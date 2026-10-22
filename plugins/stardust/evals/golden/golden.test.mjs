#!/usr/bin/env node
// evals/golden/golden.test.mjs — the pipeline snapshot: run.mjs into a temp dir must reproduce expected/
// byte for byte (same file list, same bytes). On a mismatch the first differing file is shown as a unified
// diff. Also: run.mjs --help answers before any I/O. Offline, no browser, no node_modules.
// Run: node plugins/stardust/evals/golden/golden.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, 'run.mjs');
const EXPECTED = join(HERE, 'expected');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const walk = (dir, root = dir, acc = []) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, root, acc); else acc.push(relative(root, p).split('\\').join('/')); } return acc.sort(); };
const unifiedDiff = (a, b, labelA, labelB) => {
  const r = spawnSync('diff', ['-u', '--label', labelA, '--label', labelB, a, b], { encoding: 'utf8' });
  if (r.error) return `(diff unavailable: ${r.error.message})\n--- ${labelA}\n${readFileSync(a, 'utf8').slice(0, 2000)}\n+++ ${labelB}\n${readFileSync(b, 'utf8').slice(0, 2000)}`;
  return r.stdout.split('\n').slice(0, 80).join('\n');
};

check('run.mjs --help prints the usage and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'golden-help-'));
  const r = spawnSync(process.execPath, [RUN, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /--now/);
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true, force: true });
});
check('run.mjs without --out is a usage error (exit 2) naming the flag', () => {
  const r = spawnSync(process.execPath, [RUN], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /--out is required/);
});

const tmp = mkdtempSync(join(tmpdir(), 'golden-run-'));
const t0 = Date.now();
const r = spawnSync(process.execPath, [RUN, '--out', tmp], { encoding: 'utf8' });
const ms = Date.now() - t0;
check(`run.mjs completes (${ms} ms)`, () => { assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^golden: \d+ steps, \d+ files/); });
check('the snapshot has the same file list as expected/', () => {
  const got = walk(tmp); const want = walk(EXPECTED);
  const missing = want.filter((f) => !got.includes(f)); const extra = got.filter((f) => !want.includes(f));
  assert.ok(!missing.length && !extra.length, `missing from the run: ${missing.join(', ') || '—'}\n  not in expected/: ${extra.join(', ') || '—'}\n  re-baseline deliberately with: node evals/golden/run.mjs --out evals/golden/expected`);
});
check('every file is byte-identical to expected/', () => {
  const differing = walk(EXPECTED).filter((f) => { try { return !readFileSync(join(EXPECTED, f)).equals(readFileSync(join(tmp, f))); } catch { return true; } });
  if (!differing.length) return;
  const first = differing[0];
  assert.fail(`${differing.length} file(s) differ: ${differing.join(', ')}\nfirst diff (${first}):\n${unifiedDiff(join(EXPECTED, first), join(tmp, first), `expected/${first}`, `run/${first}`)}\n  an intended output change is re-baselined with: node evals/golden/run.mjs --out evals/golden/expected (one deliberate commit explaining the change)`);
});
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `golden: ${failed} check(s) failed` : `golden: all checks passed in ${ms} ms`);
process.exit(failed ? 1 : 0);
