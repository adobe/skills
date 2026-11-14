import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `smoke-status-${process.pid}`;
const html = (title) =>
  `<html><head><title>${title}</title><link rel="stylesheet" href="/s.css"></head>` +
  `<body>${title}</body></html>`;
const ROUTES = {
  '/old': [301, { location: '/mid' }, ''],
  '/mid': [302, { location: '/a' }, ''],
  '/a': [200, { 'content-type': 'text/html' }, html('A')],
  '/s.css': [200, { 'content-type': 'text/css' }, 'body { color: red; }'],
  '/missing': [404, { 'content-type': 'text/html' }, html('Not found')],
  '/blocked': [403, { 'content-type': 'text/html' }, html('Access denied')],
  '/boom': [500, { 'content-type': 'text/html' }, html('Server error')],
};
const ERRORS = { '/missing': 404, '/blocked': 403, '/boom': 500 };
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
const harOf = (cache, url) => {
  const sha8 = createHash('sha256').update(url).digest('hex').slice(0, 8);
  const file = join(cache, `${new URL(url).hostname}_${sha8}.har`);
  return JSON.parse(readFileSync(file, 'utf8')).log;
};

async function browse(cache) {
  const opened = await web(
    'browser',
    'open',
    `${origin}/old`,
    '--session',
    session,
    '--cache',
    cache,
  );
  assert.equal(opened.status, 0, opened.stdout);
  for (const path of Object.keys(ERRORS)) await goto(origin + path);
  const closed = await web('browser', 'close', '--session', session);
  assert.equal(closed.status, 0, closed.stdout);
}

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-status-smoke-'));
  server = createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    const [status, headers, body] = ROUTES[req.url] ?? [404, {}, ''];
    res.writeHead(status, headers);
    res.end(body);
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

test('session cache records original statuses and re-checks errors', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const cache = join(cwd, 'har-cache');
  await browse(cache);

  const chain = harOf(cache, `${origin}/old`);
  assert.deepEqual(
    chain.entries.map((e) => [e.response.status, e.request.url, e.response.redirectURL]),
    [
      [301, `${origin}/old`, `${origin}/mid`],
      [302, `${origin}/mid`, `${origin}/a`],
      [200, `${origin}/a`, ''],
      [200, `${origin}/s.css`, ''],
    ],
  );
  for (const [path, status] of Object.entries(ERRORS)) {
    const log = harOf(cache, origin + path);
    assert.equal(log.pages[0].title, origin + path);
    assert.deepEqual(
      log.entries.map((e) => [e.response.status, e.request.url]),
      [
        [status, origin + path],
        [200, `${origin}/s.css`],
      ],
    );
    assert.ok(log.entries.every((e) => e.pageref === log.pages[0].id));
  }

  await browse(cache);
  for (const path of Object.keys(ERRORS)) assert.equal(hits[path], 2, `${path}: ${hits[path]}`);
  assert.equal(hits['/old'], 1);
  assert.equal(hits['/s.css'], 1);
});
