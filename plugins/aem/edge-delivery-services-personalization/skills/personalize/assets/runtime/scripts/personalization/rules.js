/*
 * Personalization rules engine.
 *
 * Shared, unchanged, by the browser runtime (scripts/personalization/) and the
 * edge worker (cdn/cloudflare-worker/src/personalization/), so a placeholder
 * resolves to the same variant wherever it is decided. Pure ES module: no DOM,
 * no network, no storage.
 */

export const RESERVED_KEYS = ['id', 'source', 'default'];
export const CRITERIA = ['geo', 'device', 'visitor', 'param', 'state', 'audience'];
// Criteria only the browser can evaluate. The edge defers a placeholder to the
// client when it reaches one of these before a rule matches.
export const CLIENT_ONLY_CRITERIA = ['device', 'state', 'audience'];
export const SOURCES = ['rules', 'api'];
export const VISITOR_VALUES = ['new', 'returning'];
export const DEFAULT_FRAGMENT_PREFIXES = ['/fragments/'];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const GEO_PATTERN = /^[a-z]{2}(-[a-z0-9]{1,3})?$/i;

const normalize = (value) => String(value ?? '').trim().toLowerCase();
const looksLikeLink = (value) => value.startsWith('/') || /^https?:\/\//i.test(value);

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
 * Builds a placeholder spec from the rows of a Personalization block.
 * Rows are environment-neutral so the DOM runtime, the edge worker and the
 * validator can all produce them.
 * @param {{key: string, value: string, href?: string, inline?: boolean}[]} rows
 *   key = first cell text; value = second cell text; href = set when the second
 *   cell holds a single link and nothing else; inline = second cell holds other content
 * @param {{prefixes?: string[]}} options
 * @returns {object} spec with id, source, rules, default, errors, warnings
 */
export function parseSpec(rows, { prefixes = DEFAULT_FRAGMENT_PREFIXES } = {}) {
  const spec = {
    id: '', source: 'rules', rules: [], default: null, errors: [], warnings: [],
  };
  (rows || []).forEach((row, index) => {
    const label = `row ${index + 1}`;
    const key = String(row.key ?? '').trim();
    const lower = normalize(key);
    const value = String(row.value ?? '').trim();
    if (!key) {
      spec.errors.push(`${label}: first cell is empty`);
      return;
    }
    if (lower === 'id') {
      if (spec.id) spec.errors.push(`${label}: duplicate id row`);
      spec.id = value;
      return;
    }
    if (lower === 'source') {
      if (!SOURCES.includes(normalize(value))) {
        spec.errors.push(`${label}: source must be one of ${SOURCES.join(', ')}, got "${value}"`);
      } else {
        spec.source = normalize(value);
      }
      return;
    }
    if (lower === 'default') {
      if (spec.default) {
        spec.errors.push(`${label}: duplicate default row`);
        return;
      }
      const reference = row.href || (looksLikeLink(value) && !row.inline ? value : '');
      if (reference) {
        const path = toFragmentPath(reference, prefixes);
        if (path) spec.default = { type: 'fragment', path };
        else spec.errors.push(`${label}: default fragment "${reference}" is not under ${prefixes.join(' or ')}`);
      } else if (normalize(value) === 'none' && !row.inline) {
        spec.default = { type: 'none' };
      } else if (row.inline || value) {
        spec.default = { type: 'inline' };
      } else {
        spec.errors.push(`${label}: default is empty (write "none" to render nothing)`);
      }
      return;
    }
    let clauses;
    try {
      clauses = parseCondition(key);
    } catch (e) {
      spec.errors.push(`${label}: ${e.message}`);
      return;
    }
    const path = toFragmentPath(row.href || value, prefixes);
    if (!path) {
      spec.errors.push(`${label}: "${key}" must point to a fragment link under ${prefixes.join(' or ')}`);
      return;
    }
    const variant = variantName(path);
    if (normalize(variant) === 'default') {
      spec.errors.push(`${label}: variant fragment cannot be named "default"`);
      return;
    }
    // The variant name identifies a fragment in ?pzn= overrides, the edge
    // handoff and re-evaluation, so one name cannot stand for two fragments.
    const clash = spec.rules.find((rule) => normalize(rule.variant) === normalize(variant)
      && rule.target.path !== path);
    if (clash) {
      spec.errors.push(`${label}: variant "${variant}" also names ${clash.target.path}; rename one fragment so the last path segments differ`);
      return;
    }
    spec.rules.push({
      condition: key, clauses, target: { type: 'fragment', path }, variant,
    });
  });
  if (!spec.id) spec.errors.push('missing id row');
  else if (!ID_PATTERN.test(spec.id)) spec.errors.push(`id "${spec.id}" must be letters, digits, - or _`);
  if (!spec.default) spec.errors.push('missing default row (every placeholder needs a fallback)');
  if (spec.source === 'api' && !spec.rules.length) {
    spec.warnings.push('source is api but no rules are authored; the API must return fragment paths');
  }
  return spec;
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

function defaultDecision(spec, source, extra = {}) {
  return {
    id: spec.id, variant: 'default', target: spec.default || { type: 'none' }, source, rule: 'default', ...extra,
  };
}

function findVariant(spec, name) {
  if (normalize(name) === 'default') return defaultDecision(spec, 'override');
  const rule = spec.rules.find((candidate) => normalize(candidate.variant) === normalize(name));
  return rule ? {
    id: spec.id, variant: rule.variant, target: rule.target, source: 'override', rule: rule.condition,
  } : null;
}

function fromApi(spec, decision, prefixes) {
  if (!decision || typeof decision !== 'object') return null;
  const tracking = decision.tracking && typeof decision.tracking === 'object' ? decision.tracking : undefined;
  if (typeof decision.variant === 'string' && decision.variant) {
    const match = findVariant(spec, decision.variant);
    if (match) return { ...match, source: 'api', tracking };
  }
  if (typeof decision.fragment === 'string' && decision.fragment) {
    const path = toFragmentPath(decision.fragment, prefixes);
    if (path) {
      return {
        id: spec.id, variant: variantName(path), target: { type: 'fragment', path }, source: 'api', rule: 'api', tracking,
      };
    }
  }
  if (decision.variant === null) return defaultDecision(spec, 'api', { tracking });
  return null;
}

/**
 * Decides which variant a placeholder renders.
 * Order: forced override -> decision API -> authored rules (first match) -> default.
 * @param {object} spec from parseSpec
 * @param {object} context resolved context
 * @param {object} options
 * @param {object} [options.audiences] custom audiences
 * @param {object} [options.apiDecision] this placeholder's decision API entry
 * @param {string} [options.forcedVariant] variant forced via preview override
 * @param {string[]} [options.deferCriteria] criteria the caller cannot evaluate
 * @param {string[]} [options.prefixes] allowed fragment prefixes
 * @returns {Promise<object>} decision, or { id, deferred: true }
 */
export async function decide(spec, context = {}, options = {}) {
  const {
    audiences = {}, apiDecision, forcedVariant, deferCriteria = [],
    prefixes = DEFAULT_FRAGMENT_PREFIXES,
  } = options;
  if (forcedVariant) {
    const forced = findVariant(spec, forcedVariant);
    if (forced) return forced;
  }
  const api = fromApi(spec, apiDecision, prefixes);
  if (api) return api;
  const outcomes = await Promise.all(spec.rules.map((rule) => {
    if (rule.clauses.some((clause) => deferCriteria.includes(clause.criterion))) return 'deferred';
    return evaluate(rule.clauses, context, audiences);
  }));
  const index = outcomes.findIndex((outcome) => outcome === true || outcome === 'deferred');
  if (index === -1) return defaultDecision(spec, 'default');
  if (outcomes[index] === 'deferred') return { id: spec.id, deferred: true };
  const rule = spec.rules[index];
  return {
    id: spec.id, variant: rule.variant, target: rule.target, source: 'rule', rule: rule.condition,
  };
}
