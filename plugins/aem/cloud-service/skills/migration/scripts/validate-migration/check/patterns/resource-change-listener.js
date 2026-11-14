'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { jarDsDescriptors } = require('../lib/jar.js');
const { componentContractFromDescriptor, sourceContractFailure, rclFlagsFromDescriptor, componentName, dsDescriptorFor } = require('../lib/descriptor.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate, componentGate } = require('../lib/runtime-gate.js');

module.exports = {
  describe: 'JCR EventListener / resource EventHandler → Sling ResourceChangeListener',
  discover: (jar, args) => {
    // Migrated code registers a ResourceChangeListener DS
    // service with resource.paths + resource.change.types properties.
    // When the caller pins a class, read that component's descriptor so the
    // contract check still runs instead of being silently skipped.
    if (args && args.fqcn) {
      const xml = dsDescriptorFor(jar, args.fqcn);
      const flags = rclFlagsFromDescriptor(xml);
      return { fqcn: args.fqcn, hasPaths: flags.hasPaths, hasChangeTypes: flags.hasChangeTypes, contract: componentContractFromDescriptor(xml, 'resource-change-listener') };
    }
    for (const [, xml] of jarDsDescriptors(jar)) {
      const providesRcl = /provide\s+interface="org\.apache\.sling\.api\.resource\.observation\.(External)?ResourceChangeListener"/.test(xml);
      const flags = rclFlagsFromDescriptor(xml);
      if (!providesRcl && !(flags.hasPaths && flags.hasChangeTypes)) continue;
      const fqcn = componentName(xml);
      if (fqcn) return { fqcn, hasPaths: flags.hasPaths, hasChangeTypes: flags.hasChangeTypes, contract: componentContractFromDescriptor(xml, 'resource-change-listener') };
    }
    return null;
  },
  async verify({ bundleBSN, discovered, args }) {
    const contractFailure = sourceContractFailure(discovered);
    if (contractFailure) return contractFailure;
    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;
    const component = componentGate(diagnosis, discovered.contract?.componentName || discovered.fqcn);
    if (component.failure) return component.failure;

    // resource.paths + resource.change.types are read from the built DS descriptor,
    // not the effective properties of the running component.
    if (!discovered.hasPaths || !discovered.hasChangeTypes) {
      const missing = [!discovered.hasPaths && 'resource.paths', !discovered.hasChangeTypes && 'resource.change.types'].filter(Boolean).join(' + ');
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: `ResourceChangeListener contract incomplete: ${missing} missing in DS descriptor`,
      };
    }
    return {
      result: 'pass', bundle_state: 'Active', component_state: 'Active',
      checks: { ...discovered.contract?.checks, resource_paths: true, resource_change_types: true },
      restricted: true,
      restricted_reason: 'effective ResourceChangeListener properties not exposed by diagnose-osgi-bundle; listener callbacks and business effects not tested',
    };
  },
};
