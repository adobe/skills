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
 * minutes from the start of the last call, so that call re-wrote the whole
 * 513k-token context at the cache-write price: $6.30 for one silent gap, more
 * than the gate rounds it waited for. Every other gap in that session stayed
 * under 184 s and the session ran a 96% cache-hit ratio. The rule that falls out:
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
 *   A value flag (--name --dir --timeout --slots --max --tail --grep) followed by
 *   nothing or by another --flag is a usage error (exit 125) naming the flag —
 *   never a silently swallowed value.
 *
 * start  returns at once. The job runs detached under run-capped.mjs
 *        (default --timeout 900 s — a background job without a deadline is the
 *        hang class run-capped exists for; 0 disables) in its own process
 *        group, stdout+stderr in <dir>/<job>.log, state in <dir>/<job>.json.
 *        --slots (default 2; env RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS) is a
 *        soft concurrency cap: a job waits, first come first served, until fewer
 *        than that many jobs are running. Each capture is a Chromium, and one
 *        `gate.sh --full` round holds three of them at its peak (the three probes
 *        run in parallel), so two slots — up to six Chromiums — is the machine
 *        budget. Start the jobs all at once and let the slots pace them — no
 *        `sleep N;` staggering, and do not raise the slots for --full rounds.
 * wait   polls until the named jobs (default: every job unfinished when the
 *        wait began; if none, the latest batch — jobs ended within 10 min of the
 *        newest; --all: every job on disk) have ended, or --max seconds pass
 *        (default 100; clamped to 110 — the agent's shell tool kills a foreground
 *        command at about two minutes and returns nothing from it, so a wait that
 *        could run 180 s died with no output; 110 s leaves node startup and the
 *        report their room, and still returns well inside the context cache's
 *        five minutes from the start of the previous model request), then prints
 *        one line per job and, for ended jobs, its verdict lines: log lines
 *        matching --grep (default: the gate instruments' verdict vocabulary),
 *        else the last --tail (8) lines.
 *        Exit 0 = every named job ended; 75 = some still queued/running —
 *        run `wait` again as your NEXT step. Never loop on it inside one
 *        command; that recreates the blocked step this tool removes.
 * status one pass of the same report, without waiting.
 * log    a bounded view of one job's log: the last --tail lines (default
 *        40) or the --grep matches (at most 200).
 * clean  deletes ended and lost jobs' files; --all also stops queued/running
 *        jobs: SIGTERM to the wrapper (run-capped forwards it to the
 *        instrument's process group and escalates to SIGKILL after 3 s), then
 *        after a 4 s grace SIGKILL to the wrapper's whole process group and to
 *        the instrument's, and the files go only once the wrapper is gone. A
 *        lost job (wrapper gone) whose instrument still runs is stopped the same
 *        way through the recorded childPid. Nothing is ever signalled unless its
 *        identity matches (below).
 *
 * Liveness: a job's state records the wrapper pid AND its process start time
 * (`ps -o lstart`, the same on macOS and procps Linux) — a bare pid names a
 * recycled process after a reboot or a busy day, and EPERM answers for a
 * process that is not ours. A job counts as alive only when the pid exists, is
 * not a zombie, and its start time is the recorded one (state files from before
 * the identity was recorded fall back to the command line containing
 * `run-bg.mjs __run … --name <job>`). Anything else is `lost`: it blocks no
 * FIFO slot, never refuses its name to a new `start`, and is never signalled.
 * After spawn the wrapper is the state file's only writer (the starter writes
 * it once before spawn; the wrapper's first act is to write its own pid + start
 * time — a state younger than 15 s without a pid is still spawning). When the
 * wrapper launches the instrument it records childPid + childStart, found by
 * `ps` as its own child (run-capped's API does not expose the pid); where `ps`
 * is unavailable (and no /proc) they stay null and `clean --all` cannot reach
 * an orphaned instrument — the wrapper's own group is still killed.
 *
 * Per-job exit codes are the instrument's (gate.sh: 0 PASS, 2 FAIL, 3 bot
 * challenge, 4 identity, 1 error); 124 = deadline, no verdict — re-run.
 *
 * Also importable: start(), wait(), status(), alive(), phase(), report helpers — see the tests.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEADLINE_EXIT, runCapped } from './run-capped.mjs';

export const DEFAULT_DIR = 'stardust/.work/replica/bg';
export const DEFAULT_TIMEOUT_SEC = 900;
// Each capture is a Chromium and a `gate.sh --full` round holds three at its peak: two slots = up to six Chromiums,
// the machine budget. RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS, else this.
export const DEFAULT_SLOTS = 2;
export const DEFAULT_MAX_SEC = 100;
// The agent's shell tool kills a foreground command at about two minutes and returns nothing from it — a wait that
// could run 180 s died with no output. 110 s leaves node startup and the report their room, and still returns inside
// the context cache's five minutes from the start of the previous model request.
export const MAX_CEILING_SEC = 110;
export const DEFAULT_TAIL = 8;
export const STILL_RUNNING_EXIT = 75;
// With nothing going and no names given, `wait`/`status` report the latest batch: jobs that ended
// within this window of the newest ending. Earlier sessions' jobs stay on disk (their logs are
// evidence) but out of the report — one session's wait had dumped every prior session's summary.
export const RECENT_WINDOW_SEC = 600;
// The starter writes the state without a pid; the wrapper's first act is to write its own. A pid-less state
// younger than this is still spawning (node startup on a loaded machine), older is lost.
export const SPAWN_GRACE_SEC = 15;
// clean --all: SIGTERM first (run-capped forwards it to the instrument's group and SIGKILLs that after 3 s), then
// SIGKILL whatever is left after this grace.
const CLEAN_GRACE_MS = 4000;
// One `ps` snapshot serves a whole report/poll pass.
const PROC_TTL_MS = 250;
// The gate instruments' verdict vocabulary: pixel-compare's size/height/percentage/band lines,
// stitch-shot's completion line, gate.sh's fail-loud prefixes, run-capped's deadline notice,
// content-diff's structural count, motion-compare's SUMMARY, the browser-lock's wait/hold notices.
// Override with --grep for another instrument.
export const VERDICT_RE = /differing pixels|height delta|hot band|\bPASS\b|\bFAIL(?:ED)?\b|WARNING|\berror\b|exceeded|IDENTITY|reaped|stitched \S+:|structural|🔴|run-capped:|gate\.sh:|\b(?:content-diff|visual-diff|chrome-parity|evidence): |DEADLINE|BLOCKED|ERROR \(exit|delta\(s\)|advisory|motion summary:|SUMMARY|browser-lock:/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const POLL_MS = Number(process.env.RUN_BG_POLL_MS) || 2000;
const SELF = fileURLToPath(import.meta.url);

const HELP = `Usage:
  node run-bg.mjs start --name <job> [--timeout <s>=${DEFAULT_TIMEOUT_SEC}] [--slots <n>=${DEFAULT_SLOTS}] -- <cmd> [args…]
  node run-bg.mjs wait   [--max <s>=${DEFAULT_MAX_SEC}] [--tail <n>=${DEFAULT_TAIL}] [--grep <re>] [--all] [<job>…]
  node run-bg.mjs status [--tail <n>] [--grep <re>] [--all] [<job>…]
  node run-bg.mjs log    <job> [--tail <n>=40] [--grep <re>]
  node run-bg.mjs clean  [--all]
  (all: [--dir <d>], default ${DEFAULT_DIR})`;

class UsageError extends Error { constructor(msg, code = 125) { super(msg); this.code = code; } }
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const statePath = (dir, name) => join(dir, `${name}.json`);
export const logPath = (dir, name) => join(dir, `${name}.log`);
const secondsBetween = (a, b) => Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 1000));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

export function readState(dir, name) { try { return JSON.parse(readFileSync(statePath(dir, name), 'utf8')); } catch { return null; } }
function writeState(dir, st) { const p = statePath(dir, st.name); const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(st, null, 1)); renameSync(tmp, p); return st; }
export function listJobs(dir) { if (!existsSync(dir)) return []; return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readState(dir, f.slice(0, -5))).filter(Boolean); }

// ---- process identity --------------------------------------------------------------------------
// pid → { ppid, state, start, command } from one `ps` run (cached PROC_TTL_MS); null when ps is unusable.
// lstart is 5 whitespace tokens ("Wed Sep 23 07:59:27 2026") on macOS and procps alike; -ww: never truncate.
let procCache = { at: 0, table: null };
function procTable({ fresh = false } = {}) {
  if (!fresh && Date.now() - procCache.at < PROC_TTL_MS) return procCache.table;
  let table = null;
  const r = spawnSync('ps', ['-e', '-ww', '-o', 'pid=,ppid=,state=,lstart=,command='], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    table = new Map();
    for (const line of r.stdout.split('\n')) {
      const t = line.trim().split(/\s+/);
      if (t.length < 9) continue;
      table.set(Number(t[0]), { ppid: Number(t[1]), state: t[2], start: t.slice(3, 8).join(' '), command: t.slice(8).join(' ') });
    }
  }
  procCache = { at: Date.now(), table };
  return table;
}
// One process's identity: the ps snapshot, else /proc (Linux without ps: start = kernel start ticks), else null.
export function procInfo(pid, opts) {
  const t = procTable(opts);
  if (t) return t.get(Number(pid)) || null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { ppid: Number(f[1]), state: f[0], start: `ticks:${f[19]}`, command: readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0').join(' ').trim() };
  } catch { return null; }
}
// A pid alone is not a job: pids recycle, and EPERM answers for a process that is not ours. Ours = the pid exists,
// is not a zombie (a dead wrapper lingers as one under a PID 1 that does not reap), and its start time is the one
// recorded at spawn — or, for state files without one, its command line is this script's `__run --name <job>`.
export function alive(pid, { start = null, name = null } = {}, opts) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const p = procInfo(pid, opts);
  if (!p || /^[ZX]/.test(p.state)) return false;
  if (start) return p.start === start;
  return Boolean(name) && new RegExp(`run-bg\\.mjs __run\\b.* --name ${escapeRe(name)}(?: |$)`).test(p.command);
}
const wrapperAlive = (st, opts) => alive(st.wrapperPid, { start: st.wrapperStart, name: st.name }, opts);
const childAlive = (st, opts) => Boolean(st.childStart) && alive(st.childPid, { start: st.childStart }, opts);
// The wrapper's own child right after runCapped spawned it (ps itself excluded) — run-capped does not expose the pid.
function childOf(ppid) {
  const t = procTable({ fresh: true }); if (!t) return null;
  for (const [pid, p] of t) if (p.ppid === ppid && !/^(?:\S*\/)?ps(?: |$)/.test(p.command)) return { pid, start: p.start };
  return null;
}
function signal(pid, sig, { group = false } = {}) { try { process.kill(group && process.platform !== 'win32' ? -pid : pid, sig); return true; } catch { return false; } }

// queued: waiting for a slot (or still spawning) · running · ended: wrote an exit · lost: the wrapper died without
// writing one (kill -9, reboot) or the stored pid now names some other process.
export function phase(st) {
  if (st.endedAt) return 'ended';
  if (!st.wrapperPid) return secondsBetween(st.queuedAt) < SPAWN_GRACE_SEC ? 'queued' : 'lost';
  if (!wrapperAlive(st)) return 'lost';
  return st.launchedAt ? 'running' : 'queued';
}
const isPending = (st) => ['queued', 'running'].includes(phase(st));
// lost, but the instrument the wrapper launched is still running.
const isOrphan = (st) => phase(st) === 'lost' && childAlive(st);

// ---- start -------------------------------------------------------------------------------------
export function start(dir, name, cmd, args, { timeoutSec = DEFAULT_TIMEOUT_SEC, slots = DEFAULT_SLOTS } = {}) {
  if (!name || !NAME_RE.test(name)) throw new UsageError(`run-bg: --name must match ${NAME_RE} (got "${name}")\n${HELP}`);
  if (!cmd) throw new UsageError(`run-bg: start needs a command after --\n${HELP}`);
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) throw new UsageError(`run-bg: --timeout must be a number of seconds (0 disables)\n${HELP}`);
  if (!Number.isInteger(slots) || slots < 1) throw new UsageError(`run-bg: --slots must be a positive integer\n${HELP}`);
  mkdirSync(dir, { recursive: true });
  const prev = readState(dir, name);
  if (prev && isPending(prev)) throw new UsageError(`run-bg: ${name} is still ${phase(prev)} (wrapper pid ${prev.wrapperPid}) — pick another --name, or \`clean --all\` to stop it`, 2);
  // Written once, before the spawn; from here on the wrapper is the file's only writer.
  const st = { name, cmd, args, cwd: process.cwd(), timeoutSec, slots, queuedAt: new Date().toISOString(), wrapperPid: null, wrapperStart: null, launchedAt: null, childPid: null, childStart: null, endedAt: null, exit: null, timedOut: false };
  writeState(dir, st);
  const fd = openSync(logPath(dir, name), 'w');
  const child = spawn(process.execPath, [SELF, '__run', '--dir', dir, '--name', name], { detached: true, stdio: ['ignore', fd, fd], cwd: process.cwd(), env: process.env });
  closeSync(fd);
  child.unref();
  return { name, log: logPath(dir, name), wrapperPid: child.pid };
}

// The detached wrapper: record its identity, take a slot (FIFO), run the command under run-capped, record the exit.
async function runWrapper(dir, name) {
  let st = readState(dir, name);
  if (!st) throw new Error(`run-bg: state for ${name} vanished from ${dir}`);
  st = writeState(dir, { ...st, wrapperPid: process.pid, wrapperStart: procInfo(process.pid, { fresh: true })?.start ?? null });
  for (;;) {
    const others = listJobs(dir).filter((j) => j.name !== name);
    const running = others.filter((j) => phase(j) === 'running').length;
    const ahead = others.filter((j) => phase(j) === 'queued' && (j.queuedAt < st.queuedAt || (j.queuedAt === st.queuedAt && j.name < name))).length;
    if (running < st.slots && ahead === 0) break;
    await sleep(Math.min(POLL_MS, 1000));
  }
  const run = runCapped(st.cmd, st.args, { timeoutSec: st.timeoutSec, label: name }); // spawns synchronously
  const child = childOf(process.pid);
  st = writeState(dir, { ...st, launchedAt: new Date().toISOString(), childPid: child?.pid ?? null, childStart: child?.start ?? null });
  console.log(`run-bg: ${name} launched ${st.launchedAt} (timeout ${st.timeoutSec || 'none'}s): ${[st.cmd, ...st.args].join(' ')}`);
  const code = await run;
  writeState(dir, { ...st, endedAt: new Date().toISOString(), exit: code, timedOut: code === DEADLINE_EXIT });
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
  if (ph === 'lost') return `${st.name}  lost — wrapper gone without an exit (kill -9? reboot?)${isOrphan(st) ? `; its instrument (pid ${st.childPid}) still runs — \`clean --all\` stops it` : ''} — re-run`;
  const took = st.launchedAt ? ` in ${secondsBetween(st.launchedAt, st.endedAt)}s` : '';
  return st.timedOut ? `${st.name}  deadline ${st.timeoutSec}s exceeded (exit ${DEADLINE_EXIT}: no verdict — re-run, or raise --timeout for a legitimately huge page)${took}` : `${st.name}  done exit=${st.exit}${took}`;
}

export function report(dir, names, { tail = DEFAULT_TAIL, grep = null, hidden = 0, elapsedSec = 0, ceilingSec = 0 } = {}) {
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
  if (hidden) lines.push(`run-bg: ${hidden} earlier job(s) not shown — \`status --all\``);
  return { text: lines.join('\n'), pending };
}

function pickNames(dir, requested, { all = false } = {}) {
  if (requested.length) return { names: requested, hidden: 0 };
  const jobs = listJobs(dir).sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
  const unfinished = jobs.filter(isPending);
  if (unfinished.length) return { names: unfinished.map((j) => j.name), hidden: 0 };
  if (all || !jobs.length) return { names: jobs.map((j) => j.name), hidden: 0 };
  const at = (j) => new Date(j.endedAt || j.queuedAt).getTime();
  const newest = Math.max(...jobs.map(at));
  const recent = jobs.filter((j) => newest - at(j) <= RECENT_WINDOW_SEC * 1000);
  return { names: recent.map((j) => j.name), hidden: jobs.length - recent.length };
}

export async function wait(dir, requested, { maxSec = DEFAULT_MAX_SEC, tail, grep, all = false } = {}) {
  if (!Number.isFinite(maxSec) || maxSec < 0) throw new UsageError(`run-bg: --max must be a number of seconds\n${HELP}`);
  let ceilingSec = maxSec;
  if (maxSec > MAX_CEILING_SEC) { ceilingSec = MAX_CEILING_SEC; console.error(`run-bg: --max ${maxSec} clamped to ${MAX_CEILING_SEC}s — the agent's shell tool kills a foreground command at about two minutes and returns nothing from it; ${MAX_CEILING_SEC} s leaves startup and the report their room (and a step must still return before the context cache expires)`); }
  const { names, hidden } = pickNames(dir, requested, { all });
  const t0 = Date.now();
  for (;;) {
    const pending = names.map((n) => readState(dir, n)).filter((st) => st && isPending(st));
    if (!pending.length || (Date.now() - t0) / 1000 >= ceilingSec) break;
    await sleep(Math.min(POLL_MS, Math.max(50, ceilingSec * 1000 - (Date.now() - t0))));
  }
  return report(dir, names, { tail, grep, hidden, elapsedSec: (Date.now() - t0) / 1000, ceilingSec });
}

export function status(dir, requested, { tail, grep, all = false } = {}) { const { names, hidden } = pickNames(dir, requested, { all }); return report(dir, names, { tail, grep, hidden }); }

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

// Without --all: ended and lost jobs' files go; queued/running jobs, and lost jobs whose instrument still runs, stay.
// With --all: every live wrapper (own group) and every identity-matched instrument (own group) is stopped — SIGTERM,
// grace, SIGKILL — and a job's files go only once nothing of it is left alive.
export async function clean(dir, { all = false } = {}) {
  const out = []; const targets = new Map(); // name → [{ pid, ident, what }]
  for (const j of listJobs(dir)) {
    const pending = isPending(j); const orphan = !pending && isOrphan(j);
    if (!pending && !orphan) continue;
    if (!all) { out.push(`run-bg: keeping ${j.name} (${pending ? phase(j) : `lost, instrument pid ${j.childPid} still running`}) — \`clean --all\` stops it`); continue; }
    const t = [];
    if (pending) t.push({ pid: j.wrapperPid, ident: { start: j.wrapperStart, name: j.name }, what: 'wrapper' });
    if (childAlive(j)) t.push({ pid: j.childPid, ident: { start: j.childStart }, what: 'instrument' });
    targets.set(j.name, t);
    for (const x of t) signal(x.pid, 'SIGTERM', { group: x.what === 'instrument' });
  }
  const left = () => [...targets.values()].flat().filter((x) => alive(x.pid, x.ident, { fresh: true }));
  if (targets.size) {
    const t0 = Date.now();
    while (left().length && Date.now() - t0 < CLEAN_GRACE_MS) await sleep(100);
    for (const x of left()) signal(x.pid, 'SIGKILL', { group: true });
    if (left().length) await sleep(200);
  }
  const survivors = new Set(left().map((x) => x.pid));
  for (const [name, t] of targets) {
    const stuck = t.filter((x) => survivors.has(x.pid));
    out.push(stuck.length ? `run-bg: could not stop ${name} (${stuck.map((x) => `${x.what} pid ${x.pid}`).join(', ')} survived SIGKILL) — files kept` : `run-bg: stopped ${name}`);
  }
  for (const j of listJobs(dir)) {
    if ((isPending(j) || isOrphan(j)) && (!all || (targets.get(j.name) || []).some((x) => survivors.has(x.pid)))) continue;
    for (const p of [statePath(dir, j.name), logPath(dir, j.name)]) { try { unlinkSync(p); } catch { /* gone */ } }
    if (!targets.has(j.name)) out.push(`run-bg: removed ${j.name}`);
  }
  return out.join('\n');
}

// ---- cli ---------------------------------------------------------------------------------------
function parse(argv) {
  const [sub, ...rest] = argv;
  const o = { dir: process.env.RUN_BG_DIR || DEFAULT_DIR, names: [], name: null, timeoutSec: DEFAULT_TIMEOUT_SEC, slots: Number(process.env.RUN_BG_SLOTS) || Number(process.env.STARDUST_BROWSER_SLOTS) || DEFAULT_SLOTS, maxSec: DEFAULT_MAX_SEC, tail: undefined, grep: null, all: false, cmd: [] };
  const num = (flag, v) => { const n = Number(v); if (!Number.isFinite(n)) throw new UsageError(`run-bg: ${flag} needs a number (got ${v})\n${HELP}`); return n; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    // A value flag never swallows a following flag (or nothing) as its value.
    const value = () => { const v = rest[i + 1]; if (v === undefined || v.startsWith('--')) throw new UsageError(`run-bg: ${a} needs a value${v === undefined ? '' : ` (got ${v})`}\n${HELP}`); i += 1; return v; };
    if (a === '--') { o.cmd = rest.slice(i + 1); break; }
    if (a === '--dir') o.dir = value();
    else if (a === '--name') o.name = value();
    else if (a === '--timeout') o.timeoutSec = num(a, value());
    else if (a === '--slots') o.slots = num(a, value());
    else if (a === '--max') o.maxSec = num(a, value());
    else if (a === '--tail') o.tail = num(a, value());
    else if (a === '--grep') { const v = value(); try { o.grep = new RegExp(v); } catch (e) { throw new UsageError(`run-bg: bad --grep ${v}: ${e.message}`); } }
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
    case 'wait': { const r = await wait(o.dir, o.names, { maxSec: o.maxSec, tail: o.tail, grep: o.grep, all: o.all }); console.log(r.text); return r.pending ? STILL_RUNNING_EXIT : 0; }
    case 'status': { const r = status(o.dir, o.names, { tail: o.tail, grep: o.grep, all: o.all }); console.log(r.text); return 0; }
    case 'log': console.log(showLog(o.dir, o.names[0], { tail: o.tail ?? 40, grep: o.grep })); return 0;
    case 'clean': console.log(await clean(o.dir, { all: o.all })); return 0;
    case '__run': await runWrapper(o.dir, o.name); return process.exitCode ?? 0;
    default: throw new UsageError(`run-bg: unknown command "${sub}"\n${HELP}`);
  }
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  // exitCode, not process.exit(): see run-capped.mjs — a forced exit can hang Node's platform shutdown.
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof UsageError ? e.message : `run-bg: ${e.stack || e.message}`); process.exitCode = e instanceof UsageError ? e.code : 1; });
}
