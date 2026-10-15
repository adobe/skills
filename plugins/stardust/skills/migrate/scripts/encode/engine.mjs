/**
 * migrate/encode/engine.mjs — the encoder's engine: the map-driven walk over a committed capture, the rows × cells
 * grammar (v2), the delivered-form renderer, the shape fingerprint + census and the hard stops. A library module (no
 * CLI). Pure: no I/O, no clock, no randomness, no environment, no locale — the capture HTML, the page JSON, the map, a
 * site-context object, the content-count functions and the finaliser all arrive as arguments.
 *
 * The walk (importer-recipe rules 3/4/5/10, kept from the skeleton): a marker classifies the element ITSELF, the first
 * marker in array order wins (rule 3); recursion only through declared wrappers (rule 4); anything else is default
 * content in document order, from a content root that is never body/html or a chrome landmark (rule 5); adjacent runs
 * of the same block merge into one block with one row per run (rule 10). Hidden-live: on a stamped capture (a
 * `data-hidden-live-stamp` on <html>/<body>, or any `[data-hidden-live]` node) marked nodes are skipped and recorded
 * (<details> kept); an unstamped capture skips nothing and says so (`hiddenLive: "unstamped"`).
 *
 * vocabulary.json  { root, chrome[], wrappers[], moduleSelectors[], sectionTags[] (default ["section"]), walkSiblings,
 *                    requireH1 (default true), ignoreModifiers[] (class-token regexes the fingerprint ignores),
 *                    metadata: [[key, expr], …], variance: { ignoreAncestors, accept }, markers: [Marker, …] }
 *   variance         ignoreAncestors: [{ class: "<regex>", reason }] — ancestor class tokens left out of every print's
 *                    ancestor chain (archetype and sibling alike; an ancestor with nothing else left leaves the chain):
 *                    one entry accepts a chain-level class such as a missing layout-grid layer.
 *                    accept: [{ print: "<exact>", on: "extra"|"missing", reason }] — `extra` accepts a print only the
 *                    sibling has, `missing` one only the archetype has; never the other direction. reason non-empty.
 *   moduleSelectors  a selector string, or a site-level component pattern { childClass: "<regex>" } (an element with
 *                    an element child whose class token matches: a wrapper around a component — anchor the regex on
 *                    the block class, e.g. "^x-[a-z]+(-[a-z]+)*$", so BEM element/modifier classes never match) or
 *                    { class: "<regex>" } (its own class token matches): visible + no marker + not a wrapper →
 *                    `unmapped`. Default: [data-module] [data-component] [data-tpl] [data-block].
 *   metadata expr    alternatives joined by `||`, the first non-empty wins: a template over $title $description $nav
 *                    $footer $h1 $ogtitle (page JSON + chrome map), or text(<selector>) on the capture; an alternative
 *                    with neither is a literal (recorded in literals[]). Default rows Title, Description, nav, footer.
 *   Marker           { sel, kind, emitter, style, sectionBefore, sectionAfter, sectionStyle, variants: [{ when, add }],
 *                    merge (default true), retag {}, drop [], rows, cells } — markers is an ARRAY: order is the only
 *                    precedence, JSON key order never is.
 *   emitters         block:<name>[ <variant>…] · default-content · wrapper · section (with `style`) ·
 *                    section-style:<style> · section-break:<style> (an empty styled section) · drop:<reason> ·
 *                    dynamics:<row>; no emitter (absent or null) = a known kind not mapped yet: `unmapped` when
 *                    visible. drop:/dynamics: hold at any depth: a match inside a module, reached by a cell or not,
 *                    is left out, recorded, and never counted as missing content.
 *   rows             "<selector>" (with `cells`) | [{ sel, cells, optional, max }, …] (row groups in order; no sel =
 *                    the module itself is the row) | absent (the module is one row)
 *   cells            [CellSpec, …] | { each: "<selector>", …CellSpec } (one cell per match: a variable-width row)
 *   CellSpec         { sel (relative to the row; absent = the row), as: rich|inline|text|image|link|attr|literal|idref,
 *                    all (default: true for rich), wrap, itemWrap (wraps each matched node's value before join), join
 *                    (default "\n"), optional: true|"empty", selfOk, retag, drop, attr (attr; idref, default
 *                    aria-labelledby; link: the attribute holding the URL, e.g. an iframe's src), then (idref:
 *                    text|inline|rich), text + titleAttr (link), value (literal),
 *                    parts: [CellSpec, …] (a compound cell: each part relative to the matched node) }
 *                    `link` with no usable anchor falls back to the node's plain text. A required cell that resolves
 *                    to nothing, or a required row group that matches nothing, is `flattened`.
 * transform.json   { imageParagraph (default true), imgAttrs (default [src, alt, title]), retag {}, headingsByClass {},
 *                    drop [], keepHashLinks, emptyP: drop|keep } — emptyP `drop` also drops a div/span that holds only
 *                    whitespace or NBSP (no image, no link).
 *
 * Shape prints: `<marker sel | UNMARKED> | <tag>.<sorted classes> | <ancestor chain>` for every marker match at any
 * depth that can change the document (visible, or able to emit when empty: section flags, section emitters, blocks,
 * default-content with cells) and every visible unmarked module-level node the walk reaches (the census) — one rule for
 * both halves: what emits nothing is no shape; class tokens minus generated ones and ignoreModifiers. Selector drops: a
 * marker's `drop` holds for its whole subtree and the transform's everywhere, on every path (walk, rich text, text,
 * cells), a cell's within that cell; each that removes visible content is recorded in dropped[] as
 * { kind: <selector>, reason: "selector drop (marker <sel> | transform | cell)", visible, at }.
 *
 * Hard stops (page status; the first that applies, in this order): error (root missing or a landmark, 0 sections, no
 * <h1>, an exception) · unmapped (incl. a showing <video>/<audio controls>/<iframe>/<object>/<embed> reached by rich
 * text: map it as a block or drop: it; non-showing ones — hidden, display:none, zero width/height — are stripped)
 * · flattened (incl. a module nested inside rich content: a moduleSelectors match or a marker whose emitter is not
 * default-content/wrapper/drop/dynamics; a nested default-content marker keeps its own retag/drop) · variance (a
 * sibling whose SET of shape prints differs from the archetype's, minus accepted prints) · incomplete (the offline
 * content count finds a MISSING item).
 *
 * Output: the delivered body fragment — <body><header></header><main>, the metadata block alone in the first section,
 * then one <div> per section (default content, blocks as <div class="name variant"> rows × cells, a section-metadata
 * `style` row), </main><footer></footer></body>. The engine normalises its own whitespace (ASCII runs collapse to one
 * space, trimmed at line starts/ends and around <br>; NBSP kept; pre/code/textarea byte-exact), so its output is
 * byte-stable. Then, in this order: the page's patches (stardust/patches/<slug>.json, the skeleton's
 * [{ selector, op: replace|attr|remove, name?, value? }] on the rendered document; recorded in patchesApplied[] with
 * their match counts — a patch that matches nothing is recorded with matched 0 and stops nothing, as in the
 * skeleton), the <h1> check, the content count, and the finaliser (sanitise's encode()) last. Patches never touch the
 * fingerprint: variance is decided on the capture.
 *
 * Ported from the `stardust/next` branch: `skills/migrate/scripts/importer-skeleton.mjs` (commits 9aaeff4f, d4a37277, 7662fda2).
 */
import { decodeEntities, parseHTML, isEl, kids, attr, remove, esc, parseSelector, matches, qsa, qs } from './dom.mjs';

export const STATUSES = ['clean', 'unmapped', 'flattened', 'variance', 'incomplete', 'hand-edit', 'error'];
const STOP_ORDER = ['error', 'unmapped', 'flattened', 'variance', 'incomplete'];

const STRIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'link', 'meta', 'input', 'select']);
// embedded players have no rich-text form: a showing one reached by rich text is `unmapped` (map it as a block or
// drop: it); a non-showing one (hidden, display:none / visibility:hidden, zero width or height, audio without
// controls) is stripped like a script
const PLAYERS = new Set(['video', 'audio', 'iframe', 'object', 'embed']);
const ZERO = /^\s*0+(\.0+)?(px)?\s*$/i;
const BLOCKLVL = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'details', 'summary', 'figcaption', 'li']);
const UNWRAP = new Set(['div', 'section', 'article', 'span', 'button', 'figure', 'label', 'time', 'header', 'aside', 'nav', 'font', 'center', 'small']);
const KEEP_GENERIC = ['colspan', 'rowspan', 'start'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DEFAULT_MODULE_SELECTORS = ['[data-module]', '[data-component]', '[data-tpl]', '[data-block]'];
const CHROME_ROOT = 'body, html, header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';
const LANDMARK_STOP = 'footer, nav, header, [role="contentinfo"]';
const DEFAULT_METADATA = [['Title', '$title'], ['Description', '$description'], ['nav', '$nav'], ['footer', '$footer']];
const META_VARS = ['$title', '$description', '$nav', '$footer', '$h1', '$ogtitle'];
// census: class-less plain content at module level is default content by nature, never a component
export const PLAIN_CONTENT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'table', 'figure', 'img', 'picture', 'hr', 'br', 'a', 'span', 'strong', 'em', 'b', 'i', 'small', 'code']);
const CELL_MODES = new Set(['rich', 'inline', 'text', 'image', 'link', 'attr', 'literal', 'idref']);
const EMITTER_RE = /^(block:[a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)*|section-style:[a-z0-9][a-z0-9 ,-]*|section-break:[a-z0-9][a-z0-9 ,-]*|section|wrapper|default-content|drop:.+|dynamics:.+)$/;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]*$/;
const TAG_RE = /^[a-z][a-z0-9]*$/;
// class tokens no author wrote: content hashes and long numbers (plus the map's ignoreModifiers)
const GENERATED_TOKEN = /[0-9a-f]{8,}|\d{5,}/i;

// ===================================================================================== small helpers
const classList = (n) => String(attr(n, 'class') || '').split(/\s+/).filter(Boolean);
const describe = (n) => `${n.tag}${attr(n, 'id') ? `#${attr(n, 'id')}` : ''}${classList(n).slice(0, 2).map((c) => `.${c}`).join('')}`;
const ASCII_WS = /[\t\n\f\r ]+/g;
const asciiTrim = (s) => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
const collapse = (s) => asciiTrim(String(s).replace(ASCII_WS, ' '));
// text that came from the capture keeps its entities (text nodes are raw); text from JSON is decoded and escaped fully
const escText = (t) => String(t).replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;');
const escPlain = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrapIn = (v, wrap) => (wrap ? [].concat(wrap).reduceRight((acc, t) => `<${t}>${acc}</${t}>`, v) : v);
const blankText = (raw) => !decodeEntities(raw).replace(/[\s\u00a0]+/g, '');
const rawText = (n) => (n.type === 'text' ? n.text : (n.children || []).map(rawText).join(''));
function playerShows(n) {
  if (attr(n, 'hidden') !== undefined || /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(n, 'style') || '')) return false;
  if (['width', 'height'].some((k) => attr(n, k) !== undefined && ZERO.test(attr(n, k)))) return false;
  return n.tag !== 'audio' || attr(n, 'controls') !== undefined;
}
const hasMedia = (n) => qs(n, 'img, picture') !== null || n.tag === 'img' || n.tag === 'picture' || [n, ...qsa(n, 'video, audio, iframe, object, embed')].some((x) => PLAYERS.has(x.tag) && playerShows(x));
const visible = (n) => !blankText(rawText(n)) || hasMedia(n);
const isBlankNode = (n) => blankText(rawText(n)) && !hasMedia(n) && qs(n, 'a[href]') === null;
const isBlankHtml = (h) => !h || (!/<(img|picture|video)\b/i.test(h) && blankText(h.replace(/<[^>]*>/g, '')));
const bgUrl = (n) => { const m = /background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(attr(n, 'style') || ''); return m ? m[1] : null; };
const pushUnique = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
function splitTop(s, sep) {
  const out = []; let d = 0; let q = null; let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') d += 1; else if (c === ')' || c === ']') d -= 1;
    if (d === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ===================================================================================== validation
const selectorError = (where, s) => { try { parseSelector(s); return null; } catch (e) { return `${where}: ${e.message}`; } };
const regexError = (where, s) => { try { new RegExp(s); return null; } catch (e) { return `${where}: ${e.message}`; } }; // eslint-disable-line no-new
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isTagMap = (v) => isObj(v) && Object.values(v).every((t) => typeof t === 'string' && TAG_RE.test(t));
const isBool = (v) => v === true || v === false;
const CELL_KEYS = ['sel', 'as', 'all', 'wrap', 'itemWrap', 'join', 'optional', 'selfOk', 'retag', 'drop', 'attr', 'then', 'text', 'titleAttr', 'value', 'parts'];
const freezeKeys = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze([...v])])));
/**
 * The keys each object of a map takes, exactly the sets the validators enforce (R29) — anything else is a typo and
 * fails. Kinds are named after the schema's definitions: vocabulary (the root object), marker, variant, rowGroup,
 * cellSpec, cellsEach (a CellSpec plus `each`), variance, accept (variance.accept[]), ignoreAncestors
 * (variance.ignoreAncestors[]), childClass / class (the two moduleSelectors pattern objects: exactly that one key),
 * transform, patch (an entry of stardust/patches/<slug>.json). COMMENT_KEY (`$comment`, free text, a string) is accepted
 * on every one of them and listed in none. LINT_KEYS are the keys --lint reads and the engine accepts unread.
 */
export const KEYS = freezeKeys({
  vocabulary: ['$schema', 'archetype', 'inputs', 'root', 'chrome', 'wrappers', 'moduleSelectors', 'sectionTags', 'walkSiblings', 'requireH1', 'ignoreModifiers', 'metadata', 'variance', 'markers'],
  marker: ['sel', 'kind', 'emitter', 'style', 'sectionBefore', 'sectionAfter', 'sectionStyle', 'variants', 'merge', 'retag', 'drop', 'rows', 'cells', 'evidence', 'unique'],
  variant: ['when', 'add'],
  rowGroup: ['sel', 'cells', 'optional', 'max'],
  cellSpec: CELL_KEYS,
  cellsEach: [...CELL_KEYS, 'each'],
  variance: ['accept', 'ignoreAncestors'],
  accept: ['print', 'on', 'reason'],
  ignoreAncestors: ['class', 'reason'],
  childClass: ['childClass'],
  class: ['class'],
  transform: ['imageParagraph', 'imgAttrs', 'retag', 'headingsByClass', 'drop', 'keepHashLinks', 'emptyP'],
  patch: ['selector', 'op', 'name', 'value'],
});
export const COMMENT_KEY = '$comment';
export const LINT_KEYS = freezeKeys({ vocabulary: ['$schema', 'archetype', 'inputs'], marker: ['evidence', 'unique'] });
function keysIn(obj, kind, where, errs) {
  const allowed = KEYS[kind];
  for (const k of Object.keys(obj)) {
    const at = where ? `${where}.${k}` : k;
    if (k === COMMENT_KEY) { if (typeof obj[k] !== 'string') errs.push(`${at}: free text (a string)`); continue; }
    if (!allowed.includes(k)) errs.push(`${at}: unknown key — ${where || kind} takes ${allowed.join(', ')} (and $comment)`);
  }
}
const wrapOk = (w) => (typeof w === 'string' && TAG_RE.test(w)) || (Array.isArray(w) && w.length > 0 && w.every((t) => typeof t === 'string' && TAG_RE.test(t)));

function validateCell(spec, where, errs, kind = 'cellSpec') {
  if (!isObj(spec)) { errs.push(`${where}: a CellSpec must be an object`); return; }
  keysIn(spec, kind, where, errs);
  const as = spec.as;
  if (as !== undefined && !CELL_MODES.has(as)) errs.push(`${where}.as "${as}": use ${[...CELL_MODES].join('|')} (a mode the grammar lacks is a hard stop, never a per-template extension)`);
  if (spec.parts !== undefined) {
    if (as !== undefined) errs.push(`${where}: parts and as are exclusive (each part has its own as)`);
    if (!Array.isArray(spec.parts) || !spec.parts.length) errs.push(`${where}.parts: a non-empty array of CellSpecs`);
    else spec.parts.forEach((p, i) => validateCell(p, `${where}.parts[${i}]`, errs));
  }
  for (const k of ['sel', 'text']) if (spec[k] !== undefined) { if (typeof spec[k] !== 'string') errs.push(`${where}.${k}: a selector string`); else { const e = selectorError(`${where}.${k}`, spec[k]); if (e) errs.push(e); } }
  for (const k of ['wrap', 'itemWrap']) if (spec[k] !== undefined && !wrapOk(spec[k])) errs.push(`${where}.${k}: a tag name or an array of tag names`);
  if (spec.join !== undefined && typeof spec.join !== 'string') errs.push(`${where}.join: a string`);
  for (const k of ['all', 'selfOk']) if (spec[k] !== undefined && !isBool(spec[k])) errs.push(`${where}.${k}: true|false`);
  if (spec.optional !== undefined && spec.optional !== true && spec.optional !== false && spec.optional !== 'empty') errs.push(`${where}.optional: true, false or "empty"`);
  if (as === 'literal' && typeof spec.value !== 'string') errs.push(`${where}: a literal cell needs a string value`);
  else if (spec.value !== undefined && typeof spec.value !== 'string') errs.push(`${where}.value: a string`);
  if (as === 'attr' && typeof spec.attr !== 'string') errs.push(`${where}: an attr cell needs attr: "<name>"`);
  else if (spec.attr !== undefined && typeof spec.attr !== 'string') errs.push(`${where}.attr: an attribute name`);
  if (spec.then !== undefined && !['text', 'inline', 'rich'].includes(spec.then)) errs.push(`${where}.then: text|inline|rich`);
  if (spec.titleAttr !== undefined && typeof spec.titleAttr !== 'string') errs.push(`${where}.titleAttr: an attribute name`);
  if (spec.retag !== undefined && !isTagMap(spec.retag)) errs.push(`${where}.retag: an object tag → tag name`);
  if (spec.drop !== undefined) { if (!isStrArr(spec.drop)) errs.push(`${where}.drop: an array of selectors`); else for (const s of spec.drop) { const e = selectorError(`${where}.drop`, s); if (e) errs.push(e); } }
}

function validateCells(cells, where, errs) {
  if (Array.isArray(cells)) { cells.forEach((c, i) => validateCell(c, `${where}[${i}]`, errs)); return; }
  if (cells && typeof cells === 'object' && typeof cells.each === 'string') {
    const e = selectorError(`${where}.each`, cells.each); if (e) errs.push(e);
    validateCell(cells, where, errs, 'cellsEach');
    return;
  }
  errs.push(`${where}: an array of CellSpecs or { each: "<selector>", …CellSpec }`);
}

/** Map errors (empty = valid): unknown keys at every level, the type of every key the engine reads, selectors, regexes. */
export function validateVocabulary(v) {
  const errs = [];
  if (!isObj(v)) return ['vocabulary.json is not an object'];
  keysIn(v, 'vocabulary', '', errs);
  if (typeof v.root !== 'string' || !v.root.trim()) errs.push('root: a selector string is required');
  for (const k of ['walkSiblings', 'requireH1']) if (v[k] !== undefined && !isBool(v[k])) errs.push(`${k}: true|false`);
  for (const k of ['chrome', 'wrappers']) if (v[k] !== undefined && !isStrArr(v[k])) errs.push(`${k}: an array of selector strings`);
  if (v.sectionTags !== undefined && !(isStrArr(v.sectionTags) && v.sectionTags.every((t) => TAG_RE.test(t)))) errs.push('sectionTags: an array of tag names');
  if (v.moduleSelectors !== undefined) {
    if (!Array.isArray(v.moduleSelectors)) errs.push('moduleSelectors: an array of selectors or { childClass } / { class } patterns');
    else v.moduleSelectors.forEach((m, i) => {
      const keys = isObj(m) ? Object.keys(m).filter((k) => k !== COMMENT_KEY) : [];
      const pattern = ['childClass', 'class'].find((kind) => KEYS[kind].length === keys.length && KEYS[kind].every((k) => keys.includes(k)));
      const key = pattern && typeof m[pattern] === 'string' ? pattern : null;
      if (typeof m === 'string') { const e = selectorError(`moduleSelectors[${i}]`, m); if (e) errs.push(e); } else if (key) { const e = regexError(`moduleSelectors[${i}].${key}`, m[key]); if (e) errs.push(e); if (m.$comment !== undefined && typeof m.$comment !== 'string') errs.push(`moduleSelectors[${i}].$comment: free text (a string)`); } else errs.push(`moduleSelectors[${i}]: a selector string, { childClass: "<regex>" } or { class: "<regex>" } (one key${keys.length ? `; got ${keys.join(', ')}` : ''})`);
    });
  }
  if (v.ignoreModifiers !== undefined) { if (!isStrArr(v.ignoreModifiers)) errs.push('ignoreModifiers: an array of regex strings'); else v.ignoreModifiers.forEach((s, i) => { const e = regexError(`ignoreModifiers[${i}]`, s); if (e) errs.push(e); }); }
  if (v.metadata !== undefined && !(Array.isArray(v.metadata) && v.metadata.every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'string')))) errs.push('metadata: an array of [key, expression] string pairs');
  if (Array.isArray(v.metadata)) {
    for (const [k, expr] of v.metadata.filter((r) => Array.isArray(r) && typeof r[1] === 'string')) {
      for (const alt of splitTop(expr, '||')) {
        const m = /^text\((.*)\)$/.exec(alt);
        if (m) { const e = selectorError(`metadata "${k}" text()`, m[1]); if (e) errs.push(e); continue; }
        for (const x of alt.match(/\$[a-z0-9]+/g) || []) if (!META_VARS.includes(x)) errs.push(`metadata "${k}": unknown variable ${x} (${META_VARS.join(' ')})`);
      }
    }
  }
  if (v.variance !== undefined) {
    const va = v.variance; const why = (r) => typeof r === 'string' && r.trim();
    if (!isObj(va)) errs.push('variance: an object { ignoreAncestors, accept }');
    else {
      keysIn(va, 'variance', 'variance', errs);
      if (va.accept !== undefined) {
        if (!Array.isArray(va.accept)) errs.push('variance.accept: an array of { print, on: "extra"|"missing", reason }');
        else va.accept.forEach((a, i) => {
          if (isObj(a)) keysIn(a, 'accept', `variance.accept[${i}]`, errs);
          if (!isObj(a) || typeof a.print !== 'string' || (a.on !== 'extra' && a.on !== 'missing') || !why(a.reason)) errs.push(`variance.accept[${i}]: { print, on: "extra"|"missing", reason } with a non-empty reason`);
        });
      }
      if (va.ignoreAncestors !== undefined) {
        if (!Array.isArray(va.ignoreAncestors)) errs.push('variance.ignoreAncestors: an array of { class: "<regex>", reason }');
        else va.ignoreAncestors.forEach((x, i) => {
          if (isObj(x)) keysIn(x, 'ignoreAncestors', `variance.ignoreAncestors[${i}]`, errs);
          if (!isObj(x) || typeof x.class !== 'string' || !why(x.reason)) errs.push(`variance.ignoreAncestors[${i}]: { class: "<regex>", reason } with a non-empty reason`); else { const e = regexError(`variance.ignoreAncestors[${i}].class`, x.class); if (e) errs.push(e); }
        });
      }
    }
  }
  for (const s of [v.root, ...(isStrArr(v.chrome) ? v.chrome : []), ...(isStrArr(v.wrappers) ? v.wrappers : [])]) { if (typeof s !== 'string') continue; const e = selectorError('selector', s); if (e) errs.push(e); }
  if (v.markers !== undefined && !Array.isArray(v.markers)) errs.push('markers: an ARRAY of { sel, kind, emitter, … } (order is precedence; an object keyed by selector is the old form)');
  (Array.isArray(v.markers) ? v.markers : []).forEach((m, i) => {
    const w = `markers[${i}]`;
    if (!isObj(m)) { errs.push(`${w}: an object { sel, kind, emitter, … }`); return; }
    keysIn(m, 'marker', w, errs);
    if (typeof m.sel !== 'string' || !m.sel.trim()) errs.push(`${w}.sel: a selector string is required`); else { const e = selectorError(`${w}.sel`, m.sel); if (e) errs.push(e); }
    if (m.kind !== undefined && typeof m.kind !== 'string') errs.push(`${w}.kind: a string`);
    for (const k of ['sectionBefore', 'sectionAfter', 'merge']) if (m[k] !== undefined && !isBool(m[k])) errs.push(`${w}.${k}: true|false`);
    if (m.emitter !== undefined && m.emitter !== null && (typeof m.emitter !== 'string' || !EMITTER_RE.test(m.emitter))) errs.push(`${w}.emitter ${typeof m.emitter === 'string' ? `"${m.emitter}"` : `${JSON.stringify(m.emitter)} is not a string`}: use block:<name>[ variants] · default-content · wrapper · section · section-style:<style> · section-break:<style> · drop:<reason> · dynamics:<row>`);
    if (m.style !== undefined && typeof m.style !== 'string') errs.push(`${w}.style: a string`);
    if (m.sectionStyle !== undefined && typeof m.sectionStyle !== 'string') errs.push(`${w}.sectionStyle: a string`);
    if (m.variants !== undefined) {
      if (!Array.isArray(m.variants)) errs.push(`${w}.variants: an array of { when, add }`);
      else m.variants.forEach((x, j) => {
        if (isObj(x)) keysIn(x, 'variant', `${w}.variants[${j}]`, errs);
        if (!x || typeof x.when !== 'string' || typeof x.add !== 'string' || !x.add.split(' ').every((t) => TOKEN_RE.test(t))) { errs.push(`${w}.variants[${j}]: { when: "<selector>", add: "<token>[ <token>…]" }`); return; }
        const e = selectorError(`${w}.variants[${j}].when`, x.when); if (e) errs.push(e);
      });
    }
    if (m.drop !== undefined) { if (!isStrArr(m.drop)) errs.push(`${w}.drop: an array of selectors`); else for (const s of m.drop) { const e = selectorError(`${w}.drop`, s); if (e) errs.push(e); } }
    if (m.retag !== undefined && !isTagMap(m.retag)) errs.push(`${w}.retag: an object tag → tag name`);
    if (m.rows !== undefined) {
      if (typeof m.rows === 'string') { const e = selectorError(`${w}.rows`, m.rows); if (e) errs.push(e); } else if (Array.isArray(m.rows)) {
        m.rows.forEach((g, j) => {
          if (!isObj(g)) { errs.push(`${w}.rows[${j}]: { sel, cells, optional, max }`); return; }
          keysIn(g, 'rowGroup', `${w}.rows[${j}]`, errs);
          if (g.optional !== undefined && !isBool(g.optional)) errs.push(`${w}.rows[${j}].optional: true|false`);
          if (g.sel !== undefined) { const e = typeof g.sel === 'string' ? selectorError(`${w}.rows[${j}].sel`, g.sel) : `${w}.rows[${j}].sel: a selector string`; if (e) errs.push(e); }
          if (g.max !== undefined && !(Number.isInteger(g.max) && g.max > 0)) errs.push(`${w}.rows[${j}].max: a positive integer`);
          if (g.cells !== undefined) validateCells(g.cells, `${w}.rows[${j}].cells`, errs);
        });
      } else errs.push(`${w}.rows: a selector string or an array of row groups`);
    }
    if (m.cells !== undefined) validateCells(m.cells, `${w}.cells`, errs);
    if (m.emitter === 'default-content' && m.cells !== undefined && !(Array.isArray(m.cells) && m.cells.length === 1)) errs.push(`${w}: a default-content marker takes at most one cell`);
  });
  return errs;
}

/** Transform errors (empty = valid). */
export function validateTransform(tf) {
  if (!isObj(tf)) return ['transform.json is not an object'];
  const errs = [];
  keysIn(tf, 'transform', '', errs);
  if (tf.imageParagraph !== undefined && typeof tf.imageParagraph !== 'boolean') errs.push('imageParagraph: true|false');
  if (tf.keepHashLinks !== undefined && typeof tf.keepHashLinks !== 'boolean') errs.push('keepHashLinks: true|false');
  if (tf.emptyP !== undefined && !['drop', 'keep'].includes(tf.emptyP)) errs.push('emptyP: "drop" or "keep"');
  if (tf.imgAttrs !== undefined && !(isStrArr(tf.imgAttrs) && tf.imgAttrs.every((a) => ['src', 'alt', 'title'].includes(a)))) errs.push('imgAttrs: a subset of ["src", "alt", "title"]');
  for (const k of ['retag', 'headingsByClass']) if (tf[k] !== undefined && (typeof tf[k] !== 'object' || Array.isArray(tf[k]) || !Object.values(tf[k]).every((t) => typeof t === 'string' && TAG_RE.test(t)))) errs.push(`${k}: an object mapping to tag names`);
  if (tf.drop !== undefined) { if (!isStrArr(tf.drop)) errs.push('drop: an array of selectors'); else for (const s of tf.drop) { const e = selectorError('drop', s); if (e) errs.push(e); } }
  return errs;
}

// ===================================================================================== capture preparation
/**
 * Parse a capture and prepare it for the walk: strip non-content elements, remove chrome, find the content root.
 * Returns { doc, rootEl, stamped, error } — `error` set when the root is missing or is a landmark (rule 5).
 */
export function prepareCapture(html, vocab) {
  const doc = parseHTML(html);
  const htmlEl = qs(doc, 'html'); const body = qs(doc, 'body') || doc;
  // the mark is the evidence, whoever wrote it: the stamp attribute OR any marked node makes the capture `stamped`
  const stamped = Boolean((htmlEl && attr(htmlEl, 'data-hidden-live-stamp') !== undefined) || attr(body, 'data-hidden-live-stamp') !== undefined || qs(body, '[data-hidden-live]'));
  const out = { doc, rootEl: null, stamped, error: null };
  const strip = []; const collect = (n) => { for (const c of n.children) if (isEl(c)) { if (STRIP.has(c.tag) || (PLAYERS.has(c.tag) && !playerShows(c))) strip.push(c); else collect(c); } };
  collect(doc); for (const s of strip) remove(s);
  for (const sel of vocab.chrome || []) for (const c of qsa(doc, sel)) remove(c);
  const rootEl = qs(doc, vocab.root);
  if (!rootEl) { out.error = `root selector "${vocab.root}" matched nothing (rule 5: encode from the content root, fail loud)`; return out; }
  if (matches(rootEl, CHROME_ROOT)) { out.error = `root selector "${vocab.root}" resolves to <${rootEl.tag}> — a chrome landmark or the whole body, not the content root (rule 5)`; return out; }
  out.rootEl = rootEl;
  return out;
}

const hiddenLive = (n, stamped) => stamped && attr(n, 'data-hidden-live') !== undefined && n.tag !== 'details';

/** The first marker (array order) that matches the element itself (rule 3), or null. */
export function firstMarker(n, markers, rootEl) { for (const m of markers) if (matches(n, m.sel, rootEl)) return m; return null; }

/**
 * The drops of a prepared capture, before the walk (the encoder's pre-pass): the transform's `drop` matches under the
 * content tops (a top that matches included) and every first-marker match's own `drop` matches at any depth are claimed
 * as selector drops (node → { selector, source: "transform" | "marker <sel>" }; the first claim wins); a drop:/dynamics:
 * match at any depth is `declared` (node → marker, document order) and not descended. `excluded` holds every node left
 * out of the content count; `claim(scope, selectors, source)` adds more (the encoder's cell drops, source "cell").
 */
function collectDrops(prep, vocab, tf = {}) {
  const { rootEl, stamped } = prep; const markers = vocab.markers || [];
  const claims = new Map(); const declared = new Map(); const excluded = new Set();
  const claim = (scope, sels, source) => { for (const s of sels || []) for (const x of qsa(scope, s)) { excluded.add(x); if (!claims.has(x)) claims.set(x, { selector: s, source }); } };
  const tops = contentTops(prep, vocab);
  for (const t of tops) {
    claim(t, tf.drop, 'transform');
    const own = t !== rootEl && (tf.drop || []).find((s) => matches(t, s, rootEl));
    if (own) { excluded.add(t); if (!claims.has(t)) claims.set(t, { selector: own, source: 'transform' }); }
  }
  const prepass = (n) => {
    if (!isEl(n) || STRIP.has(n.tag) || hiddenLive(n, stamped) || excluded.has(n)) return;
    const m = firstMarker(n, markers, rootEl);
    if (m) claim(n, m.drop, `marker ${m.sel}`);
    const e = m && m.emitter ? String(m.emitter) : '';
    if (e.startsWith('drop:') || e.startsWith('dynamics:')) { declared.set(n, m); excluded.add(n); return; }
    for (const c of n.children) prepass(c);
  };
  for (const t of tops) for (const c of (t === rootEl ? kids(t) : [t])) prepass(c);
  return { claims, declared, excluded, claim };
}
// the tests over collected drops: skip = a marker's or the transform's selector drop (every path; a cell's drop stays in
// its cell); skip.within = the node or an ancestor is skipped or a declared drop:/dynamics: match
function dropTests({ claims, declared }) {
  const skip = (x) => { const d = claims.get(x); return Boolean(d) && d.source !== 'cell'; };
  skip.within = (x) => { for (let p = x; p && isEl(p); p = p.parent) if (declared.has(p) || skip(p)) return true; return false; };
  return skip;
}
/**
 * What the encoder's walk skips on this capture: `skip(node)` — true for a node a marker's `drop` (its whole subtree) or
 * the transform's `drop` removes — to pass to walkModules / moduleLevel as `skip`; `skip.within(node)` — the node or an
 * ancestor is skipped or is a drop:/dynamics: match (the filter cells, rows and pickers use; pass it to rowNodes).
 */
export function dropPredicate(prep, vocab, tf = {}) { return dropTests(collectDrops(prep, vocab, tf)); }

/**
 * A marker's rows as the encoder selects them: per row group (rows "<sel>" → one group with the marker's cells; rows
 * absent → the module is its one row) the module's matches of the group's sel, minus nodes `within` a drop, capped at
 * max: [{ group, index, nodes }]. rowNodes = the same, flat.
 */
export function rowGroups(mod, marker, within = () => false) {
  const groups = Array.isArray(marker.rows) ? marker.rows : (typeof marker.rows === 'string' ? [{ sel: marker.rows, cells: marker.cells }] : [{ cells: marker.cells }]);
  return groups.map((group, index) => {
    let nodes = (group.sel ? qsa(mod, group.sel) : [mod]).filter((x) => !within(x));
    if (group.max) nodes = nodes.slice(0, group.max);
    return { group, index, nodes };
  });
}
export const rowNodes = (mod, marker, within) => rowGroups(mod, marker, within).flatMap((g) => g.nodes);

// ===================================================================================== the walk's traversal (shared)
// What --lint and --sweep need to see the capture as the encoder does; the encoder's own walk and fingerprint run on
// these same functions, so the two never drift.
export { GENERATED_TOKEN, LANDMARK_STOP };
/** visible = text other than whitespace/NBSP, or media (an image, a showing player). */
export const isVisible = (n) => visible(n);
/** a node the walk skips on a stamped capture (never <details>). */
export const isHiddenLive = (n, stamped) => hiddenLive(n, stamped);
/** the class tokens the fingerprint reads: generated tokens and the map's ignoreModifiers left out. */
export const classTokens = (vocab) => tokenFilter(vocab);
/** a marker whose emitter the walk recurses through (wrapper, section, section-style:). */
export const recursesThrough = (m) => { const e = String((m && m.emitter) || ''); return e === 'wrapper' || e === 'section' || e.startsWith('section-style:'); };

/** The walked tops of a prepared capture: the root, plus (walkSiblings) its following siblings up to a landmark. */
export function contentTops(prep, vocab) {
  const out = [prep.rootEl];
  if (vocab.walkSiblings && prep.rootEl.parent) {
    const sibs = kids(prep.rootEl.parent);
    for (const s of sibs.slice(sibs.indexOf(prep.rootEl) + 1)) { if (matches(s, LANDMARK_STOP)) break; out.push(s); }
  }
  return out;
}

/** Every first-marker match at any depth under the tops (hidden-live skipped), in document order: [{ node, marker }]. */
export function markerMatches(prep, vocab) {
  const markers = vocab.markers || []; const { rootEl, stamped } = prep; const out = [];
  const visit = (n) => {
    if (!isEl(n) || hiddenLive(n, stamped)) return;
    const m = firstMarker(n, markers, rootEl);
    if (m) out.push({ node: n, marker: m });
    for (const c of n.children) visit(c);
  };
  for (const t of contentTops(prep, vocab)) visit(t);
  return out;
}

/**
 * The walk (rules 3/4/5): visits each module-level node in document order — the root's children, then the walked
 * siblings — recursing through wrapper/section markers (by default), sectionTags and wrappers[]. Hooks, all optional:
 *   skip(node) → true leaves a node and its subtree out · hidden(node) a hidden-live node on a stamped capture ·
 *   marker(node, marker, descend) a marker hit (default: descend when recursesThrough(marker)) ·
 *   section(node, descend) a sectionTags node (default: descend) · module(node) anything else (rule 5).
 */
export function walkModules(prep, vocab, hooks = {}) {
  const markers = vocab.markers || []; const wrappers = vocab.wrappers || []; const sectionTags = vocab.sectionTags || ['section'];
  const { rootEl, stamped } = prep;
  const visit = (n) => {
    if (!isEl(n) || STRIP.has(n.tag) || (hooks.skip && hooks.skip(n))) return;
    if (hiddenLive(n, stamped)) { if (hooks.hidden) hooks.hidden(n); return; }
    const descend = () => { for (const c of kids(n)) visit(c); };
    const m = firstMarker(n, markers, rootEl); // rule 3: the element itself, never a descendant
    if (m) { if (hooks.marker) hooks.marker(n, m, descend); else if (recursesThrough(m)) descend(); return; }
    if (sectionTags.includes(n.tag)) { if (hooks.section) hooks.section(n, descend); else descend(); return; }
    if (wrappers.some((w) => matches(n, w, rootEl))) { descend(); return; } // rule 4: recurse only through declared wrappers
    if (hooks.module) hooks.module(n);
  };
  for (const t of contentTops(prep, vocab)) for (const c of (t === rootEl ? kids(t) : [t])) visit(c);
}

/** The module-level nodes the walk classifies: [{ node, marker | null }] (marker null: rule 5, default content). */
export function moduleLevel(prep, vocab, { skip } = {}) {
  const out = [];
  walkModules(prep, vocab, { skip, marker: (node, marker, descend) => { out.push({ node, marker }); if (recursesThrough(marker)) descend(); }, module: (node) => out.push({ node, marker: null }) });
  return out;
}

function moduleMatcher(vocab, rootEl) {
  const list = vocab.moduleSelectors || DEFAULT_MODULE_SELECTORS;
  const tests = list.map((m) => {
    if (typeof m === 'string') return { label: m, test: (n) => matches(n, m, rootEl) };
    if (typeof m.childClass === 'string') { const re = new RegExp(m.childClass); return { label: `childClass ${m.childClass}`, test: (n) => kids(n).some((k) => classList(k).some((c) => re.test(c))) }; }
    const re = new RegExp(m.class);
    return { label: `class ${m.class}`, test: (n) => classList(n).some((c) => re.test(c)) };
  });
  return (n) => { for (const t of tests) if (t.test(n)) return t.label; return null; };
}

// ===================================================================================== shape fingerprint
function tokenFilter(vocab) {
  const ignore = (vocab.ignoreModifiers || []).map((s) => new RegExp(s));
  const tokens = (n) => classList(n).filter((c) => !GENERATED_TOKEN.test(c) && !ignore.some((re) => re.test(c)));
  const anc = ((vocab.variance && vocab.variance.ignoreAncestors) || []).map((x) => new RegExp(x.class));
  // an ancestor's chain token: its smallest kept class; an ancestor whose classes are all ignored leaves the chain
  tokens.chain = (p) => {
    const kept = tokens(p).filter((c) => !anc.some((re) => re.test(c)));
    if (!kept.length && classList(p).some((c) => anc.some((re) => re.test(c)))) return null;
    return kept.sort()[0] || p.tag;
  };
  return tokens;
}
function printOf(label, n, rootEl, tokens) {
  const chain = [];
  for (let p = n.parent; p && p !== rootEl && isEl(p); p = p.parent) { const t = tokens.chain(p); if (t !== null) chain.push(t); }
  return `${label} | ${n.tag}.${[...tokens(n)].sort().join('.')} | ${chain.reverse().join('>')}`;
}
/**
 * Can this marker match change the document although it holds nothing visible? Section flags and section emitters move
 * section boundaries, a block (or a default-content marker with cells) can emit attr/literal/link/"empty" cells; only an
 * empty wrapper, plain default-content, drop:, dynamics: or unmapped match emits nothing.
 */
const emitsWhenEmpty = (m) => {
  const e = String(m.emitter || '');
  if (m.sectionBefore || m.sectionAfter || m.sectionStyle) return true;
  if (!e || e === 'wrapper' || e.startsWith('drop:') || e.startsWith('dynamics:')) return false;
  return e !== 'default-content' || Boolean(m.cells);
};
/** Every marker match at any depth (first marker wins), as a print — unless it emits nothing. */
function markerPrints(prep, vocab, tokens) {
  // one visibility rule with the census: a match that emits nothing (empty, and nothing to emit when empty) is no shape
  return markerMatches(prep, vocab).filter(({ node, marker }) => visible(node) || emitsWhenEmpty(marker)).map(({ node, marker }) => printOf(marker.sel, node, prep.rootEl, tokens));
}

/**
 * Variance of a sibling against the archetype: the symmetric difference of the two print SETS, minus accepted prints —
 * an `extra` accept covers a print only the sibling has, a `missing` accept one only the archetype has. Returns
 * [{ change: "extra"|"missing", print }] sorted (extra first); `change` is the `on` an accept entry would take.
 */
export function varianceDelta(prints, archetypePrints, accept = []) {
  const ok = (on) => new Set((accept || []).filter((x) => x.on === on).map((x) => x.print));
  const okExtra = ok('extra'); const okMissing = ok('missing');
  const a = new Set(archetypePrints); const s = new Set(prints);
  const extra = [...s].filter((p) => !a.has(p) && !okExtra.has(p)).sort().map((print) => ({ change: 'extra', print }));
  const missing = [...a].filter((p) => !s.has(p) && !okMissing.has(p)).sort().map((print) => ({ change: 'missing', print }));
  return [...extra, ...missing];
}

// ===================================================================================== whitespace (the engine's own)
const PRESERVE = new Set(['pre', 'code', 'textarea']);
const LINE_BREAKERS = new Set([...BLOCKLVL, 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'dt', 'dd']);
function serializeTidy(n) {
  if (n.type === 'text') return n.text;
  if (!isEl(n)) return '';
  const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${a}>`;
  return `<${n.tag}${a}>${n.children.map(serializeTidy).join('')}</${n.tag}>`;
}
/**
 * Collapse ASCII whitespace runs to one space, trimmed at the start and end of every line (block edges, <br>), with
 * NBSP kept and pre/code/textarea byte-exact; top-level blocks of the fragment are joined by "\n".
 */
export function tidy(html) {
  if (!html) return '';
  const root = parseHTML(html);
  let last = null; let atStart = true; let endsSpace = false;
  const endLine = () => { if (last) last.text = last.text.replace(/[\t\n\f\r ]+$/, ''); last = null; atStart = true; endsSpace = false; };
  const visit = (n) => {
    for (const c of n.children) {
      if (c.type === 'text') {
        let t = c.text.replace(ASCII_WS, ' ');
        if (atStart || endsSpace) t = t.replace(/^ /, '');
        c.text = t;
        if (t) { atStart = false; endsSpace = t.endsWith(' '); last = c; }
        continue;
      }
      if (!isEl(c)) continue;
      if (PRESERVE.has(c.tag)) { if (LINE_BREAKERS.has(c.tag)) { endLine(); continue; } atStart = false; endsSpace = false; last = null; continue; }
      if (c.tag === 'br') { endLine(); continue; }
      if (VOID.has(c.tag)) { atStart = false; endsSpace = false; last = null; continue; }
      if (LINE_BREAKERS.has(c.tag)) { endLine(); visit(c); endLine(); continue; }
      visit(c);
    }
  };
  visit(root); endLine();
  const parts = []; let run = '';
  for (const c of root.children) {
    const s = serializeTidy(c);
    if (isEl(c) && LINE_BREAKERS.has(c.tag)) { if (run) parts.push(run); run = ''; parts.push(s); } else run += s;
  }
  if (run) parts.push(run);
  return parts.filter((p) => p !== '').join('\n');
}

// ===================================================================================== content: media, links, rich text
function imgHtml(n, ctx) {
  const img = n.tag === 'img' ? n : qsa(n, 'img').find((x) => !ctx.isDropped(x)) || null;
  let cands = []; let alt = ''; let title;
  if (img) {
    const firstOfSet = (v) => String(v || '').split(',').map((s) => s.trim().split(/\s+/)[0]);
    cands = [attr(img, 'src'), attr(img, 'data-src'), ...firstOfSet(attr(img, 'srcset') || attr(img, 'data-srcset'))];
    const pic = img.parent && img.parent.tag === 'picture' ? img.parent : null;
    if (pic) for (const s of qsa(pic, 'source')) cands.push(...firstOfSet(attr(s, 'srcset')));
    alt = attr(img, 'alt') || ''; title = attr(img, 'title');
  } else {
    const holder = bgUrl(n) ? n : qsa(n, '[style]').find((d) => bgUrl(d) && !ctx.isDropped(d));
    if (!holder) return null;
    cands = [bgUrl(holder)];
  }
  cands = cands.filter((c) => c && c.trim() && !/^data:/i.test(c.trim()));
  if (!cands.length) return null;
  let src = null;
  for (const c of cands) {
    let abs; try { abs = new URL(c.trim(), ctx.base || undefined).href; } catch { continue; }
    const hit = ctx.site.resolveMedia(abs);
    if (hit) { src = hit; break; }
  }
  if (!src) { try { src = new URL(cands[0].trim(), ctx.base || undefined).href; } catch { src = cands[0].trim(); } pushUnique(ctx.report.mediaUnresolved, src); }
  const keep = ctx.tf.imgAttrs || ['src', 'alt', 'title'];
  const a = { src, alt, title };
  return `<img${keep.filter((k) => a[k] !== undefined && (k !== 'title' || a[k])).map((k) => ` ${k}="${esc(a[k])}"`).join('')}>`;
}

function linkHref(raw, ctx) {
  const h = String(raw || '').trim();
  if (h === '#' && ctx.tf.keepHashLinks) return '#';
  if (!h || h === '#' || /^javascript:/i.test(h)) return null;
  if (/^(mailto|tel):/i.test(h) || h.startsWith('#')) return h;
  const r = ctx.site.localizeHref(h, ctx.base); // pages through the roster + redirects, documents through the asset ledger
  if (r.unresolved) pushUnique(ctx.report.linksUnresolved, r.href);
  return r.href;
}

/** Plain text of a node as the walk sees it (drops, hidden-live and STRIP honoured), raw entities kept. */
function plainText(n, ctx) {
  const dropSel = [...(ctx.tf.drop || []), ...(ctx.drop || [])];
  const t = (x) => {
    if (x.type === 'text') return x.text.replace(/\{\{[^}]*\}\}/g, '');
    if (!isEl(x) || STRIP.has(x.tag) || PLAYERS.has(x.tag) || ctx.declared.has(x) || ctx.globalDrop(x)) return '';
    if (x.tag === 'br') return ' ';
    if (dropSel.some((s) => matches(x, s, ctx.rootEl)) || hiddenLive(x, ctx.stamped)) { ctx.excluded.add(x); return ''; }
    return x.children.map(t).join('');
  };
  return collapse(t(n));
}

/**
 * The rich-text pass: one module subtree → delivered HTML (block-level unless `inline`). Nested modules inside it
 * (a moduleSelectors match, or a marker that is not default-content/wrapper) are recorded as `flattened`; nested
 * drop:/dynamics: matches are left out (the pre-pass recorded them); a nested default-content marker's subtree is
 * serialised with its own retag/drop; a showing <video>/<audio> is `unmapped`.
 */
function richText(n, ctx, { inline = false, nested = true, childrenOnly = false } = {}) {
  const tf = ctx.tf; const headingsByClass = tf.headingsByClass || {};
  const base = { retag: { b: 'strong', i: 'em', ...(tf.retag || {}), ...(ctx.retag || {}) }, drop: [...(tf.drop || []), ...(ctx.drop || [])] };
  const emptyP = tf.emptyP !== 'keep';
  // sc: the retag/drop scope of the subtree — a nested default-content marker brings its own
  const clean = (node, top = false, isRoot = false, sc = base) => {
    if (node.type === 'text') return escText(node.text.replace(/\{\{[^}]*\}\}/g, ''));
    if (!isEl(node) || STRIP.has(node.tag) || ctx.declared.has(node) || ctx.globalDrop(node)) return '';
    if (sc.drop.some((s) => matches(node, s, ctx.rootEl))) { ctx.excluded.add(node); return ''; }
    if (hiddenLive(node, ctx.stamped)) { ctx.report.hidden.push({ at: describe(node), reason: attr(node, 'data-hidden-live') || 'hidden' }); ctx.excluded.add(node); return ''; }
    const kidsOf = (t = false) => node.children.map((c) => clean(c, t, false, sc));
    if (isRoot && childrenOnly) return kidsOf().join('');
    if (nested && sc.owner !== node && !ctx.wrappers.some((w) => matches(node, w, ctx.rootEl))) {
      const m = firstMarker(node, ctx.markers, ctx.rootEl);
      const e = m ? String(m.emitter || '') : null;
      // a default-content marker brings its own retag/drop — nested in the cell, or the cell's own node
      if (m && e === 'default-content' && (m.retag || m.drop)) return clean(node, top, isRoot, { retag: { ...sc.retag, ...(m.retag || {}) }, drop: [...sc.drop, ...(m.drop || [])], owner: node });
    }
    if (!isRoot && nested && sc.owner !== node && !ctx.wrappers.some((w) => matches(node, w, ctx.rootEl))) {
      const m = firstMarker(node, ctx.markers, ctx.rootEl);
      const e = m ? String(m.emitter || '') : null;
      if (m && e.startsWith('drop:')) { ctx.report.dropped.push({ kind: m.kind || m.sel, reason: e.slice(5), visible: visible(node), nested: true, at: describe(node) }); ctx.excluded.add(node); return ''; }
      if (m && e.startsWith('dynamics:')) { ctx.report.deviations.push({ kind: 'dynamic-dependency', row: e.slice(9), module: m.kind || m.sel, nested: true, at: describe(node) }); ctx.excluded.add(node); return ''; }
      if (m && e !== 'default-content' && e !== 'wrapper' && visible(node)) ctx.report.flattened.push({ kind: m.kind || m.sel, selector: m.sel, at: describe(node), why: ['a module nested inside rich content'] });
      else if (!m) { const ms = ctx.isModule(node); if (ms && visible(node)) ctx.report.flattened.push({ kind: classList(node)[0] || node.tag, selector: ms, at: describe(node), why: ['a module nested inside rich content'] }); }
    }
    let tag = node.tag;
    for (const c of classList(node)) if (headingsByClass[c]) tag = headingsByClass[c];
    if (sc.retag[tag]) tag = sc.retag[tag];
    if (PLAYERS.has(node.tag)) { // no rich-text form: a hard stop when it shows (D4: map it as a block or drop: it)
      if (playerShows(node) && !ctx.cache.media.has(node)) { ctx.cache.media.add(node); ctx.report.unmapped.push({ kind: node.tag, selector: node.tag, at: describe(node), remedy: `map it as a block (e.g. an embed block with a link cell: as link, attr src) or drop: it — <${node.tag}> has no rich-text form` }); }
      ctx.excluded.add(node);
      return '';
    }
    if (tag === 'img' || tag === 'picture') { const h = imgHtml(node, ctx); return h ? ((tf.imageParagraph !== false && top) ? `<p>${h}</p>` : h) : ''; }
    if (tag === 'br') return '<br>';
    if (tag === 'hr') return '';
    // blank-container drop: the emptyP rule extended to div/span (a span only where it stands as a block of its own)
    if (emptyP && (tag === 'p' || tag === 'div' || (tag === 'span' && top)) && isBlankNode(node)) return '';
    if (UNWRAP.has(tag) || tag === 'unwrap') {
      const blockish = (c) => isEl(c) && !STRIP.has(c.tag) && (BLOCKLVL.has(c.tag) || c.tag === 'img' || c.tag === 'picture' || (UNWRAP.has(c.tag) && qs(c, 'p, h1, h2, h3, h4, h5, h6, ul, ol, table, img, picture, blockquote') !== null));
      if (inline || !node.children.some(blockish)) return kidsOf().join('');
      const chunks = []; let run = '';
      const flush = () => { if (!blankText(run.replace(/<br>/g, ''))) chunks.push(`<p>${run}</p>`); run = ''; };
      for (const c of node.children) {
        if (blockish(c)) { flush(); const v = clean(c, true, false, sc); if (v && !isBlankHtml(v)) chunks.push(v); } else run += clean(c, false, false, sc);
      }
      flush();
      return chunks.join('\n');
    }
    if (/^h[1-6]$/.test(tag) && blankText(rawText(node)) && !qs(node, 'img')) return ''; // rule 6: an empty heading
    if (tag === 'a') {
      const href = linkHref(attr(node, 'href'), ctx);
      const inner = kidsOf().join('');
      return href === null ? inner : `<a href="${esc(href)}">${inner}</a>`;
    }
    const attrs = KEEP_GENERIC.filter((k) => attr(node, k) !== undefined).map((k) => ` ${k}="${esc(attr(node, k))}"`).join('');
    if (VOID.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${kidsOf().join('')}</${tag}>`;
  };
  const html = asciiTrim(clean(n, true, true));
  if (!html || isBlankHtml(html)) return '';
  if (inline) return html;
  const first = /^<([a-z][a-z0-9]*)[\s>]/.exec(html);
  return first && (BLOCKLVL.has(first[1]) || first[1] === 'table') ? html : `<p>${html}</p>`;
}

// ===================================================================================== cells and rows (grammar v2)
function idTarget(id, ctx) {
  const { cache } = ctx;
  if (!cache.ids) { cache.ids = new Map(); const visit = (x) => { for (const c of x.children) if (isEl(c)) { const k = attr(c, 'id'); if (k !== undefined && !cache.ids.has(k)) cache.ids.set(k, c); visit(c); } }; visit(ctx.doc); }
  return cache.ids.get(id) || null;
}

function itemValue(n, spec, ctx, kind) {
  if (spec.parts) {
    const out = [];
    for (const p of spec.parts) { const v = cellValue(n, p, ctx, kind); if (v === null) { if (p.optional) continue; return null; } out.push(v); }
    return out.join('\n');
  }
  const as = spec.as || 'rich';
  if (as === 'rich') return richText(n, ctx);
  if (as === 'inline') return richText(n, ctx, { inline: true });
  if (as === 'text') return escText(plainText(n, ctx));
  if (as === 'image') return imgHtml(n, ctx) || '';
  if (as === 'attr') { const v = attr(n, spec.attr); return v === undefined ? '' : escPlain(collapse(v)); }
  if (as === 'idref') {
    const ref = String(attr(n, spec.attr || 'aria-labelledby') || '').trim().split(/\s+/)[0];
    const target = ref ? idTarget(ref, ctx) : null;
    if (!target) return '';
    const then = spec.then || 'text';
    if (then === 'rich') return richText(target, ctx);
    if (then === 'inline') return richText(target, ctx, { inline: true });
    return escText(plainText(target, ctx));
  }
  if (as === 'link' && spec.attr) { // the URL is an attribute of the matched node (an iframe's src); text = `text`, else the URL
    const raw = attr(n, spec.attr);
    const href = raw === undefined ? null : linkHref(raw, ctx);
    if (href === null) return '';
    const label = spec.text ? qs(n, spec.text) : null;
    return `<a href="${esc(href)}">${label ? escText(plainText(label, ctx)) : escPlain(href)}</a>`;
  }
  if (as === 'link') {
    const a = n.tag === 'a' && attr(n, 'href') !== undefined ? n : qsa(n, 'a[href]').find((x) => !ctx.isDropped(x)) || null;
    if (!a) return escText(plainText(n, ctx)); // no anchor: the plain text stands in
    const label = spec.text ? qs(a, spec.text) || (matches(a, spec.text, ctx.rootEl) ? a : null) : null;
    const text = label ? escText(plainText(label, ctx)) : richText(a, ctx, { inline: true, childrenOnly: true });
    const href = linkHref(attr(a, 'href'), ctx);
    if (href === null) return text;
    const title = spec.titleAttr ? collapse(attr(a, spec.titleAttr) || '') : '';
    const t = title && title !== decodeEntities(plainText(label || a, ctx)) ? ` title="${esc(title)}"` : '';
    return `<a href="${esc(href)}"${t}>${text}</a>`;
  }
  throw new Error(`unknown cell mode ${as}`);
}

function cellValue(row, spec, ctx, kind) {
  if (spec.as === 'literal') { ctx.report.literals.push({ kind, value: spec.value }); return spec.value; }
  const nodes = (spec.sel ? (spec.selfOk && matches(row, spec.sel, ctx.rootEl) ? [row] : qsa(row, spec.sel)) : [row]).filter((x) => !ctx.isDropped(x));
  const as = spec.parts ? 'parts' : (spec.as || 'rich');
  const pick = (spec.all ?? as === 'rich') ? nodes : nodes.slice(0, 1);
  const sub = { ...ctx, retag: { ...(ctx.retag || {}), ...(spec.retag || {}) }, drop: [...(ctx.drop || []), ...(spec.drop || [])] };
  for (const n of pick) ctx.excludeAll(n, spec.drop, 'cell');
  const vals = pick.map((n) => itemValue(n, spec, sub, kind)).filter((v) => v !== null && !isBlankHtml(v)).map((v) => (spec.itemWrap ? wrapIn(v, spec.itemWrap) : v));
  if (!vals.length) return null;
  return wrapIn(vals.join(spec.join ?? '\n'), spec.wrap);
}

function rowCells(rn, cells, ctx, kind, missing) {
  const out = [];
  if (!Array.isArray(cells)) { // { each: sel, …CellSpec }: one cell per match
    const { each, ...spec } = cells;
    for (const node of qsa(rn, each).filter((x) => !ctx.isDropped(x))) { const v = cellValue(node, spec, ctx, kind); if (v !== null) out.push(v); else if (spec.optional === 'empty') out.push(''); }
    if (!out.length && !spec.optional) missing.push(`no cell for each "${each}" at ${describe(rn)}`);
    return out;
  }
  cells.forEach((spec, ci) => {
    const v = cellValue(rn, spec, ctx, kind);
    if (v !== null) out.push(v);
    else if (spec.optional === 'empty') out.push('');
    else if (!spec.optional) missing.push(`cell ${ci} (${spec.sel || (spec.parts ? 'parts' : 'self')}) empty at ${describe(rn)}`);
  });
  return out;
}

function shapeRows(mod, m, ctx, kind) {
  const rows = []; const missing = [];
  for (const { group: g, index: gi, nodes } of rowGroups(mod, m, ctx.isDropped)) {
    if (!nodes.length) { if (!g.optional) missing.push(`row group ${gi} (${g.sel}) matched nothing`); continue; }
    for (const rn of nodes) { const cells = rowCells(rn, g.cells || [{}], ctx, kind, missing); if (cells.length) rows.push(cells); }
  }
  return { rows, missing };
}

// ===================================================================================== metadata
function metaValue(expr, vars, ctx, key) {
  for (const alt of splitTop(String(expr), '||')) {
    const sel = /^text\((.*)\)$/.exec(alt);
    if (sel) { const el = qs(ctx.doc, sel[1]); const v = el ? escText(plainText(el, ctx)) : ''; if (v) return v; continue; }
    let used = false;
    // vars arrive escaped; the map's own words around them are escaped here
    const v = collapse(alt.split(/(\$[a-z0-9]+)/).map((p) => { if (Object.hasOwn(vars, p)) { used = true; return vars[p]; } return escPlain(p); }).join(''));
    if (v) { if (!used) ctx.report.literals.push({ kind: 'metadata', key, value: alt }); return v; }
  }
  return '';
}

// ===================================================================================== patches (the skeleton's)
const PATCH_OPS = ['replace', 'attr', 'remove'];
/** Patch-file errors (empty = valid): an array of { selector, op: replace|attr|remove, name? (attr), value? }. */
export function validatePatches(patches) {
  if (!Array.isArray(patches)) return ['a patch file holds an array of { selector, op, name?, value? }'];
  const errs = [];
  patches.forEach((p, i) => {
    if (!isObj(p)) { errs.push(`[${i}]: an object { selector, op, name?, value? }`); return; }
    keysIn(p, 'patch', `[${i}]`, errs);
    if (typeof p.selector !== 'string' || !p.selector.trim()) errs.push(`[${i}].selector: a selector string`); else { const e = selectorError(`[${i}].selector`, p.selector); if (e) errs.push(e); }
    if (!PATCH_OPS.includes(p.op)) errs.push(`[${i}].op "${p.op}": use ${PATCH_OPS.join('|')}`);
    if (p.op === 'attr' && (typeof p.name !== 'string' || !/^[a-z][a-z0-9:_-]*$/i.test(p.name))) errs.push(`[${i}].name: an attribute name`);
    if (p.op === 'attr' && p.value !== undefined && p.value !== null && typeof p.value !== 'string') errs.push(`[${i}].value: a string, or null to remove the attribute`);
    if (p.op === 'replace' && p.value !== undefined && typeof p.value !== 'string') errs.push(`[${i}].value: the replacement inner HTML as a string`);
  });
  return errs;
}
/**
 * Apply validated patches, in order, to a rendered document: `replace` sets the inner HTML of every match (the value
 * normalised like the engine's own output), `attr` sets (or with value null removes) an attribute, `remove` deletes the
 * match. Returns { html, applied: [{ selector, op, matched }] }.
 */
export function applyPatches(html, patches) {
  const doc = parseHTML(html); const applied = [];
  for (const p of patches) {
    const hits = qsa(doc, p.selector);
    for (const h of hits) {
      if (p.op === 'remove') remove(h);
      else if (p.op === 'attr') { if (p.value === null || p.value === undefined) delete h.attrs[p.name]; else h.attrs[p.name] = p.value; }
      else { h.children = parseHTML(tidy(p.value || '')).children; for (const c of h.children) c.parent = h; }
    }
    applied.push({ selector: p.selector, op: p.op, matched: hits.length });
  }
  return { html: doc.children.map(serializeTidy).join(''), applied };
}

// ===================================================================================== the walk + renderer
/**
 * Encode one page. Arguments:
 *   html            the committed capture (stardust/current/pages/<slug>.html)
 *   page            its page JSON ({ url, title, description, og }); `page.url` names the page (chrome map)
 *   base            what the capture's relative URLs resolve against (the page JSON's finalUrl, else page.url)
 *   vocab, tf       the template's map (validated)
 *   site            { resolveMedia(absUrl) → contentUrl|null, chromeFor(url) → { nav, footer },
 *                     localizeHref(href, base) → { href, internal, kind, unresolved? } — pages through the roster and
 *                     redirects, documents through the asset ledger (encode/site.mjs) }
 *   archetypePrints the archetype's print set (siblings only; absent → no variance check)
 *   inventory       { offlineInventory, diffOffline } (deploy's content-inventory); absent → no content count
 *   countKeys       { mediaKey(absUrl), linkKey(absUrl) } for the content count
 *   patches         the parsed stardust/patches/<slug>.json array (null/absent or [] → none); applied to the rendered
 *                   document before the <h1> check and the content count; anything else invalid is an `error`
 *   finalise        string → string, applied last (sanitise's encode)
 * Returns { status, html, report, prints, sections, blocks }; `html` is null when the root was not found.
 */
export function encodePage({ html, page = {}, base = null, vocab, tf = {}, site, archetypePrints = null, inventory = null, countKeys = null, patches = null, finalise = null }) {
  const report = { hiddenLive: 'unstamped', unmapped: [], flattened: [], variance: [], incomplete: [], dropped: [], hidden: [], deviations: [], literals: [], mediaUnresolved: [], linksUnresolved: [], patchesApplied: [], errors: [] };
  const result = { status: 'error', html: null, report, prints: [], sections: 0, blocks: [] };
  try {
    encodeInto(result, { html, page, base: base || page.url || null, vocab, tf, site, archetypePrints, inventory, countKeys, patches, finalise });
  } catch (e) {
    report.errors.push(`exception: ${e.message}`);
  }
  result.status = statusOf(report);
  return result;
}

/** The page status from a report: the first hard stop that applies, else clean. */
export function statusOf(r) {
  for (const s of STOP_ORDER) if ((s === 'error' ? r.errors : r[s]).length) return s;
  return 'clean';
}

function encodeInto(result, { html, page, base, vocab, tf, site, archetypePrints, inventory, countKeys, patches, finalise }) {
  const { report } = result;
  const prep = prepareCapture(html, vocab);
  report.hiddenLive = prep.stamped ? 'stamped' : 'unstamped';
  if (prep.error) { report.errors.push(prep.error); return; }
  const { doc, rootEl, stamped } = prep;
  const markers = vocab.markers || [];
  const wrappers = vocab.wrappers || [];
  const isModule = moduleMatcher(vocab, rootEl);
  const tokens = tokenFilter(vocab);
  // the pre-pass (shared with dropPredicate): selector drops claimed, drop:/dynamics: matches declared, the count's exclusions
  const drops = collectDrops(prep, vocab, tf);
  const { excluded, declared, claims: selDrops, claim: excludeAll } = drops;
  const globalDrop = dropTests(drops); // a marker's or the transform's selector drop: every path; a cell's stays in its cell
  const isDropped = globalDrop.within; // the node or an ancestor dropped (selector drop or drop:/dynamics: match)
  const ctx = { tf, site, report, base, stamped, doc, rootEl, markers, wrappers, isModule, excluded, declared, isDropped, globalDrop, cache: { media: new Set() } };
  const walkedDrops = new Set(); // drop:/dynamics: matches the walk reached as modules
  const census = new Set();
  ctx.excludeAll = excludeAll;

  const sections = []; let cur = { style: null, nodes: [] };
  const closeSection = () => { if (cur.nodes.length) sections.push(cur); cur = { style: null, nodes: [] }; };
  const pushHtml = (h) => { if (h && !isBlankHtml(h)) cur.nodes.push({ kind: 'html', html: h }); };
  const pushBlock = (name, variants, rows, merge) => {
    const last = cur.nodes[cur.nodes.length - 1];
    if (merge && last && last.kind === 'block' && last.name === name && last.variants.join(' ') === variants.join(' ')) { last.rows.push(...rows); return; }
    cur.nodes.push({ kind: 'block', name, variants, rows });
  };
  const onMarker = (n, m, descend) => {
    {
      const emitter = m.emitter || null; const kind = m.kind || m.sel;
      if (m.sectionBefore) closeSection();
      if (m.sectionStyle) cur.style = m.sectionStyle;
      const after = () => { if (m.sectionAfter) closeSection(); };
      const sub = { ...ctx, retag: m.retag, drop: m.drop };
      if (!emitter) { if (visible(n)) report.unmapped.push({ kind, selector: m.sel, at: describe(n) }); pushHtml(richText(n, ctx, { nested: false })); return after(); }
      if (emitter.startsWith('drop:') || emitter.startsWith('dynamics:')) { if (!declared.has(n)) declared.set(n, m); walkedDrops.add(n); excluded.add(n); return after(); } // recorded after the walk
      if (emitter === 'wrapper') { descend(); return after(); }
      if (emitter.startsWith('section-break:')) { closeSection(); sections.push({ style: emitter.slice(14), nodes: [] }); return after(); }
      if (emitter === 'section' || emitter.startsWith('section-style:')) {
        closeSection(); cur.style = emitter.startsWith('section-style:') ? emitter.slice(14) : (m.style || null);
        const style = cur.style; descend(); if (!cur.style) cur.style = style; closeSection();
        return after();
      }
      if (emitter === 'default-content') { pushHtml(m.cells ? (cellValue(n, m.cells[0], sub, kind) || '') : richText(n, sub)); return after(); }
      const [name, ...base] = emitter.slice(6).split(' ');
      const variants = [...base];
      for (const v of m.variants || []) if (matches(n, v.when, rootEl)) for (const t of v.add.split(' ')) pushUnique(variants, t);
      const before = report.flattened.length;
      const { rows, missing } = shapeRows(n, m, sub, kind);
      if (missing.length || !rows.length) { report.flattened.splice(before); report.flattened.push({ kind, selector: m.sel, emitter, at: describe(n), why: missing.length ? missing : ['0 rows'] }); pushHtml(richText(n, ctx, { nested: false })); return after(); }
      pushBlock(name, variants, rows, m.merge !== false);
      return after();
    }
  };
  const onSection = (n, descend) => { if (visible(n)) census.add(printOf('UNMARKED', n, rootEl, tokens)); closeSection(); descend(); closeSection(); };
  const onModule = (n) => {
    if (visible(n) && !(PLAIN_CONTENT.has(n.tag) && !tokens(n).length)) census.add(printOf('UNMARKED', n, rootEl, tokens));
    const ms = isModule(n);
    if (ms && visible(n)) { report.unmapped.push({ kind: attr(n, 'data-module') || attr(n, 'data-component') || attr(n, 'data-tpl') || attr(n, 'data-block') || classList(n)[0] || n.tag, selector: ms, at: describe(n) }); pushHtml(richText(n, ctx, { nested: false })); return; }
    pushHtml(richText(n, ctx)); // rule 5: default content in document order
  };
  const tops = contentTops(prep, vocab); // the root, plus (walkSiblings) its following siblings up to a landmark
  walkModules(prep, vocab, {
    skip: globalDrop, // a marker's or the transform's drop holds through wrapper and section recursion
    hidden: (n) => { report.hidden.push({ at: describe(n), reason: attr(n, 'data-hidden-live') || 'hidden' }); excluded.add(n); },
    marker: onMarker, section: onSection, module: onModule,
  });
  closeSection();
  // drop:/dynamics: records in document order; `nested` (+ where) for a match the walk did not reach as a module
  const pre = { dropped: [], deviations: [] };
  for (const [n, m] of declared) {
    const e = String(m.emitter); const kind = m.kind || m.sel; const where = walkedDrops.has(n) ? {} : { nested: true, at: describe(n) };
    if (e.startsWith('drop:')) pre.dropped.push({ kind, reason: e.slice(5), visible: visible(n), ...where });
    else pre.deviations.push({ kind: 'dynamic-dependency', row: e.slice(9), module: kind, ...where });
  }
  // selector drops that removed visible content, outermost only, in document order
  const order = new Map(); let seq = 0;
  const number = (x) => { for (const c of x.children) if (isEl(c)) { order.set(c, seq); seq += 1; number(c); } };
  number(doc);
  const covered = (x) => { for (let p = x; p && isEl(p); p = p.parent) if (declared.has(p) || hiddenLive(p, stamped) || (p !== x && selDrops.has(p))) return true; return false; };
  const selectorDrops = [...selDrops].filter(([x]) => visible(x) && !covered(x)).sort((a, b) => order.get(a[0]) - order.get(b[0]))
    .map(([x, d]) => ({ kind: d.selector, reason: `selector drop (${d.source})`, visible: true, at: describe(x) }));
  report.dropped = [...pre.dropped, ...selectorDrops, ...report.dropped];
  report.deviations = [...pre.deviations, ...report.deviations];

  // shape prints: every marker match at any depth + the census of unmarked module-level nodes; a SET, sorted
  result.prints = [...new Set([...markerPrints(prep, vocab, tokens), ...census])].sort();
  if (archetypePrints) report.variance = varianceDelta(result.prints, archetypePrints, vocab.variance && vocab.variance.accept);

  // metadata (its own first section, delivered form; no lang row)
  const chrome = site.chromeFor(page.url || '') || {};
  const h1 = qs(rootEl, 'h1');
  const vars = { $title: escPlain(page.title || ''), $description: escPlain(page.description || ''), $nav: escPlain(chrome.nav || ''), $footer: escPlain(chrome.footer || ''), $h1: h1 ? escText(plainText(h1, ctx)) : '', $ogtitle: escPlain((page.og && page.og.title) || '') };
  const metaRows = (vocab.metadata || DEFAULT_METADATA).map(([k, expr]) => [k, metaValue(expr, vars, ctx, k)]).filter(([, v]) => v);

  const content = sections.filter((s) => s.nodes.length);
  result.sections = sections.length;
  result.blocks = sections.flatMap((s) => s.nodes.filter((x) => x.kind === 'block').map((x) => [x.name, ...x.variants].join(' ')));
  const sectionHtml = sections.map((s) => {
    const parts = s.nodes.map((x) => (x.kind === 'block'
      ? [`<div class="${esc([x.name, ...x.variants].join(' '))}">`, ...x.rows.map((r) => `<div>${r.map((c) => `<div>${tidy(c)}</div>`).join('')}</div>`), '</div>'].join('\n')
      : tidy(x.html)));
    if (s.style) parts.push(['<div class="section-metadata">', `<div><div>style</div><div>${escPlain(s.style)}</div></div>`, '</div>'].join('\n'));
    return ['<div>', ...parts, '</div>'].join('\n');
  });
  const metaHtml = ['<div>', '<div class="metadata">', ...metaRows.map(([k, v]) => `<div><div>${escPlain(k)}</div><div>${v}</div></div>`), '</div>', '</div>'].join('\n');
  const body = ['<body>', '<header></header>', '<main>', metaHtml, ...sectionHtml, '</main>', '<footer></footer>', '</body>'].join('\n');
  let prefinal = `${body}\n`;

  // the page's patches: on the rendered document, before the checks that judge it (the h1, the content count)
  if (patches !== null && patches !== undefined) { // only [] means "no patches"; any other non-array is an error
    const errs = validatePatches(patches);
    if (errs.length) { report.errors.push(...errs.map((e) => `stardust/patches: ${e}`)); return; }
    if (patches.length) { const r = applyPatches(prefinal, patches); prefinal = r.html; report.patchesApplied = r.applied; }
  }

  // h1 presence is a DOM fact: an inline-first or image-only heading counts, an empty one does not
  if (!content.length) report.errors.push('0 sections — an empty page is never written');
  const h1El = qs(parseHTML(prefinal), 'h1');
  if (vocab.requireH1 !== false && !(h1El && (!blankText(rawText(h1El)) || qs(h1El, 'img')))) report.errors.push('no <h1> in the encoded document');

  // L5: the offline content count of the capture's content root against the encoded document
  if (inventory && content.length) {
    const keys = countKeys || {};
    const opts = { mediaKey: keys.mediaKey || (() => null), linkKey: keys.linkKey || (() => null), base };
    const walked = new Set(tops);
    const countRoot = tops.length > 1 ? rootEl.parent : rootEl;
    const srcInv = inventory.offlineInventory(countRoot, { ...opts, exclude: (x) => excluded.has(x) || (x.parent === countRoot && tops.length > 1 && !walked.has(x)) });
    const outMain = qs(parseHTML(prefinal), 'main');
    const docInv = inventory.offlineInventory(outMain, { ...opts, exclude: (x) => isEl(x) && matches(x, '.metadata, .section-metadata') });
    const diff = inventory.diffOffline(srcInv, docInv, opts);
    report.incomplete = diff.missing || [];
    report.count = { counts: diff.counts || null, extra: (diff.extra || []).length, tolerated: (diff.tolerated || []).length };
  }
  result.html = finalise ? finalise(prefinal) : prefinal;
}
