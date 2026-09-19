#!/usr/bin/env node
// Guard: the deploy lane's two exit-2 gates keep their codes, tiers and exit codes.
//
// Why: davids-model-lint's pipeline-shape rules (TABLE, branch-host and
// protocol-relative D4, STYLE-SPACE, JSON, SOLE-EMPH, META ALONE/CHROME, HBR,
// TEXT-LEAK, TEXT, CHROME, CONTENT, LOCALIZE) and block-lint (BL-CSS, BL-MEDIA,
// BL-GUARD, IMG-HARDCODED with the @fixed-asset exemption) run BEFORE the PUT
// and before the harness respectively; none of what they catch shows locally.
// A rule that fires on a clean page, or stays silent on the shape it names, is
// worse than no rule — so both directions are pinned against small fixtures:
//   fixtures/davids-model-lint-shapes/  content pages (+ nav.html, fragments/promo.html)
//   fixtures/block-lint/{fail,pass}/    blocks/ + scripts/scripts.js
//
// Usage: node plugins/stardust/evals/lint/deploy-lint-fixtures.mjs  (exit 1 on findings)
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const SCRIPTS = join(HERE, '..', '..', 'skills', 'deploy', 'scripts');
const DM = { bin: join(SCRIPTS, 'davids-model-lint.mjs'), cwd: join(HERE, 'fixtures', 'davids-model-lint-shapes') };
const BL = { bin: join(SCRIPTS, 'block-lint.mjs'), cwd: join(HERE, 'fixtures', 'block-lint') };
const HOST = ['--source-host', 'www.source.example'];

// expect entries: { sev, rule, msg? } — msg is a substring the finding's text must contain.
const DM_CASES = [
  {
    name: 'every pipeline-shape code fires on one page (with --source-host)',
    args: ['fail-shapes.html', ...HOST], exit: 2,
    expect: [
      { sev: '🔴', rule: 'TABLE' },
      { sev: '🔴', rule: 'D4', msg: 'delivery branch host' },
      { sev: '🔴', rule: 'D4', msg: 'protocol-relative' },
      { sev: '🟡', rule: 'D15', msg: 'STYLE-SPACE' },
      { sev: '🟡', rule: 'D15', msg: 'raw JSON' },
      { sev: '🟡', rule: 'D15', msg: 'TEXT-LEAK' },
      { sev: '🟡', rule: 'D6', msg: 'buttonize' },
      { sev: '🟡', rule: 'META', msg: 'alone in its section' },
      { sev: '🟡', rule: 'HBR' },
      { sev: '🟡', rule: 'TEXT', msg: 'punctuation' },
      { sev: '🟡', rule: 'TEXT', msg: 'empty or missing alt' },
      { sev: '🟡', rule: 'CHROME' },
      { sev: '🟡', rule: 'D12', msg: 'prose words' },
      { sev: '🟡', rule: 'D4', msg: 'LOCALIZE' },
    ],
  },
  { name: 'LOCALIZE is flag-dependent: silent without --source-host', args: ['fail-shapes.html'], exit: 2, absent: [{ rule: 'D4', msg: 'LOCALIZE' }] },
  { name: 'a protocol-relative source-host link is ONE 🔴, never 🔴 + LOCALIZE 🟡', args: ['fail-urls.html', ...HOST], exit: 2, count: 1, expect: [{ sev: '🔴', rule: 'D4', msg: 'protocol-relative' }], absent: [{ rule: 'D4', msg: 'LOCALIZE' }] },
  { name: 'style: a / a, b pass; a b is one STYLE-SPACE advisory (#120)', args: ['fail-style.html'], exit: 0, count: 1, expect: [{ sev: '🟡', rule: 'D15', msg: 'STYLE-SPACE' }] },
  { name: 'chrome document: a metadata block is one META CHROME advisory', args: ['nav.html'], exit: 0, count: 1, expect: [{ sev: '🟡', rule: 'META', msg: 'chrome/fragment' }] },
  { name: 'clean page (D6 <p><strong><a>, comma styles, alts, root-relative + external links) is silent', args: ['pass.html', ...HOST], exit: 0, count: 0 },
  { name: 'a prose fragment linted on its own is silent (CONTENT fires on the linking page)', args: ['fragments/promo.html'], exit: 0, count: 0 },
  { name: 'usage: no target is a usage error', args: [], exit: 1 },
];

const BL_CASES = [
  {
    name: 'every block code fires: BL-CSS, BL-MEDIA, IMG-HARDCODED ×3, BL-GUARD on the unguarded decorator only',
    args: ['fail/blocks', 'fail/scripts/scripts.js'], exit: 2,
    expect: [
      { sev: '🔴', rule: 'BL-CSS', msg: 'cards' },
      { sev: '🔴', rule: 'BL-MEDIA', msg: 'picture, img' },
      { sev: '🔴', rule: 'IMG-HARDCODED', msg: 'index/key' },
      { sev: '🔴', rule: 'IMG-HARDCODED', msg: 'derived from authored text' },
      { sev: '🔴', rule: 'IMG-HARDCODED', msg: 'createOptimizedPicture' },
      { sev: '🟡', rule: 'BL-GUARD', msg: 'decorateUnguarded()' },
    ],
    absent: [{ rule: 'BL-GUARD', msg: 'decorateGuarded()' }],
    counts: { 'IMG-HARDCODED': 3, 'BL-GUARD': 1 },
  },
  { name: 'clean block (loadCSS for the imported builder, picture-then-img, @fixed-asset mark, guarded decorator) is silent', args: ['pass/blocks', 'pass/scripts/scripts.js'], exit: 0, count: 0 },
  { name: 'usage: a missing blocks dir is a usage error', args: ['nope'], exit: 1 },
];

// Normalise both lints' --json shapes to { sev, rule, msg }.
const normalise = (out) => (out.findings || []).map((f) => ({ sev: f.sev || f.level, rule: f.rule || f.code, msg: f.msg || '' }));

const failures = [];
function run(tool, cases, label0) {
  for (const c of cases) {
    const r = spawnSync(process.execPath, [tool.bin, ...c.args, '--json'], { cwd: tool.cwd, encoding: 'utf8' });
    const label = `${label0}: ${c.name} [${c.args.join(' ')}]`;
    if (r.status !== c.exit) { failures.push(`${label}: exit ${r.status}, expected ${c.exit}\n${r.stderr || r.stdout}`); continue; }
    if (c.exit === 1) continue;
    let out;
    try { out = JSON.parse(r.stdout); } catch (e) { failures.push(`${label}: --json output is not JSON`); continue; }
    const findings = normalise(out);
    const hit = (e) => findings.filter((f) => f.rule === e.rule && (!e.sev || f.sev === e.sev) && (!e.msg || f.msg.includes(e.msg)));
    for (const e of c.expect || []) if (!hit(e).length) failures.push(`${label}: expected ${e.sev || ''} ${e.rule}${e.msg ? ` (…${e.msg}…)` : ''}`);
    for (const e of c.absent || []) if (hit(e).length) failures.push(`${label}: unexpected ${e.rule}${e.msg ? ` (…${e.msg}…)` : ''}`);
    if (c.count !== undefined && findings.length !== c.count) failures.push(`${label}: ${findings.length} finding(s), expected ${c.count}:\n  ${findings.map((f) => `${f.sev} ${f.rule} ${f.msg.slice(0, 80)}`).join('\n  ')}`);
    for (const [rule, n] of Object.entries(c.counts || {})) {
      const k = findings.filter((f) => f.rule === rule).length;
      if (k !== n) failures.push(`${label}: ${rule} reported ${k}×, expected ${n}`);
    }
  }
}
run(DM, DM_CASES, 'davids-model-lint');
run(BL, BL_CASES, 'block-lint');

if (failures.length) { console.error(`deploy-lint fixtures: ${failures.length} failure(s)\n${failures.join('\n')}`); process.exit(1); }
console.log(`deploy-lint fixtures: ${DM_CASES.length + BL_CASES.length} cases pass (${relative(process.cwd(), DM.cwd)}, ${relative(process.cwd(), BL.cwd)})`);
