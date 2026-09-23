#!/usr/bin/env node
// skills/replica/scripts/test/run-bg.test.mjs — the run-bg.mjs contract: detached start, FIFO
// concurrency slots (default 2), bounded wait (exit 75 while jobs are going; --max clamped to 110), instrument
// deadline (124), verdict-line extraction, duplicate-name refusal, pid identity (a recycled pid is lost, holds no
// slot, is never signalled), the value-flag swallow rule, log/clean (--all stops wrapper + instrument).
// Run: node plugins/stardust/skills/replica/scripts/test/run-bg.test.mjs   (about 10 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SLOTS, MAX_CEILING_SEC, STILL_RUNNING_EXIT, VERDICT_RE } from '../run-bg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'run-bg.mjs');
const dir = mkdtempSync(join(tmpdir(), 'run-bg-test-'));
const env = { ...process.env, RUN_BG_POLL_MS: '100' };
delete env.RUN_BG_SLOTS; delete env.STARDUST_BROWSER_SLOTS;
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
  assert.equal(MAX_CEILING_SEC, 110, 'the agent\'s shell tool kills a foreground command at about two minutes; 110 s leaves startup and the report their room');
  assert.equal(bg('start', '--name', 'z', '--', 'true').code, 0);
  const r = bg('wait', '--max', '9999', 'z');
  assert.equal(r.code, 0); assert.match(r.err, /--max 9999 clamped to 110s — the agent's shell tool kills a foreground command at about two minutes and returns nothing from it; 110 s leaves startup and the report their room/);
  const r200 = bg('wait', '--max', '200', 'z');
  assert.equal(r200.code, 0); assert.match(r200.err, /--max 200 clamped to 110s/);
  const r111 = bg('wait', '--max', '111', 'z');
  assert.equal(r111.code, 0); assert.match(r111.err, /--max 111 clamped to 110s/, 'the former 179 s would die with the shell tool');
  const r110 = bg('wait', '--max', '110', 'z');
  assert.equal(r110.code, 0); assert.equal(r110.err, '', 'a --max at or under the ceiling is not clamped');
});
await check(`slots default to ${DEFAULT_SLOTS} — RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS, else ${DEFAULT_SLOTS}`, () => {
  assert.equal(DEFAULT_SLOTS, 2, 'each capture is a Chromium and a gate.sh --full round holds three: two slots is the machine budget');
  assert.equal(bg('start', '--name', 'd0', '--', 'true').code, 0); assert.equal(state('d0').slots, 2);
  assert.equal(run({ STARDUST_BROWSER_SLOTS: '4' }, 'start', '--name', 'd1', '--', 'true').code, 0); assert.equal(state('d1').slots, 4);
  assert.equal(run({ STARDUST_BROWSER_SLOTS: '4', RUN_BG_SLOTS: '1' }, 'start', '--name', 'd2', '--', 'true').code, 0); assert.equal(state('d2').slots, 1);
  assert.equal(run({ RUN_BG_SLOTS: '1' }, 'start', '--name', 'd3', '--slots', '5', '--', 'true').code, 0); assert.equal(state('d3').slots, 5, '--slots wins over the env');
  assert.equal(bg('wait', '--max', '10', 'd0', 'd1', 'd2', 'd3').code, 0);
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

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nrun-bg: all checks passed');
process.exit(failed ? 1 : 0);
