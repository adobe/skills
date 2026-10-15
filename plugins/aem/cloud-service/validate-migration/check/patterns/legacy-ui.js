'use strict';

const { execFileSync } = require('child_process');
const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { classifyDialog, discoverDialogs } = require('../lib/dialogs.js');

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
    for (const p of discovered.dialogs) {
      const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
      const kind = classifyDialog(xml);
      if (kind === 'classic') classic.push(p);
      else if (kind === 'coral2') coral2.push(p);
      else if (kind === 'coral3') coral3.push(p);
    }
    const bad = classic.length + coral2.length;
    if (bad > 0) {
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH,
        bundle_state: null, component_state: null,
        evidence: `${classic.length} Classic UI + ${coral2.length} Coral 2 dialogs remain (Coral 3 ok: ${coral3.length})`,
        checks: { dialogs_total: discovered.dialogs.length, classic: classic.length, coral2: coral2.length, coral3: coral3.length },
      };
    }
    return {
      result: 'pass',
      bundle_state: null, component_state: null,
      checks: { dialogs_total: discovered.dialogs.length, coral3: coral3.length },
    };
  },
};
