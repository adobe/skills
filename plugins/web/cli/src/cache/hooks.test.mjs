import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CACHE_STATS_CODE, cacheHooksCode } from '#src/cache/hooks.mjs';
import { harFileName } from '#src/cache/har.mjs';
import { startKeeper } from '#src/cache/keeper.mjs';

const A = 'https://site.test/a';
const B = 'https://site.test/b';

// Runs a run-code snippet the way playwright-cli does: a function of `page`.
const compile = (code) => new Function(`return (${code});`)();

/** APIRequestContext stand-in backed by real HTTP, so the keeper protocol is exercised. */
const apiRequest = {
  async post(url, { data }) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      redirect: 'manual',
    });
    const body = Buffer.from(await res.arrayBuffer());
    return {
      status: () => res.status,
      headers: () => Object.fromEntries(res.headers),
      body: async () => body,
    };
  },
};

function fakePage() {
  const context = {
    routes: [],
    listeners: {},
    request: apiRequest,
    async route(pattern, handler) {
      this.routes.push(handler);
    },
    on(event, handler) {
      this.listeners[event] = handler;
    },
  };
  const page = { context: () => context };
  return { page, context };
}

function fakeRequest(page, { url, method = 'GET', nav = false, redirectedFrom = null }) {
  const frame = { page: () => page, parentFrame: () => null };
  return {
    url: () => url,
    method: () => method,
    isNavigationRequest: () => nav,
    frame: () => frame,
    redirectedFrom: () => redirectedFrom,
    headersArray: async () => [{ name: 'accept', value: '*/*' }],
  };
}

function fakeRoute(request) {
  const calls = [];
  return {
    calls,
    request: () => request,
    fallback: async () => calls.push(['fallback']),
    fulfill: async (options) => calls.push(['fulfill', options]),
  };
}

function fakeResponse(request, { status = 200, body = '<h1>x</h1>', mime = 'text/html' } = {}) {
  return {
    request: () => request,
    status: () => status,
    statusText: () => '',
    headers: () => ({ 'content-type': mime }),
    headersArray: async () => [{ name: 'content-type', value: mime }],
    body: async () => {
      if (body instanceof Error) throw body;
      return Buffer.from(body);
    },
  };
}

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hooks-'));
  const keeper = await startKeeper({ cacheDir: dir, port: 0 });
  t.after(() => keeper.stop());
  const { page, context } = fakePage();
  assert.equal(await compile(cacheHooksCode(keeper.port))(page), 'installed');
  const visit = async (opts, responseOpts) => {
    const request = fakeRequest(page, opts);
    const route = fakeRoute(request);
    await context.routes[0](route);
    if (responseOpts !== null)
      await context.listeners.response(fakeResponse(request, responseOpts));
    return route.calls;
  };
  return { dir, keeper, page, context, visit };
}

test('miss falls back and the response is stored', async (t) => {
  const { keeper, visit } = await setup(t);
  const calls = await visit({ url: A, nav: true });
  assert.deepEqual(calls, [['fallback']]);
  assert.equal(keeper.stats.stored, 1);
});

test('hit is fulfilled and not stored again', async (t) => {
  const { keeper, visit } = await setup(t);
  await visit({ url: A, nav: true }, { body: '<h1>a</h1>' });
  const calls = await visit({ url: A, nav: true }, { body: '<h1>a</h1>' });
  assert.equal(calls[0][0], 'fulfill');
  const { response } = calls[0][1];
  assert.equal(response.status(), 200);
  assert.equal((await response.body()).toString(), '<h1>a</h1>');
  assert.equal(keeper.stats.stored, 1);
});

test('redirect hop keeps the page', async (t) => {
  const { dir, visit } = await setup(t);
  const first = { url: A };
  await visit({ url: A, nav: true }, { status: 301, body: new Error('redirect') });
  await visit({ url: B, nav: true, redirectedFrom: first }, { body: '<h1>b</h1>' });
  const har = JSON.parse(readFileSync(path.join(dir, harFileName(A)), 'utf8'));
  assert.deepEqual(
    har.log.entries.map((e) => e.request.url),
    [A, B],
  );
});

test('unreadable body', async (t) => {
  const { keeper, visit } = await setup(t);
  await visit({ url: A, nav: true }, { status: 301, body: new Error('no body') });
  assert.equal(keeper.stats.stored, 1);
  await visit({ url: B }, { status: 200, body: new Error('aborted') });
  assert.equal(keeper.stats.stored, 1);
});

test('keeper down falls back', async (t) => {
  const { keeper, context, visit } = await setup(t);
  await keeper.stop();
  const calls = await visit({ url: A, nav: true });
  assert.deepEqual(calls, [['fallback']]);
  assert.equal(context.__webCache.errors, 2);
});

test('POST request is not looked up', async (t) => {
  const { keeper, visit } = await setup(t);
  const calls = await visit({ url: A, method: 'POST' });
  assert.deepEqual(calls, [['fallback']]);
  assert.equal(keeper.stats.misses, 0);
  assert.equal(keeper.stats.stored, 0);
});

test('installs once', async (t) => {
  const { keeper, page, context } = await setup(t);
  assert.equal(await compile(cacheHooksCode(keeper.port))(page), 'already');
  assert.equal(context.routes.length, 1);
});

test('stats snippet reports hook errors', async (t) => {
  const { keeper, page, visit } = await setup(t);
  assert.equal(await compile(CACHE_STATS_CODE)(page), 0);
  await keeper.stop();
  await visit({ url: A, nav: true });
  assert.equal(await compile(CACHE_STATS_CODE)(page), 2);
});

test('port must be an integer', () => {
  assert.throws(() => cacheHooksCode('1; evil()'), /port/);
});

test('stats snippet waits for pending stores', async (t) => {
  const { keeper, page, context } = await setup(t);
  const request = fakeRequest(page, { url: A, nav: true });
  await context.routes[0](fakeRoute(request));
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = { ...fakeResponse(request), body: async () => (await gate, Buffer.from('x')) };
  context.listeners.response(slow);
  const stats = compile(CACHE_STATS_CODE)(page);
  release();
  assert.equal(await stats, 0);
  assert.equal(keeper.stats.stored, 1);
});
