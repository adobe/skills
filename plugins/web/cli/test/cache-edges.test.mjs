import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `smoke-edges-${process.pid}`;
const SW_PAGE = (title) =>
  `<html><head><title>${title}</title></head><body>${title}<script>
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
  </script></body></html>`;
const SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));`;
const SSE_PAGE = `<html><head><title>SSE</title></head><body>SSE<script>
  new EventSource('/events');
</script></body></html>`;
const hits = {};
let cwd;
let server;
let origin;

const web = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { cwd }, (err, stdout) => {
      resolve({ status: err ? err.code : 0, stdout });
    });
  });

const goto = (url) =>
  new Promise((resolve) => {
    execFile('playwright-cli', [`-s=${session}`, 'goto', url], () => resolve());
  });

// Same naming as harFileName in src/cache/har.mjs; the test only sees the built binary.
const harPath = (cache, url) => {
  const sha8 = createHash('sha256').update(url).digest('hex').slice(0, 8);
  return join(cache, `${new URL(url).hostname}_${sha8}.har`);
};
const firstEntry = (cache, url) =>
  JSON.parse(readFileSync(harPath(cache, url), 'utf8')).log.entries[0].request.url;

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-edges-smoke-'));
  server = createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    if (req.url === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(SW);
    }
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      return res.write('data: hello\n\n');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(req.url === '/sse' ? SSE_PAGE : SW_PAGE(req.url));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!available) return;
  await web('browser', 'close', '--session', session);
  server?.close();
  server?.closeAllConnections();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

test('a page that registers a service worker does not capture the next page', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const cache = join(cwd, 'sw-cache');
  const opened = await web(
    'browser',
    'open',
    `${origin}/first`,
    '--session',
    session,
    '--cache',
    cache,
  );
  assert.equal(opened.status, 0, opened.stdout);
  await goto(`${origin}/second`);
  const closed = await web('browser', 'close', '--session', session);
  assert.equal(closed.status, 0, closed.stdout);
  assert.equal(firstEntry(cache, `${origin}/first`), `${origin}/first`);
  assert.equal(firstEntry(cache, `${origin}/second`), `${origin}/second`);
});

test('an open event stream does not block close', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const cache = join(cwd, 'sse-cache');
  const opened = await web(
    'browser',
    'open',
    `${origin}/sse`,
    '--session',
    session,
    '--cache',
    cache,
  );
  assert.equal(opened.status, 0, opened.stdout);
  assert.equal(hits['/events'] >= 1, true);
  const start = performance.now();
  const closed = await web('browser', 'close', '--session', session);
  const seconds = (performance.now() - start) / 1000;
  assert.equal(closed.status, 0, closed.stdout);
  assert.ok(seconds < 15, `close took ${seconds.toFixed(1)} s`);
  assert.equal(existsSync(harPath(cache, `${origin}/sse`)), true);
});
