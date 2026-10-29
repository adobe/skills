import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const session = `smoke-cache-${process.pid}`;
const page = (title) =>
  `<html><head><title>${title}</title><link rel="stylesheet" href="/s.css"></head>` +
  `<body><h1>${title}</h1><script src="/s.js"></script></body></html>`;
const ROUTES = {
  '/a': ['text/html', page('A')],
  '/b': ['text/html', page('B')],
  '/s.css': ['text/css', 'h1 { color: rgb(1, 2, 3); }'],
  '/s.js': ['text/javascript', 'document.title += "!";'],
};
const hits = {};
let cwd;
let server;
let origin;

const web = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [binPath, ...args], { encoding: 'utf8', cwd }, (err, stdout) => {
      let doc = null;
      try {
        doc = JSON.parse(stdout);
      } catch {
        // Left null: the assertion shows stdout.
      }
      resolve({ status: err ? err.code : 0, doc, stdout });
    });
  });

const goto = (url) =>
  new Promise((resolve) => {
    execFile('playwright-cli', [`-s=${session}`, 'goto', url], () => resolve());
  });

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-cache-smoke-'));
  server = createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    const route = ROUTES[req.url];
    if (!route) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': route[0] });
    return res.end(route[1]);
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

async function browse(cache) {
  const opened = await web(
    'browser',
    'open',
    `${origin}/a`,
    '--session',
    session,
    '--cache',
    cache,
  );
  assert.equal(opened.status, 0, opened.stdout);
  const state = JSON.parse(readFileSync(join(cwd, '.web', `${session}-cache-keeper.json`), 'utf8'));
  await goto(`${origin}/b`);
  const closed = await web('browser', 'close', '--session', session);
  assert.equal(closed.status, 0, closed.stdout);
  return { opened: opened.doc, closed: closed.doc, pid: state.pid };
}

test('session cache records pages and replays shared assets', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const cache = join(cwd, 'har-cache');

  const first = await browse(cache);
  assert.deepEqual(first.opened.cache, { dir: cache, entries: 0 });
  assert.equal(first.closed.cache.stored, 4, first.closed.stdout);
  const files = readdirSync(cache);
  assert.equal(files.filter((f) => f.endsWith('.har')).length, 2, files.join(' '));
  assert.equal(files.filter((f) => f.endsWith('.css')).length, 1, files.join(' '));

  const second = await browse(cache);
  assert.equal(second.opened.cache.entries, 4);
  assert.ok(second.closed.cache.hits >= 4, JSON.stringify(second.closed.cache));
  assert.equal(second.closed.cache.errors, 0);
  for (const path of Object.keys(ROUTES)) assert.equal(hits[path], 1, `${path}: ${hits[path]}`);
  assert.equal(isAlive(second.pid), false);
  assert.equal(existsSync(join(cwd, '.web', `${session}-cache-keeper.json`)), false);
});
