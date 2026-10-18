#!/usr/bin/env node
/**
 * rollout/done-check.mjs — is the delivery complete? One verdict from the ledgers the run already
 * wrote, so "done" is computed once instead of re-derived by every reader.
 *
 * Usage: node stardust/scripts/rollout/done-check.mjs [--out stardust/rollout] [--ledger stardust/status.jsonl]
 *          [--live-host <host> | --offline] [--chrome stardust/chrome] [--state stardust/state.json]
 *          [--widths 1440,360] [--register stardust/replica/inconsistency-register.md]
 *          [--schemas stardust/eds-schema] [--redirects stardust/redirects.tsv] [--json]
 *   --out        rollout dir (default stardust/rollout): coverage/pages.json, optimize/findings.json, rollout.json,
 *                progress.json, units/<unit>.paths
 *   --ledger     run-status ledger (default stardust/status.jsonl)
 *   --live-host  aem.live host or origin the delivered pages must answer 200 on (default rollout.json site.liveHost)
 *   --offline    skip the live probe; pages_not_live is not checked and the verdict says so
 *   --chrome     header contract and comparison dir (default stardust/chrome)
 *   --state      project state whose `flow` makes it a migration (default stardust/state.json)
 *   --widths     the gate widths every delivered page is proven at (default 1440,360); judged for
 *                sidecars_missing only when `flow` is replica or a coverage row carries delivery.gate
 *   --register   the inconsistency register an override cites (default stardust/replica/inconsistency-register.md)
 *   --schemas    per-page section schemas, <slug>.json (default stardust/eds-schema)
 *   --redirects  redirects sheet, one `source<TAB>destination` per line (default stardust/redirects.tsv); the
 *                redirects-cdn.tsv beside it (seed-redirects.mjs: sources the sheet cannot match) counts too
 *   --json       print { complete, gaps[], liveChecked, skipped[] } instead of one line per gap
 * Writes nothing; the live probe sends one HEAD request per delivered page.
 *
 * Delivered rows are coverage rows `deployed` or `verified`. Gaps, one per line in this order; complete = none:
 *   pages_unfinished:N             coverage rows not yet verified (pending, content-pending, converting, deployed, stale)
 *   pages_failed:N: <paths>        rows failed, or whose published-origin gate (delivery.gate.pass) is false, or
 *                                  whose verdict at any recorded width (delivery.gate.passByWidth) is false; a row
 *                                  with an inconclusive gate only when it also failed for another reason or at a width
 *   gates_inconclusive:N: <paths>  rows whose gate gave no verdict (delivery.gate.inconclusive: reasons, or true)
 *   pages_overridden:N: <why>      N delivered rows carry a gate override (delivery.gate.override: gate-all's
 *                                  {verdict, reason, valid}, or the older verdict string); a gap when an object
 *                                  override is not `valid: true` (not validated by gate-all), the rows passing by
 *                                  an earned override exceed 10 % of delivered rows, or an override cites no
 *                                  `## R-<nn>` heading of the register (in the override itself, else the recorded
 *                                  gate table's override.reason, which must not be marked valid: false)
 *   pages_not_live:N: <paths>      deployed or verified rows that do not answer 200 on the live host
 *   sidecars_missing:N: <counts>   delivered rows missing <schemas>/<slug>.json, a delivery.gate.atByWidth time at
 *                                  a --widths width (only in a flow with a published-origin gate table: state.json
 *                                  `flow` replica, or any coverage row carrying delivery.gate; else skipped and the
 *                                  count reads `-`), or — when the source path (source.sourceUrl) differs from the
 *                                  delivered URL — a line for the source path in the redirects sheet or the
 *                                  redirects-cdn.tsv beside it
 *   unit_unproven:<unit>: <why>    one per done unit of progress.json (kind not foundation or final, by name)
 *                                  whose units/<unit>.paths is missing, or lists a page not proven: proven =
 *                                  `delivery.gate.passByWidth[w] === true` (update-coverage.mjs keeps each
 *                                  width's own verdict) and a recorded gate time at every --widths width, with
 *                                  `delivery.gate.pass === true` (the last width ingested); a row gated before
 *                                  passByWidth is proven on that pass alone and counted as skipped (pages
 *                                  matched by deploy's eds-path pathKey)
 *   open_p1:N                      open or in-progress P1 findings in optimize/findings.json, source parity
 *                                  excluded — the optimize gate's own count
 *   header_parity:<why>            migration projects (state.json `flow`) only: the header contract
 *                                  (chrome/header-contract.json, chrome-explore of the source) is missing, or
 *                                  chrome/header-parity.json (chrome-compare) is missing, older than the contract,
 *                                  of the wrong profile (replica flow: replica; redesign, reskin: functional),
 *                                  short of a contract width, not run on the live host, or has undecided errors
 *   header_parity_errors:N         any project: the undecided error findings of chrome/header-parity.json
 *                                  (counts.error − counts.decided without findings[]); no file, no gap; not
 *                                  listed when header_parity already names those errors (one finding set, one gap)
 *   ledger_unpaired:N: <ends>      ledger `end` lines without an open start that no later start and end of the
 *                                  same phase re-records (stardust ledger.mjs unpairedEnds); `unchecked` when
 *                                  ledger.mjs is not found beside the rollout scripts
 *   rollout_incomplete             the last stardust:rollout I-dashboard ledger line is not an `end`
 * A check that did not run is named after the gaps, one `skipped: <what>` line each (JSON: skipped[]): the live
 * probe under --offline; the units, when progress.json is missing, is not JSON or has no units map; the redirects
 * of delivered rows without source.sourceUrl; the sidecar gate widths in a flow without a gate table; the per-width
 * verdicts of done units' rows gated before passByWidth (proven on the last width's pass).
 *
 * Exit: 0 complete · 1 gaps · 2 usage (no coverage/pages.json; no live host and no --offline; bad --widths).
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJSON, isSourceParity, publicUrl } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNFINISHED = new Set(['pending', 'content-pending', 'converting', 'deployed', 'stale']);
const DELIVERED = new Set(['deployed', 'verified']);
const LIST_MAX = 20;
const DEFAULT_WIDTHS = ['1440', '360'];
const NOT_UNIT_PROVEN = new Set(['foundation', 'final']);
const UNIT_NAME = /^[\w.-]+$/;
export const OFFLINE_SKIP = 'pages_not_live: live probe not run (--offline)';

const statusOf = (p) => (p.delivery && p.delivery.status) || 'pending';
const pathOf = (p) => p.path || `/${p.slug}`;
const listed = (paths) => (paths.length > LIST_MAX ? `${paths.slice(0, LIST_MAX).join(', ')}, … (+${paths.length - LIST_MAX})` : paths.join(', '));
const isDelivered = (p) => DELIVERED.has(statusOf(p));
const gateOf = (p) => (p && p.delivery && p.delivery.gate) || null;
// a gate with no verdict (a polluted capture): its reasons as a non-empty string, or true
const isInconclusive = (p) => { const i = (gateOf(p) || {}).inconclusive; return i === true || (typeof i === 'string' && i !== ''); };
// a width whose recorded verdict is false failed, whichever width was gated last (a width without a verdict is null)
const widthFailed = (p) => { const by = (gateOf(p) || {}).passByWidth; return isMap(by) && Object.values(by).some((v) => v === false); };
const gatedAt = (gate, widths) => widths.every((w) => !!(gate && gate.atByWidth && gate.atByWidth[String(w)]));
const contentLines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const decoded = (s) => { try { return decodeURI(s); } catch { return s; } };
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The rows that should answer on the live host. */
// probed where each page was deployed (publicUrl: delivery.deployedUrl, else its path): the other slash form is no 200
export const deliveredPaths = (pages) => pages.filter((p) => DELIVERED.has(statusOf(p))).map(publicUrl);

/** Is the rollout's final phase ended? The LAST I-dashboard line decides (a later `start` re-opens it). */
export function rolloutEnded(ledgerLines) {
  const dash = ledgerLines.filter((l) => l && l.skill === 'stardust:rollout' && l.phase === 'I-dashboard');
  return dash.length > 0 && dash[dash.length - 1].event === 'end';
}

/** Open P1 findings the optimize gate counts: open or in-progress, severity P1, not source parity. */
export const openP1 = (findings) => findings.filter((f) => (f.status === 'open' || f.status === 'in-progress')
  && f.severity === 'P1' && !isSourceParity(f));

const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).host; } catch { return ''; } };

/** The header's gap, or null: a migration is not done while its header's behaviour is unproven (header-parity). */
export function headerGap({ flow = null, contract = null, parity = null, liveHost = null }) {
  if (!flow) return null;
  const want = flow === 'replica' ? 'replica' : 'functional';
  if (!contract) return 'header_parity:no contract: chrome-explore.mjs <source home> stardust/chrome/header-contract.json';
  if (!parity) return `header_parity:unchecked: chrome-compare.mjs the live header against the contract --profile ${want} --json stardust/chrome/header-parity.json`;
  if (parity.source !== contract.url) return `header_parity:compared against ${parity.source}, not the contract (${contract.url})`;
  if (String(parity.at) < String(contract.at)) return 'header_parity:stale: the contract is newer than the comparison';
  if (parity.profile !== want) return `header_parity:profile ${parity.profile}; the ${flow} flow needs ${want}`;
  const short = Object.keys(contract.widths || {}).filter((w) => !(parity.widths || []).map(String).includes(w));
  if (short.length) return `header_parity:not compared at ${short.join(', ')}`;
  if (liveHost && hostOf(parity.build) !== hostOf(liveHost)) return `header_parity:compared on ${hostOf(parity.build)}, not the live host ${hostOf(liveHost)}`;
  const open = (parity.findings || []).filter((f) => f.severity === 'error' && !f.decided);
  return open.length ? `header_parity:${open.length}: ${listed(open.map((f) => f.key))}` : null;
}

/**
 * header_parity_errors, or null: the undecided error findings of chrome/header-parity.json in any project. Its
 * findings[] decide when present (chrome-compare's counts.error already leaves the decided out); without them,
 * counts.error − counts.decided, floored at 0. An absent or unreadable file (`parity` null) is no gap. Pure.
 */
export function headerParityErrors(parity) {
  if (!isMap(parity)) return null;
  const counts = isMap(parity.counts) ? parity.counts : {};
  const n = Array.isArray(parity.findings)
    ? parity.findings.filter((f) => f && f.severity === 'error' && !f.decided).length
    : Math.max(0, (Number(counts.error) || 0) - (Number(counts.decided) || 0));
  return n > 0 ? `header_parity_errors:${n}` : null;
}

const REF = /\bR-\d+\b/;
const refIn = (v) => { const m = typeof v === 'string' ? v.match(REF) : null; return m ? m[0] : null; };

/** The entries of the inconsistency register: its `## R-<nn>` headings. Pure. */
export const registerEntries = (text) => new Set([...String(text || '').matchAll(/^## (R-\d+)\b/gm)].map((m) => m[1]));

/**
 * The register entry a delivered row's gate override cites: `{ ref, invalid }`. An object override cites the
 * first R-<nn> of its reason, else of any other string field, and is invalid unless gate-all validated it
 * (`valid: true`; a table older than that check carries none). A string override (the older overrides.json
 * verdict) cites itself when it holds one, else the row of the recorded gate table (`readTable(delivery.gate.table)`
 * → rows[], by slug, then path) cites its `override.reason`, invalid when that carries `valid: false`. Pure.
 */
export function overrideRef(page, readTable = () => null) {
  const gate = gateOf(page) || {};
  const o = gate.override;
  if (o && typeof o === 'object') {
    const ref = refIn(o.reason) || Object.keys(o).filter((k) => k !== 'reason').map((k) => refIn(o[k])).find(Boolean) || null;
    return { ref, invalid: o.valid !== true };
  }
  const own = refIn(o);
  if (own) return { ref: own, invalid: false };
  const table = gate.table ? readTable(gate.table) : null;
  const rows = table && Array.isArray(table.rows) ? table.rows.filter((r) => r && typeof r === 'object') : [];
  const row = rows.find((r) => r.slug === page.slug) || rows.find((r) => r.path && r.path === page.path);
  const recorded = row && row.override && typeof row.override === 'object' ? row.override : null;
  return { ref: recorded ? refIn(recorded.reason) : null, invalid: !!recorded && recorded.valid === false };
}

/**
 * pages_overridden, or null. Override rows: delivered rows whose delivery.gate.override is set (string or object).
 * An object override is earned only with `valid: true`; one without is listed as not validated by gate-all.
 * Passing by override: an earned override row (object valid, or the string form) with gate.pass true whose own
 * measurements failed (`reasons` non-empty or absent; an empty array passed on its own). A gap when those exceed
 * 10 % of delivered rows (k × 10 > d), any object override is not validated, or any override row cites no
 * register entry (`register` = the register's text). Pure.
 */
export function overrideGap({ pages = [], register = '', readTable = () => null } = {}) {
  const delivered = pages.filter(isDelivered);
  const rows = delivered.filter((p) => { const g = gateOf(p); return !!(g && g.override); });
  if (!rows.length) return null;
  const isObject = (p) => typeof gateOf(p).override === 'object';
  const earned = (p) => !isObject(p) || gateOf(p).override.valid === true;
  const byOverride = rows.filter((p) => { const g = gateOf(p); return earned(p) && g.pass === true && !(Array.isArray(g.reasons) && g.reasons.length === 0); });
  const unvalidated = rows.filter((p) => !earned(p));
  const entries = registerEntries(register);
  // an object override's validity is named apart above; a string override's recorded `valid: false` stays here
  const unbacked = rows.filter((p) => { const { ref, invalid } = overrideRef(p, readTable); return (invalid && !isObject(p)) || !ref || !entries.has(ref); });
  const why = [];
  if (byOverride.length * 10 > delivered.length) why.push(`${byOverride.length}/${delivered.length} delivered pages pass by override (cap 10 %)`);
  if (unvalidated.length) why.push(`${unvalidated.length} not validated by gate-all (override.valid is not true): ${listed(unvalidated.map(pathOf))}`);
  if (unbacked.length) why.push(`no register entry for ${listed(unbacked.map(pathOf))}`);
  return why.length ? `pages_overridden:${rows.length}: ${why.join('; ')}` : null;
}

/**
 * unit_unproven gaps, one per done unit (kind not foundation / final), units by name: `{ gaps[], skipped[] }`.
 * `progress` = progress.json (null when absent; skipped, as is a record without a `units` map), `unitPaths` =
 * { <unit>: .paths text, or null when the file is absent }, `pathKey` = deploy's eds-path key. A page is proven
 * when its coverage row's `delivery.gate.passByWidth[w] === true` and a recorded gate time (atByWidth) at every
 * width, and `delivery.gate.pass === true` (the verdict of the width ingested last). A row gated before
 * passByWidth was recorded (none on the gate) is proven on `pass` and its gate times alone; each such row
 * proven is counted in one skipped line, so the weaker proof is never silent. Pure.
 */
export function unitGaps({ progress = null, unitPaths = {}, pages = [], widths = DEFAULT_WIDTHS, pathKey, out = 'stardust/rollout' } = {}) {
  if (progress == null) return { gaps: [], skipped: [`unit_unproven: no ${join(out, 'progress.json')}`] };
  if (!isMap(progress) || !isMap(progress.units)) return { gaps: [], skipped: [`unit_unproven: ${join(out, 'progress.json')} has no units map`] };
  const { units } = progress;
  const rowsByKey = new Map();
  for (const p of pages) { const k = pathKey(pathOf(p)); rowsByKey.set(k, [...(rowsByKey.get(k) || []), p]); }
  const legacy = new Set();
  const rowProven = (p) => {
    const g = gateOf(p);
    if (!g || g.pass !== true || !gatedAt(g, widths)) return false;
    if (g.passByWidth == null) { legacy.add(p); return true; }
    return isMap(g.passByWidth) && widths.every((w) => g.passByWidth[String(w)] === true);
  };
  // every coverage row behind the key must be proven: two rows on one key never let the passing one vouch for the other
  const proven = (key) => { const rows = rowsByKey.get(key) || []; const each = rows.map(rowProven); return rows.length > 0 && each.every(Boolean); };
  const gaps = [];
  for (const name of Object.keys(units).sort()) {
    const u = units[name] || {};
    if (u.status !== 'done' || NOT_UNIT_PROVEN.has(u.kind)) continue;
    // the unit's literal name, never a normalised path: a name that is not a unit name points nowhere
    const file = `${join(out, 'units')}/${name}.paths`;
    const text = Object.hasOwn(unitPaths, name) ? unitPaths[name] : null;
    if (text == null) { gaps.push(`unit_unproven:${name}: no ${file}`); continue; }
    const byKey = new Map();
    for (const l of contentLines(text)) if (!byKey.has(pathKey(l))) byKey.set(pathKey(l), l);
    if (!byKey.size) { gaps.push(`unit_unproven:${name}: no pages in ${file}`); continue; }
    const unproven = [...byKey].filter(([k]) => !proven(k)).map(([, l]) => l);
    if (unproven.length) gaps.push(`unit_unproven:${name}: ${unproven.length}/${byKey.size} pages without a passing gate at ${widths.join(' and ')}: ${listed(unproven)}`);
  }
  return { gaps, skipped: legacy.size ? [`unit_unproven: ${legacy.size} row(s) without per-width verdicts — proven on the last width's pass`] : [] };
}

/** The source paths of a redirects sheet (TSV `source<TAB>destination`, `#` comments, 2+ spaces tolerated). Pure. */
export const redirectSources = (text) => contentLines(text).map((l) => l.split(/\t+|\s{2,}/)[0]);

/** Does this flow have a published-origin gate table to prove widths against? Replica, or any row gated. Pure. */
export const widthsJudged = ({ flow = null, pages = [] } = {}) => flow === 'replica' || pages.some((p) => !!gateOf(p));
export const WIDTHS_SKIP = 'sidecars_missing gate widths: no published-origin gate table in this flow';

/**
 * sidecars_missing, as `{ gap, skipped[] }`. Each delivered row needs `schemaExists(slug)`, a gate time at every
 * width (only when `judgeWidths`; else skipped and the count reads `-`), and — when the pathname of
 * source.sourceUrl differs from its delivered URL (publicUrl) — a redirects line whose source is that pathname
 * (`redirects` = the text of the sheet and of redirects-cdn.tsv; decodeURI forms compared too). Rows without
 * source.sourceUrl are not judged for redirects; their count is skipped. Pure.
 */
export function sidecarGap({ pages = [], widths = DEFAULT_WIDTHS, schemaExists = () => false, redirects = '', judgeWidths = true } = {}) {
  const sources = redirectSources(redirects);
  const hasLine = (path) => sources.some((s) => s === path || decoded(s) === decoded(path));
  const count = { schema: 0, gate: 0, redirects: 0 };
  const missing = [];
  let unjudged = 0;
  for (const p of pages.filter(isDelivered)) {
    const noSchema = !schemaExists(p.slug);
    const noWidths = judgeWidths && !gatedAt(gateOf(p), widths);
    const src = p.source && p.source.sourceUrl;
    let noRedirect = false;
    if (typeof src !== 'string' || !src) unjudged += 1;
    else {
      let from = null;
      try { from = new URL(src, 'https://source.invalid').pathname; } catch { from = null; }
      noRedirect = from === null || (from !== publicUrl(p) && !hasLine(from));
    }
    count.schema += noSchema ? 1 : 0; count.gate += noWidths ? 1 : 0; count.redirects += noRedirect ? 1 : 0;
    if (noSchema || noWidths || noRedirect) missing.push(pathOf(p));
  }
  return {
    gap: missing.length ? `sidecars_missing:${missing.length}: schema ${count.schema}, gate widths ${judgeWidths ? count.gate : '-'}, redirects ${count.redirects}: ${listed(missing)}` : null,
    skipped: [...(judgeWidths || !pages.some(isDelivered) ? [] : [WIDTHS_SKIP]), ...(unjudged ? [`sidecars_missing redirects: ${unjudged} delivered rows without source.sourceUrl`] : [])],
  };
}

/**
 * ledger_unpaired, or null. `unpaired` = ledger.mjs unpairedEnds(lines), or null when ledger.mjs was not found
 * (unchecked is a gap: an unprovable record never passes silently). Only ends not re-recorded count. Pure.
 */
export function ledgerGap(unpaired) {
  if (!Array.isArray(unpaired)) return 'ledger_unpaired:unchecked (ledger.mjs not found beside the rollout scripts)';
  const open = unpaired.filter((u) => u && u.reRecorded !== true);
  return open.length ? `ledger_unpaired:${open.length}: ${listed(open.map((u) => [u.skill, u.phase, u.ts].map((v) => v ?? '-').join(' ')))}` : null;
}

/**
 * The verdict. `notLive` is the list of delivered paths the live probe found missing, or null when the probe did
 * not run (offline). `header`, `headerErrors`, `overridden`, `sidecars`, `ledger` are gap lines (or null), `units`
 * gap lines, from the functions above; `skipped` names the checks that did not run. A row whose gate is
 * inconclusive (delivery.gate.inconclusive: reasons, or true) has no verdict: gates_inconclusive, and in
 * pages_failed only when it failed for another reason (status failed with an error not from the gate) or at a
 * width (delivery.gate.passByWidth[w] === false: any recorded width's failure counts, whichever width came last).
 * `headerErrors` is left out when `header` already names the undecided errors (`header_parity:<n>: …`).
 */
export function doneGaps({ pages = [], findings = [], ledgerLines = [], notLive = null, header = null, headerErrors = null, overridden = null, sidecars = null, units = [], ledger = null, skipped = [] }) {
  const gaps = [];
  const unfinished = pages.filter((p) => UNFINISHED.has(statusOf(p)));
  if (unfinished.length) gaps.push(`pages_unfinished:${unfinished.length}`);
  const inconclusive = pages.filter(isInconclusive);
  const failedElsewhere = (p) => statusOf(p) === 'failed' && !/^gate: /.test(String(p.delivery.error || ''));
  const failed = pages.filter((p) => widthFailed(p) || ((statusOf(p) === 'failed' || (p.delivery && p.delivery.gate && p.delivery.gate.pass === false))
    && (!isInconclusive(p) || failedElsewhere(p))));
  if (failed.length) gaps.push(`pages_failed:${failed.length}: ${listed(failed.map(pathOf))}`);
  if (inconclusive.length) gaps.push(`gates_inconclusive:${inconclusive.length}: ${listed(inconclusive.map(pathOf))}`);
  if (overridden) gaps.push(overridden);
  if (notLive && notLive.length) gaps.push(`pages_not_live:${notLive.length}: ${listed(notLive)}`);
  if (sidecars) gaps.push(sidecars);
  gaps.push(...units);
  const p1 = openP1(findings);
  if (p1.length) gaps.push(`open_p1:${p1.length}`);
  if (header) gaps.push(header);
  // one finding set, one gap: header_parity already names the undecided errors (`header_parity:<n>: <keys>`)
  if (headerErrors && !(header && /^header_parity:\d+:/.test(header))) gaps.push(headerErrors);
  if (ledger) gaps.push(ledger);
  if (!rolloutEnded(ledgerLines)) gaps.push('rollout_incomplete');
  return { complete: gaps.length === 0, gaps, liveChecked: notLive !== null, skipped: [...(notLive === null ? [OFFLINE_SKIP] : []), ...skipped] };
}

/** HEAD each path on the live host; returns the paths that do not answer 200. */
export async function probeLive(host, paths, { fetchImpl = fetch, concurrency = 8 } = {}) {
  const origin = /^https?:\/\//.test(host) ? host.replace(/\/$/, '') : `https://${host}`;
  const missing = [];
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const path = paths[next]; next += 1;
      let ok = false;
      try { ok = (await fetchImpl(`${origin}${path}`, { method: 'HEAD', redirect: 'manual' })).status === 200; } catch { ok = false; }
      if (!ok) missing.push(path);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return paths.filter((p) => missing.includes(p)); // input order, not completion order
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
}

async function main() {
  const argv = process.argv.slice(2);
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (argv.includes('--help') || argv.includes('-h')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(0);
  }
  const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
  const OUT = arg('out', 'stardust/rollout');
  const LEDGER = arg('ledger', 'stardust/status.jsonl');
  const OFFLINE = argv.includes('--offline');
  const JSON_OUT = argv.includes('--json');
  const WIDTHS = String(arg('widths', DEFAULT_WIDTHS.join(','))).split(',').map((w) => w.trim()).filter(Boolean);
  if (!WIDTHS.length || !WIDTHS.every((w) => /^\d+$/.test(w))) { console.error('rollout done-check: --widths takes comma-separated pixel widths, e.g. 1440,360.'); process.exit(2); }
  const REGISTER = arg('register', 'stardust/replica/inconsistency-register.md');
  const SCHEMAS = arg('schemas', 'stardust/eds-schema');
  const REDIRECTS = arg('redirects', 'stardust/redirects.tsv');

  const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
  if (!pagesDoc) { console.error(`rollout done-check: no ${join(OUT, 'coverage', 'pages.json')} — run inventory.mjs first.`); process.exit(2); }
  const config = readJSON(join(OUT, 'rollout.json'), {});
  const host = arg('live-host', config.site && config.site.liveHost);
  if (!OFFLINE && !host) { console.error('rollout done-check: need --live-host <host> (or rollout.json site.liveHost), or --offline.'); process.exit(2); }

  // sibling skills resolve in both layouts: plugin tree (skills/<b>/scripts/) and project copy (stardust/scripts/<b>/)
  const sibling = (plugin, project) => [join(HERE, '..', '..', ...plugin), join(HERE, '..', ...project)].find((x) => existsSync(x));
  const { pathKey } = await import(pathToFileURL(sibling(['deploy', 'scripts', 'eds-path.mjs'], ['deploy', 'eds-path.mjs']) || join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs')).href);
  const ledgerLib = sibling(['stardust', 'scripts', 'ledger.mjs'], ['stardust', 'ledger.mjs']);
  let unpairedEnds = null;
  if (ledgerLib) { try { ({ unpairedEnds } = await import(pathToFileURL(ledgerLib).href)); } catch { unpairedEnds = null; } }

  const pages = pagesDoc.pages || [];
  const ledgerLines = readLedger(LEDGER);
  const textOf = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const tables = new Map();
  const readTable = (f) => { if (!tables.has(f)) tables.set(f, readJSON(f)); return tables.get(f); };
  const progressFile = join(OUT, 'progress.json');
  const NOT_JSON = Symbol('not JSON');
  const progressExists = existsSync(progressFile);
  const progress = progressExists ? readJSON(progressFile, NOT_JSON) : null;
  const unitPaths = Object.create(null);
  for (const name of Object.keys(isMap(progress) && isMap(progress.units) ? progress.units : {})) {
    const f = join(OUT, 'units', `${name}.paths`);
    unitPaths[name] = UNIT_NAME.test(name) && existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  const units = progress === NOT_JSON
    ? { gaps: [], skipped: [`unit_unproven: ${progressFile} is not JSON`] }
    // a file holding JSON null exists: a record without a units map, never "no progress.json"
    : unitGaps({ progress: progressExists && progress === null ? {} : progress, unitPaths, pages, widths: WIDTHS, pathKey, out: OUT });
  const flow = (readJSON(arg('state', 'stardust/state.json'), {}) || {}).flow || null;
  // seed-redirects.mjs routes the sources the sheet cannot match to redirects-cdn.tsv beside it: a line there counts
  const redirects = [textOf(REDIRECTS), textOf(join(dirname(REDIRECTS), 'redirects-cdn.tsv'))].join('\n');
  const sidecars = sidecarGap({ pages, widths: WIDTHS, schemaExists: (slug) => typeof slug === 'string' && slug !== '' && existsSync(join(SCHEMAS, `${slug}.json`)), redirects, judgeWidths: widthsJudged({ flow, pages }) });

  const findings = (readJSON(join(OUT, 'optimize', 'findings.json'), {}) || {}).findings || [];
  const notLive = OFFLINE ? null : await probeLive(host, deliveredPaths(pages));
  const chrome = arg('chrome', 'stardust/chrome');
  const parity = readJSON(join(chrome, 'header-parity.json'));
  const header = headerGap({ flow, contract: readJSON(join(chrome, 'header-contract.json')), parity, liveHost: OFFLINE ? null : host });
  const verdict = doneGaps({
    pages, findings, ledgerLines, notLive, header,
    headerErrors: headerParityErrors(parity),
    overridden: overrideGap({ pages, register: textOf(REGISTER), readTable }),
    sidecars: sidecars.gap,
    units: units.gaps,
    ledger: ledgerGap(typeof unpairedEnds === 'function' ? unpairedEnds(ledgerLines) : null),
    skipped: [...sidecars.skipped, ...units.skipped],
  });

  if (JSON_OUT) console.log(JSON.stringify(verdict));
  else {
    for (const g of verdict.gaps) console.log(g);
    for (const s of verdict.skipped) console.log(`skipped: ${s}`);
    console.log(`${verdict.complete ? '✓ complete' : `✗ ${verdict.gaps.length} gap(s)`}${verdict.liveChecked ? '' : ' (live probe skipped: --offline)'}`);
  }
  process.exit(verdict.complete ? 0 : 1);
}

const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) main();
