'use strict';

/**
 * Legacy UI (dialog) SOURCE invariant — from
 * migration/references/legacy-ui/dialog/. Classic UI and Coral 2 dialogs are
 * not supported on AEM Cloud Service; migrated dialogs must be Coral 3 Touch UI.
 *
 * Markers:
 *   Classic UI → xtype / cq:Dialog / cq:Widget
 *   Coral 2    → granite/ui/components/foundation/...        (no coral/)
 *   Coral 3    → granite/ui/components/coral/foundation/...
 */
function checkLegacyUiSource(src) {
  const classic = /\bxtype=|cq:Dialog|cq:Widget/.test(src);
  const coral2 = src.includes('granite/ui/components/foundation/');       // without coral/
  const coral3 = src.includes('granite/ui/components/coral/foundation/');
  const checks = { no_classic_ui: !classic, no_coral2: !coral2, uses_coral3: coral3 };

  if (classic) return { result: 'fail', failure_class: 'source.classic_ui_dialog', checks,
    evidence: 'Classic UI dialog (xtype / cq:Dialog) — not supported on AEMaaCS' };
  if (coral2) return { result: 'fail', failure_class: 'source.coral2_dialog', checks,
    evidence: 'Coral 2 resourceType (…/foundation/… without coral/) — upgrade to Coral 3' };
  if (!coral3) return { result: 'fail', failure_class: 'source.no_coral3', checks,
    evidence: 'no Coral 3 resourceType found' };
  return { result: 'pass', failure_class: null, checks };
}

module.exports = { checkLegacyUiSource };
