/*
 * Section personalization grammar (contract section 1, section.schema.json).
 *
 * Authors personalize a section with Section Metadata rows; the pipeline turns
 * them into data-personalization* attributes on the section, in authoring
 * order. This module reads those attributes into a spec, and evaluates Rule
 * rows and split draws. Shared, unchanged, by the browser runtime, the edge
 * worker and the skill's scripts. Pure ES module: no DOM, no network, no storage.
 *
 * | Section Metadata                      |                                        |
 * | Personalization                       | home-hero (id, unique on the page)     |
 * | Personalization Source                | rules (default) | split | api | target |
 * | Personalization Variants              | fragment links (the allowlist)         |
 * | Personalization Rule <Variant>        | geo: IN  (rules; api fallback)         |
 * | Personalization Split                 | 40, 30   (split)                       |
 * | Personalization Hint                  | plain words, <= 500 chars (api)        |
 * | Personalization Description <Variant> | <= 600 chars; Default too (api)        |
 * | Personalization Location              | existing Target mbox (target)          |
 * | Personalization Trigger               | scroll: 60% | view | load (target)     |
 * | Personalization Display               | inline | popup (target)                |
 */

import {
  parseCondition, evaluate, toFragmentPath, variantName, DEFAULT_FRAGMENT_PREFIXES,
  NO_CONSENT_CRITERIA,
} from './rules.js';

export const ATTRIBUTE = 'data-personalization';
export const SOURCES = ['rules', 'split', 'api', 'target'];
export const DISPLAYS = ['inline', 'popup'];
export const DEFAULT_TRIGGER = { type: 'scroll', ratio: 0.7 };
// aem-experimentation section metadata (Experiment, Campaign, Audience: <name>).
export const EXPERIMENTATION_ATTRIBUTE = /^data-(experiment|campaign|audience)\b/;
// aem-experimentation page metadata: a page experiment, campaign or audience
// variant. Such a page gets no personalized sections.
export const EXPERIMENTATION_META = /^(experiment|campaign|campaign-.+|audience-.+)$/i;
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const LIMITS = {
  id: 64, variants: 20, rules: 50, condition: 512, hint: 500, description: 600, location: 250,
};

const LOCATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const PATH_CHARS = /^[A-Za-z0-9/_-]+$/;
const ROWS = ['', 'source', 'variants', 'split', 'hint', 'location', 'trigger', 'display'];
const ONLY = {
  split: 'split', hint: 'api', location: 'target', trigger: 'target', display: 'target',
};

/**
 * Comparable form of a variant name or rule key: lowercase, every run of
 * other characters a single dash. The pipeline keeps `_` in keys while older
 * aem.js turns it into `-`, so both compare equal.
 * @param {string} value
 * @returns {string}
 */
export function slug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The pipeline splits Section Metadata text on commas and joins it back with
 * "," (no space). Restores the space for prose rows (Hint, Description),
 * leaving numbers such as 1,000 alone.
 * @param {string} value
 * @returns {string}
 */
export function proseValue(value) {
  return String(value ?? '').replace(/(?<!\d),|,(?!\d)/g, ', ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} value `scroll: 70%`, `view` or `load`
 * @returns {{type: string, ratio?: number}|null} null when not a trigger
 */
export function parseTrigger(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'view' || text === 'load') return { type: text };
  const match = /^scroll\s*:?\s*(\d{1,3})\s*%?$/.exec(text);
  if (!match || Number(match[1]) > 100) return null;
  return { type: 'scroll', ratio: Number(match[1]) / 100 };
}

/**
 * @param {string} value `40, 30`
 * @returns {number[]|null} percentages, or null when one is not a number 0-100
 */
export function parseSplit(value) {
  const parts = String(value ?? '').split(',').map((part) => part.trim().replace(/%$/, '')).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.length && numbers.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
    ? numbers : null;
}

/**
 * The arms of a split section in draw order: the variants in Variants order,
 * then the default (the control). Weights are the Split row's percentages,
 * the default getting the rest; an even split without a Split row.
 * @param {object} spec
 * @returns {{name: string, weight: number}[]}
 */
export function splitArms(spec) {
  const names = [...spec.variants.map((variant) => variant.name), 'default'];
  if (!spec.split || !spec.split.length) return names.map((name) => ({ name, weight: 1 }));
  const own = spec.variants.map((variant, index) => spec.split[index] || 0);
  const rest = Math.max(0, 100 - own.reduce((sum, weight) => sum + weight, 0));
  return names.map((name, index) => ({ name, weight: index < own.length ? own[index] : rest }));
}

/**
 * Draws an arm. The number is the visitor's draw in [0, 1): tests pass fixed
 * numbers to check every boundary. For `40, 30`: [0, 0.4) first variant,
 * [0.4, 0.7) second, [0.7, 1) the default.
 * @param {object} spec
 * @param {number} number
 * @returns {string} variant name or 'default'
 */
export function drawSplit(spec, number) {
  const arms = splitArms(spec);
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  if (!total) return 'default';
  let cumulative = 0;
  const arm = arms.find(({ weight }) => {
    cumulative += weight;
    return weight > 0 && number < cumulative / total;
  });
  return (arm || arms.filter(({ weight }) => weight > 0).pop() || { name: 'default' }).name;
}

/**
 * The arm a visitor keeps: an earlier assignment that is still an arm, else a
 * new draw (a removed variant is drawn again).
 * @param {object} spec
 * @param {string|undefined} stored
 * @param {number} number draw in [0, 1)
 * @returns {string}
 */
export function assignSplit(spec, stored, number) {
  const names = [...spec.variants.map((variant) => variant.name), 'default'];
  const kept = stored && names.find((name) => name === slug(stored));
  return kept || drawSplit(spec, number);
}

/**
 * The variant a rule or description key names: an exact match, else (rules
 * only) the key without a trailing number (`india-2` -> `india`).
 * @param {string} suffix key after data-personalization-rule-
 * @param {{name: string}[]} variants
 * @param {boolean} [numbered]
 * @returns {object|undefined}
 */
export function ruleVariant(suffix, variants, numbered = true) {
  const key = slug(suffix);
  return variants.find((variant) => slug(variant.name) === key)
    || (numbered ? variants.find((variant) => slug(variant.name) === key.replace(/-\d+$/, '')) : undefined);
}

function readVariants(spec, raw, prefixes) {
  const items = String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  items.forEach((item) => {
    const path = toFragmentPath(item, prefixes);
    if (!path || !PATH_CHARS.test(path)) {
      spec.errors.push(`"Personalization Variants" holds only fragment links under ${prefixes.join(' or ')} (letters, digits, /, _ and -); "${item}" is not one (write conditions in "Personalization Rule <Variant>" rows)`);
      return;
    }
    const name = variantName(path);
    if (name.toLowerCase() === 'default') {
      spec.errors.push(`variant ${path} cannot be named "default": the authored content is the default`);
      return;
    }
    if (!NAME_PATTERN.test(name)) {
      spec.errors.push(`variant name "${name}" (${path}) must be lowercase letters, digits, - or _: rename the fragment`);
      return;
    }
    const clash = spec.variants.find((variant) => variant.name === name);
    if (clash) {
      spec.errors.push(clash.path === path
        ? `variant ${path} is listed twice`
        : `variants ${clash.path} and ${path} share the name "${name}"; rename one fragment`);
      return;
    }
    spec.variants.push({ name, path });
  });
  if (spec.variants.length > LIMITS.variants) spec.errors.push(`at most ${LIMITS.variants} variants per section, got ${spec.variants.length}`);
}

/**
 * Reads a section's attributes into a spec.
 * @param {[string, string][]|object} attributes name -> value, in document order
 * @param {object} [options]
 * @param {string[]} [options.prefixes] allowed fragment prefixes
 * @returns {{id: string, source: string, variants: {name: string, path: string}[],
 *   rules: {variant: string, condition: string, clauses: object[], key: string}[],
 *   split: number[]|null, hint: string|null, descriptions: object, location: string|null,
 *   trigger: object|null, display: string, held: boolean, authored: object,
 *   errors: string[], warnings: string[]}}
 */
export function parseSection(attributes, { prefixes = DEFAULT_FRAGMENT_PREFIXES } = {}) {
  const entries = Array.isArray(attributes) ? attributes : Object.entries(attributes || {});
  const spec = {
    id: '',
    source: 'rules',
    variants: [],
    rules: [],
    split: null,
    hint: null,
    descriptions: {},
    location: null,
    trigger: null,
    display: 'inline',
    held: true,
    authored: {},
    errors: [],
    warnings: [],
  };
  const raw = {};
  const ruleRows = [];
  const descriptionRows = [];
  entries.forEach(([name, value]) => {
    const attribute = String(name).toLowerCase();
    if (EXPERIMENTATION_ATTRIBUTE.test(attribute)) {
      spec.errors.push(`also carries AEM Experimentation metadata (${attribute.slice(5)}); one personalization per section, no experiment on it`);
      return;
    }
    if (attribute !== ATTRIBUTE && !attribute.startsWith(`${ATTRIBUTE}-`)) return;
    const key = attribute.slice(ATTRIBUTE.length + 1);
    const text = String(value ?? '');
    if (key === 'rule' || key.startsWith('rule-')) ruleRows.push([key.slice(5), text]);
    else if (key === 'description' || key.startsWith('description-')) descriptionRows.push([key.slice(12), text]);
    else if (ROWS.includes(key)) raw[key] = text.trim();
    else spec.warnings.push(`unknown row "Personalization ${key.replace(/-/g, ' ')}" is ignored`);
  });
  spec.authored = { ...raw };

  spec.id = raw[''] || '';
  if (!NAME_PATTERN.test(spec.id) || spec.id.length > LIMITS.id) {
    spec.errors.push(`id "${spec.id}" must be lowercase letters, digits, - or _ (at most ${LIMITS.id}), row "Personalization"`);
  }
  const source = (raw.source || 'rules').toLowerCase();
  if (SOURCES.includes(source)) spec.source = source;
  else spec.errors.push(`"Personalization Source" must be one of ${SOURCES.join(', ')}, got "${raw.source}"`);

  readVariants(spec, raw.variants, prefixes);
  if (!spec.variants.length && !spec.errors.some((error) => error.includes('Variants'))) {
    spec.errors.push(`a section needs "Personalization Variants": fragment links under ${prefixes.join(' or ')} (the allowlist)`);
  }

  // Rows that belong to one source only.
  Object.entries(ONLY).forEach(([key, only]) => {
    if (raw[key] !== undefined && spec.source !== only) {
      spec.errors.push(`"Personalization ${key[0].toUpperCase()}${key.slice(1)}" is for ${only} sections only`);
    }
  });
  if (descriptionRows.length && spec.source !== 'api') spec.errors.push('"Personalization Description" rows are for api sections only');
  if (ruleRows.length && ['split', 'target'].includes(spec.source)) {
    spec.errors.push(`a ${spec.source} section has no Rule rows (${spec.source === 'split' ? 'the split decides' : 'Target decides'})`);
  }

  if (['rules', 'api'].includes(spec.source)) {
    ruleRows.forEach(([suffix, condition]) => {
      const label = suffix ? `"Personalization Rule ${suffix.replace(/-/g, ' ')}"` : '"Personalization Rule"';
      const variant = suffix ? ruleVariant(suffix, spec.variants) : undefined;
      if (!variant) {
        spec.errors.push(`${label} names no variant in "Personalization Variants"${suffix ? '' : ' (add the variant name after "Rule")'}`);
        return;
      }
      if (condition.trim().length > LIMITS.condition) {
        spec.errors.push(`${label} is longer than ${LIMITS.condition} characters`);
        return;
      }
      try {
        spec.rules.push({
          variant: variant.name,
          condition: condition.trim(),
          clauses: parseCondition(condition),
          key: suffix,
        });
      } catch (e) {
        spec.errors.push(`${label}: ${e.message}`);
      }
    });
    if (spec.rules.length > LIMITS.rules) spec.errors.push(`at most ${LIMITS.rules} Rule rows per section`);
  }
  if (spec.source === 'rules' && !ruleRows.length) {
    spec.errors.push('a rules section needs at least one "Personalization Rule <Variant>" row');
  }
  if (spec.source === 'rules') {
    spec.variants.filter((variant) => !spec.rules.some((rule) => rule.variant === variant.name))
      .forEach((variant) => spec.warnings.push(`variant "${variant.name}" has no rule: only ?pzn= previews show it`));
  }

  if (spec.source === 'split' && raw.split !== undefined) {
    spec.split = parseSplit(raw.split);
    if (!spec.split) spec.errors.push(`"Personalization Split" must be percentages from 0 to 100 such as "40, 30", got "${raw.split}"`);
    else {
      const total = spec.split.reduce((sum, weight) => sum + weight, 0);
      if (spec.split.length > spec.variants.length) spec.errors.push(`"Personalization Split" has ${spec.split.length} values for ${spec.variants.length} variant(s)`);
      if (total > 100) spec.errors.push(`"Personalization Split" adds up to ${total}%; at most 100 (the default gets the rest)`);
    }
  }

  if (spec.source === 'api') {
    if (raw.hint !== undefined) {
      spec.hint = proseValue(raw.hint);
      if (!spec.hint || spec.hint.length > LIMITS.hint) spec.errors.push(`"Personalization Hint" must be 1 to ${LIMITS.hint} characters, got ${spec.hint.length}`);
    }
    descriptionRows.forEach(([suffix, value]) => {
      const name = slug(suffix) === 'default' ? 'default' : ruleVariant(suffix, spec.variants, false)?.name;
      const label = `"Personalization Description ${suffix.replace(/-/g, ' ')}"`;
      if (!name) {
        spec.errors.push(`${label} names no listed variant (or Default)`);
        return;
      }
      const text = proseValue(value);
      if (!text || text.length > LIMITS.description) {
        spec.errors.push(`${label} must be 1 to ${LIMITS.description} characters, got ${text.length}`);
        return;
      }
      spec.descriptions[name] = text;
    });
  }

  if (spec.source === 'target') {
    if (raw.location !== undefined) {
      spec.location = raw.location;
      if (!LOCATION_PATTERN.test(spec.location) || spec.location.length > LIMITS.location) {
        spec.errors.push(`"Personalization Location" must be a Target location name (letters, digits, _ . : -), got "${raw.location}"`);
      }
    }
    if (raw.trigger !== undefined) {
      spec.trigger = parseTrigger(raw.trigger);
      if (!spec.trigger) spec.errors.push(`"Personalization Trigger" must be "scroll: <0-100>%", "view" or "load", got "${raw.trigger}"`);
    }
    if (raw.display !== undefined) {
      const display = raw.display.toLowerCase();
      if (DISPLAYS.includes(display)) spec.display = display;
      else spec.errors.push(`"Personalization Display" must be ${DISPLAYS.join(' or ')}, got "${raw.display}"`);
    } else if (raw.trigger !== undefined) spec.display = 'popup';
    if (spec.display === 'popup') spec.trigger = spec.trigger || DEFAULT_TRIGGER;
    else if (raw.trigger !== undefined) {
      spec.warnings.push('"Personalization Trigger" is ignored with "Personalization Display | inline"');
      spec.trigger = null;
    }
    spec.held = spec.display === 'inline';
  }
  return spec;
}

/**
 * A spec as the contract's section object (section.schema.json), for
 * validation and reports.
 * @param {object} spec
 * @returns {object}
 */
export function sectionObject(spec) {
  const object = {
    id: spec.id,
    source: spec.source,
    variants: spec.variants.map(({ name, path }) => ({ name, fragment: path })),
  };
  if (spec.rules.length) {
    object.rules = spec.rules.map(({ variant, condition }) => ({ variant, condition }));
  }
  if (spec.split) object.split = spec.split;
  if (spec.hint !== null) object.hint = spec.hint;
  if (Object.keys(spec.descriptions).length) object.descriptions = { ...spec.descriptions };
  if (spec.location !== null) object.location = spec.location;
  if (spec.authored.trigger !== undefined) object.trigger = spec.authored.trigger.toLowerCase();
  if (spec.authored.display !== undefined) object.display = spec.authored.display.toLowerCase();
  return object;
}

/**
 * The listed variant a decision names, by name or by fragment path.
 * @param {object} spec
 * @param {{variant?: string, fragment?: string}} decision
 * @param {string[]} [prefixes]
 * @returns {{name: string, path?: string}|undefined} { name: 'default' } for
 *   the authored content; undefined when the answer names nothing listed
 */
export function listedVariant(spec, decision, prefixes = DEFAULT_FRAGMENT_PREFIXES) {
  if (!decision || typeof decision !== 'object') return undefined;
  if (typeof decision.variant === 'string') {
    if (decision.variant === 'default') return { name: 'default' };
    return spec.variants.find((variant) => variant.name === decision.variant);
  }
  const path = typeof decision.fragment === 'string' ? toFragmentPath(decision.fragment, prefixes) : null;
  return path ? spec.variants.find((variant) => variant.path === path) : undefined;
}

/**
 * Evaluates the Rule rows, top to bottom; the first match wins.
 * @param {object} spec
 * @param {object} context { geo, device, visitor, params, state }
 * @param {object} [options]
 * @param {object} [options.audiences] name -> boolean | (context) => boolean
 * @param {string[]} [options.defer] criteria the caller cannot evaluate (the
 *   edge: device, state, audience); reaching one before a match defers
 * @param {boolean} [options.withoutConsent] the `rules` consent exception:
 *   rules using visitor or audience never run
 * @returns {Promise<{variant: {name: string, path: string}, rule: string}|{none: true}
 *   |{deferred: true}>}
 */
export async function ruleOutcome(spec, context = {}, {
  audiences = {}, defer = [], withoutConsent = false,
} = {}) {
  const usable = (rule) => !withoutConsent
    || rule.clauses.every((clause) => NO_CONSENT_CRITERIA.includes(clause.criterion));
  const results = await Promise.all(spec.rules.map((rule) => {
    if (!usable(rule)) return false;
    if (rule.clauses.some((clause) => defer.includes(clause.criterion))) return 'deferred';
    return evaluate(rule.clauses, context, audiences);
  }));
  const index = results.findIndex((result) => result === true || result === 'deferred');
  if (index === -1) return { none: true };
  if (results[index] === 'deferred') return { deferred: true };
  const rule = spec.rules[index];
  const variant = spec.variants.find((candidate) => candidate.name === rule.variant);
  return { variant, rule: rule.condition };
}

/**
 * Criteria referenced by a section's rules.
 * @param {object} spec
 * @returns {Set<string>}
 */
export function sectionCriteria(spec) {
  return new Set((spec.rules || [])
    .flatMap((rule) => rule.clauses.map((clause) => clause.criterion)));
}
