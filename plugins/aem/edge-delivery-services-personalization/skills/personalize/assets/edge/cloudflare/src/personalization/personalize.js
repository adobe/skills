/* global globalThis */
/* eslint-disable no-console */
/*
 * Edge personalization for the AEM Cloudflare worker (contract sections 4, 8
 * and 10).
 *
 * Runs after the origin fetch, so the CDN cache key and cached HTML are
 * untouched. It decides `rules`, `split` and `api` sections with the same
 * modules as the browser, only with the pzn-consent cookie or an approved
 * exception, and does one of three things per section:
 *   applied:  decided and swapped in the HTML (also the default); the
 *             authored content is kept in <template data-pzn-default>
 *   selected: decided, the browser loads the fragment
 *   left:     not marked; the browser decides as in client mode
 * Marked sections carry data-pzn-where="edge", data-pzn-status and the
 * decision (variant, source, outcome, reason, decision, cached, tracking).
 * `target` sections and rules needing device, state or audience are left.
 *
 * handleApiRoute is the same-origin server route for browser engine
 * requests: it holds the engine's credentials and adapters.
 */

import { CLIENT_ONLY_CRITERIA } from './rules.js';
import {
  parseSection, ruleOutcome, sectionCriteria, assignSplit, EXPERIMENTATION_META,
} from './section-spec.js';
import {
  buildRequest, sanitizeRequest, sharedKey, referrerHost, engineProfile, DESCRIPTION_MAX,
} from './contract.js';
import { callEngine } from './provider-api.js';
import {
  parseCookies, getVisitor, isBot, readParams, overridesEnabled, readOverrides, COOKIE_CONSENT,
} from './context.js';
import {
  makeDecision, decisionAttributes, engineOutcome, splitOutcome, rulesOutcome, RULE_FALLBACK,
} from './outcomes.js';
import {
  findBlocks, findSections, sections, openingTag, applyEdits, injectHead, escapeAttr, textContent,
  renderSectionMetadata,
} from './html.js';
import { COOKIE as SPLIT_COOKIE, parseAssignments, formatAssignments } from './sources/split.js';

const MAX_API_BODY_BYTES = 16384;
const ROUTE_TIMEOUT_MS = 2000;
const FRAGMENT_TIMEOUT_MS = 1000;
const ENGINE_TIMEOUT_MS = 300;
const TEXT_CACHE_MS = 300000;
// Sources the edge decides; target stays in the browser.
export const EDGE_SOURCES = ['rules', 'api', 'split'];
const LEAVE = Object.freeze({ leave: true });

/**
 * @param {object} config edge-config.js
 * @returns {Set<string>} exceptions approved without consent (with a policyRef)
 */
export function approvedExceptions(config) {
  const consent = config.consent || {};
  return new Set(consent.policyRef ? consent.withoutConsent || [] : []);
}

/**
 * @param {Request} request
 * @param {object} [cf] request.cf
 * @returns {boolean}
 */
export function isBotRequest(request, cf) {
  return cf?.botManagement?.verifiedBot === true || isBot(request.headers.get('user-agent'));
}

/**
 * @param {Request} request
 * @returns {boolean} the pzn-consent cookie the browser mirrors from the consent tool
 */
export function consentCookie(request) {
  return parseCookies(request.headers.get('cookie'))[COOKIE_CONSENT] === '1';
}

/**
 * What the edge knows about the visitor: request geo, URL params, the
 * referrer host and, with consent, the visitor cookies. Device, state and
 * audiences are browser-only.
 * @param {Request} request
 * @param {object} [cf]
 * @param {{consent: boolean}} options
 * @returns {object}
 */
export function edgeContext(request, cf, { consent }) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  let geo = null;
  if (cf?.country && /^[a-z]{2}$/i.test(cf.country)) {
    geo = { country: cf.country.toUpperCase() };
    if (cf.regionCode && /^[a-z0-9]{1,3}$/i.test(cf.regionCode)) geo.region = String(cf.regionCode).toUpperCase();
  }
  return {
    geo,
    visitor: getVisitor(cookies, consent),
    params: readParams(url.searchParams),
    state: {},
    referrer: referrerHost(request.headers.get('referer') || '', url.hostname),
  };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function engineOptions(config, env) {
  const { api = {} } = config;
  return {
    headers: api.headers ? api.headers(env) : {},
    mapRequest: api.mapRequest,
    mapResponse: api.mapResponse,
  };
}

const TAG = /<([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const URL_ATTR = /(\s(src|srcset|href)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Rewrites the relative URLs (src, srcset, href) of a fragment's markup
 * against the fragment's path, as loadFragment does for ./media_ images, so
 * they still resolve once the markup sits in another page.
 * @param {string} markup
 * @param {string} path fragment path
 * @returns {string}
 */
export function absolutizeUrls(markup, path) {
  const base = new URL(path, 'https://fragment.invalid');
  const resolve = (value) => {
    if (!value || /^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(value)) return value;
    try {
      const url = new URL(value, base);
      return url.pathname + url.search + url.hash;
    } catch (e) {
      return value;
    }
  };
  return markup.replace(TAG, (tag, name, attrs) => `<${name}${attrs.replace(URL_ATTR, (match, prefix, attr, double, single) => {
    const value = double ?? single;
    const out = attr.toLowerCase() === 'srcset'
      ? value.split(',').map((candidate) => {
        const [url, ...descriptor] = candidate.trim().split(/\s+/);
        return [resolve(url), ...descriptor].join(' ');
      }).join(', ')
      : resolve(value.trim());
    const quote = double === undefined ? "'" : '"';
    return `${prefix}${quote}${out}${quote}`;
  })}>`);
}

/**
 * The content of a variant fragment's .plain.html, as the browser runtime
 * shows it: the children of every fragment section, concatenated, with the
 * fragment's own Section Metadata left out.
 * @param {string} text .plain.html
 * @param {string} path fragment path
 * @returns {string|null} null when the fragment has no element content
 */
export function fragmentMarkup(text, path) {
  const source = applyEdits(text, findBlocks(text, 'section-metadata')
    .map((block) => ({ start: block.start, end: block.end, text: '' })));
  const parts = sections(source)
    .map((section) => source.slice(section.openEnd, section.closeStart));
  const markup = (parts.length ? parts.join('') : source).trim();
  return /<[a-z]/i.test(markup) ? absolutizeUrls(markup, path) : null;
}

async function withTimeout(promise, timeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeout} ms`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function plainText(path, fetchPlain, timeout) {
  const response = await withTimeout(fetchPlain(path), timeout);
  if (!response || !response.ok) throw new Error(`HTTP ${response?.status}`);
  return response.text();
}

async function loadFragment(path, fetchPlain, timeout) {
  try {
    return fragmentMarkup(await plainText(path, fetchPlain, timeout), path);
  } catch (error) {
    console.warn(`⚠️ personalization: fragment ${path} failed at the edge:`, error.message);
    return null;
  }
}

// Fragment and page texts for engine descriptions, per worker isolate.
const texts = new Map();

async function cachedText(key, load) {
  const hit = texts.get(key);
  if (hit && hit.expires > Date.now()) return hit.text;
  const text = await load();
  if (texts.size > 500) texts.clear();
  texts.set(key, { text, expires: Date.now() + TEXT_CACHE_MS });
  return text;
}

/**
 * Fills missing descriptions for engines that use them (profile of1,
 * contract section 5): a variant without a Description row gets the text
 * of its fragment's .plain.html, the default gets the text of the authored
 * section; cut to 600 characters. Author rows always win; none is sent empty.
 * @param {object} request v1 request (changed in place)
 * @param {object} options
 * @param {Function} [options.fetchPlain] path -> Promise<Response> of `${path}.plain.html`
 * @param {(id: string) => Promise<string|null>|string|null} [options.sectionText]
 * @param {number} [options.timeout]
 * @returns {Promise<object>} the request
 */
export async function fillDescriptions(request, {
  fetchPlain, sectionText, timeout = FRAGMENT_TIMEOUT_MS,
} = {}) {
  await Promise.all(request.placeholders.map(async (placeholder) => {
    const descriptions = { ...(placeholder.descriptions || {}) };
    await Promise.all(placeholder.candidates.map(async (name) => {
      if (descriptions[name]) return;
      let text = null;
      try {
        if (name === 'default') {
          text = sectionText ? await sectionText(placeholder.id) : null;
        } else if (fetchPlain && placeholder.fragments?.[name]) {
          const path = placeholder.fragments[name];
          text = await cachedText(`fragment:${path}`, async () => {
            const markup = fragmentMarkup(await plainText(path, fetchPlain, timeout), path);
            return markup ? textContent(markup) : '';
          });
        }
      } catch (error) {
        console.warn(`⚠️ personalization: no description for ${placeholder.id}/${name}:`, error.message);
      }
      if (text) descriptions[name] = text.slice(0, DESCRIPTION_MAX);
    }));
    if (Object.keys(descriptions).length) placeholder.descriptions = descriptions;
  }));
  return request;
}

/**
 * The authored text of a section in a page's (or .plain.html's) markup.
 * @param {string} html
 * @param {string} id section id
 * @returns {string|null}
 */
export function authoredText(html, id) {
  const rendered = /data-personalization=/.test(html) ? html : renderSectionMetadata(html).html;
  const section = findSections(rendered)
    .find((candidate) => candidate.attributes.some(([name, value]) => name === 'data-personalization' && value === id));
  if (!section) return null;
  const text = textContent(rendered.slice(section.openEnd, section.closeStart)
    .replace(/<template\b[\s\S]*?<\/template>/gi, ''));
  return text ? text.slice(0, DESCRIPTION_MAX) : null;
}

/**
 * One engine call for the page's api sections, using the Cache API for
 * answers the engine marks cacheable (shared key, contract section 10).
 * @returns {Promise<{response?: object, cached: boolean, error?: string, kind?: string}>}
 */
async function edgeEngine({
  body, env, config, fetchImpl, cache, ctx, policy, lastModified,
}) {
  const url = env.PZN_API_ENDPOINT || config.api?.endpoint;
  if (!url) return { error: 'no engine endpoint', kind: 'config', cached: false };
  const key = cache ? sharedKey(body, { policy, lastModified }) : null;
  const request = key ? new Request(`https://pzn-cache.invalid/${await sha256(key)}`) : null;
  try {
    if (request) {
      const hit = await cache.match(request);
      if (hit) return { response: await hit.json(), cached: true };
    }
    const response = await callEngine({
      url,
      body,
      fetchImpl,
      timeout: config.api?.timeout || ENGINE_TIMEOUT_MS,
      ...engineOptions(config, env),
    });
    if (request && response.cacheable && response.ttl > 0) {
      const stored = new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json', 'cache-control': `max-age=${response.ttl}` },
      });
      const put = cache.put(request, stored);
      if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
    }
    return { response, cached: false };
  } catch (error) {
    console.warn('⚠️ personalization: decision engine failed at the edge:', error.message);
    return { error: error.message, kind: error.kind || 'http', cached: false };
  }
}

/**
 * The edge's decision fields for one section, or LEAVE (contract sections 3,
 * 4 and 8).
 * @param {object} entry { spec, first, ruled }
 * @param {object} env { bot, consent, allowed, context, engine, profile, split, random }
 * @returns {Promise<object>} { fields, browserMayNotDecide } or LEAVE
 */
export async function edgeDecision(entry, env) {
  const { spec } = entry;
  const allowed = (exception) => env.allowed.has(exception);
  const { consent } = env;
  const browserMayNotDecide = spec.source === 'api' && env.profile.slow && entry.first;
  const rules = () => ruleOutcome(spec, env.context, {
    defer: CLIENT_ONLY_CRITERIA, withoutConsent: !consent,
  });
  if (env.bot) return { fields: { source: 'bot', outcome: 'bot', variant: 'default' } };
  if (spec.source === 'rules') {
    if (!consent && !allowed('rules')) return LEAVE;
    const ruled = await rules();
    return ruled.deferred ? LEAVE : { fields: { source: 'rules', ...rulesOutcome(ruled) } };
  }
  if (spec.source === 'split') {
    if (!consent && !allowed('split')) return LEAVE;
    const arm = assignSplit(spec, env.split.stored[spec.id], env.random());
    env.split.assigned[spec.id] = arm;
    return { fields: { source: 'split', ...splitOutcome(spec, arm) } };
  }
  if (spec.source !== 'api') return LEAVE;
  const rulesUsable = spec.rules.length > 0 && (consent || allowed('rules'));
  if (!consent && !allowed('api')) {
    if (!rulesUsable) return LEAVE;
    const ruled = await rules();
    if (ruled.deferred) return LEAVE;
    return { fields: { ...rulesOutcome(ruled), source: 'rules', outcome: 'no-consent' } };
  }
  // Not asked: its rules need the browser, or there is no engine.
  if (entry.ruled?.deferred || !env.engine) return LEAVE;
  const { engine } = env;
  const answer = engine.error
    ? { outcome: engine.kind === 'timeout' ? 'timeout' : 'fallback', variant: 'default', reason: engine.error }
    : {
      ...engineOutcome(spec, engine.response.decisions[spec.id], env.prefixes),
      ...(engine.cached ? { cached: true } : {}),
    };
  if (!['timeout', ...RULE_FALLBACK].includes(answer.outcome)) {
    return { fields: { source: 'api', ...answer }, browserMayNotDecide };
  }
  if (rulesUsable && entry.ruled?.variant) {
    return {
      fields: {
        ...rulesOutcome(entry.ruled),
        source: 'rules',
        outcome: answer.outcome,
        reason: answer.reason,
        tracking: answer.tracking,
        cached: answer.cached,
      },
      browserMayNotDecide,
    };
  }
  // The engine failed or was too slow and no rule matched: the browser may
  // try again, unless it may not decide this section.
  if (['timeout', 'fallback'].includes(answer.outcome) && !browserMayNotDecide) return LEAVE;
  return {
    fields: { source: rulesUsable ? 'rules' : 'api', ...answer, variant: 'default' },
    browserMayNotDecide,
  };
}

const pageLocale = (html) => /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
const pageTitle = (html) => {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? textContent(match[1]) : undefined;
};
const pageExperiment = (html) => [...String(html.split(/<\/head>/i)[0])
  .matchAll(/<meta\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)]
  .some((match) => EXPERIMENTATION_META.test(match[1]));

function marked(section, decision, status) {
  const attributes = decisionAttributes(decision, status, { tracking: true });
  return openingTag(section, Object.fromEntries(Object.entries(attributes)
    .map(([name, value]) => [name.slice(4), value])));
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
 * @param {Function} [options.fetchFragment] path -> Promise<Response> of
 *   `${path}.plain.html` from the AEM origin; without it the edge selects
 *   variants and the browser loads them
 * @param {Function} [options.random] split draw, for tests
 * @returns {Promise<Response>}
 */
export async function personalizeResponse(request, response, options) {
  const {
    config, env = {}, cf, ctx, fetchImpl = globalThis.fetch,
    cache = globalThis.caches?.default, fetchFragment, random = Math.random,
  } = options;
  const url = new URL(request.url);
  if (request.method !== 'GET' || response.status !== 200) return response;
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;
  if (url.pathname.endsWith('.plain.html')) return response;

  const html = await response.text();
  const original = () => new Response(html, response);
  try {
    const found = findSections(html)
      .filter((section) => section.attributes.some(([name]) => name === 'data-personalization'));
    if (!found.length) return original();

    const prefixes = config.fragmentPrefixes || ['/fragments/'];
    const consent = consentCookie(request);
    const allowed = approvedExceptions(config);
    const overrides = overridesEnabled(config.overrides, url.hostname)
      ? readOverrides(url.searchParams) : { any: false };
    const bot = config.botsGetDefault !== false && isBotRequest(request, cf);
    const context = edgeContext(request, cf, { consent });
    const profile = engineProfile(config.api?.engine);
    const firstSection = sections(html)[0];
    const ids = new Set();
    const entries = found.map((section) => {
      const spec = parseSection(section.attributes, { prefixes });
      if (ids.has(spec.id)) spec.errors.push('duplicate id');
      ids.add(spec.id);
      return { section, spec, first: firstSection?.start === section.start };
    });
    // Preview overrides, a page experiment, an invalid section, a target
    // section or one the edge already marked: the browser decides.
    const browserOnly = overrides.any || pageExperiment(html);
    const decidable = browserOnly ? [] : entries.filter(({ section, spec }) => !spec.errors.length
      && EDGE_SOURCES.includes(spec.source)
      && !section.attributes.some(([name]) => name === 'data-pzn-where'));

    // The engine is asked only about api sections it may decide here.
    const asked = [];
    if (!bot) {
      await Promise.all(decidable.filter(({ spec }) => spec.source === 'api').map(async (entry) => {
        if (!consent && !allowed.has('api')) return;
        if (entry.spec.rules.length && (consent || allowed.has('rules'))) {
          entry.ruled = await ruleOutcome(entry.spec, context, {
            defer: CLIENT_ONLY_CRITERIA, withoutConsent: !consent,
          });
          if (entry.ruled.deferred) return;
        }
        asked.push(entry);
      }));
      // Page order, so the request (and its shared cache key) is stable.
      asked.sort((a, b) => decidable.indexOf(a) - decidable.indexOf(b));
    }
    let engine = null;
    if (asked.length) {
      const body = buildRequest({
        page: { path: url.pathname, locale: pageLocale(html), title: pageTitle(html) },
        specs: asked.map(({ spec }) => spec),
        context,
        consent,
        mode: 'edge',
      });
      if (profile.descriptions) {
        await fillDescriptions(body, {
          fetchPlain: fetchFragment,
          sectionText: (id) => authoredText(html, id),
        });
      }
      engine = await edgeEngine({
        body,
        env,
        config,
        fetchImpl,
        cache,
        ctx,
        policy: [...allowed],
        lastModified: response.headers.get('last-modified') || '',
      });
    }

    const split = { stored: parseAssignments(parseCookies(request.headers.get('cookie'))[SPLIT_COOKIE]), assigned: {} };
    const shared = {
      bot, consent, allowed, context, profile, split, random, prefixes,
    };
    const fragmentTimeout = config.fragmentTimeout || FRAGMENT_TIMEOUT_MS;
    const edits = (await Promise.all(decidable.map(async (entry) => {
      const plan = await edgeDecision(entry, {
        ...shared, engine: asked.includes(entry) ? engine : null,
      });
      if (plan.leave) return null;
      const { section, spec } = entry;
      const decision = makeDecision({
        id: spec.id, decisionId: `${spec.id}#1`, where: 'edge', trigger: 'initial', ...plan.fields,
      });
      if (decision.variant === 'default' || !decision.path) {
        return { start: section.start, end: section.openEnd, text: marked(section, decision, 'applied') };
      }
      const markup = fetchFragment
        ? await loadFragment(decision.path, fetchFragment, fragmentTimeout) : null;
      if (markup === null) {
        // Without the fragment: the browser loads it (selected), or decides
        // the section itself (left).
        if (fetchFragment && !plan.browserMayNotDecide) return null;
        return { start: section.start, end: section.openEnd, text: marked(section, decision, 'selected') };
      }
      const authored = html.slice(section.openEnd, section.closeStart);
      return {
        start: section.start,
        end: section.closeStart,
        text: `${marked(section, decision, 'applied')}${markup}<template data-pzn-default>${authored}</template>`,
      };
    }))).filter(Boolean);

    const changed = Object.entries(split.assigned).some(([id, arm]) => split.stored[id] !== arm);
    const cookie = changed
      ? `${SPLIT_COOKIE}=${encodeURIComponent(formatAssignments({ ...split.stored, ...split.assigned }))}; Path=/; SameSite=Lax; Secure`
      : null;
    const geoUsed = entries.some(({ spec }) => sectionCriteria(spec).has('geo'));
    const meta = context.geo && geoUsed
      ? `<meta name="pzn-geo" content="${escapeAttr(context.geo.region ? `${context.geo.country}-${context.geo.region}` : context.geo.country)}">`
      : '';
    const out = injectHead(applyEdits(html, edits), meta);

    const headers = new Headers(response.headers);
    // Personalized output must not be stored by shared caches. no-cache (not
    // no-store) keeps the page eligible for the back/forward cache.
    headers.set('cache-control', 'private, no-cache');
    headers.delete('etag');
    headers.delete('content-length');
    headers.set('x-pzn', edits.length ? 'edge' : 'deferred');
    // Split assignments last the browser session, like sessionStorage.
    if (cookie) headers.append('set-cookie', cookie);
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
 * Same-origin server route for browser engine requests (config.apiRoute,
 * default /pzn/decide). Accepts only v1 requests from the site's own pages
 * and forwards a rebuilt body with the engine's credentials and adapters.
 * With consent (the pzn-consent cookie and consent.personalization) the
 * request goes as sent; with the approved `api` exception it is cut to
 * request data only; otherwise it is refused. An optional
 * PZN_RATE_LIMITER binding limits requests per client IP.
 * @param {Request} request
 * @param {object} env
 * @param {object} config
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.fetchPlain] path -> Promise<Response> of
 *   `${path}.plain.html` (descriptions for engines that use them)
 * @returns {Promise<Response|null>} null for any other request
 */
export async function handleApiRoute(request, env, config, {
  fetchImpl = globalThis.fetch, fetchPlain,
} = {}) {
  const url = new URL(request.url);
  if (!config.apiRoute || url.pathname !== config.apiRoute) return null;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const upstream = env.PZN_API_ENDPOINT || config.api?.endpoint;
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
    body = sanitizeRequest(JSON.parse(text), { prefixes: config.fragmentPrefixes });
  } catch (e) {
    body = null;
  }
  if (!body) {
    return new Response('Bad Request: expected a v1 decision request. When the browser calls this route, leave mapRequest/mapResponse empty in scripts/personalization/config.js; set them in edge-config.js instead.', { status: 400 });
  }
  const consent = consentCookie(request) && body.context.consent.personalization;
  if (!consent) {
    if (!approvedExceptions(config).has('api')) return new Response('Forbidden: no consent', { status: 403 });
    // The approved `api` exception: request data only.
    delete body.context.visitor;
    delete body.context.state;
    body.context.consent = { personalization: false };
  }
  if (engineProfile(config.api?.engine).descriptions) {
    const pages = new Map();
    await fillDescriptions(body, {
      fetchPlain,
      sectionText: async (id) => {
        if (!fetchPlain) return null;
        const path = body.page.path.endsWith('/') ? `${body.page.path}index` : body.page.path;
        if (!pages.has(path)) {
          pages.set(path, cachedText(`page:${path}`, () => plainText(path, fetchPlain, FRAGMENT_TIMEOUT_MS)).catch(() => ''));
        }
        return authoredText(await pages.get(path), id);
      },
    });
  }
  try {
    const result = await callEngine({
      url: upstream,
      body,
      fetchImpl,
      timeout: config.api?.routeTimeout || ROUTE_TIMEOUT_MS,
      ...engineOptions(config, env),
    });
    // Answers given without consent aren't kept in the browser.
    return json(consent ? result : { ...result, ttl: 0, cacheable: false });
  } catch (error) {
    console.warn('⚠️ personalization: decision route failed:', error.message);
    return json({ decisions: {} }, 502);
  }
}
