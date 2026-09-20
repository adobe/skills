#!/usr/bin/env node
/**
 * skills/stardust/scripts/browser-lock.mjs — the machine-wide browser semaphore.
 *
 * Parallel gate rounds across projects on one machine were killed by the OS for
 * memory (64 kills in 9 projects); a raw Chromium process count is not a usable
 * threshold (one browser is 6–12 processes). This lock counts BROWSERS: one slot
 * file per live holder under `~/.stardust/locks/browser/` (outside any project —
 * contention is cross-project), `STARDUST_BROWSER_SLOTS` (default 2) slots.
 *
 *   <dir>/<pid>-<ts>.json   { pid, host, project, script, since }
 *
 * A slot is HELD while its file exists, the recorded pid is alive (`kill -0`) and
 * the file's mtime is younger than STARDUST_BROWSER_TTL_MIN (20); otherwise it is
 * stale, deleted and re-used. Above budget `acquire` WAITS — one stderr line at
 * 0:00 and every 30 s, `waiting-slot` appended to $STARDUST_PROGRESS_LOG when set
 * (fan-out.md § Progress files) — and after STARDUST_BROWSER_WAIT (600 s) exits
 * 124: the no-verdict code, never a FAIL (gate.sh already treats 124 as
 * abort-the-round). A launch gate, not a quality gate: it runs before the first
 * navigation and changes no threshold.
 *
 * Usage:
 *   node skills/stardust/scripts/browser-lock.mjs acquire [--pid <n>] [--script <name>] [--project <root>] [--wait <s>] [--no-lock]
 *   node skills/stardust/scripts/browser-lock.mjs release [--pid <n>] | --all [--stale]
 *   node skills/stardust/scripts/browser-lock.mjs refresh [--pid <n>]     (touch this holder's slot — a shell round longer than the TTL calls it per step)
 *   node skills/stardust/scripts/browser-lock.mjs status  [--json]         (the census: holders + orphan browsers)
 *   node skills/stardust/scripts/browser-lock.mjs reap    [--min <minutes>] (kill parentless chrome-headless-shell/chromium older than --min, default 15)
 *   common: [--lock-dir <dir>] [--slots <n>]
 *
 * `--pid` defaults to the parent process (the shell or driver that will own the
 * browser); an in-process holder passes its own. An API holder keeps its slot
 * fresh itself (an unref'd timer touches the file every TTL/3); a shell holder
 * calls `refresh` between steps or re-runs `acquire`. Env: STARDUST_BROWSER_SLOTS
 * (0 = disabled: acquire exits 0 and touches nothing), STARDUST_BROWSER_TTL_MIN,
 * STARDUST_BROWSER_WAIT, STARDUST_BROWSER_LOCK_DIR, STARDUST_PROGRESS_LOG. Owner
 * settings per machine — never written to state.json.
 *
 * API (in-process holders — live-session launchTier, crawl.mjs's ladder copy, qa/scripts/lib.mjs browserSlot):
 *   import { acquireProcess, acquire, release, status, reap } from '…/stardust/scripts/browser-lock.mjs';
 *   await acquireProcess({ script: 'stitch-shot' });         // the PROCESS's slot: one per process however many browsers it
 *                                                             // launches (a ladder relaunch, a crawl, five qa checks) — memoised,
 *                                                             // released on process exit; null when disabled; throws { code: 124 }
 *   const slot = await acquire({ script: 'shell-round' });   // a raw slot: { file, release(), refresh() } | null — for holders that
 *   … slot?.release();                                        // manage their own lifetime (release deletes the file, stops the timer)
 * Slots are per PROCESS, never per context or per launch (hit-minimisation: a crawl relaunching up the
 * ladder holds one slot for its run and re-hits nothing).
 *
 * Exit codes: 0 acquired / released / refreshed / printed · 124 no slot within --wait (no verdict)
 *             · 2 usage (a non-numeric --slots / --wait / --min / --pid included) or I/O
 *             error. No network. Never reaps a dev server (ports are the port
 *             allocator's, by pidfile only).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, appendFileSync, utimesSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEADLINE_EXIT = 124;
export const DEFAULTS = { slots: 2, ttlMin: 20, waitS: 600, reapMin: 15 };
export const DEFAULT_LOCK_DIR = join(homedir(), '.stardust', 'locks', 'browser');
const POLL_MS = Number(process.env.STARDUST_BROWSER_POLL_MS) || 1000; // tests shorten the tick
const NOTE_EVERY_MS = 30_000;

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
export function settings(env = process.env, over = {}) {
  return {
    dir: over.dir ?? env.STARDUST_BROWSER_LOCK_DIR ?? DEFAULT_LOCK_DIR,
    slots: over.slots ?? num(env.STARDUST_BROWSER_SLOTS, DEFAULTS.slots),
    ttlMs: num(env.STARDUST_BROWSER_TTL_MIN, DEFAULTS.ttlMin) * 60_000,
    waitMs: (over.waitS ?? num(env.STARDUST_BROWSER_WAIT, DEFAULTS.waitS)) * 1000,
    progressLog: env.STARDUST_PROGRESS_LOG ?? null,
  };
}
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function readSlots(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const file = join(dir, f);
    let rec = {}; try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch { rec = { corrupt: true }; }
    let mtime = 0; try { mtime = statSync(file).mtimeMs; } catch { /* vanished */ }
    return { file, ...rec, mtime };
  });
}
/** Live holders after deleting stale files. Returns { held, reaped }. */
export function census({ dir, ttlMs }, now = Date.now()) {
  const held = []; const reaped = [];
  for (const s of readSlots(dir)) {
    const stale = s.corrupt || !pidAlive(s.pid) || now - s.mtime > ttlMs;
    if (stale) { try { unlinkSync(s.file); } catch { /* raced */ } reaped.push(s); } else held.push(s);
  }
  return { held, reaped };
}
/** Advisory-lock race repair: after two simultaneous writes took the last slot, the holders past the budget
 *  (newest by mtime, then file name) back off — both racers compute the same order. Returns the surplus files. */
export function surplus(held, slots) {
  return [...held].sort((a, b) => a.mtime - b.mtime || (a.file < b.file ? -1 : 1)).slice(Math.max(0, slots)).map((h) => h.file);
}
const describe = (held) => held.map((h) => `pid ${h.pid} ${h.script ?? '?'} ${basename(h.project ?? '?')}`).join(', ');
const mmss = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
function note(cfg, line) {
  process.stderr.write(`browser-lock: ${line}\n`);
  if (cfg.progressLog) { try { appendFileSync(cfg.progressLog, `${new Date().toISOString()} waiting-slot ok ${line}\n`); } catch { /* log dir gone */ } }
}

/** Touch every slot file of <pid> so a long round outlives the TTL. Returns the count touched. */
export function refresh({ pid = process.pid, env = process.env, ...over } = {}) {
  const cfg = settings(env, over);
  let n = 0;
  const now = new Date();
  for (const s of readSlots(cfg.dir)) if (s.pid === pid) { try { utimesSync(s.file, now, now); n += 1; } catch { /* gone */ } }
  return n;
}
/** Take a slot or wait for one. Resolves { file, release, refresh } or null when disabled; rejects { code: 124 } on timeout.
 *  The returned slot keeps itself fresh (unref'd timer, TTL/3) until release() — an API holder never expires mid-round. */
export async function acquire({ pid = process.pid, script = basename(process.argv[1] ?? 'script'), project = process.cwd(), env = process.env, ...over } = {}) {
  const cfg = settings(env, over);
  if (cfg.slots <= 0) return null;
  mkdirSync(cfg.dir, { recursive: true });
  const t0 = Date.now();
  let lastNote = -Infinity;
  for (;;) {
    const { held } = census(cfg);
    if (held.length < cfg.slots) {
      const file = join(cfg.dir, `${pid}-${Date.now().toString(36)}.json`);
      writeFileSync(file, `${JSON.stringify({ pid, host: hostname().split('.')[0], project: resolve(project), script, since: new Date().toISOString() })}\n`);
      const after = census(cfg).held; // re-census: a simultaneous acquire may have taken the same last slot
      if (after.length <= cfg.slots || !surplus(after, cfg.slots).includes(file)) {
        const touch = () => { try { const n = new Date(); utimesSync(file, n, n); } catch { /* gone */ } };
        const timer = setInterval(touch, Math.max(50, Math.floor(cfg.ttlMs / 3)));
        timer.unref?.(); // never keeps the holder's process alive
        return { file, release: () => { clearInterval(timer); try { unlinkSync(file); } catch { /* gone */ } }, refresh: touch };
      }
      try { unlinkSync(file); } catch { /* gone */ } // over budget after the race — back off and wait like everyone else
    }
    const waited = Date.now() - t0;
    if (waited - lastNote >= NOTE_EVERY_MS) { note(cfg, `waiting for a slot (${held.length}/${cfg.slots} held by ${describe(held)}) ${mmss(waited)}`); lastNote = waited; }
    if (waited >= cfg.waitMs) {
      const err = new Error(`browser-lock: no slot within ${cfg.waitMs / 1000} s (${held.length}/${cfg.slots} held by ${describe(held)}) — exit ${DEADLINE_EXIT}, no verdict: re-queue the round or raise STARDUST_BROWSER_SLOTS (owner setting)`);
      err.code = DEADLINE_EXIT; throw err;
    }
    await sleep(Math.min(POLL_MS, cfg.waitMs - waited));
  }
}
/** The PROCESS's slot: one acquire per process however many browsers it launches, released on process exit.
 *  Memoised as a promise so concurrent callers share one wait; a rejected wait ({ code: 124 }) clears the memo. */
let processSlot = null;
export function acquireProcess(opts = {}) {
  processSlot ??= acquire(opts).then((slot) => { if (slot) process.on('exit', () => slot.release()); return slot; }, (e) => { processSlot = null; throw e; });
  return processSlot;
}
/** Remove this pid's slots (or all / only stale with all+stale). Returns the count removed. */
export function release({ pid = process.pid, all = false, stale = false, env = process.env, ...over } = {}) {
  const cfg = settings(env, over);
  if (stale) return census(cfg).reaped.length;
  let n = 0;
  for (const s of readSlots(cfg.dir)) if (all || s.pid === pid) { try { unlinkSync(s.file); n += 1; } catch { /* gone */ } }
  return n;
}
/** Orphan browser processes: chrome-headless-shell / chromium whose parent is gone (ppid 1), with age in minutes. */
export function orphanBrowsers() {
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,etime=,comm='], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m || !/chrome-headless-shell|chromium|Chromium|Google Chrome for Testing/.test(m[4])) continue;
    if (Number(m[2]) !== 1) continue;
    const p = m[3].split(/[-:]/).map(Number).reverse(); // ss, mm, hh, dd
    const minutes = (p[1] ?? 0) + (p[2] ?? 0) * 60 + (p[3] ?? 0) * 1440;
    out.push({ pid: Number(m[1]), minutes, comm: m[4].trim() });
  }
  return out;
}
export function status({ env = process.env, ...over } = {}) {
  const cfg = settings(env, over);
  const { held, reaped } = census(cfg);
  return { dir: cfg.dir, slots: cfg.slots, held: held.map(({ mtime, ...h }) => h), reapedStale: reaped.length, orphans: orphanBrowsers() };
}
export function reap({ minutes = DEFAULTS.reapMin } = {}) {
  const killed = [];
  for (const o of orphanBrowsers()) if (o.minutes >= minutes) { try { process.kill(o.pid, 'SIGKILL'); killed.push(o); } catch { /* gone or not ours */ } }
  return killed;
}

// ----------------------------------------------------------------------- CLI --
// main guard on REAL paths: the main module's import.meta.url is symlink-resolved (macOS /var → /private/var, a
// symlinked project dir) while argv[1] is not — a plain resolve() compare made the CLI exit 0 silently, no slot taken
const realOf = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && realOf(resolve(process.argv[1])) === realOf(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith('--'));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (n) => args.includes(`--${n}`);
  if (flag('help') || !['acquire', 'release', 'refresh', 'status', 'reap'].includes(cmd)) {
    const text = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
    console.log(text); process.exit(flag('help') ? 0 : 2);
  }
  const over = {};
  if (opt('lock-dir')) over.dir = resolve(opt('lock-dir'));
  const numArg = (n, min) => { // a NaN here would turn the --wait deadline into an infinite 0 ms poll
    const v = opt(n); if (v === undefined) return undefined;
    const x = Number(v);
    if (v === '' || !Number.isFinite(x) || x < min) { console.error(`browser-lock: --${n} needs a number ≥ ${min}, got ${JSON.stringify(v)} (--help)`); process.exit(2); }
    return x;
  };
  if (opt('slots') !== undefined) over.slots = numArg('slots', 0);
  if (opt('wait') !== undefined) over.waitS = numArg('wait', 0);
  const pid = opt('pid') !== undefined ? numArg('pid', 1) : process.ppid;
  const reapMin = opt('min') !== undefined ? numArg('min', 0) : DEFAULTS.reapMin;
  try {
    if (cmd === 'acquire') {
      if (flag('no-lock')) { console.log('browser-lock: disabled (--no-lock)'); process.exit(0); }
      const slot = await acquire({ pid, script: opt('script') ?? 'shell', project: opt('project') ?? process.cwd(), ...over });
      console.log(slot ? `acquired ${slot.file}` : 'browser-lock: disabled (STARDUST_BROWSER_SLOTS=0)');
      process.exit(0);
    }
    if (cmd === 'release') { console.log(`released ${release({ pid, all: flag('all'), stale: flag('stale'), ...over })}`); process.exit(0); }
    if (cmd === 'refresh') { console.log(`refreshed ${refresh({ pid, ...over })}`); process.exit(0); }
    if (cmd === 'status') {
      const s = status(over);
      if (flag('json')) console.log(JSON.stringify(s, null, 2));
      else console.log(`browser-lock: ${s.held.length}/${s.slots} slot(s) held${s.held.length ? ` (${describe(s.held)})` : ''} · ${s.reapedStale} stale reaped · ${s.orphans.length} orphan browser process(es)${s.orphans.length ? ` (oldest ${Math.max(...s.orphans.map((o) => o.minutes))} min)` : ''}`);
      process.exit(0);
    }
    if (cmd === 'reap') { const k = reap({ minutes: reapMin }); console.log(`browser-lock: reaped ${k.length} orphan browser process(es)${k.length ? ` (${k.map((o) => `pid ${o.pid} ${o.minutes} min`).join(', ')})` : ''}`); process.exit(0); }
  } catch (e) {
    console.error(e.message);
    process.exit(e.code === DEADLINE_EXIT ? DEADLINE_EXIT : 2);
  }
}
