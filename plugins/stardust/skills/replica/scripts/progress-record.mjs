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
 *   iterations = counted rounds OF THE RECORD'S REGIME in its gate dir
 *   (verdict PASS|FAIL, not excluded, not a live-drift recapture, same
 *   regime — a record without `regime` is a prototype round): the same rule
 *   gate.sh uses, so a published-origin round never inflates the prototype
 *   block's `iterations`.
 * Existing keys of the breakpoint block other than these (residuals,
 * justified, captureState…) are preserved.
 *
 * Ledger shapes understood (shared reader `pageTypesOf`, also used by
 * gate-ledger-lint.mjs): `{ archetypes: [ { pageType, archetype, … } ] }`
 * (the documented shape), `{ pageTypes: { <t>: { archetype, … } } }`,
 * `{ pageTypes: [ … ] }`, a top-level array of the same, or a top-level map
 * of page types. No page type with a matching `archetype` (or no ledger
 * file) → the intended block is PRINTED and the exit is 0 without writing —
 * the free-form ledger is never restructured by this script; add the page
 * type, then re-run.
 *
 * Exit codes: 0 written or dry-printed, 1 unreadable record/ledger or a
 * record without a verdict (no-verdict rounds are not ledger material).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';

const HELP = `progress-record — copy a gate round record into stardust/replica/progress.json

Usage: node progress-record.mjs <gate-record.json> [--progress <file>] [--dry-run]

Upserts <pageType>.breakpoints.<width> (prototype regime) or
<pageType>.published.<width> (published-origin regime) for the page type whose
archetype equals the record's slug; iterations are counted from the gate dir's
records of the same regime. No matching page type → prints the block, writes
nothing, exit 0.
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

/** Counted rounds of one regime in a gate dir — the same rule as gate.sh count_rounds(). */
export function countRounds(dir, regime = 'prototype') {
  return readdirSync(dir).filter((f) => /^gate-.*\.json$/.test(f)).reduce((n, f) => {
    try { const j = readJson(`${dir}/${f}`); return n + (['PASS', 'FAIL'].includes(j.verdict) && !j.excluded && !j.liveDrift && (j.regime || 'prototype') === regime ? 1 : 0); } catch { return n; }
  }, 0);
}

/** One ledger mask entry: kind, class, area % and the identifier by kind (`spec` for
 *  bands, `sel` / `src` otherwise), `asymmetric` + `side` when one side only — the
 *  shape source-fidelity-gate.md § Residual logging format names; undefined keys dropped. */
const maskEntry = ({ kind, class: cls, spec, sel, src, areaPct, asymmetric, side }) => Object.fromEntries(
  Object.entries({ kind, class: cls, spec, sel, src, areaPct, ...(asymmetric ? { asymmetric, side } : {}) }).filter(([, v]) => v !== undefined),
);

/** The ledger block for one record. */
export function blockFor(rec, recordPath, iterations) {
  const result = {
    regime: rec.regime, pixelPct: rec.pixelPct, pixelPctUnmasked: rec.pixelPctUnmasked ?? rec.pixelPct, heightDelta: rec.heightDelta, pass: rec.pass ?? rec.verdict === 'PASS',
    masks: (rec.masks || []).map(maskEntry), ref: rec.ref, at: rec.at,
    ...(rec.forced ? { forced: true } : {}), ...(rec.noiseFloor ? { noiseFloor: { pixelPct: rec.noiseFloor.pixelPct, heightDelta: rec.noiseFloor.heightDelta } } : {}),
  };
  if (rec.regime === 'published-origin') return { key: 'published', block: { result, url: rec.build?.url, artifacts: [recordPath] } };
  return { key: 'breakpoints', block: { iterations, result, ...(rec.overCap ? { overCap: rec.overCap } : {}), record: recordPath } };
}

// ---- shared ledger reader (progress-record + gate-ledger-lint) ----

const isEntry = (e) => e && typeof e === 'object' && !Array.isArray(e) && ('archetype' in e || 'breakpoints' in e || 'published' in e);

/**
 * Every page-type entry of a ledger in any documented shape.
 * Returns { shape, entries: [{ name, entry }] }; shape 'unknown' (entries [])
 * when the ledger is not § Residual logging format — callers must fail loud,
 * never treat an unreadable ledger as a pass.
 */
export function pageTypesOf(ledger) {
  const fromArray = (arr) => arr.map((e, i) => ({ name: e?.pageType || e?.name || `[${i}]`, entry: e })).filter(({ entry }) => isEntry(entry));
  const fromMap = (obj) => Object.entries(obj).filter(([, e]) => isEntry(e)).map(([k, e]) => ({ name: e.pageType || k, entry: e }));
  if (Array.isArray(ledger)) { const entries = fromArray(ledger); return { shape: entries.length || !ledger.length ? 'array' : 'unknown', entries }; }
  if (!ledger || typeof ledger !== 'object') return { shape: 'unknown', entries: [] };
  if (Array.isArray(ledger.archetypes)) return { shape: 'archetypes[]', entries: fromArray(ledger.archetypes) };
  if (Array.isArray(ledger.pageTypes)) return { shape: 'pageTypes[]', entries: fromArray(ledger.pageTypes) };
  if (ledger.pageTypes && typeof ledger.pageTypes === 'object') return { shape: 'pageTypes{}', entries: fromMap(ledger.pageTypes) };
  const entries = fromMap(ledger);
  return entries.length ? { shape: 'map', entries } : { shape: 'unknown', entries: [] };
}

/** Read a ledger file; throws on unreadable JSON. */
export function readLedger(path) { return readJson(path); }

/**
 * source-fidelity-gate.md § Residual classes, embedded: [id, permanent]. The
 * project copy under stardust/scripts/replica/ has no ../reference/ beside it,
 * so the readers fall back to this list; gate-ledger-lint.test.mjs pins parity
 * with the table (edit both together).
 */
export const RESIDUAL_CLASSES = [
  ['glyph-antialiasing', true], ['third-party-in-flow', true], ['tag-injected-tail', false], ['index-driven-content', true],
  ['photo-reencoding', true], ['live-drift', false], ['nondeterministic-live', true], ['live-data-embed', true],
  ['randomized-decoration', true], ['personalised-region', true], ['skip-link-focus', false], ['fixed-disc-at-seams', false],
  ['subpixel-layoutunit', true], ['icon-font-substitution', true], ['capture-state', false], ['motion-unassertable', false],
  ['authored-volatile-masked', false],
];

/** Parse a gate doc's § Residual classes table → Map<id, { permanent }> (empty when the text has no table). */
export function parseResidualClasses(text) {
  const out = new Map();
  const section = String(text || '').split(/^### Residual classes\s*$/m)[1] || '';
  for (const line of section.split('\n')) {
    const m = line.match(/^\| `([a-z0-9-]+)` \|(?:[^|]*\|){3}\s*([^|]*)\|\s*$/);
    if (m) out.set(m[1], { permanent: /^yes/i.test(m[2].trim()) });
  }
  return out;
}

/**
 * Residual class ids: the gate doc's § Residual classes table when
 * `reference/source-fidelity-gate.md` is beside this scripts dir (or at the
 * path given), else the embedded RESIDUAL_CLASSES (project copy). Returns
 * Map<id, { permanent }> with `.source` = 'doc' | 'embedded'; never empty.
 */
export function residualClasses(docPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'source-fidelity-gate.md')) {
  let text = null; try { text = readFileSync(docPath, 'utf8'); } catch { /* project copy: no reference dir beside the scripts */ }
  const fromDoc = text === null ? new Map() : parseResidualClasses(text);
  const out = fromDoc.size ? fromDoc : new Map(RESIDUAL_CLASSES.map(([id, permanent]) => [id, { permanent }]));
  out.source = fromDoc.size ? 'doc' : 'embedded';
  return out;
}

/** Find the page-type entry whose archetype is `slug` in any supported ledger shape. */
export function findPageType(ledger, slug) {
  return pageTypesOf(ledger).entries.find(({ entry }) => entry.archetype === slug) || null;
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
  const iterations = countRounds(dirname(record), rec.regime || 'prototype');
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
