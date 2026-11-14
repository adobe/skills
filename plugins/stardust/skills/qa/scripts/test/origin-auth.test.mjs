import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fetchUrl, originAuthFor, setOriginAuth } from '../lib.mjs';

const credential = 'token test-only-placeholder';

test('credentials are available for normalized same-origin URLs', () => {
  setOriginAuth('https://example.test:443/root', credential);
  for (const url of [
    'https://example.test/',
    'https://EXAMPLE.test:443/path?x=1',
    new URL('https://example.test/path'),
  ]) assert.equal(originAuthFor(url), credential, String(url));
});

test('credentials are withheld from cross-origin or invalid URLs', () => {
  setOriginAuth('https://example.test', credential);
  for (const url of [
    'https://example.test.attacker.test/path',
    'https://example.test-extra.test/path',
    'https://example.test@attacker.test/path',
    'https://example.test:444/path',
    'http://example.test/path',
    'https://sub.example.test/path',
    'https://example.test:invalid/path',
    'not a URL',
    '/relative',
    '',
    null,
  ]) assert.equal(originAuthFor(url), null, String(url));
});

test('opaque origins never receive credentials', () => {
  setOriginAuth('file:///tmp/site', credential);
  assert.equal(originAuthFor('file:///tmp/other'), null);
  assert.equal(originAuthFor('data:text/plain,example'), null);
  assert.equal(originAuthFor('null'), null);
});

test('clearing authentication removes the credential', () => {
  setOriginAuth('https://example.test', credential);
  setOriginAuth(null, null);
  assert.equal(originAuthFor('https://example.test/'), null);
});

test('fetchUrl withholds credentials from origin-prefix lookalikes', async () => {
  const received = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    received.push(options.headers.authorization === credential);
    return new Response('ok', { status: 200 });
  };
  try {
    setOriginAuth('https://example.test', credential);
    for (const url of [
      'https://example.test/page',
      'https://example.test.attacker.test/page',
      'https://example.test@attacker.test/page',
      'https://example.test:444/page',
    ]) await fetchUrl(url, { retries: 0 });
    assert.deepEqual(received, [true, false, false, false]);
  } finally {
    globalThis.fetch = originalFetch;
    setOriginAuth(null, null);
  }
});

test('fetchUrl sends a credential to the matching port only', async () => {
  const received = [];
  const server = createServer((req, res) => {
    received.push(req.headers.authorization === credential);
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    setOriginAuth('http://127.0.0.1', credential);
    assert.equal((await fetchUrl(`${origin}/external`, { retries: 0 })).status, 200);
    setOriginAuth(origin, credential);
    assert.equal((await fetchUrl(`${origin}/internal`, { retries: 0 })).status, 200);
    assert.deepEqual(received, [false, true]);
  } finally {
    setOriginAuth(null, null);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchUrl strips credentials on cross-origin redirects', async () => {
  const hops = [];
  let originA; let originB;
  const a = createServer((req, res) => {
    hops.push(['A', req.headers.authorization === credential]);
    if (req.url === '/aa') res.writeHead(302, { location: '/target' });
    else if (req.url === '/ab') res.writeHead(302, { location: `${originB}/target` });
    else if (req.url === '/aba') res.writeHead(302, { location: `${originB}/back` });
    res.end('ok');
  });
  const b = createServer((req, res) => {
    hops.push(['B', req.headers.authorization === credential]);
    if (req.url === '/back' || req.url === '/ba') res.writeHead(302, { location: `${originA}/target` });
    res.end('ok');
  });
  await new Promise((resolve) => a.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => b.listen(0, '127.0.0.1', resolve));
  originA = `http://127.0.0.1:${a.address().port}`;
  originB = `http://127.0.0.1:${b.address().port}`;
  try {
    setOriginAuth(originA, credential);
    const cases = [
      [`${originA}/aa`, [['A', true], ['A', true]]],
      [`${originA}/ab`, [['A', true], ['B', false]]],
      [`${originA}/aba`, [['A', true], ['B', false], ['A', false]]],
      [`${originB}/ba`, [['B', false], ['A', false]]],
    ];
    for (const [url, expected] of cases) {
      hops.length = 0;
      assert.equal((await fetchUrl(url, { retries: 0 })).status, 200);
      assert.deepEqual(hops, expected);
    }
  } finally {
    setOriginAuth(null, null);
    await Promise.all([
      new Promise((resolve) => a.close(resolve)),
      new Promise((resolve) => b.close(resolve)),
    ]);
  }
});
