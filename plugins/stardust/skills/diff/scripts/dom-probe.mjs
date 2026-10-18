#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue */
/**
 * dom-probe — the structural / geometry probe: boxes, a DOM skeleton and a heading + landmark outline under CSS
 * roots, for one document or two compared
 *
 * Usage: node dom-probe.mjs <url|file> [options]
 *   <url|file>            an http(s) URL, opened the way the gate instruments open a page (live-session: real-Chrome
 *                         context, gotoLive's per-host wait rule, the EDS delayed phase on build/preview hosts, consent
 *                         and overlays dismissed); or a local HTML file (a path, relative to the cwd, or a file:// URL),
 *                         opened directly: no live-session rules, no overlay sweep
 *   --selector <css>      a root to probe (default body); repeatable, one root per flag. The value is passed whole to
 *                         querySelectorAll (a comma makes it a selector list, its matches in document order); the
 *                         first 20 matches are probed, the count is always printed
 *   --width <px>          viewport width (default 1440; height 900)
 *   --depth <n>           skeleton levels below each root (default 4; 0 = the root line only)
 *   --max-nodes <n>       skeleton lines per root match (default 400); a cut skeleton ends "… <k> more"
 *   --compare <url|file>  probe a second document with the same options; prints the comparison instead of the
 *                         reports (A = <url|file>, B = --compare)
 *   --json [<file.json>]  the JSON below on stdout instead of the text; given a .json path, the text still prints, the
 *                         JSON goes to the file (directories created) and a last line "json: <file>" names it
 *   --locale <tag>        pin Accept-Language + locale
 *   --nav-timeout <ms>    navigation timeout (default 60000)
 *   --headed              stealth real-Chrome tier for a bot-managed http(s) document
 *   --help                this text
 *
 * Output (stdout, deterministic: no timestamps), one document:
 *   dom-probe <url> @<w>px · HTTP <status> · consent <sel|none>      (a file: "· file")
 *   selector <css>: <n> matches[ (first 20 probed)]                  (0 matches is not an error)
 *   [<i>] <sig> box <x>,<y> <w>×<h> · <display> · <position> · visible|hidden
 *     skeleton:
 *       <sig> <w>×<h> @<x>,<y>[ <display>][ <position>][ #shadow]   one line per element, 2 spaces per level
 *       ×<N> <sig> <w>×<h> @<x>,<y>     a run of 3 or more consecutive same-signature siblings: the first one's box
 *                                       and subtree stand for all
 *       … <k> more                      lines past --max-nodes (+ elements past the 20000-element walk cap)
 *     outline:                          ("outline: none" when empty)
 *       h<1-6> "<text>" y=<y>[ (hidden)]
 *       [<landmark>] "<text>" y=<y>[ (hidden)]
 * <sig> = tag#id.class1.class2.class3… (classes in document order, 3 then …). Boxes are page-absolute
 * (getBoundingClientRect + scroll offsets), whole px; visible = a non-zero size, not display: none, not
 * visibility: hidden. A skeleton line prints the display only when it is not the tag's usual one (flex, grid, none,
 * block on an inline tag …) and the position only when absolute, fixed or sticky. Skipped: head, script, style,
 * noscript, template, link, meta, base, title, and everything inside an svg. An open shadow root's children are
 * walked before the light children and marked #shadow (a closed root is not walked). The outline lists h1-h6 and the
 * landmarks (header, nav, main, footer, aside, a section with aria-label or aria-labelledby, a labelled role=region,
 * role=banner, navigation, main, contentinfo, complementary, search, form) in document order, the root included,
 * light DOM only, at most 200 per root match; text = aria-label / aria-labelledby, else the rendered text,
 * whitespace collapsed, first 80 chars.
 *
 * --compare output, per --selector:
 *   dom-probe compare @<w>px · depth <n>, then A = <url> · … and B = <url> · …
 *   selector <css>: A <n> matches · B <n> matches
 *   [<i>] Δx Δy Δw Δh (B minus A) · A <box> · B <box>       per index pair of the probed matches
 *     skeleton: <n> differences (only A <a> · only B <b> · changed <c>)     or "skeleton: same"
 *       Lines keyed by their signature path below the root (a repeated path numbered [2], [3] …): only A, only B,
 *       and a box moved or resized by more than 2 px, a changed ×N, display or position; the first 40, then
 *       "… <k> more".
 *     outline: <n> differences                                 or "outline: same"
 *       Headings only: removed, added, text changed, level changed; the first 40, then "… <k> more".
 *   unpaired: <k> probed matches only in A|B
 *
 * JSON (--json) = { tool: "dom-probe", width, depth, maxNodes, a: <doc>, b?: <doc>, compare?: [<cmp>] }
 *   <doc> = { input, url, kind: "http"|"file", status, consent, roots: [{ selector, count, error?, matches: [{ index,
 *     box: { x, y, w, h, display, position, visible }, skeleton: { lines: [{ depth, sig, n, x, y, w, h, display,
 *     position, shadow? }], more }, outline: { entries: [{ kind, level?, text, y, visible }], more } }] }] }
 *   <cmp> = { selector, countA, countB, error?, pairs: [{ index, a: <box>, b: <box>, delta: { dx, dy, dw, dh },
 *     skeleton: { total, onlyA, onlyB, changed, diffs: [{ type: "onlyA"|"onlyB", path, line } | { type: "changed",
 *     path, delta, moved, sig?, n?, display?, position? }] }, outline: { total, diffs: [{ type: "removed"|"added"|
 *     "text"|"level", a?, b? }] } }] }
 *   Every JSON line carries its raw computed display and position; status and consent are null for a file.
 *
 * Exit codes: 0 ok (differences never change it, nor does a selector matching nothing); 1 error (navigation,
 * HTTP >= 400, an invalid selector: its line still prints); 2 usage (unknown flag, a value flag without its value,
 * a missing file); 3 bot challenge (escalate with --headed).
 *
 * Why: a recorded hands-off run wrote dozens of inline browser scripts for geometry questions (element-box and
 * position probes, DOM-skeleton dumps of a section, heading and text outlines), and the recorded runs compared two
 * documents (the source page against the built page, or two built pages) by eye. This one probe answers them.
 * For looking and measuring, never for gating: gate numbers still come from the gate instruments.
 * Measure with this, never with a pixel library on a screenshot; for computed style groups across widths use
 * replica/measure.mjs.
 */
// Pure parts exported: parseArgs, toTarget, signature, collapseRuns, usualDisplay, skeletonLines, formatBox, formatSkeleton,
// formatOutline, formatDelta, compareBoxes, compareSkeleton, formatSkeletonDiff, compareOutline, formatOutlineDiff, shapeDoc,
// compareDocs, formatDoc, formatCompare, exitCodeFor, and collectInPage (the in-page collector: self-contained, serialised
// by playwright). Requires playwright, imported lazily: --help and the usage errors answer without it.
import { mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as session from './live-session.mjs';

export const HELP = `dom-probe — the structural / geometry probe: boxes, a DOM skeleton and a heading + landmark outline under CSS
roots, for one document or two compared

Usage: node dom-probe.mjs <url|file> [options]
  <url|file>            an http(s) URL, opened the way the gate instruments open a page (live-session: real-Chrome
                        context, gotoLive's per-host wait rule, the EDS delayed phase on build/preview hosts, consent
                        and overlays dismissed); or a local HTML file (a path, relative to the cwd, or a file:// URL),
                        opened directly: no live-session rules, no overlay sweep
  --selector <css>      a root to probe (default body); repeatable, one root per flag. The value is passed whole to
                        querySelectorAll (a comma makes it a selector list, its matches in document order); the
                        first 20 matches are probed, the count is always printed
  --width <px>          viewport width (default 1440; height 900)
  --depth <n>           skeleton levels below each root (default 4; 0 = the root line only)
  --max-nodes <n>       skeleton lines per root match (default 400); a cut skeleton ends "… <k> more"
  --compare <url|file>  probe a second document with the same options; prints the comparison instead of the
                        reports (A = <url|file>, B = --compare)
  --json [<file.json>]  the JSON below on stdout instead of the text; given a .json path, the text still prints, the
                        JSON goes to the file (directories created) and a last line "json: <file>" names it
  --locale <tag>        pin Accept-Language + locale
  --nav-timeout <ms>    navigation timeout (default 60000)
  --headed              stealth real-Chrome tier for a bot-managed http(s) document
  --help                this text

Output (stdout, deterministic: no timestamps), one document:
  dom-probe <url> @<w>px · HTTP <status> · consent <sel|none>      (a file: "· file")
  selector <css>: <n> matches[ (first 20 probed)]                  (0 matches is not an error)
  [<i>] <sig> box <x>,<y> <w>×<h> · <display> · <position> · visible|hidden
    skeleton:
      <sig> <w>×<h> @<x>,<y>[ <display>][ <position>][ #shadow]   one line per element, 2 spaces per level
      ×<N> <sig> <w>×<h> @<x>,<y>     a run of 3 or more consecutive same-signature siblings: the first one's box
                                      and subtree stand for all
      … <k> more                      lines past --max-nodes (+ elements past the 20000-element walk cap)
    outline:                          ("outline: none" when empty)
      h<1-6> "<text>" y=<y>[ (hidden)]
      [<landmark>] "<text>" y=<y>[ (hidden)]
<sig> = tag#id.class1.class2.class3… (classes in document order, 3 then …). Boxes are page-absolute
(getBoundingClientRect + scroll offsets), whole px; visible = a non-zero size, not display: none, not
visibility: hidden. A skeleton line prints the display only when it is not the tag's usual one (flex, grid, none,
block on an inline tag …) and the position only when absolute, fixed or sticky. Skipped: head, script, style,
noscript, template, link, meta, base, title, and everything inside an svg. An open shadow root's children are
walked before the light children and marked #shadow (a closed root is not walked). The outline lists h1-h6 and the
landmarks (header, nav, main, footer, aside, a section with aria-label or aria-labelledby, a labelled role=region,
role=banner, navigation, main, contentinfo, complementary, search, form) in document order, the root included,
light DOM only, at most 200 per root match; text = aria-label / aria-labelledby, else the rendered text,
whitespace collapsed, first 80 chars.

--compare output, per --selector:
  dom-probe compare @<w>px · depth <n>, then A = <url> · … and B = <url> · …
  selector <css>: A <n> matches · B <n> matches
  [<i>] Δx Δy Δw Δh (B minus A) · A <box> · B <box>       per index pair of the probed matches
    skeleton: <n> differences (only A <a> · only B <b> · changed <c>)     or "skeleton: same"
      Lines keyed by their signature path below the root (a repeated path numbered [2], [3] …): only A, only B,
      and a box moved or resized by more than 2 px, a changed ×N, display or position; the first 40, then
      "… <k> more".
    outline: <n> differences                                 or "outline: same"
      Headings only: removed, added, text changed, level changed; the first 40, then "… <k> more".
  unpaired: <k> probed matches only in A|B

JSON (--json) = { tool: "dom-probe", width, depth, maxNodes, a: <doc>, b?: <doc>, compare?: [<cmp>] }
  <doc> = { input, url, kind: "http"|"file", status, consent, roots: [{ selector, count, error?, matches: [{ index,
    box: { x, y, w, h, display, position, visible }, skeleton: { lines: [{ depth, sig, n, x, y, w, h, display,
    position, shadow? }], more }, outline: { entries: [{ kind, level?, text, y, visible }], more } }] }] }
  <cmp> = { selector, countA, countB, error?, pairs: [{ index, a: <box>, b: <box>, delta: { dx, dy, dw, dh },
    skeleton: { total, onlyA, onlyB, changed, diffs: [{ type: "onlyA"|"onlyB", path, line } | { type: "changed",
    path, delta, moved, sig?, n?, display?, position? }] }, outline: { total, diffs: [{ type: "removed"|"added"|
    "text"|"level", a?, b? }] } }] }
  Every JSON line carries its raw computed display and position; status and consent are null for a file.

Exit codes: 0 ok (differences never change it, nor does a selector matching nothing); 1 error (navigation,
HTTP >= 400, an invalid selector: its line still prints); 2 usage (unknown flag, a value flag without its value,
a missing file); 3 bot challenge (escalate with --headed).

Why: a recorded hands-off run wrote dozens of inline browser scripts for geometry questions (element-box and
position probes, DOM-skeleton dumps of a section, heading and text outlines), and the recorded runs compared two
documents (the source page against the built page, or two built pages) by eye. This one probe answers them.
For looking and measuring, never for gating: gate numbers still come from the gate instruments.
Measure with this, never with a pixel library on a screenshot; for computed style groups across widths use
replica/measure.mjs.`;

export class UsageError extends Error {
  constructor(msg) { super(msg); this.name = 'UsageError'; this.code = 2; }
}

export const MAX_MATCHES = 20;
export const WALK_CAP = 20000;
export const OUTLINE_CAP = 200;
export const TEXT_MAX = 80;
export const TOLERANCE_PX = 2;
export const DIFF_LIMIT = 40;
const MIN_RUN = 3;
const VIEWPORT_HEIGHT = 900;
const REPEATABLE = new Set(['--selector']);

// ---- arguments ----------------------------------------------------------------------------------------

const SCHEME = /^([a-z][a-z0-9+.-]+):/i;

/** An input → { kind: 'http', url } or { kind: 'file', url, path }: an http(s) URL as parsed, a file:// URL with its
 * path, anything without a scheme a path resolved against `cwd`. Any other scheme is a UsageError. No file I/O. */
export function toTarget(input, cwd = process.cwd()) {
  const m = SCHEME.exec(input);
  if (!m) {
    const path = resolve(cwd, input);
    return { kind: 'file', url: pathToFileURL(path).href, path };
  }
  const scheme = m[1].toLowerCase();
  let u = null;
  try { u = new URL(input); } catch { /* reported below */ }
  if (u && (scheme === 'http' || scheme === 'https')) return { kind: 'http', url: u.href };
  if (u && scheme === 'file') return { kind: 'file', url: u.href, path: fileURLToPath(u) };
  throw new UsageError(`<url|file> must be an http(s) URL, a file path or a file:// URL, got "${input}"`);
}

function wholeNumber(flag, v, min, max, unit = '') {
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new UsageError(`${flag} must be a whole number${unit} from ${min} to ${max}, got "${v}"`);
  return Number(v);
}

const DEFAULTS = Object.freeze({ input: null, target: null, selectors: [], width: 1440, depth: 4, maxNodes: 400, json: false, jsonFile: null, compare: null, compareTarget: null, locale: null, navTimeout: 60000, headed: false, help: false });

/** argv after the script → options, or a UsageError (exit 2). `help: true` when --help / -h is anywhere. */
export function parseArgs(args, cwd = process.cwd()) {
  if (args.includes('--help') || args.includes('-h')) return { ...DEFAULTS, selectors: ['body'], help: true };
  const opts = { ...DEFAULTS, selectors: [] };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    // A value flag never swallows the next flag: `--selector --depth 2` is a forgotten selector.
    const need = () => {
      if (i + 1 >= args.length) throw new UsageError(`${a} needs a value`);
      if (args[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value (got ${args[i + 1]}, which is a flag)`);
      i += 1; return args[i];
    };
    if (a.startsWith('--')) {
      if (seen.has(a) && !REPEATABLE.has(a)) throw new UsageError(`${a} given more than once`);
      seen.add(a);
    }
    if (a === '--selector') {
      const s = need().trim();
      if (!s) throw new UsageError('--selector needs a non-empty selector');
      opts.selectors.push(s);
    }
    else if (a === '--width') opts.width = wholeNumber(a, need(), 1, 10000, ' of px');
    else if (a === '--depth') opts.depth = wholeNumber(a, need(), 0, 64);
    else if (a === '--max-nodes') opts.maxNodes = wholeNumber(a, need(), 1, 100000);
    else if (a === '--json') {
      opts.json = true;
      // The value is optional: only a following .json path is the file, anything else stays an argument.
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith('-') && /\.json$/i.test(v)) { opts.jsonFile = v; i += 1; }
    }
    else if (a === '--compare') opts.compare = need();
    else if (a === '--locale') opts.locale = need();
    else if (a === '--nav-timeout') opts.navTimeout = wholeNumber(a, need(), 1, 600000, ' of ms');
    else if (a === '--headed') opts.headed = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else if (opts.input) throw new UsageError(`unexpected argument "${a}" — one <url|file> per probe; compare two with --compare`);
    else opts.input = a;
  }
  if (!opts.input) throw new UsageError('need <url|file> (an http(s) URL or a local HTML file)');
  opts.selectors = opts.selectors.length ? [...new Set(opts.selectors)] : ['body'];
  opts.target = toTarget(opts.input, cwd);
  opts.compareTarget = opts.compare ? toTarget(opts.compare, cwd) : null;
  return opts;
}

// A missing input file is a usage error, checked before any browser starts.
function assertFile(target, input) {
  let ok = false;
  try { ok = statSync(target.path).isFile(); } catch { /* reported below */ }
  if (ok) return;
  const first = String(input).split('/')[0];
  const hostLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(first) && !/\.x?html?$/i.test(first);
  throw new UsageError(`no such file: ${target.path}${hostLike ? ' (an http(s) URL needs its scheme)' : ''}`);
}

// ---- the in-page collector ----------------------------------------------------------------------------

/* eslint-disable no-undef */
/**
 * Runs in the page (serialised by playwright: it references nothing outside itself). For each selector: the match
 * count (or the error querySelectorAll threw) and, for the first `maxMatches` matches, the box, the element tree to
 * `depth` (an open shadow root's children first, marked shadow; skipped tags and svg internals left out; at most
 * `walkCap` elements, `omitted` counts the rest) and the heading + landmark outline (at most `outlineCap` entries,
 * text cut at `textMax` chars).
 */
export function collectInPage({ selectors, depth, maxMatches, walkCap, outlineCap, textMax }) {
  const SKIP = new Set(['head', 'script', 'style', 'noscript', 'template', 'link', 'meta', 'base', 'title']);
  const OUTLINE = 'h1,h2,h3,h4,h5,h6,header,nav,main,footer,aside,section[aria-label],section[aria-labelledby],[role=region][aria-label],[role=region][aria-labelledby],'
    + '[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=search],[role=form]';
  const sx = window.scrollX; const sy = window.scrollY;
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, position: cs.position,
      visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse',
    };
  };
  const clip = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > textMax ? `${t.slice(0, textMax)}…` : t; };
  const kidsOf = (el) => [...(el.shadowRoot ? [...el.shadowRoot.children].map((c) => [c, true]) : []), ...[...el.children].map((c) => [c, false])].filter(([c]) => !SKIP.has(c.localName));
  const walks = (el, d) => d < depth && el.localName !== 'svg';
  const countAll = (el, d) => 1 + (walks(el, d) ? kidsOf(el).reduce((n, [c]) => n + countAll(c, d + 1), 0) : 0);
  let walked = 0; let omitted = 0;
  const node = (el, d, shadow) => {
    const b = boxOf(el);
    const n = { tag: el.localName, id: el.getAttribute('id') || '', cls: [...el.classList], x: b.x, y: b.y, w: b.w, h: b.h, display: b.display, position: b.position };
    if (shadow) n.shadow = true;
    if (walks(el, d)) {
      n.kids = [];
      for (const [c, sh] of kidsOf(el)) {
        if (walked >= walkCap) { omitted += countAll(c, d + 1); continue; }
        walked += 1;
        n.kids.push(node(c, d + 1, sh));
      }
    }
    return n;
  };
  const labelOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label;
    const ids = el.getAttribute('aria-labelledby');
    const by = ids ? ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((x) => x.textContent).join(' ') : '';
    return by.trim() ? by : null;
  };
  const outline = (root) => {
    const els = [...(root.matches(OUTLINE) ? [root] : []), ...root.querySelectorAll(OUTLINE)];
    const entries = els.slice(0, outlineCap).map((el) => {
      const tag = el.localName;
      const role = el.getAttribute('role');
      const b = boxOf(el);
      const head = /^h[1-6]$/.test(tag) ? { kind: tag, level: Number(tag[1]) } : { kind: role ? `role=${role}` : tag };
      const label = labelOf(el);
      return { ...head, text: clip(label != null ? label : (el.innerText != null ? el.innerText : el.textContent)), y: b.y, visible: b.visible };
    });
    return { entries, more: Math.max(0, els.length - outlineCap) };
  };
  return selectors.map((selector) => {
    let list;
    try { list = [...document.querySelectorAll(selector)]; } catch (e) { return { selector, count: 0, error: String((e && e.message) || e).split('\n')[0], matches: [] }; }
    return {
      selector,
      count: list.length,
      matches: list.slice(0, maxMatches).map((el, i) => {
        walked = 0; omitted = 0;
        const tree = node(el, 0, false);
        return { index: i + 1, box: boxOf(el), tree, omitted, outline: outline(el) };
      }),
    };
  });
}
/* eslint-enable no-undef */

// ---- skeleton -----------------------------------------------------------------------------------------

/** `tag#id.class1.class2.class3…` — classes in document order, at most 3, then `…`. */
export function signature({ tag, id, cls }) {
  const c = cls || [];
  return `${tag}${id ? `#${id}` : ''}${c.slice(0, 3).map((x) => `.${x}`).join('')}${c.length > 3 ? '…' : ''}`;
}

/** Siblings → the same list with `n`: a run of ≥ 3 consecutive same-signature siblings (same light / shadow side)
 * becomes its first element with n = the run length (its box and subtree stand for all); everything else n = 1. */
export function collapseRuns(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length;) {
    const sig = signature(nodes[i]);
    const shadow = Boolean(nodes[i].shadow);
    let j = i + 1;
    while (j < nodes.length && signature(nodes[j]) === sig && Boolean(nodes[j].shadow) === shadow) j += 1;
    if (j - i >= MIN_RUN) { out.push({ ...nodes[i], n: j - i }); i = j; }
    else for (; i < j; i += 1) out.push({ ...nodes[i], n: 1 });
  }
  return out;
}

const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'listing', 'main', 'menu', 'nav', 'ol', 'optgroup',
  'option', 'p', 'plaintext', 'pre', 'search', 'section', 'ul', 'xmp']);
const INLINE_BLOCK = new Set(['button', 'input', 'select', 'textarea', 'meter', 'progress']);
const OWN_DISPLAY = { li: 'list-item', summary: 'list-item', table: 'table', caption: 'table-caption', colgroup: 'table-column-group', col: 'table-column',
  thead: 'table-header-group', tbody: 'table-row-group', tfoot: 'table-footer-group', tr: 'table-row', td: 'table-cell', th: 'table-cell', slot: 'contents',
  ruby: 'ruby', rt: 'ruby-text', area: 'none', datalist: 'none', param: 'none', rp: 'none' };

/** The display a tag has without author CSS (custom and unknown elements: inline). */
export function usualDisplay(tag) {
  if (BLOCK.has(tag)) return 'block';
  if (INLINE_BLOCK.has(tag)) return 'inline-block';
  return Object.hasOwn(OWN_DISPLAY, tag) ? OWN_DISPLAY[tag] : 'inline';
}

const POSITIONED = new Set(['absolute', 'fixed', 'sticky']);
const tagOf = (sig) => sig.split(/[#.…]/)[0];

/** A collected tree → { lines: [{ depth, sig, n, x, y, w, h, display, position, shadow? }], more } in document order,
 * runs collapsed, cut at maxNodes lines; more = lines past the cut + `omitted` (elements past the in-page walk cap). */
export function skeletonLines(tree, maxNodes = 400, omitted = 0) {
  const lines = [];
  const visit = (nd, depth, n) => {
    lines.push({ depth, sig: signature(nd), n, x: nd.x, y: nd.y, w: nd.w, h: nd.h, display: nd.display, position: nd.position, ...(nd.shadow ? { shadow: true } : {}) });
    if (nd.kids) for (const k of collapseRuns(nd.kids)) visit(k, depth + 1, k.n);
  };
  visit(tree, 0, 1);
  return { lines: lines.slice(0, maxNodes), more: Math.max(0, lines.length - maxNodes) + omitted };
}

const boxText = (b) => `${b.w}×${b.h} @${b.x},${b.y}`;

function skeletonLine(l) {
  const flags = [l.display !== usualDisplay(tagOf(l.sig)) ? l.display : null, POSITIONED.has(l.position) ? l.position : null, l.shadow ? '#shadow' : null].filter(Boolean);
  return `${'  '.repeat(l.depth)}${l.n > 1 ? `×${l.n} ` : ''}${l.sig} ${boxText(l)}${flags.length ? ` ${flags.join(' ')}` : ''}`;
}

/** { lines, more } → text lines, 2 spaces per level after `indent`, then `… <k> more` when cut. */
export function formatSkeleton({ lines, more }, indent = '') {
  return [...lines.map((l) => `${indent}${skeletonLine(l)}`), ...(more ? [`${indent}… ${more} more`] : [])];
}

export const formatBox = (b) => `${b.x},${b.y} ${b.w}×${b.h} · ${b.display} · ${b.position} · ${b.visible ? 'visible' : 'hidden'}`;

const quote = (s) => JSON.stringify(String(s));

/** { entries, more } → `h2 "text" y=…` / `[landmark] "text" y=…` lines (` (hidden)` when not visible), then the cut. */
export function formatOutline({ entries, more }) {
  return [...entries.map((e) => `${e.level ? e.kind : `[${e.kind}]`} ${quote(e.text)} y=${e.y}${e.visible ? '' : ' (hidden)'}`), ...(more ? [`… ${more} more`] : [])];
}

// ---- comparison ---------------------------------------------------------------------------------------

/** B minus A. */
export const compareBoxes = (a, b) => ({ dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h });

/** `Δx 0 Δy +40 Δw 0 Δh 0`; nonZero keeps only the components that are not 0. */
export function formatDelta(d, nonZero = false) {
  return [['Δx', d.dx], ['Δy', d.dy], ['Δw', d.dw], ['Δh', d.dh]].filter(([, v]) => !nonZero || v !== 0).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' ');
}

// Lines → Map(path → line) in order: the signature path below the root ('' = the root), a repeated path numbered [k].
function keyedLines(lines) {
  const stack = []; const seen = new Map(); const map = new Map();
  for (const l of lines) {
    stack.length = l.depth;
    stack[l.depth] = l.sig;
    const base = stack.slice(1).join(' > ');
    const k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    map.set(k > 1 ? `${base} [${k}]` : base, l);
  }
  return map;
}

/**
 * Two skeletons' lines → { total, onlyA, onlyB, changed, diffs } keyed by signature path: a path only in A, only in B,
 * or on both sides with a box moved / resized by more than `tolerance` px, or a changed ×N, display, position (or the
 * root's signature). diffs = the first `limit` in A's order, then B's.
 */
export function compareSkeleton(a, b, { tolerance = TOLERANCE_PX, limit = DIFF_LIMIT } = {}) {
  const A = keyedLines(a); const B = keyedLines(b);
  const diffs = []; let onlyA = 0; let onlyB = 0; let changed = 0;
  for (const [path, la] of A) {
    const lb = B.get(path);
    if (!lb) { diffs.push({ type: 'onlyA', path, line: la }); onlyA += 1; continue; }
    const delta = compareBoxes(la, lb);
    const rec = { type: 'changed', path, delta, moved: Object.values(delta).some((v) => Math.abs(v) > tolerance) };
    for (const k of ['sig', 'n', 'display', 'position']) if (la[k] !== lb[k]) rec[k] = [la[k], lb[k]];
    if (rec.moved || rec.sig || rec.n || rec.display || rec.position) { diffs.push(rec); changed += 1; }
  }
  for (const [path, lb] of B) if (!A.has(path)) { diffs.push({ type: 'onlyB', path, line: lb }); onlyB += 1; }
  return { total: diffs.length, onlyA, onlyB, changed, diffs: diffs.slice(0, limit) };
}

const pathLabel = (p) => p || '(root)';

export function formatSkeletonDiff(d) {
  if (d.type !== 'changed') return `only ${d.type === 'onlyA' ? 'A' : 'B'}: ${pathLabel(d.path)} ${boxText(d.line)}`;
  const parts = [
    d.moved ? formatDelta(d.delta, true) : null,
    d.sig ? `${d.sig[0]}→${d.sig[1]}` : null,
    d.n ? `×${d.n[0]}→×${d.n[1]}` : null,
    d.display ? `display ${d.display[0]}→${d.display[1]}` : null,
    d.position ? `position ${d.position[0]}→${d.position[1]}` : null,
  ].filter(Boolean);
  return `Δ ${pathLabel(d.path)}: ${parts.join(' · ')}`;
}

/**
 * Two outlines → the heading differences in document order (landmarks are not compared): headings aligned by text
 * (longest common subsequence); an aligned pair at another level = level; between two aligned pairs the leftovers
 * pair up in order = text (the level may change too), the rest removed (A) / added (B).
 */
export function compareOutline(a, b) {
  const ha = a.filter((e) => e.level); const hb = b.filter((e) => e.level);
  const n = ha.length; const m = hb.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = ha[i].text === hb[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let ga = []; let gb = [];
  const flush = () => {
    const k = Math.min(ga.length, gb.length);
    for (let t = 0; t < k; t += 1) out.push({ type: 'text', a: ga[t], b: gb[t] });
    for (const x of ga.slice(k)) out.push({ type: 'removed', a: x });
    for (const x of gb.slice(k)) out.push({ type: 'added', b: x });
    ga = []; gb = [];
  };
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (ha[i].text === hb[j].text) {
      flush();
      if (ha[i].level !== hb[j].level) out.push({ type: 'level', a: ha[i], b: hb[j] });
      i += 1; j += 1;
    } else if (L[i + 1][j] >= L[i][j + 1]) { ga.push(ha[i]); i += 1; }
    else { gb.push(hb[j]); j += 1; }
  }
  ga.push(...ha.slice(i)); gb.push(...hb.slice(j));
  flush();
  return out;
}

export function formatOutlineDiff(d) {
  if (d.type === 'removed') return `removed ${d.a.kind} ${quote(d.a.text)} y=${d.a.y}`;
  if (d.type === 'added') return `added ${d.b.kind} ${quote(d.b.text)} y=${d.b.y}`;
  if (d.type === 'level') return `level ${quote(d.a.text)} ${d.a.kind} → ${d.b.kind}`;
  return `text ${d.a.kind === d.b.kind ? d.a.kind : `${d.a.kind}→${d.b.kind}`} ${quote(d.a.text)} → ${quote(d.b.text)}`;
}

// ---- documents ----------------------------------------------------------------------------------------

/** collectInPage's result for one document → the JSON <doc>. */
export function shapeDoc(target, input, nav, raw, { maxNodes = 400 } = {}) {
  return {
    input, url: target.url, kind: target.kind, status: nav.status ?? null, consent: nav.consent ?? null,
    roots: raw.map((r) => ({
      selector: r.selector, count: r.count, ...(r.error ? { error: r.error } : {}),
      matches: r.matches.map((m) => ({ index: m.index, box: m.box, skeleton: skeletonLines(m.tree, maxNodes, m.omitted), outline: m.outline })),
    })),
  };
}

/** Two <doc>s probed with the same selectors → the JSON <cmp> list, one per selector. */
export function compareDocs(a, b, { tolerance = TOLERANCE_PX, limit = DIFF_LIMIT } = {}) {
  return a.roots.map((ra, k) => {
    const rb = b.roots[k];
    const error = [ra.error ? `A: ${ra.error}` : null, rb.error ? `B: ${rb.error}` : null].filter(Boolean).join(' · ');
    const pairs = [];
    for (let i = 0; i < Math.min(ra.matches.length, rb.matches.length); i += 1) {
      const ma = ra.matches[i]; const mb = rb.matches[i];
      const o = compareOutline(ma.outline.entries, mb.outline.entries);
      pairs.push({ index: ma.index, a: ma.box, b: mb.box, delta: compareBoxes(ma.box, mb.box),
        skeleton: compareSkeleton(ma.skeleton.lines, mb.skeleton.lines, { tolerance, limit }), outline: { total: o.length, diffs: o.slice(0, limit) } });
    }
    return { selector: ra.selector, countA: ra.count, countB: rb.count, ...(error ? { error } : {}), pairs };
  });
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const docState = (d) => (d.kind === 'file' ? 'file' : `HTTP ${d.status ?? '-'} · consent ${d.consent || 'none'}`);
const countText = (r) => (r.error ? `error ${r.error}` : `${plural(r.count, 'match', 'matches')}${r.count > r.matches.length ? ` (first ${r.matches.length} probed)` : ''}`);

/** One <doc> → its text report. */
export function formatDoc(doc, { width }) {
  const out = [`dom-probe ${doc.url} @${width}px · ${docState(doc)}`];
  for (const r of doc.roots) {
    out.push(`selector ${r.selector}: ${countText(r)}`);
    for (const m of r.matches) {
      out.push(`[${m.index}] ${m.skeleton.lines[0].sig} box ${formatBox(m.box)}`, '  skeleton:', ...formatSkeleton(m.skeleton, '    '));
      const o = formatOutline(m.outline);
      out.push(...(o.length ? ['  outline:', ...o.map((l) => `    ${l}`)] : ['  outline: none']));
    }
  }
  return out;
}

/** Two <doc>s and their <cmp> list → the comparison text. */
export function formatCompare(a, b, cmp, { width, depth }) {
  const out = [`dom-probe compare @${width}px · depth ${depth}`, `A = ${a.url} · ${docState(a)}`, `B = ${b.url} · ${docState(b)}`];
  const more = (total, shown) => (total > shown ? [`    … ${total - shown} more`] : []);
  cmp.forEach((c, k) => {
    const ra = a.roots[k]; const rb = b.roots[k];
    out.push(`selector ${c.selector}: A ${countText(ra)} · B ${countText(rb)}`);
    for (const p of c.pairs) {
      out.push(`[${p.index}] ${formatDelta(p.delta)} · A ${p.a.x},${p.a.y} ${p.a.w}×${p.a.h} · B ${p.b.x},${p.b.y} ${p.b.w}×${p.b.h}`);
      const s = p.skeleton;
      if (!s.total) out.push('  skeleton: same');
      else out.push(`  skeleton: ${plural(s.total, 'difference')} (only A ${s.onlyA} · only B ${s.onlyB} · changed ${s.changed})`, ...s.diffs.map((d) => `    ${formatSkeletonDiff(d)}`), ...more(s.total, s.diffs.length));
      if (!p.outline.total) out.push('  outline: same');
      else out.push(`  outline: ${plural(p.outline.total, 'difference')}`, ...p.outline.diffs.map((d) => `    ${formatOutlineDiff(d)}`), ...more(p.outline.total, p.outline.diffs.length));
    }
    const left = ra.matches.length - rb.matches.length;
    if (left) out.push(`unpaired: ${plural(Math.abs(left), 'probed match', 'probed matches')} only in ${left > 0 ? 'A' : 'B'}`);
  });
  return out;
}

export const exitCodeFor = (e) => (e instanceof UsageError ? 2 : e && e.name === 'BotChallengeError' ? 3 : 1);

const firstLine = (s) => String(s).split('\n')[0];

function writeAtomic(file, text) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

// ---- probe --------------------------------------------------------------------------------------------

async function probeDoc(browser, target, input, opts) {
  const viewport = { width: opts.width, height: VIEWPORT_HEIGHT };
  const nav = { status: null, consent: null };
  const ctx = target.kind === 'http'
    ? await session.newLiveContext(browser, { locale: opts.locale || undefined, viewport })
    : await browser.newContext({ viewport, ...(opts.locale ? { locale: opts.locale === 'en' ? 'en-US' : opts.locale } : {}) });
  try {
    const page = await ctx.newPage();
    if (target.kind === 'http') {
      const resp = await session.gotoLive(page, target.url, { waitUntil: session.defaultWaitUntil(target.url), timeoutMs: opts.navTimeout, settleMs: session.isLiveHttpUrl(target.url) ? 2500 : 1200, solveWindow: opts.headed });
      nav.status = resp.status();
      // An EDS build/preview host gets no timed poll (lateWindowFor → 0): wait for its delayed phase, where a consent
      // manager the build enables loads, so the one sweep sees it (as page-probe does).
      if (session.isEdsHost(target.url)) await session.waitEdsDelayedPhase(page);
      const d = await session.dismissOverlays(page, { lateWindowMs: session.lateWindowFor(target.url) });
      nav.consent = d.consent;
    } else {
      await page.goto(target.url, { waitUntil: 'load', timeout: opts.navTimeout });
    }
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {}); // eslint-disable-line no-undef
    const raw = await page.evaluate(collectInPage, { selectors: opts.selectors, depth: opts.depth, maxMatches: MAX_MATCHES, walkCap: WALK_CAP, outlineCap: OUTLINE_CAP, textMax: TEXT_MAX });
    return shapeDoc(target, input, nav, raw, opts);
  } finally { await ctx.close().catch(() => {}); }
}

export async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const opts = parseArgs(args);
  if (opts.target.kind === 'file') assertFile(opts.target, opts.input);
  if (opts.compareTarget && opts.compareTarget.kind === 'file') assertFile(opts.compareTarget, opts.compare);
  const { chromium } = await import('playwright');
  const browser = opts.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  const docs = [];
  let err = null;
  try {
    docs.push(await probeDoc(browser, opts.target, opts.input, opts));
    if (opts.compareTarget) docs.push(await probeDoc(browser, opts.compareTarget, opts.compare, opts));
  } catch (e) { err = e; }
  finally { await browser.close().catch(() => {}); }
  const [a, b] = docs;
  if (err) {
    // B failed after A was measured: A's report still prints (text mode), then the error.
    if (a && !opts.json) for (const line of formatDoc(a, opts)) console.log(line);
    throw err;
  }
  const result = { tool: 'dom-probe', width: opts.width, depth: opts.depth, maxNodes: opts.maxNodes, a, ...(b ? { b, compare: compareDocs(a, b) } : {}) };
  if (opts.json && !opts.jsonFile) console.log(JSON.stringify(result, null, 2));
  else {
    for (const line of b ? formatCompare(a, b, result.compare, opts) : formatDoc(a, opts)) console.log(line);
    if (opts.jsonFile) { writeAtomic(opts.jsonFile, `${JSON.stringify(result, null, 2)}\n`); console.log(`json: ${opts.jsonFile}`); }
  }
  const bad = docs.flatMap((d) => d.roots.filter((r) => r.error));
  if (bad.length) throw new Error(`invalid selector ${bad[0].selector}: ${bad[0].error}`);
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(e instanceof UsageError ? `dom-probe: ${e.message} (--help for usage)` : `dom-probe error: ${firstLine(e.message)}`);
    process.exitCode = exitCodeFor(e);
  });
}
