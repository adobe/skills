#!/usr/bin/env node
/**
 * skills/replica/scripts/port.mjs — per-project port allocator (+ server identity)
 *
 * Every gate consumes a localhost URL, and every skill doc suggested the same
 * port — so on a shared machine a stale server from ANOTHER project served a
 * foreign site into the gate (field record: 41 collision events in 17
 * projects; three runs killed other projects' servers). This allocator hashes
 * the project root into a role range, skips the documented defaults, probes
 * the slot's listener and its cwd, REUSES an own listener, MOVES past a
 * foreign one (never kills it), and records the result in
 * `stardust/.work/ports.json` — the one file every snippet reads.
 *
 * Usage:
 *   node skills/replica/scripts/port.mjs <proto|harness> [--root <dir>] [--marker <s>] [--port <n>] [--json]
 *       print the role's port (allocate or reuse); write stardust/.work/ports.json
 *   node skills/replica/scripts/port.mjs stop <proto|harness> [--root <dir>]
 *       kill THIS project's server for the role (pidfile pid, cwd under root) — never a foreign pid
 *   node skills/replica/scripts/port.mjs list [--root <dir>] [--json]
 *       listeners on both ranges + the defaults, each own | foreign | orphan
 *     --root <dir>     project root (default cwd; ports.json lives under <root>/stardust/.work/)
 *     --marker <s>     identity marker recorded for the role (default: the root's basename)
 *     --port <n>       pin the port — still probed: a foreign listener there is exit 3, never reused;
 *                      `STARDUST_PORT_PROTO` / `STARDUST_PORT_HARNESS` pin the same way when the flag is absent
 *     --json           machine-readable output
 *
 * Ranges: proto 8800–8899, harness 3100–3199 (100 slots each, start = fnv1a(root) % 100);
 * 8791, 3000 and 8765 are never allocated — they stay the documented fallback
 * when ports.json is absent (B10/B33). Ownership = the listener's cwd is under
 * the project root (lsof); age is never a criterion.
 *
 * Exit codes:
 *   0  port printed (allocate / list) · server stopped or none running (stop)
 *   3  no free slot in the role range, or --port pinned to a foreign listener
 *   1  error (unknown role/flag, lsof unusable for the pin check)
 *
 * Importable: allocate(role, opts), envPin(role), listeners(port), parseLsof(text), cwdOf(pid), slotFor(root, role), RANGES, EXCLUDED.
 * Contract: ../reference/source-fidelity-gate.md § Per-breakpoint procedure (the snippet).
 */
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { spawnSync } from 'child_process';
import { createServer } from 'net';
import { pathToFileURL } from 'url';

export const RANGES = { proto: [8800, 8899], harness: [3100, 3199] };
export const EXCLUDED = new Set([8791, 3000, 8765]);
export const ROLES = Object.keys(RANGES);

const HELP = `port — per-project port allocator; never kills a foreign listener

Usage: node port.mjs <proto|harness> [--root <dir>] [--marker <s>] [--port <n>] [--json]
       node port.mjs stop <proto|harness> [--root <dir>]
       node port.mjs list [--root <dir>] [--json]
Pin:   --port <n>, else STARDUST_PORT_<ROLE> (STARDUST_PORT_PROTO / STARDUST_PORT_HARNESS) — probed like any slot, a foreign listener is exit 3.
Ranges: proto ${RANGES.proto.join('–')}, harness ${RANGES.harness.join('–')}; never ${[...EXCLUDED].join(', ')} (documented fallbacks).
Exit codes: 0 ok, 3 no free slot / pinned port foreign, 1 error.`;

export function fnv1a(str) { let h = 0x811c9dc5; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } }; // a symlinked checkout and its target are ONE project → one slot
export function slotFor(root, role) { const [lo] = RANGES[role]; return lo + (fnv1a(canon(root)) % 100); }
export const workDir = (root) => join(resolve(root), 'stardust', '.work');
export const portsFile = (root) => join(workDir(root), 'ports.json');
export const pidFile = (root, role) => join(workDir(root), `${role}.pid`);
const under = (cwd, root) => { try { const a = realpathSync(cwd); const b = realpathSync(root); return a === b || a.startsWith(b + sep); } catch { return false; } };

/**
 * Listeners on a TCP port or range ("8800-8899"): [{ pid, command, port, cwd }]
 * — cwd null when lsof cannot tell; null when lsof is missing (caller falls
 * back to a bind probe). ONE lsof call per query (a per-port loop over the
 * ranges took tens of seconds); cwd looked up once per pid.
 */
/** Parse `lsof -Fpcn` output: one row per LISTEN socket (a pid on several ports is several rows — the first `n` line alone used to hide the rest). */
export function parseLsof(text) {
  const out = []; let pid = null; let command = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1)); command = null; }
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n') && pid !== null) { const m = line.match(/:(\d+)$/); if (m && !out.some((o) => o.pid === pid && o.port === Number(m[1]))) out.push({ pid, command, port: Number(m[1]), cwd: null }); }
  }
  return out;
}
/** The LIVE cwd of a pid via lsof (null when lsof is missing or the pid is gone) — never trust a stored cwd for a pid that may have been recycled. */
export function cwdOf(pid) {
  const c = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }); /* -a ANDs the selectors — without it lsof lists every process's cwd */
  if (c.error) return null;
  const n = (c.stdout || '').split('\n').find((x) => x.startsWith('n')); return n ? n.slice(1) : null;
}
export function listeners(portOrRange) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${portOrRange}`, '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' });
  if (r.error) return null;
  const out = parseLsof(r.stdout);
  const cwds = new Map();
  for (const l of out) { if (!cwds.has(l.pid)) cwds.set(l.pid, cwdOf(l.pid)); l.cwd = cwds.get(l.pid); }
  return out;
}

/** true when nothing accepts on the port (bind probe — the lsof-less fallback). */
export function bindFree(port) {
  return new Promise((res) => { const s = createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
}

export function readPorts(root) { try { return JSON.parse(readFileSync(portsFile(root), 'utf8')); } catch { return {}; } }
export function writePorts(root, role, rec) {
  const all = readPorts(root); all[role] = rec;
  mkdirSync(workDir(root), { recursive: true }); writeFileSync(portsFile(root), `${JSON.stringify(all, null, 2)}\n`);
  return all;
}
export function readPid(root, role) { try { return JSON.parse(readFileSync(pidFile(root, role), 'utf8')); } catch { return null; } }
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Classify a listener for a root: own (cwd under root) | foreign (elsewhere) | unknown (no cwd). */
export function classify(l, root) { return l.cwd ? (under(l.cwd, root) ? 'own' : 'foreign') : 'unknown'; }

/**
 * Allocate (or reuse) the role's port. Returns { port, status: 'free'|'own', pid, marker, tried[], foreign[] }.
 * Throws { code: 3 } when the range has no free slot or a pinned port is foreign.
 */
/** The env pin for a role (`STARDUST_PORT_PROTO`, `STARDUST_PORT_HARNESS`): a positive integer, else null (a malformed value is exit 1, never silently ignored). */
export function envPin(role, env = process.env) {
  const raw = env[`STARDUST_PORT_${String(role).toUpperCase()}`];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(`STARDUST_PORT_${String(role).toUpperCase()}=${raw} is not a port number`), { code: 1 });
  return n;
}

export async function allocate(role, { root = process.cwd(), marker = null, pin = null } = {}) {
  if (!RANGES[role]) throw Object.assign(new Error(`unknown role ${role} — proto | harness`), { code: 1 });
  if (pin === null || pin === undefined) pin = envPin(role); // --port wins; the env pin is the same escape hatch for snippets that cannot pass a flag
  const [lo, hi] = RANGES[role]; const size = hi - lo + 1;
  const mk = marker || (readPorts(root)[role] || {}).marker || basename(resolve(root));
  const tried = []; const foreign = [];
  const probe = async (port) => {
    const ls = listeners(port);
    if (ls === null) return (await bindFree(port)) ? { status: 'free' } : { status: 'foreign', pid: null, cwd: null }; // no lsof: a taken port is never assumed ours
    if (!ls.length) return { status: 'free' };
    const own = ls.find((l) => classify(l, root) === 'own');
    if (own) return { status: 'own', pid: own.pid, cwd: own.cwd };
    return { status: 'foreign', pid: ls[0].pid, cwd: ls[0].cwd, command: ls[0].command };
  };
  const finish = (port, p) => { const rec = { role, port, pid: p.pid || null, cwd: resolve(root), marker: mk, startedAt: (readPorts(root)[role] || {}).startedAt || null, allocatedAt: new Date().toISOString() }; writePorts(root, role, rec); return { ...rec, status: p.status, tried, foreign }; };
  if (pin) {
    const p = await probe(pin); tried.push(pin);
    if (p.status === 'foreign') { foreign.push({ port: pin, ...p }); throw Object.assign(new Error(`--port ${pin} has a listener from outside this project (pid ${p.pid || '?'}, cwd ${p.cwd || '?'}) — listed, never killed; drop --port to move`), { code: 3, foreign }); }
    return finish(pin, p);
  }
  const start = slotFor(root, role);
  for (let i = 0; i < size; i += 1) {
    const port = lo + ((start - lo + i) % size);
    if (EXCLUDED.has(port)) continue;
    tried.push(port);
    const p = await probe(port);
    if (p.status === 'foreign') { foreign.push({ port, ...p }); continue; }
    return finish(port, p);
  }
  throw Object.assign(new Error(`no free slot in the ${role} range ${lo}–${hi} (${foreign.length} foreign listener(s) listed, none killed)`), { code: 3, foreign });
}

function parse(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(rest.length ? 0 : 1); }
  const o = { cmd: null, role: null, root: process.cwd(), marker: null, pin: null, json: false };
  const need = (flag, i) => { if (rest[i] === undefined || rest[i].startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return rest[i]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--root') o.root = need(a, ++i);
    else if (a === '--marker') o.marker = need(a, ++i);
    else if (a === '--port') { o.pin = Number(need(a, ++i)); if (!(o.pin > 0)) { console.error(`--port needs a number\n\n${HELP}`); process.exit(1); } }
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!o.cmd) o.cmd = a;
    else if (!o.role) o.role = a;
  }
  if (!o.root) { console.error(`--root needs a value\n\n${HELP}`); process.exit(1); }
  if (ROLES.includes(o.cmd)) { o.role = o.cmd; o.cmd = 'alloc'; }
  if (!['alloc', 'stop', 'list'].includes(o.cmd) || (o.cmd !== 'list' && !ROLES.includes(o.role))) { console.error(`usage error: ${rest.join(' ')}\n\n${HELP}`); process.exit(1); }
  return o;
}

async function main() {
  const o = parse(process.argv);
  if (o.cmd === 'alloc') {
    try {
      const r = await allocate(o.role, { root: o.root, marker: o.marker, pin: o.pin });
      if (o.json) console.log(JSON.stringify(r));
      else { console.log(String(r.port)); if (r.status === 'own') console.error(`port: reusing this project's ${o.role} server on :${r.port} (pid ${r.pid})`); for (const f of r.foreign) console.error(`port: :${f.port} is held by another project (pid ${f.pid || '?'}, cwd ${f.cwd || '?'}) — listed, not killed; moved on`); }
    } catch (e) { console.error(`port: ${e.message}`); process.exit(e.code || 1); }
    return;
  }
  if (o.cmd === 'stop') {
    const rec = readPid(o.root, o.role);
    if (!rec) { console.error(`port: no ${o.role} pidfile under ${workDir(o.root)} — nothing of this project's to stop`); return; }
    if (!alive(rec.pid)) { rmSync(pidFile(o.root, o.role), { force: true }); console.error(`port: ${o.role} pid ${rec.pid} is gone (orphan pidfile removed)`); return; }
    const liveCwd = cwdOf(rec.pid); // the pidfile's cwd is a claim; a recycled pid is a different process
    const cwd = liveCwd === null && spawnSync('lsof', ['-v'], { encoding: 'utf8' }).error ? (rec.cwd || '') : (liveCwd || '');
    if (!under(cwd, o.root)) { console.error(`port: pid ${rec.pid} runs with cwd ${cwd || '?'} outside ${o.root} (pidfile claimed ${rec.cwd}) — not this project's, not killed`); process.exit(1); }
    try { process.kill(rec.pid, 'SIGTERM'); } catch { /* raced */ }
    rmSync(pidFile(o.root, o.role), { force: true });
    console.error(`port: stopped this project's ${o.role} server pid ${rec.pid} on :${rec.port}`);
    return;
  }
  // list
  const rows = [];
  for (const role of ROLES) { const [lo, hi] = RANGES[role]; for (const l of listeners(`${lo}-${hi}`) || []) rows.push({ role, ...l, owner: classify(l, o.root) }); }
  for (const p of EXCLUDED) for (const l of listeners(p) || []) rows.push({ role: 'default', ...l, port: l.port || p, owner: classify(l, o.root) });
  for (const role of ROLES) { const rec = readPid(o.root, role); if (rec && !alive(rec.pid)) rows.push({ role, port: rec.port, pid: rec.pid, command: null, cwd: rec.cwd, owner: 'orphan' }); }
  if (o.json) console.log(JSON.stringify(rows));
  else if (!rows.length) console.log('port: nothing listening on the plugin ranges or the defaults');
  else for (const r of rows) console.log(`:${r.port}  ${r.owner.padEnd(7)} pid ${r.pid}  ${r.command || ''}  cwd ${r.cwd || '?'}${r.owner === 'foreign' ? '  (another project — never kill it; allocate moves past it)' : ''}`);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`port error: ${e.message}`); process.exit(e.code || 1); });
