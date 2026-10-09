/*
 * Decision engine transport: one batched request per page, with timeout,
 * session cache and adapter hooks. Every failure resolves to null so callers
 * fall back to authored rules and then the default. callEngine is shared with
 * the edge worker.
 */

import { parseResponse, cacheKey } from './contract.js';

export const CACHE_PREFIX = 'pzn-decisions:';

function readCache(storage, key, now) {
  try {
    const entry = JSON.parse(storage?.getItem(CACHE_PREFIX + key) || 'null');
    return entry && entry.expires > now ? entry.decisions : null;
  } catch (e) {
    return null;
  }
}

function writeCache(storage, key, decisions, ttl, now) {
  try {
    storage?.setItem(CACHE_PREFIX + key, JSON.stringify({ decisions, expires: now + ttl * 1000 }));
  } catch (e) {
    // storage full or blocked: no cache
  }
}

/**
 * One request to the decision engine, shared by the browser runtime and the
 * edge worker. Applies the adapters and validates the answer.
 * @param {object} options
 * @param {string} options.url engine URL
 * @param {object} options.body v1 request from buildRequest
 * @param {number} options.timeout ms
 * @param {object} [options.headers] extra request headers (the edge adds the secret)
 * @param {object} [options.init] extra fetch options
 * @param {Function} [options.mapRequest] v1 request -> { url?, init?, body }
 * @param {Function} [options.mapResponse] engine JSON -> v1 response
 * @param {Function} options.fetchImpl
 * @returns {Promise<{decisions: object, ttl: number, cacheable: boolean}>}
 * @throws {Error} on HTTP errors, timeouts and contract violations
 */
export async function callEngine({
  url, body, timeout, headers = {}, init: extra = {}, mapRequest, mapResponse, fetchImpl,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const mapped = mapRequest ? await mapRequest(body) : { body };
    const init = {
      method: 'POST',
      ...extra,
      ...(mapped.init || {}),
      headers: { 'content-type': 'application/json', ...headers, ...(mapped.init?.headers || {}) },
      body: JSON.stringify(mapped.body ?? body),
      signal: controller.signal,
    };
    if (String(init.method).toUpperCase() === 'GET') delete init.body;
    const response = await fetchImpl(mapped.url || url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return parseResponse(mapResponse ? await mapResponse(json) : json);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`timed out after ${timeout}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Requests decisions for a batch of placeholders.
 * @param {object} options
 * @param {string} options.endpoint engine URL (same-origin path recommended)
 * @param {object} options.body v1 request from buildRequest
 * @param {number} options.timeout ms
 * @param {Function} [options.mapRequest] v1 request -> { url?, init?, body }
 * @param {Function} [options.mapResponse] engine JSON -> v1 response
 * @param {Storage} [options.storage] sessionStorage, only passed with consent
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.now]
 * @returns {Promise<{decisions: object|null, cached: boolean, ms: number, error?: string}>}
 */
export async function fetchDecisions({
  endpoint, body, timeout, mapRequest, mapResponse, storage,
  fetchImpl = (...args) => window.fetch(...args), now = Date.now,
}) {
  const started = now();
  const key = cacheKey(body);
  const cached = readCache(storage, key, started);
  if (cached) return { decisions: cached, cached: true, ms: 0 };
  try {
    const result = await callEngine({
      url: endpoint,
      body,
      timeout,
      init: { credentials: 'same-origin' },
      mapRequest,
      mapResponse,
      fetchImpl,
    });
    // Per-visitor cache, so `cacheable` (shared caching) is not required here.
    if (result.ttl > 0) writeCache(storage, key, result.decisions, result.ttl, now());
    return { decisions: result.decisions, cached: false, ms: now() - started };
  } catch (error) {
    return {
      decisions: null, cached: false, ms: now() - started, error: error.message,
    };
  }
}
