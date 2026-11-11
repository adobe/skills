/*
 * `api` source: a decision engine behind the v1 contract (contract section
 * 5). One batched request per evaluation for the page's browser-decided api
 * sections, to a same-origin server route (the edge route /pzn/decide, an
 * engine's proxy or a CDN proxy) that keeps the engine's credentials.
 * config.api.mapRequest / mapResponse adapt a keyless engine that speaks
 * another shape; adapters that need credentials live in the server route.
 */

import { buildRequest } from '../contract.js';
import { fetchDecisions } from '../provider-api.js';

/**
 * @param {object[]} specs section specs to decide
 * @param {object} context visitor context
 * @param {object} options
 * @param {object} options.config site config
 * @param {boolean} options.consent false: the approved `api` exception (request data only)
 * @param {Function} options.fetch
 * @param {number} options.timeout ms
 * @returns {Promise<{response?: object, cached: boolean, ms: number, error?: string,
 *   kind?: string, request?: object}>}
 */
export async function apiAnswers(specs, context, {
  config, consent, fetch, timeout,
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
  const result = await fetchDecisions({
    endpoint: api.endpoint,
    body: request,
    timeout,
    mapRequest: api.mapRequest,
    mapResponse: api.mapResponse,
    // Answers are kept for the session only with consent.
    storage: consent ? window.sessionStorage : undefined,
    fetchImpl: fetch,
  });
  return { ...result, request };
}

export default apiAnswers;
