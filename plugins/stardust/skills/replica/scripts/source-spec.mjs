#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, object-property-newline, no-undef */
/**
 * skills/replica/scripts/source-spec.mjs — the source's geometry, measured BEFORE authoring.
 *
 * `capture` reads the live page once per gate width: every top-level band (y, height, background, padding) and
 * every visible text node and image box (box, font, colour, rendered line count) in the content root, the header
 * and the footer, plus the page's tokens (font stacks, text-style clusters, colours, container gutters).
 * `compare` measures the served prototype the same way — a local check, no live navigation — pairs it with the
 * stored spec and prints the vertical-offset chain (which section's own height differs first, which are only
 * displaced), then the nodes that are off. `view` queries the stored spec so nobody reads the JSON.
 *
 * `--help` prints the full usage (HELP below). The in-page reader (collectInPage) is ONE function for both sides,
 * so the instrument is symmetric; pairing, tables, tolerance and clustering are pure exports (the test runs them
 * without a browser). Browser work goes through ../../diff/scripts/measure-live.mjs (the shared live session:
 * pacing, overlay handling, challenge detection), resolved in the plugin tree and in the project copy.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXT_CAP = 1500; // text + control nodes kept per width
export const IMAGE_CAP = 600; // image boxes kept per width
export const TEXT_MAX = 80; // characters of a node's text kept
export const DEFAULT_TOL = 2;
// The bound on the SUM of the offset steps: the gate's own prototype bound (pixel-compare OFFSETS.px). Each section
// is held to --tol; a long page whose sections are each within it may still add up to a few px, which the gate accepts.
export const TOTAL_OFFSET_MAX = 8;
export const DEFAULT_OUT = 'stardust/replica/spec';
const VIEW_MAX = 60;
const NODE_ROWS = 12; // off-node rows printed per section by compare (the rest are in --json)

export const HELP = `source-spec — measure the source before authoring, compare the build against it before gating

Usage:
  node source-spec.mjs capture <live-url> --slug <s> [--widths 1440,360[,<wide>]] [options]
      ONE settled visit per width through the shared live session. Per width: writes <out>/<slug>-<width>.json
      and prints one screen (page height, section table, text-style clusters, fonts, colours, gutters).
    --slug <s>          file stem (required)
    --widths <px,…>     viewport widths (default 1440,360)
    --main <sel>        content root (default main; falls back to [role=main], then body — said in the brief)
    --consent <sel> / --dismiss <sel,…> / --no-dismiss   overlay handling, as gate.sh and stitch-shot spell it
    --locale <tag>      pin Accept-Language + locale (default en-US)
    --headed            headed stealth real Chrome (escalation after an exit 3)
    --no-chrome         skip the header and footer inventory (default: chrome-parity --live-only per width, written as
                        <out>/<slug>-<width>-chrome.json and as the gate's live cache stardust/replica/gates/<slug>-<width>/chrome-live.json)
    --out <dir>         default ${DEFAULT_OUT}

  node source-spec.mjs compare <spec.json> <build-url> [--main <sel>] [--tol ${DEFAULT_TOL}] [--json <file>]
      Opens ONLY the build URL at the spec's width, measures it the same way and pairs it with the spec:
      sections by first text then order; nodes by text (exact, prefix, then order between paired neighbours,
      same tag and role); images by file name then order. Prints, top-down:
        the section table  i | live y,h | build y,h | Δy | Δh | cum (offset at the section's bottom edge)
          ◄ FIRST CAUSE = the first section whose OWN height (or the gap above it) differs — fix it first;
          "displaced" = moved only by a cause above it; a missing / extra section is a cause;
        per section, the nodes over tolerance: text | Δx Δy Δw Δh (Δy relative to the section top) | font
          deltas | lines live→build (a changed line count is the usual cause of a Δh); nodes moved only
          by an off node above them in the section are counted, not listed;
        missing nodes (in the spec, not on the build) and extra nodes (on the build, not in the spec);
        the verdict line: source-spec: N section(s) with a height delta, total offset Xpx, M node(s) off,
          K missing, J extra      (total offset = the sum of the |steps|, bounded at ${TOTAL_OFFSET_MAX} px as
          pixel-compare --offset-max prototype bounds it; each section's own step at --tol)
    --main <sel>        content root on the build (default: the one the spec was captured with)
    --tol <px>          tolerance for boxes and offsets (default ${DEFAULT_TOL}); font size / line-height use 0.5
    --json <file>       also write the full comparison (every pair, every delta)

  node source-spec.mjs view <spec.json> [--section <i>] [--kind text|image|control] [--grep <re>] [--tsv] [--max ${VIEW_MAX}]
      No flag: the brief again. With a filter: the matching nodes, one line each (--tsv: every field, uncapped
      cells, tab-separated — the form that feeds a command).

Spec JSON: { _provenance, page: { url, width, viewport, docHeight, scrollWidth, root, rootFallback,
  rootWrapsChrome, tier }, sections: [{ i, region: header|main|footer, y, h, background, paddingTop,
  paddingBottom, selectorHint, firstText }], nodes: [{ section, region, kind: text|image|control, tag, role
  (h1…h6 | link | button), text, x, y, w, h, fontFamily, fontSize, lineHeight, fontWeight, letterSpacing,
  textTransform, textAlign, color, lines, href, scroll } | { …, kind: image, fit, natural: [w, h], src, bg,
  shape: { pos, r, clip, mask, by } }]  (scroll = "sticky <top>" | "fixed <top>" when the node holds its place
  while the page scrolls; shape = the image's object-position and what cuts it; page.records names both, and
  compare checks them only against a spec that recorded them),
  tokens: { fonts, loadedFaces, textStyles, colours, container: { left, right, content, leftCommon } },
  truncated: { text, image } }. Coordinates are document px at scroll 0 after the settle. At most ${TEXT_CAP}
  text/control nodes and ${IMAGE_CAP} image boxes are kept per width (the brief says when more were dropped).
  Not read: closed shadow roots, canvas content, cross-origin iframe content, anything an ancestor's overflow
  clips (off-screen carousel slides), position:fixed children of the content root.

Writes: capture — <out>/<slug>-<width>.json per width. compare — nothing, unless --json <file>. view — nothing.
Exit codes: 0 captured / within tolerance and nothing missing / printed; 2 compare found a delta or a missing
  node; 3 bot challenge (capture — nothing is written as measured; escalate --headed); 1 error; 125 usage.
Requires playwright in the project and the diff + master skills' scripts beside this one (replica § Setup).`;

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) { console.log(HELP); process.exit(0); }

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 125; } }

// ---- arguments (pure) ------------------------------------------------------------------------------------------

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError('need a subcommand: capture | compare | view (see --help)');
  if (!['capture', 'compare', 'view'].includes(cmd)) throw new UsageError(`unknown subcommand "${cmd}" — capture | compare | view`);
  const o = { cmd, pos: [], slug: null, widths: [], main: null, consent: null, dismiss: [], noDismiss: false, locale: null, headed: false, noChrome: false, out: DEFAULT_OUT, tol: DEFAULT_TOL, json: null, section: null, kind: null, grep: null, tsv: false, max: VIEW_MAX };
  const flags = {
    capture: { '--slug': 'slug', '--widths': 'widths', '--main': 'main', '--consent': 'consent', '--dismiss': 'dismiss', '--locale': 'locale', '--out': 'out' },
    compare: { '--main': 'main', '--tol': 'tol', '--json': 'json' },
    view: { '--section': 'section', '--kind': 'kind', '--grep': 'grep', '--max': 'max' },
  }[cmd];
  const bools = { capture: { '--no-dismiss': 'noDismiss', '--headed': 'headed', '--no-chrome': 'noChrome' }, compare: {}, view: { '--tsv': 'tsv' } }[cmd];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (bools[a]) { o[bools[a]] = true; continue; }
    if (flags[a]) {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`);
      const v = rest[i += 1]; const k = flags[a];
      if (k === 'widths') o.widths.push(...splitList(v).map(Number));
      else if (k === 'dismiss') o.dismiss.push(...splitList(v));
      else if (k === 'tol' || k === 'section' || k === 'max') o[k] = Number(v);
      else o[k] = v;
      continue;
    }
    if (a.startsWith('--')) throw new UsageError(`unknown flag ${a} for ${cmd} (see --help)`);
    o.pos.push(a);
  }
  const want = { capture: 1, compare: 2, view: 1 }[cmd];
  const names = { capture: '<live-url>', compare: '<spec.json> <build-url>', view: '<spec.json>' }[cmd];
  if (o.pos.length !== want) throw new UsageError(`${cmd} takes ${names}, got ${o.pos.length} argument(s)`);
  if (cmd === 'capture') {
    if (!o.slug) throw new UsageError('capture needs --slug <s>');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.slug)) throw new UsageError(`--slug "${o.slug}" must be a file stem (letters, digits, . _ -)`);
    if (!o.widths.length) o.widths = [1440, 360];
    if (o.widths.some((w) => !Number.isInteger(w) || w <= 0)) throw new UsageError(`--widths must be positive integers, got ${o.widths.join(',')}`);
    o.widths = [...new Set(o.widths)];
    if (!/^https?:\/\//.test(o.pos[0])) throw new UsageError(`capture needs an http(s) URL, got "${o.pos[0]}"`);
  }
  if (cmd === 'compare') {
    if (!Number.isFinite(o.tol) || o.tol < 0) throw new UsageError('--tol must be a number ≥ 0');
    if (!/^(https?|file):\/\//.test(o.pos[1])) throw new UsageError(`compare needs the build URL second, got "${o.pos[1]}"`);
  }
  if (cmd === 'view') {
    if (o.section !== null && !Number.isInteger(o.section)) throw new UsageError('--section needs a section index (the i column)');
    if (o.kind && !['text', 'image', 'control'].includes(o.kind)) throw new UsageError(`--kind is text | image | control, got "${o.kind}"`);
    if (o.grep) { try { RegExp(o.grep, 'i'); } catch (e) { throw new UsageError(`--grep: ${e.message}`); } }
    if (!Number.isInteger(o.max) || o.max <= 0) throw new UsageError('--max must be a positive integer');
  }
  return o;
}

// ---- the in-page reader (serialised by playwright: self-contained, ONE argument object) -----------------------

export function collectInPage({ main, textCap, imageCap, textMax }) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const de = document.documentElement;
  const vw = de.clientWidth;
  const sx = window.scrollX; const sy = window.scrollY;
  const docW = Math.max(de.scrollWidth, vw);
  const boxOf = (r) => ({ x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) });
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  // What the rest geometry cannot show. `scroll`: the node sits in a sticky / fixed box (its own or an ancestor's) —
  // it holds one place while the page scrolls, so a stitched capture shows it elsewhere than a static copy of it.
  const scrollMemo = new Map();
  const scrollOf = (el) => {
    if (!el || el === document.body || el === de) return null;
    if (scrollMemo.has(el)) return scrollMemo.get(el);
    const cs = getComputedStyle(el);
    const v = cs.position === 'sticky' || cs.position === 'fixed' ? `${cs.position} ${cs.top === 'auto' ? 'auto' : Math.round(parseFloat(cs.top))}` : scrollOf(el.parentElement || (el.getRootNode() && el.getRootNode().host));
    scrollMemo.set(el, v);
    return v;
  };
  // `shape` of an image: where it is anchored in its box and what cuts it — its own radius / clip-path / mask, else
  // those of the nearest ancestor (up to 4) that clips it. Two boxes of one size can still draw two pictures.
  const cutOf = (cs) => ({ r: /[1-9]/.test(cs.borderRadius) ? cs.borderRadius : null, clip: cs.clipPath && cs.clipPath !== 'none' ? cs.clipPath : null, mask: [cs.maskImage, cs.webkitMaskImage].some((m) => m && m !== 'none') });
  const shapeOf = (el, cs) => {
    let c = cutOf(cs); let by = null;
    for (let a = el.parentElement, i = 0; !(c.r || c.clip || c.mask) && a && a !== document.body && i < 4; a = a.parentElement, i += 1) {
      const as = getComputedStyle(a); const k = cutOf(as);
      if ((k.clip || k.mask) || (k.r && /hidden|clip/.test(`${as.overflowX} ${as.overflowY}`))) { c = k; const q = a.getBoundingClientRect(); by = [Math.round(q.width), Math.round(q.height)]; }
    }
    return { pos: cs.objectPosition || null, ...(c.r ? { r: c.r } : {}), ...(c.clip ? { clip: c.clip } : {}), ...(c.mask ? { mask: true } : {}), ...(by ? { by } : {}) };
  };
  const SKIP = /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|BR|HEAD|TITLE|BASE|WBR)$/;
  const fileOf = (src) => { const s = String(src || ''); if (!s) return ''; if (/^data:/i.test(s)) return `${s.split(/[;,]/)[0]}…`; const p = s.split(/[?#]/)[0].replace(/\/+$/, ''); return p.slice(p.lastIndexOf('/') + 1); };

  // visibility: own box, own visibility, the opacity chain, and every clipping ancestor (overflow ≠ visible)
  const opacity = new Map();
  const chainOpacity = (el) => {
    if (!el || el === de) return 1;
    if (opacity.has(el)) return opacity.get(el);
    const own = parseFloat(getComputedStyle(el).opacity);
    const v = (Number.isNaN(own) ? 1 : own) * chainOpacity(el.parentElement || (el.getRootNode() && el.getRootNode().host));
    opacity.set(el, v); return v;
  };
  const clips = new Map();
  const clipFor = (el) => {
    const p = el.parentElement || (el.getRootNode() && el.getRootNode().host);
    if (!p || p === de || p === document.body) return null;
    if (clips.has(p)) return clips.get(p);
    let c = clipFor(p);
    const cs = getComputedStyle(p);
    const cx = cs.overflowX !== 'visible'; const cy = cs.overflowY !== 'visible';
    if (cx || cy) {
      const r = p.getBoundingClientRect();
      const b = { l: cx ? r.left : -Infinity, r: cx ? r.right : Infinity, t: cy ? r.top : -Infinity, b: cy ? r.bottom : Infinity };
      c = c ? { l: Math.max(c.l, b.l), r: Math.min(c.r, b.r), t: Math.max(c.t, b.t), b: Math.min(c.b, b.b) } : b;
    }
    clips.set(p, c); return c;
  };
  const shown = (el, cs, r) => {
    if (r.width < 2 || r.height < 2 || cs.visibility !== 'visible') return false;
    if (r.right + sx <= 0 || r.left + sx >= docW) return false;
    if (chainOpacity(el) <= 0.05) return false;
    const c = clipFor(el);
    return !c || (Math.min(r.right, c.r) - Math.max(r.left, c.l) >= 1 && Math.min(r.bottom, c.b) - Math.max(r.top, c.t) >= 1);
  };

  // content root and regions
  let matched = null; let rootError = null;
  try { matched = main ? document.querySelector(main) : null; } catch (e) { rootError = e.message; }
  const fallback = matched ? null : (document.querySelector('main, [role="main"]') || document.body);
  const root = matched || fallback;
  const rootName = matched ? main : (fallback === document.body ? 'body' : 'main, [role="main"]');
  const isHeader = (el) => el.tagName === 'HEADER' || el.getAttribute('role') === 'banner';
  const isFooter = (el) => el.tagName === 'FOOTER' || el.getAttribute('role') === 'contentinfo';
  const hasBox = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; };
  const bandKids = (host) => [...host.children].flatMap((c) => {
    if (SKIP.test(c.tagName)) return [];
    const cs = getComputedStyle(c);
    if (cs.display === 'contents') return bandKids(c);
    return cs.position !== 'fixed' && hasBox(c) ? [c] : [];
  });
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
  // a lone wrapper is not a band: descend while the root has ONE painting child that is neither a section, nor text, nor media
  let bands = bandKids(root);
  for (let d = 0; d < 6 && bands.length === 1; d += 1) {
    const only = bands[0];
    if (only.tagName === 'SECTION' || only.classList.contains('section') || ownText(only) || /^(IMG|PICTURE|VIDEO|IFRAME|CANVAS|svg)$/i.test(only.tagName)) break;
    const inner = bandKids(only);
    if (!inner.length) break;
    bands = inner;
  }
  if (!bands.length) bands = [root];
  const outside = (el) => !root.contains(el) && !el.contains(root) && hasBox(el);
  const headerEl = [...document.querySelectorAll('header, [role="banner"]')].find(outside) || null;
  const footerEl = [...document.querySelectorAll('footer, [role="contentinfo"]')].reverse().find(outside) || null;
  const secEls = [...(headerEl ? [headerEl] : []), ...bands, ...(footerEl ? [footerEl] : [])];
  const secSet = new Set(secEls);
  const regionOf = (el) => (el === headerEl || isHeader(el) ? 'header' : (el === footerEl || isFooter(el) ? 'footer' : 'main'));

  const paint = (cs) => {
    const parts = [];
    if (!/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(cs.backgroundColor)) parts.push(cs.backgroundColor);
    if (cs.backgroundImage !== 'none') { const m = cs.backgroundImage.match(/url\((["']?)([^"')]*)\1\)/); parts.push(m ? `image(${fileOf(m[2])})` : 'gradient'); }
    return parts.join(' + ');
  };
  // a band's background is often on a full-size inner wrapper: follow a covering only-child up to three levels
  const bandPaint = (el) => {
    let e = el;
    for (let d = 0; d < 4 && e; d += 1) {
      const p = paint(getComputedStyle(e)); if (p) return p;
      const kids = [...e.children].filter(hasBox); if (kids.length !== 1) break;
      const a = e.getBoundingClientRect(); const b = kids[0].getBoundingClientRect();
      if (b.width * b.height < 0.95 * a.width * a.height) break;
      [e] = kids;
    }
    return 'none';
  };
  const hint = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('')}`;

  // text of an element as one node: its own text plus its inline descendants' (block children are their own nodes)
  const inlineText = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.data;
      else if (n.nodeType === 1) { if (n.tagName === 'BR') s += ' '; else if (!SKIP.test(n.tagName) && /^inline/.test(getComputedStyle(n).display)) s += inlineText(n); else s += ' '; }
    }
    return s;
  };
  const isControl = (el) => el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
  // an element with no text of its own whose children are all inline text runs (a heading split into spans) is ONE text
  const inlineOnly = (el) => el.children.length > 0 && !el.querySelector('a, button, img, svg, picture, video, canvas, iframe, input, select, textarea')
    && [...el.children].every((c) => c.tagName === 'BR' || (/^inline/.test(getComputedStyle(c).display) && !SKIP.test(c.tagName))) && norm(el.textContent).length > 0;
  const firstTextEl = (el) => { if (ownText(el)) return el; for (const c of el.children) { const f = firstTextEl(c); if (f) return f; } return null; };
  const lineCount = (el) => {
    const rects = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.data.trim()) continue; range.selectNodeContents(n); for (const q of range.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push(q); }
    rects.sort((a, b) => a.top - b.top);
    let lines = 0; let bottom = -Infinity;
    for (const q of rects) { if ((q.top + q.bottom) / 2 > bottom) { lines += 1; bottom = q.bottom; } }
    return lines;
  };
  const roleOf = (el) => {
    const h = el.closest('h1, h2, h3, h4, h5, h6'); if (h) return h.tagName.toLowerCase();
    const c = el.closest('a[href], button, [role="button"]'); if (!c) return null;
    return c.tagName === 'A' ? 'link' : 'button';
  };

  const nodes = []; const stacks = {}; const promoted = new Set();
  let texts = 0; let images = 0; const dropped = { text: 0, image: 0 };
  const pushText = (el, cs, si, region) => {
    let boxEl = el; let kind = isControl(el) ? 'control' : 'text';
    const text = norm(inlineText(el));
    if (!text) return;
    const ctl = el.closest('a, button, [role="button"]');
    if (ctl && ctl !== el && norm(ctl.textContent) === text) { if (promoted.has(ctl)) return; promoted.add(ctl); boxEl = ctl; kind = 'control'; }
    const r = boxEl.getBoundingClientRect();
    if (!shown(boxEl, getComputedStyle(boxEl), r)) return;
    if (texts >= textCap) { dropped.text += 1; return; }
    texts += 1;
    const fe = ownText(el) ? el : (firstTextEl(el) || el); const fs = fe === el ? cs : getComputedStyle(fe);
    stacks[fs.fontFamily] = (stacks[fs.fontFamily] || 0) + 1;
    const a = el.closest('a[href]');
    nodes.push({
      section: si, region, kind, tag: boxEl.tagName.toLowerCase(), role: roleOf(el), text: cut(text, textMax), ...boxOf(r),
      fontFamily: fs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), fontSize: num(fs.fontSize), lineHeight: fs.lineHeight === 'normal' ? 'normal' : num(fs.lineHeight),
      fontWeight: fs.fontWeight, letterSpacing: fs.letterSpacing === 'normal' ? 0 : num(fs.letterSpacing), textTransform: fs.textTransform, textAlign: fs.textAlign, color: fs.color,
      lines: lineCount(boxEl), ...(a ? { href: a.getAttribute('href') } : {}), ...(scrollOf(boxEl) ? { scroll: scrollOf(boxEl) } : {}),
    });
  };
  const pushImage = (el, cs, si, region, bg) => {
    const r = el.getBoundingClientRect();
    if (!shown(el, cs, r)) return;
    if (bg && (r.width < 24 || r.height < 16)) return;
    if (images >= imageCap) { dropped.image += 1; return; }
    images += 1;
    const tag = el.tagName.toLowerCase();
    const n = { section: si, region, kind: 'image', tag: tag === 'img' && el.parentElement && el.parentElement.tagName === 'PICTURE' ? 'picture' : tag, role: roleOf(el), text: cut(norm(el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || ''), textMax), ...boxOf(r) };
    if (bg) { const m = cs.backgroundImage.match(/url\((["']?)([^"')]*)\1\)/); Object.assign(n, { bg: true, fit: cs.backgroundSize, src: m ? cut(m[2], 200) : '' }); }
    else {
      n.fit = cs.objectFit; n.shape = shapeOf(el, cs);
      if (tag === 'img') { n.natural = [el.naturalWidth, el.naturalHeight]; n.src = cut(el.currentSrc || el.getAttribute('src') || '', 200); }
      else if (tag === 'video') { n.natural = [el.videoWidth, el.videoHeight]; n.src = cut(el.currentSrc || el.getAttribute('src') || el.getAttribute('poster') || '', 200); }
      else if (tag === 'iframe') n.src = cut(el.getAttribute('src') || '', 200);
    }
    const a = el.closest('a[href]'); if (a) n.href = a.getAttribute('href');
    if (scrollOf(el)) n.scroll = scrollOf(el);
    nodes.push(n);
  };
  const pushField = (el, cs, si, region) => {
    if (el.type === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (!shown(el, cs, r)) return;
    if (texts >= textCap) { dropped.text += 1; return; }
    texts += 1;
    nodes.push({ section: si, region, kind: 'control', tag: el.tagName.toLowerCase(), role: 'field', text: cut(norm(el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.tagName === 'SELECT' ? (el.selectedOptions[0] || {}).textContent : el.value) || el.getAttribute('name') || ''), textMax), ...boxOf(r),
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), fontSize: num(cs.fontSize), lineHeight: cs.lineHeight === 'normal' ? 'normal' : num(cs.lineHeight), fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing), textTransform: cs.textTransform, textAlign: cs.textAlign, color: cs.color, lines: 1 });
  };
  const walk = (el, si, region, textAncestor) => {
    if (SKIP.test(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const tag = el.tagName.toLowerCase();
    if (/^(img|video|iframe|canvas|svg|object|embed)$/.test(tag)) { pushImage(el, cs, si, region, false); return; }
    if (/^(input|select|textarea)$/.test(tag)) { pushField(el, cs, si, region); return; }
    if (!secSet.has(el) && /url\(/.test(cs.backgroundImage)) pushImage(el, cs, si, region, true);
    let ta = textAncestor;
    if (ownText(el) || (!textAncestor && inlineOnly(el))) {
      // an inline run inside a text block is part of that block's text; an inline control keeps its own row
      if (!(textAncestor && /^inline/.test(cs.display) && !isControl(el))) pushText(el, cs, si, region);
      if (!ta) ta = el;
    }
    for (const c of el.children) walk(c, si, region, ta);
    if (el.shadowRoot) for (const c of el.shadowRoot.children) walk(c, si, region, ta);
  };

  const sections = secEls.map((el, i) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const region = regionOf(el);
    const from = nodes.length;
    walk(el, i, region, null);
    const first = nodes.slice(from).find((n) => n.kind !== 'image' && n.text);
    return { i, region, y: Math.round(r.top + sy), h: Math.round(r.height), background: bandPaint(el), paddingTop: num(cs.paddingTop), paddingBottom: num(cs.paddingBottom), selectorHint: hint(el), firstText: first ? cut(first.text, 60) : '' };
  });
  return {
    page: {
      url: location.href, width: window.innerWidth, viewport: vw, docHeight: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0), scrollWidth: de.scrollWidth,
      root: rootName, rootFallback: !matched, ...(rootError ? { rootError } : {}), records: ['scroll', 'shape'],
      rootWrapsChrome: !!(root !== document.body && root.querySelector('header, footer') && [...root.querySelectorAll('header, footer')].some((e) => secSet.has(e))),
    },
    sections, nodes, stacks,
    loadedFaces: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.style}`))].slice(0, 40),
    truncated: dropped,
  };
}

// ---- tokens (pure) ---------------------------------------------------------------------------------------------

const counted = (map) => Object.entries(map).map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || (a.value < b.value ? -1 : 1));
const isText = (n) => n.kind === 'text' || n.kind === 'control';

/** Distinct text styles (size / line-height / weight / family [+ transform]) with their usage counts, most used first. */
export function clusterStyles(nodes) {
  const by = new Map();
  for (const n of nodes) {
    if (!isText(n) || n.fontSize == null) continue;
    const key = `${n.fontSize}/${n.lineHeight} ${n.fontWeight} ${n.fontFamily}${n.textTransform && n.textTransform !== 'none' ? ` ${n.textTransform}` : ''}`;
    const c = by.get(key) || { key, fontSize: n.fontSize, lineHeight: n.lineHeight, fontWeight: n.fontWeight, fontFamily: n.fontFamily, textTransform: n.textTransform || 'none', n: 0, roles: {}, sample: n.text };
    c.n += 1; const r = n.role || n.tag; c.roles[r] = (c.roles[r] || 0) + 1;
    by.set(key, c);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.fontSize - a.fontSize);
}

/** The container the text sits in: the left and right gutters of the main-region text, and the width between them. */
export function containerOf(nodes, viewport) {
  const t = nodes.filter((n) => isText(n) && n.region === 'main' && n.x >= 0 && n.x + n.w <= viewport + 1);
  if (!t.length) return { left: null, right: null, content: null, leftCommon: null };
  const left = Math.min(...t.map((n) => n.x)); const right = Math.max(0, viewport - Math.max(...t.map((n) => n.x + n.w)));
  const xs = {}; for (const n of t) xs[n.x] = (xs[n.x] || 0) + 1;
  const [cx, cn] = Object.entries(xs).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { left, right, content: viewport - left - right, leftCommon: { x: Number(cx), n: cn } };
}

export function tokensOf(nodes, { viewport, stacks = {}, loadedFaces = [] } = {}) {
  const colours = {};
  for (const n of nodes) if (isText(n) && n.color) colours[n.color] = (colours[n.color] || 0) + 1;
  return { fonts: counted(stacks).map(({ value, n }) => ({ stack: value, n })), loadedFaces, textStyles: clusterStyles(nodes), colours: counted(colours).map(({ value, n }) => ({ color: value, n })), container: containerOf(nodes, viewport) };
}

/** The reader's raw output → the stored spec. */
export function buildSpec(raw, provenance = {}) {
  const { page, sections, nodes, stacks, loadedFaces, truncated } = raw;
  return { _provenance: { writtenBy: 'skills/replica/scripts/source-spec.mjs', ...provenance }, page, sections, nodes, tokens: tokensOf(nodes, { viewport: page.viewport, stacks, loadedFaces }), truncated };
}

// one node per line: the file stays greppable and `view` stays the way to read it
export function serialiseSpec(spec) {
  const { sections, nodes, ...rest } = spec;
  const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
  const rows = (a) => (a.length ? `[\n${a.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]` : '[]');
  return `${head},\n "sections": ${rows(sections)},\n "nodes": ${rows(nodes)}\n}\n`;
}

// ---- pairing (pure) --------------------------------------------------------------------------------------------

export const normText = (s) => String(s || '').toLowerCase().replace(/…$/, '').replace(/\s+/g, ' ').trim();
const fileKey = (src) => { const s = String(src || ''); if (!s || /^data:/i.test(s)) return ''; const p = s.split(/[?#]/)[0].replace(/\/+$/, ''); return p.slice(p.lastIndexOf('/') + 1).toLowerCase(); };
const PREFIX_MIN = 8;
const prefixMatch = (a, b) => {
  if (!a || !b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= PREFIX_MIN && l.startsWith(s)) return true;
  let i = 0; while (i < s.length && s[i] === l[i]) i += 1;
  return i >= 20;
};

/**
 * Pair two reading-order lists. Pass 1: equal keys, the k-th occurrence with the k-th (duplicates stay in order).
 * Pass 2: prefix (one key starts the other, or 20 shared leading characters). Pass 3: order — an unpaired A item
 * takes the first unpaired B item of the same class that lies between its paired neighbours' partners.
 * → { pairs: [{ a, b, how }], missing: [a…], extra: [b…] } (indices; pairs in A order).
 */
export function pairList(A, B, { keyOf, classOf, prefix = true }) {
  const pa = new Array(A.length).fill(-1); const pb = new Array(B.length).fill(-1); const how = new Array(A.length).fill(null);
  const link = (i, j, h) => { pa[i] = j; pb[j] = i; how[i] = h; };
  const byKey = new Map();
  B.forEach((b, j) => { const k = keyOf(b); if (!k) return; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(j); });
  A.forEach((a, i) => { const q = byKey.get(keyOf(a)); if (keyOf(a) && q && q.length) link(i, q.shift(), 'exact'); });
  if (prefix) {
    A.forEach((a, i) => {
      if (pa[i] >= 0) return;
      const k = keyOf(a);
      const j = B.findIndex((b, jj) => pb[jj] < 0 && classOf(b) === classOf(a) && prefixMatch(k, keyOf(b)));
      if (j >= 0) link(i, j, 'prefix');
    });
  }
  A.forEach((a, i) => {
    if (pa[i] >= 0) return;
    let lo = -1; for (let p = i - 1; p >= 0; p -= 1) if (pa[p] >= 0) { lo = pa[p]; break; }
    let hi = B.length; for (let p = i + 1; p < A.length; p += 1) if (pa[p] >= 0 && pa[p] > lo) { hi = pa[p]; break; }
    for (let j = lo + 1; j < hi; j += 1) if (pb[j] < 0 && classOf(B[j]) === classOf(a)) { link(i, j, 'order'); break; }
  });
  return {
    pairs: pa.map((j, i) => (j >= 0 ? { a: i, b: j, how: how[i] } : null)).filter(Boolean),
    missing: pa.map((j, i) => (j < 0 ? i : -1)).filter((i) => i >= 0),
    extra: pb.map((i, j) => (i < 0 ? j : -1)).filter((j) => j >= 0),
  };
}

/** Sections: by region + first text, then by order within the region. */
export function pairSections(live, build) {
  return pairList(live, build, { keyOf: (s) => (s.firstText ? `${s.region}|${normText(s.firstText).slice(0, 40)}` : ''), classOf: (s) => s.region });
}

/** One section's nodes: text and controls by text (same tag + role for the order pass), images by file name then order. */
export function pairNodes(live, build) {
  const lt = live.filter(isText); const bt = build.filter(isText);
  const li = live.filter((n) => n.kind === 'image'); const bi = build.filter((n) => n.kind === 'image');
  const t = pairList(lt, bt, { keyOf: (n) => normText(n.text), classOf: (n) => `${n.kind}|${n.tag}|${n.role || ''}` });
  const im = pairList(li, bi, { keyOf: (n) => fileKey(n.src), classOf: (n) => (n.bg ? 'bg' : 'image'), prefix: false });
  return {
    pairs: [...t.pairs.map((p) => ({ live: lt[p.a], build: bt[p.b], how: p.how })), ...im.pairs.map((p) => ({ live: li[p.a], build: bi[p.b], how: p.how }))],
    missing: [...t.missing.map((i) => lt[i]), ...im.missing.map((i) => li[i])],
    extra: [...t.extra.map((j) => bt[j]), ...im.extra.map((j) => bi[j])],
  };
}

// ---- deltas, the offset chain, the verdict (pure) --------------------------------------------------------------

const FONT_TOL = 0.5;
const numDiff = (a, b, tol) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > tol : a !== b);

/** One pair → box deltas (Δy relative to each side's section top), font deltas, line counts, and whether it is off. */
const pxList = (v) => String(v || '').match(/-?\d+(?:\.\d+)?(?:px|%)?/g) || [];
/** Two radius / position strings are the same when their numbers agree within 1 (same units, same count). */
export function sameLengths(a, b, tol = 1) {
  const [x, y] = [pxList(a), pxList(b)];
  return x.length === y.length && x.every((v, i) => v.replace(/[-\d.]/g, '') === y[i].replace(/[-\d.]/g, '') && Math.abs(parseFloat(v) - parseFloat(y[i])) <= tol);
}
/** The scroll and shape deltas of a pair, only for what the live spec recorded (`records`; an older spec has neither). */
export function scrollShapeDelta(l, b, records = [], tol = DEFAULT_TOL) {
  const out = {};
  if (records.includes('scroll')) {
    const [ls, bs] = [l.scroll || 'static', b.scroll || 'static'];
    if (ls.split(' ')[0] !== bs.split(' ')[0] || !sameLengths(ls, bs, tol)) out.scroll = [ls, bs];
  }
  if (records.includes('shape') && l.shape && b.shape) {
    const [x, y] = [l.shape, b.shape];
    if (!sameLengths(x.pos, y.pos)) out['object-position'] = [x.pos, y.pos];
    if (!sameLengths(x.r, y.r)) out.radius = [x.r || 'none', y.r || 'none'];
    if ((x.clip || 'none').replace(/\s+/g, '') !== (y.clip || 'none').replace(/\s+/g, '')) out.clip = [x.clip || 'none', y.clip || 'none'];
    if (!!x.mask !== !!y.mask) out.mask = [x.mask ? 'yes' : 'no', y.mask ? 'yes' : 'no'];
    if (x.by && y.by && (Math.abs(x.by[0] - y.by[0]) > tol || Math.abs(x.by[1] - y.by[1]) > tol)) out['clip-box'] = [x.by.join('×'), y.by.join('×')];
  }
  return out;
}
export function nodeDelta(l, b, lSec, bSec, tol = DEFAULT_TOL, subst = [], records = []) {
  const d = { dx: b.x - l.x, dy: (b.y - (bSec ? bSec.y : 0)) - (l.y - (lSec ? lSec.y : 0)), dw: b.w - l.w, dh: b.h - l.h, font: {}, lines: null };
  if (isText(l)) {
    if (numDiff(l.fontSize, b.fontSize, FONT_TOL)) d.font.size = [l.fontSize, b.fontSize];
    if (numDiff(l.lineHeight, b.lineHeight, FONT_TOL)) d.font['line-height'] = [l.lineHeight, b.lineHeight];
    if (String(l.fontWeight) !== String(b.fontWeight)) d.font.weight = [l.fontWeight, b.fontWeight];
    const [lf, bf] = [String(l.fontFamily || '').toLowerCase(), String(b.fontFamily || '').toLowerCase()];
    // a DECLARED substitution (stardust/replica/font-subst.txt): the family is not a delta, and the glyph-width
    // difference it brings is bounded (chrome-parity's rule: 6 % of the live width, at least 2 px) instead of `tol`
    d.subst = lf !== bf && subst.some((s) => s.live === lf && s.build === bf);
    if (lf !== bf && !d.subst) d.font.family = [l.fontFamily, b.fontFamily];
    if (l.color !== b.color) d.font.colour = [l.color, b.color];
    if ((l.textTransform || 'none') !== (b.textTransform || 'none')) d.font.transform = [l.textTransform, b.textTransform];
    if (numDiff(l.letterSpacing, b.letterSpacing, 0.1)) d.font['letter-spacing'] = [l.letterSpacing, b.letterSpacing];
    if (l.lines !== b.lines) d.lines = [l.lines, b.lines];
    if (normText(l.text) !== normText(b.text)) d.text = [l.text, b.text];
  } else if ((l.fit || '') !== (b.fit || '')) d.font.fit = [l.fit, b.fit];
  Object.assign(d.font, scrollShapeDelta(l, b, records, tol));
  const styleOff = Object.keys(d.font).length > 0 || !!d.lines || !!d.text;
  const wTol = d.subst ? Math.max(tol, 2, 0.06 * l.w) : tol;
  const boxOff = Math.abs(d.dx) > wTol || Math.abs(d.dw) > wTol || Math.abs(d.dh) > tol;
  d.onlyDy = !styleOff && !boxOff && Math.abs(d.dy) > tol;
  d.off = styleOff || boxOff || d.onlyDy;
  return d;
}

/**
 * The offset chain. Rows in live reading order (extra build sections slotted where they sit). Per paired row:
 * dy, dh, cum = dy + dh (the offset at its bottom edge), step = what THIS row adds to the chain (its Δh plus any
 * change in the gap above it); status ok | cause | displaced | missing | extra; first = the first cause.
 */
export function sectionTable(live, build, pairing, tol = DEFAULT_TOL) {
  const partner = new Map(pairing.pairs.map((p) => [p.a, p]));
  const extras = [...pairing.extra];
  const rows = []; let prev = null; let pending = 0;
  const flushExtras = (before) => { while (extras.length && extras[0] < before) { const b = build[extras.shift()]; rows.push({ live: null, build: b, status: 'extra', step: b.h }); pending += b.h; } };
  live.forEach((l, i) => {
    const p = partner.get(i);
    if (!p) { rows.push({ live: l, build: null, status: 'missing', step: -l.h }); pending -= l.h; return; }
    flushExtras(p.b);
    const b = build[p.b];
    const dy = b.y - l.y; const dh = b.h - l.h; const cum = dy + dh;
    // a section that overlaps the one before it on the live page (fixed / overlaid chrome) is not pushed by that one's height
    const base = prev ? (l.y < prev.live.y + prev.live.h - tol ? prev.dy : prev.cum) : 0;
    const gap = dy - base - pending;
    const notes = [];
    if (Math.abs(dh) > tol) notes.push('own height');
    if (Math.abs(gap) > tol) notes.push(`gap above ${gap > 0 ? '+' : ''}${gap}`);
    if (numDiff(l.paddingTop, b.paddingTop, FONT_TOL)) notes.push(`padding-top ${l.paddingTop}→${b.paddingTop}`);
    if (numDiff(l.paddingBottom, b.paddingBottom, FONT_TOL)) notes.push(`padding-bottom ${l.paddingBottom}→${b.paddingBottom}`);
    if ((l.background || 'none') !== (b.background || 'none')) notes.push(`bg ${l.background}→${b.background}`);
    const cause = Math.abs(dh) > tol || Math.abs(gap) > tol;
    const row = { live: l, build: b, how: p.how, dy, dh, cum, step: gap + dh, status: cause ? 'cause' : (Math.abs(dy) > tol ? 'displaced' : 'ok'), notes };
    rows.push(row); prev = row; pending = 0;
  });
  flushExtras(Infinity);
  let first = rows.find((r) => r.status !== 'ok' && r.status !== 'displaced');
  // No single row over the tolerance, but their steps add up past it (five sections each 1 px taller): the first
  // row that adds anything is the cause to start from — a failing table always names one.
  const total = rows.reduce((s, r) => s + Math.abs(r.step || 0), 0);
  if (!first && total > Math.max(tol, TOTAL_OFFSET_MAX)) { first = rows.find((r) => Math.abs(r.step || 0) > 0); first.status = 'cause'; (first.notes ||= []).push(`accumulated: steps within the ${tol}px tolerance add up to ${total}px (bound ${Math.max(tol, TOTAL_OFFSET_MAX)}px)`); }
  if (first) first.first = true;
  return rows;
}

/** The whole comparison: section rows, per-section node deltas, missing / extra, counts, the verdict line, pass. */
export function compareSpecs(live, build0, { tol = DEFAULT_TOL, subst = [] } = {}) {
  // A region the source spec does not have (its header is not a <header> / banner landmark) cannot be paired: the
  // build's section of that region is left to chrome-parity, which resolves both sides — never an EXTRA to clear.
  const has = (spec, region) => spec.sections.some((s) => s.region === region);
  const skip = ['header', 'footer'].filter((r) => !has(live, r) && has(build0, r));
  const gone = new Set(build0.sections.filter((s) => skip.includes(s.region)).map((s) => s.i));
  const build = skip.length ? { ...build0, sections: build0.sections.filter((s) => !gone.has(s.i)), nodes: build0.nodes.filter((n) => !gone.has(n.section)) } : build0;
  const pairing = pairSections(live.sections, build.sections);
  const rows = sectionTable(live.sections, build.sections, pairing, tol);
  const inSec = (spec, i) => spec.nodes.filter((n) => n.section === i);
  const out = { width: live.page.width, tol, page: { live: live.page.docHeight, build: build.page.docHeight, dh: build.page.docHeight - live.page.docHeight }, sections: rows, nodes: [], missing: [], extra: [] };
  for (const r of rows) {
    if (!r.build) { out.missing.push(...inSec(live, r.live.i)); continue; }
    if (!r.live) { out.extra.push(...inSec(build, r.build.i)); continue; }
    const p = pairNodes(inSec(live, r.live.i), inSec(build, r.build.i));
    out.missing.push(...p.missing); out.extra.push(...p.extra);
    const ds = p.pairs.map((q) => ({ section: r.live.i, live: q.live, build: q.build, how: q.how, ...nodeDelta(q.live, q.build, r.live, r.build, tol, subst, (live.page && live.page.records) || []) })).sort((a, b) => a.live.y - b.live.y || a.live.x - b.live.x);
    // a node whose only delta is Δy, sitting below an off node of its section, is displaced by it — counted, not listed
    let firstOffBottom = Infinity;
    for (const d of ds) {
      d.status = !d.off ? 'ok' : (d.onlyDy && d.live.y >= firstOffBottom - tol ? 'displaced' : 'off');
      if (d.status === 'off') firstOffBottom = Math.min(firstOffBottom, d.live.y + Math.min(d.live.h, d.build.h));
    }
    out.nodes.push(...ds);
  }
  const causes = rows.filter((r) => r.status === 'cause' || r.status === 'missing' || r.status === 'extra').length;
  const totalOffset = rows.reduce((s, r) => s + Math.abs(r.step || 0), 0);
  const off = out.nodes.filter((d) => d.status === 'off').length;
  out.counts = { sections: causes, totalOffset, off, displaced: out.nodes.filter((d) => d.status === 'displaced').length, missing: out.missing.length, extra: out.extra.length, paired: out.nodes.length };
  out.verdict = `source-spec: ${causes} section(s) with a height delta, total offset ${totalOffset}px, ${off} node(s) off, ${out.missing.length} missing, ${out.extra.length} extra`;
  out.pass = causes === 0 && totalOffset <= Math.max(tol, TOTAL_OFFSET_MAX) && off === 0 && out.missing.length === 0 && out.extra.length === 0; // an extra node is a difference too
  out.liveSections = live.sections; out.buildSections = build.sections;
  if (skip.length) { out.chromeSkipped = skip; out.verdict += ` (build ${skip.join(' and ')} not compared: the source spec has none — chrome-parity gates it)`; }
  return out;
}

// ---- tables (pure) ---------------------------------------------------------------------------------------------

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const pad = (v, n) => String(v).padStart(n);
const padE = (v, n) => String(v).padEnd(n);
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const shortColour = (c) => String(c || '').replace(/\s+/g, '');
const fontOf = (n) => `${n.fontSize}/${n.lineHeight} ${n.fontWeight} ${n.fontFamily}${n.textTransform && n.textTransform !== 'none' ? ` ${n.textTransform}` : ''}`;
const who = (n) => `${n.kind === 'image' ? `[${n.tag}${n.bg ? ' bg' : ''}] ${clip(n.text || fileKey(n.src) || '', 36)}` : `"${clip(n.text, 44)}"`}`;

export function formatCompare(res, { specPath = '', buildUrl = '' } = {}) {
  const L = [];
  L.push(`source-spec compare @${res.width}  ${specPath} ⇄ ${buildUrl}  (tol ${res.tol}px)`);
  L.push(`page height  live ${res.page.live}  build ${res.page.build}  Δ ${signed(res.page.dh)}`);
  L.push('  i region  live y     h | build y     h |    Δy    Δh   cum');
  for (const r of res.sections) {
    const l = r.live; const b = r.build;
    const mark = r.first ? '  ◄ FIRST CAUSE' : (r.status === 'cause' ? '  ◄ cause' : (r.status === 'displaced' ? '  displaced' : ''));
    if (!b) { L.push(`${pad(l.i, 3)} ${padE(l.region, 6)} ${pad(l.y, 7)} ${pad(l.h, 5)} |       —     — |              ${pad(signed(r.step), 5)}${r.first ? '  ◄ FIRST CAUSE' : '  ◄ cause'}: MISSING section  "${clip(l.firstText, 40)}"`); continue; }
    if (!l) { L.push(`  + ${padE(b.region, 6)}       —     — | ${pad(b.y, 7)} ${pad(b.h, 5)} |              ${pad(signed(r.step), 5)}${r.first ? '  ◄ FIRST CAUSE' : '  ◄ cause'}: EXTRA section  "${clip(b.firstText, 40)}"`); continue; }
    L.push(`${pad(l.i, 3)} ${padE(l.region, 6)} ${pad(l.y, 7)} ${pad(l.h, 5)} | ${pad(b.y, 7)} ${pad(b.h, 5)} | ${pad(signed(r.dy), 5)} ${pad(signed(r.dh), 5)} ${pad(signed(r.cum), 5)}${mark}${r.notes.length && r.status !== 'ok' ? `: ${r.notes.join(', ')}` : (r.notes.length ? `  (${r.notes.join(', ')})` : '')}${r.status !== 'ok' ? `  "${clip(l.firstText, 32)}"` : ''}`);
  }
  let wraps = false;
  const bySection = new Map();
  for (const d of res.nodes) { if (d.status === 'ok') continue; if (!bySection.has(d.section)) bySection.set(d.section, []); bySection.get(d.section).push(d); }
  for (const [si, ds] of bySection) {
    const offs = ds.filter((d) => d.status === 'off'); const disp = ds.length - offs.length;
    if (!offs.length && !disp) continue;
    L.push(`section ${si} — ${offs.length} node(s) off${disp ? `, ${disp} below displaced by them (Δy only)` : ''}`);
    for (const d of offs.slice(0, NODE_ROWS)) {
      const font = Object.entries(d.font).map(([k, [a, b]]) => `${k} ${k === 'colour' ? shortColour(a) : a}→${k === 'colour' ? shortColour(b) : b}`);
      if (d.text) font.push(`text → "${clip(d.text[1], 30)}"`);
      if (d.lines) { wraps = true; font.push(`lines ${d.lines[0]}→${d.lines[1]} ◄ wrap`); }
      L.push(`  ${padE(who(d.live), 46)} | Δx ${signed(d.dx)} Δy ${signed(d.dy)} Δw ${signed(d.dw)} Δh ${signed(d.dh)}${font.length ? ` | ${font.join(' · ')}` : ''}${d.how === 'order' ? '  (paired by order)' : ''}`);
    }
    if (offs.length > NODE_ROWS) L.push(`  … ${offs.length - NODE_ROWS} more off in this section (--json <file>)`);
  }
  if (wraps) L.push('◄ wrap: the line count changed — the usual cause of a height delta; fix the width, font or spacing that moved the wrap, not the height');
  const list = (title, nodes, sideSections) => {
    if (!nodes.length) return;
    L.push(`${title} (${nodes.length})`);
    for (const n of nodes.slice(0, 20)) L.push(`  section ${n.section} ${padE(n.region, 6)} ${padE(n.role || n.tag, 6)} ${who(n)}  @ x ${n.x} y ${n.y - ((sideSections[n.section] || {}).y || 0)} (in section) ${n.w}×${n.h}`);
    if (nodes.length > 20) L.push(`  … ${nodes.length - 20} more (--json <file>)`);
  };
  list('MISSING on the build — in the spec, by live section', res.missing, res.liveSections || []);
  list('EXTRA on the build — not in the spec, by build section', res.extra, res.buildSections || []);
  L.push(res.verdict);
  return L.join('\n');
}

export function formatBrief(spec, { path = '' } = {}) {
  const { page, sections, nodes, tokens, truncated } = spec;
  const L = [];
  const nt = nodes.filter(isText).length; const ni = nodes.length - nt;
  L.push(`source-spec @${page.width}  ${page.url}`);
  L.push(`page  height ${page.docHeight}  viewport ${page.viewport}${page.scrollWidth > page.viewport ? `  scrollWidth ${page.scrollWidth} ◄ wider than the viewport` : ''}  root ${page.root}  ${nt} text + ${ni} image nodes`);
  if (page.rootFallback) L.push(`  ⚠ --main matched nothing — measured ${page.root}; pass the real content root`);
  if (page.rootWrapsChrome) L.push('  ⚠ the content root contains <header>/<footer> — they are listed as bands below; pass the content root for a cleaner map');
  if (truncated && (truncated.text || truncated.image)) L.push(`  ⚠ truncated: ${truncated.text} text and ${truncated.image} image node(s) over the cap (${TEXT_CAP} / ${IMAGE_CAP}) were dropped — narrow --main`);
  L.push('  i region      y     h  pad t/b   background                  first text');
  for (const s of sections) L.push(`${pad(s.i, 3)} ${padE(s.region, 6)} ${pad(s.y, 6)} ${pad(s.h, 5)}  ${padE(`${s.paddingTop}/${s.paddingBottom}`, 8)}  ${padE(clip(shortColour(s.background), 26), 26)}  "${clip(s.firstText, 40)}"`);
  const st = tokens.textStyles;
  L.push(`text styles (${st.length}) — n × size/line-height weight family [transform] — roles — sample`);
  for (const c of st.slice(0, 14)) L.push(`${pad(c.n, 4)} × ${padE(c.key, 34)} ${padE(Object.entries(c.roles).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r}×${n}`).join(' '), 18)} "${clip(c.sample, 28)}"`);
  if (st.length > 14) L.push(`  … ${st.length - 14} more style(s): view <spec> --tsv`);
  L.push(`fonts    ${tokens.fonts.slice(0, 4).map((f) => `${clip(f.stack, 48)} ×${f.n}`).join(' · ') || '—'}${tokens.fonts.length > 4 ? ` · +${tokens.fonts.length - 4}` : ''}`);
  L.push(`colours  ${tokens.colours.slice(0, 8).map((c) => `${shortColour(c.color)} ×${c.n}`).join(' · ') || '—'}${tokens.colours.length > 8 ? ` · +${tokens.colours.length - 8}` : ''}`);
  // what a box-by-box copy at rest would miss: nodes that hold their place while the page scrolls, images cut to a shape
  const held = nodes.filter((n) => n.scroll && n.region === 'main');
  if (held.length) L.push(`scroll   ${held.length} node(s) in the main region sit in a sticky / fixed box (${[...new Set(held.map((n) => `section ${n.section}: ${n.scroll}`))].slice(0, 4).join(' · ')}) — author the same box sticky, at the same top`);
  const cutN = nodes.filter((n) => n.shape && (n.shape.r || n.shape.clip || n.shape.mask)).length;
  if (cutN) L.push(`shapes   ${cutN} image(s) are cut by a radius, clip-path or mask (view --kind image: the [..] column)`);
  const c = tokens.container;
  L.push(c.left == null ? 'container  no text in the main region' : `container  left ${c.left}  right ${c.right}  content ${c.content}  (commonest left edge x ${c.leftCommon.x}, ${c.leftCommon.n} node(s))`);
  if (path) L.push(`spec → ${path}   (nodes: source-spec.mjs view ${path} --section <i>)`);
  return L.join('\n');
}

/** view's filter: section index, kind, a case-insensitive regex over text / tag / role / src. */
export function queryNodes(spec, { section = null, kind = null, grep = null } = {}) {
  const re = grep ? new RegExp(grep, 'i') : null;
  return spec.nodes.filter((n) => (section === null || n.section === section) && (!kind || n.kind === kind) && (!re || re.test(`${n.text || ''} ${n.tag} ${n.role || ''} ${n.src || ''}`)));
}

const TSV_FIELDS = ['section', 'region', 'kind', 'tag', 'role', 'x', 'y', 'w', 'h', 'fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'textTransform', 'textAlign', 'color', 'lines', 'fit', 'natural', 'src', 'href', 'scroll', 'text'];
/** The trailing [..] of a node row: its scroll box, and for an image what cuts it and a non-centred anchor. */
export function extraOf(n) {
  const x = [];
  if (n.scroll) x.push(n.scroll);
  if (n.shape) {
    if (n.shape.r) x.push(`r ${n.shape.r}`); if (n.shape.clip) x.push(`clip ${clip(n.shape.clip, 28)}`); if (n.shape.mask) x.push('mask');
    if (n.shape.by) x.push(`cut by ${n.shape.by.join('×')}`);
    if (n.shape.pos && !/^50% 50%$/.test(n.shape.pos) && /cover|none/.test(n.fit || '')) x.push(`pos ${n.shape.pos}`);
  }
  return x.length ? `  [${x.join('; ')}]` : '';
}
export function formatNodes(nodes, { tsv = false, max = VIEW_MAX } = {}) {
  if (tsv) return [TSV_FIELDS.join('\t'), ...nodes.map((n) => TSV_FIELDS.map((k) => (n[k] == null ? '' : (Array.isArray(n[k]) ? n[k].join('×') : String(n[k]).replace(/[\t\n]/g, ' ')))).join('\t'))].join('\n');
  const L = ['sec kind    tag/role      x      y     w     h  style                                        text'];
  for (const n of nodes.slice(0, max)) {
    const style = n.kind === 'image' ? `${n.fit || ''}${n.natural ? ` natural ${n.natural.join('×')}` : ''} ${fileKey(n.src) || ''}`.trim() : `${fontOf(n)} ${shortColour(n.color)} ${n.lines}L${n.textAlign && !/^(start|left)$/.test(n.textAlign) ? ` ${n.textAlign}` : ''}`;
    L.push(`${pad(n.section, 3)} ${padE(n.kind, 7)} ${padE(clip(n.role ? `${n.tag}/${n.role}` : n.tag, 10), 10)} ${pad(n.x, 5)} ${pad(n.y, 6)} ${pad(n.w, 5)} ${pad(n.h, 5)}  ${padE(clip(style, 44), 44)} ${n.kind === 'image' ? clip(n.text, 40) : `"${clip(n.text, 48)}"`}${n.href ? `  → ${clip(n.href, 30)}` : ''}${extraOf(n)}`);
  }
  L.push(nodes.length > max ? `${max} of ${nodes.length} node(s) — narrow with --section / --kind / --grep, or raise --max` : `${nodes.length} node(s)`);
  return L.join('\n');
}

export function readSpec(path) {
  let spec;
  try { spec = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`cannot read spec ${path}: ${String(e.message).split('\n')[0]}`); }
  if (!spec || !spec.page || !Array.isArray(spec.sections) || !Array.isArray(spec.nodes)) throw new Error(`${path} is not a source-spec file (no page / sections / nodes) — write one with: source-spec.mjs capture`);
  return spec;
}

// ---- browser side ----------------------------------------------------------------------------------------------

// measure-live.mjs lives in the diff skill's scripts dir, browser.mjs in the master skill's: the plugin tree
// (skills/replica/scripts ↔ skills/<skill>/scripts) or the project copy (scripts/replica ↔ scripts/<skill>).
const sibling = (paths) => paths.map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
async function loadSession() {
  const live = sibling(['../../diff/scripts/measure-live.mjs', '../diff/measure-live.mjs']);
  const front = sibling(['../../stardust/scripts/browser.mjs', '../stardust/browser.mjs']);
  if (!live || !front) throw new Error(`${live ? 'browser.mjs' : 'measure-live.mjs'} not found beside this script — copy the diff and master skills' scripts dirs to stardust/scripts/ (replica SKILL.md § Setup)`);
  const [m, f] = await Promise.all([import(live.href), import(front.href)]);
  return { ...m, isLiveHttpUrl: f.isLiveHttpUrl };
}

async function measure(session, browser, url, { width, main, locale, overlay }) {
  const { ctx, page } = await session.openPage(browser, { width, locale: locale || 'en-US', stateUrl: url });
  try {
    // a local build is static: a short settle keeps `compare` cheap; a live page gets the shared routine's defaults
    const settle = session.isLiveHttpUrl(url) ? {} : { passes: 3, step: 600, dwell: 60, quietMs: 500 };
    const v = await session.visit(page, url, { ...overlay, settle });
    if (v.status && v.status >= 400) throw new Error(`HTTP ${v.status} at ${url}`);
    const raw = await page.evaluate(collectInPage, { main, textCap: TEXT_CAP, imageCap: IMAGE_CAP, textMax: TEXT_MAX });
    raw.page.tier = session.browserTier(browser);
    return raw;
  } finally { await ctx.close().catch(() => {}); }
}

async function capture(o) {
  const [url] = o.pos;
  const session = await loadSession();
  const browser = await session.openBrowser({ mode: o.headed ? 'headed' : 'chrome' });
  try {
    for (const width of o.widths) {
      const raw = await measure(session, browser, url, { width, main: o.main || 'main', locale: o.locale, overlay: session.overlayOf(o) });
      const spec = buildSpec(raw, { writtenAt: new Date().toISOString(), url, width, main: o.main || 'main', locale: o.locale || 'en-US' });
      const path = join(o.out, `${o.slug}-${width}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialiseSpec(spec));
      console.log(`${formatBrief(spec, { path })}\n`);
    }
  } finally { await browser.close().catch(() => {}); }
  if (!o.noChrome) for (const width of o.widths) chromeInventory(o, url, width);
  return 0;
}

/**
 * The header and footer are authored from an inventory too (texts by channel, icons, background, position): the
 * same capture, the same settings, saved as the gate's live side. Never fails the capture — an unresolved region
 * prints its own line (chrome-parity exit 4) and the spec stands.
 */
function chromeInventory(o, url, width) {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'chrome-parity.mjs');
  if (!existsSync(script)) { console.error('source-spec: chrome-parity.mjs is not beside this script — header and footer inventory skipped'); return; }
  const gateDir = join('stardust', 'replica', 'gates', `${o.slug}-${width}`); mkdirSync(gateDir, { recursive: true });
  const args = [script, url, '--live-only', '--width', String(width), '--live-cache', join(gateDir, 'chrome-live.json'), '--json', join(o.out, `${o.slug}-${width}-chrome.json`)];
  if (o.noDismiss) args.push('--no-dismiss'); else { if (o.consent) args.push('--consent', o.consent); if (o.dismiss && o.dismiss.length) args.push('--dismiss', [].concat(o.dismiss).join(',')); }
  if (o.locale) args.push('--locale', o.locale);
  if (o.headed) args.push('--headed'); // the sites --headed exists for block the headless probe too
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240000 });
  console.log(`${(r.stdout || '').trimEnd()}\n`);
  if (r.status !== 0) console.error(`source-spec: header and footer inventory at ${width} ended with exit ${r.status} — ${((r.stderr || '').trim().split('\n').pop() || 'see above').slice(0, 200)}`);
}

/** stardust/replica/font-subst.txt (`<brand>=<substitute>` per line, # comments) → [{ live, build }], lower-cased. */
export function parseFontSubstFile(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split('=').map((f) => f.replace(/["']/g, '').trim().toLowerCase()))
    .filter((p) => p.length === 2 && p[0] && p[1]).map(([live, build]) => ({ live, build }));
}
function readFontSubst(file = join('stardust', 'replica', 'font-subst.txt')) { try { return parseFontSubstFile(readFileSync(file, 'utf8')); } catch { return []; } }
async function compare(o) {
  const [specPath, buildUrl] = o.pos;
  const live = readSpec(specPath);
  const session = await loadSession();
  const browser = await session.openBrowser({ mode: 'chrome' });
  let raw;
  try { raw = await measure(session, browser, buildUrl, { width: live.page.width, main: o.main || (live._provenance && live._provenance.main) || 'main', locale: live._provenance && live._provenance.locale, overlay: { dismiss: false } }); }
  finally { await browser.close().catch(() => {}); }
  const build = buildSpec(raw, { url: buildUrl, width: live.page.width });
  const res = compareSpecs(live, build, { tol: o.tol, subst: readFontSubst() });
  if (build.page.rootFallback) console.error(`source-spec: the build has no element matching the content root — measured ${build.page.root}; pass --main`);
  if (o.json) { mkdirSync(dirname(o.json), { recursive: true }); writeFileSync(o.json, JSON.stringify({ spec: specPath, build: buildUrl, ...res, buildPage: build.page }, null, 1)); }
  console.log(formatCompare(res, { specPath, buildUrl }));
  return res.pass ? 0 : 2;
}

function view(o) {
  const spec = readSpec(o.pos[0]);
  if (o.section === null && !o.kind && !o.grep && !o.tsv) { console.log(formatBrief(spec, { path: o.pos[0] })); return 0; }
  if (o.section !== null) {
    const s = spec.sections.find((x) => x.i === o.section);
    if (!s) throw new UsageError(`no section ${o.section} in ${o.pos[0]} (0…${spec.sections.length - 1})`);
    if (!o.tsv) console.log(`section ${s.i} ${s.region} ${s.selectorHint}  y ${s.y} h ${s.h}  padding ${s.paddingTop}/${s.paddingBottom}  bg ${s.background}`);
  }
  console.log(formatNodes(queryNodes(spec, o), o));
  return 0;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.cmd === 'view') return view(o);
  return o.cmd === 'capture' ? capture(o) : compare(o);
}

const invoked = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invoked) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
    const usage = e instanceof UsageError;
    console.error(`source-spec${usage ? '' : ' error'}: ${String(e.message).split('\n')[0]}${e.name === 'BotChallengeError' ? ' — nothing was written; escalate with --headed' : ''}`);
    process.exit(usage ? 125 : (e.name === 'BotChallengeError' ? 3 : 1));
  });
}
