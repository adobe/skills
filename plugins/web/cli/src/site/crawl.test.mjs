import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import {
  crawl,
  extractLinks,
  failureMessage,
  globToRegExp,
  langOf,
  parseSitemap,
} from '#src/site/crawl.mjs';

async function site(routes) {
  const server = createServer((req, res) => {
    const r = routes[req.url];
    if (!r) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(r.status ?? 200, {
      'content-type': r.type ?? 'text/html',
      ...(r.location && { location: r.location(origin) }),
    });
    return res.end(typeof r.body === 'function' ? r.body(origin) : (r.body ?? ''));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => server.close() };
}

const urlset = (...locs) =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

test('globToRegExp: * spans slashes, ? is one character, dots are literal', () => {
  assert.ok(globToRegExp('/blog/**').test('/blog/a/b'));
  assert.ok(globToRegExp('/a?').test('/ab'));
  assert.ok(!globToRegExp('/a?').test('/a'));
  assert.ok(!globToRegExp('/a.html').test('/aXhtml'));
});

test('langOf reads a language from the first path segment only', () => {
  assert.equal(langOf('/fr-fr/x'), 'fr-FR');
  assert.equal(langOf('/de/x'), 'de');
  assert.equal(langOf('/blog/x'), '');
  assert.equal(langOf('/'), '');
});

test('parseSitemap decodes entities and tells an index from a urlset', () => {
  assert.deepEqual(parseSitemap(urlset('http://a/x?a=1&amp;b=2')), {
    index: false,
    locs: ['http://a/x?a=1&b=2'],
  });
  assert.equal(
    parseSitemap('<sitemapindex><sitemap><loc>http://a/s.xml</loc></sitemap></sitemapindex>').index,
    true,
  );
});

test('extractLinks resolves relative links and drops fragments and mailto', () => {
  const html = `<a href="/a#top">x</a><a class=c href='b'>y</a><a href="mailto:x@y.z">m</a>`;
  assert.deepEqual(extractLinks(html, 'http://h.test/dir/'), [
    'http://h.test/a',
    'http://h.test/dir/b',
  ]);
});

test('sitemaps: robots.txt, an index, gzip, filters, dedupe and other origins', async () => {
  const s = await site({
    '/robots.txt': { type: 'text/plain', body: (o) => `Sitemap: ${o}/index.xml` },
    '/index.xml': {
      body: (o) =>
        `<sitemapindex><sitemap><loc>${o}/a.xml</loc></sitemap><sitemap><loc>${o}/b.xml.gz</loc></sitemap></sitemapindex>`,
    },
    '/a.xml': {
      body: (o) =>
        urlset(`${o}/en/one`, `${o}/en/one`, `${o}/old/archive/x`, 'http://other.test/z'),
    },
    '/b.xml.gz': {
      type: 'application/gzip',
      body: (o) => gzipSync(urlset(`${o}/fr-fr/deux`, `${o}/en/three?x=1`)),
    },
  });
  try {
    const r = await crawl(s.origin, {
      exclude: ['**/archive/**'],
      include: ['/en/**', '/fr-fr/**'],
    });
    assert.deepEqual(
      r.urls.map((u) => [u.url.replace(s.origin, ''), u.lang]),
      [
        ['/en/one', 'en'],
        ['/fr-fr/deux', 'fr-FR'],
        ['/en/three?x=1', 'en'],
      ],
    );
    assert.equal(r.sitemaps.length, 3);
    assert.deepEqual(r.errors, []);
    assert.equal((await crawl(s.origin, { limit: 1 })).valid, 1);
  } finally {
    s.close();
  }
});

test('sitemaps: no robots.txt falls back to /sitemap.xml; a missing one is an error entry', async () => {
  const s = await site({ '/sitemap.xml': { body: (o) => urlset(`${o}/p`) } });
  try {
    assert.equal((await crawl(s.origin)).valid, 1);
  } finally {
    s.close();
  }
  const empty = await site({});
  try {
    const r = await crawl(empty.origin);
    assert.equal(r.valid, 0);
    assert.ok(r.errors.some((e) => e.message === 'HTTP 404'));
  } finally {
    empty.close();
  }
});

test('http: follows same-origin html links once, skips non-html and respects exclude', async () => {
  const s = await site({
    '/': {
      body: '<a href="/a">a</a><a href="/doc.pdf">p</a><a href="/skip/x">s</a><a href="http://other.test/">o</a>',
    },
    '/a': { body: '<a href="/">home</a><a href="/b#frag">b</a>' },
    '/b': { body: 'end' },
    '/doc.pdf': { type: 'application/pdf', body: 'pdf' },
    '/skip/x': { body: 'no' },
  });
  try {
    const r = await crawl(s.origin, { strategy: 'http', exclude: ['/skip/**'] });
    assert.deepEqual(r.urls.map((u) => u.url.replace(s.origin, '')).sort(), ['/', '/a', '/b']);
  } finally {
    s.close();
  }
});

test('sitemaps: a URL on another origin is dropped even without patterns', async () => {
  const s = await site({
    '/sitemap.xml': { body: (o) => urlset(`${o}/mine`, 'http://other.test/theirs') },
  });
  try {
    const r = await crawl(s.origin);
    assert.deepEqual(
      r.urls.map((u) => u.url.replace(s.origin, '')),
      ['/mine'],
    );
  } finally {
    s.close();
  }
});

test('http: the start page obeys include/exclude and does not use up the limit', async () => {
  const s = await site({
    '/': { body: '<a href="/blog/one">1</a><a href="/blog/two">2</a>' },
    '/blog/one': { body: 'one' },
    '/blog/two': { body: 'two' },
  });
  try {
    assert.equal((await crawl(s.origin, { strategy: 'http', exclude: ['*'] })).valid, 0);
    const r = await crawl(s.origin, { strategy: 'http', include: ['/blog/**'], limit: 1 });
    assert.deepEqual(
      r.urls.map((u) => u.url.replace(s.origin, '')),
      ['/blog/one'],
    );
  } finally {
    s.close();
  }
});

test('http: links resolve against the redirected URL, and a redirect off the origin is dropped', async () => {
  const other = await site({ '/': { body: '<a href="/leak">x</a>' }, '/leak': { body: 'no' } });
  const server = createServer((req, res) => {
    const route = {
      '/': ['200', '<a href="/docs">docs</a><a href="/away">away</a>'],
      '/docs': ['301', '', '/docs/'],
      '/docs/': ['200', '<a href="intro.html">intro</a>'],
      '/docs/intro.html': ['200', 'intro'],
      '/away': ['302', '', `${other.origin}/`],
    }[req.url];
    if (!route) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(Number(route[0]), {
      'content-type': 'text/html',
      ...(route[2] ? { location: route[2] } : {}),
    });
    return res.end(route[1]);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await crawl(origin, { strategy: 'http' });
    assert.deepEqual(r.urls.map((u) => u.url.replace(origin, '')).sort(), [
      '/',
      '/docs/',
      '/docs/intro.html',
    ]);
    assert.deepEqual(r.errors, []);
  } finally {
    server.close();
    other.close();
  }
});

test('sitemaps: a missing robots.txt is not an error', async () => {
  const s = await site({ '/sitemap.xml': { body: (o) => urlset(`${o}/p`) } });
  try {
    assert.deepEqual((await crawl(s.origin)).errors, []);
  } finally {
    s.close();
  }
});

test('http: a start page that is not HTML or leaves the origin says why', async () => {
  const s = await site({ '/': { type: 'application/pdf', body: 'pdf' } });
  try {
    const r = await crawl(s.origin, { strategy: 'http' });
    assert.deepEqual(r.errors, [{ url: `${s.origin}/`, message: 'not HTML (application/pdf)' }]);
  } finally {
    s.close();
  }
  const target = await site({ '/': { body: 'elsewhere' } });
  const server = createServer((_req, res) =>
    res.writeHead(301, { location: `${target.origin}/` }).end(),
  );
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await crawl(origin, { strategy: 'http' });
    assert.equal(r.valid, 0);
    assert.match(r.errors[0].message, new RegExp(`another origin; scan ${target.origin} instead`));
  } finally {
    server.close();
    target.close();
  }
});

test('failureMessage names the innermost cause and hides credentials', () => {
  const inner = new Error('connect ECONNREFUSED http://user:secret@127.0.0.1:9');
  const err = new TypeError('fetch failed', { cause: new Error('wrapped', { cause: inner }) });
  assert.equal(
    failureMessage(err),
    'fetch failed: connect ECONNREFUSED http://[redacted]@127.0.0.1:9',
  );
  assert.equal(failureMessage(new Error('HTTP 404')), 'HTTP 404');
});

test('sitemaps: robots.txt and sitemap.xml sent to another site say which origin to scan', async () => {
  const other = await site({ '/': { body: '<html>home</html>' } });
  const s = await site({
    '/robots.txt': { status: 302, location: () => `${other.origin}/` },
    '/sitemap.xml': { status: 302, location: () => `${other.origin}/` },
  });
  try {
    const r = await crawl(s.origin);
    const message = `redirected to ${other.origin}/, another origin; scan ${other.origin} instead`;
    assert.equal(r.valid, 0);
    assert.deepEqual(r.errors, [
      { url: `${s.origin}/robots.txt`, message },
      { url: `${s.origin}/sitemap.xml`, message },
    ]);
  } finally {
    s.close();
    other.close();
  }
});

test('sitemaps: robots.txt and a sitemap served from a CDN host are fine', async () => {
  let origin;
  const cdn = await site({
    '/robots.txt': { type: 'text/plain', body: () => `Sitemap: ${origin}/sitemap.xml` },
    '/s.xml': { body: () => urlset(`${origin}/a`, `${origin}/b`) },
  });
  const s = await site({
    '/robots.txt': { status: 301, location: () => `${cdn.origin}/robots.txt` },
    '/sitemap.xml': { status: 302, location: () => `${cdn.origin}/s.xml` },
  });
  origin = s.origin;
  try {
    const r = await crawl(s.origin);
    assert.equal(r.valid, 2);
    assert.deepEqual(r.errors, []);
  } finally {
    s.close();
    cdn.close();
  }
});

test('sitemaps: sitemaps that list only another origin say to scan it', async () => {
  const s = await site({
    '/sitemap.xml': {
      body: urlset('http://www.other.test/a', 'http://www.other.test/b', 'http://cdn.test/c'),
    },
  });
  try {
    const r = await crawl(s.origin);
    assert.equal(r.valid, 0);
    assert.deepEqual(r.errors, [
      {
        url: `${s.origin}/`,
        message:
          'the sitemaps list URLs of http://www.other.test only; scan http://www.other.test instead',
      },
    ]);
    // Same-origin URLs left out by the patterns are no reason to scan elsewhere.
    const s2 = await site({
      '/sitemap.xml': { body: (o) => urlset(`${o}/x`, 'http://www.other.test/a') },
    });
    try {
      assert.deepEqual((await crawl(s2.origin, { exclude: ['*'] })).errors, []);
    } finally {
      s2.close();
    }
  } finally {
    s.close();
  }
});

test('sitemaps: on the wrong origin, the walk stops after three sitemaps of another one', async () => {
  let fetched = 0;
  const s = await site({
    '/sitemap.xml': {
      body: (o) =>
        `<sitemapindex>${Array.from({ length: 10 }, (_, i) => `<sitemap><loc>${o}/s${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`,
    },
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `/s${i}.xml`,
        {
          body: () => {
            fetched += 1;
            return urlset(`https://www.other.test/p${i}`);
          },
        },
      ]),
    ),
  });
  try {
    const r = await crawl(s.origin);
    assert.equal(fetched, 3);
    assert.match(r.errors.at(-1).message, /scan https:\/\/www\.other\.test instead$/);
  } finally {
    s.close();
  }
});

test('sitemaps: an HTML page instead of a sitemap is an error; an empty urlset is not', async () => {
  const s = await site({
    '/robots.txt': {
      type: 'text/plain',
      body: (o) => `Sitemap: ${o}/challenge.xml\nSitemap: ${o}/empty.xml`,
    },
    '/challenge.xml': { body: '<html><head><meta name="robots" content="noindex"></head></html>' },
    '/empty.xml': { type: 'application/xml', body: '<?xml version="1.0"?><urlset></urlset>' },
  });
  try {
    const r = await crawl(s.origin);
    assert.deepEqual(r.errors, [
      { url: `${s.origin}/challenge.xml`, message: 'not a sitemap (text/html)' },
    ]);
    assert.deepEqual(r.sitemaps, [`${s.origin}/empty.xml`]);
  } finally {
    s.close();
  }
});
