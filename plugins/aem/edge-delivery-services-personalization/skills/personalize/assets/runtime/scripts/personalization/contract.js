/*
 * Decision engine API contract, version 1.
 *
 * Shared by the browser runtime and the edge worker. Builds the request body
 * and validates the response; transport (fetch, timeout, cache) lives in the
 * caller. See reference/decision-api-contract.md in the skill.
 */

import { criteriaUsed } from './rules.js';

export const CONTRACT_VERSION = '1';
export const MAX_TTL_SECONDS = 1800;
export const DEFAULT_TTL_SECONDS = 300;
export const MAX_PLACEHOLDERS = 20;

/**
 * Candidate variants of a placeholder, as sent to the decision engine.
 * @param {object} spec from parseSpec
 * @returns {string[]}
 */
export function candidates(spec) {
  return [...new Set([...spec.rules.map((rule) => rule.variant), 'default'])];
}

/**
 * Keeps only the URL params the engine may use: utm_* and keys referenced by
 * `param:` rules. Anything else (emails, tokens in links) is never forwarded.
 * @param {object} params all URL params
 * @param {object[]} specs placeholder specs
 * @returns {object}
 */
export function allowedParams(params, specs) {
  const keys = new Set();
  specs.forEach((spec) => spec.rules.forEach((rule) => rule.clauses
    .filter((clause) => clause.criterion === 'param')
    .forEach((clause) => clause.values.forEach((value) => keys.add(value.split('=')[0].trim())))));
  return Object.fromEntries(Object.entries(params || {})
    .filter(([key]) => key.startsWith('utm_') || keys.has(key)));
}

/**
 * Builds the v1 request body.
 * @param {object} input
 * @param {string} input.path page path
 * @param {string} [input.locale] page locale
 * @param {object[]} input.specs placeholder specs to decide
 * @param {object} input.context resolved context
 * @param {boolean} input.consent personalization consent
 * @param {'client'|'edge'} input.mode
 * @returns {object}
 */
export function buildRequest({
  path, locale, specs, context, consent, mode,
}) {
  const used = new Set();
  specs.forEach((spec) => criteriaUsed(spec).forEach((criterion) => used.add(criterion)));
  const body = {
    version: CONTRACT_VERSION,
    page: { path, locale: locale || undefined },
    placeholders: specs.map((spec) => ({ id: spec.id, candidates: candidates(spec) })),
    context: {
      geo: context.geo && context.geo.country ? { ...context.geo } : undefined,
      device: context.device || undefined,
      visitor: context.visitor || undefined,
      state: consent && context.state && Object.keys(context.state).length
        ? { ...context.state } : undefined,
      params: allowedParams(context.params, specs),
      consent: { personalization: !!consent },
    },
    mode,
  };
  // Without consent only what is needed to decide this page is sent.
  if (!consent && !used.has('visitor')) delete body.context.visitor;
  return JSON.parse(JSON.stringify(body));
}

const MAX_TEXT = 256;
const MAX_ENTRIES = 50;
const isText = (value) => typeof value === 'string' && value.length <= MAX_TEXT;
const text = (value) => (isText(value) ? value : undefined);

function bag(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, item]) => isText(key) && isText(item));
  return entries.length ? Object.fromEntries(entries.slice(0, MAX_ENTRIES)) : undefined;
}

/**
 * Rebuilds a v1 request received from a browser, keeping only contract
 * fields with bounded sizes, so a proxy holding the engine secret cannot be
 * used to send arbitrary payloads.
 * @param {unknown} body parsed JSON
 * @returns {object|null} clean v1 request, or null when body is not one
 */
export function sanitizeRequest(body) {
  if (!body || typeof body !== 'object' || body.version !== CONTRACT_VERSION) return null;
  const { page = {}, placeholders, context = {} } = body;
  if (!Array.isArray(placeholders) || !placeholders.length
    || placeholders.length > MAX_PLACEHOLDERS) return null;
  const clean = placeholders.map((placeholder) => (placeholder && isText(placeholder.id)
    && Array.isArray(placeholder.candidates) && placeholder.candidates.length <= MAX_ENTRIES
    && placeholder.candidates.every(isText)
    ? { id: placeholder.id, candidates: placeholder.candidates } : null));
  if (clean.includes(null) || !context || typeof context !== 'object') return null;
  return JSON.parse(JSON.stringify({
    version: CONTRACT_VERSION,
    page: { path: text(page?.path) || '/', locale: text(page?.locale) },
    placeholders: clean,
    context: {
      geo: bag(context.geo),
      device: text(context.device),
      visitor: text(context.visitor),
      state: bag(context.state),
      params: bag(context.params) || {},
      consent: { personalization: context.consent?.personalization === true },
    },
    mode: 'client',
  }));
}

/**
 * Validates a v1 response body.
 * @param {unknown} body parsed JSON
 * @returns {{decisions: object, ttl: number, cacheable: boolean}}
 * @throws {Error} when the body does not follow the contract
 */
export function parseResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('response is not a JSON object');
  }
  const { decisions } = body;
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) {
    throw new Error('response has no "decisions" object');
  }
  const clean = {};
  Object.entries(decisions).forEach(([id, decision]) => {
    if (!decision || typeof decision !== 'object') return;
    const entry = {};
    if (typeof decision.variant === 'string' || decision.variant === null) entry.variant = decision.variant;
    if (typeof decision.fragment === 'string') entry.fragment = decision.fragment;
    if (decision.tracking && typeof decision.tracking === 'object') entry.tracking = decision.tracking;
    if ('variant' in entry || 'fragment' in entry) clean[id] = entry;
  });
  const ttl = Number.isFinite(body.ttl) && body.ttl >= 0
    ? Math.min(body.ttl, MAX_TTL_SECONDS) : DEFAULT_TTL_SECONDS;
  return { decisions: clean, ttl, cacheable: body.cacheable === true };
}

/**
 * Stable key of the context fields that influence a decision, for caching.
 * @param {object} requestBody from buildRequest
 * @returns {string}
 */
export function cacheKey(requestBody) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort()
        .reduce((acc, key) => ({ ...acc, [key]: stable(value[key]) }), {});
    }
    return value;
  };
  const { page, placeholders, context } = requestBody;
  return JSON.stringify(stable({ page, placeholders, context }));
}
