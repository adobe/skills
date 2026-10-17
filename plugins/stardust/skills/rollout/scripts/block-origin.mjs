#!/usr/bin/env node
/**
 * rollout/block-origin.mjs — the source side of every delivered block: the CSS selector of its origin element
 * in the page's captured source DOM, written to stardust/rollout/workspace/mapping.json (formatVersion 0.1.0).
 *
 * A delivered document is walked with lib.mjs walkDelivered (coverage's records, with their nodes). A record's
 * text fragments (fragmentsOf, keyed with unit-geometry's keyed()) are located in the captured page
 * (indexSource + alignBlock: the element covering most of the record's text, the deepest on ties), and
 * stableSelector gives a CSS selector that resolves to exactly that element. Text is compared normalised and
 * with all whitespace removed (squash), so inline-element splits do not matter. querySelectorAll/countMatches
 * are a minimal selector engine over lib.mjs parseHtml (the plugin tree ships no dependency); syntax outside
 * its grammar throws UnsupportedSelector, and countMatches counts it as 0 hits. An encoder map's marker
 * comes before the text when it selects the block's element (its k-th match, confidence 1); a block it has
 * no element for falls through to its text, then to its position among its anchored neighbours; a section
 * takes the lowest common ancestor of its records; a template's sections are aligned across its pages and
 * their selectors generalised (buildMapping).
 *
 * Exports (pure): normText, squash, indexSource, fragmentsOf, alignBlock, lca, coveredShare, stableSelector,
 * parseSelector, querySelectorAll, countMatches, requireKeyed, buildMapping, verifyMapping, serialize,
 * countsOf; main (the CLI). unit-geometry.mjs is found in the plugin tree (../../diff/scripts/) or a project copy
 * (stardust/scripts/<skill>/: ../diff/); without either the import still succeeds, requireKeyed (so
 * fragmentsOf) throws an Error naming both places and the CLI exits 1.
 * Usage, inputs, outputs and exit codes: --help.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COVERAGE_FORMAT_VERSION, byStr, classList, contentFileFor, elements, isLink, onlyChild, parseHtml, readJSON, textOf, walkDelivered,
} from './lib.mjs';

const HELP = `block-origin — the source side of every delivered block: the CSS selector of its origin element in the
page's captured source DOM, written to stardust/rollout/workspace/mapping.json (formatVersion 0.1.0).

Usage: node skills/rollout/scripts/block-origin.mjs [--coverage <pages.json>] [--content <dir>] [--captures <dir>]
         [--eds-schema <dir>] [--encode <dir>] [--out <file>] [--verify] [--json]
  (paths are relative to the cwd, the project root)
  --coverage <file>   rollout coverage pages, formatVersion 0.1.0 (default stardust/rollout/coverage/pages.json)
  --content <dir>     the delivered documents, one content file per page path (default content)
  --captures <dir>    the captured source pages, <slug>.html (default stardust/current/pages)
  --eds-schema <dir>  per-page eds-schema <slug>.json: the roles of a section's default content (default
                      stardust/eds-schema; optional: without a page's file, the delivered default parts)
  --encode <dir>      encoder maps <dir>/<templateId>/vocabulary.json (root, markers[] with sel and emitter
                      block:<name>), taken before the text; markers apply under the root (page-wide without
                      one; not at all on a page where the root matches nothing or does not parse) (default
                      stardust/migrate/encode; optional; the shipped encoder keeps its maps under
                      stardust/import: pass --encode stardust/import)
  --out <file>        default stardust/rollout/workspace/mapping.json
  --verify            re-read and re-index every capture and count each selector's hits: an instance is
                      verified true (exactly one element) or false; a section's pages are re-checked (a
                      page may drop, none is added)
  --json              one JSON object on stdout instead of the status lines: { status, out, counts: { templates,
                      blocks, instances, verified, verifiedPct, sources, confidence: { high, medium, low, none },
                      positionBlocks }, skipped }; notes go to stderr

Per page (coverage pages in slug order with a delivered structure, a content file and a capture), each
delivered block is located in its capture by its template's encoder map when the map selects its element
(the first marker emitting block:<name>: the k-th block of that name takes the marker's k-th match under
the map's root; confidence 1), else by its text (the element covering most of it, the deepest on ties;
confidence = the share covered), else by its position among its anchored neighbours (confidence 0; never
an element another record already has). A section takes the lowest common ancestor of its records
(confidence = the share of their text it holds, the lowest over the pages); its default-content roles are
the page's eds-schema roles of its text (an equal text, else the shorter of the two, 8+ characters, inside
the other), else its delivered default parts. A template's sections are aligned across its pages by style
and block names; a section's selector is the generalisation that resolves to that page's own section
element (its one hit) on the most of its pages (its pages lists them). Text is compared normalised
(NFKC, lower case, typographic quotes and dashes folded) with whitespace removed; selectors follow lib.mjs
parseHtml's tree (no inserted tbody, no auto-closed p). Without --verify every instance records verified
null (skipped).

Stdout: templates N · blocks N · instances N · verified P % (the share verified true; verified skipped
without --verify, verified n/a without instances); sources encoder-map N · text-alignment N ·
position N; confidence ≥0.9 N · 0.5–<0.9 N · >0–<0.5 N · 0 N; position fallback: <block> ×N, … and
skipped: N (<reason> ×N, …) when any; one line per unreadable encoder map (ignored); last, → <out>
(written|unchanged).

Outputs: <out>, keys sorted, generatedAt copied from the coverage (no clock); rewritten only when the bytes
differ. Under skipped: pages without a delivered structure, a content file or a capture, or whose capture
cannot be indexed, and coverage blocks the delivered document no longer has.

Exit: 0 written or unchanged, whatever verification found; 1 a missing input, nothing written (coverage
missing, unreadable, without formatVersion or pages[], or of another formatVersion; --content or
--captures missing; unit-geometry.mjs in neither skills/diff/scripts/ nor stardust/scripts/diff/);
2 usage (unknown flag, missing value), nothing read or written.
`;

const safeRealpath = (p) => { try { return realpathSync(p); } catch { return p; } };
const isMain = () => !!process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1]);
// --help is answered before any other work, unit-geometry's lookup included.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h') && isMain()) {
  process.stdout.write(HELP);
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** unit-geometry's keyed() in either layout, or the reason it is unavailable. */
async function loadKeyed() {
  const at = [join(HERE, '..', '..', 'diff', 'scripts', 'unit-geometry.mjs'), join(HERE, '..', 'diff', 'unit-geometry.mjs')].find((p) => existsSync(p));
  if (!at) return { error: 'unit-geometry.mjs not found (../../diff/scripts/ or ../diff/): copy the diff skill\'s scripts next to these' };
  try {
    const { keyed } = await import(pathToFileURL(at).href);
    return typeof keyed === 'function' ? { keyed } : { error: `unit-geometry.mjs exports no keyed() (${at})` };
  } catch (e) {
    return { error: `unit-geometry.mjs did not load (${at}): ${String(e && e.message).split('\n')[0]}` };
  }
}
const KEYED = await loadKeyed();

/** unit-geometry's keyed(); throws an Error naming both places it was looked for when it is unavailable. */
export function requireKeyed() {
  if (!KEYED.keyed) throw new Error(KEYED.error);
  return KEYED.keyed;
}

// --- text ------------------------------------------------------------------------------------------
const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u2035]/g;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033\u2036]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;

/** NFKC, lower case, typographic quotes/primes → ' and ", dashes and minus → -, … → ..., NBSP → space, whitespace collapsed. */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(DASHES, '-')
    .replace(/\u2026/g, '...').replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** normText without any whitespace: the form text containment and lengths are measured in. */
export const squash = (s) => normText(s).replace(/\s+/g, '');

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const round3 = (x) => Math.round(x * 1000) / 1000;

// --- source DOM index ------------------------------------------------------------------------------
// Subtrees whose text a reader does not see as page content.
const NO_TEXT = new Set(['head', 'noscript', 'template', 'svg', 'iframe']);

/**
 * indexSource(html) → { root, body, els, meta, ids } over lib.mjs parseHtml(html):
 * - root: the parseHtml root (`#root`, not an element); body: the first `body` element, else root;
 * - els: every element in document order;
 * - meta: Map node (every element, and root) → { parent, depth, order, end, text, index, count, typeIndex,
 *   typeCount }: parent node (root for a top-level element, null for root); depth (0 top-level, -1 root);
 *   order = position in els (-1 root); end = order of its last descendant (b lies inside a when
 *   a.order < b.order <= a.end); text = squash of its descendant text, nothing from head, noscript,
 *   template, svg or iframe; index/count = 1-based position among its parent's element children and their
 *   number, typeIndex/typeCount the same among those with its tag;
 * - ids: Map id → number of elements carrying it.
 */
export function indexSource(html) {
  const root = parseHtml(html);
  const els = [];
  const meta = new Map();
  const ids = new Map();
  const visit = (n, parent, depth, mute, pos) => {
    const m = { parent, depth, order: parent ? els.length : -1, end: -1, text: '', ...pos };
    meta.set(n, m);
    if (parent) {
      els.push(n);
      const id = n.attrs && n.attrs.id;
      if (id) ids.set(id, (ids.get(id) || 0) + 1);
    }
    const off = mute || NO_TEXT.has(n.tag);
    const kids = elements(n);
    const ofTag = new Map();
    for (const c of kids) ofTag.set(c.tag, (ofTag.get(c.tag) || 0) + 1);
    const seen = new Map();
    let raw = '';
    let k = 0;
    for (const c of n.children || []) {
      if (c.tag === '#text') { if (!off) raw += c.text; continue; }
      k += 1;
      const t = (seen.get(c.tag) || 0) + 1;
      seen.set(c.tag, t);
      raw += visit(c, n, depth + 1, off, { index: k, count: kids.length, typeIndex: t, typeCount: ofTag.get(c.tag) });
    }
    m.end = els.length - 1;
    m.text = squash(raw);
    return off ? '' : raw;
  };
  visit(root, null, -1, false, { index: 1, count: 1, typeIndex: 1, typeCount: 1 });
  return { root, body: els.find((e) => e.tag === 'body') || root, els, meta, ids };
}

const parentEl = (index, el) => { const p = index.meta.get(el).parent; return p && p !== index.root ? p : null; };
const contains = (index, a, b) => {
  const [ma, mb] = [index.meta.get(a), index.meta.get(b)];
  return a === b || (ma.order < mb.order && mb.order <= ma.end);
};

// --- delivered fragments -----------------------------------------------------------------------------
const CONTAINERS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'blockquote', 'figcaption', 'td', 'th', 'pre']);
const PHRASING = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins',
  'kbd', 'mark', 'picture', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
const phrasing = (n) => PHRASING.has(n.tag) && elements(n).every(phrasing);
// A div cell's own text: its direct text plus that of inline children (a link, emphasis) that hold no block.
const ownText = (div) => (div.children || []).map((c) => (c.tag === '#text' ? c.text : phrasing(c) ? textOf(c) : ' ')).join('');

/**
 * fragmentsOf(nodes) → [{ role, sel, text, key }] in document order for one delivered block div or a default
 * record's node array: h1–h6 → heading; p li dt dd blockquote figcaption td th pre → link when the
 * container's only content is a link (an `a`, or strong/em wrapping a lone `a`), else text — the outermost
 * container only; a div cell's own text (direct text and inline children) → text; img → image with its alt as
 * text (for its key only: alignment and confidence skip images). Empty containers and cells give none. `sel` is
 * a path from the node (`div[1]/div[2]/p[1]`); `key` is unit-geometry's keyed() (duplicates get ` #2`).
 */
export function fragmentsOf(nodes) {
  const keyed = requireKeyed();
  const out = [];
  const visit = (n, sel, inside) => {
    if (n.tag === 'img') { out.push({ role: 'image', sel, text: clean(n.attrs && n.attrs.alt) }); return; }
    let within = inside;
    if (!inside && CONTAINERS.has(n.tag)) {
      within = true;
      const text = clean(textOf(n));
      if (text) out.push({ role: /^h[1-6]$/.test(n.tag) ? 'heading' : isLink(onlyChild(n)) ? 'link' : 'text', sel, text });
    } else if (!inside && n.tag === 'div') {
      const text = clean(ownText(n));
      if (text) out.push({ role: 'text', sel, text });
    }
    elements(n).forEach((c, k) => visit(c, `${sel}/${c.tag}[${k + 1}]`, within));
  };
  (Array.isArray(nodes) ? nodes : [nodes]).filter((n) => n && n.tag && n.tag !== '#text')
    .forEach((n, k) => visit(n, `${n.tag}[${k + 1}]`, false));
  return keyed(out).map(({ role, sel, text, key }) => ({ role, sel, text, key }));
}

// --- text alignment ----------------------------------------------------------------------------------
// Cell text only: an image's alt is an attribute and the source index holds text nodes only (R17).
const textFragments = (fragments) => (fragments || []).filter((f) => f && f.role !== 'image')
  .map((f) => ({ key: f.key, s: squash(f.text) })).filter((f) => f.s);
const lengthOf = (frags) => frags.reduce((n, f) => n + f.s.length, 0);

/** The deepest elements at or under `start` whose text contains `s`. */
function deepest(index, start, s) {
  const out = [];
  const go = (n) => {
    const kids = elements(n).filter((c) => index.meta.get(c).text.includes(s));
    if (kids.length) kids.forEach(go); else out.push(n);
  };
  if (index.meta.get(start).text.includes(s)) go(start);
  return out;
}

/**
 * alignBlock(index, fragments) → { anchor, confidence, covered, total, unmatched }. Text fragments are the
 * non-image fragments with a non-empty squashed text (an image's alt never counts); total = the sum of their
 * lengths. Each one covers (once) the deepest elements under body containing it and all their ancestors up to
 * body; the anchor is the element covering the most, then (on equal coverage) the one whose own text is the
 * shortest — closest to the fragments, so an element holding exactly a heading beats a deeper paragraph that
 * merely contains it — then the deepest, then the first in document order;
 * confidence = covered / total (3 decimals); unmatched = the keys of text fragments found nowhere. No text
 * fragment (an image-only block included) → anchor null and zeros.
 */
export function alignBlock(index, fragments) {
  const frags = textFragments(fragments);
  const total = lengthOf(frags);
  const covered = new Map();
  const unmatched = [];
  for (const f of frags) {
    if (!index.meta.get(index.body).text.includes(f.s)) { unmatched.push(f.key); continue; }
    const hit = new Set();
    for (const d of deepest(index, index.body, f.s)) {
      for (let n = d; n && n !== index.root; n = n === index.body ? null : index.meta.get(n).parent) hit.add(n);
    }
    for (const n of hit) covered.set(n, (covered.get(n) || 0) + f.s.length);
  }
  let [anchor, best] = [null, 0];
  for (const [n, c] of covered) {
    const [m, a] = [index.meta.get(n), anchor && index.meta.get(anchor)];
    const tie = () => m.text.length < a.text.length
      || (m.text.length === a.text.length && (m.depth > a.depth || (m.depth === a.depth && m.order < a.order)));
    if (!a || c > best || (c === best && tie())) [anchor, best] = [n, c];
  }
  return { anchor, confidence: anchor ? round3(best / total) : 0, covered: best, total, unmatched };
}

/** Lowest common ancestor element of `els` (nulls ignored): the element itself for one, null for none. */
export function lca(index, els) {
  const list = (els || []).filter((e) => e && e !== index.root && index.meta.has(e));
  if (!list.length) return null;
  let a = list[0];
  for (const b of list.slice(1)) {
    while (a && !contains(index, a, b)) a = parentEl(index, a);
    if (!a) return null;
  }
  return a;
}

/** Share (3 decimals) of the text fragments' squashed text (images skipped, as in alignBlock) contained in `el`'s text; 0 without text or element. */
export function coveredShare(index, el, fragments) {
  const frags = textFragments(fragments);
  const total = lengthOf(frags);
  const m = el && index.meta.get(el);
  if (!total || !m) return 0;
  return round3(lengthOf(frags.filter((f) => m.text.includes(f.s))) / total);
}

// --- selector engine ---------------------------------------------------------------------------------
const unsupported = (sel, why) => Object.assign(new Error(`unsupported selector ${JSON.stringify(sel)}: ${why}`), { name: 'UnsupportedSelector' });
const WS = /[ \t\n\r\f]/;
const isHex = (c) => !!c && /[0-9a-fA-F]/.test(c);
const nameStart = (c) => !!c && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);
const nameChar = (c) => !!c && (/[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80);
const PSEUDOS = new Set(['first-child', 'last-child', 'first-of-type', 'last-of-type']);
const NTH = new Set(['nth-child', 'nth-of-type']);
const ATTR_OPS = ['~=', '^=', '$=', '*=', '='];

/**
 * parseSelector(selector) → [complex], complex = [{ combinator, tag, ids, classes, attrs, pseudos }] left to
 * right, combinator (' ' or '>') joining a compound to the one before (null for the first). Grammar: lists
 * (,), descendant and > combinators; tag or *, #id, .class, [attr], [attr=v], [attr~=v], [attr^=v], [attr$=v],
 * [attr*=v] (quoted or identifier values), :nth-of-type(n), :nth-child(n) (an integer), :first-child,
 * :last-child, :first-of-type, :last-of-type; backslash escapes. Anything else throws UnsupportedSelector.
 */
export function parseSelector(selector) {
  const s = String(selector ?? '');
  let i = 0;
  const fail = (why) => { throw unsupported(s, why); };
  const ws = () => { const at = i; while (i < s.length && WS.test(s[i])) i += 1; return i > at; };
  const escape = () => {
    i += 1;
    if (i >= s.length || /[\n\r\f]/.test(s[i])) fail('a backslash escapes nothing');
    if (isHex(s[i])) {
      let h = '';
      while (h.length < 6 && isHex(s[i])) { h += s[i]; i += 1; }
      if (s[i] === '\r' && s[i + 1] === '\n') i += 2; else if (WS.test(s[i] || '')) i += 1;
      const cp = parseInt(h, 16);
      return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '\ufffd' : String.fromCodePoint(cp);
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    i += ch.length;
    return ch;
  };
  const ident = () => {
    const at = i;
    let out = '';
    if (s[i] === '-') { out = '-'; i += 1; }
    if (out && s[i] === '-') { out = '--'; i += 1; } else if (!(nameStart(s[i]) || s[i] === '\\')) { i = at; return null; }
    while (i < s.length) {
      if (s[i] === '\\') out += escape();
      else if (nameChar(s[i])) { out += s[i]; i += 1; } else break;
    }
    return out;
  };
  const string = () => {
    const q = s[i];
    let out = '';
    for (i += 1; i < s.length && s[i] !== q;) {
      if (s[i] === '\\' && s[i + 1] === '\n') i += 2;
      else if (s[i] === '\\') out += escape();
      else if (s[i] === '\n') fail('a newline inside a string');
      else { out += s[i]; i += 1; }
    }
    if (s[i] !== q) fail('an unterminated string');
    i += 1;
    return out;
  };
  const attribute = () => {
    i += 1;
    ws();
    const name = ident();
    if (name === null) fail('an attribute without a name');
    ws();
    let [op, value] = [null, null];
    if (s[i] !== ']') {
      op = ATTR_OPS.find((o) => s.startsWith(o, i));
      if (!op) fail(i >= s.length ? 'an unclosed [' : `the attribute operator at ${JSON.stringify(s.slice(i, i + 2))}`);
      i += op.length;
      ws();
      value = s[i] === '"' || s[i] === "'" ? string() : ident();
      if (value === null) fail('an attribute value that is neither quoted nor an identifier');
      ws();
    }
    if (s[i] !== ']') fail(i >= s.length ? 'an unclosed [' : 'attribute flags');
    i += 1;
    return { name: name.toLowerCase(), op, value };
  };
  const pseudo = () => {
    if (s[i + 1] === ':') fail('pseudo-elements');
    i += 1;
    const name = (ident() || '').toLowerCase();
    if (PSEUDOS.has(name)) return { name };
    if (!NTH.has(name) || s[i] !== '(') return fail(`:${name || s[i] || ''}`);
    const close = s.indexOf(')', i);
    const arg = close < 0 ? '' : s.slice(i + 1, close);
    if (close < 0 || !/^[ \t\n\r\f]*\+?\d+[ \t\n\r\f]*$/.test(arg)) fail(`:${name}(${arg}) — only an integer`);
    i = close + 1;
    return { name, n: parseInt(arg.trim(), 10) };
  };
  const compound = () => {
    const c = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
    let any = false;
    if (s[i] === '*') { i += 1; any = true; } else { const t = ident(); if (t !== null) { c.tag = t.toLowerCase(); any = true; } }
    if (s[i] === '|') fail('namespaces');
    for (;;) {
      if (s[i] === '#' || s[i] === '.') {
        const kind = s[i];
        i += 1;
        const name = ident();
        if (name === null) fail(`a ${kind === '#' ? 'id' : 'class'} without a name`);
        (kind === '#' ? c.ids : c.classes).push(name);
      } else if (s[i] === '[') c.attrs.push(attribute());
      else if (s[i] === ':') c.pseudos.push(pseudo());
      else break;
      any = true;
    }
    return any ? c : null;
  };
  const list = [];
  ws();
  for (;;) {
    const complex = [];
    let combinator = null;
    for (;;) {
      const c = compound();
      if (!c) fail(i >= s.length ? 'an unexpected end' : `an unexpected ${JSON.stringify(s[i])}`);
      complex.push({ combinator, ...c });
      const spaced = ws();
      if (i >= s.length || s[i] === ',') break;
      if (s[i] === '>') { i += 1; ws(); combinator = '>'; continue; }
      if (s[i] === '+' || s[i] === '~') fail(`the ${s[i]} combinator`);
      if (!spaced) fail(`an unexpected ${JSON.stringify(s[i])}`);
      combinator = ' ';
    }
    list.push(complex);
    if (i >= s.length) return list;
    i += 1;
    ws();
  }
}

function matchAttr(attrs, { name, op, value }) {
  if (!Object.hasOwn(attrs, name)) return false;
  const v = attrs[name];
  if (op === null) return true;
  if (op === '=') return v === value;
  if (value === '') return false;
  if (op === '~=') return !/[ \t\n\r\f]/.test(value) && v.split(/[ \t\n\r\f]+/).includes(value);
  if (op === '^=') return v.startsWith(value);
  if (op === '$=') return v.endsWith(value);
  return v.includes(value);
}

function matchPseudo(m, { name, n }) {
  if (name === 'first-child') return m.index === 1;
  if (name === 'last-child') return m.index === m.count;
  if (name === 'first-of-type') return m.typeIndex === 1;
  if (name === 'last-of-type') return m.typeIndex === m.typeCount;
  return (name === 'nth-child' ? m.index : m.typeIndex) === n;
}

function matchCompound(index, el, c) {
  if (c.tag && el.tag !== c.tag) return false;
  const attrs = el.attrs || {};
  if (c.ids.some((id) => attrs.id !== id)) return false;
  if (c.classes.length) { const cl = classList(el); if (c.classes.some((k) => !cl.includes(k))) return false; }
  if (c.attrs.some((a) => !matchAttr(attrs, a))) return false;
  const m = index.meta.get(el);
  return c.pseudos.every((p) => matchPseudo(m, p));
}

function matchComplex(index, el, complex, k) {
  if (!matchCompound(index, el, complex[k])) return false;
  if (k === 0) return true;
  if (complex[k].combinator === '>') { const p = parentEl(index, el); return !!p && matchComplex(index, p, complex, k - 1); }
  for (let p = parentEl(index, el); p; p = parentEl(index, p)) if (matchComplex(index, p, complex, k - 1)) return true;
  return false;
}

/** The elements matching `selector`, in document order (each once); throws UnsupportedSelector outside the grammar. */
export function querySelectorAll(index, selector) {
  const list = parseSelector(selector);
  return index.els.filter((el) => list.some((complex) => matchComplex(index, el, complex, complex.length - 1)));
}

/** Number of elements matching `selector`; 0 for a selector outside the grammar (never throws for one). */
export function countMatches(index, selector) {
  try { return querySelectorAll(index, selector).length; } catch (e) { if (e && e.name === 'UnsupportedSelector') return 0; throw e; }
}

// --- stable selectors --------------------------------------------------------------------------------
const STATE = new Set(['active', 'current', 'open', 'show', 'shown', 'selected', 'visible', 'hidden', 'collapsed', 'expanded', 'disabled']);
// A digit run of 4+ or an 8+ character hex-like token with a digit: a build hash, a CMS counter, a uuid.
const generated = (t) => /\d{4,}/.test(t) || (t.length >= 8 && /^[0-9a-f-]+$/i.test(t) && /\d/.test(t));
const stableId = (id) => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && !generated(id);
const stableClass = (c) => /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(c) && !generated(c) && !STATE.has(c.toLowerCase()) && !/^(is|has|js)-/i.test(c);
const stableClasses = (el) => [...new Set(classList(el).filter(stableClass))];
const cssEscape = (s) => [...String(s)].map((ch) => (/[A-Za-z0-9_-]/.test(ch) || ch.codePointAt(0) >= 0x80 ? ch
  : /[\x00-\x1f\x7f]/.test(ch) ? `\\${ch.codePointAt(0).toString(16)} ` : `\\${ch}`)).join('');
const compoundOf = (el) => `${cssEscape(el.tag)}${stableClasses(el).map((c) => `.${c}`).join('')}`;
const uniqueId = (index, el) => { const id = el.attrs && el.attrs.id; return stableId(id) && index.ids.get(id) === 1 ? id : null; };
const resolvesTo = (index, sel, el) => {
  try { const hits = querySelectorAll(index, sel); return hits.length === 1 && hits[0] === el; } catch (e) { if (e && e.name === 'UnsupportedSelector') return false; throw e; }
};
const stepOf = (index, el) => { const m = index.meta.get(el); return `${compoundOf(el)}${m.typeCount > 1 ? `:nth-of-type(${m.typeIndex})` : ''}`; };

/**
 * stableSelector(index, el) → a CSS selector resolving to exactly `el`, the first unique of: `#id` (a stable,
 * unique id); its own compound `tag.c1.c2` (stable classes in attribute order, at least one); the nearest
 * ancestor anchor (`#id` stable and unique, else its unique compound) + ' ' + its own compound (a bare tag
 * without stable classes); the structural path from `el` up to the nearest ancestor with a stable unique id
 * (`#id`) or to body (`body`), each step tag + stable classes + `:nth-of-type(k)` when the parent has more
 * than one child of that tag, joined with ' > '. Stable: no 4+ digit run, not an 8+ character hex-like token
 * with a digit; a class also not a state (active, current, open, show(n), selected, visible, hidden,
 * collapsed, expanded, disabled, is-*, has-*, js-*). null for no element, or a path that is not unique (a
 * malformed document).
 */
export function stableSelector(index, el) {
  if (!el || el === index.root || !index.meta.has(el)) return null;
  const id = uniqueId(index, el);
  if (id) return `#${id}`;
  const own = compoundOf(el);
  if (stableClasses(el).length && resolvesTo(index, own, el)) return own;
  for (let a = parentEl(index, el); a; a = parentEl(index, a)) {
    const aid = uniqueId(index, a);
    const anchor = aid ? `#${aid}` : stableClasses(a).length && countMatches(index, compoundOf(a)) === 1 ? compoundOf(a) : null;
    if (!anchor) continue;
    // a farther anchor holds everything a nearer one does: if this one is not unique, none is
    if (resolvesTo(index, `${anchor} ${own}`, el)) return `${anchor} ${own}`;
    break;
  }
  const steps = [];
  for (let n = el; ;) {
    if (n === index.body) { steps.unshift('body'); break; }
    const nid = n !== el && uniqueId(index, n);
    if (nid) { steps.unshift(`#${nid}`); break; }
    steps.unshift(stepOf(index, n));
    n = parentEl(index, n);
    if (!n) break;
  }
  const path = steps.join(' > ');
  return resolvesTo(index, path, el) ? path : null;
}

// --- one page --------------------------------------------------------------------------------------
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const pathSafe = (s) => typeof s === 'string' && s !== '' && !s.split(/[\\/]/).some((x) => x === '..' || x === '');
const uniq = (xs) => [...new Set(xs)];
// A selector count that never throws: outside the grammar, or too deep a document to match, is 0 hits.
const hitsOf = (index, sel) => { try { return countMatches(index, sel); } catch (e) { if (e instanceof RangeError) return 0; throw e; } };
const safeQuery = (index, sel) => { try { return querySelectorAll(index, sel); } catch (e) { if (e && e.name === 'UnsupportedSelector') return []; throw e; } };
// Whether `sel` hits exactly one element of the page and it is `el` (a page too deep to match: no).
const hitsOnly = (index, sel, el) => {
  if (!el) return false;
  try { const hits = safeQuery(index, sel); return hits.length === 1 && hits[0] === el; } catch (e) { if (e instanceof RangeError) return false; throw e; }
};
const elementSibling = (index, el, step) => {
  const m = index.meta.get(el);
  return m && m.parent ? elements(m.parent)[m.index - 1 + step] || null : null;
};


/** eds-schema items `{ role, s }` of a page (`sections[].items[]` or `items[]`, role + text), or null without a readable file. */
function edsItems(dir, slug) {
  if (!dir || !pathSafe(slug)) return null;
  const doc = readJSON(join(dir, `${slug}.json`));
  if (!doc || typeof doc !== 'object') return null;
  const from = (xs) => (Array.isArray(xs) ? xs : []);
  return [...from(doc.items), ...from(doc.sections).flatMap((s) => from(s && s.items))]
    .filter((it) => it && typeof it.role === 'string' && it.role && typeof it.text === 'string')
    .map((it) => ({ role: it.role, s: squash(it.text) })).filter((it) => it.s);
}

/** A section's default-content roles (R5): the eds-schema roles of its default text, first seen, else its delivered default parts. */
function defaultRoles(recs, eds) {
  const roles = [];
  // an item matches a fragment on an equal text; else the shorter text, 8+ characters, inside the other
  const inside = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 8 && l.includes(s); };
  if (eds && eds.length) {
    for (const f of recs.flatMap((r) => textFragments(r.frags))) {
      const hit = eds.find((it) => it.s === f.s) || eds.find((it) => inside(it.s, f.s));
      if (hit && !roles.includes(hit.role)) roles.push(hit.role);
    }
  }
  return roles.length ? roles : uniq(recs.flatMap((r) => String(r.cov.variant || '').split('+').filter(Boolean)));
}

/**
 * Position fallback for record `r` (the i-th of `recs`) of section `sec`: the element among its neighbours
 * a block without an anchor most likely came from. `anchorOf` gives a record's anchor, or the element an
 * earlier fallback chose (so consecutive fallbacks do not share one element). With a section anchor S that
 * is not itself a record's anchor: among S's element children (claimed when holding a record's element),
 * the first free child after the one holding the previous record (same section), else the last free one
 * before the one holding the next, else the first free one, else S. Otherwise: the previous record's next
 * element sibling, else the next record's previous element sibling — each walking up the ancestors (up to,
 * not past, body) until one exists. An element another record already has (its anchor, or an earlier
 * fallback's choice) is never chosen: the next option is tried, and when none is left, null.
 */
function positionOf(index, recs, i, sec, sectionOf, anchorOf) {
  const near = (list) => list.find((x) => sec && sectionOf.get(x) === sec && anchorOf(x)) || list.find((x) => anchorOf(x)) || null;
  const prev = near(recs.slice(0, i).reverse());
  const next = near(recs.slice(i + 1));
  const taken = new Set(recs.filter((x, j) => j !== i).map(anchorOf).filter(Boolean));
  const pick = (...els) => els.find((el) => el && !taken.has(el)) || null;
  const S = sec && sec.anchor && !sec.own.some((x) => x.anchor === sec.anchor) ? sec.anchor : null;
  if (S) {
    const kids = elements(S);
    const childOf = (x) => (x && sectionOf.get(x) === sec && anchorOf(x) ? kids.findIndex((c) => contains(index, c, anchorOf(x))) : -1);
    const claimed = new Set(sec.own.map(childOf).filter((k) => k >= 0));
    const free = (j) => !claimed.has(j);
    const [p, n] = [childOf(prev), childOf(next)];
    return pick(
      p >= 0 ? kids.find((c, j) => j > p && free(j)) : null,
      n >= 0 ? kids.findLast((c, j) => j < n && free(j)) : null,
      kids.find((c, j) => free(j)),
      S,
    );
  }
  const sibling = (from, step) => {
    for (let a = from; a && a !== index.body; a = parentEl(index, a)) {
      const sib = elementSibling(index, a, step);
      if (sib) return sib;
    }
    return null;
  };
  return pick(sibling(prev && anchorOf(prev), 1), sibling(next && anchorOf(next), -1));
}

/**
 * One page: coverage row `row` (with delivered), its delivered document `contentHtml`, its capture's
 * `index`, the template's encoder map `map` ({ root, markers } or null) and the page's eds-schema items.
 * → { slug, index, sections: [{ pos, style, sig, names, anchor, selector, confidence, defaultContent }],
 * instances: [{ pos, block, variant, variantId, sectionPos, selector, confidence, source }], skipped }.
 */
function mapPage(row, contentHtml, index, { map = null, eds = null } = {}) {
  const slug = row.slug;
  const doc = walkDelivered(contentHtml);
  const queues = new Map();
  const occurrence = new Map();
  for (const d of doc.records) {
    const q = `${d.kind}|${d.block}`;
    if (!queues.has(q)) queues.set(q, []);
    occurrence.set(d, queues.get(q).length);
    queues.get(q).push(d);
  }
  const skipped = [];
  const covered = (Array.isArray(row.delivered.blocks) ? row.delivered.blocks : [])
    .filter((r) => r && (r.kind === 'block' || r.kind === 'default') && typeof r.block === 'string' && Number.isInteger(r.pos) && r.pos >= 0);
  // Each coverage record takes the next unused document record of its kind and name.
  const recs = covered.map((cov) => {
    const q = queues.get(`${cov.kind}|${cov.block}`);
    const d = q && q.length ? q.shift() : null;
    if (!d && cov.kind === 'block') skipped.push({ slug, block: cov.block, pos: cov.pos, reason: 'not in the delivered document' });
    const frags = d ? fragmentsOf(cov.kind === 'block' ? [doc.nodes[d.pos]] : doc.nodes[d.pos]) : [];
    return { cov, doc: d, frags, anchor: null, selector: null, confidence: 0, source: null };
  });
  // An encoder map's marker first (the k-th block of a name takes the marker's k-th match); a block it has no
  // element for falls through to its text, then its position, as without a map.
  // Without a root the markers apply page-wide; a root that matches nothing here (or does not parse) means
  // the map does not apply on this page.
  const rootEls = map && map.root !== null ? safeQuery(index, map.root) : null;
  const applies = !!map && (rootEls === null || rootEls.length > 0);
  const matchesOf = new Map();
  const matches = (m) => {
    if (!matchesOf.has(m)) {
      const all = safeQuery(index, m.sel);
      matchesOf.set(m, rootEls ? all.filter((el) => rootEls.some((r) => r !== el && contains(index, r, el))) : all);
    }
    return matchesOf.get(m);
  };
  for (const r of recs) {
    if (!r.doc) continue;
    const marker = applies && r.cov.kind === 'block' ? map.markers.find((m) => m.emitter === `block:${r.cov.block}`) : null;
    const el = marker ? matches(marker)[occurrence.get(r.doc)] : null;
    if (el) {
      Object.assign(r, { anchor: el, selector: stableSelector(index, el), confidence: 1, source: 'encoder-map' });
      continue;
    }
    const a = alignBlock(index, r.frags);
    r.anchor = a.anchor;
    if (r.cov.kind !== 'block') continue;
    if (a.anchor) Object.assign(r, { selector: stableSelector(index, a.anchor), confidence: a.confidence, source: 'text-alignment' });
    else r.source = 'position';
  }
  const byPos = new Map(recs.map((r) => [r.cov.pos, r]));
  const sectionOf = new Map();
  const sections = (Array.isArray(row.delivered.sections) ? row.delivered.sections : []).filter((s) => s && Array.isArray(s.blocks)).map((s) => {
    const own = s.blocks.map((p) => byPos.get(p)).filter(Boolean);
    const names = own.filter((r) => r.cov.kind === 'block').map((r) => r.cov.block);
    const anchor = lca(index, own.map((r) => r.anchor));
    const sec = {
      pos: s.pos, style: s.style ?? null, own, anchor, names, sig: `${s.style ?? ''}|${names.join(',')}`,
      confidence: anchor ? coveredShare(index, anchor, own.flatMap((r) => r.frags)) : 0,
      defaultContent: defaultRoles(own.filter((r) => r.cov.kind === 'default'), eds),
    };
    own.forEach((r) => sectionOf.set(r, sec));
    return sec;
  });
  const placed = new Map();
  const anchorOf = (r) => r.anchor || placed.get(r) || null;
  recs.forEach((r, i) => {
    if (r.source !== 'position') return;
    const el = positionOf(index, recs, i, sectionOf.get(r) || null, sectionOf, anchorOf);
    if (el) placed.set(r, el);
    r.selector = el ? stableSelector(index, el) : null;
  });
  return {
    slug,
    index,
    sections: sections.map(({ own, ...s }) => ({ ...s, selector: stableSelector(index, s.anchor) })),
    instances: recs.filter((r) => r.doc && r.cov.kind === 'block').map((r) => ({
      pos: r.cov.pos, block: r.cov.block, variant: r.cov.variant ?? null, variantId: r.cov.variantId ?? null,
      sectionPos: sectionOf.has(r) ? sectionOf.get(r).pos : null, selector: r.selector, confidence: r.confidence, source: r.source,
    })),
    skipped,
  };
}

// --- per template ----------------------------------------------------------------------------------
/** Index pairs [i, j] of a longest common subsequence of `a` and `b` (earliest matches first). */
function lcsPairs(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { out.push([i, j]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) i += 1; else j += 1;
  }
  return out;
}

const identText = (s) => cssEscape(s).replace(/^(-?)(\d)/, (m, d, c) => `${d}\\3${c} `);
const cssString = (s) => `"${[...String(s)].map((ch) => (ch === '"' || ch === '\\' ? `\\${ch}` : /[\x00-\x1f\x7f]/.test(ch) ? `\\${ch.codePointAt(0).toString(16)} ` : ch)).join('')}"`;
const compoundText = ({ tag, ids, classes, attrs, pseudos }) => `${tag ? identText(tag) : ''}${ids.map((x) => `#${identText(x)}`).join('')}${classes.map((x) => `.${identText(x)}`).join('')}${
  attrs.map((a) => `[${identText(a.name)}${a.op ? `${a.op}${cssString(a.value)}` : ''}]`).join('')}${pseudos.map((p) => (p.n != null ? `:${p.name}(${p.n})` : `:${p.name}`)).join('')}` || '*';

/**
 * The per-step generalisation of selectors with the same steps and combinators: per step the common tag
 * (a differing tag → null), the id when equal on all, the classes common to all (the first's order), the
 * attributes and pseudo-classes equal on all (a varying :nth-of-type is dropped). null when not comparable.
 */
function mergeSteps(sels) {
  let parsed;
  try { parsed = sels.map((s) => parseSelector(s)); } catch (e) { if (e && e.name === 'UnsupportedSelector') return null; throw e; }
  if (parsed.some((l) => l.length !== 1)) return null;
  const cx = parsed.map(([c]) => c);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (cx.some((c) => c.length !== cx[0].length || c.some((st, i) => st.combinator !== cx[0][i].combinator))) return null;
  let out = '';
  for (let i = 0; i < cx[0].length; i += 1) {
    const steps = cx.map((c) => c[i]);
    const [first] = steps;
    if (steps.some((st) => st.tag !== first.tag)) return null;
    const step = {
      tag: first.tag,
      ids: steps.every((st) => same(st.ids, first.ids)) ? first.ids : [],
      classes: first.classes.filter((k) => steps.every((st) => st.classes.includes(k))),
      attrs: first.attrs.filter((a) => steps.every((st) => st.attrs.some((b) => same(a, b)))),
      pseudos: first.pseudos.filter((p) => steps.every((st) => st.pseudos.some((q) => same(p, q)))),
    };
    out += `${i ? (first.combinator === '>' ? ' > ' : ' ') : ''}${compoundText(step)}`;
  }
  return out;
}

/**
 * A section's template-level selector over `entries` ([{ slug, index, selector, anchor }], the pages that
 * have it, representative first, then slug order; anchor = that page's own section element): the first
 * candidate — the common selector, the per-step generalisation, the representative's, the others' —
 * resolving on every page, else the one resolving on the most (ties → earlier); a candidate resolves on a
 * page only when its one hit there is that page's own section element. → { selector, pages (sorted slugs
 * it resolved on) }.
 */
function generalise(entries) {
  const sels = entries.map((e) => e.selector).filter(Boolean);
  if (!sels.length) return { selector: null, pages: [] };
  const cands = uniq([...(sels.every((s) => s === sels[0]) ? [sels[0]] : []), mergeSteps(sels), ...sels].filter(Boolean));
  let best = null;
  for (const c of cands) {
    const pages = entries.filter((e) => hitsOnly(e.index, c, e.anchor)).map((e) => e.slug);
    if (!best || pages.length > best.pages.length) best = { selector: c, pages };
    if (pages.length === entries.length) break;
  }
  return { selector: best.selector, pages: best.pages.sort(byStr) };
}

/**
 * One template from its mapped pages (slug order). The representative (slug = templateId, else the first)
 * gives the section list s1…sN; each other page's sections are LCS-aligned on their signature (style +
 * block names) to the list, an unmatched one inserted after the entry its predecessor matched (or first).
 * Block entries list their instances' coverage `pos` values (positions, unique, ascending); each instance
 * keeps its own `pos`. → the template entry.
 */
function assembleTemplate(templateId, pages) {
  const rep = pages.find((p) => p.slug === templateId) || pages[0];
  const order = [rep, ...pages.filter((p) => p !== rep)];
  const list = [];
  let next = 1;
  const ids = new Map();
  for (const p of order) {
    const matched = new Map(lcsPairs(list.map((e) => e.sig), p.sections.map((s) => s.sig)).map(([a, b]) => [b, list[a].id]));
    const own = new Map();
    let prevId = null;
    p.sections.forEach((s, j) => {
      let id = matched.get(j);
      if (!id) {
        id = `s${next}`;
        next += 1;
        list.splice(prevId ? list.findIndex((e) => e.id === prevId) + 1 : 0, 0, { id, sig: s.sig });
      }
      own.set(s.pos, id);
      prevId = id;
    });
    ids.set(p, own);
  }
  const sections = list.map(({ id }) => {
    const on = order.map((p) => ({ p, s: p.sections.find((s) => ids.get(p).get(s.pos) === id) })).filter((x) => x.s);
    const g = generalise(on.map(({ p, s }) => ({ slug: p.slug, index: p.index, selector: s.selector, anchor: s.anchor })));
    return {
      id, selector: g.selector, pages: g.pages, style: on[0].s.style,
      blocks: uniq(on.flatMap((x) => x.s.names)),
      defaultContent: uniq(on.flatMap((x) => x.s.defaultContent)),
      confidence: Math.min(...on.map((x) => x.s.confidence)),
    };
  });
  const rank = new Map(list.map((e, k) => [e.id, k]));
  const groups = new Map();
  for (const p of order) {
    for (const inst of p.instances) {
      const section = inst.sectionPos == null ? null : ids.get(p).get(inst.sectionPos) ?? null;
      const key = JSON.stringify([inst.block, inst.variantId, section]);
      if (!groups.has(key)) groups.set(key, { first: groups.size, entry: { block: inst.block, variant: inst.variant, variantId: inst.variantId, section }, instances: [] });
      groups.get(key).instances.push({ slug: p.slug, ...inst });
    }
  }
  const sectionRank = (id) => (rank.has(id) ? rank.get(id) : list.length);
  const blocks = [...groups.values()]
    .sort((a, b) => sectionRank(a.entry.section) - sectionRank(b.entry.section) || a.first - b.first)
    .map((g) => ({
      ...g.entry,
      positions: uniq(g.instances.map((i) => i.pos)).sort((a, b) => a - b),
      instances: g.instances.sort((a, b) => byStr(a.slug, b.slug) || a.pos - b.pos)
        .map((i) => ({ slug: i.slug, pos: i.pos, selector: i.selector, confidence: i.confidence, source: i.source, verified: null })),
    }));
  return { templateId, pages: pages.map((p) => p.slug).sort(byStr), sections, blocks };
}

// --- the run -----------------------------------------------------------------------------------------
export const MAPPING_FORMAT_VERSION = '0.1.0';

/**
 * A template's encoder map `<dir>/<templateId>/vocabulary.json` → { root (null when absent or null: the
 * markers apply page-wide; else the given root as a string, '' when it is not one, which never parses),
 * markers (those with a sel and an emitter) }; null when absent. One line in `notes` when it exists but
 * does not parse or has no markers[] (it is then ignored).
 */
function loadEncoderMap(dir, shownDir, templateId, notes) {
  if (!dir || !pathSafe(templateId)) return null;
  const file = join(dir, templateId, 'vocabulary.json');
  if (!existsSync(file)) return null;
  let map = null;
  try { map = JSON.parse(readFileSync(file, 'utf8')); } catch { map = null; }
  if (!map || typeof map !== 'object' || !Array.isArray(map.markers)) {
    notes.push(`encoder map ${join(shownDir, templateId, 'vocabulary.json')} is unreadable or has no markers[] — ignored`);
    return null;
  }
  return {
    root: map.root == null ? null : typeof map.root === 'string' ? map.root.trim() : '',
    markers: map.markers.filter((m) => m && typeof m.sel === 'string' && m.sel.trim() && typeof m.emitter === 'string')
      .map((m) => ({ sel: m.sel.trim(), emitter: m.emitter })),
  };
}

/**
 * The mapping from a coverage document (formatVersion checked by the caller) and resolved directories
 * { content, captures, eds, encode, encodeShown }; lines for stdout go to `notes`. → { mapping }. A page
 * that cannot be indexed or mapped is skipped, never fatal.
 */
export function buildMapping(coverage, dirs, notes = []) {
  const rows = (Array.isArray(coverage.pages) ? coverage.pages : []).filter((p) => p && typeof p.slug === 'string' && p.slug)
    .slice().sort((a, b) => byStr(a.slug, b.slug));
  const skipped = [];
  const groups = new Map();
  const inContent = (rel) => !rel.split('/').includes('..') && isFile(join(dirs.content, rel));
  for (const p of rows) {
    const skip = (reason) => skipped.push({ slug: p.slug, reason });
    if (!p.delivered || typeof p.delivered !== 'object') { skip('no delivered structure'); continue; }
    const file = typeof p.path === 'string' ? contentFileFor(p.path, inContent) : null;
    if (!file) { skip('no content file'); continue; }
    const capture = pathSafe(p.slug) ? join(dirs.captures, `${p.slug}.html`) : null;
    if (!capture || !isFile(capture)) { skip('no capture'); continue; }
    const id = p.templateId || 'untyped';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ row: p, file: join(dirs.content, file), capture });
  }
  const templates = [];
  for (const id of [...groups.keys()].sort(byStr)) {
    const map = loadEncoderMap(dirs.encode, dirs.encodeShown || dirs.encode, id, notes);
    const mapped = [];
    for (const g of groups.get(id)) {
      let index;
      try { index = indexSource(readFileSync(g.capture, 'utf8')); } catch { skipped.push({ slug: g.row.slug, reason: 'capture could not be indexed' }); continue; }
      let page;
      try {
        page = mapPage(g.row, readFileSync(g.file, 'utf8'), index, { map, eds: edsItems(dirs.eds, g.row.slug) });
      } catch (e) {
        skipped.push({ slug: g.row.slug, reason: `page could not be mapped (${(e && e.name) || 'Error'})` });
        continue;
      }
      skipped.push(...page.skipped);
      mapped.push(page);
    }
    if (mapped.length) templates.push(assembleTemplate(id, mapped));
  }
  skipped.sort((a, b) => byStr(a.slug, b.slug) || (a.pos ?? -1) - (b.pos ?? -1));
  const generatedAt = typeof coverage.generatedAt === 'string' ? coverage.generatedAt : null;
  return { mapping: { formatVersion: MAPPING_FORMAT_VERSION, generatedAt, skipped, templates } };
}

/**
 * --verify: re-reads and re-indexes every mapped page's capture (<captures>/<slug>.html) and counts each
 * selector's hits. An instance is verified true when its selector resolves to exactly one element, else
 * false (a null selector, syntax outside the grammar, a capture gone or not indexable); a section keeps
 * in pages only those where its selector still resolves to exactly one element (a page may drop, none is
 * added). Mutates and returns `mapping`.
 */
export function verifyMapping(mapping, captures) {
  for (const t of mapping.templates) {
    const indices = new Map();
    const indexOf = (slug) => {
      if (!indices.has(slug)) {
        let index = null;
        try { index = pathSafe(slug) ? indexSource(readFileSync(join(captures, `${slug}.html`), 'utf8')) : null; } catch { index = null; }
        indices.set(slug, index);
      }
      return indices.get(slug);
    };
    const once = (slug, sel) => { const index = sel ? indexOf(slug) : null; return !!index && hitsOf(index, sel) === 1; };
    for (const b of t.blocks) for (const i of b.instances) i.verified = once(i.slug, i.selector);
    for (const s of t.sections) s.pages = s.pages.filter((slug) => once(slug, s.selector));
  }
  return mapping;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort(byStr).map((k) => [k, sortKeys(v[k])])) : v);
/** The mapping's bytes: object keys sorted at every level, 2-space indent, trailing newline. */
export const serialize = (mapping) => `${JSON.stringify(sortKeys(mapping), null, 2)}\n`;

/** Counts behind the status lines and --json. */
export function countsOf(mapping, verify) {
  const all = mapping.templates.flatMap((t) => t.blocks.flatMap((b) => b.instances.map((i) => ({ ...i, block: b.block }))));
  const sources = { 'encoder-map': 0, 'text-alignment': 0, position: 0 };
  const confidence = { high: 0, medium: 0, low: 0, none: 0 };
  const position = new Map();
  for (const i of all) {
    sources[i.source] += 1;
    confidence[i.confidence >= 0.9 ? 'high' : i.confidence >= 0.5 ? 'medium' : i.confidence > 0 ? 'low' : 'none'] += 1;
    if (i.source === 'position') position.set(i.block, (position.get(i.block) || 0) + 1);
  }
  const ok = all.filter((i) => i.verified === true).length;
  return {
    templates: mapping.templates.length,
    blocks: mapping.templates.reduce((n, t) => n + t.blocks.length, 0),
    instances: all.length,
    verified: verify ? ok : null,
    verifiedPct: verify && all.length ? Math.round((ok / all.length) * 1000) / 10 : null,
    sources,
    confidence,
    positionBlocks: Object.fromEntries([...position].sort(([a, x], [b, y]) => y - x || byStr(a, b))),
  };
}

const tally = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort(([a, x], [b, y]) => y - x || byStr(a, b));

function statusLines(c, skipped, verify) {
  const v = !verify ? 'verified skipped' : !c.instances ? 'verified n/a' : `verified ${c.verifiedPct.toFixed(1)} %`;
  const out = [
    `templates ${c.templates} · blocks ${c.blocks} · instances ${c.instances} · ${v}`,
    `sources encoder-map ${c.sources['encoder-map']} · text-alignment ${c.sources['text-alignment']} · position ${c.sources.position}`,
    `confidence ≥0.9 ${c.confidence.high} · 0.5–<0.9 ${c.confidence.medium} · >0–<0.5 ${c.confidence.low} · 0 ${c.confidence.none}`,
  ];
  const pos = Object.entries(c.positionBlocks);
  if (pos.length) out.push(`position fallback: ${pos.map(([b, n]) => `${b} ×${n}`).join(', ')}`);
  if (skipped.length) out.push(`skipped: ${skipped.length} (${tally(skipped.map((s) => s.reason)).map(([r, n]) => `${r} ×${n}`).join(', ')})`);
  return out;
}

const DEFAULTS = {
  coverage: 'stardust/rollout/coverage/pages.json', content: 'content', captures: 'stardust/current/pages',
  'eds-schema': 'stardust/eds-schema', encode: 'stardust/migrate/encode', out: 'stardust/rollout/workspace/mapping.json',
};
const BOOL_FLAGS = ['verify', 'json'];
const USAGE = 'usage: block-origin.mjs [--coverage <pages.json>] [--content <dir>] [--captures <dir>] [--eds-schema <dir>] [--encode <dir>] [--out <file>] [--verify] [--json] (--help for details)';
const fail = (code, msg) => { process.stderr.write(`block-origin: ${msg}\n`); return code; };

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (Object.hasOwn(DEFAULTS, name)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `--${name} needs a value` };
      opts[name] = v;
      i += 1;
    } else if (BOOL_FLAGS.includes(name)) opts[name] = true;
    else return { error: `unknown argument "${argv[i]}"` };
  }
  return opts;
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

/** The CLI: → exit code (0 written or unchanged, 1 a missing input, 2 usage). */
export function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) return fail(2, `${opts.error}\n${USAGE}`);
  try { requireKeyed(); } catch (e) { return fail(1, `${e.message} — nothing written`); }
  const shown = opts.coverage;
  if (!isFile(resolve(shown))) return fail(1, `coverage ${shown} not found (inventory.mjs writes it) — nothing written`);
  let coverage;
  try { coverage = JSON.parse(readFileSync(resolve(shown), 'utf8')); } catch (e) { return fail(1, `coverage ${shown} is unreadable (${String(e && e.message).split('\n')[0]}) — nothing written`); }
  if (!coverage || typeof coverage !== 'object' || coverage.formatVersion === undefined || !Array.isArray(coverage.pages)) {
    return fail(1, `coverage ${shown} has no formatVersion or no pages[] — re-run inventory.mjs; nothing written`);
  }
  if (coverage.formatVersion !== COVERAGE_FORMAT_VERSION) {
    return fail(1, `coverage ${shown} is formatVersion ${JSON.stringify(coverage.formatVersion)}, this script reads ${COVERAGE_FORMAT_VERSION} — nothing written`);
  }
  for (const flag of ['content', 'captures']) {
    if (!isDir(resolve(opts[flag]))) return fail(1, `--${flag} ${opts[flag]} is not a directory — nothing written`);
  }
  const notes = [];
  const captures = resolve(opts.captures);
  const { mapping } = buildMapping(coverage, {
    content: resolve(opts.content), captures, eds: resolve(opts['eds-schema']), encode: resolve(opts.encode), encodeShown: opts.encode,
  }, notes);
  const verify = !!opts.verify;
  if (verify) verifyMapping(mapping, captures);
  const text = serialize(mapping);
  const file = resolve(opts.out);
  let status = 'unchanged';
  if (!(isFile(file) && readFileSync(file).equals(Buffer.from(text)))) {
    try { writeAtomic(file, text); } catch (e) { return fail(1, `write failed: ${e.message}`); }
    status = 'written';
  }
  const counts = countsOf(mapping, verify);
  if (opts.json) {
    notes.forEach((n) => process.stderr.write(`block-origin: ${n}\n`));
    process.stdout.write(`${JSON.stringify({ status, out: opts.out, counts, skipped: mapping.skipped })}\n`);
  } else process.stdout.write(`${[...statusLines(counts, mapping.skipped, verify), ...notes, `→ ${opts.out} (${status})`].join('\n')}\n`);
  return 0;
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.exitCode = fail(1, (e && e.stack) || String(e));
  }
}
