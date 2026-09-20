#!/usr/bin/env node
// Fixture test: the prep-vs-bounded contract between crawl.mjs and brand-surface.mjs
// (extract/reference/prep-mode.md § 1, brand-surface.md § mode). No browser, no network.
//
//   * crawl.mjs parseArgs: `--prep` sets prep and implies --all unless --cap/--single/--pages was given;
//     runArgsRecord() (the runs[].args writer) carries `prep` — the key isBoundedRun() reads;
//   * brand-surface.mjs over evals/lint/fixtures/brand-surface/modular: a --pages run is auto-bounded;
//     the same log with args.prep true is NOT; `--full` overrides a bounded log; `--bounded --full` is
//     usage (exit 2, nothing written).
// Before the fix crawl.mjs wrote no `prep` key at all, so every prep run that used --pages was silently
// bounded and no flag could undo it.
// Usage: node plugins/stardust/skills/extract/scripts/test/prep-bounded.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runArgsRecord } from '../crawl.mjs';
import { isBoundedRun } from '../brand-surface.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BS = join(here, '..', 'brand-surface.mjs');
const FIX = join(here, '..', '..', '..', '..', 'evals', 'lint', 'fixtures', 'brand-surface', 'modular');
const argv = (...a) => ['node', 'crawl.mjs', '--url', 'https://example.com', ...a];

// crawl side
let a = parseArgs(argv('--prep'));
assert.equal(a.prep, true, '--prep sets prep');
assert.equal(a.max, Infinity, '--prep implies --all'); assert.equal(a.capLabel, 'all');
a = parseArgs(argv('--prep', '--pages', '/a,/b'));
assert.deepEqual(a.pages, ['/a', '/b'], '--prep keeps an explicit page list'); assert.equal(a.prep, true);
a = parseArgs(argv('--prep', '--cap', '3'));
assert.equal(a.max, 3, 'an explicit --cap wins over the implied --all');
a = parseArgs(argv('--pages', '/a'));
assert.equal(a.prep, undefined, 'no --prep → no prep');
const rec = runArgsRecord(parseArgs(argv('--prep', '--pages', '/a')));
assert.equal(rec.prep, true, 'runs[].args records prep: true');
assert.deepEqual(rec.pages, ['/a']);
assert.equal(runArgsRecord(parseArgs(argv('--pages', '/a'))).prep, false, 'runs[].args records prep: false otherwise');
assert.ok(!isBoundedRun({ runs: [{ args: rec }] }), 'brand-surface reads the recorded prep and does not bound the run');
assert.ok(isBoundedRun({ runs: [{ args: runArgsRecord(parseArgs(argv('--pages', '/a'))) }] }), 'a --pages run without --prep is bounded');

// brand-surface side (CLI over the fixture)
const tmp = mkdtempSync(join(tmpdir(), 'prep-bounded-'));
try {
  const out = join(tmp, 'current');
  cpSync(FIX, out, { recursive: true });
  const logPath = join(out, '_crawl-log.json');
  const log = JSON.parse(readFileSync(logPath, 'utf8'));
  const run = (...extra) => spawnSync(process.execPath, [BS, '--out', out, ...extra], { encoding: 'utf8' });
  const mode = () => JSON.parse(readFileSync(join(out, '_brand-extraction.json'), 'utf8'))._provenance.mode;

  log.runs[log.runs.length - 1].args.pages = ['/'];
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  let r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(mode(), 'bounded', 'a --pages run is auto-bounded');
  r = run('--full'); assert.equal(r.status, 0, r.stderr); assert.equal(mode(), 'full', '--full overrides the auto-bounded detection');
  assert.match(r.stdout, /mode full/);

  log.runs[log.runs.length - 1].args.prep = true;
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(mode(), 'full', 'a --pages run recorded with prep: true is never bounded');
  r = run('--bounded'); assert.equal(r.status, 0, r.stderr); assert.equal(mode(), 'bounded', '--bounded still forces the bounded surface');

  rmSync(join(out, '_brand-extraction.json'));
  r = run('--bounded', '--full');
  assert.equal(r.status, 2, '--bounded --full is usage'); assert.match(r.stderr, /--bounded and --full exclude each other/);
  assert.ok(!existsSync(join(out, '_brand-extraction.json')), 'usage writes nothing');
  r = run('--full', '--help'); assert.equal(r.status, 0); assert.match(r.stdout, /--bounded \| --full/);
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log('prep-bounded test: ok (--prep implies --all, runs[].args.prep written and read, --full overrides, --bounded --full exit 2)');
