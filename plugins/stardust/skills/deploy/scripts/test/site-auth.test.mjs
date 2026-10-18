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

// A browser context as attachSiteAuth sees it: the route handler it registers; `visit` runs one request through the
// handler and returns the calls it made on its route. `answers` scripts the origin: url → { status, location }, 200 by
// default, shared by route.fetch and context.request.fetch; `failing` is a set of urls whose fetch throws.
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

test('attachSiteAuth: a redirect within the origin is walked, then replayed with the header so the browser follows it with the token; a redirect off it is handed over as it is, nothing of the origin follows', async () => {
  const header = `token ${T}`;
  const ctx = fakeContext({ answers: {
    'https://a.test/hop-a': { status: 302, location: '/page' },
    'https://a.test/hop-aa': { status: 301, location: 'https://a.test/hop-a' },
    'https://a.test/hop-b': { status: 302, location: 'https://b.test/page' },
    'https://a.test/hop-ab': { status: 307, location: '/hop-b' },
    'https://a.test/loop': { status: 302, location: '/loop' },
  } });
  await attachSiteAuth(ctx, 'https://a.test', header);
  const walkedUrls = () => ctx.walked.splice(0).map(([url]) => url);

  // A → A: continued with the header (the browser follows, its URL stays true); no answer is fulfilled
  assert.deepEqual(await ctx.visit('https://a.test/hop-a'), { fetched: { headers: { accept: '*/*', authorization: header }, maxRedirects: 0, timeout: 0 }, continued: { headers: { accept: '*/*', authorization: header } } });
  assert.deepEqual(walkedUrls(), ['https://a.test/page']);
  // A → A → A: two hops inside the origin, the same way
  const twice = await ctx.visit('https://a.test/hop-aa');
  assert.equal(twice.fulfilled, undefined); assert.deepEqual(twice.continued, { headers: { accept: '*/*', authorization: header } });
  assert.deepEqual(walkedUrls(), ['https://a.test/hop-a', 'https://a.test/page']);
  // A → B: the redirect is handed to the browser as it is; no request to B is made here, none with the token
  assert.deepEqual(await ctx.visit('https://a.test/hop-b'), { fetched: { headers: { accept: '*/*', authorization: header }, maxRedirects: 0, timeout: 0 }, fulfilled: 'https://a.test/hop-b' });
  assert.deepEqual(walkedUrls(), []);
  // A → A → B: the hop inside the origin is walked, the redirect off it is what the browser gets
  const viaA = await ctx.visit('https://a.test/hop-ab');
  assert.equal(viaA.continued, undefined); assert.equal(viaA.fulfilled, 'https://a.test/hop-b');
  assert.deepEqual(walkedUrls(), ['https://a.test/hop-b']);
  // the walk carries the header and the request's method, follows nothing itself
  await ctx.visit('https://a.test/hop-a', { accept: 'image/*' }, { method: 'HEAD' });
  assert.deepEqual(ctx.walked, [['https://a.test/page', { method: 'HEAD', headers: { accept: 'image/*', authorization: header }, maxRedirects: 0, timeout: 0 }]]);
  ctx.walked.length = 0;
  // another method gets its answer as it came, redirect included, and no walk
  assert.deepEqual(await ctx.visit('https://a.test/hop-a', { accept: '*/*' }, { method: 'POST' }), { fetched: { headers: { accept: '*/*', authorization: header }, maxRedirects: 0, timeout: 0 }, fulfilled: 'https://a.test/hop-a' });
  assert.deepEqual(ctx.walked, []);
});

test('attachSiteAuth: a redirect loop, or a chain still inside the origin after ten hops, fails closed — aborted, one stderr line naming the origin and the hop count, never replayed or handed over', async () => {
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const chain = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`https://a.test/c${i}`, { status: 302, location: `/c${i + 1}` }]));
    const ctx = fakeContext({ answers: { 'https://a.test/loop': { status: 302, location: '/loop' }, ...chain(11) } });
    await attachSiteAuth(ctx, 'https://a.test', `token ${T}`);
    // ten hops inside the origin and then an answer is within the budget: replayed
    const within = fakeContext({ answers: chain(10) });
    await attachSiteAuth(within, 'https://a.test', `token ${T}`);
    assert.equal((await within.visit('https://a.test/c0')).aborted, undefined);
    assert.deepEqual(Object.keys(await within.visit('https://a.test/c0')), ['fetched', 'continued']);
    assert.equal(lines.length, 0);
    // a loop and a chain of eleven redirects are not
    const loop = await ctx.visit('https://a.test/loop');
    assert.deepEqual(loop, { fetched: { headers: { accept: '*/*', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 }, aborted: 'failed' });
    assert.equal(ctx.walked.length, 10, 'the walk stopped at the budget');
    ctx.walked.length = 0;
    assert.equal((await ctx.visit('https://a.test/c0')).aborted, 'failed');
    assert.deepEqual(lines, [
      'site-auth: a redirect chain inside https://a.test was still going after 10 hops (a loop?) and was not followed without the site token',
    ], 'one line per attachSiteAuth');
    assert.ok(!lines.join('').includes(T));
  } finally { console.error = real; }
});

test('attachSiteAuth: a request of the origin that fails — at the first fetch or on a hop of its redirect — is aborted, never continued without the header; one stderr line names the origin and no token', async () => {
  const lines = [];
  const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const ctx = fakeContext({ answers: { 'https://a.test/hop-a': { status: 302, location: '/page' } }, failing: ['https://a.test/page', 'https://a.test/style.css'] });
    await attachSiteAuth(ctx, 'https://a.test', `token ${T}`);
    const first = await ctx.visit('https://a.test/style.css', { accept: '*/*', authorization: `token ${T}` });
    const hop = await ctx.visit('https://a.test/hop-a');
    assert.deepEqual(first, { aborted: 'failed' });
    assert.deepEqual(hop, { fetched: { headers: { accept: '*/*', authorization: `token ${T}` }, maxRedirects: 0, timeout: 0 }, aborted: 'failed' });
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
// /hop-b, /hop-pic → B's /pic.png. The token must ride every hop inside A and reach B on none.
async function withFixture(fn) {
  const { chromium } = await import('playwright');
  const fx = await startTwoOriginServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, fx.originA, fx.authorization);
    const page = await context.newPage();
    await fn(fx, page);
  } finally { await browser.close(); await fx.stop(); }
}
const onA = (fx, path) => fx.a.log.filter((q) => q.path === path);
const chromiumTest = (name, fn) => test(name, { skip: !hasBrowser && 'playwright / Chromium not available' }, () => withFixture(fn));
// An image request for `src` from a page of origin A: its natural width, or -1 when it did not decode
const imageWidth = (page, src) => page.evaluate((u) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth); i.onerror = () => resolve(-1); i.src = u; }), src);

chromiumTest('a document redirected within the origin (A → A) keeps the token: the page behind it is served to it, its stylesheet and image come from B without it', async (fx, page) => {
  await page.goto(`${fx.originA}/hop-a`, { waitUntil: 'load' });
  assert.equal(page.url(), `${fx.originA}/page`, 'the redirect was followed');
  assert.equal(await page.textContent('h1'), 'Protected fixture');
  // the origin is asked twice for /hop-a: once to read the redirect, once when the browser's own request is replayed with the header
  assert.ok(onA(fx, '/hop-a').length >= 1 && onA(fx, '/hop-a').every((q) => q.status === 302 && q.authorization === fx.authorization));
  assert.ok(onA(fx, '/page').length >= 1 && onA(fx, '/page').every((q) => q.status === 200 && q.authorization === fx.authorization), 'the page was served to the token');
  assert.ok(fx.a.log.every((q) => q.authorization === fx.authorization), 'every request to origin A carried the token');
  assert.deepEqual(fx.b.log.map((q) => q.path).sort(), ['/pic.png', '/style.css']);
  assert.deepEqual(fx.authorizations('B'), []);
});

chromiumTest('a document redirected within the origin and then off it (A → A → B): B gets the page request and no token', async (fx, page) => {
  await page.goto(`${fx.originA}/hop-ab`, { waitUntil: 'load' });
  assert.equal(page.url(), `${fx.originB}/page`, 'the redirect was followed');
  assert.deepEqual(onA(fx, '/hop-ab').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.ok(onA(fx, '/hop-b').length >= 1 && onA(fx, '/hop-b').every((q) => q.status === 302 && q.authorization === fx.authorization));
  assert.ok(fx.b.log.some((q) => q.path === '/page' && q.status === 200), 'origin B served the page');
  assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
});

chromiumTest('a document redirected off the origin (A → B): B gets the page request and no token', async (fx, page) => {
  await page.goto(`${fx.originA}/hop-b`, { waitUntil: 'load' });
  assert.equal(page.url(), `${fx.originB}/page`);
  assert.deepEqual(onA(fx, '/hop-b').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.ok(fx.b.log.some((q) => q.path === '/page' && q.status === 200));
  assert.deepEqual(fx.authorizations('B'), []);
});

chromiumTest('an image redirected off the origin (A → B) loads, and B gets no token', async (fx, page) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  assert.equal(await imageWidth(page, '/hop-pic'), 1, 'the image behind the redirect loaded');
  assert.deepEqual(onA(fx, '/hop-pic').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.deepEqual(fx.b.log.map((q) => q.path), ['/pic.png']);
  assert.deepEqual(fx.authorizations('B'), []);
});

chromiumTest('an image request redirected within the origin (A → A) is followed with the token', async (fx, page) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  await imageWidth(page, '/hop-a'); // the redirect lands on the HTML page, which is no image — what matters is who asked
  assert.ok(onA(fx, '/hop-a').length >= 1 && onA(fx, '/hop-a').every((q) => q.status === 302 && q.authorization === fx.authorization));
  const follow = onA(fx, '/page');
  assert.ok(follow.length >= 1 && follow.every((q) => q.status === 200 && q.authorization === fx.authorization && /image/.test(q.accept || '')), `the follow-up went out without the token or as no image request: ${JSON.stringify(follow)}`);
  assert.deepEqual(fx.authorizations('B'), []);
});

chromiumTest('an image request redirected within the origin and then off it (A → A → B): B gets the request and no token', async (fx, page) => {
  await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
  fx.reset();
  await imageWidth(page, '/hop-ab'); // B answers with its HTML page, which is no image
  assert.deepEqual(onA(fx, '/hop-ab').map((q) => [q.status, q.authorization]), [[302, fx.authorization]]);
  assert.ok(fx.b.log.some((q) => q.path === '/page' && /image/.test(q.accept || '')), 'the redirected image request reached origin B');
  assert.deepEqual(fx.authorizations('B'), []);
});

// A same-origin image redirect that ends in a real image, on an origin of its own
test('an image redirected within the origin loads (A → A): the follow-up carries the token', { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
  const { chromium } = await import('playwright');
  const seen = [];
  const A = await listen((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization || null });
    if (req.headers.authorization !== `token ${T}`) { res.writeHead(401); res.end('401'); return; }
    if (req.url === '/pic') { res.writeHead(302, { location: '/real.png' }); res.end(); } else if (req.url === '/real.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><p>page</p>'); }
  });
  const origin = `http://127.0.0.1:${A.address().port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await attachSiteAuth(context, origin, `token ${T}`);
    const page = await context.newPage();
    await page.goto(`${origin}/page`);
    assert.equal(await imageWidth(page, '/pic'), 1, 'the image behind the redirect loaded');
    assert.ok(seen.some((q) => q.path === '/real.png'), 'the redirect target was requested');
    assert.ok(seen.every((q) => q.authorization === `token ${T}`), `a request reached the origin without the token: ${JSON.stringify(seen)}`);
  } finally { await browser.close(); A.closeAllConnections(); A.close(); }
});

// A same-origin redirect loop must not end on a silent 401: the page fails, the route says why, and every request the
// origin saw carried the token.
test('attachSiteAuth in Chromium: a same-origin redirect loop fails the page loudly — one stderr line naming the origin and the hop count, no request without the token', { skip: !hasBrowser && 'playwright / Chromium not available' }, async () => {
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
    await assert.rejects(page.goto(`${origin}/loop`, { timeout: 15000 }), (e) => /ERR_FAILED/.test(e.message) && !e.message.includes(T));
    assert.deepEqual(lines, [`site-auth: a redirect chain inside ${origin} was still going after 10 hops (a loop?) and was not followed without the site token`]);
    assert.ok(seen.length >= 1 && seen.every((q) => q.authorization === `token ${T}`), `a request reached the origin without the token: ${JSON.stringify(seen)}`);
    assert.ok(!seen.some((q) => q.authorization === null), 'no 401 was measured');
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

