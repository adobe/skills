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

function extractHideSelectors(hideActions) {
  const rules = [];
  for (const action of toArray(hideActions)) {
    if (action.type === 'hide' && action.target?.selector) {
      rules.push(`${action.target.selector} { display:none!important }`);
    }
  }
  return rules;
}

function extractDismissActions(doConsent, saveConsent) {
  const actions = [];
  for (const action of toArray(doConsent)) {
    if (action.type === 'click' && action.target?.selector) {
      actions.push({ action: 'click', selector: action.target.selector });
    }
  }
  for (const action of toArray(saveConsent)) {
    if (action.type === 'wait' && action.waitTime) {
      actions.push({ action: 'wait', ms: action.waitTime });
    }
    if (action.type === 'click' && action.target?.selector) {
      actions.push({ action: 'click', selector: action.target.selector });
    }
  }
  return actions;
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
    const method = rule.methods?.[0];
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
      hide: extractHideSelectors(method?.HIDE_CMP),
      dismiss: extractDismissActions(method?.DO_CONSENT, method?.SAVE_CONSENT),
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const force = args.includes('--force');
  switch (command) {
    case 'refresh': await cmdRefresh(force); break;
    case 'status': cmdStatus(); break;
    case 'lookup': cmdLookup(args[1]); break;
    case 'bundle': cmdBundle(); break;
    default:
      console.error(['Usage: overlay-db.js <command> [options]', '', 'Commands:', '  refresh [--force]   Fetch/update pattern databases', '  status              Show cache age and stats', '  lookup <cmp-name>   Check if a CMP is in the database', '  bundle              Output injectable script with embedded patterns'].join('\n'));
      process.exit(command ? 1 : 0);
  }
}

if (require.main === module) { main().catch((err) => die(err.message)); }

module.exports = { parseAbpHideRules, normalizeCmpRules, isCacheStale, buildPatternsJson, buildBundle };
