import { pathPattern, TEST_DATA } from './lib.mjs';
import { parseGraphQL } from './classify.mjs';

function mediaType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function formValueInto(target, key, value) {
  if (Object.hasOwn(target, key)) {
    target[key] = Array.isArray(target[key]) ? [...target[key], value] : [target[key], value];
  } else {
    target[key] = value;
  }
}

function parseForm(body) {
  const value = {};
  for (const [key, entryValue] of new URLSearchParams(body)) {
    formValueInto(value, key, entryValue);
  }
  return value;
}

function parseMultipartFields(body) {
  const fields = [];
  const seen = new Set();
  const re = /Content-Disposition:[^\r\n]*\bname="([^"]+)"/gi;
  let match;
  while ((match = re.exec(String(body || '')))) {
    if (!seen.has(match[1])) {
      fields.push(match[1]);
      seen.add(match[1]);
    }
  }
  return { fields };
}

export function parseBody(body, contentType = '') {
  if (body === null || body === undefined || body === '') return { format: 'empty', value: null };

  const type = mediaType(contentType);
  if (type === 'application/json' || type.endsWith('+json')) {
    try {
      return { format: 'json', value: JSON.parse(body) };
    } catch {
      return { format: 'text', value: String(body) };
    }
  }

  if (type === 'application/x-www-form-urlencoded') {
    return { format: 'form', value: parseForm(body) };
  }

  if (type === 'multipart/form-data') {
    return { format: 'multipart', value: parseMultipartFields(body) };
  }

  return { format: 'text', value: String(body) };
}

function stringFormat(value) {
  const text = String(value);
  if (/^<(?:test:)?email>$/.test(text)) return 'email';
  if (/^<(?:test:)?phone>$/.test(text)) return 'phone';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
  if (/^https?:\/\/[^\s]+$/i.test(text)) return 'uri';

  const digits = text.replace(/\D/g, '');
  if (/^\+?[\d .-]+$/.test(text) && digits.length >= 10) return 'phone';
  return undefined;
}

export function inferSchema(value) {
  if (Array.isArray(value)) {
    const itemSchemas = value.map(inferSchema);
    return {
      type: 'array',
      items: itemSchemas.reduce((merged, item) => (merged ? mergeSchemas(merged, item) : item), undefined) || {},
    };
  }

  if (isPlainObject(value)) {
    const properties = {};
    const required = [];
    for (const [key, child] of Object.entries(value)) {
      properties[key] = inferSchema(child);
      if (!isEmpty(child)) required.push(key);
    }

    const schema = { type: 'object', properties };
    if (required.length) schema.required = required;
    return schema;
  }

  if (typeof value === 'string') {
    const schema = { type: 'string' };
    const format = stringFormat(value);
    if (format) schema.format = format;
    return schema;
  }

  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (value === null) return { type: 'null' };
  return { type: typeof value };
}

function unique(values) {
  return [...new Set(values)];
}

function intersect(a = [], b = []) {
  const inB = new Set(b);
  return a.filter((value) => inB.has(value));
}

export function mergeSchemas(a = {}, b = {}) {
  if (!a.type) return b;
  if (!b.type) return a;
  if (a.type !== b.type) return { type: unique([a.type, b.type].flat()).sort() };

  if (a.type === 'object') {
    const properties = {};
    for (const key of unique([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})])) {
      properties[key] = mergeSchemas(a.properties?.[key], b.properties?.[key]);
    }
    const required = intersect(a.required || [], b.required || []);
    return required.length ? { type: 'object', properties, required } : { type: 'object', properties };
  }

  if (a.type === 'array') {
    return { type: 'array', items: mergeSchemas(a.items || {}, b.items || {}) };
  }

  const schema = { type: a.type };
  if (a.format && a.format === b.format) schema.format = a.format;
  return schema;
}

const testValues = new Map(Object.entries(TEST_DATA).map(([key, value]) => [value, key]));
const sensitiveKeyRe = /name|first|last|address|phone|email|message|comment|token|recaptcha/i;
const tokenRe = /^[A-Za-z0-9._-]{40,}$/;
const placeholderRe = /^<(?:email|phone|token|recaptcha|redacted|test:[\w-]+|cookie:[\w-]+)>$/i;

function redactString(value, path) {
  if (testValues.has(value)) return `<test:${testValues.get(value)}>`;
  if (placeholderRe.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '<email>';
  if (/^\+?[\d .-]+$/.test(value) && value.replace(/\D/g, '').length >= 10) return '<phone>';
  if (tokenRe.test(value)) return '<token>';
  if (path.some((part) => sensitiveKeyRe.test(part))) return '<redacted>';
  return value;
}

export function redact(value, path = []) {
  if (Array.isArray(value)) return value.map((item, index) => redact(item, [...path, String(index)]));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child, [...path, key])]));
  }
  if (typeof value === 'string') return redactString(value, path);
  if (typeof value === 'number' && String(Math.abs(value)).replace(/\D/g, '').length >= 10) return '<phone>';
  if (path.some((part) => sensitiveKeyRe.test(part))) return '<redacted>';
  return value;
}

function joinPath(base, key) {
  if (!base) return String(key);
  if (/^\d+$/.test(String(key))) return `${base}[${key}]`;
  return `${base}.${key}`;
}

function leaves(value, base = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, joinPath(base, index)));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, joinPath(base, key)));
  }
  return [{ path: base, key: base.split('.').at(-1)?.replace(/\[\d+\]$/, '') || base, value }];
}

function cookieNameForNull(key, cookies) {
  const lowerKey = String(key || '').toLowerCase();
  const names = Object.keys(cookies || {});
  return names.find((name) => lowerKey === name.toLowerCase() || lowerKey.includes(name.toLowerCase()))
    || (lowerKey.includes('hutk') ? names.find((name) => name.toLowerCase().includes('hutk')) : undefined);
}

export function correlate(bodyValue, sources = {}) {
  const inputs = Array.isArray(sources.inputs) ? sources.inputs : [];
  const cookies = sources.cookies || {};
  const tokens = Array.isArray(sources.tokens) ? sources.tokens : [];
  const fieldMap = [];
  const clientDeps = [];

  for (const leaf of leaves(bodyValue)) {
    if (typeof leaf.value === 'string') {
      for (const input of inputs) {
        if (leaf.value === input.value) {
          fieldMap.push({
            path: leaf.path,
            selector: input.selector,
            name: input.name,
            value: input.value,
          });
        }
      }

      const token = tokens.find((entry) => leaf.value === entry.value);
      if (token) {
        clientDeps.push({
          path: leaf.path,
          from: token.kind || 'recaptcha',
          siteKey: token.siteKey,
          action: token.action,
        });
        continue;
      }

      const cookie = Object.entries(cookies).find(([, value]) => leaf.value === value);
      if (cookie) {
        clientDeps.push({ path: leaf.path, from: 'cookie', name: cookie[0] });
      } else if (leaf.value === sources.title) {
        clientDeps.push({ path: leaf.path, from: 'title' });
      } else if (leaf.value === sources.href) {
        clientDeps.push({ path: leaf.path, from: 'location' });
      } else if (leaf.value === '') {
        clientDeps.push({ path: leaf.path, from: 'constant', value: '' });
      }
    } else if (leaf.value === null) {
      const name = cookieNameForNull(leaf.key, cookies);
      if (name) clientDeps.push({ path: leaf.path, from: 'cookie', name });
    }
  }

  return { fieldMap, clientDeps };
}

function getPath(value, path) {
  if (!path) return value;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || !Object.hasOwn(Object(current), part)) return undefined;
    current = current[part];
  }
  return current;
}

function pathParts(path) {
  const parts = [];
  for (const part of String(path).split('.')) {
    const indexed = [...part.matchAll(/([^\[\]]+)|\[(\d+)?\]/g)];
    for (const match of indexed) parts.push(match[1] || match[2] || '[]');
  }
  return parts;
}

function redactForPath(value, path) {
  return redact(value, pathParts(path).filter((part) => part !== '[]' && !/^\d+$/.test(part)));
}

function pathExistsParts(value, parts) {
  if (parts.length === 0) return value !== undefined;
  const [part, ...rest] = parts;
  if (part === '[]') {
    return Array.isArray(value) && value.every((item) => pathExistsParts(item, rest));
  }
  if (value === null || value === undefined || !Object.hasOwn(Object(value), part)) return false;
  return pathExistsParts(value[part], rest);
}

function pathExists(value, path) {
  if (!path) return value !== undefined;
  return pathExistsParts(value, pathParts(path));
}

function requiredPaths(schema, base = '') {
  // Array item requirements use [] wildcards, e.g. items[].sku means every item must have sku.
  if (schema?.type === 'array') return requiredPaths(schema.items, `${base}[]`);
  if (!schema || schema.type !== 'object') return [];
  const paths = [];
  for (const key of schema.required || []) {
    const path = joinPath(base, key);
    paths.push(path);
    paths.push(...requiredPaths(schema.properties?.[key], path));
  }
  return paths;
}

function pathnamePattern(url, base) {
  return pathPattern(new URL(url, base).pathname);
}

function queryKeys(url, base) {
  const parsed = new URL(url, base);
  return [...new Set([...parsed.searchParams.keys()])].sort();
}

function lowerHeaderNames(value = []) {
  if (Array.isArray(value)) return value.map((name) => String(name).toLowerCase()).filter(Boolean).sort();
  if (value && typeof value === 'object') return Object.keys(value).map((name) => String(name).toLowerCase()).sort();
  return [];
}

function contractHeaderNames(contract) {
  const names = [
    ...(contract.auth?.headerNames || []),
    ...(contract.auth?.headers || []),
  ];
  if (contract.contentType) names.push('content-type');
  return [...new Set(names.map((name) => String(name).toLowerCase()).filter(Boolean))].sort();
}

function graphqlForCaptured(captured) {
  const ops = parseGraphQL({
    method: captured.method,
    url: captured.url,
    body: JSON.stringify(captured.body),
    contentType: captured.contentType,
  });
  return Array.isArray(ops) ? ops : [];
}

export function diffContract(contract, captured) {
  const diffs = [];

  const expectedMethod = String(contract.method || '').toUpperCase();
  const actualMethod = String(captured.method || '').toUpperCase();
  if (expectedMethod !== actualMethod) diffs.push(`method expected ${expectedMethod}, got ${actualMethod}`);

  try {
    const expectedPath = pathnamePattern(contract.endpoint);
    const actualPath = pathnamePattern(captured.url, captured.href);
    if (expectedPath !== actualPath) diffs.push(`path pattern expected ${expectedPath}, got ${actualPath}`);
  } catch (error) {
    diffs.push(`path pattern could not be compared: ${error.message}`);
  }

  try {
    const actualKeys = new Set(queryKeys(captured.url, captured.href));
    for (const key of queryKeys(contract.endpoint, captured.href)) {
      if (!actualKeys.has(key)) diffs.push(`query parameter missing: ${key}`);
    }
  } catch (error) {
    diffs.push(`query parameters could not be compared: ${error.message}`);
  }

  const actualHeaders = new Set(lowerHeaderNames(captured.requestHeaderNames || captured.headers));
  for (const name of contractHeaderNames(contract)) {
    if (!actualHeaders.has(name)) diffs.push(`required header missing: ${name}`);
  }

  const expectedType = mediaType(contract.contentType);
  const actualType = mediaType(captured.contentType);
  if (expectedType && expectedType !== actualType) {
    diffs.push(`contentType expected ${expectedType}, got ${actualType || '<none>'}`);
  }

  for (const path of requiredPaths(contract.requestSchema)) {
    if (!pathExists(captured.body, path)) diffs.push(`required path missing: ${path}`);
  }

  if (contract.graphql) {
    const ops = graphqlForCaptured(captured);
    const actual = ops.find((op) => op.operationName === contract.graphql.operationName) || ops[0];
    if (!actual) {
      diffs.push('GraphQL operation missing');
    } else {
      if ((contract.graphql.operationName || null) !== (actual.operationName || null)) {
        diffs.push('GraphQL operationName differed');
      }
      if (contract.graphql.type !== actual.type) {
        diffs.push('GraphQL type differed');
      }
      if (contract.graphql.persistedHash && contract.graphql.persistedHash !== actual.persistedHash) {
        diffs.push('GraphQL persisted query hash differed');
      }
      for (const path of requiredPaths(inferSchema(contract.graphql.variables || {}))) {
        if (!pathExists(actual.variables || {}, path)) diffs.push(`GraphQL variable missing: ${path}`);
      }
    }
  }

  for (const entry of contract.fieldMap || []) {
    const actual = getPath(captured.body, entry.path);
    if (actual !== entry.value) {
      diffs.push(`fieldMap ${entry.path} value differed`);
    }
  }

  for (const dep of contract.clientDeps || []) {
    const actual = getPath(captured.body, dep.path);
    if (dep.from === 'recaptcha' || dep.from === 'recaptcha-enterprise') {
      if (typeof actual !== 'string' || actual === '') diffs.push(`${dep.path} recaptcha token missing`);
    } else if (dep.from === 'cookie') {
      const expected = captured.cookies?.[dep.name];
      if (expected === undefined ? actual !== null : actual !== expected) {
        const actualLabel = actual === null || actual === undefined ? 'null' : 'different value';
        diffs.push(`${dep.path}: expected cookie ${dep.name} value, got ${actualLabel}`);
      }
    } else if (dep.from === 'title') {
      if (actual !== captured.title) diffs.push(`${dep.path}: expected page title, got ${actual === null || actual === undefined ? 'null' : 'different value'}`);
    } else if (dep.from === 'location') {
      if (actual !== captured.href) diffs.push(`${dep.path}: expected page location, got ${actual === null || actual === undefined ? 'null' : 'different value'}`);
    } else if (dep.from === 'constant') {
      if (actual !== dep.value) diffs.push(`${dep.path} constant expected ${JSON.stringify(dep.value)}, got ${JSON.stringify(actual)}`);
    }
  }

  return { pass: diffs.length === 0, diffs };
}
