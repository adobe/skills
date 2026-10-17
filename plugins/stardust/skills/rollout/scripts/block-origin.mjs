#!/usr/bin/env node
/**
 * rollout/block-origin.mjs — the source side of every delivered block: the CSS selector of its origin element
 * in the page's captured source DOM, for stardust/rollout/workspace/mapping.json (formatVersion 0.1.0).
 *
 * A delivered document is walked with lib.mjs walkDelivered (coverage's records, with their nodes). A record's
 * text fragments (fragmentsOf, keyed with unit-geometry's keyed()) are located in the captured page
 * (indexSource + alignBlock: the element covering most of the record's text, the deepest on ties), and
 * stableSelector gives a CSS selector that resolves to exactly that element. Text is compared normalised and
 * with all whitespace removed (squash), so inline-element splits do not matter. querySelectorAll/countMatches
 * are a minimal selector engine over lib.mjs parseHtml (the plugin tree ships no dependency); syntax outside
 * its grammar throws UnsupportedSelector, and countMatches counts it as 0 hits.
 *
 * Exports (pure): normText, squash, indexSource, fragmentsOf, alignBlock, lca, coveredShare, stableSelector,
 * parseSelector, querySelectorAll, countMatches, requireKeyed. unit-geometry.mjs is found in the plugin tree
 * (../../diff/scripts/) or a project copy (stardust/scripts/<skill>/: ../diff/); without either the import
 * still succeeds and requireKeyed (so fragmentsOf) throws an Error naming both places.
 * Usage, inputs, outputs and exit codes: --help.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classList, elements, isLink, onlyChild, parseHtml, textOf } from './lib.mjs';

const HELP = `block-origin — the source side of every delivered block: the CSS selector of its origin element in the
page's captured source DOM, written to stardust/rollout/workspace/mapping.json.

Usage: node skills/rollout/scripts/block-origin.mjs [--coverage <pages.json>] [--content <dir>] [--captures <dir>]
         [--eds-schema <dir>] [--encode <dir>] [--out <file>] [--verify] [--json]
  --coverage <file>   rollout coverage pages, formatVersion 0.1.0 (default stardust/rollout/coverage/pages.json)
  --content <dir>     the delivered documents, one content file per page path (default content)
  --captures <dir>    the captured source pages, <slug>.html (default stardust/current/pages)
  --eds-schema <dir>  per-page eds-schema, <slug>.json: default-content roles (default stardust/eds-schema; optional)
  --encode <dir>      encoder maps <dir>/<templateId>/vocabulary.json, taken before text alignment (default
                      stardust/migrate/encode; optional; the shipped encoder keeps them under stardust/import:
                      pass --encode stardust/import)
  --out <file>        default stardust/rollout/workspace/mapping.json
  --verify            re-resolve every selector against the captured pages: verified true (exactly one
                      element) or false; without it every instance records verified null (skipped)
  --json              one JSON object on stdout instead of the status lines

Per page, each delivered block is located in its capture by its text (the element covering most of it, the
deepest on ties; confidence = the share covered), by an encoder map's marker, or by its position among its
neighbours; its selector resolves to exactly that element. A section takes the lowest common ancestor of its
records; a template's selectors are the generalisation that resolves on its listed pages. Text is compared
normalised (NFKC, lower case, typographic quotes and dashes folded) with whitespace removed.

Outputs: <out>, formatVersion 0.1.0, keys sorted, generatedAt copied from the coverage (no clock); rewritten
only when the bytes differ. Pages without a delivered structure, a content file or a capture are listed
under skipped.

Exit: 0 written or unchanged, whatever verification found; 1 a missing input, nothing written (coverage
missing, unreadable or of another formatVersion; --content or --captures missing; unit-geometry.mjs in
neither skills/diff/scripts/ nor stardust/scripts/diff/); 2 usage (unknown flag, missing value), nothing
read or written.
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
 * text. Empty containers and cells give none. `sel` is a path from the node (`div[1]/div[2]/p[1]`); `key` is
 * unit-geometry's keyed() (duplicates get ` #2`).
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
const textFragments = (fragments) => (fragments || []).map((f) => ({ key: f.key, s: squash(f.text) })).filter((f) => f.s);
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
 * alignBlock(index, fragments) → { anchor, confidence, covered, total, unmatched }. Text fragments are those
 * with a non-empty squashed text; total = the sum of their lengths. Each one covers (once) the deepest
 * elements under body containing it and all their ancestors up to body; the anchor is the element covering
 * the most, then the deepest, then the first in document order; confidence = covered / total (3 decimals);
 * unmatched = the keys of fragments found nowhere. No text fragment → anchor null and zeros.
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
    if (!a || c > best || (c === best && (m.depth > a.depth || (m.depth === a.depth && m.order < a.order)))) [anchor, best] = [n, c];
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

/** Share (3 decimals) of the fragments' squashed text contained in `el`'s text; 0 without text or element. */
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

if (isMain()) {
  process.stderr.write('block-origin: this build carries the primitives only; the mapping run is not wired yet (see --help)\n');
  process.exitCode = 1;
}
