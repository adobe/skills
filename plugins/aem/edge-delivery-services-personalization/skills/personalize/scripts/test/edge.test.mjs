import assert from 'node:assert/strict';
import {
  after, before, describe, it,
} from 'node:test';
import { edgeBundle, fixture } from './helpers.mjs';

const bundle = edgeBundle();
const { personalizeResponse, handleApiRoute, edgeContext } = await bundle.load('personalization/personalize.js');
const { default: baseConfig } = await bundle.load('personalization/edge-config.js');
after(bundle.cleanup);

const BROWSER = 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36';
const PAGE = fixture('index.html');
const OFFER_PAGE = `<html><head></head><body><main>${fixture('content/offer.plain.html')}</main></body></html>`;

function htmlResponse(body, headers = {}) {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'cache-control': 'max-age=7200', ...headers,
    },
  });
}

function request(url = 'https://www.example.com/', headers = {}) {
  return new Request(url, { headers: { 'user-agent': BROWSER, ...headers } });
}

const attrs = (out, id) => {
  const match = new RegExp(`<div class="personalization"([^>]*)>\\s*<div><div>id</div><div>${id}<`).exec(out);
  return match ? match[1] : null;
};

function quiet(fn) {
  return async () => {
    const { warn, error } = console;
    console.warn = () => {};
    console.error = () => {};
    try {
      await fn();
    } finally {
      console.warn = warn;
      console.error = error;
    }
  };
}

describe('personalizeResponse', () => {
  it('decides geo at the edge and defers browser-only criteria', async () => {
    const out = await personalizeResponse(request(), htmlResponse(PAGE), { config: baseConfig, cf: { country: 'IN' }, cache: null });
    const text = await out.text();
    assert.match(attrs(text, 'home-hero'), /data-pzn-source="edge" data-pzn-variant="india" data-pzn-fragment="\/fragments\/personalization\/home-hero\/india"/);
    // welcome: visitor is known (new) but the state rule after it is browser-only.
    assert.equal(attrs(text, 'welcome'), '');
    assert.match(text, /<meta name="pzn-geo" content="IN">/);
    assert.match(text, /<link rel="preload" href="\/fragments\/personalization\/home-hero\/india.plain.html" as="fetch" crossorigin="anonymous"><\/head>/);
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
    assert.equal(out.headers.get('etag'), null);
    assert.equal(out.headers.get('x-pzn'), 'edge');
  });

  it('uses the returning-visitor cookie', async () => {
    const out = await personalizeResponse(
      request('https://www.example.com/', { cookie: 'pzn-seen=1' }),
      htmlResponse(PAGE),
      { config: baseConfig, cf: { country: 'FR' }, cache: null },
    );
    const text = await out.text();
    assert.match(attrs(text, 'welcome'), /data-pzn-variant="back"/);
    // FR: geo rule fails, the next rule needs device -> browser decides.
    assert.equal(attrs(text, 'home-hero'), '');
  });

  it('serves bots the default', async () => {
    const out = await personalizeResponse(
      request('https://www.example.com/', { 'user-agent': 'Googlebot/2.1' }),
      htmlResponse(PAGE),
      { config: baseConfig, cf: { country: 'IN' }, cache: null },
    );
    const text = await out.text();
    assert.match(attrs(text, 'home-hero'), /data-pzn-variant="default"/);
    assert.match(attrs(text, 'welcome'), /data-pzn-variant="default"/);
    const verified = await personalizeResponse(request(), htmlResponse(PAGE), {
      config: baseConfig, cf: { country: 'IN', botManagement: { verifiedBot: true } }, cache: null,
    });
    assert.match(attrs(await verified.text(), 'home-hero'), /data-pzn-variant="default"/);
  });

  it('marks pages it cannot decide as deferred', async () => {
    const out = await personalizeResponse(request(), htmlResponse(PAGE), { config: baseConfig, cf: { country: 'US' }, cache: null });
    assert.equal(out.headers.get('x-pzn'), 'deferred');
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
  });

  it('passes through everything that is not a personalized HTML page', async () => {
    const plain = htmlResponse('<main><div>No placeholders</div></main>');
    const out = await personalizeResponse(request(), plain, { config: baseConfig, cache: null });
    assert.equal(out.headers.get('x-pzn'), null);
    assert.equal(out.headers.get('cache-control'), 'max-age=7200');

    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal(await personalizeResponse(request(), json, { config: baseConfig }), json);
    const notFound = new Response('x', { status: 404, headers: { 'content-type': 'text/html' } });
    assert.equal(await personalizeResponse(request(), notFound, { config: baseConfig }), notFound);
    const fragment = htmlResponse(PAGE);
    assert.equal(await personalizeResponse(request('https://www.example.com/a.plain.html'), fragment, { config: baseConfig }), fragment);
    const head = htmlResponse(PAGE);
    assert.equal(await personalizeResponse(new Request('https://www.example.com/', { method: 'HEAD' }), head, { config: baseConfig }), head);
  });

  it('leaves everything to the browser when overrides are active', async () => {
    const config = { ...baseConfig, overrides: 'always' };
    const out = await personalizeResponse(request('https://www.example.com/?pzn=home-hero:india'), htmlResponse(PAGE), { config, cf: { country: 'IN' }, cache: null });
    const text = await out.text();
    assert.equal(attrs(text, 'home-hero'), '');
    assert.equal(out.headers.get('x-pzn'), 'deferred');
  });

  it('asks the engine with consent and caches cacheable answers', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return Response.json({ decisions: { offer: { variant: 'diwali' } }, ttl: 60, cacheable: true });
    };
    const store = new Map();
    const cache = {
      match: async (key) => store.get(key.url)?.clone(),
      put: async (key, value) => { store.set(key.url, value); },
    };
    const config = { ...baseConfig, api: { ...baseConfig.api, endpoint: 'https://engine.example/decide' } };
    const run = () => personalizeResponse(
      request('https://www.example.com/offers?utm_campaign=x&email=a', { cookie: 'pzn-consent=1' }),
      htmlResponse(OFFER_PAGE),
      { config, env: { PZN_API_KEY: 'k' }, cf: { country: 'IN' }, cache, fetchImpl },
    );
    const first = await (await run()).text();
    assert.match(attrs(first, 'offer'), /data-pzn-variant="diwali"/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://engine.example/decide');
    assert.equal(calls[0].init.headers.authorization, 'Bearer k');
    assert.equal(calls[0].body.mode, 'edge');
    assert.deepEqual(calls[0].body.context.params, { utm_campaign: 'x' });
    const second = await (await run()).text();
    assert.match(attrs(second, 'offer'), /data-pzn-variant="diwali"/);
    assert.equal(calls.length, 1, 'second request served from the Cache API');
  });

  it('hands an engine-only fragment to the browser by path', async () => {
    const config = { ...baseConfig, api: { ...baseConfig.api, endpoint: 'https://engine.example/decide' } };
    const out = await personalizeResponse(
      request('https://www.example.com/', { cookie: 'pzn-consent=1' }),
      htmlResponse(OFFER_PAGE),
      {
        config,
        cf: { country: 'IN' },
        cache: null,
        fetchImpl: async () => Response.json({ decisions: { offer: { fragment: '/fragments/personalization/offer/summer' } } }),
      },
    );
    const text = await out.text();
    assert.match(attrs(text, 'offer'), /data-pzn-variant="summer" data-pzn-fragment="\/fragments\/personalization\/offer\/summer"/);
    assert.match(text, /href="\/fragments\/personalization\/offer\/summer.plain.html"/);
  });

  it('skips the engine without consent and falls back to rules on failure', quiet(async () => {
    let calls = 0;
    const config = { ...baseConfig, api: { ...baseConfig.api, endpoint: 'https://engine.example/decide' } };
    const failing = async () => { calls += 1; return new Response('down', { status: 500 }); };
    const noConsent = await personalizeResponse(request(), htmlResponse(OFFER_PAGE), {
      config, cf: { country: 'IN' }, cache: null, fetchImpl: failing,
    });
    assert.match(attrs(await noConsent.text(), 'offer'), /data-pzn-variant="india"/);
    assert.equal(calls, 0);
    const withConsent = await personalizeResponse(request('https://www.example.com/', { cookie: 'pzn-consent=1' }), htmlResponse(OFFER_PAGE), {
      config, cf: { country: 'IN' }, cache: null, fetchImpl: failing,
    });
    assert.match(attrs(await withConsent.text(), 'offer'), /data-pzn-variant="india"/);
    assert.equal(calls, 1);
    const slow = () => new Promise(() => {});
    const timed = await personalizeResponse(request('https://www.example.com/', { cookie: 'pzn-consent=1' }), htmlResponse(OFFER_PAGE), {
      config: { ...config, api: { ...config.api, timeout: 20 } },
      cf: { country: 'FR' },
      cache: null,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        slow();
      }),
    });
    assert.match(attrs(await timed.text(), 'offer'), /data-pzn-variant="default"/);
  }));

  it('serves origin HTML when processing throws', quiet(async () => {
    const config = { ...baseConfig, fragmentPrefixes: null, get botsGetDefault() { throw new Error('boom'); } };
    const out = await personalizeResponse(request(), htmlResponse(PAGE), { config, cache: null });
    assert.equal(await out.text(), PAGE);
    assert.equal(out.headers.get('x-pzn'), null);
  }));

  it('builds the edge context from cf and cookies', () => {
    const ctx = edgeContext(request('https://www.example.com/?a=1', { cookie: 'pzn-seen=1; pzn-consent=1' }), { country: 'us', regionCode: 'ca' });
    assert.deepEqual(ctx, {
      geo: { country: 'US', region: 'CA' }, visitor: 'returning', params: { a: '1' }, state: {}, consent: true,
    });
    assert.equal(edgeContext(request(), { country: 'T1' }).geo, null);
  });
});

describe('handleApiRoute', () => {
  const config = { ...baseConfig, api: { ...baseConfig.api, endpoint: '' } };
  const V1 = JSON.stringify({
    version: '1',
    page: { path: '/offers' },
    placeholders: [{ id: 'offer', candidates: ['india', 'default'] }],
    context: { geo: { country: 'IN' }, params: {}, consent: { personalization: true } },
    mode: 'client',
  });
  const SITE_HEADERS = { origin: 'https://www.example.com', 'sec-fetch-site': 'same-origin', cookie: 'pzn-consent=1' };
  const post = (body, headers = SITE_HEADERS, path = '/pzn/decide') => new Request(`https://www.example.com${path}`, { method: 'POST', body, headers });
  const env = { PZN_API_ENDPOINT: 'https://engine.example' };
  const engine = async () => Response.json({ decisions: {} });

  it('ignores other paths and rejects bad requests', async () => {
    assert.equal(await handleApiRoute(request(), {}, config), null);
    assert.equal(await handleApiRoute(post(V1), {}, { ...config, apiRoute: '' }), null);
    assert.equal((await handleApiRoute(new Request('https://www.example.com/pzn/decide'), {}, config)).status, 405);
    assert.equal((await handleApiRoute(post(V1), {}, config)).status, 503);
    assert.equal((await handleApiRoute(post('x'.repeat(20000)), env, config)).status, 413);
    // Multi-byte characters count as bytes, not characters.
    assert.equal((await handleApiRoute(post(`"${'é'.repeat(9000)}"`), env, config)).status, 413);
    assert.equal((await handleApiRoute(post('{bad'), env, config)).status, 400);
  });

  it('only forwards same-origin v1 requests with consent', async () => {
    let calls = 0;
    const counting = async () => { calls += 1; return Response.json({ decisions: {} }); };
    const send = (body, headers) => handleApiRoute(post(body, headers), env, config, counting);
    assert.equal((await send(V1, { ...SITE_HEADERS, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await send(V1, { cookie: 'pzn-consent=1' })).status, 403, 'no Origin header');
    assert.equal((await send(V1, { ...SITE_HEADERS, cookie: '' })).status, 403, 'no consent cookie');
    assert.equal((await send('{"version":"1"}')).status, 400, 'not a v1 request');
    assert.match(await (await send('{"slots":["offer"]}')).text(), /leave mapRequest\/mapResponse empty/);
    assert.equal(calls, 0);
    assert.equal((await handleApiRoute(post(V1, { ...SITE_HEADERS, cookie: '' }), env, {
      ...config, api: { ...config.api, sendWithoutConsent: true },
    }, counting)).status, 200);
    assert.equal(calls, 1);
  });

  it('rebuilds the body from contract fields only', async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = JSON.parse(init.body); return Response.json({ decisions: {} }); };
    const extra = JSON.parse(V1);
    extra.anything = 'x'.repeat(100);
    extra.context.state = { quiz: 'cn', nested: { a: 1 } };
    extra.mode = 'edge';
    await handleApiRoute(post(JSON.stringify(extra)), env, config, fetchImpl);
    assert.equal('anything' in seen, false);
    assert.deepEqual(seen.context.state, { quiz: 'cn' });
    assert.equal(seen.mode, 'client');
  });

  it('applies the optional rate limiter', async () => {
    const keys = [];
    const limiter = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
    const out = await handleApiRoute(post(V1, { ...SITE_HEADERS, 'cf-connecting-ip': '203.0.113.9' }), { ...env, PZN_RATE_LIMITER: limiter }, config, engine);
    assert.equal(out.status, 429);
    assert.deepEqual(keys, ['203.0.113.9']);
  });

  it('proxies to the engine with the secret and validates the answer', quiet(async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return Response.json({ decisions: { offer: { variant: 'x', junk: 1 } }, ttl: 10 });
    };
    const keyed = { ...env, PZN_API_KEY: 'secret' };
    const out = await handleApiRoute(post(V1), keyed, config, fetchImpl);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await out.json(), { decisions: { offer: { variant: 'x' } }, ttl: 10, cacheable: false });
    assert.equal(seen.url, 'https://engine.example');
    assert.equal(seen.init.headers.authorization, 'Bearer secret');
    const failed = await handleApiRoute(post(V1), keyed, config, async () => Response.json({ nope: 1 }));
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { decisions: {} });
  }));

  it('applies request and response adapters', async () => {
    const adapted = {
      ...config,
      api: {
        ...config.api,
        mapRequest: (body) => ({ url: 'https://vendor.example/v2', body: { slots: body.placeholders.map((p) => p.id) } }),
        mapResponse: (json) => ({ decisions: Object.fromEntries(json.results.map((r) => [r.slot, { variant: r.choice }])) }),
      },
    };
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return Response.json({ results: [{ slot: 'offer', choice: 'india' }] });
    };
    const out = await handleApiRoute(post(V1), env, adapted, fetchImpl);
    assert.deepEqual(seen, { url: 'https://vendor.example/v2', body: { slots: ['offer'] } });
    assert.deepEqual((await out.json()).decisions, { offer: { variant: 'india' } });
  });
});

describe('worker entry point (index.mjs)', () => {
  let worker;
  let originRequests;
  const realFetch = globalThis.fetch;

  before(async () => {
    ({ default: worker } = await bundle.load('index.mjs'));
    originRequests = [];
    globalThis.fetch = async (req) => {
      originRequests.push(req);
      const url = new URL(req.url);
      if (url.pathname === '/') return htmlResponse(PAGE, { age: '10', 'x-robots-tag': 'noindex' });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    };
  });
  after(() => { globalThis.fetch = realFetch; });

  const env = { ORIGIN_HOSTNAME: 'main--site--org.aem.live' };
  const ctx = { waitUntil: () => {} };

  it('fetches the AEM origin with an unchanged cache key and personalizes the HTML', async () => {
    const req = new Request('https://www.example.com/?utm_campaign=x', { headers: { 'user-agent': BROWSER, host: 'www.example.com' } });
    req.cf = { country: 'IN' };
    const out = await worker.fetch(Object.assign(req, { cf: { country: 'IN' } }), env, ctx);
    const origin = originRequests.at(-1);
    assert.equal(origin.url, 'https://main--site--org.aem.live/');
    assert.equal(origin.headers.get('x-byo-cdn-type'), 'cloudflare');
    assert.equal(out.headers.get('x-robots-tag'), null);
    assert.equal(out.headers.get('x-pzn'), 'edge');
    assert.match(attrs(await out.text(), 'home-hero'), /data-pzn-variant="india"/);
  });

  it('keeps the official worker behavior for non-HTML and invalid origins', async () => {
    const json = await worker.fetch(new Request('https://www.example.com/data.json?limit=1&x=2'), env, ctx);
    assert.equal(originRequests.at(-1).url, 'https://main--site--org.aem.live/data.json?limit=1');
    assert.equal(json.headers.get('x-pzn'), null);
    const invalid = await worker.fetch(new Request('https://www.example.com/'), { ORIGIN_HOSTNAME: 'evil.example' }, ctx);
    assert.equal(invalid.status, 500);
    const drafts = await worker.fetch(new Request('https://www.example.com/drafts/x'), env, ctx);
    assert.equal(drafts.status, 404);
  });

  it('routes /pzn/decide before the origin', async () => {
    const before = originRequests.length;
    const out = await worker.fetch(new Request('https://www.example.com/pzn/decide', { method: 'POST', body: '{}' }), env, ctx);
    assert.equal(out.status, 503);
    assert.equal(originRequests.length, before);
  });
});
