/*
 * skills/personalize/scripts/schema.mjs — checks values against the vendored
 * contract schemas (assets/contract/schemas). A small draft 2020-12
 * validator for the keywords those schemas use (the contract's own test
 * validator): it throws on any other keyword, so nothing is silently
 * unchecked. No dependencies.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS_DIR } from './lib.mjs';

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs', '$comment', 'examples', 'default']);
const KEYWORDS = new Set([
  'type', 'required', 'properties', 'additionalProperties', 'propertyNames', 'minProperties',
  'maxProperties', 'enum', 'const', 'items', 'contains', 'minItems', 'maxItems', 'uniqueItems', 'minLength',
  'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'oneOf', 'anyOf', 'allOf',
  'not', 'if', 'then', 'else', '$ref',
]);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};
const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((node, key) => {
    if (!node || !(key in node)) throw new Error(`unresolved $ref ${ref}`);
    return node[key];
  }, root);
}

function walk(schema, value, path, root, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push(`${path}: not allowed`); return; }
  Object.keys(schema).forEach((key) => {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`unsupported keyword "${key}" at ${path}`);
  });
  const fail = (message) => errors.push(`${path}: ${message}`);
  const sub = (s, v, p = path) => { const e = []; walk(s, v, p, root, e); return e; };

  if (schema.$ref) errors.push(...sub(resolveRef(root, schema.$ref), value));
  if ('type' in schema) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matchesType(value, t))) fail(`expected ${types.join('|')}, got ${typeOf(value)}`);
  }
  if ('const' in schema && !equal(value, schema.const)) fail(`expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => equal(item, value))) fail(`expected one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail('too short');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('too long');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`not above ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('items not unique');
    if (schema.items !== undefined) value.forEach((item, i) => errors.push(...sub(schema.items, item, `${path}[${i}]`)));
    if (schema.contains !== undefined && !value.some((item) => !sub(schema.contains, item).length)) fail('no item matches "contains"');
  }
  if (typeOf(value) === 'object') {
    const keys = Object.keys(value);
    (schema.required || []).forEach((key) => { if (!(key in value)) fail(`missing "${key}"`); });
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail('too few properties');
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail('too many properties');
    keys.forEach((key) => {
      if (schema.propertyNames) errors.push(...sub(schema.propertyNames, key, `${path}{${key}}`));
      if (schema.properties && key in schema.properties) {
        errors.push(...sub(schema.properties[key], value[key], `${path}.${key}`));
      } else if (schema.additionalProperties !== undefined) {
        errors.push(...sub(schema.additionalProperties, value[key], `${path}.${key}`));
      }
    });
  }
  if (schema.allOf) schema.allOf.forEach((s) => errors.push(...sub(s, value)));
  if (schema.anyOf && !schema.anyOf.some((s) => !sub(s, value).length)) fail('matches none of anyOf');
  if (schema.oneOf && schema.oneOf.filter((s) => !sub(s, value).length).length !== 1) fail('does not match exactly one of oneOf');
  if (schema.not && !sub(schema.not, value).length) fail('matches a "not" schema');
  if (schema.if !== undefined) {
    if (!sub(schema.if, value).length) {
      if (schema.then !== undefined) errors.push(...sub(schema.then, value));
    } else if (schema.else !== undefined) {
      errors.push(...sub(schema.else, value));
    }
  }
}

/**
 * @param {object} schema root schema
 * @param {unknown} value
 * @returns {string[]} errors, empty when valid
 */
export function validate(schema, value) {
  const errors = [];
  walk(schema, value, '$', schema, errors);
  return errors;
}

const cache = {};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A vendored contract schema. Fragment path patterns use the default
 * /fragments/ prefix; a site with other fragmentPrefixes checks against those.
 * @param {string} name e.g. 'section', 'measurement-event'
 * @param {{prefixes?: string[]}} [options]
 * @returns {object}
 */
export function schema(name, { prefixes } = {}) {
  cache[name] = cache[name] || JSON.parse(readFileSync(join(ASSETS_DIR, 'contract', 'schemas', `${name}.schema.json`), 'utf8'));
  const base = cache[name];
  if (!prefixes || (prefixes.length === 1 && prefixes[0] === '/fragments/')) return base;
  const alternatives = `(?:${prefixes.map(escape).join('|')})`;
  return JSON.parse(JSON.stringify(base), (key, value) => (key === 'pattern' && typeof value === 'string' && value.startsWith('^/fragments/')
    ? `^${alternatives}${value.slice('^/fragments/'.length)}` : value));
}

const UNASSIGNED = ['no-consent', 'bot', 'timeout', 'error', 'invalid'];
const RESULTS = {
  variant: ['applied', 'unchanged', 'failed'],
  control: ['kept-default', 'unchanged'],
  'intentional-default': ['kept-default', 'unchanged'],
};

/**
 * The cross-field rules of a measurement event that JSON Schema can't
 * express (contract section 9): when assigned is present and result isn't
 * failed, variant equals assigned (the contract's own semantics check);
 * plus the allowed outcome / result combinations: assigned is absent for
 * unassigned outcomes, a failed treatment shows the default, kept-default
 * always shows the default.
 * @param {object} event { event, personalization }
 * @returns {string[]}
 */
export function eventSemantics(event) {
  const p = event?.personalization || {};
  const errors = [];
  if (p.assigned !== undefined && p.result !== 'failed' && p.variant !== p.assigned) {
    errors.push(`variant "${p.variant}" differs from assigned "${p.assigned}" without result "failed"`);
  }
  if (UNASSIGNED.includes(p.outcome) && p.assigned !== undefined) {
    errors.push(`outcome "${p.outcome}" has assigned "${p.assigned}"`);
  }
  if (['variant', 'control', 'intentional-default', 'override'].includes(p.outcome) && p.assigned === undefined) {
    errors.push(`outcome "${p.outcome}" has no assigned`);
  }
  if (p.result !== undefined) {
    if (RESULTS[p.outcome] && !RESULTS[p.outcome].includes(p.result)) {
      errors.push(`outcome "${p.outcome}" with result "${p.result}"`);
    }
    if (['kept-default', 'failed'].includes(p.result) && p.variant !== 'default') {
      errors.push(`result "${p.result}" shows "${p.variant}", not the default`);
    }
  }
  return errors;
}

/**
 * @param {string} name schema name
 * @param {unknown} value
 * @param {{prefixes?: string[]}} [options]
 * @returns {string[]} errors (schema, plus the event semantics for measurement events)
 */
export function check(name, value, options) {
  return [
    ...validate(schema(name, options), value),
    ...(name === 'measurement-event' ? eventSemantics(value) : []),
  ];
}
