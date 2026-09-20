#!/usr/bin/env node
// Smoke: skills/stardust/scripts/browser-lock.mjs — the machine-wide browser semaphore
// (reference/fan-out.md § Machine budget), against a temp --lock-dir. No browser, no network.
//
//   (a) SLOTS=2: two acquires succeed (two live pids), a third with --wait 2 exits 124 after
//       printing one `waiting for a slot` line at 0:00 and appending `waiting-slot` to
//       $STARDUST_PROGRESS_LOG; 124 is the no-verdict code, never a FAIL;
//   (b) a slot file with a dead pid and one with an old mtime are reaped and re-acquired;
//   (c) SLOTS=0 acquires without creating the dir; --no-lock likewise;
//   (d) release frees the slot (by pid; --all --stale removes only stale files);
//   (e) status --json prints holders, slots and the orphan census; --help exits 0; usage exits 2.
// Usage: node plugins/stardust/evals/lint/browser-lock-smoke.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', '..', 'skills', 'stardust', 'scripts', 'browser-lock.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'browser-lock-'));
const dir = join(tmp, 'locks');
const log = join(tmp, 'agent.log');
const env = { ...process.env, STARDUST_BROWSER_SLOTS: '2', STARDUST_BROWSER_POLL_MS: '200', STARDUST_PROGRESS_LOG: log };
delete env.STARDUST_BROWSER_LOCK_DIR;
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [CLI, ...args, '--lock-dir', dir], { encoding: 'utf8', env: { ...env, ...extraEnv } });
const holders = [spawn('sleep', ['60']), spawn('sleep', ['60'])]; // two live pids to record
try {
  // (a) two acquires, a third times out
  let r = run(['acquire', '--pid', String(holders[0].pid), '--script', 'stitch-shot', '--project', '/x/proj-a']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^acquired /);
  r = run(['acquire', '--pid', String(holders[1].pid), '--script', 'gate.sh', '--project', '/x/proj-b']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readdirSync(dir).length, 2);
  const t0 = Date.now();
  r = run(['acquire', '--pid', String(process.pid), '--wait', '2']);
  assert.equal(r.status, 124, `third acquire exits 124 (no verdict)\n${r.stdout}${r.stderr}`);
  assert.ok(Date.now() - t0 >= 1900, 'waited the budget');
  assert.equal(r.stderr.match(/^browser-lock: waiting for a slot \(2\/2 held by pid \d+ stitch-shot proj-a, pid \d+ gate\.sh proj-b\) 0:00$/gm)?.length, 1, `one waiting line\n${r.stderr}`);
  assert.match(r.stderr, /no slot within 2 s .* — exit 124, no verdict/);
  assert.match(readFileSync(log, 'utf8'), /waiting-slot ok waiting for a slot \(2\/2 held by/);
  assert.equal(readdirSync(dir).length, 2, 'the timed-out caller left no slot file');

  // (d) release by pid frees a slot
  r = run(['release', '--pid', String(holders[0].pid)]);
  assert.equal(r.stdout.trim(), 'released 1');
  assert.equal(readdirSync(dir).length, 1);
  r = run(['acquire', '--pid', String(process.pid), '--wait', '2']);
  assert.equal(r.status, 0, 'a freed slot is re-acquired');

  // (b) dead pid + old mtime are reaped and re-used
  run(['release', '--all']);
  assert.equal(readdirSync(dir).length, 0);
  const dead = join(dir, '999999-dead.json');
  writeFileSync(dead, JSON.stringify({ pid: 999999, project: '/x/dead', script: 'x', since: '2026-01-01T00:00:00Z' }));
  const old = join(dir, `${holders[1].pid}-old.json`);
  writeFileSync(old, JSON.stringify({ pid: holders[1].pid, project: '/x/old', script: 'x', since: '2026-01-01T00:00:00Z' }));
  const past = new Date(Date.now() - 3 * 3_600_000);
  utimesSync(old, past, past);
  r = run(['status', '--json']);
  let s = JSON.parse(r.stdout);
  assert.equal(s.reapedStale, 2, 'both stale files reaped by the census');
  assert.deepEqual(s.held, []);
  assert.ok(!existsSync(dead) && !existsSync(old));
  r = run(['acquire', '--pid', String(holders[1].pid), '--script', 'anchor']);
  assert.equal(r.status, 0);
  r = run(['acquire', '--pid', String(holders[0].pid), '--script', 'visual-diff']);
  assert.equal(r.status, 0, 'two slots free after the reap');
  // --all --stale removes only stale files
  writeFileSync(dead, JSON.stringify({ pid: 999999 }));
  r = run(['release', '--all', '--stale']);
  assert.equal(r.stdout.trim(), 'released 1');
  assert.equal(readdirSync(dir).length, 2, 'live holders untouched by --stale');

  // (e) status: holders as JSON, orphan census present, human line
  r = run(['status', '--json']);
  s = JSON.parse(r.stdout);
  assert.equal(s.slots, 2);
  assert.deepEqual(s.held.map((h) => h.script).sort(), ['anchor', 'visual-diff']);
  for (const h of s.held) for (const k of ['pid', 'host', 'project', 'script', 'since', 'file']) assert.ok(k in h, `holder has ${k}`);
  assert.ok(Array.isArray(s.orphans), 'orphan census is a list');
  r = run(['status']);
  assert.match(r.stdout, /^browser-lock: 2\/2 slot\(s\) held \(pid \d+ (anchor|visual-diff) \S+, pid \d+ (anchor|visual-diff) \S+\) · 0 stale reaped · \d+ orphan browser process\(es\)/);

  // (c) SLOTS=0 / --no-lock touch nothing
  const dir0 = join(tmp, 'never');
  r = spawnSync(process.execPath, [CLI, 'acquire', '--lock-dir', dir0], { encoding: 'utf8', env: { ...env, STARDUST_BROWSER_SLOTS: '0' } });
  assert.equal(r.status, 0); assert.match(r.stdout, /disabled \(STARDUST_BROWSER_SLOTS=0\)/);
  r = spawnSync(process.execPath, [CLI, 'acquire', '--no-lock', '--lock-dir', dir0], { encoding: 'utf8', env });
  assert.equal(r.status, 0); assert.match(r.stdout, /disabled \(--no-lock\)/);
  assert.ok(!existsSync(dir0), 'disabled lock never creates the dir');

  // help / usage
  r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Exit codes: 0 acquired/);
  r = spawnSync(process.execPath, [CLI, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  console.log('browser-lock smoke: ok (2 slots, third exits 124 with one waiting line + progress log, dead/old slots reaped, release by pid / --all --stale, status JSON + census, SLOTS=0 and --no-lock touch nothing)');
} finally {
  for (const h of holders) h.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}
