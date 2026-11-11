/* eslint-disable no-console */
/*
 * Browser glue for the section runtime (sections.js): preview overrides, the
 * consent policy (contract section 3), the bot check, the visitor context
 * (section 2), page state, measurement delivery (section 9), the debug
 * table and the public API, window.hlx.personalization.
 */

import config from './config.js';
import {
  parseCookies, readGeo, parseGeo, getDevice, getVisitor, syncConsentCookie, clearStored, isBot,
  readParams, overridesEnabled, readOverrides, loadState, saveState,
} from './context.js';
import { referrerHost } from './contract.js';

const search = new URLSearchParams(window.location.search);
const writeCookie = (cookie) => { document.cookie = cookie; };
const storage = (name) => {
  try {
    return window[name];
  } catch (e) {
    return undefined;
  }
};

// Preview hosts (aem.page, localhost) by default; see config.overrides.
export const previewHost = overridesEnabled(config.overrides, window.location.hostname);
export const overrides = readOverrides(previewHost ? search : new URLSearchParams());
export const debug = previewHost && overrides.debug;

// One row per evaluation, also those that produced no new decision.
export const decisions = [];
let debugTimer;

/**
 * Records an evaluation for ?pzn-debug and window.hlx.personalization.decisions.
 * @param {object} row
 * @returns {object} the row, which may be updated later (log it again to reprint)
 */
export function log(row) {
  if (!decisions.includes(row)) decisions.push(row);
  if (debug) {
    clearTimeout(debugTimer);
    debugTimer = setTimeout(() => console.table(decisions), 100);
  }
  return row;
}

// --- Consent (contract section 3) ---

const policy = config.consent || { mode: 'deny' };
const approved = new Set(policy.mode !== 'allow' && policy.policyRef ? policy.withoutConsent || [] : []);
if (policy.withoutConsent?.length && !policy.policyRef) {
  console.warn('⚠️ personalization: consent.withoutConsent is ignored without consent.policyRef (where the approval is recorded)');
}
let previewConsent;

/**
 * The consent tool's answer: true, false, or undefined while it hasn't
 * answered. consent.mode allow / deny fix it; ?pzn-consent and the preview
 * hook override it on preview hosts.
 * @returns {boolean|undefined}
 */
export function consentAnswer() {
  if (previewConsent !== undefined) return previewConsent;
  if (overrides.consent !== undefined) return overrides.consent;
  if (policy.mode === 'allow') return true;
  if (policy.mode !== 'cmp') return false;
  try {
    const answer = config.hasConsent('personalization');
    return answer === undefined || answer === null ? undefined : !!answer;
  } catch (e) {
    return false;
  }
}

/**
 * @returns {boolean} personalization consent
 */
export function hasConsent() {
  return consentAnswer() === true;
}

/**
 * Whether an approved exception allows something without consent.
 * @param {'rules'|'split'|'api'|'rum'|'data-layer'} exception
 * @returns {boolean}
 */
export function allowed(exception) {
  return approved.has(exception);
}

/**
 * Mirrors the consent answer into the pzn-consent cookie the edge reads,
 * once the consent tool has answered. Deletes stored data when consent is
 * no longer given.
 * @returns {boolean} consent
 */
export function syncConsent() {
  const answer = consentAnswer();
  if (answer !== undefined) {
    syncConsentCookie(answer, parseCookies(document.cookie), writeCookie, storage('localStorage'), storage('sessionStorage'));
  }
  return answer === true;
}

/**
 * Deletes everything the skill stored on the device (consent withdrawn).
 */
export function forgetVisitor() {
  clearStored(writeCookie, storage('localStorage'), storage('sessionStorage'));
}

/**
 * Crawlers and performance tools get the authored content. Preview
 * overrides win, since headless test browsers look like bots.
 * @returns {boolean}
 */
export function isCrawler() {
  return config.botsGetDefault !== false && !overrides.any && isBot(navigator.userAgent);
}

// --- Page state (state: rules) ---

// Values set in this page view (setState, ?pzn-state), and the persisted
// values, read only with consent.
const pageState = { ...(overrides.context.state || {}) };
let storedState = null;

/**
 * @param {boolean} consent
 * @returns {object} the state rules see: persisted state (with consent), then
 *   this page view's values
 */
export function currentState(consent) {
  if (!consent) return { ...pageState };
  storedState = storedState || loadState(storage('localStorage'));
  return { ...storedState, ...pageState };
}

/**
 * Forgets the persisted state (consent withdrawn); this page view's values stay.
 */
export function dropStoredState() {
  storedState = null;
}

// --- Context (contract section 2) ---

let geoPromise;

async function lookupGeo() {
  const { endpoint, timeout } = config.geo || {};
  if (!endpoint) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 500);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const json = response.ok ? await response.json() : {};
    return parseGeo(json.region ? `${json.country}-${json.region}` : json.country);
  } catch (e) {
    console.warn('⚠️ personalization: geo lookup failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The visitor's context, read fresh on every evaluation. Without consent it
 * holds request data only: geo from the edge's meta tag (not the pzn-geo
 * cookie, not the geo endpoint), device, URL params, the referrer host and
 * this page view's state; no visitor, nothing stored.
 * @param {object} options
 * @param {boolean} options.consent
 * @param {boolean} [options.needGeo] call config.geo.endpoint (opt-in) when no
 *   edge meta tag or cookie provides geo; with consent only
 * @returns {Promise<object>} { geo, device, visitor, params, state, referrer }
 */
export async function getContext({ consent, needGeo = false }) {
  const cookies = parseCookies(document.cookie);
  const context = {
    geo: readGeo(document, cookies, { cookie: consent }),
    device: getDevice(config.devices, (query) => window.matchMedia(query)),
    visitor: getVisitor(cookies, consent, writeCookie),
    params: readParams(search),
    state: currentState(consent),
    referrer: referrerHost(document.referrer, window.location.hostname),
  };
  ['geo', 'device'].forEach((key) => {
    if (overrides.context[key]) context[key] = overrides.context[key];
  });
  if (consent && overrides.context.visitor) context.visitor = overrides.context.visitor;
  if (consent && needGeo && !context.geo) {
    geoPromise = geoPromise || lookupGeo();
    context.geo = await geoPromise;
  }
  return context;
}

/**
 * Custom audiences from config.js, plus those forced with ?pzn-audience.
 * @returns {object}
 */
export function getAudiences() {
  const audiences = { ...(config.audiences || {}) };
  overrides.audiences.forEach((name) => { audiences[name] = true; });
  return audiences;
}

// --- Measurement delivery (contract section 9) ---

/**
 * Sends one measurement event: a CustomEvent on the section (bubbles) and
 * adobeDataLayer. Only with consent, or the `data-layer` exception.
 * @param {Element} section
 * @param {string} event pzn:decided | pzn:applied | pzn:seen | pzn:clicked | pzn:notified
 * @param {object} personalization eventPayload()
 * @returns {boolean} whether it was sent
 */
export function emit(section, event, personalization) {
  if (!hasConsent() && !allowed('data-layer')) return false;
  section.dispatchEvent(new CustomEvent(event, { bubbles: true, detail: personalization }));
  if (config.analytics?.dataLayer !== false) {
    window.adobeDataLayer = window.adobeDataLayer || [];
    window.adobeDataLayer.push({ event, personalization });
  }
  return true;
}

/**
 * Sends a RUM checkpoint. Only with consent, or the `rum` exception.
 * @param {[string, object]|null} checkpoint rumCheckpoint()
 */
export function rum(checkpoint) {
  if (!checkpoint || config.analytics?.rum === false) return;
  if (!hasConsent() && !allowed('rum')) return;
  import('../aem.js')
    .then(({ sampleRUM }) => {
      if (typeof sampleRUM === 'function') sampleRUM(...checkpoint);
    })
    .catch(() => {});
}

/**
 * Decision feedback to the engine (decision-feedback.schema.json), with
 * navigator.sendBeacon. Only with consent; best effort.
 * @param {object} decision
 * @param {'seen'|'clicked'} type
 * @returns {boolean|null} sendBeacon's answer, or null when not sent
 */
export function feedback(decision, type) {
  const url = config.api?.feedback;
  if (!url || !hasConsent() || typeof navigator.sendBeacon !== 'function') return null;
  const event = {
    id: decision.id, decisionId: decision.decisionId, variant: decision.shown, type,
  };
  if (decision.tracking) event.tracking = decision.tracking;
  const body = { version: '1', page: { path: window.location.pathname.slice(0, 256) }, events: [event] };
  try {
    return navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: 'application/json' }));
  } catch (e) {
    return false;
  }
}

// --- Public API ---

// Runtimes (sections.js) that re-decide on state or consent changes.
const runtimes = [];

/**
 * @param {{refresh?: Function, stateChanged?: Function}} runtime
 */
export function register(runtime) {
  runtimes.push(runtime);
}

/**
 * @param {string} key
 * @returns {string|undefined}
 */
export function getState(key) {
  return currentState(hasConsent())[key];
}

/**
 * Sets a state value (quiz answer, app state) and re-decides what depends on
 * it. Kept after the page view (localStorage) only with consent.
 * @param {string} key
 * @param {string|null} value null removes the key
 * @returns {Promise<void>}
 */
export async function setState(key, value) {
  if (value === null || value === undefined) delete pageState[key];
  else pageState[key] = String(value);
  if (hasConsent()) {
    const state = currentState(true);
    if (value === null || value === undefined) delete state[key];
    saveState(storage('localStorage'), state);
    storedState = state;
  }
  document.dispatchEvent(new CustomEvent('personalization:state-changed', { detail: { key, value } }));
  await Promise.all(runtimes.map((runtime) => runtime.stateChanged?.(key)));
}

let refreshing;

/**
 * Re-decides after a consent change or on request. Calls in the same task
 * (the consent tool's hook and the consent.update listener) share one run.
 * @returns {Promise<void>}
 */
export function refresh() {
  refreshing = refreshing || Promise.resolve().then(async () => {
    refreshing = null;
    await Promise.all(runtimes.map((runtime) => runtime.refresh?.()));
  });
  return refreshing;
}

// A site's consent glue may announce consent changes with an event.
window.addEventListener('consent.update', () => refresh());

window.hlx = window.hlx || {};
window.hlx.personalization = {
  setState, getState, refresh, decisions,
};
if (previewHost) {
  // Preview only: stand in for the consent tool (tests, demos).
  window.hlx.personalization.preview = {
    consent: (value) => {
      previewConsent = value === undefined ? undefined : !!value;
      return refresh();
    },
  };
}
