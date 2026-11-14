import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cachePath, startCacheProxy } from '#src/cache/proxy.mjs';

const listen = (handler) =>
  new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () =>
      resolve({ server: s, origin: `http://127.0.0.1:${s.address().port}` }),
    );
  });

async function start(options) {
  const p = await startCacheProxy({ port: 0, ...options });
  return { url: `http://127.0.0.1:${p.port}`, stop: p.stop };
}

test('/x and /x/ map to different files', () => {
  assert.notEqual(cachePath('/c', 'http://a.test/x'), cachePath('/c', 'http://a.test/x/'));
});

test('a long query is hashed so the path stays short', () => {
  const p = cachePath('/c', `http://a.test/a.js?${'q'.repeat(300)}`);
  assert.ok(p.length < 200);
});

test('a non-GET request is refused with 405', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-405-'));
  const p = await start({ cacheDir: dir });
  try {
    assert.equal((await fetch(`${p.url}/?_origin=http://x.test`, { method: 'POST' })).status, 405);
  } finally {
    await p.stop();
  }
});

test('a request without an origin is a 400, an unenrolled cookie origin a 403', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-400-'));
  const p = await start({ cacheDir: dir });
  try {
    assert.equal((await fetch(`${p.url}/`)).status, 400);
    const res = await fetch(`${p.url}/`, {
      headers: { cookie: 'page-cache-origin=http%3A%2F%2Fx.test' },
    });
    assert.equal(res.status, 403);
  } finally {
    await p.stop();
  }
});

test("--also: another origin's assets go through the proxy, cached, served offline", async () => {
  const hits = { site: 0, cdn: 0 };
  const cdn = await listen((req, res) => {
    hits.cdn += 1;
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(`jpeg:${req.url}`);
  });
  const seenBySite = [];
  const site = await listen((req, res) => {
    hits.site += 1;
    seenBySite.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<html><body><img src="${cdn.origin}/a.jpg">` +
        `<img srcset="${cdn.origin}/b.jpg?w=1 1x, ${cdn.origin}/b.jpg?w=2 2x">` +
        `<a href="${cdn.origin}">cdn</a><a href="${cdn.origin}.evil/x">not cdn</a>` +
        `<img src="${cdn.origin.replace(/^http:/, '')}/d.jpg">` +
        `<style>.h{background:url(${cdn.origin}/c.png)}</style></body></html>`,
    );
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-also-'));
  const enc = encodeURIComponent(cdn.origin);
  try {
    // 1. Cached without --also: the page keeps the CDN's absolute URLs.
    const plain = await start({ cacheDir: dir });
    const first = await fetch(`${plain.url}/?_origin=${site.origin}`).then((r) => r.text());
    assert.match(first, new RegExp(`src="${cdn.origin}/a.jpg"`));
    await plain.stop();

    // 2. With --also, the same cached page is served rewritten; assets fetched once.
    const also = await start({ cacheDir: dir, also: [cdn.origin] });
    const status = await fetch(`${also.url}/__status`).then((r) => r.json());
    assert.deepEqual(status.also, [cdn.origin]);
    const res = await fetch(`${also.url}/?_origin=${site.origin}`);
    const html = await res.text();
    assert.equal(res.headers.get('x-page-cache'), 'hit');
    assert.equal(hits.site, 1, 'not fetched again');
    assert.match(html, new RegExp(`src="/a.jpg\\?_origin=${enc}"`));
    assert.match(
      html,
      new RegExp(`srcset="/b.jpg\\?w=1&_origin=${enc} 1x, /b.jpg\\?w=2&_origin=${enc} 2x"`),
    );
    assert.match(html, new RegExp(`href="/\\?_origin=${enc}"`), 'a bare origin');
    assert.match(html, new RegExp(`href="${cdn.origin}.evil/x"`), 'another host untouched');
    assert.match(html, new RegExp(`src="/d.jpg\\?_origin=${enc}"`), 'a protocol-relative one');
    assert.match(html, new RegExp(`url\\(/c.png\\?_origin=${enc}\\)`));
    const img = await fetch(`${also.url}/a.jpg?_origin=${enc}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(img.status, 200);
    assert.equal(await img.text(), 'jpeg:/a.jpg');
    assert.equal(img.headers.get('set-cookie'), null, 'an asset origin is never the page origin');
    assert.equal(hits.cdn, 1);
    await fetch(`${also.url}/b.jpg?w=1&_origin=${enc}`).then((r) => r.arrayBuffer());
    assert.equal(hits.cdn, 2);
    await also.stop();

    // 3. Offline: page and assets from the cache, page still rewritten.
    const offline = await start({ cacheDir: dir, also: [cdn.origin], offline: true });
    const off = await fetch(`${offline.url}/?_origin=${site.origin}`).then((r) => r.text());
    assert.match(off, new RegExp(`src="/a.jpg\\?_origin=${enc}"`));
    const offImg = await fetch(`${offline.url}/a.jpg?_origin=${enc}`);
    assert.equal(offImg.status, 200);
    assert.equal(await offImg.text(), 'jpeg:/a.jpg');
    assert.equal((await fetch(`${offline.url}/zzz.jpg?_origin=${enc}`)).status, 504);
    assert.equal(hits.cdn, 2, 'nothing fetched offline');
    await offline.stop();

    // 4. /x and /x/ are two files: a stored /x -> /x/ redirect never answers /x/.
    const loop = await start({ cacheDir: dir });
    const redirectSite = await listen((req, res) => {
      if (req.url === '/x') {
        res.writeHead(301, { location: '/x/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<p>${req.url}</p>`);
    });
    try {
      const first = await fetch(`${loop.url}/x?_origin=${redirectSite.origin}`, {
        redirect: 'manual',
      });
      assert.equal(first.status, 301);
      const second = await fetch(`${loop.url}/x/?_origin=${redirectSite.origin}`);
      assert.equal(second.status, 200);
      assert.equal(await second.text(), '<p>/x/</p>');
    } finally {
      redirectSite.server.close();
      await loop.stop();
    }

    // 5. The query goes upstream verbatim: a bare `$responsive$` stays what it was.
    const verbatim = await start({ cacheDir: dir });
    await fetch(
      `${verbatim.url}/img?qlt=82&$responsive$&fit=constrain&_origin=${site.origin}`,
    ).then((r) => r.arrayBuffer());
    assert.equal(seenBySite.at(-1), '/img?qlt=82&$responsive$&fit=constrain');
    await fetch(`${verbatim.url}/img?_origin=${site.origin}&a=1`).then((r) => r.arrayBuffer());
    assert.equal(seenBySite.at(-1), '/img?a=1');
    await verbatim.stop();
  } finally {
    cdn.server.close();
    site.server.close();
  }
});

test('a query cannot write outside the cache directory', async () => {
  const site = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('upstream');
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'page-cache-escape-'));
  const victim = path.join(root, 'victim.txt');
  await writeFile(victim, 'mine');
  const p = await start({ cacheDir: path.join(root, 'cache') });
  try {
    const res = await fetch(`${p.url}/a.txt?x/../../../victim&_origin=${site.origin}`);
    assert.equal(res.status, 200);
    assert.equal(await readFile(victim, 'utf-8'), 'mine');
    const stored = cachePath(path.join(root, 'cache'), `${site.origin}/a.txt?x/../../../victim`);
    assert.ok(stored.startsWith(path.join(root, 'cache') + path.sep));
  } finally {
    site.server.close();
    await p.stop();
  }
});

test('a Range or conditional request is cached as the full resource', async () => {
  const seen = [];
  const site = await listen((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('abcdef');
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-range-'));
  const p = await start({ cacheDir: dir });
  try {
    const first = await fetch(`${p.url}/f.txt?_origin=${site.origin}`, {
      headers: {
        range: 'bytes=0-1',
        'if-none-match': '"x"',
        'if-modified-since': 'Wed, 01 Jan 2020 00:00:00 GMT',
      },
    });
    assert.equal(first.status, 200);
    assert.equal(await first.text(), 'abcdef');
    assert.equal(seen[0].range, undefined);
    assert.equal(seen[0]['if-none-match'], undefined);
    assert.equal(seen[0]['if-modified-since'], undefined);
    assert.equal(
      await fetch(`${p.url}/f.txt?_origin=${site.origin}`).then((r) => r.text()),
      'abcdef',
    );
  } finally {
    site.server.close();
    await p.stop();
  }
});

test('--also: a CDN stylesheet and redirect keep routing to the CDN', async () => {
  const cdn = await listen((req, res) => {
    if (req.url === '/old.png') {
      res.writeHead(302, { location: '/new.png' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': req.url.startsWith('/css/') ? 'text/css' : 'image/png' });
    return res.end(
      req.url.startsWith('/css/')
        ? `a{background:url(../img/a.png)} b{background:url(b.png)} c{background:url(${cdn.origin}/c.png)} d{background:url(data:image/png;base64,AA==)}`
        : `png:${req.url}`,
    );
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-cdn-'));
  const enc = encodeURIComponent(cdn.origin);
  const p = await start({ cacheDir: dir, also: [cdn.origin] });
  try {
    const css = await fetch(`${p.url}/css/site.css?_origin=${cdn.origin}`).then((r) => r.text());
    assert.match(css, new RegExp(`url\\(/img/a.png\\?_origin=${enc}\\)`), 'parent-relative');
    assert.match(css, new RegExp(`url\\(/css/b.png\\?_origin=${enc}\\)`), 'sibling-relative');
    assert.match(css, new RegExp(`url\\(/c.png\\?_origin=${enc}\\)`), 'absolute on the CDN');
    assert.match(css, /url\(data:image\/png;base64,AA==\)/, 'data URI untouched');
    const redirect = await fetch(`${p.url}/old.png?_origin=${cdn.origin}`, { redirect: 'manual' });
    assert.equal(redirect.headers.get('location'), `/new.png?_origin=${enc}`);
  } finally {
    cdn.server.close();
    await p.stop();
  }
});

test('no two URLs share a file, and no body overwrites a sidecar', () => {
  const urls = [
    'http://a.test/x.html',
    'http://a.test/x.html.json',
    'http://a.test/x.html{meta}.json',
    'http://a.test/a.html?b',
    'http://a.test/a!b.html',
    'http://a.test/x',
    'http://a.test/x/',
    'http://a.test/x/index.html',
    'http://a.test/x/index~.html',
  ];
  const bodies = urls.map((u) => cachePath('/c', u));
  const files = [...bodies, ...bodies.map((b) => `${b}{meta}.json`)];
  assert.equal(new Set(files).size, files.length);
});

test('a .json URL next to its .html sibling leaves both servable', async () => {
  const site = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`body of ${req.url}`);
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'page-cache-sidecar-'));
  const p = await start({ cacheDir: dir });
  try {
    const get = (u) => fetch(`${p.url}${u}?_origin=${site.origin}`).then((r) => r.text());
    await get('/x.html');
    await get('/x.html.json');
    assert.equal(await get('/x.html'), 'body of /x.html');
    assert.equal(await get('/x.html.json'), 'body of /x.html.json');
  } finally {
    site.server.close();
    await p.stop();
  }
});
