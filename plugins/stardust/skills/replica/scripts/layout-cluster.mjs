#!/usr/bin/env node
/**
 * skills/replica/scripts/layout-cluster.mjs — cluster a page type's corpus by
 * RENDERED layout signature; one gated exemplar per cluster.
 *
 * Why: "one archetype per page type" assumes the CMS label names one layout.
 * It does not: a type of ~1,400 pages split into hundreds of section
 * signatures, and a template's "same-template" siblings carried section
 * shapes the gated archetype never had — every one passed the content diff
 * and failed the pixel gate, so most of a wave parked. The refusal that
 * fixes this is the shipped gated-archetype precondition (migrate before any
 * sibling render, rollout Setup) at CLUSTER granularity: a cluster of ≥ T
 * pages needs its own gated exemplar. This script is the instrument that
 * names the clusters; the rule lives in migrate/rollout SKILL.md and
 * fidelity-tiers.md § Sibling variance probe (Layout clusters).
 *
 * Offline: reads the crawler's settled-DOM sidecar
 * `stardust/current/pages/<slug>.html` over `file://` with EVERY request
 * aborted (zero source-site hits — a page without a sidecar is reported
 * `unclustered` and re-captured by extract, never fetched here). The
 * signature unit is `main`'s direct children (fallback `:scope > section,
 * :scope > .section` as sibling-variance.mjs uses), each reduced to
 * `firstClass|repeat groups (count×unit)|interactive|columns` — the same
 * repeat-unit grouping section-schema.mjs applies to prototypes (≥ 2
 * same-tag+class content-bearing siblings, outermost only). No computed
 * style is read (no stylesheet loads offline): the signature is a DOM fact.
 *
 * Usage:
 *   node skills/replica/scripts/layout-cluster.mjs [--root stardust] [--type <t>] [--min-cluster <n>]
 *                                                  [--k <edits>] [--json] [--write-state]
 *   node skills/replica/scripts/layout-cluster.mjs --cover <id>=<gatedId> --reason <text> [--root stardust]
 *     --root <dir>         project stardust dir (default stardust): state.json,
 *                          current/pages/*.html, replica/progress.json
 *     --type <t>           page type to cluster (default: every type in state.json);
 *                          replaces only that type's entry in layout-clusters.json
 *                          (other types and their coveredBy survive); a type with
 *                          no pages exits 1 and writes nothing
 *     --min-cluster <n>    T — a cluster with ≥ n pages needs its own gated
 *                          exemplar (default max(5, 2 % of the type), printed)
 *     --k <edits>          merge signatures within this many section edits
 *                          into one family (default 0 — exact signatures; a one-section difference IS a different layout)
 *     --json               print the cluster report as JSON instead of text
 *     --write-state        stamp state.json.pages[].layoutCluster (<id> | tail) — pages[]
 *                          or the {slug: …} map; nothing stampable exits 1, unwritten
 *     --cover <id>=<gatedId> --reason <text>
 *                          OPERATOR ONLY: record that cluster <id> is a variant
 *                          of gated cluster <gatedId> (writes coveredBy on the
 *                          cluster file). Refused when state.json.handsOff is
 *                          true — hands-off never merges clusters, it gates
 *                          the exemplar. The target must be gated.
 *     --help
 *
 * Output: stardust/current/layout-clusters.json (a corpus fact, flow-neutral —
 * the redesign flow's `direct --prep` reads it to refine the type catalog;
 * the blocking rule applies under `flow: replica` only) —
 *   { generatedAt, minCluster, k, breakpoints, types: [ { type, pages, clusters: [
 *     { id, signature[], count, pages[], exemplar, exemplarSource, gated: { <bp>: pass|accepted|fail|ungated }, coveredBy? } ],
 *     tail: [ same shape, count < T ], unclustered: [slug…] } ] }
 * and one report line per cluster: count, exemplar, gate status per
 * breakpoint, signature diff vs the archetype's cluster.
 *
 * Gate status comes from progress.json through gate-ledger-lint's own judges
 * (§ Pass bar restated, residual rule unchanged); a no-verdict round (exit
 * 124) never enters the ledger, so it reads `ungated`, never FAIL.
 *
 * Exit codes: 0 every cluster ≥ T has a gated exemplar or a recorded
 * coveredBy · 2 at least one ungated cluster ≥ T (the blocking fact; tail
 * clusters never count) · 1 error / unreadable inputs / refused --cover ·
 * 124 deadline when run under run-capped.mjs (no verdict, re-run).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { findPageType, pageTypesOf, readLedger, residualClasses } from './progress-record.mjs';
import { judgeResiduals, judgeResult } from './gate-ledger-lint.mjs';
// Dependencies through the resolution chain (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md
// § Resolution chain): plugin layout, then a project copy made as a set (harness-permissions.md § Two classes);
// a lone copy without the helper falls back to the bare import it resolved before. A miss at every link is one
// line naming preflight-runtime.mjs.
const CHAIN = await (async () => { for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return null; })();
const loadDep = (name) => (CHAIN ? CHAIN.resolveDep(name, { from: import.meta.url }) : import(name).then((m) => ('module.exports' in m ? m['module.exports'] : (m.default && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in m.default) ? m.default : m))));

// The repeat-unit grouping rule is deploy schema-checks.mjs `repeatUnitGroups` (T28.2 — the ONE rule), injected into
// the page through its `inPageCall`. Loaded by the browser driver only, so the pure halves import without deploy
// beside them: plugin layout, then the flat project copy (stardust/scripts/replica ↔ stardust/scripts/deploy).
async function loadSchemaChecks() {
  for (const c of ['../../deploy/scripts/schema-checks.mjs', '../deploy/schema-checks.mjs']) {
    try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  throw new Error('deploy schema-checks.mjs not found (looked in ../../deploy/scripts/ and ../deploy/) — run from the plugin tree or copy skills/deploy/scripts/ beside this one as a set (harness-permissions.md § Two classes)');
}

const DEFAULT_BPS = [1440, 360];
export const DEFAULT_K = 0;

const HELP = `layout-cluster — cluster a page type by rendered layout signature; one gated exemplar per cluster ≥ T

Usage: node layout-cluster.mjs [--root stardust] [--type <t>] [--min-cluster <n>] [--k <edits>] [--json] [--write-state]
       node layout-cluster.mjs --cover <id>=<gatedId> --reason <text> [--root stardust]
  --root <dir>          stardust dir (state.json, current/pages/*.html, replica/progress.json)
  --type <t>            page type (default: every type)
  --min-cluster <n>     T, clusters with ≥ n pages need a gated exemplar (default max(5, 2 %))
  --k <edits>           merge signatures within k section edits (default ${DEFAULT_K})
  --json                JSON report on stdout
  --write-state         stamp state.json.pages[].layoutCluster
  --cover <id>=<gid> --reason <text>   operator-only coveredBy record (refused under handsOff)
  --help                this text

Offline over the crawler sidecar (file://, every request aborted — zero source hits).
Exit: 0 all clusters ≥ T gated/covered · 2 ungated cluster(s) ≥ T · 1 error · 124 deadline (run-capped).`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { root: 'stardust', type: null, minCluster: null, k: DEFAULT_K, json: false, writeState: false, cover: null, reason: null };
  const fail = (m) => { console.error(`layout-cluster: ${m}\n\n${HELP}`); process.exit(1); };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v === undefined || String(v).startsWith('--')) fail(`${a} needs a value`); i += 1; return v; };
    if (a === '--root') opts.root = val();
    else if (a === '--type') opts.type = val();
    else if (a === '--min-cluster') { opts.minCluster = Number(val()); if (!Number.isInteger(opts.minCluster) || opts.minCluster < 2) fail('--min-cluster needs an integer ≥ 2'); }
    else if (a === '--k') { opts.k = Number(val()); if (!Number.isInteger(opts.k) || opts.k < 0) fail('--k needs an integer ≥ 0'); }
    else if (a === '--json') opts.json = true;
    else if (a === '--write-state') opts.writeState = true;
    else if (a === '--cover') { const m = String(val() || '').match(/^([\w-]+)=([\w-]+)$/); if (!m) fail('--cover needs <id>=<gatedId>'); opts.cover = { id: m[1], gatedId: m[2] }; }
    else if (a === '--reason') opts.reason = val();
    else fail(`unknown flag ${a}`);
  }
  if (opts.cover && !String(opts.reason || '').trim()) fail('--cover needs --reason <text> (a recorded operator judgement, never implicit)');
  return opts;
}

// ------------------------------------------------------------ pure functions

/** T = max(5, 2 % of the type) — a selection threshold, printed and overridable; never a pass bar. */
export function defaultMinCluster(pageCount) { return Math.max(5, Math.ceil(pageCount * 0.02)); }

/**
 * One section's facts → one signature token.
 * facts: { tag, firstClass, groups: [{ count, unit: { headings, ctas, imgs, textRuns } }], interactive, columns }
 * Counts above 6 collapse to "n": a list of 17 vs 24 items is the same layout; 3 vs 4 columns is not.
 */
export function tokenOf(f) {
  const n = (c) => (c > 6 ? 'n' : String(c));
  const groups = (f.groups || []).map((g) => `${n(g.count)}x${g.unit.headings ? 'h' : ''}${g.unit.ctas ? 'c' : ''}${g.unit.imgs ? 'i' : ''}${g.unit.textRuns ? 't' : ''}`).sort().join('+');
  return [f.firstClass || f.tag || 'div', groups ? `g:${groups}` : '', f.interactive ? 'i' : '', f.columns >= 2 ? `c${n(f.columns)}` : ''].filter(Boolean).join('|');
}

/** sectionFacts[] → signature tokens[] (one per top-level section, in order). */
export function signatureOf(sectionFacts) { return (sectionFacts || []).map(tokenOf); }

/** Token-level Levenshtein distance between two signatures. */
export function editDistance(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/**
 * Human diff of two signatures from the Levenshtein alignment (one inserted
 * section is ONE edit, not a cascade of substitutions): `+token @i` (position
 * in `to`) · `−token @i` (position in `from`) · `a → b @i` (position in `to`).
 * `out.length === editDistance(from, to)`.
 */
export function signatureDiff(from, to) {
  const m = from.length; const n = to.length;
  const d = Array.from({ length: m + 1 }, (_, i) => { const row = new Array(n + 1).fill(0); row[0] = i; return row; });
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (from[i - 1] === to[j - 1] ? 0 : 1));
  const out = [];
  let i = m; let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && from[i - 1] === to[j - 1] && d[i][j] === d[i - 1][j - 1]) { i--; j--; continue; }
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) { out.push(`${from[i - 1]} → ${to[j - 1]} @${j - 1}`); i--; j--; continue; }
    if (j > 0 && d[i][j] === d[i][j - 1] + 1) { out.push(`+${to[j - 1]} @${j - 1}`); j--; continue; }
    out.push(`−${from[i - 1]} @${i - 1}`); i--;
  }
  return out.reverse();
}

/**
 * Group pages by exact signature, then merge signatures within k edits into
 * families (largest group first; a group joins the first family whose
 * representative is ≤ k edits away). Returns clusters sorted by count desc,
 * each { signature (representative), pages[], count }.
 * sigs: [{ slug, signature: string[] }]
 */
export function clusterSignatures(sigs, { k = DEFAULT_K } = {}) {
  const exact = new Map();
  for (const s of sigs) { const key = s.signature.join(' > '); if (!exact.has(key)) exact.set(key, { signature: s.signature, pages: [] }); exact.get(key).pages.push(s.slug); }
  const groups = [...exact.values()].sort((a, b) => b.pages.length - a.pages.length || a.signature.join().localeCompare(b.signature.join()));
  const families = [];
  for (const g of groups) {
    const home = k > 0 ? families.find((f) => editDistance(f.signature, g.signature) <= k) : null;
    if (home) { home.pages.push(...g.pages); home.variants.push(g.signature); }
    else families.push({ signature: g.signature, pages: [...g.pages], variants: [] });
  }
  return families.map((f) => ({ signature: f.signature, variants: f.variants, pages: f.pages, count: f.pages.length })).sort((a, b) => b.count - a.count);
}

/** Exemplar: the archetype when it belongs; else the page whose weight is the cluster's median. */
export function pickExemplar(pages, weights, archetype) {
  if (archetype && pages.includes(archetype)) return { exemplar: archetype, exemplarSource: 'archetype' };
  const sorted = [...pages].sort((a, b) => (weights[a] ?? 0) - (weights[b] ?? 0) || a.localeCompare(b));
  return { exemplar: sorted[Math.floor((sorted.length - 1) / 2)], exemplarSource: 'median' };
}

/**
 * Gate status of a slug per breakpoint from the ledger, using gate-ledger-lint's
 * judges: pass | accepted (over the bar, residuals valid) | fail | ungated.
 * A slug with no ledger entry is ungated at every bp (never FAIL).
 */
export function gateStatus(ledger, slug, bps, classes) {
  const hit = ledger ? findPageType(ledger, slug) : null;
  const out = {};
  for (const bp of bps) {
    const block = hit?.entry?.breakpoints?.[String(bp)];
    if (!block?.result) { out[bp] = 'ungated'; continue; }
    const j = judgeResult(block.result, bp);
    if (j.pass) out[bp] = 'pass';
    else out[bp] = judgeResiduals(block.residuals, classes).length ? 'fail' : 'accepted';
  }
  return out;
}
export const isGated = (status) => Object.values(status).length > 0 && Object.values(status).every((s) => s === 'pass' || s === 'accepted');

/**
 * The whole report for one type from per-page facts — no browser, no files.
 * pages: [{ slug, facts: sectionFacts[] | null (unclustered), weight }]
 */
export function clusterType({ type, pages, ledger, bps = DEFAULT_BPS, classes = new Map(), minCluster = null, k = DEFAULT_K, previous = null }) {
  const clustered = pages.filter((p) => Array.isArray(p.facts));
  const unclustered = pages.filter((p) => !Array.isArray(p.facts)).map((p) => p.slug);
  const T = minCluster ?? defaultMinCluster(pages.length);
  const weights = Object.fromEntries(clustered.map((p) => [p.slug, p.weight ?? 0]));
  const typeEntry = ledger ? pageTypesOf(ledger).entries.find((e) => e.name === type) : null;
  const archetype = typeEntry?.entry?.archetype || null;
  const fams = clusterSignatures(clustered.map((p) => ({ slug: p.slug, signature: signatureOf(p.facts) })), { k });
  const prevCovers = new Map((previous?.clusters || []).filter((c) => c.coveredBy).map((c) => [c.signature.join(' > '), c.coveredBy]));
  const all = fams.map((f, i) => {
    const { exemplar, exemplarSource } = pickExemplar(f.pages, weights, archetype);
    const gated = gateStatus(ledger, exemplar, bps, classes);
    const row = { id: `c${i + 1}`, signature: f.signature, variants: f.variants, count: f.count, pages: f.pages, exemplar, exemplarSource, gated };
    const cov = prevCovers.get(f.signature.join(' > '));
    if (cov) row.coveredBy = cov;
    return row;
  });
  const clusters = all.filter((c) => c.count >= T);
  const tail = all.filter((c) => c.count < T);
  const archetypeCluster = all.find((c) => c.pages.includes(archetype)) || clusters[0] || null;
  for (const c of all) c.diffVsArchetype = archetypeCluster && c !== archetypeCluster ? signatureDiff(archetypeCluster.signature, c.signature) : [];
  const ungated = clusters.filter((c) => !isGated(c.gated) && !c.coveredBy);
  return { type, pages: pages.length, minCluster: T, k, archetype, archetypeCluster: archetypeCluster?.id || null, clusters, tail, unclustered, ungated: ungated.map((c) => c.id) };
}

/** Text report for one type. */
export function renderType(r, bps) {
  const gatedCount = r.clusters.filter((c) => isGated(c.gated)).length;
  const lines = [`type ${r.type}: ${r.pages} pages, ${r.clusters.length} cluster(s) ≥ ${r.minCluster} (gated ${gatedCount}${r.clusters.filter((c) => c.coveredBy).length ? `, covered ${r.clusters.filter((c) => c.coveredBy).length}` : ''}), tail ${r.tail.reduce((n, c) => n + c.count, 0)} page(s)${r.unclustered.length ? `, unclustered ${r.unclustered.length} (no sidecar — re-capture with extract)` : ''}; min-cluster ${r.minCluster}${r.minClusterSource === 'default' ? ' (default max(5, 2 %); --min-cluster overrides)' : ''}`];
  const g = (c) => bps.map((bp) => `${bp} ${{ pass: '✓', accepted: '✓*', fail: '✗', ungated: '—' }[c.gated[bp]] || '—'}`).join(' ');
  for (const c of r.clusters) {
    const status = c.coveredBy ? `covered by ${c.coveredBy.cluster} (${c.coveredBy.reason})` : isGated(c.gated) ? `gated ${g(c)}` : `ungated ${g(c)} → $stardust replica ${c.exemplar}`;
    lines.push(`  ${c.id}  ${String(c.count).padStart(4)} pages  exemplar ${c.exemplar} (${c.exemplarSource})  ${status}${c.id === r.archetypeCluster ? '  ← archetype\'s cluster' : ''}`);
    lines.push(`        sig: ${c.signature.join(' > ')}${c.variants.length ? `  (+${c.variants.length} merged variant signature(s))` : ''}`);
    if (c.diffVsArchetype.length) lines.push(`        vs ${r.archetypeCluster}: ${c.diffVsArchetype.join('; ')}`);
  }
  for (const c of r.tail) lines.push(`  tail ${String(c.count).padStart(3)} page(s)  ${c.pages.slice(0, 3).join(', ')}${c.count > 3 ? ', …' : ''}  sig: ${c.signature.join(' > ')}${c.diffVsArchetype.length ? `  (vs ${r.archetypeCluster}: ${c.diffVsArchetype.join('; ')})` : ''}`);
  if (r.tail.length) lines.push('  tail pages carry layoutCluster: tail — never blocked, never silently passed: they must be eligible for the seeded published-origin sample (rollout sweep-protocol).');
  if (r.ungated.length) lines.push(`✗ ${r.ungated.length} ungated cluster(s) ≥ ${r.minCluster} in type ${r.type} — under flow: replica nothing in ${r.ungated.join(', ')} renders or publishes (coverage gap: ungated cluster); gate each exemplar (Phase 3–4), or — operator only, after reading the signature diff — --cover <id>=<gatedId> --reason <text>.`);
  else lines.push(`✓ every cluster ≥ ${r.minCluster} in type ${r.type} has a gated exemplar${r.clusters.some((c) => c.coveredBy) ? ' or a recorded coveredBy' : ''}.`);
  return lines.join('\n');
}

/** --cover: mutate a cluster file; throws with a reason when refused. */
export function applyCover(clusterFile, { id, gatedId, reason, handsOff = false, by = 'operator' }) {
  if (handsOff) throw new Error('refused: state.json.handsOff is true — hands-off never merges clusters; gate the exemplar ($stardust replica <exemplar>) within the iteration cap instead');
  const all = (clusterFile.types || []).flatMap((t) => [...t.clusters, ...t.tail].map((c) => ({ c, t })));
  const target = all.find(({ c }) => c.id === id); const gated = all.find(({ c }) => c.id === gatedId);
  if (!target) throw new Error(`cluster ${id} not in the cluster file`);
  if (!gated) throw new Error(`cluster ${gatedId} not in the cluster file`);
  if (target.t.type !== gated.t.type) throw new Error(`refused: ${id} (${target.t.type}) and ${gatedId} (${gated.t.type}) are different page types`);
  if (!isGated(gated.c.gated)) throw new Error(`refused: cover target ${gatedId} is not gated at every breakpoint (${JSON.stringify(gated.c.gated)}) — a cluster can only be covered by a GATED one`);
  target.c.coveredBy = { cluster: gatedId, reason: reason.trim(), by, at: new Date().toISOString(), signatureDiff: signatureDiff(gated.c.signature, target.c.signature) };
  target.t.ungated = target.t.clusters.filter((c) => !isGated(c.gated) && !c.coveredBy).map((c) => c.id);
  return target;
}

/**
 * --write-state: stamp state.json.pages[].layoutCluster (<id> | tail) IN PLACE
 * for both page shapes — pages[] and the pages{slug: …} map (the map used to be
 * copied for reading, so the stamp landed on the copy and nothing was written).
 * Returns the number of pages stamped.
 */
export function stampState(state, types) {
  const stamp = new Map();
  for (const t of types || []) { for (const c of t.clusters || []) for (const s of c.pages) stamp.set(s, c.id); for (const c of t.tail || []) for (const s of c.pages) stamp.set(s, 'tail'); }
  let n = 0;
  if (Array.isArray(state.pages)) { for (const p of state.pages) if (p && stamp.has(p.slug)) { p.layoutCluster = stamp.get(p.slug); n++; } }
  else if (state.pages && typeof state.pages === 'object') { for (const [slug, p] of Object.entries(state.pages)) if (p && typeof p === 'object' && stamp.has(slug)) { p.layoutCluster = stamp.get(slug); n++; } }
  return n;
}

/**
 * Merge one run's report into the previous cluster file: a `--type <t>` run
 * replaces only that type's entry; every other type (and its coveredBy
 * records) survives. Order: previous types first (replaced in place), new
 * types appended. No previous file → the report as is.
 */
export function mergeReport(previous, report) {
  const prevTypes = Array.isArray(previous?.types) ? previous.types : [];
  const fresh = new Map((report.types || []).map((t) => [t.type, t]));
  const types = prevTypes.map((t) => (fresh.has(t.type) ? fresh.get(t.type) : t));
  for (const t of report.types || []) if (!prevTypes.some((p) => p.type === t.type)) types.push(t);
  return { ...report, types };
}

/**
 * layout-clusters.json (+ its sibling state.json) → { archetype, siblings } URLs:
 * archetype = the archetype cluster's exemplar; siblings = every other cluster's
 * exemplar (clusters ≥ T only — tail pages are the seeded sample's business).
 * Used by sibling-variance.mjs --from-clusters; returns null when no pair can be formed.
 */
export function urlsFromClusters(file, type = null, stateFile = null) {
  const clusters = JSON.parse(readFileSync(file, 'utf8'));
  const statePath = stateFile || join(dirname(resolve(file)), '..', 'state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { pages: [] };
  const pages = Array.isArray(state.pages) ? state.pages : Object.entries(state.pages || {}).map(([slug, p]) => ({ slug, ...p }));
  const urlOf = (slug) => pages.find((p) => p.slug === slug)?.url || null;
  const types = (clusters.types || []).filter((t) => !type || t.type === type);
  for (const t of types) {
    const arch = t.clusters.find((c) => c.id === t.archetypeCluster) || t.clusters[0];
    if (!arch || !urlOf(arch.exemplar)) continue;
    const others = t.clusters.filter((c) => c !== arch && urlOf(c.exemplar));
    if (!others.length) continue;
    return { type: t.type, archetypeCluster: arch.id, archetypeSlug: arch.exemplar, archetype: urlOf(arch.exemplar), siblingSlugs: others.map((c) => `${c.exemplar} (${c.id}${c.coveredBy ? `, covered by ${c.coveredBy.cluster}` : ''})`), siblings: others.map((c) => urlOf(c.exemplar)) };
  }
  return null;
}

// ------------------------------------------------------------ in-page facts

/* eslint-disable no-undef */
/** Runs IN the page (Playwright evaluate). Returns { facts: sectionFacts[], weight }. */
export function extractFacts() {
  const ATOMS = ['LI', 'A', 'SPAN', 'P', 'IMG', 'SVG', 'PATH', 'BUTTON', 'BR', 'PICTURE', 'SOURCE'];
  const SKIP = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META'];
  const main = document.querySelector('main');
  let sections = main ? [...main.children] : [...document.body.children].filter((el) => !['HEADER', 'FOOTER', 'NAV'].includes(el.tagName));
  sections = sections.filter((el) => !SKIP.includes(el.tagName) && (el.children.length || (el.textContent || '').trim()));
  if (main && !sections.length) sections = [...main.querySelectorAll(':scope > section, :scope > .section')];
  /* global repeatUnitGroups -- in scope via inPageCall (deploy schema-checks.mjs, the ONE grouping rule) */
  const groupsOf = (sec) => repeatUnitGroups(sec, { skip: SKIP, atoms: ATOMS.filter((t) => t !== 'LI') }).map(({ count, unit, tag, depth }) => ({ count, unit, tag, depth }));
  const facts = sections.map((sec) => {
    const groups = groupsOf(sec);
    // columns = the outermost repeat group (depth ≤ 2) of 2–6 non-stacked units (lists, details, table rows stack by nature)
    const cols = groups.filter((g) => g.depth <= 2 && g.count >= 2 && g.count <= 6 && !['LI', 'DETAILS', 'TR', 'DT', 'DD', 'OPTION'].includes(g.tag)).sort((a, b) => a.depth - b.depth)[0];
    return {
      tag: sec.tagName.toLowerCase(),
      firstClass: String(sec.className || '').trim().split(/\s+/).filter((x) => x && x !== 'section')[0] || '',
      groups: groups.map(({ count, unit }) => ({ count, unit })),
      interactive: !!sec.querySelector('button, [aria-expanded], [role=tab], [role=tablist], summary, form, input, select, textarea, video, iframe, [aria-haspopup]'),
      columns: cols ? cols.count : 1,
    };
  });
  return { facts, weight: (main || document.body).textContent.replace(/\s+/g, ' ').trim().length };
}
/* eslint-enable no-undef */

// -------------------------------------------------------------------- driver

async function factsForPages(slugs, pagesDir) {
  const { repeatUnitGroups, inPageCall } = await loadSchemaChecks();
  const { chromium } = await loadDep('playwright');
  const browser = await chromium.launch();
  const out = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    // zero network: only the file:// document itself is allowed through
    await ctx.route('**/*', (route) => { const req = route.request(); if (req.url().startsWith('file://') && req.resourceType() === 'document') route.continue(); else route.abort(); });
    const page = await ctx.newPage();
    let n = 0;
    for (const slug of slugs) {
      const file = join(pagesDir, `${slug}.html`);
      if (!existsSync(file)) { out[slug] = null; continue; }
      await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      out[slug] = await page.evaluate(inPageCall(extractFacts, null, { repeatUnitGroups }));
      n++;
      if (n % 100 === 0) console.error(`layout-cluster: ${n}/${slugs.length} pages`);
    }
  } finally { await browser.close(); }
  return out;
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

async function main() {
  const opts = parseArgs(process.argv);
  const root = resolve(opts.root);
  const statePath = join(root, 'state.json'); const clusterPath = join(root, 'current', 'layout-clusters.json');
  const ledgerPath = join(root, 'replica', 'progress.json');
  if (!existsSync(statePath)) { console.error(`layout-cluster: ${statePath} not found — run extract first`); process.exit(1); }
  const state = readJson(statePath);
  const ledger = existsSync(ledgerPath) ? readLedger(ledgerPath) : null;
  const bps = Array.isArray(ledger?.breakpointsConfigured) && ledger.breakpointsConfigured.length ? ledger.breakpointsConfigured : DEFAULT_BPS;

  if (opts.cover) {
    if (!existsSync(clusterPath)) { console.error(`layout-cluster: ${clusterPath} not found — run the clustering first`); process.exit(1); }
    const file = readJson(clusterPath);
    let hit;
    try { hit = applyCover(file, { ...opts.cover, reason: opts.reason, handsOff: state.handsOff === true }); }
    catch (e) { console.error(`layout-cluster --cover: ${e.message}`); process.exit(1); }
    writeFileSync(clusterPath, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`covered: ${hit.c.id} (${hit.c.count} pages, exemplar ${hit.c.exemplar}) by ${opts.cover.gatedId} — ${hit.c.coveredBy.reason}\n  signature diff: ${hit.c.coveredBy.signatureDiff.join('; ') || 'none'}\n  journal line: "layout cluster ${hit.c.id} (${hit.t.type}, ${hit.c.count} pages) covered by ${opts.cover.gatedId}: ${hit.c.coveredBy.reason} — verify with sibling-variance.mjs --from-clusters ${clusterPath} (variant-class deltas only)"`);
    process.exit(hit.t.ungated.length ? 2 : 0);
  }

  const pages = Array.isArray(state.pages) ? state.pages : Object.entries(state.pages || {}).map(([slug, p]) => ({ slug, ...p }));
  const known = [...new Set(pages.map((p) => p.type).filter(Boolean))];
  const types = opts.type ? [opts.type] : known;
  if (!types.length) { console.error('layout-cluster: state.json has no typed pages'); process.exit(1); }
  if (opts.type && !pages.some((p) => p.type === opts.type && p.slug)) { console.error(`layout-cluster: no pages of type ${opts.type} in state.json (types: ${known.join(', ') || 'none'}) — nothing written`); process.exit(1); }
  const classes = residualClasses();
  const previous = existsSync(clusterPath) ? readJson(clusterPath) : null;
  const report = { generatedAt: new Date().toISOString(), root: opts.root, minCluster: opts.minCluster, k: opts.k, breakpoints: bps, types: [] };
  let blocking = 0;
  for (const type of types) {
    const slugs = pages.filter((p) => p.type === type && p.slug).map((p) => p.slug);
    if (!slugs.length) { console.error(`layout-cluster: no pages of type ${type} in state.json`); continue; }
    const facts = await factsForPages(slugs, join(root, 'current', 'pages'));
    const r = clusterType({ type, pages: slugs.map((s) => ({ slug: s, facts: facts[s]?.facts ?? null, weight: facts[s]?.weight ?? 0 })), ledger, bps, classes, minCluster: opts.minCluster, k: opts.k, previous: previous?.types?.find((t) => t.type === type) || null });
    r.minClusterSource = opts.minCluster ? 'flag' : 'default';
    report.types.push(r);
    blocking += r.ungated.length;
    if (!opts.json) console.log(renderType(r, bps));
  }
  writeFileSync(clusterPath, `${JSON.stringify(mergeReport(previous, report), null, 2)}\n`);
  let stamped = 0;
  if (opts.writeState) {
    stamped = stampState(state, report.types);
    if (!stamped) { console.error(`layout-cluster: --write-state stamped nothing — state.json.pages is neither pages[] nor a {slug: …} map with these slugs; state.json not written`); process.exit(1); }
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(`→ ${clusterPath}${opts.writeState ? ` · state.json pages[].layoutCluster stamped (${stamped})` : ''}`);
  process.exit(blocking ? 2 : 0);
}

const isMain = (() => { try { return realpathSync(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`layout-cluster error: ${e.message}`); process.exit(1); });
