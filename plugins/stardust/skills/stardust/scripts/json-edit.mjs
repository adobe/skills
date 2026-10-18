#!/usr/bin/env node
// skills/stardust/scripts/json-edit.mjs — one edit of a JSON file (set, merge, append or delete at a
// path), under a lock, written atomically in the file's own style.
//
//   node stardust/scripts/stardust/json-edit.mjs <file> set <path> <value>
//   node stardust/scripts/stardust/json-edit.mjs <file> merge <path> <json-object>
//   node stardust/scripts/stardust/json-edit.mjs <file> append <path> <value>
//   node stardust/scripts/stardust/json-edit.mjs <file> delete <path>
//        [--create]   (anywhere; `--` ends the options, so a value may start with `--`)
//
// Why: the recorded runs edited JSON ledgers in place with 18 python programs and wrote a node script
// 32 times just to update a notes JSON. Such a whole-file rewrite from one process's memory loses a
// parallel writer's entry, and a slip leaves a malformed file. This instrument re-reads the file under
// deploy's file lock, applies the one edit, writes atomically and prints the value before and after.
//
// Path: keys separated by "."; a key in double quotes is one key and may hold dots (a."b.c".d, with \"
// and \\ escaped inside); [n] is an index segment (a[0].b = a.0.b); "." alone is the root (merge, and
// append when the root is an array). Value: JSON when it parses, else the string as given.
// Guards (refused, nothing written): a path outside the project (the cwd), resolving outside it, a
// symlink loop or not a regular file — for --create the would-be path, whose existing ancestors must not
// be dangling symlinks; a file with a dedicated writer (replace.mjs ownedBy, case ignored); an absent
// file without --create; a file that is not JSON; __proto__ / constructor / prototype in the path or at
// any depth of a value.
// Write: replace.mjs writeAll — a sibling temp file, created exclusively, renamed over the real path,
// mode kept; indent, line endings and the trailing newline as the file had them; a result equal to the
// file byte for byte is not written.
// Exit codes: 0 written or unchanged · 1 I/O error · 2 usage, refusal, lock timeout, file-lock.mjs or
// replace.mjs missing.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// deploy's lock, in both layouts: plugin tree (skills/stardust/scripts → ../../deploy/scripts) and project
// copy (stardust/scripts/stardust → ../deploy). Imported after --help and argument checks.
const FILE_LOCK = [join(HERE, '..', '..', 'deploy', 'scripts', 'file-lock.mjs'), join(HERE, '..', 'deploy', 'file-lock.mjs')];
// replace.mjs (resolveInside, ownedBy, writeAll) sits beside this script in both layouts; imported after
// --help and argument checks too, so the pure helpers throw json-edit's own errors (replace.mjs's shape).
const REPLACE = join(HERE, 'replace.mjs');
let replaceLib = null;

class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }
class Refusal extends UsageError {}

export const OPS = ['set', 'merge', 'append', 'delete'];
export const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
export const CUT = 120;
export const NEW_STYLE = { indent: 2, eol: '\n', trailing: true };
const USAGE = 'usage: json-edit.mjs <file> set|merge|append <path> <value> | <file> delete <path> [--create] (--help)';

const HELP = `Usage:
  node stardust/scripts/stardust/json-edit.mjs <file> set <path> <value>
  node stardust/scripts/stardust/json-edit.mjs <file> merge <path> <json-object>
  node stardust/scripts/stardust/json-edit.mjs <file> append <path> <value>
  node stardust/scripts/stardust/json-edit.mjs <file> delete <path>
       [--create]   (anywhere; -- ends the options, so a value may start with --)
  (run from the project root; <file> must lie inside it)
  (needs replace.mjs beside it and deploy's file-lock.mjs: ../../deploy/scripts/, ../deploy/ in a project copy)

One edit of a JSON file, locked and atomic — never a python or node -e rewrite of the JSON.
Path: keys separated by "." (a.b.c); a key in double quotes is one key and may hold dots (a."b.c".d;
  \\" and \\\\ escape inside the quotes); [n] is an index segment (a[0].b = a.0.b); "." alone is the root
  (merge, and append when the root is an array). Empty segments, an unbalanced quote or bracket are
  usage errors.
Value: JSON when it parses, else the text as given — 12 → 12, true → true, hello → "hello",
  '"12"' → "12". merge needs a JSON object.
Operations — in an object a segment is an own key, in an array an index 0 ≤ n < length:
  set     sets the key or replaces the element; missing objects on the way are created ({}); not the root
  merge   deep merge into an object (absent → created): where both sides hold an object it recurses,
          otherwise the payload's value replaces (arrays, scalars, null)
  append  adds the value to an array (absent → [value])
  delete  removes the key or splices the element; the path must exist; not the root
  --create  an absent file starts as {} ([] for append .), parent directories created
Refused (exit 2, nothing written, one stderr line "json-edit: refused — <reason>"): a path outside the
  project, resolving outside it (a symlink), a symlink loop or not a regular file — for --create the
  would-be path, and a symlink to a missing file or directory on it; a file with a dedicated writer,
  case ignored (a progress ledger → progress.mjs, …: use the writer); an absent file without --create;
  a file that is not JSON;
  ${UNSAFE_KEYS.join(', ')} in the path or at any depth of the value; an index out of range; a
  non-object on the way ("a.b is a number, not an object"); a merge target that is not an object, an
  append target that is not an array; delete of a missing path; something already at the temp
  file's name.
Writes: under deploy's file lock (<file>.lock beside the real file; file-lock.mjs beside this script's
  skill: ../../deploy/scripts/ or ../deploy/), the file re-read inside the lock; a sibling temp file
  (.<name>.<pid>.tmp, created exclusively) renamed over the real path, the file mode kept. The file's
  style is kept: the indent (a tab, or the first indented line's spaces; a file with no line break
  inside stays compact), CRLF line endings, a trailing newline iff it had one; a new file gets 2 spaces
  and a newline. A result equal to the file byte for byte is not written. A symlink inside the project
  stays a link.
Output: one stdout line
  json-edit <rel> <op> <path>: <before> → <after>[ unchanged]
  <before> / <after>: the value at the path as compact JSON, cut to ${CUT} characters (…); (absent) when
  there was none, (deleted) after a delete; " unchanged" when nothing was written.
Usage errors (exit 2, one stderr line "json-edit: <message>"): an unknown --option, a missing or extra
  argument, an unknown operation, a bad path, merge without a JSON object, set or delete on the root.
Exit codes: 0 written or unchanged · 1 I/O error · 2 usage error, refusal, lock timeout, file-lock.mjs or
  replace.mjs not found.`;

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isContainer = (v) => v !== null && typeof v === 'object';
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a${typeof v === 'object' ? 'n' : ''} ${typeof v}`);
const clone = (v) => (Array.isArray(v) ? v.map(clone) : isMap(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const toPosix = (p) => p.split(sep).join('/');
const isInside = (p, dir) => { const r = relative(dir, p); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
const quoteKey = (k) => (/^[^."[\]\\]+$/.test(k) ? k : `"${k.replace(/[\\"]/g, '\\$&')}"`);
const ROOT = 'the root (.)';

// ---- pure helpers (exported for tests) ---------------------------------------------------------
/** A value: JSON when it parses, else the text as given (the progress.mjs --set rule). */
export function parseValue(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/** Path text → its segments (strings); "." → []. A syntax error throws a UsageError. */
export function parsePath(text) {
  if (text === '.') return [];
  if (text === '') throw new UsageError('the path is empty — name a key, or . for the root');
  const bad = (why) => new UsageError(`path ${text}: ${why}`);
  const segs = [];
  const n = text.length;
  let i = 0;
  const index = () => {
    const close = text.indexOf(']', i + 1);
    const open = text.indexOf('[', i + 1);
    if (close === -1 || (open !== -1 && open < close)) throw bad('unbalanced bracket');
    const body = text.slice(i + 1, close);
    if (!/^\d+$/.test(body)) throw bad(`[${body}] is not an index (digits only)`);
    segs.push(body);
    i = close + 1;
  };
  const key = () => {
    if (text[i] === '"') {
      let k = '';
      for (i += 1; ; ) {
        if (i >= n) throw bad('unbalanced quote');
        const c = text[i];
        if (c === '"') { i += 1; break; }
        if (c === '\\') {
          if (text[i + 1] !== '"' && text[i + 1] !== '\\') throw bad('inside quotes only \\" and \\\\ escape');
          k += text[i + 1]; i += 2;
        } else { k += c; i += 1; }
      }
      segs.push(k);
      return;
    }
    let j = i;
    while (j < n && !'."[]'.includes(text[j])) j += 1;
    if (j === i) throw bad(text[i] === ']' ? 'unbalanced bracket' : 'empty segment');
    if (text[j] === '"') throw bad('a quote opens a key only at its start — quote the whole key');
    segs.push(text.slice(i, j));
    i = j;
  };
  if (text[0] === '[') index(); else key();
  while (i < n) {
    const c = text[i];
    if (c === '.') { i += 1; key(); } else if (c === '[') index();
    else if (c === ']') throw bad('unbalanced bracket');
    else throw bad(`unexpected ${c} after a key — separate keys with .`);
  }
  return segs;
}

/** Segments → path text (the form parsePath reads back); [] → ".". */
export const formatPath = (segs) => (segs.length ? segs.map(quoteKey).join('.') : '.');

/** The first unsafe key at any depth of `v` → its path (segments), or null. */
function unsafeAt(v, at = []) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i += 1) { const r = unsafeAt(v[i], [...at, String(i)]); if (r) return r; }
    return null;
  }
  if (!isMap(v)) return null;
  for (const [k, x] of Object.entries(v)) {
    if (UNSAFE_KEYS.includes(k)) return [...at, k];
    const r = unsafeAt(x, [...at, k]);
    if (r) return r;
  }
  return null;
}

/** The checks that need no document: root rules and the merge payload (UsageError), unsafe keys (Refusal). */
function checkEdit(op, segs, shown, value) {
  if (!segs.length && (op === 'set' || op === 'delete')) throw new UsageError(`${op} on the root (.) — name a key${op === 'set' ? ', or merge . <json-object>' : ''}`);
  if (op === 'merge' && !isMap(value)) throw new UsageError(`merge needs a JSON object, got ${cut(JSON.stringify(value) ?? String(value))}`);
  const k = segs.find((s) => UNSAFE_KEYS.includes(s));
  if (k !== undefined) throw new Refusal(`${shown}: "${k}" is never edited (${UNSAFE_KEYS.join(', ')})`);
  if (op !== 'delete') {
    const at = unsafeAt(value);
    if (at) throw new Refusal(`the ${op} value holds "${at.at(-1)}" at ${formatPath(at)} — ${UNSAFE_KEYS.join(', ')} are never written`);
  }
}

export function parseArgs(argv) {
  const pos = [];
  let create = false;
  let options = true;
  for (const a of argv) {
    if (options && a === '--') options = false;
    else if (options && a === '--create') create = true;
    else if (options && (a === '--help' || a === '-h')) continue;
    else if (options && a.startsWith('--')) throw new UsageError(`unknown option ${a} (--create, --help; -- ends the options)`);
    else pos.push(a);
  }
  const [file, op, path, valueText, ...extra] = pos;
  if (op === undefined) throw new UsageError(USAGE);
  if (!OPS.includes(op)) throw new UsageError(`unknown operation "${op}" — set, merge, append or delete`);
  if (path === undefined) throw new UsageError(`${op} needs a <path> (--help)`);
  let value;
  if (op === 'delete') { if (valueText !== undefined) extra.unshift(valueText); } else {
    if (valueText === undefined) throw new UsageError(`${op} needs a ${op === 'merge' ? '<json-object>' : '<value>'} (--help)`);
    value = parseValue(valueText);
    if (op === 'merge' && !isMap(value)) throw new UsageError(`merge needs a JSON object, got ${cut(valueText)}`);
  }
  if (extra.length) throw new UsageError(`unexpected argument(s) after ${op} ${path}${op === 'delete' ? '' : ' <value>'}: ${extra.join(' ')}`);
  const segments = parsePath(path);
  checkEdit(op, segments, path, value);
  return { file, op, path, segments, value, create };
}

function deepMerge(target, payload) {
  for (const [k, v] of Object.entries(payload)) {
    if (isMap(v) && Object.hasOwn(target, k) && isMap(target[k])) deepMerge(target[k], v);
    else target[k] = clone(v);
  }
}

/**
 * Apply one edit to `doc` (not mutated) → { doc, before, after }: the edited copy and the value at the
 * path before and after (undefined = absent; after a delete, undefined). `path` is the path text or its
 * segments; `file` names the document in "no <path> in <file>". A refusal throws a UsageError (exit 2).
 */
export function applyEdit(doc, op, path, value, { file = 'the document' } = {}) {
  if (!OPS.includes(op)) throw new UsageError(`unknown operation "${op}" — set, merge, append or delete`);
  const segs = typeof path === 'string' ? parsePath(path) : [...path];
  const shown = typeof path === 'string' ? path : formatPath(segs);
  checkEdit(op, segs, shown, value);
  const out = clone(doc);
  if (!segs.length) {
    const before = clone(out);
    if (op === 'merge') {
      if (!isMap(out)) throw new Refusal(`${ROOT} is ${typeName(out)}, not an object`);
      deepMerge(out, value);
    } else {
      if (!Array.isArray(out)) throw new Refusal(`${ROOT} is ${typeName(out)}, not an array`);
      out.push(clone(value));
    }
    return { doc: out, before, after: clone(out) };
  }
  const missing = () => new Refusal(`no ${shown} in ${file}`);
  if (!isContainer(out)) {
    if (op === 'delete') throw missing();
    throw new Refusal(`${ROOT} is ${typeName(out)}, not an object`);
  }
  let cur = out;
  let prefix = '';
  const step = (seg) => {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(seg)) throw new Refusal(`${shown}: ${prefix || ROOT} is an array — "${seg}" is not an index`);
      if (Number(seg) >= cur.length) throw new Refusal(`${shown}: index ${seg} out of range (length ${cur.length})`);
      return { key: Number(seg), has: true, at: `${prefix}[${seg}]` };
    }
    return { key: seg, has: Object.hasOwn(cur, seg), at: prefix ? `${prefix}.${quoteKey(seg)}` : quoteKey(seg) };
  };
  for (const seg of segs.slice(0, -1)) {
    const s = step(seg);
    if (!s.has) {
      if (op === 'delete') throw missing();
      cur[s.key] = {};
    } else if (!isContainer(cur[s.key])) {
      if (op === 'delete') throw missing();
      throw new Refusal(`${s.at} is ${typeName(cur[s.key])}, not an object`);
    }
    cur = cur[s.key];
    prefix = s.at;
  }
  const s = step(segs.at(-1));
  const before = s.has ? clone(cur[s.key]) : undefined;
  if (op === 'set') cur[s.key] = clone(value);
  else if (op === 'merge') {
    if (!s.has) cur[s.key] = clone(value);
    else if (!isMap(cur[s.key])) throw new Refusal(`${s.at} is ${typeName(cur[s.key])}, not an object`);
    else deepMerge(cur[s.key], value);
  } else if (op === 'append') {
    if (!s.has) cur[s.key] = [clone(value)];
    else if (!Array.isArray(cur[s.key])) throw new Refusal(`${s.at} is ${typeName(cur[s.key])}, not an array`);
    else cur[s.key].push(clone(value));
  } else {
    if (!s.has) throw missing();
    if (Array.isArray(cur)) cur.splice(s.key, 1); else delete cur[s.key];
  }
  return { doc: out, before, after: op === 'delete' ? undefined : clone(cur[s.key]) };
}

/** The file's style: indent (a tab, the first indented line's spaces, 0 = compact), line ending, trailing newline. */
export function styleOf(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = text.endsWith('\n');
  const body = text.replace(/\r?\n$/, '');
  if (!body.includes('\n')) return { indent: 0, eol, trailing };
  const m = body.match(/\n([ \t]+)\S/);
  return { indent: !m ? 2 : m[1][0] === '\t' ? '\t' : m[1].match(/^ +/)[0].length, eol, trailing };
}

export function formatJSON(doc, { indent, eol, trailing } = NEW_STYLE) {
  let out = indent ? JSON.stringify(doc, null, indent) : JSON.stringify(doc);
  if (eol !== '\n') out = out.replaceAll('\n', eol);
  return trailing ? out + eol : out;
}

function cut(s) {
  const cps = Array.from(s);
  return cps.length > CUT ? `${cps.slice(0, CUT).join('')}…` : s;
}

/** The one output line: `json-edit <rel> <op> <path>: <before> → <after>[ unchanged]`. */
export function formatLine(rel, op, path, { before, after, written }) {
  const b = before === undefined ? '(absent)' : cut(JSON.stringify(before));
  const a = op === 'delete' ? '(deleted)' : cut(JSON.stringify(after));
  return `json-edit ${rel} ${op} ${path}: ${b} → ${a}${written ? '' : ' unchanged'}`;
}

// ---- I/O ---------------------------------------------------------------------------------------
/** An absent `file`'s would-be path: lexically inside `root`, its nearest existing ancestor a directory inside realpath(root). */
function wouldBe(file, root) {
  const logical = resolve(root);
  const base = realpathSync.native(logical);
  const abs = resolve(logical, file);
  const lexical = isInside(abs, logical) ? logical : isInside(abs, base) ? base : null;
  if (lexical === null) throw new Refusal(`${file} is outside the project (${base})`);
  const entry = (p) => { try { lstatSync(p); return true; } catch { return false; } };
  if (entry(abs)) throw new Refusal(`${file} is a symlink to a missing file`);
  let dir = dirname(abs);
  let real = null;
  while (real === null) {
    try { real = realpathSync.native(dir); } catch (e) {
      if (e.code === 'ELOOP') throw new Refusal(`${file}: symlink loop`);
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      // an entry that does not resolve is a symlink whose target is missing: the parent directories could not be made
      if (entry(dir)) throw new Refusal(`${file}: ${toPosix(relative(lexical, dir))} is a symlink to a missing directory`);
      dir = dirname(dir);
    }
  }
  if (!isInside(real, base)) throw new Refusal(`${file} resolves outside the project (${real})`);
  if (!statSync(real).isDirectory()) throw new Refusal(`${toPosix(relative(base, real)) || '.'} is not a directory`);
  real = join(real, relative(dir, abs));
  return { abs, real, rel: toPosix(relative(lexical, abs)), realRel: toPosix(relative(base, real)) };
}

/** `file` inside the project → { abs, real, rel, realRel, present }; the guards refuse (exit 2). Needs loadReplace() first. */
export function locate(file, { create = false, root = process.cwd() } = {}) {
  const { ownedBy, resolveInside } = replaceLib;
  let present = true;
  // ENOENT / ENOTDIR = absent; anything else (a symlink loop, …) is resolveInside's to report
  try { statSync(resolve(root, file)); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') present = false; }
  const r = present ? resolveInside(file, root) : wouldBe(file, root);
  // the on-disk path first: the refusal names the ledger as it is spelled on disk (ownedBy ignores case)
  for (const rel of [r.realRel, r.rel]) {
    const writer = ownedBy(rel);
    if (writer) throw new Refusal(`${rel} is written by ${writer} — use it`);
  }
  if (!present && !create) throw new Refusal(`no such file ${file} — pass --create to start one`);
  return { ...r, present };
}

function readText(file, rel) {
  const buf = readFileSync(file);
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) throw new Refusal(`${rel} is not JSON (bytes that are not UTF-8) — nothing written`);
  return text;
}

function parseDoc(text, rel) {
  try { return JSON.parse(text); } catch (e) { throw new Refusal(`${rel} is not JSON (${String(e.message).split('\n')[0]}) — nothing written`); }
}

async function loadLock() {
  const found = FILE_LOCK.find((p) => existsSync(p));
  const lib = found ? await import(pathToFileURL(found).href) : null;
  if (!lib || typeof lib.withLock !== 'function') {
    throw new UsageError(`deploy's file-lock.mjs not found beside this script (${FILE_LOCK.map((p) => relative(process.cwd(), p) || p).join(' or ')}) — copy the deploy scripts first; nothing written`);
  }
  return lib;
}

async function loadReplace() {
  const lib = existsSync(REPLACE) ? await import(pathToFileURL(REPLACE).href) : null;
  if (!lib || !['ownedBy', 'resolveInside', 'writeAll', 'Refusal', 'UsageError'].every((k) => typeof lib[k] === 'function')) {
    throw new UsageError(`replace.mjs not found beside this script (${relative(process.cwd(), REPLACE) || REPLACE}) — copy the stardust scripts first; nothing written`);
  }
  replaceLib = lib;
  return lib;
}

// json-edit's errors and replace.mjs's (resolveInside, writeAll) alike.
const isUsage = (e) => e instanceof UsageError || (replaceLib !== null && e instanceof replaceLib.UsageError);
const isRefusal = (e) => e instanceof Refusal || (replaceLib !== null && e instanceof replaceLib.Refusal);

// ---- main --------------------------------------------------------------------------------------
export async function main(argv) {
  const end = argv.indexOf('--');
  const options = end === -1 ? argv : argv.slice(0, end);
  if (options.includes('--help') || options.includes('-h')) { console.log(HELP); return 0; }
  const o = parseArgs(argv);
  const { writeAll } = await loadReplace();
  const t = locate(o.file, { create: o.create });
  const start = () => (o.op === 'append' && !o.segments.length ? [] : {});
  // an absent file: a failing edit is refused before the lock creates its directory
  if (!t.present) applyEdit(start(), o.op, o.path, o.value, { file: t.rel });
  const { withLock } = await loadLock();
  const result = withLock(t.real, () => {
    // re-read INSIDE the lock: a parallel writer's edit since this process started must survive
    const present = existsSync(t.real);
    if (!present && !o.create) throw new Refusal(`no such file ${o.file} — pass --create to start one`);
    const text = present ? readText(t.real, t.rel) : null;
    const r = applyEdit(present ? parseDoc(text, t.rel) : start(), o.op, o.path, o.value, { file: t.rel });
    const next = formatJSON(r.doc, present ? styleOf(text) : NEW_STYLE);
    if (next === text) return { ...r, written: false };
    if (!present) mkdirSync(dirname(t.real), { recursive: true });
    writeAll([{ rel: t.rel, real: t.real, next, mode: present ? statSync(t.real).mode & 0o7777 : 0o666 & ~process.umask() }]);
    return { ...r, written: true };
  });
  console.log(formatLine(t.rel, o.op, o.path, result));
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exitCode = await main(process.argv.slice(2)); } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    console.error(isRefusal(e) ? `json-edit: refused — ${msg}` : `json-edit: ${msg}`);
    // file-lock's bounded wait ends in "lock <dir> held for over <n> ms …": a refusal, not an I/O error
    process.exitCode = isUsage(e) || /^lock .+ held for over \d+ ms/.test(msg) ? 2 : 1;
  }
}
