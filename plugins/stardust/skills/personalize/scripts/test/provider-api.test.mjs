import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';

const { fetchDecisions, CACHE_PREFIX } = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'provider-api.js')).href);

const BODY = { version: '1', page: { path: '/' }, placeholders: [{ id: 'a', candidates: ['x', 'default'] }], context: {} };

function memory() {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
}

describe('fetchDecisions', () => {
  it('posts the body same-origin and caches per visitor for the ttl', async () => {
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
    assert.deepEqual(first.decisions, { a: { variant: 'x' } });
    assert.equal(first.cached, false);
    assert.equal(calls[0].url, '/pzn/decide');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[0].init.body), BODY);
    assert.ok(Object.keys(storage.data)[0].startsWith(CACHE_PREFIX));

    assert.equal((await fetchDecisions(options)).cached, true);
    assert.equal(calls.length, 1);
    clock += 61000;
    assert.equal((await fetchDecisions(options)).cached, false);
    assert.equal(calls.length, 2);
  });

  it('does not cache without storage (no consent)', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return Response.json({ decisions: {}, ttl: 60 }); };
    await fetchDecisions({ endpoint: '/d', body: BODY, timeout: 500, fetchImpl });
    await fetchDecisions({ endpoint: '/d', body: BODY, timeout: 500, fetchImpl });
    assert.equal(calls, 2);
  });

  it('resolves every failure to null decisions', async () => {
    const run = (fetchImpl, timeout = 500) => fetchDecisions({
      endpoint: '/d', body: BODY, timeout, fetchImpl,
    });
    assert.match((await run(async () => new Response('x', { status: 500 }))).error, /HTTP 500/);
    assert.equal((await run(async () => new Response('{bad', { headers: { 'content-type': 'application/json' } }))).decisions, null);
    assert.match((await run(async () => Response.json({ nope: true }))).error, /no "decisions"/);
    assert.match((await run(async () => { throw new TypeError('Failed to fetch'); })).error, /Failed to fetch/);
    const hang = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    assert.match((await run(hang, 30)).error, /timed out after 30ms/);
  });

  it('uses the adapters', async () => {
    let seen;
    const result = await fetchDecisions({
      endpoint: '/d',
      body: BODY,
      timeout: 500,
      mapRequest: (body) => ({ url: '/vendor?page=/', init: { method: 'GET' }, body: { ids: body.placeholders.map((p) => p.id) } }),
      mapResponse: (json) => ({ decisions: { a: { variant: json.pick } } }),
      fetchImpl: async (url, init) => { seen = { url, init }; return Response.json({ pick: 'x' }); },
    });
    assert.equal(seen.url, '/vendor?page=/');
    assert.equal(seen.init.method, 'GET');
    assert.equal('body' in seen.init, false);
    assert.deepEqual(result.decisions, { a: { variant: 'x' } });
  });
});
