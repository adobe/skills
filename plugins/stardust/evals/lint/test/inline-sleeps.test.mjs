#!/usr/bin/env node
// evals/lint/test/inline-sleeps.test.mjs — the inline-sleeps lint contract: inside a shell snippet (a
// shell-language fenced block, or an inline backtick span) a long `sleep <n>` (n over --max-seconds,
// default 60) and a `while`/`until` poll loop with a sleep are findings, reported at the sleep's line;
// a short sleep, a non-shell block and prose that merely names sleep stay clean; an allow marker on
// the line above the sleep (or above the fence) suppresses it; the CLI scans every .md below the
// skills dir except under fixtures/, assets/ and scripts/, sorts its findings, honours --max-seconds,
// and answers --help and usage errors.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../inline-sleeps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, '..', 'inline-sleeps.mjs');
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'inline-sleeps-test-'));
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [LINT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const md = (...lines) => lines.join('\n');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const LONG_FENCE = md('Wait for the job:', '', '```bash', 'echo starting', 'sleep 595', '```');

// ---- findings ----------------------------------------------------------------------------------
check('finding: a long sleep in a bash fence, at the sleep line', () => {
  assert.deepEqual(scanText(LONG_FENCE), [{ line: 5, snippet: 'sleep 595', reason: 'a shell snippet waits with a long sleep' }]);
});
check('finding: a long sleep in an inline backtick span', () => {
  assert.deepEqual(scanText(md('Then `sleep 1200` and come back.')), [{ line: 1, snippet: 'sleep 1200', reason: 'a shell snippet waits with a long sleep' }]);
});
check('finding: a while poll loop with a short sleep, flagged by the loop not the duration', () => {
  const text = md('```bash', 'while [ ! -f done ]; do', '  sleep 5', 'done', '```');
  assert.deepEqual(scanText(text), [{ line: 3, snippet: 'while … sleep 5', reason: 'a shell snippet polls with sleep' }]);
});
check('finding: an until poll loop counts as while … sleep', () => {
  const text = md('```sh', 'until curl -sf "$u"; do sleep 10; done', '```');
  assert.deepEqual(scanText(text), [{ line: 2, snippet: 'while … sleep 10', reason: 'a shell snippet polls with sleep' }]);
});
check('finding: a bare fence (no info string) is shell', () => {
  assert.deepEqual(scanText(md('```', 'sleep 1380', '```')), [{ line: 2, snippet: 'sleep 1380', reason: 'a shell snippet waits with a long sleep' }]);
});
check('findings: two sleeps, lines ascending', () => {
  const text = md('```bash', 'sleep 300', 'echo mid', 'sleep 90', '```');
  assert.deepEqual(scanText(text).map((f) => [f.line, f.snippet]), [[2, 'sleep 300'], [4, 'sleep 90']]);
});

// ---- clean -------------------------------------------------------------------------------------
check('clean: a short sleep under the threshold', () => {
  assert.deepEqual(scanText(md('```bash', 'sleep 3', '```')), []);
  assert.deepEqual(scanText(md('```bash', 'sleep 60', '```')), []);
});
check('clean: a bounded for-loop poll with a short sleep is not a while/until poll loop', () => {
  const text = md('```bash', 'for i in $(seq 1 40); do', '  curl -sf "$u" && break', '  sleep 3', 'done', '```');
  assert.deepEqual(scanText(text), []);
});
check('clean: a non-shell fenced block is ignored', () => {
  assert.deepEqual(scanText(md('```python', 'time.sleep(600)', 'sleep 600', '```')), []);
  assert.deepEqual(scanText(md('```json', '{ "sleep": 1200 }', '```')), []);
});
check('clean: prose naming sleep, while and a poll, none inside a shell snippet', () => {
  assert.deepEqual(scanText('The lead waits, never a bare `sleep`; poll with the instrument, never `while … sleep`.'), []);
  assert.deepEqual(scanText(md('Poll the status while it settles;', 'a `sleep` is never a wait.')), []);
  assert.deepEqual(scanText('The slots pace the Chromiums — no `sleep N;` staggering.'), []);
});

// ---- allow marker ------------------------------------------------------------------------------
check('allow: a marker on the line above the sleep suppresses an inline finding', () => {
  assert.deepEqual(scanText(md('<!-- lint: allow-sleep -->', 'Give the CDN a beat: `sleep 90`.')), []);
});
check('allow: a marker above the opening fence suppresses a block finding', () => {
  assert.deepEqual(scanText(md('<!-- lint: allow-sleep -->', '```bash', 'sleep 300', '```')), []);
});
check('allow: the marker does not leak to the next, unmarked snippet', () => {
  const text = md('<!-- lint: allow-sleep -->', '`sleep 300`', '', '`sleep 400`');
  assert.deepEqual(scanText(text), [{ line: 4, snippet: 'sleep 400', reason: 'a shell snippet waits with a long sleep' }]);
});

// ---- --max-seconds -----------------------------------------------------------------------------
check('--max-seconds: the threshold moves (scanText arg)', () => {
  assert.deepEqual(scanText(md('```bash', 'sleep 90', '```'), 120), []);
  assert.deepEqual(scanText(md('```bash', 'sleep 150', '```'), 120).map((f) => f.snippet), ['sleep 150']);
  // a poll loop is flagged regardless of the duration threshold
  assert.deepEqual(scanText(md('```bash', 'while :; do sleep 5; done', '```'), 120).map((f) => f.reason), ['a shell snippet polls with sleep']);
});

// ---- CLI ---------------------------------------------------------------------------------------
check('CLI: the plugin tree is clean (exit 0, one summary line)', () => {
  const r = run(REPO);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^inline-sleeps lint: \d+ files clean\n$/);
});
const skills = join(root, 'skills');
const tail = ' — wait on the instrument instead (run-bg.mjs wait for jobs, progress.mjs wait for units; both wake early via the wake file), never a bare sleep';
put(join(skills, 'a', 'SKILL.md'), md('# a', '', 'Run `node scripts/a.mjs`.', ''));
put(join(skills, 'a', 'notes.md'), LONG_FENCE);
for (const dir of [['scripts', 'test', 'fixtures'], ['fixtures'], ['assets']]) put(join(skills, 'a', ...dir, 'bad.md'), LONG_FENCE);
check('CLI --root: a violating notes.md at a skill root is scanned; .md below fixtures/, assets/, scripts/ is not', () => {
  const r = run(root, '--root', skills);
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(r.err.trimEnd().split('\n'), [
    'inline-sleeps lint: 1 finding(s)',
    `skills/a/notes.md:5: a shell snippet waits with a long sleep (sleep 595)${tail}`,
  ]);
});
check('CLI --root: violations in reference/ and SKILL.md fail with exit 1, files sorted, path:line', () => {
  put(join(skills, 'b', 'SKILL.md'), md('# b', '', '```bash', 'while :; do sleep 5; done', '```', ''));
  put(join(skills, 'a', 'reference', 'deep', 'x.md'), LONG_FENCE);
  const r = run(root, '--root', skills);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.out, '');
  assert.deepEqual(r.err.trimEnd().split('\n'), [
    'inline-sleeps lint: 3 finding(s)',
    `skills/a/notes.md:5: a shell snippet waits with a long sleep (sleep 595)${tail}`,
    `skills/a/reference/deep/x.md:5: a shell snippet waits with a long sleep (sleep 595)${tail}`,
    `skills/b/SKILL.md:4: a shell snippet polls with sleep (while … sleep 5)${tail}`,
  ]);
});
check('CLI --max-seconds: raises the threshold so a 90 s sleep passes', () => {
  put(join(skills, 'c', 'SKILL.md'), md('# c', '', '```bash', 'sleep 90', '```', ''));
  assert.equal(run(root, '--root', join(skills, 'c')).code, 1);
  assert.equal(run(root, '--root', join(skills, 'c'), '--max-seconds', '120').code, 0);
});
check('CLI: usage errors exit 2 (unknown flag, --root missing, --root not a dir, bad --max-seconds)', () => {
  assert.equal(run(root, '--bogus').code, 2);
  assert.equal(run(root, '--root').code, 2);
  assert.equal(run(root, '--root', join(skills, 'a', 'SKILL.md')).code, 2);
  assert.equal(run(root, '--root', join(root, 'missing')).code, 2);
  assert.equal(run(root, '--max-seconds').code, 2);
  assert.equal(run(root, '--max-seconds', 'soon').code, 2);
});
check('CLI --help / -h: exit 0, usage on stdout', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(root, flag);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Usage/);
  }
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\ninline-sleeps: all checks passed');
process.exit(failed ? 1 : 0);
