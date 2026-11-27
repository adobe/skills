import test from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProxyUrl, withProxy } from '#src/site/proxy.mjs';
import { crawl } from '#src/site/crawl.mjs';
import { startForwardProxy } from '../../test/forward-proxy.mjs';

const supported = typeof http.setGlobalProxyFromEnv === 'function';
const noProxySupport = !supported && 'needs Node.js 24.14+ or 25.4+';

async function listen(server) {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return server.address().port;
}

async function textSite(body) {
  const server = createServer((_req, res) => res.writeHead(200).end(body));
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** Pretend to be a Node.js without built-in proxy support while `fn` runs. */
async function withoutProxySupport(fn) {
  const saved = http.setGlobalProxyFromEnv;
  http.setGlobalProxyFromEnv = undefined;
  try {
    return await fn();
  } finally {
    http.setGlobalProxyFromEnv = saved;
  }
}

const get = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return `${res.status} ${await res.text()}`;
  } catch (err) {
    let inner = err;
    while (inner.cause instanceof Error) inner = inner.cause;
    return `error: ${inner.message}`;
  }
};

test('assertProxyUrl takes http(s) URLs and never quotes a rejected one', () => {
  assertProxyUrl('http://proxy.test:8080');
  assertProxyUrl('https://user:secret@proxy.test:8443');
  for (const value of [
    'socks5://user:secret@proxy.test:1080',
    'user:secret@proxy.test:8080',
    'nope',
  ]) {
    assert.throws(
      () => assertProxyUrl(value),
      (err) => err.code === 'USAGE' && !`${err.message} ${err.hint}`.includes('secret'),
      value,
    );
  }
});

test('withProxy without a proxy only runs fn', async () => {
  const saved = http.setGlobalProxyFromEnv;
  http.setGlobalProxyFromEnv = () => assert.fail('no proxy was asked for');
  try {
    assert.equal(await withProxy({}, async () => 'ran'), 'ran');
    assert.equal(await withProxy({ proxy: '' }, async () => 'ran'), 'ran');
  } finally {
    http.setGlobalProxyFromEnv = saved;
  }
});

test('withProxy fails closed with UNSUPPORTED where Node.js has no proxy support', async () => {
  let ran = false;
  await withoutProxySupport(() =>
    assert.rejects(
      withProxy({ proxy: 'http://127.0.0.1:9' }, async () => {
        ran = true;
      }),
      (err) => err.code === 'UNSUPPORTED' && err.message.includes(process.version),
    ),
  );
  assert.equal(ran, false);
});

test(
  'withProxy sends every fetch through the proxy, then goes direct again',
  { skip: noProxySupport },
  async () => {
    const site = await textSite('hello');
    const proxy = await startForwardProxy();
    try {
      assert.equal(
        await withProxy({ proxy: proxy.url }, () => get(`${site.origin}/a`)),
        '200 hello',
      );
      assert.ok(
        proxy.seen.some((u) => u.includes(site.origin.slice(7))),
        proxy.seen.join(),
      );
      const count = proxy.seen.length;
      assert.equal(await get(`${site.origin}/b`), '200 hello');
      assert.equal(proxy.seen.length, count, 'a fetch after withProxy went through the proxy');
    } finally {
      proxy.close();
      site.close();
    }
  },
);

test(
  'a proxy that refuses the credentials shows in the crawl errors',
  { skip: noProxySupport },
  async () => {
    const site = await textSite('<urlset></urlset>');
    const proxy = await startForwardProxy({ auth: 'user:right' });
    try {
      const wrong = proxy.url.replace('user:right', 'user:wrong');
      const result = await withProxy({ proxy: wrong }, () => crawl(site.origin));
      assert.equal(result.valid, 0);
      assert.ok(result.errors.length > 0);
      for (const e of result.errors) assert.match(e.message, /407/);
      assert.deepEqual(proxy.seen, []);
    } finally {
      proxy.close();
      site.close();
    }
  },
);

let openssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  openssl = false;
}

test(
  '--proxy-ca and --insecure accept a certificate only while the proxy is on',
  { skip: noProxySupport || (!openssl && 'needs openssl') },
  async () => {
    // A self-signed certificate stands for the CA of a proxy that re-signs TLS.
    const dir = mkdtempSync(join(tmpdir(), 'web-proxy-ca-'));
    const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')];
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
      ].concat(['-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]),
      { stdio: 'ignore' },
    );
    const server = createHttpsServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (_q, s) => s.writeHead(200).end('secure'),
    );
    const url = `https://127.0.0.1:${await listen(server)}/robots.txt`;
    const proxy = await startForwardProxy();
    const reject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      const via = (options) => withProxy({ proxy: proxy.url, ...options }, () => get(url));
      assert.match(await via({}), /^error: .*certificate/);
      assert.equal(await via({ ca: cert }), '200 secure');
      assert.match(await via({}), /^error: .*certificate/, 'the CA stayed trusted');
      assert.equal(await via({ insecure: true }), '200 secure');
      assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, reject);
      assert.match(await via({}), /^error: .*certificate/, 'certificate checks stayed off');
    } finally {
      proxy.close();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'withProxy rejects a --proxy-ca file without a PEM certificate',
  { skip: noProxySupport },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-proxy-ca-'));
    const empty = join(dir, 'empty.pem');
    writeFileSync(empty, 'not a certificate');
    let ran = false;
    const run = async () => {
      ran = true;
    };
    try {
      for (const ca of [empty, join(dir, 'missing.pem')]) {
        await assert.rejects(withProxy({ proxy: 'http://127.0.0.1:9', ca }, run), {
          code: 'USAGE',
        });
      }
      assert.equal(ran, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'withProxy ignores NO_PROXY and HTTP(S)_PROXY from the environment',
  { skip: noProxySupport },
  async () => {
    const site = await textSite('hello');
    const proxy = await startForwardProxy();
    const saved = Object.fromEntries(
      ['NO_PROXY', 'no_proxy', 'HTTPS_PROXY', 'HTTP_PROXY'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, {
      NO_PROXY: '*',
      no_proxy: '127.0.0.1',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
    });
    try {
      assert.equal(
        await withProxy({ proxy: proxy.url }, () => get(`${site.origin}/a`)),
        '200 hello',
      );
      assert.equal(proxy.seen.length, 1, 'the request went around the proxy');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      proxy.close();
      site.close();
    }
  },
);

test(
  'withProxy refuses a second proxied run while one is going',
  { skip: noProxySupport },
  async () => {
    const site = await textSite('hello');
    const proxy = await startForwardProxy();
    try {
      await withProxy({ proxy: proxy.url }, async () => {
        await assert.rejects(
          withProxy({ proxy: proxy.url }, async () => 'no'),
          {
            code: 'UNSUPPORTED',
          },
        );
      });
      // Released afterwards, also after a failure.
      await assert.rejects(withProxy({ proxy: proxy.url }, async () => assert.fail('boom')));
      assert.equal(
        await withProxy({ proxy: proxy.url }, () => get(`${site.origin}/`)),
        '200 hello',
      );
    } finally {
      proxy.close();
      site.close();
    }
  },
);
