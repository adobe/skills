#!/usr/bin/env node
// skills/replica/scripts/test/run-bg.test.mjs — the run-bg.mjs contract: detached start, FIFO
// concurrency slots (default 3), bounded wait (exit 75 while jobs are going; --max default 300, a notice over 600, ceiling 1500, or
// --until <ISO> clamped to the same ceiling; exit 76 at once on the pause file $STARDUST_PAUSE_FILE, which status
// shows too), instrument
// deadline (124), verdict-line extraction, duplicate-name refusal, pid identity (a recycled pid is lost, holds no
// slot, is never signalled), the value-flag swallow rule, log/clean (--all stops wrapper + instrument), and the
// machine-wide browser slot a browser job takes through browser-lock.mjs (temp STARDUST_BROWSER_LOCK_DIR): peak
// holders within STARDUST_BROWSER_SLOTS, a wait without a limit by default (lockWaitS), no slot within a set
// STARDUST_BROWSER_WAIT = exit 124, --lock/--no-lock, a dead holder reclaimed, the browsers per slot it exports
// (browsersPerSlot, STARDUST_BROWSERS_PER_SLOT) and the slots derived from STARDUST_BROWSER_BUDGET when unset
// (derivedBrowserSlots); the job's deadline exported as
// RUN_BG_DEADLINE_SEC, and a gate-all job without --timeout sized from gate-all's roster estimate (gateAllTimeout) — × 1
// with the lock off, × 4 at the default one browser per slot; whose jobs a bare wait/status covers — the caller's own
// (ownerPid: RUN_BG_OWNER, else callerOwner's ancestry walk), --all every owner's, a state without ownerPid only by name
// or --all — the report's first line naming the selection, and --timeout refused on wait/status (exit 125); servers
// (--kind server, implied by --no-lock unless --kind job): no slot (mayLaunch), out of a bare and an --all wait/status
// (pickNames), listed by status under servers:, a 3600 s deadline, and stop (<job>…, --servers [--all]: SIGTERM, SIGKILL
// after the grace, stopped + exit 143 recorded).
// Run: node plugins/stardust/skills/replica/scripts/test/run-bg.test.mjs   (about 55 s)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_SCRIPTS, DEFAULT_MAX_SEC, DEFAULT_SLOTS, MAX_CEILING_SEC, PAUSED_EXIT, STILL_RUNNING_EXIT, STOPPED_EXIT, VERDICT_RE, WAIT_NOTICE_SEC, browsersPerSlot, callerOwner, derivedBrowserSlots, gateAllTimeout, isBrowserJob, lockWaitS, mayLaunch, pickNames, procInfo, startKind, status, stop as stopJobs, wait } from '../run-bg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'run-bg.mjs');
const dir = mkdtempSync(join(tmpdir(), 'run-bg-test-'));
// The machine-wide browser lock (browser-lock.mjs) points at a temp dir — never the real ~/.stardust.
const lockRoot = mkdtempSync(join(tmpdir(), 'run-bg-lock-test-'));
const LOCKS = join(lockRoot, 'locks');
const env = { ...process.env, RUN_BG_POLL_MS: '100', STARDUST_BROWSER_LOCK_DIR: LOCKS, STARDUST_BROWSER_POLL_MS: '100' };
delete env.RUN_BG_SLOTS; delete env.STARDUST_BROWSER_SLOTS; delete env.STARDUST_BROWSER_SLOT; delete env.STARDUST_BROWSER_WAIT; delete env.STARDUST_BROWSER_TTL_MIN; delete env.RUN_BG_DEADLINE_SEC; delete env.STARDUST_BROWSER_BUDGET; delete env.STARDUST_BROWSERS_PER_SLOT; delete env.RUN_BG_SLOTS_DERIVED;
// No RUN_BG_OWNER: every job started here is owned by this process — run-bg's parent, the nearest non-shell ancestor.
delete env.RUN_BG_OWNER;
// No inherited pause file: a supervised session running these tests must not end their waits with exit 76.
delete env.STARDUST_PAUSE_FILE; delete process.env.STARDUST_PAUSE_FILE;
const run = (extra, sub, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, sub, '--dir', dir, ...args], { encoding: 'utf8', env: { ...env, ...extra } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const bg = (sub, ...args) => run({}, sub, ...args);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// A state file as the wrapper would leave it (owned by this process, like the jobs bg() starts), with the identity fields the caller sets.
const fakeState = (name, fields) => { const q = new Date(Date.now() - 60000).toISOString(); writeFileSync(join(dir, `${name}.json`), JSON.stringify({ name, ownerPid: process.pid, cmd: 'true', args: [], cwd: dir, timeoutSec: 0, slots: 1, queuedAt: q, wrapperPid: null, wrapperStart: null, launchedAt: q, childPid: null, childStart: null, endedAt: null, exit: null, timedOut: false, ...fields })); writeFileSync(join(dir, `${name}.log`), ''); };
const state = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const firstLine = (out) => out.split('\n')[0];
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
  for (const [args, flag] of [[['start', '--name'], '--name'], [['start', '--name', '--slots', '1', '--', 'true'], '--name'], [['wait', '--max', '--tail', '3'], '--max'], [['status', '--grep'], '--grep'], [['status', '--tail', '--all'], '--tail'], [['start', '--name', 'x', '--timeout', '--', 'true'], '--timeout'], [['status', '--dir'], '--dir'], [['wait', '--until', '--all'], '--until'], [['wait', '--until'], '--until'], [['start', '--name', 'x', '--kind', '--no-lock', '--', 'true'], '--kind']]) {
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
  assert.equal(firstLine(r.out), 'run-bg: wait — named: 4 job(s)', 'the first line names the selection and its count');
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
await check('--timeout is a start flag: on wait or status it is a usage error naming --max (exit 125, no report) — never silently ignored', () => {
  for (const args of [['wait', '--timeout', '30'], ['wait', 'a', '--timeout', '5'], ['status', '--timeout', '30'], ['wait', '--timeout']]) {
    const r = bg(...args);
    assert.equal(r.code, 125, `${args.join(' ')}: exit ${r.code}`); assert.equal(r.out, '', `${args.join(' ')}: no report`);
    assert.equal(firstLine(r.err), 'run-bg: --timeout is a start flag — wait takes --max <s> (default 300, at most 1500) or --until <ISO>; status reports at once', args.join(' '));
  }
});
const CLAMP_WHY = 'a supervised session asks its runner at least every 25 minutes, the pause file (STARDUST_PAUSE_FILE) ends a wait early, and the tool call must declare a timeout longer than the wait';
const NOTICE = (n) => `run-bg: --max ${n} — a wait over 600 s buys nothing; a one-hour cache does not need it (a 300 s step costs about three cents and sees an ended job up to 20 minutes sooner)`;
await check(`--max above ${WAIT_NOTICE_SEC} s prints one notice line; above ${MAX_CEILING_SEC} s the clamp line (says why) follows it; at or under ${WAIT_NOTICE_SEC} stderr stays empty`, () => {
  assert.equal(WAIT_NOTICE_SEC, 600);
  assert.equal(MAX_CEILING_SEC, 1500, 'a recorded single wait of 57 minutes is why a ceiling stays; 25 minutes is the runner\'s check-in interval');
  assert.equal(bg('start', '--name', 'z', '--', 'true').code, 0);
  const r = bg('wait', '--max', '9999', 'z');
  assert.equal(r.code, 0); assert.deepEqual(r.err.trim().split('\n'), [NOTICE(9999), `run-bg: --max 9999 clamped to 1500s — ${CLAMP_WHY}.`]);
  const r1501 = bg('wait', '--max', '1501', 'z'); const [n1501, c1501] = r1501.err.trim().split('\n');
  assert.equal(r1501.code, 0); assert.equal(n1501, NOTICE(1501)); assert.match(c1501, /^run-bg: --max 1501 clamped to 1500s — /);
  const r1500 = bg('wait', '--max', '1500', 'z');
  assert.equal(r1500.code, 0); assert.deepEqual(r1500.err.trim().split('\n'), [NOTICE(1500)], 'at the ceiling: the notice, no clamp');
  const r601 = bg('wait', '--max', '601', 'z');
  assert.equal(r601.code, 0); assert.deepEqual(r601.err.trim().split('\n'), [NOTICE(601)], 'just over 600: exactly one notice line');
  for (const max of ['600', '200', '111']) { const k = bg('wait', '--max', max, 'z'); assert.equal(k.code, 0); assert.equal(k.err, '', `--max ${max}: at or under 600 no line`); }
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
await check('with no names and nothing going, wait/status report the caller\'s latest batch — the earlier job folds into the first line; --all shows every job on disk', () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // an earlier session's finished job, this caller's
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ name: 'old', ownerPid: process.pid, cmd: 'true', args: [], cwd: dir, timeoutSec: 0, slots: 1, queuedAt: old, wrapperPid: null, launchedAt: old, endedAt: old, exit: 0, timedOut: false }));
  writeFileSync(join(dir, 'old.log'), 'differing pixels: 0 / 1 = 0.00%  (threshold 10%) → PASS\n');
  const jobs = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  const s = bg('status'); assert.equal(s.code, 0); assert.doesNotMatch(s.out, /^old {2}/m, s.out); assert.match(s.out, /^a {2}done exit=2/m);
  assert.equal(firstLine(s.out), `run-bg: status — yours (owner ${process.pid}), latest batch: ${jobs - 1} job(s); 1 other job(s) not shown — --all`, s.out);
  assert.doesNotMatch(s.out, /earlier job\(s\) not shown/, 'no trailing line: it folded into the first');
  const w = bg('wait'); assert.equal(w.code, 0); assert.doesNotMatch(w.out, /^old {2}/m, w.out); assert.equal(firstLine(w.out), `run-bg: wait — yours (owner ${process.pid}), latest batch: ${jobs - 1} job(s); 1 other job(s) not shown — --all`);
  const all = bg('status', '--all'); assert.match(all.out, /^old {2}done exit=0/m, all.out); assert.doesNotMatch(all.out, /not shown/); assert.equal(firstLine(all.out), `run-bg: status — all owners, on disk: ${jobs} job(s)`);
  const named = bg('status', 'old'); assert.match(named.out, /^old {2}done exit=0/m); assert.doesNotMatch(named.out, /not shown/); assert.equal(firstLine(named.out), 'run-bg: status — named: 1 job(s)');
});
await check('clean removes ended and lost jobs; wait on an empty dir says so', () => {
  const r = bg('clean');
  assert.equal(r.code, 0); assert.match(r.out, /removed a/); assert.match(r.out, /removed w/); assert.match(r.out, /removed z/); assert.match(r.out, /removed lost/); assert.match(r.out, /removed stale2/);
  assert.equal(readdirSync(dir).length, 0, readdirSync(dir).join(','));
  const w = bg('wait'); assert.equal(w.code, 0); assert.match(w.out, /no jobs in/); assert.equal(firstLine(w.out), `run-bg: wait — yours (owner ${process.pid}): 0 job(s)`);
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
await check('browsersPerSlot: max(1, floor(STARDUST_BROWSER_BUDGET / STARDUST_BROWSER_SLOTS)); a budget that is not a positive number and a slot count that is not a positive number (0 = lock off, junk) count as the default 3; a non-integer slot count rounds up — browser-lock keeps floor(S) holders, ceil(S) bounds the share so it never overshoots the budget', () => {
  assert.equal(browsersPerSlot({}), 1, 'defaults: 3 / 3');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '6', STARDUST_BROWSER_SLOTS: '2' }), 3);
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '2', STARDUST_BROWSER_SLOTS: '3' }), 1, 'a budget below the slots: the floor of one');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '7', STARDUST_BROWSER_SLOTS: '2' }), 3, 'floored');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '4.5', STARDUST_BROWSER_SLOTS: '2' }), 2);
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '10', STARDUST_BROWSER_SLOTS: '4.5' }), 2, '4.5 slots: 10 / ceil 5 (browser-lock keeps 4 holders — 8 ≤ 10)');
  assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: '1.5' }), 4, '1.5 slots: 9 / ceil 2 (browser-lock keeps 1 holder — 4 ≤ 9)');
  for (const s of [undefined, '0', '', ' ', 'x', '-2']) assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: '9', STARDUST_BROWSER_SLOTS: s }), 3, `slots ${JSON.stringify(s)}: 9 / 3`);
  for (const b of [undefined, '0', '', 'x', '-6']) assert.equal(browsersPerSlot({ STARDUST_BROWSER_BUDGET: b, STARDUST_BROWSER_SLOTS: '1' }), 3, `budget ${JSON.stringify(b)}: 3 / 1`);
});
await check('derivedBrowserSlots: STARDUST_BROWSER_SLOTS unset → from a positive budget: 3 for 3 or 6, below 2 max(1, floor), else 2; set (0 included) it wins, a budget unset or junk derives nothing', () => {
  for (const [b, s] of [['3', 3], ['4', 2], ['5', 2], ['6', 3], ['1', 1], ['1.5', 1], ['0.5', 1], ['2', 2], ['8', 2]]) assert.equal(derivedBrowserSlots({ STARDUST_BROWSER_BUDGET: b }), s, `budget ${b}`);
  for (const blank of ['', ' ']) assert.equal(derivedBrowserSlots({ STARDUST_BROWSER_BUDGET: '4', STARDUST_BROWSER_SLOTS: blank }), 2, `slots ${JSON.stringify(blank)} counts as unset`);
  for (const b of [undefined, '', 'x', '0', '-4']) assert.equal(derivedBrowserSlots({ STARDUST_BROWSER_BUDGET: b }), null, `budget ${JSON.stringify(b)}`);
  for (const s of ['4', '0', '3']) assert.equal(derivedBrowserSlots({ STARDUST_BROWSER_BUDGET: '4', STARDUST_BROWSER_SLOTS: s }), null, `explicit slots ${s} win`);
});
await check('a slot-holding job gets STARDUST_BROWSERS_PER_SLOT from the slot count before it is zeroed (derived from the budget when unset, one run-bg: line naming it; set, it wins); a budget below the slots says so in one run-bg: line', () => {
  const d = join(lockRoot, 'per-slot', 'bg');
  const jobs = [['ps62', { STARDUST_BROWSER_BUDGET: '6', STARDUST_BROWSER_SLOTS: '2' }, '3'], ['ps23', { STARDUST_BROWSER_BUDGET: '2', STARDUST_BROWSER_SLOTS: '3' }, '1'], ['psdef', {}, '1'],
    ['ps4', { STARDUST_BROWSER_BUDGET: '4' }, '2'], ['ps44', { STARDUST_BROWSER_BUDGET: '4', STARDUST_BROWSER_SLOTS: '4' }, '1']];
  for (const [name, x] of jobs) assert.equal(bgIn(d, x, 'start', '--name', name, '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
  const w = bgIn(d, {}, 'wait', '--max', '30', ...jobs.map(([n]) => n)); assert.equal(w.code, 0, w.out);
  for (const [name, , per] of jobs) {
    const st = stateIn(d, name); const log = logIn(d, name);
    assert.equal(st.exit, 0, `${name}: ${log}`); assert.ok(st.lockFile, `${name} took a slot`);
    assert.match(log, new RegExp(`^holders \\d+ perSlot=${per} slots=0 slot=\\S+$`, 'm'), `${name}: ${log}`);
  }
  assert.deepEqual(logIn(d, 'ps23').match(/^run-bg: STARDUST_BROWSER_BUDGET.*$/gm), ['run-bg: STARDUST_BROWSER_BUDGET 2 is below STARDUST_BROWSER_SLOTS 3 — one browser per slot, 3 at most; set STARDUST_BROWSER_SLOTS=2 to hold the budget']);
  assert.deepEqual(logIn(d, 'ps4').match(/^run-bg: STARDUST_BROWSER_.*$/gm), ['run-bg: STARDUST_BROWSER_SLOTS=2 derived from STARDUST_BROWSER_BUDGET 4 — 2 browsers per slot']);
  assert.equal(stateIn(d, 'ps4').slots, 2, 'the dir\'s --slots default follows the derived count');
  for (const name of ['ps62', 'psdef', 'ps44']) assert.doesNotMatch(logIn(d, name), /STARDUST_BROWSER_BUDGET/, name);
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
await check('--no-lock (a job: --kind job; alone it makes a server), an unclassified command and STARDUST_BROWSER_SLOTS=0 take no slot; a browser instrument asks for one without --lock', async () => {
  const holder = spawn('sleep', ['60']);
  try {
    assert.equal(lockCli({ STARDUST_BROWSER_SLOTS: '1' }, 'acquire', '--pid', String(holder.pid)).status, 0); // the only slot is held: asking for one ends 124
    const x = { STARDUST_BROWSER_SLOTS: '1', STARDUST_BROWSER_WAIT: '1' };
    const never = join(lockRoot, 'never');
    assert.equal(run(x, 'start', '--name', 'nl', '--no-lock', '--kind', 'job', '--', process.execPath, '-e', SLOT_JOB(0), 'stitch-shot.mjs').code, 0);
    const nls = run(x, 'start', '--name', 'nls', '--no-lock', '--', process.execPath, '-e', SLOT_JOB(0), 'stitch-shot.mjs'); // a server: never asks for the slot
    assert.equal(nls.code, 0, nls.err);
    assert.deepEqual(nls.out.split('\n').filter((l) => /^run-bg: nls: /.test(l)), ['run-bg: nls: --no-lock implies --kind server — no slot, out of a bare wait; --kind job keeps an instrument run a job', 'run-bg: nls: a server whose command names a browser instrument takes no browser slot and no bare wait waits for it — --kind job if it is an instrument run'], nls.out);
    assert.equal(run(x, 'start', '--name', 'plain', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
    assert.equal(run(x, 'start', '--name', 'auto', '--', process.execPath, '-e', SLOT_JOB(0), 'stitch-shot.mjs').code, 0);
    assert.equal(run({ STARDUST_BROWSER_SLOTS: '0', STARDUST_BROWSER_LOCK_DIR: never }, 'start', '--name', 'off', '--lock', '--', process.execPath, '-e', SLOT_JOB(0)).code, 0);
    assert.equal(bg('wait', '--max', '20', 'nl', 'nls', 'plain', 'auto', 'off').code, 0);
    assert.deepEqual([state('nl').kind, state('nls').kind], ['job', 'server']);
    for (const n of ['nl', 'nls', 'plain', 'off']) {
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
await check('start without --timeout on a gate-all.mjs job: deadline = the estimate (× 1 with the lock off, × 4 under the default slot env, × 2 with budget 4 and the slots derived), named on stdout, exported as RUN_BG_DEADLINE_SEC; an explicit --timeout and a non-gate-all job keep theirs; --timeout 0 leaves an inherited value alone', () => {
  const fake = join(lockRoot, 'fake'); mkdirSync(fake); // stand-ins that print the deadline they see
  for (const f of ['gate-all.mjs', 'stitch-shot.mjs']) writeFileSync(join(fake, f), "console.log('deadline='+process.env.RUN_BG_DEADLINE_SEC)");
  const d = join(proj, 'bg');
  const startIn = (extra, name, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, 'start', '--dir', d, '--name', name, '--no-lock', '--kind', 'job', ...args], { cwd: proj, encoding: 'utf8', env: { ...env, ...extra } }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const OFF = { STARDUST_BROWSER_SLOTS: '0' }; // the lock off: no slot, the default pools, × 1
  const ga = startIn(OFF, 'ga', '--', process.execPath, join(fake, 'gate-all.mjs'));
  assert.match(ga, /^run-bg: ga gates 40 page\(s\) × 1 width ≈ 1000 s \(gate-all estimate, 25 s per page per width\) — no --timeout given: deadline 1000 s instead of the 900 s default$/m, ga);
  const ga4 = startIn({}, 'ga4', '--', process.execPath, join(fake, 'gate-all.mjs')); // the default slot env: 1 browser per slot, × 4
  assert.match(ga4, /^run-bg: ga4 gates 40 page\(s\) × 1 width ≈ 4000 s \(gate-all estimate, 25 s per page per width\) — no --timeout given: deadline 4000 s instead of the 900 s default$/m, ga4);
  const ga2 = startIn({ STARDUST_BROWSER_BUDGET: '4' }, 'ga2', '--', process.execPath, join(fake, 'gate-all.mjs')); // slots derived: 2, 2 browsers per slot, × 2
  assert.match(ga2, /^run-bg: ga2 gates 40 page\(s\) × 1 width ≈ 2000 s /m, ga2);
  const given = startIn(OFF, 'given', '--timeout', '30', '--', process.execPath, join(fake, 'gate-all.mjs'));
  const shot = startIn(OFF, 'shot', '--', process.execPath, join(fake, 'stitch-shot.mjs'));
  const zero = startIn({ ...OFF, RUN_BG_DEADLINE_SEC: '77' }, 'zero', '--timeout', '0', '--', process.execPath, join(fake, 'gate-all.mjs'));
  for (const out of [given, shot, zero]) assert.doesNotMatch(out, /gates|estimate/, out);
  const w = bgIn(d, {}, 'wait', '--max', '20', 'ga', 'ga4', 'ga2', 'given', 'shot', 'zero'); assert.equal(w.code, 0, w.out);
  for (const [name, timeoutSec, seen] of [['ga', 1000, '1000'], ['ga4', 4000, '4000'], ['ga2', 2000, '2000'], ['given', 30, '30'], ['shot', 900, '900'], ['zero', 0, '77']]) {
    assert.equal(stateIn(d, name).timeoutSec, timeoutSec, name); assert.equal(stateIn(d, name).exit, 0, name);
    assert.match(logIn(d, name), new RegExp(`^deadline=${seen}$`, 'm'), `${name}: ${logIn(d, name)}`);
  }
});

// ---- whose jobs a bare wait/status covers: the caller's own (ownerPid) ------------------------------------------
await check('callerOwner: RUN_BG_OWNER as given, else the nearest ancestor that is not a shell or wrapper — the agent behind the shell, whether or not the shell exec\'d node; the parent pid when no process table answers', () => {
  const table = new Map([
    [100, { ppid: 1, command: 'node /opt/agent/cli.js --session x' }], // the agent
    [200, { ppid: 100, command: '/bin/bash -c node run-bg.mjs wait' }], // the tool call's shell
    [210, { ppid: 100, command: '-zsh' }], // a login shell
    [300, { ppid: 210, command: 'timeout 120 node run-bg.mjs wait' }],
    [310, { ppid: 200, command: '/usr/bin/env node run-bg.mjs wait' }],
    [500, { ppid: 100, command: 'python3 runner.py' }], // a non-shell between the agent and the shell: the nearest wins
    [510, { ppid: 500, command: 'sh -c node run-bg.mjs wait' }],
  ]);
  const info = (pid) => table.get(pid) ?? null;
  assert.equal(callerOwner({}, { ppid: 200, info }), 100, 'shell → agent');
  assert.equal(callerOwner({}, { ppid: 100, info }), 100, 'the shell exec\'d node: run-bg\'s parent is the agent');
  assert.equal(callerOwner({}, { ppid: 300, info }), 100, 'timeout → login shell (-zsh) → agent');
  assert.equal(callerOwner({}, { ppid: 310, info }), 100, 'env → shell → agent');
  assert.equal(callerOwner({}, { ppid: 510, info }), 500, 'the nearest non-shell ancestor, not the root');
  assert.equal(callerOwner({}, { ppid: 200, info: () => null }), 200, 'no ps (and no /proc) → the parent pid');
  assert.equal(callerOwner({ RUN_BG_OWNER: 'agent-a' }, { ppid: 200, info }), 'agent-a');
  assert.equal(callerOwner({ RUN_BG_OWNER: '4242' }, { ppid: 200, info }), '4242', 'stored as given — a string');
  assert.equal(callerOwner({ RUN_BG_OWNER: '' }, { ppid: 200, info }), 100, 'empty = unset');
});
await check('start records ownerPid: RUN_BG_OWNER as given, else this test process — run-bg\'s caller, directly and through sh -c alike', () => {
  const d = join(lockRoot, 'owner-id', 'bg');
  assert.equal(bgIn(d, {}, 'start', '--name', 'direct', '--', 'true').code, 0);
  const sh = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${SCRIPT}" start --dir "${d}" --name viash -- true; :`], { encoding: 'utf8', env }); // `; :` keeps the shell from exec'ing node
  assert.equal(sh.status, 0, sh.stderr);
  assert.equal(bgIn(d, { RUN_BG_OWNER: 'agent-a' }, 'start', '--name', 'given', '--', 'true').code, 0);
  assert.equal(stateIn(d, 'direct').ownerPid, process.pid); assert.equal(stateIn(d, 'viash').ownerPid, process.pid, 'the shell is skipped'); assert.equal(stateIn(d, 'given').ownerPid, 'agent-a');
  assert.equal(bgIn(d, {}, 'wait', '--all', '--max', '20').code, 0);
});
await check('two owners in one dir: a bare wait/status covers the caller\'s own jobs only — it returns without blocking on the other\'s; --all selects both; a state without ownerPid only by name or --all; the first line names the selection and the count', () => {
  const d = join(lockRoot, 'owners', 'bg'); mkdirSync(d, { recursive: true });
  const A = { RUN_BG_OWNER: 'agent-a' }; const B = { RUN_BG_OWNER: 'agent-b' }; const C = { RUN_BG_OWNER: 'agent-c' };
  const ended = (name, fields, ago) => { const t = new Date(Date.now() - ago).toISOString(); writeFileSync(join(d, `${name}.json`), JSON.stringify({ name, cmd: 'true', args: [], cwd: d, timeoutSec: 0, slots: 1, queuedAt: t, wrapperPid: null, launchedAt: t, endedAt: t, exit: 0, timedOut: false, ...fields })); writeFileSync(join(d, `${name}.log`), 'differing pixels: 0 / 1 = 0.00%  (threshold 10%) → PASS\n'); };
  ended('legacy', {}, 120000); // an older run's state: no ownerPid — nobody's
  ended('a0', { ownerPid: 'agent-a' }, 3 * 3600 * 1000); // agent-a's earlier session: outside its latest batch
  // agent-a's jobs outlast the starts and the wait's own startup on a loaded host; agent-b's outlasts agent-a's wait
  for (const n of ['a1', 'a2']) assert.equal(bgIn(d, A, 'start', '--name', n, '--', process.execPath, '-e', 'setTimeout(()=>{},2500)').code, 0);
  assert.equal(bgIn(d, B, 'start', '--name', 'b1', '--', process.execPath, '-e', 'setTimeout(()=>{},7000)').code, 0);
  const wa = bgIn(d, A, 'wait', '--max', '20'); const back = Date.now();
  assert.equal(wa.code, 0, wa.out);
  assert.equal(firstLine(wa.out), 'run-bg: wait — yours (owner agent-a), unfinished: 2 job(s); 1 other job(s) not shown — --all', wa.out);
  assert.match(wa.out, /^a1 {2}done exit=0/m); assert.match(wa.out, /^a2 {2}done exit=0/m); assert.doesNotMatch(wa.out, /^(?:b1|legacy|a0) {2}/m); assert.match(wa.out, /run-bg: all 2 ended/);
  const sa = bgIn(d, A, 'status');
  assert.equal(firstLine(sa.out), 'run-bg: status — yours (owner agent-a), latest batch: 2 job(s); 1 other job(s) not shown — --all', sa.out);
  const sb = bgIn(d, B, 'status');
  assert.equal(firstLine(sb.out), 'run-bg: status — yours (owner agent-b), unfinished: 1 job(s)', sb.out); assert.match(sb.out, /^b1 {2}(?:queued|running)/m); assert.doesNotMatch(sb.out, /^(?:a\d|legacy) {2}/m);
  const sAll = bgIn(d, A, 'status', '--all');
  assert.equal(firstLine(sAll.out), 'run-bg: status — all owners, unfinished: 1 job(s)', sAll.out); assert.match(sAll.out, /^b1 {2}/m);
  const wb = bgIn(d, B, 'wait', '--max', '20');
  assert.equal(wb.code, 0, wb.out); assert.equal(firstLine(wb.out), 'run-bg: wait — yours (owner agent-b), unfinished: 1 job(s)', wb.out); assert.match(wb.out, /^b1 {2}done exit=0/m);
  assert.ok(Date.parse(stateIn(d, 'b1').endedAt) > back, 'agent-a\'s wait returned while agent-b\'s job still ran');
  const all = bgIn(d, C, 'status', '--all');
  assert.equal(firstLine(all.out), 'run-bg: status — all owners, on disk: 5 job(s)', all.out);
  for (const n of ['a0', 'a1', 'a2', 'b1', 'legacy']) assert.match(all.out, new RegExp(`^${n} {2}done exit=0`, 'm'), n);
  assert.equal(firstLine(bgIn(d, A, 'status').out), 'run-bg: status — yours (owner agent-a), latest batch: 2 job(s); 3 other job(s) not shown — --all');
  const wc = bgIn(d, C, 'wait', '--max', '20');
  assert.equal(wc.code, 0, wc.out); assert.equal(firstLine(wc.out), 'run-bg: wait — yours (owner agent-c): 0 job(s); 5 other job(s) not shown — --all', wc.out);
  assert.match(wc.out, /^run-bg: no jobs of yours in /m); assert.doesNotMatch(wc.out, /^legacy {2}/m);
  const named = bgIn(d, C, 'status', 'legacy');
  assert.equal(firstLine(named.out), 'run-bg: status — named: 1 job(s)'); assert.match(named.out, /^legacy {2}done exit=0/m);
});

// ---- the pause file ($STARDUST_PAUSE_FILE) and --until ------------------------------------------------------------
// The runner that supervises a hands-off run writes the pause file when it wants the session to stop: a wait ends on it
// at once (exit 76), status shows it, and no job is signalled. p1 runs through the whole section and ends on its own.
const pd = join(lockRoot, 'pz', 'bg'); mkdirSync(pd, { recursive: true });
const PAUSE = join(lockRoot, 'pz', 'pause.json');
const pauseLine = (path, reason, at) => `run-bg: paused — ${path} present (reason: ${reason}, at ${at}) — jobs keep running; finish the iteration, record it and return`;
const bgAsync = (d, extra, sub, ...args) => new Promise((res) => { const c = spawn(process.execPath, [SCRIPT, sub, '--dir', d, ...args], { env: { ...env, ...extra } }); let out = ''; let err = ''; c.stdout.on('data', (b) => { out += b; }); c.stderr.on('data', (b) => { err += b; }); c.on('close', (code) => res({ code, out, err, at: Date.now() })); });

await check(`wait exits ${PAUSED_EXIT} at once when the pause file is present — the pause line, then the one-pass report without "wait again"; the job is not signalled`, async () => {
  assert.equal(PAUSED_EXIT, 76);
  assert.equal(bgIn(pd, {}, 'start', '--name', 'p1', '--slots', '9', '--', process.execPath, '-e', 'setTimeout(()=>{},12000)').code, 0);
  for (let i = 0; i < 50 && !stateIn(pd, 'p1').wrapperPid; i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  writeFileSync(PAUSE, JSON.stringify({ at: '2026-10-18T09:00:00Z', reason: 'push-stop' }));
  const t0 = Date.now(); const r = bgIn(pd, { STARDUST_PAUSE_FILE: PAUSE }, 'wait', '--max', '30', 'p1');
  assert.equal(r.code, PAUSED_EXIT, r.out); assert.ok(Date.now() - t0 < 3000, `returned at once (${Date.now() - t0} ms)`);
  const lines = r.out.trim().split('\n');
  assert.equal(lines[0], pauseLine(PAUSE, 'push-stop', '2026-10-18T09:00:00Z'));
  assert.equal(lines[1], 'run-bg: wait — named: 1 job(s)'); assert.match(lines[2], /^p1 {2}(?:queued|running)/);
  assert.match(lines.at(-1), /^run-bg: 0\/1 ended, 1 still going — paused: /); assert.doesNotMatch(r.out, /run `wait` again/);
  const st = stateIn(pd, 'p1'); assert.equal(st.endedAt, null, 'the job keeps running'); assert.ok(pidAlive(st.wrapperPid), 'its wrapper was not signalled');
  const inproc = await wait(pd, ['p1'], { maxSec: 30, pauseFile: PAUSE }); // the export takes the pause file as an option
  assert.equal(inproc.paused, true); assert.equal(inproc.text.split('\n')[0], pauseLine(PAUSE, 'push-stop', '2026-10-18T09:00:00Z'));
  rmSync(PAUSE);
});
await check('a pause file that appears mid-wait ends the wait within one poll interval; a file that is not JSON still counts (reason unreadable)', async () => {
  rmSync(PAUSE, { force: true });
  const waiting = bgAsync(pd, { STARDUST_PAUSE_FILE: PAUSE }, 'wait', '--max', '30', 'p1');
  await sleep(1000);
  writeFileSync(PAUSE, 'stop'); const wrote = Date.now();
  const r = await waiting;
  assert.equal(r.code, PAUSED_EXIT, r.out + r.err); assert.ok(r.at - wrote < 1500, `ended ${r.at - wrote} ms after the pause file appeared`);
  assert.equal(firstLine(r.out), pauseLine(PAUSE, 'unreadable', 'unknown'));
  assert.equal(stateIn(pd, 'p1').endedAt, null, 'the job keeps running');
  rmSync(PAUSE);
});
await check('STARDUST_PAUSE_FILE: a relative path is read from the cwd (the project root); unset, empty or a missing file = no pause', () => {
  writeFileSync(join(lockRoot, 'pz', 'rel-pause.json'), JSON.stringify({ at: '2026-10-18T09:05:00Z', reason: 'push-stop' }));
  const inCwd = (cwd, extra, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const rel = { STARDUST_PAUSE_FILE: 'rel-pause.json' };
  const w = inCwd(join(lockRoot, 'pz'), rel, 'wait', '--dir', pd, '--max', '30', 'p1');
  assert.equal(w.code, PAUSED_EXIT, w.out); assert.equal(firstLine(w.out), pauseLine('rel-pause.json', 'push-stop', '2026-10-18T09:05:00Z'));
  const elsewhere = inCwd(lockRoot, rel, 'wait', '--dir', pd, '--max', '0', 'p1');
  assert.equal(elsewhere.code, STILL_RUNNING_EXIT, elsewhere.out); assert.doesNotMatch(elsewhere.out, /paused/, 'not in this cwd: no pause');
  for (const extra of [{}, { STARDUST_PAUSE_FILE: '' }, { STARDUST_PAUSE_FILE: join(lockRoot, 'pz', 'absent.json') }]) {
    const k = bgIn(pd, extra, 'wait', '--max', '0', 'p1'); assert.equal(k.code, STILL_RUNNING_EXIT, JSON.stringify(extra)); assert.doesNotMatch(k.out, /paused/, JSON.stringify(extra));
  }
  rmSync(join(lockRoot, 'pz', 'rel-pause.json'));
});
await check('status shows the pause line first when the pause file is present (exit 0, the report below it unchanged); set but missing adds nothing', () => {
  writeFileSync(PAUSE, JSON.stringify({ at: '2026-10-18T09:10:00Z', reason: 'push-stop' }));
  const s = bgIn(pd, { STARDUST_PAUSE_FILE: PAUSE }, 'status', 'p1');
  assert.equal(s.code, 0, s.out); const lines = s.out.trim().split('\n');
  assert.equal(lines[0], pauseLine(PAUSE, 'push-stop', '2026-10-18T09:10:00Z')); assert.equal(lines[1], 'run-bg: status — named: 1 job(s)'); assert.match(lines[2], /^p1 {2}running/);
  rmSync(PAUSE);
  const a = bgIn(pd, { STARDUST_PAUSE_FILE: PAUSE }, 'status', 'p1');
  assert.equal(a.code, 0); assert.equal(firstLine(a.out), 'run-bg: status — named: 1 job(s)'); assert.doesNotMatch(a.out, /paused/);
});
await check('--until <ISO> (offset or Z) bounds a wait like --max: a past instant = one pass, a near one returns then, a far one is clamped and says why', () => {
  const past = bgIn(pd, {}, 'wait', '--until', '2020-01-01T00:00:00+02:00', 'p1');
  assert.equal(past.code, STILL_RUNNING_EXIT, past.out); assert.match(past.out, /still going after 0s \(ceiling 0s\)/); assert.equal(past.err, '');
  const t0 = Date.now(); const near = bgIn(pd, {}, 'wait', '--until', new Date(t0 + 1500).toISOString(), 'p1'); const took = Date.now() - t0;
  assert.equal(near.code, STILL_RUNNING_EXIT, near.out); assert.ok(took >= 1400 && took < 4000, `returned after ${took} ms`); assert.equal(near.err, '');
  assert.equal(bgIn(pd, {}, 'start', '--name', 'p2', '--', 'true').code, 0); assert.equal(bgIn(pd, {}, 'wait', '--max', '10', 'p2').code, 0);
  const far = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const r = bgIn(pd, {}, 'wait', '--until', far, 'p2');
  assert.equal(r.code, 0, r.out); assert.equal(r.err.trim(), `run-bg: --until ${far} clamped to 1500s from now — ${CLAMP_WHY}.`);
});
await check('--until that is not an ISO-8601 instant with an offset or Z, --until with --max, and --until on status/start are usage errors (exit 125, no report, no job)', () => {
  for (const v of ['tomorrow', '2026-10-18T12:00:00', '2026-13-40T12:00:00Z', '1792324800']) {
    const r = bgIn(pd, {}, 'wait', '--until', v, 'p1');
    assert.equal(r.code, 125, v); assert.equal(r.out, '', v); assert.equal(firstLine(r.err), `run-bg: --until needs an ISO-8601 instant with an offset or Z, e.g. 2026-10-18T12:25:00Z (got ${v})`);
  }
  const iso = new Date(Date.now() + 60000).toISOString();
  for (const args of [['--max', '5', '--until', iso], ['--until', iso, '--max', '5']]) {
    const r = bgIn(pd, {}, 'wait', ...args, 'p1');
    assert.equal(r.code, 125, args.join(' ')); assert.equal(r.out, ''); assert.equal(firstLine(r.err), 'run-bg: --max and --until are alternatives — give one');
  }
  for (const args of [['status', '--until', iso], ['start', '--name', 'ux', '--until', iso, '--', 'true']]) {
    const r = bgIn(pd, {}, ...args);
    assert.equal(r.code, 125, args.join(' ')); assert.equal(r.out, ''); assert.equal(firstLine(r.err), 'run-bg: --until is a wait flag — status reports at once; start takes --timeout <s>');
  }
  assert.equal(existsSync(join(pd, 'ux.json')), false, 'no job was created by the rejected start');
});
await check('--help: wait\'s default --max 300 or --until, the five-minute rule, the tool-call timeout to declare, and exit 76 for the pause file', () => {
  assert.equal(DEFAULT_MAX_SEC, 300, 'recorded leads polled with 9–23 minute waits while ended units sat unseen: five minutes, lead and subagents alike');
  const h = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', env });
  assert.equal(h.status, 0); assert.match(h.stdout, /wait +\[--max <s>=300 \| --until <ISO>\]/);
  assert.ok(h.stdout.includes('wait in steps of at most five minutes, lead and subagents alike — `run-bg.mjs wait` for jobs, `progress.mjs wait` for units; a `sleep` is never a wait'), 'the rule, verbatim');
  assert.match(h.stdout, /timeout longer than the wait/);
  assert.match(h.stdout, /76 \(wait\) the pause file is present — stop waiting, finish the iteration and return/);
});
await check('the paused-on job ends on its own, unsignalled (exit 0)', () => {
  const w = bgIn(pd, {}, 'wait', '--max', '30', 'p1'); assert.equal(w.code, 0, w.out); assert.match(w.out, /^p1 {2}done exit=0/m);
});

// ---- servers (--kind server; --no-lock implies it) and stop ------------------------------------------------------
// In recorded hands-off runs a 26-second measure queued 615 s behind a static file server, and a bare wait blocked 600 s
// on the unit's own servers: a server holds no slot, a bare or --all wait leaves it out, status lists it under servers:.
await check('startKind: --kind as given wins; without it --no-lock (lock off) makes a server, anything else a job', () => {
  assert.deepEqual([startKind(undefined, 'auto'), startKind(undefined, 'on'), startKind(undefined, 'off'), startKind('job', 'off'), startKind('server', 'auto')], ['job', 'job', 'server', 'job', 'server']);
});
await check('mayLaunch: a running server holds no slot and a queued one is never ahead; a server never waits; jobs keep FIFO on their slots', () => {
  const t = (s) => new Date(Date.UTC(2026, 9, 18, 10, 0, s)).toISOString();
  const ph = (j) => j.ph;
  const me = { name: 'm', slots: 1, queuedAt: t(10) }; // no kind: an older state, a job
  const web = { name: 'web', kind: 'server', queuedAt: t(0), ph: 'running' }; const web2 = { name: 'web2', kind: 'server', queuedAt: t(1), ph: 'queued' };
  const running = { name: 'j1', kind: 'job', queuedAt: t(2), ph: 'running' }; const earlier = { name: 'j0', kind: 'job', queuedAt: t(5), ph: 'queued' };
  assert.equal(mayLaunch(me, [me, web, web2], ph), true, 'one slot, a running and an earlier queued server: the job launches');
  assert.equal(mayLaunch(me, [me, web, running], ph), false, 'a running job holds the one slot');
  assert.equal(mayLaunch({ ...me, slots: 2 }, [me, web, running], ph), true, 'two slots: the server is not the second job');
  assert.equal(mayLaunch(me, [me, earlier], ph), false, 'FIFO: a job queued earlier goes first');
  assert.equal(mayLaunch({ name: 'web3', kind: 'server', slots: 1, queuedAt: t(20) }, [running, earlier], ph), true, 'a server never waits for a slot');
});
await check('pickNames: bare and --all leave servers out (their queued or running count is skipped), a named server is selected; status lists the scope\'s servers by name after the jobs under servers:', async () => {
  const d = join(lockRoot, 'pick', 'bg'); mkdirSync(d, { recursive: true });
  // "Running" without a process: this test process's own identity stands in for a wrapper. Never stop or clean this dir.
  const me = { wrapperPid: process.pid, wrapperStart: procInfo(process.pid, { fresh: true }).start };
  const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
  const put = (name, fields) => { writeFileSync(join(d, `${name}.json`), JSON.stringify({ name, kind: 'job', ownerPid: 'agent-a', cmd: 'node', args: ['serve.mjs'], cwd: d, timeoutSec: 3600, slots: 3, lock: 'off', queuedAt: ago(120), wrapperPid: null, wrapperStart: null, launchedAt: ago(110), childPid: null, childStart: null, endedAt: null, exit: null, timedOut: false, ...fields })); writeFileSync(join(d, `${name}.log`), ''); };
  put('gate', { ...me, timeoutSec: 900 });
  put('web', { ...me, kind: 'server', childPid: 4242 });
  put('proto', { kind: 'server', endedAt: ago(60), exit: STOPPED_EXIT, stopped: true, stoppedAt: ago(60) });
  put('older', { kind: 'server', queuedAt: ago(7300), launchedAt: ago(7300), endedAt: ago(7200), exit: 0 }); // ended long ago: listed by name only
  put('theirs', { ...me, kind: 'server', ownerPid: 'agent-b' });
  const bare = pickNames(d, [], { owner: 'agent-a' });
  assert.deepEqual([bare.names, bare.servers, bare.skipped], [['gate'], ['proto', 'web'], 1]);
  const all = pickNames(d, [], { all: true, owner: 'agent-a' });
  assert.deepEqual([all.names, all.servers, all.skipped], [['gate'], ['proto', 'theirs', 'web'], 2]);
  assert.deepEqual(pickNames(d, ['web'], { owner: 'agent-a' }).names, ['web'], 'named: a server is selected');
  const s = status(d, [], { owner: 'agent-a', pauseFile: '' }).text.split('\n');
  assert.equal(s[0], 'run-bg: status — yours (owner agent-a), unfinished: 1 job(s)');
  assert.deepEqual(s.slice(-3).map((l) => l.replace(/\d+s/g, 'Ns')), ['servers: 2 of yours — not waited for; `stop <name>` or `stop --servers` ends them', '  proto  stopped exit=143  ran Ns  deadline Ns  — node serve.mjs', '  web  running pid 4242  age Ns  deadline Ns  — node serve.mjs']);
  assert.ok(s.indexOf('servers: 2 of yours — not waited for; `stop <name>` or `stop --servers` ends them') > s.findIndex((l) => /^run-bg: 0\/1 ended/.test(l)), 'after the jobs');
  assert.match(status(d, [], { all: true, owner: 'agent-a', pauseFile: '' }).text, /^servers: 3 of all owners — not waited for; `stop <name>` or `stop --servers --all` ends them$/m);
  const w = await wait(d, [], { maxSec: 0, owner: 'agent-a', pauseFile: '' });
  assert.equal(w.text.split('\n')[0], 'run-bg: wait — yours (owner agent-a), unfinished: 1 job(s); 1 server(s) not waited for — status lists them'); assert.doesNotMatch(w.text, /^servers:/m);
  const named = status(d, ['web'], { owner: 'agent-a', pauseFile: '' }).text;
  assert.match(named, /^web {2}server running \d+s \(ends at `stop web` or its 3600s deadline\)$/m); assert.doesNotMatch(named, /^servers:/m);
  rmSync(join(lockRoot, 'pick'), { recursive: true, force: true });
});
await check('start --kind: --no-lock alone makes a server (one line says so; deadline 3600 s, lock off), --no-lock --kind job a job (900 s), an explicit --timeout wins; --kind server --lock, a bad --kind, --kind off start and --servers off stop are usage errors (exit 125)', () => {
  const d = join(lockRoot, 'kinds', 'bg');
  const nl = bgIn(d, {}, 'start', '--name', 'nl', '--no-lock', '--', 'true');
  assert.equal(nl.code, 0, nl.err); assert.match(nl.out, /^run-bg: nl: --no-lock implies --kind server/m); assert.match(nl.out, /^run-bg: started server nl → .*nl\.log {3}\(not waited for: `status` lists it under servers:, `stop nl` ends it, else its 3600 s deadline\)$/m);
  const nj = bgIn(d, {}, 'start', '--name', 'nj', '--no-lock', '--kind', 'job', '--', 'true');
  assert.equal(nj.code, 0, nj.err); assert.doesNotMatch(nj.out, /server/); assert.match(nj.out, /^run-bg: queued nj → /m);
  const ks = bgIn(d, {}, 'start', '--name', 'ks', '--kind', 'server', '--timeout', '60', '--', 'true');
  assert.equal(ks.code, 0, ks.err); assert.doesNotMatch(ks.out, /implies/, 'an explicit --kind: no implication line');
  assert.deepEqual(['nl', 'nj', 'ks'].map((n) => { const st = stateIn(d, n); return [st.kind, st.lock, st.timeoutSec]; }), [['server', 'off', 3600], ['job', 'off', 900], ['server', 'off', 60]]);
  for (const [args, msg] of [[['start', '--name', 'kl', '--kind', 'server', '--lock', '--', 'true'], 'run-bg: a server takes no browser slot — --lock is for a job (--kind job)'], [['start', '--name', 'kb', '--kind', 'daemon', '--', 'true'], 'run-bg: --kind must be job or server (got daemon)'],
    [['wait', '--kind', 'server'], 'run-bg: --kind is a start flag — status lists servers under servers:, stop --servers ends them'], [['status', '--servers'], 'run-bg: --servers is a stop flag — status lists servers under servers:'],
    [['stop'], 'run-bg: stop needs <job>… or --servers'], [['stop', '--all'], 'run-bg: stop --all needs --servers (every owner\'s servers) — jobs are stopped by name'], [['stop', 'nl', '--servers'], 'run-bg: stop takes <job>… or --servers, not both']]) {
    const r = bgIn(d, {}, ...args); assert.equal(r.code, 125, args.join(' ')); assert.equal(r.out, '', args.join(' ')); assert.equal(firstLine(r.err), msg, args.join(' '));
  }
  assert.equal(existsSync(join(d, 'kl.json')) || existsSync(join(d, 'kb.json')), false, 'no job was created by a rejected start');
  assert.equal(bgIn(d, {}, 'wait', '--max', '10', 'nl', 'nj', 'ks').code, 0);
});
const sd = join(lockRoot, 'srv', 'bg');
const SERVE = 'setInterval(()=>{},1000)';
const launched = async (d, name) => { for (let i = 0; i < 50 && !stateIn(d, name).childPid; i += 1) await sleep(100); return stateIn(d, name); }; // eslint-disable-line no-await-in-loop
await check('a running server holds no slot: a --slots 1 job launches beside it and a bare wait returns without it (its first line counts it); status lists it under servers:; wait <server> waits for it; clean keeps it', async () => {
  assert.equal(bgIn(sd, {}, 'start', '--name', 'web', '--kind', 'server', '--', process.execPath, '-e', SERVE).code, 0);
  const { childPid } = await launched(sd, 'web'); assert.ok(childPid, 'the server runs');
  assert.equal(bgIn(sd, {}, 'start', '--name', 'j1', '--slots', '1', '--', process.execPath, '-e', PASS_JOB).code, 0);
  const w = bgIn(sd, {}, 'wait', '--max', '15');
  assert.equal(w.code, 0, w.out);
  assert.equal(firstLine(w.out), `run-bg: wait — yours (owner ${process.pid}), unfinished: 1 job(s); 1 server(s) not waited for — status lists them`);
  assert.match(w.out, /^j1 {2}done exit=0/m); assert.doesNotMatch(w.out, /^ *web /m);
  const s = bgIn(sd, {}, 'status').out.split('\n');
  assert.equal(s[0], `run-bg: status — yours (owner ${process.pid}), latest batch: 1 job(s)`);
  const head = s.indexOf('servers: 1 of yours — not waited for; `stop <name>` or `stop --servers` ends them');
  assert.ok(head > s.findIndex((l) => /^run-bg: all 1 ended/.test(l)), s.join('\n'));
  assert.match(s[head + 1], new RegExp(`^ {2}web {2}running pid ${childPid} {2}age \\d+s {2}deadline 3600s {2}— .+ -e setInterval\\(\\(\\)=>\\{\\},1000\\)$`), s[head + 1]);
  const named = bgIn(sd, {}, 'wait', '--max', '1', 'web');
  assert.equal(named.code, STILL_RUNNING_EXIT, named.out); assert.match(named.out, /^web {2}server running \d+s \(ends at `stop web` or its 3600s deadline\)$/m);
  const c = bgIn(sd, {}, 'clean');
  assert.match(c.out, /^run-bg: keeping web \(server, running\) — `stop web` or `clean --all` stops it$/m, c.out); assert.ok(existsSync(join(sd, 'web.json')) && pidAlive(childPid));
});
await check('stop <server>: its process group ends, the state records stopped (exit 143), status shows it stopped; again = not running (exit 0); an unknown name = exit 2', async () => {
  const { wrapperPid, childPid } = stateIn(sd, 'web');
  const t0 = Date.now(); const r = bgIn(sd, {}, 'stop', 'web');
  assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /^run-bg: stopped web \(server, ran \d+s; exit 143 recorded\)\n$/); assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  assert.equal(pidAlive(childPid), false, 'the server is gone'); assert.equal(pidAlive(wrapperPid), false, 'its wrapper is gone');
  const st = stateIn(sd, 'web'); assert.deepEqual([st.stopped, st.exit, Boolean(st.endedAt), Boolean(st.stoppedAt)], [true, STOPPED_EXIT, true, true]);
  assert.match(bgIn(sd, {}, 'status').out, /^ {2}web {2}stopped exit=143 {2}ran \d+s {2}deadline 3600s {2}— /m);
  assert.match(bgIn(sd, {}, 'status', 'web').out, /^web {2}stopped after \d+s \(exit 143: no verdict\)$/m);
  assert.match(logIn(sd, 'web'), /^run-bg: web stopped \S+ \(exit 143\)$/m);
  const again = bgIn(sd, {}, 'stop', 'web');
  assert.equal(again.code, 0); assert.match(again.out, /^run-bg: web is not running — stopped after \d+s \(exit 143: no verdict\); nothing to stop$/m);
  const unknown = bgIn(sd, {}, 'stop', 'nope'); assert.equal(unknown.code, 2); assert.match(unknown.err, /^run-bg: no such job in .*: nope — nothing stopped$/m);
});
await check('stop --servers stops the caller\'s own running servers, --servers --all every owner\'s; a name list with an unknown name signals nothing; stop <job> works on a job (exit 143, no verdict)', async () => {
  const OTHER = { RUN_BG_OWNER: 'agent-b' };
  assert.equal(bgIn(sd, {}, 'start', '--name', 'a1', '--no-lock', '--', process.execPath, '-e', SERVE).code, 0);
  assert.equal(bgIn(sd, OTHER, 'start', '--name', 'b1', '--kind', 'server', '--', process.execPath, '-e', SERVE).code, 0);
  assert.equal(bgIn(sd, {}, 'start', '--name', 'long', '--timeout', '0', '--', process.execPath, '-e', SERVE).code, 0);
  const [a1, b1, long] = [await launched(sd, 'a1'), await launched(sd, 'b1'), await launched(sd, 'long')];
  assert.equal(bgIn(sd, {}, 'stop', 'a1', 'nope').code, 2); assert.ok(pidAlive(a1.childPid), 'nothing signalled');
  const mine = bgIn(sd, {}, 'stop', '--servers');
  assert.equal(mine.code, 0, mine.out); assert.match(mine.out, /^run-bg: stopped a1 \(server, ran \d+s; exit 143 recorded\)\n$/);
  assert.equal(pidAlive(a1.childPid), false); assert.ok(pidAlive(b1.childPid), 'another owner\'s server keeps running'); assert.ok(pidAlive(long.childPid), 'a job is not a server');
  const every = bgIn(sd, {}, 'stop', '--servers', '--all');
  assert.equal(every.code, 0, every.out); assert.match(every.out, /^run-bg: stopped b1 \(server, ran \d+s; exit 143 recorded\)\n$/); assert.equal(pidAlive(b1.childPid), false);
  assert.equal(bgIn(sd, {}, 'stop', '--servers').out, `run-bg: stop — no running servers of yours in ${sd}\n`);
  const j = bgIn(sd, {}, 'stop', 'long');
  assert.equal(j.code, 0); assert.match(j.out, /^run-bg: stopped long \(job, ran \d+s; exit 143 recorded\)$/m); assert.equal(pidAlive(long.childPid), false);
  assert.match(bgIn(sd, {}, 'status', 'long').out, /^long {2}stopped after \d+s \(exit 143: no verdict\)$/m);
});
await check('stop escalates: a server that ignores SIGTERM gets SIGKILL after the grace (stop(…, { graceMs })), and the end is recorded though its wrapper wrote none', async () => {
  assert.equal(bgIn(sd, {}, 'start', '--name', 'stubborn', '--kind', 'server', '--', process.execPath, '-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)").code, 0);
  for (let i = 0; i < 50 && !/^ready$/m.test(logIn(sd, 'stubborn')); i += 1) await sleep(100); // eslint-disable-line no-await-in-loop
  const { wrapperPid, childPid } = stateIn(sd, 'stubborn');
  const t0 = Date.now(); const r = await stopJobs(sd, ['stubborn'], { graceMs: 300 });
  assert.equal(r.code, 0, r.text); assert.match(r.text, /^run-bg: stopped stubborn \(server, ran \d+s; exit 143 recorded\)$/); assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.equal(pidAlive(childPid), false); assert.equal(pidAlive(wrapperPid), false);
  assert.doesNotMatch(logIn(sd, 'stubborn'), /ended exit=/, 'the wrapper was killed before it could record an end');
  const st = stateIn(sd, 'stubborn'); assert.deepEqual([st.stopped, st.exit, Boolean(st.endedAt)], [true, STOPPED_EXIT, true]);
  assert.equal(bgIn(sd, {}, 'clean').code, 0); assert.deepEqual(readdirSync(sd), [], 'every stopped job is ended: clean removes it');
});

rmSync(dir, { recursive: true, force: true });
rmSync(lockRoot, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nrun-bg: all checks passed');
process.exit(failed ? 1 : 0);
