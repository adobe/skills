#!/usr/bin/env node
// Guard: the davids-model-lint icon/variant, embed, vocabulary/census, vehicle,
// empty-structure (D1-EMPTY 🟡, B7), content-loss and site-wide-constant (D-CONST / D14-OPTIONS 🟡,
// tree census) rules keep their tiers and exit codes.
//
// Why: the gate is only worth running if a mis-authored `:icon-x:` token or a
// variant token that collides with a foundation class fails the page BEFORE
// the PUT, and a legitimate page still passes — this pins both directions and
// the flag-dependent tiers (no --icons-dir → advisory only) against the
// fixtures in fixtures/davids-model-lint/.
//
// Usage: node plugins/stardust/evals/lint/davids-model-lint-fixtures.mjs  (exit 1 on findings)
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const LINT = join(HERE, '..', '..', 'skills', 'deploy', 'scripts', 'davids-model-lint.mjs');
const FIX = join(HERE, 'fixtures', 'davids-model-lint');
const ICONS = ['--icons-dir', join(FIX, 'icons')];
const STYLES = ['--styles', join(FIX, 'styles.css')];
const CHROME = ['--chrome', `${join(FIX, 'chrome', 'nav.html')},${join(FIX, 'chrome', 'footer.html')}`];

const CASES = [
  { name: 'icons: double prefix + missing asset fail with --icons-dir', args: ['fail-icons.html', ...ICONS, ...STYLES], exit: 2, red: ['ICON-PREFIX', 'ICON-MISSING'], yellow: [] },
  { name: 'icons: without --icons-dir the prefix is advisory only', args: ['fail-icons.html', ...STYLES], exit: 0, red: [], yellow: ['ICON-PREFIX'], absent: ['ICON-MISSING'] },
  { name: 'variants: reserved token, bare selector and pseudo-suffixed bare selector (.tint:hover) fail', args: ['fail-variant.html', ...ICONS, ...STYLES], exit: 2, red: ['VARIANT-COLLIDE'], yellow: [], tokens: ['"icon"', '"illu"', '"tint"'] },
  { name: 'pass: :name: token, decorated span, compound-selector variant is advisory, :not(.badge) is ignored; census/vehicle/empty rules silent', args: ['pass.html', ...ICONS, ...STYLES], exit: 0, red: [], yellow: ['VARIANT-COLLIDE'], absent: ['ICON-PREFIX', 'ICON-MISSING', 'D9-VOCAB', 'D15-STYLE', 'STYLE-SEL', 'D1-DENSITY', 'D1-SPACER', 'D15', 'D14', 'ICON-EMPTY', 'TEXT', 'D1-EMPTY', 'WRAPPER', 'D5-SERIAL', 'D2-FLATTEN', 'CHROME-LEAK'], absentTokens: ['"badge"'] },
  { name: 'tree mode: one finding per token with page count', args: ['.', ...ICONS, ...STYLES], exit: 2, oncePer: ['ICON-PREFIX'], pages: 'fail-icons.html' },
  // T30.4 — embed exemption for channel/profile URLs; the D1 prose advisory once per block name in tree mode.
  { name: 'embed: a channel/profile URL inside a block is a navigation link, not an authored embed', args: ['pass-channel.html', ...STYLES], exit: 0, count: 0 },
  { name: 'embed: a watch URL alone in a block cell stays 🔴 D1', args: ['fail-embed.html', ...STYLES], exit: 2, expect: [{ sev: '🔴', rule: 'D1', msg: 'embed/video URL' }] },
  { name: 'tree mode: an authored breadcrumbs block is ONE D1 advisory with the page count and the BREADCRUMB wording', args: ['tree-breadcrumbs', ...STYLES], exit: 0, count: 1, oncePer: ['D1'], pages: 'two.html', expect: [{ sev: '🟡', rule: 'D1', msg: 'BREADCRUMB' }, { rule: 'D1', msg: 'on 2 pages' }] },
  { name: 'single file: the breadcrumbs block keeps the BREADCRUMB remedy with the per-page wording (pinned choice)', args: ['tree-breadcrumbs/one.html', ...STYLES], exit: 0, count: 1, expect: [{ sev: '🟡', rule: 'D1', msg: 'BREADCRUMB' }, { rule: 'D1', msg: 'on this page' }] },
  // T29.2 — vocabulary census: every rule 🟡, exit 0, rollups once per rule/token, census in --json (tree mode).
  {
    name: 'census (tree): D9-VOCAB ×4 sub-rules, D15-STYLE per layout token, STYLE-SEL only for tokens no selector reaches, D1-DENSITY and D1-SPACER once',
    args: ['tree-vocab', '--styles', join(FIX, 'styles-vocab.css')], exit: 0, red: [],
    expect: [
      { sev: '🟡', rule: 'D9-VOCAB', msg: '14 distinct section-style tokens' },
      { sev: '🟡', rule: 'D9-VOCAB', msg: 'block "cards": 7 distinct variant strings' },
      { sev: '🟡', rule: 'D9-VOCAB', msg: 'cards "promo duo arrow"' },
      { sev: '🟡', rule: 'D9-VOCAB', msg: '12 of 13 block names appear on one page only' },
      { sev: '🟡', rule: 'D15-STYLE', msg: '"pb-sm"' }, { sev: '🟡', rule: 'D15-STYLE', msg: '"cols-8-4"' }, { sev: '🟡', rule: 'D15-STYLE', msg: '"true"' },
      { sev: '🟡', rule: 'STYLE-SEL', msg: '"wide"' },
      { sev: '🟡', rule: 'D1-DENSITY', msg: '1/3 pages carry > 12 sections, max 13' },
      { sev: '🟡', rule: 'D1-SPACER', msg: '2 section(s) (8.3 %)' },
    ],
    absentMsg: [{ rule: 'STYLE-SEL', msg: '"dark"' }, { rule: 'STYLE-SEL', msg: '"tinted"' }, { rule: 'STYLE-SEL', msg: '"narrow"' }, { rule: 'STYLE-SEL', msg: '"band-navy"' }, { rule: 'D15-STYLE', msg: '"dark"' }],
    counts: { 'D9-VOCAB': 4, 'D15-STYLE': 3, 'STYLE-SEL': 9, 'D1-DENSITY': 1, 'D1-SPACER': 1 },
    check: (out) => {
      const c = out.census;
      if (!c) return 'census missing from --json in tree mode';
      const cards = c.blocks.find((b) => b.name === 'cards');
      const bad = [
        c.styles.length !== 14 && `styles ${c.styles.length} ≠ 14`,
        !(cards && cards.instances === 7 && cards.pages === 1) && `cards ${JSON.stringify(cards)}`,
        c.variants.filter((v) => v.block === 'cards').length !== 7 && 'cards variants ≠ 7',
        c.sections.perPage.over12 !== 1 && 'over12 ≠ 1', c.sections.perPage.max !== 13 && 'max ≠ 13',
        c.sections.metadataOnly.count !== 2 && 'metadataOnly ≠ 2',
        c.styles.find((s) => s.token === 'band-navy').selector !== true && 'band-navy selector via [class*=] not true',
        c.styles.find((s) => s.token === 'wide').selector !== false && 'wide selector not false',
      ].filter(Boolean);
      return bad.length ? `census: ${bad.join('; ')}` : null;
    },
  },
  { name: 'census (single file): D1-DENSITY is a per-page line and --json carries no census', args: ['tree-vocab/a.html', '--styles', join(FIX, 'styles-vocab.css')], exit: 0, expect: [{ sev: '🟡', rule: 'D1-DENSITY', msg: '13 sections on one page' }], check: (out) => (out.census ? 'census present in single-file mode' : null) },
  // T31.2 — D15 VEHICLE rules: all 🟡, exit 0; tree mode one line per vehicle.
  {
    name: 'vehicles: <u>, empty <code>, NBSP/ZWSP-only <p>, superscript digit, :spacer: (+ ICON-EMPTY), DUPROW pair — all 🟡; CO₂/m² and a 3-row cards block do not fire',
    args: ['fail-vehicle.html', ...ICONS, ...STYLES], exit: 0, red: [],
    expect: [
      { sev: '🟡', rule: 'D15', msg: '1 <u> element(s)' },
      { sev: '🟡', rule: 'D15', msg: '1 empty <code> spacer(s)' },
      { sev: '🟡', rule: 'D15', msg: '2 invisible-character spacer paragraph(s)' },
      { sev: '🟡', rule: 'D15', msg: '1 Unicode superscript/subscript digit(s) ("Boarding¹")' },
      { sev: '🟡', rule: 'D15', msg: '":spacer:" is a spacer vehicle' },
      { sev: '🟡', rule: 'ICON-EMPTY', msg: 'icons/spacer.svg has no child element' },
      { sev: '🟡', rule: 'D14', msg: 'block "columns": row 2 duplicates row 1 (J=0.' },
    ],
    absentMsg: [{ rule: 'D14', msg: 'block "cards"' }, { rule: 'ICON-MISSING' }],
    counts: { D14: 1, 'ICON-EMPTY': 1 },
  },
  { name: 'vehicles (tree): one rollup line per vehicle with the page count', args: ['tree-vehicle', ...ICONS, ...STYLES], exit: 0, count: 2, expect: [{ sev: '🟡', rule: 'D15', msg: '2 <u> element(s) across 2 page(s)' }, { sev: '🟡', rule: 'D15', msg: '2 invisible-character spacer paragraph(s) (NBSP/ZWSP/ZWNJ only) across 2 page(s)' }] },
  // T16.2 / T30.2 — D1-EMPTY ships 🟡 (B7: new tiers advisory first; promote after one clean wave): zero-row block,
  // all-empty cells, empty section — exit 0, never 🔴; --allow-empty declares placeholders.
  { name: 'empty: a 0-row block, an all-empty-cells block, an undeclared placeholder and an empty section are four D1-EMPTY 🟡, exit 0 (B7)', args: ['warn-empty.html', ...STYLES], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'D1-EMPTY', msg: 'block "cards": block table with 0 rows' }, { sev: '🟡', rule: 'D1-EMPTY', msg: 'block "hero": 1 row(s) whose every cell is empty' }, { sev: '🟡', rule: 'D1-EMPTY', msg: 'block "form": block table with 0 rows' }, { sev: '🟡', rule: 'D1-EMPTY', msg: 'section 2: no text, link, image or block' }], counts: { 'D1-EMPTY': 4 } },
  { name: 'empty: --allow-empty exempts the named placeholders only', args: ['warn-empty.html', ...STYLES, '--allow-empty', 'form,cards'], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'D1-EMPTY', msg: 'block "hero"' }, { sev: '🟡', rule: 'D1-EMPTY', msg: 'section 2' }], absentMsg: [{ rule: 'D1-EMPTY', msg: '"form"' }, { rule: 'D1-EMPTY', msg: '"cards"' }], counts: { 'D1-EMPTY': 2 } },
  { name: 'empty: a declared placeholder, a section-metadata-only spacer section, an icon-only cell and an icon-only section pass; D1-SPACER and D9-VOCAB are tree-only', args: ['pass-empty.html', ...STYLES, '--allow-empty', 'form'], exit: 0, red: [], absent: ['D1-EMPTY', 'D1-SPACER', 'D9-VOCAB'] },
  { name: 'empty (tree): the icon-only cell and section stay silent in tree mode too; the spacer count fires as one D1-SPACER line', args: ['pass-empty.html', 'tree-breadcrumbs/one.html', ...STYLES, '--allow-empty', 'form'], exit: 0, red: [], absent: ['D1-EMPTY'], expect: [{ sev: '🟡', rule: 'D1-SPACER', msg: '1 section(s)' }], counts: { 'D1-SPACER': 1 } },
  { name: 'usage: a dangling --allow-empty is a usage error', args: ['pass-empty.html', ...STYLES, '--allow-empty'], exit: 1 },
  // T30.2 — content-loss detectors: WRAPPER 🔴; D5-SERIAL, D2-FLATTEN, CHROME-LEAK 🟡.
  { name: 'wrapper: an unclassed section child and a classed wrapper around a block are two WRAPPER 🔴 (no secondary findings on the wrapper)', args: ['fail-wrapper.html', ...STYLES], exit: 2, expect: [{ sev: '🔴', rule: 'WRAPPER', msg: 'section 1: unclassed <div> child' }, { sev: '🔴', rule: 'WRAPPER', msg: 'block "nested-bg": direct child <div class="horizontal-card">' }], counts: { WRAPPER: 2 }, absent: ['D1-EMPTY', 'D2'] },
  { name: 'serial: five |-joined options in one cell is one D5-SERIAL advisory', args: ['warn-serial.html', ...STYLES], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'D5-SERIAL', msg: 'serialised list of 5 segments' }], counts: { 'D5-SERIAL': 1 } },
  { name: 'flatten: three headings inside one cell is one D2-FLATTEN advisory', args: ['warn-flatten.html', ...STYLES], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'D2-FLATTEN', msg: '3 headings inside one cell' }], counts: { 'D2-FLATTEN': 1 } },
  { name: 'chrome-leak: an 11-link list before the first heading fires without --chrome', args: ['warn-chrome-leak.html', ...STYLES], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'CHROME-LEAK', msg: 'a list of 11 links before the first heading' }], counts: { 'CHROME-LEAK': 1 } },
  { name: 'chrome-leak: 9 chrome link labels on a page fire with --chrome, not without; --chrome-min 10 silences', args: ['warn-chrome-labels.html', ...STYLES, ...CHROME], exit: 0, red: [], expect: [{ sev: '🟡', rule: 'CHROME-LEAK', msg: '9 of this page\'s link labels are chrome labels' }], counts: { 'CHROME-LEAK': 1 } },
  { name: 'chrome-leak: silent without --chrome (labels are never matched on page text)', args: ['warn-chrome-labels.html', ...STYLES], exit: 0, absent: ['CHROME-LEAK'] },
  { name: 'chrome-leak: --chrome-min 10 silences the 9-label page', args: ['warn-chrome-labels.html', ...STYLES, ...CHROME, '--chrome-min', '10'], exit: 0, absent: ['CHROME-LEAK'] },
  { name: 'chrome-leak: a chrome document itself never fires', args: ['chrome/nav.html', ...STYLES, ...CHROME], exit: 0, absent: ['CHROME-LEAK'] },
  { name: 'usage: a --chrome file that does not exist is a usage error', args: ['pass.html', '--chrome', join(FIX, 'chrome', 'nope.html')], exit: 1 },
  { name: 'usage: --styles that does not exist is a usage error', args: ['pass.html', '--styles', join(FIX, 'nope.css')], exit: 1 },
  { name: 'usage: a dangling --icons-dir is a usage error, not a silent downgrade', args: ['fail-icons.html', ...STYLES, '--icons-dir'], exit: 1 },
  // T30.1 — D-CONST (tree only) and D14-OPTIONS: both 🟡 (B7), exit 0; constants in --json census.
  {
    name: 'D-CONST (tree): a row identical on 5/6 and one on 6/6 toc instances fire once each; the listing <ul> label row and the Source-headed form are silent; D14-OPTIONS on the modello option row',
    args: ['tree-const', ...STYLES], exit: 0, red: [],
    expect: [
      { sev: '🟡', rule: 'D-CONST', msg: 'row "Table of Contents" identical in 5/6 instances (5 pages)' },
      { sev: '🟡', rule: 'D-CONST', msg: 'row "Show all" identical in 6/6 instances (6 pages)' },
      { sev: '🟡', rule: 'D14-OPTIONS', msg: 'row "modello" carries an option list of 5 values' },
    ],
    absentMsg: [{ rule: 'D-CONST', msg: '"listing"' }, { rule: 'D-CONST', msg: '"form"' }, { rule: 'D-CONST', msg: '"filters"' }],
    counts: { 'D-CONST': 2, 'D14-OPTIONS': 1 },
    check: (out) => (out.census && Array.isArray(out.census.constants) && out.census.constants.length === 2 ? null : `census.constants: ${JSON.stringify(out.census && out.census.constants)}`),
  },
  { name: 'D-CONST is tree-only; D14-OPTIONS fires per page in single-file mode', args: ['tree-const/one.html', ...STYLES], exit: 0, absent: ['D-CONST'], expect: [{ sev: '🟡', rule: 'D14-OPTIONS', msg: 'option list of 5 values' }] },
];

const failures = [];
for (const c of CASES) {
  const r = spawnSync(process.execPath, [LINT, ...c.args, '--json'], { cwd: FIX, encoding: 'utf8' });
  const label = `${c.name} [${c.args.filter((a) => !a.startsWith('/')).join(' ')}]`;
  if (r.status !== c.exit) { failures.push(`${label}: exit ${r.status}, expected ${c.exit}\n${r.stderr || r.stdout}`); continue; }
  if (c.exit === 1) continue;
  let out;
  try { out = JSON.parse(r.stdout); } catch (e) { failures.push(`${label}: --json output is not JSON`); continue; }
  const rules = (sev) => out.findings.filter((f) => f.sev === sev).map((f) => f.rule);
  for (const id of c.red || []) if (!rules('🔴').includes(id)) failures.push(`${label}: expected 🔴 ${id}`);
  for (const id of c.yellow || []) if (!rules('🟡').includes(id)) failures.push(`${label}: expected 🟡 ${id}`);
  for (const id of c.absent || []) if (out.findings.some((f) => f.rule === id)) failures.push(`${label}: unexpected ${id}`);
  // expect / absentMsg: { sev?, rule, msg? } — msg is a substring the finding text must contain; count pins the total.
  const hit = (e) => out.findings.filter((f) => f.rule === e.rule && (!e.sev || f.sev === e.sev) && (!e.msg || f.msg.includes(e.msg)));
  for (const e of c.expect || []) if (!hit(e).length) failures.push(`${label}: expected ${e.sev || ''} ${e.rule}${e.msg ? ` (…${e.msg}…)` : ''}`);
  for (const e of c.absentMsg || []) if (hit(e).length) failures.push(`${label}: unexpected ${e.rule}${e.msg ? ` (…${e.msg}…)` : ''}`);
  if (c.count !== undefined && out.findings.length !== c.count) failures.push(`${label}: ${out.findings.length} finding(s), expected ${c.count}:\n  ${out.findings.map((f) => `${f.sev} ${f.rule} ${f.msg.slice(0, 80)}`).join('\n  ')}`);
  for (const [rule, n] of Object.entries(c.counts || {})) { const k = out.findings.filter((f) => f.rule === rule).length; if (k !== n) failures.push(`${label}: ${rule} reported ${k}×, expected ${n}`); }
  if (c.check) { const err = c.check(out); if (err) failures.push(`${label}: ${err}`); }
  for (const t of c.tokens || []) if (!out.findings.some((f) => f.rule === 'VARIANT-COLLIDE' && f.msg.includes(t))) failures.push(`${label}: expected VARIANT-COLLIDE for ${t}`);
  for (const t of c.absentTokens || []) if (out.findings.some((f) => f.rule === 'VARIANT-COLLIDE' && f.msg.includes(t))) failures.push(`${label}: unexpected VARIANT-COLLIDE for ${t}`);
  for (const id of c.oncePer || []) {
    const hits = out.findings.filter((f) => f.rule === id);
    if (hits.length !== 1) failures.push(`${label}: ${id} reported ${hits.length}×, expected once`);
    else if (!(hits[0].pages || []).some((p) => p.endsWith(c.pages))) failures.push(`${label}: ${id} pages ${JSON.stringify(hits[0].pages)} lack ${c.pages}`);
  }
}
if (failures.length) { console.error(`davids-model-lint fixtures: ${failures.length} failure(s)\n${failures.join('\n')}`); process.exit(1); }
console.log(`davids-model-lint fixtures: ${CASES.length} cases pass (${relative(process.cwd(), FIX)})`);
