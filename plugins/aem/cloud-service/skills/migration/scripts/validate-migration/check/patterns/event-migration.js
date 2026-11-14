'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { jarDsDescriptors } = require('../lib/jar.js');
const { descriptorProperty, topicFromDescriptor, componentContractFromDescriptor, sourceContractFailure, componentName, dsDescriptorFor } = require('../lib/descriptor.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate, componentGate } = require('../lib/runtime-gate.js');

module.exports = {
  describe: 'OSGi EventHandler → Sling JobConsumer',
  discover: (jar, args) => {
    // Migrated code declares a JobConsumer with job.topics property.
    // When the caller pins a class, read that component's descriptor so the
    // topic check still runs instead of being silently skipped.
    if (args && args.fqcn) {
      const xml = dsDescriptorFor(jar, args.fqcn);
      return { fqcn: args.fqcn, topic: topicFromDescriptor(xml), contract: componentContractFromDescriptor(xml, 'event-migration') };
    }
    for (const [, xml] of jarDsDescriptors(jar)) {
      if (!descriptorProperty(xml, 'job.topics').present) continue;
      const fqcn = componentName(xml);
      if (fqcn) return { fqcn, topic: topicFromDescriptor(xml), contract: componentContractFromDescriptor(xml, 'event-migration') };
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

    // job.topics is read at discovery time from the built DS descriptor
    // (offline), so no Felix property lookup is needed.
    if (!discovered.topic) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: 'JobConsumer contract missing job.topics property in DS descriptor',
      };
    }
    return {
      result: 'pass', bundle_state: 'Active', component_state: 'Active',
      checks: { ...discovered.contract?.checks, topic: discovered.topic },
      restricted: true,
      restricted_reason: 'effective JobConsumer properties not exposed by diagnose-osgi-bundle; job processing and business effects not tested',
    };
  },
};
