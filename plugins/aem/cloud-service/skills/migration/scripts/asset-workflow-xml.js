'use strict';
// Dependency-free XML reader for FileVault .content.xml, pom.xml and filter.xml.
// Every element records its source offsets so fixers can edit text spans instead of
// re-serialising the document — comments, license headers, entity encodings
// (e.g. &#xd;&#xa; inside OR-split scripts) and indentation survive, and diffs stay minimal.
const crypto = require('crypto');

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

function encodeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\r/g, '&#xd;').replace(/\n/g, '&#xa;').replace(/\t/g, '&#x9;');
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

// Whitespace between the start of the line and pos — '' when non-whitespace precedes pos on that line.
function lineIndent(text, pos) {
  let s = pos;
  while (s > 0 && text[s - 1] !== '\n') s--;
  const prefix = text.slice(s, pos);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

function childIndent(text, parent) {
  for (const c of parent.children) { const ind = lineIndent(text, c.start); if (ind) return ind; }
  const own = parent.type === 'document' ? '' : lineIndent(text, parent.start);
  return own + '    ';
}

function reindent(raw, from, to) {
  if (!from && !raw.includes('\n')) return raw;
  return raw.split('\n').map((line, idx) => (idx > 0 && from && line.startsWith(from) ? to + line.slice(from.length) : line)).join('\n');
}

// ── Span edits ────────────────────────────────────────────────────────

let editSeq = 0;
const mkEdit = (start, end, text) => ({ start, end, text, seq: editSeq++ });

function wsBefore(text, pos) { let s = pos; while (s > 0 && isWs(text[s - 1])) s--; return s; }

const removeElementEdit = (text, el) => mkEdit(wsBefore(text, el.start), el.end, '');

function insertChildEdit(text, parent, raw, opts = {}) {
  const indent = opts.indent != null ? opts.indent : childIndent(text, parent);
  // Without fromIndent, raw is a zero-based template: shift every following line by the child indent.
  const shifted = opts.fromIndent != null ? reindent(raw, opts.fromIndent, indent)
    : raw.split('\n').map((line, idx) => (idx > 0 && line ? indent + line : line)).join('\n');
  const body = '\n' + indent + shifted;
  if (parent.selfClosing) {
    const pIndent = lineIndent(text, parent.start);
    return mkEdit(parent.tagCloseStart, parent.startTagEnd, '>' + body + '\n' + pIndent + `</${parent.name}>`);
  }
  if (opts.after) return mkEdit(opts.after.end, opts.after.end, body);
  const last = parent.children[parent.children.length - 1];
  return last ? mkEdit(last.end, last.end, body) : mkEdit(parent.startTagEnd, parent.startTagEnd, body);
}

function setAttrEdit(text, el, name, value, rawAttr) {
  const attrText = rawAttr || `${name}="${encodeAttr(value)}"`;
  const existing = findAttr(el, name);
  if (existing) return mkEdit(existing.start, existing.end, attrText);
  const last = el.attrs[el.attrs.length - 1];
  if (last) {
    const ind = lineIndent(text, last.start);
    return mkEdit(last.end, last.end, (ind ? '\n' + ind : ' ') + attrText);
  }
  return mkEdit(el.nameEnd, el.nameEnd, ' ' + attrText);
}

const removeAttrEdit = (text, attr) => mkEdit(wsBefore(text, attr.start), attr.end, '');

function applyEdits(text, edits) {
  const ranges = edits.filter(e => e.end > e.start).sort((a, b) => a.start - b.start);
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k].start < ranges[k - 1].end) throw new Error(`Overlapping edits at ${ranges[k].start}`);
  }
  for (const ins of edits.filter(e => e.end === e.start)) {
    if (ranges.some(r => ins.start > r.start && ins.start < r.end)) throw new Error(`Insert inside edited range at ${ins.start}`);
  }
  // Apply back-to-front. At an equal start, replacements go before inserts so inserts land at
  // the replaced range's start; equal-position inserts are applied last-first to keep their order.
  const ordered = edits.slice().sort((a, b) => (b.start - a.start)
    || ((a.end === a.start) - (b.end === b.start))
    || (b.seq - a.seq));
  let out = text;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ── Canonical comparison (ignores formatting, comments, attr order, xmlns) ──

const isNs = name => name === 'xmlns' || name.startsWith('xmlns:');
const normText = s => s.replace(/\s+/g, ' ').trim();

function hashOf(el) {
  if (el._hash) return el._hash;
  const attrs = el.attrs.filter(a => !isNs(a.name)).map(a => [a.name, a.value]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify([el.name, attrs, normText(el.texts.map(t => t.value).join('')), el.children.map(hashOf)]));
  el._hash = h.digest('hex');
  return el._hash;
}

function canonicalEqual(a, b) {
  try {
    const ra = rootElement(parseXml(a)), rb = rootElement(parseXml(b));
    return !!ra && !!rb && hashOf(ra) === hashOf(rb);
  } catch { return false; }
}

// ── Diff minimiser ────────────────────────────────────────────────────
// Rebuilds the tool's output as minimal span edits on the original text. Accepted only when the
// result is canonically equal to the tool's output; otherwise the caller keeps the tool's version.

function lcsPairs(A, B) {
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let x = n - 1; x >= 0; x--) {
    for (let y = m - 1; y >= 0; y--) {
      dp[x][y] = hashOf(A[x]) === hashOf(B[y]) ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    }
  }
  const pairs = [];
  let x = 0, y = 0;
  while (x < n && y < m) {
    if (hashOf(A[x]) === hashOf(B[y])) { pairs.push([x, y]); x++; y++; } else if (dp[x + 1][y] >= dp[x][y + 1]) x++; else y++;
  }
  return pairs;
}

function diffElements(orig, out, ea, eb, edits) {
  for (const ab of eb.attrs) {
    const aa = findAttr(ea, ab.name);
    if (!aa) {
      // A new namespace declaration goes next to the existing ones rather than after the last attribute.
      const lastNs = isNs(ab.name) && ea.attrs.filter(x => isNs(x.name)).pop();
      edits.push(lastNs ? mkEdit(lastNs.end, lastNs.end, ' ' + out.slice(ab.start, ab.end)) : setAttrEdit(orig, ea, ab.name, ab.value, out.slice(ab.start, ab.end)));
    } else if (!isNs(ab.name) && aa.value !== ab.value) edits.push(mkEdit(aa.start, aa.end, out.slice(ab.start, ab.end)));
  }
  for (const aa of ea.attrs) {
    if (!isNs(aa.name) && !findAttr(eb, aa.name)) edits.push(removeAttrEdit(orig, aa));
  }

  const A = ea.children, B = eb.children;
  const textA = normText(ea.texts.map(t => t.value).join('')), textB = normText(eb.texts.map(t => t.value).join(''));
  if (!A.length && !B.length) {
    if (textA === textB) return;
    const inner = eb.selfClosing ? '' : out.slice(eb.startTagEnd, eb.endTagStart);
    if (ea.selfClosing) edits.push(mkEdit(ea.tagCloseStart, ea.startTagEnd, `>${inner}</${ea.name}>`));
    else edits.push(mkEdit(ea.startTagEnd, ea.endTagStart, inner));
    return;
  }
  if (textA !== textB) throw new Error(`Mixed-content change in <${ea.name}>`);

  const matched = lcsPairs(A, B);
  const counterpart = new Map(); // index in B -> element in A
  for (const [x, y] of matched) counterpart.set(y, A[x]);
  const removed = new Set();
  const bounds = [[-1, -1], ...matched, [A.length, B.length]];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [ax, by] = bounds[k], [ax2, by2] = bounds[k + 1];
    let cursor = ax + 1;
    for (let y = by + 1; y < by2; y++) {
      let found = -1;
      for (let x = cursor; x < ax2; x++) if (A[x].name === B[y].name) { found = x; break; }
      if (found >= 0) {
        for (let x = cursor; x < found; x++) removed.add(x);
        counterpart.set(y, A[found]);
        diffElements(orig, out, A[found], B[y], edits);
        cursor = found + 1;
      }
    }
    for (let x = cursor; x < ax2; x++) removed.add(x);
  }
  for (const x of removed) edits.push(removeElementEdit(orig, A[x]));

  const toInsert = [];
  let prev = null;
  for (let y = 0; y < B.length; y++) {
    if (counterpart.has(y)) { prev = counterpart.get(y); continue; }
    toInsert.push({ raw: out.slice(B[y].start, B[y].end), fromIndent: lineIndent(out, B[y].start), after: prev });
  }
  if (!toInsert.length) return;
  const indent = childIndent(orig, ea);
  if (ea.selfClosing) {
    const pIndent = lineIndent(orig, ea.start);
    const body = toInsert.map(t => '\n' + indent + reindent(t.raw, t.fromIndent, indent)).join('');
    edits.push(mkEdit(ea.tagCloseStart, ea.startTagEnd, '>' + body + '\n' + pIndent + `</${ea.name}>`));
    return;
  }
  for (const t of toInsert) {
    const pos = t.after ? t.after.end : ea.startTagEnd;
    edits.push(mkEdit(pos, pos, '\n' + indent + reindent(t.raw, t.fromIndent, indent)));
  }
}

function minimizeDiff(orig, out) {
  let a, b;
  try { a = parseXml(orig); b = parseXml(out); } catch (e) { return { text: out, minimized: false, reason: `parse-error: ${e.message}` }; }
  const ra = rootElement(a), rb = rootElement(b);
  if (!ra || !rb) return { text: out, minimized: false, reason: 'no-root-element' };
  if (hashOf(ra) === hashOf(rb)) return { text: orig, minimized: true, identical: true };
  if (ra.name !== rb.name) return { text: out, minimized: false, reason: 'root-renamed' };
  let result;
  try {
    const edits = [];
    diffElements(orig, out, ra, rb, edits);
    result = applyEdits(orig, edits);
  } catch (e) { return { text: out, minimized: false, reason: e.message }; }
  if (!canonicalEqual(result, out)) return { text: out, minimized: false, reason: 'verification-failed' };
  return { text: result, minimized: true };
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

const formatMultiValue = arr => '[' + arr.map(x => String(x).replace(/\\/g, '\\\\').replace(/,/g, '\\,')).join(',') + ']';

module.exports = {
  parseXml, rootElement, getAttr, findAttr, child, textOf, findAll, unboundPrefixes,
  decodeEntities, decodeAttr, encodeAttr, lineIndent, childIndent, reindent,
  mkEdit, removeElementEdit, insertChildEdit, setAttrEdit, removeAttrEdit, applyEdits,
  hashOf, canonicalEqual, minimizeDiff, parseMultiValue, formatMultiValue,
};
