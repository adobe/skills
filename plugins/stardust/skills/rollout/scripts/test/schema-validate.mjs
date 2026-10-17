// skills/rollout/scripts/test/schema-validate.mjs — test helper: a JSON Schema validator for exactly
// the keyword subset the rollout schemas use.
//
//   validate(schema, value, { root } = {}) -> string[]
//     '<json path>: <problem>' lines, empty when `value` is valid. Keywords: type (string or array;
//     'integer' = Number.isInteger), required and properties (objects only), additionalProperties
//     (boolean or schema, applied only to keys not in properties), items, enum, const, pattern,
//     minimum, uniqueItems, and local $ref '#/$defs/...' resolved against `root || schema` (pass
//     `{ root }` to validate against a sub-schema such as `{ $ref: '#/$defs/row' }`). Annotations
//     ($schema, $id, $defs, title, description, default, examples, format) are not checked.
//   unsupported(schema) -> string[]   keywords outside that subset ('<pointer>: <keyword>'); a schema
//     using one would be silently under-checked here.
//   loadSchema(name) -> object        parses ../../schemas/<name>, e.g. 'rollout-pages.schema.json'.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const SCHEMAS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

const KEYWORDS = new Set(['type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minimum', 'uniqueItems', '$ref', '$defs',
  'title', 'description', '$schema', '$id', 'default', 'examples', 'format']);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (t, v) => {
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeOf(v) === t;
};
const rx = (p) => { try { return new RegExp(p, 'u'); } catch { return new RegExp(p); } };
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
const resolveRef = (root, ref) => (ref.startsWith('#/')
  ? ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((n, k) => (n == null ? undefined : n[k]), root)
  : undefined);

function walk(schema, value, root, path, errors) {
  if (schema === true) return errors;
  if (schema === false) { errors.push(`${path}: not allowed`); return errors; }
  if (!schema || typeof schema !== 'object') { errors.push(`${path}: invalid schema`); return errors; }
  if (schema.$ref !== undefined) {
    const target = resolveRef(root, schema.$ref);
    if (target === undefined) errors.push(`${path}: unresolved $ref ${schema.$ref}`);
    else walk(target, value, root, path, errors);
  }
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(t, value))) { errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`); return errors; }
  }
  if ('const' in schema && !isDeepStrictEqual(value, schema.const)) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => isDeepStrictEqual(e, value))) errors.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string' && schema.pattern !== undefined && !rx(schema.pattern).test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.items !== undefined) value.forEach((v, i) => walk(schema.items, v, root, `${path}[${i}]`, errors));
    if (schema.uniqueItems && value.some((v, i) => value.findIndex((w) => isDeepStrictEqual(v, w)) !== i)) errors.push(`${path}: items are not unique`);
  }
  if (isType('object', value)) {
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) errors.push(`${path}: missing required ${k}`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) walk(props[k], v, root, `${path}${key(k)}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}${key(k)}: additional property not allowed`);
      else if (schema.additionalProperties !== undefined) walk(schema.additionalProperties, v, root, `${path}${key(k)}`, errors);
    }
  }
  return errors;
}

export function validate(schema, value, { root } = {}) {
  return walk(schema, value, root || schema, '$', []);
}

export function unsupported(schema, at = '#', out = []) {
  if (!schema || typeof schema !== 'object') return out;
  for (const k of Object.keys(schema)) if (!KEYWORDS.has(k)) out.push(`${at}: ${k}`);
  for (const [k, v] of Object.entries(schema.properties || {})) unsupported(v, `${at}/properties/${k}`, out);
  for (const [k, v] of Object.entries(schema.$defs || {})) unsupported(v, `${at}/$defs/${k}`, out);
  if (schema.items) unsupported(schema.items, `${at}/items`, out);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') unsupported(schema.additionalProperties, `${at}/additionalProperties`, out);
  return out;
}

export function loadSchema(name) {
  return JSON.parse(readFileSync(join(SCHEMAS, name), 'utf8'));
}
