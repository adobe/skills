#!/usr/bin/env node
/**
 * skills/replica/scripts/serve.mjs — the project's own static server, with identity
 *
 * Serves a directory (prototypes, a built harness) on the port `port.mjs`
 * allocates for the role, answers `/.stardust-marker.txt` with the project's
 * marker so every gate can assert WHOSE page it measures, refuses to start on
 * a taken port (exit 98 — the listener is printed, never killed), writes a
 * pidfile under `stardust/.work/` so `port.mjs stop <role>` can end THIS
 * server and nothing else, and exits with its parent (SIGHUP/SIGTERM/SIGINT).
 *
 * Replaces the `python3 -m http.server 8791` snippet — that one served any
 * project's files on the shared port with no way to tell whose (field record:
 * gate rounds measured a foreign prototype as "the build").
 *
 * Usage:
 *   node skills/replica/scripts/serve.mjs <dir> --role proto|harness [--port <n>] [--root <dir>] [--marker <s>] [--json]
 *     <dir>          directory to serve (no directory listings; `/` → index.html or 404)
 *     --role <r>     proto | harness — selects the port range and the pidfile name (required)
 *     --port <n>     pin the port (port.mjs still probes it — a foreign listener there is exit 98)
 *     --root <dir>   project root (default cwd) — ports.json / pidfile live under <root>/stardust/.work/
 *     --marker <s>   identity marker (default: ports.json's for the role, else the root's basename)
 *     --host <ip>    bind address (default 127.0.0.1)
 *     --json         print one JSON line { url, port, pid, marker, dir } instead of the prose line
 *     --help
 *
 * Responses: static files with a MIME table, `Cache-Control: no-store`,
 * `/.stardust-marker.txt` = marker (text/plain), 404 otherwise; paths never
 * escape <dir>; a malformed percent-escape is 400. Exit codes: 0 clean stop
 * (signal), 98 port already bound (EADDRINUSE / foreign listener), 1 usage or I/O error.
 */
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import { createServer } from 'http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { basename, extname, join, normalize, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import { allocate, listeners, readPorts, writePorts, pidFile, workDir, ROLES } from './port.mjs';

export const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.map': 'application/json' };
export const MARKER_PATH = '/.stardust-marker.txt';

const HELP = `serve — static server with a project marker; refuses a taken port, never kills a listener

Usage: node serve.mjs <dir> --role proto|harness [--port <n>] [--root <dir>] [--marker <s>] [--host <ip>] [--json]
Exit codes: 0 clean stop, 98 port already bound (listener printed), 1 usage / I/O error.`;

function parse(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { dir: null, role: null, port: null, root: process.cwd(), marker: null, json: false, host: '127.0.0.1' };
  const need = (flag, i) => { if (rest[i] === undefined || rest[i].startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return rest[i]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--role') o.role = need(a, ++i);
    else if (a === '--port') { o.port = Number(need(a, ++i)); if (!(o.port > 0)) { console.error(`--port needs a number\n\n${HELP}`); process.exit(1); } }
    else if (a === '--root') o.root = need(a, ++i);
    else if (a === '--marker') o.marker = need(a, ++i);
    else if (a === '--host') o.host = need(a, ++i);
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!o.dir) o.dir = a;
  }
  if (!o.dir || !ROLES.includes(o.role) || !o.root) { console.error(`need <dir> and --role proto|harness\n\n${HELP}`); process.exit(1); }
  if (!existsSync(o.dir) || !statSync(o.dir).isDirectory()) { console.error(`serve error: ${o.dir} is not a directory`); process.exit(1); }
  return o;
}

/** Request handler over `dir` answering the marker path — exported for the smoke test. */
export function handler(dir, marker) {
  const root = realpathSync(dir);
  return (req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, { 'cache-control': 'no-store' }); res.end('bad request (malformed path)'); return; } // a bad %-escape must never take the server down
    if (path === MARKER_PATH) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(`${marker}\n`); return; }
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (!(file === root || file.startsWith(root + sep))) { res.writeHead(403); res.end('forbidden'); return; }
    try {
      if (statSync(file).isDirectory()) { file = join(file, 'index.html'); if (!existsSync(file)) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('not found (no directory listings)'); return; } }
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('not found'); }
  };
}

async function main() {
  const o = parse(process.argv);
  let port = o.port; let marker = o.marker;
  try {
    const r = await allocate(o.role, { root: o.root, marker: o.marker, pin: o.port });
    if (r.status === 'own' && r.pid && r.pid !== process.pid) { console.error(`serve: this project already serves ${o.role} on :${r.port} (pid ${r.pid}) — reuse it, or \`port.mjs stop ${o.role}\` first`); process.exit(98); }
    port = r.port; marker = r.marker;
  } catch (e) {
    if (e.code === 3) { console.error(`serve: ${e.message}`); for (const f of e.foreign || []) console.error(`serve: :${f.port} pid ${f.pid || '?'} cwd ${f.cwd || '?'}`); process.exit(98); }
    throw e;
  }
  const srv = createServer(handler(o.dir, marker));
  await new Promise((res) => {
    srv.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`serve: port ${port} is already bound — not started, nothing killed.`);
        for (const l of listeners(port) || []) console.error(`serve: :${port} pid ${l.pid} ${l.command || ''} cwd ${l.cwd || '?'}`);
        process.exit(98);
      }
      console.error(`serve error: ${e.message}`); process.exit(1);
    });
    srv.listen(port, o.host, res);
  });
  mkdirSync(workDir(o.root), { recursive: true });
  const rec = { pid: process.pid, port, role: o.role, cwd: resolve(o.root), dir: resolve(o.dir), marker, startedAt: new Date().toISOString() };
  writeFileSync(pidFile(o.root, o.role), `${JSON.stringify(rec, null, 2)}\n`);
  writePorts(o.root, o.role, { ...(readPorts(o.root)[o.role] || {}), role: o.role, port, pid: process.pid, cwd: rec.cwd, marker, startedAt: rec.startedAt });
  const url = `http://${o.host}:${port}/`;
  if (o.json) console.log(JSON.stringify({ url, port, pid: process.pid, marker, dir: rec.dir }));
  else console.log(`serve: ${basename(rec.dir)}/ at ${url} (marker "${marker}", pid ${process.pid}; ${MARKER_PATH} answers the marker; stop with port.mjs stop ${o.role})`);
  const stop = () => { try { rmSync(pidFile(o.root, o.role), { force: true }); } catch { /* gone */ } srv.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); };
  for (const sig of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(sig, stop);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`serve error: ${e.message}`); process.exit(1); });
