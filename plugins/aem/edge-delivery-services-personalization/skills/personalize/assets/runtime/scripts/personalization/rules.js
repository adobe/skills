/*
 * Personalization conditions: parsing and evaluation.
 *
 * Shared, unchanged, by the browser runtime (scripts/personalization/) and the
 * edge worker (src/personalization/), so a section's rules resolve to the same
 * variant wherever they are decided. Pure ES module: no DOM, no network, no
 * storage.
 */

export const CRITERIA = ['geo', 'device', 'visitor', 'param', 'state', 'audience'];
// Criteria only the browser can evaluate. The edge defers a section to the
// browser when it reaches one of these before a rule matches.
export const CLIENT_ONLY_CRITERIA = ['device', 'state', 'audience'];
// Criteria the `rules` consent exception allows (contract section 3): geo from
// the request, device, URL params and this page view's state. A rule using any
// other criterion (visitor, audience) never runs without consent.
export const NO_CONSENT_CRITERIA = ['geo', 'device', 'param', 'state'];
export const VISITOR_VALUES = ['new', 'returning'];
export const DEFAULT_FRAGMENT_PREFIXES = ['/fragments/'];

const GEO_PATTERN = /^[a-z]{2}(-[a-z0-9]{1,3})?$/i;

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/**
 * Reduces an authored link or API value to a same-origin fragment pathname.
 * Only the pathname is kept, so a value can never point the fetch off-origin.
 * @param {string} raw link href, pathname or URL
 * @param {string[]} prefixes allowed path prefixes
 * @returns {string|null} pathname, or null when not an allowed fragment path
 */
export function toFragmentPath(raw, prefixes = DEFAULT_FRAGMENT_PREFIXES) {
  if (!raw || typeof raw !== 'string') return null;
  let path;
  try {
    path = decodeURI(new URL(raw.trim(), 'https://fragment.invalid').pathname);
  } catch (e) {
    return null;
  }
  path = path.replace(/\.plain\.html$/, '').replace(/\.html$/, '');
  if (!path.startsWith('/') || path.startsWith('//') || path.split('/').includes('..')) return null;
  const allowed = (prefixes && prefixes.length ? prefixes : DEFAULT_FRAGMENT_PREFIXES);
  return allowed.some((prefix) => path.startsWith(prefix)) ? path : null;
}

/**
 * Variant name of a fragment path: its last non-empty segment.
 * @param {string} path fragment pathname
 * @returns {string}
 */
export function variantName(path) {
  const segments = String(path).split('/').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : 'default';
}

function validateValue(criterion, value) {
  if (criterion === 'geo' && !GEO_PATTERN.test(value)) {
    throw new Error(`"${value}" is not a country code (IN) or country-region code (US-CA)`);
  }
  if (criterion === 'visitor' && !VISITOR_VALUES.includes(normalize(value))) {
    throw new Error(`visitor must be one of ${VISITOR_VALUES.join(', ')}, got "${value}"`);
  }
  if ((criterion === 'param' || criterion === 'state') && !value.split('=')[0].trim()) {
    throw new Error(`${criterion} value "${value}" needs a key (key or key=value)`);
  }
}

/**
 * Parses an authored condition such as `geo: US, CA & !visitor: returning`.
 * Values within a clause are OR'ed, clauses joined by `&` are AND'ed, `!` negates.
 * @param {string} text condition cell text
 * @returns {{criterion: string, negate: boolean, values: string[]}[]} clauses
 */
export function parseCondition(text) {
  const parts = String(text ?? '').split('&').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('empty condition');
  return parts.map((part) => {
    let body = part;
    let negate = false;
    if (body.startsWith('!')) {
      negate = true;
      body = body.slice(1).trim();
    }
    const colon = body.indexOf(':');
    if (colon < 1) throw new Error(`"${part}" is not in the form "criterion: value"`);
    const criterion = normalize(body.slice(0, colon));
    if (!CRITERIA.includes(criterion)) {
      throw new Error(`unknown criterion "${criterion}" (known: ${CRITERIA.join(', ')})`);
    }
    const values = body.slice(colon + 1).split(',').map((value) => value.trim()).filter(Boolean);
    if (!values.length) throw new Error(`"${part}" has no values`);
    values.forEach((value) => validateValue(criterion, value));
    return { criterion, negate, values };
  });
}

/**
 * Criteria referenced by a spec.
 * @param {object} spec
 * @returns {Set<string>}
 */
export function criteriaUsed(spec) {
  const used = new Set();
  (spec.rules || []).forEach((rule) => rule.clauses
    .forEach((clause) => used.add(clause.criterion)));
  return used;
}

/**
 * State keys referenced by `state:` clauses of a spec.
 * @param {object} spec
 * @returns {Set<string>}
 */
export function stateKeysUsed(spec) {
  const keys = new Set();
  (spec.rules || []).forEach((rule) => rule.clauses
    .filter((clause) => clause.criterion === 'state')
    .forEach((clause) => clause.values.forEach((value) => keys.add(value.split('=')[0].trim()))));
  return keys;
}

function matchKeyValue(bag, value) {
  const [rawKey, ...rest] = value.split('=');
  const key = rawKey.trim();
  if (!bag || bag[key] === undefined || bag[key] === null) return false;
  if (!rest.length) return true;
  return normalize(bag[key]) === normalize(rest.join('='));
}

async function matchAudience(name, context, audiences) {
  const audience = audiences ? audiences[name] : undefined;
  if (typeof audience === 'function') {
    try {
      return !!(await audience(context));
    } catch (e) {
      return false;
    }
  }
  return audience === true;
}

async function matchValue(criterion, value, context, audiences) {
  switch (criterion) {
    case 'geo': {
      const country = normalize(context.geo?.country);
      if (!country) return false;
      const [wantCountry, wantRegion] = normalize(value).split('-');
      return wantCountry === country
        && (!wantRegion || wantRegion === normalize(context.geo?.region));
    }
    case 'device':
      return normalize(value) === normalize(context.device);
    case 'visitor':
      return normalize(value) === normalize(context.visitor);
    case 'param':
      return matchKeyValue(context.params, value);
    case 'state':
      return matchKeyValue(context.state, value);
    case 'audience':
      return matchAudience(value.trim(), context, audiences);
    default:
      return false;
  }
}

async function matchClause(clause, context, audiences) {
  const results = await Promise.all(
    clause.values.map((value) => matchValue(clause.criterion, value, context, audiences)),
  );
  const matched = results.some(Boolean);
  return clause.negate ? !matched : matched;
}

/**
 * Evaluates a parsed condition against a context.
 * @param {object[]} clauses from parseCondition
 * @param {object} context { geo, device, visitor, params, state }
 * @param {object} audiences name -> boolean | (context) => boolean|Promise<boolean>
 * @returns {Promise<boolean>}
 */
export async function evaluate(clauses, context = {}, audiences = {}) {
  const results = await Promise.all(clauses
    .map((clause) => matchClause(clause, context, audiences)));
  return results.every(Boolean);
}
