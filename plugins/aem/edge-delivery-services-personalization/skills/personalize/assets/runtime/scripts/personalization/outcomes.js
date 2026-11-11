/*
 * The decision model (contract sections 4, 8 and 9): how a source's answer
 * becomes an outcome, what a decision's identity is, which application
 * result it gets, what the measurement events and the RUM checkpoint carry,
 * and how a decision travels from the edge to the browser in data-pzn-*
 * attributes. Shared, unchanged, by the browser runtime, the edge worker and
 * the skill's scripts. Pure ES module.
 *
 * A decision:
 *   { id, decisionId, source, where, outcome, variant, path?, reason?,
 *     assigned?, tracking?, test?, cached?, tokens?, trigger, ms? }
 * `variant` is what the decision shows (a listed name or 'default'); after
 * application the runtime adds `shown` and `result`.
 */

import { listedVariant } from './section-spec.js';

export const OUTCOMES = ['variant', 'control', 'intentional-default', 'no-match', 'low-confidence',
  'no-consent', 'fallback', 'timeout', 'error', 'invalid', 'bot', 'override'];
// The source chose: assigned is set (a name, or 'default' for control and
// intentional-default).
export const ASSIGNING = ['variant', 'control', 'intentional-default', 'override'];
// Nothing was assigned, whatever is shown.
export const UNASSIGNED = ['no-consent', 'bot', 'timeout', 'error', 'invalid'];
// The engine gave no usable answer: an api section's Rule rows decide.
export const RULE_FALLBACK = ['no-match', 'low-confidence', 'fallback'];
// Engine reason codes with their own outcome; any other code is no-match.
export const REASON_OUTCOMES = {
  low_confidence: 'low-confidence', provider_error: 'fallback', invalid_choice: 'fallback',
};
export const TRACKING_MAX_BYTES = 1024;

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const pick = (variant) => (variant && variant.path ? { variant: variant.name, path: variant.path } : { variant: 'default' });

/**
 * What the deciding source assigned, from the outcome and the variant shown
 * by the decision: absent when nothing was assigned (contract section 9).
 * @param {string} outcome
 * @param {string} variant
 * @returns {string|undefined}
 */
export function assignedFor(outcome, variant) {
  if (outcome === 'control' || outcome === 'intentional-default') return 'default';
  if (outcome === 'variant' || outcome === 'override') return variant;
  if (RULE_FALLBACK.includes(outcome) && variant && variant !== 'default') return variant;
  return undefined;
}

/**
 * Maps one engine answer (a parseResponse decision, or undefined when the
 * section is missing from `decisions`) to an outcome. Only listed variants
 * count.
 * @param {object} spec
 * @param {object|undefined} answer
 * @param {string[]} [prefixes]
 * @returns {{outcome: string, variant: string, path?: string, reason?: string, tracking?: object}}
 */
export function engineOutcome(spec, answer, prefixes) {
  if (!answer) return { outcome: 'no-match', variant: 'default', reason: 'no decision' };
  const tracking = isObject(answer.tracking) ? { tracking: answer.tracking } : {};
  if (answer.invalid) {
    return {
      outcome: 'fallback', variant: 'default', reason: `not listed: ${answer.invalid}`, ...tracking,
    };
  }
  if (answer.reason) {
    return {
      outcome: REASON_OUTCOMES[answer.reason] || 'no-match', variant: 'default', reason: answer.reason, ...tracking,
    };
  }
  // An answer from the engine's own cache says so in its tracking.
  const cached = answer.tracking?.cached === true ? { cached: true } : {};
  if (answer.control === true) {
    return {
      outcome: 'control', variant: 'default', ...tracking, ...cached,
    };
  }
  if (answer.variant === 'default') {
    return {
      outcome: 'intentional-default', variant: 'default', ...tracking, ...cached,
    };
  }
  const listed = listedVariant(spec, answer, prefixes);
  if (!listed || !listed.path) {
    return {
      outcome: 'fallback', variant: 'default', reason: `not listed: ${answer.variant ?? answer.fragment}`, ...tracking,
    };
  }
  return {
    outcome: 'variant', ...pick(listed), ...tracking, ...cached,
  };
}

/**
 * Maps one Target answer (sources/target*.js) to an outcome. A JSON offer
 * names a listed variant, { control: true } is the control experience,
 * nothing returned is no-match.
 * @param {object} spec
 * @param {object|undefined} answer { fragment, tracking, tokens } | { control, tracking,
 *   tokens } | { invalid, tracking } | undefined
 * @param {string[]} [prefixes]
 * @returns {object} outcome fields, with tokens (notification tokens) when Target answered
 */
export function targetOutcome(spec, answer, prefixes) {
  if (!answer) return { outcome: 'no-match', variant: 'default', reason: 'no offer' };
  const extra = {
    ...(isObject(answer.tracking) ? { tracking: answer.tracking } : {}),
    ...(answer.tokens ? { tokens: answer.tokens } : {}),
  };
  if (answer.invalid) {
    return {
      outcome: 'fallback', variant: 'default', reason: answer.invalid, ...extra,
    };
  }
  if (answer.control === true) return { outcome: 'control', variant: 'default', ...extra };
  const listed = listedVariant(spec, { fragment: answer.fragment }, prefixes);
  if (!listed || !listed.path) {
    return {
      outcome: 'fallback', variant: 'default', reason: `not listed: ${answer.fragment}`, ...extra,
    };
  }
  return { outcome: 'variant', ...pick(listed), ...extra };
}

/**
 * The outcome of a split assignment: a variant arm, or the control arm.
 * @param {object} spec
 * @param {string} arm variant name or 'default'
 * @returns {object}
 */
export function splitOutcome(spec, arm) {
  const test = { type: 'split', weights: spec.split || 'even' };
  if (arm === 'default') return { outcome: 'control', variant: 'default', test };
  return { outcome: 'variant', ...pick(spec.variants.find((variant) => variant.name === arm)), test };
}

/**
 * The outcome of a rules section from ruleOutcome().
 * @param {object} ruled { variant, rule } | { none }
 * @returns {object}
 */
export function rulesOutcome(ruled) {
  return ruled.variant
    ? { outcome: 'variant', ...pick(ruled.variant), rule: ruled.rule }
    : { outcome: 'no-match', variant: 'default' };
}

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) {
    return Object.keys(value).sort()
      .reduce((acc, key) => ({ ...acc, [key]: stable(value[key]) }), {});
  }
  return value;
};

/**
 * A decision's identity: two evaluations are the same decision only when
 * source, assigned, outcome, reason, cached, tracking, test and the Target
 * notification tokens are all equal (and they show the same variant).
 * @param {object} decision
 * @returns {string}
 */
export function identity(decision) {
  const {
    source, assigned, outcome, reason, cached, tracking, test, tokens, variant,
  } = decision;
  return JSON.stringify(stable({
    source, assigned, outcome, reason, cached: !!cached, tracking, test, tokens, variant,
  }));
}

/**
 * Completes a decision: decisionId, assigned.
 * @param {object} fields
 * @returns {object}
 */
export function makeDecision(fields) {
  const decision = { ...fields };
  const assigned = assignedFor(decision.outcome, decision.variant);
  if (assigned === undefined) delete decision.assigned;
  else decision.assigned = assigned;
  if (!decision.reason) delete decision.reason;
  if (!decision.cached) delete decision.cached;
  Object.keys(decision).forEach((key) => {
    if (decision[key] === undefined) delete decision[key];
  });
  return decision;
}

/**
 * The application result (contract section 9): applied, kept-default,
 * unchanged (a new decision showing what is already shown) or failed (the
 * assigned variant could not be shown).
 * @param {object} decision
 * @param {string} shown what the page now shows
 * @param {string|null} before what it showed before this decision (null: first)
 * @returns {string}
 */
export function resultFor(decision, shown, before) {
  if (shown === 'default' && decision.variant !== 'default' && decision.assigned
    && decision.assigned !== 'default') return 'failed';
  if (before !== null && before === shown) return 'unchanged';
  return shown === 'default' ? 'kept-default' : 'applied';
}

/**
 * The `personalization` object of a measurement event
 * (measurement-event.schema.json).
 * @param {'pzn:decided'|'pzn:applied'|'pzn:seen'|'pzn:clicked'|'pzn:notified'} event
 * @param {object} decision applied decision (shown and result set, except for decided)
 * @param {object} [extra] { href } for clicked, { notification } for notified
 * @returns {object}
 */
export function eventPayload(event, decision, extra = {}) {
  const decided = event === 'pzn:decided';
  const p = {
    id: decision.id,
    decisionId: decision.decisionId,
    variant: decided ? decision.variant : (decision.shown ?? decision.variant),
  };
  if (decision.assigned !== undefined) p.assigned = decision.assigned;
  Object.assign(p, { source: decision.source, where: decision.where, outcome: decision.outcome });
  if (decision.reason) p.reason = String(decision.reason).slice(0, 256);
  if (event === 'pzn:notified') return { ...p, notification: extra.notification };
  if (decided) {
    p.trigger = decision.trigger || 'initial';
    if (Number.isFinite(decision.ms)) p.ms = Math.max(0, Math.round(decision.ms));
    if (decision.cached) p.cached = true;
    if (decision.tracking) p.tracking = decision.tracking;
  } else {
    p.result = decision.result;
    if (event === 'pzn:applied' && Number.isFinite(decision.appliedMs)) p.ms = Math.max(0, Math.round(decision.appliedMs));
    if (event === 'pzn:seen' && decision.tracking) p.tracking = decision.tracking;
    if (event === 'pzn:clicked') p.href = extra.href;
  }
  if (decision.test) p.test = decision.test;
  return p;
}

/**
 * The RUM checkpoint for an applied decision, or null. Only successfully
 * applied arms: `experiment` for split sections (variant or control),
 * `audience` for other sections (variant or intentional-default). It marks
 * application, not exposure.
 * @param {object} spec
 * @param {object} decision applied decision
 * @returns {[string, {source: string, target: string}]|null}
 */
export function rumCheckpoint(spec, decision) {
  const { outcome, result, assigned } = decision;
  const shownOk = outcome === 'variant' && ['applied', 'unchanged'].includes(result);
  const keptOk = ['control', 'intentional-default'].includes(outcome) && ['kept-default', 'unchanged'].includes(result);
  if (!shownOk && !keptOk) return null;
  const data = { source: decision.id, target: assigned };
  if (spec.source === 'split') return ['variant', 'control'].includes(outcome) ? ['experiment', data] : null;
  return ['variant', 'intentional-default'].includes(outcome) ? ['audience', data] : null;
}

/**
 * Engine tracking as the edge writes it into data-pzn-tracking: JSON of at
 * most 1 KB, else left out.
 * @param {object|undefined} tracking
 * @returns {string|null}
 */
export function trackingAttribute(tracking) {
  if (!isObject(tracking)) return null;
  const json = JSON.stringify(tracking);
  return new TextEncoder().encode(json).length <= TRACKING_MAX_BYTES ? json : null;
}

/**
 * data-pzn-* attributes of a decided section (names without `data-`).
 * @param {object} decision
 * @param {'applied'|'selected'} status
 * @param {{tracking?: boolean}} [options] tracking: write data-pzn-tracking (edge)
 * @returns {object} attribute name -> value
 */
export function decisionAttributes(decision, status, { tracking = false } = {}) {
  const attributes = {
    'pzn-where': decision.where,
    'pzn-status': status,
    'pzn-variant': decision.variant,
    'pzn-source': decision.source,
    'pzn-outcome': decision.outcome,
    'pzn-decision': decision.decisionId,
  };
  if (decision.reason) attributes['pzn-reason'] = String(decision.reason).slice(0, 256);
  if (decision.cached) attributes['pzn-cached'] = 'true';
  if (decision.path) attributes['pzn-fragment'] = decision.path;
  const json = tracking ? trackingAttribute(decision.tracking) : null;
  if (json) attributes['pzn-tracking'] = json;
  return attributes;
}

/**
 * Reads an edge decision back from a section's data-pzn-* attributes.
 * @param {object} spec
 * @param {(name: string) => string|null} get attribute reader (name without data-)
 * @returns {object|null} decision and status, or null when the section is not edge-marked
 */
export function decisionFromAttributes(spec, get) {
  if (get('pzn-where') !== 'edge') return null;
  const status = get('pzn-status');
  if (!['applied', 'selected'].includes(status)) return null;
  const variantName = get('pzn-variant') || 'default';
  const listed = variantName === 'default' ? null : spec.variants.find((variant) => variant.name === variantName);
  const outcome = OUTCOMES.includes(get('pzn-outcome')) ? get('pzn-outcome') : 'variant';
  let tracking;
  try {
    const parsed = JSON.parse(get('pzn-tracking') || 'null');
    if (isObject(parsed)) tracking = parsed;
  } catch (e) {
    tracking = undefined;
  }
  const decisionId = /^[a-z0-9][a-z0-9_-]*#[1-9][0-9]*$/.test(get('pzn-decision') || '')
    ? get('pzn-decision') : `${spec.id}#1`;
  const source = ['rules', 'split', 'api', 'target', 'override', 'bot'].includes(get('pzn-source'))
    ? get('pzn-source') : spec.source;
  const decision = makeDecision({
    id: spec.id,
    decisionId,
    source,
    where: 'edge',
    outcome,
    ...(listed ? { variant: listed.name, path: listed.path } : { variant: 'default' }),
    reason: get('pzn-reason') || undefined,
    cached: get('pzn-cached') === 'true',
    tracking,
    test: spec.source === 'split' && ['variant', 'control'].includes(outcome)
      ? { type: 'split', weights: spec.split || 'even' } : undefined,
    trigger: 'initial',
  });
  // An edge variant that is not listed here never shows.
  return { decision, status, unlisted: variantName !== 'default' && !listed };
}
