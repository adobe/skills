/*
 * `target` source over the Target Delivery API (contract section 7,
 * config.target.transport 'delivery-api', the default):
 * https://<clientCode>.tt.omtrdc.net/rest/v1/delivery, or a same-origin
 * proxy in config.target.endpoint.
 *
 * Every target section is one location (mbox): its `Personalization
 * Location` row, else its id. All of them are prefetched in one request with
 * the location parameters `device` and `visitor`. An offer is a JSON offer
 * (target-offer.schema.json): { "fragment": "/fragments/..." } names a listed
 * variant, { "control": true } is the control experience; nothing returned
 * is no-match. Prefetch never counts as a visit: notify() sends `display`
 * when the section is seen and `click` on the first link click.
 *
 * Called only with consent (never through an exception). The session id is
 * kept in sessionStorage and the Target visitor id (tntId) in localStorage;
 * both are cleared when consent is withdrawn (context.js clearStored).
 * Notification tokens stay in memory for the page view only.
 */

import { TNT_ID_STORAGE_KEY } from '../context.js';

export const TNT_ID_KEY = TNT_ID_STORAGE_KEY;
export const SESSION_KEY = 'pzn-tnt-session';
export const EDGE_HOST_KEY = 'pzn-tnt-edge';
export const DEFAULT_TIMEOUT = 3000;

// Response tokens kept as `tracking`: Target's activity and experience,
// never profile or geo tokens.
const TRACKING_TOKENS = /^(activity|experience|offer|option)\.(id|name)$/;

const uuid = () => (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A section's Target location.
 * @param {object} spec
 * @returns {string}
 */
export function locationOf(spec) {
  return spec.location || spec.id;
}

/**
 * Reads the content of a Target JSON offer (target-offer.schema.json).
 * Extra fields are ignored.
 * @param {unknown} content
 * @returns {{fragment: string}|{control: true}|{invalid: string}}
 */
export function readOffer(content) {
  if (!isObject(content)) return { invalid: 'offer is not a JSON offer' };
  const hasFragment = 'fragment' in content;
  const hasControl = 'control' in content;
  if (hasFragment && hasControl) return { invalid: 'offer has both fragment and control' };
  if (hasControl) return content.control === true ? { control: true } : { invalid: 'offer control is not true' };
  if (typeof content.fragment === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(content.fragment)) {
    return { fragment: content.fragment };
  }
  return { invalid: 'offer is not { "fragment": "/..." } or { "control": true }' };
}

/**
 * Activity and experience names from response tokens.
 * @param {object} [tokens] option.responseTokens
 * @returns {object|undefined}
 */
export function trackingOf(tokens) {
  if (!isObject(tokens)) return undefined;
  const kept = Object.entries(tokens)
    .filter(([key, value]) => TRACKING_TOKENS.test(key) && ['string', 'number'].includes(typeof value));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * @param {object} target config.target
 * @param {string} sessionId
 * @param {string} [edgeHost] host Target answered from earlier in the session
 * @param {string} [base] page URL, for a relative config.target.endpoint
 * @returns {string}
 */
export function deliveryUrl(target, sessionId, edgeHost, base = 'https://target.invalid/') {
  const host = edgeHost || `${target.clientCode}.tt.omtrdc.net`;
  const url = new URL(target.endpoint || `https://${host}/rest/v1/delivery`, base);
  url.searchParams.set('client', target.clientCode || '');
  url.searchParams.set('sessionId', sessionId);
  return url.href;
}

/**
 * The Delivery API context of this page view.
 * @param {object} page { url, referrer, screen, viewport }
 * @returns {object}
 */
export function requestContext({
  url, referrer, screen, viewport,
}) {
  return {
    channel: 'web',
    address: { url, referringUrl: referrer || undefined },
    screen,
    window: viewport,
  };
}

/**
 * Prefetch request for the page's target locations.
 * @param {string[]} locations in order
 * @param {object} context visitor context ({ device, visitor })
 * @param {object} request { requestId, tntId, propertyToken, page }
 * @returns {object}
 */
export function prefetchRequest(locations, context, {
  requestId, tntId, propertyToken, page,
}) {
  const { device, visitor } = context;
  const parameters = Object.fromEntries(
    Object.entries({ device, visitor }).filter(([, value]) => value),
  );
  return JSON.parse(JSON.stringify({
    requestId,
    id: tntId ? { tntId } : undefined,
    property: propertyToken ? { token: propertyToken } : undefined,
    context: requestContext(page),
    prefetch: { mboxes: locations.map((name, index) => ({ index, name, parameters })) },
  }));
}

/**
 * Turns a prefetched mbox into a normalized answer.
 * @param {object|undefined} mbox prefetch.mboxes entry
 * @returns {object|undefined} { fragment|control|invalid, tracking?, tokens }, or
 *   undefined when no experience qualified
 */
export function toAnswer(mbox) {
  const option = mbox?.options?.[0];
  if (!option) return undefined;
  const offer = option.type === 'json' ? readOffer(option.content) : { invalid: `offer type ${option.type || 'unknown'} (JSON offers only)` };
  const tokens = {
    display: (mbox.options || []).map((item) => item.eventToken).filter(Boolean),
    click: (mbox.metrics || []).filter((metric) => metric.type === 'click' && metric.eventToken)
      .map((metric) => metric.eventToken),
  };
  const tracking = trackingOf(option.responseTokens);
  return JSON.parse(JSON.stringify({ ...offer, tracking, tokens }));
}

/**
 * Notification request for a displayed or clicked offer.
 * @param {'display'|'click'} type
 * @param {string} location
 * @param {string[]} tokens event tokens
 * @param {object} request { requestId, id, tntId, propertyToken, page, timestamp }
 * @returns {object}
 */
export function notificationRequest(type, location, tokens, {
  requestId, id, tntId, propertyToken, page, timestamp,
}) {
  return JSON.parse(JSON.stringify({
    requestId,
    id: tntId ? { tntId } : undefined,
    property: propertyToken ? { token: propertyToken } : undefined,
    context: requestContext(page),
    notifications: [{
      id, type, timestamp, mbox: { name: location }, tokens,
    }],
  }));
}

/**
 * Whether Target accepted a notification: only when its answer lists the
 * notification id.
 * @param {object} json Delivery API response
 * @param {string} id notification id
 * @returns {boolean}
 */
export function notificationOk(json, id) {
  return Array.isArray(json?.notifications) && json.notifications.some((item) => item?.id === id);
}

function session(key, value) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    return window.sessionStorage.getItem(key);
  } catch (e) {
    return value || null;
  }
}

function currentSession() {
  return session(SESSION_KEY) || session(SESSION_KEY, uuid());
}

function storedTntId(value) {
  try {
    if (value) window.localStorage.setItem(TNT_ID_KEY, value);
    return window.localStorage.getItem(TNT_ID_KEY);
  } catch (e) {
    return value || null;
  }
}

function currentPage() {
  return {
    url: window.location.href,
    referrer: document.referrer,
    screen: { width: window.screen.width, height: window.screen.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

async function send(target, body, { fetch, timeout }) {
  const limit = timeout || target.timeout || DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const edgeHost = target.endpoint ? null : session(EDGE_HOST_KEY);
    const url = deliveryUrl(target, currentSession(), edgeHost, window.location.href);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A click notification must outlive the navigation it reports.
      keepalive: !!body.notifications,
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { kind: 'http' });
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error(`timed out after ${limit} ms`), { kind: 'timeout' });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prefetches the page's target sections.
 * @param {object[]} specs target section specs
 * @param {object} context visitor context
 * @param {object} options { config, fetch, timeout }
 * @returns {Promise<{answers?: object, error?: string, kind?: string}>} answers: id -> answer
 */
export async function decide(specs, context, { config, fetch, timeout }) {
  const target = config.target || {};
  if (!target.clientCode) return { error: 'no clientCode (config.target)', kind: 'config' };
  const locations = [...new Set(specs.map(locationOf))];
  try {
    const json = await send(target, prefetchRequest(locations, context, {
      requestId: uuid(),
      tntId: storedTntId(),
      propertyToken: target.propertyToken,
      page: currentPage(),
    }), { fetch, timeout });
    storedTntId(json?.id?.tntId);
    if (json?.edgeHost && !target.endpoint) session(EDGE_HOST_KEY, json.edgeHost);
    const mboxes = json?.prefetch?.mboxes || [];
    const byLocation = Object.fromEntries(locations.map((name, index) => [
      name,
      toAnswer(mboxes.find((mbox) => mbox.index === index
        || (mbox.index === undefined && mbox.name === name))),
    ]));
    const answers = Object.fromEntries(specs
      .map((spec) => [spec.id, byLocation[locationOf(spec)]]));
    return { answers };
  } catch (error) {
    return { error: error.message || 'network error', kind: error.kind || 'http' };
  }
}

/**
 * Tells Target the visitor saw (`display`) or clicked (`click`) an offer.
 * @param {{type: 'display'|'click', spec: object, decision: object}} event
 * @param {object} options { config, fetch }
 * @returns {Promise<{ok: boolean}|null>} null when there is nothing to send
 */
export async function notify({ type, spec, decision }, { config, fetch }) {
  const tokens = decision.tokens?.[type];
  if (!tokens?.length) return null;
  const target = config.target || {};
  const id = uuid();
  try {
    const json = await send(target, notificationRequest(type, locationOf(spec), tokens, {
      requestId: uuid(),
      id,
      tntId: storedTntId(),
      propertyToken: target.propertyToken,
      page: currentPage(),
      timestamp: Date.now(),
    }), { fetch });
    return { ok: notificationOk(json, id) };
  } catch (e) {
    return { ok: false };
  }
}
