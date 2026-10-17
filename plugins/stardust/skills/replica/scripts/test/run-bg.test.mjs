#!/usr/bin/env node
// skills/replica/scripts/test/run-bg.test.mjs — the run-bg.mjs contract: detached start, FIFO
// concurrency slots (default 3), bounded wait (exit 75 while jobs are going; --max clamped to 110), instrument
// deadline (124), verdict-line extraction, duplicate-name refusal, pid identity (a recycled pid is lost, holds no
// slot, is never signalled), the value-flag swallow rule, log/clean (--all stops wrapper + instrument), and the
// machine-wide browser slot a browser job takes through browser-lock.mjs (temp STARDUST_BROWSER_LOCK_DIR): peak
// holders within STARDUST_BROWSER_SLOTS, a wait without a limit by default (lockWaitS), no slot within a set
// STARDUST_BROWSER_WAIT = exit 124, --lock/--no-lock, a dead holder reclaimed, the browsers per slot it exports
// (browsersPerSlot, STARDUST_BROWSERS_PER_SLOT); the job's deadline exported as
// RUN_BG_DEADLINE_SEC, and a gate-all job without --timeout sized from gate-all's roster estimate (gateAllTimeout) — × 1
// with the lock off, × 4 at the default one browser per slot.
// Run: node plugins/stardust/skills/replica/scripts/test/run-bg.test.mjs   (about 25 s)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_SCRIPTS, DEFAULT_SLOTS, MAX_CEILING_SEC, STILL_RUNNING_EXIT, VERDICT_RE, browsersPerSlot, gateAllTimeout, isBrowserJob, lockWaitS } from '../run-bg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'run-bg.mjs');
const dir = mkdtempSync(join(tmpdir(), 'run-bg-test-'));
// The machine-wide browser lock (browser-lock.mjs) points at a temp dir — never the real ~/.stardust.
const lockRoot = mkdtempSync(join(tmpdir(), 'run-bg-lock-test-'));
const LOCKS = join(lockRoot, 'locks');
const env = { ...process.env, RUN_BG_POLL_MS: '100', STARDUST_BROWSER_LOCK_DIR: LOCKS, STARDUST_BROWSER_POLL_MS: '100' };
delete env.RUN_BG_SLOTS; delete env.STARDUST_BROWSER_SLOTS; delete env.STARDUST_BROWSER_SLOT; delete env.STARDUST_BROWSER_WAIT; delete env.STARDUST_BROWSER_TTL_MIN; delete env.RUN_BG_DEADLINE_SEC; delete env.STARDUST_BROWSER_BUDGET; delete env.STARDUST_BROWSERS_PER_SLOT;
const run = (extra, sub, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, sub, '--dir', dir, ...args], { encoding: 'utf8', env: { ...env, ...extra } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const bg = (sub, ...args) => run({}, sub, ...args);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// A state file as the wrapper would leave it, with the identity fields the caller sets.
const fakeState = (name, fields) => { const q = new Date(Date.now() - 60000).toISOString(); writeFileSync(join(dir, `${name}.json`), JSON.stringify({ name, cmd: 'true', args: [], cwd: dir, timeoutSec: 0, slots: 1, queuedAt: q, wrapperPid: null, wrapperStart: null, launchedAt: q, childPid: null, childStart: null, endedAt: null, exit: null, timedOut: false, ...fields })); writeFileSync(join(dir, `${name}.log`), ''); };
const state = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// Three jobs on one slot: a prints a FAIL verdict and exits 2, b prints PASS, c outlives a 1 s deadline.
const FAIL_JOB = "setTimeout(()=>{console.log('A 1440x3690  B 1440x3754  → compare 1440x3690, height delta 64px');console.log('differing pixels: 12 / 100 = 12.00%  (threshold 10%) → FAIL');console.log('  y      0–500: 30.1%  ◄◄ hot band');process.exit(2)},600)";
const PASS_JOB = "setTimeout(()=>console.log('differing pixels: 1 / 100 = 1.00%  (threshold 10%) → PASS'),600)";
const SLOW_JOB = 'setTimeout(()=>{},5000)';

await check('start detaches and names the log', () => {
  const r = bg('start', '--name', 'a', '--slots', '1', '--', process.execPath, '-e', FAIL_JOB);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /queued a → .*a\.log/);
  assert.equal(bg('start', '--name', 'b', '--slots', '1', '--', process.execPath, '-e', PASS_JOB).code, 0);
  assert.equal(bg('start', '--name', 'c', '--slots', '1', '--timeout', '1', '--', process.execPath, '-e', SLOW_JOB).code, 0);
});
await check('a pending name is refused (exit 2)', () => {
  const r = bg('start', '--name', 'a', '--', 'true');
  assert.equal(r.code, 2); assert.match(r.err, /a is still (queued|running)/);
});
await check('start rejects a bad name and a missing command (exit 125)', () => {
  assert.equal(bg('start', '--name', '../x', '--', 'true').code, 125);
  assert.equal(bg('start', '--name', 'ok').code, 125);
});
await check('a value flag followed by nothing or by another flag is a usage error naming the flag (exit 125), never swallowed', () => {
  for (const [args, flag] of [[['start', '--name'], '--name'], [['start', '--name', '--slots', '1', '--', 'true'], '--name'], [['wait', '--max', '--tail', '3'], '--max'], [['status', '--grep'], '--grep'], [['status', '--tail', '--all'], '--tail'], [['start', '--name', 'x', '--timeout', '--', 'true'], '--timeout'], [['status', '--dir'], '--dir']]) {
    const r = bg(...args); assert.equal(r.code, 125, `${args.join(' ')}: exit ${r.code}`); assert.match(r.err, new RegExp(`run-bg: ${flag} needs a value`), `${args.join(' ')}: ${r.err.split('\n')[0]}`);
  }
  assert.equal(readdirSync(dir).some((f) => f.startsWith('x.')), false, 'no job was created by the rejected start');
});
await check('status reports every named job without waiting (slot queue visible while it lasts)', () => {
  const r = bg('status', 'a', 'b', 'c'); // on a slow (emulated) host a may already be done — the states vary, the shape does not
  assert.equal(r.code, 0); assert.match(r.out, /^a {2}(running \d+s|queued \d+s \(waiting for a slot\)|done exit=2)/m); assert.match(r.out, /^b {2}(running|queued|done exit=0)/m);
  assert.match(r.out, /^c {2}(queued \d+s \(waiting for a slot\)|running|deadline)/m); assert.match(r.out, /(still going — run `wait` again|all 3 ended)/);
});
await check(`wait returns at its ceiling with exit ${STILL_RUNNING_EXIT} while a job is going`, () => {
  assert.equal(bg('start', '--name', 'w', '--slots', '9', '--', process.execPath, '-e', 'setTimeout(()=>{},4000)').code, 0); // its own slot budget: launches at once
  const t0 = Date.now(); const r = bg('wait', '--max', '1', 'w');
  assert.equal(r.code, STILL_RUNNING_EXIT, r.out); assert.ok(Date.now() - t0 < 3500, 'returned promptly'); assert.match(r.out, /^w {2}(running|queued)/m); assert.match(r.out, /still going after \ds \(ceiling 1s\)/); assert.match(r.out, /run `wait` again as your next step/);
});
await check('VERDICT_RE covers the gate.sh --full verdict lines and motion-compare\'s summary, not report body lines', () => {
  for (const line of [
    'content-diff: none — content + roles match',
    'content-diff: 3 (1 structural 🔴)',
    'visual-diff: 2 advisory flag(s) — HEADING COLOR: h2 differs; IMAGE DIMS: hero;',
    'chrome-parity: ✓ chrome parity within tolerance — run crop-compare (pass bar item 5) to confirm in pixels.',
    'chrome-parity: ✗ 3 delta(s) — fix these before any pixel iteration on chrome; re-run until quiet, then crop-compare confirms.',
    'chrome-parity: DEADLINE (exit 124) — re-run, not a verdict',
    'content-diff: BLOCKED (exit 3) — bot challenge on the live side, escalate --headed',
    'visual-diff: ERROR (exit 1) — visual-diff error: page.goto failed',
    'evidence: stardust/replica/gates/home-1440/content-diff-iter2.txt',
    'motion summary: 6 behaviors — 6 parity, 0 missing on build → PASS',
    'SUMMARY 3 blocks compared, 1 differs',
    'browser-lock: waiting for slot (2/2 held by pid 4242)',
  ]) assert.match(line, VERDICT_RE, line);
  for (const line of ['  live: 12 headings', '  • HEADING COLOR: h2 differs', 'Full metrics JSON:', '{}']) assert.doesNotMatch(line, VERDICT_RE, line);
});
await check('wait to completion reports verdict lines only, deadline as no-verdict', () => {
  const r = bg('wait', '--max', '20', 'a', 'b', 'c', 'w');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^w {2}done exit=0/m);
  assert.match(r.out, /^a {2}done exit=2 in \ds$/m); assert.match(r.out, /^ {2}differing pixels: 12 \/ 100 = 12\.00%.*FAIL$/m); assert.match(r.out, /hot band/);
  assert.match(r.out, /^b {2}done exit=0/m); assert.match(r.out, /→ PASS$/m);
  assert.match(r.out, /^c {2}deadline 1s exceeded \(exit 124: no verdict/m); assert.match(r.out, /run-capped: c exceeded 1s/);
  assert.doesNotMatch(r.out, /launched/, 'run-bg housekeeping lines are not verdict lines');
  assert.match(r.out, /all 4 ended/);
});
await check('one slot means strictly sequential launches, first come first served', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(state);
  assert.equal(a.exit, 2); assert.equal(b.exit, 0); assert.equal(c.exit, 124); assert.equal(c.timedOut, true); assert.equal(a.timedOut, false);
  assert.ok(b.launchedAt >= a.endedAt, `b launched ${b.launchedAt} before a ended ${a.endedAt}`);
  assert.ok(c.launchedAt >= b.endedAt, `c launched ${c.launchedAt} before b ended ${b.endedAt}`);
});
await check('log is bounded: --tail and --grep', () => {
  const t = bg('log', 'a', '--tail', '2');
  assert.equal(t.code, 0); const lines = t.out.trim().split('\n'); assert.equal(lines.length, 3, t.out); assert.match(lines[0], /a\.log: \d+ lines, showing the last 2$/); assert.match(lines[2], /run-bg: a ended exit=2/);
  const g = bg('log', 'a', '--grep', 'height delta');
  assert.match(g.out, /2 match \/height delta\//, g.out); // the verdict line and the launch line echoing the command
  assert.equal(bg('log', 'nope').code, 2);
});
await check('wait names an unknown job instead of hanging on it', () => {
  const r = bg('wait', '--max', '1', 'ghost');
  assert.equal(r.code, 0); assert.match(r.out, /^ghost {2}no such job/m);
});
await check(`--max above ${MAX_CEILING_SEC} s is clamped and says why`, () => {
  assert.equal(MAX_CEILING_SEC, 110, 'the agent\'s shell tool\'s default timeout is about two minutes and applies only to a call that declares none; 110 s returns inside it even when none is declared');
  assert.equal(bg('start', '--name', 'z', '--', 'true').code, 0);
  const r = bg('wait', '--max', '9999', 'z');
  assert.equal(r.code, 0); assert.match(r.err, /--max 9999 clamped to 110s — the agent's shell tool's default timeout is about two minutes and applies to a call that declares none; 110 s returns inside it and leaves startup and the report their room/);
  const r200 = bg('wait', '--max', '200', 'z');
  assert.equal(r200.code, 0); assert.match(r200.err, /--max 200 clamped to 110s/);
  const r111 = bg('wait', '--max', '111', 'z');
  assert.equal(r111.code, 0); assert.match(r111.err, /--max 111 clamped to 110s/, 'the former 180 s ceiling outlived the shell tool\'s default timeout whenever the call declared none');
  const r110 = bg('wait', '--max', '110', 'z');
  assert.equal(r110.code, 0); assert.equal(r110.err, '', 'a --max at or under the ceiling is not clamped');
});
await check(`slots default to ${DEFAULT_SLOTS} — RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS, else ${DEFAULT_SLOTS}`, () => {
  assert.equal(DEFAULT_SLOTS, 3, 'each capture is a Chromium and a gate.sh --full round holds up to six, yet at 3 slots a recorded fan-out still queued 84 of 272 jobs for more than 10 s: 3 is the default, the env moves it');
  assert.equal(bg('start', '--name', 'd0', '--', 'true').code, 0); assert.equal(state('d0').slots, 3);
  assert.equal(run({ STARDUST_BROWSER_SLOTS: '4' }, 'start', '--name', 'd1', '--', 'true').code, 0); assert.equal(state('d1').slots, 4);
  assert.equal(run({ RUN_BG_SLOTS: '2' }, 'start', '--name', 'd4', '--', 'true').code, 0); assert.equal(state('d4').slots, 2, 'RUN_BG_SLOTS alone overrides the default');
  assert.equal(run({ STARDUST_BROWSER_SLOTS: '4', RUN_BG_SLOTS: '1' }, 'start', '--name', 'd2', '--', 'true').code, 0); assert.equal(state('d2').slots, 1);
  assert.equal(run({ RUN_BG_SLOTS: '1' }, 'start', '--name', 'd3', '--slots', '5', '--', 'true').code, 0); assert.equal(state('d3').slots, 5, '--slots wins over the env');
  assert.equal(bg('wait', '--max', '10', 'd0', 'd1', 'd2', 'd3', 'd4').code, 0);
});
await check('a wrapper killed without an exit is reported lost, not running', async () => {
  assert.equal(bg('start', '--name', 'lost', '--', process.execPath, '-e', 'setTimeout(()=>{},1500)').code, 0);
  for (let i = 0; i < 30 && !state('lost').launchedAt; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  process.kill(state('lost').wrapperPid, 'SIGKILL');
  await sleep(200);
  const r = bg('status', 'lost');
  assert.match(r.out, /^lost {2}lost — wrapper gone.*; its instrument \(pid \d+\) still runs — `clean --all` stops it/m, r.out);
  for (let i = 0; i < 40 && pidAlive(state('lost').childPid); i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  assert.match(bg('status', 'lost').out, /^lost {2}lost — wrapper gone without an exit \(kill -9\? reboot\?\) — re-run$/m, 'instrument gone: a plain lost');
});
await check('the wrapper records its pid + start identity and the instrument\'s childPid; the starter wrote no pid', () => {
  const st = state('lost');
  assert.ok(st.wrapperStart && /\d{4}$|^ticks:/.test(st.wrapperStart), `wrapperStart ${st.wrapperStart}`);
  assert.ok(Number.isInteger(st.childPid) && st.childPid > 0 && st.childStart, `childPid ${st.childPid} childStart ${st.childStart}`);
  assert.notEqual(st.childPid, st.wrapperPid);
});
await check('a stored pid that now names another process (recycled) is lost, not running, holds no slot and does not refuse its name', () => {
  // Our own pid stands in for the recycled one: it exists, answers signal 0, and its start time is not the recorded one.
  fakeState('stale', { wrapperPid: process.pid, wrapperStart: 'Mon Jan  1 00:00:00 2001' });
  const s = bg('status', 'stale'); assert.match(s.out, /^stale {2}lost — wrapper gone/m, s.out);
  assert.equal(bg('start', '--name', 'after', '--slots', '1', '--', 'true').code, 0, 'stale counts as no running job on the single slot');
  const w = bg('wait', '--max', '10', 'after'); assert.equal(w.code, 0, w.out); assert.match(w.out, /^after {2}done exit=0/m, w.out);
  assert.equal(bg('start', '--name', 'stale', '--', 'true').code, 0, 'a lost name may be reused');
  assert.equal(bg('wait', '--max', '10', 'stale').code, 0);
  // Without a recorded start (older state file), the command line must be this script's __run for the job.
  fakeState('stale2', { wrapperPid: process.pid, wrapperStart: null });
  assert.match(bg('status', 'stale2').out, /^stale2 {2}lost/m);
  fakeState('spawning', { wrapperPid: null, launchedAt: null, queuedAt: new Date().toISOString() });
  assert.match(bg('status', 'spawning').out, /^spawning {2}queued/m, 'a pid-less state younger than the spawn grace is still spawning');
  rmSync(join(dir, 'spawning.json')); rmSync(join(dir, 'spawning.log'));
});
await check('with no names and nothing going, wait/status report the latest batch — --all shows every job on disk', () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // an earlier session's finished job
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ name: 'old', cmd: 'true', args: [], cwd: dir, timeoutSec: 0, slots: 1, queuedAt: old, wrapperPid: null, launchedAt: old, endedAt: old, exit: 0, timedOut: false }));
  writeFileSync(join(dir, 'old.log'), 'differing pixels: 0 / 1 = 0.00%  (threshold 10%) → PASS\n');
  const s = bg('status'); assert.equal(s.code, 0); assert.doesNotMatch(s.out, /^old {2}/m, s.out); assert.match(s.out, /^a {2}done exit=2/m); assert.match(s.out, /run-bg: 1 earlier job\(s\) not shown — `status --all`$/m);
  const w = bg('wait'); assert.equal(w.code, 0); assert.doesNotMatch(w.out, /^old {2}/m, w.out); assert.match(w.out, /1 earlier job\(s\) not shown/);
  const all = bg('status', '--all'); assert.match(all.out, /^old {2}done exit=0/m, all.out); assert.doesNotMatch(all.out, /not shown/);
  const named = bg('status', 'old'); assert.match(named.out, /^old {2}done exit=0/m); assert.doesNotMatch(named.out, /not shown/);
});
await check('clean removes ended and lost jobs; wait on an empty dir says so', () => {
  const r = bg('clean');
  assert.equal(r.code, 0); assert.match(r.out, /removed a/); assert.match(r.out, /removed w/); assert.match(r.out, /removed z/); assert.match(r.out, /removed lost/); assert.match(r.out, /removed stale2/);
  assert.equal(readdirSync(dir).length, 0, readdirSync(dir).join(','));
  const w = bg('wait'); assert.equal(w.code, 0); assert.match(w.out, /no jobs in/);
});
await check('clean --all stops a running job — wrapper and instrument — and only then removes its files', async () => {
  assert.equal(bg('start', '--name', 'busy', '--timeout', '0', '--', process.execPath, '-e', 'setInterval(()=>{},1000)').code, 0);
  for (let i = 0; i < 50 && !state('busy').childPid; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  const { wrapperPid, childPid } = state('busy'); assert.ok(childPid, 'childPid recorded');
  const r = bg('clean', '--all');
  assert.equal(r.code, 0); assert.match(r.out, /^run-bg: stopped busy$/m, r.out);
  assert.equal(pidAlive(wrapperPid), false, 'wrapper gone'); assert.equal(pidAlive(childPid), false, 'instrument gone');
  assert.equal(readdirSync(dir).length, 0, readdirSync(dir).join(','));
});
await check('a lost job whose instrument still runs: plain clean keeps it, clean --all kills the instrument group and removes it', async () => {
  assert.equal(bg('start', '--name', 'orphan', '--timeout', '0', '--', process.execPath, '-e', 'setInterval(()=>{},1000)').code, 0);
  for (let i = 0; i < 50 && !state('orphan').childPid; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  const { wrapperPid, childPid } = state('orphan'); assert.ok(childPid, 'childPid recorded');
  process.kill(wrapperPid, 'SIGKILL'); await sleep(200);
  const k = bg('clean'); assert.match(k.out, /keeping orphan \(lost, instrument pid \d+ still running\) — `clean --all` stops it/, k.out);
  assert.equal(pidAlive(childPid), true, 'plain clean did not touch the instrument');
  const r = bg('clean', '--all');
  assert.equal(r.code, 0); assert.match(r.out, /^run-bg: stopped orphan$/m, r.out);
  assert.equal(pidAlive(childPid), false, 'instrument gone'); assert.equal(readdirSync(dir).length, 0, readdirSync(dir).join(','));
});
await check('clean --all never signals a pid whose identity does not match (recycled wrapper or instrument pid)', () => {
  fakeState('ghost', { wrapperPid: process.pid, wrapperStart: 'Mon Jan  1 00:00:00 2001', childPid: process.pid, childStart: 'Mon Jan  1 00:00:00 2001' });
  const r = bg('clean', '--all'); // a SIGTERM to process.pid would end this test run here
  assert.equal(r.code, 0); assert.doesNotMatch(r.out, /stopped ghost/); assert.match(r.out, /removed ghost/, r.out);
  assert.equal(readdirSync(dir).length, 0);
});
await check('VERDICT_RE covers the gate instruments and skips prose', () => {
  for (const l of ['differing pixels: 1 / 2 = 50.00%  (threshold 10%) → FAIL', 'A 1440x100  B 1440x120  → compare 1440x100, height delta 20px', '  y      0–500: 30.1%  ◄◄ hot band',
    'stitched stardust/replica/gates/home-1440/build.png: 1440x3690 from 8 chunks', 'gate.sh: IDENTITY ASSERTION FAILED — http://localhost:8791/x does not serve …', 'run-capped: stitch-shot build home@1440 exceeded 300s — killed (exit 124).',
    'gate.sh: reaped stale instrument pid 4 (running 16:02): stitch-shot.mjs', 'stitch-shot WARNING: FONT LOAD FAILED for declared face(s) Asar', '🔴 3 structural']) assert.match(l, VERDICT_RE, l);
  for (const l of ['consent dismissed via #onetrust-accept-btn-handler', 'passing 3 selectors through', 'no errors so far', 'diff image: stardust/replica/gates/home-1440/diff-iter2.png']) assert.doesNotMatch(l, VERDICT_RE, l);
});

// ---- the machine-wide browser slot (browser-lock.mjs) ------------------------------------------
const LOCK_CLI = join(HERE, '..', '..', '..', 'stardust', 'scripts', 'browser-lock.mjs');
const lockCli = (extra, ...args) => spawnSync(process.execPath, [LOCK_CLI, ...args, '--lock-dir', LOCKS], { encoding: 'utf8', env: { ...env, ...extra } });
const bgIn = (d, extra, sub, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, sub, '--dir', d, ...args], { encoding: 'utf8', env: { ...env, ...extra } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const stateIn = (d, name) => JSON.parse(readFileSync(join(d, `${name}.json`), 'utf8'));
const logIn = (d, name) => readFileSync(join(d, `${name}.log`), 'utf8');
const locks = () => (existsSync(LOCKS) ? readdirSync(LOCKS) : []);
// A job that prints the slot it runs in (holder files in the lock dir, the env its children see), then holds it.
const SLOT_JOB = (ms) => `const fs=require('fs'),d=process.env.STARDUST_BROWSER_LOCK_DIR;console.log('holders '+(fs.existsSync(d)?fs.readdirSync(d).length:0)+' perSlot='+(process.env.STARDUST_BROWSERS_PER_SLOT||'')+' slots='+process.env.STARDUST_BROWSER_SLOTS+' slot='+(process.env.STARDUST_BROWSER_SLOT||''));setTimeout(()=>{},${ms})`;
// The most [launchedAt, endedAt] intervals open at one instant (an end before a start at the same ms).
const peak = (sts) => { let n = 0; let m = 0; for (const [, d] of sts.flatMap((s) => [[Date.parse(s.launchedAt), 1], [Date.parse(s.endedAt), -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) { n += d; m = Math.max(m, n); } return m; };

await check('BROWSER_SCRIPTS = every skills/*/scripts/*.mjs that launches a browser (imports playwright, or calls its skill\'s lib.mjs loadPlaywright() itself or in a module it names) + gate.sh + gate-all.mjs', () => {
  const SKILLS = join(HERE, '..', '..', '..');
  const PW = /from ['"]playwright['"]|import\(\s*['"]playwright['"]\s*\)/;
  // loadPlaywright imported from the skill's lib.mjs (static or dynamic import) and awaited
  const VIA_LIB = (s) => (/import\s*\{[^}]*\bloadPlaywright\b[^}]*\}\s*from\s*['"]\.{1,2}\/lib\.mjs['"]/.test(s) || /\{\s*loadPlaywright\s*\}\s*=\s*await\s+import\(\s*['"]\.{1,2}\/lib\.mjs['"]\s*\)/.test(s)) && /await\s+loadPlaywright\s*\(/.test(s);
  const launches = (s) => PW.test(s) || VIA_LIB(s);
  const derived = new Set(['gate.sh', 'gate-all.mjs']);
  for (const skill of readdirSync(SKILLS)) {
    const d = join(SKILLS, skill, 'scripts'); if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.mjs') || f === 'lib.mjs') continue;
      const src = readFileSync(join(d, f), 'utf8');
      // a module the script names by a relative path inside its scripts dir (qa.mjs's 'checks/browse.mjs')
      const named = [...src.matchAll(/['"]((?:\.\/)?[\w-]+\/[\w.-]+\.mjs)['"]/g)].map((m) => join(d, m[1])).filter((p) => existsSync(p));
      if (launches(src) || named.some((p) => launches(readFileSync(p, 'utf8')))) derived.add(f);
    }
  }
  for (const f of ['qa.mjs', 'dynamics-detect.mjs', 'spec-capture.mjs', 'stitch-shot.mjs']) assert.ok(derived.has(f), `the derivation finds ${f}`);
  assert.deepEqual([...BROWSER_SCRIPTS].sort(), [...derived].sort(), 'a script that starts or stops launching a browser updates BROWSER_SCRIPTS');
});
await check('isBrowserJob: an argv token naming a browser instrument by basename (also inside a shell -c string); deploy-batch, pixel-compare, crop-compare, gate-evidence are not', () => {
  for (const argv of [['stardust/scripts/replica/gate.sh', 'home', 'LIVE', 'PROTO', '1440', 'iter1'], ['node', 'stardust/scripts/replica/gate-all.mjs', '--only', 'home'],
    [process.execPath, '/abs/stardust/scripts/replica/stitch-shot.mjs', 'LIVE', 'o.png'], ['bash', '-c', 'node stardust/scripts/diff/content-diff.mjs a b > out.txt'],
    ['node', 'stardust/scripts/qa/qa.mjs', '--checks', 'browse']]) assert.equal(isBrowserJob(argv[0], argv.slice(1)), true, argv.join(' '));
  for (const argv of [['node', 'stardust/scripts/deploy/deploy-batch.mjs', '--all'], ['node', 'stardust/scripts/replica/pixel-compare.mjs', 'a.png', 'b.png'], ['node', 'crop-compare.mjs'],
    ['node', 'stardust/scripts/replica/gate-evidence.mjs'], [process.execPath, '-e', 'setTimeout(()=>{},1)'], ['true']]) assert.equal(isBrowserJob(argv[0], argv.slice(1)), false, argv.join(' '));
});
const dirs3 = ['p1', 'p2', 'p3'].map((n) => join(lockRoot, n, 'bg')); // three projects' run-bg dirs
await check('three --lock jobs from three run-bg dirs under STARDUST_BROWSER_SLOTS=2: at most two hold a slot at once, the third waits then runs, none exits 1', () => {
  for (const [i, d] of dirs3.entries()) assert.equal(bgIn(d, { STARDUST_BROWSER_SLOTS: '2' }, 'start', '--name', `b${i}`, '--lock', '--', process.execPath, '-e', SLOT_JOB(2000)).code, 0);
  for (const [i, d] of dirs3.entries()) { const w = bgIn(d, {}, 'wait', '--max', '30', `b${i}`); assert.equal(w.code, 0, w.out); }
  const sts = dirs3.map((d, i) => stateIn(d, `b${i}`));
  assert.deepEqual(sts.map((s) => s.exit), [0, 0, 0], 'no job exits 1 (a re-queue) or 124');
  assert.ok(peak(sts) <= 2, `peak ${peak(sts)} concurrent slot holders`);
  for (const [i, d] of dirs3.entries()) { const m = logIn(d, `b${i}`).match(/^holders (\d+)/m); assert.ok(m && Number(m[1]) <= 2, `b${i} saw ${m?.[1]} holders`); }
  const waited = sts.filter((s, i) => /^browser-lock: waiting for a slot \(2\/2 held by/m.test(logIn(dirs3[i], `b${i}`)));
  assert.equal(waited.length, 1, 'exactly one job waited for a machine-wide slot');
  assert.ok(waited[0].lockWaitSec >= 1 && waited[0].launchedAt >= sts.filter((s) => s !== waited[0]).map((s) => s.endedAt).sort()[0], `lockWaitSec ${waited[0].lockWaitSec}`);
  assert.deepEqual(locks(), [], 'every slot released at the end');
});
await check('a slot-holding job runs with STARDUST_BROWSER_SLOTS=0 (its children take no second slot) and STARDUST_BROWSER_SLOT = its slot file in the lock dir', () => {
  for (const [i, d] of dirs3.entries()) {
    const st = stateIn(d, `b${i}`); const m = logIn(d, `b${i}`).match(/ slots=(\S*) slot=(\S*)$/m);
    assert.ok(m, `b${i} printed its slot`); assert.equal(m[1], '0'); assert.equal(m[2], st.lockFile); assert.equal(dirname(m[2]), LOCKS, m[2]);
  }
});
await check('browsersPerSlot: max(1, floor(STARDUST_BROWSER_BUDGET / STARDUST_BROWSER_SLOTS)); a budget that is not a positive number and a slot count that is not a positive number (0 = lock off, junk) count as the default 3; a non-integer slot count rounds up, as browser-lock admits holders', () => {
  assert.equal(browsersPerSlot({}), 1, 'defaults: 3 / 3');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '6', STARDUST_BROWSER_SLOTS: '2' }), 3);
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '2', STARDUST_BROWSER_SLOTS: '3' }), 1, 'a budget below the slots: the floor of one');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '7', STARDUST_BROWSER_SLOTS: '2' }), 3, 'floored');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '4.5', STARDUST_BROWSER_SLOTS: '2' }), 2);
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '10', STARDUST_BROWSER_SLOTS: '4.5' }), 2, '4.5 slots admit 5 holders: 10 / 5');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: '1.5' }), 4, '1.5 slots admit 2 holders: 9 / 2');
  for (const s of [undefined, '0', '', ' ', 'x', '-2']) assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: s }), 3, `slots ${JSON.stringify(s)}: 9 / 3`);
  for (const b of [undefined, '0', '', 'x', '-6']) assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: b, STARDUST_BROWSER_SLOTS: '1' }), 3, `budget ${JSON.stringify(b)}: 3 / 1`);
});
await check('a slot-holding job gets STARDUST_BROWSERS_PER_SLOT from the slot count before it is zeroed; a budget below the slots says so in one run-bg: line', () => {
  const d = join(lockRoot, 'per-slot', 'bg');
  const jobs = [['ps62', { STARDUST_BROWSER_BUDGET: '6', STARDUST_BROWSER_SLOTS: '2' }, '3'], ['ps23', { STARDUST_BROWSER_BUDGET: '2', STARDUST_BROWSER_SLOTS: '3' }, '1'], ['psdef', {}, '1']];
  for (const [name, x] of jobs) assert.equal(bgIn(d, x, 'start', '--name', name, '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
  const w = bgIn(d, {}, 'wait', '--max', '30', ...jobs.map(([n]) => n)); assert.equal(w.code, 0, w.out);
  for (const [name, , per] of jobs) {
    const st = stateIn(d, name); const log = logIn(d, name);
    assert.equal(st.exit, 0, `${name}: ${log}`); assert.ok(st.lockFile, `${name} took a slot`);
    assert.match(log, new RegExp(`^holders \\d+ perSlot=${per} slots=0 slot=\\S+$`, 'm'), `${name}: ${log}`);
  }
  assert.deepEqual(logIn(d, 'ps23').match(/^run-bg: STARDUST_BROWSER_BUDGET.*$/gm), ['run-bg: STARDUST_BROWSER_BUDGET 2 is below STARDUST_BROWSER_SLOTS 3 — one browser per slot, 3 at most; set STARDUST_BROWSER_SLOTS=2 to hold the budget']);
  for (const name of ['ps62', 'psdef']) assert.doesNotMatch(logIn(d, name), /STARDUST_BROWSER_BUDGET/, name);
  assert.deepEqual(locks(), []);
});
await check('lockWaitS: a job waits for its machine-wide slot without a limit unless STARDUST_BROWSER_WAIT is set to seconds ≥ 0', () => {
  for (const v of [undefined, '', ' ', 'x', '-1']) assert.equal(lockWaitS(v === undefined ? {} : { STARDUST_BROWSER_WAIT: v }), Infinity, JSON.stringify(v));
  assert.equal(lockWaitS({ STARDUST_BROWSER_WAIT: '2' }), 2); assert.equal(lockWaitS({ STARDUST_BROWSER_WAIT: '0' }), 0);
});
await check('STARDUST_BROWSER_WAIT unset: a job stays queued behind a foreign holder past the moment a bounded wait would end, then runs once the slot is released (exit 0, never 124)', async () => {
  const holder = spawn('sleep', ['60']);
  try {
    assert.equal(lockCli({ STARDUST_BROWSER_SLOTS: '1' }, 'acquire', '--pid', String(holder.pid), '--script', 'foreign').status, 0);
    assert.equal(run({ STARDUST_BROWSER_SLOTS: '1' }, 'start', '--name', 'patient', '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
    for (let i = 0; i < 30 && !state('patient').lockWaitFrom; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
    await sleep(2500); // longer than the 2 s bound the next check sets
    assert.match(bg('status', 'patient').out, /^patient {2}queued \d+s \(waiting for a machine-wide browser slot — browser-lock\.mjs status\)$/m);
    assert.equal(lockCli({}, 'release', '--pid', String(holder.pid)).status, 0);
    const w = bg('wait', '--max', '20', 'patient'); assert.equal(w.code, 0, w.out);
    const st = state('patient'); const log = readFileSync(join(dir, 'patient.log'), 'utf8');
    assert.equal(st.exit, 0, log); assert.equal(st.lockTimeout ?? false, false); assert.ok(st.lockWaitSec >= 2, `lockWaitSec ${st.lockWaitSec}`);
    assert.match(log, /^browser-lock: waiting for a slot \(1\/1 held by pid \d+ foreign/m); assert.doesNotMatch(log, /no slot within/);
  } finally { holder.kill('SIGKILL'); lockCli({}, 'release', '--all'); }
});
await check('no machine-wide slot within a set STARDUST_BROWSER_WAIT: queued while it waits, then exit 124 (lockTimeout, no verdict) and the command never runs', async () => {
  const holder = spawn('sleep', ['60']);
  try {
    const a = lockCli({ STARDUST_BROWSER_SLOTS: '1' }, 'acquire', '--pid', String(holder.pid), '--script', 'foreign');
    assert.equal(a.status, 0, a.stderr);
    const marker = join(lockRoot, 'ran.txt');
    assert.equal(run({ STARDUST_BROWSER_SLOTS: '1', STARDUST_BROWSER_WAIT: '2' }, 'start', '--name', 'noslot', '--lock', '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'x')`).code, 0);
    for (let i = 0; i < 30 && !state('noslot').lockWaitFrom; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
    assert.match(bg('status', 'noslot').out, /^noslot {2}queued \d+s \(waiting for a machine-wide browser slot — browser-lock\.mjs status\)$/m);
    const w = bg('wait', '--max', '20', 'noslot');
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /^noslot {2}no machine-wide browser slot within \ds \(exit 124: no verdict — re-run\)$/m, w.out);
    assert.match(w.out, /browser-lock: no slot within 2 s \(1\/1 held by pid \d+ foreign/);
    const st = state('noslot');
    assert.equal(st.exit, 124); assert.equal(st.lockTimeout, true); assert.equal(st.launchedAt, null); assert.equal(st.timedOut, false);
    assert.equal(existsSync(marker), false, 'the command never ran');
  } finally { holder.kill('SIGKILL'); lockCli({}, 'release', '--all'); }
});
await check('--no-lock, an unclassified command and STARDUST_BROWSER_SLOTS=0 take no slot; a browser instrument asks for one without --lock', async () => {
  const holder = spawn('sleep', ['60']);
  try {
    assert.equal(lockCli({ STARDUST_BROWSER_SLOTS: '1' }, 'acquire', '--pid', String(holder.pid)).status, 0); // the only slot is held: asking for one ends 124
    const x = { STARDUST_BROWSER_SLOTS: '1', STARDUST_BROWSER_WAIT: '1' };
    const never = join(lockRoot, 'never');
    assert.equal(run(x, 'start', '--name', 'nl', '--no-lock', '--', process.execPath, '-e', SLOT_JOB(0), 'stitch-shot.mjs').code, 0);
    assert.equal(run(x, 'start', '--name', 'plain', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
    assert.equal(run(x, 'start', '--name', 'auto', '--', process.execPath, '-e', SLOT_JOB(0), 'stitch-shot.mjs').code, 0);
    assert.equal(run({ STARDUST_BROWSER_SLOTS: '0', STARDUST_BROWSER_LOCK_DIR: never }, 'start', '--name', 'off', '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
    assert.equal(bg('wait', '--max', '20', 'nl', 'plain', 'auto', 'off').code, 0);
    for (const n of ['nl', 'plain', 'off']) {
      const st = state(n); const log = readFileSync(join(dir, `${n}.log`), 'utf8');
      assert.equal(st.exit, 0, `${n}: ${log}`); assert.equal(st.lockFile ?? null, null, n); assert.match(log, / perSlot= slots=\S* slot=$/m, n);
    }
    assert.equal(state('auto').exit, 124, 'stitch-shot.mjs in the argv asks for a slot by default');
    assert.equal(state('auto').lockTimeout, true);
    assert.ok(state('off').launchedAt >= state('auto').endedAt, 'FIFO: a job waiting for the machine slot is still queued, the next job of its dir waits behind it');
    assert.equal(existsSync(never), false, 'STARDUST_BROWSER_SLOTS=0: the lock dir is never created');
  } finally { holder.kill('SIGKILL'); lockCli({}, 'release', '--all'); }
});
await check('a slot-holding wrapper killed with SIGKILL leaves a dead-pid slot that the next --lock job reclaims at once', async () => {
  const x = { STARDUST_BROWSER_SLOTS: '1', STARDUST_BROWSER_WAIT: '10' };
  assert.equal(run(x, 'start', '--name', 'k1', '--lock', '--timeout', '0', '--', process.execPath, '-e', 'setInterval(()=>{},1000)').code, 0);
  for (let i = 0; i < 50 && !state('k1').childPid; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  const { wrapperPid, childPid, lockFile } = state('k1');
  assert.ok(lockFile && existsSync(lockFile), 'k1 holds a slot');
  process.kill(wrapperPid, 'SIGKILL'); try { process.kill(-childPid, 'SIGKILL'); } catch { /* gone */ }
  await sleep(200);
  assert.equal(run(x, 'start', '--name', 'k2', '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
  const w = bg('wait', '--max', '20', 'k2'); assert.equal(w.code, 0, w.out);
  const st = state('k2');
  assert.equal(st.exit, 0, readFileSync(join(dir, 'k2.log'), 'utf8')); assert.ok(st.lockWaitSec < 2, `lockWaitSec ${st.lockWaitSec}`);
  assert.equal(existsSync(lockFile), false, 'the dead wrapper\'s slot was reaped'); assert.deepEqual(locks(), []);
});
await check('a project copy resolves browser-lock.mjs beside it (stardust/scripts/stardust/); run-bg copied alone runs the job unlocked and says so once', () => {
  const copy = (root, withLock) => {
    const rep = join(lockRoot, root, 'stardust', 'scripts', 'replica'); mkdirSync(rep, { recursive: true });
    for (const f of ['run-bg.mjs', 'run-capped.mjs']) copyFileSync(join(HERE, '..', f), join(rep, f));
    if (withLock) { mkdirSync(join(rep, '..', 'stardust')); copyFileSync(LOCK_CLI, join(rep, '..', 'stardust', 'browser-lock.mjs')); }
    const d = join(lockRoot, root, 'bg');
    const r = (sub, ...args) => spawnSync(process.execPath, [join(rep, 'run-bg.mjs'), sub, '--dir', d, ...args], { encoding: 'utf8', env });
    assert.equal(r('start', '--name', 'solo', '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).status, 0);
    assert.equal(r('wait', '--max', '20', 'solo').status, 0);
    return { st: stateIn(d, 'solo'), log: logIn(d, 'solo') };
  };
  const withLock = copy('copy', true);
  assert.equal(withLock.st.exit, 0); assert.ok(withLock.st.lockFile, 'the copy took a slot'); assert.doesNotMatch(withLock.log, /not found/);
  const alone = copy('alone', false);
  assert.equal(alone.st.exit, 0, alone.log); assert.equal(alone.st.lockFile ?? null, null);
  assert.equal(alone.log.match(/^run-bg: browser-lock\.mjs not found \(looked in .+\) — solo runs without a machine-wide browser slot$/gm)?.length, 1, alone.log);
  assert.deepEqual(locks(), []);
});

// ---- the job's deadline: exported as RUN_BG_DEADLINE_SEC; a gate-all job without --timeout sized from its roster ----
const proj = join(lockRoot, 'proj'); mkdirSync(join(proj, 'stardust'), { recursive: true }); // a project: 40 deployed pages
const deployed = (n) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}`, url: `https://o.test/p${i}`, status: 'deployed', liveUrl: `https://e.test/p${i}` }));
writeFileSync(join(proj, 'stardust', 'state.json'), JSON.stringify({ pages: deployed(40) })); writeFileSync(join(proj, 'small.json'), JSON.stringify({ pages: deployed(8) }));
// gateAllTimeout runs gate-all's rosterEstimate in this process's env (its pools follow the slot run-bg will take): pin
// the browser-slot env for the call, restore it after.
const SLOT_ENV = ['STARDUST_BROWSER_SLOT', 'STARDUST_BROWSER_SLOTS', 'STARDUST_BROWSER_BUDGET', 'STARDUST_BROWSERS_PER_SLOT'];
const withSlotEnv = async (vars, fn) => {
  const saved = SLOT_ENV.map((k) => [k, process.env[k]]);
  for (const k of SLOT_ENV) { if (k in vars) process.env[k] = vars[k]; else delete process.env[k]; }
  try { return await fn(); } finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
await check('gateAllTimeout: a gate-all job without --timeout gets max(900, 25 s × pages × widths × factor) summed over its invocations (argv tokens or sh -c words); other jobs and an explicit --timeout → null; factor × 1 with the lock off (STARDUST_BROWSER_SLOTS=0), × 4 under the defaults (budget 3 / 3 slots → 1 browser per slot, captures sequential)', async () => {
  const GA = 'stardust/scripts/replica/gate-all.mjs';
  await withSlotEnv({ STARDUST_BROWSER_SLOTS: '0' }, async () => {
    assert.deepEqual(await gateAllTimeout('node', [GA, '--width', '1440'], { cwd: proj }), { timeoutSec: 1000, note: 'gates 40 page(s) × 1 width ≈ 1000 s (gate-all estimate, 25 s per page per width) — no --timeout given: deadline 1000 s instead of the 900 s default' });
    const two = await gateAllTimeout('sh', ['-c', `node ${GA} --width 1440 > a.txt; node ${GA} --width 360 --only 'p0,p1,p2,p3'`], { cwd: proj });
    assert.equal(two.timeoutSec, 1100, two.note); assert.match(two.note, /^gates 40 page\(s\) × 1 width \+ 4 page\(s\) × 1 width ≈ 1100 s \(gate-all estimate/, 'both invocations counted, each with its own args');
    assert.deepEqual(await gateAllTimeout(process.execPath, ['/abs/gate-all.mjs', '--state', 'small.json'], { cwd: proj }), { timeoutSec: 900, note: 'gates 8 page(s) × 1 width ≈ 200 s (gate-all estimate, 25 s per page per width) — within the 900 s default — kept' }, 'raised only, never lowered');
    const none = await gateAllTimeout('node', [GA, '--state', 'nope.json'], { cwd: proj });
    assert.equal(none.timeoutSec, 900); assert.match(none.note, /^gate-all estimate unavailable \(.*nope\.json not found\) — 900 s default kept$/, none.note);
    for (const argv of [['stardust/scripts/replica/gate.sh', 'home', 'LIVE', 'PROTO', '1440', 'iter1'], ['node', 'stardust/scripts/replica/stitch-shot.mjs', 'LIVE', 'o.png'], ['bash', '-c', 'node gate-all.test.mjs'], ['true']]) assert.equal(await gateAllTimeout(argv[0], argv.slice(1), { cwd: proj }), null, argv.join(' ')); // eslint-disable-line no-await-in-loop
    assert.equal(await gateAllTimeout('node', [GA], { cwd: proj, given: true }), null, 'an explicit --timeout is never changed');
  });
  await withSlotEnv({}, async () => {
    assert.deepEqual(await gateAllTimeout('node', [GA, '--width', '1440'], { cwd: proj }), { timeoutSec: 4000, note: 'gates 40 page(s) × 1 width ≈ 4000 s (gate-all estimate, 25 s per page per width) — no --timeout given: deadline 4000 s instead of the 900 s default' });
    const two = await gateAllTimeout('sh', ['-c', `node ${GA} --width 1440 > a.txt; node ${GA} --width 360 --only 'p0,p1,p2,p3'`], { cwd: proj });
    assert.equal(two.timeoutSec, 4400, two.note); assert.match(two.note, /^gates 40 page\(s\) × 1 width \+ 4 page\(s\) × 1 width ≈ 4400 s \(gate-all estimate/, 'both invocations counted, each with its own args');
    assert.deepEqual(await gateAllTimeout(process.execPath, ['/abs/gate-all.mjs', '--state', 'small.json'], { cwd: proj }), { timeoutSec: 900, note: 'gates 8 page(s) × 1 width ≈ 800 s (gate-all estimate, 25 s per page per width) — within the 900 s default — kept' }, 'raised only, never lowered');
  });
});
await check('start without --timeout on a gate-all.mjs job: deadline = the estimate (× 1 with the lock off, × 4 under the default slot env), named on stdout, exported as RUN_BG_DEADLINE_SEC; an explicit --timeout and a non-gate-all job keep theirs; --timeout 0 leaves an inherited value alone', () => {
  const fake = join(lockRoot, 'fake'); mkdirSync(fake); // stand-ins that print the deadline they see
  for (const f of ['gate-all.mjs', 'stitch-shot.mjs']) writeFileSync(join(fake, f), "console.log('deadline='+process.env.RUN_BG_DEADLINE_SEC)");
  const d = join(proj, 'bg');
  const startIn = (extra, name, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, 'start', '--dir', d, '--name', name, '--no-lock', ...args], { cwd: proj, encoding: 'utf8', env: { ...env, ...extra } }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const OFF = { STARDUST_BROWSER_SLOTS: '0' }; // the lock off: no slot, the default pools, × 1
  const ga = startIn(OFF, 'ga', '--', process.execPath, join(fake, 'gate-all.mjs'));
  assert.match(ga, /^run-bg: ga gates 40 page\(s\) × 1 width ≈ 1000 s \(gate-all estimate, 25 s per page per width\) — no --timeout given: deadline 1000 s instead of the 900 s default$/m, ga);
  const ga4 = startIn({}, 'ga4', '--', process.execPath, join(fake, 'gate-all.mjs')); // the default slot env: 1 browser per slot, × 4
  assert.match(ga4, /^run-bg: ga4 gates 40 page\(s\) × 1 width ≈ 4000 s \(gate-all estimate, 25 s per page per width\) — no --timeout given: deadline 4000 s instead of the 900 s default$/m, ga4);
  const given = startIn(OFF, 'given', '--timeout', '30', '--', process.execPath, join(fake, 'gate-all.mjs'));
  const shot = startIn(OFF, 'shot', '--', process.execPath, join(fake, 'stitch-shot.mjs'));
  const zero = startIn({ ...OFF, RUN_BG_DEADLINE_SEC: '77' }, 'zero', '--timeout', '0', '--', process.execPath, join(fake, 'gate-all.mjs'));
  for (const out of [given, shot, zero]) assert.doesNotMatch(out, /gates|estimate/, out);
  const w = bgIn(d, {}, 'wait', '--max', '20', 'ga', 'ga4', 'given', 'shot', 'zero'); assert.equal(w.code, 0, w.out);
  for (const [name, timeoutSec, seen] of [['ga', 1000, '1000'], ['ga4', 4000, '4000'], ['given', 30, '30'], ['shot', 900, '900'], ['zero', 0, '77']]) {
    assert.equal(stateIn(d, name).timeoutSec, timeoutSec, name); assert.equal(stateIn(d, name).exit, 0, name);
    assert.match(logIn(d, name), new RegExp(`^deadline=${seen}$`, 'm'), `${name}: ${logIn(d, name)}`);
  }
});

rmSync(dir, { recursive: true, force: true });
rmSync(lockRoot, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nrun-bg: all checks passed');
process.exit(failed ? 1 : 0);
