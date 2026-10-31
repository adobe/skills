'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { readJarManifest, manifestImportsPackage } = require('../lib/jar.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate } = require('../lib/runtime-gate.js');

module.exports = {
  describe: 'Supported CQ Replicator / Sling Distribution; no retired Sling Replication API',
  discover: (jar, args) => {
    const manifest = readJarManifest(jar);
    const importsDistribution = manifestImportsPackage(manifest, 'org.apache.sling.distribution');
    const importsReplication = manifestImportsPackage(manifest, 'com.day.cq.replication');
    const importsUnsupported = manifestImportsPackage(manifest, 'org.apache.sling.replication');
    return { importsDistribution, importsReplication, importsUnsupported, fqcn: (args && args.fqcn) || null };
  },
  async verify({ bundleBSN, discovered, args }) {
    // Bundle state via MCP. Manifest headers are inspected offline from the
    // built artifact (see discover); replication/distribution service lists are not
    // exposed by diagnose-osgi-bundle today — tracked as a restricted check.
    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;

    if (discovered.importsUnsupported) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: 'bundle imports retired org.apache.sling.replication APIs — migration incomplete',
      };
    }

    return {
      result: 'pass',
      bundle_state: 'Active', component_state: 'Active',
      restricted: true,
      restricted_reason: 'Replication/distribution service registration and publication delivery are not verified by bundle diagnosis',
      checks: {
        imports_distribution: discovered.importsDistribution,
        imports_replication: discovered.importsReplication,
        imports_unsupported: false,
      },
    };
  },
};
