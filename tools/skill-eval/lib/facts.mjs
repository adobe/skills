import { readFile } from 'node:fs/promises';

const KEY = /^( {2}|- )([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
const REQUIRED = ['id', 'claim', 'question'];

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}

function blockScalar(style, lines) {
  const folded = style[0] === '>';
  const body = lines.map((l) => l.replace(/^ {4}/, ''));
  while (body.length && !body.at(-1).trim()) body.pop();
  if (!folded) return body.join('\n');
  const paragraphs = [];
  let current = [];
  for (const l of body) {
    if (l.trim()) current.push(l.trim());
    else if (current.length) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(' '));
  return paragraphs.join('\n');
}

export function parseFacts(text, name = 'facts') {
  const lines = text.split(/\r?\n/);
  const facts = [];
  let fact = null;
  const fail = (i, msg) => {
    throw new Error(`${name}:${i + 1}: ${msg}`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) continue;
    const m = KEY.exec(line);
    if (!m) fail(i, `unsupported syntax: ${line.trim()}`);
    if (m[1] === '- ') {
      fact = { used_by: [] };
      facts.push(fact);
    } else if (!fact) fail(i, 'expected a "- id:" entry first');
    const key = m[2];
    const raw = m[3]?.trim() ?? '';
    if (key in fact && key !== 'used_by') fail(i, `duplicate key ${key}`);
    if (/^[>|][+-]?$/.test(raw)) {
      const block = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].startsWith('    '))) block.push(lines[++i]);
      fact[key] = blockScalar(raw, block);
    } else if (raw === '') {
      const items = [];
      while (i + 1 < lines.length && /^ {4}- /.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^ {4}- /, '')));
      fact[key] = items;
    } else if (raw === '[]') fact[key] = [];
    else if (/^[[{]/.test(raw)) fail(i, 'flow collections are not supported (except [])');
    else fact[key] = unquote(raw);
  }
  const ids = new Set();
  for (const [n, f] of facts.entries()) {
    for (const k of REQUIRED) if (typeof f[k] !== 'string' || !f[k].trim()) throw new Error(`${name}: fact #${n + 1} (${f.id ?? '?'}) needs a non-empty ${k}`);
    if (ids.has(f.id)) throw new Error(`${name}: duplicate fact id ${f.id}`);
    ids.add(f.id);
  }
  return facts;
}

export async function loadFacts(path) {
  return parseFacts(await readFile(path, 'utf8'), path);
}
