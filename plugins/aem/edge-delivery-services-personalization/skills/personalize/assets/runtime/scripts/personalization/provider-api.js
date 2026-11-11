/*
 * Decision engine transport: one batched request, with timeout, adapters and
 * (browser) a session cache. callEngine is shared with the edge worker and
 * its server route.
 */

import { parseResponse, sessionKey } from './contract.js';

export const CACHE_PREFIX = 'pzn-decisions:';

// Answers fetched in this page view. A re-evaluation that reuses one of them
// from the session cache is the same answer, not a cached one (contract
// section 9: cached means reused from an earlier page view or the engine's
// own cache).
const fetchedThisView = new Set();

function readCache(storage, key, now) {
  try {
    const entry = JSON.parse(storage?.getItem(CACHE_PREFIX + key) || 'null');
    return entry && entry.expires > now ? entry.response : null;
  } catch (e) {
    return null;
  }
}

function writeCache(storage, key, response, now) {
  try {
    const entry = { response, expires: now + response.ttl * 1000 };
    storage?.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // storage full or blocked: no cache
  }
}

/**
 * An engine failure, with its kind: timeout (slower than allowed), http
 * (non-2xx or network), json (not JSON) or contract (not a v1 response).
 */
export class EngineError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * One request to the decision engine. Applies the adapters
 * (mapRequest(v1) -> { url?, init?, body }, mapResponse(json, v1) -> v1
 * response) and validates the answer.
 * @param {object} options
 * @param {string} options.url engine URL
 * @param {object} options.body v1 request
 * @param {number} options.timeout ms
 * @param {object} [options.headers] extra headers (the server route adds credentials)
 * @param {object} [options.init] extra fetch options
 * @param {Function} [options.mapRequest]
 * @param {Function} [options.mapResponse]
 * @param {Function} options.fetchImpl
 * @returns {Promise<{decisions: object, ttl: number, cacheable: boolean}>}
 * @throws {EngineError}
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
    if (!response.ok) throw new EngineError(`HTTP ${response.status}`, 'http');
    let json;
    try {
      json = await response.json();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new EngineError('bad JSON', 'json');
    }
    try {
      return parseResponse(mapResponse ? await mapResponse(json, body) : json);
    } catch (e) {
      throw new EngineError(e.message, 'contract');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new EngineError(`timed out after ${timeout} ms`, 'timeout');
    if (error instanceof EngineError) throw error;
    throw new EngineError(error.message || 'network error', 'http');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Requests decisions for a batch of sections from the browser.
 * @param {object} options
 * @param {string} options.endpoint engine URL (same-origin server route)
 * @param {object} options.body v1 request
 * @param {number} options.timeout ms
 * @param {Function} [options.mapRequest]
 * @param {Function} [options.mapResponse]
 * @param {Storage} [options.storage] sessionStorage; only passed with consent
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.now]
 * @returns {Promise<{response?: object, cached: boolean, ms: number, error?: string,
 *   kind?: string}>}
 */
export async function fetchDecisions({
  endpoint, body, timeout, mapRequest, mapResponse, storage,
  fetchImpl = (...args) => window.fetch(...args), now = Date.now,
}) {
  const started = now();
  const key = sessionKey(body);
  const hit = readCache(storage, key, started);
  if (hit) return { response: hit, cached: !fetchedThisView.has(key), ms: 0 };
  try {
    const response = await callEngine({
      url: endpoint,
      body,
      timeout,
      init: { credentials: 'same-origin' },
      mapRequest,
      mapResponse,
      fetchImpl,
    });
    fetchedThisView.add(key);
    // A visitor's own cache: `cacheable` (sharing) is not needed here.
    if (storage && response.ttl > 0) writeCache(storage, key, response, now());
    return { response, cached: false, ms: now() - started };
  } catch (error) {
    return {
      cached: false, ms: now() - started, error: error.message, kind: error.kind || 'http',
    };
  }
}
