'use strict';

/**
 * Asset Manager SOURCE invariant — offline gate, from
 * code-assessment/asset-manager/SKILL.md.
 *
 * The binary-path Asset Manager APIs are REMOVED on AEM Cloud Service (no
 * filesystem path in the cloud JVM). RV checks the migrated source:
 *   - no removed binary APIs: createAssetForBinary / getAssetForBinary /
 *     removeAssetForBinary
 *   - the CS replacement is present for the delete path:
 *     resolver.delete(...) + resolver.commit()
 */
function checkAssetManagerSource(src) {
  const removed = /(createAssetForBinary|getAssetForBinary|removeAssetForBinary)\s*\(/.test(src);
  const usesResolverDelete = /\bresolver\.delete\s*\(/.test(src) && /\.commit\s*\(/.test(src);

  const checks = {
    no_removed_binary_api: !removed,
    uses_resolver_delete_commit: usesResolverDelete,
  };

  if (removed) return { result: 'fail', failure_class: 'source.removed_asset_api', checks,
    evidence: 'uses a removed AssetManager binary API (…ForBinary) — not available on AEMaaCS' };
  if (!usesResolverDelete) return { result: 'fail', failure_class: 'source.no_supported_delete', checks,
    evidence: 'no resolver.delete() + commit() — CS delete path not applied' };
  return { result: 'pass', failure_class: null, checks };
}

module.exports = { checkAssetManagerSource };
