'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { jarDsDescriptors, jarReferencedMethods } = require('../lib/jar.js');
const { componentName } = require('../lib/descriptor.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate, componentGate } = require('../lib/runtime-gate.js');

// AssetManager stays supported on Cloud Service; only its binary-path methods
// were removed (see code-assessment/asset-manager/SKILL.md).
const ASSET_MANAGER = 'com.day.cq.dam.api.AssetManager';
const REMOVED_METHODS = ['createAssetForBinary', 'getAssetForBinary', 'removeAssetForBinary'];

module.exports = {
  describe: 'AssetManager binary-path methods → Cloud Service asset APIs',
  discover: (jar, args) => {
    // Removed AssetManager calls are read from the compiled classes; the
    // component under test is the DS service that uses ResourceResolverFactory.
    const removedAssetManagerCalls = jarReferencedMethods(jar, ASSET_MANAGER, REMOVED_METHODS);
    if (args && args.fqcn) return { fqcn: args.fqcn, removedAssetManagerCalls };
    for (const [, xml] of jarDsDescriptors(jar)) {
      if (!/reference\s+[^>]*interface="org\.apache\.sling\.api\.resource\.ResourceResolverFactory"/.test(xml)) continue;
      const fqcn = componentName(xml);
      if (fqcn) return { fqcn, removedAssetManagerCalls };
    }
    return { fqcn: null, removedAssetManagerCalls };
  },
  async verify({ bundleBSN, discovered, args }) {
    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;

    // Class references are read offline from the built artifact — not from
    // the SDK — so this stays MCP-independent.
    const removed = discovered.removedAssetManagerCalls || [];
    if (removed.length) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: `bundle still calls AssetManager methods removed on Cloud Service: ${removed.join(', ')}`,
      };
    }

    // Satisfied is fine for a service-only component that nothing has activated yet.
    const component = discovered.fqcn ? componentGate(diagnosis, discovered.fqcn, { allowSatisfied: true }) : { state: 'Active' };
    if (component.failure) return component.failure;

    return { result: 'pass', bundle_state: 'Active', component_state: component.state, checks: { removed_asset_manager_calls: 0 } };
  },
};
