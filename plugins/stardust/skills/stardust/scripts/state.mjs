#!/usr/bin/env node
// skills/stardust/scripts/state.mjs — deterministic page-status writer for `stardust/state.json`
// (contract: skills/stardust/reference/state-machine.md; file layout and provenance shape:
// skills/stardust/reference/artifact-map.md). Replaces the node -e one-shots agents used to
// hand-edit page entries with: one command that enforces the lifecycle, appends the history
// entry, clears `stale` where the contract says so and re-stamps `_provenance`.
//
//   node state.mjs advance <slug…> --to <status> [--by <who>] [--prototype <path>] [--migrated <path>]
//                  [--skill <name>] [--force | --history-only] [--dir <stardust dir>]
//   node state.mjs summary [--slugs] [--dir <stardust dir>]
//
// Lifecycle (state-machine.md § Page lifecycle states): extracted → directed → prototyped →
// approved → migrated. Forward moves are legal, including jumps (a `directed` page can be migrated
// from an approved sibling's template, migrate Path A′). A move to the page's current status is a
// re-entry (re-prototype, re-approve, re-migrate) and appends a fresh history entry. Backward moves
// break the linearity rule ("a page never moves backward") and exit 2 unless --force.
// --history-only appends the { status, at } entry WITHOUT changing `status` — state-machine.md
// § Linearity rule: "re-running prototype after approved does not demote — it produces a new
// prototype with a new history entry, and the user must re-approve". Forward/backward rules do not
// apply to it; --prototype / --migrated still set their paths; stale is left as it is (the status
// did not move). A value flag (--to, --by, --prototype, --migrated, --skill, --dir) followed by
// nothing or by another --flag is a usage error naming the flag.
// Top-level key order on write (state-machine.md § File): _provenance, site, direction, handsOff,
// flow, flowChosenAt, flowSource, pages; a key this script does not know keeps its place relative
// to the known keys around it (never pushed behind pages).
// Exit codes: 0 ok · 2 usage, unknown slug, or illegal transition (nothing written in every 2 case).
import { existsSync, readFileSync, renameSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = 'stardust';
export const FILE_NAME = 'state.json';
export const ORDER = ['extracted', 'directed', 'prototyped', 'approved', 'migrated'];
// state-machine.md § Page lifecycle states, column "Set by" — the writer stamped in _provenance
// when --skill is not given.
export const SET_BY = { extracted: 'extract', directed: 'direct', prototyped: 'prototype', approved: 'prototype', migrated: 'migrate' };
// Statuses whose (re-)entry clears `stale`: state-machine.md § Stale flagging ("when a stale page
// is successfully re-prototyped or re-migrated, clear its stale flag") and prototype SKILL.md
// Phase 5 step 4 ("clear any stale flag on the page" at approval).
export const CLEARS_STALE = new Set(['prototyped', 'approved', 'migrated']);
// state-machine.md § File: top-level keys "always in that order"; handsOff sits after direction, the
// 0.23.0 flow keys (§ Flow keys) between it and pages.
export const TOP_ORDER = ['_provenance', 'site', 'direction', 'handsOff', 'flow', 'flowChosenAt', 'flowSource', 'pages'];

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PLUGIN_MANIFEST = join(HERE, '..', '..', '..', '.claude-plugin', 'plugin.json');
const HELP = `Usage:
  node state.mjs advance <slug…> --to <${ORDER.join('|')}> [--by <who>] [--prototype <path>]
                 [--migrated <path>] [--skill <name>] [--force | --history-only] [--dir <d>]
  node state.mjs summary [--slugs] [--dir <d>]
  (--dir defaults to ${DEFAULT_DIR}; the file is <dir>/${FILE_NAME} and must already exist)

advance  moves every named page to <status>: appends { status, at[, approvedBy] } to its history,
         sets prototypePath / migratedPath when given, clears stale on prototyped|approved|migrated,
         re-stamps _provenance (writtenBy stardust:<skill>, writtenAt, stardustVersion).
         --by is only valid with --to approved (it becomes approvedBy, e.g. "hands-off").
         Backward moves exit 2 unless --force. All-or-nothing: one bad slug, nothing is written.
         --history-only appends the history entry and leaves status untouched (re-running prototype
         after approved does not demote — state-machine.md § Linearity rule); no direction check,
         stale untouched, paths still set. Not combinable with --force.
         A value flag followed by nothing or by another --flag is a usage error.
summary  prints page counts by status (and the slugs per status with --slugs).
Writes: advance rewrites <dir>/${FILE_NAME} in place (atomic temp file + rename); summary writes nothing.
Exit codes: 0 ok, 2 usage / illegal transition.`;

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

// ---- helpers (exported for tests) --------------------------------------------------------------
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const statePath = (dir) => join(dir, FILE_NAME);

export function normaliseSkill(raw) {
  const name = String(raw || '').trim().replace(/^stardust:/i, '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new UsageError(`skill "${raw}" is not a skill name`);
  return `stardust:${name}`;
}

export function pluginVersion() {
  try { return JSON.parse(readFileSync(PLUGIN_MANIFEST, 'utf8')).version || null; } catch { return null; }
}

export function readState(dir) {
  const file = statePath(dir);
  if (!existsSync(file)) throw new UsageError(`${file} does not exist — extract creates it; advance only moves pages that are already in it`);
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError(`${file} is not valid JSON (${e.message})`); }
  if (!state || typeof state !== 'object' || !Array.isArray(state.pages)) throw new UsageError(`${file} has no pages[] array`);
  return { state, file };
}

// Classifies one move. Returns { kind: 'forward' | 'reentry' | 'backward' | 'unknown-from' }.
export function classify(from, to) {
  const f = ORDER.indexOf(from); const t = ORDER.indexOf(to);
  if (t < 0) throw new UsageError(`--to must be one of ${ORDER.join('|')}, got "${to}"`);
  if (f < 0) return 'unknown-from';
  if (t > f) return 'forward';
  if (t === f) return 'reentry';
  return 'backward';
}

// Re-stamps the provenance block, keeping any extra keys it already carried (readArtifacts,
// synthesizedInputs, …) in place; the schema for state.json lists writtenBy, writtenAt and
// stardustVersion only, so nothing else is added.
export function stampProvenance(prev, writtenBy, at = nowIso()) {
  const { writtenBy: _w, writtenAt: _a, stardustVersion, ...rest } = prev && typeof prev === 'object' ? prev : {};
  const version = pluginVersion() || stardustVersion;
  return { writtenBy, writtenAt: at, ...rest, ...(version ? { stardustVersion: version } : {}) };
}

// Known keys in TOP_ORDER; an unknown key keeps its place relative to the known keys: it follows the
// highest-ranked known key that preceded it in the file (or leads when none did) — so a `reskin` or
// `migrate` block between direction and pages stays there, and a trailing block stays trailing.
export function orderTopLevel(state) {
  const rank = (k) => TOP_ORDER.indexOf(k);
  const after = new Map([[null, []]]);
  let anchor = null;
  for (const k of Object.keys(state)) {
    if (rank(k) >= 0) { if (anchor === null || rank(k) > rank(anchor)) anchor = k; if (!after.has(k)) after.set(k, []); } else after.get(anchor).push(k);
  }
  const out = {};
  for (const k of after.get(null)) out[k] = state[k];
  for (const k of TOP_ORDER) {
    if (!(k in state)) continue;
    out[k] = state[k];
    for (const u of after.get(k) || []) out[u] = state[u];
  }
  return out;
}

export function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(orderTopLevel(state), null, 2)}\n`);
  renameSync(tmp, file);
}

// Applies the transition to every slug in memory; throws before touching anything when a slug is
// unknown or a move is illegal. Returns the per-page summaries.
export function advance(state, slugs, { to, by = null, prototype = null, migrated = null, force = false, historyOnly = false, at = nowIso() }) {
  if (!slugs.length) throw new UsageError('advance needs at least one <slug>');
  if (by && to !== 'approved') throw new UsageError('--by only applies to --to approved (it is recorded as approvedBy on the approved history entry)');
  if (historyOnly && force) throw new UsageError('--history-only does not move the page, so --force has nothing to override — pass one of them');
  const bySlug = new Map(state.pages.map((p) => [p.slug, p]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length) throw new UsageError(`unknown slug(s): ${missing.join(', ')} — ${state.pages.length} page(s) in state.json; advance moves existing entries only`);
  const plan = slugs.map((slug) => { const page = bySlug.get(slug); return { slug, page, from: page.status, kind: historyOnly ? 'history-only' : classify(page.status, to) }; });
  if (historyOnly) {
    if (!ORDER.includes(to)) throw new UsageError(`--to must be one of ${ORDER.join('|')}, got "${to}"`);
    for (const m of plan) {
      const entry = { status: to, at };
      if (by) entry.approvedBy = by;
      if (!Array.isArray(m.page.history)) m.page.history = [];
      m.page.history.push(entry);
      if (prototype) m.page.prototypePath = prototype;
      if (migrated) m.page.migratedPath = migrated;
    }
    return { plan, cleared: [] };
  }
  const bad = plan.filter((m) => m.kind === 'backward' || m.kind === 'unknown-from');
  if (bad.length && !force) {
    throw new UsageError(bad.map((m) => (m.kind === 'backward'
      ? `${m.slug}: ${m.from} → ${to} moves backward; a page never moves backward (state-machine.md § Linearity rule). Re-run the producing phase to append a fresh entry at its current status, or pass --force to override.`
      : `${m.slug}: current status "${m.from}" is not in the lifecycle (${ORDER.join(' → ')}); pass --force to move it to ${to}.`)).join('\n'));
  }
  const cleared = [];
  for (const m of plan) {
    const entry = { status: to, at };
    if (by) entry.approvedBy = by;
    m.page.status = to;
    if (!Array.isArray(m.page.history)) m.page.history = [];
    m.page.history.push(entry);
    if (prototype) m.page.prototypePath = prototype;
    if (migrated) m.page.migratedPath = migrated;
    if (CLEARS_STALE.has(to) && m.page.stale) { m.page.stale = false; m.page.staleReason = null; cleared.push(m.slug); }
  }
  return { plan, cleared };
}

export function summarise(state) {
  const counts = Object.fromEntries(ORDER.map((s) => [s, []]));
  const other = {};
  const stale = [];
  for (const p of state.pages) {
    (counts[p.status] || (other[p.status] = other[p.status] || [])).push(p.slug);
    if (p.stale) stale.push(p.slug);
  }
  return { total: state.pages.length, counts, other, stale };
}

// ---- argv --------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, force: false, historyOnly: false, slugs: false, to: null, by: null, prototype: null, migrated: null, skill: null };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // A value flag never swallows the next flag: `--to --force` is a forgotten status, not the status "--force".
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      if (argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value (got ${argv[i + 1]}, which is a flag)`);
      i += 1; return argv[i];
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--history-only') opts.historyOnly = true;
    else if (a === '--slugs') opts.slugs = true;
    else if (a === '--dir') opts.dir = need();
    else if (a === '--to') opts.to = need();
    else if (a === '--by') opts.by = need();
    else if (a === '--prototype') opts.prototype = need();
    else if (a === '--migrated') opts.migrated = need();
    else if (a === '--skill') opts.skill = need();
    else if (a === '--gate' || a === '--note') throw new UsageError(`${a} is not accepted: a state.json history entry carries status, at and approvedBy only (state-machine.md § File). Gate evidence belongs in the producing skill's own ledger; free-text notes belong in stardust/journal.md.`);
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  return { opts, pos };
}

// ---- main --------------------------------------------------------------------------------------
export function main(argv) {
  const { opts, pos } = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  const [cmd, ...rest] = pos;
  if (!cmd) throw new UsageError(HELP);

  if (cmd === 'summary') {
    const { state } = readState(opts.dir);
    const s = summarise(state);
    const parts = ORDER.map((k) => `${k} ${s.counts[k].length}`);
    for (const [k, v] of Object.entries(s.other)) parts.push(`other(${k}) ${v.length}`);
    parts.push(`stale ${s.stale.length}`);
    console.log(`${s.total} page(s) · ${parts.join(' · ')}`);
    if (opts.slugs) {
      const rows = [...ORDER.map((k) => [k, s.counts[k]]), ...Object.entries(s.other).map(([k, v]) => [`other(${k})`, v])].filter(([, v]) => v.length);
      for (const [k, v] of rows) console.log(`  ${k.padEnd(11)} ${String(v.length).padStart(3)}  ${v.join(', ')}`);
      if (s.stale.length) console.log(`  ${'stale'.padEnd(11)} ${String(s.stale.length).padStart(3)}  ${s.stale.join(', ')}`);
    }
    return 0;
  }

  if (cmd === 'advance') {
    if (!opts.to) throw new UsageError('advance needs --to <status>');
    if (!ORDER.includes(opts.to)) throw new UsageError(`--to must be one of ${ORDER.join('|')}, got "${opts.to}"`);
    const { state, file } = readState(opts.dir);
    const at = nowIso();
    const { plan, cleared } = advance(state, rest, { to: opts.to, by: opts.by, prototype: opts.prototype, migrated: opts.migrated, force: opts.force, historyOnly: opts.historyOnly, at });
    const writtenBy = normaliseSkill(opts.skill || SET_BY[opts.to]);
    state._provenance = stampProvenance(state._provenance, writtenBy, at);
    writeState(file, state);
    const moves = plan.map((m) => (m.kind === 'history-only' ? `${m.slug} (stays ${m.from}, ${opts.to} entry appended)` : `${m.slug} (${m.from}→${opts.to}${m.kind === 'reentry' ? ', again' : m.kind === 'forward' ? '' : ', forced'})`)).join(', ');
    const extras = [opts.by ? `approvedBy ${opts.by}` : null, opts.prototype ? `prototypePath set` : null, opts.migrated ? `migratedPath set` : null, cleared.length ? `stale cleared: ${cleared.join(', ')}` : null].filter(Boolean);
    console.log(`state: ${plan.length} page(s) ${opts.historyOnly ? 'history +=' : '→'} ${opts.to}: ${moves}${extras.length ? ` · ${extras.join(' · ')}` : ''} · written by ${writtenBy}`);
    return 0;
  }

  throw new UsageError(`unknown command "${cmd}"\n${HELP}`);
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof UsageError) { console.error(`state: ${e.message}`); process.exit(e.code); }
    console.error(`state: ${e.message}`); process.exit(1);
  }
}
