#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, no-restricted-globals */
/* global __clipChain, __controlOf, __isControl, __lineRects, __norm, __pageRect, __path, __rendered, __sel, __srOnly, __walk */
/**
 * skills/diff/scripts/clip-probe.mjs — the CLIPPING probe of the published-origin gate (#125, D1).
 *
 * Why: a recorded page passed the pixel gate at 6.7 % with every card broken — a fixed-height card
 * with `overflow: hidden` clipped the description mid-glyph and pushed the details link under the
 * primary button. The links were in the DOM; pixelmatch underweights small text inside matching
 * shapes. Geometry is checkable, so this probe checks it: every text node's line rects and every
 * control's box against EVERY overflow-clipping ancestor (nearest first) and the page width.
 *
 *   TEXT CLIPPED / TEXT HIDDEN / CONTROL HIDDEN / CONTROL CLIPPED            counted (exit 2)
 *   TEXT CLAMPED (line-clamp), TEXT|CONTROL COLLAPSED ("read more" toggle), SCROLL-HIDDEN,
 *   X-CUT / X-HIDDEN (horizontal: carousels, ellipsis)                       advisory
 *   collapsed containers (≤ 2 px), sr-only boxes, hidden / opacity-0 subtrees, off-page boxes,
 *   text inside a control already reported                                   never reported
 *
 * content-presence.mjs runs the same inventory on both sides; gate-all reads the served count as
 * criterion 3. The visible text LINE boxes come out as `textBoxes` (pixel-compare --text-boxes).
 *
 * Usage: node skills/diff/scripts/clip-probe.mjs <url> [--width 1440] [--min-cut 2] [--main <sel>]
 *        [--json [<file>]] [--max-findings 400] [--advisory] [--more-words <regex>] [--plain]
 *        [--warmup <url>] [--locale en-US]
 * Exit: 0 nothing counted, 2 counted findings, 1 error, 3 bot challenge. Requires playwright.
 * `clipInventoryInPage`, `IN_PAGE_LIB`, `inPage`, `summarize`, `formatTable` are exported.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, openPage, visit } from './measure-live.mjs';

const HELP = `clip-probe — text and controls cut or hidden by an overflow ancestor on a served page (#125 D1)

Usage: node clip-probe.mjs <url> [options]
  --width <px>        viewport width (default 1440)
  --min-cut <px>      ignore partial cuts below this (default 2)
  --main <sel>        restrict to this root (default whole document)
  --json [<file>]     JSON (counts, findings, groups, textBoxes) on stdout or to <file>
  --max-findings <n>  cap the finding list (default 400)
  --advisory          print the advisory kinds too (CLAMPED, COLLAPSED, SCROLL-HIDDEN, X-CUT, X-HIDDEN)
  --more-words <re>   "read more" toggle labels (default English: read|show|see|view|load + more|all|full|less)
  --plain             bundled Chromium instead of the window-free real-Chrome tier
  --warmup <url>      visit this URL first (bot-managed sites)
  --locale <tag>      default en-US
  --help              this text
Counted (exit 2): TEXT CLIPPED, TEXT HIDDEN, CONTROL HIDDEN, CONTROL CLIPPED. Exit 3 = bot challenge.`;

// ---- in-page library --------------------------------------------------------------------------------
// Helper declarations injected in front of every in-page function of the gate probes (content-presence
// and unit-geometry reuse them), so the clipping model is ONE piece of code. Playwright serialises a
// function's source only, so shared helpers must travel as text: inPage(fn, arg) builds the expression.
export const IN_PAGE_LIB = `
const __cs = new WeakMap();
function __style(el) { let s = __cs.get(el); if (!s) { s = getComputedStyle(el); __cs.set(el, s); } return s; }
function __parent(el) { return el.parentElement || (el.parentNode && el.parentNode.host) || null; }
function __rendered(el) {
  for (let a = el; a && a.nodeType === 1; a = __parent(a)) {
    const s = __style(a);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false;
    if (a.tagName === 'BODY') break;
  }
  return true;
}
function __pageRect(r) { return { l: r.left + window.scrollX, t: r.top + window.scrollY, r: r.right + window.scrollX, b: r.bottom + window.scrollY, w: r.width, h: r.height }; }
// nearest clipping ancestor of el (el itself excluded): { el, rect, mode: 'hidden'|'scroll'|'collapsed'|'srOnly', clamp } or null
function __srOnly(el) {
  const s = __style(el); const br = el.getBoundingClientRect();
  return (s.clipPath && s.clipPath !== 'none') || (s.clip && s.clip !== 'auto') || (br.width <= 1 && br.height <= 1 && s.overflow === 'hidden');
}
// every clipping ancestor, nearest first (el itself included when inclusive — a text node's own element clips
// its lines: a 30 px 'p.desc { overflow: hidden }' inside a 170 px body). Stops at a collapsed / sr-only box
// (the whole subtree is a state, not a clip defect) by returning { skip: true }.
function __clipChain(el, inclusive) {
  const chain = [];
  for (let a = inclusive ? el : __parent(el); a && a.nodeType === 1 && a.tagName !== 'BODY' && a.tagName !== 'HTML'; a = __parent(a)) {
    const s = __style(a);
    const clips = (v) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
    if (!clips(s.overflowX) && !clips(s.overflowY)) continue;
    const c = __clipOf(a, true);
    if (!c) continue;
    if (c.mode === 'collapsed' || c.mode === 'srOnly') return { skip: true, chain };
    chain.push(c);
  }
  return { skip: false, chain };
}
function __clipOf(el, inclusive) {
  for (let a = inclusive ? el : __parent(el); a && a.nodeType === 1 && a.tagName !== 'BODY' && a.tagName !== 'HTML'; a = __parent(a)) {
    const s = __style(a);
    const ox = s.overflowX, oy = s.overflowY;
    const clips = (v) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
    if (!clips(ox) && !clips(oy)) continue;
    const br = a.getBoundingClientRect();
    const cw = a.clientWidth || br.width, ch = a.clientHeight || br.height;
    const l = br.left + (a.clientLeft || 0) + window.scrollX, t = br.top + (a.clientTop || 0) + window.scrollY;
    const rect = { l, t, r: l + cw, b: t + ch, w: cw, h: ch };
    const srOnly = (s.clipPath && s.clipPath !== 'none') || (s.clip && s.clip !== 'auto') || (cw <= 1 && ch <= 1);
    const mode = srOnly ? 'srOnly' : (cw <= 2 || ch <= 2) ? 'collapsed' : (ox === 'scroll' || ox === 'auto' || oy === 'scroll' || oy === 'auto') ? 'scroll' : 'hidden';
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none';
    const toggle = mode === 'hidden' && !clamp && __collapsible(a);
    return { el: a, rect, mode, clamp, toggle, axes: { x: clips(ox), y: clips(oy) } };
  }
  return null;
}
// a clipper that is a "Read more" / "Show all" collapsible: it (or its parent) holds or is followed by a
// control with aria-expanded="false" or a show-more label. Whole lines behind it are a STATE the visitor can
// open, not a defect — recorded: 13 product pages read 4–46 TEXT HIDDEN inside their collapsed accordions.
const __MORE = typeof __MORE_OVERRIDE !== 'undefined' ? __MORE_OVERRIDE : /\\b(read|show|see|view|load)\\s+(more|all|full|less)\\b|\\bmore\\b\\s*$|expand/i;
function __collapsible(clipEl) {
  const isToggle = (c) => c.getAttribute('aria-expanded') === 'false' || c.getAttribute('aria-controls') || __MORE.test(__norm(c.textContent || c.getAttribute('aria-label') || '').slice(0, 40));
  const CTRL = 'button, [role="button"], a[href], summary, [aria-expanded]';
  // the toggle sits inside the box, right AFTER it, or in a small wrapper around it (≤ 3 children) — never
  // before it or anywhere in a large ancestor, or every box on a page with one "Read more" reads collapsible
  if ([...clipEl.querySelectorAll(CTRL)].some(isToggle)) return true;
  const next = clipEl.nextElementSibling;
  if (next && (isToggle(next) || [...next.querySelectorAll(CTRL)].some(isToggle))) return true;
  const parent = __parent(clipEl);
  if (parent && parent.children.length <= 3 && [...parent.querySelectorAll(CTRL)].some(isToggle)) return true;
  return false;
}
function __lineRects(node) {
  const range = document.createRange(); range.selectNodeContents(node);
  return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map(__pageRect);
}
function __sel(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  if (el.id) return tag + '#' + el.id;
  const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
  return tag + (cls.length ? '.' + cls.join('.') : '');
}
function __path(el, depth) {
  const parts = [];
  for (let a = el, i = 0; a && a.nodeType === 1 && a.tagName !== 'BODY' && i < (depth || 4); a = __parent(a), i += 1) parts.unshift(__sel(a));
  return parts.join(' > ');
}
function __norm(s) { return (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
// text a sighted visitor can read inside el: text nodes whose element is rendered, not sr-only, on-page
function __visibleText(el) {
  const pageW = document.documentElement.clientWidth; const parts = [];
  const stack = [el];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === 3) { if (n.textContent.trim()) parts.push(n.textContent); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG' || tag === 'svg') continue;
    const s = __style(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0 || __srOnly(n)) continue;
    const br = n.getBoundingClientRect();
    if (br.width > 0 && (br.right + window.scrollX <= 0 || br.left + window.scrollX >= pageW)) continue;
    if (n.shadowRoot) for (let i = n.shadowRoot.childNodes.length - 1; i >= 0; i -= 1) stack.push(n.shadowRoot.childNodes[i]);
    for (let i = n.childNodes.length - 1; i >= 0; i -= 1) stack.push(n.childNodes[i]);
  }
  return parts.join(' ').replace(/\\s+/g, ' ').trim();
}
function __isControl(el) {
  if (!el || el.nodeType !== 1) return false;
  const t = el.tagName;
  if (t === 'A') return el.hasAttribute('href');
  if (t === 'BUTTON' || t === 'SUMMARY' || t === 'SELECT') return true;
  if (t === 'INPUT') return /^(button|submit|reset)$/i.test(el.type);
  const role = el.getAttribute('role');
  return role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem';
}
function __controlOf(el) { for (let a = el; a && a.nodeType === 1; a = __parent(a)) { if (__isControl(a)) return a; if (a.tagName === 'BODY') break; } return null; }
function* __walk(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    yield n;
    if (n.nodeType === 1) {
      if (n.shadowRoot) for (let i = n.shadowRoot.childNodes.length - 1; i >= 0; i -= 1) stack.push(n.shadowRoot.childNodes[i]);
      const tag = n.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG' || tag === 'svg' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'TITLE') continue;
      for (let i = n.childNodes.length - 1; i >= 0; i -= 1) stack.push(n.childNodes[i]);
    }
  }
}
`;

/** Build a page.evaluate expression: the library, then fn applied to a JSON-inlined arg. */
export function inPage(fn, arg = {}, prelude = '') { return `(() => { ${prelude}\n${IN_PAGE_LIB}\n return (${fn.toString()})(${JSON.stringify(arg)}); })()`; }
/** The "read more" word list is English by default; --more-words <regex> replaces it (both probes). */
export const morePrelude = (re) => (re ? `const __MORE_OVERRIDE = new RegExp(${JSON.stringify(re)}, 'i');` : '');

/**
 * In-page (needs IN_PAGE_LIB): page.evaluate(inPage(clipInventoryInPage, { minCut, rootSel, maxFindings }))
 * → { docH, pageW, counts, findings, textBoxes }
 */
export function clipInventoryInPage({ minCut = 2, rootSel = null, maxFindings = 400 } = {}) {
  const root = (rootSel && document.querySelector(rootSel)) || document.body;
  const pageW = document.documentElement.clientWidth;
  const docH = document.documentElement.scrollHeight;
  const counts = { textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0, clamped: 0, collapsed: 0, scrollHidden: 0, horizontal: 0, offPage: 0, textNodes: 0, controls: 0, total: 0 };
  const findings = [];
  const textBoxes = [];
  const reported = new Set();
  const push = (f) => { if (findings.length < maxFindings) findings.push(f); };
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const rnd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]));
  // per-rect visibility against EVERY clipping ancestor, nearest first (vertical = the defect axis) and the
  // page width (horizontal). A line hidden by the nearest clipper is attributed to it (a line-clamp there is
  // design); a line no single clipper hides but one cuts across is a partial cut by that clipper.
  const judge = (rects, chain) => {
    let partialCut = 0; let hiddenV = 0; let visibleV = 0; let hcut = 0; let hiddenH = 0; let offPage = 0; let by = null; let hiddenBy = null;
    for (const r of rects) {
      if (r.r <= 0 || r.l >= pageW) { offPage += 1; continue; }
      if (r.r > pageW + minCut) hcut = Math.max(hcut, r.r - pageW);
      let hidden = null; let cut = 0; let cutBy = null; let hHidden = false;
      for (const clip of chain) {
        const vis = clip.axes.y ? overlap(r.t, r.b, clip.rect.t, clip.rect.b) : r.h;
        const hvis = clip.axes.x ? overlap(r.l, r.r, clip.rect.l, clip.rect.r) : r.w;
        if (vis <= 0) { hidden = clip; break; }
        if (r.h - vis > cut + 0.5 && r.h - vis > minCut) { cut = r.h - vis; cutBy = clip; }
        if (hvis <= 0) hHidden = true;
        else if (r.w - hvis > minCut) hcut = Math.max(hcut, r.w - hvis);
      }
      if (hidden) { hiddenV += 1; if (!hiddenBy) hiddenBy = hidden; }
      else { visibleV += 1; if (cut > partialCut) { partialCut = cut; by = cutBy; } if (hHidden) hiddenH += 1; }
    }
    return { partialCut, hiddenV, visibleV, hcut, hiddenH, offPage, n: rects.length, by, hiddenBy };
  };
  for (const node of __walk(root)) {
    if (node.nodeType === 1 && __isControl(node)) {
      if (!__rendered(node) || __srOnly(node)) continue;
      const br = node.getBoundingClientRect();
      if (br.width <= 0 || br.height <= 0) continue;
      counts.controls += 1;
      const r = __pageRect(br);
      const cc = __clipChain(node, false);
      if (cc.skip || !cc.chain.length) continue;
      const j = judge([r], cc.chain);
      if (j.offPage) { counts.offPage += 1; continue; }
      const text = __norm(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || (node.querySelector('img') && node.querySelector('img').alt) || '').slice(0, 60);
      const clip = j.hiddenBy || j.by || cc.chain[0];
      const base = { path: __path(node), text, clipper: __sel(clip.el), rect: rnd(r), clip: rnd(clip.rect) };
      if (j.hiddenV) {
        if (clip.mode === 'scroll') { counts.scrollHidden += 1; push({ kind: 'CONTROL SCROLL-HIDDEN', advisory: true, ...base }); }
        else if (clip.toggle) { counts.collapsed += 1; reported.add(node); push({ kind: 'CONTROL COLLAPSED', advisory: true, ...base }); }
        else { counts.controlHidden += 1; reported.add(node); push({ kind: 'CONTROL HIDDEN', cut: Math.round(r.h), ...base }); }
      } else if (j.partialCut) {
        if (clip.mode === 'scroll') { counts.scrollHidden += 1; push({ kind: 'CONTROL SCROLL-HIDDEN', advisory: true, cut: Math.round(j.partialCut), ...base }); }
        else { counts.controlClipped += 1; reported.add(node); push({ kind: 'CONTROL CLIPPED', cut: Math.round(j.partialCut), ...base }); }
      } else if (j.hiddenH) { counts.horizontal += 1; push({ kind: 'CONTROL X-HIDDEN', advisory: true, ...base }); }
      else if (j.hcut) { counts.horizontal += 1; push({ kind: 'CONTROL X-CUT', advisory: true, cut: Math.round(j.hcut), ...base }); }
      continue;
    }
    if (node.nodeType !== 3) continue;
    const text = node.textContent;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement || (node.parentNode && node.parentNode.host) || null;
    if (!parent || !__rendered(parent)) continue;
    const ptag = parent.tagName;
    if (ptag === 'OPTION' || ptag === 'OPTGROUP' || ptag === 'TEXTAREA') continue;
    if (__srOnly(parent)) continue; // the sr-only pattern carried by the text's own element
    const lines = __lineRects(node);
    if (!lines.length) continue;
    counts.textNodes += 1;
    const cc = __clipChain(parent, true);
    if (cc.skip) continue;
    const ctrl = __controlOf(parent);
    if (ctrl && reported.has(ctrl)) continue; // the control already carries the finding
    const j = judge(lines, cc.chain);
    if (j.offPage === j.n) { counts.offPage += 1; continue; }
    // visible line boxes → textBoxes (D4 input)
    for (const r of lines) {
      if (r.r <= 0 || r.l >= pageW) continue;
      if (cc.chain.some((clip) => clip.axes.y && overlap(r.t, r.b, clip.rect.t, clip.rect.b) <= 0)) continue;
      textBoxes.push({ x: Math.round(r.l), y: Math.round(r.t), w: Math.round(r.w), h: Math.round(r.h) });
    }
    const clip = j.by || j.hiddenBy || cc.chain[0] || null;
    const base = { path: __path(parent), text: __norm(text).slice(0, 60), clipper: clip ? __sel(clip.el) : null, rect: rnd(lines[0]), clip: clip ? rnd(clip.rect) : null, lines: lines.length };
    if (j.partialCut) {
      if (j.by.mode === 'scroll') { counts.scrollHidden += 1; push({ kind: 'TEXT SCROLL-HIDDEN', advisory: true, cut: Math.round(j.partialCut), ...base }); }
      else { counts.textClipped += 1; push({ kind: 'TEXT CLIPPED', cut: Math.round(j.partialCut), hiddenLines: j.hiddenV, ...base }); }
    } else if (j.hiddenV) {
      if (j.hiddenBy.mode === 'scroll') { counts.scrollHidden += 1; push({ kind: 'TEXT SCROLL-HIDDEN', advisory: true, hiddenLines: j.hiddenV, ...base }); }
      else if (j.hiddenBy.clamp) { counts.clamped += 1; push({ kind: 'TEXT CLAMPED', advisory: true, hiddenLines: j.hiddenV, ...base }); }
      else if (j.hiddenBy.toggle) { counts.collapsed += 1; push({ kind: 'TEXT COLLAPSED', advisory: true, hiddenLines: j.hiddenV, ...base }); }
      else { counts.textHidden += 1; push({ kind: 'TEXT HIDDEN', hiddenLines: j.hiddenV, cut: Math.round(lines[0].h), ...base }); }
    } else if (j.hiddenH || j.hcut) { counts.horizontal += 1; push({ kind: j.hiddenH ? 'TEXT X-HIDDEN' : 'TEXT X-CUT', advisory: true, cut: Math.round(j.hcut), ...base }); }
  }
  counts.total = counts.textClipped + counts.textHidden + counts.controlHidden + counts.controlClipped;
  return { docH, pageW, counts, findings, textBoxes };
}

// ---- pure: grouping + formatting ----------------------------------------------------------------------

/** Group findings by kind + clipper + parent selector: [{ kind, advisory, n, clipper, path, text, cutMin, cutMax }] sorted by count. */
export function summarize(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.clipper || ''}|${(f.path || '').split(' > ').pop()}`;
    let g = groups.get(key);
    if (!g) { g = { kind: f.kind, advisory: !!f.advisory, n: 0, clipper: f.clipper, path: f.path, text: f.text, cutMin: Infinity, cutMax: -Infinity }; groups.set(key, g); }
    g.n += 1;
    if (Number.isFinite(f.cut)) { g.cutMin = Math.min(g.cutMin, f.cut); g.cutMax = Math.max(g.cutMax, f.cut); }
  }
  return [...groups.values()].map((g) => ({ ...g, cutMin: Number.isFinite(g.cutMin) ? g.cutMin : null, cutMax: Number.isFinite(g.cutMax) ? g.cutMax : null })).sort((a, b) => Number(a.advisory) - Number(b.advisory) || b.n - a.n);
}

export function formatTable(groups, { advisory = false } = {}) {
  const rows = groups.filter((g) => advisory || !g.advisory);
  if (!rows.length) return '  (none)';
  const cut = (g) => (g.cutMin == null ? '-' : g.cutMin === g.cutMax ? `${g.cutMin}px` : `${g.cutMin}–${g.cutMax}px`);
  return rows.map((g) => `  ${g.advisory ? '🟡' : '🔴'} ${g.kind.padEnd(22)} ×${String(g.n).padEnd(5)} in ${g.clipper || '(page)'}  ${g.path}  "${g.text}"  cut ${cut(g)}`).join('\n');
}

export const verdictLine = (counts) => `Clipped: ${counts.total} (text clipped ${counts.textClipped}, text hidden ${counts.textHidden}, controls hidden ${counts.controlHidden}, controls clipped ${counts.controlClipped}; advisory: clamped ${counts.clamped}, collapsed ${counts.collapsed || 0}, scroll-hidden ${counts.scrollHidden}, horizontal ${counts.horizontal})`;

// ---- CLI ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { url: null, width: 1440, minCut: 2, main: null, json: false, jsonFile: null, maxFindings: 400, advisory: false, plain: false, warmup: null, locale: 'en-US', moreWords: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(rest[++i]);
    else if (a === '--min-cut') opts.minCut = Number(rest[++i]);
    else if (a === '--main') opts.main = rest[++i];
    else if (a === '--json') { opts.json = true; if (rest[i + 1] && !rest[i + 1].startsWith('--')) opts.jsonFile = rest[++i]; }
    else if (a === '--max-findings') opts.maxFindings = Number(rest[++i]);
    else if (a === '--advisory') opts.advisory = true;
    else if (a === '--more-words') opts.moreWords = rest[++i];
    else if (a === '--plain') opts.plain = true;
    else if (a === '--warmup') opts.warmup = rest[++i];
    else if (a === '--locale') opts.locale = rest[++i];
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!opts.url) opts.url = a;
  }
  if (!opts.url) { console.error(`need <url>\n\n${HELP}`); process.exit(1); }
  return opts;
}

/** Load + settle a page and run the inventory (shared with gate-all's --no-content path). */
export async function probe(page, url, opts) {
  const v = await visit(page, url, { warmup: opts.warmup });
  const inv = await page.evaluate(inPage(clipInventoryInPage, { minCut: opts.minCut, rootSel: opts.main, maxFindings: opts.maxFindings }, morePrelude(opts.moreWords)));
  return { url, at: new Date().toISOString(), width: opts.width, status: v.status, settlePasses: v.passes, ...inv, groups: summarize(inv.findings) };
}

async function main() {
  const opts = parseArgs(process.argv);
  const { chromium } = await import('playwright');
  const browser = await openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' });
  let res;
  try {
    const { ctx, page } = await openPage(browser, { width: opts.width, locale: opts.locale });
    res = await probe(page, opts.url, opts);
    await ctx.close();
  } finally { await browser.close(); }
  const out = { ...res, textBoxes: res.textBoxes };
  if (opts.json && !opts.jsonFile) { console.log(JSON.stringify(out, null, 1)); }
  else {
    console.log(`clip-probe ${opts.url} @ ${opts.width}px — docH ${res.docH}, ${res.counts.textNodes} text nodes, ${res.counts.controls} controls (HTTP ${res.status})`);
    console.log(formatTable(res.groups, { advisory: opts.advisory }));
    console.log(verdictLine(res.counts));
    if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile) || '.', { recursive: true }); writeFileSync(opts.jsonFile, JSON.stringify(out, null, 1)); console.log(`json → ${opts.jsonFile}`); }
  }
  process.exitCode = res.counts.total > 0 ? 2 : 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`clip-probe error: ${String(e.message).split('\n')[0]}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
