'use strict';
const fs = require('fs');
const path = require('path');
const { buildInventory, countRewrites } = require('./dispatcher-inventory.js');

const BETA = '> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.';
const SECTIONS = ['filter', 'rewrite', 'cache', 'clientheader', 'virtualhost'];

// Render the conversion coverage + handoff report. ADVISORY: reads verifyResult but never
// recomputes or changes `ok`. Source counts use the Phase-1 counter (buildInventory).
// Output counts are custom-only — the rewrite figure is overridden with the shared
// countRewrites({excludeDefault:true}) (same counter verifyOutput's rewrite warning uses) so a
// surviving Adobe-managed default_rewrite.rules can't mask dropped custom rewrites (matching the
// filter gate) and verify + report agree. With no outputSrcDir the Output/Status columns read
// "not scanned" (source inventory only), never a false DROPPED.
function renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir }) {
  const src = (inventory && inventory.ruleCounts) || {};
  const scanned = !!outputSrcDir;
  const out = scanned ? buildInventory(outputSrcDir).ruleCounts : {};
  // Override the rewrite figure with the custom-only count (excludes default_*) so a
  // surviving SDK default_rewrite.rules can't inflate output and mask dropped custom rewrites.
  if (scanned) out.rewrite = countRewrites(outputSrcDir, { excludeDefault: true });
  const L = [];
  L.push('# Dispatcher Conversion Report', '', BETA, '');

  L.push('## Conversion coverage (source → output)', '');
  L.push('| Section | Source | Output | Status |', '|---|---|---|---|');
  // Only filter (gate-echoed) and rewrite (reliably file-counted) get hard preserved/DROPPED
  // verdicts. cache/clientheaders/virtualhosts are counted from inline farm bodies only; their
  // custom entries may live in $include'd files we don't resolve here, so a hard DROPPED would be
  // a false alarm — render them advisory and delegate precise reconciliation to validate/lint.
  const PRECISE = new Set(['filter', 'rewrite']);
  for (const s of SECTIONS) {
    const a = src[s] || 0;
    if (!scanned) { L.push(`| ${s} | ${a} | not scanned | not scanned |`); continue; }
    const b = out[s] || 0;
    let status;
    if (!PRECISE.has(s)) {
      // Counted from inline farm bodies only; custom entries may live in $include'd files we
      // don't resolve here — do not assert a false DROPPED. Precise reconciliation is delegated.
      status = a === 0 ? 'n/a' : 'inline — verify via `validate`/`lint`';
    } else if (a === 0) status = 'n/a';
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
    ? '> Output counts are **custom-only** — Adobe-managed `default_*` immutables are excluded (matching the filter gate), so the rewrite figure can differ from the raw verify warning. Only `filter` and `rewrite` carry hard preserved/DROPPED verdicts; `cache` / `clientheaders` / `virtualhosts` are **inline-counted** (advisory) — custom entries may live in `$include`\'d files, so they are precisely reconciled by the delegated `validate` / `lint` checks, never asserted DROPPED here.'
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
