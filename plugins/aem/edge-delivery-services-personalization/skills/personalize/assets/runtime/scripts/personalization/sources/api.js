/*
 * `api` source: a decision engine behind the decision API v1. One
 * batched request per evaluation for the page's browser-decided api
 * sections, to a same-origin server route (the edge route /pzn/decide, an
 * engine's proxy or a CDN proxy) that keeps the engine's credentials.
 * config.api.mapRequest / mapResponse adapt a keyless engine that speaks
 * another shape; adapters that need credentials live in the server route.
 */

import { buildRequest, requestBytes, MAX_REQUEST_BYTES } from '../contract.js';
import { fetchDecisions } from '../provider-api.js';

/**
 * @param {object[]} specs section specs to decide
 * @param {object} context visitor context
 * @param {object} options
 * @param {object} options.config site config
 * @param {boolean} options.consent false: the approved `api` exception (request data only)
 * @param {Function} options.fetch
 * @param {number} options.timeout ms
 * @param {Function} [options.canStore] whether the answer may still be kept
 *   when it arrives (consent not withdrawn meanwhile)
 * @returns {Promise<{response?: object, cached: boolean, ms: number, error?: string,
 *   kind?: string, request?: object}>}
 */
export async function apiAnswers(specs, context, {
  config, consent, fetch, timeout, canStore,
}) {
  const api = config.api || {};
  if (!api.endpoint) return { error: 'no endpoint (config.api.endpoint)', kind: 'http', cached: false };
  const request = buildRequest({
    page: {
      path: window.location.pathname,
      locale: document.documentElement.lang,
      title: document.title,
    },
    specs,
    context,
    consent,
    mode: 'client',
  });
  const bytes = requestBytes(request);
  if (bytes > MAX_REQUEST_BYTES) {
    return {
      error: `request too large (${bytes} bytes > ${MAX_REQUEST_BYTES})`, kind: 'http', cached: false, ms: 0, request,
    };
  }
  const result = await fetchDecisions({
    endpoint: api.endpoint,
    body: request,
    timeout,
    mapRequest: api.mapRequest,
    mapResponse: api.mapResponse,
    // Answers are kept for the session only with consent.
    storage: consent ? window.sessionStorage : undefined,
    canStore,
    fetchImpl: fetch,
  });
  return { ...result, request };
}

export default apiAnswers;
