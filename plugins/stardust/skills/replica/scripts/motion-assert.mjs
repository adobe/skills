#!/usr/bin/env node
/**
 * skills/replica/scripts/motion-assert.mjs — behaviour-match assertion:
 * replay a motion-observe run against the PROTOTYPE (or the published page)
 * and record the verdict in the replica ledger. Never opens the live origin.
 *
 * Why: the static gate measures t=0 pixels; "interaction parity" was prose
 * and was skipped on most archetypes under fan-out; a deployed verify passed
 * with a carousel whose chevrons did nothing (measure() ran inside a
 * display:none section, clientWidth 0), found 70 minutes later by hand; an
 * open-everything probe found five drifts the gates never saw because
 * behaviour checks asserted "opened", not what opened. The observe JSON is
 * the evidence of what live DOES; this instrument asserts the recreation
 * does the same, and writes the record the Phase 4 close reads —
 * `breakpoints.<bp>.motion.assert`. No record = `motion: unasserted`.
 *
 * D15 re-proposal (B30): ships as an INSTRUMENT with an advisory 🟡 verdict
 * first — a `fail` is printed and recorded, not a mechanical approval block;
 * a MISSING record is what the close names `unasserted`.
 *
 * Checks (each pass | fail | n/a | not-asserted | skipped):
 *   chrome        header state at {top, scrolled-down, scrolled-up, back-to-top}
 *                 — position, height (± --tolerance px) and the class DELTA vs
 *                 top — equals the live headerTimeline's, sampled at the same
 *                 scroll positions. Static live chrome + morphing target = fail
 *                 (invented motion).
 *   widgets       every widgetSamples[].sel that ADVANCED live (track transform,
 *                 scrollLeft or active dot moved) is located on the target
 *                 (same selector, else --control <liveSel>=<targetSel>),
 *                 clicked once and must advance the same way. A dead live widget
 *                 is n/a (implement nothing).
 *   pageErrors    zero `pageerror` during the run.
 *   entrances     (observe schema ≥ 2) elements whose inline opacity/transform
 *                 mutated during the traversal, within --entrance-tolerance of
 *                 the live total (entrances[].elements). Schema 1 → not-asserted.
 *   stateMachines (schema ≥ 2) each click-paired attribute machine: its trigger
 *                 is located by text / aria-label (else --control), clicked
 *                 once, and one observable must change (the attribute, the
 *                 aria-controls target's display/height, className, child
 *                 count). Schema 1 → not-asserted.
 * Absent evidence is never a FAIL: a page with no motion observed records
 * verdict n/a; schema-1 JSON records not-asserted for (entrances,
 * stateMachines).
 *
 * Usage:
 *   node skills/replica/scripts/motion-assert.mjs <observe.json> <targetURL> [options]
 *     --width <px>               viewport width (default: the observe run's)
 *     --tolerance <px>           header height tolerance (default 2)
 *     --entrance-tolerance <f>   fraction of the live count (default 0.1)
 *     --control <live>=<target>  map a live selector / trigger text to a target selector (repeatable)
 *     --skip <check>=<reason>    skip a named check; the reason is copied into the record (repeatable)
 *     --record <progress.json> --slug <s>
 *                                write breakpoints.<width>.motion.assert on the page type whose
 *                                archetype is <slug>; `result` and motion.{observed,implemented,dead} untouched
 *     --regime prototype|published-origin   (default prototype; recorded, printed per row)
 *     --timeout <s>              deadline (default 90): on expiry verdict none, exit 124
 *     --json                     machine-readable result on stdout
 *     --help
 *
 * Record shape: { verdict: pass|fail|n/a|none, at, target, regime, observe, schema, width,
 *                 checks: { chrome, widgets, pageErrors, entrances, stateMachines }, skips: {…} }
 *
 * Exit codes: 0 pass or n/a · 1 fail (🟡 advisory this release) or error ·
 * 2 usage, unreadable observe JSON, a target on the live origin, or
 * live-session.mjs not beside this script · 124 deadline or no browser slot
 * in time (verdict none — re-run once; still none = unasserted, never FAIL).
 * Launch: live-session launchTier (tier 1) — launch-ladder parity, one
 * browser slot per launch (fan-out.md § Machine budget).
 * No bot-challenge exit: the target is the prototype / published page, never
 * the live origin (a bot-blocked observe run is the `motion-unassertable`
 * residual, source-fidelity-gate.md § Residual classes).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findPageType, readLedger } from './progress-record.mjs';

// The browser is launched through live-session's launchTier (launch-ladder
// parity: one launch site per machine, one browser slot per launch — fan-out.md
// § Machine budget), never a bare launch call. Two layouts: the plugin
// tree (../../diff/scripts) and the project copy (../diff). Resolved lazily —
// usage / --help / the record writer never need it.
const HERE = dirname(fileURLToPath(import.meta.url));
export function liveSessionPath() {
  return ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p)) || null;
}
async function launchBrowser(chromium) {
  const ls = liveSessionPath();
  if (!ls) { const e = new Error('live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/) — copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup step 4)'); e.code = 2; throw e; }
  const { launchTier } = await import(pathToFileURL(ls).href);
  return launchTier(chromium, 1); // tier 1: the target is the prototype / published page, never a bot-walled live origin
}

export const CHECKS = ['chrome', 'widgets', 'pageErrors', 'entrances', 'stateMachines'];
export const DEADLINE_EXIT = 124;

const HELP = `motion-assert — replay a motion-observe run against the prototype / published page; record the verdict

Usage: node motion-assert.mjs <observe.json> <targetURL> [options]
  --width <px>                viewport (default: the observe run's width)
  --tolerance <px>            header height tolerance (default 2)
  --entrance-tolerance <f>    fraction of the live entrance count (default 0.1)
  --control <live>=<target>   map a live selector or trigger text to a target selector (repeatable)
  --skip <check>=<reason>     skip chrome|widgets|pageErrors|entrances|stateMachines with a recorded reason
  --record <progress.json> --slug <s>   write breakpoints.<width>.motion.assert for that archetype
  --regime prototype|published-origin   recorded regime (default prototype)
  --timeout <s>               deadline (default 90) → verdict none, exit 124
  --json                      JSON result on stdout
  --help                      this text

Never opens the live origin (the observe JSON is the live evidence).
Exit: 0 pass/n-a · 1 fail (advisory 🟡) or error · 2 usage · 124 deadline (no verdict).`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { width: null, tolerance: 2, entranceTolerance: 0.1, controls: {}, skips: {}, record: null, slug: null, regime: 'prototype', timeout: 90, json: false };
  const pos = [];
  const usage = (m) => { console.error(`motion-assert: ${m}\n\n${HELP}`); process.exit(2); };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v === undefined || String(v).startsWith('--')) usage(`${a} needs a value`); i += 1; return v; };
    if (a === '--width') opts.width = Number(val());
    else if (a === '--tolerance') opts.tolerance = Number(val());
    else if (a === '--entrance-tolerance') opts.entranceTolerance = Number(val());
    else if (a === '--control') { const m = String(val() || '').match(/^(.+?)=(.+)$/); if (!m) usage('--control needs <live>=<target>'); opts.controls[m[1].trim()] = m[2].trim(); }
    else if (a === '--skip') { const m = String(val() || '').match(/^([a-zA-Z]+)=(.+)$/); if (!m || !CHECKS.includes(m[1])) usage(`--skip needs <check>=<reason> with check in ${CHECKS.join('|')}`); opts.skips[m[1]] = m[2].trim(); }
    else if (a === '--record') opts.record = val();
    else if (a === '--slug') opts.slug = val();
    else if (a === '--regime') { opts.regime = val(); if (!['prototype', 'published-origin'].includes(opts.regime)) usage('--regime must be prototype or published-origin'); }
    else if (a === '--timeout') { opts.timeout = Number(val()); if (!(opts.timeout > 0)) usage('--timeout needs seconds > 0'); }
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) usage(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 2) usage('need <observe.json> and <targetURL>');
  if (opts.record && !opts.slug) usage('--record needs --slug <archetype slug>');
  return { observePath: pos[0], target: pos[1], opts };
}

// ------------------------------------------------------------ pure functions

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const classSet = (cls) => new Set(norm(cls).split(' ').filter(Boolean));
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/** Observe schema → which checks have evidence. */
export function schemaGate(observe) {
  const schema = Number(observe?.schema) || 1;
  return { schema, entrances: schema >= 2 && Array.isArray(observe?.entrances), stateMachines: schema >= 2 && Array.isArray(observe?.stateMachines) };
}

/**
 * Pick the four chrome states off a headerTimeline: top (first sample),
 * scrolled-down (deepest 'down' sample), scrolled-up (the 'up' sample nearest
 * y≈800 with y > 0), back-to-top (last sample at y 0). Timelines without
 * `dir` (older JSON) fall back to y ordering.
 */
export function chromeStates(timeline) {
  const t = (timeline || []).filter(Boolean);
  if (!t.length) return null;
  const top = t[0];
  const downs = t.filter((s) => s.dir === 'down' || s.dir === undefined);
  const down = downs.reduce((a, s) => (s.y > (a?.y ?? -1) ? s : a), null) || top;
  const maxIdx = t.indexOf(down);
  const ups = t.slice(maxIdx + 1).filter((s) => s.y > 0 && (s.dir === 'up' || s.dir === undefined));
  const up = ups.reduce((a, s) => (a == null || Math.abs(s.y - 800) < Math.abs(a.y - 800) ? s : a), null) || down;
  const back = t[t.length - 1].y === 0 ? t[t.length - 1] : top;
  return { top, down, up, back };
}

/** One state's delta vs the top state: position, height, class delta. */
export function chromeDelta(state, top) {
  const a = classSet(top?.cls); const b = classSet(state?.cls);
  return {
    position: state?.position ?? null,
    heightPx: px(state?.height),
    added: [...b].filter((c) => !a.has(c)).sort(),
    removed: [...a].filter((c) => !b.has(c)).sort(),
  };
}

/**
 * compareChrome(liveTimeline, targetTimeline, { tolerancePx }) → { status, diffs[] }
 * Both timelines carry the four states (target sampled at the live picks' y).
 * A header absent on both sides is n/a; absent on one side is a fail.
 */
export function compareChrome(liveTimeline, targetTimeline, { tolerancePx = 2 } = {}) {
  const L = chromeStates(liveTimeline); const T = chromeStates(targetTimeline);
  if (!L && !T) return { status: 'n/a', diffs: ['no header on either side'] };
  if (!L || !T) return { status: 'fail', diffs: [`header ${!L ? 'absent live, present on the target' : 'present live, absent on the target'}`] };
  const diffs = [];
  for (const k of ['top', 'down', 'up', 'back']) {
    const l = k === 'top' ? { position: L.top?.position ?? null, heightPx: px(L.top?.height), added: [], removed: [] } : chromeDelta(L[k], L.top);
    const t = k === 'top' ? { position: T.top?.position ?? null, heightPx: px(T.top?.height), added: [], removed: [] } : chromeDelta(T[k], T.top);
    if (l.position !== t.position) diffs.push(`${k}: position ${l.position} → ${t.position}`);
    if (l.heightPx != null && t.heightPx != null && Math.abs(l.heightPx - t.heightPx) > tolerancePx) diffs.push(`${k}: height ${l.heightPx} → ${t.heightPx}`);
    if (k !== 'top') {
      const liveMorphs = l.added.length + l.removed.length > 0; const targetMorphs = t.added.length + t.removed.length > 0;
      if (liveMorphs !== targetMorphs) diffs.push(`${k}: live ${liveMorphs ? `morphs (+${l.added.join(',')} −${l.removed.join(',')})` : 'is static'}, target ${targetMorphs ? `morphs (+${t.added.join(',')} −${t.removed.join(',')})` : 'is static'}`);
      else if (liveMorphs && (l.added.join() !== t.added.join() || l.removed.join() !== t.removed.join())) diffs.push(`${k}: class delta +${l.added.join(',')} −${l.removed.join(',')} → +${t.added.join(',')} −${t.removed.join(',')}`);
    }
  }
  return { status: diffs.length ? 'fail' : 'pass', diffs };
}

/** Active-dot index from a frame's dots[] (class or aria marker). */
export function activeDot(dots) {
  const i = (dots || []).findIndex((d) => /(^|\s)(slick-active|swiper-pagination-bullet-active|active|current|selected|is-active)(\s|$)/.test(String(d?.cls || '')) || d?.current === true || d?.selected === true);
  return i < 0 ? null : i;
}

/** widgetAdvanced(frames) → { advanced, by } — first vs last non-null frame on track transform, scrollLeft, active dot. */
export function widgetAdvanced(frames) {
  const f = (frames || []).filter(Boolean);
  if (f.length < 2) return { advanced: false, by: null };
  const a = f[0]; const b = f[f.length - 1];
  const moved = (x, y) => x != null && y != null && x !== y && !(x === 'none' && y === 'matrix(1, 0, 0, 1, 0, 0)') && !(y === 'none' && x === 'matrix(1, 0, 0, 1, 0, 0)');
  if (moved(a.trackTransform, b.trackTransform)) return { advanced: true, by: 'trackTransform' };
  if (a.boxScrollLeft != null && b.boxScrollLeft != null && a.boxScrollLeft !== b.boxScrollLeft) return { advanced: true, by: 'boxScrollLeft' };
  if (moved(a.boxTransform, b.boxTransform)) return { advanced: true, by: 'boxTransform' };
  const da = activeDot(a.dots); const db = activeDot(b.dots);
  if (da != null && db != null && da !== db) return { advanced: true, by: 'activeDot' };
  return { advanced: false, by: null };
}

/** stateChanged(before, after) → { changed, by } over the observable set a click may move. */
export function stateChanged(before, after) {
  if (!before || !after) return { changed: false, by: null };
  for (const k of ['ariaExpanded', 'ariaSelected', 'ariaHidden', 'hidden', 'open', 'dataState', 'controlsDisplay', 'controlsHeight', 'className', 'childCount', 'scrollLeft']) {
    if (before[k] !== undefined && after[k] !== undefined && JSON.stringify(before[k]) !== JSON.stringify(after[k])) return { changed: true, by: k };
  }
  return { changed: false, by: null };
}

/** entranceWithinTolerance(live, target, tol) — |target − live| ≤ tol · live (live 0 → target must be 0). */
export function entranceWithinTolerance(live, target, tol = 0.1) {
  if (!Number.isFinite(live) || !Number.isFinite(target)) return false;
  if (live === 0) return target === 0;
  return Math.abs(target - live) <= tol * live;
}

/** Verdict over the checks: fail > pass > n/a. not-asserted/skipped never decide alone. */
export function verdictOf(checks) {
  const st = Object.values(checks || {}).map((c) => c?.status);
  if (st.includes('fail')) return 'fail';
  if (st.includes('pass')) return 'pass';
  return 'n/a';
}

/** Build the ledger record. */
export function buildRecord({ checks, skips = {}, target, regime, observePath, schema, width, verdict = null, at = new Date().toISOString() }) {
  return { verdict: verdict || verdictOf(checks), at, target, regime, observe: observePath, schema, width, checks, skips };
}

/** A no-verdict record (deadline): verdict none — never fail. */
export function noVerdict({ target, regime, observePath, schema, width, reason }) {
  return { verdict: 'none', at: new Date().toISOString(), target, regime, observe: observePath, schema, width, checks: {}, skips: {}, reason };
}

/**
 * record(progress, slug, bp, result) → { written, pageType } — writes
 * breakpoints.<bp>.motion.assert on the page type whose archetype is slug;
 * `result`, `residuals`, motion.{observed,implemented,dead} untouched.
 */
export function record(progress, slug, bp, result) {
  const hit = findPageType(progress, slug);
  if (!hit) return { written: false, pageType: null };
  hit.entry.breakpoints = hit.entry.breakpoints && typeof hit.entry.breakpoints === 'object' ? hit.entry.breakpoints : {};
  const block = hit.entry.breakpoints[String(bp)] = hit.entry.breakpoints[String(bp)] && typeof hit.entry.breakpoints[String(bp)] === 'object' ? hit.entry.breakpoints[String(bp)] : {};
  block.motion = block.motion && typeof block.motion === 'object' ? block.motion : {};
  block.motion.assert = result;
  return { written: true, pageType: hit.name };
}

/** Human summary lines. */
export function renderResult(rec) {
  const icon = { pass: '✓', fail: '🟡 FAIL', 'n/a': 'n/a', none: '⏱ none' }[rec.verdict] || rec.verdict;
  const lines = [`motion-assert ${icon} — ${rec.regime} · ${rec.target} · observe schema ${rec.schema} @${rec.width}px`];
  for (const [k, c] of Object.entries(rec.checks || {})) lines.push(`  ${k.padEnd(14)}${c.status.padEnd(13)}${c.detail || ''}`);
  if (rec.reason) lines.push(`  ${rec.reason}`);
  if (rec.verdict === 'fail') lines.push('  advisory this release (D15 re-proposal): iterate within the Phase 4 cap, then log a residual; the RECORD is what approval reads — a missing record is `motion: unasserted`.');
  return lines.join('\n');
}

// ------------------------------------------------------------ in-page code

/* eslint-disable no-undef */
function initScript() {
  window.__ma = { styleMutated: new Set(), errors: 0 };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type !== 'attributes' || m.attributeName !== 'style') continue;
      const el = m.target; const st = el.style;
      if (!st) continue;
      if (st.opacity !== '' || (st.transform !== '' && st.transform !== 'none') || st.visibility !== '') window.__ma.styleMutated.add(el);
    }
  });
  const start = () => obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
function headerState() {
  const h = document.querySelector('.header-container, header');
  if (!h) return null;
  const cs = getComputedStyle(h);
  return { y: window.pageYOffset, cls: String(h.className).trim(), position: cs.position, height: cs.height, transform: cs.transform };
}
function widgetFrame(sel) {
  const el = document.querySelector(sel);
  const box = el && (el.closest('[class*="slick"],[class*="swiper"],[class*="carousel"],[class*="slider"],[data-block-name*="carousel"],section, .section') || el.parentElement);
  const track = (box || document).querySelector('.slick-track, .swiper-wrapper, [class*="track"], [class*="slides"], ul, ol');
  const scroller = box ? [box, ...box.querySelectorAll('*')].find((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') : null;
  const dots = [...(box || document).querySelectorAll('.slick-dots li, .dots button, [class*="dot"], [role="tab"]')].slice(0, 12).map((d) => ({ cls: d.className, current: d.getAttribute('aria-current') === 'true' || d.getAttribute('aria-selected') === 'true' }));
  return { t: performance.now(), trackTransform: track ? getComputedStyle(track).transform : null, boxScrollLeft: scroller ? scroller.scrollLeft : (box ? box.scrollLeft : null), boxTransform: box ? getComputedStyle(box).transform : null, dots };
}
function findTrigger({ txt, targetSel }) {
  if (targetSel) { const el = document.querySelector(targetSel); return el ? { found: true } : { found: false }; }
  const t = String(txt || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return { found: false };
  const cands = [...document.querySelectorAll('button, [role=button], summary, a, [aria-expanded], [role=tab], [aria-haspopup]')];
  const el = cands.find((e) => String(e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === t || String(e.getAttribute('aria-label') || '').trim().toLowerCase() === t);
  if (!el) return { found: false };
  el.setAttribute('data-ma-trigger', '1');
  return { found: true };
}
function triggerSnapshot(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const id = el.getAttribute('aria-controls'); const target = id ? document.getElementById(id) : null;
  return {
    ariaExpanded: el.getAttribute('aria-expanded'), ariaSelected: el.getAttribute('aria-selected'), ariaHidden: el.getAttribute('aria-hidden'),
    hidden: el.hidden, open: el.hasAttribute('open') || (el.parentElement?.tagName === 'DETAILS' ? el.parentElement.hasAttribute('open') : null),
    dataState: el.getAttribute('data-state'), className: el.className,
    controlsDisplay: target ? getComputedStyle(target).display : null, controlsHeight: target ? Math.round(target.getBoundingClientRect().height) : null,
    childCount: document.body.querySelectorAll('*').length,
  };
}
/* eslint-enable no-undef */

// -------------------------------------------------------------------- driver

async function runChecks({ observe, target, opts, warn }) {
  const { chromium } = await import('playwright');
  const width = opts.width || observe.width || 1440; const VH = 900;
  const browser = await launchBrowser(chromium);
  const checks = {}; let errors = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width, height: VH } });
    await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    page.on('pageerror', () => { errors += 1; });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    const skip = (k) => (opts.skips[k] ? (checks[k] = { status: 'skipped', detail: opts.skips[k] }, true) : false);
    const gate = schemaGate(observe);

    // --- chrome + entrances: traverse at the live picks' y
    const L = chromeStates(observe.headerTimeline);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const targetTimeline = [];
    const at = async (y, dir) => { await page.evaluate((v) => window.scrollTo(0, v), Math.max(0, Math.min(y, docH - VH))); await page.waitForTimeout(250); const s = await page.evaluate(headerState); targetTimeline.push(s ? { ...s, dir } : null); };
    await at(0, 'down');
    for (let yy = 400; yy < docH - VH; yy += 400) { await page.evaluate((v) => window.scrollTo(0, v), yy); await page.waitForTimeout(120); }
    await at(L?.down?.y ?? docH, 'down');
    await at(L?.up?.y ?? 800, 'up');
    await at(0, 'up');
    if (!skip('chrome')) { const c = compareChrome(observe.headerTimeline, targetTimeline, { tolerancePx: opts.tolerance }); checks.chrome = { status: c.status, detail: c.diffs.join('; ') || 'top / scrolled-down / scrolled-up / back-to-top match', target: targetTimeline }; }
    if (!skip('entrances')) {
      if (!gate.entrances) checks.entrances = { status: 'not-asserted', detail: `observe schema ${gate.schema} has no entrances[] — re-observe with the schema-2 instrument` };
      else {
        const live = observe.entrances.reduce((n, e) => n + (Number(e.elements) || 0), 0);
        const fired = await page.evaluate(() => window.__ma.styleMutated.size);
        const ok = entranceWithinTolerance(live, fired, opts.entranceTolerance);
        checks.entrances = { status: live === 0 && fired === 0 ? 'n/a' : ok ? 'pass' : 'fail', detail: `live ${live} element(s) with inline opacity/transform entrances, target ${fired} (± ${Math.round(opts.entranceTolerance * 100)} %)`, live, target: fired };
      }
    }

    // --- widgets
    if (!skip('widgets')) {
      const rows = [];
      for (const w of observe.widgetSamples || []) {
        if (!Array.isArray(w.frames)) continue;
        const liveAdv = widgetAdvanced(w.frames);
        if (!liveAdv.advanced) { rows.push({ sel: w.sel, status: 'n/a', detail: 'dead live (implement nothing)' }); continue; }
        const targetSel = opts.controls[w.sel] || w.sel;
        const found = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; }, targetSel);
        if (!found) { rows.push({ sel: w.sel, status: 'fail', detail: `control not located on the target (${targetSel}) — map it with --control "${w.sel}=<targetSel>"` }); continue; }
        await page.waitForTimeout(500);
        const frames = [await page.evaluate(widgetFrame, targetSel)];
        await page.evaluate((s) => document.querySelector(s).click(), targetSel);
        for (let t = 0; t < 4; t += 1) { await page.waitForTimeout(200); frames.push(await page.evaluate(widgetFrame, targetSel)); }
        const adv = widgetAdvanced(frames);
        rows.push({ sel: w.sel, status: adv.advanced ? 'pass' : 'fail', detail: adv.advanced ? `advanced by ${adv.by} (live: ${liveAdv.by})` : `control ${targetSel}: no observable changed after the click (live advanced by ${liveAdv.by})` });
      }
      checks.widgets = { status: rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'pass') ? 'pass' : 'n/a', detail: rows.map((r) => `${r.sel}: ${r.status}${r.status !== 'pass' ? ` (${r.detail})` : ''}`).join('; ') || 'no widget pokes in the observe run', rows };
    }

    // --- state machines
    if (!skip('stateMachines')) {
      if (!gate.stateMachines) checks.stateMachines = { status: 'not-asserted', detail: `observe schema ${gate.schema} has no stateMachines[] — re-observe with the schema-2 instrument` };
      else {
        const rows = [];
        for (const m of observe.stateMachines.filter((x) => x.kind === 'attribute' && (x.triggered || 0) > 0)) {
          const txt = (m.transitions || []).map((t) => t.trigger?.txt).find((x) => norm(x));
          const mapped = opts.controls[m.el] || (txt && opts.controls[txt]) || null;
          if (!mapped && !norm(txt)) { rows.push({ el: m.el, status: 'not-asserted', detail: 'trigger has no text — map it with --control "<live path>=<targetSel>"' }); continue; }
          const f = await page.evaluate(findTrigger, { txt, targetSel: mapped });
          const sel = mapped || '[data-ma-trigger="1"]';
          if (!f.found) { rows.push({ el: m.el, status: 'fail', detail: `trigger "${txt || m.el}" not located on the target` }); continue; }
          await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
          const before = await page.evaluate(triggerSnapshot, sel);
          await page.evaluate((s) => document.querySelector(s).click(), sel);
          await page.waitForTimeout(600);
          const after = await page.evaluate(triggerSnapshot, sel);
          const ch = stateChanged(before, after);
          rows.push({ el: m.el, attr: m.attr, status: ch.changed ? 'pass' : 'fail', detail: ch.changed ? `${txt || sel}: ${ch.by} changed (live: ${m.attr})` : `${txt || sel}: no observable changed after the click (live toggled ${m.attr})` });
          await page.keyboard.press('Escape');
          if (after?.ariaExpanded === 'true') await page.evaluate((s) => document.querySelector(s)?.click(), sel);
          await page.evaluate((s) => document.querySelector(s)?.removeAttribute('data-ma-trigger'), sel);
          await page.waitForTimeout(200);
        }
        checks.stateMachines = { status: rows.some((r) => r.status === 'fail') ? 'fail' : rows.some((r) => r.status === 'pass') ? 'pass' : rows.length ? 'not-asserted' : 'n/a', detail: rows.map((r) => `${r.detail}`).join('; ') || 'no click-paired machines in the observe run', rows };
      }
    }
    if (!skip('pageErrors')) checks.pageErrors = { status: errors ? 'fail' : 'pass', detail: `${errors} pageerror(s)`, count: errors };
  } finally { await browser.close(); }
  if (warn) for (const k of CHECKS) if (!checks[k]) checks[k] = { status: 'n/a', detail: 'not run' };
  return { checks, width };
}

function writeRecord(opts, rec, width) {
  if (!opts.record) return;
  if (!existsSync(opts.record)) { console.error(`motion-assert: ${opts.record} not found — not recorded`); return; }
  const ledger = readLedger(opts.record);
  const r = record(ledger, opts.slug, width, rec);
  if (!r.written) { console.error(`motion-assert: no page type with archetype ${opts.slug} in ${opts.record} — not recorded (add the page type, re-run)`); return; }
  writeFileSync(opts.record, `${JSON.stringify(ledger, null, 2)}\n`);
  console.error(`motion-assert: recorded ${r.pageType}.breakpoints.${width}.motion.assert = ${rec.verdict}`);
}

async function main() {
  const { observePath, target, opts } = parseArgs(process.argv);
  let observe;
  try { observe = JSON.parse(readFileSync(observePath, 'utf8')); } catch (e) { console.error(`motion-assert: cannot read observe JSON ${observePath}: ${e.message}`); process.exit(2); }
  let tHost = null; let lHost = null;
  try { tHost = new URL(target).host; } catch { console.error(`motion-assert: <targetURL> is not a URL: ${target}`); process.exit(2); }
  try { lHost = new URL(observe.url).host; } catch { /* observe without url: cannot compare hosts */ }
  if (lHost && tHost && lHost === tHost) { console.error(`motion-assert: target ${target} is on the live origin (${lHost}) — this instrument never opens the live site; the observe JSON is the live evidence. Point it at the prototype or the published page.`); process.exit(2); }
  const gate = schemaGate(observe);
  const width = opts.width || observe.width || 1440;
  const base = { target, regime: opts.regime, observePath, schema: gate.schema, width };
  let timer = null;
  const deadline = new Promise((resolveP) => { timer = setTimeout(() => resolveP({ deadline: true }), opts.timeout * 1000); });
  const run = runChecks({ observe, target, opts, warn: true }).then((r) => ({ ...r, deadline: false }));
  const out = await Promise.race([run, deadline]);
  clearTimeout(timer);
  if (out.deadline) {
    const rec = noVerdict({ ...base, reason: `deadline ${opts.timeout}s reached — no verdict (re-run once; still none = unasserted)` });
    writeRecord(opts, rec, width);
    console.log(opts.json ? JSON.stringify(rec, null, 2) : renderResult(rec));
    process.exit(DEADLINE_EXIT);
  }
  const rec = buildRecord({ ...base, checks: out.checks, skips: opts.skips });
  writeRecord(opts, rec, width);
  console.log(opts.json ? JSON.stringify(rec, null, 2) : renderResult(rec));
  process.exit(rec.verdict === 'fail' ? 1 : 0);
}

const invokedDirectly = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
// exit 124 also when live-session's launchTier got no browser slot in time (no verdict, never FAIL); 2 = live-session.mjs missing (setup)
if (invokedDirectly) main().catch((e) => { console.error(`motion-assert error: ${e.message}`); process.exit(e.code === 124 ? DEADLINE_EXIT : e.code === 2 ? 2 : 1); });
