#!/usr/bin/env node
/**
 * api-cors.mjs — Probe API CORS policy from AEM Edge Delivery origins.
 *
 * Sends safe CORS preflights for contracted backend integrations, records only
 * status codes and access-control-* policy headers, updates each contract with
 * per-origin CORS results, and writes stardust/api/cors.json.
 *
 *   node scripts/api-cors.mjs --owner <owner> --repo <repo> --branch <branch> --prod <url> [--dir stardust/api]
 *
 * Exit 0 when preview/live are allowed, 1 when preview or live is blocked, 2 on usage.
 */
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

import {
  ART,
  arg,
  isMain,
  printHelpIfAsked,
  provenance,
  readJSON,
  writeJSON,
} from './lib/lib.mjs';

const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);
const SIMPLE_HEADERS = new Set(['accept', 'accept-language', 'content-language']);
const SIMPLE_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);
const PROBE_TIMEOUT_MS = 10_000;

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).toLowerCase()))].sort();
}

function normalizeMethod(method) {
  return String(method || 'GET').toUpperCase();
}

function normalizeEndpoint(endpoint) {
  const url = new URL(endpoint);
  url.search = '';
  url.hash = '';
  return url.href;
}

function branchSlug(branch) {
  return String(branch || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function originsFor({ owner, repo, branch, prod }) {
  const ref = branchSlug(branch);
  const production = new URL(prod).origin;
  return [
    { label: 'preview', origin: `https://${ref}--${repo}--${owner}.aem.page` },
    { label: 'live', origin: `https://${ref}--${repo}--${owner}.aem.live` },
    { label: 'production', origin: production },
  ];
}

function authHeaderNames(auth = {}) {
  const names = Array.isArray(auth.headers) ? auth.headers : auth.headerNames;
  return Array.isArray(names) ? names : [];
}

function isSafelistedHeader(name, contract) {
  const lower = String(name || '').toLowerCase();
  if (SIMPLE_HEADERS.has(lower)) return true;
  if (lower !== 'content-type') return false;
  const contentType = String(contract.contentType || '').split(';')[0].trim().toLowerCase();
  return contentType ? SIMPLE_CONTENT_TYPES.has(contentType) : false;
}

export function requestNeeds(contract = {}) {
  const method = normalizeMethod(contract.method || (contract.graphql ? 'POST' : 'GET'));
  const auth = contract.auth || { scheme: 'none' };
  const scheme = String(auth.scheme || 'none').toLowerCase();
  const headers = [];

  for (const name of authHeaderNames(auth)) {
    const lower = String(name || '').toLowerCase();
    if (lower === 'cookie') continue;
    if (!isSafelistedHeader(lower, contract)) headers.push(lower);
  }
  if (contract.contentType && !isSafelistedHeader('content-type', contract)) headers.push('content-type');

  return {
    method,
    headers: uniqueSorted(headers),
    credentials: scheme === 'cookie',
  };
}

export function needsPreflight(needs = {}) {
  const method = normalizeMethod(needs.method);
  if (!SIMPLE_METHODS.has(method)) return true;
  if (uniqueSorted(needs.headers || []).length > 0) return true;
  const contentType = String(needs.contentType || '').split(';')[0].trim().toLowerCase();
  return Boolean(contentType && method === 'POST' && !SIMPLE_CONTENT_TYPES.has(contentType));
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const desired = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === desired) return Array.isArray(value) ? value.join(', ') : String(value);
  }
  return null;
}

function splitHeaderList(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function originAllowed(acao, origin, credentials, reasons) {
  if (!acao) {
    reasons.push('no Access-Control-Allow-Origin');
    return;
  }
  const value = acao.trim();
  if (value === '*') {
    if (credentials) reasons.push('wildcard with credentials');
    return;
  }
  if (value.toLowerCase() === 'null') {
    reasons.push('Access-Control-Allow-Origin null');
    return;
  }
  const listed = value.split(/[\s,]+/).filter(Boolean);
  if (listed.length > 1) {
    reasons.push('Access-Control-Allow-Origin lists multiple origins');
    return;
  }
  if (value !== origin) reasons.push(`origin ${origin} not allowed`);
}

export function evaluateCors(response, needs) {
  const status = Number(response?.status || 0);
  const headers = response?.headers || {};
  const method = normalizeMethod(needs?.method);
  const requestHeaders = uniqueSorted(needs?.headers || []);
  const credentials = Boolean(needs?.credentials);
  const reasons = [];

  if (status < 200 || status >= 300) reasons.push(`preflight status ${status}`);

  originAllowed(headerValue(headers, 'access-control-allow-origin'), needs.origin, credentials, reasons);

  if (!SIMPLE_METHODS.has(method)) {
    const acam = headerValue(headers, 'access-control-allow-methods');
    const methods = splitHeaderList(acam);
    if (!acam || (!methods.includes(method.toLowerCase()) && !methods.includes('*'))) {
      reasons.push(`method ${method} not allowed`);
    } else if (methods.includes('*') && credentials) {
      reasons.push('method wildcard with credentials');
    }
  }

  if (requestHeaders.length) {
    const acah = headerValue(headers, 'access-control-allow-headers');
    const allowedHeaders = splitHeaderList(acah);
    if (allowedHeaders.includes('*')) {
      if (credentials) reasons.push('header wildcard with credentials');
    } else {
      for (const name of requestHeaders) {
        if (!allowedHeaders.includes(name)) reasons.push(`header ${name} not allowed`);
      }
    }
  }

  if (credentials && headerValue(headers, 'access-control-allow-credentials') !== 'true') {
    reasons.push('Access-Control-Allow-Credentials true required');
  }

  return { allowed: reasons.length === 0, reasons };
}

function accessControlHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === 'function' ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    const lower = String(key).toLowerCase();
    if (lower.startsWith('access-control-')) out[lower] = String(value);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function persistedResponse(response) {
  return { status: response.status, headers: accessControlHeaders(response.headers) };
}

async function safeFetch(fetchImpl, url, init) {
  try {
    const response = await fetchImpl(url, init);
    return { response: await persistedResponse(response), errorReason: null };
  } catch (error) {
    return { response: { status: 0, headers: {} }, errorReason: `network error: ${error.message}` };
  }
}

export async function probeCors(endpoint, origin, needs, { fetchImpl = fetch } = {}) {
  const url = normalizeEndpoint(endpoint);
  const preflightHeaders = {
    Origin: origin,
    'Access-Control-Request-Method': normalizeMethod(needs.method),
  };
  if (needs.headers?.length) preflightHeaders['Access-Control-Request-Headers'] = uniqueSorted(needs.headers).join(', ');

  const preflight = await safeFetch(fetchImpl, url, {
    method: 'OPTIONS',
    headers: preflightHeaders,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  let actual = null;
  let actualError = null;
  if (normalizeMethod(needs.method) === 'GET' && needs.actualGet !== false) {
    const actualFetch = await safeFetch(fetchImpl, url, {
      method: 'GET',
      headers: { Origin: origin },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    actual = actualFetch.response;
    actualError = actualFetch.errorReason;
  }

  return {
    preflight: preflight.response,
    actual,
    ...(preflight.errorReason ? { preflightError: preflight.errorReason } : {}),
    ...(actualError ? { actualError } : {}),
  };
}

function evaluateActualCors(response, needs, errorReason = null) {
  if (!response) return { allowed: true, reasons: [] };
  if (errorReason) return { allowed: false, reasons: [errorReason] };
  const reasons = [];
  originAllowed(headerValue(response.headers, 'access-control-allow-origin'), needs.origin, needs.credentials, reasons);
  if (needs.credentials && headerValue(response.headers, 'access-control-allow-credentials') !== 'true') {
    reasons.push('Access-Control-Allow-Credentials true required');
  }
  return { allowed: reasons.length === 0, reasons };
}

function evaluateSimpleFromPreflightHeaders(response, needs, errorReason = null) {
  if (errorReason) return { allowed: false, reasons: [errorReason, 'judged from preflight headers (no real request sent)'] };
  const reasons = [];
  originAllowed(headerValue(response?.headers || {}, 'access-control-allow-origin'), needs.origin, needs.credentials, reasons);
  if (needs.credentials && headerValue(response?.headers || {}, 'access-control-allow-credentials') !== 'true') {
    reasons.push('Access-Control-Allow-Credentials true required');
  }
  reasons.push('judged from preflight headers (no real request sent)');
  return { allowed: reasons.length === 1, reasons };
}

function evaluateProbe(probe, needs) {
  if (!needsPreflight(needs)) {
    if (normalizeMethod(needs.method) === 'GET' && probe.actual) {
      return evaluateActualCors(probe.actual, needs, probe.actualError);
    }
    return evaluateSimpleFromPreflightHeaders(probe.preflight, needs, probe.preflightError);
  }

  if (probe.preflightError) return { allowed: false, reasons: [probe.preflightError] };
  const preflight = evaluateCors(probe.preflight, needs);
  if (!preflight.allowed) return preflight;
  const actual = evaluateActualCors(probe.actual, needs, probe.actualError);
  return {
    allowed: actual.allowed,
    reasons: actual.reasons.map((reason) => `actual ${reason}`),
  };
}

function contractPath(dir, integration) {
  return join(dir, integration.contract || `contracts/${integration.id}.json`);
}

function nextStatus(contract, blocked) {
  if (blocked) return 'blocked-cors';
  if (contract.status === 'blocked-cors') return contract.confirmed === false ? 'detected' : 'contracted';
  return contract.status;
}

function originMatches(endpoint, origin) {
  return new URL(endpoint).origin === origin;
}

function allowsActualGet(contract) {
  const kind = String(contract.kind || '').toLowerCase();
  const graphqlType = String(contract.graphql?.type || '').toLowerCase();
  if (kind.includes('write') || kind.includes('mutation') || graphqlType === 'mutation') return false;
  return normalizeMethod(contract.method) === 'GET';
}

function mergeOriginResult({ origin, evaluation, probe = null }) {
  return { origin, allowed: evaluation.allowed, reasons: evaluation.reasons, ...(probe || {}) };
}

function usageError() {
  console.error('usage: api-cors.mjs --owner <owner> --repo <repo> --branch <branch> --prod <url> [--dir stardust/api]');
  process.exit(2);
}

export async function runCors({ owner, repo, branch, prod, dir = dirname(ART.cors), fetchImpl = fetch } = {}) {
  const inventoryPath = join(dir, 'inventory.json');
  const inventory = readJSON(inventoryPath);
  const origins = originsFor({ owner, repo, branch, prod });
  const results = [];
  const actionItems = [];
  let blocked = false;

  for (const integration of inventory.integrations || []) {
    const file = contractPath(dir, integration);
    const contract = readJSON(file);
    const endpoint = normalizeEndpoint(contract.endpoint || integration.endpoint);
    const needs = { ...requestNeeds(contract), actualGet: allowsActualGet(contract) };
    const originResults = {};

    for (const { label, origin } of origins) {
      const needsForOrigin = { ...needs, origin };
      let evaluation;
      let probe = null;
      if (label === 'production' && originMatches(endpoint, origin)) {
        evaluation = { allowed: true, reasons: ['same-origin'] };
        probe = { preflight: null, actual: null };
      } else {
        const probed = await probeCors(endpoint, origin, needs, { fetchImpl });
        evaluation = evaluateProbe(probed, needsForOrigin);
        probe = { preflight: probed.preflight, actual: probed.actual };
      }
      originResults[label] = mergeOriginResult({ origin, evaluation, probe });
      if ((label === 'preview' || label === 'live') && !evaluation.allowed) {
        blocked = true;
        actionItems.push(`Allow origin ${origin} for ${needs.method} ${endpoint} with headers ${needs.headers.length ? needs.headers.join(',') : 'none'}`);
      }
    }

    contract.cors = Object.fromEntries(Object.entries(originResults).map(([label, result]) => [label, {
      allowed: result.allowed,
      reasons: result.reasons,
    }]));
    contract.status = nextStatus(contract, !originResults.preview.allowed || !originResults.live.allowed);
    integration.status = contract.status;
    integration.cors = contract.cors;
    writeJSON(file, contract);

    results.push({
      id: contract.id || integration.id,
      endpoint,
      method: needs.method,
      origins: originResults,
    });
  }

  const artifact = { _provenance: provenance('api-cors'), results };
  await mkdir(dir, { recursive: true });
  writeJSON(join(dir, 'cors.json'), artifact);
  writeJSON(inventoryPath, inventory);
  return { blocked, actionItems, artifact };
}

async function main() {
  printHelpIfAsked(import.meta.url);
  const owner = arg('owner');
  const repo = arg('repo');
  const branch = arg('branch');
  const prod = arg('prod');
  const dir = arg('dir') || dirname(ART.cors);
  if (!owner || !repo || !branch || !prod) usageError();
  const result = await runCors({ owner, repo, branch, prod, dir });
  for (const item of result.actionItems) console.log(item);
  process.exit(result.blocked ? 1 : 0);
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
