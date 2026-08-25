'use strict';
const fs = require('fs');
const path = require('path');
const { buildInventory } = require('./dispatcher-inventory.js');

const BETA = '> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.';
const SECTIONS = ['filter', 'rewrite', 'cache', 'clientheader', 'virtualhost'];

// Render the conversion coverage + handoff report. ADVISORY: reads verifyResult
// but never recomputes or changes `ok`. Output counts are derived with the SAME
// Phase-1 counter (buildInventory) as the source, so the two columns are symmetric.
function renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir }) {
  const src = (inventory && inventory.ruleCounts) || {};
  const out = outputSrcDir ? buildInventory(outputSrcDir).ruleCounts : {};
  const L = [];
  L.push('# Dispatcher Conversion Report', '', BETA, '');

  L.push('## Conversion coverage (source → output)', '');
  L.push('| Section | Source | Output | Status |', '|---|---|---|---|');
  for (const s of SECTIONS) {
    const a = src[s] || 0, b = out[s] || 0;
    let status;
    if (a === 0) status = 'n/a';
    else if (b >= a) status = 'preserved';
    else if (b === 0) status = '**DROPPED**';
    else status = `partial (${b}/${a})`;
    const note = (s === 'rewrite' && b < a)
      ? ' — dropped rewrites may belong at the edge (see security-hardening / performance-tuning)'
      : '';
    L.push(`| ${s} | ${a} | ${b} | ${status}${note} |`);
  }
  L.push('');

  // Echo the Phase-1 verify verdict verbatim (advisory — never recomputed).
  L.push('## Filter/ACL gate (Phase-1 verify)', '');
  if (verifyResult && verifyResult.ok) {
    L.push('- `ok`: **true** — no gate failures.');
  } else {
    L.push('- `ok`: **false** — gate failures below.');
    for (const f of (verifyResult && verifyResult.failures) || []) {
      L.push(`  - **${f.severity}** / \`${f.category}\`: ${f.detail}`);
    }
  }
  for (const w of (verifyResult && verifyResult.warnings) || []) L.push(`- warning: ${w}`);
  L.push('');

  L.push('## Cross-boundary handoff — Cloud Manager variables (→ migration Branch A)', '');
  const cmVars = (crossBoundary && crossBoundary.cmVars) || [];
  if (!cmVars.length) {
    L.push('- none detected.');
  } else {
    L.push('| Variable | Origin | Secret-like | First usage |', '|---|---|---|---|');
    for (const v of cmVars) {
      const first = v.files[0] ? `${v.files[0].path}:${v.files[0].line}` : '';
      L.push(`| \`${v.name}\` | ${v.origin} | ${v.secretLike ? 'yes' : 'no'} | ${first} |`);
    }
    L.push('', 'Hand this list to **migration Branch A** (OSGi → Cloud Manager). `secret-like` entries get Branch A\'s secret handling. Values are not captured here.');
  }
  L.push('');

  L.push('## Next checks (delegated to the dispatcher skill)', '');
  L.push('This report does not run these — route them to the `dispatcher` skill and record results:');
  L.push('- **Immutable/default freshness & drift** → `sdk(action="diff-baseline")` + `config-authoring` `validation-playbook.md` §6.');
  L.push('- **Security headers / edge hardening** → `security-hardening`.');
  L.push('- **Config validation & quality** → `config-authoring` `validate` / `lint`.');
  L.push('');
  return L.join('\n');
}

function writeReport(dir, markdown) {
  const p = path.join(dir, 'conversion-report.md');
  fs.writeFileSync(p, markdown);
  return p;
}

module.exports = { renderReport, writeReport };
