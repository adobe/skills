#!/usr/bin/env node
// Guard: block-lint's Experience Workspace rules (EW-VALUE, EW-JOIN, EW-RETAG,
// EW-HEADER 🔴; EW-CLONE, EW-CLASS, EW2-CSS, EW-RHYTHM, EW-COMPOSED 🟡) fire on
// the shapes they name and stay SILENT on the legal ones.
//
// Why: the rules mechanise the former manual "static review" checklist item; every
// dead text on one recorded 143-page rollout had one of these static signatures.
// The 🔴 forms are position-aware — #79 classify-by-cell-text (a class, dataset,
// attribute or condition from `cell.textContent`) is legal and present in 5 of 26
// blocks of a post-fix repo, so a rule that fires on it is worse than none. Both
// directions are pinned:
//   fixtures/block-lint/fail-ew/  slotter (every JS + CSS signature), retag, header
//                                 (chrome cap 🟡 + EW-HEADER 🔴), promo (@ew-exempt all
//                                 cap 🟡), styles/styles.css (EW-COMPOSED)
//   fixtures/block-lint/pass-ew/  the scaffold shape (move, labelWrap, stripInstrumentation,
//                                 classify-by-cell, attribute position, :has() below p,
//                                 edit-mode foundation rules) + shapes/ (a class from a cell
//                                 word in an innerHTML template, an aria-label interpolation,
//                                 a template of EMPTY slots built on a line that mentions
//                                 .textContent — the #79 shapes a rollout repo is full of) — 0 findings
//   fixtures/block-lint/exempt-ew/ a declared item-level `@ew-exempt <p> /^\d{4}-/ — derived` with a
//                                 derived-date assignment: EW-VALUE reported 🟡 (capped, reason
//                                 appended), exit 0 — the runtime gate decides per text (EW5)
//   fixtures/block-lint/exempt-overreach-ew/ ONE declared item, THREE value-slotting sites: only the
//                                 first (by line) is capped 🟡, the other two stay 🔴 with a
//                                 "not capped" reason, exit 2 — a single declared showcase link
//                                 must never hide a file of value-slotted texts (the recorded
//                                 4-declared / 254-slotted case). `all` still caps the file (promo).
//   fixtures/block-lint/exempt-clone-ew/ TWO declared items, ONE value-slotting site, ONE authored-picture
//                                 clone: EW-VALUE 🟡 (capped), EW-CLONE stays 🔴 with its own reason —
//                                 an item declares a text, never a clone — and the leftover wording never
//                                 claims the items "cover 2 sites" when only one was capped; exit 2
// deploy-lint-fixtures.mjs keeps pinning the BL-*/IMG-HARDCODED rules over fail/ and pass/.
//
// Usage: node plugins/stardust/evals/lint/block-lint-ew-fixtures.mjs  (exit 1 on findings)
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const BIN = join(HERE, '..', '..', 'skills', 'deploy', 'scripts', 'block-lint.mjs');
const CWD = join(HERE, 'fixtures', 'block-lint');
const failures = [];
const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: CWD, encoding: 'utf8' });
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name}${detail ? `\n    ${detail}` : ''}`); };

// ── fail-ew: every rule fires, with the right tier, exactly the expected number of times
let r = run(['fail-ew/blocks', '--styles', 'fail-ew/styles/styles.css', '--json']);
check('fail-ew exits 2', r.status === 2, r.stderr || r.stdout);
let out = {};
try { out = JSON.parse(r.stdout); } catch (e) { check('fail-ew --json parses', false, e.message); }
const F = out.findings || [];
const count = (code, level, file) => F.filter((f) => f.code === code && (!level || f.level === level) && (!file || f.file.includes(file))).length;
const expect = [
  ['EW-VALUE', '🔴', 'slotter', 2, 'innerHTML template (once for two interpolations) + textContent assignment'],
  ['EW-JOIN', '🔴', 'slotter', 1], ['EW-CLONE', '🔴', 'slotter', 1, 'authored picture cloned, no stripInstrumentation'],
  ['EW-CLASS', '🟡', 'slotter', 1], ['EW2-CSS', '🟡', 'slotter.css', 3, '> p, > :is(h2, h3), h3:first-child'],
  ['EW-RHYTHM', '🟡', 'slotter.css', 1], ['EW-RETAG', '🔴', 'retag', 1], ['EW-VALUE', null, 'retag', 0, 'RETAG is not doubled as VALUE'],
  ['EW-HEADER', '🔴', 'header', 1], ['EW-VALUE', '🟡', 'header', 1, 'chrome block capped at 🟡'],
  ['EW-VALUE', '🟡', 'promo', 1, '@ew-exempt all capped at 🟡'], ['EW-COMPOSED', '🟡', 'styles.css', 2],
];
for (const [code, level, file, n, why] of expect) check(`fail-ew: ${code}${level ? ` ${level}` : ''} in ${file} ×${n}${why ? ` (${why})` : ''}`, count(code, level, file) === n, `got ${count(code, level, file)}: ${F.filter((f) => f.code === code && f.file.includes(file)).map((f) => `${f.level} ${f.file}:${f.line}`).join(', ')}`);
check('fail-ew: the legal :has(> …) selector and the .prosemirror-editor rule are silent', !F.some((f) => /^`[^`]*(?::has\(> :is\(picture|prosemirror-editor)[^`]*`/.test(f.msg)));
check('fail-ew: the non-prose composed selectors are silent', count('EW-COMPOSED') === 2 && !F.some((f) => f.code === 'EW-COMPOSED' && /first-of-type` /.test(f.msg)));
check('fail-ew: findings carry file:line', F.every((f) => f.file && Number.isInteger(f.line) && f.line > 0));
check('fail-ew: red count = 🔴 findings', out.red === F.filter((f) => f.level === '🔴').length && out.red === 6, `red=${out.red}`);

// ── pass-ew: the scaffold shape is silent
r = run(['pass-ew/blocks', '--styles', 'pass-ew/styles.css', '--json']);
check('pass-ew exits 0', r.status === 0, r.stderr || r.stdout);
try { const j = JSON.parse(r.stdout); check('pass-ew has 0 findings', j.findings.length === 0, j.findings.map((f) => `${f.level} ${f.code} ${f.file}:${f.line} ${f.msg.slice(0, 70)}`).join('\n    ')); check('pass-ew read 3 block JS + 1 block CSS', j.files === 3 && j.cssFiles === 1); } catch (e) { check('pass-ew --json parses', false, e.message); }

// ── exempt-ew: a declared item caps the 🔴 to 🟡 and says why; exit 0
r = run(['exempt-ew/blocks', '--json']);
check('exempt-ew exits 0', r.status === 0, r.stderr || r.stdout);
try {
  const j = JSON.parse(r.stdout);
  const v = j.findings.filter((f) => f.code === 'EW-VALUE');
  check('exempt-ew: EW-VALUE reported once, 🟡, with the cap reason', v.length === 1 && v[0].level === '🟡' && /\[capped 🟡: 1 @ew-exempt item\(s\) declared/.test(v[0].msg) && j.red === 0, JSON.stringify(j.findings.map((f) => `${f.level} ${f.code} ${f.msg.slice(-90)}`)));
} catch (e) { check('exempt-ew --json parses', false, e.message); }

// ── exempt-overreach-ew: N declared items cap N value-slotting sites, never the whole file
r = run(['exempt-overreach-ew/blocks', '--json']);
check('exempt-overreach-ew exits 2 (one item cannot cap three re-emission sites)', r.status === 2, r.stderr || r.stdout);
try {
  const j = JSON.parse(r.stdout);
  const v = j.findings.filter((f) => ['EW-VALUE', 'EW-RETAG', 'EW-JOIN'].includes(f.code)).sort((a, b) => a.line - b.line);
  check('exempt-overreach-ew: three value-slotting findings', v.length === 3, JSON.stringify(v.map((f) => `${f.level} ${f.code}:${f.line}`)));
  check('exempt-overreach-ew: the lowest-line site is the capped one, 🟡 with the per-item reason', v[0] && v[0].level === '🟡' && v[0].code === 'EW-RETAG' && /\[capped 🟡: 1 @ew-exempt item\(s\) declared \(one cap per item\)/.test(v[0].msg), v[0] && v[0].msg.slice(-120));
  check('exempt-overreach-ew: the other two stay 🔴 and say the item is spent', v.slice(1).every((f) => f.level === '🔴' && /\[not capped: the 1 declared @ew-exempt item\(s\) already cover 1 re-emission site\(s\)/.test(f.msg)), JSON.stringify(v.slice(1).map((f) => `${f.level} ${f.msg.slice(-100)}`)));
  check('exempt-overreach-ew: red = 2, no `cappable` field leaks into --json', j.red === 2 && j.findings.every((f) => !('cappable' in f)), `red=${j.red}`);
} catch (e) { check('exempt-overreach-ew --json parses', false, e.message); }

// ── exempt-clone-ew: items cap texts, never a clone; the leftover reason counts the sites actually capped
r = run(['exempt-clone-ew/blocks', '--json']);
check('exempt-clone-ew exits 2 (a 🔴 EW-CLONE is not item-cappable)', r.status === 2, r.stderr || r.stdout);
try {
  const j = JSON.parse(r.stdout);
  const v = j.findings.find((f) => f.code === 'EW-VALUE');
  const c = j.findings.find((f) => f.code === 'EW-CLONE');
  check('exempt-clone-ew: the one value-slotting site is capped 🟡 by the two items', v && v.level === '🟡' && /\[capped 🟡: 2 @ew-exempt item\(s\) declared \(one cap per item\)/.test(v.msg), v && `${v.level} ${v.msg.slice(-100)}`);
  check('exempt-clone-ew: EW-CLONE stays 🔴 and carries the clone reason, not the re-emission one', c && c.level === '🔴' && /\[not capped: an @ew-exempt item declares a text, not a clone/.test(c.msg) && !/already cover/.test(c.msg), c && `${c.level} ${c.msg.slice(-140)}`);
  check('exempt-clone-ew: no finding claims the items cover more sites than were capped', !j.findings.some((f) => /already cover 2 re-emission site/.test(f.msg)), JSON.stringify(j.findings.map((f) => f.msg.slice(-90))));
  check('exempt-clone-ew: red = 1 (the clone), 2 findings in all', j.red === 1 && j.findings.length === 2, `red=${j.red} n=${j.findings.length}`);
} catch (e) { check('exempt-clone-ew --json parses', false, e.message); }

// ── usage
r = run(['pass-ew/blocks', '--styles']);
check('--styles without a path is a usage error (exit 1)', r.status === 1);
r = run(['pass-ew/blocks', '--styles', 'nope.css']);
check('--styles pointing nowhere is a usage error (exit 1)', r.status === 1);
r = run(['--help']);
check('--help exits 0 with usage', r.status === 0 && /usage:/.test(r.stdout));

if (failures.length) {
  for (const f of failures) console.log(`${relative(process.cwd(), BIN)}: ${f}`);
  console.log(`block-lint EW fixtures: ${failures.length} finding(s)`);
  process.exit(1);
}
console.log(`block-lint EW fixtures: ${expect.length + 21} cases pass (${relative(process.cwd(), CWD)}/{fail-ew,pass-ew,exempt-ew,exempt-overreach-ew,exempt-clone-ew})`);
