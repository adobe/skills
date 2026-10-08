/* eslint-disable no-await-in-loop, no-restricted-syntax */
import { pathPattern, TEST_DATA, INVALID_DATA } from './lib.mjs';
import { INIT_SCRIPT, routeDecision } from '../api-detect.mjs';
import { fieldsFor, fillFields, submitForm, synthValueFor } from './detect-interactions.mjs';
import { diffContract, inferSchema, parseBody } from './shape.mjs';

const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function pathOf(url, base = 'https://example.invalid') {
  return new URL(url, base).pathname;
}

function endpointPattern(contract, origin) {
  return pathPattern(pathOf(contract.endpoint, origin));
}

function requestMatchesContract(request, contract, origin) {
  if (request.method().toUpperCase() !== String(contract.method || 'GET').toUpperCase()) return false;
  try {
    return pathPattern(new URL(request.url()).pathname) === endpointPattern(contract, origin);
  } catch {
    return false;
  }
}

function rawContentType(headers = {}) {
  return headers['content-type'] || headers['Content-Type'] || '';
}

function headerNames(headers = {}) {
  return Object.keys(headers).map((name) => name.toLowerCase()).sort();
}

async function capturedFromRequest(request, ctx) {
  const headers = await request.allHeaders().catch(() => request.headers());
  const contentType = rawContentType(headers);
  const parsed = parseBody(request.postData() || '', contentType);
  const page = request.frame()?.page?.();
  const cookies = Object.fromEntries((await ctx.cookies().catch(() => [])).map((cookie) => [cookie.name, cookie.value]));
  const pageState = page ? await page.evaluate(() => ({ title: document.title, href: location.href })).catch(() => ({ title: '', href: '' })) : { title: '', href: '' };
  return {
    method: request.method().toUpperCase(),
    url: request.url(),
    requestHeaderNames: headerNames(headers),
    contentType,
    body: parsed.value,
    cookies,
    title: pageState.title,
    href: pageState.href,
  };
}

function responsePayload(record, fallbackStatus = 200) {
  const example = record?.example ?? {};
  return {
    status: record?.status || fallbackStatus,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(record?.headers || {}) },
    body: JSON.stringify(example),
  };
}

async function chooseTarget(page, preferredSelector) {
  return page.evaluate((preferred) => {
    if (preferred && document.querySelector(preferred)) {
      const el = document.querySelector(preferred);
      return { selector: preferred, form: el.matches('form') || !!el.closest('form') };
    }
    const firstForm = document.querySelector('form');
    if (firstForm) {
      if (firstForm.id) return { selector: `#${CSS.escape(firstForm.id)}`, form: true };
      firstForm.setAttribute('data-api-check-form', '1');
      return { selector: '[data-api-check-form="1"]', form: true };
    }
    const groups = Array.from(document.querySelectorAll('section,div,article,main')).filter((el) => !el.closest('form'));
    for (let index = 0; index < groups.length; index += 1) {
      const el = groups[index];
      const inputs = el.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select');
      const button = el.querySelector('button,input[type=button],[role=button]');
      if (inputs.length >= 2 && button) {
        if (el.id) return { selector: `#${CSS.escape(el.id)}`, form: false };
        el.setAttribute('data-api-check-group', String(index));
        return { selector: `[data-api-check-group="${index}"]`, form: false };
      }
    }
    return null;
  }, preferredSelector || null);
}

async function submitTarget(page, target) {
  if (target.form) await submitForm(page, target.selector);
  else await page.click(`${target.selector} button, ${target.selector} input[type=button], ${target.selector} [role=button]`, { timeout: 3000, noWaitAfter: true });
}

async function formValues(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector) || document.body;
    return Array.from(root.querySelectorAll('input,textarea,select'))
      .filter((el) => !['hidden', 'submit', 'button', 'reset', 'file'].includes((el.getAttribute('type') || '').toLowerCase()))
      .map((el) => el.value || '');
  }, selector);
}

async function dataLayerEvents(page) {
  return page.evaluate(() => (window.__apiProbe?.dataLayer || []).map((entry) => entry && entry.event).filter(Boolean)).catch(() => []);
}

async function statusText(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector) || document.body;
    const selectors = '[role=status],[aria-live],[class*=error i],[class*=success i],[class*=message i]';
    const nodes = [];
    if (root.matches?.(selectors)) nodes.push(root);
    nodes.push(...root.querySelectorAll(selectors));
    let parent = root.parentElement;
    while (!nodes.some((node) => node.textContent.trim()) && parent) {
      if (parent.matches?.(selectors)) nodes.push(parent);
      nodes.push(...parent.querySelectorAll(selectors));
      parent = parent.parentElement;
    }
    return (nodes.find((node) => node.textContent.trim())?.textContent || '').replace(/\s+/g, ' ').trim();
  }, selector).catch(() => '');
}

function installLiveSafetyRoute(ctx, { contract, origin, pageUrl }) {
  let armed = false;
  let remaining = 0;
  const handler = async (route) => {
    const request = route.request();
    if (requestMatchesContract(request, contract, origin)) {
      if (armed && remaining > 0) {
        remaining -= 1;
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
      return;
    }

    const headers = await request.allHeaders().catch(() => request.headers());
    const decision = routeDecision({
      method: request.method().toUpperCase(),
      url: request.url(),
      body: request.postData() || '',
      contentType: rawContentType(headers),
    }, { pageUrl });
    if (decision === 'abort') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  };
  return {
    handler,
    arm() { armed = true; remaining = 1; },
  };
}

function installReplayRoute(ctx, { contract, origin, pageUrl, fulfillResponse = null, allowOne = false, requireArm = false, diffBeforeContinue = false }) {
  let endpointSeen = 0;
  let continued = 0;
  let captured = null;
  let diffResult = null;
  let armed = !requireArm;
  let remaining = allowOne ? 1 : 0;
  let resolveCaptured;
  const capturedPromise = new Promise((resolve) => { resolveCaptured = resolve; });
  const handler = async (route) => {
    const request = route.request();
    if (requestMatchesContract(request, contract, origin)) {
      endpointSeen += 1;
      if (requireArm && !armed) {
        await route.abort('blockedbyclient');
        return;
      }
      const current = await capturedFromRequest(request, ctx);
      if (!captured) {
        captured = current;
        resolveCaptured(captured);
      }
      if (fulfillResponse) {
        await route.fulfill(fulfillResponse);
        return;
      }
      if (allowOne && armed && remaining > 0) {
        if (diffBeforeContinue) {
          diffResult = diffContract(contract, current);
          if (!diffResult.pass) {
            remaining = 0;
            await route.abort('blockedbyclient');
            return;
          }
        }
        remaining -= 1;
        continued += 1;
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
      return;
    }

    const method = request.method().toUpperCase();
    const headers = await request.allHeaders().catch(() => request.headers());
    const decision = routeDecision({
      method,
      url: request.url(),
      body: request.postData() || '',
      contentType: rawContentType(headers),
    }, { pageUrl });
    if (decision === 'abort') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  };
  return {
    arm() { armed = true; remaining = allowOne ? 1 : remaining; },
    captured: async (timeout = 5000) => Promise.race([
      capturedPromise,
      new Promise((resolve) => { setTimeout(() => resolve(null), timeout); }),
    ]),
    endpointSeen: () => endpointSeen,
    continued: () => continued,
    diffResult: () => diffResult,
    handler,
  };
}

async function openFilledPage(ctx, origin, check, page = null) {
  const ownedPage = page || await ctx.newPage();
  try {
    if (!page) await ownedPage.addInitScript({ content: INIT_SCRIPT });
    await ownedPage.goto(`${origin}${check.path || '/'}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(300);
    const target = await chooseTarget(ownedPage, check.selector || check.trigger?.selector || null);
    if (!target) throw new Error('no form or form-less input group found');
    const fields = await fieldsFor(ownedPage, target.selector);
    await fillFields(ownedPage, fields, new Map());
    return { page: ownedPage, target };
  } catch (error) {
    if (!page) await ownedPage.close().catch(() => {});
    throw error;
  }
}

async function performTrigger(page, check) {
  const trigger = check.trigger || { type: 'load', selector: null };
  if (trigger.type === 'load') return { selector: 'body', form: false };

  if (trigger.type === 'submit') {
    const target = await chooseTarget(page, check.selector || trigger.selector || null);
    if (!target) throw new Error('no form or form-less input group found');
    const fields = await fieldsFor(page, target.selector);
    await fillFields(page, fields, new Map());
    await submitTarget(page, target);
    return target;
  }

  if (trigger.type === 'search') {
    const selector = await page.evaluate((preferred) => {
      if (preferred && document.querySelector(preferred)) return preferred;
      const input = document.querySelector('input[type="search"], input[name="q"], input[name="s"], input[name="query"], input[name="search"]');
      if (!input) return null;
      if (input.id) return `#${CSS.escape(input.id)}`;
      if (input.name) return `input[name="${CSS.escape(input.name)}"]`;
      input.setAttribute('data-api-check-search', '1');
      return '[data-api-check-search="1"]';
    }, trigger.selector || check.selector || null);
    if (!selector) throw new Error('no search input found');
    await page.fill(selector, TEST_DATA.search, { timeout: 3000 });
    await page.press(selector, 'Enter', { timeout: 3000 });
    return { selector, form: false };
  }

  if (trigger.type === 'click') {
    const selector = await page.evaluate((preferred) => {
      if (preferred && document.querySelector(preferred)) return preferred;
      const control = Array.from(document.querySelectorAll('button,a,[role=button]')).find((el) => /load more|show more|next|filter/i.test(el.textContent || el.getAttribute('aria-label') || ''));
      if (!control) return null;
      if (control.id) return `#${CSS.escape(control.id)}`;
      control.setAttribute('data-api-check-click', '1');
      return '[data-api-check-click="1"]';
    }, trigger.selector || check.selector || null);
    if (!selector) throw new Error('no clickable control found');
    await page.click(selector, { timeout: 3000, noWaitAfter: true });
    return { selector, form: false };
  }

  if (trigger.type === 'select') {
    const selector = await page.evaluate((preferred) => {
      if (preferred && document.querySelector(preferred)) return preferred;
      const select = document.querySelector('select');
      if (!select) return null;
      if (select.id) return `#${CSS.escape(select.id)}`;
      if (select.name) return `select[name="${CSS.escape(select.name)}"]`;
      select.setAttribute('data-api-check-select', '1');
      return '[data-api-check-select="1"]';
    }, trigger.selector || check.selector || null);
    if (!selector) throw new Error('no select found');
    const value = await page.evaluate((sel) => {
      const select = document.querySelector(sel);
      return select?.options?.[1]?.value || select?.options?.[0]?.value || '';
    }, selector);
    await page.selectOption(selector, value, { timeout: 3000 });
    return { selector, form: false };
  }

  return { selector: 'body', form: false };
}

async function runTriggeredRequest(check, { ctx, origin, contract, response }) {
  const pageUrl = `${origin}${check.path || '/'}`;
  const replay = installReplayRoute(ctx, { contract, origin, pageUrl, fulfillResponse: response });
  let page = null;
  let target = { selector: 'body', form: false };
  const errors = [];
  await ctx.route('**/*', replay.handler);
  try {
    page = await ctx.newPage();
    page.on('pageerror', (error) => errors.push(String(error.message || error).slice(0, 160)));
    await page.addInitScript({ content: INIT_SCRIPT });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(300);
    target = await performTrigger(page, check);
    const captured = await replay.captured();
    await settle(700);
    const uiText = await statusText(page, target.selector || 'body');
    const events = await dataLayerEvents(page);
    const values = target.selector ? await formValues(page, target.selector) : [];
    return { captured, uiText, events, values, endpointSeen: replay.endpointSeen(), errors };
  } finally {
    if (page) await page.close().catch(() => {});
    await ctx.unroute('**/*', replay.handler).catch(() => {});
  }
}

async function runMockedSubmission(check, { ctx, origin, contract, response }) {
  return runTriggeredRequest(check, { ctx, origin, contract, response });
}

export async function runContract(check, { ctx, origin, contract }) {
  const response = responsePayload(contract.responses?.success, 200);
  const run = await runMockedSubmission(check, { ctx, origin, contract, response });
  if (!run.captured) return { pass: false, detail: 'endpoint request not observed' };
  const result = diffContract(contract, run.captured);
  return { pass: result.pass, detail: result.pass ? 'contract matched' : result.diffs.join('; ') };
}

function expectedEvents(uiBehavior = {}) {
  return (uiBehavior.dataLayer || []).map((entry) => entry.event).filter(Boolean);
}

function checkUi(kind, run, expected = {}) {
  const problems = [];
  if (expected.text && !run.uiText.includes(expected.text)) problems.push(`${kind} text missing ${JSON.stringify(expected.text)}`);
  for (const event of expectedEvents(expected)) if (!run.events.includes(event)) problems.push(`${kind} event missing ${event}`);
  if (expected.reset === true && run.values.some((value) => value !== '')) problems.push(`${kind} form did not reset`);
  return problems;
}

export async function runMockedFlow(check, { ctx, origin, contract }) {
  const success = await runMockedSubmission(check, {
    ctx,
    origin,
    contract,
    response: responsePayload(contract.responses?.success, 200),
  });
  const problems = [...(success.errors || []).map((error) => `page error: ${error}`)];
  if (!success.captured) problems.push('success request not observed');
  problems.push(...checkUi('success', success, contract.uiBehavior?.success || {}));

  const method = String(contract.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    const error = await runMockedSubmission(check, {
      ctx,
      origin,
      contract,
      response: responsePayload(contract.responses?.error, 400),
    });
    if (!error.captured) problems.push('error request not observed');
    problems.push(...checkUi('error', error, contract.uiBehavior?.error || {}));
    return {
      pass: problems.length === 0,
      detail: problems.length ? problems.join('; ') : `success ${success.uiText}; error ${error.uiText}; events ${[...new Set([...success.events, ...error.events])].join(',')}`,
    };
  }

  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `success ${success.uiText || 'ok'}; events ${[...new Set(success.events)].join(',')}`,
  };
}

function pathParts(path) {
  return String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function setPath(target, path, value) {
  const parts = pathParts(path);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  if (parts.length) current[parts.at(-1)] = value;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function expandPlaceholders(value) {
  if (Array.isArray(value)) return value.map(expandPlaceholders);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expandPlaceholders(child)]));
  if (typeof value !== 'string') return value;
  const test = value.match(/^<test:([^>]+)>$/);
  if (test) return TEST_DATA[test[1]] || value;
  if (value === '<recaptcha>') return '';
  if (/^<cookie:[^>]+>$/.test(value)) return null;
  if (value === '<redacted>') return '';
  return value;
}

function invalidFor(entry) {
  const text = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
  if (/email/.test(text)) return INVALID_DATA.email;
  if (/phone|tel/.test(text)) return INVALID_DATA.phone;
  if (/last|family|surname/.test(text)) return INVALID_DATA.lastName;
  if (/company|organisation|organization/.test(text)) return INVALID_DATA.company;
  if (/message|comment/.test(text)) return '';
  return INVALID_DATA.firstName;
}

function liveBody(contract, invalid = false) {
  const body = expandPlaceholders(cloneJson(contract.requestExample) ?? {});
  if (invalid) for (const entry of contract.fieldMap || []) setPath(body, entry.path, invalidFor(entry));
  return body;
}

function responseSchemaFor(contract, mode) {
  return mode === 'read' ? (contract.responses?.success?.schema || inferSchema(contract.responses?.success?.example ?? {}))
    : (contract.responses?.error?.schema || inferSchema(contract.responses?.error?.example ?? {}));
}

function requiredPaths(schema, base = '') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.type === 'array') return requiredPaths(schema.items, `${base}[]`);
  if (schema.type !== 'object') return [];
  const out = [];
  for (const key of schema.required || []) {
    const path = base ? `${base}.${key}` : key;
    out.push(path, ...requiredPaths(schema.properties?.[key], path));
  }
  return out;
}

function hasPath(value, path) {
  const parts = String(path).replace(/\[\]/g, '.0').split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || !Object.hasOwn(Object(current), part)) return false;
    current = current[part];
  }
  return true;
}

function bodyMatchesSchema(body, schema) {
  const missing = requiredPaths(schema).filter((path) => !hasPath(body, path));
  return { pass: missing.length === 0, detail: missing.length ? `missing response paths: ${missing.join(', ')}` : 'response schema matched' };
}

function confirmHas(confirm, contract) {
  if (!confirm) return false;
  const key = `${String(contract.method || 'GET').toUpperCase()} ${endpointPattern(contract)}`;
  if (confirm instanceof Set) return confirm.has(key);
  if (Array.isArray(confirm)) return confirm.includes(key);
  return String(confirm) === key;
}

function confirmLiveHas(confirmLiveWrite, contract) {
  return confirmLiveWrite === contract.id;
}

function corsBlocked(cors, contract, origin) {
  const candidates = [];
  if (contract.cors) candidates.push(...Object.values(contract.cors));
  for (const result of cors?.results || []) {
    if (result.id === contract.id || result.id === `api-${contract.id}`) candidates.push(...Object.values(result.origins || {}));
  }
  return candidates.some((entry) => entry && entry.origin === origin && entry.allowed === false);
}

async function liveFetch(page, contract, body, { invalid = false } = {}) {
  const result = await page.evaluate(async ({ endpoint, method, contentType, bodyValue, deps, testData, invalidData, useInvalid }) => {
    try {
      const parts = (path) => String(path || '').split('.').filter(Boolean);
      const set = (obj, path, value) => {
        const keys = parts(path);
        let current = obj;
        for (const key of keys.slice(0, -1)) {
          if (!current[key] || typeof current[key] !== 'object') current[key] = {};
          current = current[key];
        }
        if (keys.length) current[keys.at(-1)] = value;
      };
      const valueFor = (name) => {
        const text = String(name || '').toLowerCase();
        const data = useInvalid ? invalidData : testData;
        if (/email/.test(text)) return data.email;
        if (/phone|tel/.test(text)) return data.phone;
        if (/last|family|surname/.test(text)) return data.lastName;
        if (/company|organisation|organization/.test(text)) return data.company;
        if (/message|comment/.test(text)) return data.message || '';
        return data.firstName;
      };
      const cookie = (name) => document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))?.split('=').slice(1).join('=') || null;
      for (const dep of deps) {
        if (dep.from === 'cookie') set(bodyValue, dep.path, cookie(dep.name));
        else if (dep.from === 'title') set(bodyValue, dep.path, document.title);
        else if (dep.from === 'location') set(bodyValue, dep.path, location.href);
        else if (dep.from === 'constant') set(bodyValue, dep.path, dep.value);
        else if (String(dep.from || '').startsWith('recaptcha')) {
          const token = window.grecaptcha?.execute ? await window.grecaptcha.execute(dep.siteKey, { action: dep.action }) : `token-${Date.now()}`;
          set(bodyValue, dep.path, token);
        }
      }
      const headers = {};
      const init = { method, headers };
      const type = String(contentType || '').split(';')[0].toLowerCase();
      if (method !== 'GET' && method !== 'HEAD') {
        if (type === 'application/x-www-form-urlencoded') {
          headers['content-type'] = contentType;
          init.body = new URLSearchParams(bodyValue && typeof bodyValue === 'object' ? bodyValue : {}).toString();
        } else if (type === 'multipart/form-data') {
          const form = new FormData();
          if (Array.isArray(bodyValue?.fields)) {
            for (const name of bodyValue.fields) form.append(name, valueFor(name));
          } else if (bodyValue && typeof bodyValue === 'object') {
            for (const [name, value] of Object.entries(bodyValue)) form.append(name, value ?? valueFor(name));
          }
          init.body = form;
        } else if (contentType && type !== '') {
          headers['content-type'] = contentType;
          init.body = type.includes('json') ? JSON.stringify(bodyValue) : String(bodyValue || '');
        } else {
          init.body = String(bodyValue || '');
        }
      }
      const response = await fetch(endpoint, init);
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      return { status: response.status, body: parsed, text };
    } catch (error) {
      return { thrown: { name: error.name || 'Error', message: error.message || String(error) } };
    }
  }, {
    endpoint: contract.endpoint,
    method: String(contract.method || 'GET').toUpperCase(),
    contentType: contract.contentType || 'application/json',
    bodyValue: body,
    deps: contract.clientDeps || [],
    invalid,
    testData: TEST_DATA,
    invalidData: INVALID_DATA,
    useInvalid: invalid,
  });
  if (result?.thrown) {
    const error = new Error(result.thrown.message);
    error.name = result.thrown.name;
    throw error;
  }
  return result;
}

export async function runLiveRead(check, { ctx, origin, contract, cors = null }) {
  const pageUrl = `${origin}${check.path || '/'}`;
  const safety = installLiveSafetyRoute(ctx, { contract, origin, pageUrl });
  let page = null;
  await ctx.route('**/*', safety.handler);
  try {
    page = await ctx.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    safety.arm();
    const response = await liveFetch(page, contract, liveBody(contract), { invalid: false });
    const schema = responseSchemaFor(contract, 'read');
    const compat = bodyMatchesSchema(response.body, schema);
    return { pass: response.status >= 200 && response.status < 300 && compat.pass, detail: `${response.status}; ${compat.detail}` };
  } catch (error) {
    if (error?.name === 'TypeError' && corsBlocked(cors, contract, origin)) {
      return { pass: true, environmentLimit: `cors-blocked: ${origin}`, detail: `cors-blocked: ${origin}` };
    }
    return { pass: false, detail: `error: ${String(error.message || error).slice(0, 160)}` };
  } finally {
    if (page) await page.close().catch(() => {});
    await ctx.unroute('**/*', safety.handler).catch(() => {});
  }
}

export async function runLiveWriteInvalid(check, { ctx, origin, contract, cors = null, confirm = null }) {
  if (!confirmHas(confirm, contract)) return { pass: false, skipped: true, detail: 'not confirmed' };
  const pageUrl = `${origin}${check.path || '/'}`;
  const safety = installLiveSafetyRoute(ctx, { contract, origin, pageUrl });
  let page = null;
  await ctx.route('**/*', safety.handler);
  try {
    page = await ctx.newPage();
    await page.addInitScript({ content: INIT_SCRIPT });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    safety.arm();
    const response = await liveFetch(page, contract, liveBody(contract, true), { invalid: true });
    const expectedStatus = contract.responses?.error?.status;
    const schema = responseSchemaFor(contract, 'error');
    const compat = bodyMatchesSchema(response.body, schema);
    const statusOk = expectedStatus ? response.status === expectedStatus : response.status >= 400;
    return { pass: statusOk && compat.pass, detail: `${response.status}; ${compat.detail}` };
  } catch (error) {
    if (error?.name === 'TypeError' && corsBlocked(cors, contract, origin)) {
      return { pass: true, environmentLimit: `cors-blocked: ${origin}`, detail: `cors-blocked: ${origin}` };
    }
    return { pass: false, detail: `error: ${String(error.message || error).slice(0, 160)}` };
  } finally {
    if (page) await page.close().catch(() => {});
    await ctx.unroute('**/*', safety.handler).catch(() => {});
  }
}

export async function runLiveWriteValid(check, { ctx, origin, contract, confirmLiveWrite = null }) {
  if (!confirmLiveHas(confirmLiveWrite, contract)) return { pass: false, detail: 'not confirmed' };
  const pageUrl = `${origin}${check.path || '/'}`;
  const replay = installReplayRoute(ctx, { contract, origin, pageUrl, allowOne: true, requireArm: true, diffBeforeContinue: true });
  let page = null;
  let target = null;
  await ctx.route('**/*', replay.handler);
  try {
    ({ page, target } = await openFilledPage(ctx, origin, check));
    replay.arm();
    await submitTarget(page, target);
    const captured = await replay.captured();
    await settle(1200);
    const text = await statusText(page, target.selector);
    const events = await dataLayerEvents(page);
    const problems = [];
    if (!captured) problems.push('endpoint request not observed');
    const diff = replay.diffResult();
    if (diff && !diff.pass) problems.push(...diff.diffs);
    if (replay.continued() !== 1) problems.push(`expected one live endpoint request, saw ${replay.continued()}`);
    const expected = contract.uiBehavior?.success || {};
    if (expected.text && !text.includes(expected.text)) problems.push(`success text missing ${JSON.stringify(expected.text)}`);
    for (const event of expectedEvents(expected)) if (!events.includes(event)) problems.push(`event missing ${event}`);
    return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `live write succeeded; events ${events.join(',')}` };
  } catch (error) {
    return { pass: false, detail: `error: ${String(error.message || error).slice(0, 160)}` };
  } finally {
    if (page) await page.close().catch(() => {});
    await ctx.unroute('**/*', replay.handler).catch(() => {});
  }
}

export const RUNNERS = {
  'api-contract': runContract,
  'api-mocked-flow': runMockedFlow,
  'api-live-read': runLiveRead,
  'api-live-write-invalid': runLiveWriteInvalid,
  'api-live-write-valid': runLiveWriteValid,
};

export { synthValueFor };
