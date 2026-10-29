import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { harFileName, loadHarIndex } from '#src/cache/har.mjs';
import { startKeeper } from '#src/cache/keeper.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'keeper-'));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const A = 'https://site.test/a';
const B = 'https://site.test/b';
const CSS = 'https://site.test/s.css';

async function withKeeper(t, opts = {}) {
  const dir = opts.cacheDir ?? (await tmp());
  const keeper = await startKeeper({ cacheDir: dir, port: 0, ...opts });
  t.after(() => keeper.stop());
  return { dir, keeper };
}

const post = (keeper, route, body, headers = {}) =>
  fetch(`${keeper.url}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });

const lookup = (keeper, url, page, nav = false) =>
  post(keeper, '/lookup', { url, page, nav, redirect: false });

function store(keeper, { url, page, body = '', status = 200, method = 'GET', mime = 'text/html' }) {
  return post(keeper, '/store', {
    page,
    method,
    url,
    status,
    statusText: '',
    requestHeaders: [{ name: 'accept', value: '*/*' }],
    headers: [{ name: 'content-type', value: mime }],
    mimeType: mime,
    body: Buffer.from(body).toString('base64'),
  });
}

const readHar = (dir, url) =>
  JSON.parse(readFileSync(path.join(dir, harFileName(url)), 'utf8')).log.entries;

test('store writes body and page HAR', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  assert.equal((await lookup(keeper, A, 1, true)).status, 404);
  assert.equal((await store(keeper, { url: A, page: 1, body: '<h1>a</h1>' })).status, 204);
  const [entry] = readHar(dir, A);
  assert.equal(entry.request.url, A);
  assert.equal(entry.response.content._file, `${sha1('<h1>a</h1>')}.html`);
  assert.equal(readFileSync(path.join(dir, entry.response.content._file), 'utf8'), '<h1>a</h1>');
  assert.equal(keeper.stats.stored, 1);
  assert.equal(keeper.stats.misses, 1);
});

test('stored response is a hit for the next lookup', async (t) => {
  const { keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, body: '<h1>a</h1>' });
  const res = await lookup(keeper, A, 2, true);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-web-cache'), 'hit');
  assert.equal(res.headers.get('content-type'), 'text/html');
  assert.equal(await res.text(), '<h1>a</h1>');
  assert.equal(keeper.stats.hits, 1);
});

test('miss answers 404 with x-web-cache: miss', async (t) => {
  const { keeper } = await withKeeper(t);
  const res = await lookup(keeper, A, 1, true);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-web-cache'), 'miss');
});

test('cached redirect is returned as-is', async (t) => {
  const { keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await post(keeper, '/store', {
    page: 1,
    method: 'GET',
    url: A,
    status: 301,
    statusText: 'Moved',
    requestHeaders: [],
    headers: [{ name: 'location', value: B }],
    mimeType: '',
    body: '',
  });
  const res = await lookup(keeper, A, 2, true);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), B);
});

test('shared body stored once, listed in both pages', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: CSS, page: 1, body: 'h1{}', mime: 'text/css' });
  await lookup(keeper, B, 2, true);
  await store(keeper, { url: CSS, page: 2, body: 'h1{}', mime: 'text/css' });
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.css')).length, 1);
  assert.deepEqual(
    readHar(dir, A).map((e) => e.request.url),
    [CSS],
  );
  assert.deepEqual(
    readHar(dir, B).map((e) => e.request.url),
    [CSS],
  );
});

test('hit is appended to the page HAR', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: CSS, page: 1, body: 'h1{}', mime: 'text/css' });
  await lookup(keeper, B, 2, true);
  await store(keeper, { url: B, page: 2, body: '<h1>b</h1>' });
  assert.equal((await lookup(keeper, CSS, 2)).status, 200);
  const entries = readHar(dir, B);
  assert.deepEqual(
    entries.map((e) => e.request.url),
    [B, CSS],
  );
  assert.equal(entries[1].response.content._file, `${sha1('h1{}')}.css`);
});

test('redirect lookup keeps the current page', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await post(keeper, '/lookup', { url: B, page: 1, nav: true, redirect: true });
  await store(keeper, { url: B, page: 1, body: '<h1>b</h1>' });
  assert.deepEqual(
    readHar(dir, A).map((e) => e.request.url),
    [B],
  );
  assert.equal(existsSync(path.join(dir, harFileName(B))), false);
});

test('non-storable responses are ignored', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, method: 'POST' });
  await store(keeper, { url: A, page: 1, status: 304 });
  await store(keeper, { url: A, page: 1, status: 206, body: 'partial' });
  await store(keeper, { url: 'https://www.google-analytics.com/g/collect', page: 1 });
  await store(keeper, { url: 'data:text/plain,hi', page: 1 });
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(keeper.stats.stored, 0);
});

test('existing HARs are served', async (t) => {
  const dir = await tmp();
  const first = await startKeeper({ cacheDir: dir, port: 0 });
  await lookup(first, A, 1, true);
  await store(first, { url: A, page: 1, body: '<h1>a</h1>' });
  await first.stop();
  const { keeper } = await withKeeper(t, { cacheDir: dir });
  assert.equal(keeper.entries, 1);
  const res = await lookup(keeper, A, 1, true);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h1>a</h1>');
});

test('written HARs load with loadHarIndex', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, body: '<h1>a</h1>' });
  const hit = loadHarIndex(dir).get(`GET ${A}`);
  assert.equal(hit.status, 200);
  assert.equal(hit.body().toString(), '<h1>a</h1>');
});

test('no .tmp left behind', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, body: 'x' });
  await store(keeper, { url: CSS, page: 1, body: 'y', mime: 'text/css' });
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.endsWith('.tmp')),
    [],
  );
});

test('creates a missing cache dir', async (t) => {
  const dir = path.join(await tmp(), 'nested', 'cache');
  await withKeeper(t, { cacheDir: dir });
  assert.equal(existsSync(dir), true);
});

test('requests from a web page are refused', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  const cross = await post(keeper, '/store', {}, { 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403);
  const withOrigin = await post(keeper, '/lookup', { url: A }, { origin: 'https://evil.test' });
  assert.equal(withOrigin.status, 403);
  assert.equal(readdirSync(dir).length, 0);
});

test('__stop refused from a page, accepted directly', async (t) => {
  const { keeper } = await withKeeper(t);
  const refused = await fetch(`${keeper.url}/__stop`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(refused.status, 403);
  const ok = await fetch(`${keeper.url}/__stop`);
  assert.equal(ok.status, 200);
  await keeper.closed;
});

test('__status reports stats and entries', async (t) => {
  const { keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  const status = await (await fetch(`${keeper.url}/__status`)).json();
  assert.deepEqual(status, { hits: 0, misses: 1, stored: 0, errors: 0, entries: 0 });
});

test('liveness stops keeper', async () => {
  const keeper = await startKeeper({
    cacheDir: await tmp(),
    port: 0,
    isSessionOpen: () => false,
    livenessMs: 20,
  });
  await keeper.closed;
});

test('malformed body answers 400 and is counted', async (t) => {
  const { keeper } = await withKeeper(t);
  assert.equal((await post(keeper, '/store', '{bad')).status, 400);
  assert.equal((await post(keeper, '/lookup', '{bad')).status, 400);
  assert.equal(keeper.stats.errors, 2);
  assert.equal((await lookup(keeper, A, 1, true)).status, 404);
});

const pageHar = (dir, url) => JSON.parse(readFileSync(path.join(dir, harFileName(url)), 'utf8'));

test('error responses are recorded but not served', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, status: 404, body: 'nf' });
  const [entry] = readHar(dir, A);
  assert.equal(entry.response.status, 404);
  assert.equal(readFileSync(path.join(dir, entry.response.content._file), 'utf8'), 'nf');
  const res = await lookup(keeper, A, 2, true);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-web-cache'), 'miss');
  assert.equal(keeper.stats.stored, 1);
  assert.equal(keeper.stats.hits, 0);
});

test('errors in existing HARs are not indexed', async (t) => {
  const dir = await tmp();
  const first = await startKeeper({ cacheDir: dir, port: 0 });
  await lookup(first, A, 1, true);
  await store(first, { url: A, page: 1, status: 500, body: 'boom' });
  await store(first, { url: CSS, page: 1, body: 'h1{}', mime: 'text/css' });
  await first.stop();
  const { keeper } = await withKeeper(t, { cacheDir: dir });
  assert.equal(keeper.entries, 1);
  assert.equal((await lookup(keeper, A, 1, true)).status, 404);
  assert.equal((await lookup(keeper, CSS, 1)).status, 200);
});

test('redirectURL is the absolute location', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await post(keeper, '/store', {
    page: 1,
    method: 'GET',
    url: A,
    status: 301,
    statusText: 'Moved',
    requestHeaders: [],
    headers: [{ name: 'Location', value: '/b' }],
    mimeType: '',
    body: '',
  });
  await store(keeper, { url: B, page: 1, body: '<h1>b</h1>' });
  const entries = readHar(dir, A);
  assert.equal(entries[0].response.redirectURL, B);
  assert.equal(entries[1].response.redirectURL, '');
});

test('page HAR lists the page and pageref', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: A, page: 1, body: '<h1>a</h1>' });
  await store(keeper, { url: CSS, page: 1, body: 'h1{}', mime: 'text/css' });
  const { log } = pageHar(dir, A);
  assert.equal(log.pages.length, 1);
  assert.equal(log.pages[0].id, 'page_1');
  assert.equal(log.pages[0].title, A);
  assert.deepEqual(log.pages[0].pageTimings, {});
  assert.deepEqual(
    log.entries.map((e) => e.pageref),
    ['page_1', 'page_1'],
  );
});

test('entries are ordered by request start', async (t) => {
  const { dir, keeper } = await withKeeper(t);
  await lookup(keeper, A, 1, true);
  await store(keeper, { url: CSS, page: 1, body: 'h1{}', mime: 'text/css' });
  await lookup(keeper, B, 2, true);
  const documentStart = Date.now() - 1000;
  assert.equal((await lookup(keeper, CSS, 2)).status, 200);
  await post(keeper, '/store', {
    page: 2,
    method: 'GET',
    url: B,
    status: 404,
    statusText: '',
    requestHeaders: [],
    headers: [],
    mimeType: 'text/html',
    body: '',
    startedAt: documentStart,
  });
  const entries = readHar(dir, B);
  assert.deepEqual(
    entries.map((e) => e.request.url),
    [B, CSS],
  );
  assert.equal(entries[0].startedDateTime, new Date(documentStart).toISOString());
});
