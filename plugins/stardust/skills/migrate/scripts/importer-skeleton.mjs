#!/usr/bin/env node
/**
 * migrate/importer-skeleton.mjs — the DOM-based sibling importer, driven by a vocabulary map.
 *
 * Turns a rendered capture (stardust/current/pages/<slug>.html) into a migrated document for a
 * template's siblings (Path A′) WITHOUT a hand-written parser: the project authors
 * stardust/import/vocabulary.json (what each source module is and which emitter takes it) and
 * stardust/import/transform.json (rich-text rules); this script does the walk. It encodes
 * reference/importer-recipe.md rules 1, 3, 4, 5, 6, 7, 10 and the § Idempotent writer rules
 * (patches last, import-manifest sha guard, manifest-only overwrites, 0-sections exit,
 * state.json.migrate.generators[]). Seven field migrations wrote this importer by hand; the
 * regex variants swallowed component runs, the descendant-matching ones flattened modules to prose.
 *
 * Runtime: a built-in HTML parser + CSS-selector matcher (tag, #id, .class, [attr op value],
 * combinators, :scope :not :is :has :first-child :last-child :empty). Browser-serialised captures
 * are regular HTML, so no browser is launched and NO network request can happen — zero source hits
 * by construction (hit-minimisation), and the plugin keeps zero runtime dependencies.
 *
 * vocabulary.json  { root: "<selector>", chrome: ["<sel>", …], wrappers: ["<sel>", …],
 *                    moduleSelectors: ["[data-module]", …]   (what counts as a source module; default below),
 *                    markers: { "<selector>": { kind: "<ledger kind>", emitter: "<emitter>" } } }
 *   emitters: block:<name>[ <variant tokens>] · section-style:<token> · default-content · drop:<reason> · dynamics:<row>
 *   classification is el.matches(<selector>) on the element itself (rule 3); recursion only through wrappers[] (rule 4/5);
 *   N adjacent same-block runs become one block with N rows (rule 10).
 * transform.json   { headings: { "<class>": "h2" }, inline: { b: "strong", i: "em" },
 *                    links: { stripExt: ".html", stripParams: ["utm_"], anchors: "keep|drop" }, whitespace: { emptyP: "drop|keep" } }
 * patches          stardust/patches/<slug>.json  [{ selector, op: replace|attr|remove, name?, value? }] — applied LAST on the output.
 *
 * Outputs per page (exit 0): stardust/migrated/<outputPath> (URL-literal rule) in the block-model document form
 * (sections as <div>, blocks as <div class="name variant"><div><div>cell</div></div></div>, a metadata block with a
 * `lang` row), its _meta.json sidecar (renderBranch "A'", fidelityTier "sibling", modules[], audit.import),
 * stardust/import-manifest.json (path → sha), state.json.migrate.generators[<template>] = { script, sha },
 * and the run summary stardust/migrated/_import/summary.{json,md}.
 * audit.import = { captureSha, vocabularySha, transformSha, captureProvenance, unmapped[], flattened[], dropped[],
 *                  hidden[], hiddenLive: "stamped"|"unstamped", patchesApplied[] }
 *
 * The hard stop (exit 2, nothing written for the page):
 *   (a) root selector not found, or it resolves to body/html or a chrome landmark (rule 5, fail loud);
 *   (b) the emitted document has 0 sections or no <h1> (the sixty-six empty pages);
 *   (c) a source module with visible content has no emitter → audit.import.unmapped[] · a `block:` kind that
 *       could not be shaped and would flatten to prose → flattened[] (both 🔴 — "flattened to prose with a
 *       logged warning" is the defect class, never a note); no numeric tolerance exists;
 *   (d) a manifest path whose on-disk sha differs from the recorded one (a hand edit) — refuse to overwrite;
 *   (e) plan time (--template / --all): a lift-ledger kind (stardust/replica/progress.json modules[], pageType or
 *       firstSeen in the template) with no emitter in vocabulary.json BLOCKS the template — every page of it is
 *       recorded `blocked`, nothing renders (fidelity-tiers.md § Module-map precondition). Ledger selectors also
 *       identify modules on a page: a visible one with no emitter is unmapped[] under its ledger kind.
 * Escapes: `drop:<reason>` / `dynamics:<row>` emitters in the map (recorded), a patch file, `--force` for (d).
 * Bulk (--all / --template): per-page records (--template skips pages already `migrated` that have no capture); stop on
 * the first failure unless --continue; a kind unmapped on
 * ≥ 3 pages of one template stops that template early (map it once instead of failing 500 pages);
 * exit 2 when any page failed. Second run with unchanged inputs → zero file writes.
 * Hidden-live: nodes stamped `data-hidden-live` by the capture are skipped (recorded in hidden[]; <details> kept);
 * an unstamped capture skips nothing and reports hiddenLive: "unstamped".
 *
 * Usage:
 *   node skills/migrate/scripts/importer-skeleton.mjs (--slug <s> | --template <t> | --all) [--root <projectDir>]
 *        [--out <migratedDir>] [--dry-run] [--report-only] [--force] [--continue] [--json]
 * Exit: 0 written · 1 usage / missing capture (the run stops there; manifest + summary still flush) / invalid vocabulary
 *       or transform · 2 a page failed (see above)
 * Contract: reference/importer-recipe.md § Skeleton contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ===================================================================================== mini DOM
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'noscript', 'template', 'textarea']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'details', 'summary']);
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export const decodeEntities = (v) => String(v).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m)));
const el = (tag, attrs = {}, parent = null) => ({ type: 'element', tag, attrs, children: [], parent });
const txt = (text, parent) => ({ type: 'text', text, parent });

export function parseHTML(html) {
  const root = { type: 'root', tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root]; let i = 0; const n = html.length;
  const top = () => stack[stack.length - 1];
  const push = (node) => { top().children.push(node); };
  const closeTo = (tag) => { for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k].tag === tag) { stack.length = k; return true; } return false; };
  while (i < n) {
    if (html[i] !== '<') { const j = html.indexOf('<', i); const s = html.slice(i, j === -1 ? n : j); if (s) push(txt(s, top())); i = j === -1 ? n : j; continue; }
    if (html.startsWith('<!--', i)) { const j = html.indexOf('-->', i + 4); i = j === -1 ? n : j + 3; continue; }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) { const j = html.indexOf('>', i); i = j === -1 ? n : j + 1; continue; }
    if (html.startsWith('</', i)) { const j = html.indexOf('>', i); const tag = html.slice(i + 2, j === -1 ? n : j).trim().toLowerCase().split(/\s/)[0]; closeTo(tag); i = j === -1 ? n : j + 1; continue; }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 64));
    if (!m) { push(txt('<', top())); i += 1; continue; }
    const tag = m[1].toLowerCase();
    // find the end of the tag, honouring quotes
    let j = i + m[0].length; let q = null;
    while (j < n) { const c = html[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j += 1; }
    const body = html.slice(i + m[0].length, j); const selfClose = /\/\s*$/.test(body);
    const attrs = {}; ATTR_RE.lastIndex = 0; let a;
    while ((a = ATTR_RE.exec(body.replace(/\/\s*$/, '')))) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    i = j + 1;
    // implicit closes browsers apply that hand-written fixtures rely on
    if (tag === 'li' && top().tag === 'li') stack.pop();
    if ((tag === 'dt' || tag === 'dd') && (top().tag === 'dt' || top().tag === 'dd')) stack.pop();
    if ((tag === 'td' || tag === 'th') && (top().tag === 'td' || top().tag === 'th')) stack.pop();
    if (tag === 'tr' && (top().tag === 'td' || top().tag === 'th')) stack.pop();
    if (tag === 'tr' && top().tag === 'tr') stack.pop();
    if (tag === 'option' && top().tag === 'option') stack.pop();
    if (BLOCK.has(tag) && top().tag === 'p') stack.pop();
    const node = el(tag, attrs, top()); push(node);
    if (RAW.has(tag)) { const close = new RegExp(`</${tag}\\s*>`, 'i'); close.lastIndex = 0; const rest = html.slice(i); const c = close.exec(rest); const raw = rest.slice(0, c ? c.index : rest.length); if (raw) node.children.push(txt(raw, node)); i += c ? c.index + c[0].length : rest.length; continue; }
    if (VOID.has(tag) || selfClose) continue;
    stack.push(node);
  }
  return root;
}
export const isEl = (n) => n && n.type === 'element';
export const kids = (n) => (n ? n.children.filter(isEl) : []);
export const attr = (n, k) => (n && n.attrs ? n.attrs[k] : undefined);
const classList = (n) => String(attr(n, 'class') || '').split(/\s+/).filter(Boolean);
export function textOf(n) { if (!n) return ''; if (n.type === 'text') return n.text; return n.children.map(textOf).join(''); }
export const cleanText = (n) => textOf(n).replace(/\s+/g, ' ').trim();
export function remove(n) { if (n.parent) { const i = n.parent.children.indexOf(n); if (i !== -1) n.parent.children.splice(i, 1); } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
export function serialize(n) {
  if (n.type === 'text') return n.parent && RAW.has(n.parent.tag) ? n.text : n.text.replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;');
  if (n.type === 'root') return n.children.map(serialize).join('');
  const attrs = Object.entries(n.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}>`;
  return `<${n.tag}${attrs}>${n.children.map(serialize).join('')}</${n.tag}>`;
}
export const innerHTML = (n) => n.children.map(serialize).join('');
export function* walk(n) { for (const c of n.children) { if (isEl(c)) { yield c; yield* walk(c); } } }

// selectors ----------------------------------------------------------------------------------
function splitTop(s, sep) { const out = []; let d = 0; let q = null; let cur = ''; for (const c of s) { if (q) { if (c === q) q = null; cur += c; continue; } if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d += 1; else if (c === ')' || c === ']') d -= 1; if (c === sep && d === 0) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); }
const selCache = new Map();
export function parseSelector(sel) {
  if (selCache.has(sel)) return selCache.get(sel);
  const list = splitTop(sel, ',').map((complex) => {
    // tokenise compounds + combinators
    const parts = []; let cur = ''; let comb = ' '; let d = 0; let q = null;
    const flush = () => { if (cur.trim()) { parts.push({ comb, compound: parseCompound(cur.trim()) }); cur = ''; comb = ' '; } };
    for (let i = 0; i < complex.length; i += 1) {
      const c = complex[i];
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(' || c === '[') d += 1; if (c === ')' || c === ']') d -= 1;
      if (d === 0 && (c === '>' || c === '+' || c === '~')) { flush(); comb = c; continue; }
      if (d === 0 && /\s/.test(c)) { flush(); continue; }
      cur += c;
    }
    flush();
    if (parts.length) parts[0].comb = null;
    return parts;
  });
  selCache.set(sel, list);
  return list;
}
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:([\w-]+)(?:\((.*)\))?/g;
  let m; let last = 0;
  while ((m = re.exec(s))) {
    if (m.index !== last) throw new Error(`bad selector near "${s.slice(last)}"`);
    last = re.lastIndex;
    if (m[1] !== undefined) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2] !== undefined) c.id = m[2];
    else if (m[3] !== undefined) c.classes.push(m[3]);
    else if (m[4] !== undefined) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? null });
    else if (m[9] !== undefined) c.pseudos.push({ name: m[9], arg: m[10] !== undefined ? m[10] : null });
  }
  if (last !== s.length) throw new Error(`bad selector "${s}"`);
  return c;
}
function matchCompound(n, c, scope) {
  if (!isEl(n)) return false;
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id && attr(n, 'id') !== c.id) return false;
  if (c.classes.length) { const cl = classList(n); if (!c.classes.every((x) => cl.includes(x))) return false; }
  for (const a of c.attrs) {
    const v = attr(n, a.name); if (v === undefined) return false;
    if (a.op === null) continue;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === '|=' && !(v === a.value || v.startsWith(`${a.value}-`))) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
  }
  for (const p of c.pseudos) {
    const sibs = n.parent ? kids(n.parent) : [n];
    if (p.name === 'scope') { if (n !== scope) return false; }
    else if (p.name === 'not') { if (matches(n, p.arg, scope)) return false; }
    else if (p.name === 'is' || p.name === 'where') { if (!matches(n, p.arg, scope)) return false; }
    else if (p.name === 'has') { if (![...walk(n)].some((d) => matches(d, p.arg, n))) return false; }
    else if (p.name === 'first-child') { if (sibs[0] !== n) return false; }
    else if (p.name === 'last-child') { if (sibs[sibs.length - 1] !== n) return false; }
    else if (p.name === 'first-of-type') { if (sibs.find((x) => x.tag === n.tag) !== n) return false; }
    else if (p.name === 'empty') { if (n.children.some((x) => isEl(x) || x.text.trim())) return false; }
    else throw new Error(`unsupported pseudo-class :${p.name}`);
  }
  return true;
}
function matchComplex(n, parts, idx, scope) {
  const part = parts[idx];
  if (!matchCompound(n, part.compound, scope)) return false;
  if (idx === 0) return true;
  const comb = part.comb;
  if (comb === '>') return n.parent && isEl(n.parent) ? matchComplex(n.parent, parts, idx - 1, scope) : false;
  if (comb === ' ') { for (let p = n.parent; p && isEl(p); p = p.parent) if (matchComplex(p, parts, idx - 1, scope)) return true; return false; }
  const sibs = n.parent ? kids(n.parent) : []; const i = sibs.indexOf(n);
  if (comb === '+') return i > 0 && matchComplex(sibs[i - 1], parts, idx - 1, scope);
  if (comb === '~') { for (let k = i - 1; k >= 0; k -= 1) if (matchComplex(sibs[k], parts, idx - 1, scope)) return true; return false; }
  return false;
}
export function matches(n, sel, scope = null) { return parseSelector(sel).some((parts) => parts.length && matchComplex(n, parts, parts.length - 1, scope)); }
export function qsa(rootNode, sel) { const out = []; for (const d of walk(rootNode)) if (matches(d, sel, rootNode)) out.push(d); return out; }
export const qs = (rootNode, sel) => qsa(rootNode, sel)[0] || null;

// ===================================================================================== importer
const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const EMITTER_RE = /^(block:[a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)*|section-style:[a-z0-9][a-z0-9-]*|default-content|drop:.+|dynamics:.+)$/;
const DEFAULT_MODULE_SELECTORS = ['[data-module]', '[data-component]', '[data-tpl]', '[data-block]'];
const CHROME_ROOT = 'body, html, header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';
const STRIP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas', 'object', 'embed', 'link', 'meta']);
const INLINE = new Set(['span', 'a', 'strong', 'em', 'b', 'i', 'img', 'picture', 'small', 'sup', 'sub', 'time', 'label', 'br', 'abbr', 'code']);
const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'start']);

export function validateVocabulary(v) {
  const errs = [];
  if (!v || typeof v !== 'object') return ['vocabulary.json is not an object'];
  if (typeof v.root !== 'string' || !v.root.trim()) errs.push('root: a selector string is required');
  for (const k of ['chrome', 'wrappers', 'moduleSelectors']) if (v[k] !== undefined && !(Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string'))) errs.push(`${k}: must be an array of selector strings`);
  if (v.markers !== undefined && (typeof v.markers !== 'object' || Array.isArray(v.markers))) errs.push('markers: must be an object keyed by selector');
  for (const [sel, m] of Object.entries(v.markers || {})) {
    if (!m || typeof m !== 'object') { errs.push(`markers["${sel}"]: must be { kind, emitter }`); continue; }
    if (m.emitter !== undefined && m.emitter !== null && !EMITTER_RE.test(String(m.emitter))) errs.push(`markers["${sel}"].emitter "${m.emitter}": use block:<name>[ variants] · section-style:<token> · default-content · drop:<reason> · dynamics:<row>`);
    try { parseSelector(sel); } catch (e) { errs.push(`markers["${sel}"]: ${e.message}`); }
  }
  for (const s of [v.root, ...(v.chrome || []), ...(v.wrappers || []), ...(v.moduleSelectors || [])]) { if (typeof s !== 'string') continue; try { parseSelector(s); } catch (e) { errs.push(e.message); } }
  return errs;
}

/** URL-literal output path (migration-procedure.md § Output path mapping). */
export function outputPathFor(url, slug) {
  let p = null;
  if (url) { try { p = new URL(url).pathname; } catch { p = null; } }
  if (!p || p === '/') return { path: 'index.html', dflt: false };
  p = p.replace(/^\/+/, '');
  if (/\.html?$/i.test(p)) return { path: p, dflt: false };
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return { path: p, dflt: false };
  if (p.endsWith('/')) return { path: `${p}index.html`, dflt: false };
  return { path: `${p}/index.html`, dflt: true };
}
const sidecarFor = (out) => (out.endsWith('/index.html') || out === 'index.html' ? join(dirname(out), '_meta.json') : out.replace(/\.html?$/i, '._meta.json'));

const visible = (n) => cleanText(n).length > 0 || qs(n, 'img, picture, video, a[href]') !== null;

// rich-text pass (rules 6, 7 + transform.json) ------------------------------------------------------
function richText(n, tf, ctx) {
  const inline = { b: 'strong', i: 'em', ...(tf.inline || {}) };
  const headings = tf.headings || {};
  const links = tf.links || {};
  const emptyP = (tf.whitespace && tf.whitespace.emptyP) || 'drop';
  const out = [];
  const clean = (node) => {
    if (node.type === 'text') { const t = node.text.replace(/\{\{[^}]*\}\}/g, ''); return t.replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;'); }
    if (!isEl(node) || STRIP.has(node.tag)) return '';
    if (attr(node, 'data-hidden-live') !== undefined && node.tag !== 'details' && ctx.stamped) { ctx.hidden.push({ selector: describe(node), reason: attr(node, 'data-hidden-live') || 'hidden' }); return ''; }
    let tag = node.tag;
    for (const c of classList(node)) if (headings[c]) tag = headings[c];
    if (inline[tag]) tag = inline[tag];
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span' && !node.children.some(isEl)) { /* unwrap wrappers: div.p → p, bare div → its children */
      if (tag !== 'span') { const chunks = []; let run = ''; for (const c of node.children) { if (isEl(c) && (BLOCK.has(c.tag) || c.tag === 'img' || c.tag === 'picture')) { if (run.trim()) chunks.push(`<p>${run.trim()}</p>`); run = ''; chunks.push(clean(c)); } else run += clean(c); } if (run.trim()) chunks.push(`<p>${run.trim()}</p>`); return chunks.join('\n'); }
    }
    if (/^h[1-6]$/.test(tag) && !cleanText(node) && !qs(node, 'img')) return ''; // rule 6: empty heading
    if (tag === 'p' && emptyP === 'drop' && !cleanText(node) && !qs(node, 'img, a[href]')) return '';
    const attrs = {};
    for (const [k, v] of Object.entries(node.attrs)) if (KEEP_ATTRS.has(k)) attrs[k] = v;
    if (tag === 'a' && attrs.href !== undefined) {
      let h = String(attrs.href).trim();
      if (/^\s*javascript:/i.test(h) || h === '#' || h === '') { delete attrs.href; tag = 'span'; } // rule 7
      else {
        try { const u = new URL(h, 'https://x.invalid/'); for (const k of [...u.searchParams.keys()]) if ((links.stripParams || []).some((pfx) => k.startsWith(pfx))) u.searchParams.delete(k); if (links.stripExt && u.pathname.endsWith(links.stripExt)) u.pathname = u.pathname.slice(0, -links.stripExt.length); if (links.anchors === 'drop') u.hash = ''; h = u.origin === 'https://x.invalid' ? `${u.pathname}${u.search}${u.hash}` : u.href; } catch { /* keep */ }
        attrs.href = h;
      }
    }
    if (tag === 'img' && attrs.alt === undefined) attrs.alt = '';
    if ((tag === 'img' || tag === 'source') && attrs.src && ctx.base) { try { attrs.src = new URL(attrs.src, ctx.base).href; } catch { /* keep as authored */ } } // D4: a fully qualified source URL — the ingester re-hosts it
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    if (VOID.has(tag)) return `<${tag}${a}>`;
    const inner = node.children.map(clean).join('');
    if (tag === 'span' && !a) return inner;
    return `<${tag}${a}>${inner}</${tag}>`;
  };
  const html = clean(n).trim();
  if (html) out.push(/^<(h[1-6]|p|ul|ol|table|blockquote|pre|dl|img|picture|details|hr|div)/.test(html) ? html : `<p>${html}</p>`);
  return out.join('\n');
}
const describe = (n) => `${n.tag}${attr(n, 'id') ? `#${attr(n, 'id')}` : ''}${classList(n).slice(0, 2).map((c) => `.${c}`).join('')}`;

// block shaping (rule 4/5/10) ----------------------------------------------------------------------------------------
function shapeRows(n, tf, ctx) {
  const units = kids(n).filter((u) => !STRIP.has(u.tag) && visible(u));
  const cellsOf = (u) => {
    const ks = kids(u);
    const media = ks.find((k) => k.tag === 'img' || k.tag === 'picture' || k.tag === 'figure' || qs(k, 'img') && !cleanText(k));
    if (media && ks.length >= 2) { const rest = ks.filter((k) => k !== media).map((k) => richText(k, tf, ctx)).filter(Boolean).join('\n'); return [richText(media, tf, ctx), rest].filter((c) => c); }
    return [richText(u, tf, ctx)];
  };
  if (!units.length) { const one = richText(n, tf, ctx); return one ? [[one]] : []; }
  // inline-only children (spans, links, an image): the marked element is ONE row, its children the cells (rule 10)
  if (units.every((u) => INLINE.has(u.tag))) { const cells = units.map((u) => richText(u, tf, ctx)).filter((c) => c && c.trim()); return cells.length ? [cells] : []; }
  return units.map(cellsOf).filter((r) => r.some((c) => c && c.trim()));
}

// the walk --------------------------------------------------------------------------------------------------------------
export function importCapture(html, vocab, tf, opts = {}) {
  const doc = parseHTML(html);
  const report = { unmapped: [], flattened: [], dropped: [], hidden: [], deviations: [], hiddenLive: 'unstamped' };
  const htmlEl = qs(doc, 'html'); const body = qs(doc, 'body') || doc;
  const stamped = (htmlEl && attr(htmlEl, 'data-hidden-live-stamp') !== undefined) || attr(body, 'data-hidden-live-stamp') !== undefined;
  report.hiddenLive = stamped ? 'stamped' : 'unstamped';
  const ctx = { stamped, hidden: report.hidden, base: opts.base || null };
  const meta = {
    title: cleanText(qs(doc, 'title')) || (qs(doc, 'meta[property="og:title"]') ? attr(qs(doc, 'meta[property="og:title"]'), 'content') : ''),
    description: qs(doc, 'meta[name="description"]') ? attr(qs(doc, 'meta[name="description"]'), 'content') || '' : '',
    canonical: qs(doc, 'link[rel="canonical"]') ? attr(qs(doc, 'link[rel="canonical"]'), 'href') || '' : '',
    lang: (htmlEl && attr(htmlEl, 'lang')) || '',
  };
  for (const s of [...walk(doc)].filter((n) => STRIP.has(n.tag))) remove(s);
  for (const sel of vocab.chrome || []) for (const c of qsa(doc, sel)) remove(c);
  const rootEl = qs(doc, vocab.root);
  if (!rootEl) return { error: `root selector "${vocab.root}" matched nothing (rule 5: import from the content root, fail loud)`, report, meta };
  if (matches(rootEl, CHROME_ROOT)) return { error: `root selector "${vocab.root}" resolves to <${rootEl.tag}> — a chrome landmark or the whole body, not the content root (rule 5)`, report, meta };
  const markers = Object.entries(vocab.markers || {});
  const wrappers = vocab.wrappers || [];
  const moduleSelectors = vocab.moduleSelectors || DEFAULT_MODULE_SELECTORS;
  const ledgerMods = (vocab.ledgerModules || []).filter((m) => m && m.selector && m.kind); // unmapped lift-ledger kinds: their selector names the module
  const sections = []; let cur = { style: null, nodes: [] };
  const closeSection = () => { if (cur.nodes.length) sections.push(cur); cur = { style: null, nodes: [] }; };
  const modules = [];
  const pushBlock = (name, variants, rows) => {
    const last = cur.nodes[cur.nodes.length - 1];
    if (last && last.kind === 'block' && last.name === name && last.variants.join(' ') === variants.join(' ')) { last.rows.push(...rows); return; }
    cur.nodes.push({ kind: 'block', name, variants, rows });
    if (!modules.includes(name)) modules.push(name);
  };
  const pushHtml = (h) => { if (h && h.trim()) cur.nodes.push({ kind: 'html', html: h }); };
  const kindOf = (n) => attr(n, 'data-module') || attr(n, 'data-component') || attr(n, 'data-tpl') || attr(n, 'data-block') || classList(n)[0] || n.tag;
  const visit = (n) => {
    if (!isEl(n) || STRIP.has(n.tag)) return;
    if (stamped && attr(n, 'data-hidden-live') !== undefined && n.tag !== 'details') { report.hidden.push({ selector: describe(n), reason: attr(n, 'data-hidden-live') || 'hidden' }); return; }
    const hit = markers.find(([sel]) => matches(n, sel, rootEl)); // rule 3: the element itself, never a descendant
    if (hit) {
      const [sel, m] = hit; const emitter = m.emitter || null; const kind = m.kind || kindOf(n);
      if (!emitter) { if (visible(n)) report.unmapped.push({ kind, selector: sel, at: describe(n) }); pushHtml(richText(n, tf, ctx)); return; }
      if (emitter.startsWith('drop:')) { report.dropped.push({ kind, selector: sel, reason: emitter.slice(5) }); return; }
      if (emitter.startsWith('dynamics:')) { report.deviations.push({ kind: 'dynamic-dependency', row: emitter.slice(9), module: kind, selector: sel }); return; }
      if (emitter === 'default-content') { pushHtml(richText(n, tf, ctx)); return; }
      if (emitter.startsWith('section-style:')) { closeSection(); cur.style = emitter.slice(14); for (const c of kids(n)) visit(c); closeSection(); return; }
      const [name, ...variants] = emitter.slice(6).split(' ');
      const rows = shapeRows(n, tf, ctx);
      if (!rows.length) { report.flattened.push({ kind, selector: sel, emitter, at: describe(n) }); pushHtml(richText(n, tf, ctx)); return; }
      pushBlock(name, variants, rows);
      return;
    }
    if (n.tag === 'section') { closeSection(); for (const c of kids(n)) visit(c); closeSection(); return; }
    const lm = ledgerMods.find((m) => matches(n, m.selector, rootEl));
    if (lm) { if (visible(n)) report.unmapped.push({ kind: lm.kind, selector: lm.selector, at: describe(n), ledger: true }); pushHtml(richText(n, tf, ctx)); return; }
    if (wrappers.some((w) => matches(n, w, rootEl))) { for (const c of kids(n)) visit(c); return; } // rule 4: recurse only through declared wrappers
    if (moduleSelectors.some((s) => matches(n, s, rootEl)) && visible(n)) { report.unmapped.push({ kind: kindOf(n), selector: moduleSelectors.find((s) => matches(n, s, rootEl)), at: describe(n) }); pushHtml(richText(n, tf, ctx)); return; }
    pushHtml(richText(n, tf, ctx)); // rule 5: default content in document order
  };
  for (const c of kids(rootEl)) visit(c);
  // following siblings of the root up to the first chrome landmark (content some templates place beside <main>)
  if (opts.walkSiblings !== false && rootEl.parent) { const sibs = kids(rootEl.parent); for (const s of sibs.slice(sibs.indexOf(rootEl) + 1)) { if (matches(s, 'footer, nav, header, [role="contentinfo"]')) break; visit(s); } }
  closeSection();
  const bodyHtml = sections.map((s) => renderSection(s)).join('\n');
  // h1 presence is a DOM fact, not a regex over the serialised page: `<h1><strong>Bold</strong> start</h1>` and an image-only
  // heading are headings; `<h1><em></em></h1>` is not
  const h1El = /<h1[\s>]/.test(bodyHtml) ? qs(parseHTML(bodyHtml), 'h1') : null;
  const h1 = Boolean(h1El && (cleanText(h1El).length > 0 || qs(h1El, 'img')));
  return { sections, meta, modules, report, bodyHtml, h1 };
}
const cell = (c) => `      <div>${c}</div>`;
const renderBlock = (b) => `    <div class="${[b.name, ...b.variants].join(' ')}">\n${b.rows.map((r) => `    <div>\n${r.map(cell).join('\n')}\n    </div>`).join('\n')}\n    </div>`;
function renderSection(s) {
  const parts = s.nodes.map((n) => (n.kind === 'block' ? renderBlock(n) : n.html.split('\n').map((l) => `    ${l}`).join('\n')));
  if (s.style) parts.push(`    <div class="section-metadata">\n    <div>\n      <div>style</div>\n      <div>${esc(s.style)}</div>\n    </div>\n    </div>`);
  return `  <div>\n${parts.join('\n')}\n  </div>`;
}
export function renderDocument(res, page, template) {
  const rows = [['title', res.meta.title || page.title || page.slug], ['description', res.meta.description || ''], ['template', template || page.type || ''], ['lang', res.meta.lang || 'en']].filter(([, v]) => v);
  const metadata = `    <div class="metadata">\n${rows.map(([k, v]) => `    <div>\n      <div>${esc(k)}</div>\n      <div>${esc(v)}</div>\n    </div>`).join('\n')}\n    </div>`;
  // the metadata block rides in the LAST content section (a section holding only metadata ships an empty band — lint META)
  const body = res.bodyHtml.replace(/\n  <\/div>\s*$/, `\n${metadata}\n  </div>`);
  return `<!DOCTYPE html>\n<html lang="${esc(res.meta.lang || 'en')}">\n<head>\n<meta charset="utf-8">\n<title>${esc(res.meta.title || page.slug)}</title>\n${res.meta.description ? `<meta name="description" content="${esc(res.meta.description)}">\n` : ''}${res.meta.canonical ? `<link rel="canonical" href="${esc(res.meta.canonical)}">\n` : ''}</head>\n<body>\n<header></header>\n<main>\n${body}\n</main>\n<footer></footer>\n</body>\n</html>\n`;
}
export function applyPatches(html, patches) {
  const doc = parseHTML(html); const applied = [];
  for (const p of patches || []) {
    const hits = qsa(doc, p.selector);
    for (const h of hits) {
      if (p.op === 'remove') remove(h);
      else if (p.op === 'attr') { if (p.value === null || p.value === undefined) delete h.attrs[p.name]; else h.attrs[p.name] = String(p.value); }
      else if (p.op === 'replace') { h.children = parseHTML(String(p.value || '')).children; h.children.forEach((c) => { c.parent = h; }); }
    }
    applied.push({ selector: p.selector, op: p.op, matched: hits.length });
  }
  return { html: serialize(doc), applied };
}

// ===================================================================================== CLI
function usage(code) {
  (code ? console.error : console.log)('Usage: node skills/migrate/scripts/importer-skeleton.mjs (--slug <s> | --template <t> | --all) [--root <projectDir>] [--out <migratedDir>] [--dry-run] [--report-only] [--force] [--continue] [--json]\n  exit 0 written · 1 usage / missing capture / invalid map · 2 a page failed (root, empty, unmapped/flattened, hand edit)');
  process.exit(code);
}
export function parseArgs(argv) {
  const a = { slug: null, template: null, all: false, root: '.', out: null, dryRun: false, reportOnly: false, force: false, cont: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]; const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--slug') a.slug = next(); else if (k === '--template') a.template = next(); else if (k === '--all') a.all = true;
    else if (k === '--root') a.root = next(); else if (k === '--out') a.out = next();
    else if (k === '--dry-run') a.dryRun = true; else if (k === '--report-only') a.reportOnly = true; else if (k === '--force') a.force = true;
    else if (k === '--continue') a.cont = true; else if (k === '--json') a.json = true;
    else throw new Error(`unknown flag ${k}`);
  }
  return a;
}

export function main(argv) {
  let a; try { a = parseArgs(argv); } catch (e) { console.error(`importer-skeleton: ${e.message}`); return 1; }
  if (a.help) usage(0);
  if (!a.slug && !a.template && !a.all) { console.error('importer-skeleton: one of --slug, --template, --all is required'); return 1; }
  const root = resolve(a.root); const S = (...p) => join(root, 'stardust', ...p);
  const outDir = a.out ? resolve(root, a.out) : S('migrated');
  const vocabFile = S('import', 'vocabulary.json'); const tfFile = S('import', 'transform.json');
  const vocab = readJSON(vocabFile); if (!vocab) { console.error(`importer-skeleton: ${relative(root, vocabFile)} missing or invalid JSON — write the vocabulary map first (importer-recipe.md § Skeleton contract)`); return 1; }
  const verrs = validateVocabulary(vocab); if (verrs.length) { console.error(`importer-skeleton: vocabulary.json invalid:\n  ${verrs.join('\n  ')}`); return 1; }
  const tf = existsSync(tfFile) ? readJSON(tfFile) : {}; if (!tf || typeof tf !== 'object') { console.error(`importer-skeleton: ${relative(root, tfFile)} is not a JSON object`); return 1; }
  const stateFile = S('state.json'); const state = readJSON(stateFile, null);
  const roster = (state && state.pages) || [];
  let pages;
  if (a.slug) { const p = roster.find((x) => x.slug === a.slug) || { slug: a.slug, url: null, type: null }; pages = [p]; }
  else if (a.template) pages = roster.filter((p) => (p.type === a.template || p.template === a.template) && (p.status !== 'migrated' || existsSync(S('current', 'pages', `${p.slug}.html`)) || existsSync(S('current', 'pages', `${p.slug}.json`)))); // a page already migrated by another generator and never captured is not this run's
  else pages = roster.filter((p) => existsSync(S('current', 'pages', `${p.slug}.html`)) || existsSync(S('current', 'pages', `${p.slug}.json`)));
  if (!pages.length) { console.error(`importer-skeleton: no pages selected${a.template ? ` for template ${a.template}` : ''} (state.json pages[] with a capture under stardust/current/pages/)`); return 1; }
  // lift ledger ↔ vocabulary (fidelity-tiers.md § Module-map precondition): a kind with no emitter blocks its template at plan time
  const ledger = readJSON(S('replica', 'progress.json'), null);
  const ledgerModules = ledger && Array.isArray(ledger.modules) ? ledger.modules.filter((m) => m && m.kind) : [];
  const hasEmitter = (m) => Object.entries(vocab.markers || {}).some(([sel, v]) => v && v.emitter && (v.kind === m.kind || sel === m.selector));
  const ledgerUnmapped = ledgerModules.filter((m) => !hasEmitter(m));
  const templateOf = (m) => m.pageType || m.template || ((roster.find((p) => p.slug === m.firstSeen) || {}).template) || ((roster.find((p) => p.slug === m.firstSeen) || {}).type) || null;
  const blockedTemplates = new Map();
  for (const m of ledgerUnmapped) { const t = templateOf(m); if (!t) continue; if (!blockedTemplates.has(t)) blockedTemplates.set(t, []); blockedTemplates.get(t).push(m.kind); }
  if (!a.slug) for (const [t, kinds] of blockedTemplates) if (pages.some((p) => (p.template || p.type) === t)) console.error(`importer-skeleton: template ${t} blocked — lift-ledger kinds without an emitter: ${[...new Set(kinds)].map((k) => `"${k}"`).join(', ')} (progress.json modules[] vs vocabulary.json — map or drop:<reason>); nothing rendered for this template`);
  const effVocab = { ...vocab, ledgerModules: ledgerUnmapped.filter((m) => m.selector) };
  const manifestFile = S('import-manifest.json'); const manifest = readJSON(manifestFile, {}) || {};
  const scriptSha = sha256(readFileSync(fileURLToPath(import.meta.url)));
  const vocabularySha = sha256(readFileSync(vocabFile)); const transformSha = existsSync(tfFile) ? sha256(readFileSync(tfFile)) : null;
  const records = []; let writes = 0; let failed = 0; let missingCapture = false; const unmappedByTemplate = new Map(); const stoppedTemplates = new Set();
  const write = (file, content, { count = true } = {}) => { if (a.dryRun) return; if (existsSync(file) && readFileSync(file, 'utf8') === content) return; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); if (count) writes += 1; };
  for (const page of pages) {
    const template = page.template || page.type || null;
    if (template && stoppedTemplates.has(template)) { records.push({ slug: page.slug, status: 'skipped', reason: `template ${template} stopped early` }); continue; }
    if (!a.slug && template && blockedTemplates.has(template)) { records.push({ slug: page.slug, template, status: 'blocked', reason: `template ${template} blocked — unmapped ledger kinds ${[...new Set(blockedTemplates.get(template))].join(', ')}` }); continue; }
    const rec = { slug: page.slug, template, status: 'ok' };
    const capHtml = S('current', 'pages', `${page.slug}.html`); const capJson = S('current', 'pages', `${page.slug}.json`);
    let html = null; let provenance = null;
    if (existsSync(capHtml)) html = readFileSync(capHtml, 'utf8');
    const cj = existsSync(capJson) ? readJSON(capJson) : null;
    if (cj) { if (!html && typeof cj.renderedHtml === 'string') html = cj.renderedHtml; provenance = cj._provenance || cj.provenance || (cj.settle ? { settle: cj.settle } : null); }
    // a missing capture stops the run (exit 1) but never loses the pages already processed: the manifest and summary still flush below
    if (html === null) { console.error(`importer-skeleton: ${page.slug}: no capture (stardust/current/pages/${page.slug}.html or .json renderedHtml) — run extract; the importer never fetches the live page (rule 1)`); records.push({ slug: page.slug, template, status: 'missing', reason: 'no capture — run extract' }); missingCapture = true; break; }
    const captureSha = sha256(html);
    const res = importCapture(html, effVocab, tf, { base: page.url || null });
    const audit = { captureSha, vocabularySha, transformSha, captureProvenance: provenance, unmapped: res.report.unmapped, flattened: res.report.flattened, dropped: res.report.dropped, hidden: res.report.hidden, hiddenLive: res.report.hiddenLive, patchesApplied: [] };
    const fail = (reason) => { rec.status = 'failed'; rec.reason = reason; rec.audit = audit; failed += 1; console.error(`importer-skeleton: ${page.slug}: ${reason}`); records.push(rec); };
    if (res.error) { fail(res.error); if (!a.cont) break; continue; }
    if (res.report.unmapped.length || res.report.flattened.length) {
      const kinds = [...new Set(res.report.unmapped.map((u) => u.kind))];
      if (template) { const m = unmappedByTemplate.get(template) || new Map(); for (const k of kinds) m.set(k, (m.get(k) || 0) + 1); unmappedByTemplate.set(template, m); if ([...m.values()].some((n) => n >= 3)) stoppedTemplates.add(template); }
      fail(`${res.report.unmapped.length ? `unmapped modules ${kinds.map((k) => `"${k}"`).join(', ')} (visible content, no emitter — map or drop:<reason> in vocabulary.json)` : ''}${res.report.unmapped.length && res.report.flattened.length ? '; ' : ''}${res.report.flattened.length ? `flattened to prose: ${res.report.flattened.map((f) => `${f.emitter} at ${f.at}`).join(', ')} (a block: kind the walk could not shape — recipe rule 4)` : ''}`);
      if (!a.cont) break; continue;
    }
    if (!res.sections.length || !res.h1) { fail(`${res.sections.length} sections, h1 ${res.h1 ? 1 : 0} — an empty page is never written (0-sections rule)`); if (!a.cont) break; continue; }
    const { path: outRel, dflt } = outputPathFor(page.url, page.slug);
    let docHtml = renderDocument(res, page, template);
    const patchFile = S('patches', `${page.slug}.json`);
    if (existsSync(patchFile)) { const patches = readJSON(patchFile, []); const r = applyPatches(docHtml, Array.isArray(patches) ? patches : []); docHtml = r.html; audit.patchesApplied = r.applied; for (const p of r.applied) if (!p.matched) console.error(`importer-skeleton: ${page.slug}: patch ${p.op} "${p.selector}" matched nothing`); }
    const outFile = join(outDir, outRel); const metaFile = join(outDir, sidecarFor(outRel));
    const outKey = relative(root, outFile); const metaKey = relative(root, metaFile);
    const prior = existsSync(metaFile) ? readJSON(metaFile, {}) : {};
    const sidecar = {
      ...(a.reportOnly ? prior : {}),
      slug: page.slug, type: page.type || prior.type || null, renderBranch: "A'", fidelityTier: 'sibling', template, archetypeSource: page.representative || prior.archetypeSource || null,
      modules: res.modules, variants: prior.variants || [], gatesPassed: (prior.gatesPassed || []).filter((g) => g !== 'content-count'), contentDeviations: [...(prior.contentDeviations || []).filter((d) => d.kind !== 'dynamic-dependency'), ...res.report.deviations],
      metadata: { title: res.meta.title, description: res.meta.description, canonical: res.meta.canonical, lang: res.meta.lang || 'en' },
      outputPathDefault: dflt ? 'trailing-slash' : undefined,
      importer: { script: 'skills/migrate/scripts/importer-skeleton.mjs', sha: scriptSha }, migratedAt: prior.migratedAt || new Date().toISOString(), sourceCurrentSha: captureSha,
      audit: { ...(prior.audit || {}), import: audit },
    };
    if (a.reportOnly) { write(metaFile, `${JSON.stringify(sidecar, null, 2)}\n`); rec.audit = audit; records.push(rec); continue; }
    // hand-edit guard (writer rule): a manifest path whose bytes differ from the recorded sha is a hand edit
    for (const [key, file] of [[outKey, outFile], [metaKey, metaFile]]) {
      if (manifest[key] && existsSync(file) && sha256(readFileSync(file)) !== manifest[key]) {
        if (!a.force) { fail(`${key} was edited by hand since the last import (manifest sha differs) — move the edit into stardust/patches/${page.slug}.json or pass --force to overwrite`); break; }
        console.error(`importer-skeleton: ${page.slug}: --force overwrites hand-edited ${key}`);
      }
    }
    if (rec.status === 'failed') { if (!a.cont) break; continue; }
    const metaJson = `${JSON.stringify(sidecar, null, 2)}\n`;
    write(outFile, docHtml); write(metaFile, metaJson);
    manifest[outKey] = sha256(docHtml); manifest[metaKey] = sha256(metaJson);
    if (state && template) { state.migrate = state.migrate || {}; state.migrate.generators = state.migrate.generators || {}; state.migrate.generators[template] = { script: 'skills/migrate/scripts/importer-skeleton.mjs', sha: scriptSha }; }
    rec.output = outKey; rec.modules = res.modules; rec.sections = res.sections.length; rec.audit = audit; records.push(rec);
  }
  if (!a.dryRun && !a.reportOnly) {
    write(manifestFile, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`);
    if (state) write(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }
  const blockedRecs = records.filter((r) => r.status === 'blocked');
  const unmappedPages = records.filter((r) => r.audit && r.audit.unmapped && r.audit.unmapped.length);
  const unmappedKinds = new Set(unmappedPages.flatMap((r) => r.audit.unmapped.map((u) => u.kind)));
  const summary = { _provenance: { writtenBy: 'stardust:migrate/importer-skeleton', writtenAt: new Date().toISOString() }, pages: records.length, ok: records.filter((r) => r.status === 'ok').length, failed, blocked: blockedRecs.length, writes, stoppedTemplates: [...stoppedTemplates], blockedTemplates: [...new Set(blockedRecs.map((r) => r.template))], records };
  if (!a.dryRun) { write(join(outDir, '_import', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { count: false }); write(join(outDir, '_import', 'summary.md'), `# import summary — ${summary._provenance.writtenAt}\n\npages ${summary.pages} · ok ${summary.ok} · failed ${failed} · writes ${writes}\n\n| slug | status | modules | reason |\n|---|---|---|---|\n${records.map((r) => `| ${r.slug} | ${r.status} | ${(r.modules || []).join(', ')} | ${(r.reason || '').replace(/\|/g, '\\|')} |`).join('\n')}\n`, { count: false }); }
  if (a.json) for (const r of records) console.log(JSON.stringify(r));
  else for (const r of records) console.log(`${r.status === 'ok' ? '✓' : r.status === 'failed' ? '✗' : r.status === 'blocked' ? '⛔' : '·'} ${r.slug}${r.output ? ` → ${r.output}` : ''}${r.modules ? ` [${r.modules.join(', ')}]` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
  if (blockedRecs.length) console.log(`blocked: ${[...new Set(blockedRecs.map((r) => r.template))].map((t) => `template ${t} (${[...new Set(blockedTemplates.get(t))].join(', ')})`).join('; ')} — map or drop with reason in vocabulary.json`);
  if (unmappedKinds.size) console.log(`unmapped modules: ${unmappedKinds.size} kinds on ${unmappedPages.length} pages — map or drop with reason${stoppedTemplates.size ? ` (stopped early: ${[...stoppedTemplates].join(', ')})` : ''}`);
  console.log(`importer-skeleton: ${summary.ok} ok · ${failed} failed${blockedRecs.length ? ` · ${blockedRecs.length} blocked` : ''} · ${writes} writes${a.dryRun ? ' (dry run)' : ''}${a.reportOnly ? ' (report only)' : ''}`);
  return missingCapture ? 1 : (failed || blockedRecs.length) ? 2 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exit(main(process.argv.slice(2)));
