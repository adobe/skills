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
 *   --live-host  live host or origin the delivered pages must answer 200 on (default rollout.json site.liveHost,
 *                else the host the coverage records the delivered rows were deployed/gated on — inferred so the
 *                live-host header-parity rule applies by default)
 *   --offline    skip the live probe; pages_not_live is not checked and the verdict says so (the inferred/given
 *                live host is still used for the header-parity rule — where parity was measured vs where the gates ran)
 *   --chrome     header contract and comparison dir (default stardust/chrome)
 *   --state      project state whose `flow` makes it a migration (default stardust/state.json)
 *   --widths     the gate widths every delivered page is proven at (default 1440,360); judged for
 *                sidecars_missing only when `flow` is replica or a coverage row carries delivery.gate
 *   --register   the inconsistency register an override cites (default stardust/replica/inconsistency-register.md)
 *   --schemas    per-page section schemas, <slug>.json (default stardust/eds-schema)
 *   --redirects  redirects sheet, one `source<TAB>destination` per line (default stardust/redirects.tsv); the
 *                redirects-cdn.tsv beside it (seed-redirects.mjs: sources the sheet cannot match) counts too
 *   --json       print { complete, gaps[], liveChecked, skipped[], info[] } instead of one line per gap
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
 *                                  matched by deploy's eds-path pathKey; a page excluded since — a pages.json
 *                                  excluded[] path — leaves its unit's count). A unit flipped with
 *                                  progress.mjs `unit done --unproven "<reason>"` (the escape hatch past that
 *                                  tool's own pre-check) carries the reason on this line (`declared unproven:`)
 *   open_p1:N                      open or in-progress P1 findings in optimize/findings.json, source parity
 *                                  excluded — the optimize gate's own count
 *   header_parity:<why>            migration projects (state.json `flow`) only: the header contract
 *                                  (chrome/header-contract.json, chrome-explore of the source) is missing, or
 *                                  chrome/header-parity.json (chrome-compare) is missing, older than the contract,
 *                                  of the wrong profile (replica flow: replica; redesign, reskin: functional),
 *                                  short of a contract width, not run on the live host, or has undecided errors
 *   header_parity_errors:N         any project: the undecided error findings of chrome/header-parity.json
 *                                  (counts.error without findings[] — it leaves the decided out); no file, no gap; not
 *                                  listed when header_parity already names those errors (one finding set, one gap)
 *   ledger_unpaired:N: <ends>      ledger `end` lines without an open start that no later start and end of the
 *                                  same phase re-records (stardust ledger.mjs unpairedEnds); `unchecked` when
 *                                  ledger.mjs is not found beside the rollout scripts
 *   export_stale:<why> — <remedy>  rollout.json `exports` lists migration-workspace and the export is not fresh:
 *                                  no workspace/manifest.json; its input or output hashes differ from the tree
 *                                  (content/**.html, blocks/<n>/<n>.{js,css}, judgement.json; the coverage files,
 *                                  mapping.json — the cwd is the project root); mapping.json missing while
 *                                  stardust/current/pages holds a capture, unreadable, or its generatedAt is not
 *                                  pages.json's. Remedy, in order: inventory.mjs + blocks.mjs, block-origin.mjs
 *                                  --verify, workspace-manifest.mjs. Not judged once handed over (skipped line)
 *   blocks_unjudged:N              migration-workspace export only (rollout.json `exports`): N delivered module
 *                                  blocks of coverage/blocks.json whose base type is not judged (unknown or missing
 *                                  — unknown is not a judged value); a gap, not a hard stop, until the owner names
 *                                  them (workspace-manifest.mjs lists them under handoverNotes)
 *   rollout_incomplete             the last stardust:rollout I-dashboard ledger line is not an `end`
 * A check that did not run is named after the gaps, one `skipped: <what>` line each (JSON: skipped[]): the live
 * probe under --offline; the units, when progress.json is missing, is not JSON or has no units map; the redirects
 * of delivered rows without source.sourceUrl; the sidecar gate widths in a flow without a gate table; the per-width
 * verdicts of done units' rows gated before passByWidth (proven on the last width's pass); the export once a client
 * took it over (workspace/handover.json, or a manifest recording a handover).
 * Info, never a gap, one `info: <what>` line each after the skipped ones (JSON: info[]): pages_excluded:N: <paths>,
 * the coverage pages.json excluded[] rows — planned pages the source no longer serves (state.mjs exclude);
 * blocks_pending:N: <names> — record each, the module blocks of coverage/blocks.json delivered (instances in the
 * content files) without a conversion record (update-coverage.mjs --block … converted|deployed|verified|not-delivered);
 * header_decided_by_agent:N: <keys> — for the owner's review, the header findings a hands-off agent decided
 * (decided.agent in chrome/header-parity.json, else its counts.decidedByAgent);
 * export_quality:zero_confidence:N — migration-workspace export only: the manifest's selectorQuality.zeroConfidence
 * (image-only repeating blocks with no text to anchor, shipped without an encoder map) once above the threshold
 * (default 0); informational, it never flips completeness — the hard gate is block-origin.mjs --max-zero-confidence;
 * export_quality:null_selector_sections:N — the manifest's sectionGaps with reason no-selector (sections an adopter
 * projecting per selector drops) when N>0, informational, never a gap;
 * export_quality:judgement_to_fill:N — the manifest's judgement.toFill (judgement.json fields still empty: block
 * purpose / reuseGuidance / a default-fallback baseType) when N>0, informational, never a gap;
 * export_quality:encode_unrecorded:N — the manifest's selectorQuality.encode.unrecorded (multi-page templates with
 * no encoder-map selector and no migrate encode record, so a reviewer cannot tell whether the encoder was tried,
 * skipped or never applicable; else counted from byTemplate[].encode.decision) when N>0, informational, never a
 * gap;
 * export_quality:schema:<file>:N: <errors> — an export file (coverage/{pages,templates,blocks}.json, rollout.json,
 * workspace/{manifest,mapping,judgement}.json, those present) that fails its published schema under
 * skills/rollout/schemas/ — undeclared or missing required keys, a wrong type, an enum or pattern miss (lib.mjs's
 * structural check, no dependency; `format` and `if`/`then` are not checked) — N errors, the first three named, so a
 * run surfaces schema drift before a
 * client's validator does; a `skipped:` line names the schemas dir when none is found beside the scripts (plugin
 * tree: skills/rollout/schemas/; a copied scripts dir: its schemas/);
 * export_quality:excluded:N: <url (reason)> — the manifest's excluded[] (planned URLs that never became a page, each
 * with its recorded reason — workspace-manifest.mjs --help) when N>0; all six hidden once the export is handed over.
 *
 * Exit: 0 complete · 1 gaps · 2 usage (no coverage/pages.json; no live host and no --offline; bad --widths).
 */
import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJSON, isSourceParity, publicUrl, sha256, classifyExportDrift, gateProof, validateSchema } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNFINISHED = new Set(['pending', 'content-pending', 'converting', 'deployed', 'stale']);
const DELIVERED = new Set(['deployed', 'verified']);
const LIST_MAX = 20;
const DEFAULT_WIDTHS = ['1440', '360'];
const NOT_UNIT_PROVEN = new Set(['foundation', 'final']);
const UNIT_NAME = /^[\w.-]+$/;
export const OFFLINE_SKIP = 'pages_not_live: live probe not run (--offline)';
// The manifest's selectorQuality.zeroConfidence surfaces as an info line (never a gap) once it is above this many;
// 0 means any zero-confidence selector is reported. The hard gate is block-origin.mjs --max-zero-confidence, not this.
export const ZERO_CONFIDENCE_INFO_THRESHOLD = 0;

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

/**
 * The live host the delivered pages were deployed/gated on, inferred from the coverage: the most common host
 * among delivered rows' delivery.deployedUrl (an http(s) URL), ties broken by host string; null when none records
 * one. When pages.json records a live host, done-check applies the live-host header-parity rule by default
 * (--live-host inferred): a recorded run measured header parity on the preview host while its gates ran on the
 * live host, and the rule never fired because --live-host was not passed. Pure.
 */
export function inferredLiveHost(pages = [], { previewHost = null } = {}) {
  const pv = previewHost ? hostOf(previewHost) : null;
  const tally = (get) => {
    const counts = new Map();
    for (const p of (Array.isArray(pages) ? pages : []).filter(isDelivered)) {
      const u = get(p);
      const h = typeof u === 'string' && /^https?:\/\//.test(u) ? hostOf(u) : '';
      if (h && h !== pv) counts.set(h, (counts.get(h) || 0) + 1);
    }
    if (!counts.size) return null;
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
  };
  // The live host the published gates ran on (delivery.gate.host) is the live host; the preview host is excluded; fall
  // back to the deployed URL's host, which update-coverage records as the PREVIEW host by default — so the header-parity
  // rule still fires when parity was measured on preview while the gates ran on the live host.
  return tally((p) => p.delivery && p.delivery.gate && p.delivery.gate.host) || tally((p) => p.delivery && p.delivery.deployedUrl);
}

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
  if (liveHost && hostOf(parity.build) !== hostOf(liveHost)) return `header_parity:measured on ${hostOf(parity.build)}, not the live host the gates ran on (${hostOf(liveHost)})`;
  const open = (parity.findings || []).filter((f) => f.severity === 'error' && !f.decided);
  return open.length ? `header_parity:${open.length}: ${listed(open.map((f) => f.key))}` : null;
}

/**
 * header_parity_errors, or null: the undecided error findings of chrome/header-parity.json in any project. Its
 * findings[] decide when present; without them, counts.error — chrome-compare's count already leaves the decided
 * (owner's and, hands-off, the agent's) out, the same reading as findings[]. An absent or unreadable file (`parity`
 * null) is no gap. Pure.
 */
export function headerParityErrors(parity) {
  if (!isMap(parity)) return null;
  const counts = isMap(parity.counts) ? parity.counts : {};
  const n = Array.isArray(parity.findings)
    ? parity.findings.filter((f) => f && f.severity === 'error' && !f.decided).length
    : Math.max(0, Number(counts.error) || 0);
  return n > 0 ? `header_parity_errors:${n}` : null;
}

/**
 * header_decided_by_agent (info, never a gap), or null: the header findings a hands-off agent decided
 * (`decided.agent: true`, by key) — else, without findings[], counts.decidedByAgent — for the owner's review. Pure.
 */
export function headerDecidedByAgent(parity) {
  if (!isMap(parity)) return null;
  const tail = ' — for the owner\'s review';
  if (Array.isArray(parity.findings)) {
    const keys = parity.findings.filter((f) => f && isMap(f.decided) && f.decided.agent === true).map((f) => f.key);
    return keys.length ? `header_decided_by_agent:${keys.length}: ${listed(keys)}${tail}` : null;
  }
  const n = isMap(parity.counts) ? Number(parity.counts.decidedByAgent) || 0 : 0;
  return n > 0 ? `header_decided_by_agent:${n}${tail}` : null;
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
export function unitGaps({ progress = null, unitPaths = {}, pages = [], widths = DEFAULT_WIDTHS, pathKey, out = 'stardust/rollout', excluded = [] } = {}) {
  if (progress == null) return { gaps: [], skipped: [`unit_unproven: no ${join(out, 'progress.json')}`] };
  if (!isMap(progress) || !isMap(progress.units)) return { gaps: [], skipped: [`unit_unproven: ${join(out, 'progress.json')} has no units map`] };
  const { units } = progress;
  // a page excluded since (coverage excluded[]) with no row left in pages[] has nothing to prove: it leaves its unit's count
  const gone = new Set((Array.isArray(excluded) ? excluded : []).filter((e) => e && typeof e.path === 'string').map((e) => pathKey(e.path)));
  const rowsByKey = new Map();
  for (const p of pages) { const k = pathKey(pathOf(p)); rowsByKey.set(k, [...(rowsByKey.get(k) || []), p]); }
  const legacy = new Set();
  // THE shared proof predicate (lib.gateProof): progress.mjs's `unit done` pre-check reads it too, so a page
  // it refuses to mark proven is exactly a page this gap would name — the two never disagree.
  const rowProven = (p) => { const r = gateProof(p, widths); if (r.legacy) legacy.add(p); return r.proven; };
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
    let left = 0;
    for (const l of contentLines(text)) {
      if (gone.has(pathKey(l)) && !rowsByKey.has(pathKey(l))) { left += 1; continue; }
      if (!byKey.has(pathKey(l))) byKey.set(pathKey(l), l);
    }
    if (!byKey.size) { if (!left) gaps.push(`unit_unproven:${name}: no pages in ${file}`); continue; }
    const unproven = [...byKey].filter(([k]) => !proven(k)).map(([, l]) => l);
    // the escape hatch progress.mjs `unit done --unproven "<reason>"` records on the entry travels into the gap
    const declared = typeof u.unproven === 'string' && u.unproven.trim() ? ` — declared unproven: ${u.unproven.trim()}` : '';
    if (unproven.length) gaps.push(`unit_unproven:${name}: ${unproven.length}/${byKey.size} pages without a passing gate at ${widths.join(' and ')}: ${listed(unproven)}${declared}`);
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

/** The export files and the schema each validates against: rollout-dir-relative file → skills/rollout/schemas/<schema>. */
export const EXPORT_SCHEMAS = [
  ['coverage/pages.json', 'rollout-pages.schema.json'],
  ['coverage/templates.json', 'rollout-templates.schema.json'],
  ['coverage/blocks.json', 'rollout-blocks.schema.json'],
  ['rollout.json', 'rollout-config.schema.json'],
  ['workspace/manifest.json', 'rollout-workspace-manifest.schema.json'],
  ['workspace/mapping.json', 'rollout-workspace-mapping.schema.json'],
  ['workspace/judgement.json', 'rollout-workspace-judgement.schema.json'],
];
export const SCHEMAS_SKIP = 'export_quality:schema: no rollout schemas dir beside the scripts (skills/rollout/schemas/, or schemas/ in the copied rollout scripts dir)';
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
/** The rollout schemas dir in either layout: skills/rollout/schemas beside scripts/, or schemas/ inside a copied scripts dir; null when neither exists. */
export const schemasDir = () => [join(HERE, '..', 'schemas'), join(HERE, 'schemas')].find(isDir) || null;
const SCHEMA_ERRORS_SHOWN = 3;

/**
 * The export files under `out` that fail their published schema: [{ file, errors[] }] in EXPORT_SCHEMAS order — lib.mjs
 * validateSchema over each file present (declared properties, required keys, additionalProperties, types, enums,
 * patterns; a file that does not parse is one error). `schemas` = the schemas dir; null → nothing judged, one skipped
 * line (SCHEMAS_SKIP); a schema file missing or unreadable → its own skipped line. Pure but for the reads.
 */
export function schemaErrorsOf(out, schemas) {
  if (!schemas) return { errors: [], skipped: [SCHEMAS_SKIP] };
  const parse = (text) => { try { return { doc: JSON.parse(text) }; } catch (e) { return { error: e.message }; } };
  const errors = [];
  const skipped = [];
  for (const [rel, schemaFile] of EXPORT_SCHEMAS) {
    const file = join(out, rel);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const schema = readJSON(join(schemas, schemaFile));
    if (!isMap(schema)) { skipped.push(`export_quality:schema: ${join(schemas, schemaFile)} missing or not JSON`); continue; }
    const { doc, error } = parse(readFileSync(file, 'utf8'));
    const errs = error ? [`${rel}: does not parse as JSON (${error})`] : validateSchema(schema, doc);
    if (errs.length) errors.push({ file: rel, errors: errs });
  }
  return { errors, skipped };
}

export const EXPORT_REMEDY = 're-run inventory.mjs + blocks.mjs, then block-origin.mjs --verify, then workspace-manifest.mjs';
export const EXPORT_REHASH = 'workspace-manifest.mjs --rehash-only';

/**
 * export_stale, as `{ gap, skipped[] }`; judged only when `listed` (rollout.json `exports` lists migration-workspace).
 * `manifest` = workspace/manifest.json (null: absent or unreadable); `tree` = { inputs, outputs } on disk now, keyed as
 * the manifest keys them (workspace-manifest.mjs inputHashes; the coverage files and mapping.json), null when that
 * could not be computed (unchecked is a gap); `mapping` = mapping.json (null: absent; not an object: unreadable);
 * `pagesGeneratedAt` = pages.json generatedAt; `captures` = a capture exists; `handedOver` = why a client owns the
 * export now (handover.json, or a manifest recording one), else null — then nothing is judged and a skipped line
 * says so. `treeError` names why the tree could not be read (an unreadable file), shown in the unchecked cause. Causes, joined by `; `: no manifest; manifest hashes that differ from the tree (content by files and
 * sha256 — git tracking is not a hash); mapping.json missing while captures exist, unreadable, or with a generatedAt
 * other than pages.json's. The remedy carries the drift classification (classifyExportDrift) and its command —
 * `rehash-safe: workspace-manifest.mjs --rehash-only` when only block CSS or a regenerated coverage file drifted,
 * else `rebuild: <the full sequence>` (a missing manifest, missing/unreadable mapping or an unchecked tree is always a
 * rebuild). When coverage/pages.json's recorded hash drifted the line also states the adopter refuses the export until
 * it is refreshed (it hard-rejects a coverage/pages.json sha mismatch). Pure.
 */
export function exportGap({ listed: judged = false, manifest = null, tree = null, treeError = null, mapping = null, pagesGeneratedAt = null, captures = false, handedOver = null, dir = 'stardust/rollout/workspace' } = {}) {
  if (!judged) return { gap: null, skipped: [] };
  if (handedOver) return { gap: null, skipped: [`export_stale: handed over (${handedOver}) — stardust no longer writes the export`] };
  const why = [];
  let inOff = [];
  let outOff = [];
  // structural causes can never be re-hashed away: no manifest, an unchecked tree, or a missing/unreadable mapping
  let structural = false;
  if (!isMap(manifest)) { why.push(`no ${dir}/manifest.json`); structural = true; }
  if (!tree) { why.push(`unchecked (${treeError || 'workspace-manifest.mjs not found beside done-check.mjs'})`); structural = true; }
  else if (isMap(manifest)) {
    const norm = (k, v) => JSON.stringify(k === 'content' && isMap(v) ? [v.files, v.sha256] : v ?? null);
    const differ = (was = {}, now = {}) => [...new Set([...Object.keys(isMap(was) ? was : {}), ...Object.keys(now)])]
      .filter((k) => norm(k, (isMap(was) ? was : {})[k]) !== norm(k, now[k]));
    inOff = differ(manifest.inputs, tree.inputs);
    outOff = differ(manifest.outputs, tree.outputs);
    const off = [...inOff, ...outOff].sort();
    if (off.length) why.push(`manifest hashes differ from the tree: ${listed(off)}`);
  }
  if (mapping == null) { if (captures) { why.push(`no ${dir}/mapping.json while captures exist`); structural = true; } }
  else if (!isMap(mapping)) { why.push(`${dir}/mapping.json unreadable`); structural = true; }
  else if (mapping.generatedAt !== pagesGeneratedAt) why.push(`${dir}/mapping.json generatedAt ${mapping.generatedAt ?? 'none'} ≠ pages.json ${pagesGeneratedAt ?? 'none'}`);
  if (!why.length) return { gap: null, skipped: [] };
  const cls = structural || classifyExportDrift(inOff, outOff) === 'rebuild' ? 'rebuild' : 'rehash-safe';
  const remedy = cls === 'rehash-safe' ? `rehash-safe: ${EXPORT_REHASH}` : `rebuild: ${EXPORT_REMEDY}`;
  const adopter = outOff.some((k) => /(?:^|\/)coverage\/pages\.json$/.test(k))
    ? '; the adopter refuses this export until coverage/pages.json is refreshed' : '';
  return { gap: `export_stale:${why.join('; ')} — ${remedy}${adopter}`, skipped: [] };
}

/**
 * The verdict. `notLive` is the list of delivered paths the live probe found missing, or null when the probe did
 * not run (offline). `header`, `headerErrors`, `overridden`, `sidecars`, `ledger`, `exported` are gap lines (or null), `units`
 * gap lines, from the functions above; `skipped` names the checks that did not run. A row whose gate is
 * inconclusive (delivery.gate.inconclusive: reasons, or true) has no verdict: gates_inconclusive, and in
 * pages_failed only when it failed for another reason (status failed with an error not from the gate) or at a
 * width (delivery.gate.passByWidth[w] === false: any recorded width's failure counts, whichever width came last).
 * `headerErrors` is left out when `header` already names the undecided errors (`header_parity:<n>: …`).
 */
export function doneGaps({ pages = [], findings = [], ledgerLines = [], notLive = null, header = null, headerErrors = null, overridden = null, sidecars = null, units = [], ledger = null, exported = null, blocksUnjudged = 0, excluded = [], pendingBlocks = [], headerAgent = null, zeroConfidence = null, zeroConfidenceThreshold = ZERO_CONFIDENCE_INFO_THRESHOLD, nullSelectorSections = null, judgementToFill = null, schemaErrors = [], plannedExcluded = [], encodeUnrecorded = null, skipped = [] }) {
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
  if (exported) gaps.push(exported);
  // delivered blocks with no judged base type: a gap (not a hard stop) until the owner names them — unknown is not judged
  if (blocksUnjudged > 0) gaps.push(`blocks_unjudged:${blocksUnjudged}`);
  if (!rolloutEnded(ledgerLines)) gaps.push('rollout_incomplete');
  // planned pages the source no longer serves (coverage excluded[]) and blocks delivered without a conversion record:
  // named, never a gap
  const out = (Array.isArray(excluded) ? excluded : []).filter((e) => e && typeof e === 'object');
  // the migration export's zero-confidence selector count (manifest selectorQuality), null-selector section count
  // (manifest sectionGaps), judgement documentation debt (manifest judgement.toFill), multi-page templates without an
  // encode decision (manifest selectorQuality.encode.unrecorded), export files failing their schema (schemaErrorsOf) and
  // planned URLs that never became a page (manifest excluded[]): informational, never a gap
  const failing = (Array.isArray(schemaErrors) ? schemaErrors : []).filter((s) => s && typeof s.file === 'string' && Array.isArray(s.errors) && s.errors.length);
  const planned = (Array.isArray(plannedExcluded) ? plannedExcluded : []).filter((e) => e && typeof e.url === 'string');
  const info = [
    ...(zeroConfidence != null && zeroConfidence > zeroConfidenceThreshold ? [`export_quality:zero_confidence:${zeroConfidence}`] : []),
    ...(nullSelectorSections != null && nullSelectorSections > 0 ? [`export_quality:null_selector_sections:${nullSelectorSections}`] : []),
    ...(judgementToFill != null && judgementToFill > 0 ? [`export_quality:judgement_to_fill:${judgementToFill}`] : []),
    ...(encodeUnrecorded != null && encodeUnrecorded > 0 ? [`export_quality:encode_unrecorded:${encodeUnrecorded}`] : []),
    ...failing.map((s) => `export_quality:schema:${s.file}:${s.errors.length}: ${s.errors.slice(0, SCHEMA_ERRORS_SHOWN).join('; ')}${s.errors.length > SCHEMA_ERRORS_SHOWN ? `, … (+${s.errors.length - SCHEMA_ERRORS_SHOWN})` : ''}`),
    ...(planned.length ? [`export_quality:excluded:${planned.length}: ${listed(planned.map((e) => `${e.url} (${typeof e.reason === 'string' && e.reason ? e.reason : 'unrecorded'})`))}`] : []),
    ...(out.length ? [`pages_excluded:${out.length}: ${listed(out.map((e) => e.path || `/${e.slug}`))}`] : []),
    ...(pendingBlocks.length ? [`blocks_pending:${pendingBlocks.length}: ${listed(pendingBlocks)} — record each: update-coverage.mjs --block <name|id> --status converted`] : []),
    ...(headerAgent ? [headerAgent] : []),
  ];
  return { complete: gaps.length === 0, gaps, liveChecked: notLive !== null, skipped: [...(notLive === null ? [OFFLINE_SKIP] : []), ...skipped], info };
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

/** workspace-manifest.mjs, imported here, never at load, so its own --help never answers for this script; null when absent. */
async function loadManifestLib() {
  try { return await import(pathToFileURL(join(HERE, 'workspace-manifest.mjs')).href); } catch { return null; }
}

/**
 * The migration export as on disk, judged by exportGap: the cwd is the project root (content/, blocks/,
 * stardust/current/pages/ — the captures), keys project-relative as workspace-manifest.mjs (`wm`) writes them.
 */
async function exportState({ out, config, pagesDoc, wm }) {
  const listed = Array.isArray(config && config.exports) && config.exports.includes('migration-workspace');
  if (!listed) return exportGap();
  const ws = join(out, 'workspace');
  const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
  const manifest = readJSON(join(ws, 'manifest.json'));
  // the marker as workspace-manifest.mjs reads it: any entry at that path
  const handedOver = existsSync(join(ws, 'handover.json')) ? join(ws, 'handover.json')
    : isMap(manifest) && manifest.handover ? `${join(ws, 'manifest.json')} records one` : null;
  const project = resolve('.');
  const rel = (abs) => relative(project, abs).split(sep).join('/');
  let tree = null;
  let treeError = null;
  if (wm && typeof wm.inputHashes === 'function') {
    try {
      // the same block-origin inputs (captures, eds-schema sidecars, encoder maps) the manifest hashed
      const dirs = typeof wm.blockOriginInputDirs === 'function' ? wm.blockOriginInputDirs(project) : {};
      const { inputs } = wm.inputHashes({ project, contentDir: resolve('content'), blocksDir: resolve('blocks'), judgementFile: resolve(ws, 'judgement.json'), ...dirs });
      const files = [...['pages', 'templates', 'blocks'].map((n) => resolve(out, 'coverage', `${n}.json`)), resolve(ws, 'mapping.json')];
      tree = { inputs, outputs: Object.fromEntries(files.filter(isFile).map((f) => [rel(f), sha256(readFileSync(f))])) };
    } catch (e) { treeError = e.message; }
  }
  const mappingFile = join(ws, 'mapping.json');
  const gap = exportGap({
    listed,
    manifest,
    tree,
    treeError,
    mapping: isFile(mappingFile) ? readJSON(mappingFile, 'unreadable') : null,
    pagesGeneratedAt: (pagesDoc && pagesDoc.generatedAt) ?? null,
    captures: !!(wm && typeof wm.hasCaptures === 'function' && wm.hasCaptures(resolve('stardust', 'current', 'pages'))),
    handedOver,
    dir: ws,
  });
  // the shipped manifest's zero-confidence figure, null-selector section count, judgement debt, encode decisions and
  // excluded planned URLs, and the export files' schema verdicts, for the info lines; none surfaced once a client owns
  // the export
  const sq = !handedOver && isMap(manifest) && isMap(manifest.selectorQuality) ? manifest.selectorQuality : null;
  const gaps = !handedOver && isMap(manifest) && Array.isArray(manifest.sectionGaps) ? manifest.sectionGaps : null;
  const judgement = !handedOver && isMap(manifest) && isMap(manifest.judgement) ? manifest.judgement : null;
  const schemas = handedOver ? { errors: [], skipped: [] } : schemaErrorsOf(out, schemasDir());
  // the manifest's encode decision count: its selectorQuality.encode.unrecorded, else the byTemplate rows that carry a
  // decision counted (a manifest from before the field has neither: null, silent)
  const rows = sq && Array.isArray(sq.byTemplate) ? sq.byTemplate.filter((r) => isMap(r) && isMap(r.encode)) : [];
  const encodeUnrecorded = sq && isMap(sq.encode) && typeof sq.encode.unrecorded === 'number' ? sq.encode.unrecorded
    : rows.length ? rows.filter((r) => r.encode.decision === 'unrecorded').length : null;
  return {
    ...gap,
    skipped: [...gap.skipped, ...schemas.skipped],
    zeroConfidence: sq && typeof sq.zeroConfidence === 'number' ? sq.zeroConfidence : null,
    nullSelectorSections: gaps ? gaps.filter((g) => g && g.reason === 'no-selector').length : null,
    judgementToFill: judgement && typeof judgement.toFill === 'number' ? judgement.toFill : null,
    schemaErrors: schemas.errors,
    plannedExcluded: !handedOver && isMap(manifest) && Array.isArray(manifest.excluded) ? manifest.excluded : [],
    encodeUnrecorded,
  };
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
  const pages = pagesDoc.pages || [];
  // The live host: --live-host, else rollout.json site.liveHost, else the host the coverage records the pages were
  // deployed/gated on (inferredLiveHost) — so the live-host header-parity rule applies by default. --offline keeps
  // this host for the rule but skips the network probe.
  const host = arg('live-host', (config.site && config.site.liveHost) || inferredLiveHost(pages, { previewHost: config.site && config.site.previewHost }));
  if (!OFFLINE && !host) { console.error('rollout done-check: need --live-host <host> (or rollout.json site.liveHost or a deployed live host in coverage), or --offline.'); process.exit(2); }

  // sibling skills resolve in both layouts: plugin tree (skills/<b>/scripts/) and project copy (stardust/scripts/<b>/)
  const sibling = (plugin, project) => [join(HERE, '..', '..', ...plugin), join(HERE, '..', ...project)].find((x) => existsSync(x));
  const { pathKey } = await import(pathToFileURL(sibling(['deploy', 'scripts', 'eds-path.mjs'], ['deploy', 'eds-path.mjs']) || join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs')).href);
  const ledgerLib = sibling(['stardust', 'scripts', 'ledger.mjs'], ['stardust', 'ledger.mjs']);
  let unpairedEnds = null;
  if (ledgerLib) { try { ({ unpairedEnds } = await import(pathToFileURL(ledgerLib).href)); } catch { unpairedEnds = null; } }

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
    : unitGaps({ progress: progressExists && progress === null ? {} : progress, unitPaths, pages, widths: WIDTHS, pathKey, out: OUT, excluded: pagesDoc.excluded });
  const flow = (readJSON(arg('state', 'stardust/state.json'), {}) || {}).flow || null;
  // seed-redirects.mjs routes the sources the sheet cannot match to redirects-cdn.tsv beside it: a line there counts
  const redirects = [textOf(REDIRECTS), textOf(join(dirname(REDIRECTS), 'redirects-cdn.tsv'))].join('\n');
  const sidecars = sidecarGap({ pages, widths: WIDTHS, schemaExists: (slug) => typeof slug === 'string' && slug !== '' && existsSync(join(SCHEMAS, `${slug}.json`)), redirects, judgeWidths: widthsJudged({ flow, pages }) });

  const findings = (readJSON(join(OUT, 'optimize', 'findings.json'), {}) || {}).findings || [];
  const notLive = OFFLINE ? null : await probeLive(host, deliveredPaths(pages));
  const chrome = arg('chrome', 'stardust/chrome');
  const parity = readJSON(join(chrome, 'header-parity.json'));
  // the live-host rule applies whether or not the network probe ran (--offline keeps the host, skips the probe)
  const header = headerGap({ flow, contract: readJSON(join(chrome, 'header-contract.json')), parity, liveHost: host });
  const wm = await loadManifestLib();
  const exported = await exportState({ out: OUT, config, pagesDoc, wm });
  const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
  const pendingKnown = !blocksDoc || (wm && typeof wm.pendingBlocks === 'function');
  // judged only for the migration-workspace export the adopter reads (where unknown base types were emitted as judged)
  const exportListed = Array.isArray(config.exports) && config.exports.includes('migration-workspace');
  const unjudgedKnown = exportListed && blocksDoc && wm && typeof wm.unjudgedBaseTypes === 'function';
  const verdict = doneGaps({
    pages, findings, ledgerLines, notLive, header,
    headerErrors: headerParityErrors(parity),
    overridden: overrideGap({ pages, register: textOf(REGISTER), readTable }),
    sidecars: sidecars.gap,
    units: units.gaps,
    ledger: ledgerGap(typeof unpairedEnds === 'function' ? unpairedEnds(ledgerLines) : null),
    exported: exported.gap,
    blocksUnjudged: unjudgedKnown ? wm.unjudgedBaseTypes(blocksDoc).length : 0,
    excluded: pagesDoc.excluded,
    pendingBlocks: blocksDoc && pendingKnown ? wm.pendingBlocks(blocksDoc) : [],
    headerAgent: headerDecidedByAgent(parity),
    zeroConfidence: exported.zeroConfidence,
    nullSelectorSections: exported.nullSelectorSections,
    judgementToFill: exported.judgementToFill,
    schemaErrors: exported.schemaErrors,
    plannedExcluded: exported.plannedExcluded,
    encodeUnrecorded: exported.encodeUnrecorded,
    skipped: [...sidecars.skipped, ...units.skipped, ...exported.skipped, ...(pendingKnown ? [] : ['blocks_pending: workspace-manifest.mjs not found beside done-check.mjs'])],
  });

  if (JSON_OUT) console.log(JSON.stringify(verdict));
  else {
    for (const g of verdict.gaps) console.log(g);
    for (const s of verdict.skipped) console.log(`skipped: ${s}`);
    for (const i of verdict.info) console.log(`info: ${i}`);
    console.log(`${verdict.complete ? '✓ complete' : `✗ ${verdict.gaps.length} gap(s)`}${verdict.liveChecked ? '' : ' (live probe skipped: --offline)'}`);
  }
  process.exit(verdict.complete ? 0 : 1);
}

const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) main();
