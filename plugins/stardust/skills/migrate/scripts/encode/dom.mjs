/**
 * migrate/encode/dom.mjs — the encoder's mini DOM: an HTML parser into a plain node tree, a serialiser, and a
 * CSS-selector engine (qs / qsa / matches). A library module (no CLI); Node built-ins only — it imports nothing.
 *
 * Nodes: { type: 'root', tag: '#root', attrs, children, parent: null } · { type: 'element', tag, attrs, children, parent }
 *        · { type: 'text', text, parent }. Attribute values are entity-decoded; text nodes keep their raw source text.
 *
 * Runtime: a built-in HTML parser + CSS-selector matcher (tag, #id, .class, [attr op value],
 * combinators, :scope :not :is :has :first-child :last-child :empty). Browser-serialised captures
 * are regular HTML, so no browser is launched and NO network request can happen — zero source hits
 * by construction (hit-minimisation), and the plugin keeps zero runtime dependencies.
 *
 * Ported from the `stardust/next` branch: `skills/migrate/scripts/importer-skeleton.mjs` (commits 9aaeff4f, d4a37277, 7662fda2).
 */

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
// index of the ')' that closes the '(' just before `i` (nesting and quotes honoured); -1 when unclosed
function closeParen(s, i) { let d = 1; let q = null; for (let k = i; k < s.length; k += 1) { const c = s[k]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(') d += 1; else if (c === ')') { d -= 1; if (d === 0) return k; } } return -1; }
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:([\w-]+)(\()?/g;
  let m; let last = 0;
  while ((m = re.exec(s))) {
    if (m.index !== last) throw new Error(`bad selector near "${s.slice(last)}"`);
    last = re.lastIndex;
    if (m[1] !== undefined) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2] !== undefined) c.id = m[2];
    else if (m[3] !== undefined) c.classes.push(m[3]);
    else if (m[4] !== undefined) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? null });
    else if (m[9] !== undefined) {
      let arg = null;
      if (m[10] !== undefined) { const end = closeParen(s, last); if (end === -1) throw new Error(`bad selector near "${s.slice(m.index)}"`); arg = s.slice(last, end); last = end + 1; re.lastIndex = last; }
      c.pseudos.push({ name: m[9], arg });
    }
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
    else if (p.name === 'has') { if (!hasRelative(n, p.arg)) return false; }
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
// :has() takes relative selectors, each anchored at the element: a leading > + ~ or (by default) the descendant
// combinator; an argument that already starts with :scope is anchored as written
function hasRelative(n, arg) {
  return splitTop(arg, ',').some((rel) => {
    const sel = /^:scope(?![\w-])/.test(rel) ? rel : `:scope ${rel}`;
    let pool = [...walk(n)];
    if (/^[+~]/.test(rel)) { const sibs = n.parent ? kids(n.parent) : []; pool = sibs.slice(sibs.indexOf(n) + 1).flatMap((s) => [s, ...walk(s)]); }
    return pool.some((d) => matches(d, sel, n));
  });
}
export function qsa(rootNode, sel) { const out = []; for (const d of walk(rootNode)) if (matches(d, sel, rootNode)) out.push(d); return out; }
export const qs = (rootNode, sel) => qsa(rootNode, sel)[0] || null;
