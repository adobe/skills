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
import { startTwoOriginServer } from '../../../replica/scripts/test/fixtures/two-origin-server.mjs';

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
    && e.message === '--token-env: the .env line for the variable it names is not in a form that is read; it must be exactly NAME=value (no export, no spaces round the =, no indent)');
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_Y', urls: ['https://a.test/'], env: {}, cwd }), (e) => /^no site token: the variable --token-env names is not set/.test(e.message), 'another variable is plainly not set');
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
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_NOT_SET', urls, env: {}, cwd }), (e) => e.code === 2 && e.message === 'no site token: the variable --token-env names is not set (or is empty) in the environment or in .env');
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'SITE_BLANK', urls, env: {}, cwd }), (e) => e.code === 2 && /^no site token: the variable --token-env names is not set/.test(e.message));
  assert.throws(() => instrumentSiteAuth({ tokenEnv: `token ${T}`, urls, env: {}, cwd }), (e) => e.code === 2 && !e.message.includes(T));
  assert.throws(() => instrumentSiteAuth({ tokenEnv: 'hlx_AbC123secretValue', urls, env: {}, cwd }), (e) => e.code === 2 && !e.message.includes('hlx_AbC123secretValue') && /--token-env/.test(e.message), 'a token shaped like a name is not echoed');
});

// A browser context as attachSiteAuth sees it: the route handler it registers; `visit` runs one request through the
// handler and returns the calls it made on its route (a `continued` key would be a release to the browser). `answers`
// scripts the origin: url → { status, location }, 200 by default; `failing` is a set of urls whose fetch throws;
// `walked` records any request made beside the route's own (context.request.fetch), which must stay empty.
function fakeContext({ answers = {}, failing = [] } = {}) {
  const walked = [];
  const answer = (url) => { const a = answers[url] || { status: 200 }; return { answer: url, status: () => a.status, headers: () => (a.location ? { location: a.location } : {}) }; };
  const ctx = {
    walked,
    async route(pattern, handler) { ctx.pattern = pattern; ctx.handler = handler; },
    request: { fetch: async (url, o) => { walked.push([url, o]); if (failing.includes(url)) throw new Error('network'); return answer(url); } },
    async visit(url, headers = { accept: '*/*' }, { method = 'GET' } = {}) {
      const done = {};
      await ctx.handler({
        request: () => ({ url: () => url, headers: () => headers, method: () => method }),
        fallback: async () => { done.fellBack = true; },
        continue: async (o) => { done.continued = o || {}; },
        abort: async (code) => { done.aborted = code; },
        fetch: async (o) => { if (failing.includes(url)) throw new Error(`network ${headers.authorization || ''}`); done.fetched = o; return answer(url); },
        fulfill: async (o) => { done.fulfilled = o.response.answer; },
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
  assert.deepEqual(await ctx.visit('https://a.test/page', { accept: 'text/html' }), { fetched: { headers: { accept: 'text/html', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 }, fulfilled: 'https://a.test/page' });
  assert.deepEqual((await ctx.visit('https://a.test', {})).fetched, { headers: { authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 });
  assert.deepEqual((await ctx.visit('https://a.test/x?y=1#z', { authorization: 'token other' })).fetched.headers, { authorization: `token ${T}` });
  for (const other of ['https://cdn.test/font.woff2', 'https://a.test.evil.test/x', 'https://evil.test/https://a.test/', 'https://sub.a.test/x', 'http://a.test/x', 'https://a.test:8443/x', 'https://a.test@evil.test/x', 'data:text/plain,hi', 'blob:https://a.test/1', 'not a url']) {
    assert.deepEqual(await ctx.visit(other), { fellBack: true }, `${other}: passed on untouched, nothing fetched`);
  }
  assert.deepEqual(ctx.walked, []);
});

test('attachSiteAuth: a redirect is never followed or replayed with the header — one off the origin is handed to the browser as it came, one within it is aborted with one stderr line per redirect naming the origin and the two paths; any method', async () => {
  const header = `token ${T}`;
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const ctx = fakeContext({ answers: {
      'https://a.test/hop-a': { status: 302, location: '/page' },
      'https://a.test/hop-aa': { status: 301, location: 'https://a.test/hop-a' },
      'https://a.test/hop-b': { status: 302, location: 'https://b.test/page' },
      'https://a.test/hop-ab': { status: 307, location: '/hop-b' },
      'https://a.test/loop': { status: 308, location: '/loop' },
      'https://a.test/see-other': { status: 303, location: '/done?session=s3cr3t' },
      'https://a.test/to-http': { status: 302, location: 'http://a.test/page' },
      'https://a.test/no-location': { status: 302 },
      'https://a.test/not-modified': { status: 304, location: '/page' },
    } });
    await attachSiteAuth(ctx, 'https://a.test', header);
    const fetched = (headers = { accept: '*/*' }) => ({ headers: { ...headers, authorization: header }, maxRedirects: 0, timeout: 0 });
    const aborted = (headers) => ({ fetched: fetched(headers), aborted: 'failed' });
    const handedOver = (url) => ({ fetched: fetched(), fulfilled: url });
    // within the origin: aborted, wherever the chain would go next — the browser is never let to follow it
    for (const path of ['/hop-a', '/hop-aa', '/hop-ab', '/loop', '/see-other']) assert.deepEqual(await ctx.visit(`https://a.test${path}`), aborted(), path);
    // off the origin (another host, another scheme), or nothing to follow: handed over as it came
    for (const path of ['/hop-b', '/to-http', '/no-location', '/not-modified']) assert.deepEqual(await ctx.visit(`https://a.test${path}`), handedOver(`https://a.test${path}`), path);
    // any method, the same
    assert.deepEqual(await ctx.visit('https://a.test/hop-a', { accept: 'image/*' }, { method: 'HEAD' }), aborted({ accept: 'image/*' }));
    assert.deepEqual(await ctx.visit('https://a.test/hop-a', { accept: '*/*' }, { method: 'POST' }), aborted());
    assert.deepEqual(await ctx.visit('https://a.test/hop-b', { accept: '*/*' }, { method: 'POST' }), handedOver('https://a.test/hop-b'));
    assert.deepEqual(ctx.walked, [], 'nothing was asked beyond the request itself');
    const said = (from, to) => `site-auth: https://a.test redirected ${from} → ${to}; a site token is never replayed across a redirect — measure the final URL`;
    assert.deepEqual(lines, [said('/hop-a', '/page'), said('/hop-aa', '/hop-a'), said('/hop-ab', '/hop-b'), said('/loop', '/loop'), said('/see-other', '/done')], 'one line per redirect, a repeat not again; paths only');
    assert.ok(!lines.join('').includes(T) && !lines.join('').includes('s3cr3t'), 'no token, no query');
  } finally { console.error = real; }
});

test('attachSiteAuth: a request of the origin that fails is aborted, never continued without the header; one stderr line names the origin and no token', async () => {
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const ctx = fakeContext({ failing: ['https://a.test/page', 'https://a.test/style.css'] });
    await attachSiteAuth(ctx, 'https://a.test', `token ${T}`);
    assert.deepEqual(await ctx.visit('https://a.test/style.css', { accept: '*/*', authorization: `token ${T}` }), { aborted: 'failed' });
    assert.deepEqual(await ctx.visit('https://a.test/page'), { aborted: 'failed' });
    assert.deepEqual(lines, ['site-auth: a request to https://a.test failed and was not retried without the site token'], 'one line, not one per request');
    assert.ok(!lines.join('').includes(T));
  } finally { console.error = real; }
});

test('attachSiteAuth: a local origin with a port is matched exactly; nothing is registered without an origin or a header', async () => {
  const ctx = fakeContext();
  await attachSiteAuth(ctx, 'http://127.0.0.1:4000', `token ${T}`);
  assert.deepEqual((await ctx.visit('http://127.0.0.1:4000/page')).fetched, { headers: { accept: '*/*', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 });
  for (const other of ['http://127.0.0.1:40001/page', 'http://127.0.0.1:400/page', 'http://localhost:4000/page']) assert.deepEqual(await ctx.visit(other), { fellBack: true }, other);
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

// The two-origin fixture's redirect routes (origin A, protected): /hop-a → A's /page, /hop-b → B's /page, /hop-ab → A's
// /hop-b, /hop-pic → B's /pic.png, /loop → itself; /cookie-hop and /count-hop → A's /page, then B's /page when asked
// again. The token reaches origin A once per request and origin B never; no redirect within A is followed.
async function withFixture(fn) {
  const { chromium } = await import('playwright');
  const fx = await startTwoOriginServer();
  const browser = await chromium.launch();
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, fx.originA, fx.authorization);
    const page = await context.newPage();
    await fn(fx, page, lines);
  } finally { console.error = real; await browser.close(); await fx.stop(); }
}
const onA = (fx, path) => fx.a.log.filter((q) => q.path === path);
const askedA = (fx) => fx.a.log.map((q) => [q.path, q.status, q.authorization]);
const said = (origin, from, to) => `site-auth: ${origin} redirected ${from} → ${to}; a site token is never replayed across a redirect — measure the final URL`;
const chromiumTest = (name, fn) => test(name, { skip: !hasBrowser && 'playwright / Chromium not available' }, () => withFixture(fn));
// An image request for `src` from a page of origin A: its natural width, or -1 when it did not decode
const imageWidth = (page, src) => page.evaluate((u) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth); i.onerror = () => resolve(-1); i.src = u; }), src);
const failsLoudly = (page, url) => assert.rejects(page.goto(url, { waitUntil: 'load', timeout: 15000 }), (e) => /ERR_FAILED/.test(e.message) && !e.message.includes(T));

chromiumTest('a document redirected within the origin (A → A) fails the navigation: one stderr line names the origin and the two paths; the page behind it is never asked', async (fx, page, lines) => {
  await failsLoudly(page, `${fx.originA}/hop-a`);
  assert.deepEqual(lines, [said(fx.originA, '/hop-a', '/page')]);
  assert.deepEqual(askedA(fx), [['/hop-a', 302, fx.authorization]], 'one ask, with the token, and nothing after it');
  assert.deepEqual(fx.b.log, []);
});

chromiumTest('a document redirected within the origin and then off it (A → A → B): stopped at the first hop, origin B is never asked', async (fx, page, lines) => {
  await failsLoudly(page, `${fx.originA}/hop-ab`);
  assert.deepEqual(lines, [said(fx.originA, '/hop-ab', '/hop-b')]);
  assert.deepEqual(askedA(fx), [['/hop-ab', 302, fx.authorization]]);
  assert.deepEqual(fx.b.log, []);
});

chromiumTest('a document redirected off the origin (A → B): A sees the token once, B gets the page request and no token', async (fx, page, lines) => {
  await page.goto(`${fx.originA}/hop-b`, { waitUntil: 'load' });
  assert.equal(page.url(), `${fx.originB}/page`);
  assert.deepEqual(onA(fx, '/hop-b').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.ok(fx.b.log.some((q) => q.path === '/page' && q.status === 200));
  assert.deepEqual(fx.authorizations('B'), []);
  assert.deepEqual(lines, []);
});

chromiumTest('an image redirected off the origin (A → B) loads; A sees the token once, B none', async (fx, page, lines) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  assert.equal(await imageWidth(page, '/hop-pic'), 1, 'the image behind the redirect loaded');
  assert.deepEqual(onA(fx, '/hop-pic').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.deepEqual(fx.b.log.map((q) => q.path), ['/pic.png']);
  assert.deepEqual(fx.authorizations('B'), []);
  assert.deepEqual(lines, []);
});

chromiumTest('an image request redirected within the origin (A → A) fails with one stderr line; its target is never asked', async (fx, page, lines) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  assert.equal(await imageWidth(page, '/hop-a'), -1);
  assert.deepEqual(lines, [said(fx.originA, '/hop-a', '/page')]);
  assert.deepEqual(askedA(fx), [['/hop-a', 302, fx.authorization]]);
  assert.deepEqual(fx.authorizations('B'), []);
});

chromiumTest('an image request redirected within the origin and then off it (A → A → B): stopped at the first hop, origin B is never asked', async (fx, page, lines) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  assert.equal(await imageWidth(page, '/hop-ab'), -1);
  assert.deepEqual(lines, [said(fx.originA, '/hop-ab', '/hop-b')]);
  assert.deepEqual(askedA(fx), [['/hop-ab', 302, fx.authorization]]);
  assert.deepEqual(fx.b.log, []);
});

// The reviewer's case: the origin's first answer sets a cookie, and the same request asked again with it is sent to the
// other origin. Walking the first redirect and then letting the browser replay its request with the header sent the
// token there.
chromiumTest('a redirect within the origin that a cookie turns off it on the next ask: the first navigation fails loudly, the next ends on origin B, which never sees the token', async (fx, page, lines) => {
  await failsLoudly(page, `${fx.originA}/cookie-hop`);
  assert.deepEqual(lines, [said(fx.originA, '/cookie-hop', '/page')]);
  // a fresh tab: the first one is still showing its error page
  const tab = await page.context().newPage();
  await tab.goto(`${fx.originA}/cookie-hop`, { waitUntil: 'load' });
  assert.equal(tab.url(), `${fx.originB}/page`);
  assert.deepEqual(fx.a.log.map((q) => [q.path, q.status, q.authorization, q.cookie]), [['/cookie-hop', 302, fx.authorization, null], ['/cookie-hop', 302, fx.authorization, 'hopped=1']], 'the redirect target on A was never asked');
  assert.ok(fx.b.log.some((q) => q.path === '/page' && q.status === 200));
  assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
  assert.equal(lines.length, 1);
});

chromiumTest('a redirect within the origin that turns off it on the second ask: the first navigation fails loudly, the second ends on origin B, which never sees the token', async (fx, page, lines) => {
  await failsLoudly(page, `${fx.originA}/count-hop`);
  assert.deepEqual(lines, [said(fx.originA, '/count-hop', '/page')]);
  const tab = await page.context().newPage();
  await tab.goto(`${fx.originA}/count-hop`, { waitUntil: 'load' });
  assert.equal(tab.url(), `${fx.originB}/page`);
  assert.deepEqual(askedA(fx), [['/count-hop', 302, fx.authorization], ['/count-hop', 302, fx.authorization]]);
  assert.ok(fx.b.log.some((q) => q.path === '/page' && q.status === 200));
  assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
});

// A same-origin image redirect that would end in a real image, on an origin of its own
test('an image redirected within the origin (A → A) does not load: its target is never asked, every ask carried the token', { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
  const { chromium } = await import('playwright');
  const seen = [];
  const A = await listen((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.headers.authorization !== `token ${T}`) { res.writeHead(401); res.end('401'); return; }
    if (req.url === '/pic') { res.writeHead(302, { location: '/real.png' }); res.end(); } else if (req.url === '/real.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><p>page</p>'); }
  });
  const origin = `http://127.0.0.1:${A.address().port}`;
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, origin, `token ${T}`);
    const page = await context.newPage();
    await page.goto(`${origin}/page`);
    assert.equal(await imageWidth(page, '/pic'), -1, 'the image behind the redirect did not load');
    assert.deepEqual(lines, [said(origin, '/pic', '/real.png')]);
    assert.deepEqual(seen.map((q) => q.path), ['/page', '/pic'], 'the redirect target was never asked');
    assert.ok(seen.every((q) => q.authorization === `token ${T}`), `a request reached the origin without the token: ${JSON.stringify(seen)}`);
  } finally { console.error = real; await browser.close(); A.closeAllConnections(); A.close(); }
});

// A same-origin redirect loop must not end on a silent 401: the page fails, the route says why, and the origin was
// asked once, with the token.
test('attachSiteAuth in Chromium: a same-origin redirect loop fails the page loudly — one ask with the token, one stderr line naming the origin and the path', { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
  const { chromium } = await import('playwright');
  const seen = [];
  const site = await listen((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.headers.authorization !== `token ${T}`) { res.writeHead(401); res.end('401'); return; }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><p>page</p>'); }
  });
  const origin = `http://127.0.0.1:${site.address().port}`;
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, origin, `token ${T}`);
    const page = await context.newPage();
    await failsLoudly(page, `${origin}/loop`);
    assert.deepEqual(lines, [said(origin, '/loop', '/loop')]);
    assert.deepEqual(seen, [{ path: '/loop', authorization: `token ${T}` }], 'one ask, with the token; no 401 measured');
  } finally {
    console.error = real;
    await browser.close();
    site.closeAllConnections(); site.close();
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

