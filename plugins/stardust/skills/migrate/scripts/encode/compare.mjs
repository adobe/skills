/**
 * migrate/encode/compare.mjs — the encoder's document comparator: two block-model documents (expected = the gated
 * delivered document, got = the encoded one) compared at one level. A library module (no CLI); pure apart from reading
 * sanitise.js's entity table once, and nothing runs on import.
 *
 * compareDocs(expectedHtml, gotHtml, {level = 'text'}) → {equal, level, levels, diffs}
 *   levels  {core, text, strict, byte}: the verdict at every level
 *   diffs   [{where, kind, level, expected, got}] at the levels `level` includes (equal ⇔ no diffs); where is
 *           `s<section>.<item> <sig>[ r<row>c<cell>]`, `… [r<row> ]stray<n>`, `metadata:<key>`,
 *           `s<n> section-metadata:<key>` or `doc`
 *
 * Levels (design § 2, tightened by decision D0): core ⊂ text ⊂ strict; byte extends text. Sections are the children of
 * <main>; a section holding only the metadata block is not one. Items are blocks (`div` with a class: block:<name>.
 * <variants>) and default content (dc:<tag>; a run of non-whitespace text directly in a section is dc:#text, directly in
 * <main> a section of its own); units are default-content items, block cells and stray text (a run of non-whitespace text
 * in a block or a row outside its cells).
 *   core    the same sections, section styles (lower case), item sequence and rows × cells, stray text in the same
 *           places; every unit's text equal after decoding entities, NFC and collapsing all whitespace, NBSP included
 *           kinds: section-count, missing-item, extra-item, section-style, rows-cells, stray-text, text, text-missing,
 *           text-extra
 *   text    + every code point equal after decoding (NBSP kept, no NFC); only runs of ASCII whitespace collapse to one
 *           space and a unit's edges are trimmed (none ≠ one); inside pre / code / textarea nothing collapses
 *           kind: text-exact
 *   strict  + metadata and section-metadata rows, and each unit's inline markup — tags, then href, src, alt and title
 *           with their values exact — with text placed as at `text`                kinds: metadata, section-metadata, markup
 *   byte    + each unit's raw text nodes equal after decoding, no whitespace rule at all (reported; not an acceptance
 *           level)                                                                    kind: text-byte
 * Block boundaries (p, li, div, td, br …) separate text, so `</li><li>` and `</li>\n<li>` read the same and whitespace
 * beside them is never content. Entities decode once, with sanitise.js's own table (+ numeric references), so a document
 * compares the same before and after sanitise: `&eacute;`, `&#233;` and `é` are one code point, `&amp;eacute;` is not.
 * Attribute values are dom.mjs's own single decoding, after sanitise's named references outside dom's table have been
 * rewritten as numeric ones.
 */
import { readFileSync } from 'node:fs';
import { attr, isEl, kids, parseHTML, qs } from './dom.mjs';
import { deployPath } from './deps.mjs';

export const LEVELS = ['core', 'text', 'strict', 'byte'];
const COUNTS = { core: ['core'], text: ['core', 'text'], strict: ['core', 'text', 'strict'], byte: ['core', 'text', 'byte'] };

const SEPARATORS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const PRESERVE = new Set(['pre', 'code', 'textarea']);
const HIDDEN = new Set(['script', 'style', 'noscript', 'template']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const MARKUP_ATTRS = ['href', 'src', 'alt', 'title'];
const ASCII_WS = /[\t\n\f\r ]+/g;
const BASIC = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

let named = null;
function entityTable() {
  if (named) return named;
  const file = deployPath('sanitise.js');
  const table = new Map();
  for (const m of readFileSync(file, 'utf8').matchAll(/\[0x([0-9a-f]+),\s*'&([a-z][a-z0-9]*);'\]/gi)) table.set(m[2], String.fromCodePoint(parseInt(m[1], 16)));
  if (!table.size) throw new Error(`compare: no entity table found in ${file}`);
  named = table;
  return named;
}
function decode(s) {
  const table = entityTable();
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] !== '#') return table.get(e) ?? BASIC[e.toLowerCase()] ?? m;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

// dom.mjs decodes attribute values once, numeric references and these names only: rewrite sanitise's other named
// references as numeric ones first, so its single decoding is complete (`&amp;eacute;` stays the text `&eacute;`)
const DOM_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp']);
function numericRefs(html) {
  const table = entityTable();
  return html.replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
    if (DOM_NAMES.has(name.toLowerCase())) return m;
    const ch = table.get(name);
    return ch ? `&#${ch.codePointAt(0)};` : m;
  });
}

// ---- a unit as tokens: text (decoded; `pre` inside a whitespace-preserving element), open / close (`sep` = boundary) ----
function tokens(node, withSelf) {
  const out = [];
  const visit = (n, pre) => {
    if (n.type === 'text') { out.push({ t: 'text', s: decode(n.text), pre }); return; }
    if (!isEl(n) || HIDDEN.has(n.tag)) return;
    const sep = !pre && SEPARATORS.has(n.tag);
    out.push({ t: 'open', tag: n.tag, sep, attrs: MARKUP_ATTRS.filter((k) => attr(n, k) !== undefined).map((k) => [k, attr(n, k)]) });
    if (VOID.has(n.tag)) return;
    for (const c of n.children) visit(c, pre || PRESERVE.has(n.tag));
    out.push({ t: 'close', tag: n.tag, sep });
  };
  if (withSelf) visit(node, false); else for (const c of node.children) visit(c, false);
  return out;
}

const coreText = (toks) => toks.map((k) => (k.t === 'text' ? k.s : k.sep ? ' ' : '')).join('').normalize('NFC').replace(/[\s\u00a0]+/g, ' ').trim();

function exactText(toks) {
  const segs = [];
  const push = (s, pre) => { const last = segs[segs.length - 1]; if (last && !last.pre && !pre) last.s += s; else segs.push({ s, pre }); };
  for (const k of toks) if (k.t === 'text') push(k.s, k.pre); else if (k.sep) push(' ', false);
  for (const g of segs) if (!g.pre) g.s = g.s.replace(ASCII_WS, ' ');
  if (segs.length && !segs[0].pre) segs[0].s = segs[0].s.replace(/^ /, '');
  const last = segs[segs.length - 1];
  if (last && !last.pre) last.s = last.s.replace(/ $/, '');
  return segs.map((g) => g.s).join('');
}

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
function markup(toks) {
  const merged = [];
  for (const k of toks) {
    const last = merged[merged.length - 1];
    if (k.t === 'text' && !k.pre && last?.t === 'text' && !last.pre) last.s += k.s;
    else merged.push(k.t === 'text' ? { ...k } : k);
  }
  const boundary = (k) => !k || (k.t !== 'text' && k.sep);
  return merged.map((k, i) => {
    if (k.t === 'open') return `<${k.tag}${k.attrs.map(([a, v]) => ` ${a}="${escAttr(v)}"`).join('')}>`;
    if (k.t === 'close') return `</${k.tag}>`;
    if (k.pre) return escText(k.s);
    let s = k.s.replace(ASCII_WS, ' ');
    if (boundary(merged[i - 1])) s = s.replace(/^ /, '');
    if (boundary(merged[i + 1])) s = s.replace(/ $/, '');
    return escText(s);
  }).join('');
}

const unit = (toks) => ({ core: coreText(toks), text: exactText(toks), markup: markup(toks), byte: toks.filter((k) => k.t === 'text').map((k) => k.s).join('') });
const classes = (n) => String(attr(n, 'class') || '').split(/\s+/).filter(Boolean);

// a key/value block (metadata, section-metadata) → Map(lower-case key → value unit); a later row wins, as in EDS
function readRows(block, into) {
  for (const r of kids(block)) {
    const [k, v] = kids(r);
    if (k) into.set(coreText(tokens(k, false)).toLowerCase(), unit(v ? tokens(v, false) : []));
  }
}

// a node's children as elements and text runs (consecutive text nodes); a run of whitespace only is dropped
function childParts(n) {
  const parts = [];
  for (const c of n.children) {
    if (isEl(c)) { parts.push(c); continue; }
    if (c.type !== 'text') continue;
    const last = parts[parts.length - 1];
    if (Array.isArray(last)) last.push(c); else parts.push([c]);
  }
  return parts.filter((p) => !Array.isArray(p) || /\S/.test(decode(p.map((t) => t.text).join(''))));
}
const runUnit = (run) => unit(run.map((t) => ({ t: 'text', s: decode(t.text), pre: false })));
// text a block holds outside its rows, and each row outside its cells: [{at: '' | ' r<row>', unit}] → keyed `<at> stray<n>`
function strays(block) {
  const out = [];
  const collect = (n, at) => childParts(n).filter(Array.isArray).forEach((run, i) => out.push({ key: `${at} stray${i}`, unit: runUnit(run) }));
  collect(block, '');
  kids(block).forEach((r, ri) => collect(r, ` r${ri}`));
  return out;
}

function normalise(html) {
  const doc = parseHTML(numericRefs(String(html ?? '')));
  const main = qs(doc, 'main') || qs(doc, 'body') || doc;
  const meta = new Map();
  const sections = [];
  for (const sec of childParts(main)) {
    const s = { meta: new Map(), style: null, items: [] };
    let hadMeta = false;
    for (const c of Array.isArray(sec) ? [sec] : childParts(sec)) {
      if (Array.isArray(c)) { s.items.push({ sig: 'dc:#text', unit: runUnit(c) }); continue; }
      const cls = classes(c);
      if (c.tag === 'div' && cls.length) {
        if (cls[0] === 'metadata') { hadMeta = true; readRows(c, meta); continue; }
        if (cls[0] === 'section-metadata') { readRows(c, s.meta); continue; }
        s.items.push({ sig: `block:${cls.join('.')}`, rows: kids(c).map((r) => kids(r).map((cell) => unit(tokens(cell, false)))), strays: strays(c) });
      } else s.items.push({ sig: `dc:${c.tag}`, unit: unit(tokens(c, true)) });
    }
    if (s.meta.has('style')) s.style = s.meta.get('style').core.toLowerCase();
    if (s.items.length || s.meta.size || !hadMeta) sections.push(s);
  }
  return { meta, sections };
}

// longest common subsequence of two lists by key → [['=' | '-' | '+', item]]
function lcs(a, b, key) {
  const ka = a.map(key); const kb = b.map(key); const n = a.length; const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { ops.push(['=', a[i]]); i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i += 1; } else { ops.push(['+', b[j]]); j += 1; }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

const itemUnits = (it, where) => (it.unit ? [{ where, ...it.unit }] : [...it.rows.flatMap((r, ri) => r.map((c, ci) => ({ where: `${where} r${ri}c${ci}`, ...c }))), ...it.strays.map((x) => ({ where: `${where}${x.key}`, ...x.unit }))]);
const docUnits = (d) => d.sections.flatMap((s, si) => s.items.flatMap((it, ii) => itemUnits(it, `s${si}.${ii} ${it.sig}`)));

export function compareDocs(expectedHtml, gotHtml, { level = 'text' } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`compareDocs: unknown level "${level}" (${LEVELS.join(' | ')})`);
  const E = normalise(expectedHtml);
  const G = normalise(gotHtml);
  const all = [];
  const add = (lv, kind, where, expected, got) => all.push({ where, kind, level: lv, expected, got });
  const textDiffs = (eu, gu) => {
    for (const [op, u] of lcs(eu, gu, (x) => x.core)) if (op !== '=') add('core', op === '-' ? 'text-missing' : 'text-extra', u.where, op === '-' ? u.core : null, op === '+' ? u.core : null);
  };
  const compareUnit = (e, g, where) => {
    if (e.core !== g.core) add('core', 'text', where, e.core, g.core);
    else if (e.text !== g.text) add('text', 'text-exact', where, e.text, g.text);
    else {
      if (e.markup !== g.markup) add('strict', 'markup', where, e.markup, g.markup);
      if (e.byte !== g.byte) add('byte', 'text-byte', where, e.byte, g.byte);
    }
  };
  const compareRows = (e, g, prefix, kind) => {
    for (const k of [...new Set([...e.keys(), ...g.keys()])].sort()) {
      const a = e.get(k); const b = g.get(k);
      if (a && b && a.text === b.text && a.markup === b.markup) continue;
      const showMarkup = a && b && a.text === b.text;
      add('strict', kind, `${prefix}:${k}`, a ? (showMarkup ? a.markup : a.text) : null, b ? (showMarkup ? b.markup : b.text) : null);
    }
  };

  if (E.sections.length !== G.sections.length) add('core', 'section-count', 'doc', E.sections.length, G.sections.length);
  const seq = (d) => d.sections.flatMap((s, si) => [{ sig: '§', where: `s${si}` }, ...s.items.map((it, ii) => ({ sig: it.sig, where: `s${si}.${ii} ${it.sig}` }))]);
  const es = seq(E); const gs = seq(G);
  if (es.length === gs.length && es.every((x, i) => x.sig === gs[i].sig)) {
    E.sections.forEach((s, si) => {
      const g = G.sections[si];
      if (s.style !== g.style) add('core', 'section-style', `s${si}`, s.style, g.style);
      compareRows(s.meta, g.meta, `s${si} section-metadata`, 'section-metadata');
      s.items.forEach((it, ii) => {
        const gi = g.items[ii]; const where = `s${si}.${ii} ${it.sig}`;
        if (it.unit) { compareUnit(it.unit, gi.unit, where); return; }
        const shape = (rows) => rows.map((r) => r.length).join(',');
        if (shape(it.rows) !== shape(gi.rows)) { add('core', 'rows-cells', where, shape(it.rows), shape(gi.rows)); textDiffs(itemUnits(it, where), itemUnits(gi, where)); return; }
        it.rows.forEach((r, ri) => r.forEach((c, ci) => compareUnit(c, gi.rows[ri][ci], `${where} r${ri}c${ci}`)));
        const gotStrays = new Map(gi.strays.map((x) => [x.key, x.unit]));
        for (const x of it.strays) if (gotStrays.has(x.key)) compareUnit(x.unit, gotStrays.get(x.key), `${where}${x.key}`); else add('core', 'stray-text', `${where}${x.key}`, x.unit.core, null);
        const expectedKeys = new Set(it.strays.map((x) => x.key));
        for (const x of gi.strays) if (!expectedKeys.has(x.key)) add('core', 'stray-text', `${where}${x.key}`, null, x.unit.core);
      });
    });
  } else {
    for (const [op, x] of lcs(es, gs, (y) => y.sig)) if (op !== '=') add('core', op === '-' ? 'missing-item' : 'extra-item', x.where, op === '-' ? x.sig : null, op === '+' ? x.sig : null);
    textDiffs(docUnits(E), docUnits(G));
  }
  compareRows(E.meta, G.meta, 'metadata', 'metadata');

  const clean = (lv) => !all.some((d) => d.level === lv);
  const levels = { core: clean('core') };
  levels.text = levels.core && clean('text');
  levels.strict = levels.text && clean('strict');
  levels.byte = levels.text && clean('byte');
  return { equal: levels[level], level, levels, diffs: all.filter((d) => COUNTS[level].includes(d.level)) };
}
