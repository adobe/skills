#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, no-restricted-globals, newline-per-chained-call, object-property-newline, no-use-before-define */
/* global __clipChain, __norm, __pageRect, __path, __rendered, __sel, __srOnly, __style, __visibleText, __walk */
/**
 * skills/diff/scripts/unit-geometry.mjs — per-unit GEOMETRY compare for repeated units (#125, D3).
 *
 * A card, a rail item, an FAQ row: the pixel gate sees the grid of shapes, not whether the badge sits
 * on the corner or the body starts 30 px low. The workstreams that converged measured live element
 * rects; this makes that a gate row: for the first N matching units on both sides, the rects of the
 * inner elements (role + text, shadow-DOM aware) relative to the unit's corner, aligned (key, text
 * prefix, relaxed link ↔ button, images by order, leftover text by position) and reported as
 * Δx / Δy / Δw / Δh against --tol, plus the unit's own size / position delta; `hidden` where the
 * served page clips. Both sides settle the same way; the origin inventory caches per slug under
 * stardust/current/measure/<slug>-units.json.
 *
 * Usage: node skills/diff/scripts/unit-geometry.mjs <originUrl> <edsUrl> --unit "<selO>=<selE>" …
 *        [--n 1] [--tol 4] [--width 1440] [--json [<file>]] [--slug <s>] [--force] [--advisory]
 *        [--plain] [--warmup <url>] [--locale en-US]
 * Exit: 0 within tolerance, 2 any element off / hidden / missing, 1 error, 3 bot challenge.
 * gate-all runs it for the units units.json declares. `unitInventoryInPage`, `alignUnit`,
 * `keyed`, `compareUnits`, `formatUnits`, `verdictOf` are exported.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inPage } from './clip-probe.mjs';
import { openBrowser, openPage, readCache, visit, writeCache } from './measure-live.mjs';

const HELP = `unit-geometry — per-element Δx/Δy/Δw/Δh of the first N repeated units, origin vs served (#125 D3)

Usage: node unit-geometry.mjs <originUrl> <edsUrl> --unit "<selOrigin>=<selEds>" [options]
  --unit <selO>[=<selE>]  repeatable
  --n <count>             units per selector (default 1)
  --tol <px>              per-element tolerance (default 4)
  --width <px>            viewport width (default 1440)
  --json [<file>]         JSON on stdout or to <file>
  --slug <s>              cache the origin inventory at stardust/current/measure/<s>-units.json (--force to redo)
  --advisory              report only, exit 0
  --plain                 bundled Chromium instead of the window-free real-Chrome tier
  --warmup <url>          visit this URL first on the origin side
  --locale <tag>          default en-US
  --help                  this text
Exit: 0 within tolerance, 2 any element off / missing / hidden, 1 error, 3 bot challenge.`;

// ---- in-page (needs IN_PAGE_LIB) -------------------------------------------------------------------------
/** page.evaluate(inPage(unitInventoryInPage, { sel, n })) → { sel, matches, units: [{ index, path, rect, elements[] }] } */
export function unitInventoryInPage({ sel, n = 1 } = {}) {
  let all; try { all = [...document.querySelectorAll(sel)]; } catch { return { sel, error: 'bad selector', matches: 0, units: [] }; }
  const pageW = document.documentElement.clientWidth;
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const onPage = (el) => { if (!__rendered(el) || __srOnly(el)) return false; const r = __pageRect(el.getBoundingClientRect()); return r.w > 0 && r.h > 0 && r.r > 0 && r.l < pageW; };
  const visible = all.filter(onPage).slice(0, n);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const roleOf = (el) => {
    const t = el.tagName;
    if (/^H[1-6]$/.test(t) || el.getAttribute('role') === 'heading') return 'heading';
    if (t === 'A' && el.hasAttribute('href')) return 'link';
    if (t === 'BUTTON' || el.getAttribute('role') === 'button' || (t === 'INPUT' && /^(button|submit|reset)$/i.test(el.type))) return 'button';
    if (t === 'IMG' || t === 'PICTURE' || t === 'SVG' || t === 'svg' || t === 'VIDEO' || t === 'IFRAME') return 'image';
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return 'input';
    return null;
  };
  const ownText = (el) => [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const units = visible.map((u, index) => {
    const ur = __pageRect(u.getBoundingClientRect());
    const elements = [];
    const seenText = new Set();
    for (const el of __walk(u)) {
      if (el.nodeType !== 1 || el === u) continue;
      if (!__rendered(el) || __srOnly(el)) continue;
      const br = el.getBoundingClientRect(); if (br.width <= 0 || br.height <= 0) continue;
      const s = __style(el);
      let role = roleOf(el);
      const own = ownText(el);
      const boxed = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.borderTopWidth !== '0px' || s.boxShadow !== 'none' || (s.backgroundImage && s.backgroundImage !== 'none');
      if (!role) { if (own) role = 'text'; else if (boxed) role = 'box'; else continue; }
      // a link/button's text lives in descendants — take the visible text; other roles take own text
      const text = role === 'link' || role === 'button' || role === 'heading' ? __norm(__visibleText(el)).slice(0, 60) : role === 'image' ? __norm(el.getAttribute('alt') || el.getAttribute('aria-label') || '').slice(0, 60) : __norm(own).slice(0, 60);
      if (role === 'text' && seenText.has(text) && !boxed) continue; // nested wrappers repeating the same own text
      if (text) seenText.add(text);
      const r = __pageRect(br);
      const cc = __clipChain(el, false);
      if (cc.skip) continue;
      let hidden = false;
      for (const clip of cc.chain) { if (clip.mode === 'scroll') continue; const vis = (clip.axes.y ? overlap(r.t, r.b, clip.rect.t, clip.rect.b) : r.h) * (clip.axes.x ? overlap(r.l, r.r, clip.rect.l, clip.rect.r) : r.w); if (vis / (r.w * r.h) < 0.5) { hidden = true; break; } }
      elements.push({
        role, tag: el.tagName.toLowerCase(), sel: __sel(el), text, boxed,
        x: Math.round(r.l - ur.l), y: Math.round(r.t - ur.t), w: Math.round(r.w), h: Math.round(r.h), absY: Math.round(r.t), hidden,
        fs: px(s.fontSize), lh: px(s.lineHeight), fw: s.fontWeight, color: s.color, bg: s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? s.backgroundColor : null, position: s.position,
      });
    }
    return { index, path: __path(u, 3), rect: { x: Math.round(ur.l), y: Math.round(ur.t), w: Math.round(ur.w), h: Math.round(ur.h) }, elements };
  });
  return { sel, matches: all.length, visibleMatches: all.filter(onPage).length, units };
}

// ---- pure: alignment ------------------------------------------------------------------------------------
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const keyOf = (el, ord) => (el.text ? `${el.role}:${norm(el.text).slice(0, 40)}` : `${el.role}:${el.sel}#${ord}`);

/** Assign stable keys (role:text, or role:selector#ordinal for text-less elements; duplicates get #2, #3 …). */
export function keyed(elements) {
  const ordBySel = new Map(); const seen = new Map();
  return elements.map((el) => {
    const o = (ordBySel.get(`${el.role}:${el.sel}`) || 0) + 1; ordBySel.set(`${el.role}:${el.sel}`, o);
    let key = keyOf(el, o);
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    if (n > 1) key = `${key} #${n}`;
    return { ...el, key };
  });
}

/** alignUnit(originUnit, edsUnit, tol) → { rows, missing, extra, unit, summary } */
export function alignUnit(o, e, tol = 4) {
  const O = keyed(o.elements); const E = keyed(e.elements);
  const usedE = new Set(); const rows = []; const missing = [];
  const relaxed = { link: ['button', 'text'], button: ['link', 'text'], heading: ['text'], text: ['heading', 'link', 'button'] };
  const find = (oe) => {
    let idx = E.findIndex((ee, i) => !usedE.has(i) && ee.key === oe.key);
    if (idx < 0 && oe.text) idx = E.findIndex((ee, i) => !usedE.has(i) && ee.text && ee.role === oe.role && (norm(ee.text) === norm(oe.text) || (norm(oe.text).length >= 10 && (norm(ee.text).startsWith(norm(oe.text).slice(0, 10)) || norm(oe.text).startsWith(norm(ee.text).slice(0, 10))))));
    if (idx < 0 && oe.text) idx = E.findIndex((ee, i) => !usedE.has(i) && ee.text && (relaxed[oe.role] || []).includes(ee.role) && norm(ee.text) === norm(oe.text));
    if (idx < 0 && !oe.text) idx = E.findIndex((ee, i) => !usedE.has(i) && !ee.text && ee.role === oe.role && (ee.tag === oe.tag || oe.role === 'image'));
    // images pair by role + order whatever their alt text says (an origin <img> without alt vs a served one with)
    if (idx < 0 && oe.role === 'image') idx = E.findIndex((ee, i) => !usedE.has(i) && ee.role === 'image');
    return idx;
  };
  // second pass for what text could not pair: same role, nearest position within 40 px (session-variable text
  // such as a "1 day left" vs "2 days left" badge is the same element)
  const byPosition = (oe) => {
    let best = -1; let bestD = 41;
    E.forEach((ee, i) => { if (usedE.has(i) || ee.role !== oe.role) return; const d = Math.max(Math.abs(ee.x - oe.x), Math.abs(ee.y - oe.y)); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };
  const pending = [];
  for (const oe of O) {
    const idx = find(oe);
    if (idx < 0) { pending.push(oe); continue; }
    usedE.add(idx); rows.push(rowFor(oe, E[idx], tol, false));
  }
  for (const oe of pending) {
    const idx = oe.role === 'text' || oe.role === 'box' || oe.role === 'heading' ? byPosition(oe) : -1;
    if (idx < 0) { missing.push(oe); continue; }
    usedE.add(idx); rows.push(rowFor(oe, E[idx], tol, true));
  }
  rows.sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x);
  const extra = E.filter((_, i) => !usedE.has(i));
  const unit = { origin: o.rect, eds: e.rect, dx: e.rect.x - o.rect.x, dy: e.rect.y - o.rect.y, dw: e.rect.w - o.rect.w, dh: e.rect.h - o.rect.h };
  const summary = { elements: O.length, within: rows.filter((r) => !r.off && !r.hidden).length, off: rows.filter((r) => r.off).length, hidden: rows.filter((r) => r.hidden).length, missing: missing.length, extra: extra.length, unitOff: Math.abs(unit.dw) > tol || Math.abs(unit.dh) > tol };
  return { rows, missing, extra, unit, summary };
}

function rowFor(oe, ee, tol, byPosition) {
  const d = { dx: ee.x - oe.x, dy: ee.y - oe.y, dw: ee.w - oe.w, dh: ee.h - oe.h };
  const off = Math.abs(d.dx) > tol || Math.abs(d.dy) > tol || Math.abs(d.dw) > tol || Math.abs(d.dh) > tol;
  return { key: oe.key, role: oe.role, text: oe.text, edsText: ee.text, byPosition, origin: { x: oe.x, y: oe.y, w: oe.w, h: oe.h }, eds: { x: ee.x, y: ee.y, w: ee.w, h: ee.h, sel: ee.sel, role: ee.role }, ...d, off, hidden: !!ee.hidden, type: { origin: `${oe.fs}/${oe.lh}/${oe.fw}`, eds: `${ee.fs}/${ee.lh}/${ee.fw}` } };
}

const fmt = (r) => `${r.x},${r.y} ${r.w}×${r.h}`;
const sgn = (n) => (n > 0 ? `+${n}` : String(n));
export function formatUnits(results, tol) {
  const lines = [];
  for (const res of results) {
    for (const u of res.units) {
      const { unit, summary } = u;
      lines.push(`unit ${u.index + 1} of ${res.sel}: origin ${fmt(unit.origin)} vs served ${fmt(unit.eds)} → Δx ${sgn(unit.dx)} Δy ${sgn(unit.dy)} Δw ${sgn(unit.dw)} Δh ${sgn(unit.dh)}${summary.unitOff ? '  ✗ unit size' : ''}; ${summary.elements} elements: ${summary.within} within ${tol}px, ${summary.off} off, ${summary.hidden} hidden, ${summary.missing} missing, ${summary.extra} extra`);
      lines.push('| element | origin x,y w×h | served x,y w×h | Δx | Δy | Δw | Δh | |', '|---|---|---|---|---|---|---|---|');
      for (const r of u.rows) lines.push(`| ${r.role} "${(r.text || r.key).slice(0, 36)}"${r.byPosition ? ` ≈ "${(r.edsText || '').slice(0, 20)}" (by position)` : ''} | ${fmt(r.origin)} | ${fmt(r.eds)}${r.eds.role !== r.role ? ` (${r.eds.role})` : ''} | ${sgn(r.dx)} | ${sgn(r.dy)} | ${sgn(r.dw)} | ${sgn(r.dh)} | ${r.hidden ? '✗ hidden (clipped)' : r.off ? '✗' : '✓'} |`);
      for (const m of u.missing) lines.push(`| ${m.role} "${(m.text || m.key).slice(0, 36)}" | ${fmt(m)} | — | | | | | ✗ missing |`);
      for (const x of u.extra) lines.push(`| ${x.role} "${(x.text || x.key).slice(0, 36)}" | — | ${fmt(x)} | | | | | 🟡 extra |`);
    }
    if (res.error) lines.push(`${res.sel}: ${res.error}`);
  }
  return lines.join('\n');
}

// ---- CLI ----------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { origin: null, eds: null, units: [], n: 1, tol: 4, width: 1440, json: false, jsonFile: null, slug: null, force: false, advisory: false, plain: false, warmup: null, locale: 'en-US' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--unit') { const [o, e] = rest[++i].split('='); opts.units.push({ origin: o.trim(), eds: (e || o).trim() }); }
    else if (a === '--n') opts.n = Number(rest[++i]);
    else if (a === '--tol') opts.tol = Number(rest[++i]);
    else if (a === '--width') opts.width = Number(rest[++i]);
    else if (a === '--json') { opts.json = true; if (rest[i + 1] && !rest[i + 1].startsWith('--')) opts.jsonFile = rest[++i]; }
    else if (a === '--slug') opts.slug = rest[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--advisory') opts.advisory = true;
    else if (a === '--plain') opts.plain = true;
    else if (a === '--warmup') opts.warmup = rest[++i];
    else if (a === '--locale') opts.locale = rest[++i];
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!opts.origin) opts.origin = a; else if (!opts.eds) opts.eds = a;
  }
  if (!opts.origin || !opts.eds || !opts.units.length) { console.error(`need <originUrl> <edsUrl> --unit <selO>=<selE>\n\n${HELP}`); process.exit(1); }
  return opts;
}

export async function measureUnits(browser, url, sels, { width, locale, warmup, n }) {
  const { ctx, page } = await openPage(browser, { width, locale });
  try {
    const v = await visit(page, url, { warmup });
    const bySel = {};
    for (const sel of sels) bySel[sel] = await page.evaluate(inPage(unitInventoryInPage, { sel, n }));
    return { url, at: new Date().toISOString(), status: v.status, docH: v.docH, bySel };
  } finally { await ctx.close(); }
}

/** Compare two measurement results for one --unit pair. */
export function compareUnits(oInv, eInv, pair, tol) {
  const o = oInv.bySel[pair.origin]; const e = eInv.bySel[pair.eds];
  const res = { sel: `${pair.origin}=${pair.eds}`, originMatches: o.matches, edsMatches: e.matches, units: [] };
  if (o.error || e.error) { res.error = o.error ? `origin: ${o.error}` : `served: ${e.error}`; return res; }
  if (!o.units.length || !e.units.length) { res.error = `no visible unit on the ${!o.units.length ? 'origin' : 'served'} side (${o.matches} / ${e.matches} DOM matches)`; return res; }
  for (let i = 0; i < Math.min(o.units.length, e.units.length); i += 1) res.units.push({ index: i, origin: { path: o.units[i].path }, eds: { path: e.units[i].path }, ...alignUnit(o.units[i], e.units[i], tol) });
  return res;
}

export const verdictOf = (results) => results.reduce((a, r) => { if (r.error) a.errors += 1; for (const u of r.units) { a.off += u.summary.off; a.hidden += u.summary.hidden; a.missing += u.summary.missing; a.within += u.summary.within; a.units += 1; } return a; }, { units: 0, within: 0, off: 0, hidden: 0, missing: 0, errors: 0 });

async function main() {
  const opts = parseArgs(process.argv);
  const { chromium } = await import('playwright');
  const browser = await openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' });
  let oInv; let eInv;
  try {
    const cacheKey = opts.slug ? `${opts.slug}-units` : null;
    const cached = cacheKey && !opts.force ? readCache(cacheKey) : null;
    const oSels = opts.units.map((u) => u.origin);
    if (cached && oSels.every((s) => cached.bySel && cached.bySel[s])) { oInv = cached; console.log(`origin: cached ${cacheKey} (${cached.at})`); }
    else { oInv = await measureUnits(browser, opts.origin, oSels, { width: opts.width, locale: opts.locale, warmup: opts.warmup, n: opts.n }); if (cacheKey) writeCache(cacheKey, oInv); }
    eInv = await measureUnits(browser, opts.eds, opts.units.map((u) => u.eds), { width: opts.width, locale: opts.locale, warmup: null, n: opts.n });
  } finally { await browser.close(); }
  const results = opts.units.map((pair) => compareUnits(oInv, eInv, pair, opts.tol));
  const v = verdictOf(results);
  const out = { _provenance: { writtenBy: 'unit-geometry.mjs', at: new Date().toISOString(), tol: opts.tol, n: opts.n, width: opts.width }, origin: { url: opts.origin, at: oInv.at, docH: oInv.docH }, eds: { url: opts.eds, at: eInv.at, docH: eInv.docH }, results, verdict: v };
  if (opts.json && !opts.jsonFile) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`unit-geometry @ ${opts.width}px, tol ${opts.tol}px — ${opts.origin} vs ${opts.eds}`);
    console.log(formatUnits(results, opts.tol));
    console.log(`Units: ${v.units} compared; elements within ${v.within}, off ${v.off}, hidden ${v.hidden}, missing ${v.missing}${v.errors ? `; ${v.errors} selector error(s)` : ''} → ${v.off + v.hidden + v.missing + v.errors ? 'FAIL' : 'PASS'}`);
    if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile) || '.', { recursive: true }); writeFileSync(opts.jsonFile, JSON.stringify(out, null, 1)); console.log(`json → ${opts.jsonFile}`); }
  }
  process.exitCode = !opts.advisory && (v.off + v.hidden + v.missing + v.errors) > 0 ? 2 : 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`unit-geometry error: ${String(e.message).split('\n')[0]}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
