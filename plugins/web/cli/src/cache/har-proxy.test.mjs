import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHarProxy } from '#src/cache/har-proxy.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'har-proxy-'));
const writeHar = (dir, name, entries) =>
  writeFile(path.join(dir, name), JSON.stringify({ log: { version: '1.2', entries } }));
const start = (options) => startHarProxy({ port: 0, log: () => {}, ...options });

const collect = (res) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () =>
      resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
    );
    res.on('error', reject);
  });

const connectTunnel = (proxy, host) =>
  new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      method: 'CONNECT',
      path: `${host}:443`,
    });
    req.on('connect', (res, socket) => resolve(socket));
    req.on('error', reject);
    req.end();
  });

/** Send `targetUrl` through the proxy: CONNECT + TLS for https, absolute-form for http. */
async function viaProxy(proxy, targetUrl, { method = 'GET' } = {}) {
  const target = new URL(targetUrl);
  if (target.protocol === 'https:') {
    const socket = await connectTunnel(proxy, target.hostname);
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: target.hostname,
        port: 443,
        path: target.pathname + target.search,
        method,
        createConnection: () =>
          tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false }),
      });
      req.on('response', (res) => collect(res).then(resolve, reject));
      req.on('error', reject);
      req.end();
    });
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      path: targetUrl,
      method,
      headers: { host: target.host },
    });
    req.on('response', (res) => collect(res).then(resolve, reject));
    req.on('error', reject);
    req.end();
  });
}

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
const status = async (proxy) => (await fetch(`${proxy.url}/__status`)).json();

test('an HTTPS request recorded in a HAR is served from the file through the tunnel', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'page.html'), '<h1>cached</h1>');
  await writeHar(dir, 'site.har', [
    {
      request: { method: 'GET', url: 'https://site.test/' },
      response: {
        status: 200,
        headers: [
          { name: 'Content-Type', value: 'text/html' },
          { name: 'Content-Length', value: '9999' },
        ],
        content: { _file: 'page.html' },
      },
    },
  ]);
  const proxy = await start({ cacheDir: dir });
  try {
    assert.equal(proxy.entries, 1);
    assert.equal(proxy.url, `http://127.0.0.1:${proxy.port}`);
    const res = await viaProxy(proxy, 'https://site.test/');
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), '<h1>cached</h1>');
    assert.equal(res.headers['content-length'], String('<h1>cached</h1>'.length));
    assert.equal(res.headers['content-type'], 'text/html');
    assert.equal(proxy.stats.hits, 1);
  } finally {
    await proxy.stop();
  }
});

test('an HTTP miss goes live, is counted and never written to disk', async () => {
  const dir = await tmp();
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  const proxy = await start({ cacheDir: dir });
  const before = await readdir(dir, { recursive: true });
  try {
    const url = `http://127.0.0.1:${upstream.address().port}/x`;
    const res = await viaProxy(proxy, url);
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'ok');
    const s = await status(proxy);
    assert.equal(s.live, 1);
    assert.equal(s.misses, 1);
    assert.deepEqual(s.missed, [url]);
    assert.deepEqual(await readdir(dir, { recursive: true }), before);
  } finally {
    await proxy.stop();
    upstream.close();
  }
});

test('an upstream that never answers is a 502 after timeoutMs', async () => {
  const dir = await tmp();
  const upstream = await listen(() => {});
  const proxy = await start({ cacheDir: dir, timeoutMs: 200 });
  try {
    const res = await viaProxy(proxy, `http://127.0.0.1:${upstream.address().port}/slow`);
    assert.equal(res.status, 502);
    assert.equal((await status(proxy)).liveFailed, 1);
  } finally {
    await proxy.stop();
    upstream.closeAllConnections();
    upstream.close();
  }
});

test('a tracker miss is blocked with an empty 403 and not listed as missed', async () => {
  const dir = await tmp();
  const proxy = await start({ cacheDir: dir });
  try {
    const res = await viaProxy(proxy, 'https://www.google-analytics.com/collect');
    assert.equal(res.status, 403);
    assert.equal(res.body.length, 0);
    const s = await status(proxy);
    assert.equal(s.blocked, 1);
    assert.deepEqual(s.missed, []);
  } finally {
    await proxy.stop();
  }
});

test('an offline miss is a 504', async () => {
  const dir = await tmp();
  const proxy = await start({ cacheDir: dir, offline: true });
  try {
    const res = await viaProxy(proxy, 'https://site.test/missing.js');
    assert.equal(res.status, 504);
    assert.deepEqual((await status(proxy)).missed, ['https://site.test/missing.js']);
  } finally {
    await proxy.stop();
  }
});

test('GET /__stop shuts the proxy down', async () => {
  const proxy = await start({ cacheDir: await tmp() });
  assert.equal((await fetch(`${proxy.url}/__stop`)).status, 200);
  await proxy.closed;
});

test('stop() closes an open keep-alive tunnel', async () => {
  const dir = await tmp();
  const proxy = await start({ cacheDir: dir, offline: true });
  const socket = await connectTunnel(proxy, 'site.test');
  const tlsSocket = tls.connect({ socket, servername: 'site.test', rejectUnauthorized: false });
  tlsSocket.on('error', () => {});
  await new Promise((resolve) => tlsSocket.once('secureConnect', resolve));
  const ended = new Promise((resolve) => tlsSocket.once('close', resolve));
  await proxy.stop();
  await ended;
});

test('a second start on the same dir reuses the certificate', async () => {
  const dir = await tmp();
  const first = await start({ cacheDir: dir });
  await first.stop();
  const cert = await readFile(path.join(dir, '.cert', 'cert.pem'));
  const second = await start({ cacheDir: dir });
  await second.stop();
  assert.deepEqual(await readFile(path.join(dir, '.cert', 'cert.pem')), cert);
});

test('an unreadable HAR rejects with a USAGE error', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'bad.har'), 'not json');
  await assert.rejects(start({ cacheDir: dir }), (err) => err.code === 'USAGE');
});

test('/__stop from a cross-site page answers 403 and leaves the proxy running', async () => {
  const proxy = await start({ cacheDir: await tmp() });
  try {
    const res = await fetch(`${proxy.url}/__stop`, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 403);
    assert.equal((await fetch(`${proxy.url}/__status`)).status, 200);
  } finally {
    await proxy.stop();
  }
});
