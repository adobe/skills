'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { jarDsDescriptors, jarReferencesClass } = require('../lib/jar.js');
const { componentName } = require('../lib/descriptor.js');
const { getBundleDiagnosis } = require('../lib/diagnosis.js');
const { bundleGate, componentGate } = require('../lib/runtime-gate.js');

// Legacy DAM API class that migrated bundles must no longer reference.
const LEGACY_ASSET_MANAGER = 'com.day.cq.dam.api.AssetManager';

module.exports = {
  describe: 'AssetManager → ResourceResolver (Cloud Service asset ops)',
  discover: (jar, args) => {
    // Legacy code imports com.day.cq.dam.api.AssetManager. Migrated code
    // uses ResourceResolver.delete/adaptTo(Asset.class) via the resolver
    // factory. Discovery = the bundle-level manifest check + any DS
    // component with `sling.resource.type` or a service that references
    // ResourceResolverFactory. If the caller pinned a class, take it.
    // Legacy AssetManager usage is a class-level reference in the bytecode,
    // not a manifest import (Import-Package only lists the package), so scan
    // the compiled classes for it independently of the DS component.
    const usesLegacyAssetManager = jarReferencesClass(jar, LEGACY_ASSET_MANAGER);
    if (args && args.fqcn) return { fqcn: args.fqcn, usesLegacyAssetManager };
    for (const [, xml] of jarDsDescriptors(jar)) {
      if (!/reference\s+[^>]*interface="org\.apache\.sling\.api\.resource\.ResourceResolverFactory"/.test(xml)) continue;
      const fqcn = componentName(xml);
      if (fqcn) return { fqcn, usesLegacyAssetManager };
    }
    return { fqcn: null, usesLegacyAssetManager };
  },
  async verify({ bundleBSN, discovered, args }) {
    const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
    const bundleFailure = bundleGate(diagnosis, bundleBSN);
    if (bundleFailure) return bundleFailure;

    // Class references are read offline from the built artifact — not from
    // the SDK — so this stays MCP-independent.
    if (discovered.usesLegacyAssetManager) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
        bundle_state: 'Active', component_state: 'Active',
        evidence: 'bundle still references com.day.cq.dam.api.AssetManager — migration incomplete',
      };
    }

    // Satisfied is fine for a service-only component that nothing has activated yet.
    const component = discovered.fqcn ? componentGate(diagnosis, discovered.fqcn, { allowSatisfied: true }) : { state: 'Active' };
    if (component.failure) return component.failure;

    return { result: 'pass', bundle_state: 'Active', component_state: component.state, checks: { uses_legacy_asset_manager: false } };
  },
};
