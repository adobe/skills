import { registrable, vendorFor, WRITE_METHODS } from './lib.mjs';

function safeJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function normalizedContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function persistedHashFrom(extensions) {
  return stringOrNull(objectOrNull(extensions)?.persistedQuery?.sha256Hash);
}

function blankChar(char) {
  return char === '\n' || char === '\r' ? char : ' ';
}

function stripIgnoredTokens(query) {
  const source = String(query || '');
  let stripped = '';

  for (let i = 0; i < source.length;) {
    const char = source[i];

    if (char === '#') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        stripped += ' ';
        i += 1;
      }
      continue;
    }

    if (char === '"') {
      if (source.slice(i, i + 3) === '"""') {
        stripped += '   ';
        i += 3;
        while (i < source.length) {
          if (source.slice(i, i + 3) === '"""') {
            stripped += '   ';
            i += 3;
            break;
          }
          stripped += blankChar(source[i]);
          i += 1;
        }
        continue;
      }

      stripped += ' ';
      i += 1;
      let escaped = false;
      while (i < source.length) {
        const stringChar = source[i];
        stripped += blankChar(stringChar);
        i += 1;
        if (escaped) {
          escaped = false;
        } else if (stringChar === '\\') {
          escaped = true;
        } else if (stringChar === '"') {
          break;
        }
      }
      continue;
    }

    stripped += char;
    i += 1;
  }

  return stripped;
}

function operationsIn(query) {
  const source = stripIgnoredTokens(query).trimStart();
  if (!source) return [];
  if (source.startsWith('{')) return [{ type: 'query', name: null }];

  const operations = [];
  const re = /\b(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/g;
  let match;
  while ((match = re.exec(source))) {
    operations.push({ type: match[1], name: match[2] || null });
  }
  return operations;
}

function operationFor(operations, operationName) {
  if (operations.length === 0) return null;
  if (operationName) {
    const named = operations.find((op) => op.name === operationName);
    if (named) return named;
  }
  return operations[0];
}

function opFromParts({ query = null, operationName = null, variables = null, extensions = null }) {
  const persistedHash = persistedHashFrom(extensions);
  if (!query && !persistedHash) return null;

  const operations = query ? operationsIn(query) : [];
  const selected = query ? operationFor(operations, operationName) : null;
  const type = selected?.type || 'query';
  return {
    operationName: operationName || selected?.name || null,
    type,
    query,
    variables: objectOrNull(variables),
    persistedHash,
    documentHasMutation: operations.some((op) => op.type === 'mutation'),
  };
}

function opFromJSONPayload(payload) {
  const obj = objectOrNull(payload);
  if (!obj) return null;
  return opFromParts({
    query: stringOrNull(obj.query),
    operationName: stringOrNull(obj.operationName),
    variables: objectOrNull(obj.variables),
    extensions: objectOrNull(obj.extensions),
  });
}

function parseGraphQLGet(url) {
  let parsed;
  try {
    parsed = new URL(url, 'https://placeholder.invalid/');
  } catch {
    return null;
  }

  const query = stringOrNull(parsed.searchParams.get('query'));
  const operationName = stringOrNull(parsed.searchParams.get('operationName'));
  const variables = objectOrNull(safeJSON(parsed.searchParams.get('variables')));
  const extensions = objectOrNull(safeJSON(parsed.searchParams.get('extensions')));

  if (!query && !persistedHashFrom(extensions)) return null;
  const op = opFromParts({ query, operationName, variables, extensions });
  return op ? [op] : null;
}

export function parseGraphQL({ method = 'GET', url = '', body = null, contentType = '' } = {}) {
  const upperMethod = String(method || 'GET').toUpperCase();
  if (upperMethod === 'GET') return parseGraphQLGet(url);

  const type = normalizedContentType(contentType);
  if (type === 'application/graphql') {
    const query = stringOrNull(body);
    if (!query) return null;
    const op = opFromParts({ query });
    return op ? [op] : null;
  }

  const parsed = safeJSON(body);
  if (Array.isArray(parsed)) {
    const ops = parsed.map(opFromJSONPayload).filter(Boolean);
    return ops.length ? ops : null;
  }

  const op = opFromJSONPayload(parsed);
  return op ? [op] : null;
}

function matchesReadPost(url, readPost) {
  if (!Array.isArray(readPost) || readPost.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url, 'https://placeholder.invalid/');
  } catch {
    parsed = null;
  }
  const candidates = [String(url || '')];
  if (parsed) candidates.push(parsed.pathname, `${parsed.pathname}${parsed.search}`);

  return readPost.some((pattern) => {
    if (pattern instanceof RegExp) {
      return candidates.some((candidate) => {
        pattern.lastIndex = 0;
        return pattern.test(candidate);
      });
    }
    if (typeof pattern === 'string') return candidates.some((candidate) => candidate.includes(pattern));
    return false;
  });
}

export function classifyRequest(req, { readPost = [] } = {}) {
  const graphql = parseGraphQL(req);
  const allowedRead = matchesReadPost(req?.url, readPost);
  if (graphql) {
    const hasMutation = graphql.some((op) => op.type === 'mutation' || op.documentHasMutation);
    return {
      kind: hasMutation ? 'graphql-mutation' : 'graphql-query',
      isWrite: hasMutation,
      graphql,
    };
  }

  const method = String(req?.method || 'GET').toUpperCase();
  const isWrite = WRITE_METHODS.includes(method) && !allowedRead;
  return { kind: isWrite ? 'rest-write' : 'rest-read', isWrite, graphql: null };
}

function normalizeVendor(vendor) {
  if (!vendor) return null;
  return { class: vendor.class, role: vendor.role };
}

export function scopeOf(url, pageUrl) {
  const target = new URL(url, pageUrl);
  const page = new URL(pageUrl);
  const targetHost = target.hostname;
  const pageHost = page.hostname;

  let origin = 'third-party';
  if (targetHost === pageHost) origin = 'first-party';
  else if (registrable(targetHost) === registrable(pageHost)) origin = 'api-subdomain';

  const vendor = normalizeVendor(vendorFor(target.href) || vendorFor(targetHost));
  const inScope = !(vendor && ['T', 'V'].includes(vendor.class));
  const inspect = origin === 'third-party' && !vendor;

  return { inScope, origin, vendor, inspect };
}
