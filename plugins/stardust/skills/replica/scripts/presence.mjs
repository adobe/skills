#!/usr/bin/env node
/**
 * skills/replica/scripts/presence.mjs
 *
 * Writes the site-wide hide list, `stardust/replica/presence.json` — the file every gate instrument merges
 * under a gate dir's own presence.json (live-session's mergePresence: the gate dir wins per key and field).
 * In-flow per-visitor regions (a geo-IP location bar above the header, a member strip) cannot be dismissed;
 * they reach the captures and the probes only through a `hide` list. A recorded hands-off run named such a
 * region and its selector in prose, nothing wrote the selector into the file, and the gate never hid it —
 * this script is that link.
 *
 *   add   the preserve-direction step records a region it identified: the selector(s) are appended to
 *         `"*".hide` (every page) or, with --slug, to `<slug>.hide` (that page only).
 *   seed  Setup writes the runner's overlay selectors into `"*".hide`: run.json `siteOverlays` (an array of
 *         selectors) and the env STARDUST_SITE_OVERLAYS (a comma list), in that order.
 *
 * Usage:
 *   node stardust/scripts/replica/presence.mjs add --hide <sel[,sel…]> [--slug <s>] [--reason <R-nn>] [--file <f>]
 *   node stardust/scripts/replica/presence.mjs seed [--run stardust/.labs/run.json] [--file <f>]
 *
 *   --hide <sel,…>   selectors to append (repeatable; each value a comma list)
 *   --slug <s>       write `<s>.hide` instead of `"*".hide`
 *   --reason <R-nn>  the residual id (`R-<digits>`) recorded as `reasons[<sel>]` for every selector of the
 *                    call (a different earlier reason is replaced)
 *   --run <f>        the runner's run file (default stardust/.labs/run.json); a missing file seeds nothing
 *   --file <f>       the presence file (default stardust/replica/presence.json, relative to the cwd = the
 *                    project root); created with its directory when missing
 *
 * File shape (a gate dir's presence.json shape): `{ "*": { "hide": [<sel>, …], "reasons": { "<sel>":
 * "<R-nn | seeded: …>" } }, "<slug>": { "hide": […], "main": …, "variable": […] } }`. Readers ignore
 * `reasons`. The key's list is extended in order and de-duplicated with live-session's parseHideList (each
 * stored entry may be a comma list; trimmed; empty dropped); when it changes it is stored as one selector per
 * array item (a stored comma-list string is split — same selectors, same order). seed records
 * `seeded: run.json siteOverlays` or `seeded: STARDUST_SITE_OVERLAYS` (run.json first when both name a
 * selector) for the selectors it appends; a selector already in the list keeps its reason, or none. Other
 * top-level keys and the entry's other fields are left as they are; a new key or field is appended. No
 * change → the file is not rewritten. Writes are atomic (`<file>.<pid>.tmp` + rename), JSON indent 2 plus a
 * trailing newline, no timestamps — the same inputs give the same bytes. Reads nothing but the presence file,
 * the run file and STARDUST_SITE_OVERLAYS.
 *
 * Output (stdout): `<key>.hide: <sel>, <sel>` — the key's resulting list (`*.hide: …` for "*") — then
 * `wrote <file>: +<n> selector(s), <m> reason(s)` or `unchanged: <file>`; seed with no selector from either
 * source prints `nothing to seed (<run>: <not found | no siteOverlays>; STARDUST_SITE_OVERLAYS: <unset | empty>)`
 * and touches no file.
 *
 * Exit codes: 0 written, unchanged or nothing to seed; 1 a malformed input file — the presence file not JSON,
 * not an object, the touched entry not an object, its `hide` not a selector string or list, its `reasons` not
 * an object of strings; the run file not JSON, not an object, `siteOverlays` not an array of strings — named
 * on stderr with nothing written (also: a file that cannot be read or written, live-session.mjs not found);
 * 2 usage (no or unknown command, unknown flag, a flag without a value, add without a selector, --reason not
 * `R-<digits>`).
 *
 * Requires the diff skill's live-session.mjs (parseHideList) in one of two layouts — the plugin tree
 * (../../diff/scripts/) or the project copy (stardust/scripts/diff/ beside stardust/scripts/replica/; replica
 * SKILL.md § Setup copies both). It is imported after --help, so --help needs neither it nor any file.
 */

/* eslint-disable import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_FILE = 'stardust/replica/presence.json';
export const DEFAULT_RUN = 'stardust/.labs/run.json';
export const ENV_OVERLAYS = 'STARDUST_SITE_OVERLAYS';
export const SEED_REASON = Object.freeze({ run: 'seeded: run.json siteOverlays', env: 'seeded: STARDUST_SITE_OVERLAYS' });
export const REASON_RE = /^R-\d+$/;

const HELP = `presence.mjs — write the site-wide hide list (${DEFAULT_FILE}) every gate instrument merges under a gate dir's presence.json

Usage:
  node stardust/scripts/replica/presence.mjs add --hide <sel[,sel…]> [--slug <s>] [--reason <R-nn>] [--file <f>]
  node stardust/scripts/replica/presence.mjs seed [--run ${DEFAULT_RUN}] [--file <f>]

  add    append in-flow per-visitor region selectors (a location bar above the header) to "*".hide, or to
         <slug>.hide with --slug — the preserve-direction step records a region it identified
  seed   append the runner's overlay selectors to "*".hide: run.json siteOverlays (array of selectors), then
         the env ${ENV_OVERLAYS} (comma list) — run at Setup
  --hide <sel,…>   selectors to append (repeatable; comma lists)
  --slug <s>       write <s>.hide instead of "*".hide
  --reason <R-nn>  residual id (R-<digits>) recorded as reasons[<sel>] for every selector of the call
  --run <f>        the run file (default ${DEFAULT_RUN}); missing = nothing from it
  --file <f>       the presence file (default ${DEFAULT_FILE}, relative to the project root = cwd)
  --help           this text (reads and writes nothing)

Writes: the key's hide list extended in order, de-duplicated (live-session parseHideList), stored one selector per
item; reasons in the entry's "reasons" map (seed: "${SEED_REASON.run}" / "${SEED_REASON.env}" for the
selectors it appends); other keys and fields untouched; atomic (tmp + rename), indent 2 + newline, deterministic.
No change → the file is not rewritten.

Output: "<key>.hide: <sel>, <sel>" (the key's resulting list; "*.hide: …"), then "wrote <file>: +<n> selector(s),
<m> reason(s)" or "unchanged: <file>"; seed with nothing from either source: "nothing to seed (…)", no file touched.

Exit codes: 0 written / unchanged / nothing to seed; 1 malformed input file (presence file or run file — named,
nothing written), a file that cannot be read or written, or live-session.mjs not found; 2 usage error.`;

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }
export class InputError extends Error { constructor(msg) { super(msg); this.code = 1; } }

// live-session.mjs lives in the diff skill's scripts dir: the plugin tree (../../diff/scripts/) or the project copy
// (stardust/scripts/diff/ beside stardust/scripts/replica/).
async function loadLiveSession() {
  const found = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new InputError('presence: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

const FLAGS = { add: ['--hide', '--slug', '--reason', '--file'], seed: ['--run', '--file'] };

/** argv after the script path → { cmd, hide: [values], slug, reason, file, run }; throws UsageError. --help is answered before this. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError('presence: a command is required — add or seed (see --help)');
  if (!Object.hasOwn(FLAGS, cmd)) throw new UsageError(`presence: unknown command "${cmd}" — add or seed (see --help)`);
  const o = { cmd, hide: [], slug: null, reason: null, file: DEFAULT_FILE, run: DEFAULT_RUN };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!FLAGS[cmd].includes(a)) throw new UsageError(`presence: unknown argument ${a} for ${cmd} (see --help)`);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`presence: ${a} needs a value (see --help)`);
    i += 1;
    if (a === '--hide') o.hide.push(v);
    else if (a === '--slug') o.slug = v.trim();
    else if (a === '--reason') o.reason = v.trim();
    else if (a === '--file') o.file = v;
    else if (a === '--run') o.run = v;
  }
  if (cmd === 'add' && !o.hide.length) throw new UsageError('presence: add needs --hide <sel[,sel…]> (see --help)');
  if (o.slug === '') throw new UsageError('presence: --slug needs a page slug (see --help)');
  if (o.reason !== null && !REASON_RE.test(o.reason)) throw new UsageError(`presence: --reason must be a residual id R-<digits> (got "${o.reason}")`);
  if (!o.file.trim()) throw new UsageError('presence: --file needs a path (see --help)');
  if (!o.run.trim()) throw new UsageError('presence: --run needs a path (see --help)');
  return o;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);
const malformed = (file, why) => new InputError(`presence: ${file} is malformed (${why}) — nothing written`);

/** A JSON file → { found, json }; a missing file → found: false. Unreadable / not JSON / not an object → InputError naming it. */
function readJsonObject(file) {
  if (!existsSync(file)) return { found: false, json: {} };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new InputError(`presence: ${file} cannot be read (${e.code || e.message}) — nothing written`); }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw malformed(file, String(e.message).split('\n')[0]); }
  if (!isPlainObject(json)) throw malformed(file, 'the top level must be a JSON object');
  return { found: true, json };
}

/** Checks the entry this run touches: an object whose `hide` is a selector string or a list of them and whose
 * `reasons` is an object of strings (each may be absent; `hide: null` reads as absent). Throws InputError. */
export function checkEntry(json, key, file) {
  const entry = own(json, key);
  if (entry === undefined) return;
  if (!isPlainObject(entry)) throw malformed(file, `"${key}" must be an object`);
  const { hide, reasons } = entry;
  if (hide != null && typeof hide !== 'string' && !(Array.isArray(hide) && hide.every((s) => typeof s === 'string'))) throw malformed(file, `"${key}".hide must be a selector string or a list of selector strings`);
  if (reasons !== undefined && !(isPlainObject(reasons) && Object.values(reasons).every((r) => typeof r === 'string'))) throw malformed(file, `"${key}".reasons must be an object of strings`);
}

/**
 * Pure: append `selectors` to `json[key].hide` → { json, list, added, reasonChanges, changed }. `parse` is
 * live-session's parseHideList. `reasonOf(sel)` → the reason to record (or null) for each selector of the call,
 * replacing a different recorded one; `onlyAdded` restricts it to the selectors this call appends (seed), so a
 * selector already in the list keeps its reason. With no
 * change the input object is returned as is; otherwise a new object (the input is not mutated) whose key and field
 * order follow the input, a new key or field appended.
 */
export function applyHide(json, key, selectors, { parse, reasonOf = null, onlyAdded = false }) {
  const entry = own(json, key) || {};
  const before = parse(entry.hide);
  const list = parse(entry.hide, selectors);
  const added = list.filter((sel) => !before.includes(sel));
  const reasons = { ...(isPlainObject(entry.reasons) ? entry.reasons : {}) };
  let reasonChanges = 0;
  if (reasonOf) {
    for (const sel of parse(selectors)) {
      const r = reasonOf(sel);
      if (!r || (onlyAdded && !added.includes(sel))) continue;
      if (own(reasons, sel) !== r) { reasons[sel] = r; reasonChanges += 1; }
    }
  }
  if (!added.length && !reasonChanges) return { json, list, added, reasonChanges, changed: false };
  const next = { ...entry, hide: list };
  if (Object.keys(reasons).length) next.reasons = reasons;
  return { json: { ...json, [key]: next }, list, added, reasonChanges, changed: true };
}

/** Pure: the seed selectors → { selectors, reasonOf } — run.json `siteOverlays` first, then the env comma list,
 * de-duplicated; a selector named by both carries the run.json reason. */
export function seedSelectors(siteOverlays, envValue, parse) {
  const fromRun = parse(siteOverlays);
  const selectors = parse(fromRun, envValue);
  return { selectors, reasonOf: (sel) => (fromRun.includes(sel) ? SEED_REASON.run : SEED_REASON.env) };
}

/** The run file's `siteOverlays` → { found, overlays }; a missing file or key → []. Malformed → InputError naming it. */
function readRun(file) {
  const { found, json } = readJsonObject(file);
  const so = own(json, 'siteOverlays');
  if (so == null) return { found, overlays: [] };
  if (!Array.isArray(so) || !so.every((s) => typeof s === 'string')) throw malformed(file, 'siteOverlays must be an array of selector strings');
  return { found, overlays: so };
}

function writeAtomic(file, json) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(resolvePath(file)), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new InputError(`presence: cannot write ${file} (${e.code || e.message})`);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The CLI: argv after the script path → exit code; lines go to `log`. */
export async function main(argv, { env = process.env, log = console.log } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const o = parseArgs(argv);
  const { parseHideList } = await loadLiveSession();
  const key = o.cmd === 'add' && o.slug ? o.slug : '*';
  let selectors; let reasonOf = null; let onlyAdded = false;
  if (o.cmd === 'add') {
    selectors = parseHideList(o.hide);
    if (!selectors.length) throw new UsageError('presence: --hide names no selector (see --help)');
    if (o.reason) reasonOf = () => o.reason;
  } else {
    const run = readRun(o.run);
    const raw = env[ENV_OVERLAYS];
    const seed = seedSelectors(run.overlays, raw, parseHideList);
    ({ selectors, reasonOf } = seed);
    onlyAdded = true;
    if (!selectors.length) {
      // the presence file is still checked: a malformed one fails here, not at the first gate round
      checkEntry(readJsonObject(o.file).json, key, o.file);
      log(`nothing to seed (${o.run}: ${run.found ? 'no siteOverlays' : 'not found'}; ${ENV_OVERLAYS}: ${raw === undefined ? 'unset' : 'empty'})`);
      return 0;
    }
  }
  const current = readJsonObject(o.file).json;
  checkEntry(current, key, o.file);
  const r = applyHide(current, key, selectors, { parse: parseHideList, reasonOf, onlyAdded });
  log(`${key}.hide: ${r.list.join(', ')}`);
  if (!r.changed) { log(`unchanged: ${o.file}`); return 0; }
  writeAtomic(o.file, r.json);
  log(`wrote ${o.file}: +${plural(r.added.length, 'selector')}, ${plural(r.reasonChanges, 'reason')}`);
  return 0;
}

// Compare by real path: a symlinked checkout or scratch dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(e instanceof UsageError || e instanceof InputError ? e.message : `presence: ${e.stack || e.message}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
