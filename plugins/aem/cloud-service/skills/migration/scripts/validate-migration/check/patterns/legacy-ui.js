'use strict';

const { execFileSync } = require('child_process');
const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { classifyDialog, discoverDialogs, dialogRuleViolations, isTouchDialog, dialogLabel } = require('../lib/dialogs.js');

module.exports = {
  describe: 'Classic UI / Coral 2 dialogs → Coral 3 (offline source check)',
  mode: 'source-only',
  // Auto mode verifies only dialogs the branch changed, so a partial migration or a
  // kept Classic backup elsewhere doesn't fail the run; explicit --pattern scans all.
  discover: discoverDialogs,
  async verify({ artifactPath, discovered }) {
    const classic = [];
    const coral2 = [];
    const coral3 = [];
    const ruleFailures = [];
    let ruleWarnings = 0;
    for (const p of discovered.dialogs) {
      const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
      const kind = classifyDialog(xml);
      if (kind === 'classic') classic.push(p);
      else if (kind === 'coral2') coral2.push(p);
      else if (kind === 'coral3') coral3.push(p);
      // The checklist gates dialogs the migration produced (branch diff); in a
      // full-package scan, hits on other dialogs are surfaced as warnings only.
      if (kind !== 'classic' && isTouchDialog(p)) {
        const { blocking, warnings } = dialogRuleViolations(xml);
        if (blocking.length && discovered.changedOnly) ruleFailures.push(`${dialogLabel(p)}: ${blocking.join(', ')}`);
        ruleWarnings += warnings.length + (discovered.changedOnly ? 0 : blocking.length);
      }
    }
    const bad = classic.length + coral2.length + ruleFailures.length;
    if (bad > 0) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH,
        bundle_state: null, component_state: null,
        evidence: `${classic.length} Classic UI + ${coral2.length} Coral 2 dialogs remain (Coral 3 ok: ${coral3.length})`
          + (ruleFailures.length ? `; migration dialog validation.md rules failed — ${ruleFailures.join('; ')}` : ''),
        checks: { dialogs_total: discovered.dialogs.length, classic: classic.length, coral2: coral2.length, coral3: coral3.length,
          rule_failures: ruleFailures.length, rule_warnings: ruleWarnings },
      };
    }
    return {
      result: 'pass',
      bundle_state: null, component_state: null,
      checks: { dialogs_total: discovered.dialogs.length, coral3: coral3.length, rule_warnings: ruleWarnings },
    };
  },
};
