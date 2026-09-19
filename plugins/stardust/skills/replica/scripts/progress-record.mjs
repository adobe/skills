#!/usr/bin/env node
/**
 * skills/replica/scripts/progress-record.mjs — copy one gate round into the
 * replica ledger (stardust/replica/progress.json), never typed.
 *
 * Why: hand-typed ledgers are where `pass: true` landed next to a Δh of 28,
 * where masked and unmasked numbers, regimes and reference dates got mixed
 * up, and where `iterations: 3` was written after 16 rounds. gate.sh already
 * writes every round as gates/<slug>-<width>/gate-<label>.json (the round
 * record); this script upserts that record's numbers into the page type
 * whose `archetype` equals the record's slug and touches NOTHING else in the
 * file — the ledger stays free-form, the numbers stay mechanical.
 *
 * Usage:
 *   node skills/replica/scripts/progress-record.mjs <gate-record.json> [options]
 *     --progress <file>   ledger path (default stardust/replica/progress.json)
 *     --dry-run           print the block that would be written; write nothing
 *
 * What it writes (source-fidelity-gate.md § Residual logging format):
 *   prototype regime      → <pageType>.breakpoints.<width> = { iterations, result, overCap?, record }
 *   published-origin regime → <pageType>.published.<width>  = { result, url, artifacts: [record] }
 *   result = { regime, pixelPct, pixelPctUnmasked, heightDelta, pass, masks[{spec, areaPct}], ref, at }
 *   iterations = counted rounds in the record's gate dir (verdict PASS|FAIL,
 *   not excluded, not a live-drift recapture) — the same rule gate.sh uses.
 * Existing keys of the breakpoint block other than these (residuals,
 * justified, captureState…) are preserved.
 *
 * Ledger shapes understood: `{ pageTypes: { <t>: { archetype, … } } }`,
 * `{ pageTypes: [ { pageType, archetype, … } ] }`, a top-level array of the
 * same, or a top-level map of page types. No page type with a matching
 * `archetype` (or no ledger file) → the intended block is PRINTED and the
 * exit is 0 without writing — the free-form ledger is never restructured
 * by this script; add the page type, then re-run.
 *
 * Exit codes: 0 written or dry-printed, 1 unreadable record/ledger or a
 * record without a verdict (no-verdict rounds are not ledger material).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const HELP = `progress-record — copy a gate round record into stardust/replica/progress.json

Usage: node progress-record.mjs <gate-record.json> [--progress <file>] [--dry-run]

Upserts <pageType>.breakpoints.<width> (prototype regime) or
<pageType>.published.<width> (published-origin regime) for the page type whose
archetype equals the record's slug; iterations are counted from the gate dir's
records. No matching page type → prints the block, writes nothing, exit 0.
Exit codes: 0 written/dry, 1 unreadable input or no-verdict record.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { progress: 'stardust/replica/progress.json', dryRun: false };
  const pos = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--progress') { opts.progress = rest[i += 1]; }
    else if (a === '--dry-run') { opts.dryRun = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (!pos[0]) { console.error(`need <gate-record.json>\n\n${HELP}`); process.exit(1); }
  return { record: pos[0], opts };
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Counted rounds in a gate dir — the same rule as gate.sh count_rounds(). */
export function countRounds(dir) {
  return readdirSync(dir).filter((f) => /^gate-.*\.json$/.test(f)).reduce((n, f) => {
    try { const j = readJson(`${dir}/${f}`); return n + (['PASS', 'FAIL'].includes(j.verdict) && !j.excluded && !j.liveDrift ? 1 : 0); } catch { return n; }
  }, 0);
}

/** The ledger block for one record. */
export function blockFor(rec, recordPath, iterations) {
  const result = {
    regime: rec.regime, pixelPct: rec.pixelPct, pixelPctUnmasked: rec.pixelPctUnmasked ?? rec.pixelPct, heightDelta: rec.heightDelta, pass: rec.pass ?? rec.verdict === 'PASS',
    masks: (rec.masks || []).map((m) => ({ spec: m.spec, areaPct: m.areaPct })), ref: rec.ref, at: rec.at,
    ...(rec.forced ? { forced: true } : {}), ...(rec.noiseFloor ? { noiseFloor: { pixelPct: rec.noiseFloor.pixelPct, heightDelta: rec.noiseFloor.heightDelta } } : {}),
  };
  if (rec.regime === 'published-origin') return { key: 'published', block: { result, url: rec.build?.url, artifacts: [recordPath] } };
  return { key: 'breakpoints', block: { iterations, result, ...(rec.overCap ? { overCap: rec.overCap } : {}), record: recordPath } };
}

/** Find the page-type entry whose archetype is `slug` in any supported ledger shape. */
export function findPageType(ledger, slug) {
  const candidates = [];
  const push = (entry, name) => { if (entry && typeof entry === 'object' && entry.archetype === slug) candidates.push({ entry, name }); };
  const scan = (coll) => {
    if (Array.isArray(coll)) coll.forEach((e, i) => push(e, e?.pageType || `[${i}]`));
    else if (coll && typeof coll === 'object') Object.entries(coll).forEach(([k, e]) => push(e, k));
  };
  if (ledger && typeof ledger === 'object' && 'pageTypes' in ledger) scan(ledger.pageTypes);
  else scan(ledger);
  return candidates[0] || null;
}

/** Upsert; returns { written, pageType, key, block }. Mutates `ledger`. */
export function upsert(ledger, rec, recordPath, iterations, width) {
  const hit = findPageType(ledger, rec.slug);
  const { key, block } = blockFor(rec, recordPath, iterations);
  if (!hit) return { written: false, key, block };
  hit.entry[key] = hit.entry[key] && typeof hit.entry[key] === 'object' ? hit.entry[key] : {};
  const prev = hit.entry[key][width] && typeof hit.entry[key][width] === 'object' ? hit.entry[key][width] : {};
  hit.entry[key][width] = { ...prev, ...block };
  if (key === 'breakpoints' && !rec.overCap) delete hit.entry[key][width].overCap;
  return { written: true, pageType: hit.name, key, block: hit.entry[key][width] };
}

function main() {
  const { record, opts } = parseArgs(process.argv);
  let rec; try { rec = readJson(record); } catch (e) { console.error(`progress-record: cannot read ${record}: ${e.message}`); process.exit(1); }
  if (!['PASS', 'FAIL'].includes(rec.verdict)) { console.error(`progress-record: ${record} has verdict ${rec.verdict || 'none'} — a no-verdict round is not ledger material`); process.exit(1); }
  const width = String(rec.width);
  const iterations = countRounds(dirname(record));
  let ledger = null;
  if (existsSync(opts.progress)) { try { ledger = readJson(opts.progress); } catch (e) { console.error(`progress-record: ${opts.progress} is not valid JSON (${e.message}) — not writing`); process.exit(1); } }
  const r = upsert(ledger, rec, record, iterations, width);
  const shown = JSON.stringify({ [r.key]: { [width]: r.block } }, null, 2);
  if (!r.written) {
    console.log(`progress-record: ${ledger ? `no page type in ${opts.progress} has archetype "${rec.slug}"` : `${opts.progress} does not exist`} — nothing written; the block for ${basename(record)} would be:\n${shown}`);
    return;
  }
  if (opts.dryRun) { console.log(`progress-record (dry-run): ${opts.progress} › ${r.pageType}.${r.key}.${width} ←\n${shown}`); return; }
  writeFileSync(opts.progress, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`progress-record: ${opts.progress} › ${r.pageType}.${r.key}.${width} ← ${rec.verdict} ${rec.pixelPct} % Δh ${rec.heightDelta}${r.key === 'breakpoints' ? ` · iterations ${iterations}${rec.overCap ? ` · overCap ${rec.overCap}` : ''}` : ` · published-origin ${rec.build?.url || ''}`} (from ${basename(record)})`);
}

const invokedDirectly = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedDirectly) main();
