'use strict';
const fs = require('fs');
const path = require('path');
const { buildInventory, readTextFiles } = require('./dispatcher-inventory.js');

const BETA = '> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.';
const SECTIONS = ['filter', 'rewrite', 'cache', 'clientheader', 'virtualhost'];

// Custom-only rewrite count: exclude Adobe-managed default_* immutables (esp.
// default_rewrite.rules — SDK boilerplate the converter always adds) so a surviving SDK
// default can't mask dropped custom rewrites — matching how countFilterRules treats
// default_*.any. Glob aligned with dispatcher-verify.js (.rules + .vhost). ADVISORY: this
// only counts; it never imports or calls verifyOutput.
function countCustomRewrites(dir) {
  const files = readTextFiles(dir, n =>
    (n.endsWith('.rules') || n.endsWith('.vhost')) && !n.startsWith('default_'));
  let n = 0;
  for (const f of files) {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    n += (t.match(/^\s*(RewriteRule|Redirect(Match)?)\b/gm) || []).length;
  }
  return n;
}

// Render the conversion coverage + handoff report. ADVISORY: reads verifyResult but never
// recomputes or changes `ok`. Source counts use the Phase-1 counter (buildInventory).
// Output counts are custom-only — the rewrite figure is overridden with countCustomRewrites
// so a surviving Adobe-managed default_rewrite.rules can't mask dropped custom rewrites
// (matching the filter gate). With no outputSrcDir the Output/Status columns read
// "not scanned" (source inventory only), never a false DROPPED.
function renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir }) {
  const src = (inventory && inventory.ruleCounts) || {};
  const scanned = !!outputSrcDir;
  const out = scanned ? buildInventory(outputSrcDir).ruleCounts : {};
  // Override the rewrite figure with the custom-only count (excludes default_*) so a
  // surviving SDK default_rewrite.rules can't inflate output and mask dropped custom rewrites.
  if (scanned) out.rewrite = countCustomRewrites(outputSrcDir);
  const L = [];
  L.push('# Dispatcher Conversion Report', '', BETA, '');

  L.push('## Conversion coverage (source → output)', '');
  L.push('| Section | Source | Output | Status |', '|---|---|---|---|');
  for (const s of SECTIONS) {
    const a = src[s] || 0;
    if (!scanned) {
      L.push(`| ${s} | ${a} | not scanned | not scanned |`);
      continue;
    }
    const b = out[s] || 0;
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
  L.push(scanned
    ? '> Output counts are **custom-only** — Adobe-managed `default_*` immutables are excluded (matching the filter gate), so the rewrite figure can differ from the raw verify warning.'
    : '> Output **not scanned** — no `outputSrcDir` provided; Output/Status show source inventory only. Run against the converted tree to populate coverage.');
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
