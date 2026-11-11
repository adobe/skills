#!/usr/bin/env node
/*
 * Verifies personalization in a real browser against a running preview
 * (aem up or *.aem.page), contract section 11. For each case from
 * simulate.mjs it opens the page with the case's preview query in a fresh
 * browser context and checks: the section's data-pzn-* attributes (variant,
 * outcome, source), its content, that nothing is left hidden, no new console
 * errors, CLS within budget, and the measurement events (pzn:decided and
 * pzn:applied once per decision, valid against the contract schema, with the
 * expected assigned, variant, outcome and result; nothing sent without
 * consent unless an exception allows it). Target sections: display once
 * seen, click on click; popups open at their trigger, are modal and close
 * with Escape.
 *
 * Flags:
 *   --faults         engine / Target failures, reasons and slowness (routed,
 *                    or the in-browser mock's ?pzn-mock knobs)
 *   --refresh        re-evaluation: identical → no events; same variant, new
 *                    payload → new decisionId, unchanged, seen again;
 *                    different variant → the full set
 *   --consent-flow   no consent → defaults, nothing stored or sent; given →
 *                    no-consent sections decided again; withdrawn → defaults
 *                    restored (edge sections too), storage cleared
 *   --split-runs N   split stickiness across reloads and tabs, N fresh draws,
 *                    bots and no-consent visitors not assigned
 *   --scenarios F    replays pilot scenarios (contract pilot/scenarios.json):
 *                    each step's engine answer through the edge code and the
 *                    preview's browser runtime; attributes and events must match
 *   --perf --baseline URL          LCP, CLS and time until the section shows
 *                    against the page before the change (variant, default,
 *                    no-consent and slow-engine cases)
 *   --perf --edge --uncached --baseline URL [--runs 30]   edge latency
 *
 * Usage:
 *   node verify-preview.mjs --page http://localhost:3000/index
 *     [--file content/index.html | --cases cases.json] [--matrix contexts.json]
 *     [--api-decisions decisions.json] [--target activities.json]
 *     [--faults] [--refresh] [--consent-flow] [--split-runs 30] [--scenarios file]
 *     [--perf] [--edge] [--uncached] [--runs 30] [--baseline <url>]
 *     [--revisit] [--screenshots dir] [--ignore-console <regex>] [--repo .] [--json]
 * Exits 1 on any failure, 2 on usage or a missing Playwright. A check that
 * could not run is reported as not run, never as passed.
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PLAYWRIGHT_CACHE, PLAYWRIGHT_INSTALL, exitOnHelp, importAsset, isMain, loadPlaywright, parseArgs,
  readJson, readText, sitePrefixes, status,
} from './lib.mjs';
import { buildCases, simulateEdge } from './simulate.mjs';
import { readSiteConfig } from './validate-placeholders.mjs';
import { check } from './schema.mjs';

export const USAGE = `Usage: node verify-preview.mjs --page http://localhost:3000/<page>
         [--file content/<page>.html | --cases cases.json] [--matrix contexts.json]
         [--api-decisions decisions.json] [--target activities.json]
         [--faults] [--refresh] [--consent-flow] [--split-runs 30] [--scenarios <file>]
         [--perf] [--edge] [--uncached] [--runs 30] [--baseline <url>]
         [--revisit] [--screenshots dir] [--ignore-console <regex>] [--repo .] [--json]
Playwright checks against a running preview (aem up or *.aem.page): each case
shows its expected variant and outcome, renders content, leaves nothing
hidden, logs no new console errors, keeps CLS within budget and sends the
expected pzn:* events once per decision. --faults, --refresh, --consent-flow,
--split-runs, --scenarios and --perf add the contract's other browser checks.
Playwright loads from this skill's folder or ~/.cache/aem-eds-personalization/playwright,
never the site. Exit 1 = a check failed, 2 = usage or Playwright not found.`;

const { engineAnswer, targetAnswer, parseKnob } = await importAsset('runtime', 'scripts', 'personalization', 'mock-engine.js');

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
};
// Headless Chromium announces itself as HeadlessChrome, which the runtime
// treats as a bot; cases browse as regular Chrome unless they test bots.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CLS_BUDGET = 0.1;
const CLS_REGRESSION = 0.02;
const LCP_REGRESSION_MS = 500;
const APPLY_TIMEOUT_MS = 10000;
// The runtime's safety net with the default budgets (lazy 2000 ms + 2 s).
const SAFETY_NET_MS = 4500;
const SLOW_MS = 3500;
const DELIVERY_URL = /\.tt\.omtrdc\.net\/|\/rest\/v1\/delivery/;
export const EVENTS = ['pzn:decided', 'pzn:applied', 'pzn:seen', 'pzn:clicked', 'pzn:notified'];

// Records measurement events, section show times and vitals from page start.
const INIT_SCRIPT = `(() => {
  window.__pzn = { cls: 0, lcp: 0, events: [], shown: {} };
  // Scripted answers for the in-browser mock (config.mock), set before the
  // page loads: handed to window.hlx.personalizationMock when it registers.
  window.hlx = window.hlx || {};
  let mock;
  Object.defineProperty(window.hlx, 'personalizationMock', {
    configurable: true,
    get: () => mock,
    set: (value) => {
      mock = value;
      if (value && window.__pznRespond) value.respond = window.__pznRespond;
    },
  });
  ${JSON.stringify(EVENTS)}.forEach((name) => document.addEventListener(name,
    (event) => window.__pzn.events.push({ event: name, personalization: event.detail, t: performance.now() })));
  new MutationObserver((records) => records.forEach(({ target }) => {
    const id = target.dataset && target.dataset.personalization;
    if (id && target.dataset.sectionStatus === 'loaded' && !(id in window.__pzn.shown)) window.__pzn.shown[id] = performance.now();
  })).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-section-status'] });
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => {
      if (!entry.hadRecentInput) window.__pzn.cls += entry.value;
    })).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => {
      window.__pzn.lcp = entry.startTime;
    })).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) { /* unsupported */ }
})();`;

function requirePlaywright() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error(`❌ playwright not found in this skill's folder or ${PLAYWRIGHT_CACHE}; install it there (never in the site): ${PLAYWRIGHT_INSTALL}`);
    process.exit(2);
  }
  return playwright;
}

/**
 * The .plain.html URL of a preview page (query dropped, / → index).
 * @param {string} page
 * @returns {string}
 */
export function plainUrl(page) {
  const url = new URL(page);
  url.search = '';
  url.pathname = url.pathname.endsWith('/') ? `${url.pathname}index.plain.html` : `${url.pathname}.plain.html`;
  return url.href;
}

export function withQuery(page, query) {
  const url = new URL(page);
  new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
  return url.href;
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round = (value) => (value === null || value === undefined ? null : Math.round(value));
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

// --- Engine and Target answers ---

/**
 * The answer for a fault (simulate API_FAULTS / TARGET_FAULTS), computed
 * from the request as the mock engine would.
 * @param {'engine'|'target'} kind
 * @param {string} fault
 * @param {object} body request body
 * @returns {Promise<{status: number, body: object, delay?: number}>}
 */
export async function faultAnswer(kind, fault, body) {
  if (fault === 'slow') return { status: 200, body: kind === 'engine' ? { decisions: {} } : {}, delay: SLOW_MS };
  const knob = parseKnob(fault);
  if (kind === 'engine') return engineAnswer({}, body, { knob });
  // Every location in the batch gets an activity, so the knob applies to each.
  const activities = Object.fromEntries((body?.prefetch?.mboxes || [])
    .map(({ name }) => [name, { experiences: [{ audience: null, offer: '/fragments/none' }] }]));
  return targetAnswer(activities, body, { knob });
}

/**
 * Answers the engine and Target for a page: Playwright routes (a real
 * endpoint), or the in-browser mock's respond hook (config.mock).
 * @param {object} page Playwright page
 * @param {object} site readSiteConfig()
 * @param {string} pageUrl
 * @returns {Promise<{set: Function}>} set({ engine, target }) where each is
 *   (body) => answer | answer | null
 */
async function answering(page, site, pageUrl) {
  let current = {};
  const apiPath = site.apiEndpoint ? new URL(site.apiEndpoint, pageUrl).pathname : null;
  const reply = async (route, kind) => {
    const given = current[kind];
    if (!given) return route.continue();
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
    } catch (e) {
      body = {};
    }
    const answer = typeof given === 'function' ? await given(body) : given;
    if (answer.delay) await sleep(answer.delay);
    return route.fulfill({
      status: answer.status || 200, contentType: 'application/json', body: JSON.stringify(answer.body ?? {}),
    }).catch(() => {});
  };
  if (apiPath) await page.route((url) => url.pathname === apiPath, (route) => reply(route, 'engine'));
  await page.route(DELIVERY_URL, (route) => reply(route, 'target'));
  return {
    async set(next) {
      current = next;
      if (!site.mock) return;
      // The in-browser mock never hits the network: give it static answers.
      const resolved = {};
      await Promise.all(Object.entries(next).map(async ([kind, given]) => {
        if (given && typeof given !== 'function') resolved[kind] = given;
      }));
      // For the next navigation, and for the page already loaded.
      await page.addInitScript((respond) => { window.__pznRespond = respond; }, resolved);
      await page.evaluate((respond) => {
        window.__pznRespond = respond;
        if (window.hlx?.personalizationMock) window.hlx.personalizationMock.respond = respond;
      }, resolved).catch(() => {});
    },
  };
}

// --- Page reading ---

async function settle(page) {
  await page.waitForLoadState('load');
  // Lazy sections decorate after load; scroll so below-the-fold sections are reached.
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((done) => { setTimeout(done, 300); });
    window.scrollTo(0, 0);
  });
}

async function readSection(page, id) {
  return page.evaluate((sectionId) => {
    const el = document.querySelector(`[data-personalization="${CSS.escape(sectionId)}"]`);
    if (!el) return null;
    const rows = (window.hlx?.personalization?.decisions || []).filter((entry) => entry.id === sectionId);
    const attrs = Object.fromEntries(el.getAttributeNames().filter((name) => name.startsWith('data-pzn-'))
      .map((name) => [name, el.getAttribute(name)]));
    return {
      attrs,
      variant: attrs['data-pzn-variant'] || null,
      source: attrs['data-pzn-source'] || null,
      outcome: attrs['data-pzn-outcome'] || null,
      reason: attrs['data-pzn-reason'] || null,
      decision: attrs['data-pzn-decision'] || null,
      sectionStatus: el.dataset.sectionStatus || null,
      hidden: getComputedStyle(el).display === 'none',
      text: el.textContent.replace(/\s+/g, ''),
      fragment: attrs['data-pzn-fragment'] || null,
      variants: (el.dataset.personalizationVariants || '').split(',').map((item) => item.trim()).filter(Boolean),
      row: rows.length ? { ...rows[rows.length - 1] } : null,
      // pzn-pending (deciding), pzn-ready / pzn-waiting (below a section still deciding)
      pending: document.querySelectorAll('[data-section-status^="pzn-"]').length,
      mock: !!window.hlx?.personalizationMock,
      mockCalls: window.hlx?.personalizationMock?.requests?.length || 0,
    };
  }, id);
}

async function readEvents(page, id) {
  return page.evaluate((sectionId) => (window.__pzn?.events || [])
    .filter((event) => !sectionId || event.personalization?.id === sectionId), id);
}

async function readStorage(page, context) {
  const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith('pzn-')).map((cookie) => cookie.name);
  const stored = await page.evaluate(() => ({
    local: Object.keys(localStorage).filter((key) => key.startsWith('pzn-')),
    session: Object.keys(sessionStorage).filter((key) => key.startsWith('pzn-')),
    dataLayer: (window.adobeDataLayer || []).filter((entry) => String(entry?.event || '').startsWith('pzn:')).length,
  }));
  return { cookies, ...stored };
}

// Errors that point at personalization itself never count as pre-existing.
const OWN_ERROR = /personaliz|pzn|\/fragments\//i;

function collectErrors(page, ignoreConsole) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const where = message.location()?.url;
    const text = where && !message.text().includes(where) ? `${message.text()} (${where})` : message.text();
    if (!(ignoreConsole && ignoreConsole.test(text))) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`${error.message}${OWN_ERROR.test(error.stack || '') ? ' [personalization]' : ''}`));
  return errors;
}

/**
 * Splits console errors into the ones a case introduced and the ones the page
 * already had: seen on the baseline run or on a no-consent case, and not
 * about personalization. Pre-existing errors are reported, never failed.
 * @param {object[]} results case results with errors[] and query
 * @param {string[]} [baselineErrors]
 * @returns {{results: object[], preExisting: string[]}}
 */
export function splitConsoleErrors(results, baselineErrors = []) {
  const reference = new Set([
    ...baselineErrors,
    ...results.filter((result) => !result.query || /pzn-consent=0/.test(result.query)).flatMap((result) => result.errors),
  ].filter((error) => !OWN_ERROR.test(error)));
  const preExisting = new Set();
  const split = results.map((result) => {
    const own = result.errors.filter((error) => {
      if (!reference.has(error)) return true;
      preExisting.add(error);
      return false;
    });
    const problems = [...result.problems];
    if (own.length) problems.push(`console errors: ${own.slice(0, 3).join(' | ')}`);
    return { ...result, problems, ok: !problems.length };
  });
  return { results: split, preExisting: [...preExisting] };
}

const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The fragment a section shows for a variant, as a same-origin path.
function variantPath(found, variant) {
  if (found.fragment && found.variant === variant) return found.fragment;
  const href = found.variants.find((item) => slug(item.split('/').filter(Boolean).pop()) === slug(variant));
  if (!href) return null;
  try {
    return new URL(href, 'https://x.invalid').pathname.replace(/\.(plain\.)?html$/, '');
  } catch (e) {
    return null;
  }
}

// The first heading of a fragment (else its first words), spaces removed.
async function fragmentSignature(page, path) {
  return page.evaluate(async (fragment) => {
    try {
      const response = await fetch(`${fragment}.plain.html`);
      if (!response.ok) return null;
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const heading = doc.querySelector('h1, h2, h3, h4, h5, h6');
      return (heading || doc.body).textContent.replace(/\s+/g, '').slice(0, 40) || null;
    } catch (e) {
      return null;
    }
  }, path);
}

// The start of a section's default, from the page's .plain.html as the
// browser parses it (the page itself may already show a variant).
async function authoredSignature(page, pageUrl, index) {
  return page.evaluate(async ([plain, position]) => {
    try {
      const response = await fetch(plain);
      if (!response.ok) return null;
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const section = [...(doc.querySelector('main') || doc.body).children].filter((el) => el.tagName === 'DIV')[position];
      if (!section) return null;
      section.querySelectorAll('.section-metadata').forEach((block) => block.remove());
      return section.textContent.replace(/\s+/g, '').slice(0, 40) || null;
    } catch (e) {
      return null;
    }
  }, [plainUrl(pageUrl), index]);
}

async function checkContent(page, found, variant, entry, problems, pageUrl) {
  if (variant === 'default') {
    const authored = (entry.section !== undefined && await authoredSignature(page, pageUrl, entry.section))
      || String(entry.authoredText || '').replace(/\s+/g, '').slice(0, 40);
    if (authored && !found.text.includes(authored)) problems.push('the default (authored content) is not shown');
    return;
  }
  const path = variantPath(found, variant);
  const signature = path && await fragmentSignature(page, path);
  if (!signature) problems.push(`could not read the "${variant}" fragment${path ? ` ${path}` : ''}`);
  else if (!found.text.includes(signature)) problems.push(`content of "${variant}" (${path}) not rendered`);
}

// --- Event checks ---

/**
 * Problems of a section's measurement events: each valid (schema and
 * semantics), one decided and one applied per decision, seen and clicked at
 * most once per decision.
 * @param {object[]} events
 * @param {{prefixes?: string[]}} [options]
 * @returns {string[]}
 */
export function eventProblems(events, { prefixes } = {}) {
  const problems = [];
  events.forEach(({ event, personalization }) => {
    check('measurement-event', { event, personalization }, { prefixes })
      .forEach((problem) => problems.push(`${event} ${personalization?.decisionId}: ${problem}`));
  });
  const counts = {};
  events.forEach(({ event, personalization }) => {
    if (event === 'pzn:notified') return;
    const key = `${personalization?.decisionId} ${event}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  Object.entries(counts).filter(([, count]) => count > 1)
    .forEach(([key, count]) => problems.push(`${key} sent ${count} times`));
  const decided = new Set(events.filter((e) => e.event === 'pzn:decided').map((e) => e.personalization.decisionId));
  events.filter((e) => e.event !== 'pzn:decided' && e.event !== 'pzn:notified')
    .forEach((e) => {
      if (!decided.has(e.personalization.decisionId)) problems.push(`${e.event} for ${e.personalization.decisionId} without pzn:decided`);
    });
  return problems;
}

/**
 * Whether an actual value holds every field of an expected one (objects
 * compared recursively; href by path).
 * @param {unknown} expected
 * @param {unknown} actual
 * @param {string} [key]
 * @returns {boolean}
 */
export function matches(expected, actual, key = '') {
  if (key === 'href' && typeof expected === 'string' && typeof actual === 'string') {
    try {
      return new URL(expected, 'https://x.invalid').pathname === new URL(actual, 'https://x.invalid').pathname;
    } catch (e) {
      return expected === actual;
    }
  }
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return !!actual && typeof actual === 'object'
      && Object.entries(expected).every(([name, value]) => matches(value, actual[name], name));
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/**
 * Compares the events of a step with the expected list, in order.
 * @param {object[]} expected
 * @param {object[]} actual
 * @returns {string[]}
 */
export function compareEvents(expected, actual) {
  const problems = [];
  const relevant = actual.filter((event) => event.event !== 'pzn:notified'
    || expected.some((item) => item.event === 'pzn:notified'));
  if (relevant.length !== expected.length) {
    problems.push(`${relevant.length} event(s) [${relevant.map((e) => `${e.event} ${e.personalization?.decisionId}`).join(', ')}], expected ${expected.length} [${expected.map((e) => `${e.event} ${e.personalization?.decisionId}`).join(', ')}]`);
  }
  expected.forEach((item, i) => {
    const got = relevant[i];
    if (got && !matches(item, { event: got.event, personalization: got.personalization })) {
      const diff = Object.entries(item.personalization || {})
        .filter(([name, value]) => !matches(value, got.personalization?.[name], name))
        .map(([name, value]) => `${name} ${JSON.stringify(got.personalization?.[name])} (expected ${JSON.stringify(value)})`);
      problems.push(`event ${i + 1} ${got.event}: ${got.event !== item.event ? `expected ${item.event}` : diff.join(', ')}`);
    }
  });
  return problems;
}

// --- Cases ---

const measurable = (site, consent) => consent || site.consent?.withoutConsent?.includes('data-layer');

async function scrollToRatio(page, ratio) {
  await page.evaluate(async (r) => {
    window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight * r - window.innerHeight));
    await new Promise((done) => { setTimeout(done, 400); });
  }, ratio);
}

const notified = (page, id, type, timeout = 5000) => page.waitForFunction(
  ([sectionId, kind]) => (window.__pzn?.events || []).some((event) => event.event === 'pzn:notified'
    && event.personalization.id === sectionId && event.personalization.notification?.type === kind),
  [id, type],
  { timeout },
).then(() => true, () => false);

// Clicks the first link in a container without leaving the page.
async function clickLink(page, selector) {
  return page.evaluate((target) => {
    const container = document.querySelector(target);
    const link = container?.querySelector('a[href]');
    if (!link) return false;
    document.addEventListener('click', (event) => event.preventDefault(), { capture: true, once: true });
    link.click();
    return true;
  }, selector);
}

async function checkPopup(page, entry, found, problems, notes, pageUrl) {
  const row = found.row || {};
  const dialogOpen = () => page.$('dialog.target-popup[open]');
  if (entry.expected === 'default') {
    if (row.popup === 'armed' || row.popup === 'open') problems.push(`offer "${row.variant}" armed, expected none`);
    if (entry.outcome === 'no-consent' && row.popup !== 'waiting for consent') problems.push(`popup "${row.popup}", expected "waiting for consent"`);
    await scrollToRatio(page, 1);
    if (await dialogOpen()) problems.push('a popup opened although no offer was expected');
    return { variant: row.variant || 'default', source: row.source || null, outcome: row.outcome };
  }
  if (row.popup !== 'armed') {
    problems.push(`popup ${row.popup || 'never armed'}, expected offer "${entry.expected}"`);
    return { variant: row.variant || null, source: row.source || null, outcome: row.outcome };
  }
  if (entry.expected && row.variant !== entry.expected) problems.push(`offer "${row.variant}" (source ${row.source}), expected "${entry.expected}"`);
  const trigger = entry.trigger || { type: 'scroll', ratio: 0.7 };
  if (trigger.type === 'scroll') {
    const before = trigger.ratio - 0.2;
    const reachable = await page.evaluate((r) => window.innerHeight / document.documentElement.scrollHeight < r, before);
    if (before > 0 && reachable) {
      await scrollToRatio(page, before);
      if (await dialogOpen()) problems.push(`popup open at ${Math.round(before * 100)}% scroll, before its ${Math.round(trigger.ratio * 100)}% trigger`);
    } else {
      notes.push('page too short to check the popup stays closed before its trigger');
    }
    await scrollToRatio(page, Math.min(1, trigger.ratio + 0.02));
  } else if (trigger.type === 'view') {
    await page.evaluate((id) => document.querySelector(`[data-personalization="${CSS.escape(id)}"]`).scrollIntoView(), entry.id);
  }
  const opened = await page.waitForSelector('dialog.target-popup[open]', { timeout: 5000 }).catch(() => null);
  if (!opened) {
    problems.push(`popup did not open past its trigger (${trigger.type}${trigger.ratio ? ` ${Math.round(trigger.ratio * 100)}%` : ''})`);
    return { variant: row.variant, source: row.source, outcome: row.outcome };
  }
  const dialog = await page.evaluate(() => {
    const el = document.querySelector('dialog.target-popup[open]');
    const labelledBy = el.getAttribute('aria-labelledby');
    const label = (labelledBy && document.getElementById(labelledBy)?.textContent.trim()) || el.getAttribute('aria-label') || '';
    return { modal: el.matches(':modal'), label, text: el.textContent.replace(/\s+/g, '') };
  });
  if (!dialog.modal) problems.push('popup is not modal');
  if (!dialog.label) problems.push('popup has no accessible name');
  await checkContent(page, { ...found, text: dialog.text }, row.variant, entry, problems, pageUrl);
  if (row.source === 'target' && !await notified(page, entry.id, 'display')) problems.push('no Target display notification for the opened offer');
  if (await clickLink(page, 'dialog.target-popup[open] .target-popup-content')) {
    if (row.source === 'target' && !await notified(page, entry.id, 'click')) problems.push('no Target click notification for a click in the offer');
  }
  await page.keyboard.press('Escape');
  const closed = await page.waitForSelector('dialog.target-popup', { state: 'detached', timeout: 2000 }).then(() => true, () => false);
  if (!closed) problems.push('Escape did not close the popup');
  await scrollToRatio(page, 0);
  await scrollToRatio(page, 1);
  await page.waitForTimeout(300);
  if (await dialogOpen()) problems.push('popup opened again for the same decision');
  return {
    variant: row.variant, source: row.source, outcome: row.outcome, label: dialog.label,
  };
}

async function newContext(browser, { device, bot } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[device] || VIEWPORTS.desktop,
    userAgent: bot ? BOT_UA : BROWSER_UA,
  });
  await context.addInitScript(INIT_SCRIPT);
  return context;
}

const decidedFn = (popup) => (popup
  ? (id) => !!(window.hlx?.personalization?.decisions || []).find((row) => row.id === id && row.popup)
  : (id) => {
    const el = document.querySelector(`[data-personalization="${CSS.escape(id)}"]`);
    return !!el && !!el.dataset.pznDecision && el.dataset.sectionStatus === 'loaded';
  });

/**
 * Runs one case.
 * @returns {Promise<object>} result with ok, problems
 */
async function runCase(browser, pageUrl, entry, {
  screenshots, ignoreConsole, site, prefixes,
}) {
  const bot = !!entry.context?.bot;
  const consent = !bot && entry.context?.consent !== false;
  const popup = entry.display === 'popup';
  const context = await newContext(browser, { device: entry.context?.device, bot });
  const page = await context.newPage();
  const errors = collectErrors(page, ignoreConsole);
  const calls = [];
  const apiPath = site.apiEndpoint ? new URL(site.apiEndpoint, pageUrl).pathname : null;
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (DELIVERY_URL.test(request.url()) || (apiPath && pathname === apiPath)) calls.push(request.url());
  });
  const answers = await answering(page, site, pageUrl);
  let query = entry.query || '';
  if (entry.fault) {
    const kind = entry.sourceType === 'target' ? 'target' : 'engine';
    if (entry.fault === 'slow') {
      // Only this source is slow (a static answer reaches the in-browser mock too).
      await answers.set({ [kind]: await faultAnswer(kind, 'slow', {}) });
    } else {
      await answers.set({ [kind]: (body) => faultAnswer(kind, entry.fault, body) });
      if (site.mock) query = [query, `pzn-mock=${encodeURIComponent(entry.fault)}`].filter(Boolean).join('&');
    }
  }
  const url = withQuery(pageUrl, query);
  const problems = [];
  const notes = [];
  let outcome = {};
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    // Popups must see the page unscrolled; other cases scroll once so lazy content loads.
    if (!popup) await settle(page);
    await page.waitForFunction(decidedFn(popup), entry.id, { timeout: APPLY_TIMEOUT_MS }).catch(() => {});
    // Other sections may still be within their budget: a section is left
    // hidden only once the safety net (largest budget + 2 s) has passed.
    await page.waitForFunction(() => !document.querySelector('[data-section-status^="pzn-"]'), null, { timeout: SAFETY_NET_MS }).catch(() => {});
    await page.waitForTimeout(300);
    const found = await readSection(page, entry.id);
    if (!found) {
      problems.push('section not found: are the scripts.js hooks installed and is Section Metadata rendered as data-personalization attributes (rendering v2)?');
    } else {
      if (found.pending) problems.push(`${found.pending} section(s) left hidden (data-section-status pzn-*)`);
      if (found.hidden) problems.push('section is hidden');
      if (popup) {
        outcome = await checkPopup(page, entry, found, problems, notes, pageUrl);
        if (entry.expected !== 'unknown' && entry.outcome && outcome.outcome !== entry.outcome) {
          problems.push(`outcome "${outcome.outcome}", expected "${entry.outcome}"`);
        }
      } else {
        outcome = {
          variant: found.variant, source: found.source, outcome: found.outcome, reason: found.reason,
        };
        if (!found.decision) problems.push('section never decided: is the loadEager hook installed?');
        else {
          const known = entry.expected !== 'unknown';
          if (known && entry.expected !== null && entry.expected !== undefined && found.variant !== entry.expected) {
            problems.push(`variant "${found.variant}" (${found.source}, ${found.outcome}${found.reason ? `, ${found.reason}` : ''}), expected "${entry.expected}"`);
          }
          if (entry.allowed && !entry.allowed.includes(found.variant)) problems.push(`variant "${found.variant}" is not one of ${entry.allowed.join(', ')}`);
          if (known && entry.outcome && found.outcome !== entry.outcome) problems.push(`outcome "${found.outcome}"${found.reason ? ` (${found.reason})` : ''}, expected "${entry.outcome}"`);
          if (known && entry.source && found.source !== entry.source && found.attrs['data-pzn-where'] !== 'edge') problems.push(`source "${found.source}", expected "${entry.source}"`);
          await checkContent(page, found, found.variant, entry, problems, pageUrl);
          if (found.source === 'target' && ['variant', 'control'].includes(found.outcome)) {
            await page.evaluate((id) => document.querySelector(`[data-personalization="${CSS.escape(id)}"]`).scrollIntoView(), entry.id);
            if (!await notified(page, entry.id, 'display')) problems.push('no Target display notification once the section was seen');
            if (await clickLink(page, `[data-personalization="${entry.id}"]`) && !await notified(page, entry.id, 'click')) {
              problems.push('no Target click notification for a click in the section');
            }
          }
        }
      }
      // Measurement.
      await page.waitForTimeout(200);
      const events = await readEvents(page, entry.id);
      if (measurable(site, consent)) {
        problems.push(...eventProblems(events, { prefixes }));
        const decided = events.filter((event) => event.event === 'pzn:decided');
        const applied = events.filter((event) => event.event === 'pzn:applied');
        if (decided.length !== 1 || applied.length !== 1) problems.push(`${decided.length} pzn:decided and ${applied.length} pzn:applied, expected one each`);
        const [d] = decided;
        const [a] = applied;
        if (d && entry.expected !== 'unknown' && !entry.allowed && entry.outcome) {
          if (d.personalization.assigned !== entry.assigned) problems.push(`assigned ${JSON.stringify(d.personalization.assigned)}, expected ${JSON.stringify(entry.assigned)}`);
          if (a && a.personalization.result !== entry.result && !popup) problems.push(`result "${a.personalization.result}", expected "${entry.result}"`);
        }
      } else if (events.length) {
        problems.push(`${events.length} event(s) sent without consent or the data-layer exception`);
      }
      if (!consent) {
        const stored = await readStorage(page, context);
        const allowedSplit = site.consent?.withoutConsent?.includes('split');
        const kept = [...stored.cookies, ...stored.local, ...stored.session]
          .filter((key) => !(allowedSplit && key.startsWith('pzn-split')));
        if (kept.length) problems.push(`stored without consent: ${kept.join(', ')}`);
        const engineAllowed = site.consent?.withoutConsent?.includes('api');
        const sent = calls.filter((call) => DELIVERY_URL.test(call) || !engineAllowed);
        if (sent.length || (!engineAllowed && found?.mockCalls)) problems.push(`${sent.length || found.mockCalls} engine/Target call(s) without consent`);
      }
      if (bot && (calls.length || found?.mockCalls)) problems.push(`bot caused ${calls.length || found.mockCalls} decision call(s)`);
    }
    const vitals = await page.evaluate(() => window.__pzn);
    if (vitals && vitals.cls > CLS_BUDGET) problems.push(`CLS ${vitals.cls.toFixed(3)} > ${CLS_BUDGET}`);
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      const name = `${entry.id}--${String(entry.name).replace(/[^a-z0-9]+/gi, '-')}.png`;
      await page.screenshot({ path: join(screenshots, name), fullPage: !popup });
    }
    return {
      id: entry.id,
      case: entry.name,
      query,
      url,
      expected: entry.expected ?? (entry.allowed ? `one of ${entry.allowed.join(', ')}` : null),
      actual: outcome.variant ?? null,
      outcome: outcome.outcome ?? null,
      source: outcome.source ?? null,
      cls: vitals ? Number(vitals.cls.toFixed(3)) : null,
      lcp: vitals ? Math.round(vitals.lcp) : null,
      ok: !problems.length,
      problems,
      notes,
      // A fault case makes the engine or Target fail on purpose: the browser's
      // own "Failed to load resource" line for that request is expected.
      errors: entry.fault ? errors.filter((error) => !(/Failed to load resource/.test(error)
        && (DELIVERY_URL.test(error) || (apiPath && error.includes(apiPath))))) : errors,
    };
  } finally {
    await context.close();
  }
}

// --- Re-evaluation (--refresh) ---

async function waitDecision(page, id, decisionId, timeout = APPLY_TIMEOUT_MS) {
  return page.waitForFunction(([sectionId, expected]) => {
    const el = document.querySelector(`[data-personalization="${CSS.escape(sectionId)}"]`);
    return el?.dataset.pznDecision === expected && el.dataset.sectionStatus === 'loaded';
  }, [id, decisionId], { timeout }).then(() => true, () => false);
}

/**
 * Re-evaluation of browser-decided api sections: identical answer → no
 * events; same variant with a new payload → new decisionId, unchanged, seen
 * again; another variant → the full set.
 * @returns {Promise<object[]>}
 */
async function checkRefresh(browser, pageUrl, cases, { site, prefixes }) {
  const sections = [...new Map(cases.filter((entry) => entry.sourceType === 'api' && !entry.errors)
    .map((entry) => [entry.id, entry])).values()];
  if (!sections.length) return [{ id: '-', ok: true, notRun: 'no api section on the page', problems: [] }];
  return Promise.all(sections.map(async (entry) => {
    const problems = [];
    const context = await newContext(browser);
    try {
      const page = await context.newPage();
      const answers = await answering(page, site, pageUrl);
      const variants = await (async () => {
        const probe = await context.newPage();
        await probe.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        const list = await probe.evaluate((id) => (document.querySelector(`[data-personalization="${CSS.escape(id)}"]`)?.dataset.personalizationVariants || '')
          .split(',').map((item) => item.trim().split('/').filter(Boolean).pop()).filter(Boolean), entry.id);
        await probe.close();
        return list;
      })();
      if (!variants.length) return { id: entry.id, ok: false, problems: ['could not read the section variants'] };
      const answer = (variant, run) => ({
        status: 200, body: { decisions: { [entry.id]: { variant, tracking: { engine: 'verify', run } } }, ttl: 0 },
      });
      const [first, second = 'default'] = variants;
      await answers.set({ engine: answer(first, 'r1') });
      await page.goto(withQuery(pageUrl, 'pzn-consent=1'), { waitUntil: 'load' });
      await settle(page);
      if (!await waitDecision(page, entry.id, `${entry.id}#1`)) {
        const found = await readSection(page, entry.id);
        return { id: entry.id, ok: false, problems: [`not decided by the browser (${found?.attrs['data-pzn-where'] === 'edge' ? 'decided at the edge: re-evaluation needs a browser-decided section' : found?.outcome || 'no decision'})`] };
      }
      await answers.set({ engine: answer(first, 'r1') });
      await page.evaluate((id) => document.querySelector(`[data-personalization="${CSS.escape(id)}"]`).scrollIntoView(), entry.id);
      await page.waitForTimeout(500);
      const steps = [
        { name: 'identical', engine: answer(first, 'r1'), decision: `${entry.id}#1`, events: [] },
        {
          name: 'same variant, new payload',
          engine: answer(first, 'r2'),
          decision: `${entry.id}#2`,
          events: [
            { event: 'pzn:decided', personalization: { decisionId: `${entry.id}#2`, variant: first, trigger: 'refresh' } },
            { event: 'pzn:applied', personalization: { decisionId: `${entry.id}#2`, result: 'unchanged' } },
            { event: 'pzn:seen', personalization: { decisionId: `${entry.id}#2`, result: 'unchanged' } },
          ],
        },
        {
          name: 'another variant',
          engine: answer(second, 'r3'),
          decision: `${entry.id}#3`,
          events: [
            { event: 'pzn:decided', personalization: { decisionId: `${entry.id}#3`, variant: second, trigger: 'refresh' } },
            { event: 'pzn:applied', personalization: { decisionId: `${entry.id}#3`, result: second === 'default' ? 'kept-default' : 'applied' } },
            { event: 'pzn:seen', personalization: { decisionId: `${entry.id}#3` } },
          ],
        },
      ];
      for (const step of steps) {
        /* eslint-disable no-await-in-loop */
        await answers.set({ engine: step.engine });
        const before = (await readEvents(page, entry.id)).length;
        await page.evaluate(() => window.hlx.personalization.refresh());
        await waitDecision(page, entry.id, step.decision, 5000);
        await page.waitForTimeout(800);
        const found = await readSection(page, entry.id);
        if (found.decision !== step.decision) problems.push(`${step.name}: decision ${found.decision}, expected ${step.decision}`);
        const events = (await readEvents(page, entry.id)).slice(before).filter((event) => event.event !== 'pzn:notified');
        compareEvents(step.events, events).forEach((problem) => problems.push(`${step.name}: ${problem}`));
        /* eslint-enable no-await-in-loop */
      }
      problems.push(...eventProblems(await readEvents(page, entry.id), { prefixes }));
    } finally {
      await context.close();
    }
    return { id: entry.id, ok: !problems.length, problems };
  }));
}

// --- Consent changes (--consent-flow) ---

async function checkConsentFlow(browser, pageUrl, cases, { site }) {
  const ids = [...new Set(cases.filter((entry) => !entry.errors).map((entry) => entry.id))];
  const policy = site.consent?.withoutConsent || [];
  const problems = [];
  const context = await newContext(browser);
  const calls = [];
  const apiPath = site.apiEndpoint ? new URL(site.apiEndpoint, pageUrl).pathname : null;
  try {
    const page = await context.newPage();
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (DELIVERY_URL.test(request.url()) || (apiPath && pathname === apiPath)) calls.push(request.url());
    });
    await page.goto(withQuery(pageUrl, 'pzn-consent=0'), { waitUntil: 'load' });
    await settle(page);
    await page.waitForTimeout(1500);
    const hook = await page.evaluate(() => typeof window.hlx?.personalization?.preview?.consent === 'function');
    if (!hook) return { ok: false, notRun: 'window.hlx.personalization.preview is missing: run against a preview host (aem up, *.aem.page)', problems: [] };
    const sections = async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await readSection(page, id)])));
    // 1. No consent.
    const before = await sections();
    Object.entries(before).forEach(([id, found]) => {
      if (!found) return;
      const exception = (found.source === 'rules' && policy.includes('rules'))
        || (found.source === 'split' && policy.includes('split'))
        || (found.source === 'api' && policy.includes('api'));
      if (!exception && found.outcome !== 'no-consent' && found.attrs['data-pzn-where'] !== 'edge') problems.push(`no consent: ${id} outcome "${found.outcome}", expected "no-consent"`);
      if (!exception && found.variant !== 'default') problems.push(`no consent: ${id} shows "${found.variant}"`);
    });
    let stored = await readStorage(page, context);
    const leftovers = (list) => list.filter((key) => !(policy.includes('split') && key.startsWith('pzn-split')));
    const keptBefore = leftovers([...stored.cookies, ...stored.local, ...stored.session]);
    if (keptBefore.length) problems.push(`no consent: stored ${keptBefore.join(', ')}`);
    if (stored.dataLayer && !policy.includes('data-layer')) problems.push(`no consent: ${stored.dataLayer} event(s) in adobeDataLayer`);
    if (calls.length && !policy.includes('api')) problems.push(`no consent: ${calls.length} engine/Target call(s)`);
    // 2. Consent given.
    await page.evaluate(() => window.hlx.personalization.preview.consent(true));
    await page.waitForTimeout(2500);
    const given = await sections();
    Object.entries(given).forEach(([id, found]) => {
      const was = before[id];
      if (!found || !was) return;
      if (was.outcome === 'no-consent') {
        const next = `${id}#${Number(String(was.decision).split('#')[1] || 0) + 1}`;
        if (found.decision !== next) problems.push(`consent given: ${id} decision ${found.decision}, expected ${next}`);
        if (found.outcome === 'no-consent') problems.push(`consent given: ${id} still no-consent`);
      } else if (found.decision !== was.decision) {
        problems.push(`consent given: ${id} was decided (${was.outcome}) and changed to ${found.decision}`);
      }
    });
    const decidedOnConsent = (await readEvents(page)).filter((event) => event.event === 'pzn:decided' && event.personalization.trigger === 'consent');
    const expectedOnConsent = Object.values(before).filter((found) => found?.outcome === 'no-consent').length;
    if (decidedOnConsent.length !== expectedOnConsent) problems.push(`consent given: ${decidedOnConsent.length} pzn:decided with trigger consent, expected ${expectedOnConsent}`);
    // 3. Consent withdrawn.
    const eventsBefore = (await readEvents(page)).length;
    await page.evaluate(() => window.hlx.personalization.preview.consent(false));
    await page.waitForTimeout(2000);
    const withdrawn = await sections();
    await Promise.all(Object.entries(withdrawn).map(async ([id, found]) => {
      if (!found) return;
      if (found.outcome !== 'no-consent') problems.push(`withdrawn: ${id} outcome "${found.outcome}", expected "no-consent"`);
      if (found.variant !== 'default') problems.push(`withdrawn: ${id} shows "${found.variant}"`);
      const entry = cases.find((item) => item.id === id);
      if (entry?.display !== 'popup') await checkContent(page, found, 'default', entry || {}, problems, pageUrl);
    }));
    stored = await readStorage(page, context);
    const keptAfter = [...stored.cookies, ...stored.local, ...stored.session];
    if (keptAfter.length) problems.push(`withdrawn: still stored ${keptAfter.join(', ')}`);
    const after = (await readEvents(page)).slice(eventsBefore);
    if (after.length && !policy.includes('data-layer')) problems.push(`withdrawn: ${after.length} event(s) sent without consent`);
  } finally {
    await context.close();
  }
  return { ok: !problems.length, problems };
}

// --- Split (--split-runs) ---

async function checkSplits(browser, pageUrl, cases, { runs = 0, site }) {
  const splits = cases.filter((entry) => entry.sourceType === 'split' && entry.name === 'no context' && entry.allowed);
  if (!splits.length) return [];
  const ids = splits.map((entry) => entry.id);
  const consented = withQuery(pageUrl, 'pzn-consent=1');
  const visit = async (page) => {
    await page.waitForFunction((list) => list.every((id) => document.querySelector(`[data-personalization="${CSS.escape(id)}"]`)?.dataset.pznDecision), ids, { timeout: APPLY_TIMEOUT_MS }).catch(() => {});
    return page.evaluate((list) => Object.fromEntries(list.map((id) => [id, document.querySelector(`[data-personalization="${CSS.escape(id)}"]`)?.dataset.pznVariant || null])), ids);
  };
  const seen = [];
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await page.goto(consented, { waitUntil: 'load' });
    seen.push(await visit(page));
    for (let i = 0; i < 2; i += 1) {
      /* eslint-disable no-await-in-loop */
      await page.reload({ waitUntil: 'load' });
      seen.push(await visit(page));
      /* eslint-enable no-await-in-loop */
    }
    const tab = await context.newPage();
    await tab.goto(consented, { waitUntil: 'load' });
    seen.push(await visit(tab));
  } finally {
    await context.close();
  }
  // Bots and visitors without consent are never assigned.
  const unassigned = {};
  await Promise.all([['bot', { bot: true }, pageUrl], ['no consent', {}, withQuery(pageUrl, 'pzn-consent=0')]].map(async ([name, options, url]) => {
    const fresh = await newContext(browser, options);
    try {
      const page = await fresh.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await visit(page);
      const stored = await readStorage(page, fresh);
      unassigned[name] = [...stored.cookies, ...stored.session].filter((key) => key.startsWith('pzn-split'));
    } finally {
      await fresh.close();
    }
  }));
  const counts = Object.fromEntries(ids.map((id) => [id, {}]));
  for (let i = 0; i < runs; i += 1) {
    /* eslint-disable no-await-in-loop */
    const fresh = await newContext(browser);
    try {
      const page = await fresh.newPage();
      await page.goto(consented, { waitUntil: 'load' });
      const variants = await visit(page);
      ids.forEach((id) => { counts[id][variants[id]] = (counts[id][variants[id]] || 0) + 1; });
    } finally {
      await fresh.close();
    }
    /* eslint-enable no-await-in-loop */
  }
  return splits.map((entry) => {
    const { id } = entry;
    const problems = [];
    const variants = seen.map((visitVariants) => visitVariants[id]);
    if (new Set(variants).size !== 1) problems.push(`assignment changed within the session: ${variants.join(' → ')}`);
    if (!entry.allowed.includes(variants[0])) problems.push(`variant "${variants[0]}" is not one of ${entry.allowed.join(', ')}`);
    if (unassigned.bot?.length) problems.push('a bot was assigned');
    if (unassigned['no consent']?.length && !site.consent?.withoutConsent?.includes('split')) problems.push('a visitor without consent was assigned');
    if (runs) {
      const missing = entry.allowed.filter((name) => !counts[id][name]);
      // With 10 draws per arm, a fair split misses one with odds below 1 in 10,000.
      if (runs >= 10 * entry.allowed.length && missing.length) problems.push(`never drawn in ${runs} visits: ${missing.join(', ')}`);
      const unexpected = Object.keys(counts[id]).filter((name) => !entry.allowed.includes(name));
      if (unexpected.length) problems.push(`drew arms the weights exclude: ${unexpected.join(', ')}`);
    }
    return {
      id, sticky: variants, distribution: runs ? counts[id] : undefined, ok: !problems.length, problems,
    };
  });
}

// --- Pilot scenarios (--scenarios) ---

/**
 * Replays pilot scenarios against the page: each step's engine answer goes
 * through the skill's edge code (edge sections, served to the browser
 * through a route) or the engine endpoint (browser sections), and the
 * preview's runtime does the rest. Steps: page load, refresh(), consent
 * withdrawn. A refresh whose answer changed simulates an expired session
 * cache.
 * @returns {Promise<object[]>}
 */
async function checkScenarios(browser, pageUrl, file, { site, prefixes }) {
  const { section: defaults = {}, scenarios = [] } = file;
  const response = await fetch(pageUrl).catch(() => null);
  const html = response?.ok ? await response.text() : null;
  if (!html) return [{ id: '-', ok: false, problems: [`could not fetch ${pageUrl}`] }];
  const results = [];
  for (const scenario of scenarios) {
    /* eslint-disable no-await-in-loop */
    const id = scenario.section || defaults.id;
    const problems = [];
    const { context: given = {} } = scenario;
    const params = new URLSearchParams({ ...(given.params || {}), 'pzn-consent': '1' });
    if (given.geo?.country) params.set('pzn-geo', given.geo.region ? `${given.geo.country}-${given.geo.region}` : given.geo.country);
    const url = withQuery(pageUrl, params.toString());
    const context = await newContext(browser);
    try {
      const page = await context.newPage();
      const answers = await answering(page, site, pageUrl);
      let previous = null;
      for (const step of scenario.steps) {
        const before = (await readEvents(page, id).catch(() => [])).length;
        const atEdge = step.attributes?.['data-pzn-where'] === 'edge'
          || (step.events || []).some((event) => event.personalization?.where === 'edge');
        if (/^page load/.test(step.step)) {
          if (atEdge) {
            const edge = await simulateEdge(html, {
              url: withQuery(pageUrl, new URLSearchParams(given.params || {}).toString()),
              country: given.geo?.country,
              region: given.geo?.region,
              consent: true,
              referer: given.referrer ? `https://${given.referrer}/` : undefined,
              engineName: site.engine,
              policy: site.consent?.withoutConsent,
              origin: new URL(pageUrl).origin,
              prefixes,
              fetchImpl: async () => new Response(JSON.stringify(step.answer || { decisions: {} }), { headers: { 'content-type': 'application/json' } }),
            });
            await page.route((target) => target.pathname === new URL(pageUrl).pathname, (route) => route.fulfill({
              status: 200, contentType: 'text/html', body: edge.html,
            }));
          } else if (step.answer) {
            await answers.set({ engine: { status: 200, body: step.answer } });
          }
          await page.goto(url, { waitUntil: 'load', referer: given.referrer ? `https://${given.referrer}/` : undefined });
          await settle(page);
          await waitDecision(page, id, step.attributes['data-pzn-decision']);
        } else if (/consent withdrawn/.test(step.step)) {
          const hook = await page.evaluate(() => typeof window.hlx?.personalization?.preview?.consent === 'function');
          if (!hook) {
            problems.push(`${step.step}: not run (needs a preview host for window.hlx.personalization.preview)`);
          } else {
            await page.evaluate(() => window.hlx.personalization.preview.consent(false));
            await waitDecision(page, id, step.attributes['data-pzn-decision'], 5000);
          }
        } else if (/refresh/.test(step.step)) {
          if (step.answer) await answers.set({ engine: { status: 200, body: step.answer } });
          if (step.answer && previous && JSON.stringify(step.answer) !== JSON.stringify(previous)) {
            // A new upstream answer: the session cache has expired.
            await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pzn-decisions:'))
              .forEach((key) => sessionStorage.removeItem(key)));
          }
          await page.evaluate(() => window.hlx.personalization.refresh());
          await waitDecision(page, id, step.attributes['data-pzn-decision'], 5000);
        }
        // Exposure: the section in view, then a click when a step expects one.
        await page.evaluate((sectionId) => document.querySelector(`[data-personalization="${CSS.escape(sectionId)}"]`)?.scrollIntoView(), id);
        await page.waitForTimeout(600);
        if ((step.events || []).some((event) => event.event === 'pzn:clicked')) {
          await clickLink(page, `[data-personalization="${id}"]`);
          await page.waitForTimeout(300);
        }
        const found = await readSection(page, id);
        Object.entries(step.attributes || {}).forEach(([name, value]) => {
          if (found?.attrs[name] !== value) problems.push(`${step.step}: ${name}="${found?.attrs[name] ?? ''}", expected "${value}"`);
        });
        const events = (await readEvents(page, id)).slice(before);
        compareEvents(step.events || [], events).forEach((problem) => problems.push(`${step.step}: ${problem}`));
        problems.push(...eventProblems(events, { prefixes }).map((problem) => `${step.step}: ${problem}`));
        if (/consent withdrawn/.test(step.step)) {
          const stored = await readStorage(page, context);
          const kept = [...stored.cookies, ...stored.local, ...stored.session];
          if (kept.length) problems.push(`${step.step}: still stored ${kept.join(', ')}`);
          if (step.attributes?.['data-pzn-where'] === 'edge' && /<template data-pzn-default>/.test(found?.text || '')) problems.push(`${step.step}: default not restored`);
        }
        previous = step.answer || previous;
      }
    } finally {
      await context.close();
    }
    results.push({
      id: scenario.id, pilot: scenario.pilot, ok: !problems.length, problems,
    });
    /* eslint-enable no-await-in-loop */
  }
  return results;
}

// --- Page speed (--perf) ---

async function loadMetrics(browser, url, {
  id, faultSlow, site, consentCookie = false,
} = {}) {
  const context = await newContext(browser);
  // The edge decides only for a visitor with the pzn-consent cookie (the
  // browser runtime mirrors it from the consent tool).
  if (consentCookie) await context.addCookies([{ name: 'pzn-consent', value: '1', url }]);
  try {
    const page = await context.newPage();
    if (faultSlow) {
      const answers = await answering(page, site, url);
      await answers.set({ engine: await faultAnswer('engine', 'slow', {}) });
    }
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const data = await page.evaluate((sectionId) => {
      const nav = performance.getEntriesByType('navigation')[0];
      const sections = [...document.querySelectorAll('[data-personalization]')].map((el) => ({
        id: el.dataset.personalization,
        where: el.dataset.pznWhere || null,
        outcome: el.dataset.pznOutcome || null,
        source: el.dataset.pznSource || null,
      }));
      return {
        ttfb: nav ? nav.responseStart : null,
        lcp: window.__pzn.lcp,
        cls: window.__pzn.cls,
        shown: sectionId ? window.__pzn.shown[sectionId] ?? null : null,
        sections,
      };
    }, id);
    return data;
  } finally {
    await context.close();
  }
}

const median = (values) => percentile(values.filter((value) => value !== null), 50);

/**
 * Page speed against the page before the change: a variant case, a default
 * case, a no-consent case and a slow-engine case, as a normal visitor with
 * consent and real decisions (no ?pzn= override).
 * @returns {Promise<object>}
 */
async function checkPerf(browser, pageUrl, cases, { baseline, site, repeat = 3 }) {
  const pick = (test) => cases.find((entry) => !entry.errors && !entry.context?.forced && !entry.context?.bot && test(entry));
  const runs = [
    ['variant', pick((entry) => entry.expected && entry.expected !== 'default' && entry.expected !== 'unknown' && !entry.fault)],
    ['default', pick((entry) => entry.expected === 'default' && entry.context?.consent !== false && !entry.fault)],
    ['no consent', pick((entry) => entry.context?.consent === false)],
    ['slow engine', pick((entry) => entry.fault === 'slow')],
  ].filter(([, entry]) => entry);
  const measureUrl = async (url, options) => {
    const samples = [];
    for (let i = 0; i < repeat; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      samples.push(await loadMetrics(browser, url, options));
    }
    return {
      lcp: round(median(samples.map((s) => s.lcp))),
      cls: Number((median(samples.map((s) => s.cls)) || 0).toFixed(3)),
      shown: round(median(samples.map((s) => s.shown))),
    };
  };
  const before = baseline ? await measureUrl(baseline) : null;
  const results = [];
  for (const [name, entry] of runs) {
    // eslint-disable-next-line no-await-in-loop
    const after = await measureUrl(withQuery(pageUrl, entry.query.replace(/(^|&)pzn=[^&]*/g, '')), {
      id: entry.id, faultSlow: entry.fault === 'slow', site,
    });
    const problems = [];
    if (before) {
      if (after.cls > Math.max(CLS_BUDGET, before.cls + CLS_REGRESSION)) problems.push(`CLS ${before.cls} → ${after.cls}`);
      if (after.lcp - before.lcp > LCP_REGRESSION_MS) problems.push(`LCP +${after.lcp - before.lcp} ms (> ${LCP_REGRESSION_MS})`);
    }
    results.push({
      case: name, id: entry.id, after, before, ok: !problems.length, problems,
    });
  }
  return { baseline: !!before, results, ok: results.every((result) => result.ok) };
}

/**
 * Edge latency: added time to first byte, LCP and CLS at p50 / p75 against
 * the page without personalization, for a visitor with consent (the
 * pzn-consent cookie), uncached (a unique context per run) and cached, with the share of successful decisions and the timeout, fallback
 * and low-confidence rates.
 * @returns {Promise<object>}
 */
async function checkEdgeLatency(browser, pageUrl, {
  baseline, runs = 30, uncached = true, budget = 300, success = 0.95,
}) {
  const sets = uncached ? ['uncached', 'cached'] : ['cached'];
  const report = {};
  const base = [];
  for (let i = 0; i < runs; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    base.push(await loadMetrics(browser, withQuery(baseline, `pzn-perf=${i}`), { consentCookie: true }));
  }
  const baseTtfb = base.map((s) => s.ttfb);
  for (const set of sets) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const query = set === 'uncached' ? `utm_content=pzn-perf-${Date.now().toString(36)}-${i}` : 'utm_content=pzn-perf-cached';
      // eslint-disable-next-line no-await-in-loop
      samples.push(await loadMetrics(browser, withQuery(pageUrl, query), { consentCookie: true }));
    }
    const edgeApi = (s) => s.sections.filter((section) => section.where === 'edge');
    const ok = (s) => edgeApi(s).length && edgeApi(s).every((section) => ['variant', 'control', 'intentional-default'].includes(section.outcome));
    const rate = (outcome) => samples.filter((s) => edgeApi(s).some((section) => section.outcome === outcome)).length / samples.length;
    const added = (list, p) => {
      const value = percentile(list.map((s) => s.ttfb), p);
      return value === null ? null : round(value - percentile(baseTtfb, p));
    };
    const good = samples.filter(ok);
    report[set] = {
      runs: samples.length,
      addedTtfb: { p50: added(samples, 50), p75: added(samples, 75) },
      addedTtfbSuccessful: { p50: added(good, 50), p75: added(good, 75) },
      lcp: { p50: round(percentile(samples.map((s) => s.lcp), 50)), p75: round(percentile(samples.map((s) => s.lcp), 75)) },
      cls: { p50: percentile(samples.map((s) => s.cls), 50), p75: percentile(samples.map((s) => s.cls), 75) },
      success: good.length / samples.length,
      timeout: rate('timeout'),
      fallback: rate('fallback'),
      lowConfidence: rate('low-confidence'),
    };
  }
  const target = report.uncached || report.cached;
  const problems = [];
  if (target.addedTtfb.p75 > budget) problems.push(`added time to first byte p75 ${target.addedTtfb.p75} ms > ${budget} ms`);
  if (target.success < success) problems.push(`successful decisions ${(target.success * 100).toFixed(0)}% < ${(success * 100).toFixed(0)}%`);
  return {
    ...report, budget, successTarget: success, ok: !problems.length, problems,
  };
}

async function revisit(browser, pageUrl) {
  const context = await newContext(browser);
  const visits = [];
  try {
    for (let i = 0; i < 2; i += 1) {
      /* eslint-disable no-await-in-loop */
      const page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: 'load' });
      await settle(page);
      await page.waitForTimeout(500);
      visits.push(await page.evaluate(() => [...document.querySelectorAll('main > .section[data-personalization]')]
        .map((el) => ({ id: el.dataset.personalization, variant: el.dataset.pznVariant || null, outcome: el.dataset.pznOutcome || null }))));
      await page.close();
      // The next visit is a new browser session: session cookies go away.
      const persistent = (await context.cookies()).filter((cookie) => cookie.expires > 0);
      await context.clearCookies();
      await context.addCookies(persistent);
      /* eslint-enable no-await-in-loop */
    }
    const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith('pzn-'))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return { first: visits[0], second: visits[1], cookies };
  } finally {
    await context.close();
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>} report
 */
export async function verify({
  page, cases, baseline, revisit: doRevisit, screenshots, ignoreConsole, site = readSiteConfig(''),
  prefixes, faults = false, refresh = false, consentFlow = false, splitRuns = 0, scenarios, perf = false,
  edge = false, uncached = false, runs = 30, perfOnly = false,
}) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const report = { page, invalid: cases.filter((item) => item.errors && item.outcome !== 'invalid') };
    if (perf && edge) {
      report.edge = baseline
        ? await checkEdgeLatency(browser, page, { baseline, runs, uncached })
        : { ok: false, notRun: 'needs --baseline <the same page without personalization>', problems: [] };
      report.ok = report.edge.ok;
      return report;
    }
    const runsList = [];
    if (!perfOnly) {
      // Sequential: keeps aem up and CLS measurements stable.
      for (const entry of cases.filter((item) => item.expected !== undefined && (faults || !item.fault))) {
        // eslint-disable-next-line no-await-in-loop
        runsList.push(await runCase(browser, page, entry, {
          screenshots, ignoreConsole, site, prefixes,
        }));
      }
    }
    let baselineErrors = [];
    if (baseline && !perf) {
      const context = await newContext(browser);
      const measure = async (url) => {
        const tab = await context.newPage();
        const errors = collectErrors(tab, ignoreConsole);
        await tab.goto(url, { waitUntil: 'load' });
        await settle(tab);
        await tab.waitForTimeout(500);
        const vitals = await tab.evaluate(() => window.__pzn);
        await tab.close();
        return { ...vitals, errors };
      };
      const before = await measure(baseline);
      const after = await measure(withQuery(page, 'pzn-consent=1'));
      baselineErrors = before.errors;
      await context.close();
      report.baseline = {
        url: baseline,
        before: { cls: Number(before.cls.toFixed(3)), lcp: Math.round(before.lcp) },
        after: { cls: Number(after.cls.toFixed(3)), lcp: Math.round(after.lcp) },
        lcpDeltaMs: Math.round(after.lcp - before.lcp),
        ok: after.cls <= Math.max(CLS_BUDGET, before.cls + CLS_REGRESSION),
      };
    }
    const { results, preExisting } = splitConsoleErrors(runsList, baselineErrors);
    Object.assign(report, { results, preExistingErrors: preExisting });
    report.splits = await checkSplits(browser, page, cases, { runs: splitRuns, site });
    if (refresh) report.refresh = await checkRefresh(browser, page, cases, { site, prefixes });
    if (consentFlow) report.consentFlow = await checkConsentFlow(browser, page, cases, { site });
    if (scenarios) report.scenarios = await checkScenarios(browser, page, scenarios, { site, prefixes });
    if (perf) report.perf = await checkPerf(browser, page, cases, { baseline, site });
    if (doRevisit) report.revisit = await revisit(browser, page);
    const passed = (list) => (list || []).every((item) => item.ok);
    report.ok = passed(results) && passed(report.splits) && passed(report.refresh)
      && passed(report.scenarios) && report.consentFlow?.ok !== false && report.perf?.ok !== false
      && !report.invalid.length && report.baseline?.ok !== false;
    return report;
  } finally {
    await browser.close();
  }
}

function printReport(report) {
  report.invalid.forEach((item) => status(false, `section "${item.id ?? '?'}" is invalid: ${item.errors.join('; ')}`));
  (report.results || []).forEach((result) => {
    status(result.ok, `${result.id} · ${result.case} → ${result.actual ?? '-'} (${result.outcome ?? '-'}, ${result.source ?? '-'}), CLS ${result.cls ?? '-'}, LCP ${result.lcp ?? '-'}ms`);
    result.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
    (result.notes || []).forEach((note) => console.log(`   ℹ️ ${note}`));
    if (!result.ok) console.log(`   ${result.url}`);
  });
  (report.splits || []).forEach((split) => {
    const distribution = split.distribution ? `, distribution ${JSON.stringify(split.distribution)}` : '';
    status(split.ok, `${split.id} · split sticky across reloads and tabs: ${split.sticky.join(', ')}${distribution}`);
    split.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
  });
  const block = (name, item) => {
    if (!item) return;
    if (item.notRun) {
      console.log(`⚪ NOT RUN ${name}: ${item.notRun}`);
      return;
    }
    status(item.ok, name);
    (item.problems || []).forEach((problem) => console.log(`   ❌ ${problem}`));
  };
  (report.refresh || []).forEach((item) => block(`re-evaluation · ${item.id}`, item));
  block('consent flow', report.consentFlow);
  (report.scenarios || []).forEach((item) => block(`scenario · ${item.id}${item.pilot ? ` (${item.pilot})` : ''}`, item));
  if (report.perf) {
    if (!report.perf.baseline) console.log('⚪ NOT RUN page speed comparison: pass --baseline <the page before the change>');
    report.perf.results.forEach((result) => {
      const was = result.before ? ` (before: LCP ${result.before.lcp} ms, CLS ${result.before.cls})` : '';
      status(result.ok, `page speed · ${result.case} (${result.id}): LCP ${result.after.lcp} ms, CLS ${result.after.cls}, section shown at ${result.after.shown ?? '-'} ms${was}`);
      result.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
    });
  }
  if (report.edge) {
    block('edge latency', report.edge);
    ['uncached', 'cached'].filter((set) => report.edge[set]).forEach((set) => {
      const r = report.edge[set];
      console.log(`   ${set}: ${r.runs} runs, added TTFB p50 ${r.addedTtfb.p50} / p75 ${r.addedTtfb.p75} ms (successful only: ${r.addedTtfbSuccessful.p50} / ${r.addedTtfbSuccessful.p75}), LCP p50 ${r.lcp.p50} / p75 ${r.lcp.p75} ms, success ${(r.success * 100).toFixed(0)}%, timeout ${(r.timeout * 100).toFixed(0)}%, fallback ${(r.fallback * 100).toFixed(0)}%, low confidence ${(r.lowConfidence * 100).toFixed(0)}%`);
    });
  }
  if (report.baseline) {
    const { before, after, lcpDeltaMs } = report.baseline;
    status(report.baseline.ok, `baseline CLS ${before.cls} → ${after.cls}, LCP ${before.lcp} → ${after.lcp}ms (${lcpDeltaMs >= 0 ? '+' : ''}${lcpDeltaMs}ms)`);
    if (lcpDeltaMs > LCP_REGRESSION_MS) console.log('   ⚠️ LCP regressed by more than 500ms: consider the edge for above-the-fold sections');
  }
  if (report.preExistingErrors?.length) {
    console.log(`⚠️ pre-existing console errors (also on the default/baseline run, not failed): ${report.preExistingErrors.slice(0, 5).join(' | ')}`);
  }
  if (report.revisit) {
    const show = (visit) => visit.map((section) => `${section.id}=${section.variant}`).join(', ');
    console.log(`ℹ️ revisit: first [${show(report.revisit.first)}], second [${show(report.revisit.second)}], cookies [${report.revisit.cookies.join('; ') || 'none'}]`);
  }
  console.log(report.ok ? '\n✓ PASS preview verified' : '\n❌ FAIL see problems above');
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.page !== 'string') {
    console.error(`❌ ${USAGE}`);
    process.exit(2);
  }
  const repo = resolve(args.repo || process.cwd());
  const prefixes = sitePrefixes(repo);
  const site = readSiteConfig(readText(join(repo, 'scripts', 'personalization', 'config.js')) || '');
  const policy = site.consent?.policyRef ? site.consent.withoutConsent : [];
  let cases;
  if (args.cases) cases = readJson(resolve(args.cases));
  else {
    let html = args.file ? readText(resolve(args.file)) : null;
    if (!html && !args.file) {
      const response = await fetch(plainUrl(args.page)).catch(() => null);
      html = response?.ok ? await response.text() : null;
    }
    if (!html) {
      console.error(`❌ could not read ${args.file || plainUrl(args.page)}`);
      process.exit(2);
    }
    cases = await buildCases(html, {
      matrix: args.matrix ? readJson(resolve(args.matrix)) : undefined,
      engine: args['api-decisions'] ? readJson(resolve(args['api-decisions'])) : undefined,
      activities: typeof args.target === 'string' ? readJson(resolve(args.target)) : undefined,
      prefixes,
      policy,
      engineName: site.engine,
    });
  }
  if (!Array.isArray(cases) || !cases.length) {
    console.error('❌ no cases: the page has no personalized sections');
    process.exit(2);
  }
  const scenarios = typeof args.scenarios === 'string' ? readJson(resolve(args.scenarios)) : undefined;
  if (args.scenarios && !scenarios) {
    console.error(`❌ could not read ${args.scenarios}`);
    process.exit(2);
  }
  const report = await verify({
    page: args.page,
    cases,
    site: { ...site, consent: site.consent && { ...site.consent, withoutConsent: policy } },
    prefixes,
    faults: !!args.faults,
    refresh: !!args.refresh,
    consentFlow: !!args['consent-flow'],
    splitRuns: Number(args['split-runs'] || 0),
    scenarios,
    perf: !!args.perf,
    edge: !!args.edge,
    uncached: !!args.uncached,
    runs: Number(args.runs || 30),
    perfOnly: !!args.perf,
    baseline: typeof args.baseline === 'string' ? args.baseline : undefined,
    revisit: !!args.revisit,
    screenshots: typeof args.screenshots === 'string' ? resolve(args.screenshots) : undefined,
    ignoreConsole: typeof args['ignore-console'] === 'string' ? new RegExp(args['ignore-console']) : undefined,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  process.exit(report.ok ? 0 : 1);
}
