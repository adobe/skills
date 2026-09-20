#!/usr/bin/env node
// Lint: every eval directory under evals/ ships the documented file set and a
// sound rubric (evals/README.md § Format is the rule):
//   criteria     — criteria.json parses, type weighted_checklist, non-empty
//                  checklist of { name, max_score, description }, unique names,
//                  max_score weights sum to exactly 100 (tessl normalises to 100;
//                  a 110/135 rubric grades every item under weight);
//   files        — task.md present; fixture-notes.md whenever fixture/ holds a
//                  file other than .gitkeep; answers.md unless task.md runs
//                  hands-off (the runner has no persona to answer from otherwise);
//   readme-copy  — no fixture/**/README.md is a copy of a _shared/*/README.md
//                  (shared README rule 3: everything under fixture/ is visible
//                  to the agent under test);
//   readme-row   — README.md § Evals in this suite has the eval's row and
//                  § Coverage map names it;
//   runners      — every command in the repo root package.json `lint:stardust`
//                  chain is named in README.md § Lints (skipped when no root
//                  package.json is reachable — the plugin installed standalone).
// A line containing `eval-hygiene: ignore` in README.md is not consulted.
// Usage: node plugins/stardust/evals/lint/eval-hygiene.mjs [--root <evals dir>] [--self-test]
// Exit: 0 clean · 1 findings (one line each: <class> <path>: <what>) · 2 usage / evals dir unreadable
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const HERE = import.meta.dirname;
const EVALS = resolve(HERE, '..');
const REPO_PKG = resolve(HERE, '..', '..', '..', '..', 'package.json');

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return undefined; } };
const listFiles = (d) => { const out = []; const walk = (x) => { for (const f of readdirSync(x).sort()) { const p = join(x, f); if (statSync(p).isDirectory()) walk(p); else out.push(p); } }; if (existsSync(d)) walk(d); return out; };
const section = (text, head, ...stops) => { const i = text.indexOf(head); if (i < 0) return ''; const rest = text.slice(i + head.length); const ends = stops.map((s) => rest.indexOf(s)).filter((n) => n >= 0); return ends.length ? rest.slice(0, Math.min(...ends)) : rest; };

/** Lint one evals tree. `opts.readme` = README text, `opts.chain` = lint:stardust commands (or null to skip). Returns finding strings. */
export function lintEvals(evalsDir, opts = {}) {
  const findings = [];
  const rel = (p) => relative(evalsDir, p) || '.';
  const readme = opts.readme ?? (existsSync(join(evalsDir, 'README.md')) ? readFileSync(join(evalsDir, 'README.md'), 'utf8') : '');
  const readmeText = readme.split('\n').filter((l) => !l.includes('eval-hygiene: ignore')).join('\n');
  const table = section(readmeText, '## Evals in this suite', '\n## ');
  const map = section(readmeText, '## Coverage map', '\n## ');
  const lints = section(readmeText, '### Lints', '\n## ');
  const sharedReadmes = listFiles(join(evalsDir, '_shared')).filter((f) => f.endsWith('README.md')).map((f) => readFileSync(f, 'utf8'));
  const firstLine = (t) => t.split('\n')[0].trim();
  const dirs = readdirSync(evalsDir).sort().filter((d) => !d.startsWith('_') && !d.startsWith('.') && statSync(join(evalsDir, d)).isDirectory() && (existsSync(join(evalsDir, d, 'task.md')) || existsSync(join(evalsDir, d, 'criteria.json'))));
  for (const d of dirs) {
    const dir = join(evalsDir, d);
    if (!existsSync(join(dir, 'task.md'))) findings.push(`files ${rel(dir)}: task.md missing`);
    const cf = join(dir, 'criteria.json');
    if (!existsSync(cf)) findings.push(`criteria ${rel(dir)}: criteria.json missing`);
    else {
      const c = readJson(cf);
      if (!c) findings.push(`criteria ${rel(cf)}: not valid JSON`);
      else {
        if (c.type !== 'weighted_checklist') findings.push(`criteria ${rel(cf)}: type is ${JSON.stringify(c.type)}, expected weighted_checklist`);
        const items = Array.isArray(c.checklist) ? c.checklist : null;
        if (!items || !items.length) findings.push(`criteria ${rel(cf)}: checklist missing or empty`);
        else {
          const names = new Set(); let sum = 0;
          items.forEach((it, i) => {
            if (!it || typeof it.name !== 'string' || !it.name) findings.push(`criteria ${rel(cf)}: checklist[${i}] has no name`);
            else if (names.has(it.name)) findings.push(`criteria ${rel(cf)}: duplicate name ${it.name}`); else names.add(it.name);
            if (typeof it.max_score !== 'number' || !(it.max_score > 0)) findings.push(`criteria ${rel(cf)}: ${it?.name || `checklist[${i}]`} max_score is not a positive number`); else sum += it.max_score;
            if (typeof it?.description !== 'string' || !it.description.trim()) findings.push(`criteria ${rel(cf)}: ${it?.name || `checklist[${i}]`} has no description`);
          });
          if (sum !== 100) findings.push(`criteria ${rel(cf)}: max_score weights sum to ${sum}, expected 100 (${items.length} items)`);
        }
      }
    }
    const fixtureFiles = listFiles(join(dir, 'fixture')).filter((f) => !f.endsWith('.gitkeep'));
    if (fixtureFiles.length && !existsSync(join(dir, 'fixture-notes.md'))) findings.push(`files ${rel(dir)}: fixture/ holds ${fixtureFiles.length} file(s) but fixture-notes.md is missing`);
    const task = existsSync(join(dir, 'task.md')) ? readFileSync(join(dir, 'task.md'), 'utf8') : '';
    if (!existsSync(join(dir, 'answers.md')) && !/hands-off/i.test(task)) findings.push(`files ${rel(dir)}: answers.md missing and task.md does not run hands-off`);
    for (const f of fixtureFiles.filter((x) => x.endsWith('README.md'))) {
      const t = readFileSync(f, 'utf8');
      if (sharedReadmes.some((s) => s === t || firstLine(s) === firstLine(t))) findings.push(`readme-copy ${rel(f)}: copy of a _shared/*/README.md (shared README rule 3 — delete it; fixture-notes.md documents the deltas)`);
    }
    if (readmeText) {
      if (!table.includes(`\`${d}/\``)) findings.push(`readme-row ${d}/: no row in README.md § Evals in this suite`);
      if (!map.includes(`\`${d}\``)) findings.push(`readme-row ${d}/: not named in README.md § Coverage map`);
    }
  }
  if (readmeText && opts.chain) {
    for (const cmd of opts.chain) {
      const path = cmd.replace(/^node (--test )?/, '').split(' ')[0];
      const base = path.split('/').pop();
      const short = base.replace(/^[a-z]+-[a-z]+-/, '…-'); // `…-repairs.test.mjs` family shorthand
      if (!lints.includes(base) && !lints.includes(short)) findings.push(`runners ${path}: chained in package.json lint:stardust but not named in README.md § Lints`);
    }
  }
  return findings;
}

/** The repo root lint:stardust chain as a command list, or null when no root package.json is reachable. */
export function lintChain(pkgFile = REPO_PKG) {
  const pkg = readJson(pkgFile);
  const s = pkg?.scripts?.['lint:stardust'];
  return typeof s === 'string' ? s.split('&&').map((x) => x.trim()).filter(Boolean) : null;
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'eval-hygiene-'));
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    const w = (p, t) => { mkdirSync(join(tmp, p, '..'), { recursive: true }); writeFileSync(join(tmp, p), t); };
    const crit = (weights, extra = {}) => JSON.stringify({ context: 'x', type: 'weighted_checklist', checklist: weights.map((m, i) => ({ name: `c${i}`, max_score: m, description: 'd' })), ...extra });
    w('_shared/fx/README.md', '# Shared fixture — post-migrate replica project\nbody\n');
    // good: hands-off, fixture + notes, sums to 100
    w('good-eval/task.md', '# Eval\n## Task (hands-off)\n'); w('good-eval/criteria.json', crit([40, 30, 30])); w('good-eval/fixture/stardust/state.json', '{}'); w('good-eval/fixture-notes.md', 'notes');
    // good: interactive with answers, empty fixture (.gitkeep only)
    w('good-interactive/task.md', '# Eval\n## User prompt\n'); w('good-interactive/criteria.json', crit([100])); w('good-interactive/answers.md', 'persona'); w('good-interactive/fixture/.gitkeep', '');
    // bad: sum 135, duplicate name, missing notes, missing answers, copied README, no row
    w('bad-eval/task.md', '# Eval\n## User prompt\n'); w('bad-eval/criteria.json', JSON.stringify({ type: 'weighted_checklist', checklist: [{ name: 'a', max_score: 100, description: 'd' }, { name: 'a', max_score: 35, description: 'd' }] }));
    w('bad-eval/fixture/stardust/state.json', '{}'); w('bad-eval/fixture/README.md', '# Shared fixture — post-migrate replica project\nstale copy\n');
    // bad: not weighted_checklist, empty checklist, no task.md
    w('bad-shape/criteria.json', JSON.stringify({ type: 'checklist', checklist: [] }));
    const readme = ['# evals', '## Evals in this suite', '| `good-eval/` | x |', '| `good-interactive/` | x |', '| `bad-shape/` | x |', '## Coverage map', '`good-eval`, `good-interactive`, `bad-shape`', '## Running', '### Lints', '- `harness-neutral.mjs` — x', '- `deploy-batch-ledger.test.mjs`, `…-repairs.test.mjs`', '## What not'].join('\n');
    const chain = ['node plugins/stardust/evals/lint/harness-neutral.mjs', 'node plugins/stardust/skills/deploy/scripts/test/deploy-batch-repairs.test.mjs', 'node plugins/stardust/evals/lint/unlisted-runner.mjs'];
    const f = lintEvals(tmp, { readme, chain });
    const has = (re) => f.some((x) => re.test(x));
    check(!f.some((x) => /good-eval|good-interactive/.test(x)), `clean evals produce no finding, got ${JSON.stringify(f.filter((x) => /good-/.test(x)))}`);
    check(has(/^criteria bad-eval\/criteria\.json: max_score weights sum to 135, expected 100 \(2 items\)/), 'weights ≠ 100 is a finding naming the sum');
    check(has(/^criteria bad-eval\/criteria\.json: duplicate name a/), 'duplicate criterion names');
    check(has(/^files bad-eval: fixture\/ holds 2 file\(s\) but fixture-notes\.md is missing/), 'fixture files without fixture-notes.md');
    check(has(/^files bad-eval: answers\.md missing and task\.md does not run hands-off/), 'interactive task without answers.md');
    check(has(/^readme-copy bad-eval\/fixture\/README\.md: copy of a _shared/), 'a fixture README that copies the shared one');
    check(has(/^readme-row bad-eval\/: no row in README\.md § Evals in this suite/) && has(/^readme-row bad-eval\/: not named in README\.md § Coverage map/), 'missing README row and map mention');
    check(has(/^criteria bad-shape\/criteria\.json: type is "checklist"/) && has(/^criteria bad-shape\/criteria\.json: checklist missing or empty/) && has(/^files bad-shape: task\.md missing/), 'wrong type, empty checklist, missing task.md');
    check(has(/^runners plugins\/stardust\/evals\/lint\/unlisted-runner\.mjs: chained/) && !has(/runners .*deploy-batch-repairs/) && !has(/runners .*harness-neutral/), 'a chained runner absent from § Lints is a finding; a listed one (or its …-suffix shorthand) is not');
    check(lintEvals(tmp, { readme, chain: null }).every((x) => !x.startsWith('runners ')), 'no chain → the runner check is skipped');
    check(f.length === 12, `exactly the expected findings (12), got ${f.length}:\n${f.join('\n')}`);
    // the real tree, as the chain runs it
    const real = lintEvals(EVALS, { chain: lintChain() });
    check(real.length === 0, `the plugin's own evals/ tree is clean, got ${real.length}:\n${real.join('\n')}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (failures.length) { console.error(`eval-hygiene self-test: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log('eval-hygiene self-test: ok (sum ≠ 100, duplicate names, wrong type, missing task/notes/answers, shared README copy, README row/map, runner list)');
}

const argv = process.argv.slice(2);
let root = EVALS; let self = false;
for (let i = 0; i < argv.length; i += 1) {
  const k = argv[i];
  if (k === '--help' || k === '-h') { console.log('Usage: node evals/lint/eval-hygiene.mjs [--root <evals dir>] [--self-test]\nExit: 0 clean · 1 findings · 2 usage'); process.exit(0); }
  else if (k === '--self-test') self = true;
  else if (k === '--root') { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error('eval-hygiene: --root needs a directory'); process.exit(2); } root = resolve(v); i += 1; }
  else { console.error(`eval-hygiene: unknown arg ${k}`); process.exit(2); }
}
if (self) selfTest();
else {
  if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`eval-hygiene: evals dir not found: ${root}`); process.exit(2); }
  const findings = lintEvals(root, { chain: lintChain() });
  if (findings.length) { console.error(`eval-hygiene lint: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
  const n = readdirSync(root).filter((d) => existsSync(join(root, d, 'criteria.json'))).length;
  console.log(`eval-hygiene lint: ${n} evals clean (rubrics sum to 100; file set, README rows and the runner list agree)`);
}
