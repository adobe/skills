/*
 * Adapter between the decision API (v1, contract section 5) and OF1's
 * native /api/decide, from the contract's reference adapter
 * (adapters/of1.mjs, tested against OF1's live samples). It runs in the
 * server route and the edge (edge-config.js), never in the browser: the
 * tenant id is server configuration.
 *
 *   import { createOf1Adapter } from './adapters/of1.js';
 *   const of1 = createOf1Adapter({ tenant: 'owner/site' });
 *   api: { engine: 'of1', mapRequest: of1.mapRequest, mapResponse: of1.mapResponse }
 *
 * OF1 gets only what the contract allows: the page path and title, each
 * section's hint and candidate descriptions, and acquisition.source derived
 * from the contract context (campaign, search, referral, direct). No
 * profile, no audiences.
 */

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia)\.[a-z.]+$/;

/**
 * acquisition.source from the contract's context only (no profile data).
 * @param {object} context v1 context
 * @returns {string} campaign | search | referral | direct
 */
export function acquisitionSource(context = {}) {
  const params = context.params || {};
  if (params.utm_source || params.utm_medium || params.utm_campaign) return 'campaign';
  if (context.referrer) return SEARCH_HOSTS.test(context.referrer) ? 'search' : 'referral';
  return 'direct';
}

/**
 * Candidate order sent to OF1: the default first (c0), then the variants in
 * the order of the v1 candidates.
 * @param {object} placeholder v1 placeholder
 * @returns {string[]} candidate names, index = OF1 position
 */
export function candidateOrder(placeholder) {
  return ['default', ...placeholder.candidates.filter((name) => name !== 'default')];
}

/**
 * @param {object} options
 * @param {string} options.tenant OF1 site id, e.g. 'owner/site'
 * @param {string} [options.index] OF1 index, default 'publish'
 * @param {Function} [options.newRequestId]
 * @returns {{mapRequest: Function, mapResponse: Function}}
 */
export function createOf1Adapter({
  tenant, index = 'publish', newRequestId = () => crypto.randomUUID(),
} = {}) {
  if (!tenant) throw new Error('OF1 adapter: tenant is required');

  /**
   * v1 request -> OF1 native request. Descriptions must already be filled by
   * the route (author rows first, else the fragment / page text): an empty
   * summary makes OF1 answer low_confidence.
   * @param {object} v1
   * @returns {{init: object, body: object}}
   */
  function mapRequest(v1) {
    const requestId = newRequestId();
    return {
      init: { headers: { 'x-of1-request-id': requestId } },
      body: {
        id: tenant,
        index,
        page: { url: v1.page.path, ...(v1.page.title ? { title: v1.page.title } : {}) },
        signals: { acquisition: { source: acquisitionSource(v1.context) }, audiences: [] },
        decisions: v1.placeholders.map((placeholder) => ({
          id: placeholder.id,
          ...(placeholder.hint ? { hint: placeholder.hint } : {}),
          candidates: candidateOrder(placeholder).map((name, i) => ({
            id: `c${i}`,
            summary: placeholder.descriptions?.[name] || '',
            ...(i === 0 ? { isDefault: true } : {}),
          })),
        })),
      },
    };
  }

  /**
   * OF1 native response -> v1 response. Needs the v1 request because OF1's
   * candidate ids are positional.
   * @param {object} json OF1 response
   * @param {object} v1 the v1 request
   * @returns {{decisions: object}}
   */
  function mapResponse(json, v1) {
    const decisions = {};
    v1.placeholders.forEach((placeholder) => {
      const answer = json?.decisions?.[placeholder.id];
      if (!answer) return; // no answer for this section: no-match
      const confidence = answer.confidence !== null && answer.confidence !== undefined
        ? { confidence: answer.confidence } : {};
      const tracking = {
        engine: 'of1',
        ...(json.requestId ? { requestId: json.requestId } : {}),
        ...(json.model ? { model: json.model } : {}),
        ...confidence,
      };
      // fallback/reason first: a fallback also carries choice c0, which is not a choice.
      if (answer.fallback === true || answer.reason) {
        decisions[placeholder.id] = { reason: answer.reason || 'unspecified', tracking };
        return;
      }
      const position = /^c(\d+)$/.exec(answer.choice || '');
      const name = position ? candidateOrder(placeholder)[Number(position[1])] : undefined;
      decisions[placeholder.id] = name
        ? { variant: name, tracking }
        : { reason: 'invalid_choice', tracking };
    });
    return { decisions };
  }

  return { mapRequest, mapResponse };
}
