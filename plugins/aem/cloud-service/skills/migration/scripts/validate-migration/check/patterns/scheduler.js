'use strict';

const path = require('path');
const { jarDsDescriptors } = require('../lib/jar.js');
const { descriptorProperty, componentContractFromDescriptor, sourceContractFailure, componentName, dsDescriptorFor } = require('../lib/descriptor.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate, componentGate } = require('../lib/runtime-gate.js');

module.exports = {
  describe: 'Sling Scheduler (Cloud Service contract)',
  discover: (jar, args) => {
    // If the caller pinned a class, take it verbatim.
    if (args && args.fqcn) return { fqcn: args.fqcn, contract: componentContractFromDescriptor(dsDescriptorFor(jar, args.fqcn), 'scheduler') };
    // Otherwise match any DS descriptor with scheduler.expression. Prefer the
    // one that ALSO declares scheduler.runOn (the migrated one).
    const candidates = [];
    for (const [fname, xml] of jarDsDescriptors(jar)) {
      if (!descriptorProperty(xml, 'scheduler.expression').present) continue;
      const hasRunOn = descriptorProperty(xml, 'scheduler.runOn').present;
      candidates.push({ fqcn: componentName(xml) || path.basename(fname, '.xml'), hasRunOn });
    }
    if (candidates.length === 0) return null;
    const migrated = candidates.find((c) => c.hasRunOn);
    if (!migrated && candidates.length > 1) {
      console.log(`  note: ${candidates.length} scheduler classes in jar, none declare scheduler.runOn; picking ${candidates[0].fqcn} — pass --fqcn to override`);
    }
    const fqcn = (migrated || candidates[0]).fqcn;
    return { fqcn, contract: componentContractFromDescriptor(dsDescriptorFor(jar, fqcn), 'scheduler') };
  },
  async verify({ bundleBSN, discovered, args }) {
    const contractFailure = sourceContractFailure(discovered);
    if (contractFailure) return contractFailure;

    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;
    const component = componentGate(diagnosis, discovered.contract?.componentName || discovered.fqcn);
    if (component.failure) return component.failure;

    // Contract properties (scheduler.expression, scheduler.runOn, etc.) are
    // not exposed by diagnose-osgi-bundle today. Report as restricted so the
    // agent knows the bundle+component check passed but the DS-property
    // contract could not be verified. Track as an MCP feature request.
    return {
      result: 'pass',
      bundle_state: 'Active',
      component_state: 'Active',
      checks: { ...discovered.contract?.checks, migration_contract: 'pass', business_behavior: 'not_tested' },
      restricted: true,
      restricted_reason: 'effective scheduler DS properties not exposed by diagnose-osgi-bundle; scheduled execution and cluster behavior not verified',
    };
  },
};
