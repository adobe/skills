'use strict';
// Dependency-free XML reader for FileVault .content.xml, pom.xml and filter.xml. Read-only.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e];
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(cp);
  });
}

// XML attribute-value normalisation: literal line breaks/tabs become spaces, entities are decoded.
function decodeAttr(raw) {
  return decodeEntities(raw.replace(/\r\n/g, '\n').replace(/[\t\n\r]/g, ' '));
}


const isWs = c => c === ' ' || c === '\t' || c === '\n' || c === '\r';

function xmlError(msg, pos) { const e = new Error(`${msg} at offset ${pos}`); e.xmlOffset = pos; return e; }

function parseXml(text) {
  const doc = { type: 'document', name: '#document', children: [], texts: [], attrs: [], start: 0, end: text.length };
  const stack = [doc];
  const n = text.length;
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) { pushText(top(), text, i, n); break; }
    if (lt > i) pushText(top(), text, i, lt);
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      if (e < 0) throw xmlError('Unterminated comment', lt);
      i = e + 3; continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      if (e < 0) throw xmlError('Unterminated CDATA', lt);
      top().texts.push({ start: lt, end: e + 3, value: text.slice(lt + 9, e) });
      i = e + 3; continue;
    }
    if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt + 2);
      if (e < 0) throw xmlError('Unterminated processing instruction', lt);
      i = e + 2; continue;
    }
    if (text.startsWith('<!', lt)) {
      let depth = 0, j = lt + 2;
      for (; j < n; j++) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') depth--;
        else if (text[j] === '>' && depth <= 0) break;
      }
      if (j >= n) throw xmlError('Unterminated declaration', lt);
      i = j + 1; continue;
    }
    if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      if (gt < 0) throw xmlError('Unterminated end tag', lt);
      const name = text.slice(lt + 2, gt).trim();
      const el = stack.pop();
      if (!el || el === doc || el.name !== name) throw xmlError(`Mismatched </${name}>`, lt);
      el.endTagStart = lt;
      el.end = gt + 1;
      i = gt + 1; continue;
    }
    i = parseStartTag(text, lt, stack);
  }
  if (stack.length !== 1) throw xmlError(`Unclosed <${top().name}>`, top().start);
  return doc;
}

function pushText(el, text, s, e) {
  const raw = text.slice(s, e);
  if (raw.length) el.texts.push({ start: s, end: e, value: decodeEntities(raw) });
}

function parseStartTag(text, lt, stack) {
  const n = text.length;
  let j = lt + 1;
  while (j < n && !isWs(text[j]) && text[j] !== '>' && text[j] !== '/') j++;
  const name = text.slice(lt + 1, j);
  if (!name) throw xmlError('Empty element name', lt);
  const el = { type: 'element', name, attrs: [], children: [], texts: [], start: lt, parent: stack[stack.length - 1] };
  el.nameEnd = j;
  for (;;) {
    while (j < n && isWs(text[j])) j++;
    if (j >= n) throw xmlError(`Unterminated <${name}>`, lt);
    if (text[j] === '/' && text[j + 1] === '>') {
      el.selfClosing = true; el.tagCloseStart = j; el.startTagEnd = j + 2; el.end = j + 2; el.endTagStart = null;
      el.parent.children.push(el);
      return j + 2;
    }
    if (text[j] === '>') {
      el.selfClosing = false; el.tagCloseStart = j; el.startTagEnd = j + 1;
      el.parent.children.push(el);
      stack.push(el);
      return j + 1;
    }
    const aStart = j;
    while (j < n && !isWs(text[j]) && text[j] !== '=' && text[j] !== '>' && text[j] !== '/') j++;
    const aName = text.slice(aStart, j);
    while (j < n && isWs(text[j])) j++;
    if (text[j] !== '=') throw xmlError(`Attribute ${aName} without value`, aStart);
    j++;
    while (j < n && isWs(text[j])) j++;
    const q = text[j];
    if (q !== '"' && q !== "'") throw xmlError(`Unquoted attribute ${aName}`, j);
    const vEnd = text.indexOf(q, j + 1);
    if (vEnd < 0) throw xmlError(`Unterminated attribute ${aName}`, j);
    const raw = text.slice(j + 1, vEnd);
    el.attrs.push({ name: aName, raw, value: decodeAttr(raw), quote: q, start: aStart, end: vEnd + 1, valueStart: j + 1, valueEnd: vEnd });
    j = vEnd + 1;
  }
}

// ── Navigation helpers ────────────────────────────────────────────────

const rootElement = doc => doc.children[0] || null;
const getAttr = (el, name) => { const a = el && el.attrs.find(x => x.name === name); return a ? a.value : undefined; };
const findAttr = (el, name) => el && el.attrs.find(x => x.name === name);
const child = (el, name) => (el && el.children.find(c => c.name === name)) || null;
const textOf = el => (el ? el.texts.map(t => t.value).join('').trim() : '');

function findAll(el, pred, out = []) {
  for (const c of el.children) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}

// Namespace prefixes used on element or attribute names with no xmlns:<prefix> declaration in scope.
function unboundPrefixes(doc) {
  const out = new Set();
  const prefixOf = n => (n.includes(':') ? n.slice(0, n.indexOf(':')) : null);
  const visit = (el, scope) => {
    const declared = new Set(scope);
    for (const a of el.attrs) if (a.name.startsWith('xmlns:')) declared.add(a.name.slice(6));
    for (const n of [el.name, ...el.attrs.map(a => a.name)]) {
      const p = prefixOf(n);
      if (p && p !== 'xml' && p !== 'xmlns' && !declared.has(p)) out.add(p);
    }
    for (const c of el.children) visit(c, declared);
  };
  const root = rootElement(doc);
  if (root) visit(root, new Set());
  return [...out];
}

// FileVault multi-value property: "[a,b\,c]" → ['a', 'b,c'].
function parseMultiValue(v) {
  if (v == null) return [];
  let s = String(v).trim();
  s = s.replace(/^\{[A-Za-z]+\}/, '');
  if (!(s.startsWith('[') && s.endsWith(']'))) return s ? [s] : [];
  s = s.slice(1, -1);
  const out = []; let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && k + 1 < s.length) { cur += s[k + 1]; k++; continue; }
    if (s[k] === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += s[k];
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out.filter(x => x !== '');
}

module.exports = { parseXml, rootElement, getAttr, findAttr, child, textOf, findAll, unboundPrefixes, decodeEntities, decodeAttr, parseMultiValue };
