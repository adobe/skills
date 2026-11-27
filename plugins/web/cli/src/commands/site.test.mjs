import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import { runCli } from '#src/cli.mjs';
import { emptyHint } from '#src/commands/site.mjs';
import { startForwardProxy } from '../../test/forward-proxy.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

async function run(args, env = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(['node', 'web', ...args], { stdout, stderr, env });
  return { code, doc: JSON.parse(stdout.buf), out: stdout.buf + stderr.buf };
}

/** A site with one URL in /sitemap.xml that counts the requests it gets. */
async function sitemapSite() {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    res.writeHead(req.url === '/sitemap.xml' ? 200 : 404);
    res.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/p</loc></url></urlset>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests: () => requests,
    close: () => server.close(),
  };
}

test('site scan prints grouped JSON and lists only selected URLs in text', async () => {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/sitemap.xml' ? 200 : 404);
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.end(`<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">
      <url><loc>${origin}/en/p</loc>
        <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>
        <xhtml:link rel="alternate" hreflang="fr" href="${origin}/fr/p"/>
      </url>
      <url><loc>${origin}/fr/p</loc>
        <xhtml:link rel="alternate" hreflang="en-CA" href="${origin}/en/p"/>
      </url>
    </urlset>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const args = ['site', 'scan', origin, '--exclude', '/fr/**'];
    const { code, doc } = await run(args);
    assert.equal(code, 0);
    assert.equal(doc.valid, 1);
    assert.equal(doc.total, 2);
    assert.deepEqual(doc.urls, [
      {
        url: `${origin}/`,
        variants: [
          { lang: ['en', 'en-CA'], pathLang: 'en', url: `${origin}/en/p` },
          { lang: ['fr'], pathLang: null, url: `${origin}/fr/p` },
        ],
      },
    ]);
    assert.ok(!Object.hasOwn(doc, 'scannedUrls'));
    const stdout = sink();
    assert.equal(
      await runCli(['node', 'web', '--format', 'text', ...args], {
        stdout,
        stderr: sink(),
        env: {},
      }),
      0,
    );
    assert.equal(stdout.buf, `1 valid of 2 URLs\n${origin}/en/p\n`);
  } finally {
    server.close();
  }
});

test('site scan exits 1 with EMPTY_RESULT when nothing is found', async () => {
  const server = createServer((_req, res) => res.writeHead(404).end());
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const { code, doc } = await run(['site', 'scan', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(code, 1);
    assert.equal(doc.error.code, 'EMPTY_RESULT');
  } finally {
    server.close();
  }
});

test('site scan rejects a bad strategy, origin and limit with exit 2', async () => {
  for (const args of [
    ['site', 'scan', 'http://x.test', '--strategy', 'dns'],
    ['site', 'scan', 'not a url'],
    ['site', 'scan', 'http://x.test', '--limit', '0'],
    ['site', 'scan', 'http://x.test', '--timeout', 'abc'],
    ['site', 'scan', 'http://x.test', '--timeout', '0'],
  ]) {
    const { code, doc } = await run(args);
    assert.equal(code, 2, args.join(' '));
    assert.equal(doc.error.code, 'USAGE');
  }
});

const noProxySupport =
  typeof http.setGlobalProxyFromEnv !== 'function' && 'needs Node.js 24.14+ or 25.4+';

test(
  'site scan sends every request through WEB_PROXY or --proxy',
  { skip: noProxySupport },
  async () => {
    const site = await sitemapSite();
    const proxy = await startForwardProxy();
    try {
      const viaEnv = await run(['site', 'scan', site.origin], { WEB_PROXY: proxy.url });
      assert.equal(viaEnv.code, 0);
      assert.equal(viaEnv.doc.valid, 1);
      assert.equal(proxy.seen.length, site.requests());
      const viaFlag = await run(['site', 'scan', site.origin, '--proxy', proxy.url]);
      assert.equal(viaFlag.doc.valid, 1);
      assert.equal(proxy.seen.length, site.requests());
      // WEB_PROXY= (empty) scans without a proxy.
      const direct = await run(['site', 'scan', site.origin], { WEB_PROXY: '' });
      assert.equal(direct.doc.valid, 1);
      assert.ok(proxy.seen.length < site.requests());
    } finally {
      proxy.close();
      site.close();
    }
  },
);

test('site scan with a proxy exits 2 (UNSUPPORTED) and sends nothing on an older Node.js', async () => {
  const site = await sitemapSite();
  const saved = http.setGlobalProxyFromEnv;
  http.setGlobalProxyFromEnv = undefined;
  try {
    for (const [args, env] of [
      [['--proxy', 'http://user:secret@127.0.0.1:9'], {}],
      [[], { WEB_PROXY: 'http://user:secret@127.0.0.1:9' }],
    ]) {
      const { code, doc, out } = await run(['site', 'scan', site.origin, ...args], env);
      assert.equal(code, 2);
      assert.equal(doc.error.code, 'UNSUPPORTED');
      assert.ok(!out.includes('secret'));
    }
    assert.equal(site.requests(), 0);
  } finally {
    http.setGlobalProxyFromEnv = saved;
    site.close();
  }
});

test('site scan rejects a bad proxy and proxy options without a proxy, exit 2', async () => {
  for (const [args, env] of [
    [['--proxy', 'socks5://user:secret@127.0.0.1:1080'], {}],
    [[], { WEB_PROXY: 'user:secret@127.0.0.1:8080' }],
    [['--insecure'], {}],
    [['--proxy-ca', 'ca.pem'], { WEB_PROXY: '' }],
    [['--proxy', ''], { WEB_PROXY: 'http://user:secret@127.0.0.1:8080' }],
  ]) {
    const { code, doc, out } = await run(['site', 'scan', 'http://x.test', ...args], env);
    assert.equal(code, 2, args.join(' '));
    assert.equal(doc.error.code, 'USAGE');
    assert.ok(!out.includes('secret'));
  }
});

test('site scan --help does not print WEB_PROXY', async () => {
  const stdout = sink();
  const env = { WEB_PROXY: 'http://user:secret@proxy.test:8080' };
  const code = await runCli(['node', 'web', 'site', 'scan', '--help'], {
    stdout,
    stderr: sink(),
    env,
  });
  assert.equal(code, 0);
  assert.match(stdout.buf, /--proxy <url>/);
  assert.ok(!stdout.buf.includes('secret'));
});

test('site scan hints: another origin, then a browser User-Agent, then a proxy', async () => {
  const listen = async (handler) => {
    const server = createServer(handler);
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
  };
  const blocked = await listen((_req, res) => res.writeHead(403).end());
  const home = await listen((_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html' }).end('home'),
  );
  const moved = await listen((_req, res) =>
    res.writeHead(302, { location: `${home.origin}/` }).end(),
  );
  try {
    const plain = await run(['site', 'scan', blocked.origin]);
    assert.equal(plain.doc.error.code, 'EMPTY_RESULT');
    assert.match(plain.doc.error.hint, /--user-agent/);
    const withUa = await run(['site', 'scan', blocked.origin, '--user-agent', 'Mozilla/5.0']);
    assert.match(withUa.doc.error.hint, /--proxy/);
    if (!noProxySupport) {
      const proxy = await startForwardProxy({ auth: 'user:right' });
      try {
        const through = await run(['site', 'scan', blocked.origin, '--user-agent', 'Mozilla/5.0'], {
          WEB_PROXY: proxy.url,
        });
        assert.match(through.doc.error.hint, /through the proxy too/);
        const refused = await run(['site', 'scan', blocked.origin], {
          WEB_PROXY: proxy.url.replace('right', 'wrong'),
        });
        assert.match(
          refused.doc.error.hint,
          /proxy refused the connection \(407\): check its user/,
        );
      } finally {
        proxy.close();
      }
    }
    const away = await run(['site', 'scan', moved.origin]);
    assert.equal(away.doc.error.hint, `scan ${home.origin} instead`);
    // A challenge page with a 200 instead of the sitemap.
    const page = await run(['site', 'scan', home.origin]);
    assert.match(page.doc.error.message, /sitemap\.xml: not a sitemap \(text\/html\)/);
    assert.match(page.doc.error.hint, /bot check: retry with --user-agent/);
  } finally {
    for (const s of [blocked, home, moved]) s.server.close();
  }
});

test('emptyHint: an untrusted certificate through a proxy asks for its CA', () => {
  const errors = [
    {
      url: 'https://a.test/robots.txt',
      message: 'fetch failed: unable to get local issuer certificate',
    },
  ];
  assert.match(
    emptyHint(errors, { strategy: 'sitemaps', proxy: 'https://proxy.test:8443' }),
    /re-signs TLS: pass its CA with --proxy-ca/,
  );
  assert.equal(emptyHint(errors, { strategy: 'sitemaps' }), 'retry with --strategy http');
});
