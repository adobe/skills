'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { readJarManifest, manifestImportsPackage } = require('../lib/jar.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate } = require('../lib/runtime-gate.js');

module.exports = {
  describe: 'CQ Replicator / Sling Replicator → Sling Distribution API',
  discover: (jar, args) => {
    // Discovery on manifest: bundle imports org.apache.sling.distribution
    // (migrated) and NOT com.day.cq.replication (legacy). Class detection
    // is optional; we verify at the bundle level.
    const manifest = readJarManifest(jar);
    const importsDistribution = manifestImportsPackage(manifest, 'org.apache.sling.distribution');
    const importsLegacy = manifestImportsPackage(manifest, 'com.day.cq.replication');
    return { importsDistribution, importsLegacy, fqcn: (args && args.fqcn) || null };
  },
  async verify({ bundleBSN, discovered, args }) {
    // Bundle state via MCP. Manifest headers are inspected offline from the
    // built artifact (see discover); the Distributor service list is not
    // exposed by diagnose-osgi-bundle today — tracked as a restricted check.
    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;

    if (discovered.importsLegacy) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: 'bundle still imports com.day.cq.replication — migration incomplete',
      };
    }
    if (!discovered.importsDistribution) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: 'bundle does not import org.apache.sling.distribution — migration incomplete',
      };
    }

    return {
      result: 'pass',
      bundle_state: 'Active', component_state: 'Active',
      restricted: true,
      restricted_reason: 'Distributor service registration not exposed by diagnose-osgi-bundle',
      checks: { imports_distribution: true, imports_legacy: false },
    };
  },
};
