#!/usr/bin/env node
/**
 * skills/stardust/scripts/run-lock.mjs — the session advisory lock.
 *
 * One JSON object at `<root>/stardust/.work/run.lock`:
 *   { "sessionId", "pid", "startedAt", "refreshedAt", "skill", "owns": [] }
 *
 * The lock is HELD while the file exists, `refreshedAt` is under STALE_HOURS
 * old and — when a pid is recorded — that pid is alive. Otherwise it is
 * STALE and the next `acquire` overwrites it. It never blocks its owner and
 * merges nothing (page-entry races stay last-write-wins, see
 * `reference/state-machine.md` § Concurrency); it tells a second session
 * that a run is in progress and which paths it is writing.
 *
 * Usage:
 *   node skills/stardust/scripts/run-lock.mjs check   [--root <dir>] [--session <id>]
 *   node skills/stardust/scripts/run-lock.mjs acquire [--root <dir>] [--session <id>] --skill <name> [--owns a,b] [--pid <n>] [--force]
 *   node skills/stardust/scripts/run-lock.mjs refresh [--root <dir>] [--session <id>] --skill <name> [--owns a,b]
 *   node skills/stardust/scripts/run-lock.mjs release [--root <dir>] [--session <id>] [--force]
 *
 * `--session` defaults to $STARDUST_SESSION_ID; `acquire` mints one when
 * neither is given and prints it. Pass it back on `refresh`/`release`/`check`
 * so the lock recognises its owner; without it, `refresh` and `release` act
 * on the lock unconditionally (advisory lock — phase skills of the running
 * session call them). `--pid` records a long-lived process to test with
 * `kill -0`; harnesses that spawn a fresh shell per command have none, so the
 * staleness window is the backstop there.
 *
 * Exit codes: 0 free / own / stale (check), done (acquire, refresh, release);
 *             3 held by another live session (check prints the state-report
 *               line `Active run: …`; acquire/refresh/release refuse unless --force);
 *             2 usage or I/O error.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hostname } from 'node:os';

export const HELD_EXIT = 3;
export const STALE_HOURS = 2;

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('--'));
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);

if (flag('help') || !cmd || !['check', 'acquire', 'refresh', 'release'].includes(cmd)) {
  const usage = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith(' * ')).map((l) => l.slice(3)).join('\n');
  console.log(usage);
  process.exit(flag('help') ? 0 : 2);
}

const root = resolve(opt('root') ?? process.cwd());
const lockPath = join(root, 'stardust', '.work', 'run.lock');
const session = opt('session') ?? process.env.STARDUST_SESSION_ID;
const force = flag('force');
const skill = opt('skill');
const owns = opt('owns') ? opt('owns').split(',').map((s) => s.trim()).filter(Boolean) : undefined;

export function readLock(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { corrupt: true }; }
}
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null; // unknown
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function classify(lock, sessionId, now = Date.now()) {
  if (!lock) return 'free';
  if (lock.corrupt) return 'stale';
  if (sessionId && lock.sessionId === sessionId) return 'own';
  const age = now - Date.parse(lock.refreshedAt ?? lock.startedAt ?? 0);
  if (!Number.isFinite(age) || age > STALE_HOURS * 3_600_000) return 'stale';
  if (pidAlive(lock.pid) === false) return 'stale';
  return 'held';
}
const describe = (lock) => `${lock.skill ?? '?'} in session ${lock.sessionId ?? '?'} since ${lock.startedAt ?? '?'}`;
const write = (lock) => { mkdirSync(dirname(lockPath), { recursive: true }); writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`); };
const mint = () => `${hostname().split('.')[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const lock = readLock(lockPath);
const state = classify(lock, session);
const now = new Date().toISOString();

if (cmd === 'check') {
  if (state === 'held') { console.log(`Active run: ${describe(lock)} — read-only unless you take over`); process.exit(HELD_EXIT); }
  if (state === 'stale') console.log(`stale ${lock.corrupt ? '(unreadable lock)' : `${describe(lock)}, last refreshed ${lock.refreshedAt ?? '?'}`}`);
  else if (state === 'own') console.log(`own ${describe(lock)}`);
  else console.log('free');
  process.exit(0);
}

if (cmd === 'acquire') {
  if (!skill) { console.error('acquire: --skill <name> is required'); process.exit(2); }
  if (state === 'held' && !force) { console.error(`held: ${describe(lock)} — pass --force to take over`); process.exit(HELD_EXIT); }
  const own = state === 'own';
  const pid = opt('pid') ? Number(opt('pid')) : (own ? lock.pid ?? null : null);
  const next = {
    sessionId: own ? lock.sessionId : (session ?? mint()),
    pid,
    startedAt: own ? lock.startedAt : now,
    refreshedAt: now,
    skill,
    owns: owns ?? (own ? lock.owns ?? [] : []),
  };
  write(next);
  console.log(`acquired ${next.sessionId}${state === 'held' ? ' (took over)' : ''}`);
  process.exit(0);
}

if (cmd === 'refresh') {
  if (!skill) { console.error('refresh: --skill <name> is required'); process.exit(2); }
  if (state === 'held' && session && !force) { console.error(`held: ${describe(lock)} — not yours; --force to take over`); process.exit(HELD_EXIT); }
  if (state === 'free' || state === 'stale') {
    write({ sessionId: session ?? mint(), pid: null, startedAt: now, refreshedAt: now, skill, owns: owns ?? [] });
    console.log('acquired (no live lock to refresh)');
    process.exit(0);
  }
  write({ ...lock, refreshedAt: now, skill, owns: owns ?? lock.owns ?? [] });
  console.log(`refreshed ${lock.sessionId}`);
  process.exit(0);
}

if (cmd === 'release') {
  if (state === 'free') { console.log('free (nothing to release)'); process.exit(0); }
  if (state === 'held' && session && !force) { console.error(`held: ${describe(lock)} — not yours; --force to release`); process.exit(HELD_EXIT); }
  try { unlinkSync(lockPath); } catch (e) { console.error(`release: ${e.message}`); process.exit(2); }
  console.log(`released ${lock.sessionId ?? ''}`.trim());
  process.exit(0);
}
