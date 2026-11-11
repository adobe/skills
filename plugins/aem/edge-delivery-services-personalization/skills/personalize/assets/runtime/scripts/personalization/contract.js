/*
 * Decision engine API, version 1 (contract section 5,
 * decision-request.schema.json, decision-response.schema.json).
 *
 * Shared by the browser runtime and the edge worker. Builds the request body,
 * rebuilds one received by the server route, validates the response and
 * keys the caches; transport (fetch, timeout) lives in provider-api.js.
 */

import { criteriaUsed } from './rules.js';

export const CONTRACT_VERSION = '1';
export const MAX_TTL_SECONDS = 1800;
export const DEFAULT_TTL_SECONDS = 300;
export const MAX_PLACEHOLDERS = 20;
export const DESCRIPTION_MAX = 600;
export const HINT_MAX = 500;

// Engine profiles only set the limits the validator checks, whether an
// engine may decide the first section in the browser, and `state`: whether
// the engine reads context.state, so that setState() re-decides its sections.
// Unknown engines are assumed to read it (generic). OF1 doesn't: its adapter
// sends no state; set it to true once OF1 reads state natively. The contract
// is the same for every engine.
export const ENGINE_PROFILES = {
  generic: {
    sections: 20,
    minCandidates: 2,
    maxCandidates: 21,
    slow: false,
    descriptions: false,
    state: true,
  },
  of1: {
    sections: 8,
    minCandidates: 2,
    maxCandidates: 10,
    slow: true,
    descriptions: true,
    state: false,
  },
};

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const CODE = /^[a-z][a-z0-9_]*$/;
const HOST = /^[a-z0-9.-]+$/;
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const clip = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : undefined);

/**
 * @param {string} [name]
 * @returns {object} the engine profile (generic when unknown)
 */
export function engineProfile(name) {
  return ENGINE_PROFILES[name] || ENGINE_PROFILES.generic;
}

/**
 * Candidates of a section: its variants in order, then `default`.
 * @param {object} spec section spec
 * @returns {string[]}
 */
export function candidates(spec) {
  return [...spec.variants.map((variant) => variant.name), 'default'];
}

/**
 * One `placeholders` entry: candidates, each variant's fragment, and the Hint
 * and Description rows when the section has them.
 * @param {object} spec
 * @returns {object}
 */
export function placeholder(spec) {
  const entry = {
    id: spec.id,
    candidates: candidates(spec),
    fragments: Object.fromEntries(spec.variants.map((variant) => [variant.name, variant.path])),
  };
  if (spec.hint) entry.hint = spec.hint.slice(0, HINT_MAX);
  if (spec.descriptions && Object.keys(spec.descriptions).length) {
    entry.descriptions = Object.fromEntries(Object.entries(spec.descriptions)
      .map(([name, text]) => [name, String(text).slice(0, DESCRIPTION_MAX)]));
  }
  return entry;
}

/**
 * Keeps only the URL params an engine may get: utm_* and keys named by
 * `param:` rules. Anything else (emails, tokens in links) is never sent.
 * @param {object} params all URL params
 * @param {object[]} specs section specs
 * @returns {object}
 */
export function allowedParams(params, specs) {
  const keys = new Set();
  specs.forEach((spec) => (spec.rules || []).forEach((rule) => rule.clauses
    .filter((clause) => clause.criterion === 'param')
    .forEach((clause) => clause.values.forEach((value) => keys.add(value.split('=')[0].trim())))));
  return Object.fromEntries(Object.entries(params || {})
    .filter(([key, value]) => (key.startsWith('utm_') || keys.has(key)) && typeof value === 'string')
    .slice(0, 50)
    .map(([key, value]) => [key.slice(0, 256), value.slice(0, 256)]));
}

/**
 * The host of the page the visitor came from, only when it is another site.
 * Never the path or the query.
 * @param {string} referrer document.referrer or the Referer header
 * @param {string} host this page's host name
 * @returns {string|undefined}
 */
export function referrerHost(referrer, host) {
  try {
    const { hostname } = new URL(referrer);
    const name = hostname.toLowerCase();
    if (!name || name === String(host || '').toLowerCase() || !HOST.test(name) || name.length > 253) return undefined;
    return name;
  } catch (e) {
    return undefined;
  }
}

/**
 * Builds the v1 request body. Without consent (the approved `api`
 * exception) it carries request data only: no visitor, no state.
 * @param {object} input
 * @param {{path: string, locale?: string, title?: string}} input.page
 * @param {object[]} input.specs section specs of the sections to decide
 * @param {object} input.context { geo, device, visitor, state, params, referrer }
 * @param {boolean} input.consent personalization consent
 * @param {'client'|'edge'} input.mode
 * @returns {object}
 */
export function buildRequest({
  page, specs, context = {}, consent, mode,
}) {
  const geo = context.geo && /^[A-Z]{2}$/.test(context.geo.country || '')
    ? {
      country: context.geo.country,
      ...(/^[A-Z0-9]{1,3}$/.test(context.geo.region || '') ? { region: context.geo.region } : {}),
    }
    : undefined;
  const state = consent && isObject(context.state)
    ? Object.fromEntries(Object.entries(context.state)
      .filter(([, value]) => typeof value === 'string').slice(0, 50)
      .map(([key, value]) => [key.slice(0, 256), value.slice(0, 256)]))
    : {};
  const body = {
    version: CONTRACT_VERSION,
    page: {
      path: String(page?.path || '/').slice(0, 256),
      locale: clip(page?.locale, 35),
      title: clip(page?.title, 256),
    },
    placeholders: specs.slice(0, MAX_PLACEHOLDERS).map(placeholder),
    context: {
      geo,
      device: clip(context.device, 32),
      visitor: consent && ['new', 'returning'].includes(context.visitor) ? context.visitor : undefined,
      state: Object.keys(state).length ? state : undefined,
      params: allowedParams(context.params, specs),
      referrer: context.referrer && HOST.test(context.referrer) ? context.referrer : undefined,
      consent: { personalization: !!consent },
    },
    mode,
  };
  return JSON.parse(JSON.stringify(body));
}

function stringMap(value, max = 256) {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([key, item]) => key.length <= 256 && typeof item === 'string' && item.length <= max);
  return entries.length ? Object.fromEntries(entries.slice(0, 50)) : undefined;
}

/**
 * Rebuilds a v1 request received from a browser by the server route,
 * keeping only contract fields with bounded sizes, so a route holding the
 * engine's credentials can't be used to send arbitrary payloads.
 * @param {unknown} body parsed JSON
 * @param {{prefixes?: string[]}} [options] fragment prefixes the route accepts
 * @returns {object|null} clean v1 request, or null when body is not one
 */
export function sanitizeRequest(body, { prefixes = ['/fragments/'] } = {}) {
  if (!isObject(body) || body.version !== CONTRACT_VERSION) return null;
  const { page = {}, placeholders, context = {} } = body;
  if (!Array.isArray(placeholders) || !placeholders.length
    || placeholders.length > MAX_PLACEHOLDERS || !isObject(context)) return null;
  const fragmentOk = (path) => typeof path === 'string' && path.length <= 512
    && /^\/[A-Za-z0-9/_-]+$/.test(path) && prefixes.some((prefix) => path.startsWith(prefix));
  const clean = placeholders.map((entry) => {
    if (!isObject(entry) || !NAME.test(entry.id || '') || entry.id.length > 64) return null;
    const list = Array.isArray(entry.candidates) ? entry.candidates : [];
    if (!list.length || list.length > 21 || !list.every((name) => typeof name === 'string' && NAME.test(name))
      || !list.includes('default') || new Set(list).size !== list.length) return null;
    const fragments = isObject(entry.fragments) ? Object.fromEntries(Object.entries(entry.fragments)
      .filter(([name, path]) => list.includes(name) && name !== 'default' && fragmentOk(path))) : {};
    const descriptions = stringMap(entry.descriptions, DESCRIPTION_MAX);
    return {
      id: entry.id,
      candidates: list,
      fragments,
      hint: typeof entry.hint === 'string' && entry.hint.length <= HINT_MAX ? entry.hint : undefined,
      descriptions: descriptions && Object.fromEntries(Object.entries(descriptions)
        .filter(([name]) => list.includes(name))),
    };
  });
  if (clean.includes(null)) return null;
  const geo = isObject(context.geo) && /^[A-Z]{2}$/.test(context.geo.country || '')
    ? {
      country: context.geo.country,
      region: /^[A-Z0-9]{1,3}$/.test(context.geo.region || '') ? context.geo.region : undefined,
    }
    : undefined;
  return JSON.parse(JSON.stringify({
    version: CONTRACT_VERSION,
    page: {
      path: typeof page?.path === 'string' && page.path.startsWith('/') ? page.path.slice(0, 256) : '/',
      locale: clip(page?.locale, 35),
      title: clip(page?.title, 256),
    },
    placeholders: clean,
    context: {
      geo,
      device: clip(context.device, 32),
      visitor: ['new', 'returning'].includes(context.visitor) ? context.visitor : undefined,
      state: stringMap(context.state),
      params: stringMap(context.params) || {},
      referrer: typeof context.referrer === 'string' && HOST.test(context.referrer)
        && context.referrer.length <= 253 ? context.referrer : undefined,
      consent: { personalization: context.consent?.personalization === true },
    },
    mode: 'client',
  }));
}

/**
 * One decision of a response, checked against the four answer kinds: a
 * listed `variant` (or "default"), a `fragment`, `control: true`, or a
 * `reason` code; plus optional `tracking`. Anything else is invalid.
 * @param {unknown} decision
 * @returns {object} the decision, or { invalid: <why> }
 */
export function parseDecision(decision) {
  if (!isObject(decision)) return { invalid: 'not an object' };
  const keys = Object.keys(decision);
  const kinds = ['variant', 'fragment', 'control', 'reason'].filter((key) => key in decision);
  const tracking = isObject(decision.tracking) ? { tracking: decision.tracking } : {};
  if (kinds.length !== 1) return { invalid: kinds.length ? kinds.join(' and ') : 'empty answer', ...tracking };
  const extra = keys.filter((key) => !['variant', 'fragment', 'control', 'reason', 'tracking'].includes(key));
  if (extra.length || ('tracking' in decision && !isObject(decision.tracking))) {
    return { invalid: `unknown field ${extra[0] || 'tracking'}`, ...tracking };
  }
  const [kind] = kinds;
  const value = decision[kind];
  if (kind === 'variant' && (typeof value !== 'string' || !NAME.test(value))) return { invalid: `variant ${JSON.stringify(value)}`, ...tracking };
  if (kind === 'fragment' && (typeof value !== 'string' || !/^\/[A-Za-z0-9/_-]+$/.test(value))) return { invalid: `fragment ${JSON.stringify(value)}`, ...tracking };
  if (kind === 'control' && value !== true) return { invalid: `control ${JSON.stringify(value)}`, ...tracking };
  if (kind === 'reason' && (typeof value !== 'string' || !CODE.test(value) || value.length > 64)) return { invalid: `reason ${JSON.stringify(value)}`, ...tracking };
  return { [kind]: value, ...tracking };
}

/**
 * Validates a v1 response body. Unknown top-level fields are ignored.
 * @param {unknown} body parsed JSON
 * @returns {{decisions: object, ttl: number, cacheable: boolean}}
 * @throws {Error} when the body is not an object with a `decisions` object
 */
export function parseResponse(body) {
  if (!isObject(body)) throw new Error('response is not a JSON object');
  if (!isObject(body.decisions)) throw new Error('response has no "decisions" object');
  const decisions = Object.fromEntries(Object.entries(body.decisions)
    .filter(([id]) => NAME.test(id)).slice(0, MAX_PLACEHOLDERS)
    .map(([id, decision]) => [id, parseDecision(decision)]));
  const ttl = Number.isFinite(body.ttl) && body.ttl >= 0
    ? Math.min(body.ttl, MAX_TTL_SECONDS) : DEFAULT_TTL_SECONDS;
  return { decisions, ttl, cacheable: body.cacheable === true };
}

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) {
    return Object.keys(value).sort()
      .reduce((acc, key) => ({ ...acc, [key]: stable(value[key]) }), {});
  }
  return value;
};

/**
 * Key of a visitor's own session cache (browser): the whole request.
 * @param {object} request v1 request
 * @returns {string}
 */
export function sessionKey(request) {
  const { page, placeholders, context } = request;
  return JSON.stringify(stable({ page, placeholders, context }));
}

/**
 * Key of an answer shared between visitors at the edge (contract section
 * 10): page path, the sections with their candidates, fragments, hints and
 * descriptions, geo, device, allowed params, referrer, the consent policy and
 * the origin page's Last-Modified. A request carrying visitor or state is
 * never shared.
 * @param {object} request v1 request
 * @param {{policy?: string[], lastModified?: string}} [options]
 * @returns {string|null} null when the request may not be shared
 */
export function sharedKey(request, { policy = [], lastModified = '' } = {}) {
  const { page, placeholders, context } = request;
  if (context.visitor || context.state) return null;
  return JSON.stringify(stable({
    path: page.path,
    placeholders,
    geo: context.geo,
    device: context.device,
    params: context.params,
    referrer: context.referrer,
    consent: context.consent,
    policy: [...policy].sort(),
    lastModified,
  }));
}

/**
 * Criteria used by a set of sections (what the engine context may need).
 * @param {object[]} specs
 * @returns {Set<string>}
 */
export function criteriaOf(specs) {
  const used = new Set();
  specs.forEach((spec) => criteriaUsed(spec).forEach((criterion) => used.add(criterion)));
  return used;
}
