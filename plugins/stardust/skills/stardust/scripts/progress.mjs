#!/usr/bin/env node
// skills/stardust/scripts/progress.mjs — the unit recorder: one command records a unit's start and
// end in a progress ledger, instead of a hand-written `node -e` edit of the JSON.
//
//   node stardust/scripts/stardust/progress.mjs unit <start|done|failed> <name> [--ledger rollout|migrate|replica]
//        [--file <path>] [--kind <k>] [--pages <n>] [--blocks <n>] [--templates a,b] [--verdict "<line>"]
//        [--set <key>=<value>]… [--again] [--json]
//   node stardust/scripts/stardust/progress.mjs show [<name>] [--ledger …] [--file …] [--json]
//
// Ledgers (paths relative to the project root, the cwd):
//   rollout  stardust/rollout/progress.json  { units: { <name>: { status, kind, templates[], pages, blocks?, gates?,
//            startedAt, endedAt, verdict } } }   kind foundation|archetype|cluster|final
//   migrate  stardust/migrate/progress.json  the same shape                kind plan|render|assets|report
//   replica  stardust/replica/progress.json  { _provenance?, types: { <archetype>: { …free record… } }, siblings?,
//            migrate? } — a record takes no --kind (--set pageType=<type>); every other top-level key belongs to
//            gate-evidence.mjs and is written back as it was read.
// Why: units were recorded by ad-hoc `node -e` one-shots that rewrote the whole file from one process's memory.
// Parallel unit subagents share one ledger, so a rewrite dropped another unit's entry; a slip in the
// one-shot left a malformed file or a wrong shape that the readers (done-check, token-ledger, the
// final report) then skipped. This script re-reads the file under deploy's file lock, edits the one
// entry, writes atomically, and prints the row so the transcript carries the record.
//
// Transitions. start: an absent / pending / failed entry → running, startedAt = now, endedAt removed;
// a running entry stays running with its startedAt (a resume, the line says "(resumed)"); a done entry
// is refused unless --again (then a fresh start). done / failed: the entry must exist; status set,
// endedAt = now. --kind, --pages, --blocks, --templates and --verdict set their fields; --set sets a
// dotted key inside the entry (value parsed as JSON when it parses, else kept as a string).
// Shape refusals write nothing: a file that is not JSON or not an object, a map or entry that is not an
// object, an unknown status, a replica file holding one archetype's bare record at the top level.
// Exit codes: 0 written / printed · 1 I/O error · 2 usage, refusal, lock timeout, file-lock.mjs missing.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// deploy's lock, in both layouts: plugin tree (skills/stardust/scripts → ../../deploy/scripts) and project
// copy (stardust/scripts/stardust → ../deploy). Imported after --help and argument checks.
const FILE_LOCK = [join(HERE, '..', '..', 'deploy', 'scripts', 'file-lock.mjs'), join(HERE, '..', 'deploy', 'file-lock.mjs')];

export const LEDGERS = {
  rollout: { file: 'stardust/rollout/progress.json', map: 'units', kinds: ['foundation', 'archetype', 'cluster', 'final'] },
  migrate: { file: 'stardust/migrate/progress.json', map: 'units', kinds: ['plan', 'render', 'assets', 'report'] },
  replica: { file: 'stardust/replica/progress.json', map: 'types', kinds: null },
};
export const NAME_RE = /^[\w.-]+$/;
export const EVENTS = ['start', 'done', 'failed'];
export const STATUSES = ['pending', 'running', 'done', 'failed'];
export const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
// Entry keys written first, in this order (the ledgers' documented shape); any other key follows in its own order.
export const FIELD_ORDER = ['status', 'kind', 'templates', 'pages', 'blocks', 'gates', 'startedAt', 'endedAt', 'verdict'];
const COMMAND_FIELDS = ['status', 'startedAt', 'endedAt'];
const FLAG_FIELDS = { kind: '--kind', templates: '--templates', pages: '--pages', blocks: '--blocks', verdict: '--verdict' };
const UNIT_ONLY = ['--kind', '--pages', '--blocks', '--templates', '--verdict', '--set', '--again'];

const HELP = `Usage:
  node stardust/scripts/stardust/progress.mjs unit <start|done|failed> <name> [--ledger rollout|migrate|replica]
       [--file <path>] [--kind <k>] [--pages <n>] [--blocks <n>] [--templates a,b] [--verdict "<line>"]
       [--set <key>=<value>]… [--again] [--json]
  node stardust/scripts/stardust/progress.mjs show [<name>] [--ledger …] [--file …] [--json]
  (run from the project root; <name> matches ${NAME_RE}, never ${UNSAFE_KEYS.join(', ')})

Records a unit's start and end in a progress ledger — never a hand-written node -e edit of the JSON.
Inputs / outputs (--ledger, default rollout; --file overrides the path, the map follows --ledger):
  rollout  ${LEDGERS.rollout.file}  units.<name>  --kind ${LEDGERS.rollout.kinds.join('|')}
  migrate  ${LEDGERS.migrate.file}  units.<name>  --kind ${LEDGERS.migrate.kinds.join('|')}
  replica  ${LEDGERS.replica.file}  types.<archetype>  no --kind (use --set pageType=<type>);
           _provenance, siblings, migrate and every other top-level key are written back as read
  An absent ledger is created with its empty map (parent directories too).
unit start:   absent / pending / failed → running, startedAt = now (UTC, seconds), endedAt removed;
              running → kept, startedAt kept, the line says "(resumed)";
              done → exit 2 "unit <name> is done — pass --again to run it again" (--again: a fresh start)
unit done|failed: the unit must exist (else exit 2 "no unit <name> in <file> — progress.mjs unit start
              <name> first"); status set, endedAt = now
Fields: --kind (the ledger's vocabulary), --pages / --blocks (integer ≥ 0), --templates a,b (an array),
  --verdict (one line; line breaks folded to spaces). --set <key>=<value> (repeatable): a dotted key
  inside the entry (gates.1440={"archetype":1.3}); the value is JSON when it parses, else the string.
  __proto__, constructor and prototype are refused; status / startedAt / endedAt belong to the command
  and kind / templates / pages / blocks / verdict to their flags.
Safety: read-modify-write under deploy's file lock (<file>.lock, file-lock.mjs beside this script's
  skill: ../../deploy/scripts/ or ../deploy/), the file re-read inside the lock, written atomically.
Refused (exit 2, nothing written, one stderr line): a file that is not JSON or not an object; the map
  or the entry not an object; a status outside ${STATUSES.join('|')}; a replica file whose top level is one
  archetype's record (archetype or breakpoints, no types) — gate-evidence.mjs wraps it under
  types.<archetype> (source-fidelity-gate.md § Residual logging format).
Output: one stdout line per write, fields omitted when unset —
  progress <ledger> <name>: <status>[ (resumed)] kind=<k> pages=<n> blocks=<n> templates=<a,b>
  startedAt=<iso> endedAt=<iso> verdict=<text>
  (one line; "-" when an entry has no status). --json prints the entry as JSON instead.
show: one such line per entry, sorted by name, or the named one (missing → exit 2); --json prints
  the entry, or the map of entries by name. An absent ledger → nothing printed, a note on stderr. Writes nothing.
Exit codes: 0 written / printed · 1 I/O error · 2 usage, refusal, lock timeout, file-lock.mjs not found.`;

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const oneLine = (s) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

// ---- pure helpers (exported for tests) ---------------------------------------------------------
/** A --set value: JSON when it parses, else the text as given. */
export function parseSetValue(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/** `<key>=<value>` → { path[], value }; the dotted key's segments checked. */
export function parseSet(raw) {
  const at = raw.indexOf('=');
  if (at <= 0) throw new UsageError(`--set needs <key>=<value>, got "${raw}"`);
  const key = raw.slice(0, at);
  const path = key.split('.');
  if (path.some((p) => p === '')) throw new UsageError(`--set ${key}: empty key segment`);
  const unsafe = path.find((p) => UNSAFE_KEYS.includes(p));
  if (unsafe) throw new UsageError(`--set ${key}: "${unsafe}" is not a settable key`);
  if (COMMAND_FIELDS.includes(path[0])) throw new UsageError(`--set ${key}: ${path[0]} is set by the command itself`);
  if (hasOwn(FLAG_FIELDS, path[0])) throw new UsageError(`--set ${key}: use ${FLAG_FIELDS[path[0]]}`);
  return { path, value: parseSetValue(raw.slice(at + 1)) };
}

/** Set `value` at `path` inside `obj`, creating missing objects; a non-object on the way is refused. */
export function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    if (!hasOwn(cur, k)) cur[k] = {};
    else if (!isMap(cur[k])) throw new UsageError(`--set ${path.join('.')}: ${path.slice(0, i + 1).join('.')} is not an object`);
    cur = cur[k];
  }
  cur[path.at(-1)] = value;
  return obj;
}

const count = (flag, v) => {
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw new UsageError(`${flag} needs an integer ≥ 0, got "${v}"`);
  return Number(v);
};

export function parseArgs(argv) {
  const o = { cmd: null, event: null, name: null, ledger: 'rollout', file: null, fields: {}, sets: [], again: false, json: false };
  const pos = [];
  const seen = new Set();
  const given = [];
  const isFlag = (v) => v.startsWith('--') || v === '-h';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // A value flag never swallows the next flag: `--verdict --json` is a forgotten value, not the text "--json".
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      if (isFlag(argv[i + 1])) throw new UsageError(`${a} needs a value (got ${argv[i + 1]}, which is a flag)`);
      i += 1; return argv[i];
    };
    const once = () => { if (seen.has(a)) throw new UsageError(`${a} given twice`); seen.add(a); given.push(a); };
    if (a === '--json') o.json = true;
    else if (a === '--again') { o.again = true; given.push(a); }
    else if (a === '--ledger') { once(); o.ledger = need(); }
    else if (a === '--file') { once(); o.file = need(); }
    else if (a === '--kind') { once(); o.fields.kind = need(); }
    else if (a === '--pages') { once(); o.fields.pages = count(a, need()); }
    else if (a === '--blocks') { once(); o.fields.blocks = count(a, need()); }
    else if (a === '--templates') { once(); o.fields.templates = need().split(',').map((t) => t.trim()).filter(Boolean); }
    else if (a === '--verdict') {
      once();
      o.fields.verdict = oneLine(need());
      if (!o.fields.verdict) throw new UsageError('--verdict needs a non-empty line');
    } else if (a === '--set') { given.push(a); o.sets.push(parseSet(need())); }
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  if (!pos.length) throw new UsageError('usage: progress.mjs unit <start|done|failed> <name> … | show [<name>] (--help)');
  if (!hasOwn(LEDGERS, o.ledger)) throw new UsageError(`--ledger must be rollout|migrate|replica, got "${o.ledger}"`);
  const [cmd, ...rest] = pos;
  const checkName = (n) => {
    if (!NAME_RE.test(n)) throw new UsageError(`unit name "${n}" must match ${NAME_RE}`);
    if (UNSAFE_KEYS.includes(n)) throw new UsageError(`unit name "${n}" is reserved`);
    return n;
  };
  if (cmd === 'show') {
    if (rest.length > 1) throw new UsageError(`unexpected argument(s) after show <name>: ${rest.slice(1).join(' ')}`);
    const misplaced = given.find((f) => UNIT_ONLY.includes(f));
    if (misplaced) throw new UsageError(`${misplaced} applies to unit only`);
    o.cmd = 'show';
    o.name = rest.length ? checkName(rest[0]) : null;
    return o;
  }
  if (cmd !== 'unit') throw new UsageError(`unknown command "${cmd}" — unit <start|done|failed> <name> or show [<name>]`);
  const [event, name, ...extra] = rest;
  if (!EVENTS.includes(event)) throw new UsageError(`unit needs an event start|done|failed, got ${event === undefined ? 'nothing' : `"${event}"`}`);
  if (name === undefined) throw new UsageError(`unit ${event} needs a <name>`);
  if (extra.length) throw new UsageError(`unexpected argument(s) after unit ${event} ${name}: ${extra.join(' ')}`);
  o.cmd = 'unit'; o.event = event; o.name = checkName(name);
  if (o.again && event !== 'start') throw new UsageError('--again applies to unit start only');
  const { kinds } = LEDGERS[o.ledger];
  if (hasOwn(o.fields, 'kind')) {
    if (!kinds) throw new UsageError('replica records take no --kind — use --set pageType=<type>');
    if (!kinds.includes(o.fields.kind)) throw new UsageError(`--kind ${o.fields.kind} is not a ${o.ledger} kind (${kinds.join('|')})`);
  }
  return o;
}

/** Refuse a ledger document whose shape the readers cannot use; `names` = the entries that must be objects. */
export function checkDoc(doc, ledger, file, names = []) {
  const { map } = LEDGERS[ledger];
  if (!isMap(doc)) throw new UsageError(`${file} is not a JSON object`);
  if (ledger === 'replica' && !hasOwn(doc, 'types')) {
    const top = ['archetype', 'breakpoints'].filter((k) => hasOwn(doc, k));
    if (top.length) throw new UsageError(`${file} is one archetype's record at the top level (${top.join(', ')}) and has no types map — gate-evidence.mjs wraps such a file under types.<archetype> (source-fidelity-gate.md § Residual logging format); run it, or move the record there, then retry`);
  }
  if (!hasOwn(doc, map)) return;
  if (!isMap(doc[map])) throw new UsageError(`${file}: ${map} is not an object`);
  for (const n of names) if (hasOwn(doc[map], n) && !isMap(doc[map][n])) throw new UsageError(`${file}: ${map}.${n} is not an object`);
}

/** The entry with FIELD_ORDER keys first; built with fromEntries so a key read from disk stays an own key. */
export const orderEntry = (e) => Object.fromEntries([
  ...FIELD_ORDER.filter((k) => hasOwn(e, k)).map((k) => [k, e[k]]),
  ...Object.keys(e).filter((k) => !FIELD_ORDER.includes(k)).map((k) => [k, e[k]]),
]);

/**
 * Apply one `unit <event> <name>` to the parsed ledger `doc` (mutated) at time `now`.
 * `o` = { ledger, file, event, name, fields, sets, again }. Returns { entry, resumed }; throws UsageError on a refusal.
 */
export function applyUnit(doc, o, now) {
  const { map: mapKey } = LEDGERS[o.ledger];
  checkDoc(doc, o.ledger, o.file, [o.name]);
  if (!hasOwn(doc, mapKey)) doc[mapKey] = {};
  const map = doc[mapKey];
  const had = hasOwn(map, o.name);
  const entry = had ? { ...map[o.name] } : {};
  const { status } = entry;
  if (status !== undefined && !STATUSES.includes(status)) throw new UsageError(`${o.file}: ${mapKey}.${o.name}.status ${JSON.stringify(status)} is not one of ${STATUSES.join('|')}`);
  let resumed = false;
  if (o.event === 'start') {
    if (status === 'done' && !o.again) throw new UsageError(`unit ${o.name} is done — pass --again to run it again`);
    if (status === 'running') { resumed = true; if (entry.startedAt == null) entry.startedAt = now; } else { entry.startedAt = now; delete entry.endedAt; }
    entry.status = 'running';
  } else {
    if (!had) throw new UsageError(`no unit ${o.name} in ${o.file} — progress.mjs unit start ${o.name} first`);
    entry.status = o.event;
    entry.endedAt = now;
  }
  for (const [k, v] of Object.entries(o.fields || {})) entry[k] = v;
  for (const { path, value } of o.sets || []) setPath(entry, path, value);
  map[o.name] = orderEntry(entry);
  return { entry: map[o.name], resumed };
}

const text = (v) => oneLine(typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
/** The one status line: `progress <ledger> <name>: <status>[ (resumed)] kind=… pages=… blocks=… templates=… startedAt=… endedAt=… verdict=…`. */
export function formatLine(ledger, name, entry, { resumed = false } = {}) {
  const status = typeof entry.status === 'string' && entry.status ? entry.status : '-';
  const parts = [`progress ${ledger} ${name}: ${status}${resumed ? ' (resumed)' : ''}`];
  for (const k of ['kind', 'pages', 'blocks', 'templates', 'startedAt', 'endedAt', 'verdict']) {
    const v = entry[k];
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${k}=${Array.isArray(v) ? v.map(text).join(',') : text(v)}`);
  }
  return parts.join(' ');
}

function readDoc(file) {
  const raw = readFileSync(file, 'utf8');
  try { return JSON.parse(raw); } catch (e) { throw new UsageError(`${file} is not JSON (${e.message.split('\n')[0]}) — nothing written`); }
}

async function loadLock() {
  const found = FILE_LOCK.find((p) => existsSync(p));
  const lib = found ? await import(pathToFileURL(found).href) : null;
  if (!lib || typeof lib.withLock !== 'function' || typeof lib.writeJSONAtomic !== 'function') {
    throw new UsageError(`deploy's file-lock.mjs not found beside this script (${FILE_LOCK.map((p) => relative(process.cwd(), p) || p).join(' or ')}) — copy the deploy scripts first; nothing written`);
  }
  return lib;
}

// ---- main --------------------------------------------------------------------------------------
export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const o = parseArgs(argv);
  const L = LEDGERS[o.ledger];
  const file = o.file ?? L.file;

  if (o.cmd === 'show') {
    if (!existsSync(file)) {
      if (o.name) throw new UsageError(`no unit ${o.name} in ${file} (no such file)`);
      console.error(`progress: no ${file}`);
      return 0;
    }
    const doc = readDoc(file);
    checkDoc(doc, o.ledger, file);
    const map = doc[L.map] ?? {};
    if (o.name && !hasOwn(map, o.name)) throw new UsageError(`no unit ${o.name} in ${file}`);
    const names = o.name ? [o.name] : Object.keys(map).sort();
    checkDoc(doc, o.ledger, file, names);
    if (o.json) console.log(JSON.stringify(o.name ? map[o.name] : Object.fromEntries(names.map((n) => [n, map[n]]))));
    else for (const n of names) console.log(formatLine(o.ledger, n, map[n]));
    return 0;
  }

  // done / failed need an entry: an absent ledger cannot hold one, so refuse before the lock creates a directory.
  if (o.event !== 'start' && !existsSync(file)) throw new UsageError(`no unit ${o.name} in ${file} — progress.mjs unit start ${o.name} first`);
  const { withLock, writeJSONAtomic } = await loadLock();
  const result = withLock(file, () => {
    // re-read INSIDE the lock: another unit's write since this process started must survive
    const doc = existsSync(file) ? readDoc(file) : { [L.map]: {} };
    const r = applyUnit(doc, { ...o, file }, nowIso());
    writeJSONAtomic(file, doc);
    return r;
  });
  console.log(o.json ? JSON.stringify(result.entry) : formatLine(o.ledger, o.name, result.entry, result));
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exit(await main(process.argv.slice(2))); } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    console.error(`progress: ${msg}`);
    // file-lock's bounded wait ends in "lock <dir> held for over <n> ms …": a refusal, not an I/O error
    process.exit(e instanceof UsageError || /^lock .+ held for over \d+ ms/.test(msg) ? 2 : 1);
  }
}
