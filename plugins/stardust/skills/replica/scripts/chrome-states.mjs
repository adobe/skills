#!/usr/bin/env node
/**
 * skills/replica/scripts/chrome-states.mjs
 *
 * Chrome STATE-MATRIX probe. The resting header crop (source-fidelity-gate.md
 * § Pass bar, item 5) measures ONE cell of the matrix
 *
 *   {theme variant per page type} × {rest, scrolled} × {each top-level trigger OPEN}
 *                                 × {search OPEN} × {language switcher OPEN}
 *                                 × {mobile: drawer OPEN, drilled one level}
 *                                 × {footer accordion OPEN at the mobile width}
 *
 * and every other cell is what a reviewer touches first on the delivered site.
 * This instrument enumerates the triggers on the LIVE page, opens every state
 * (hover → click fallback), associates each trigger with its panel even when
 * the panel lives OUTSIDE the trigger's <li> (aria-controls / data-menu / the
 * newly-visible diff — portal roots), records the opened panel's rect, the
 * computed-style atoms chrome-parity diffs (same STYLE group, same pairing —
 * ONE diff engine) and a neutral nav document model, writes a panel-rect PNG
 * + provenance sidecar per state, and — with a build URL — replays every
 * state on the build by trigger text, diffs it (compareRegion) and crops it
 * (crop-compare.mjs, the existing ≥98 % bar; cells added, bar unchanged).
 * A live-observed cell the build cannot open is `missing on build`.
 *
 * Reference: `../reference/chrome-states.md` (the gate contract: condition,
 * escape hatch, hands-off, residual route, the progress.json `chrome` block).
 *
 * Usage:
 *   node skills/replica/scripts/chrome-states.mjs <liveURL> [<buildURL>] [options]
 *     --width <px>          desktop width                                 (default 1440)
 *     --mobile <px>         mobile width for drawer / drill / footer accordion (default 360)
 *     --no-mobile           skip the mobile pass (one live navigation fewer)
 *     --from-state <f>      sample one live URL per page type from state.json.pages[]
 *                           for theme-variant clustering (one navigation per sample)
 *     --page <url>          extra live page for variant clustering (repeatable)
 *     --trigger <sel>[|<buildSel>]   top-level trigger override (default: attribute pass)
 *     --panel <sel>[|<buildSel>]     opened-panel override (default: association chain)
 *     --search <sel>[|<buildSel>]    search control override
 *     --toggle <sel>[|<buildSel>]    mobile menu toggle override
 *     --out <dir>           output dir  (default stardust/replica/gates/<slug>-<width>/chrome-states)
 *     --json [file]         machine-readable report (schema 1) to <file> or stdout
 *     --live-cache <f>      reuse/write the live side (all states, both widths, samples)
 *                           — one live navigation per breakpoint per URL; the key
 *                           carries width, mobile width, overrides and the sample list
 *                           (convention gates/<slug>-<w>/chrome-live-states.json)
 *     --consent <sel> | --dismiss <sel,…> | --consent-mode accept|deny | --block <substr,…>
 *     --headed[=window] | --locale <tag> | --storage-state <f> | --fresh-state | --solve-wait <ms>
 *                           live-session.mjs flags, same semantics as chrome-parity
 *     --help
 *
 * Exit codes:
 *   0  live-only inventory written, or build given and every cell paired within tolerance
 *   2  build given: at least one cell with deltas, an over-bar crop, or missing on build
 *   1  error (bad flag, no header, unreadable state file, crop step crashed)
 *   3  bot challenge on the live side (fail loud — never measured)
 *   (124 from run-capped.mjs = deadline: NO verdict, not a FAIL, not a MISSING)
 *
 * "no panel opened" for a trigger is a WARN (a plain link), never a delta.
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both); crop-compare needs
 * pixelmatch + pngjs (a missing pixel dep downgrades the crop step to a WARN).
 * Ported from a field-written first generation (2026-09) and hardened:
 * live-session ladder, attribute-first enumeration, panel-rect crops, cache.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { dirname, resolve as resolvePath, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { STYLE, probeRegion, occlusionPass, compareRegion } from './chrome-parity.mjs';
import { TRIGGER_SELECTOR, isNavigationError } from './motion-observe.mjs';
import { writeSidecar } from './capture-sidecar.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('chrome-states error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, launchTier, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, sessionContextOptions, parseSolveWaitFlag, dismissOverlays, reportOverlayResidue, defaultWaitUntil } = await import(pathToFileURL(LIVE_SESSION).href);

export const SCHEMA = 1;
export const STATE_CLASS_RE = /^(is-|has-|js-|active|open|opened|expanded|sticky|scrolled|fixed|pinned|shrink|collapsed|hover)/i;

const HELP = `chrome-states — open every chrome state on live (and the build), crop + diff each cell, emit a nav model

Usage: node chrome-states.mjs <liveURL> [<buildURL>] [options]
  --width <px>        desktop width (default 1440)      --mobile <px>  mobile width (default 360)   --no-mobile
  --from-state <f>    one live sample per page type from state.json.pages[]   --page <url>  extra sample (repeatable)
  --trigger|--panel|--search|--toggle <sel>[|<buildSel>]   selector overrides when the attribute pass finds nothing
  --out <dir>         output dir (default stardust/replica/gates/<slug>-<width>/chrome-states)
  --json [file]       report (schema ${SCHEMA}) to <file> or stdout
  --live-cache <f>    reuse/write the live side — one live navigation per breakpoint per URL
  --consent <sel> | --dismiss <sel,…> | --consent-mode accept|deny | --block <substr,…>
  --headed[=window] | --locale <tag> | --storage-state <f> | --fresh-state | --solve-wait <ms>
  --help              this text

Exit codes: 0 quiet / inventory, 2 deltas or missing cells (build given), 1 error, 3 bot challenge (live side).
run-capped 124 = deadline: no verdict (not a FAIL, not a MISSING).`;

// ------------------------------------------------------------------ pure halves

const pairSpec = (spec, flag) => {
  const m = String(spec || '').match(/^([^|]+)(?:\|(.+))?$/);
  if (!m) { console.error(`bad ${flag} "${spec}" — expected <liveSel>[|<buildSel>]\n\n${HELP}`); process.exit(1); }
  return { live: m[1].trim(), build: (m[2] || m[1]).trim() };
};

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, mobile: 360, noMobile: false, fromState: null, pages: [], trigger: null, panel: null, search: null, toggle: null, out: null, json: false, jsonFile: null, liveCache: null, consent: null, dismiss: [], consentMode: 'accept', block: [], headed: false, locale: null, tolerance: 1 };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(rest[i += 1]);
    else if (a === '--mobile') opts.mobile = Number(rest[i += 1]);
    else if (a === '--no-mobile') opts.noMobile = true;
    else if (a === '--from-state') opts.fromState = rest[i += 1];
    else if (a === '--page') opts.pages.push(rest[i += 1]);
    else if (a === '--trigger') opts.trigger = pairSpec(rest[i += 1], a);
    else if (a === '--panel') opts.panel = pairSpec(rest[i += 1], a);
    else if (a === '--search') opts.search = pairSpec(rest[i += 1], a);
    else if (a === '--toggle') opts.toggle = pairSpec(rest[i += 1], a);
    else if (a === '--out') opts.out = rest[i += 1];
    else if (a === '--tolerance') opts.tolerance = Number(rest[i += 1]);
    else if (a === '--json') { opts.json = true; if (rest[i + 1] && !rest[i + 1].startsWith('--')) opts.jsonFile = rest[i += 1]; }
    else if (a === '--live-cache') opts.liveCache = rest[i += 1];
    else if (a === '--consent') opts.consent = rest[i += 1];
    else if (a === '--dismiss') opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--block') opts.block = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--consent-mode') { opts.consentMode = rest[i += 1]; if (!['accept', 'deny'].includes(opts.consentMode)) { console.error(`--consent-mode must be accept or deny\n\n${HELP}`); process.exit(1); } }
    else if (a === '--headed' || a.startsWith('--headed=')) opts.headed = parseHeadedFlag(a);
    else if (a === '--storage-state') opts.storageState = rest[i += 1];
    else if (a === '--fresh-state') opts.freshState = true;
    else if (a === '--solve-wait') { opts.solveWaitMs = parseSolveWaitFlag(rest[i += 1]); opts.headed = 3; }
    else if (a === '--locale') opts.locale = rest[i += 1];
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (!(opts.width > 0) || !(opts.mobile > 0)) { console.error(`--width/--mobile need px values > 0\n\n${HELP}`); process.exit(1); }
  const [live, build = null] = pos;
  if (!live) { console.error(`need <liveURL>\n\n${HELP}`); process.exit(1); }
  if (!opts.out) opts.out = `stardust/replica/gates/${slugOf(live)}-${opts.width}/chrome-states`;
  return { live, build, opts };
}

export function slugOf(url) {
  try { const p = new URL(url).pathname.replace(/\/+$/, ''); return p ? p.split('/').filter(Boolean).join('-').replace(/[^\w-]+/g, '-').toLowerCase() : 'home'; } catch { return 'home'; }
}

export const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** One live sample URL per page type (+ home) from state.json.pages[] — the variant sample set. */
export function samplesFromState(state, liveUrl) {
  const pages = Array.isArray(state && state.pages) ? state.pages : [];
  const seen = new Set(); const out = [];
  for (const p of pages) {
    if (!p || !p.url || p.url === liveUrl) continue;
    const key = p.type || 'untyped';
    if (seen.has(key)) continue;
    seen.add(key); out.push({ url: p.url, type: key, slug: p.slug || null });
  }
  return out;
}

/** The variant key T18.1 consumes — the chrome identity fields that decide a theme variant. */
export function variantKeyOf(id) {
  if (!id) return null;
  return { navPosition: id.position, navBackground: id.background, linkColor: id.color, logoFill: id.logoFill, headerHeightRest: id.height, headerHeightScrolled: id.heightScrolled ?? null, hasSubnavBand: !!id.hasSubnavBand, footerHeight: id.footerHeight ?? null };
}
export const variantSig = (key) => (key ? JSON.stringify([key.navPosition, key.navBackground, key.linkColor, key.logoFill, key.hasSubnavBand]) : 'null');

/** Cluster sampled pages by variant signature: [{ sig, key, urls[] }] — one entry per distinct chrome variant. */
export function clusterVariants(samples) {
  const map = new Map();
  for (const s of samples) {
    const key = variantKeyOf(s.identity); const sig = variantSig(key);
    if (!map.has(sig)) map.set(sig, { sig, key, urls: [] });
    map.get(sig).urls.push(s.url);
  }
  return [...map.values()];
}

/**
 * Pair live states with build states by trigger text. Returns
 * { paired: [{ name, live, build }], missing: [liveState], extra: [buildState] }.
 * A live cell that opened a panel and has no build pair is MISSING (exit 2);
 * a build-only cell is EXTRA (a WARN — an invented panel).
 */
export function pairStates(liveStates, buildStates) {
  const bIdx = new Map((buildStates || []).map((s) => [normText(s.text), s]));
  const used = new Set(); const paired = []; const missing = [];
  for (const L of liveStates || []) {
    const B = bIdx.get(normText(L.text));
    if (B) { used.add(normText(L.text)); paired.push({ name: L.name, live: L, build: B }); }
    else if (L.panel) missing.push(L);
  }
  const extra = (buildStates || []).filter((s) => !used.has(normText(s.text)) && s.panel);
  return { paired, missing, extra };
}

/**
 * Link-set validation: every flat visible nav link at rest must appear in the
 * model (else WARN — enumeration gap); model-only links are `panel-only
 * (off-DOM at rest)` — informational, the signal a rest-state gate never sees.
 */
export function linkSetCheck(model, flatLinks) {
  const modelHrefs = new Set();
  const walk = (items) => { for (const it of items || []) { if (it.href) modelHrefs.add(it.href); walk(it.items); if (it.action && it.action.href) modelHrefs.add(it.action.href); for (const p of it.promos || []) if (p.cta && p.cta.href) modelHrefs.add(p.cta.href); } };
  walk(model && model.groups); for (const p of (model && model.promos) || []) if (p.cta && p.cta.href) modelHrefs.add(p.cta.href);
  for (const f of (model && model.footerLinks) || []) if (f.href) modelHrefs.add(f.href);
  const flat = new Set((flatLinks || []).map((l) => l.href).filter(Boolean));
  return { missingFromModel: [...flat].filter((h) => !modelHrefs.has(h)), panelOnly: [...modelHrefs].filter((h) => !flat.has(h)) };
}

/** The live cache key — a mismatch re-probes (never a stale site, breakpoint or override set). */
export function cacheKey(live, opts, samples) {
  return { url: live, width: opts.width, mobile: opts.noMobile ? null : opts.mobile, overrides: { trigger: opts.trigger && opts.trigger.live, panel: opts.panel && opts.panel.live, search: opts.search && opts.search.live, toggle: opts.toggle && opts.toggle.live }, samples: samples.map((s) => s.url) };
}

// --------------------------------------------------------------- in-page code
// Every function below runs inside page.evaluate: self-contained, one argument.
/* eslint-disable no-undef */

function pageEnumerate({ triggerSelector, overrides, extra }) {
  const root = document.querySelector('header, [role="banner"]') || document.body;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const painted = (e) => (e.checkVisibility ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true) && !e.closest('details:not([open]) > :not(summary), details:not([open]) > :not(summary) *');
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && painted(el); };
  const label = (el) => norm(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').slice(0, 40) || norm((el.querySelector('img') || {}).alt || '').slice(0, 40) || `<${el.tagName.toLowerCase()}>`;
  const seen = new Set(); const out = [];
  const SEARCH_RE = /search|suche|recherche|buscar|cerca|zoeken/i;
  const add = (el, kind) => {
    if (!el || seen.has(el) || !vis(el) || el.closest('[hidden], [aria-hidden="true"]')) return;
    if (el.matches('[type="submit"], input')) return;
    if (kind === 'menu' && el.matches('a[href]') && !el.matches('[aria-haspopup], [aria-controls], [aria-expanded]') && !el.closest('li:has(> ul, > div ul)')) return;
    if (kind === 'menu' && SEARCH_RE.test(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''} ${el.className || ''} ${el.getAttribute('aria-controls') || ''}`)) kind = 'search';
    seen.add(el);
    const i = out.length; el.setAttribute('data-cs-trigger', String(i));
    out.push({ i, sel: `[data-cs-trigger="${i}"]`, text: label(el), kind, controls: el.getAttribute('aria-controls') || null, dataMenu: el.getAttribute('data-menu') || (el.closest('[data-menu]') || {}).getAttribute?.('data-menu') || null, href: el.getAttribute('href') || null, tag: el.tagName.toLowerCase() });
  };
  // mobile toggle FIRST (else the generic pass claims the burger as a menu trigger)
  if (extra.toggle) {
    if (overrides.toggle) for (const el of document.querySelectorAll(overrides.toggle)) add(el, 'toggle');
    else {
      let t = [...root.querySelectorAll('button[aria-expanded], button[aria-controls], [aria-label*="menu" i], [class*="burger" i], [class*="hamburger" i], [class*="menu-toggle" i], [class*="nav-toggle" i]')].find((el) => vis(el) && !SEARCH_RE.test(`${el.getAttribute('aria-label') || ''} ${el.className || ''}`));
      if (!t) t = [...root.querySelectorAll('button, [role="button"], a')].find((el) => { const r = el.getBoundingClientRect(); return vis(el) && r.width >= 24 && r.height >= 24 && r.width <= 90 && r.y < 120 && !/search|logo|home/i.test(`${el.textContent} ${el.getAttribute('aria-label')}`); });
      if (t) add(t, 'toggle');
    }
  }
  if (overrides.trigger) { for (const el of document.querySelectorAll(overrides.trigger)) add(el, 'menu'); }
  else {
    for (const el of root.querySelectorAll(triggerSelector)) { if (el.matches('summary') || el.closest('footer')) continue; add(el, 'menu'); }
    for (const li of root.querySelectorAll('nav li:has(> ul), nav li:has(> div ul)')) { const t = li.querySelector(':scope > a, :scope > button, :scope > span'); if (t) add(t, 'menu'); }
    if (out.filter((t) => t.kind === 'menu').length < 2) { // donor fallback: short nav items in the header row
      for (const li of root.querySelectorAll('nav li, [class*="nav"] li, [role="menubar"] > *')) { const r = li.getBoundingClientRect(); const t = norm(li.textContent); if (r.width > 30 && r.y < 160 && t.length > 1 && t.length < 32 && !li.querySelector('li')) add(li.querySelector('a, button') || li, 'menu'); }
    }
  }
  // search: [role=search] controls, search-labelled controls (never the input itself)
  if (overrides.search) for (const el of document.querySelectorAll(overrides.search)) add(el, 'search');
  else for (const el of root.querySelectorAll('button, a, [role="button"]')) { if (SEARCH_RE.test(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''} ${el.className || ''} ${el.getAttribute('aria-controls') || ''}`) && !el.closest('form[role="search"] input')) add(el, 'search'); }
  // language / region switchers
  for (const el of root.querySelectorAll('[hreflang], [lang]:not(html), [class*="lang" i], [class*="locale" i], [class*="region" i]')) { const t = el.matches('button, a, [role="button"], [aria-expanded]') ? el : el.querySelector('button, [aria-expanded], [aria-haspopup]'); if (t) add(t, 'language'); }
  // footer accordions (details/summary or aria-expanded in footer) — opened at the mobile width
  if (extra.footer) for (const el of document.querySelectorAll('footer details > summary, footer [aria-expanded]')) add(el, 'footer-accordion');
  return out;
}

function pageTopLevelNav() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const list = ['header nav ul', '[role="banner"] nav ul', 'header [role="menubar"]', 'header nav', '[role="banner"] nav'].map((q) => document.querySelector(q)).find(Boolean); // priority order, not document order
  if (!list) return [];
  return [...list.children].filter(vis).map((li) => { const a = li.matches('a, button') ? li : li.querySelector(':scope > a, :scope > button, :scope > span, a, button'); return a ? { label: norm(a.getAttribute('aria-label') || a.textContent).slice(0, 40), href: a.getAttribute('href') || null } : null; }).filter(Boolean);
}

function pageFlatNavLinks() {
  const root = document.querySelector('header nav, [role="banner"] nav, header, [role="banner"]') || document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  return [...root.querySelectorAll('a[href]')].filter((a) => vis(a) && !a.querySelector('img, svg') && a.textContent.trim()).map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), href: a.getAttribute('href') }));
}

// Mark every element visible BEFORE the action (same floor as the finder's
// visible()), so "newly visible" afterwards means exactly that.
function pageSnapshotVisible() {
  let n = 0;
  const painted = (e) => (e.checkVisibility ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true) && !e.closest('details:not([open]) > :not(summary), details:not([open]) > :not(summary) *');
  for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.width > 40 && r.height > 20 && cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none' && painted(e)) { e.setAttribute('data-cs-vis', '1'); n++; } }
  return n;
}

// Associate the opened panel: aria-controls → data-menu → newly-visible diff
// (largest fresh element, positioned ones first) → null. Marks it data-cs-panel.
function pageFindPanel({ triggerSel, override, minW = 200, minH = 80 }) {
  const t = document.querySelector(triggerSel);
  // painted: skipped subtrees (closed <details>, content-visibility) keep box
  // geometry in Chromium but are not rendered — a false "newly visible"
  const painted = (e) => (e.checkVisibility ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true) && !e.closest('details:not([open]) > :not(summary), details:not([open]) > :not(summary) *');
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 40 && r.height > 20 && cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none' && painted(e); };
  const mark = (el, how) => { document.querySelectorAll('[data-cs-panel]').forEach((e) => e.removeAttribute('data-cs-panel')); el.setAttribute('data-cs-panel', '1'); const r = el.getBoundingClientRect(); return { sel: '[data-cs-panel="1"]', how, rect: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }, tag: el.tagName.toLowerCase(), id: el.id || null, cls: String(el.className || '').trim().split(/\s+/).slice(0, 3).join(' ') } ; };
  if (override) { const el = document.querySelector(override); if (el && visible(el)) return mark(el, 'override'); }
  if (t) {
    const id = String(t.getAttribute('aria-controls') || '').split(/\s+/)[0];
    const byId = id && document.getElementById(id); if (byId && visible(byId)) return mark(byId, 'aria-controls');
    if (t.matches('summary') && t.parentElement && t.parentElement.open) { const content = [...t.parentElement.children].filter((c) => c !== t && visible(c)); if (content.length) return mark(content.length === 1 ? content[0] : t.parentElement, 'details'); }
    const dm = t.getAttribute('data-menu') || (t.closest('[data-menu]') || {}).getAttribute?.('data-menu');
    if (dm) { const p = [...document.querySelectorAll(`[data-menu="${dm}"]`)].find((e) => e !== t && !e.contains(t) && !t.contains(e) && visible(e)); if (p) return mark(p, 'data-menu'); }
    const own = t.closest('li'); const nested = own ? [...own.querySelectorAll('ul, div')].find((e) => !e.contains(t) && visible(e) && e.getBoundingClientRect().height > 40) : null; if (nested) return mark(nested, 'nested-list');
  }
  const fresh = [...document.querySelectorAll('body *')].filter((e) => !e.hasAttribute('data-cs-vis') && e.getBoundingClientRect().width > minW && e.getBoundingClientRect().height > minH && visible(e) && !(t && (e === t || e.contains(t))));
  if (!fresh.length) return null;
  const area = (e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
  const positioned = fresh.filter((e) => /absolute|fixed/.test(getComputedStyle(e).position));
  const pool = positioned.length ? positioned : fresh;
  pool.sort((a, b) => area(b) - area(a));
  const top = pool.find((e) => !pool.some((o) => o !== e && o.contains(e) && area(o) <= area(e) * 1.05)) || pool[0];
  return mark(top, positioned.length ? 'newly-visible-positioned' : 'newly-visible');
}

// Neutral nav document model of ONE opened panel (T18.4 owns the /nav serialisation):
// groups = columns (heading or first link), items {label, href, description, external}, action = trailing link; promos = cells with a picture and a CTA.
function pageNavModel({ panelSel, triggerSel }) {
  const panel = document.querySelector(panelSel); const t = document.querySelector(triggerSel);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  if (!panel) return null;
  const isExternal = (a) => { try { return a.target === '_blank' || new URL(a.href, location.href).origin !== location.origin; } catch { return false; } };
  const item = (a) => { const li = a.closest('li') || a.parentElement; const desc = li && li.querySelector('p, small, em, [class*="desc" i], [class*="sub" i]'); return { label: norm(a.textContent).slice(0, 80), href: a.getAttribute('href'), description: desc && !desc.contains(a) ? norm(desc.textContent).slice(0, 160) : null, external: isExternal(a) || null, icon: !!a.querySelector('img, svg') || null }; };
  const hasLink = (e) => !!e.querySelector('a[href]');
  let level = [panel];
  for (;;) { // the column row: first depth with ≥ 2 link-bearing siblings that are not the <li> of one list
    const kids = level.flatMap((e) => [...e.children].filter(hasLink));
    if (kids.length === 0 || (kids.length >= 2 && kids.every((k) => k.tagName === 'LI'))) break;
    level = kids; if (kids.length >= 2) break;
  }
  const cols = level;
  const groups = []; const promos = [];
  for (const c of cols) {
    c.setAttribute('data-cs-col', '1');
    const links = [...c.querySelectorAll('a[href]')];
    const pic = c.querySelector('img, picture, video');
    const heading = c.querySelector('h2, h3, h4, h5, [class*="title" i], [class*="head" i]');
    if (pic && links.length <= 2 && !c.querySelector('ul')) { promos.push({ image: pic.currentSrc || pic.src || (pic.querySelector && pic.querySelector('img') || {}).src || null, title: heading ? norm(heading.textContent) : null, description: (c.querySelector('p') ? norm(c.querySelector('p').textContent) : null), cta: links[0] ? { label: norm(links[0].textContent), href: links[0].getAttribute('href') } : null }); continue; }
    const listLinks = [...c.querySelectorAll('ul a[href], ol a[href]')];
    const trailing = links.filter((a) => !listLinks.includes(a) && (heading ? !heading.contains(a) : true));
    const head = heading ? norm(heading.textContent) : (links[0] ? norm(links[0].textContent) : null);
    const headHref = heading && heading.querySelector('a[href]') ? heading.querySelector('a[href]').getAttribute('href') : (heading || !links[0] ? null : links[0].getAttribute('href'));
    const items = (listLinks.length ? listLinks : links.slice(heading ? 0 : 1)).map(item);
    groups.push({ label: head, href: headHref, icon: !!(heading && heading.querySelector('img, svg')) || null, items, action: trailing.length ? { label: norm(trailing[trailing.length - 1].textContent), href: trailing[trailing.length - 1].getAttribute('href') } : null });
  }
  document.querySelectorAll('[data-cs-col]').forEach((e) => e.removeAttribute('data-cs-col'));
  return { trigger: t ? { label: norm(t.textContent || t.getAttribute('aria-label')).slice(0, 40), href: t.getAttribute('href') } : null, groups, promos, footerLinks: [...panel.querySelectorAll(':scope > a[href], :scope > p > a[href], :scope > div > a[href]:only-child')].filter((a) => !a.closest('[data-cs-col]')).map((a) => ({ label: norm(a.textContent), href: a.getAttribute('href') })) };
}

// header identity — the fields a theme variant is decided by (+ heights, subnav band, footer h)
function pageIdentity() {
  const cands = [...document.querySelectorAll('header, [role="banner"], [class*="header" i]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > innerWidth * 0.6 && r.y < 300 && r.height > 30; });
  const h = cands[0]; if (!h) return null;
  const cs = getComputedStyle(h); const r = h.getBoundingClientRect();
  const a = h.querySelector('nav a, a:not([class*="logo" i])'); const logo = h.querySelector('svg path, svg, img');
  const rows = [...h.querySelectorAll('nav, [role="navigation"], ul')].map((n) => n.getBoundingClientRect()).filter((b) => b.width > innerWidth * 0.5 && b.height > 20);
  const bands = [...new Set(rows.map((b) => Math.round(b.y / 10)))];
  const f = document.querySelector('footer, [role="contentinfo"]');
  return { sel: `${h.tagName.toLowerCase()}${h.className ? `.${String(h.className).trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`, rect: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }, height: Math.round(r.height), position: cs.position, background: cs.backgroundColor, color: a ? getComputedStyle(a).color : null, logoFill: logo ? (getComputedStyle(logo).fill || logo.currentSrc || logo.getAttribute('src') || '') : null, hasSubnavBand: bands.length > 1, footerHeight: f ? Math.round(f.getBoundingClientRect().height) : null, viewportTop: Math.round(r.y) };
}

function pageRestore({ triggerSel }) {
  const t = document.querySelector(triggerSel);
  document.querySelectorAll('[data-cs-vis], [data-cs-panel]').forEach((e) => { e.removeAttribute('data-cs-vis'); e.removeAttribute('data-cs-panel'); });
  return t ? t.getAttribute('aria-expanded') : null;
}

function pageDrawerDrill({ drawerSel }) {
  const d = document.querySelector(drawerSel); if (!d) return null;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.y >= 0 && r.y < innerHeight; };
  const c = [...d.querySelectorAll('button, [aria-expanded], [aria-haspopup], li:has(> ul) > a, li:has(> ul) > span')].find((e) => vis(e) && !/back|close|schließen|fermer/i.test(e.textContent || '') && (e.textContent || '').trim().length < 40);
  if (!c) return null;
  c.setAttribute('data-cs-drill', '1'); return { sel: '[data-cs-drill="1"]', text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
}

function pageDrawerState({ drawerSel }) {
  const d = document.querySelector(drawerSel); if (!d) return null;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.y >= 0 && r.y < innerHeight; };
  const back = [...document.querySelectorAll('button, a, span')].find((e) => /^(back|zurück|retour|atrás|indietro|terug)$/i.test((e.textContent || '').trim()) && vis(e));
  const items = [...d.querySelectorAll('li, [role="menuitem"]')].filter((li) => vis(li) && li.getBoundingClientRect().height > 24).slice(0, 12).map((li) => { const cs = getComputedStyle(li); const r = li.getBoundingClientRect(); return { text: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), h: Math.round(r.height), font: `${cs.fontSize}/${cs.fontWeight}`, borderBottom: cs.borderBottomWidth }; });
  return { backBar: !!back, items };
}
/* eslint-enable no-undef */

// -------------------------------------------------------------- browser flow

const CS = { CHROME_WAIT: 400, HOVER_WAIT: 150 };

async function settleTop(page) {
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 60); }); } window.scrollTo(0, 0); await new Promise((r) => { setTimeout(r, 300); }); });
  await page.waitForTimeout(300);
}

async function openTrigger(page, sel, kind = 'menu') {
  const size = kind === 'menu' || kind === 'language' ? {} : { minW: 100, minH: 30 };
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return { opensOn: 'none', found: false };
  await page.evaluate(pageSnapshotVisible);
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await loc.hover({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(CS.HOVER_WAIT + 250);
  let panel = await page.evaluate(pageFindPanel, { triggerSel: sel, override: null, ...size });
  if (panel) return { opensOn: 'hover', found: true, panel };
  await loc.click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
  await page.evaluate((s) => new Promise((res) => { const el = document.querySelector(s); const t = setTimeout(res, 400); const done = () => { clearTimeout(t); setTimeout(res, 40); }; if (el) { el.addEventListener('transitionend', done, { once: true }); (el.closest('header, nav, footer') || document.body).addEventListener('transitionend', done, { once: true }); } }), sel).catch(() => {});
  await page.waitForTimeout(100);
  panel = await page.evaluate(pageFindPanel, { triggerSel: sel, override: null, ...size });
  return { opensOn: panel ? 'click' : 'none', found: true, panel };
}

async function closeTrigger(page, sel, vh) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  const expanded = await page.evaluate(pageRestore, { triggerSel: sel }).catch(() => null);
  if (expanded === 'true') { await page.locator(sel).first().click({ timeout: 2000, noWaitAfter: true }).catch(() => {}); await page.waitForTimeout(200); }
  await page.mouse.move(10, vh - 10).catch(() => {});
  await page.waitForTimeout(150);
}

async function panelShot(page, panel, file, w, h) {
  const clip = { x: Math.max(0, panel.rect.x), y: Math.max(0, panel.rect.y), width: Math.max(1, w), height: Math.max(1, h) };
  await page.screenshot({ path: file, clip, fullPage: true, animations: 'disabled' }).catch((e) => console.error(`chrome-states: panel screenshot failed (${String(e.message).split('\n')[0]})`));
  return clip;
}

async function recordState(page, { name, kind, text, sel, override, opts, side, width, vh, outDir, consent, url }) {
  const opened = override ? { opensOn: 'override', found: true, panel: await page.evaluate(pageFindPanel, { triggerSel: sel, override }) } : await openTrigger(page, sel, kind);
  const st = { name, kind, text, opensOn: opened.opensOn, panel: opened.panel || null, region: null, model: null, png: null, sidecar: null };
  if (!opened.found) { st.warn = 'trigger not found on this side'; return st; }
  if (!opened.panel) { st.warn = 'no panel opened (plain link or navigation)'; return st; }
  st.region = await page.evaluate(probeRegion, { sel: opened.panel.sel, openSel: sel });
  if (st.region && st.region.found) {
    const hits = await page.evaluate(occlusionPass, { sel: st.region.sel, keys: st.region.atoms.filter((a) => ['a', 'button'].includes(a.boxTag)).map((a) => a.key) }).catch(() => []);
    for (const hh of hits) { const a = st.region.atoms.find((x) => x.key === hh.key); if (a) a.occluded = hh.occluded; }
  }
  if (kind === 'menu' || kind === 'language') st.model = await page.evaluate(pageNavModel, { panelSel: opened.panel.sel, triggerSel: sel }).catch(() => null);
  const file = join(outDir, `${side}-${width}-${name.replace(/[^\w]+/g, '-').toLowerCase()}.png`);
  const clip = await panelShot(page, opened.panel, file, opened.panel.rect.w, opened.panel.rect.h);
  st.png = file; st.clip = clip;
  st.sidecar = writeSidecar(file, { url, width, vh, dpr: 1, capturedAt: new Date().toISOString(), instrument: { name: 'chrome-states', version: SCHEMA, options: { state: name, clip } }, consent, dismissed: [], fontsFailed: [], docHeight: null, chunks: 1, source: 'chrome-states', technique: opts.tier >= 2 ? 'chrome-headless' : 'headless', blocked: opts.block });
  return st;
}

async function probeSide(browser, url, opts, { isLive, width, mobile, outDir, side }) {
  const vh = mobile ? 800 : 900;
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width, height: vh }, block: opts.block, ...sessionContextOptions(url, opts) }); // plain viewport, like the gate's 360 capture (isMobile would honour a missing viewport meta → 980 px layout)
  const page = await ctx.newPage();
  let navigated = false;
  const onNav = (frame) => { if (frame === page.mainFrame()) navigated = true; };
  const out = { url, width, mobile: !!mobile, identity: null, triggers: [], states: [], flatLinks: [], topLevel: [], warnings: [] };
  try {
    await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, tier: isLive ? opts.tier : 1, solveWaitMs: opts.solveWaitMs });
    const dOv = await dismissOverlays(page, { mode: opts.consentMode, reject: isLive && opts.consentMode === 'deny' && opts.consent ? [opts.consent] : [], extra: isLive ? [...(opts.consent && opts.consentMode !== 'deny' ? [opts.consent] : []), ...opts.dismiss] : [], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
    reportOverlayResidue('chrome-states', dOv);
    const consent = { mode: opts.consentMode, via: (dOv && (dOv.via || dOv.consentVia)) || 'none-detected' };
    await settleTop(page);
    out.identity = await page.evaluate(pageIdentity);
    if (!out.identity) { out.warnings.push('no header landmark found (header / [role=banner] / *header*) — nothing enumerated'); return out; }
    out.flatLinks = await page.evaluate(pageFlatNavLinks);
    out.topLevel = await page.evaluate(pageTopLevelNav).catch(() => []);
    const ov = (k) => (opts[k] ? (isLive ? opts[k].live : opts[k].build) : null);
    out.triggers = await page.evaluate(pageEnumerate, { triggerSelector: TRIGGER_SELECTOR, overrides: { trigger: ov('trigger'), search: ov('search'), toggle: ov('toggle') }, extra: { footer: !!mobile, toggle: !!mobile } });
    page.on('framenavigated', onNav);
    const desktopKinds = mobile ? ['toggle', 'footer-accordion'] : ['menu', 'search', 'language'];
    for (const t of out.triggers.filter((x) => desktopKinds.includes(x.kind))) {
      if (navigated) { out.warnings.push('page navigated — remaining triggers not probed (record them as links)'); break; }
      const name = t.kind === 'menu' ? `menu:${t.text}` : t.kind === 'toggle' ? 'drawer' : t.kind === 'footer-accordion' ? `footer-accordion:${t.text}` : t.kind;
      if (out.states.some((s) => s.name === name)) continue; // one cell per name (a duplicate search control, say)
      try {
        const st = await recordState(page, { name, kind: t.kind, text: t.text, sel: t.sel, override: t.kind === 'menu' ? ov('panel') : null, opts, side, width, vh, outDir, consent, url });
        st.trigger = { sel: t.sel, controls: t.controls, dataMenu: t.dataMenu, href: t.href, tag: t.tag };
        if (navigated) { st.navigated = true; st.warn = 'trigger navigated — a link, not a toggle'; out.states.push(st); break; }
        out.states.push(st);
        if (t.kind === 'toggle' && st.panel) { // drill one level inside the open drawer
          const drawer = await page.evaluate(pageDrawerState, { drawerSel: st.panel.sel }).catch(() => null);
          st.drawer = drawer;
          const drill = await page.evaluate(pageDrawerDrill, { drawerSel: st.panel.sel }).catch(() => null);
          if (drill) {
            await page.locator(drill.sel).first().click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
            await page.waitForTimeout(CS.CHROME_WAIT + 200);
            const drilled = { name: 'drawer-drilled', kind: 'drill', text: drill.text, opensOn: 'click', panel: await page.evaluate(pageFindPanel, { triggerSel: drill.sel, override: st.panel.sel }), region: null, model: null };
            if (drilled.panel) {
              drilled.region = await page.evaluate(probeRegion, { sel: drilled.panel.sel, openSel: drill.sel });
              drilled.drawer = await page.evaluate(pageDrawerState, { drawerSel: drilled.panel.sel }).catch(() => null);
              const file = join(outDir, `${side}-${width}-drawer-drilled.png`);
              drilled.clip = await panelShot(page, drilled.panel, file, drilled.panel.rect.w, drilled.panel.rect.h); drilled.png = file;
              drilled.sidecar = writeSidecar(file, { url, width, vh, dpr: 1, capturedAt: new Date().toISOString(), instrument: { name: 'chrome-states', version: SCHEMA, options: { state: 'drawer-drilled', clip: drilled.clip } }, consent, dismissed: [], fontsFailed: [], docHeight: null, chunks: 1, source: 'chrome-states', technique: opts.tier >= 2 ? 'chrome-headless' : 'headless', blocked: opts.block });
            } else drilled.warn = 'drill click opened nothing';
            out.states.push(drilled);
            await page.evaluate(() => document.querySelectorAll('[data-cs-drill]').forEach((e) => e.removeAttribute('data-cs-drill'))).catch(() => {});
          }
        }
        await closeTrigger(page, t.sel, vh);
      } catch (e) {
        if (navigated || isNavigationError(e)) { out.states.push({ name, kind: t.kind, text: t.text, opensOn: 'none', navigated: true, warn: 'trigger navigated — a link, not a toggle' }); out.warnings.push(`${name}: navigated away — loop aborted`); break; }
        out.states.push({ name, kind: t.kind, text: t.text, opensOn: 'none', error: String(e.message || e).split('\n')[0].slice(0, 120) });
      }
    }
    page.off('framenavigated', onNav);
    if (!mobile && !navigated) { // scrolled identity (sticky / shrink) — a state without a crop; heights feed the variant key
      await page.evaluate(() => window.scrollTo(0, 800)).catch(() => {}); await page.waitForTimeout(CS.CHROME_WAIT + 300);
      const scrolled = await page.evaluate(pageIdentity).catch(() => null);
      if (out.identity && scrolled) { out.identity.heightScrolled = scrolled.height; out.identity.pinnedScrolled = scrolled.viewportTop <= 0 && /fixed|sticky/.test(scrolled.position) ? true : scrolled.viewportTop <= 0; out.states.push({ name: 'scrolled', kind: 'scroll', text: 'scrolled 800', opensOn: 'scroll', identity: scrolled }); }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

async function sampleIdentity(browser, url, opts) {
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 }, block: opts.block, ...sessionContextOptions(url, opts) });
  const page = await ctx.newPage();
  try {
    await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, tier: opts.tier, solveWaitMs: opts.solveWaitMs });
    await dismissOverlays(page, { mode: opts.consentMode, extra: [...(opts.consent && opts.consentMode !== 'deny' ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 }).catch(() => {});
    await page.waitForTimeout(500);
    const identity = await page.evaluate(pageIdentity);
    await page.evaluate(() => window.scrollTo(0, 800)).catch(() => {}); await page.waitForTimeout(CS.CHROME_WAIT + 200);
    const scrolled = await page.evaluate(pageIdentity).catch(() => null);
    if (identity && scrolled) identity.heightScrolled = scrolled.height;
    return identity;
  } finally { await ctx.close().catch(() => {}); }
}

// ------------------------------------------------------------- build compare

function cropCell(livePng, buildPng, height, outPng) {
  const r = spawnSync(process.execPath, [join(HERE, 'crop-compare.mjs'), livePng, buildPng, '--y', '0', '--height', String(height), '--out', outPng, '--json'], { encoding: 'utf8' });
  if (r.status === 0 || r.status === 2) {
    let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* summary line only */ }
    return { status: r.status === 0 ? 'pass' : 'fail', pct: j ? (j.diffPct ?? j.pct ?? j.percent ?? null) : null, out: outPng, json: j };
  }
  return { status: 'skipped', warn: `crop-compare exit ${r.status}: ${String(r.stderr || r.stdout).split('\n').find(Boolean) || 'no output'}` };
}

function compareCells(L, B, opts, outDir, width) {
  const { paired, missing, extra } = pairStates(L.states.filter((s) => s.kind !== 'scroll'), B.states.filter((s) => s.kind !== 'scroll'));
  const cells = [];
  for (const p of paired) {
    const cell = { name: p.name, width, status: 'pass', findings: [], crop: null };
    if (p.live.panel && !p.build.panel) { cell.status = 'missing'; cell.findings.push({ kind: 'MISSING', msg: `live opens a panel on ${p.live.opensOn}; the build trigger "${p.build.text}" opens nothing` }); cells.push(cell); continue; }
    if (!p.live.panel) { cell.status = 'live-only'; cell.findings.push({ kind: 'WARN', msg: `no panel on live (${p.live.warn || p.live.opensOn}) — nothing to gate` }); cells.push(cell); continue; }
    if (p.live.region && p.build.region) {
      const r = compareRegion(p.name, p.live.region, p.build.region, opts.tolerance);
      cell.findings.push(...r.findings); cell.warnings = r.warnings || []; cell.pairs = r.pairs; cell.inventory = r.inventory;
    }
    if (p.live.opensOn !== p.build.opensOn && p.build.opensOn !== 'override') cell.findings.push({ kind: 'TRIGGER', msg: `live opens on ${p.live.opensOn}, build on ${p.build.opensOn}` });
    if (p.live.png && p.build.png) {
      const h = Math.min(p.live.clip.height, p.build.clip.height);
      cell.crop = cropCell(p.live.png, p.build.png, h, join(outDir, `diff-${width}-${p.name.replace(/[^\w]+/g, '-').toLowerCase()}.png`));
      if (cell.crop.status === 'fail') cell.findings.push({ kind: 'CROP', msg: `panel crop over the 2 % bar${cell.crop.pct != null ? ` (${cell.crop.pct} %)` : ''} — ${cell.crop.out}` });
      if (cell.crop.status === 'skipped') (cell.warnings = cell.warnings || []).push(cell.crop.warn);
      if (Math.abs(p.live.clip.width - p.build.clip.width) > opts.tolerance || Math.abs(p.live.clip.height - p.build.clip.height) > opts.tolerance) cell.findings.push({ kind: 'PANEL', msg: `panel rect live ${p.live.clip.width}×${p.live.clip.height} vs build ${p.build.clip.width}×${p.build.clip.height}` });
    }
    if (cell.findings.some((f) => f.kind !== 'WARN')) cell.status = 'delta';
    cells.push(cell);
  }
  for (const m of missing) cells.push({ name: m.name, width, status: 'missing', findings: [{ kind: 'MISSING', msg: `missing on build: live trigger "${m.text}" (${m.opensOn}) has no build trigger with that text` }] });
  for (const x of extra) cells.push({ name: x.name, width, status: 'extra', findings: [], warnings: [`EXTRA: build opens "${x.text}" with no live counterpart (an invented panel?)`] });
  return cells;
}

// ------------------------------------------------------------------- main

function readLiveCache(file, key) {
  if (!file || !existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (JSON.stringify(c.key) !== JSON.stringify(key)) { console.error(`chrome-states: --live-cache ${file} was probed for a different url/width/overrides/samples — re-probing live`); return null; }
    return c;
  } catch (e) { console.error(`chrome-states: --live-cache ${file} unreadable (${e.message}) — re-probing live`); return null; }
}

async function main() {
  const { live, build, opts } = parseArgs(process.argv);
  let samples = opts.pages.map((url) => ({ url, type: null }));
  if (opts.fromState) {
    let state; try { state = JSON.parse(readFileSync(opts.fromState, 'utf8')); } catch (e) { console.error(`chrome-states error: --from-state ${opts.fromState} unreadable (${e.message})`); process.exit(1); }
    samples = [...samples, ...samplesFromState(state, live).filter((s) => !samples.some((x) => x.url === s.url))];
  }
  mkdirSync(opts.out, { recursive: true });
  const { chromium } = await import('playwright'); // lazy: the pure halves import without a browser
  opts.tier = resolveStartTier(opts.headed);
  const browser = await launchTier(chromium, opts.tier);
  let exit = 0;
  try {
    const key = cacheKey(live, opts, samples);
    const cached = readLiveCache(opts.liveCache, key);
    let L;
    if (cached) L = cached.data;
    else {
      L = { desktop: await probeSide(browser, live, opts, { isLive: true, width: opts.width, mobile: false, outDir: opts.out, side: 'live' }) };
      if (!opts.noMobile) L.mobile = await probeSide(browser, live, opts, { isLive: true, width: opts.mobile, mobile: true, outDir: opts.out, side: 'live' });
      L.samples = [];
      for (const s of samples) { try { L.samples.push({ ...s, identity: await sampleIdentity(browser, s.url, opts) }); } catch (e) { if (e.name === 'BotChallengeError') throw e; L.samples.push({ ...s, identity: null, error: String(e.message).split('\n')[0] }); } }
      if (opts.liveCache) { mkdirSync(dirname(opts.liveCache), { recursive: true }); writeFileSync(opts.liveCache, JSON.stringify({ key, probedAt: new Date().toISOString(), data: L }, null, 2)); }
    }
    // variants: the archetype's own identity + every sample
    const variants = clusterVariants([{ url: live, identity: L.desktop.identity }, ...L.samples.filter((s) => s.identity)]);
    // nav model: the top-level items are the spine (plain links included); each opened panel's groups hang under its trigger
    const navModel = { groups: (L.desktop.topLevel || []).map((t) => { const st = L.desktop.states.find((s) => s.model && normText(s.text) === normText(t.label)); return { label: t.label, href: t.href, opensOn: st ? st.opensOn : null, items: st ? st.model.groups : [], promos: st ? st.model.promos : [], action: null }; }), promos: [], footerLinks: L.desktop.states.flatMap((s) => (s.model ? s.model.footerLinks : [])) };
    for (const s of L.desktop.states) if (s.model && !navModel.groups.some((g) => normText(g.label) === normText(s.text))) navModel.groups.push({ label: s.text, href: s.trigger && s.trigger.href, opensOn: s.opensOn, items: s.model.groups, promos: s.model.promos, action: null });
    const linkCheck = linkSetCheck(navModel, L.desktop.flatLinks);
    let B = null; let cells = [];
    if (build) {
      B = { desktop: await probeSide(browser, build, opts, { isLive: false, width: opts.width, mobile: false, outDir: opts.out, side: 'build' }) };
      if (L.mobile) B.mobile = await probeSide(browser, build, opts, { isLive: false, width: opts.mobile, mobile: true, outDir: opts.out, side: 'build' });
      cells = compareCells(L.desktop, B.desktop, opts, opts.out, opts.width);
      if (L.mobile && B.mobile) cells.push(...compareCells(L.mobile, B.mobile, opts, opts.out, opts.mobile));
      if (cells.some((c) => c.status === 'delta' || c.status === 'missing')) exit = 2;
    }
    const strip = (side) => side && { ...side, states: side.states.map((s) => ({ ...s, region: s.region ? { found: s.region.found, atoms: (s.region.atoms || []).length, rect: s.region.rect || null } : null })) };
    const report = { schema: SCHEMA, live, build, width: opts.width, mobile: opts.noMobile ? null : opts.mobile, probedAt: cached ? cached.probedAt : new Date().toISOString(), liveCache: cached ? { file: opts.liveCache } : null, out: opts.out, variants: variants.map((v) => ({ key: v.key, pages: v.urls })), linkCheck, desktop: strip(L.desktop), mobileSide: strip(L.mobile), buildDesktop: strip(B && B.desktop), buildMobile: strip(B && B.mobile), cells, navModel };
    writeFileSync(join(opts.out, 'chrome-states.json'), JSON.stringify({ ...report, raw: { live: L, build: B } }, null, 2));
    if (opts.json) {
      const text = JSON.stringify(report, null, 2);
      if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile), { recursive: true }); writeFileSync(opts.jsonFile, text); console.log(`chrome-states: report written to ${opts.jsonFile}`); } else console.log(text);
    } else {
      const D = L.desktop;
      console.log(`chrome-states @ ${opts.width}px${L.mobile ? ` + ${opts.mobile}px` : ''}\n  live:  ${live}${cached ? ` (live side from cache ${opts.liveCache}, probed ${cached.probedAt} — delete the file to re-probe)` : ''}${build ? `\n  build: ${build}` : ''}`);
      console.log(`\n■ triggers (${D.triggers.length}): ${D.triggers.map((t) => `${t.kind}:"${t.text}"${t.controls ? `→#${t.controls}` : t.dataMenu ? `→[data-menu=${t.dataMenu}]` : ''}`).join(', ') || 'none — pass --trigger/--search/--toggle'}`);
      for (const s of D.states) console.log(`  ${s.name.padEnd(28)} ${s.kind === 'scroll' ? `header ${s.identity ? `${s.identity.height}px ${s.identity.position}` : '?'}` : s.panel ? `opens on ${s.opensOn} → panel ${s.panel.rect.w}×${s.panel.rect.h} (${s.panel.how})${s.region ? `, ${s.region.atoms.length} atoms` : ''}${s.model ? `, model ${s.model.groups.length} groups / ${s.model.promos.length} promos` : ''}` : `WARN ${s.warn || s.error || 'no panel'}`}`);
      for (const s of (L.mobile && L.mobile.states) || []) console.log(`  ${`${opts.mobile}:${s.name}`.padEnd(28)} ${s.panel ? `opens on ${s.opensOn} → ${s.panel.rect.w}×${s.panel.rect.h}${s.drawer ? `, ${s.drawer.items.length} items${s.drawer.backBar ? ', back bar' : ''}` : ''}` : `WARN ${s.warn || s.error || 'no panel'}`}`);
      for (const w of [...D.warnings, ...((L.mobile && L.mobile.warnings) || [])]) console.log(`  WARN ${w}`);
      console.log(`\n■ nav model: ${linkCheck.panelOnly.length} panel-only link(s) (off-DOM at rest)${linkCheck.missingFromModel.length ? `; WARN ${linkCheck.missingFromModel.length} flat nav link(s) not in the model (enumeration gap): ${linkCheck.missingFromModel.slice(0, 5).join(', ')}` : ''}`);
      console.log(`\n■ variants: ${variants.length === 1 ? 'header identity consistent across the sample' : `${variants.length} chrome THEME VARIANTS across the page sample — each needs its own chrome archetype row (chrome-variants.mjs; reference/chrome-states.md)`}`);
      for (const v of variants) console.log(`  ${variantSig(v.key).slice(0, 110)} ← ${v.urls.length} page(s): ${v.urls.slice(0, 3).join(', ')}`);
      if (build) {
        const miss = cells.filter((c) => c.status === 'missing');
        console.log(`\n■ cells: ${cells.length} — ${cells.filter((c) => c.status === 'pass').length} pass, ${cells.filter((c) => c.status === 'delta').length} delta, ${miss.length} missing on build${miss.length ? `: ${miss.map((c) => c.name).join(', ')}` : ''}`);
        for (const c of cells) { if (c.status === 'pass' || c.status === 'live-only') continue; console.log(`  ${c.name} @${c.width}: ${c.status}`); for (const f of c.findings) console.log(`    ${f.kind.padEnd(10)} ${f.text ? `"${f.text.slice(0, 40)}"  ` : ''}${f.msg}`); for (const w of c.warnings || []) console.log(`    ${'WARN'.padEnd(10)} ${w}`); }
        console.log(`\n${exit ? '✗ cells with deltas or missing on build — every live-observed cell must crop-pass or be logged as a residual with a cause (reference/chrome-states.md).' : '✓ every paired cell within tolerance — run the rest-state crop gate as usual.'}`);
      }
      console.log(`\nwrote ${opts.out}/chrome-states.json + per-state PNGs (+ sidecars)`);
    }
  } finally {
    await browser.close();
  }
  process.exit(exit);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`chrome-states error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
