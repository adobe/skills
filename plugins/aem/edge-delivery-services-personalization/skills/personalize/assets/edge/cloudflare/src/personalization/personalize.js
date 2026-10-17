/* global globalThis */
/* eslint-disable no-console */
/*
 * Edge personalization for the AEM Cloudflare worker.
 *
 * Runs after the origin fetch, so the CDN cache key and cached HTML are
 * untouched. For each Personalization block it decides with the same
 * rules.js as the browser and annotates the block with the chosen variant;
 * the browser runtime then renders that variant without deciding again.
 * Placeholders needing browser-only criteria (device, state, audience) are
 * left for the browser.
 */

import {
  parseSpec, decide, criteriaUsed, CLIENT_ONLY_CRITERIA,
} from './rules.js';
import { buildRequest, cacheKey, sanitizeRequest } from './contract.js';
import { callEngine } from './provider-api.js';
import {
  parseCookies, getVisitor, isBot, readParams, overridesEnabled, readOverrides, COOKIE_CONSENT,
} from './context.js';
import {
  findBlocks, openingTag, applyEdits, injectHead, escapeAttr,
} from './html.js';

const MAX_API_BODY_BYTES = 16384;
const ROUTE_TIMEOUT_MS = 2000;

/**
 * @param {Request} request
 * @param {object} [cf] request.cf
 * @returns {boolean}
 */
export function isBotRequest(request, cf) {
  return cf?.botManagement?.verifiedBot === true || isBot(request.headers.get('user-agent'));
}

/**
 * Context the edge can know. Device, state and audiences are browser-only.
 * @param {Request} request
 * @param {object} [cf]
 * @returns {object}
 */
export function edgeContext(request, cf) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  let geo = null;
  if (cf?.country && /^[a-z]{2}$/i.test(cf.country)) {
    geo = { country: cf.country.toUpperCase() };
    if (cf.regionCode) geo.region = String(cf.regionCode).toUpperCase();
  }
  return {
    geo,
    visitor: getVisitor(cookies, false),
    params: readParams(url.searchParams),
    state: {},
    consent: cookies[COOKIE_CONSENT] === '1',
  };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function engineOptions(config, env) {
  const { api } = config;
  return {
    headers: api.headers ? api.headers(env) : {},
    mapRequest: api.mapRequest,
    mapResponse: api.mapResponse,
  };
}

/**
 * Asks the engine for a batch of placeholders, using the Cache API for
 * responses the engine marks cacheable. Resolves to null on any failure.
 */
async function edgeDecisions({
  specs, context, path, env, config, fetchImpl, cache, ctx,
}) {
  const url = env.PZN_API_ENDPOINT || config.api.endpoint;
  if (!specs.length || !url) return null;
  if (!context.consent && !config.api.sendWithoutConsent) return null;
  const body = buildRequest({
    path, specs, context, consent: context.consent, mode: 'edge',
  });
  const key = cache ? new Request(`https://pzn-cache.invalid/${await sha256(cacheKey(body))}`) : null;
  try {
    if (key) {
      const hit = await cache.match(key);
      if (hit) return (await hit.json()).decisions;
    }
    const result = await callEngine({
      url, body, fetchImpl, timeout: config.api.timeout || 300, ...engineOptions(config, env),
    });
    if (key && result.cacheable && result.ttl > 0) {
      const stored = new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json', 'cache-control': `max-age=${result.ttl}` },
      });
      const put = cache.put(key, stored);
      if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
    }
    return result.decisions;
  } catch (error) {
    console.warn('⚠️ personalization: decision engine failed at the edge, using rules:', error.message);
    return null;
  }
}

/**
 * Personalizes an HTML response from the AEM origin.
 * @param {Request} request original visitor request
 * @param {Response} response origin response
 * @param {object} options
 * @param {object} options.config edge-config.js
 * @param {object} [options.env]
 * @param {object} [options.cf] request.cf
 * @param {object} [options.ctx] execution context
 * @param {Function} [options.fetchImpl]
 * @param {Cache} [options.cache] defaults to caches.default when available
 * @returns {Promise<Response>}
 */
export async function personalizeResponse(request, response, options) {
  const {
    config, env = {}, cf, ctx, fetchImpl = globalThis.fetch,
    cache = globalThis.caches?.default,
  } = options;
  const url = new URL(request.url);
  if (request.method !== 'GET' || response.status !== 200) return response;
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;
  if (url.pathname.endsWith('.plain.html')) return response;

  const html = await response.text();
  const original = () => new Response(html, response);
  try {
    const blocks = findBlocks(html);
    if (!blocks.length) return original();

    const context = edgeContext(request, cf);
    const prefixes = config.fragmentPrefixes;
    const overrides = overridesEnabled(config.overrides, url.hostname)
      ? readOverrides(url.searchParams) : { any: false };
    const bot = config.botsGetDefault !== false && isBotRequest(request, cf);
    const specs = blocks.map((block) => parseSpec(block.rows, { prefixes }));
    const decidable = specs.filter((spec) => !spec.errors.length);

    let decisions = null;
    if (!bot && !overrides.any) {
      decisions = await edgeDecisions({
        specs: decidable.filter((spec) => spec.source === 'api'),
        context,
        path: url.pathname,
        env,
        config,
        fetchImpl,
        cache,
        ctx,
      });
    }

    const edits = [];
    const preloads = [];
    await Promise.all(blocks.map(async (block, index) => {
      const spec = specs[index];
      if (spec.errors.length || overrides.any) return;
      const decision = bot
        ? await decide(spec, {}, { forcedVariant: 'default', prefixes })
        : await decide(spec, context, {
          apiDecision: decisions ? decisions[spec.id] : undefined,
          deferCriteria: CLIENT_ONLY_CRITERIA,
          prefixes,
        });
      if (decision.deferred) return;
      // The fragment path travels with the variant name: an engine may pick a
      // fragment that no authored rule names.
      const data = { source: 'edge', variant: decision.variant };
      if (decision.target.type === 'fragment') data.fragment = decision.target.path;
      edits.push({
        start: block.start,
        end: block.openEnd,
        text: openingTag(block, data),
      });
      if (decision.target.type === 'fragment') {
        preloads.push(`<link rel="preload" href="${escapeAttr(`${decision.target.path}.plain.html`)}" as="fetch" crossorigin="anonymous">`);
      }
    }));

    let out = applyEdits(html, edits);
    const geoUsed = specs.some((spec) => criteriaUsed(spec).has('geo'));
    const meta = context.geo && geoUsed
      ? `<meta name="pzn-geo" content="${escapeAttr(context.geo.region ? `${context.geo.country}-${context.geo.region}` : context.geo.country)}">`
      : '';
    out = injectHead(out, meta + preloads.join(''));

    const headers = new Headers(response.headers);
    // Personalized output must not be stored by shared caches. no-cache (not
    // no-store) keeps the page eligible for the back/forward cache.
    headers.set('cache-control', 'private, no-cache');
    headers.delete('etag');
    headers.delete('content-length');
    headers.set('x-pzn', edits.length ? 'edge' : 'deferred');
    return new Response(out, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error('❌ personalization: edge processing failed, serving origin HTML:', error);
    return original();
  }
}

/**
 * Reads at most `max` bytes of a request body.
 * @param {Request} request
 * @param {number} max
 * @returns {Promise<string|null>} body text, or null when it is larger than max
 */
async function readBounded(request, max) {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return new TextDecoder().decode(bytes);
}

function isSameOrigin(request, url) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  return request.headers.get('origin') === url.origin;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}

/**
 * Same-origin proxy for browser decision requests, attaching the engine
 * secret. Accepts only v1 requests from the site's own pages, with the
 * visitor's consent (unless sendWithoutConsent), and forwards a rebuilt body;
 * the edge config's adapters translate it for non-v1 engines. An optional
 * PZN_RATE_LIMITER binding limits requests per client IP.
 * Returns null for any other request.
 * @param {Request} request
 * @param {object} env
 * @param {object} config
 * @param {Function} [fetchImpl]
 * @returns {Promise<Response|null>}
 */
export async function handleApiRoute(request, env, config, fetchImpl = globalThis.fetch) {
  const url = new URL(request.url);
  if (!config.apiRoute || url.pathname !== config.apiRoute) return null;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const upstream = env.PZN_API_ENDPOINT || config.api.endpoint;
  if (!upstream) return new Response('Decision engine not configured', { status: 503 });
  if (!isSameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  if (env.PZN_RATE_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.PZN_RATE_LIMITER.limit({ key });
    if (!success) return new Response('Too Many Requests', { status: 429 });
  }
  const text = await readBounded(request, MAX_API_BODY_BYTES);
  if (text === null) return new Response('Payload Too Large', { status: 413 });
  let body;
  try {
    body = sanitizeRequest(JSON.parse(text));
  } catch (e) {
    body = null;
  }
  if (!body) {
    return new Response('Bad Request: expected a v1 decision request. When the browser calls this route, leave mapRequest/mapResponse empty in scripts/personalization/config.js; set them in edge-config.js instead.', { status: 400 });
  }
  const consent = parseCookies(request.headers.get('cookie'))[COOKIE_CONSENT] === '1'
    && body.context.consent.personalization;
  if (!consent && !config.api.sendWithoutConsent) return new Response('Forbidden: no consent', { status: 403 });
  try {
    const result = await callEngine({
      url: upstream, body, fetchImpl, timeout: ROUTE_TIMEOUT_MS, ...engineOptions(config, env),
    });
    return json(result);
  } catch (error) {
    console.warn('⚠️ personalization: decision route failed:', error.message);
    return json({ decisions: {} }, 502);
  }
}
