#!/usr/bin/env node
/**
 * api-static-scan.mjs — Layer 1 static API endpoint scan.
 *
 * Fetches raw HTML and same-site script bundles, scans them for backend API
 * endpoints, GraphQL documents, data endpoint attributes, form actions, and JSON
 * settings islands, then writes the static candidate inventory.
 *
 *   node scripts/api-static-scan.mjs --urls <url,url,…> [--out stardust/api/static-candidates.json]
 *   node scripts/api-static-scan.mjs --from-dynamics stardust/current/_dynamics.json [--out stardust/api/static-candidates.json]
 *   node scripts/api-static-scan.mjs --from-state stardust/state.json [--out stardust/api/static-candidates.json]
 *
 * Writes: stardust/api/static-candidates.json
 * Exit 0 on completion, 2 on usage or missing source URLs.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax */
import { CAPS, ART, arg, isMain, list, printHelpIfAsked, provenance, readJSON, sameSite, writeJSON } from './lib/lib.mjs';
import { scopeOf } from './lib/classify.mjs';
import { redactText, redactUrl } from './lib/detect-redaction.mjs';

const ASSET_EXTENSIONS = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp4|webm|mp3|pdf)(?:$|[?#])/i;
const API_PATH = /\/(?:api|graphql|v[1-9])(?:\/|$|[?#])/i;
const JSON_ISLAND_IDS = new Set(['__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__']);

function decodeAttr(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function attrsFrom(text) {
  const attrs = new Map();
  const re = /([:\w-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match;
  while ((match = re.exec(text))) {
    const raw = match[2] || '';
    const value = raw ? raw.replace(/^['"]|['"]$/g, '') : '';
    attrs.set(match[1].toLowerCase(), decodeAttr(value));
  }
  return attrs;
}

function evidenceFrom(text, index, length) {
  const start = Math.max(0, index - 35);
  const end = Math.min(text.length, index + Math.max(length, 1) + 35);
  return redactText(text.slice(start, end), {}, { stripUrlQueryValues: true }).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function redactEndpoint(endpoint, pageUrl) {
  try {
    const raw = String(endpoint || '');
    const parsed = new URL(raw, pageUrl || 'https://placeholder.invalid/');
    for (const key of [...parsed.searchParams.keys()]) {
      const count = parsed.searchParams.getAll(key).length || 1;
      parsed.searchParams.delete(key);
      for (let i = 0; i < count; i += 1) parsed.searchParams.append(key, '<redacted>');
    }
    if (/^https?:\/\//i.test(raw) && parsed.pathname === '/' && !raw.endsWith('/') && !parsed.search && !parsed.hash) return parsed.origin;
    if (/^https?:\/\//i.test(raw)) return parsed.href;
    if (raw.startsWith('/')) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${parsed.pathname.replace(/^\//, '')}${parsed.search}${parsed.hash}`;
  } catch {
    return redactText(endpoint, {}, { stripUrlQueryValues: true });
  }
}

function hasAssetExtension(endpoint, pageUrl) {
  try {
    const url = new URL(endpoint, pageUrl || 'https://placeholder.invalid/');
    return ASSET_EXTENSIONS.test(`${url.pathname}${url.search}`);
  } catch {
    return ASSET_EXTENSIONS.test(String(endpoint || '').split('#')[0]);
  }
}

function looksApiBaseLiteral(endpoint) {
  try {
    const url = new URL(endpoint);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname.startsWith('api.') || API_PATH.test(url.pathname));
  } catch {
    return false;
  }
}

function inScope(endpoint, pageUrl) {
  if (!pageUrl) return true;
  try {
    const abs = new URL(endpoint, pageUrl).href;
    return scopeOf(abs, pageUrl).inScope !== false;
  } catch {
    return false;
  }
}

function graphQLOperations(doc) {
  const stripped = String(doc || '')
    .replace(/#[^\n\r]*/g, ' ')
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ');
  const operations = [];
  const re = /\b(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/g;
  let match;
  while ((match = re.exec(stripped))) operations.push({ name: match[2] || null, type: match[1] });
  return operations;
}

function overlaps(spans, start, end) {
  return spans.some((span) => start < span.end && end > span.start);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const key = `${candidate.endpoint}\u0000${candidate.method || ''}\u0000${candidate.graphqlOperation?.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function collectJSONStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectJSONStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectJSONStrings(item, out));
  return out;
}

function addCandidate(candidates, spans, text, options, fields) {
  const endpoint = fields.endpoint;
  if (!endpoint || hasAssetExtension(endpoint, options.pageUrl)) return;
  if (fields.via === 'literal' && !looksApiBaseLiteral(endpoint)) return;
  if (!inScope(endpoint, options.pageUrl)) return;
  const safeEndpoint = redactEndpoint(endpoint, options.pageUrl);

  const start = fields.index ?? 0;
  const end = fields.end ?? start;
  if (fields.markSpan !== false) spans.push({ start, end });
  candidates.push({
    endpoint: safeEndpoint,
    method: fields.method ? String(fields.method).toUpperCase() : null,
    via: fields.via,
    graphqlOperation: fields.graphqlOperation || null,
    evidence: evidenceFrom(text, start, Math.max(end - start, endpoint.length)),
    source: redactUrl(options.source || options.pageUrl || 'source', {}, { stripQueryValues: true }),
  });
}

function callArguments(text, openParen, cap = 600) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  const endLimit = Math.min(text.length, openParen + cap);
  for (let i = openParen; i < endLimit; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1, endLimit);
}

function methodInCall(text, openParen) {
  const window = callArguments(text, openParen);
  const match = window.match(/\bmethod\s*:\s*['"]?([A-Za-z]+)['"]?/i);
  return match ? match[1].toUpperCase() : null;
}

export function extractScripts(html, pageUrl) {
  const inline = [];
  const external = [];
  const pageHost = new URL(pageUrl).host;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const attrs = attrsFrom(match[1]);
    const src = attrs.get('src');
    if (src) {
      try {
        const url = new URL(src, pageUrl);
        if ((url.protocol === 'http:' || url.protocol === 'https:') && sameSite(url.host, pageHost) && inScope(url.href, pageUrl)) {
          external.push(url.href);
        }
      } catch {
        // Ignore malformed script src values during static extraction.
      }
    } else {
      const body = match[2].trim();
      if (body) inline.push(body);
    }
  }
  return { inline, external: [...new Set(external)] };
}

export function scanSource(text, { pageUrl, source = pageUrl || 'source' } = {}) {
  const sourceText = String(text || '');
  const candidates = [];
  const spans = [];
  let match;

  const fetchRe = /\bfetch\s*\(\s*(['"`])([^'"`]+)\1/gi;
  while ((match = fetchRe.exec(sourceText))) {
    const endpoint = decodeAttr(match[2]);
    const start = match.index + match[0].indexOf(match[1]) + 1;
    const openParen = sourceText.indexOf('(', match.index);
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: methodInCall(sourceText, openParen),
      via: 'fetch',
      index: start,
      end: start + endpoint.length,
    });
  }

  const axiosRe = /\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  while ((match = axiosRe.exec(sourceText))) {
    const endpoint = decodeAttr(match[3]);
    const start = match.index + match[0].indexOf(match[2]) + 1;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: match[1],
      via: 'axios',
      index: start,
      end: start + endpoint.length,
    });
  }

  const xhrRe = /\.open\s*\(\s*(['"`])([A-Za-z]+)\1\s*,\s*(['"`])([^'"`]+)\3/gi;
  while ((match = xhrRe.exec(sourceText))) {
    const endpoint = decodeAttr(match[4]);
    const start = match.index + match[0].lastIndexOf(match[3]) + 1;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: match[2],
      via: 'xhr',
      index: start,
      end: start + endpoint.length,
    });
  }

  const gqlRe = /\b(?:gql|graphql)\s*`([\s\S]*?)`/gi;
  while ((match = gqlRe.exec(sourceText))) {
    const operations = graphQLOperations(match[1]);
    for (const op of operations) {
      addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
        endpoint: '/graphql',
        method: null,
        via: 'graphql-doc',
        graphqlOperation: op,
        index: match.index,
        end: gqlRe.lastIndex,
      });
    }
  }

  const bareGraphQLRe = /\b(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?\s*(?:\([^)]*\))?\s*\{/g;
  while ((match = bareGraphQLRe.exec(sourceText))) {
    if (overlaps(spans, match.index, bareGraphQLRe.lastIndex)) continue;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint: '/graphql',
      method: null,
      via: 'graphql-doc',
      graphqlOperation: { name: match[2] || null, type: match[1] },
      index: match.index,
      end: bareGraphQLRe.lastIndex,
      markSpan: false,
    });
  }

  const dataRe = /\bdata-(?:endpoint|api)\s*=\s*(['"])([^'"]+)\1/gi;
  while ((match = dataRe.exec(sourceText))) {
    const endpoint = decodeAttr(match[2]);
    const start = match.index + match[0].lastIndexOf(match[1]) + 1;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: null,
      via: 'data-attr',
      index: start,
      end: start + endpoint.length,
    });
  }

  const formRe = /<form\b([^>]*)>/gi;
  while ((match = formRe.exec(sourceText))) {
    const attrs = attrsFrom(match[1]);
    const endpoint = attrs.get('action');
    if (!endpoint) continue;
    const actionMatch = match[1].match(/\baction\s*=\s*(['"])([^'"]+)\1/i);
    const start = actionMatch ? match.index + match[0].indexOf(actionMatch[2]) : match.index;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: attrs.get('method') || 'GET',
      via: 'form-action',
      index: start,
      end: start + endpoint.length,
    });
  }

  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((match = scriptRe.exec(sourceText))) {
    const attrs = attrsFrom(match[1]);
    if (attrs.has('src')) continue;
    const id = attrs.get('id');
    const type = attrs.get('type');
    if (!JSON_ISLAND_IDS.has(id) && !/json/i.test(type || '')) continue;
    let parsed;
    try {
      parsed = JSON.parse(match[2].trim());
    } catch {
      continue;
    }
    for (const value of collectJSONStrings(parsed)) {
      const valueIndex = sourceText.indexOf(value, match.index);
      addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
        endpoint: value,
        method: null,
        via: 'json-island',
        index: valueIndex >= 0 ? valueIndex : match.index,
        end: valueIndex >= 0 ? valueIndex + value.length : scriptRe.lastIndex,
      });
    }
  }

  const literalRe = /https?:\/\/[^\s'"`<>)]+/gi;
  while ((match = literalRe.exec(sourceText))) {
    const endpoint = match[0].replace(/[},.;]+$/, '');
    if (overlaps(spans, match.index, match.index + endpoint.length)) continue;
    if (!looksApiBaseLiteral(endpoint)) continue;
    addCandidate(candidates, spans, sourceText, { pageUrl, source }, {
      endpoint,
      method: null,
      via: 'literal',
      index: match.index,
      end: match.index + endpoint.length,
    });
  }

  return dedupeCandidates(candidates);
}

export function urlsFromDynamics(doc) {
  const urls = new Set();
  for (const url of doc?._provenance?.urls || []) if (typeof url === 'string') urls.add(url);
  for (const page of Object.values(doc?.pages || {})) if (typeof page?.url === 'string') urls.add(page.url);
  return [...urls];
}

export function urlsFromState(doc) {
  const urls = new Set();
  for (const url of [doc?.site?.originUrl, doc?.site?.url, doc?.site?.origin]) if (typeof url === 'string') urls.add(url);
  for (const page of doc?.pages || []) if (typeof page?.url === 'string') urls.add(page.url);
  return [...urls];
}

async function readResponseText(resp, cap = Infinity) {
  const reader = resp.body?.getReader?.();
  if (!reader) return { text: await resp.text(), truncated: false };
  const chunks = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      const allowed = Math.max(0, value.byteLength - (size - cap));
      if (allowed) chunks.push(value.slice(0, allowed));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

async function fetchText(url, cap = Infinity, fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(url);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > cap) return { ok: resp.ok, status: resp.status, text: '', skipped: true, truncated: false };
  const body = await readResponseText(resp, cap);
  return { ok: resp.ok, status: resp.status, skipped: false, ...body };
}

export async function scanPage(url, { fetchImpl = globalThis.fetch } = {}) {
  const page = { url, candidates: [] };
  const errors = [];
  try {
    const fetched = await fetchText(url, CAPS.bundleBytes, fetchImpl);
    if (fetched.skipped) errors.push(`page skipped over ${CAPS.bundleBytes} bytes`);
    if (fetched.truncated) errors.push(`page truncated at ${CAPS.bundleBytes} bytes`);
    if (!fetched.ok) errors.push(`page HTTP ${fetched.status}`);
    const scripts = extractScripts(fetched.text, url);
    let candidates = [
      ...scanSource(fetched.text, { pageUrl: url, source: url }),
      ...scripts.inline.flatMap((script) => scanSource(script, { pageUrl: url, source: `${url}#inline-script` })),
    ];

    for (const scriptUrl of scripts.external.slice(0, CAPS.bundlesPerPage)) {
      try {
        const bundle = await fetchText(scriptUrl, CAPS.bundleBytes, fetchImpl);
        if (bundle.skipped) {
          errors.push(`${scriptUrl}: skipped over ${CAPS.bundleBytes} bytes`);
          continue;
        }
        if (!bundle.ok) errors.push(`${scriptUrl}: HTTP ${bundle.status}`);
        if (bundle.truncated) errors.push(`${scriptUrl}: truncated at ${CAPS.bundleBytes} bytes`);
        candidates = candidates.concat(scanSource(bundle.text, { pageUrl: url, source: scriptUrl }));
      } catch (e) {
        errors.push(`${scriptUrl}: ${String(e.message || e).slice(0, 160)}`);
      }
    }
    page.candidates = dedupeCandidates(candidates);
  } catch (e) {
    errors.push(`page: ${String(e.message || e).slice(0, 160)}`);
  }
  if (errors.length) page.errors = errors;
  return page;
}

export async function runStaticScan(urls) {
  const pages = [];
  for (const url of urls) pages.push(await scanPage(url));
  return { _provenance: provenance('static-scan', { urls }), pages };
}

function urlsFromArgs() {
  let urls = list(arg('urls', ''));
  if (!urls.length && arg('from-dynamics')) {
    urls = urlsFromDynamics(readJSON(arg('from-dynamics')));
    if (!urls.length) throw new Error('NEEDS_CONTEXT: dynamics file does not contain page URLs');
  }
  if (!urls.length && arg('from-state')) {
    urls = urlsFromState(readJSON(arg('from-state')));
    if (!urls.length) throw new Error('NEEDS_CONTEXT: state file does not contain page URLs');
  }
  return [...new Set(urls)];
}

async function main() {
  printHelpIfAsked(import.meta.url);
  let urls;
  try {
    urls = urlsFromArgs();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (!urls.length) {
    console.error('usage: api-static-scan.mjs --urls <url,…> | --from-dynamics stardust/current/_dynamics.json | --from-state stardust/state.json');
    process.exit(2);
  }

  const out = arg('out', ART.staticScan);
  const report = await runStaticScan(urls);
  writeJSON(out, report);
  console.error(`[api-integrations] ${report.pages.length} page(s) → ${out}`);
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
