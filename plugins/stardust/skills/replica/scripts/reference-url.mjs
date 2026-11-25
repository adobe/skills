#!/usr/bin/env node
/**
 * skills/replica/scripts/reference-url.mjs
 *
 * The reference a gate compares against is the page as the inventory lists it: stardust/state.json `pages[].url` for
 * the slug. This is the one rule (source-fidelity-gate.md § Hardening rule 13 says why); gate.sh runs this script before
 * a round, gate-all.mjs imports its functions for every row.
 *
 * Two URLs are checked against the inventory URL: the URL the gate loads (gate.sh's <live-url>; gate-all's origin) and
 * the URL the page record was captured from (`url` of state.json's `currentStatePath`, else
 * stardust/current/pages/<slug>.json). Either one is ANOTHER RENDERING when its host, path or query differs, after
 * what the inventory already treats as the same page:
 *   - `www.`, the scheme, a trailing slash, the fragment and the order of query parameters;
 *   - tracking parameters (utm_*, gclid, fbclid: the set migrate.mjs stripTracking drops);
 *   - the redirect the page record followed (its `url` and `finalUrl`, when one of the two is the inventory URL: the
 *     crawl captured the page through that redirect);
 *   - the origin redirect the crawl adopted (_crawl-log.json `discovery.originRedirect`, apex to www and the like:
 *     the same path on the new origin, or any path when the inventory URL is the origin's root, the entry the crawl
 *     followed).
 * Another rendering (a `?page-mode=static`, print, AMP or no-JS mode, another path, another host) is REFUSED unless the
 * inconsistency register records the substitution: an entry (`## R-<nn> …`) with a `- **Reference substitution:**`
 * field naming both URLs, the inventory URL and the one that stands in for it. A recorded substitution is
 * SUBSTITUTED: the gate runs and says, on its reference line and in its records, that a pass is against that
 * rendering and not the page visitors see.
 *
 * Usage:
 *   node stardust/scripts/replica/reference-url.mjs <slug> <live-url> [--state stardust/state.json]
 *        [--register stardust/replica/inconsistency-register.md] [--crawl-log stardust/current/_crawl-log.json]
 * One line on stdout:
 *   reference: the inventory URL <url>[ (via …)]               exit 0
 *   reference: unchecked: <why>                                exit 0 (no state.json, no row or no URL for the slug)
 *   reference: SUBSTITUTED: <alt> stands in for <url> (…), accepted by R-<nn> in the inconsistency register; …   exit 0
 *   reference: REFUSED for <slug>: …                           exit 7
 * Exit 125: usage. Pure, no browser, no network.
 */
/* eslint-disable no-restricted-syntax, max-len, no-continue */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HELP = `reference-url: is the gate's reference the page as the inventory lists it?

Usage: node reference-url.mjs <slug> <live-url> [--state stardust/state.json]
         [--register stardust/replica/inconsistency-register.md] [--crawl-log stardust/current/_crawl-log.json]

Compares <live-url> and the page record's URL (state.json currentStatePath, else stardust/current/pages/<slug>.json)
with state.json pages[].url for <slug>. Same page: www., scheme, trailing slash, fragment, query order, tracking
parameters (utm_*, gclid, fbclid), the redirect the record followed (url to finalUrl) and the crawl's origin redirect. Anything else (a query such as
page-mode=static, another path, another host) is another rendering: REFUSED, exit 7, unless an inconsistency-register
entry has a "- **Reference substitution:**" field naming both URLs: SUBSTITUTED, exit 0, and the line says a pass is
against that rendering. One line on stdout; exit 0 same / unchecked / substituted, 7 refused, 125 usage.
source-fidelity-gate.md § Hardening rule 13.`;

export const REFUSED_EXIT = 7;
export const PATHS = { state: 'stardust/state.json', register: 'stardust/replica/inconsistency-register.md', crawlLog: 'stardust/current/_crawl-log.json', records: 'stardust/current/pages' };
// migrate.mjs stripTracking's set: a tracking parameter does not change what the page renders.
export const TRACKING = /^(utm_.*|gclid|fbclid)$/i;
export const ADVICE = 'A static, print, AMP or no-JS mode is another rendering, not the page visitors see. Gate against the inventory URL; when stitched capture cannot measure it, record the pixel probe as gate-blocked, rely on content-diff and visual-diff against that URL and tell the user (source-fidelity-gate.md § Hardening rule 13). To accept the substitution, name both URLs in a "- **Reference substitution:**" field of an entry in stardust/replica/inconsistency-register.md';

// ── pure ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** urlParts(href) → { host, path, query: Map<name, value[,value]> } with the inventory's own folds, or null. */
export function urlParts(href) {
  let u; try { u = new URL(String(href)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const query = new Map();
  for (const [k, v] of [...u.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))) query.set(k, query.has(k) ? `${query.get(k)},${v}` : v);
  return { host: u.host.toLowerCase().replace(/^www\./, ''), path: u.pathname.replace(/\/+$/, '') || '/', query };
}
const sameQuery = (a, b) => a.query.size === b.query.size && [...a.query].every(([k, v]) => b.query.get(k) === v);
/** renderingChanges(inventoryUrl, url) → what differs, in words ([] = the same page). */
export function renderingChanges(inventoryUrl, url) {
  const a = urlParts(inventoryUrl); const b = urlParts(url);
  if (!a || !b) return [`not an http(s) URL: ${!a ? inventoryUrl : url}`];
  const out = [];
  if (a.host !== b.host) out.push(`host ${b.host} instead of ${a.host}`);
  if (a.path !== b.path) out.push(`path ${b.path} instead of ${a.path}`);
  for (const [k, v] of b.query) {
    if (!a.query.has(k)) out.push(`query ${k}${v ? `=${v}` : ''} added`);
    else if (a.query.get(k) !== v) out.push(`query ${k}=${v} instead of ${k}=${a.query.get(k)}`);
  }
  for (const k of a.query.keys()) if (!b.query.has(k)) out.push(`query ${k} removed`);
  return out;
}
/**
 * sameAsInventory(inventoryUrl, url, { record, crawlLog }) → { same, changes, via }: `url` is the inventory's page:
 * directly, through the redirect the page record followed (record.url to record.finalUrl, one of them the inventory
 * URL), or through the origin redirect the crawl adopted (crawlLog.discovery.originRedirect { from, to }).
 */
export function sameAsInventory(inventoryUrl, url, { record = null, crawlLog = null } = {}) {
  const changes = renderingChanges(inventoryUrl, url);
  if (!changes.length) return { same: true, changes, via: null };
  // the record's own redirect: one end is the inventory URL, the other is then the same page (the crawl recorded it)
  if (record && typeof record.url === 'string' && typeof record.finalUrl === 'string') {
    const ends = [record.url, record.finalUrl];
    if (ends.some((e) => !renderingChanges(inventoryUrl, e).length) && ends.some((e) => !renderingChanges(e, url).length)) return { same: true, changes: [], via: 'the redirect the page record followed' };
  }
  const r = crawlLog && crawlLog.discovery && crawlLog.discovery.originRedirect;
  const a = urlParts(inventoryUrl); const b = urlParts(url); const from = r && urlParts(r.from); const to = r && urlParts(r.to);
  if (a && b && from && to && a.host === from.host && b.host === to.host && sameQuery(a, b) && (a.path === b.path || a.path === '/')) return { same: true, changes: [], via: 'the origin redirect the crawl adopted' };
  return { same: false, changes, via: null };
}
const urlsIn = (s) => (String(s).match(/https?:\/\/[^\s`<>()[\]"']+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, ''));
/**
 * registerSubstitutions(text) → [{ id, title, urls }]: the inconsistency-register entries (`## R-<nn> <title>`) with a
 * `- **Reference substitution:**` field; urls = every http(s) URL in that field (its indented continuation lines too).
 */
export function registerSubstitutions(text) {
  const out = []; let cur = null; let inField = false;
  for (const line of String(text || '').split('\n')) {
    const h = /^##\s+(R-\d+)\b\s*(.*)$/.exec(line);
    if (h) { cur = { id: h[1], title: h[2].replace(/^[\s—–:-]+/, '').trim(), urls: [] }; out.push(cur); inField = false; continue; }
    if (/^#/.test(line)) { cur = null; inField = false; continue; }
    if (!cur) continue;
    const f = /^\s*[-*]\s+\*\*([^*]+?)\*\*:?\s*(.*)$/.exec(line);
    if (f) { inField = /^reference substitution:?$/i.test(f[1].trim()); if (inField) cur.urls.push(...urlsIn(f[2])); continue; }
    if (inField && /^\s+\S/.test(line)) cur.urls.push(...urlsIn(line)); else inField = false;
  }
  return out.filter((e) => e.urls.length >= 2);
}
/** substitutionFor(inventoryUrl, url, entries) → the entry naming both URLs (one for each), or null. */
export function substitutionFor(inventoryUrl, url, entries = []) {
  return entries.find((e) => e.urls.some((x, i) => !renderingChanges(inventoryUrl, x).length && e.urls.some((y, j) => j !== i && !renderingChanges(y, url).length))) || null;
}
/** alternateFor(inventoryUrl, entries) → { url, entry }: the URL a register entry names to stand in for the inventory URL, or null. */
export function alternateFor(inventoryUrl, entries = []) {
  for (const e of entries) {
    if (!e.urls.some((x) => !renderingChanges(inventoryUrl, x).length)) continue;
    const url = e.urls.find((x) => renderingChanges(inventoryUrl, x).length);
    if (url) return { url, entry: e };
  }
  return null;
}
/**
 * checkReference({ slug, inventoryUrl, url, record, recordFile, crawlLog, register }) → { verdict, line, substitution?,
 * refusals? }. verdict: 'unchecked' (no inventory URL) | 'same' | 'substituted' (every difference recorded in the
 * register) | 'refused'. `url` = the URL the gate loads (null: only the record is checked); `register` = the parsed
 * entries (registerSubstitutions). substitution = { url, inventoryUrl, entry, title, changes } for the gate's URL, else
 * the record's.
 */
export function checkReference({ slug, inventoryUrl = null, url = null, record = null, recordFile = null, crawlLog = null, register = [] }) {
  if (!inventoryUrl) return { verdict: 'unchecked', line: `reference: unchecked: no inventory URL for ${slug} in state.json` };
  const subs = []; const refusals = []; const vias = [];
  const consider = (what, candidate) => {
    const c = sameAsInventory(inventoryUrl, candidate, { record, crawlLog });
    if (c.same) { if (c.via) vias.push(c.via); return; }
    const entry = substitutionFor(inventoryUrl, candidate, register);
    (entry ? subs : refusals).push({ what, url: candidate, changes: c.changes, entry });
  };
  if (record && typeof record.url === 'string') consider('record', record.url);
  if (url) consider('url', url);
  const said = (x) => (x.what === 'url' ? `the gate URL ${x.url} is not the page the inventory lists (${inventoryUrl}): ${x.changes.join(', ')}` : `the page record${recordFile ? ` ${recordFile}` : ''} was captured from ${x.url}, not from the inventory URL ${inventoryUrl}: ${x.changes.join(', ')}`);
  if (refusals.length) return { verdict: 'refused', line: `reference: REFUSED for ${slug}: ${refusals.map(said).join('; ')}. ${ADVICE}`, refusals };
  if (subs.length) {
    const main = subs.find((x) => x.what === 'url') || subs[0];
    const substitution = { url: main.url, inventoryUrl, entry: main.entry.id, title: main.entry.title, changes: main.changes, ...(subs.some((x) => x.what === 'record') ? { record: subs.find((x) => x.what === 'record').url } : {}) };
    const recordNote = substitution.record && main.what === 'url' ? `; the page record was captured from ${substitution.record}` : '';
    return { verdict: 'substituted', substitution, line: `reference: SUBSTITUTED: ${main.url} stands in for ${inventoryUrl} (${main.changes.join(', ')})${recordNote}, accepted by ${main.entry.id} in the inconsistency register. A pass is a pass against that rendering, not the page visitors see: the run report says so` };
  }
  return { verdict: 'same', line: `reference: the inventory URL ${inventoryUrl}${vias.length ? ` (via ${[...new Set(vias)].join(', ')})` : ''}` };
}
/** The SUBSTITUTED line → { url, inventoryUrl, entry } (gate-evidence reads it from a gate.sh log), or null. */
export function parseSubstituted(text) {
  const m = /reference: SUBSTITUTED: (\S+) stands in for (\S+) \(.*?accepted by (R-\d+)/.exec(String(text || ''));
  return m ? { url: m[1], inventoryUrl: m[2], entry: m[3] } : null;
}

// ── project files ─────────────────────────────────────────────────────────────────────────────────────────────────
const readJson = (f) => { try { const j = JSON.parse(readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
/** referenceContext({ state, register, crawlLog }) → { state, register: entries, crawlLog }: the files every page's check reads, once. */
export function referenceContext({ state = PATHS.state, register = PATHS.register, crawlLog = PATHS.crawlLog } = {}) {
  return { state: existsSync(state) ? readJson(state) : null, register: registerSubstitutions(readText(register)), crawlLog: existsSync(crawlLog) ? readJson(crawlLog) : null };
}
/** pageRecord(row) → { record, recordFile }: the page record a state.json row names (currentStatePath), else the conventional one. */
export function pageRecord(row) {
  const recordFile = (row && typeof row.currentStatePath === 'string' && row.currentStatePath) || (row && row.slug ? `${PATHS.records}/${row.slug}.json` : null);
  return { record: recordFile && existsSync(recordFile) ? readJson(recordFile) : null, recordFile };
}
/** check(slug, url, ctx) → checkReference's answer for one state.json slug and the URL a gate loads. */
export function check(slug, url, ctx) {
  if (!ctx.state) return { verdict: 'unchecked', line: 'reference: unchecked: no readable state.json' };
  const row = (Array.isArray(ctx.state.pages) ? ctx.state.pages : []).find((p) => p && p.slug === slug);
  if (!row) return { verdict: 'unchecked', line: `reference: unchecked: state.json has no row for ${slug}` };
  return checkReference({ slug, inventoryUrl: typeof row.url === 'string' ? row.url : null, url, ...pageRecord(row), crawlLog: ctx.crawlLog, register: ctx.register });
}

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const pos = []; const o = { state: PATHS.state, register: PATHS.register, crawlLog: PATHS.crawlLog };
  const FLAGS = { '--state': 'state', '--register': 'register', '--crawl-log': 'crawlLog' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (FLAGS[a]) { const v = argv[i += 1]; if (v === undefined || v.startsWith('--')) { console.error(`reference-url: ${a} needs a value (--help)`); return 125; } o[FLAGS[a]] = v; continue; }
    if (a.startsWith('--')) { console.error(`reference-url: unknown flag ${a} (--help)`); return 125; }
    pos.push(a);
  }
  if (pos.length !== 2) { console.error('reference-url: needs <slug> <live-url> (--help)'); return 125; }
  const r = check(pos[0], pos[1], referenceContext(o));
  console.log(r.line);
  return r.verdict === 'refused' ? REFUSED_EXIT : 0;
}

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && fileURLToPath(import.meta.url) === real(process.argv[1])) process.exitCode = main(process.argv.slice(2));
