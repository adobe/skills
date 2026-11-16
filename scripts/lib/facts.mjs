// The facts a plugin may keep next to its skills, to show what they tell an agent that a
// model doesn't know:
//
//   <plugin>/facts.yaml                 a list of facts, each with
//     id        unique in the file
//     claim     the fact: something that can be checked, not advice
//     question  how a user who never saw the skill would ask for it, without the answer
//     source    where it can be checked: a page of the product's documentation, its code
//     used_by   the files, relative to the plugin, that state or test it: a SKILL.md, a
//               reference, an eval
//
// facts.yaml is read with a small YAML subset (keys, block scalars, lists of strings), so
// that this needs no dependency. What the subset doesn't know is an error, not a guess.
export const FACT_KEYS = ['id', 'claim', 'question', 'source', 'used_by'];
const REQUIRED = ['id', 'claim', 'question'];
const KEY = /^( {2}|- )([A-Za-z_][\w-]*):(?:\s+(.*))?$/;

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}

// A block scalar: `|` keeps the lines, `>` folds them into one, with blank lines as breaks.
function blockScalar(style, lines) {
  const body = lines.map((line) => line.replace(/^ {4}/, ''));
  while (body.length > 0 && !body.at(-1).trim()) body.pop();
  if (style[0] !== '>') return body.join('\n');
  const paragraphs = [];
  let current = [];
  for (const line of body) {
    if (line.trim()) current.push(line.trim());
    else if (current.length > 0) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n');
}

export function parseFacts(text, name = 'facts.yaml') {
  const lines = text.split(/\r?\n/);
  const facts = [];
  let fact = null;
  const fail = (index, message) => {
    throw new Error(`${name}:${index + 1}: ${message}`);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.startsWith('#')) continue;
    const match = KEY.exec(line);
    if (!match) fail(index, `this reader doesn't know the syntax of "${line.trim()}"`);
    if (match[1] === '- ') {
      fact = {};
      facts.push(fact);
    } else if (!fact) fail(index, 'a fact starts with "- id:"');
    const [, , key, rest = ''] = match;
    const raw = rest.trim();
    if (!FACT_KEYS.includes(key)) fail(index, `unknown key ${key}; a fact has ${FACT_KEYS.join(', ')}`);
    if (key in fact) fail(index, `${key} twice`);
    if (/^[>|][+-]?$/.test(raw)) {
      const block = [];
      while (index + 1 < lines.length && (!lines[index + 1].trim() || lines[index + 1].startsWith('    '))) block.push(lines[++index]);
      fact[key] = blockScalar(raw, block);
    } else if (raw === '') {
      const items = [];
      while (index + 1 < lines.length && /^ {4}- /.test(lines[index + 1])) items.push(unquote(lines[++index].replace(/^ {4}- /, '')));
      fact[key] = items;
    } else if (raw === '[]') {
      fact[key] = [];
    } else if (/^[[{]/.test(raw)) {
      fail(index, 'a list is written one item per line; only [] is understood inline');
    } else {
      fact[key] = unquote(raw);
    }
  }
  const ids = new Set();
  for (const [index, entry] of facts.entries()) {
    for (const key of REQUIRED) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) throw new Error(`${name}: fact ${index + 1} (${entry.id ?? 'no id'}) has no ${key}`);
    }
    if (entry.used_by !== undefined && !Array.isArray(entry.used_by)) throw new Error(`${name}: ${entry.id}: used_by is a list`);
    if (entry.source !== undefined && typeof entry.source !== 'string') throw new Error(`${name}: ${entry.id}: source is text`);
    if (ids.has(entry.id)) throw new Error(`${name}: the id ${entry.id} twice`);
    ids.add(entry.id);
    entry.used_by ??= [];
  }
  return facts;
}
