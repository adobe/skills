import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import { runCli } from '#src/cli.mjs';
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

test('site scan prints the summary document', async () => {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/sitemap.xml' ? 200 : 404);
    res.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/p</loc></url></urlset>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const { code, doc } = await run(['site', 'scan', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(code, 0);
    assert.equal(doc.valid, 1);
    assert.equal(doc.urls[0].lang, '');
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
