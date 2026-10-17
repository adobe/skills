#!/usr/bin/env node
/*
 * Verifies personalization in a real browser against a running preview
 * (aem up or *.aem.page). For each case from simulate.mjs it opens the page
 * with the case's override query in a fresh browser context and checks that
 * the placeholder applied the expected variant and rendered its content,
 * with no console errors and CLS within budget.
 *
 * Usage:
 *   node verify-preview.mjs --page http://localhost:3000/index
 *     [--file content/index.html | --cases cases.json]
 *     [--matrix contexts.json] [--api-decisions decisions.json] [--consent]
 *     [--baseline <url>] [--revisit] [--screenshots dir] [--ignore-console <regex>]
 *     [--repo .] [--json]
 *
 * Without --file/--cases the page's .plain.html is fetched from the preview.
 * --baseline measures another URL (the page before personalization) and fails
 * when CLS regresses. --revisit loads the page, then again as a new session
 * with the persistent cookies kept, and reports both (a returning visitor
 * needs the site's consent hook to grant consent). --api-decisions and
 * --consent grant consent per case with ?pzn-consent=1 (see simulate.mjs), so
 * API placeholders really call the engine. --ignore-console skips
 * expected console errors, e.g. "status of 5\d\d|ERR_" while the mock engine
 * injects failures.
 * Exits 1 on any failure.
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PLAYWRIGHT_CACHE, PLAYWRIGHT_INSTALL, exitOnHelp, isMain, loadPlaywright, parseArgs, readJson,
  readText, sitePrefixes, status,
} from './lib.mjs';

export const USAGE = `Usage: node verify-preview.mjs --page http://localhost:3000/<page>
         [--file content/<page>.html | --cases cases.json]
         [--matrix contexts.json] [--api-decisions decisions.json] [--consent]
         [--baseline <url>] [--revisit] [--screenshots dir] [--ignore-console <regex>]
         [--repo .] [--json]
Playwright check against a running preview (aem up or *.aem.page): each case
applies its variant, renders content, logs no console errors, keeps CLS within
budget. Playwright loads from this skill's folder or ~/.cache/aem-eds-personalization/playwright,
never the site. Exit 1 = a case failed, 2 = usage or Playwright not found.`;

import { buildCases } from './simulate.mjs';

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
const APPLY_TIMEOUT_MS = 10000;

// Collects CLS (excluding shifts right after input) and LCP from page start.
const VITALS_SCRIPT = `(() => {
  window.__pzn = { cls: 0, lcp: 0 };
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

function withQuery(page, query) {
  const url = new URL(page);
  new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
  return url.href;
}

async function settle(page) {
  await page.waitForLoadState('load');
  // Lazy sections decorate after load; give them a moment, then scroll so
  // below-the-fold placeholders are reached.
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((done) => { setTimeout(done, 300); });
    window.scrollTo(0, 0);
  });
}

async function readPlaceholders(page) {
  return page.evaluate(() => [...document.querySelectorAll('div.personalization')].map((block) => ({
    id: block.dataset.pznId || null,
    variant: block.dataset.pznVariant || null,
    source: block.dataset.pznSource || null,
    status: block.dataset.pznStatus || null,
    rendered: block.dataset.pznId
      ? document.querySelectorAll(`[data-pzn-id="${CSS.escape(block.dataset.pznId)}"]:not(.personalization)`).length
      : 0,
  })));
}

async function measure(context, url, ignoreConsole) {
  const page = await context.newPage();
  const errors = collectErrors(page, ignoreConsole);
  await page.goto(url, { waitUntil: 'load' });
  await settle(page);
  await page.waitForTimeout(500);
  const vitals = await page.evaluate(() => window.__pzn);
  await page.close();
  return { ...vitals, errors };
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
 * already had: seen on the baseline run or on a no-context (default) case, and
 * not about personalization. Pre-existing errors are reported, never failed.
 * @param {object[]} results case results with errors[] and query
 * @param {string[]} [baselineErrors]
 * @returns {{results: object[], preExisting: string[]}}
 */
export function splitConsoleErrors(results, baselineErrors = []) {
  const reference = new Set([
    ...baselineErrors,
    ...results.filter((result) => !result.query).flatMap((result) => result.errors),
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

/**
 * Runs one case.
 * @returns {Promise<object>} result with ok, problems
 */
async function runCase(browser, pageUrl, entry, { screenshots, ignoreConsole }) {
  const device = entry.context?.device;
  const context = await browser.newContext({
    viewport: VIEWPORTS[device] || VIEWPORTS.desktop,
    userAgent: entry.context?.bot ? BOT_UA : BROWSER_UA,
  });
  await context.addInitScript(VITALS_SCRIPT);
  const page = await context.newPage();
  const errors = collectErrors(page, ignoreConsole);
  const url = withQuery(pageUrl, entry.query || '');
  const problems = [];
  let found;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const selector = `div.personalization[data-pzn-id="${entry.placeholder}"][data-pzn-status="applied"]`;
    await page.waitForSelector(selector, { state: 'attached', timeout: APPLY_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(300);
    found = (await readPlaceholders(page)).find((block) => block.id === entry.placeholder);
    const vitals = await page.evaluate(() => window.__pzn);
    if (!found) problems.push('placeholder never applied (is the scripts.js hook installed?)');
    else {
      if (entry.source === 'bot' && found.source !== 'bot') problems.push(`source "${found.source}", expected the bot default`);
      if (found.variant !== entry.expected) problems.push(`variant "${found.variant}" (source ${found.source}), expected "${entry.expected}"`);
      const expectsContent = entry.target && entry.target.type !== 'none';
      if (expectsContent && !found.rendered) problems.push('no content rendered for the variant');
      if (!expectsContent && found.rendered) problems.push('content rendered although the variant is "none"');
    }
    if (vitals && vitals.cls > CLS_BUDGET) problems.push(`CLS ${vitals.cls.toFixed(3)} > ${CLS_BUDGET}`);
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      const name = `${entry.placeholder}--${String(entry.name).replace(/[^a-z0-9]+/gi, '-')}.png`;
      await page.screenshot({ path: join(screenshots, name), fullPage: true });
    }
    return {
      placeholder: entry.placeholder,
      case: entry.name,
      query: entry.query || '',
      url,
      expected: entry.expected,
      actual: found?.variant ?? null,
      source: found?.source ?? null,
      cls: vitals ? Number(vitals.cls.toFixed(3)) : null,
      lcp: vitals ? Math.round(vitals.lcp) : null,
      ok: !problems.length,
      problems,
      errors,
    };
  } finally {
    await context.close();
  }
}

async function revisit(browser, pageUrl) {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, userAgent: BROWSER_UA });
  const visits = [];
  try {
    for (let i = 0; i < 2; i += 1) {
      const page = await context.newPage();
      // eslint-disable-next-line no-await-in-loop
      await page.goto(pageUrl, { waitUntil: 'load' });
      // eslint-disable-next-line no-await-in-loop
      await settle(page);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
      // eslint-disable-next-line no-await-in-loop
      visits.push(await readPlaceholders(page));
      // eslint-disable-next-line no-await-in-loop
      await page.close();
      // The next visit is a new browser session: session cookies go away.
      // eslint-disable-next-line no-await-in-loop
      const persistent = (await context.cookies()).filter((cookie) => cookie.expires > 0);
      // eslint-disable-next-line no-await-in-loop
      await context.clearCookies();
      // eslint-disable-next-line no-await-in-loop
      await context.addCookies(persistent);
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
  page, cases, baseline, revisit: doRevisit, screenshots, ignoreConsole,
}) {
  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const runs = [];
    // Sequential: keeps aem up and CLS measurements stable.
    for (const entry of cases.filter((item) => item.expected !== undefined)) {
      // eslint-disable-next-line no-await-in-loop
      runs.push(await runCase(browser, page, entry, { screenshots, ignoreConsole }));
    }
    const report = { page, invalid: cases.filter((item) => item.errors) };
    let baselineErrors = [];
    if (baseline) {
      const context = await browser.newContext({ viewport: VIEWPORTS.desktop, userAgent: BROWSER_UA });
      await context.addInitScript(VITALS_SCRIPT);
      const before = await measure(context, baseline, ignoreConsole);
      const after = await measure(context, page, ignoreConsole);
      baselineErrors = before.errors;
      await context.close();
      const ok = after.cls <= Math.max(CLS_BUDGET, before.cls + CLS_REGRESSION);
      report.baseline = {
        url: baseline,
        before: { cls: Number(before.cls.toFixed(3)), lcp: Math.round(before.lcp) },
        after: { cls: Number(after.cls.toFixed(3)), lcp: Math.round(after.lcp) },
        lcpDeltaMs: Math.round(after.lcp - before.lcp),
        ok,
      };
    }
    const { results, preExisting } = splitConsoleErrors(runs, baselineErrors);
    Object.assign(report, { results, preExistingErrors: preExisting });
    if (doRevisit) report.revisit = await revisit(browser, page);
    report.ok = results.every((result) => result.ok) && !report.invalid.length && report.baseline?.ok !== false;
    return report;
  } finally {
    await browser.close();
  }
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.page !== 'string') {
    console.error(`❌ ${USAGE}`);
    process.exit(2);
  }
  const repo = resolve(args.repo || process.cwd());
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
      prefixes: sitePrefixes(repo),
      consent: !!args.consent,
    });
  }
  if (!Array.isArray(cases) || !cases.length) {
    console.error('❌ no cases: the page has no Personalization blocks');
    process.exit(2);
  }
  const report = await verify({
    page: args.page,
    cases,
    baseline: typeof args.baseline === 'string' ? args.baseline : undefined,
    revisit: !!args.revisit,
    screenshots: typeof args.screenshots === 'string' ? resolve(args.screenshots) : undefined,
    ignoreConsole: typeof args['ignore-console'] === 'string' ? new RegExp(args['ignore-console']) : undefined,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    report.invalid.forEach((item) => status(false, `placeholder "${item.placeholder ?? '?'}" is invalid: ${item.errors.join('; ')}`));
    report.results.forEach((result) => {
      status(result.ok, `${result.placeholder} · ${result.case} → ${result.actual ?? '-'} (${result.source ?? '-'}), CLS ${result.cls ?? '-'}, LCP ${result.lcp ?? '-'}ms`);
      result.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
      if (!result.ok) console.log(`   ${result.url}`);
    });
    if (report.baseline) {
      const { before, after, lcpDeltaMs } = report.baseline;
      status(report.baseline.ok, `baseline CLS ${before.cls} → ${after.cls}, LCP ${before.lcp} → ${after.lcp}ms (${lcpDeltaMs >= 0 ? '+' : ''}${lcpDeltaMs}ms)`);
      if (lcpDeltaMs > 500) console.log('   ⚠️ LCP regressed by more than 500ms: consider edge mode for above-the-fold placeholders');
    }
    if (report.preExistingErrors.length) {
      console.log(`⚠️ pre-existing console errors (also on the default/baseline run, not failed): ${report.preExistingErrors.slice(0, 5).join(' | ')}`);
    }
    if (report.revisit) {
      const show = (visit) => visit.map((block) => `${block.id}=${block.variant}`).join(', ');
      console.log(`ℹ️ revisit: first [${show(report.revisit.first)}], second [${show(report.revisit.second)}], cookies [${report.revisit.cookies.join('; ') || 'none'}]`);
    }
    console.log(report.ok ? '\n✓ PASS preview verified' : '\n❌ FAIL see problems above');
  }
  process.exit(report.ok ? 0 : 1);
}
