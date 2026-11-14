#!/usr/bin/env node
/**
 * skills/replica/scripts/json-query.mjs — a bounded view of a JSON file: the
 * shape of an object, a table of an array filtered by regex, the union of
 * keys across items. Schema-agnostic on purpose: capture files (computed
 * styles, content trees, motion checks, crawl logs) are written by the run
 * itself and differ between projects.
 *
 * Why: in one recorded hands-off session (2026-09-18) the agent wrote 21
 * one-off `node -e` scripts to look inside capture JSON — 141k characters of
 * output, plus the scripts themselves as input — mostly to answer "which
 * elements have this class, and where are they". That is one bounded table.
 * In another (2026-09-18) the agent read slug→URL pairs off the table and
 * launched two background probes against the cut cells — both killed and
 * restarted from a hand-written map. The table is for reading; a value that
 * feeds a command comes from `--tsv` or `--path <record>.<field>`, which never
 * truncate.
 *
 * Usage:
 *   node json-query.mjs <file.json>                             # shape of the root
 *   node json-query.mjs <file.json> --path elements             # array → table; object → shape
 *       [--match <key>=<regex>]…   keep items whose key (dotted) matches; `!=` to exclude
 *       [--fields <a,b.c,d>]       columns (default: the first 6 scalar keys of the first item)
 *       [--max <n>=40]             rows shown; [--width <n>=48] cell width (cut cells end in …,
 *                                  and one footer counts them)
 *       [--tsv]                    machine-readable: every matching record as one line, the fields
 *                                  tab-separated and WHOLE (no cut, no padding, --max not applied);
 *                                  a header line first, [--no-header] drops it; a tab, CR or
 *                                  newline inside a value is written as \t \r \n
 *       [--keys]                   union of keys across the items with counts and a sample type
 *       [--depth <n>=1]            object shape recursion
 *       [--count]                  only the number of (matching) items
 *   node json-query.mjs crawl.json --path pages --fields slug,url --tsv --no-header \
 *     | while IFS=$'\t' read -r slug url; do …; done               # values for commands
 *   node json-query.mjs crawl.json --path pages[3].url            # one string, printed whole
 *
 * Paths: dotted, with [n] or .n for indexes (`main[0].slides.1.content`).
 * Every reading view is capped and its footer says what was left out; `--tsv`
 * and `--path` to a string are not. Exit 0 = printed, 2 = path missing or
 * nothing matches, 125 = usage (unknown flag, or a value flag — --path,
 * --match, --fields, --max, --width, --depth — followed by nothing or by
 * another --flag: the flag is named, never swallowed as the value).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = 'Usage: node json-query.mjs <file.json> [--path <p>] [--match <k>=<re>]… [--fields <a,b>] [--max <n>] [--width <n>] [--tsv] [--no-header] [--keys] [--depth <n>] [--count]\n'
  + 'The table is for reading (cells cut at --width, marked …); values that feed a command come from --tsv or --path <record>.<field>, which never truncate.';

export function getPath(root, path) {
  if (!path) return root;
  const parts = path.match(/[^.[\]]+/g) || [];
  let cur = root;
  for (const p of parts) { if (cur === null || cur === undefined) return undefined; cur = cur[p]; }
  return cur;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cut = (s, max) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

export function cell(v, width = 48) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'string') return cut(v.replace(/\s+/g, ' '), width);
  if (typeof v !== 'object') return cut(String(v), width);
  return cut(JSON.stringify(v), width);
}

/** One TSV field: the whole value; a tab, CR or newline inside it written as \t \r \n so a row stays one line. */
export function tsvCell(v) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

export function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) { const t = v.length ? typeOf(v[0]).split(/[\s({[]/)[0] : 'empty'; return `array[${v.length}] of ${t}`; }
  if (typeof v === 'object') { const k = Object.keys(v); return `object{${k.length}}${k.length ? ` ${cut(k.join(','), 60)}` : ''}`; }
  if (typeof v === 'string') return `string(${v.length})${v.length ? ` ${JSON.stringify(cut(v.replace(/\s+/g, ' '), 40))}` : ''}`;
  return `${typeof v} ${String(v)}`;
}

export function shape(v, { depth = 1, indent = '' } = {}) {
  if (!isObj(v)) return [`${indent}${typeOf(v)}`];
  const out = [];
  for (const [k, val] of Object.entries(v)) {
    out.push(`${indent}${k}: ${typeOf(val)}`);
    if (depth > 1 && isObj(val)) out.push(...shape(val, { depth: depth - 1, indent: `${indent}  ` }));
    if (depth > 1 && Array.isArray(val) && val.length && isObj(val[0])) out.push(...shape(val[0], { depth: depth - 1, indent: `${indent}  [0].` }));
  }
  return out;
}

export function parseMatch(spec) {
  const m = spec.match(/^([^=!]+)(!=|=)(.*)$/s);
  if (!m) throw new Error(`--match needs <key>=<regex> or <key>!=<regex>, got ${spec}`);
  let re; try { re = new RegExp(m[3], 'i'); } catch (e) { throw new Error(`bad --match regex ${m[3]}: ${e.message}`); }
  return { key: m[1].trim(), negate: m[2] === '!=', re };
}

export function matches(item, filters) {
  return filters.every(({ key, negate, re }) => {
    const v = getPath(item, key);
    const hit = v !== undefined && re.test(typeof v === 'object' ? JSON.stringify(v) : String(v));
    return negate ? !hit : hit;
  });
}

export function defaultFields(items) {
  const first = items.find(isObj);
  if (!first) return [];
  const scalars = Object.keys(first).filter((k) => !isObj(first[k]) && !Array.isArray(first[k]));
  return (scalars.length ? scalars : Object.keys(first)).slice(0, 6);
}

/** The reading view: padded columns, cells cut at `width` (marked …). Returns the lines and how many cells were cut. */
export function table(items, fields, { max = 40, width = 48 } = {}) {
  let truncated = 0;
  const rows = items.slice(0, max).map((it, idx) => [String(idx), ...fields.map((f) => {
    const full = cell(getPath(it, f), Infinity); const shown = cut(full, width);
    if (shown !== full) truncated += 1;
    return shown;
  })]);
  const header = ['#', ...fields];
  const widths = header.map((h, c) => Math.min(width, Math.max(h.length, ...rows.map((r) => r[c].length))));
  const line = (r) => r.map((c, k) => c.padEnd(widths[k])).join('  ').trimEnd();
  return { lines: [line(header), ...rows.map(line)], truncated };
}

/** The machine-readable view: every item, the fields tab-separated and whole; scalars one per line. */
export function tsv(items, fields, { header = true } = {}) {
  if (!items.some(isObj)) return items.map((v) => tsvCell(v));
  const rows = items.map((it) => fields.map((f) => tsvCell(getPath(it, f))).join('\t'));
  return header ? [fields.join('\t'), ...rows] : rows;
}

export function keyUnion(items) {
  const counts = new Map();
  for (const it of items) if (isObj(it)) for (const [k, v] of Object.entries(it)) { const c = counts.get(k) || { n: 0, type: typeOf(v).split(/[\s({[]/)[0] }; c.n += 1; counts.set(k, c); }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, c]) => `${k}: ${c.n}× ${c.type}`);
}

function view(root, o) {
  const target = getPath(root, o.path);
  if (target === undefined) { console.error(`json-query: nothing at path "${o.path}" — root shape:\n${shape(root, { depth: 1 }).join('\n')}`); return 2; }
  const where = o.path ? `${o.file} → ${o.path}` : o.file;
  if (Array.isArray(target)) {
    const items = o.filters.length ? target.filter((it) => matches(it, o.filters)) : target;
    const filt = o.filters.length ? ` (${items.length} of ${target.length} match ${o.filters.map((f) => `${f.key}${f.negate ? '!=' : '='}/${f.re.source}/`).join(' ')})` : '';
    if (o.count) { console.log(`${where}: ${items.length}${o.filters.length ? ` of ${target.length}` : ''} items`); return items.length ? 0 : 2; }
    if (!items.length) { console.error(`json-query: ${where}: no item matches${filt}`); return 2; }
    if (o.keys) { console.log(`${where}: array[${target.length}]${filt} — keys across items:`); console.log(keyUnion(items).slice(0, 80).join('\n')); return 0; }
    const fields = o.fields.length ? o.fields : defaultFields(items);
    if (o.tsv) { console.log(tsv(items, fields, { header: o.header }).join('\n')); return 0; }
    if (!items.some(isObj)) { console.log(`${where}: array[${target.length}]${filt} of ${typeOf(items[0]).split(/[\s(]/)[0]}`); console.log(items.slice(0, o.max).map((v) => cell(v, o.width)).join(', ') + (items.length > o.max ? ` … ${items.length - o.max} more` : '')); return 0; }
    const other = Object.keys(items.find(isObj)).filter((k) => !fields.includes(k));
    console.log(`${where}: array[${target.length}]${filt}, showing ${Math.min(o.max, items.length)} rows × ${fields.length} fields${other.length ? `; other keys: ${cut(other.join(','), 200)}` : ''}`);
    const t = table(items, fields, { max: o.max, width: o.width });
    console.log(t.lines.join('\n'));
    if (items.length > o.max) console.log(`… ${items.length - o.max} more rows — add --match, or raise --max`);
    if (t.truncated) console.log(`${t.truncated} cell(s) truncated at --width ${o.width} — full values: --tsv, or --path ${o.path}[<#>].<field>`);
    return 0;
  }
  if (o.tsv) { console.log(tsv([target], o.fields.length ? o.fields : defaultFields([target]), { header: o.header }).join('\n')); return 0; }
  if (isObj(target)) { console.log(`${where}: object{${Object.keys(target).length}}`); console.log(shape(target, { depth: o.depth }).slice(0, 200).join('\n')); return 0; }
  if (typeof target === 'string') { console.log(`${where}: string(${target.length}), whole value follows`); console.log(target); return 0; }
  console.log(`${where}: ${typeOf(target)}`);
  return 0;
}

function cli(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); return rest.length ? 0 : 125; }
  const o = { file: null, path: '', filters: [], fields: [], max: 40, width: 48, tsv: false, header: true, keys: false, depth: 1, count: false };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag (125).
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`${flag} needs a value\n${HELP}`); return rest[i + 1]; };
  try {
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (a === '--path') { o.path = need(i, a); i += 1; }
      else if (a === '--match') { o.filters.push(parseMatch(need(i, a))); i += 1; }
      else if (a === '--fields') { o.fields = need(i, a).split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
      else if (a === '--max') { o.max = Number(need(i, a)); i += 1; }
      else if (a === '--width') { o.width = Number(need(i, a)); i += 1; }
      else if (a === '--depth') { o.depth = Number(need(i, a)); i += 1; }
      else if (a === '--tsv') o.tsv = true;
      else if (a === '--no-header') o.header = false;
      else if (a === '--keys') o.keys = true;
      else if (a === '--count') o.count = true;
      else if (a.startsWith('--')) throw new Error(`unknown flag ${a}\n${HELP}`);
      else if (!o.file) o.file = a;
      else throw new Error(`unexpected argument ${a}\n${HELP}`);
    }
    if (!o.file) throw new Error(`need <file.json>\n${HELP}`);
    if (![o.max, o.width, o.depth].every((v) => Number.isFinite(v) && v > 0)) throw new Error('--max, --width and --depth need positive numbers');
  } catch (e) { console.error(`json-query: ${e.message}`); return 125; }
  let root; try { root = JSON.parse(readFileSync(o.file, 'utf8')); } catch (e) { console.error(`json-query: cannot read ${o.file} as JSON: ${e.message}`); return 1; }
  return view(root, o);
}

// Main-module guard by REAL path: node resolves the entry's symlinks for import.meta.url but leaves process.argv[1]
// as typed, so a symlinked checkout or temp dir (e.g. /var → /private/var) would otherwise make the CLI a silent no-op.
function isMainModule(metaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { return realpathSync(argv1) === fileURLToPath(metaUrl); } catch { return false; }
}
if (isMainModule(import.meta.url)) process.exitCode = cli(process.argv);
