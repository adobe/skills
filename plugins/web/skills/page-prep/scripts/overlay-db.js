#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CACHE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || os.homedir(),
  '.cache',
  'page-prep'
);
const PATTERNS_FILE = path.join(CACHE_DIR, 'patterns.json');
const LAST_FETCH_FILE = path.join(CACHE_DIR, 'last-fetch');
const STALENESS_DAYS = 7;

// --- ABP Filter Parsing ---

function parseAbpHideRules(text) {
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
  const toActions = (name) => methodSteps(rule, name).flatMap((step) => {
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
  return toArray(matchers).some(
    (m) => (m.textFilter && m.textFilter.length > 0) || m.childFilter
  );
}

function normalizeCmpRules(rawRules) {
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
      hasDroppedFilters(detector.presentMatcher) ||
      hasDroppedFilters(detector.showingMatcher);
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

function isCacheStale(lastFetchPath, maxDays = STALENESS_DAYS) {
  try {
    const timestamp = fs.readFileSync(lastFetchPath, 'utf8').trim();
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return true;
    return Date.now() - ms > maxDays * 24 * 60 * 60 * 1000;
  } catch { return true; }
}

function buildPatternsJson(cmpResult, genericSelectors) {
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

function buildBundle(patterns, detectScriptSource) {
  const patternsJson = JSON.stringify(patterns);
  return `(function(){'use strict';var PATTERNS=${patternsJson};${detectScriptSource}})()`;
}

// --- Fetch URLs ---

const CONSENT_O_MATIC_RULES = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/Rules.json';
const EASYLIST_COOKIE_HIDE = 'https://raw.githubusercontent.com/easylist/easylist/master/easylist_cookie/easylist_cookie_general_hide.txt';

async function fetchConsentOMatic() {
  const res = await fetch(CONSENT_O_MATIC_RULES);
  if (!res.ok) throw new Error(`Consent-O-Matic fetch failed: ${res.status}`);
  return res.json();
}

async function fetchEasyList() {
  const res = await fetch(EASYLIST_COOKIE_HIDE);
  if (!res.ok) throw new Error(`EasyList fetch failed: ${res.status}`);
  return res.text();
}

// --- CLI Commands ---

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

async function cmdRefresh(force) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!force && !isCacheStale(LAST_FETCH_FILE)) {
    console.error('Cache is fresh. Use --force to re-fetch.');
    return;
  }

  let cmpResult = { cmps: {}, partial_coverage_cmps: [] };
  let genericSelectors = [];
  let cmpOk = false;
  let easyOk = false;

  try {
    const rawRules = await fetchConsentOMatic();
    cmpResult = normalizeCmpRules(rawRules);
    cmpOk = true;
  } catch (err) { console.error(`Warning: Consent-O-Matic fetch failed: ${err.message}`); }

  try {
    const rawText = await fetchEasyList();
    genericSelectors = parseAbpHideRules(rawText).slice(0, 1000);
    easyOk = true;
  } catch (err) { console.error(`Warning: EasyList fetch failed: ${err.message}`); }

  if (!cmpOk && !easyOk) {
    if (fs.existsSync(PATTERNS_FILE)) {
      console.error('Warning: Both sources failed. Using stale cache.');
      return;
    }
    die('No pattern database available. Check network connectivity and retry with --force.');
  }

  if (fs.existsSync(PATTERNS_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
      if (!cmpOk) cmpResult = { cmps: cached.cmps, partial_coverage_cmps: cached.stats?.partial_coverage_cmps ?? [] };
      if (!easyOk) genericSelectors = cached.generic_selectors ?? [];
    } catch { /* ignore corrupt cache */ }
  }

  const patterns = buildPatternsJson(cmpResult, genericSelectors);
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2));
  fs.writeFileSync(LAST_FETCH_FILE, new Date().toISOString());
  const cmpCount = Object.keys(patterns.cmps).length;
  const selCount = patterns.generic_selectors.length;
  console.log(`Refreshed: ${cmpCount} CMPs, ${selCount} generic selectors.`);
}

function cmdStatus() {
  if (!fs.existsSync(PATTERNS_FILE)) { console.log('No cache. Run: node overlay-db.js refresh'); return; }
  const patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
  const stale = isCacheStale(LAST_FETCH_FILE);
  console.log(`Fetched: ${patterns.fetched_at}`);
  console.log(`Status: ${stale ? 'STALE' : 'fresh'}`);
  console.log(`CMPs: ${Object.keys(patterns.cmps).length}`);
  console.log(`Generic selectors: ${patterns.generic_selectors.length}`);
  if (patterns.stats?.partial_coverage_cmps?.length > 0) {
    console.log(`Partial coverage: ${patterns.stats.partial_coverage_cmps.join(', ')}`);
  }
}

function cmdLookup(query) {
  if (!query) die('Usage: node overlay-db.js lookup <cmp-name>');
  if (!fs.existsSync(PATTERNS_FILE)) die('No cache. Run: node overlay-db.js refresh');
  const patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
  const matches = Object.entries(patterns.cmps).filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
  if (matches.length === 0) { console.log(`No known CMP rules matching "${query}".`); }
  else { for (const [name, rule] of matches) { console.log(`${name}: detect=${rule.detect.join(', ')}`); } }
}

function cmdBundle() {
  if (!fs.existsSync(PATTERNS_FILE)) die('No cache. Run: node overlay-db.js refresh');
  const patterns = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
  const detectPath = path.join(__dirname, 'overlay-detect.js');
  if (!fs.existsSync(detectPath)) die('overlay-detect.js not found next to overlay-db.js');
  const detectScript = fs.readFileSync(detectPath, 'utf8');
  process.stdout.write(buildBundle(patterns, detectScript));
}

// --- Hide expression ---

// Accepts the detection report as raw JSON, as a JSON-encoded string, or as
// saved `playwright-cli eval` output (### Result ... ### Ran Playwright code).
function parseReport(text) {
  const start = text.indexOf('### Result');
  const end = text.lastIndexOf('### Ran Playwright code');
  const body = start === -1 ? text : text.slice(start + '### Result'.length, end === -1 ? undefined : end);
  const parsed = JSON.parse(body.trim());
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}

// One `playwright-cli eval` expression that injects the hide rules of the
// selected overlays (ids, or 'all') plus scroll_fix as a stylesheet. The CSS is
// JSON-encoded so quotes and backslashes in selectors cannot break the string.
function buildHideExpression(report, ids) {
  const selected = ids.includes('all')
    ? report.overlays
    : report.overlays.filter((o) => ids.includes(o.id));
  const rules = selected.flatMap((o) => o.hide ?? []);
  if (report.scroll_locked && report.scroll_fix) rules.push(report.scroll_fix);
  const css = JSON.stringify(rules.join('\n'));
  return `document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${css} })) && 'ok'`;
}

function cmdHideExpr(reportPath, ids) {
  if (!reportPath) die('Usage: node overlay-db.js hide-expr <report-file> [all | overlay-id...]');
  let report;
  try { report = parseReport(fs.readFileSync(reportPath, 'utf8')); }
  catch (err) { die(`Cannot read detection report ${reportPath}: ${err.message}`); }
  process.stdout.write(buildHideExpression(report, ids));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const force = args.includes('--force');
  switch (command) {
    case 'refresh': await cmdRefresh(force); break;
    case 'status': cmdStatus(); break;
    case 'lookup': cmdLookup(args[1]); break;
    case 'bundle': cmdBundle(); break;
    case 'hide-expr': cmdHideExpr(args[1], args.slice(2)); break;
    default:
      console.error(['Usage: overlay-db.js <command> [options]', '', 'Commands:', '  refresh [--force]   Fetch/update pattern databases', '  status              Show cache age and stats', '  lookup <cmp-name>   Check if a CMP is in the database', '  bundle              Output injectable script with embedded patterns', '  hide-expr <report> [all | overlay-id...]', '                      Output an eval expression hiding those overlays (+ scroll_fix)'].join('\n'));
      process.exit(command ? 1 : 0);
  }
}

if (require.main === module) { main().catch((err) => die(err.message)); }

module.exports = { parseAbpHideRules, normalizeCmpRules, isCacheStale, buildPatternsJson, buildBundle, parseReport, buildHideExpression };
