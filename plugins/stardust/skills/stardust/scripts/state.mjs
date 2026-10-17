#!/usr/bin/env node
// skills/stardust/scripts/state.mjs — deterministic writer for `stardust/state.json`
// (contract: skills/stardust/reference/state-machine.md; file layout and provenance shape:
// skills/stardust/reference/artifact-map.md). Replaces the hand-built state.json and the node -e
// one-shots agents used to hand-edit page entries with: one command that creates the file from the
// crawl's page records, one that enforces the lifecycle (appends the history entry, clears `stale`
// where the contract says so) and one that sets a page's type / representative — each re-stamps
// `_provenance`.
//
//   node state.mjs init --pages <file|-> [--types <slug=type,…>] [--site-url <url>] [--force]
//                  [--dir <stardust dir>] [--current <dir>]
//   node state.mjs advance <slug…> --to <status> [--by <who>] [--prototype <path>] [--migrated <path>]
//                  [--skill <name>] [--force | --history-only] [--dir <stardust dir>]
//   node state.mjs set <slug…> (--representative <archetype-slug> | --type <type>) [--skill <name>]
//                  [--dir <stardust dir>]
//   node state.mjs summary [--slugs] [--dir <stardust dir>]
//
// init (after the crawl): one page per listed URL, in input order, every one `extracted`. A URL is
// matched to its crawl record through an index of every <current>/pages/*.json record (url, then
// finalUrl; origin + path without trailing slash + query, `www.` folded) — so the crawl's collision
// suffixes (-<hash4>) are honoured; a URL with no record falls back to the crawl's slug rule, which
// names the missing file in the refusal. Every page record must pass validateProvenance (live-render
// evidence, state-machine.md § validateProvenance(page)) or nothing is written. A state.json with
// no pages (no `pages` key or an empty pages[] — flow / handsOff stamped before extract ran) is
// filled without --force, its other top-level keys kept in place. One with pages is refused;
// --force re-inits only while every page in it is still `extracted` and keeps its top-level keys
// other than _provenance, site and pages in place. Invalid JSON or a non-array `pages` is refused.
// set: page.type / page.representative (the archetype slug a sibling clones), all-or-nothing.
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
// summary prints, when any page has a representative, one line per archetype (sorted by slug).
// Exit codes: 0 ok · 2 usage, unknown slug, illegal transition, or an init / set refusal (nothing
// written in every 2 case).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
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
// A page type (init --types, set --type).
export const TYPE_RE = /^[a-z][a-z0-9-]*$/;
// state-machine.md § validateProvenance(page) — contract; `slow` is listed because
// `crawl.mjs --wait slow` writes it.
export const WAIT_MODE_RE = /^(fast|medium|slow|spec|networkidle|domcontentloaded)(\(fallback\))?$/;
// fetchedAt may lead the reader's clock by at most this much (clock skew between machines).
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
// Flags only init / set read; advance and summary keep refusing them as unknown options.
const NEW_FLAGS = ['--pages', '--types', '--site-url', '--current', '--representative', '--type'];
const FLAGS_FOR = {
  init: ['--pages', '--types', '--site-url', '--current', '--force', '--dir'],
  set: ['--representative', '--type', '--skill', '--dir'],
};

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PLUGIN_MANIFEST = join(HERE, '..', '..', '..', '.claude-plugin', 'plugin.json');
const HELP = `Usage:
  node state.mjs init --pages <file|-> [--types <slug=type,…>] [--site-url <url>] [--force]
                 [--dir <d>] [--current <dir>]
  node state.mjs advance <slug…> --to <${ORDER.join('|')}> [--by <who>] [--prototype <path>]
                 [--migrated <path>] [--skill <name>] [--force | --history-only] [--dir <d>]
  node state.mjs set <slug…> (--representative <archetype-slug> | --type <type>) [--skill <name>] [--dir <d>]
  node state.mjs summary [--slugs] [--dir <d>]
  (--dir defaults to ${DEFAULT_DIR}; the file is <dir>/${FILE_NAME}. init creates it; advance, set and
  summary need it to exist. --current defaults to <dir>/current, the crawl's --out.)

init     creates <dir>/${FILE_NAME} after the crawl, one page per URL in --pages, in input order.
         --pages: a file (or - for stdin) with one URL per line (blank lines and # lines ignored)
         or a JSON array of URL strings. A path-only line (/de/x) resolves against --site-url;
         without --site-url it is a usage error naming the line.
         Each URL is looked up in an index of every <current>/pages/*.json record (url, then
         finalUrl; origin + path without trailing slash + query, www. folded), so the crawl's
         collision suffixes are kept; a URL with no record gets the crawl's slug rule.
         Every page record must exist and pass validateProvenance — renderedBy "playwright",
         fetchedAt ISO 8601 and at most 5 min in the future, waitMs an integer > 0, waitMode
         fast|medium|slow|spec|networkidle|domcontentloaded[(fallback)], httpStatus an integer in
         [200, 399] — else exit 2, nothing written, one line per failing page naming the slug, the
         condition and the file. --types home=landing,about=article sets page.type (type
         ${TYPE_RE.source}; a slug not in the input is a usage error); other pages get type null.
         Writes _provenance (writtenBy stardust:extract), site { originUrl (origin of --site-url,
         else of the first URL), deployUrl null, extractedAt, crawled, captureGaps (the roots of
         <current>/_crawl-log.json#captureGaps, when it lists any) } and pages[] (status extracted,
         one history entry, currentStatePath <current>/pages/<slug>.json). Duplicate slugs in the
         input are a usage error. An existing ${FILE_NAME} with no pages (no pages key or an empty
         pages[], e.g. flow / handsOff stamped before extract) is filled without --force: its other
         top-level keys stay in place and stdout adds "· kept <keys>". One with pages exits 2;
         --force re-inits it only while every page in it is still extracted, keeping its top-level
         keys other than _provenance, site and pages in place. Invalid JSON or a non-array pages
         exits 2.
advance  moves every named page to <status>: appends { status, at[, approvedBy] } to its history,
         sets prototypePath / migratedPath when given, clears stale on prototyped|approved|migrated,
         re-stamps _provenance (writtenBy stardust:<skill>, writtenAt, stardustVersion).
         --by is only valid with --to approved (it becomes approvedBy, e.g. "hands-off").
         Backward moves exit 2 unless --force. All-or-nothing: one bad slug, nothing is written.
         --history-only appends the history entry and leaves status untouched (re-running prototype
         after approved does not demote — state-machine.md § Linearity rule); no direction check,
         stale untouched, paths still set. Not combinable with --force.
set      sets page.representative (the archetype slug the named pages clone) and/or page.type on
         every named page; at least one of the two. Re-stamps _provenance (writtenBy
         stardust:direct unless --skill). All-or-nothing: an unknown slug, an unknown
         representative or a page named as its own representative exits 2, nothing written.
summary  prints page counts by status, then one line per archetype when any page has a
         representative ("  representative <archetype> <n>  <slug, …>", sorted by archetype),
         then the slugs per status with --slugs.
A value flag followed by nothing or by another --flag is a usage error; so is a flag init or set
does not read.
Writes: init writes <dir>/${FILE_NAME}; advance and set rewrite it in place (atomic temp file +
rename); summary writes nothing.
Exit codes: 0 ok, 2 usage / illegal transition / refusal (init: ${FILE_NAME} holds pages or does not
parse, a page record is missing or lacks live-render evidence; set: unknown slug or
representative) — nothing written.`;

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
  if (!existsSync(file)) throw new UsageError(`${file} does not exist — create it with \`state.mjs init --pages <urls>\` after the crawl; advance and set only change pages that are already in it`);
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
  const representatives = {};
  for (const p of state.pages) {
    (counts[p.status] || (other[p.status] = other[p.status] || [])).push(p.slug);
    if (p.stale) stale.push(p.slug);
    if (p.representative) (representatives[p.representative] ||= []).push(p.slug);
  }
  return { total: state.pages.length, counts, other, stale, representatives };
}

// ---- set ---------------------------------------------------------------------------------------
// Sets `key` on `obj`: in place when present (or when `after` is absent, appended); otherwise
// returns a copy with `key` right after `after`.
function withKey(obj, key, value, after) {
  if (key in obj || !(after in obj)) { obj[key] = value; return obj; }
  const out = {};
  for (const [k, v] of Object.entries(obj)) { out[k] = v; if (k === after) out[key] = value; }
  return out;
}

// Sets page.type and/or page.representative on every slug in memory; throws before touching
// anything when a slug or the representative is unknown, or a page would represent itself.
// Returns the (de-duplicated) slugs set.
export function setPages(state, slugs, { representative = null, type = null } = {}) {
  if (!slugs.length) throw new UsageError('set needs at least one <slug>');
  if (representative === null && type === null) throw new UsageError('set needs --representative <archetype-slug> and/or --type <type>');
  if (type !== null && !TYPE_RE.test(type)) throw new UsageError(`--type "${type}" is not a page type (${TYPE_RE.source})`);
  const unique = [...new Set(slugs)];
  const bySlug = new Map(state.pages.map((p) => [p.slug, p]));
  const missing = unique.filter((s) => !bySlug.has(s));
  if (missing.length) throw new UsageError(`unknown slug(s): ${missing.join(', ')} — ${state.pages.length} page(s) in state.json; set changes existing entries only`);
  if (representative !== null) {
    if (!bySlug.has(representative)) throw new UsageError(`unknown representative "${representative}" — it must be a page in state.json (the archetype the named pages clone)`);
    if (unique.includes(representative)) throw new UsageError(`${representative} cannot be its own representative — name the archetype's siblings, not the archetype`);
  }
  state.pages = state.pages.map((p) => {
    if (!unique.includes(p.slug)) return p;
    let next = p;
    if (type !== null) next = withKey(next, 'type', type, 'title');
    if (representative !== null) next = withKey(next, 'representative', representative, 'type');
    return next;
  });
  return unique;
}

// ---- init --------------------------------------------------------------------------------------
// The crawl's slug rule (extract/scripts/crawl.mjs `slugify`): pathname, one leading and one
// trailing `/` stripped, runs of non-alphanumerics → `-`, lowercased, empty → `index`.
export function crawlSlug(href) {
  const { pathname } = new URL(href);
  return pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'index';
}

// URL identity for the record index: origin (host `www.` folded) + path without trailing slash +
// query; the fragment is dropped.
export function urlKey(href) {
  const u = new URL(href);
  return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

const isHttp = (u) => u.protocol === 'http:' || u.protocol === 'https:';

export function parseSiteUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new UsageError(`--site-url "${raw}" is not an absolute URL`); }
  if (!isHttp(u)) throw new UsageError(`--site-url "${raw}" is not an http(s) URL`);
  return u;
}

// Parses the --pages input: a JSON array of URL strings, or one URL per line (blank lines and
// `#` lines ignored). A path-only entry resolves against `siteUrl`. Returns [{ url, where }].
export function parsePageList(text, { siteUrl = null } = {}) {
  const src = String(text);
  let items;
  if (src.trim().startsWith('[')) {
    let arr;
    try { arr = JSON.parse(src); } catch (e) { throw new UsageError(`--pages input looks like a JSON array but does not parse (${e.message})`); }
    if (!Array.isArray(arr)) throw new UsageError('--pages JSON input must be an array of URL strings');
    items = arr.map((v, i) => {
      if (typeof v !== 'string') throw new UsageError(`--pages entry ${i + 1} is not a string (${JSON.stringify(v)})`);
      return { raw: v.trim(), where: `entry ${i + 1}` };
    });
  } else {
    items = src.split(/\r?\n/).map((l, i) => ({ raw: l.trim(), where: `line ${i + 1}` })).filter((x) => x.raw && !x.raw.startsWith('#'));
  }
  const out = items.map(({ raw, where }) => {
    if (!raw) throw new UsageError(`--pages ${where} is empty`);
    if (raw.startsWith('/') && !raw.startsWith('//')) {
      if (!siteUrl) throw new UsageError(`--pages ${where} "${raw}" is a path; pass --site-url <url> to resolve it`);
      return { url: new URL(raw, siteUrl).href, where };
    }
    let u;
    try { u = new URL(raw); } catch { throw new UsageError(`--pages ${where} "${raw}" is not an absolute URL or a /path`); }
    if (!isHttp(u)) throw new UsageError(`--pages ${where} "${raw}" is not an http(s) URL`);
    return { url: u.href, where };
  });
  if (!out.length) throw new UsageError('--pages lists no URL');
  return out;
}

// Parses --types "slug=type,slug=type" into a Map; every slug must be one of `slugs`.
export function parseTypes(raw, slugs) {
  const types = new Map();
  if (raw === null || raw === undefined) return types;
  for (const pair of String(raw).split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--types "${pair}" is not slug=type`);
    const slug = pair.slice(0, eq).trim(); const type = pair.slice(eq + 1).trim();
    if (!TYPE_RE.test(type)) throw new UsageError(`--types ${slug}: "${type}" is not a page type (${TYPE_RE.source})`);
    if (types.has(slug) && types.get(slug) !== type) throw new UsageError(`--types names ${slug} twice (${types.get(slug)}, ${type})`);
    if (!slugs.includes(slug)) throw new UsageError(`--types names "${slug}", which is not among the input pages (${slugs.join(', ')})`);
    types.set(slug, type);
  }
  return types;
}

function readJson(file) {
  try { return { value: JSON.parse(readFileSync(file, 'utf8')) }; } catch (e) { return { error: e.message }; }
}

// Index of every <pagesDir>/*.json record: Map(urlKey → slug), url keys first, then finalUrl keys
// that no url claimed; files in name order, the first claimant keeps a key. `records` caches the
// parsed files by slug (the file name).
export function indexPageRecords(pagesDir) {
  const byKey = new Map();
  const records = new Map();
  let names = [];
  try { names = readdirSync(pagesDir).filter((n) => n.endsWith('.json')).sort(); } catch { /* no pages dir: empty index */ }
  for (const n of names) {
    const r = readJson(join(pagesDir, n));
    if (r.value && typeof r.value === 'object' && !Array.isArray(r.value)) records.set(n.slice(0, -'.json'.length), r.value);
  }
  for (const field of ['url', 'finalUrl']) {
    for (const [slug, rec] of records) {
      let key;
      try { key = urlKey(rec[field]); } catch { continue; }
      if (!byKey.has(key)) byKey.set(key, slug);
    }
  }
  return { byKey, records };
}

const shown = (v) => (v === undefined ? 'missing' : JSON.stringify(v));
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// state-machine.md § validateProvenance(page) — contract, for one parsed page record. Returns the
// failed conditions (empty when the record carries live-render evidence).
export function validateProvenance(record, { now = Date.now() } = {}) {
  const p = record && typeof record === 'object' ? record._provenance : undefined;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [`_provenance: ${shown(p)}, not an object`];
  const fails = [];
  if (p.renderedBy !== 'playwright') fails.push(`renderedBy: ${shown(p.renderedBy)} is not "playwright"`);
  const t = typeof p.fetchedAt === 'string' && ISO_8601.test(p.fetchedAt) ? Date.parse(p.fetchedAt) : NaN;
  if (!Number.isFinite(t)) fails.push(`fetchedAt: ${shown(p.fetchedAt)} does not parse as ISO 8601`);
  else if (t - now > FUTURE_SKEW_MS) fails.push(`fetchedAt: ${p.fetchedAt} is more than 5 min in the future`);
  if (!Number.isInteger(p.waitMs) || p.waitMs <= 0) fails.push(`waitMs: ${shown(p.waitMs)} is not an integer > 0`);
  if (typeof p.waitMode !== 'string' || !WAIT_MODE_RE.test(p.waitMode)) fails.push(`waitMode: ${shown(p.waitMode)} does not match ${WAIT_MODE_RE.source}`);
  if (!Number.isInteger(p.httpStatus) || p.httpStatus < 200 || p.httpStatus > 399) fails.push(`httpStatus: ${shown(p.httpStatus)} is not an integer in [200, 399]`);
  return fails;
}

// Resolves every input URL to its page record and checks it; pure apart from reading the records.
// Returns { pages: [{ slug, input, record, file }], failures: [line…] } — a failure line per slug.
export function resolvePages(inputs, current, { now = Date.now() } = {}) {
  const pagesDir = join(current, 'pages');
  const { byKey, records } = indexPageRecords(pagesDir);
  const pages = inputs.map(({ url, where }) => {
    const hit = byKey.get(urlKey(url));
    return { slug: hit || crawlSlug(url), input: url, where, indexed: Boolean(hit) };
  });
  const seen = new Map();
  for (const p of pages) {
    if (seen.has(p.slug)) { const q = seen.get(p.slug); throw new UsageError(`duplicate slug "${p.slug}": --pages ${q.where} (${q.input}) and ${p.where} (${p.input}) name the same page`); }
    seen.set(p.slug, p);
  }
  const failures = [];
  for (const p of pages) {
    p.file = posix.join(current, 'pages', `${p.slug}.json`);
    const fsFile = join(pagesDir, `${p.slug}.json`);
    let conds;
    if (!existsSync(fsFile) || !statSync(fsFile).isFile()) conds = [`file exists: no page record for ${p.input}`];
    else {
      const r = records.has(p.slug) ? { value: records.get(p.slug) } : readJson(fsFile);
      if (r.error) conds = [`file parses: ${r.error}`];
      else if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) conds = ['file parses: not a JSON object'];
      else {
        p.record = r.value;
        conds = validateProvenance(p.record, { now });
        // Not in the index although the file exists: the record at this slug is another URL's.
        const own = [p.record.url, p.record.finalUrl].filter((h) => typeof h === 'string');
        if (!p.indexed && own.length) conds.unshift(`url: the record is ${own[0]}, not ${p.input}`);
      }
    }
    if (conds.length) failures.push(`page ${p.slug} lacks live-render evidence (${conds.join('; ')}) — ${p.file}; re-crawl it`);
  }
  return { pages, failures };
}

// <current>/_crawl-log.json#captureGaps.roots, when it lists any; else null.
export function readCaptureGapRoots(current) {
  const r = readJson(join(current, '_crawl-log.json'));
  const roots = r.value && r.value.captureGaps && r.value.captureGaps.roots;
  return Array.isArray(roots) && roots.length ? structuredClone(roots) : null;
}

// Builds the state object init writes. `prev` (an existing file without pages, or the --force
// case) keeps its top-level keys other than _provenance, site and pages in place.
export function buildInitState({ pages, types = new Map(), siteUrl = null, captureGaps = null, current, prev = null, at = nowIso() }) {
  const rows = pages.map(({ slug, input, record = {} }) => ({
    slug,
    url: record.url || input,
    title: record.title || slug,
    type: types.get(slug) || null,
    status: 'extracted',
    history: [{ status: 'extracted', at }],
    stale: false,
    staleReason: null,
    currentStatePath: posix.join(current, 'pages', `${slug}.json`),
    prototypePath: null,
    migratedPath: null,
  }));
  const site = { originUrl: new URL(siteUrl || rows[0].url).origin, deployUrl: null, extractedAt: at, crawled: rows.length };
  if (captureGaps) site.captureGaps = captureGaps;
  const base = prev && typeof prev === 'object' ? { ...prev } : {};
  return { ...base, _provenance: stampProvenance(null, 'stardust:extract', at), site, pages: rows };
}

// ---- argv --------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, force: false, historyOnly: false, slugs: false, to: null, by: null, prototype: null, migrated: null, skill: null, pages: null, types: null, siteUrl: null, current: null, representative: null, type: null, seen: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // A value flag never swallows the next flag: `--to --force` is a forgotten status, not the status "--force".
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      if (argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value (got ${argv[i + 1]}, which is a flag)`);
      i += 1; return argv[i];
    };
    if (a.startsWith('--') && a !== '--help') opts.seen.push(a);
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
    else if (a === '--pages') opts.pages = need();
    else if (a === '--types') opts.types = need();
    else if (a === '--site-url') opts.siteUrl = need();
    else if (a === '--current') opts.current = need();
    else if (a === '--representative') opts.representative = need();
    else if (a === '--type') opts.type = need();
    else if (a === '--gate' || a === '--note') throw new UsageError(`${a} is not accepted: a state.json history entry carries status, at and approvedBy only (state-machine.md § File). Gate evidence belongs in the producing skill's own ledger; free-text notes belong in stardust/journal.md.`);
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  return { opts, pos };
}

function readPagesInput(src) {
  if (src === '-') {
    try { return readFileSync(0, 'utf8'); } catch (e) { throw new UsageError(`--pages -: cannot read stdin (${e.message})`); }
  }
  if (!existsSync(src) || !statSync(src).isFile()) throw new UsageError(`--pages ${src} is not a file (one URL per line or a JSON array; - reads stdin)`);
  return readFileSync(src, 'utf8');
}

const listSome = (xs, n = 5) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, … +${xs.length - n} more` : ''}`;

// The top-level keys init writes; every other key of an existing file is kept in place.
const INIT_OWNS = ['_provenance', 'site', 'pages'];
// A file with no `pages` key or an empty pages[] holds no page state (the master routing or replica
// Setup stamps flow / handsOff before extract runs): init fills it without --force.
export const holdsPages = (state) => Array.isArray(state.pages) && state.pages.length > 0;

// An existing state.json as init sees it; unreadable, not an object, or a non-array `pages` is a
// refusal (init never guesses over it).
function readPrevForInit(file) {
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError(`${file} is not valid JSON (${e.message}) — init leaves it as it is`); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new UsageError(`${file} is not a JSON object — init leaves it as it is`);
  if ('pages' in state && !Array.isArray(state.pages)) throw new UsageError(`${file} has a pages key that is not an array — init leaves it as it is`);
  return state;
}

function runInit(opts, rest) {
  if (rest.length) throw new UsageError(`init takes no <slug> (got ${rest.join(' ')}); list the pages' URLs in --pages <file|->`);
  if (!opts.pages) throw new UsageError('init needs --pages <file|-> (one URL per line or a JSON array of URLs; - reads stdin)');
  const siteUrl = opts.siteUrl ? parseSiteUrl(opts.siteUrl).href : null;
  const inputs = parsePageList(readPagesInput(opts.pages), { siteUrl });
  const current = opts.current || posix.join(opts.dir, 'current');
  const file = statePath(opts.dir);
  let prev = null;
  let kept = null;
  if (existsSync(file)) {
    prev = readPrevForInit(file);
    if (holdsPages(prev)) {
      if (!opts.force) throw new UsageError(`${file} already exists — init never overwrites it; pass --force to re-init while every page in it is still extracted, or change pages with advance / set`);
      const advanced = prev.pages.filter((p) => p.status !== 'extracted');
      if (advanced.length) throw new UsageError(`--force re-inits only while every page is extracted; ${advanced.length} of ${prev.pages.length} page(s) moved on: ${listSome(advanced.map((p) => `${p.slug} (${p.status})`))} — ${file} left as it is`);
    } else kept = Object.keys(prev).filter((k) => !INIT_OWNS.includes(k));
  }
  const at = nowIso();
  const { pages, failures } = resolvePages(inputs, current);
  const types = parseTypes(opts.types, pages.map((p) => p.slug));
  if (failures.length) throw new UsageError([`init refused — ${failures.length} of ${pages.length} page(s) have no valid crawl record under ${posix.join(current, 'pages')}; nothing written`, ...failures].join('\n'));
  const state = buildInitState({ pages, types, siteUrl, captureGaps: readCaptureGapRoots(current), current, prev, at });
  mkdirSync(opts.dir, { recursive: true });
  writeState(file, state);
  console.log(`state: init ${pages.length} page(s) from ${opts.pages === '-' ? 'stdin' : opts.pages} · ${types.size} typed${kept && kept.length ? ` · kept ${kept.join(', ')}` : ''} · written by ${state._provenance.writtenBy}`);
  return 0;
}

function runSet(opts, rest) {
  const { state, file } = readState(opts.dir);
  const done = setPages(state, rest, { representative: opts.representative, type: opts.type });
  const writtenBy = normaliseSkill(opts.skill || 'direct');
  state._provenance = stampProvenance(state._provenance, writtenBy, nowIso());
  writeState(file, state);
  const what = [opts.representative !== null ? `representative=${opts.representative}` : null, opts.type !== null ? `type=${opts.type}` : null].filter(Boolean).join(', ');
  console.log(`state: ${done.length} page(s) set ${what}: ${done.join(', ')} · written by ${writtenBy}`);
  return 0;
}

// ---- main --------------------------------------------------------------------------------------
export function main(argv) {
  const { opts, pos } = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  const [cmd, ...rest] = pos;
  if (!cmd) throw new UsageError(HELP);

  if (Object.hasOwn(FLAGS_FOR, cmd)) {
    const stray = opts.seen.find((f) => !FLAGS_FOR[cmd].includes(f));
    if (stray) throw new UsageError(`${stray} does not apply to ${cmd} (it reads ${FLAGS_FOR[cmd].join(', ')})`);
    return cmd === 'init' ? runInit(opts, rest) : runSet(opts, rest);
  }
  const stray = opts.seen.find((f) => NEW_FLAGS.includes(f));
  if (stray) throw new UsageError(`unknown option ${stray}`);

  if (cmd === 'summary') {
    const { state } = readState(opts.dir);
    const s = summarise(state);
    const parts = ORDER.map((k) => `${k} ${s.counts[k].length}`);
    for (const [k, v] of Object.entries(s.other)) parts.push(`other(${k}) ${v.length}`);
    parts.push(`stale ${s.stale.length}`);
    console.log(`${s.total} page(s) · ${parts.join(' · ')}`);
    for (const a of Object.keys(s.representatives).sort()) console.log(`  representative ${a} ${s.representatives[a].length}  ${s.representatives[a].join(', ')}`);
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
