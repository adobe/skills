#!/usr/bin/env node
/**
 * skills/replica/scripts/gate-ledger-lint.mjs — the reader of the replica
 * gate ledger (stardust/replica/progress.json): the gated-archetype
 * precondition as an instrument, not prose.
 *
 * Why: two SKILL.md files (rollout Setup step 2, migrate before any A′ render)
 * say a page type may ship only when its archetype has a gate result at every
 * configured breakpoint that passes the bar, or is over the bar only with
 * named-class residuals carrying artifacts[] and acceptedBy. Field ledgers
 * read by eye let `pass: true` next to Δh 28, six templates fan out on
 * numbers that fail 6/6 at 360, and asterisked over-bar passes ship. This script
 * applies the gate doc's existing bars to the ledger's own numbers
 * (source-fidelity-gate.md § Pass bar: pixel ≤ 10 %, |Δh| ≤ 8 px, 0
 * structural 🔴 — restated, never re-tuned) and prints one verdict line per
 * page type. A ledger shape it cannot read is not a pass.
 *
 * Usage:
 *   node skills/replica/scripts/gate-ledger-lint.mjs [options]
 *     --progress <file>    ledger (default stardust/replica/progress.json)
 *     --state <file>       stardust/state.json — roster: a type is checked when
 *                          a page of that type other than the archetype exists
 *                          (default stardust/state.json when present)
 *     --migrated <dir>     stardust/migrated — roster from _meta.json sidecars
 *                          (tier ≠ archetype) when state.json has no pages
 *     --types <a,b>        check exactly these page types
 *     --all-types          check every page type in the ledger (no roster)
 *     --project <dir>      project root the ledger's paths are relative to
 *                          (default: the directory that contains stardust/)
 *     --published          REPORTING mode: `published.<bp>` PASS / FAIL /
 *                          ungated per archetype + the coverage line; exit 0
 *     --json               machine-readable report on stdout
 *     --help
 *
 * Verdict lines:
 *   <type>: ok — <archetype> 1440 2.14 % Δh 0 · 360 3.87 % Δh 4
 *   <type>: blocked — <reason; reason> → $stardust replica <archetype>
 * Reasons: no ledger entry · never gated · missing prototype · <bp> missing ·
 *   <bp> <pct> % Δh <n> over bar, residuals unnamed / without artifacts[] /
 *   without acceptedBy / hands-off-policy on a non-permanent class ·
 *   `pass: true` typed over the bar · <bp> failClass <class> (a gate.sh build
 *   defect such as build-broken-images — no residual escapes it) · motion
 *   inventory missing.
 *   Warnings (never block): structuralRed absent (older ledger); declared
 *   prototype file not found in --project.
 *
 * Exit codes: 0 every checked type ok (or --published), 2 at least one type
 * blocked, 1 ledger unreadable / shape not § Residual logging format / bad
 * arguments. Zero network; reads JSON files and the gate doc's § Residual
 * classes table (progress-record.mjs residualClasses(); the project copy under
 * stardust/scripts/replica/ uses the embedded list, parity-tested).
 *
 * Contracts untouched: no threshold of its own (the three bars are the doc's,
 * hardcoded from § Pass bar); the published-origin gate runs AFTER delivery,
 * so `published.<bp>` is reporting only (T15.1 makes it the release check);
 * hands-off may self-accept only the table's permanent classes — enforced by
 * reading `acceptedBy`.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pageTypesOf, readLedger, residualClasses } from './progress-record.mjs';

// The bars are § Pass bar's own numbers, restated — not tunable here.
export const BARS = { pixelPct: 10, heightDelta: 8, structuralRed: 0 };
const DEFAULT_BPS = [1440, 360];

const HELP = `gate-ledger-lint — the gated-archetype precondition as an instrument

Usage: node gate-ledger-lint.mjs [--progress <file>] [--state <file>] [--migrated <dir>]
                                 [--types a,b | --all-types] [--project <dir>] [--published] [--json]

Per page type one line: "<type>: ok — …" or "<type>: blocked — <reasons> → $stardust replica <archetype>".
Bars are source-fidelity-gate.md § Pass bar (pixel ≤ ${BARS.pixelPct} %, |Δh| ≤ ${BARS.heightDelta} px, 0 structural red);
over the bar only named-class residuals with artifacts[] and acceptedBy pass (§ Residual logging format).
--published reports published.<bp> PASS / FAIL / ungated per archetype + "archetypes published-gated A of T at <bp>".
Exit: 0 ok · 2 blocked · 1 ledger unreadable or not § Residual logging format.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { progress: 'stardust/replica/progress.json', state: null, migrated: null, types: null, allTypes: false, project: null, published: false, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v == null || v.startsWith('--')) { console.error(`${a} needs a value\n\n${HELP}`); process.exit(1); } i += 1; return v; };
    if (a === '--progress') opts.progress = val();
    else if (a === '--state') opts.state = val();
    else if (a === '--migrated') opts.migrated = val();
    else if (a === '--types') opts.types = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all-types') opts.allTypes = true;
    else if (a === '--project') opts.project = val();
    else if (a === '--published') opts.published = true;
    else if (a === '--json') opts.json = true;
    else { console.error(`unknown argument ${a}\n\n${HELP}`); process.exit(1); }
  }
  return opts;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null));

/** Roster of page types with at least one non-archetype page. */
export function rosterFrom({ state, migratedDir, entries }) {
  const archetypeSlugs = new Set(entries.map(({ entry }) => entry.archetype).filter(Boolean));
  const types = new Set();
  const pages = Array.isArray(state?.pages) ? state.pages : (state?.pages && typeof state.pages === 'object' ? Object.entries(state.pages).map(([slug, p]) => ({ slug, ...p })) : []);
  for (const p of pages) if (p?.type && p.slug && !archetypeSlugs.has(p.slug) && p.tier !== 'archetype') types.add(p.type);
  if (!types.size && migratedDir && existsSync(migratedDir)) {
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === '_meta.json') { try { const m = readJson(p); const tier = m.fidelityTier ?? m.tier; if (m.type && tier && tier !== 'archetype') types.add(m.type); } catch { /* unreadable sidecar: not roster material */ } } } };
    walk(migratedDir);
  }
  return [...types];
}

/** Apply § Pass bar to one result object → { pass, reasons[], warnings[] }. */
export function judgeResult(result, bp) {
  const pct = num(result?.pixelPct ?? result?.pct);
  const dh = num(result?.heightDelta);
  const red = num(result?.structuralRed);
  const reasons = []; const warnings = [];
  if (pct == null || dh == null) return { pass: false, reasons: [`${bp} result without pixelPct/heightDelta numbers`], warnings, pct, dh };
  // a gate.sh failClass (build-broken-images) is a build defect the numbers do not show — FAIL whatever they say
  if (typeof result?.failClass === 'string' && result.failClass) reasons.push(`${bp} failClass ${result.failClass}`);
  if (pct > BARS.pixelPct) reasons.push(`${bp} ${pct} % over bar`);
  if (Math.abs(dh) > BARS.heightDelta) reasons.push(`${bp} Δh ${dh} over bar`);
  if (red == null) warnings.push(`${bp} structuralRed absent (older ledger)`);
  else if (red > BARS.structuralRed) reasons.push(`${bp} ${red} structural 🔴`);
  return { pass: reasons.length === 0, reasons, warnings, pct, dh };
}

/** Residual validity per § Residual logging format (named class + artifacts[] + acceptedBy). */
export function judgeResiduals(residuals, classes) {
  const problems = new Set();
  if (!Array.isArray(residuals) || !residuals.length) { problems.add('no residuals logged'); return [...problems]; }
  for (const r of residuals) {
    // cause = <class id | register:R-nn>[: description] — the leading token names it, the rest is free
    const cause = String(r?.cause || '').trim();
    const registered = cause.match(/^register:R-\d+(?=$|[\s:,;])/i);
    const id = registered ? registered[0] : cause.split(/[:\s]/)[0];
    const cls = classes.get(id);
    if (!registered && !cls) problems.add('residuals unnamed');
    if (!Array.isArray(r?.artifacts) || !r.artifacts.length) problems.add('residuals without artifacts[]');
    const acc = String(r?.acceptedBy || '');
    if (!acc) problems.add('residuals without acceptedBy');
    else if (/^hands-off-policy:/.test(acc)) {
      const policyCls = classes.get(acc.slice('hands-off-policy:'.length));
      if (!policyCls?.permanent || acc.slice('hands-off-policy:'.length) !== id) problems.add('hands-off-policy on a non-permanent class');
    } else if (acc !== 'user' && !/^register:R-\d+$/i.test(acc)) problems.add(`acceptedBy "${acc}" is not user | register:R-nn | hands-off-policy:<permanent class>`);
  }
  return [...problems];
}

/** One page type → { type, archetype, verdict: 'ok'|'blocked', reasons[], warnings[], numbers[] }. */
export function judgeType(name, entry, { bps, classes, projectRoot }) {
  const reasons = []; const warnings = []; const numbers = [];
  const archetype = entry?.archetype || '<archetype>';
  if (!entry) return { type: name, archetype, verdict: 'blocked', reasons: ['no ledger entry'], warnings, numbers };
  const bpBlocks = entry.breakpoints && typeof entry.breakpoints === 'object' ? entry.breakpoints : {};
  if (entry.gated === false || !Object.keys(bpBlocks).length) reasons.push('never gated');
  if (!entry.prototype) reasons.push('missing prototype');
  else if (projectRoot && !existsSync(resolve(projectRoot, entry.prototype))) warnings.push(`prototype ${entry.prototype} not found under ${projectRoot}`);
  if (!reasons.includes('never gated')) {
    for (const bp of bps) {
      const block = bpBlocks[String(bp)];
      if (!block || !block.result) { reasons.push(`${bp} missing`); continue; }
      const j = judgeResult(block.result, bp);
      warnings.push(...j.warnings);
      if (j.pct != null) numbers.push(`${bp} ${j.pct} % Δh ${j.dh}`);
      if (j.pass) continue;
      if (block.result.failClass) { reasons.push(`${bp} failClass ${block.result.failClass} — a build defect, no residual class escapes it (§ Pass bar 4)`); continue; }
      if (block.result.pass === true) reasons.push(`${bp} \`pass: true\` typed over the bar (${j.reasons.join(', ')})`);
      const rp = judgeResiduals(block.residuals, classes);
      if (rp.length) reasons.push(`${bp} ${j.pct} % Δh ${j.dh} over bar, ${rp.join(', ')}`);
    }
  }
  const motionFile = projectRoot ? join(projectRoot, 'stardust', 'replica', 'motion', `${archetype}.json`) : null;
  const motionOk = (entry.motion && typeof entry.motion === 'object' && ['observed', 'implemented', 'dead'].every((k) => Array.isArray(entry.motion[k]))) || (motionFile && existsSync(motionFile));
  if (!motionOk) reasons.push('motion inventory missing');
  return { type: name, archetype, verdict: reasons.length ? 'blocked' : 'ok', reasons, warnings, numbers };
}

/** --published reporting: per archetype per bp PASS / FAIL / ungated + coverage per bp. */
export function publishedReport(entries, bps) {
  const rows = entries.map(({ name, entry }) => {
    const pub = entry.published && typeof entry.published === 'object' ? entry.published : {};
    const perBp = bps.map((bp) => {
      const block = pub[String(bp)];
      if (!block || !block.result) return { bp, state: 'ungated' };
      const j = judgeResult(block.result, bp);
      return { bp, state: j.pass ? 'PASS' : 'FAIL', pct: j.pct, dh: j.dh };
    });
    return { type: name, archetype: entry.archetype, perBp };
  });
  const coverage = bps.map((bp) => ({ bp, gated: rows.filter((r) => r.perBp.find((x) => x.bp === bp)?.state === 'PASS').length, total: rows.length, ungated: rows.filter((r) => r.perBp.find((x) => x.bp === bp)?.state === 'ungated').map((r) => `${r.archetype}@${bp}`) }));
  return { rows, coverage };
}

function main() {
  const opts = parseArgs(process.argv);
  if (!existsSync(opts.progress)) { console.error(`gate-ledger-lint: ${opts.progress} not found — no gate ledger, nothing is gated (exit 1)`); process.exit(1); }
  let ledger; try { ledger = readLedger(opts.progress); } catch (e) { console.error(`gate-ledger-lint: cannot verify — ${opts.progress} is not valid JSON (${e.message})`); process.exit(1); }
  const { shape, entries } = pageTypesOf(ledger);
  if (shape === 'unknown' || !entries.length) { console.error(`gate-ledger-lint: cannot verify — ledger shape is not source-fidelity-gate.md § Residual logging format (archetypes[] | pageTypes{} | pageTypes[]); an unreadable ledger is never a pass`); process.exit(1); }
  const bps = (Array.isArray(ledger.breakpointsConfigured) && ledger.breakpointsConfigured.length ? ledger.breakpointsConfigured : DEFAULT_BPS).map(Number);
  const projectRoot = opts.project ? resolve(opts.project) : (() => { const d = resolve(dirname(opts.progress)); const m = d.match(/^(.*)\/stardust(\/|$)/); return m ? m[1] : dirname(dirname(d)); })();
  const classes = residualClasses(); // doc table beside the plugin scripts, else the embedded list (project copy) — never empty

  if (opts.published) {
    const rep = publishedReport(entries, bps);
    if (opts.json) { console.log(JSON.stringify({ mode: 'published', bps, ...rep }, null, 2)); return; }
    for (const r of rep.rows) console.log(`${r.type}: published: ${r.perBp.map((x) => `${x.bp} ${x.state}${x.pct != null ? ` ${x.pct} % Δh ${x.dh}` : ''}`).join(' · ')} (${r.archetype})`);
    for (const c of rep.coverage) console.log(`archetypes published-gated ${c.gated} of ${c.total} at ${c.bp}${c.ungated.length ? ` · ungated: ${c.ungated.join(' ')}` : ''}`);
    return;
  }

  let state = null;
  const statePath = opts.state || (existsSync(join(projectRoot, 'stardust', 'state.json')) ? join(projectRoot, 'stardust', 'state.json') : null);
  if (statePath) { try { state = readJson(statePath); } catch (e) { console.error(`gate-ledger-lint: cannot read ${statePath}: ${e.message}`); process.exit(1); } }
  const migratedDir = opts.migrated || join(projectRoot, 'stardust', 'migrated');
  let types;
  if (opts.types) types = opts.types;
  else if (opts.allTypes) types = entries.map(({ name }) => name);
  else { types = rosterFrom({ state, migratedDir, entries }); if (!types.length) { types = entries.map(({ name }) => name); console.error('gate-ledger-lint: no sibling roster (state.json pages / migrated sidecars) — checking every ledger type'); } }
  const byName = new Map(entries.map(({ name, entry }) => [name, entry]));
  const results = types.map((t) => judgeType(t, byName.get(t) || null, { bps, classes, projectRoot }));
  if (opts.json) console.log(JSON.stringify({ mode: 'precondition', ledger: opts.progress, shape, bps, results }, null, 2));
  else {
    for (const r of results) {
      console.log(r.verdict === 'ok' ? `${r.type}: ok — ${r.archetype} ${r.numbers.join(' · ')}` : `${r.type}: blocked — ${r.reasons.join('; ')} → $stardust replica ${r.archetype}`);
      for (const w of r.warnings) console.log(`  warn: ${w}`);
    }
    const blocked = results.filter((r) => r.verdict === 'blocked');
    console.log(`gate-ledger-lint: ${results.length} type(s) checked, ${blocked.length} blocked (${shape}, bars ≤ ${BARS.pixelPct} % · |Δh| ≤ ${BARS.heightDelta} px · 0 🔴)`);
  }
  process.exit(results.some((r) => r.verdict === 'blocked') ? 2 : 0);
}

const invokedDirectly = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedDirectly) main();
