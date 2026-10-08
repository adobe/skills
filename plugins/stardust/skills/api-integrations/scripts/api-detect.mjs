#!/usr/bin/env node
/**
 * api-detect.mjs — Layer 2 browser API detection with write blocking.
 *
 * Runs Playwright/Chromium against source pages, drives bounded interactions,
 * captures in-scope fetch/XHR and document POST requests, blocks writes, and
 * writes sanitized observations for contract generation.
 *
 *   node scripts/api-detect.mjs --urls <url,url,…> [--read-post <regex,…>] [--headed]
 *   node scripts/api-detect.mjs --from-dynamics stardust/current/_dynamics.json [--probe-writes --confirm "POST /api/path"]
 *   node scripts/api-detect.mjs --from-state stardust/state.json [--probe-writes --confirm "POST /api/path"]
 *
 * Writes: stardust/api/observations.json
 * Exit 0 on completion, 1 on detection failure, 2 on usage / confirmation needed.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax */
import {
  ART,
  CAPS,
  INVALID_DATA,
  arg,
  flag,
  isMain,
  list,
  loadPlaywright,
  pathPattern,
  printHelpIfAsked,
  provenance,
  readJSON,
  settlePage,
  writeJSON,
} from './lib/lib.mjs';
import { classifyRequest, scopeOf } from './lib/classify.mjs';
import { correlate, parseBody } from './lib/shape.mjs';
import { urlsFromDynamics, urlsFromState } from './api-static-scan.mjs';
import { redactPersisted, redactResponseBody, redactText, redactUrl, scrubKnownSecrets } from './lib/detect-redaction.mjs';

import { INIT_SCRIPT, driveInteractions, fieldsFor, fillFields, runAction, submitForm, synthValueFor, uiAfter } from './lib/detect-interactions.mjs';

export { INIT_SCRIPT, synthValueFor } from './lib/detect-interactions.mjs';

function lowerNames(headers = {}) {
  return Object.keys(headers).map((name) => name.toLowerCase()).sort();
}

function authScheme(headers = {}) {
  const value = headers.authorization || headers.Authorization;
  const match = typeof value === 'string' ? value.match(/^\s*([^\s]+)\s+/) : null;
  return match ? match[1] : null;
}

function responseHeaders(headers = {}) {
  const kept = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'content-type' || lower.startsWith('access-control-')) kept[lower] = value;
  }
  return kept;
}

function rawContentType(headers = {}) {
  return headers['content-type'] || headers['Content-Type'] || '';
}

function truncate(value) {
  const text = String(value || '');
  return Buffer.byteLength(text, 'utf8') <= CAPS.responseBytes
    ? text
    : Buffer.from(text).subarray(0, CAPS.responseBytes).toString('utf8');
}

function compileReadPost(readPost = []) {
  return readPost.map((entry) => (entry instanceof RegExp ? entry : new RegExp(String(entry))));
}

export function routeDecision({ method = 'GET', url = '', body = null, contentType = '' } = {}, { pageUrl, readPost = [] } = {}) {
  let scope;
  try {
    scope = scopeOf(url, pageUrl || url);
  } catch {
    return 'continue';
  }
  if (scope.inScope === false) return 'continue';
  return classifyRequest({ method, url, body, contentType }, { readPost }).isWrite ? 'abort' : 'continue';
}

function pathKey(method, url) {
  const parsed = new URL(url);
  return `${String(method || 'GET').toUpperCase()} ${pathPattern(parsed.pathname)}`;
}

function matchesConfirm(confirm, method, url) {
  if (!confirm) return false;
  let key;
  try { key = pathKey(method, url); } catch { return false; }
  return confirm.has(key);
}

async function pageSources(page, context, pageUrl, inputs) {
  const cookies = Object.fromEntries((await context.cookies(pageUrl)).map((cookie) => [cookie.name, cookie.value]));
  const client = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    tokens: (window.__apiProbe && window.__apiProbe.tokens || []).map((token) => ({ ...token })),
  })).catch(() => ({ title: '', href: pageUrl, tokens: [] }));
  return { inputs: [...inputs], cookies, title: client.title, href: client.href, tokens: client.tokens };
}

async function safePageSources(page, context, pageUrl, inputs) {
  const cookies = Object.fromEntries((await context.cookies(pageUrl).catch(() => [])).map((cookie) => [cookie.name, cookie.value]));
  const fallback = { inputs: [...inputs], cookies, title: '', href: pageUrl, tokens: [] };
  if (!page) return fallback;
  let timer;
  try {
    return await Promise.race([
      pageSources(page, context, pageUrl, inputs),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), 500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pathParts(path) {
  return String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function setPath(target, path, value) {
  const parts = pathParts(path);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (current == null || typeof current !== 'object') return;
    current = current[part];
  }
  if (current && typeof current === 'object' && parts.length) current[parts.at(-1)] = value;
}

function sanitizeStructured(value, correlation) {
  const cloned = JSON.parse(JSON.stringify(value));
  const scrubSensitiveKeys = (node) => {
    if (Array.isArray(node)) node.forEach(scrubSensitiveKeys);
    else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (/token|recaptcha/i.test(key) && typeof child === 'string') node[key] = '<recaptcha>';
        else scrubSensitiveKeys(child);
      }
    }
  };
  scrubSensitiveKeys(cloned);
  for (const dep of correlation.clientDeps || []) {
    if (dep.from === 'cookie') setPath(cloned, dep.path, `<cookie:${dep.name}>`);
    else if (String(dep.from || '').startsWith('recaptcha')) setPath(cloned, dep.path, '<recaptcha>');
  }
  return cloned;
}

function sanitizedBody(rawBody, contentType, parsed, correlation, sources) {
  if (!rawBody) return '';
  if (parsed.format === 'json') return truncate(JSON.stringify(redactPersisted(sanitizeStructured(parsed.value, correlation), sources)));
  if (parsed.format === 'form') {
    return truncate(JSON.stringify(redactPersisted(sanitizeStructured(parsed.value, correlation), sources)));
  }
  if (parsed.format === 'multipart') {
    return truncate(JSON.stringify(redactPersisted(parsed.value, sources)));
  }
  return truncate(redactText(rawBody, sources));
}

async function responseRecord(response, sources = {}) {
  const allHeaders = await response.allHeaders().catch(() => response.headers());
  const headers = responseHeaders(allHeaders);
  let body = '';
  try {
    const raw = Buffer.from(await response.body()).subarray(0, CAPS.responseBytes).toString('utf8');
    body = redactResponseBody(raw, allHeaders, sources);
  } catch { body = ''; }
  return { status: response.status(), headers, body };
}

function sanitizeCorrelation(correlation) {
  return {
    fieldMap: (correlation.fieldMap || []).map((entry) => ({ ...entry, value: redactPersisted(entry.value) })),
    clientDeps: (correlation.clientDeps || []).map((entry) => (
      Object.hasOwn(entry, 'value') ? { ...entry, value: redactPersisted(entry.value) } : { ...entry }
    )),
  };
}

function sanitizeGraphql(graphql, sources) {
  if (!Array.isArray(graphql)) return graphql;
  return graphql.map((op) => ({
    operationName: op.operationName,
    type: op.type,
    query: op.query ? redactText(op.query, sources) : op.query,
    variables: op.variables ? redactPersisted(op.variables, sources) : op.variables,
    persistedHash: op.persistedHash,
  }));
}

function invalidFor(entry) {
  const text = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
  if (/email/.test(text)) return INVALID_DATA.email;
  if (/phone|tel/.test(text)) return INVALID_DATA.phone;
  if (/last|family|surname/.test(text)) return INVALID_DATA.lastName;
  if (/company|organisation|organization/.test(text)) return INVALID_DATA.company;
  return INVALID_DATA.firstName;
}

function bodyForProbe(observation) {
  const parsed = parseBody(observation._rawBody, observation.contentType);
  const value = parsed.format === 'json' || parsed.format === 'form' ? JSON.parse(JSON.stringify(parsed.value)) : observation._rawBody;
  if (value && typeof value === 'object') for (const entry of observation.correlation.fieldMap || []) setPath(value, entry.path, invalidFor(entry));
  return { parsed, value };
}

async function mintProbeTokens(page, observation, value) {
  for (const dep of observation.correlation.clientDeps || []) {
    if (!String(dep.from || '').startsWith('recaptcha')) continue;
    const token = await page.evaluate(async ({ siteKey, action }) => {
      if (!window.grecaptcha || typeof window.grecaptcha.execute !== 'function') return '';
      return window.grecaptcha.execute(siteKey, { action });
    }, { siteKey: dep.siteKey, action: dep.action }).catch(() => '');
    setPath(value, dep.path, token);
  }
}

async function probeObservation(page, observation, routingState, filledInputs) {
  const { parsed, value } = bodyForProbe(observation);
  if (value && typeof value === 'object') await mintProbeTokens(page, observation, value);
  const body = parsed.format === 'json' ? JSON.stringify(value) : (parsed.format === 'form' ? new URLSearchParams(value).toString() : String(value || ''));
  const rawUrl = observation._rawUrl || observation.url;
  const key = pathKey(observation.method, rawUrl);

  routingState.mode = 'allow';
  routingState.key = key;
  routingState.remaining = 1;
  const response = await page.evaluate(async ({ url, method, body: requestBody, contentType }) => {
    const resp = await fetch(url, { method, headers: contentType ? { 'content-type': contentType } : {}, body: requestBody });
    return { status: resp.status, headers: Object.fromEntries(resp.headers.entries()), body: await resp.text() };
  }, { url: rawUrl, method: observation.method, body, contentType: observation.contentType }).finally(() => {
    routingState.mode = 'block';
    routingState.remaining = 0;
  });
  const allHeaders = response.headers;
  response.headers = responseHeaders(allHeaders);
  response.body = truncate(redactResponseBody(response.body, allHeaders, observation._sources || {}));
  observation.probe = { response, uiAfter: null };

  const formSelector = observation.trigger?.type === 'submit' ? observation.trigger.selector : null;
  if (formSelector) {
    routingState.mode = 'fulfill';
    routingState.key = key;
    routingState.fulfill = response;
    const fields = await fieldsFor(page, formSelector);
    await fillFields(page, fields, filledInputs);
    await runAction(page, [], { current: observation.trigger }, formSelector, 'submit', () => submitForm(page, formSelector));
    const ui = await uiAfter(page, formSelector);
    observation.probe.uiAfter = ui ? { ...ui, text: redactText(ui.text) } : null;
    routingState.mode = 'block';
    routingState.fulfill = null;
  }
}

function pageForRequest(request, pageRef) {
  try {
    return request.frame()?.page?.() || pageRef.page || null;
  } catch {
    return pageRef.page || null;
  }
}

async function installRouting(context, pageRef, pageUrl, readPost, observations, triggerRef, filledInputs, routingState) {
  const pending = new Map();
  context.on('response', async (response) => {
    const observation = pending.get(response.request());
    if (observation) observation.response = await responseRecord(response, observation._sources);
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = request.url();
    const resourceType = request.resourceType();
    const rawBody = request.postData() || '';
    const headers = await request.allHeaders().catch(() => request.headers());
    const contentType = rawContentType(headers);

    if (routingState.key && matchesConfirm(new Set([routingState.key]), method, url)) {
      if (routingState.mode === 'allow' && routingState.remaining > 0) {
        routingState.remaining -= 1;
        await route.continue();
        return;
      }
      if (routingState.mode === 'fulfill' && routingState.fulfill) {
        await route.fulfill({ status: routingState.fulfill.status, headers: routingState.fulfill.headers, body: routingState.fulfill.body });
        return;
      }
    }

    let scope;
    try { scope = scopeOf(url, pageUrl); } catch { scope = { inScope: false }; }
    const classification = classifyRequest({ method, url, body: rawBody, contentType }, { readPost });
    const shouldAbort = scope.inScope !== false && routeDecision({ method, url, body: rawBody, contentType }, { pageUrl, readPost }) === 'abort';
    const capture = scope.inScope !== false && (shouldAbort || ['fetch', 'xhr'].includes(resourceType) || (resourceType === 'document' && method === 'POST'));
    if (!capture) {
      await route.continue();
      return;
    }

    const parsed = parseBody(rawBody, contentType);
    const sourcePage = pageForRequest(request, pageRef);
    const sources = await safePageSources(sourcePage, context, pageUrl, [...filledInputs.values()]);
    const correlation = correlate(parsed.value, sources);
    const safeCorrelation = sanitizeCorrelation(correlation);
    const observation = {
      id: `obs-${observations.length + 1}`,
      pageUrl: redactUrl(sourcePage?.url?.() || pageUrl, sources),
      trigger: { ...triggerRef.current },
      method,
      url: redactUrl(url, sources),
      resourceType,
      requestHeaderNames: lowerNames(headers),
      authScheme: authScheme(headers),
      contentType,
      body: sanitizedBody(rawBody, contentType, parsed, correlation, sources),
      graphql: sanitizeGraphql(classification.graphql, sources),
      kind: classification.kind,
      isWrite: classification.isWrite,
      aborted: shouldAbort,
      response: null,
      correlation: safeCorrelation,
      dataLayerAfter: [],
      uiAfter: null,
    };
    Object.defineProperty(observation, '_rawBody', { value: rawBody, enumerable: false });
    Object.defineProperty(observation, '_rawUrl', { value: url, enumerable: false });
    Object.defineProperty(observation, '_sources', { value: sources, enumerable: false });
    observations.push(observation);

    if (shouldAbort) await route.abort('blockedbyclient');
    else {
      pending.set(request, observation);
      await route.continue();
    }
  });
}

async function detectPage(browser, url, options) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const pageRef = { page: null };
  const observations = [];
  const filledInputs = new Map();
  const triggerRef = { current: { type: 'load', selector: null } };
  const routingState = { mode: 'block', key: null, remaining: 0, fulfill: null };
  try {
    await context.addInitScript({ content: INIT_SCRIPT });
    await installRouting(context, pageRef, url, options.readPost, observations, triggerRef, filledInputs, routingState);
    const page = await context.newPage();
    pageRef.page = page;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page, { settleMs: 500, maxScroll: 1600 });
    await driveInteractions(page, observations, triggerRef, filledInputs);
    await page.waitForTimeout(250);
    if (options.probeConfirm) {
      if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await settlePage(page, { settleMs: 200, maxScroll: 0 }).catch(() => {});
      }
      const probed = new Set();
      for (const observation of observations.filter((item) => item.isWrite && matchesConfirm(options.probeConfirm, item.method, item._rawUrl || item.url))) {
        const key = pathKey(observation.method, observation._rawUrl || observation.url);
        if (probed.has(key)) continue;
        probed.add(key);
        await probeObservation(page, observation, routingState, filledInputs);
      }
    }
    const finalSources = await safePageSources(page, context, url, [...filledInputs.values()]);
    return observations.map((observation) => scrubKnownSecrets(
      scrubKnownSecrets(observation, observation._sources || {}),
      finalSources,
    ));
  } finally {
    await context.close().catch(() => {});
  }
}

export async function detect({ urls = [], readPost = [], probeConfirm = null, headed = false } = {}) {
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: !headed });
  const compiledReadPost = compileReadPost(readPost);
  const confirmSet = probeConfirm ? new Set(probeConfirm.map((entry) => {
    const [method, ...rest] = String(entry).trim().split(/\s+/);
    const path = rest.join(' ');
    return `${method.toUpperCase()} ${pathPattern(path)}`;
  })) : null;
  const observations = [];
  const errors = [];
  try {
    for (const url of urls) {
      try {
        observations.push(...await detectPage(browser, url, { readPost: compiledReadPost, probeConfirm: confirmSet }));
      } catch (error) {
        const source = { cookies: {}, tokens: [] };
        errors.push(scrubKnownSecrets({
          url: redactUrl(url, source, { stripQueryValues: true }),
          error: redactText(String(error.message || error).slice(0, 500), source, { stripUrlQueryValues: true }),
        }, source));
      }
    }
    return { _provenance: provenance('api-detect', { urls: urls.map((url) => redactUrl(url)) }), observations, errors };
  } finally {
    await browser.close().catch(() => {});
  }
}

function urlsFromArgs() {
  let urls = list(arg('urls', ''));
  if (!urls.length && arg('from-dynamics')) urls = urlsFromDynamics(readJSON(arg('from-dynamics')));
  if (!urls.length && arg('from-state')) urls = urlsFromState(readJSON(arg('from-state')));
  return [...new Set(urls)];
}

function writeEndpoints(report) {
  const seen = new Set();
  for (const observation of report.observations) {
    if (!observation.isWrite) continue;
    const key = pathKey(observation.method, observation.url);
    if (!seen.has(key)) {
      seen.add(key);
      console.log(key);
    }
  }
}

async function main() {
  printHelpIfAsked(import.meta.url);
  const urls = urlsFromArgs();
  if (!urls.length) {
    console.error('usage: api-detect.mjs --urls <url,…> | --from-dynamics <file> | --from-state <file>');
    process.exit(2);
  }
  const probeWrites = flag('probe-writes');
  const confirm = list(arg('confirm', ''));
  const report = await detect({
    urls,
    readPost: list(arg('read-post', '')),
    probeConfirm: probeWrites && confirm.length ? confirm : null,
    headed: flag('headed'),
  });
  writeJSON(ART.observations, report);
  if (probeWrites && !confirm.length) {
    writeEndpoints(report);
    process.exit(2);
  }
  console.error(`[api-integrations] ${report.observations.length} observation(s) → ${ART.observations}`);
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
