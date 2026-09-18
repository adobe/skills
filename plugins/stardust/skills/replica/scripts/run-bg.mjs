#!/usr/bin/env node
/**
 * skills/replica/scripts/run-bg.mjs
 *
 * Run an instrument in the background and wait for it in bounded slices, so
 * that no single agent step blocks for longer than a few minutes and no
 * step returns an instrument's whole output into the agent's context.
 *
 * Why: in a hands-off replica session (2026-09-18, 26-page site, 1440+360)
 * one gate batch was launched as three parallel shell steps — each
 * `sleep 5|10|15;` then two gate rounds and a content-diff — and the next
 * model call came 15 minutes later. The agent's prompt cache lives five
 * minutes past the last call, so that call re-wrote the whole 513k-token
 * context at the cache-write price: $6.30 for one silent gap, more than the
 * gate rounds it waited for. Every other gap in that session stayed under
 * 184 s and the session ran a 96% cache-hit ratio. The rule that falls out:
 * an instrument may run as long as it needs, but the STEP that waits for it
 * must return inside the cache lifetime, and must return a verdict summary —
 * the full output belongs in a log file the agent reads by `log --grep`.
 *
 * Usage:
 *   node run-bg.mjs start --name <job> [--timeout <s>] [--slots <n>] -- <cmd> [args…]
 *   node run-bg.mjs wait   [--max <s>] [--tail <n>] [--grep <re>] [<job>…]
 *   node run-bg.mjs status [--tail <n>] [--grep <re>] [<job>…]
 *   node run-bg.mjs log    <job> [--tail <n>] [--grep <re>]
 *   node run-bg.mjs clean  [--all]
 *   (every form: [--dir <d>], default stardust/.work/replica/bg, env RUN_BG_DIR)
 *
 * start  returns at once. The job runs detached under run-capped.mjs
 *        (default --timeout 900 s — a background job without a deadline is the
 *        hang class run-capped exists for; 0 disables) in its own process
 *        group, stdout+stderr in <dir>/<job>.log, state in <dir>/<job>.json.
 *        --slots (default 3, env RUN_BG_SLOTS) is a soft concurrency cap:
 *        a job waits, first come first served, until fewer than that many
 *        jobs are running. Each capture is a Chromium; start them all at once
 *        and let the slots pace them — no `sleep N;` staggering.
 * wait   polls until the named jobs (default: every job unfinished when the
 *        wait began; if none, every job) have ended, or --max seconds pass
 *        (default 100; clamped to 270 — returning before the context cache
 *        expires is the point), then prints one line per job and, for ended
 *        jobs, its verdict lines: log lines matching --grep (default: the gate
 *        instruments' verdict vocabulary), else the last --tail (8) lines.
 *        Exit 0 = every named job ended; 75 = some still queued/running —
 *        run `wait` again as your NEXT step. Never loop on it inside one
 *        command; that recreates the blocked step this tool removes.
 * status one pass of the same report, without waiting.
 * log    a bounded view of one job's log: the last --tail lines (default
 *        40) or the --grep matches (at most 200).
 * clean  deletes ended jobs' files; --all also stops queued/running jobs.
 *
 * Per-job exit codes are the instrument's (gate.sh: 0 PASS, 2 FAIL, 3 bot
 * challenge, 4 identity, 1 error); 124 = deadline, no verdict — re-run.
 *
 * Also importable: start(), wait(), status(), report helpers — see the tests.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEADLINE_EXIT, runCapped } from './run-capped.mjs';

export const DEFAULT_DIR = 'stardust/.work/replica/bg';
export const DEFAULT_TIMEOUT_SEC = 900;
export const DEFAULT_SLOTS = 3;
export const DEFAULT_MAX_SEC = 100;
export const MAX_CEILING_SEC = 270;
export const DEFAULT_TAIL = 8;
export const STILL_RUNNING_EXIT = 75;
// The gate instruments' verdict vocabulary: pixel-compare's size/height/percentage/band lines,
// stitch-shot's completion line, gate.sh's fail-loud prefixes, run-capped's deadline notice,
// content-diff's structural count. Override with --grep for another instrument.
export const VERDICT_RE = /differing pixels|height delta|hot band|\bPASS\b|\bFAIL(?:ED)?\b|WARNING|\berror\b|exceeded|IDENTITY|reaped|stitched \S+:|structural|🔴|run-capped:|gate\.sh:/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const POLL_MS = Number(process.env.RUN_BG_POLL_MS) || 2000;
const SELF = fileURLToPath(import.meta.url);

const HELP = `Usage:
  node run-bg.mjs start --name <job> [--timeout <s>=${DEFAULT_TIMEOUT_SEC}] [--slots <n>=${DEFAULT_SLOTS}] -- <cmd> [args…]
  node run-bg.mjs wait   [--max <s>=${DEFAULT_MAX_SEC}] [--tail <n>=${DEFAULT_TAIL}] [--grep <re>] [<job>…]
  node run-bg.mjs status [--tail <n>] [--grep <re>] [<job>…]
  node run-bg.mjs log    <job> [--tail <n>=40] [--grep <re>]
  node run-bg.mjs clean  [--all]
  (all: [--dir <d>], default ${DEFAULT_DIR})`;

class UsageError extends Error { constructor(msg, code = 125) { super(msg); this.code = code; } }
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const statePath = (dir, name) => join(dir, `${name}.json`);
export const logPath = (dir, name) => join(dir, `${name}.log`);

export function readState(dir, name) { try { return JSON.parse(readFileSync(statePath(dir, name), 'utf8')); } catch { return null; } }
function writeState(dir, st) { const p = statePath(dir, st.name); const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(st, null, 1)); renameSync(tmp, p); return st; }
// Read-modify-write: the starter and the detached wrapper both touch the file in the first milliseconds.
function patchState(dir, name, patch) { const st = readState(dir, name); if (!st) throw new Error(`run-bg: state for ${name} vanished from ${dir}`); return writeState(dir, { ...st, ...patch }); }
export function listJobs(dir) { if (!existsSync(dir)) return []; return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readState(dir, f.slice(0, -5))).filter(Boolean); }

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; }
  // A wrapper is orphaned the moment `start` returns. Under a PID 1 that does not reap (node as a
  // container's entrypoint), a dead wrapper lingers as a zombie and still answers signal 0 — read
  // its state where the kernel exposes it, or a killed job would read "running" forever.
  if (process.platform === 'linux') {
    try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const state = stat.charAt(stat.lastIndexOf(')') + 2); return state !== 'Z' && state !== 'X'; } catch { return false; }
  }
  return true;
}
// queued: waiting for a slot · running · ended: wrote an exit · lost: the wrapper died without writing one (kill -9, reboot).
export function phase(st) {
  if (st.endedAt) return 'ended';
  if (!alive(st.wrapperPid)) return 'lost';
  return st.launchedAt ? 'running' : 'queued';
}
const isPending = (st) => ['queued', 'running'].includes(phase(st));
const secondsBetween = (a, b) => Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 1000));

// ---- start -------------------------------------------------------------------------------------
export function start(dir, name, cmd, args, { timeoutSec = DEFAULT_TIMEOUT_SEC, slots = DEFAULT_SLOTS } = {}) {
  if (!name || !NAME_RE.test(name)) throw new UsageError(`run-bg: --name must match ${NAME_RE} (got "${name}")\n${HELP}`);
  if (!cmd) throw new UsageError(`run-bg: start needs a command after --\n${HELP}`);
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) throw new UsageError(`run-bg: --timeout must be a number of seconds (0 disables)\n${HELP}`);
  if (!Number.isInteger(slots) || slots < 1) throw new UsageError(`run-bg: --slots must be a positive integer\n${HELP}`);
  mkdirSync(dir, { recursive: true });
  const prev = readState(dir, name);
  if (prev && isPending(prev)) throw new UsageError(`run-bg: ${name} is still ${phase(prev)} (wrapper pid ${prev.wrapperPid}) — pick another --name, or \`clean --all\` to stop it`, 2);
  const st = { name, cmd, args, cwd: process.cwd(), timeoutSec, slots, queuedAt: new Date().toISOString(), wrapperPid: null, launchedAt: null, endedAt: null, exit: null, timedOut: false };
  writeState(dir, st);
  const fd = openSync(logPath(dir, name), 'w');
  const child = spawn(process.execPath, [SELF, '__run', '--dir', dir, '--name', name], { detached: true, stdio: ['ignore', fd, fd], cwd: process.cwd(), env: process.env });
  closeSync(fd);
  patchState(dir, name, { wrapperPid: child.pid });
  child.unref();
  return { name, log: logPath(dir, name), wrapperPid: child.pid };
}

// The detached wrapper: take a slot (FIFO), run the command under run-capped, record the exit.
async function runWrapper(dir, name) {
  let st = patchState(dir, name, { wrapperPid: process.pid });
  for (;;) {
    const others = listJobs(dir).filter((j) => j.name !== name);
    const running = others.filter((j) => phase(j) === 'running').length;
    const ahead = others.filter((j) => phase(j) === 'queued' && (j.queuedAt < st.queuedAt || (j.queuedAt === st.queuedAt && j.name < name))).length;
    if (running < st.slots && ahead === 0) break;
    await sleep(Math.min(POLL_MS, 1000));
  }
  st = patchState(dir, name, { launchedAt: new Date().toISOString() });
  console.log(`run-bg: ${name} launched ${st.launchedAt} (timeout ${st.timeoutSec || 'none'}s): ${[st.cmd, ...st.args].join(' ')}`);
  const code = await runCapped(st.cmd, st.args, { timeoutSec: st.timeoutSec, label: name });
  patchState(dir, name, { endedAt: new Date().toISOString(), exit: code, timedOut: code === DEADLINE_EXIT });
  console.log(`run-bg: ${name} ended exit=${code}`);
  process.exitCode = code;
}

// ---- report ------------------------------------------------------------------------------------
export function verdictLines(p, { tail = DEFAULT_TAIL, grep = null } = {}) {
  let text; try { text = readFileSync(p, 'utf8'); } catch { return ['(no log)']; }
  const own = /^run-bg: /;
  const all = text.split('\n').filter((l) => l.trim() && !own.test(l));
  const re = grep || VERDICT_RE;
  const hits = all.filter((l) => re.test(l));
  const pick = hits.length ? hits : all;
  const out = pick.slice(-tail).map((l) => (l.length > 240 ? `${l.slice(0, 237)}…` : l));
  if (pick.length > tail) out.unshift(`… ${pick.length - tail} earlier ${hits.length ? 'verdict ' : ''}lines in ${p}`);
  if (!hits.length && all.length) out.unshift(`(no verdict-vocabulary line; last ${Math.min(tail, all.length)} lines — \`log --grep <re>\` for more)`);
  return out;
}

export function describe(st) {
  const ph = phase(st);
  if (ph === 'queued') return `${st.name}  queued ${secondsBetween(st.queuedAt)}s (waiting for a slot)`;
  if (ph === 'running') return `${st.name}  running ${secondsBetween(st.launchedAt)}s`;
  if (ph === 'lost') return `${st.name}  lost — wrapper gone without an exit (kill -9? reboot?) — re-run`;
  const took = st.launchedAt ? ` in ${secondsBetween(st.launchedAt, st.endedAt)}s` : '';
  return st.timedOut ? `${st.name}  deadline ${st.timeoutSec}s exceeded (exit ${DEADLINE_EXIT}: no verdict — re-run, or raise --timeout for a legitimately huge page)${took}` : `${st.name}  done exit=${st.exit}${took}`;
}

export function report(dir, names, { tail = DEFAULT_TAIL, grep = null, elapsedSec = 0, ceilingSec = 0 } = {}) {
  const lines = []; let pending = 0;
  for (const name of names) {
    const st = readState(dir, name);
    if (!st) { lines.push(`${name}  no such job in ${dir}`); continue; }
    if (isPending(st)) pending += 1;
    lines.push(describe(st));
    if (!isPending(st)) for (const l of verdictLines(logPath(dir, name), { tail, grep })) lines.push(`  ${l}`);
  }
  if (!names.length) lines.push(`run-bg: no jobs in ${dir}`);
  else if (pending) lines.push(`run-bg: ${names.length - pending}/${names.length} ended, ${pending} still going${elapsedSec ? ` after ${Math.round(elapsedSec)}s (ceiling ${ceilingSec}s)` : ''} — run \`wait\` again as your next step; logs: ${dir}/<job>.log`);
  else lines.push(`run-bg: all ${names.length} ended — full output per job: \`log <job> --grep <re>\` (${dir}/<job>.log)`);
  return { text: lines.join('\n'), pending };
}

function pickNames(dir, requested) {
  if (requested.length) return requested;
  const jobs = listJobs(dir).sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
  const unfinished = jobs.filter(isPending);
  return (unfinished.length ? unfinished : jobs).map((j) => j.name);
}

export async function wait(dir, requested, { maxSec = DEFAULT_MAX_SEC, tail, grep } = {}) {
  if (!Number.isFinite(maxSec) || maxSec < 0) throw new UsageError(`run-bg: --max must be a number of seconds\n${HELP}`);
  let ceilingSec = maxSec;
  if (maxSec > MAX_CEILING_SEC) { ceilingSec = MAX_CEILING_SEC; console.error(`run-bg: --max ${maxSec} clamped to ${MAX_CEILING_SEC}s — a step must return before the context cache expires`); }
  const names = pickNames(dir, requested);
  const t0 = Date.now();
  for (;;) {
    const pending = names.map((n) => readState(dir, n)).filter((st) => st && isPending(st));
    if (!pending.length || (Date.now() - t0) / 1000 >= ceilingSec) break;
    await sleep(Math.min(POLL_MS, Math.max(50, ceilingSec * 1000 - (Date.now() - t0))));
  }
  return report(dir, names, { tail, grep, elapsedSec: (Date.now() - t0) / 1000, ceilingSec });
}

export function status(dir, requested, { tail, grep } = {}) { return report(dir, pickNames(dir, requested), { tail, grep }); }

export function showLog(dir, name, { tail = 40, grep = null } = {}) {
  if (!name) throw new UsageError(`run-bg: log needs a <job>\n${HELP}`);
  const p = logPath(dir, name);
  let text; try { text = readFileSync(p, 'utf8'); } catch { throw new UsageError(`run-bg: no log for ${name} at ${p}`, 2); }
  const all = text.split('\n'); if (all.length && all[all.length - 1] === '') all.pop();
  const pick = grep ? all.filter((l) => grep.test(l)) : all;
  const cap = grep ? Math.min(200, Math.max(tail, 1)) : tail;
  const out = pick.slice(-cap);
  const head = `${p}: ${all.length} lines${grep ? `, ${pick.length} match ${grep}` : ''}${pick.length > cap ? `, showing the last ${cap}` : ''}`;
  return `${head}\n${out.join('\n')}`;
}

export async function clean(dir, { all = false } = {}) {
  const out = []; const stopped = [];
  for (const j of listJobs(dir)) {
    if (isPending(j)) {
      if (!all) { out.push(`run-bg: keeping ${j.name} (${phase(j)}) — \`clean --all\` stops it`); continue; }
      try { process.kill(j.wrapperPid, 'SIGTERM'); } catch { /* already gone */ }
      stopped.push(j.name); out.push(`run-bg: stopped ${j.name}`);
    }
  }
  if (stopped.length) await sleep(500); // let run-capped forward the signal and the wrapper write its exit before the files go
  for (const j of listJobs(dir)) {
    if (isPending(j) && !all) continue;
    for (const p of [statePath(dir, j.name), logPath(dir, j.name)]) { try { unlinkSync(p); } catch { /* gone */ } }
    if (!stopped.includes(j.name)) out.push(`run-bg: removed ${j.name}`);
  }
  return out.join('\n');
}

// ---- cli ---------------------------------------------------------------------------------------
function parse(argv) {
  const [sub, ...rest] = argv;
  const o = { dir: process.env.RUN_BG_DIR || DEFAULT_DIR, names: [], name: null, timeoutSec: DEFAULT_TIMEOUT_SEC, slots: Number(process.env.RUN_BG_SLOTS) || DEFAULT_SLOTS, maxSec: DEFAULT_MAX_SEC, tail: undefined, grep: null, all: false, cmd: [] };
  const num = (flag, v) => { const n = Number(v); if (v === undefined || !Number.isFinite(n)) throw new UsageError(`run-bg: ${flag} needs a number\n${HELP}`); return n; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--') { o.cmd = rest.slice(i + 1); break; }
    if (a === '--dir') o.dir = rest[++i];
    else if (a === '--name') o.name = rest[++i];
    else if (a === '--timeout') o.timeoutSec = num(a, rest[++i]);
    else if (a === '--slots') o.slots = num(a, rest[++i]);
    else if (a === '--max') o.maxSec = num(a, rest[++i]);
    else if (a === '--tail') o.tail = num(a, rest[++i]);
    else if (a === '--grep') { const v = rest[++i]; try { o.grep = new RegExp(v); } catch (e) { throw new UsageError(`run-bg: bad --grep ${v}: ${e.message}`); } }
    else if (a === '--all') o.all = true;
    else if (a.startsWith('--')) throw new UsageError(`run-bg: unknown flag ${a}\n${HELP}`);
    else o.names.push(a);
  }
  if (!o.dir) throw new UsageError(`run-bg: --dir needs a path\n${HELP}`);
  o.dir = resolve(o.dir);
  return { sub, o };
}

async function cli(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const { sub, o } = parse(argv);
  switch (sub) {
    case 'start': {
      const [cmd, ...args] = o.cmd;
      const r = start(o.dir, o.name, cmd, args, { timeoutSec: o.timeoutSec, slots: o.slots });
      console.log(`run-bg: queued ${r.name} → ${r.log}   (next step: node stardust/scripts/replica/run-bg.mjs wait)`);
      return 0;
    }
    case 'wait': { const r = await wait(o.dir, o.names, { maxSec: o.maxSec, tail: o.tail, grep: o.grep }); console.log(r.text); return r.pending ? STILL_RUNNING_EXIT : 0; }
    case 'status': { const r = status(o.dir, o.names, { tail: o.tail, grep: o.grep }); console.log(r.text); return 0; }
    case 'log': console.log(showLog(o.dir, o.names[0], { tail: o.tail ?? 40, grep: o.grep })); return 0;
    case 'clean': console.log(await clean(o.dir, { all: o.all })); return 0;
    case '__run': await runWrapper(o.dir, o.name); return process.exitCode ?? 0;
    default: throw new UsageError(`run-bg: unknown command "${sub}"\n${HELP}`);
  }
}

if (process.argv[1] && SELF === process.argv[1]) {
  // exitCode, not process.exit(): see run-capped.mjs — a forced exit can hang Node's platform shutdown.
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof UsageError ? e.message : `run-bg: ${e.stack || e.message}`); process.exitCode = e instanceof UsageError ? e.code : 1; });
}
