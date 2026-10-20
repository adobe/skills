#!/usr/bin/env node
// evals/lint/test/labs-reserved.test.mjs — the labs-reserved lint contract: a `stardust/.labs/<name>`
// token is a finding at its line unless <name> is one of the runner's files (wake, run.json,
// boundary-request.json) or absent (the directory itself); the CLI scans every .md below the skills dir
// except under fixtures/, assets/ and scripts/, plus every .mjs/.js under <skill>/scripts/ except test/,
// sorts its findings, and answers --help and usage errors. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNNER_FILES, scanText } from '../labs-reserved.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, '..', 'labs-reserved.mjs');
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'labs-reserved-test-'));
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [LINT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const md = (...lines) => lines.join('\n');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const TAIL = " — the runner's directory; a session's scratch goes to stardust/.work/<skill>/";

// ---- scanText ----------------------------------------------------------------------------------
check('finding: a scratch file under stardust/.labs/, at its line, by name', () => {
  assert.deepEqual(scanText(md('# x', '', 'Write the roster to `stardust/.labs/pages.txt` first.')), [{ line: 3, name: 'pages.txt' }]);
  assert.deepEqual(scanText("const out = 'stardust/.labs/lift.js';"), [{ line: 1, name: 'lift.js' }]);
  assert.deepEqual(scanText('dump it to stardust/.labs/<slug>.css'), [{ line: 1, name: '<slug>.css' }]);
});
check('findings: two tokens on two lines, lines ascending; two on one line both reported', () => {
  assert.deepEqual(scanText(md('a stardust/.labs/a.txt', 'b', 'c stardust/.labs/b.txt and stardust/.labs/c.txt')).map((f) => [f.line, f.name]), [[1, 'a.txt'], [3, 'b.txt'], [3, 'c.txt']]);
});
check("clean: the runner's own files and the bare directory", () => {
  assert.deepEqual(RUNNER_FILES, ['wake', 'run.json', 'boundary-request.json']);
  assert.deepEqual(scanText(md('exit 77 = the wake line (`stardust/.labs/wake` grew)', 'seed [--run stardust/.labs/run.json]', 'the runner writes `stardust/.labs/boundary-request.json`')), []);
  assert.deepEqual(scanText("`stardust/.labs/` is reserved for the runner's files; a session's scratch goes to `stardust/.work/<skill>/`"), []);
  assert.deepEqual(scanText("mkdirSync(join(d, 'stardust', '.labs'))"), [], 'a path built from segments is not a token');
});
check('clean: .work paths and other dot-directories are not .labs', () => {
  assert.deepEqual(scanText(md('stardust/.work/replica/bg', 'stardust/.labsx/y', 'stardust/labs/z')), []);
});

// ---- CLI ---------------------------------------------------------------------------------------
check('CLI: the plugin tree is clean (exit 0, one summary line)', () => {
  const r = run(REPO);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^labs-reserved lint: \d+ files clean\n$/);
});
const skills = join(root, 'skills');
put(join(skills, 'a', 'SKILL.md'), md('# a', '', 'Scratch goes to `stardust/.work/a/`; the runner owns `stardust/.labs/run.json`.', ''));
put(join(skills, 'a', 'reference', 'notes.md'), md('# notes', '', 'Keep the page list in `stardust/.labs/pages.txt`.', ''));
put(join(skills, 'a', 'scripts', 'a.mjs'), md("const WAKE = 'stardust/.labs/wake';", "const OUT = 'stardust/.labs/census.json';", ''));
put(join(skills, 'a', 'scripts', 'test', 'a.test.mjs'), md("write(root, 'stardust/.labs/anything.txt', '');", ''));
for (const dir of [['fixtures'], ['assets'], ['scripts', 'fixtures']]) put(join(skills, 'a', ...dir, 'bad.md'), 'stardust/.labs/bad.txt');
check('CLI --root: a doc and a script naming scratch under .labs fail (exit 1, sorted); test/, fixtures/, assets/ are not scanned; a clean SKILL.md passes', () => {
  const r = run(root, '--root', skills);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.out, '');
  assert.deepEqual(r.err.trimEnd().split('\n'), [
    'labs-reserved lint: 2 finding(s)',
    `skills/a/reference/notes.md:3: stardust/.labs/pages.txt${TAIL}`,
    `skills/a/scripts/a.mjs:2: stardust/.labs/census.json${TAIL}`,
  ]);
});
check('CLI --root: a clean tree counts docs and scripts', () => {
  const clean = join(root, 'clean');
  put(join(clean, 'b', 'SKILL.md'), '# b\n');
  put(join(clean, 'b', 'scripts', 'b.mjs'), "export const WAKE = 'stardust/.labs/wake';\n");
  const r = run(root, '--root', clean);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'labs-reserved lint: 2 files clean\n');
});
check('CLI: usage errors exit 2 (unknown flag, --root missing, --root not a dir)', () => {
  assert.equal(run(root, '--bogus').code, 2);
  assert.equal(run(root, '--root').code, 2);
  assert.equal(run(root, '--root', join(skills, 'a', 'SKILL.md')).code, 2);
  assert.equal(run(root, '--root', join(root, 'missing')).code, 2);
});
check('CLI --help / -h: exit 0, usage on stdout', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(root, flag);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Guard: no stardust skill text or script names a file of its own under stardust\/\.labs\//);
    assert.match(r.out, /Usage: node plugins\/stardust\/evals\/lint\/labs-reserved\.mjs \[--root <skills-dir>\]/);
  }
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nlabs-reserved: all checks passed');
process.exit(failed ? 1 : 0);
