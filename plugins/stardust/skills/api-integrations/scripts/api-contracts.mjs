#!/usr/bin/env node
/**
 * api-contracts.mjs — Build API integration contracts, Block Party matches, and reports.
 *
 * Groups browser observations with static scan candidates, writes one contract
 * per integration, ranks AEM Block Party matches, and produces inventory,
 * Markdown, and HTML reports.
 *
 *   node scripts/api-contracts.mjs --observations stardust/api/observations.json --static stardust/api/static-candidates.json --out stardust/api [--fixture id=file] [--offline]
 *
 * Writes: contracts/<id>.json, inventory.json, report.md, report.html
 * Exit 0 on completion, 1 on runtime failure, 2 on usage.
 */
/* eslint-disable no-await-in-loop */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  TEST_DATA,
  WRITE_METHODS,
  arg,
  flag,
  isMain,
  pathPattern,
  printHelpIfAsked,
  provenance,
  readJSON,
  slug,
  writeJSON,
  writeText,
} from './lib/lib.mjs';
import { classifyRequest, scopeOf } from './lib/classify.mjs';
import { inferSchema, mergeSchemas, parseBody, redact } from './lib/shape.mjs';
import { loadBlockPartyIndex, rankBlockParty, termsFor } from './lib/block-party.mjs';
import { ownerActions, renderHtml, renderMarkdown } from './lib/api-report.mjs';

export { loadBlockPartyIndex, rankBlockParty, termsFor } from './lib/block-party.mjs';
export { renderHtml, renderMarkdown } from './lib/api-report.mjs';

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function lowerKebab(text) {
  return slug(String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-'));
}

function safeUrl(endpoint, base) {
  try {
    return new URL(endpoint, base).href;
  } catch {
    return endpoint || '';
  }
}

function parsedUrl(endpoint, base) {
  try {
    return new URL(endpoint, base);
  } catch {
    return null;
  }
}

function displayEndpoint(endpoint) {
  const parsed = parsedUrl(endpoint);
  return parsed ? `${parsed.pathname}${parsed.search}` : (endpoint || '');
}

function firstGraphqlOperation(source) {
  const op = Array.isArray(source?.graphql) ? source.graphql[0] : source?.graphql;
  if (!op) return null;
  return {
    operationName: op.operationName ?? op.name ?? null,
    type: op.type ?? null,
    variables: op.variables ?? null,
    persistedHash: op.persistedHash ?? null,
  };
}

function candidateGraphqlOperation(candidate) {
  const op = candidate?.graphqlOperation;
  return op ? {
    operationName: op.name ?? op.operationName ?? null,
    type: op.type ?? null,
    variables: op.variables ?? null,
    persistedHash: op.persistedHash ?? null,
  } : null;
}

function keyFor({ endpoint, method, pageUrl, graphql }) {
  const url = parsedUrl(endpoint, pageUrl);
  const host = url?.host || '';
  const pattern = url ? pathPattern(url.pathname) : pathPattern(endpoint || '');
  const opName = graphql?.operationName || '';
  return {
    host,
    method: method ? String(method).toUpperCase() : null,
    pattern,
    opName,
    value: `${host}|${method ? String(method).toUpperCase() : ''}|${pattern}|${opName}`,
  };
}

function pathSegmentForId(endpoint, pageUrl) {
  const url = parsedUrl(endpoint, pageUrl);
  const path = url?.pathname || String(endpoint || '').split('?')[0];
  const parts = path.split('/').filter(Boolean).filter((part) => (
    !/^\{.+\}$/.test(part) && !/^:.+/.test(part) && !/^\[.+\]$/.test(part) && part !== '*'
  ));
  return parts.at(-1) || 'integration';
}

export function integrationId(op, taken = new Set()) {
  const graphqlName = op?.graphql?.operationName || op?.operationName;
  const base = lowerKebab(graphqlName || pathSegmentForId(op?.endpoint || op?.url, op?.pageUrl));
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const method = String(op?.method || '').toLowerCase();
  if (method) {
    const withMethod = `${base}-${method}`;
    if (!taken.has(withMethod)) {
      taken.add(withMethod);
      return withMethod;
    }
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function normalizeCandidateInputs(candidates = []) {
  const out = [];
  for (const item of candidates || []) {
    if (Array.isArray(item?.candidates)) {
      for (const candidate of item.candidates) {
        out.push({ ...candidate, pageUrl: item.url, pageErrors: item.errors || [] });
      }
    } else if (item) {
      out.push(item);
    }
  }
  return out;
}

function candidateMatchesGroup(candidate, group) {
  const ckey = candidate._key;
  if (!ckey || ckey.host !== group.key.host || ckey.pattern !== group.key.pattern) return false;
  if (ckey.method && group.key.method && ckey.method !== group.key.method) return false;
  if (ckey.opName && group.key.opName && ckey.opName !== group.key.opName) return false;
  if (ckey.opName && !group.key.opName) return false;
  return true;
}

export function groupObservations(observations = [], candidates = []) {
  const groups = [];
  const taken = new Set();
  const findByKey = (key) => groups.find((group) => group.key.value === key.value);
  const addPage = (group, page) => {
    if (page && !group.pages.includes(page)) group.pages.push(page);
  };

  for (const observation of observations || []) {
    const graphql = firstGraphqlOperation(observation);
    const key = keyFor({ endpoint: observation.url, method: observation.method, pageUrl: observation.pageUrl, graphql });
    let group = findByKey(key);
    if (!group) {
      const op = { endpoint: observation.url, method: observation.method, pageUrl: observation.pageUrl, graphql };
      group = { id: integrationId(op, taken), key, observations: [], candidates: [], pages: [] };
      groups.push(group);
    }
    group.observations.push(observation);
    addPage(group, observation.pageUrl);
  }

  for (const rawCandidate of normalizeCandidateInputs(candidates)) {
    const endpoint = safeUrl(rawCandidate.endpoint, rawCandidate.pageUrl || rawCandidate.source);
    const graphql = candidateGraphqlOperation(rawCandidate);
    const candidate = {
      ...rawCandidate,
      endpoint,
      graphqlOperation: rawCandidate.graphqlOperation || null,
      _key: keyFor({ endpoint, method: rawCandidate.method, pageUrl: rawCandidate.pageUrl, graphql }),
    };
    let group = groups.find((entry) => candidateMatchesGroup(candidate, entry));
    if (!group) {
      const method = candidate.method ? String(candidate.method).toUpperCase() : null;
      const key = keyFor({ endpoint, method, pageUrl: candidate.pageUrl, graphql });
      const op = { endpoint, method, pageUrl: candidate.pageUrl, graphql };
      group = { id: integrationId(op, taken), key, observations: [], candidates: [], pages: [] };
      groups.push(group);
    }
    group.candidates.push(candidate);
    addPage(group, candidate.pageUrl);
  }

  for (const group of groups) group.pages.sort();
  return groups;
}

function parsedBodyValue(observation) {
  const parsed = parseBody(observation?.body || '', observation?.contentType || '');
  return parsed.value;
}

function schemaForObservations(observations) {
  let schema = {};
  for (const observation of observations) {
    const value = parsedBodyValue(observation);
    if (value === null || value === undefined || value === '') continue;
    schema = mergeSchemas(schema, inferSchema(value));
  }
  return schema;
}

function firstBodyExample(observations) {
  const first = observations.find((observation) => observation.body);
  return first ? redact(parsedBodyValue(first)) : null;
}

function unredactTestValue(value) {
  const match = typeof value === 'string' ? value.match(/^<test:([^>]+)>$/) : null;
  return match && Object.hasOwn(TEST_DATA, match[1]) ? TEST_DATA[match[1]] : value;
}

function dedupeObjects(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function collectFieldMap(observations) {
  return dedupeObjects(observations.flatMap((observation) => (
    observation.correlation?.fieldMap || []
  )).map((entry) => ({ ...entry, value: unredactTestValue(entry.value) })));
}

function collectClientDeps(observations) {
  return dedupeObjects(observations.flatMap((observation) => observation.correlation?.clientDeps || []));
}

function parseResponseBody(response) {
  const body = response?.body ?? '';
  if (body === '' || body === null || body === undefined) return null;
  const contentType = response?.headers?.['content-type'] || response?.headers?.['Content-Type'] || '';
  if (String(contentType).toLowerCase().includes('json')) {
    try {
      return JSON.parse(body);
    } catch {
      return String(body);
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return String(body);
  }
}

function responseRecord(response) {
  if (!response) return null;
  const example = parseResponseBody(response);
  return {
    status: response.status,
    headers: response.headers || {},
    schema: example === null ? {} : inferSchema(example),
    example,
  };
}

function successResponse(group, fixtures) {
  if (fixtures[group.id]) return responseRecord(fixtures[group.id]);
  const observed = group.observations.find((observation) => observation.response?.status >= 200 && observation.response.status < 300);
  return responseRecord(observed?.response);
}

function errorResponse(group) {
  const probed = group.observations.find((observation) => observation.probe?.response)?.probe?.response;
  if (probed) return responseRecord(probed);
  const observed = group.observations.find((observation) => observation.response?.status >= 400)?.response;
  return responseRecord(observed);
}

function uiBehaviorFor(group, kind) {
  const source = kind === 'error'
    ? group.observations.find((observation) => observation.probe?.uiAfter || observation.uiAfter)
    : group.observations.find((observation) => observation.response?.status >= 200 && observation.response.status < 300 && observation.uiAfter);
  const ui = kind === 'error' ? (source?.probe?.uiAfter || source?.uiAfter) : source?.uiAfter;
  if (!ui) return null;
  return {
    text: ui.text || '',
    reset: Boolean(ui.reset),
    dataLayer: source?.dataLayerAfter || [],
  };
}

function deriveAuth(observations) {
  const headerNames = unique(observations.flatMap((observation) => observation.requestHeaderNames || [])).map((name) => String(name).toLowerCase()).sort();
  const authSchemes = observations.map((observation) => String(observation.authScheme || '').toLowerCase()).filter(Boolean);
  let scheme = 'none';
  if (headerNames.some((name) => /api[-_]?key|x-api/i.test(name))) scheme = 'api-key';
  else if (authSchemes.length || headerNames.includes('authorization')) scheme = 'bearer';
  else if (headerNames.includes('cookie')) scheme = 'cookie';
  return { scheme, headerNames };
}

function kindFor({ method, graphql, observation }) {
  if (observation?.kind) return observation.kind;
  if (graphql) return graphql.type === 'mutation' ? 'graphql-mutation' : 'graphql-query';
  return WRITE_METHODS.includes(String(method || 'GET').toUpperCase()) ? 'rest-write' : 'rest-read';
}

function originFor(endpoint, page) {
  try {
    return scopeOf(endpoint, page || endpoint).origin;
  } catch {
    return 'third-party';
  }
}

function triggerFor(group) {
  return group.observations[0]?.trigger || {
    type: group.candidates[0] ? 'static' : 'load',
    selector: null,
    via: group.candidates[0]?.via,
  };
}

export function buildContract(group, { fixtures = {} } = {}) {
  const observation = group.observations[0] || null;
  const candidate = group.candidates[0] || null;
  const graphql = firstGraphqlOperation(observation) || candidateGraphqlOperation(candidate);
  const endpoint = observation?.url || candidate?.endpoint || '';
  const method = observation?.method || candidate?.method || (graphql ? null : 'GET');
  const clientDeps = collectClientDeps(group.observations);
  const auth = deriveAuth(group.observations);
  const confirmed = group.observations.length > 0;
  const bodyForClassification = observation?.body || '';
  const classification = graphql && observation
    ? classifyRequest({ method, url: endpoint, body: bodyForClassification, contentType: observation.contentType })
    : null;

  return {
    id: group.id,
    endpoint,
    method,
    contentType: observation?.contentType || null,
    graphql,
    kind: kindFor({ method, graphql, observation: classification ? { kind: classification.kind } : observation }),
    origin: originFor(endpoint, group.pages[0]),
    trigger: triggerFor(group),
    pages: group.pages,
    reach: group.pages.length,
    auth,
    requestSchema: schemaForObservations(group.observations),
    requestExample: firstBodyExample(group.observations),
    fieldMap: collectFieldMap(group.observations),
    clientDeps,
    responses: {
      success: successResponse(group, fixtures),
      error: errorResponse(group),
    },
    uiBehavior: {
      success: uiBehaviorFor(group, 'success'),
      error: uiBehaviorFor(group, 'error'),
    },
    blockParty: [],
    status: confirmed ? 'contracted' : 'detected',
    confirmed,
    cors: null,
  };
}

function fixtureArgs() {
  const out = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--fixture' && process.argv[i + 1]) out.push(process.argv[i + 1]);
    else if (process.argv[i].startsWith('--fixture=')) out.push(process.argv[i].slice('--fixture='.length));
  }
  return out;
}

function loadFixtures() {
  const fixtures = {};
  for (const entry of fixtureArgs()) {
    const separator = entry.indexOf('=');
    const id = separator >= 0 ? entry.slice(0, separator) : '';
    const file = separator >= 0 ? entry.slice(separator + 1) : '';
    if (!id || !file) throw new Error(`invalid --fixture ${entry}; expected id=file`);
    fixtures[id] = readJSON(file);
  }
  return fixtures;
}

function staticErrors(staticReport) {
  return (staticReport.pages || []).flatMap((page) => (page.errors || []).map((error) => ({ url: page.url, error })));
}

function inventoryEntry(contract) {
  let inspect = false;
  try { inspect = scopeOf(contract.endpoint, contract.pages[0] || contract.endpoint).inspect; } catch { inspect = false; }
  return {
    id: contract.id,
    kind: contract.kind,
    method: contract.method,
    endpoint: contract.endpoint,
    origin: contract.origin,
    pages: contract.pages,
    status: contract.status,
    confirmed: contract.confirmed,
    auth: contract.auth,
    trigger: contract.trigger,
    blockParty: contract.blockParty,
    contract: `contracts/${contract.id}.json`,
    inspect,
  };
}

async function main() {
  printHelpIfAsked(import.meta.url);
  const observationsFile = arg('observations');
  const staticFile = arg('static');
  const out = arg('out');
  if (!observationsFile || !staticFile || !out) {
    console.error('usage: api-contracts.mjs --observations <file> --static <file> --out <dir> [--fixture id=file] [--offline]');
    process.exit(2);
  }

  const observationReport = readJSON(observationsFile);
  const staticReport = readJSON(staticFile);
  const fixtures = loadFixtures();
  const blockPartyEntries = await loadBlockPartyIndex({ offline: flag('offline') });
  const groups = groupObservations(observationReport.observations || [], staticReport.pages || []);
  const contractsDir = join(out, 'contracts');
  await mkdir(contractsDir, { recursive: true });
  const integrations = [];
  for (const group of groups) {
    const contract = buildContract(group, { fixtures });
    contract.blockParty = rankBlockParty(blockPartyEntries, termsFor(contract));
    writeJSON(join(contractsDir, `${contract.id}.json`), contract);
    integrations.push(inventoryEntry(contract));
  }

  const inventory = {
    _provenance: provenance('api-contracts'),
    integrations,
    errors: [...(observationReport.errors || []), ...staticErrors(staticReport)],
    blockParty: flag('offline') ? [] : undefined,
    blockPartyUnavailable: Boolean(blockPartyEntries.unavailable),
  };
  inventory.ownerActions = ownerActions(inventory);
  writeJSON(join(out, 'inventory.json'), inventory);
  writeText(join(out, 'report.md'), renderMarkdown(inventory));
  writeText(join(out, 'report.html'), renderHtml(inventory));
  console.error(`[api-integrations] ${integrations.length} integration(s) → ${resolve(out)}`);
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
