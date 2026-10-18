/**
 * migrate/slot-map.mjs — the A′ fork's slot values located through the rollout block mapping (or, derived, through the
 * archetype's own capture). A pure library (no CLI): migrate.mjs render --slots mapping|derived imports it.
 *
 * The rollout's workspace/mapping.json (skills/rollout/reference/coverage-contract.md § mapping) gives every delivered
 * block of a mapped page the CSS selector of its origin element in that page's capture (stardust/current/pages/<slug>.html).
 * For a directed sibling of an archetype, the archetype's selectors are the anchors: each data-slot inside the
 * archetype prototype's <main> is found in the archetype's capture under the innermost anchor holding it (by its text,
 * whitespace removed, case kept; an image by its file name; a link by its text), and its recipe { anchor, path, kind }
 * records that selector and the child path (tag + nth-of-type steps) from the anchor's element to it. The same selector
 * and path on the sibling's capture give the sibling's value, so no per-sibling slot data is written by hand. A text found
 * in separate places of the mapped capture (not one inside the other), or a file name on more than one image, is
 * ambiguous: that slot gets no recipe, never the first place's. Without a mapping, deriveRecipes anchors the same search
 * at the archetype capture's <main> (exactly one, else <body>) — migrate.mjs's `derived` slot source.
 *
 * Exports: UnsupportedSelector, parseSelector, querySelectorAll, indexHtml, readMapping, anchorsFor, slotRecipes,
 * deriveRecipes, slotValues. The element model is migrate.mjs elementsOf: comments and raw-text contents skipped, a close tag pops to
 * its open match (a stray one is ignored), an unclosed element ends with its parent — the tree the rollout's parseHtml
 * builds, except that the contents of <template>, <textarea> and <title> are raw text here. migrate.mjs imports this
 * module, so nothing here calls a migrate.mjs export at module top level.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { elementsOf, slotNameOf } from './migrate.mjs';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const toPosix = (p) => p.split('\\').join('/');

// ---- selectors: the grammar of the rollout's block-origin.mjs (the selectors it writes are verified in it) ----------
export class UnsupportedSelector extends Error {
  constructor(selector, why) { super(`unsupported selector ${JSON.stringify(selector)}: ${why}`); this.name = 'UnsupportedSelector'; }
}
const WS = /[ \t\n\r\f]/;
const PSEUDO = new Set(['first-child', 'last-child', 'first-of-type', 'last-of-type']);
const NTH = new Set(['nth-child', 'nth-of-type']);
const OPS = ['~=', '^=', '$=', '*=', '='];

/**
 * parseSelector(selector) → [complex], complex = [{ combinator, tag, ids, classes, attrs, pseudos }] left to right, the
 * combinator (' ' or '>') joining a compound to the one before (null for the first). Grammar: lists (,), descendant and >
 * combinators; tag or *, #id, .class, [attr], [attr=v], [attr~=v], [attr^=v], [attr$=v], [attr*=v] (quoted or identifier
 * values), :nth-of-type(n) and :nth-child(n) with an integer, :first-child, :last-child, :first-of-type, :last-of-type;
 * backslash escapes. Anything else throws UnsupportedSelector.
 */
export function parseSelector(selector) {
  const s = String(selector ?? ''); let i = 0;
  const fail = (why) => { throw new UnsupportedSelector(s, why); };
  const space = () => { const at = i; while (i < s.length && WS.test(s[i])) i += 1; return i > at; };
  const escape = () => {
    i += 1;
    if (i >= s.length || /[\n\r\f]/.test(s[i])) fail('a backslash that escapes nothing');
    const hex = /^[0-9a-fA-F]{1,6}/.exec(s.slice(i, i + 6));
    if (hex) {
      i += hex[0].length;
      if (s[i] === '\r' && s[i + 1] === '\n') i += 2; else if (i < s.length && WS.test(s[i])) i += 1;
      const cp = parseInt(hex[0], 16);
      return cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? '\ufffd' : String.fromCodePoint(cp);
    }
    const ch = String.fromCodePoint(s.codePointAt(i)); i += ch.length; return ch;
  };
  const nameStart = (c) => c !== undefined && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);
  const nameChar = (c) => c !== undefined && (/[\w-]/.test(c) || c.charCodeAt(0) >= 0x80);
  const ident = () => {
    const at = i; let out = '';
    if (s[i] === '-') { out = '-'; i += 1; if (s[i] === '-') { out = '--'; i += 1; } }
    if (out !== '--' && !nameStart(s[i]) && s[i] !== '\\') { i = at; return null; }
    while (i < s.length) { if (s[i] === '\\') out += escape(); else if (nameChar(s[i])) { out += s[i]; i += 1; } else break; }
    return out;
  };
  const string = () => {
    const quote = s[i]; let out = ''; i += 1;
    while (i < s.length && s[i] !== quote) {
      if (s[i] === '\\' && s[i + 1] === '\n') i += 2;
      else if (s[i] === '\\') out += escape();
      else if (s[i] === '\n') fail('a newline inside a string');
      else { out += s[i]; i += 1; }
    }
    if (s[i] !== quote) fail('an unterminated string');
    i += 1; return out;
  };
  const attribute = () => {
    i += 1; space();
    const name = ident(); if (name === null) fail('an attribute without a name');
    space(); let op = null; let value = null;
    if (s[i] !== ']') {
      op = OPS.find((o) => s.startsWith(o, i)) || null;
      if (!op) fail(i >= s.length ? 'an unclosed [' : `the attribute operator ${JSON.stringify(s.slice(i, i + 2))}`);
      i += op.length; space();
      value = s[i] === '"' || s[i] === "'" ? string() : ident();
      if (value === null) fail('an attribute value that is neither quoted nor an identifier');
      space();
    }
    if (s[i] !== ']') fail(i >= s.length ? 'an unclosed [' : 'attribute flags');
    i += 1; return { name: name.toLowerCase(), op, value };
  };
  const pseudo = () => {
    if (s[i + 1] === ':') fail('pseudo-elements');
    i += 1; const name = (ident() || '').toLowerCase();
    if (PSEUDO.has(name)) return { name };
    if (!NTH.has(name) || s[i] !== '(') fail(`:${name || s[i] || ''}`);
    const close = s.indexOf(')', i); const arg = close < 0 ? '' : s.slice(i + 1, close);
    if (close < 0 || !/^[ \t\n\r\f]*\+?\d+[ \t\n\r\f]*$/.test(arg)) fail(`:${name}(${arg}) — only an integer`);
    i = close + 1; return { name, n: parseInt(arg.trim(), 10) };
  };
  const compound = () => {
    const c = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] }; let any = false;
    if (s[i] === '*') { i += 1; any = true; } else { const t = ident(); if (t !== null) { c.tag = t.toLowerCase(); any = true; } }
    if (s[i] === '|') fail('namespaces');
    for (;;) {
      if (s[i] === '#' || s[i] === '.') {
        const k = s[i]; i += 1; const n = ident();
        if (n === null) fail(`${k === '#' ? 'an id' : 'a class'} without a name`);
        (k === '#' ? c.ids : c.classes).push(n);
      } else if (s[i] === '[') c.attrs.push(attribute());
      else if (s[i] === ':') c.pseudos.push(pseudo());
      else break;
      any = true;
    }
    return any ? c : null;
  };
  const list = []; space();
  for (;;) {
    const complex = []; let combinator = null;
    for (;;) {
      const c = compound();
      if (!c) fail(i >= s.length ? 'an unexpected end' : `an unexpected ${JSON.stringify(s[i])}`);
      complex.push({ combinator, ...c });
      const spaced = space();
      if (i >= s.length || s[i] === ',') break;
      if (s[i] === '>') { i += 1; space(); combinator = '>'; continue; }
      if (s[i] === '+' || s[i] === '~') fail(`the ${s[i]} combinator`);
      if (!spaced) fail(`an unexpected ${JSON.stringify(s[i])}`);
      combinator = ' ';
    }
    list.push(complex);
    if (i >= s.length) return list;
    i += 1; space();
  }
}

// ---- the element index over migrate.mjs elementsOf ---------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', laquo: '\u00ab', raquo: '\u00bb', bull: '\u2022', middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', euro: '\u20ac', pound: '\u00a3', shy: '\u00ad' };
const decode = (t) => String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
  if (e[0] !== '#') { const k = e.toLowerCase(); return Object.hasOwn(ENTITIES, k) ? ENTITIES[k] : m; }
  const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const MUTED = /<!--[\s\S]*?-->|<(script|style|template|noscript|svg|iframe)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<\/?[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
const PHRASING = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 'picture', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
// Text as compared (all whitespace, soft hyphens and zero-width spaces removed; case kept) and as placed (whitespace collapsed).
const squash = (t) => t.normalize('NFC').replace(/[\s\u00ad\u200b]+/g, '');
const collapse = (t) => t.normalize('NFC').replace(/[\u00ad\u200b]/g, '').replace(/\s+/g, ' ').trim();

/** indexHtml(html) → { html, els, kids, pos } over elementsOf(html): kids = Map parent (null for the top level) → element
 * children; pos = Map element → { index, count, typeIndex, typeCount } (1-based, among its parent's element children). */
export function indexHtml(html) {
  const src = String(html ?? ''); const els = elementsOf(src); const kids = new Map([[null, []]]);
  for (const e of els) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }
  const pos = new Map();
  for (const list of kids.values()) {
    const total = new Map(); for (const e of list) total.set(e.tag, (total.get(e.tag) || 0) + 1);
    const seen = new Map();
    list.forEach((e, k) => { const t = (seen.get(e.tag) || 0) + 1; seen.set(e.tag, t); pos.set(e, { index: k + 1, count: list.length, typeIndex: t, typeCount: total.get(e.tag) }); });
  }
  return { html: src, els, kids, pos, attrCache: new Map(), textCache: new Map() };
}
const indexOf = (x) => (x && typeof x === 'object' && Array.isArray(x.els) && x.pos instanceof Map ? x : indexHtml(x));
// Attributes of an element: names lower-cased, the first of a repeated name kept, values entity-decoded.
function attrsOf(idx, e) {
  let a = idx.attrCache.get(e);
  if (!a) {
    a = new Map();
    for (const m of e.attrs.matchAll(ATTR)) { const k = m[1].toLowerCase(); if (!a.has(k)) a.set(k, decode(m[2] ?? m[3] ?? m[4] ?? '')); }
    idx.attrCache.set(e, a);
  }
  return a;
}
// textContent: tags dropped (a <br> is a space), comments and script/style/template/noscript/svg/iframe contents skipped.
function textOf(idx, e) {
  if (!idx.textCache.has(e)) idx.textCache.set(e, decode(idx.html.slice(e.openEnd, e.closeStart).replace(MUTED, '').replace(/<br\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, ' ').replace(TAG, '')));
  return idx.textCache.get(e);
}
const inside = (e, a) => { for (let p = e; p; p = p.parent) if (p === a) return true; return false; };
const descendants = (idx, e) => { const out = []; const walk = (n) => { for (const k of idx.kids.get(n) || []) { out.push(k); walk(k); } }; walk(e); return out; };

function matchAttr(a, { name, op, value }) {
  if (!a.has(name)) return false;
  const v = a.get(name);
  if (op === null) return true;
  if (op === '=') return v === value;
  if (value === '') return false;
  if (op === '~=') return !WS.test(value) && v.split(/[ \t\n\r\f]+/).includes(value);
  if (op === '^=') return v.startsWith(value);
  if (op === '$=') return v.endsWith(value);
  return v.includes(value);
}
function matchCompound(idx, e, c) {
  if (c.tag && e.tag !== c.tag) return false;
  if (!c.ids.length && !c.classes.length && !c.attrs.length && !c.pseudos.length) return true;
  const a = attrsOf(idx, e);
  if (c.ids.some((id) => a.get('id') !== id)) return false;
  if (c.classes.length) { const cl = (a.get('class') || '').split(/[ \t\n\r\f]+/); if (c.classes.some((k) => !cl.includes(k))) return false; }
  if (c.attrs.some((t) => !matchAttr(a, t))) return false;
  const p = idx.pos.get(e);
  return c.pseudos.every(({ name, n }) => (name === 'first-child' ? p.index === 1 : name === 'last-child' ? p.index === p.count
    : name === 'first-of-type' ? p.typeIndex === 1 : name === 'last-of-type' ? p.typeIndex === p.typeCount : (name === 'nth-child' ? p.index : p.typeIndex) === n));
}
function matchComplex(idx, e, complex, k) {
  if (!matchCompound(idx, e, complex[k])) return false;
  if (k === 0) return true;
  if (complex[k].combinator === '>') return !!e.parent && matchComplex(idx, e.parent, complex, k - 1);
  for (let p = e.parent; p; p = p.parent) if (matchComplex(idx, p, complex, k - 1)) return true;
  return false;
}
/** querySelectorAll(html | indexHtml(html), selector) → the matching elements in document order; throws UnsupportedSelector. */
export function querySelectorAll(htmlOrIndex, selector) {
  const list = parseSelector(selector); const idx = indexOf(htmlOrIndex);
  return idx.els.filter((e) => list.some((complex) => matchComplex(idx, e, complex, complex.length - 1)));
}

// ---- the mapping: read only when hash-listed and fresh (coverage-contract.md § mapping, Rule) -----------------------
const readJsonFile = (p) => { if (!isFile(p)) return undefined; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
/**
 * readMapping(rolloutDir) → { mapping, reason, file, generatedAt }: <rolloutDir>/workspace/mapping.json, read only when it
 * parses as formatVersion 0.1.x with templates[], <rolloutDir>/workspace/manifest.json lists its sha256 under outputs (a
 * key ending in workspace/mapping.json), and its generatedAt equals <rolloutDir>/coverage/pages.json's. Otherwise mapping
 * is null and reason one line naming what failed (absent, unparseable, not hash-listed, changed since, stale).
 */
export function readMapping(rolloutDir) {
  const p = (...xs) => toPosix(join(rolloutDir, ...xs));
  const file = p('workspace', 'mapping.json'); const manifestFile = p('workspace', 'manifest.json'); const pagesFile = p('coverage', 'pages.json');
  const no = (reason) => ({ mapping: null, reason, file, generatedAt: null });
  if (!isFile(file)) return no(`${file} is absent`);
  const bytes = readFileSync(file); let mapping;
  try { mapping = JSON.parse(bytes.toString('utf8')); } catch { return no(`${file} is not valid JSON`); }
  if (!mapping || typeof mapping !== 'object' || !Array.isArray(mapping.templates)) return no(`${file} has no templates[]`);
  if (!/^0\.1\.\d+$/.test(String(mapping.formatVersion))) return no(`${file} is formatVersion ${JSON.stringify(mapping.formatVersion ?? null)}; this reader takes 0.1.x`);
  const manifest = readJsonFile(manifestFile);
  if (manifest === undefined) return no(`${manifestFile} is absent, so nothing lists the mapping's sha256`);
  if (!manifest || typeof manifest.outputs !== 'object' || !manifest.outputs || Array.isArray(manifest.outputs)) return no(`${manifestFile} is not valid JSON with an outputs object`);
  const listed = Object.entries(manifest.outputs).filter(([k]) => /(^|\/)workspace\/mapping\.json$/.test(toPosix(k)));
  if (!listed.length) return no(`${manifestFile} lists no workspace/mapping.json under outputs`);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (!listed.some(([, v]) => v === digest)) return no(`${file} changed after ${manifestFile} was written (its sha256 is not the one listed under outputs)`);
  const pages = readJsonFile(pagesFile);
  if (pages === undefined) return no(`${pagesFile} is absent, so the mapping's freshness cannot be checked`);
  if (!pages || typeof pages !== 'object') return no(`${pagesFile} is not valid JSON`);
  if (typeof mapping.generatedAt !== 'string' || mapping.generatedAt !== pages.generatedAt) return no(`${file} is stale: generatedAt ${mapping.generatedAt ?? 'null'}, ${pagesFile} generatedAt ${pages.generatedAt ?? 'null'}`);
  return { mapping, reason: null, file, generatedAt: mapping.generatedAt };
}

/**
 * anchorsFor(mapping, template, archetypeSlug) → [{ selector, kind: 'block', block, pos } | { selector, kind: 'section',
 * section }]: the archetype's block instances verified true with a selector (by pos), then the sections whose pages[] lists
 * it (their selector resolved to exactly one element there: default content belongs to no block), each selector once.
 * template: a templateId, or null for every template whose pages[] lists the archetype.
 */
export function anchorsFor(mapping, template, archetypeSlug) {
  const templates = (Array.isArray(mapping?.templates) ? mapping.templates : [])
    .filter((t) => t && typeof t === 'object' && (template != null ? t.templateId === template : Array.isArray(t.pages) && t.pages.includes(archetypeSlug)));
  const out = []; const seen = new Set();
  const add = (a) => { if (typeof a.selector === 'string' && a.selector.trim() && !seen.has(a.selector)) { seen.add(a.selector); out.push(a); } };
  const blocks = [];
  for (const t of templates) {
    for (const b of Array.isArray(t.blocks) ? t.blocks : []) {
      for (const i of Array.isArray(b?.instances) ? b.instances : []) if (i && i.slug === archetypeSlug && i.verified === true) blocks.push({ selector: i.selector, kind: 'block', block: b.block, pos: i.pos });
    }
  }
  blocks.sort((x, y) => (Number.isInteger(x.pos) ? x.pos : Infinity) - (Number.isInteger(y.pos) ? y.pos : Infinity)).forEach(add);
  for (const t of templates) for (const s of Array.isArray(t.sections) ? t.sections : []) if (s && Array.isArray(s.pages) && s.pages.includes(archetypeSlug)) add({ selector: s.selector, kind: 'section', section: s.id });
  return out;
}

// ---- recipes (archetype) and values (sibling) --------------------------------------------------------------------
// The kind follows the prototype's slot element: <img> image, <a> link; block children → html; only text → text; inline
// children only: one image and no text → image (a container), one link holding all the text → link (a container), no
// image or link → text, else html (text would drop the inline link or image).
function slotKindOf(idx, e) {
  if (e.tag === 'img') return 'image';
  if (e.tag === 'a') return 'link';
  const desc = descendants(idx, e);
  if (!desc.length) return 'text';
  if (desc.some((d) => !PHRASING.has(d.tag))) return 'html';
  const imgs = desc.filter((d) => d.tag === 'img'); const links = desc.filter((d) => d.tag === 'a'); const text = squash(textOf(idx, e));
  if (!imgs.length && !links.length) return 'text';
  if (imgs.length === 1 && !links.length && !text) return 'image';
  if (links.length === 1 && !imgs.length && text === squash(textOf(idx, links[0]))) return 'link';
  return 'html';
}
// srcset candidates as a browser splits them: a URL runs to whitespace (so a data: URL keeps its comma), a trailing comma
// ends a candidate, else its descriptors run to the next comma. → [{ url, desc }]
function srcsetCandidates(s) {
  const str = String(s || ''); const out = []; let i = 0;
  while (i < str.length) {
    while (i < str.length && /[\s,]/.test(str[i])) i += 1;
    let j = i; while (j < str.length && !/\s/.test(str[j])) j += 1;
    let url = str.slice(i, j); let desc = '';
    if (/,$/.test(url)) { url = url.replace(/,+$/, ''); i = j; } else {
      let k = j; let depth = 0;
      while (k < str.length && (str[k] !== ',' || depth)) { if (str[k] === '(') depth += 1; else if (str[k] === ')') depth = Math.max(0, depth - 1); k += 1; }
      desc = str.slice(j, k).trim(); i = k + 1;
    }
    if (url) out.push({ url, desc });
  }
  return out;
}
const isData = (u) => /^data:/i.test(u);
// An image's URLs (src, data-src, then every srcset / data-srcset candidate), data: URLs skipped.
function imageUrls(idx, img) {
  const a = attrsOf(idx, img); const out = [];
  for (const k of ['src', 'data-src']) { const v = (a.get(k) || '').trim(); if (v && !isData(v)) out.push(v); }
  for (const k of ['srcset', 'data-srcset']) for (const c of srcsetCandidates(a.get(k))) if (!isData(c.url)) out.push(c.url);
  return out;
}
// A URL's file name as extract/media-harvest.mjs names a harvested file: decoded, extension dropped, lower case, runs of
// anything but [a-z0-9_-] → '-', at most 60 characters.
function stemOf(url) {
  let seg = String(url).split(/[?#]/)[0].split('/').pop() || '';
  try { seg = decodeURIComponent(seg); } catch { /* keep as is */ }
  const dot = seg.lastIndexOf('.');
  return (dot > 0 ? seg.slice(0, dot) : seg).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
function locate(proto, cap, e, kind, ctx) {
  const none = (reason) => ({ anchor: null, path: null, kind, reason });
  if (!ctx.usable.size) return none('no mapped selector matches exactly one element of the archetype capture');
  let source;
  if (kind === 'image') {
    const img = e.tag === 'img' ? e : descendants(proto, e).find((d) => d.tag === 'img');
    const want = new Set();
    for (const u of imageUrls(proto, img)) { const s = stemOf(u); if (s) { want.add(s); want.add(s.replace(/-[0-9a-f]{8}$/, '')); } } // a harvested file carries -<hash8>
    want.delete('');
    if (!want.size) return none('the archetype image has no file name to find it by');
    const found = ctx.within.filter((el) => el.tag === 'img' && imageUrls(cap, el).some((u) => want.has(stemOf(u))));
    if (!found.length) return none('its image file name is inside no mapped element of the archetype capture');
    if (found.length > 1) return none(`ambiguous: its image file name matches ${found.length} images of the mapped archetype capture`);
    [source] = found;
  } else {
    const target = kind === 'link' && e.tag !== 'a' ? descendants(proto, e).find((d) => d.tag === 'a') : e;
    const t = squash(textOf(proto, target));
    if (!t) return none('the archetype slot has no text to find it by');
    const hits = ctx.within.filter((el) => (kind !== 'link' || el.tag === 'a') && squash(textOf(cap, el)) === t);
    if (!hits.length) return none(`its ${kind === 'link' ? 'link text' : 'text'} is inside no mapped element of the archetype capture`);
    // Equal text nests: the first hit and the hits inside it are one chain; the deepest of the slot's tag, else (html)
    // the deepest holding a block child, else the deepest. A hit outside that chain is another place with the same text,
    // and which place is the slot's cannot be told.
    const chain = hits.filter((el) => inside(el, hits[0]));
    if (chain.length < hits.length) {
      const places = hits.filter((el) => !hits.some((o) => o !== el && inside(el, o))).length;
      return none(`ambiguous: its ${kind === 'link' ? 'link text' : 'text'} is in ${places} separate places of the mapped archetype capture`);
    }
    const same = chain.filter((el) => el.tag === target.tag);
    const pick = same.length ? same : kind === 'html' ? chain.filter((el) => (cap.kids.get(el) || []).some((k) => !PHRASING.has(k.tag))) : [];
    source = (pick.length ? pick : chain).at(-1);
  }
  const anchorEl = ctx.anchorOf(source); const path = [];
  for (let n = source; n !== anchorEl; n = n.parent) path.unshift({ tag: n.tag, n: cap.pos.get(n).typeIndex });
  return { anchor: ctx.usable.get(anchorEl), path, kind };
}
/**
 * slotRecipes(archetypeProtoHtml, archetypeCaptureHtml, anchors) → { <data-slot name>: recipe | [recipe…] } for every
 * data-slot inside the prototype's <main> the fork fills (not one nested in a slot whose value replaces its content), in
 * document order; a name on several elements → one recipe per element. recipe = { anchor, path: [{ tag, n }], kind } —
 * anchor the selector (of `anchors`: strings or { selector }) whose single element in the capture is the innermost holding
 * the slot's source element, path the nth-of-type steps from it to that element — or { anchor: null, path: null, kind,
 * reason } when none is found, or when the source is ambiguous (its text in separate places of the mapped capture, its
 * file name on more than one image; reason "ambiguous: …"). An anchor that is outside the grammar or does not match
 * exactly one element of the capture is not used.
 */
export function slotRecipes(archetypeProtoHtml, archetypeCaptureHtml, anchors) {
  const proto = indexHtml(archetypeProtoHtml); const cap = indexHtml(archetypeCaptureHtml);
  const usable = new Map();
  for (const a of Array.isArray(anchors) ? anchors : []) {
    const sel = typeof a === 'string' ? a : a?.selector;
    if (typeof sel !== 'string' || !sel.trim()) continue;
    let hits; try { hits = querySelectorAll(cap, sel); } catch (err) { if (err instanceof UnsupportedSelector) continue; throw err; }
    if (hits.length === 1 && !usable.has(hits[0])) usable.set(hits[0], sel);
  }
  const anchorOf = (el) => { for (let p = el; p; p = p.parent) if (usable.has(p)) return p; return null; };
  const ctx = { usable, anchorOf, within: cap.els.filter((el) => anchorOf(el)) };
  const main = proto.els.find((e) => e.tag === 'main');
  const kinds = new Map(); const lists = new Map();
  for (const e of main ? proto.els.filter((x) => x !== main && inside(x, main) && slotNameOf(x.attrs)) : []) {
    let gone = false;
    for (let p = e.parent; p && p !== main; p = p.parent) if (kinds.has(p) && kinds.get(p) !== 'image') { gone = true; break; } // only an image container is kept
    if (gone) { kinds.set(e, 'gone'); continue; }
    const kind = slotKindOf(proto, e); kinds.set(e, kind);
    const name = slotNameOf(e.attrs);
    if (!lists.has(name)) lists.set(name, []);
    lists.get(name).push(locate(proto, cap, e, kind, ctx));
  }
  return Object.fromEntries([...lists].map(([name, l]) => [name, l.length === 1 ? l[0] : l]));
}
/**
 * deriveRecipes(archetypeProtoHtml, archetypeCaptureHtml) → { anchor, recipes }: the recipes without a rollout mapping —
 * the archetype's own capture is the map. anchor = 'main' when the capture has exactly one <main>, else 'body'; recipes =
 * slotRecipes(proto, capture, [anchor]). The prototype must already carry its data-slot marks (migrate.mjs deriveSlots
 * marks a markerless one first).
 */
export function deriveRecipes(archetypeProtoHtml, archetypeCaptureHtml) {
  const cap = indexHtml(archetypeCaptureHtml);
  const anchor = cap.els.filter((e) => e.tag === 'main').length === 1 ? 'main' : 'body';
  return { anchor, recipes: slotRecipes(archetypeProtoHtml, cap.html, [anchor]) };
}
function valueOf(idx, el, kind, where) {
  const a = attrsOf(idx, el);
  if (kind === 'image') {
    if (el.tag !== 'img') return { why: `the element at ${where} is a <${el.tag}>, not an <img>` };
    const src = imageUrls(idx, el)[0];
    if (!src) return { why: `the <img> at ${where} has no source` };
    const v = { src }; if (a.has('alt')) v.alt = a.get('alt');
    // the first of srcset / data-srcset with a candidate that is not a data: placeholder, without the placeholders
    for (const k of ['srcset', 'data-srcset']) {
      const set = srcsetCandidates(a.get(k)).filter((c) => !isData(c.url));
      if (set.length) { v.srcset = set.map((c) => (c.desc ? `${c.url} ${c.desc}` : c.url)).join(', '); break; }
    }
    return { value: v };
  }
  if (kind === 'link') {
    if (el.tag !== 'a') return { why: `the element at ${where} is a <${el.tag}>, not an <a>` };
    const href = (a.get('href') || '').trim();
    if (!href) return { why: `the <a> at ${where} has no href` };
    // A link recipe is built only from an archetype link with text: a sibling link without any differs (an image or icon
    // link), and a value without text would keep the archetype's label beside the sibling's href.
    const text = collapse(textOf(idx, el));
    if (!text) return { why: `the <a> at ${where} has no text` };
    return { value: { href, text } };
  }
  if (kind === 'html') { const inner = idx.html.slice(el.openEnd, el.closeStart).trim(); return { value: inner ? { html: inner } : null }; }
  return { value: collapse(textOf(idx, el)) || null };
}
const pathText = (path) => path.map((s) => `${s.tag}[${s.n}]`).join('/');
const placeOf = (anchor, path) => (path.length ? `${pathText(path)} under ${JSON.stringify(anchor)}` : JSON.stringify(anchor));
// The level at which a repeated name's items can be counted: { d, tag, k } — all items under one anchor, their paths
// equal up to step d where they part (one item: its last step), that step of one tag and numbered 1..k, one item each.
// Then the items are every <tag> element there up to k, and a sibling with no more <tag> elements there has no more items.
// { why } when that cannot be shown; null for a single item that is its anchor itself.
function itemLevel(list) {
  const cannot = (what) => ({ why: `${what}, so the sibling's item count cannot be checked` });
  const anchors = [...new Set(list.map((r) => r.anchor))];
  if (anchors.length > 1) return cannot(`its items sit under different anchors (${anchors.map((a) => JSON.stringify(a)).join(', ')})`);
  const [anchor] = anchors; const paths = list.map((r) => r.path);
  let d = paths[0].length - 1;
  if (paths.length > 1) {
    d = 0;
    while (paths.every((p) => d < p.length && p[d].tag === paths[0][d].tag && p[d].n === paths[0][d].n)) d += 1;
    if (paths.some((p) => p.length <= d)) return cannot(`its items are not side by side (one is or holds another at ${placeOf(anchor, paths[0].slice(0, d))})`);
  }
  if (d < 0) return null;
  const where = placeOf(anchor, paths[0].slice(0, d)); const steps = paths.map((p) => p[d]);
  const tags = [...new Set(steps.map((s) => s.tag))];
  if (tags.length > 1) return cannot(`its items part at different tags (${tags.join(', ')}) under ${where}`);
  const ns = steps.map((s) => s.n).sort((x, y) => x - y);
  if (ns.some((n, i) => n !== i + 1)) return cannot(`its items are not the first ${ns.length} <${tags[0]}> elements under ${where} (the archetype's are ${steps.map((s) => `${s.tag}[${s.n}]`).join(', ')})`);
  return { d, tag: tags[0], k: ns.length };
}
/**
 * slotValues(recipes, siblingCaptureHtml) → { slots, unresolved }: slots = { name: value | [value…] | null } in the shapes
 * migrate.mjs forkFromArchetype takes — text: a string (whitespace collapsed; null when empty); html: { html } (the inner
 * HTML, trimmed; null when empty); image: { src, alt?, srcset? } (src, else data-src, else the first srcset candidate;
 * data: placeholders never); link: { href, text }. A name whose recipe (any of a repeated name's) has no anchor is left
 * out — the caller decides. unresolved = [{ slot, reason }]: an anchor that does not match exactly one element of the
 * sibling's capture, a path that leads nowhere, an element that cannot give the value (a link without text included), or
 * a repeated name that cannot be shown complete — its items not all under one anchor, side by side and the first same-tag
 * elements where their paths part (a card grid parts at the cards, a list at its items), or the sibling holding more
 * same-tag elements there than the archetype has items: the list is never truncated; such a slot's value is null.
 */
export function slotValues(recipes, siblingCaptureHtml) {
  const idx = indexHtml(siblingCaptureHtml); const slots = {}; const unresolved = []; const hits = new Map();
  const read = (r) => {
    if (!hits.has(r.anchor)) {
      let h; try { h = querySelectorAll(idx, r.anchor); } catch (err) { if (!(err instanceof UnsupportedSelector)) throw err; h = null; }
      hits.set(r.anchor, h);
    }
    const h = hits.get(r.anchor);
    if (!h) return { why: `anchor ${JSON.stringify(r.anchor)} is outside the selector grammar` };
    if (h.length !== 1) return { why: `anchor ${JSON.stringify(r.anchor)} matches ${h.length} elements` };
    const where = placeOf(r.anchor, r.path);
    let el = h[0];
    for (const step of r.path) {
      el = (idx.kids.get(el) || []).filter((k) => k.tag === step.tag)[step.n - 1];
      if (!el) return { why: `path ${where} leads nowhere` };
    }
    const v = valueOf(idx, el, r.kind, where);
    return v.why ? v : { ...v, el };
  };
  for (const [name, rec] of Object.entries(recipes || {})) {
    const list = Array.isArray(rec) ? rec : [rec];
    if (!list.length || list.some((r) => !r || !r.anchor)) continue;
    const level = Array.isArray(rec) ? itemLevel(list) : null;
    let bad = level?.why ? level : null; const got = bad ? [] : list.map(read);
    bad ||= got.find((g) => g.why);
    if (!bad && level) {
      let el = got[0].el; for (let s = list[0].path.length - 1; s > level.d; s -= 1) el = el.parent;
      const items = (idx.kids.get(el.parent) || []).filter((k) => k.tag === level.tag).length;
      if (items > level.k) bad = { why: `the sibling has more items than the archetype (${items} > ${level.k})` };
    }
    if (bad) { slots[name] = null; unresolved.push({ slot: name, reason: bad.why }); continue; }
    slots[name] = Array.isArray(rec) ? got.map((g) => g.value) : got[0].value;
  }
  return { slots, unresolved };
}
