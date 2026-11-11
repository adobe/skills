/*
 * Engine transport (contract sections 5 and 10): provider-api.js callEngine
 * (shared with the edge) and fetchDecisions (browser session cache).
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';

const MODULE = pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'provider-api.js')).href;
const {
  fetchDecisions, callEngine, EngineError, CACHE_PREFIX,
} = await import(MODULE);

const BODY = {
  version: '1',
  page: { path: '/' },
  placeholders: [{ id: 'a', candidates: ['x', 'default'], fragments: { x: '/fragments/a/x' } }],
  context: { params: {}, consent: { personalization: true } },
  mode: 'client',
};

function memory() {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
}

const hang = (url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

describe('callEngine', () => {
  it('POSTs JSON with extra headers and returns the parsed v1 response', async () => {
    let seen;
    const result = await callEngine({
      url: 'https://engine.example/decide',
      body: BODY,
      timeout: 500,
      headers: { authorization: 'Bearer k' },
      fetchImpl: async (url, init) => { seen = { url, init }; return Response.json({ decisions: { a: { variant: 'x' } }, ttl: 0 }); },
    });
    assert.equal(seen.url, 'https://engine.example/decide');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['content-type'], 'application/json');
    assert.equal(seen.init.headers.authorization, 'Bearer k');
    assert.deepEqual(JSON.parse(seen.init.body), BODY);
    assert.deepEqual(result, { decisions: { a: { variant: 'x' } }, ttl: 0, cacheable: false });
  });

  it('gives mapResponse the v1 request too (engines answering with positions)', async () => {
    let received;
    const result = await callEngine({
      url: '/d',
      body: BODY,
      timeout: 500,
      mapRequest: (body) => ({ url: '/vendor?page=/', init: { method: 'GET' }, body: { ids: body.placeholders.map((p) => p.id) } }),
      mapResponse: (json, v1) => {
        received = v1;
        return { decisions: { a: { variant: v1.placeholders[0].candidates[json.pick] } } };
      },
      fetchImpl: async (url, init) => {
        assert.equal(url, '/vendor?page=/');
        assert.equal(init.method, 'GET');
        assert.equal('body' in init, false);
        return Response.json({ pick: 0 });
      },
    });
    assert.equal(received, BODY);
    assert.deepEqual(result.decisions, { a: { variant: 'x' } });
  });

  it('throws an EngineError of the right kind', async () => {
    const kind = async (fetchImpl, timeout = 500) => {
      try {
        await callEngine({
          url: '/d', body: BODY, timeout, fetchImpl,
        });
        return 'none';
      } catch (error) {
        assert.ok(error instanceof EngineError);
        return [error.kind, error.message];
      }
    };
    assert.deepEqual(await kind(async () => new Response('x', { status: 500 })), ['http', 'HTTP 500']);
    assert.deepEqual((await kind(async () => new Response('{bad')))[0], 'json');
    assert.deepEqual(await kind(async () => Response.json({ nope: true })), ['contract', 'response has no "decisions" object']);
    assert.deepEqual(await kind(async () => { throw new TypeError('Failed to fetch'); }), ['http', 'Failed to fetch']);
    assert.deepEqual(await kind(hang, 30), ['timeout', 'timed out after 30 ms']);
  });
});

describe('fetchDecisions (browser)', () => {
  it('posts same-origin, caches for the ttl, and reports a reuse within the page view as not cached', async () => {
    const storage = memory();
    let clock = 1000;
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ decisions: { a: { variant: 'x' } }, ttl: 60 });
    };
    const options = {
      endpoint: '/pzn/decide', body: BODY, timeout: 500, storage, fetchImpl, now: () => clock,
    };
    const first = await fetchDecisions(options);
    assert.deepEqual(first.response.decisions, { a: { variant: 'x' } });
    assert.equal(first.cached, false);
    assert.equal(calls[0].url, '/pzn/decide');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.ok(Object.keys(storage.data)[0].startsWith(CACHE_PREFIX));

    // refresh() in the same page view: the same answer, not a cached one.
    const again = await fetchDecisions(options);
    assert.equal(calls.length, 1);
    assert.equal(again.cached, false);

    // The next page view (a fresh module) reuses it: cached: true.
    const { fetchDecisions: nextView } = await import(`${MODULE}?view=2`);
    assert.equal((await nextView(options)).cached, true);
    assert.equal(calls.length, 1);

    clock += 61000;
    assert.equal((await nextView(options)).cached, false);
    assert.equal(calls.length, 2);
  });

  it('keeps nothing without storage (no consent) or with ttl 0', async () => {
    let calls = 0;
    const storage = memory();
    const fetchImpl = async () => { calls += 1; return Response.json({ decisions: {}, ttl: 0 }); };
    const body = { ...BODY, page: { path: '/no-cache' } };
    await fetchDecisions({
      endpoint: '/d', body, timeout: 500, fetchImpl, storage,
    });
    await fetchDecisions({
      endpoint: '/d', body, timeout: 500, fetchImpl,
    });
    assert.equal(calls, 2);
    assert.deepEqual(storage.data, {});
  });

  it('resolves every failure to an error with its kind', async () => {
    const run = (fetchImpl, timeout = 500) => fetchDecisions({
      endpoint: '/d', body: { ...BODY, page: { path: `/${Math.random()}` } }, timeout, fetchImpl,
    });
    const failed = await run(async () => new Response('x', { status: 500 }));
    assert.deepEqual([failed.error, failed.kind, failed.response], ['HTTP 500', 'http', undefined]);
    assert.equal((await run(async () => new Response('{bad'))).kind, 'json');
    assert.equal((await run(async () => Response.json({ nope: true }))).kind, 'contract');
    assert.equal((await run(async () => { throw new TypeError('Failed to fetch'); })).kind, 'http');
    const slow = await run(hang, 30);
    assert.deepEqual([slow.kind, slow.error], ['timeout', 'timed out after 30 ms']);
  });
});
