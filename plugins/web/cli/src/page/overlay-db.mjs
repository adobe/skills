import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CliError } from '#src/errors.mjs';

const CACHE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || os.homedir(),
  '.cache',
  'page-prep',
);
export const STALENESS_DAYS = 7;

// --- ABP Filter Parsing ---

export function parseAbpHideRules(text) {
  const seen = new Set();
  const selectors = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('!')) continue;
    // Generic cosmetic rules start with ## (no domain prefix)
    if (!trimmed.startsWith('##')) continue;
    const selector = trimmed.slice(2);
    if (selector && !seen.has(selector)) {
      seen.add(selector);
      selectors.push(selector);
    }
  }
  return selectors;
}

// --- Consent-O-Matic Normalization ---

function toArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

const BARE_TAG_RE = /^[a-z][a-z0-9]*$/i;

function extractSelectors(matchers) {
  const selectors = [];
  let requiresVisible = false;
  for (const matcher of toArray(matchers)) {
    if (matcher.type === 'css' && matcher.target?.selector) {
      const sel = matcher.target.selector;
      if (BARE_TAG_RE.test(sel)) continue;
      selectors.push(sel);
      if (matcher.displayFilter) requiresVisible = true;
    }
  }
  return { selectors, requiresVisible };
}

// Consent-O-Matic rules list `methods` as [{ name, action }]. An action is
// either a single step or { type: 'list', actions: [...] }.
function methodSteps(rule, name) {
  const method = toArray(rule.methods).find((m) => m.name === name);
  const flatten = (action) => {
    if (!action) return [];
    if (action.type === 'list') return toArray(action.actions).flatMap(flatten);
    return [action];
  };
  return flatten(method?.action);
}

function quoteText(text) {
  return JSON.stringify(String(text));
}

// Playwright selector for a Consent-O-Matic target: `parent` scopes the
// target, `textFilter` (string or list of alternatives) narrows by text.
function stepSelector(step) {
  const target = step.target ?? {};
  const base = step.parent?.selector
    ? `${step.parent.selector} ${target.selector}`
    : target.selector;
  const texts = toArray(target.textFilter);
  if (texts.length === 0) return base;
  return texts.map((t) => `${base}:has-text(${quoteText(t)})`).join(', ');
}

const PAGE_ROOT_RE = /^(html|body)\b/i;

function extractHideRules(rule, presentSelectors) {
  const rules = methodSteps(rule, 'HIDE_CMP')
    .filter((step) => step.type === 'hide' && step.target?.selector)
    .map((step) => `${stepSelector(step)} { display:none!important }`);
  if (rules.length > 0) return rules;
  // No HIDE_CMP: hide the banner element itself, never <html>/<body>.
  return presentSelectors
    .filter((sel) => !PAGE_ROOT_RE.test(sel.trim()))
    .map((sel) => `${sel} { display:none!important }`);
}

// Open the CMP's options and save. Per-purpose toggles (DO_CONSENT) and
// conditional steps (ifcss, foreach) are skipped, so the CMP saves its
// default choices. A CMP whose save step is conditional-only gets no dismiss
// recipe: clicking "options" without saving would leave the banner up.
function extractDismissActions(rule) {
  const toActions = (name) =>
    methodSteps(rule, name).flatMap((step) => {
      if (step.type === 'click' && step.target?.selector) {
        return [{ action: 'click', selector: stepSelector(step) }];
      }
      if (step.type === 'wait' && step.waitTime) return [{ action: 'wait', ms: step.waitTime }];
      return [];
    });
  const save = toActions('SAVE_CONSENT');
  if (!save.some((a) => a.action === 'click')) return [];
  return [...toActions('OPEN_OPTIONS'), ...save];
}

function hasDroppedFilters(matchers) {
  return toArray(matchers).some((m) => (m.textFilter && m.textFilter.length > 0) || m.childFilter);
}

export function normalizeCmpRules(rawRules) {
  const cmps = {};
  const partialCoverage = [];

  for (const [name, rule] of Object.entries(rawRules)) {
    const detector = rule.detectors?.[0];
    if (!detector) continue;

    const present = extractSelectors(detector.presentMatcher);
    const showing = extractSelectors(detector.showingMatcher);
    const allSelectors = [...new Set([...present.selectors, ...showing.selectors])];

    if (allSelectors.length === 0) continue;

    const hasPartialCoverage =
      hasDroppedFilters(detector.presentMatcher) || hasDroppedFilters(detector.showingMatcher);
    if (hasPartialCoverage) partialCoverage.push(name);

    cmps[name] = {
      detect: allSelectors,
      detect_requires_visible: present.requiresVisible || showing.requiresVisible,
      hide: extractHideRules(rule, present.selectors),
      dismiss: extractDismissActions(rule),
    };
  }

  return { cmps, partial_coverage_cmps: partialCoverage };
}

// --- Cache Management ---

export function isCacheStale(lastFetchPath, maxDays = STALENESS_DAYS) {
  try {
    const timestamp = fs.readFileSync(lastFetchPath, 'utf8').trim();
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return true;
    return Date.now() - ms > maxDays * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export function buildPatternsJson(cmpResult, genericSelectors) {
  return {
    version: 1,
    fetched_at: new Date().toISOString(),
    sources: ['consent-o-matic', 'easylist-cookie'],
    stats: {
      consent_o_matic_cmps: Object.keys(cmpResult.cmps).length,
      easylist_selectors: genericSelectors.length,
      partial_coverage_cmps: cmpResult.partial_coverage_cmps,
    },
    cmps: cmpResult.cmps,
    generic_selectors: genericSelectors,
  };
}

// --- Bundle ---

export function buildBundle(patterns, detectScriptSource) {
  const patternsJson = JSON.stringify(patterns);
  return `(function(){'use strict';var PATTERNS=${patternsJson};${detectScriptSource}})()`;
}

// --- Fetch URLs ---

const CONSENT_O_MATIC_RULES =
  'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/Rules.json';
const EASYLIST_COOKIE_HIDE =
  'https://raw.githubusercontent.com/easylist/easylist/master/' +
  'easylist_cookie/easylist_cookie_general_hide.txt';

export async function fetchConsentOMatic(fetch = globalThis.fetch) {
  const res = await fetch(CONSENT_O_MATIC_RULES);
  if (!res.ok) throw new Error(`Consent-O-Matic fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchEasyList(fetch = globalThis.fetch) {
  const res = await fetch(EASYLIST_COOKIE_HIDE);
  if (!res.ok) throw new Error(`EasyList fetch failed: ${res.status}`);
  return res.text();
}

// One `eval` expression that injects the hide rules of the selected overlays
// (ids, or 'all') plus scroll_fix as a stylesheet. The CSS is JSON-encoded so
// quotes and backslashes in selectors cannot break the string.
export function buildHideExpression(report, ids) {
  const selected = ids.includes('all')
    ? report.overlays
    : report.overlays.filter((o) => ids.includes(o.id));
  const rules = selected.flatMap((o) =>
    o.hide?.length ? o.hide : [`${o.selector} { display:none!important }`],
  );
  if (report.scroll_locked && report.scroll_fix) rules.push(report.scroll_fix);
  const css = JSON.stringify(rules.join('\n'));
  const style = `Object.assign(document.createElement('style'), { textContent: ${css} })`;
  return `document.head.appendChild(${style}) && 'ok'`;
}

// --- Loading ---

async function settle(promise, label, stderr) {
  try {
    return await promise;
  } catch (err) {
    stderr.write(`Warning: ${label} fetch failed: ${err.message}\n`);
    return undefined;
  }
}

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function fetchPatterns(fetch, cached, stderr) {
  const [rawRules, rawText] = await Promise.all([
    settle(fetchConsentOMatic(fetch), 'Consent-O-Matic', stderr),
    settle(fetchEasyList(fetch), 'EasyList', stderr),
  ]);
  if (!rawRules && rawText === undefined) throw new Error('both sources failed');
  const cmpResult = rawRules
    ? normalizeCmpRules(rawRules)
    : {
        cmps: cached?.cmps ?? {},
        partial_coverage_cmps: cached?.stats?.partial_coverage_cmps ?? [],
      };
  const selectors =
    rawText === undefined
      ? (cached?.generic_selectors ?? [])
      : parseAbpHideRules(rawText).slice(0, 1000);
  return buildPatternsJson(cmpResult, selectors);
}

// Seen on live Shopify stores, absent from EasyList.
export const BUILTIN_SELECTORS = [
  '#shopify-pc__banner',
  '.shopify-pc__banner__dialog',
  '#shopify-pc__prefs',
];

function withBuiltins(patterns) {
  const generic = [...new Set([...(patterns.generic_selectors ?? []), ...BUILTIN_SELECTORS])];
  return { ...patterns, generic_selectors: generic };
}

/**
 * Load the overlay pattern database, refreshing the cache when missing, stale or forced.
 * @param {{ refresh?: boolean, fetch?: Function, cacheDir?: string,
 *   stderr?: { write: Function } }} [options]
 * @returns {Promise<object>} patterns
 */
export async function loadPatterns(options) {
  return withBuiltins(await loadRawPatterns(options));
}

async function loadRawPatterns({
  refresh = false,
  fetch = globalThis.fetch,
  cacheDir = CACHE_DIR,
  stderr = process.stderr,
} = {}) {
  const patternsFile = path.join(cacheDir, 'patterns.json');
  const lastFetchFile = path.join(cacheDir, 'last-fetch');
  const cached = readCache(patternsFile);
  if (cached && !refresh && !isCacheStale(lastFetchFile)) return cached;
  try {
    const patterns = await fetchPatterns(fetch, cached, stderr);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(patternsFile, JSON.stringify(patterns, null, 2));
    fs.writeFileSync(lastFetchFile, new Date().toISOString());
    return patterns;
  } catch (err) {
    if (cached) {
      stderr.write(`Warning: ${err.message}. Using cached pattern database.\n`);
      return cached;
    }
    throw new CliError('FAILURE', `cannot fetch overlay pattern database: ${err.message}`, {
      hint: 'check network access or retry with --refresh-db later',
    });
  }
}
