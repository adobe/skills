#!/usr/bin/env node
/**
 * skills/replica/scripts/cap-probe.mjs — the content-cap probe (#124): the page's container
 * sizing MODEL — which boxes stop growing, at what width, at which tier — measured on a page
 * (capture) or compared live vs build (compare). Shared by extract (records the model into
 * DESIGN.json), replica (the mandatory wide row of the pass bar) and deploy (qa-gate.mjs imports
 * probePage for its wide pass).
 *
 * Why: both pixel gates run NARROWER than most caps — at 1440 a 1600 px article and a 1920 px
 * shell are both wider than the viewport, so a build that renders edge to edge at every width
 * passes both gates by construction (recorded: a live site with two nested centered caps, 1920
 * shell + 1600 content; the build declared the token and never applied it; both gates green).
 * A probe pinned AT a cap's width cannot see the cap either (at 1920 the shell reads as the
 * viewport) — so the probe width is DERIVED, never fixed: max(2560, largest cap × 1.25).
 *
 * Method (one navigation per URL, no diff loop): render at the base width (1440), remember every
 * visible box ≥ 240 px wide, then read the same boxes at the probe width and at 0.9 × the probe
 * width (resizes, not navigations). A box is CAPPED when its width is identical at the two wide
 * reads and short of the viewport — a 90 % container scales, a `max-width`/fixed box does not; a
 * cap ORIGIN is a capped box whose parent is fluid, or that is narrower than its parent's content
 * box by its own `max-width` / fixed `width` (padding and auto margins are layout, not caps). When
 * a cap is found at ≥ probe ÷ 1.25 the probe width is re-derived and the wide reads repeated once.
 * Kinds, by how much of the content root a cap holds: `shell` — the outermost cap holding ≥ 90 %
 * of the root's text (or an ancestor of the root); `content` — a further cap inside it holding
 * ≥ 90 %; `module` — a cap inside one top-level section (the root's children, descending through
 * single-child wrappers); caps in header/footer are chrome and are not modelled. The
 * page's contentMaxWidth is the innermost shell/content cap; without one, the module cap shared by
 * at least half of the capped sections; else null (fluid). Compare pairs the two sides by KIND and
 * by section order (never by DOM depth — EDS wrappers are full width by design).
 *
 * Usage:
 *   capture  node cap-probe.mjs <url> [<url>…] [--main <sel>] [--write-design <DESIGN.json>]
 *   compare  node cap-probe.mjs <live-url> --against <build-url> [--design <DESIGN.json>]
 *                               [--slug <s> [--label <l>]] [--main <sel>] [--build-main <sel>]
 *     --width <px>           base width (default 1440)
 *     --probe-width <px>     PIN the probe width and skip derivation — evidence runs only (a probe
 *                            at a cap's own width misses it); the default derives
 *     --tolerance <px>       cap match tolerance in compare (default 20)
 *     --main <sel>           content root on the live side (default: main, else body)
 *     --build-main <sel>     content root on the build side (default: main)
 *     --design <file>        compare: read extensions.breakpoints.probeWidth (and containerMaxWidth)
 *                            so every skill probes at the width extract derived
 *     --write-design <file>  capture: merge the model into <file> extensions.breakpoints —
 *                            containerMaxWidth ("1600px" | null), probeWidth, caps[], modules[]
 *     --slug <s>             compare: evidence to stardust/replica/gates/<slug>-<probeWidth>/
 *                            cap-<label>.json (+ .txt), like the pixel rounds (--label default iter)
 *     --json / --out <file>  the JSON on stdout / written to <file>
 *     --timeout-ms, --ua, --consent <sel>, --dismiss <sel,…>, --headed, --locale <tag>  as measure.mjs
 *
 * Output (capture): per URL the probe width and its derivation, one line per cap origin (kind, px,
 * via, selector, tier, share), a modules line (capped values × count, full-bleed count); then across
 * URLs: `contentMaxWidth`, `shellMaxWidth`, `probeWidth`, and `consistent: yes|NO` — a cap that
 * differs between archetypes, or a module cap on a single section, is a register item, not a token.
 * Compare rows: `wrapper cap` (innermost shell/content cap, live vs build, ±tolerance; a live cap
 * missing on the build, or a build cap over a fluid live, is ✗), `module i/n` per section (same
 * rule; advisory when the section counts differ — fix structure first) and, when neither side has
 * a wrapper, `content cap` (the shared module cap). Outer shell caps beyond the wrapper cap are
 * informational. The verdict line:
 * `cap-probe: PASS|FAIL at <probeWidth> — <n> of <m> rows…`. A ✗ names the sizing rule to fix
 * (deploy Step 3 scaffold); never iterate pixels on it.
 *
 * Exit codes: 0 pass / measured, 2 compare FAIL, 1 a page failed to load or playwright missing,
 * 3 bot challenge on the live side (escalate --headed), 125 usage. probePage and the pure
 * functions (classifyCaps, deriveProbeWidth, aggregateCaps, compareCaps, formatCapture,
 * formatCompare, parseArgs) are exported — the contract test runs them without a browser.
 * Requires playwright importable from this file's location and the diff skill's live-session.mjs
 * (../../diff/scripts/ or ../diff/ — replica SKILL.md § Setup copies both dirs as siblings).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

export const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
export const BASE_WIDTH = 1440;
export const MIN_PROBE_WIDTH = 2560;
export const PROBE_FACTOR = 1.25;
export const CAP_TOLERANCE = 20;
export const WRAPPER_SHARE = 0.9;
const VIEWPORT_H = 900;
const EDGE = 8; // px: a box this close to the viewport is full width

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 125; } }

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION_CANDIDATES = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'];
async function loadLiveSession() {
  const found = LIVE_SESSION_CANDIDATES.map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new UsageError('live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function parseArgs(argv) {
  const o = { urls: [], against: null, width: BASE_WIDTH, probeWidth: null, tolerance: CAP_TOLERANCE, main: null, buildMain: 'main', design: null, writeDesign: null, slug: null, label: 'iter', json: false, out: null, timeoutMs: 30000, ua: DEFAULT_UA, consent: null, dismiss: [], headed: false, locale: null };
  const need = (i, flag) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${flag} needs a value`); return argv[i + 1]; };
  const int = (v, flag) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} must be a positive integer, got ${v}`); return n; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--against') { o.against = need(i, a); i += 1; }
    else if (a === '--width') { o.width = int(need(i, a), a); i += 1; }
    else if (a === '--probe-width') { o.probeWidth = int(need(i, a), a); i += 1; }
    else if (a === '--tolerance') { o.tolerance = int(need(i, a), a); i += 1; }
    else if (a === '--main') { o.main = need(i, a); i += 1; }
    else if (a === '--build-main') { o.buildMain = need(i, a); i += 1; }
    else if (a === '--design') { o.design = need(i, a); i += 1; }
    else if (a === '--write-design') { o.writeDesign = need(i, a); i += 1; }
    else if (a === '--slug') { o.slug = need(i, a); i += 1; }
    else if (a === '--label') { o.label = need(i, a); i += 1; }
    else if (a === '--json') { o.json = true; }
    else if (a === '--out') { o.out = need(i, a); i += 1; }
    else if (a === '--timeout-ms') { o.timeoutMs = int(need(i, a), a); i += 1; }
    else if (a === '--ua') { o.ua = need(i, a); i += 1; }
    else if (a === '--consent') { o.consent = need(i, a); i += 1; }
    else if (a === '--dismiss') { o.dismiss.push(...splitList(need(i, a))); i += 1; }
    else if (a === '--headed') { o.headed = true; }
    else if (a === '--locale') { o.locale = need(i, a); i += 1; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a} (see --help)`); }
    else { o.urls.push(a); }
  }
  if (!o.urls.length) throw new UsageError('need <url> (see --help)');
  if (o.against && o.urls.length > 1) throw new UsageError('compare takes ONE live url and --against <build-url>');
  if (o.against && o.writeDesign) throw new UsageError('--write-design is a capture flag; compare reads --design');
  if (o.slug && !o.against) throw new UsageError('--slug records compare evidence; it needs --against');
  if (o.probeWidth && o.probeWidth <= o.width) throw new UsageError(`--probe-width must exceed the base width ${o.width}`);
  return o;
}

// ---- in-page passes (serialised by playwright — no outer-scope references) -----------------------
/* eslint-disable no-undef */
// Pass 1 at the base width: remember every visible box ≥ 240 px wide with its base width, and the
// content root. Stored on window so pass 2 reads the SAME elements after the resize (no DOM stamping).
function basePassInPage({ rootSel }) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'G', 'USE', 'DEFS', 'BR', 'IFRAME']);
  let root = null;
  if (rootSel) { try { root = document.querySelector(rootSel); } catch { root = null; } }
  const rootMatched = !rootSel || !!root;
  if (!root) root = document.querySelector('main') || document.body;
  const els = []; const base = [];
  for (const el of [document.body, ...document.body.querySelectorAll('*')]) {
    if (SKIP.has(el.tagName.toUpperCase()) || !vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 24) continue;
    els.push(el); base.push(Math.round(r.width));
  }
  window.__capProbe = { els, base, root, rootSel: rootSel || null };
  return { viewport: document.documentElement.clientWidth, candidates: els.length, rootMatched, rootIsBody: root === document.body };
}

// Pass 2 at the probe width: the same boxes, with everything the classifier needs.
function probePassInPage() {
  const S = window.__capProbe;
  const vw = document.documentElement.clientWidth;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 4; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n.id && /^[A-Za-z][\w-]{0,40}$/.test(n.id) && !/\d{3,}/.test(n.id)) { parts.unshift(`#${n.id}`); break; }
      const cls = [...n.classList].filter((c) => /^[A-Za-z][\w-]{0,30}$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2);
      parts.unshift(tag + (cls.length ? `.${cls.join('.')}` : ''));
    }
    return parts.join(' > ');
  };
  const { root } = S;
  // Text leaves of the root: what "holds the content" is measured against.
  const leaves = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && norm(n.nodeValue)) { leaves.push(el); break; }
  }
  // Top-level sections: the root's children — descending through single-child wrappers (a live
  // `main > div.content > div.wrapper > section*` is common) until a node has two or more.
  // A wrapper whose children are fixed/absolute has no height of its own — it qualifies when it holds text.
  const qualifying = (node) => [...node.children].filter((kid) => { const r = kid.getBoundingClientRect(); return r.width > 0 && getComputedStyle(kid).display !== 'none' && (r.height >= 40 || leaves.some((l) => kid.contains(l))); });
  let sectionRoot = root; let kids = qualifying(sectionRoot);
  for (let guard = 0; kids.length === 1 && guard < 8; guard += 1) { sectionRoot = kids[0]; kids = qualifying(sectionRoot); }
  const sections = kids.map((kid) => { const r = kid.getBoundingClientRect(); return { el: kid, selector: cssPath(kid), w: Math.round(r.width), h: Math.round(r.height) }; });
  const sectionOf = (el) => { for (let i = 0; i < sections.length; i += 1) if (sections[i].el.contains(el)) return i; return -1; };
  const depthFromRoot = (el) => {
    if (el.contains(root)) { let d = 0; for (let n = root; n && n !== el; n = n.parentElement) d -= 1; return d; }
    let d = 0; for (let n = el; n && n !== root; n = n.parentElement) d += 1; return d;
  };
  const chromeOf = (el) => !!(el.closest('header, footer, nav, [role="banner"], [role="contentinfo"]'));
  const idx = new Map(S.els.map((e, k) => [e, k]));
  const boxes = [];
  S.els.forEach((el, i) => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width <= 0 || cs.display === 'none') return;
    const p = el.parentElement; const pr = p ? p.getBoundingClientRect() : null; const pcs = p ? getComputedStyle(p) : null;
    const inRoot = root.contains(el); const aboveRoot = el !== root && el.contains(root);
    let held = 0;
    if (aboveRoot) held = leaves.length; else if (inRoot) for (const l of leaves) if (el.contains(l)) held += 1;
    const contentBearing = held > 0 || !!el.querySelector('img, picture, video, svg, canvas');
    boxes.push({
      i, selector: cssPath(el), tag: el.tagName.toLowerCase(),
      w1: S.base[i], w2: Math.round(r.width), h2: Math.round(r.height),
      maxWidth: cs.maxWidth, boxSizing: cs.boxSizing, padL: parseFloat(cs.paddingLeft) || 0, padR: parseFloat(cs.paddingRight) || 0,
      parent: p ? { i: idx.has(p) ? idx.get(p) : -1, w2: Math.round(pr.width), padL: parseFloat(pcs.paddingLeft) || 0, padR: parseFloat(pcs.paddingRight) || 0 } : null,
      share: leaves.length ? held / leaves.length : 0, contentBearing,
      inRoot, aboveRoot, isRoot: el === root, tier: depthFromRoot(el), section: inRoot && !aboveRoot ? sectionOf(el) : -1,
      chrome: el !== root && !aboveRoot && chromeOf(el), // header/nav/footer caps are chrome wherever they sit
    });
  });
  return { viewport: vw, root: { selector: cssPath(root), isBody: root === document.body, leaves: leaves.length, w2: Math.round(root.getBoundingClientRect().width) }, sections: sections.map(({ selector, w, h }) => ({ selector, w, h })), boxes };
}
// Pass 3 at 0.9 × the probe width: the same boxes' widths only, by index.
function wideReadInPage() {
  return window.__capProbe.els.map((el) => (el.isConnected ? Math.round(el.getBoundingClientRect().width) : null));
}
/* eslint-enable no-undef */

// ---- classification (pure) ------------------------------------------------------------------------

// Capped = the same width at the two wide reads (probe and 0.9 × probe) while short of the viewport:
// a 90 % container scales between them, a max-width/fixed box does not. Without a third read (older
// fixtures) fall back to the growth test: full width at the probe, or a constant share of the
// viewport (a `width: 50%` column), is fluid; everything else stopped growing somewhere.
export function isCapped(b, baseWidth, probeWidth) {
  if (b.w2 >= probeWidth - EDGE) return false;
  if (Number.isFinite(b.w3)) return Math.abs(b.w2 - b.w3) <= 1;
  const grew = b.w2 - b.w1; const dv = probeWidth - baseWidth;
  if (grew >= dv - EDGE) return false;
  const proportional = Math.abs(b.w2 / probeWidth - b.w1 / baseWidth) < 0.02 && b.w1 < baseWidth - EDGE;
  return !proportional;
}

// How the cap is authored: its own max-width (content-box adds the padding), a fixed px width (same
// at both reads), or anything else (clamp(), min(), a percentage of a capped parent, …).
export function capVia(b) {
  const mw = parseFloat(b.maxWidth);
  if (Number.isFinite(mw)) { const own = mw + (b.boxSizing === 'content-box' ? b.padL + b.padR : 0); if (Math.abs(own - b.w2) <= 2) return 'max-width'; }
  if (Math.abs(b.w2 - b.w1) <= 1) return 'fixed';
  return 'other';
}

// Boxes → cap origins with kinds, the per-section module map, and the page's content cap.
export function classifyCaps(pass, { baseWidth = BASE_WIDTH, probeWidth = MIN_PROBE_WIDTH } = {}) {
  const byIndex = new Map(pass.boxes.map((b) => [b.i, b]));
  const capped = new Map();
  for (const b of pass.boxes) capped.set(b.i, isCapped(b, baseWidth, probeWidth));
  const origins = [];
  for (const b of pass.boxes) {
    if (!capped.get(b.i) || !b.contentBearing || b.chrome) continue;
    const p = b.parent && byIndex.get(b.parent.i);
    const parentCapped = p ? capped.get(p.i) : false;
    const via = capVia(b);
    if (parentCapped) {
      const parentContent = b.parent.w2 - b.parent.padL - b.parent.padR;
      if (b.w2 >= parentContent - 2 || via === 'other') continue; // inherited width, or padding/margins — layout, not a cap
    }
    origins.push({ kind: null, px: b.w2, via, selector: b.selector, tier: b.tier, share: Math.round(b.share * 100) / 100, section: b.section, w1: b.w1, maxWidth: b.maxWidth });
  }
  // Wrappers: hold ≥ 90 % of the root's text (ancestors of the root hold all of it). Outermost first.
  const wrappers = origins.filter((o) => o.share >= WRAPPER_SHARE || o.tier <= 0).sort((a, b) => a.tier - b.tier || b.px - a.px);
  wrappers.forEach((o, k) => { o.kind = k === 0 ? 'shell' : 'content'; });
  for (const o of origins) if (!o.kind) o.kind = o.section >= 0 ? 'module' : 'other';
  // One module cap per section: the widest module origin inside it (the section's content column).
  const modules = pass.sections.map((s, index) => {
    const inSection = origins.filter((o) => o.kind === 'module' && o.section === index);
    const top = inSection.sort((a, b) => b.px - a.px)[0] || null;
    return { index, selector: s.selector, px: top ? top.px : null, capSelector: top ? top.selector : null };
  });
  const shell = wrappers[0] || null;
  const innerWrapper = wrappers[wrappers.length - 1] || null;
  let contentMaxWidth = innerWrapper ? innerWrapper.px : null; let contentFrom = innerWrapper ? innerWrapper.kind : null;
  if (contentMaxWidth === null) {
    const cappedModules = modules.filter((m) => m.px !== null);
    const groups = groupPx(cappedModules.map((m) => m.px));
    if (groups.length && groups[0].count * 2 >= cappedModules.length && cappedModules.length) { contentMaxWidth = groups[0].px; contentFrom = 'module'; }
  }
  const maxCap = origins.reduce((m, o) => Math.max(m, o.px), 0);
  return { baseWidth, probeWidth, root: pass.root, origins, modules, shellMaxWidth: shell ? shell.px : null, contentMaxWidth, contentFrom, maxCap, fluid: !origins.length };
}

// px values → groups within the tolerance, most frequent first (then widest).
export function groupPx(values, tol = CAP_TOLERANCE) {
  const groups = [];
  for (const v of [...values].sort((a, b) => b - a)) {
    const g = groups.find((x) => Math.abs(x.px - v) <= tol);
    if (g) g.count += 1; else groups.push({ px: v, count: 1 });
  }
  return groups.sort((a, b) => b.count - a.count || b.px - a.px);
}

// max(2560, largest cap × 1.25) — a probe AT a cap's width cannot see the cap.
export function deriveProbeWidth(maxCap) { return Math.max(MIN_PROBE_WIDTH, Math.ceil((maxCap || 0) * PROBE_FACTOR)); }

// Several archetypes → one model: caps grouped by kind + px with the pages that carry them, the
// content/shell cap when every page agrees (±tolerance), and the register items when they don't.
export function aggregateCaps(perUrl, tol = CAP_TOLERANCE) {
  const urls = Object.keys(perUrl);
  const caps = [];
  for (const url of urls) for (const o of perUrl[url].origins) {
    if (o.kind === 'other') continue;
    const g = caps.find((c) => c.kind === o.kind && Math.abs(c.px - o.px) <= tol);
    if (g) { if (!g.pages.includes(url)) g.pages.push(url); } else caps.push({ kind: o.kind, px: o.px, via: o.via, selector: o.selector, pages: [url] });
  }
  caps.sort((a, b) => ['shell', 'content', 'module'].indexOf(a.kind) - ['shell', 'content', 'module'].indexOf(b.kind) || b.px - a.px);
  const agree = (key) => {
    const vals = urls.map((u) => perUrl[u][key]);
    const set = vals.filter((v) => v !== null);
    if (!set.length) return { value: null, consistent: true, perUrl: vals };
    const g = groupPx(set, tol)[0];
    return { value: g.px, consistent: set.length === vals.length && g.count === set.length, perUrl: vals };
  };
  const content = agree('contentMaxWidth'); const shell = agree('shellMaxWidth');
  const register = [];
  if (!content.consistent) register.push(`contentMaxWidth differs between archetypes: ${urls.map((u, i) => `${content.perUrl[i] ?? 'fluid'} (${u})`).join(', ')} — decide per template in the inconsistency register`);
  if (!shell.consistent) register.push(`shellMaxWidth differs between archetypes: ${urls.map((u, i) => `${shell.perUrl[i] ?? 'fluid'} (${u})`).join(', ')}`);
  for (const c of caps) if (c.kind === 'module' && c.pages.length === 1 && urls.length > 1) {
    const page = perUrl[c.pages[0]]; const n = page.modules.filter((m) => m.px !== null && Math.abs(m.px - c.px) <= tol).length;
    if (n === 1) register.push(`module cap ${c.px}px on a single section (${c.selector}, ${c.pages[0]}) — intent or mistake? register it`);
  }
  const maxCap = Math.max(0, ...urls.map((u) => perUrl[u].maxCap));
  const modules = urls.flatMap((u) => perUrl[u].modules.map((m) => ({ url: u, section: m.index, selector: m.selector, px: m.px })));
  return { containerMaxWidth: content.value === null ? null : `${content.value}px`, contentMaxWidth: content.value, shellMaxWidth: shell.value, consistent: content.consistent && shell.consistent && !register.length, probeWidth: deriveProbeWidth(maxCap), caps, modules, register };
}

// Live model vs build model → rows and a verdict. Pairing is by KIND and by section order: the
// wrapper row (innermost shell/content cap) first, then one module row per top-level section; when
// neither side has a wrapper the module-derived content cap gets its own row so a section-count
// mismatch (advisory module rows) still leaves one deciding row.
export function compareCaps(live, build, tol = CAP_TOLERANCE) {
  const rows = [];
  const row = (ok, label, detail, advisory = false) => rows.push({ ok, label, detail, advisory });
  const wrapperOf = (m) => { const w = m.origins.filter((o) => o.kind === 'shell' || o.kind === 'content'); return w.length ? w[w.length - 1] : null; };
  const rule = (px, tier) => `fix the sizing rule, not pixels — deploy Step 3 scaffold: ${tier === 'wrapper' ? `main { max-width: ${px}px; margin: 0 auto }` : `main > .section > div { max-width: ${px}px; margin: 0 auto }`}`;
  const lw = wrapperOf(live); const bw = wrapperOf(build);
  const modulesNote = (m) => { const c = m.modules.filter((x) => x.px !== null); return c.length ? `module caps only: ${groupPx(c.map((x) => x.px), tol).map((g) => `${g.px}px ×${g.count}`).join(', ')}` : 'no cap at all'; };
  if (lw && !bw) row(false, 'wrapper cap', `live ${lw.px}px (${lw.kind}, ${lw.selector}) → build NONE: content runs ${build.root.w2}px wide at ${build.probeWidth} (${modulesNote(build)}) — ${rule(lw.px, 'wrapper')}`);
  else if (!lw && bw) row(false, 'wrapper cap', `build ${bw.px}px (${bw.selector}) but live has no wrapper cap (${modulesNote(live)}; live content runs ${live.root.w2}px at ${live.probeWidth}) — fix the sizing rule, not pixels: remove the wrapper cap, the live site does not have one`);
  else if (lw && bw && Math.abs(lw.px - bw.px) <= tol) row(true, 'wrapper cap', `live ${lw.px}px = build ${bw.px}px (±${tol})`);
  else if (lw && bw) row(false, 'wrapper cap', `live ${lw.px}px (${lw.selector}) → build ${bw.px}px (${bw.selector}), Δ${bw.px - lw.px}px — ${rule(lw.px, 'wrapper')}`);
  else {
    const L = live.contentMaxWidth; const B = build.contentMaxWidth;
    if (L === null && B === null) row(true, 'content cap', 'fluid on both sides — no wrapper, no shared module cap');
    else if (L !== null && B === null) row(false, 'content cap', `live ${L}px (${modulesNote(live)}) → build NONE: content runs ${build.root.w2}px wide at ${build.probeWidth} — ${rule(L, 'module')}`);
    else if (L === null && B !== null) row(false, 'content cap', `build ${B}px (${modulesNote(build)}) but live modules are fluid — fix the sizing rule, not pixels: remove the module cap`);
    else if (Math.abs(L - B) <= tol) row(true, 'content cap', `live ${L}px = build ${B}px (±${tol}, shared module cap)`);
    else row(false, 'content cap', `live ${L}px → build ${B}px, Δ${B - L}px (shared module cap) — ${rule(L, 'module')}`);
  }
  for (const o of live.origins.filter((x) => (x.kind === 'shell' || x.kind === 'content') && x !== lw)) row(true, `outer ${o.kind}`, `live ${o.px}px (${o.selector}) encloses the ${lw.px}px wrapper cap — informational, no content bound of its own`, true);
  const advisory = live.modules.length !== build.modules.length;
  if (advisory) row(true, 'sections', `live ${live.modules.length} vs build ${build.modules.length} top-level sections — module rows compared by order up to the shorter side, advisory until the structure matches`, true);
  const n = Math.min(live.modules.length, build.modules.length);
  for (let i = 0; i < n; i += 1) {
    const a = live.modules[i]; const b = build.modules[i]; const label = `module ${i + 1}/${live.modules.length}`;
    if (a.px === null && b.px === null) row(true, label, 'full-bleed on both');
    else if (a.px !== null && b.px === null) row(advisory, label, `live ${a.px}px (${a.capSelector}) → build full-bleed (${b.selector})`, advisory);
    else if (a.px === null && b.px !== null) row(advisory, label, `live full-bleed (${a.selector}) → build ${b.px}px (${b.capSelector})`, advisory);
    else if (Math.abs(a.px - b.px) <= tol) row(true, label, `${a.px}px = ${b.px}px`);
    else row(advisory, label, `live ${a.px}px → build ${b.px}px, Δ${b.px - a.px}px (${b.capSelector})`, advisory);
  }
  const fails = rows.filter((r) => !r.ok).length;
  return { probeWidth: live.probeWidth, rows, fails, pass: fails === 0 };
}

// ---- formatting (pure) ----------------------------------------------------------------------------
const pxs = (v) => (v === null || v === undefined ? 'fluid' : `${v}px`);
export function formatModel(m) {
  const lines = [];
  if (!m.origins.length) lines.push(`  no cap origin — content runs ${m.root.w2}px wide at ${m.probeWidth} (fluid)`);
  for (const o of m.origins.filter((x) => x.kind === 'shell' || x.kind === 'content')) lines.push(`  ${o.kind.padEnd(8)} ${String(o.px).padStart(5)}px  ${o.via.padEnd(9)} ${o.selector}  (tier ${o.tier}, holds ${Math.round(o.share * 100)}% of the text)`);
  const other = m.origins.filter((x) => x.kind === 'other');
  if (other.length) lines.push(`  other    ${other.length} capped box(es) outside the section tier (in the JSON) — e.g. ${other[0].px}px ${other[0].selector}`);
  const capped = m.modules.filter((x) => x.px !== null);
  const groups = groupPx(capped.map((x) => x.px)).map((g) => `${g.px} ×${g.count}`).join(', ');
  lines.push(`  modules  ${m.modules.length} sections: ${capped.length ? `capped ${groups}` : 'none capped'} · full-bleed ×${m.modules.length - capped.length}`);
  lines.push(`  contentMaxWidth ${pxs(m.contentMaxWidth)}${m.contentFrom ? ` (${m.contentFrom})` : ''} · shellMaxWidth ${pxs(m.shellMaxWidth)} · root ${m.root.selector}`);
  return lines.join('\n');
}
export function formatCapture(result) {
  const out = [];
  for (const [url, m] of Object.entries(result.pages)) { out.push(`${url}  base ${m.baseWidth} → probe ${m.probeWidth}${m.probeNote ? ` (${m.probeNote})` : ''}`); out.push(formatModel(m)); }
  const a = result.aggregate;
  if (a) {
    out.push(`contentMaxWidth: ${a.containerMaxWidth ?? 'null (fluid)'}  shellMaxWidth: ${pxs(a.shellMaxWidth)}  probeWidth: ${a.probeWidth}  consistent: ${a.consistent ? 'yes' : 'NO'}`);
    for (const r of a.register) out.push(`  register: ${r}`);
  }
  return out.join('\n');
}
export function formatCompare(result) {
  const out = [`cap-probe  base ${result.live.baseWidth} → probe ${result.live.probeWidth} (${result.probeNote})`, `live   ${result.urls[0]}`, formatModel(result.live), `build  ${result.urls[1]}`, formatModel(result.build), 'rows'];
  for (const r of result.compare.rows) out.push(`  ${r.ok ? (r.advisory ? '⚠' : '✓') : '✗'} ${r.label}: ${r.detail}`);
  out.push(`cap-probe: ${result.compare.pass ? 'PASS' : 'FAIL'} at ${result.live.probeWidth} — ${result.compare.fails} of ${result.compare.rows.length} rows failed${result.evidence ? ` (evidence ${result.evidence})` : ''}`);
  return out.join('\n');
}

// ---- browser ---------------------------------------------------------------------------------------
export function isLiveHttpUrl(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(u.hostname); } catch { return false; }
}

async function settle(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(300);
}

// The two-pass read on an OPEN page (qa-gate.mjs calls this on its own page). Returns the classified
// model; `probeWidth` pins the width, otherwise it derives from what the first wide read found.
export async function probePage(page, { rootSel = null, baseWidth = BASE_WIDTH, probeWidth = null } = {}) {
  await page.setViewportSize({ width: baseWidth, height: VIEWPORT_H });
  await settle(page);
  const base = await page.evaluate(basePassInPage, { rootSel });
  if (!base.rootMatched) console.error(`cap-probe: root selector "${rootSel}" matched nothing — probing under main (else body)`);
  let width = probeWidth || MIN_PROBE_WIDTH; let note = probeWidth ? 'pinned' : `derived: max(${MIN_PROBE_WIDTH}, largest cap × ${PROBE_FACTOR})`;
  const wideReads = async (w) => {
    await page.setViewportSize({ width: w, height: VIEWPORT_H });
    await settle(page);
    const pass = await page.evaluate(probePassInPage);
    await page.setViewportSize({ width: Math.round(w * 0.9), height: VIEWPORT_H });
    await settle(page);
    const w3 = await page.evaluate(wideReadInPage);
    for (const b of pass.boxes) b.w3 = w3[b.i];
    return classifyCaps(pass, { baseWidth, probeWidth: w });
  };
  let model = await wideReads(width);
  const derived = deriveProbeWidth(model.maxCap);
  if (!probeWidth && derived > width) {
    width = derived; note = `derived: ${model.maxCap} × ${PROBE_FACTOR} → ${width}, re-read once`;
    model = await wideReads(width);
  }
  return { ...model, probeNote: note, candidates: base.candidates };
}

async function openAndProbe(browser, url, o, session, { rootSel, probeWidth }) {
  const live = isLiveHttpUrl(url);
  const viewport = { width: o.width, height: VIEWPORT_H };
  const common = { reducedMotion: 'reduce', colorScheme: 'light', ignoreHTTPSErrors: true };
  const context = live
    ? await session.newLiveContext(browser, { ua: o.ua, locale: o.locale, viewport, ...common })
    : await browser.newContext({ userAgent: o.ua, viewport, locale: 'en-US', ...common });
  const page = await context.newPage();
  try {
    if (live) {
      await session.gotoLive(page, url, { waitUntil: session.defaultWaitUntil(url), timeoutMs: o.timeoutMs, settleMs: 1500, solveWindow: o.headed });
      const d = await session.dismissOverlays(page, { extra: [...(o.consent ? [o.consent] : []), ...o.dismiss], lateWindowMs: 6000 });
      for (const sel of [d.consent, ...d.extra, ...d.marketing].filter(Boolean)) console.error(`cap-probe: overlay dismissed via ${sel}`);
    } else {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: o.timeoutMs });
      if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    }
    return await probePage(page, { rootSel, baseWidth: o.width, probeWidth });
  } finally {
    await context.close().catch(() => {});
  }
}

// DESIGN.json: read the persisted sizing model / merge the measured one into extensions.breakpoints.
export function readDesignSizing(file) {
  if (!file || !existsSync(file)) return null;
  const bp = ((JSON.parse(readFileSync(file, 'utf8')) || {}).extensions || {}).breakpoints || {};
  const cmw = parseFloat(bp.containerMaxWidth);
  return { probeWidth: Number.isInteger(bp.probeWidth) ? bp.probeWidth : null, containerMaxWidth: Number.isFinite(cmw) ? cmw : null };
}
export function mergeDesign(text, aggregate, provenance) {
  const data = JSON.parse(text);
  data.extensions = data.extensions || {};
  const bp = (data.extensions.breakpoints = data.extensions.breakpoints || {});
  bp.containerMaxWidth = aggregate.containerMaxWidth;
  bp.probeWidth = aggregate.probeWidth;
  bp.shellMaxWidth = aggregate.shellMaxWidth === null ? null : `${aggregate.shellMaxWidth}px`;
  bp.caps = aggregate.caps.map(({ kind, px, via, selector, pages }) => ({ kind, px, via, selector, pages }));
  bp.modules = aggregate.modules;
  bp.capRegister = aggregate.register;
  bp.capProvenance = provenance;
  const m = text.match(/^[{[]\r?\n([ \t]+)/);
  return `${JSON.stringify(data, null, m ? m[1] : 2)}${text.endsWith('\n') ? '\n' : ''}`;
}

async function main(argv) {
  const o = parseArgs(argv);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) { throw Object.assign(new Error(`playwright is not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`), { code: 1 }); }
  const session = await loadLiveSession();
  const provenance = { writtenBy: 'skills/replica/scripts/cap-probe.mjs', writtenAt: new Date().toISOString(), baseWidth: o.width };
  const browser = o.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch({ headless: true });
  let result; let code = 0;
  try {
    if (o.against) {
      const design = readDesignSizing(o.design);
      if (o.design && !design) console.error(`cap-probe: --design ${o.design} not found — deriving the probe width from the live side`);
      const pinned = o.probeWidth || (design && design.probeWidth) || null;
      const live = await openAndProbe(browser, o.urls[0], o, session, { rootSel: o.main, probeWidth: pinned });
      const build = await openAndProbe(browser, o.against, o, session, { rootSel: o.buildMain, probeWidth: live.probeWidth });
      const compare = compareCaps(live, build, o.tolerance);
      const probeNote = o.probeWidth ? 'pinned by --probe-width' : (design && design.probeWidth ? `from ${o.design}` : live.probeNote);
      result = { _provenance: { ...provenance, urls: [o.urls[0], o.against], probeWidth: live.probeWidth, probeNote, tolerance: o.tolerance }, urls: [o.urls[0], o.against], probeNote, live, build, compare };
      if (design && design.containerMaxWidth !== null && live.contentMaxWidth !== null && Math.abs(design.containerMaxWidth - live.contentMaxWidth) > o.tolerance) console.error(`cap-probe: DESIGN.json containerMaxWidth ${design.containerMaxWidth}px differs from the live content cap ${live.contentMaxWidth}px — re-run capture with --write-design`);
      if (o.slug) {
        const dir = `stardust/replica/gates/${o.slug}-${live.probeWidth}`;
        mkdirSync(dir, { recursive: true });
        result.evidence = `${dir}/cap-${o.label}.json`;
        writeFileSync(result.evidence, JSON.stringify(result, null, 2));
        writeFileSync(`${dir}/cap-${o.label}.txt`, `${formatCompare(result)}\n`);
      }
      code = compare.pass ? 0 : 2;
    } else {
      const pages = {}; const failed = [];
      for (const url of o.urls) {
        try { pages[url] = await openAndProbe(browser, url, o, session, { rootSel: o.main, probeWidth: o.probeWidth }); } catch (e) {
          if (e.name === 'BotChallengeError') { e.code = 3; throw e; }
          const msg = String(e.message || e).split('\n')[0]; failed.push({ url, error: msg }); console.error(`cap-probe: ${url} failed to load — ${msg}`);
        }
      }
      const aggregate = Object.keys(pages).length ? aggregateCaps(pages, o.tolerance) : null;
      result = { _provenance: { ...provenance, urls: o.urls, failed, pinned: o.probeWidth }, pages, aggregate };
      if (o.writeDesign && aggregate) {
        const text = existsSync(o.writeDesign) ? readFileSync(o.writeDesign, 'utf8') : '{}\n';
        mkdirSync(dirname(resolvePath(o.writeDesign)), { recursive: true });
        writeFileSync(o.writeDesign, mergeDesign(text, aggregate, { ...provenance, urls: Object.keys(pages) }));
        console.error(`cap-probe: ${o.writeDesign} extensions.breakpoints ← containerMaxWidth ${aggregate.containerMaxWidth}, probeWidth ${aggregate.probeWidth}, ${aggregate.caps.length} caps, ${aggregate.modules.length} modules`);
      }
      code = failed.length ? 1 : 0;
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (o.out) { mkdirSync(dirname(resolvePath(o.out)), { recursive: true }); writeFileSync(o.out, JSON.stringify(result, null, 2)); }
  console.log(o.json ? JSON.stringify(result, null, 2) : (o.against ? formatCompare(result) : formatCapture(result)));
  return code;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    const blocked = e.name === 'BotChallengeError';
    console.error(`cap-probe: ${blocked ? 'BLOCKED (bot challenge on the live side — escalate --headed) — ' : ''}${e.message}`);
    process.exitCode = blocked ? 3 : (e.code || 1);
  });
}
