#!/usr/bin/env node
// skills/deploy/scripts/test/site-auth.test.mjs — site-auth.mjs: the one `.env` grammar of a site token, the
// `token ` prefix rule, the opt-in of an instrument (flags in, { origin, header } or null out) and the origin-scoped
// route, first pure (a fake browser context), then in Chromium against a real protected origin (skipped without it).
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { attachSiteAuth, instrumentSiteAuth, readSiteAuth, strayEnvLine } from '../site-auth.mjs';

const BASE = mkdtempSync(join(tmpdir(), 'site-auth-test-'));
after(() => rmSync(BASE, { recursive: true, force: true }));
// A project directory holding `dotenv` as its .env (no .env when null).
const withEnvFile = (dotenv) => {
  const dir = mkdtempSync(join(BASE, 'p-'));
  if (dotenv !== null) writeFileSync(join(dir, '.env'), dotenv);
  return dir;
};

const T = 'abc123';

test('readSiteAuth: the environment first, then the NAME= line of the .env in cwd; null when neither holds a value', () => {
  const cwd = withEnvFile(`OTHER=1\nSITE_X=from-file\n`);
  assert.equal(readSiteAuth('SITE_X', { env: { SITE_X: 'from-env' }, cwd }), 'token from-env');
  assert.equal(readSiteAuth('SITE_X', { env: {}, cwd }), 'token from-file');
  assert.equal(readSiteAuth('SITE_X', { env: { SITE_X: '' }, cwd }), 'token from-file', 'an empty variable falls back to the file');
  assert.equal(readSiteAuth('SITE_Y', { env: {}, cwd }), null);
  assert.equal(readSiteAuth('SITE_X', { env: {}, cwd: withEnvFile(null) }), null, 'no .env at all');
  assert.equal(readSiteAuth('SITE_X', { env: {}, cwd: withEnvFile('SITE_X=\n') }), null, 'an empty value');
  assert.equal(readSiteAuth('SITE_X', { env: {}, cwd: withEnvFile('SITE_X=   \n') }), null, 'a blank value');
  assert.equal(readSiteAuth('SITE_X', { env: { SITE_X: '   ' }, cwd }), null, 'a blank variable is a value, so the file is not asked');
});

test('readSiteAuth: the value is trimmed and one pair of quotes stripped; a CRLF file reads the same', () => {
  const read = (line) => readSiteAuth('SITE_X', { env: {}, cwd: withEnvFile(`OTHER=1\n${line}\n`) });
  assert.equal(read(`SITE_X=${T}`), `token ${T}`);
  assert.equal(read(`SITE_X=  ${T}  `), `token ${T}`);
  assert.equal(read(`SITE_X="${T}"`), `token ${T}`);
  assert.equal(read(`SITE_X='${T}'`), `token ${T}`);
  assert.equal(read(`SITE_X=${T}\r`), `token ${T}`);
  assert.equal(read(`SITE_X="bearer ${T}"`), `bearer ${T}`);
  assert.equal(read('SITE_X=""'), null);
});

test('readSiteAuth: `export NAME=`, `NAME = v`, an indented or commented line and a longer name are not the line; a trailing comment is part of the value', () => {
  const read = (dotenv) => readSiteAuth('SITE_X', { env: {}, cwd: withEnvFile(dotenv) });
  assert.equal(read(`export SITE_X=${T}\n`), null);
  assert.equal(read(`SITE_X = ${T}\n`), null);
  assert.equal(read(`SITE_X =${T}\n`), null);
  assert.equal(read(` SITE_X=${T}\n`), null);
  assert.equal(read(`# SITE_X=${T}\n`), null);
  assert.equal(read(`SITE_X_2=${T}\n`), null);
  assert.equal(read(`PRE_SITE_X=${T}\n`), null);
  assert.equal(read(`SITE_X=${T}  # the preview's\n`), `token ${T}  # the preview's`);
  assert.equal(read(`SITE_X=first\nSITE_X=second\n`), 'token first', 'the first line wins');
});

test('readSiteAuth: a value starting with token or bearer (any case) is kept; any other gets `token ` in front', () => {
  const read = (v) => readSiteAuth('SITE_X', { env: { SITE_X: v }, cwd: withEnvFile(null) });
  assert.equal(read(`token ${T}`), `token ${T}`);
  assert.equal(read(`Bearer ${T}`), `Bearer ${T}`);
  assert.equal(read(`TOKEN ${T}`), `TOKEN ${T}`);
  assert.equal(read(T), `token ${T}`);
  assert.equal(read(`tokens ${T}`), `token tokens ${T}`);
  assert.equal(read(`bearer${T}`), `token bearer${T}`);
});

test('strayEnvLine / instrumentSiteAuth: a NAME line in a form the grammar does not read is named as that, not as "not set"; the value is never printed', () => {
  const stray = (dotenv) => strayEnvLine('SITE_X', { cwd: withEnvFile(dotenv) });
  for (const line of [`export SITE_X=${T}`, `SITE_X = ${T}`, `SITE_X =${T}`, ` SITE_X=${T}`, `export  SITE_X = ${T}\r`]) assert.equal(stray(`OTHER=1\n${line}\n`), true, line);
  for (const line of [`SITE_X=${T}`, 'SITE_X=', `# SITE_X=${T}`, `SITE_X_2=${T}`, `PRE_SITE_X=${T}`, 'OTHER=1']) assert.equal(stray(`${line}\n`), false, line);
  assert.equal(stray(null), false, 'no .env');
  assert.equal(strayEnvLine('not a name', { cwd: withEnvFile(`not a name=${T}\n`) }), false);
  const cwd = withEnvFile(`export SITE_X=${T}\n`);
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_X', urls: ['https://a.test/'], env: {}, cwd }), (e) => e.code === 2
    && e.message === '--token-env SITE_X: found a SITE_X line in ./.env but it must be exactly SITE_X=value (no export, no spaces round the =, no indent)');
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_Y', urls: ['https://a.test/'], env: {}, cwd }), (e) => /^no site token: --token-env SITE_Y is not set/.test(e.message), 'another variable is plainly not set');
  assert.equal(instrumentSiteAuth({ tokenEnv: 'SITE_X', urls: ['https://a.test/'], env: { SITE_X: T }, cwd }).header, `token ${T}`, 'the environment still wins');
});

test('readSiteAuth: a name that is not an identifier is a usage error (code 2) naming the flag and never echoing the value', () => {
  const cwd = withEnvFile(null);
  for (const bad of [`token ${T}`, `${T}-x`, '', 'A B', '1ABC', 'A.*', undefined, null]) {
    assert.throws(() => readSiteAuth(bad, { env: {}, cwd }), (e) => e.code === 2 && /^--token-env takes the name of an environment variable \(letters, digits and underscores\), not the token$/.test(e.message), String(bad));
  }
  assert.throws(() => readSiteAuth('x y', { env: {}, cwd, flag: '--site-token-env' }), (e) => e.code === 2 && e.message.startsWith('--site-token-env takes the name'));
});

test('instrumentSiteAuth: no flag, no token — a SITE_TOKEN in the environment or the .env is never used on its own', () => {
  const cwd = withEnvFile(`SITE_TOKEN=${T}\n`);
  const env = { SITE_TOKEN: T };
  assert.equal(instrumentSiteAuth({ urls: ['https://a.test/p'], env, cwd }), null);
  assert.equal(instrumentSiteAuth({ tokenEnv: undefined, authHeader: undefined, authOrigin: 'https://a.test', urls: ['https://a.test/'], env, cwd }), null);
  assert.equal(instrumentSiteAuth({ tokenEnv: null, authHeader: null, env, cwd }), null);
  assert.equal(instrumentSiteAuth(), null);
});

test('instrumentSiteAuth: --token-env resolves through the one grammar; --auth-header is used as given with the prefix rule; the origin is the one of the urls', () => {
  const cwd = withEnvFile(`SITE_X=${T}\n`);
  assert.deepEqual(instrumentSiteAuth({ tokenEnv: 'SITE_X', urls: ['https://a.test/p?q=1'], env: {}, cwd }), { origin: 'https://a.test', header: `token ${T}` });
  assert.deepEqual(instrumentSiteAuth({ tokenEnv: 'SITE_Y', urls: ['https://a.test/'], env: { SITE_Y: `bearer ${T}` }, cwd }), { origin: 'https://a.test', header: `bearer ${T}` });
  assert.deepEqual(instrumentSiteAuth({ authHeader: `  ${T} `, urls: ['http://127.0.0.1:8080/x'], cwd }), { origin: 'http://127.0.0.1:8080', header: `token ${T}` });
  assert.deepEqual(instrumentSiteAuth({ authHeader: `Bearer ${T}`, urls: ['https://a.test/x', 'https://a.test/y#z'], cwd }), { origin: 'https://a.test', header: `Bearer ${T}` });
  assert.equal(instrumentSiteAuth({ authHeader: `Bearer ${T}`, tokenEnv: 'SITE_X', urls: ['https://a.test/'], env: {}, cwd }).header, `Bearer ${T}`, '--auth-header wins over --token-env');
});

test('instrumentSiteAuth: --auth-origin names the one origin (only its origin is kept); two origins without it is a usage error, not a guess', () => {
  const cwd = withEnvFile(null);
  const flags = { authHeader: T, cwd };
  assert.deepEqual(instrumentSiteAuth({ ...flags, authOrigin: 'https://a.test/some/path?x', urls: ['https://a.test/p', 'http://127.0.0.1:9/local'] }), { origin: 'https://a.test', header: `token ${T}` });
  assert.deepEqual(instrumentSiteAuth({ ...flags, authOrigin: 'https://a.test', urls: [] }), { origin: 'https://a.test', header: `token ${T}` });
  assert.throws(() => instrumentSiteAuth({ ...flags, urls: ['https://a.test/p', 'http://127.0.0.1:9/local'] }), (e) => e.code === 2 && /goes to one origin only and these URLs have 2 \(https:\/\/a\.test, http:\/\/127\.0\.0\.1:9\): pass --auth-origin <url> to name it$/.test(e.message));
  assert.throws(() => instrumentSiteAuth({ ...flags, urls: ['./local.html', 'ftp://x/y'] }), (e) => e.code === 2 && /no http\(s\) URL to take an origin from: pass --auth-origin <url>$/.test(e.message));
  assert.throws(() => instrumentSiteAuth({ ...flags, urls: [] }), (e) => e.code === 2);
  for (const bad of ['', 'a.test', 'ftp://a.test', 'file:///x', 7]) {
    assert.throws(() => instrumentSiteAuth({ ...flags, authOrigin: bad, urls: ['https://a.test/'] }), (e) => e.code === 2 && /^--auth-origin needs an http\(s\) URL/.test(e.message), String(bad));
  }
});

test('instrumentSiteAuth: an empty flag value is a usage error that names the flag; an unset variable is named, a pasted token is never echoed', () => {
  const cwd = withEnvFile(`SITE_BLANK=\n`);
  const urls = ['https://a.test/'];
  for (const authHeader of ['', '   ']) assert.throws(() => instrumentSiteAuth({ authHeader, urls, cwd }), (e) => e.code === 2 && e.message === '--auth-header needs a value');
  assert.throws(() => instrumentSiteAuth({ tokenEnv: '', urls, cwd }), (e) => e.code === 2 && /^--token-env takes the name of an environment variable/.test(e.message));
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_NOT_SET', urls, env: {}, cwd }), (e) => e.code === 2 && e.message === 'no site token: --token-env SITE_NOT_SET is not set (or is empty) in the environment or in a SITE_NOT_SET= line of .env');
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_BLANK', urls, env: {}, cwd }), (e) => e.code === 2 && /^no site token: --token-env SITE_BLANK is not set/.test(e.message));
  assert.throws(() => instrumentSiteAuth({ tokenEnv: `token ${T}`, urls, env: {}, cwd }), (e) => e.code === 2 && !e.message.includes(T));
});

// A browser context as attachSiteAuth sees it: the route handler it registers; each request gets the calls the handler
// makes on its route. `fetchFails` makes route.fetch throw.
function fakeContext() {
  const ctx = {
    async route(pattern, handler) { ctx.pattern = pattern; ctx.handler = handler; },
    async request(url, headers = { accept: '*/*' }, { fetchFails = false } = {}) {
      const done = {};
      await ctx.handler({
        request: () => ({ url: () => url, headers: () => headers }),
        continue: async (o) => { done.continued = o || {}; },
        abort: async (code) => { done.aborted = code; },
        fetch: async (o) => { if (fetchFails) throw new Error(`network ${headers.authorization || ''}`); done.fetched = o; return { answer: url }; },
        fulfill: async (o) => { done.fulfilled = o; },
      });
      return done;
    },
  };
  return ctx;
}

test('attachSiteAuth: the header rides the requests of the one origin and no other; the request\'s own headers are kept; the answer is handed to the browser unfollowed, with no timeout of its own', async () => {
  const ctx = fakeContext();
  await attachSiteAuth(ctx, 'https://a.test/some/path', `token ${T}`);
  assert.equal(ctx.pattern, '**/*');
  const sent = (done) => ({ fetched: done.fetched, answered: done.fulfilled && done.fulfilled.response.answer, continued: done.continued });
  assert.deepEqual(sent(await ctx.request('https://a.test/page', { accept: 'text/html' })), { fetched: { headers: { accept: 'text/html', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 }, answered: 'https://a.test/page', continued: undefined });
  assert.deepEqual((await ctx.request('https://a.test', {})).fetched, { headers: { authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 });
  assert.deepEqual((await ctx.request('https://a.test/x?y=1#z', { authorization: 'token other' })).fetched.headers, { authorization: `token ${T}` });
  for (const other of ['https://cdn.test/font.woff2', 'https://a.test.evil.test/x', 'https://evil.test/https://a.test/', 'https://sub.a.test/x', 'http://a.test/x', 'https://a.test:8443/x', 'https://a.test@evil.test/x', 'data:text/plain,hi', 'blob:https://a.test/1', 'not a url']) {
    assert.deepEqual(await ctx.request(other), { continued: {} }, `${other}: continued untouched, nothing fetched`);
  }
});

test('attachSiteAuth: a request of the origin that fails is aborted, never continued without the header; one stderr line names the origin and no token', async () => {
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const ctx = fakeContext();
    await attachSiteAuth(ctx, 'https://a.test', `token ${T}`);
    const first = await ctx.request('https://a.test/page', { accept: '*/*', authorization: `token ${T}` }, { fetchFails: true });
    const second = await ctx.request('https://a.test/style.css', { accept: '*/*' }, { fetchFails: true });
    assert.deepEqual(first, { aborted: 'failed' });
    assert.deepEqual(second, { aborted: 'failed' });
    assert.deepEqual(lines, ['site-auth: a request to https://a.test failed and was not retried without the site token'], 'one line, not one per request');
    assert.ok(!lines.join('').includes(T));
  } finally { console.error = real; }
});

test('attachSiteAuth: a local origin with a port is matched exactly; nothing is registered without an origin or a header', async () => {
  const ctx = fakeContext();
  await attachSiteAuth(ctx, 'http://127.0.0.1:4000', `token ${T}`);
  assert.deepEqual((await ctx.request('http://127.0.0.1:4000/page')).fetched, { headers: { accept: '*/*', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 });
  for (const other of ['http://127.0.0.1:40001/page', 'http://127.0.0.1:400/page', 'http://localhost:4000/page']) assert.deepEqual(await ctx.request(other), { continued: {} }, other);
  const idle = fakeContext();
  await attachSiteAuth(idle, '', `token ${T}`);
  await attachSiteAuth(idle, 'https://a.test', '');
  await attachSiteAuth(idle, 'https://a.test', null);
  assert.equal(idle.handler, undefined);
});

// ---- in Chromium: the route against a real protected origin ------------------------------------------------------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const hasBrowser = await import('playwright').then(async ({ chromium }) => { const b = await chromium.launch(); await b.close(); return true; }, () => false);
const listen = (handler) => new Promise((resolve) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });

test('attachSiteAuth in Chromium: the origin\'s page (gzip), stylesheet and image carry the token; a redirect off the origin — a page or an image — reaches the other origin without it', { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
  const { chromium } = await import('playwright');
  const seenA = []; const seenB = [];
  const B = await listen((req, res) => {
    seenB.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.url === '/pic.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>landed</title><p>landed on the other origin</p>'); }
  });
  const originB = `http://127.0.0.1:${B.address().port}`;
  const A = await listen((req, res) => {
    seenA.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.headers.authorization !== `token ${T}`) { res.writeHead(401); res.end('401'); return; }
    if (req.url === '/go') { res.writeHead(302, { location: `${originB}/landing` }); res.end(); return; }
    if (req.url === '/hop.png') { res.writeHead(302, { location: `${originB}/pic.png` }); res.end(); return; }
    if (req.url === '/style.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end('h1{color:rgb(1,2,3)}'); return; }
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
      res.end(gzipSync('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Protected page</h1><img id="hop" src="/hop.png"></body></html>'));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  const originA = `http://127.0.0.1:${A.address().port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, originA, `token ${T}`);
    const page = await context.newPage();
    const answer = await page.goto(`${originA}/page`, { waitUntil: 'networkidle' });
    assert.equal(answer.status(), 200);
    assert.equal(await page.textContent('h1'), 'Protected page', 'the gzip body is decoded');
    assert.equal(await page.$eval('h1', (h) => getComputedStyle(h).color), 'rgb(1, 2, 3)', 'the stylesheet of the origin applied');
    assert.ok(await page.$eval('#hop', (i) => i.complete && i.naturalWidth === 1), 'the image redirected to the other origin loaded');
    await page.goto(`${originA}/go`);
    assert.equal(page.url(), `${originB}/landing`, 'the page redirect was followed');
    assert.ok(seenA.every((q) => q.authorization === `token ${T}`), 'every request to origin A carried the token');
    assert.deepEqual(seenA.map((q) => q.path).sort(), ['/go', '/hop.png', '/page', '/style.css']);
    assert.deepEqual(seenB.map((q) => q.path).sort(), ['/landing', '/pic.png']);
    assert.deepEqual(seenB.filter((q) => q.authorization), [], 'origin B saw an Authorization');
  } finally {
    await browser.close();
    for (const s of [A, B]) { s.closeAllConnections(); s.close(); }
  }
});

// An origin that never answers well: `how` is 'drop' (the socket is destroyed) or 'stall' (the request is never answered).
async function failingOrigin(how) {
  const seen = [];
  const server = await listen((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    if (how === 'drop') req.socket.destroy();
    else if (req.headers.authorization !== `token ${T}`) { res.writeHead(401); res.end('401'); }
  });
  return { seen, origin: `http://127.0.0.1:${server.address().port}`, stop: () => { server.closeAllConnections(); server.close(); } };
}

for (const how of ['drop', 'stall']) {
  test(`attachSiteAuth in Chromium: an origin that ${how === 'drop' ? 'drops the connection' : 'never answers'} fails the page loudly and is never retried without the token${how === 'drop' ? ' (one stderr line names it)' : ''}`, { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
    const { chromium } = await import('playwright');
    const site = await failingOrigin(how);
    const lines = [];
    const real = console.error;
    console.error = (...a) => { lines.push(a.join(' ')); };
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await attachSiteAuth(context, site.origin, `token ${T}`);
      const page = await context.newPage();
      // a stall is bounded by the navigation's own timeout, not by one inside the route
      await assert.rejects(page.goto(`${site.origin}/page`, { timeout: how === 'stall' ? 2500 : 15000 }), (e) => (how === 'drop' ? /ERR_FAILED/.test(e.message) : /Timeout/.test(e.message)) && !e.message.includes(T));
      if (how === 'drop') assert.deepEqual(lines, [`site-auth: a request to ${site.origin} failed and was not retried without the site token`]);
      assert.ok(site.seen.length >= 1);
      assert.ok(site.seen.every((q) => q.authorization === `token ${T}`), `an unauthenticated request reached the origin: ${JSON.stringify(site.seen)}`);
    } finally {
      console.error = real;
      await browser.close();
      site.stop();
    }
  });
}

