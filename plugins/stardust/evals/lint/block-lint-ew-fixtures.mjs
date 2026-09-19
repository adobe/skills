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
//                                 edit-mode foundation rules) — 0 findings
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
try { const j = JSON.parse(r.stdout); check('pass-ew has 0 findings', j.findings.length === 0, j.findings.map((f) => `${f.level} ${f.code} ${f.file}:${f.line} ${f.msg.slice(0, 70)}`).join('\n    ')); check('pass-ew read 1 block CSS', j.cssFiles === 1); } catch (e) { check('pass-ew --json parses', false, e.message); }

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
console.log(`block-lint EW fixtures: ${expect.length + 9} cases pass (${relative(process.cwd(), CWD)}/{fail-ew,pass-ew})`);
