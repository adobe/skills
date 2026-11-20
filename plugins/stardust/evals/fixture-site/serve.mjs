#!/usr/bin/env node
// The fixture site of the stardust evals: a small static store site served on localhost, so a
// scenario has a concrete, stable target that needs no external network and names no real site.
//
// Usage: node plugins/stardust/evals/fixture-site/serve.mjs [--port 8780] [--idle-exit <seconds>]
//
//   /                      a store home page: header, hero, "today" band, product cards, about, footer
//   /visit/                a store visit page: header, opening hours, directions, "today" band, footer (the small page)
//   /?unstable=1           either page with a notice block whose HEIGHT differs on every load — a page
//   /visit/?unstable=1     that is not one page between two captures (reference.mjs freeze exits 2)
//   /__fixture             the identity and load counter as JSON: {"fixture":"stardust-evals-store",…}
//
// What changes between loads: the "today" band of both pages is painted from a per-request
// counter (same text, same height, other colours) — the noise floor and the self-varying rows a
// frozen reference measures and masks. Everything else is byte-stable. Responses are never cached.
//
//   --port <n>             default 8780, or PORT from the environment; exit 1 when the port is taken
//   --idle-exit <seconds>  stop after this long without a request (a detached server cleans up
//                          after itself: the eval tooling has no teardown step); default: never
//   --help                 this text, before any I/O
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const PORT = Number(opt('--port', process.env.PORT || 8780));
const IDLE = Number(opt('--idle-exit', 0));
if (!Number.isInteger(PORT) || PORT < 1 || !(IDLE >= 0)) { console.error('serve.mjs: --port <n> and --idle-exit <seconds> take numbers'); process.exit(125); }

const SITE = join(dirname(fileURLToPath(import.meta.url)), 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const part = (name) => readFileSync(join(SITE, name), 'utf8');

let loads = 0;
let last = Date.now();

// The "today" band: twelve tiles and a ground colour picked from the load counter. Same box, other paint.
function todayBand(n) {
  const hue = (n * 67) % 360;
  const tiles = Array.from({ length: 12 }, (_, i) => `<i style="background:hsl(${(hue + i * 29 + n * 13) % 360} 62% ${38 + ((i + n) % 4) * 9}%)"></i>`).join('');
  return `<div class="today-paint" style="background:hsl(${hue} 46% 88%)" aria-hidden="true">${tiles}</div>`;
}

// The unstable switch: a notice whose height steps by at least 70 px from one load to the next.
function notice(n) {
  return `<div class="notice" style="height:${90 + (n % 5) * 70}px"><p>Stock is being counted. This notice changes size on every visit.</p></div>`;
}

function page(file, url, n) {
  return part(file)
    .replace('<!--header-->', part('_header.html'))
    .replace('<!--footer-->', part('_footer.html'))
    .replace('<!--today-->', todayBand(n))
    .replace('<!--notice-->', url.searchParams.has('unstable') ? notice(n) : '');
}

const server = createServer((req, res) => {
  last = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  if (url.pathname === '/__fixture') return send(200, 'application/json', JSON.stringify({ fixture: 'stardust-evals-store', loads, pid: process.pid }));
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (rel === '' || rel.endsWith(sep)) rel += 'index.html';
  const file = join(SITE, rel);
  const type = TYPES[extname(file)];
  if (!file.startsWith(SITE + sep) || rel.startsWith('_') || !type || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain; charset=utf-8', 'Not found\n');
  if (type.startsWith('text/html')) return send(200, type, page(rel, url, (loads += 1)));
  return send(200, type, readFileSync(file));
});
server.on('error', (e) => { console.error(`serve.mjs: ${e.code === 'EADDRINUSE' ? `port ${PORT} is taken` : e.message}`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log(`fixture site on http://localhost:${PORT}/ (pid ${process.pid})`));
if (IDLE > 0) setInterval(() => { if (Date.now() - last > IDLE * 1000) process.exit(0); }, Math.min(IDLE * 1000, 30000)).unref?.();
