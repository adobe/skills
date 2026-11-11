/*
 * Visitor context (contract section 2) and what the runtime keeps on the
 * device. Functions take their browser dependencies as arguments so they can
 * be unit tested in Node and reused by the edge worker. Nothing here sends
 * data anywhere.
 */

export const COOKIE_SEEN = 'pzn-seen';
export const COOKIE_SESSION = 'pzn-vs';
export const COOKIE_CONSENT = 'pzn-consent';
export const COOKIE_GEO = 'pzn-geo';
export const COOKIE_SPLIT = 'pzn-split';
export const STATE_STORAGE_KEY = 'pzn-state';
export const SPLIT_STORAGE_PREFIX = 'pzn-split:';
// Target's visitor id (sources/target.js), stored only with consent.
export const TNT_ID_STORAGE_KEY = 'pzn-tnt-id';
// Cookies the runtime writes (pzn-geo is the CDN's, never written here).
export const OWN_COOKIES = [COOKIE_CONSENT, COOKIE_SEEN, COOKIE_SESSION, COOKIE_SPLIT];

const BOT_PATTERN = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|lighthouse|headlesschrome|pagespeed|chrome-lighthouse|gtmetrix/i;
const PREVIEW_HOST = /(\.aem\.page|\.hlx\.page)$|^localhost$|^127\.0\.0\.1$/;

/**
 * @param {string} cookieString document.cookie
 * @returns {object} name -> value
 */
export function parseCookies(cookieString) {
  return Object.fromEntries(String(cookieString || '').split(';')
    .map((pair) => pair.trim()).filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=');
      const name = index === -1 ? pair : pair.slice(0, index);
      const value = index === -1 ? '' : pair.slice(index + 1);
      try {
        return [name, decodeURIComponent(value)];
      } catch (e) {
        return [name, value];
      }
    }));
}

/**
 * Parses `IN` or `US-CA` into { country, region }.
 * @param {string} value
 * @returns {{country: string, region?: string}|null}
 */
export function parseGeo(value) {
  const match = /^([a-z]{2})(?:-([a-z0-9]{1,3}))?$/i.exec(String(value || '').trim());
  if (!match) return null;
  return match[2]
    ? { country: match[1].toUpperCase(), region: match[2].toUpperCase() }
    : { country: match[1].toUpperCase() };
}

/**
 * Geo already known to the page: the edge's meta tag (from the request), else
 * the pzn-geo cookie a CDN sets. The cookie is read only with consent: the
 * `rules` exception allows geo from the request only. Never guessed from
 * time zone or language.
 * @param {Document} doc
 * @param {object} cookies
 * @param {{cookie?: boolean}} [options] cookie: the pzn-geo cookie may be read
 * @returns {object|null}
 */
export function readGeo(doc, cookies, { cookie = true } = {}) {
  const meta = doc.querySelector('meta[name="pzn-geo"]');
  return parseGeo(meta?.content) || (cookie ? parseGeo(cookies[COOKIE_GEO]) : null);
}

/**
 * Device class from viewport media queries (not the user agent).
 * @param {object} devices name -> media query, in priority order
 * @param {(query: string) => {matches: boolean}} matchMedia
 * @returns {string|undefined}
 */
export function getDevice(devices, matchMedia) {
  return Object.keys(devices || {}).find((name) => matchMedia(devices[name]).matches);
}

/**
 * New or returning visitor, stable for the whole session so the edge and the
 * browser agree. It reads and stores cookies, so it needs consent, with no
 * exception: without consent the visitor is unknown.
 * @param {object} cookies
 * @param {boolean} consent
 * @param {(cookie: string) => void} [writeCookie]
 * @returns {'new'|'returning'|undefined}
 */
export function getVisitor(cookies, consent, writeCookie) {
  if (!consent) return undefined;
  const session = cookies[COOKIE_SESSION];
  let visitor = cookies[COOKIE_SEEN] ? 'returning' : 'new';
  if (session === 'new' || session === 'returning') visitor = session;
  if (writeCookie) {
    writeCookie(`${COOKIE_SEEN}=1; path=/; max-age=31536000; SameSite=Lax; Secure`);
    if (!session) writeCookie(`${COOKIE_SESSION}=${visitor}; path=/; SameSite=Lax; Secure`);
  }
  return visitor;
}

/**
 * Deletes everything the runtime stored: its cookies, persisted state, the
 * Target visitor id, cached engine answers, split assignments and Target
 * session data. Called when consent is withdrawn.
 * @param {(cookie: string) => void} writeCookie
 * @param {Storage} [local] localStorage
 * @param {Storage} [session] sessionStorage
 */
export function clearStored(writeCookie, local, session) {
  OWN_COOKIES.forEach((name) => writeCookie(`${name}=; path=/; max-age=0; SameSite=Lax; Secure`));
  try {
    local?.removeItem(STATE_STORAGE_KEY);
    local?.removeItem(TNT_ID_STORAGE_KEY);
    Object.keys(session || {}).filter((key) => key.startsWith('pzn-'))
      .forEach((key) => session.removeItem(key));
  } catch (e) {
    // storage blocked: nothing was stored
  }
}

/**
 * Mirrors the CMP's answer into the pzn-consent cookie the edge reads. It
 * holds only the choice and is written only once consent is given; when
 * consent is no longer given, everything stored with it is deleted.
 * @param {boolean} consent
 * @param {object} cookies
 * @param {(cookie: string) => void} writeCookie
 * @param {Storage} [local]
 * @param {Storage} [session]
 * @returns {boolean} true when stored data was deleted
 */
export function syncConsentCookie(consent, cookies, writeCookie, local, session) {
  if (consent && cookies[COOKIE_CONSENT] !== '1') {
    writeCookie(`${COOKIE_CONSENT}=1; path=/; max-age=31536000; SameSite=Lax; Secure`);
  } else if (!consent && cookies[COOKIE_CONSENT]) {
    clearStored(writeCookie, local, session);
    return true;
  }
  return false;
}

/**
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isBot(userAgent) {
  return BOT_PATTERN.test(String(userAgent || ''));
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {object} name -> value (first value wins), pzn-* overrides excluded
 */
export function readParams(searchParams) {
  const params = {};
  searchParams.forEach((value, key) => {
    if (!key.startsWith('pzn') && !(key in params)) params[key] = value;
  });
  return params;
}

/**
 * Whether preview overrides (?pzn=, ?pzn-geo=, ...) are honored on this host.
 * @param {'preview'|'always'|'never'} setting
 * @param {string} hostname
 * @returns {boolean}
 */
export function overridesEnabled(setting, hostname) {
  if (setting === 'always') return true;
  if (setting === 'never') return false;
  return PREVIEW_HOST.test(hostname);
}

const splitList = (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean);

function splitPair(pair) {
  const index = pair.indexOf(':');
  return index < 1 ? null : [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
}

/**
 * Reads preview overrides from the URL.
 * ?pzn=id:variant,id2:variant   force variants
 * ?pzn-geo=IN | US-CA           fake geo
 * ?pzn-device=mobile            fake device
 * ?pzn-visitor=returning        fake visitor
 * ?pzn-state=key:value,...      fake state
 * ?pzn-audience=name,...        force custom audiences to match
 * ?pzn-consent=1 | 0            fake the CMP's answer (tests of consent-gated paths)
 * ?pzn-debug                    log decisions (preview hosts only); decisions are unchanged
 * @param {URLSearchParams} searchParams
 * @returns {object}
 */
export function readOverrides(searchParams) {
  const forced = {};
  splitList(searchParams.get('pzn')).forEach((pair) => {
    const parsed = splitPair(pair);
    if (parsed) [, forced[parsed[0]]] = parsed;
  });
  const state = {};
  splitList(searchParams.get('pzn-state')).forEach((pair) => {
    const parsed = splitPair(pair);
    if (parsed) [, state[parsed[0]]] = parsed;
  });
  const context = {};
  const geo = parseGeo(searchParams.get('pzn-geo'));
  if (geo) context.geo = geo;
  if (searchParams.get('pzn-device')) context.device = searchParams.get('pzn-device');
  if (searchParams.get('pzn-visitor')) context.visitor = searchParams.get('pzn-visitor');
  if (Object.keys(state).length) context.state = state;
  const audiences = splitList(searchParams.get('pzn-audience'));
  const consent = searchParams.has('pzn-consent') ? searchParams.get('pzn-consent') !== '0' : undefined;
  const any = [...searchParams.keys()]
    .some((key) => (key === 'pzn' || key.startsWith('pzn-')) && key !== 'pzn-debug');
  return {
    any, forced, context, audiences, consent, debug: searchParams.has('pzn-debug'),
  };
}

/**
 * Persisted state (quiz answers, app state). Only read and written with consent.
 * @param {Storage|undefined} storage localStorage
 * @returns {object}
 */
export function loadState(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STATE_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (e) {
    return {};
  }
}

/**
 * @param {Storage|undefined} storage
 * @param {object} state
 */
export function saveState(storage, state) {
  try {
    storage?.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // storage full or blocked: state stays in memory for this page
  }
}
