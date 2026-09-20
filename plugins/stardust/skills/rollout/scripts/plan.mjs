#!/usr/bin/env node
/**
 * rollout/plan.mjs — the dedup-driven delivery + conversion plan (Phase 2).
 *
 * This is what makes block dedup a FIRST-CLASS driving step. It orders pages
 * representative-first per template, walks them once, and assigns each distinct
 * block a single conversion point: the first page in delivery order that uses it
 * CONVERTS it; every later page REUSES it by its canonical EDS name. The per-page
 * convert/reuse lists are exactly the input to `deploy`'s Step-7 brief
 * ("Existing blocks — REUSE, do not recreate: …"), so each block converts once
 * WITHOUT changing deploy.
 *
 * Chrome (header/nav/footer) loads as site-wide authored documents (/nav, /footer), so it is listed
 * once under `fragments`, not per page.
 *
 * Layout clusters (T28.1, `flow: replica`): when `stardust/current/layout-clusters.json` exists
 * (replica layout-cluster.mjs --write-state) a cluster ≥ T with no exemplar gated at every configured
 * breakpoint and no `coveredBy` is a COVERAGE GAP — its pages' steps carry `coverageGap: "ungated cluster
 * <id> (<n> pages)"` + the exemplar, the plan prints one `coverage gap:` line per cluster with
 * `$stardust replica <exemplar>`, and the coverage line `clusters gated C of K · ungated: <id (n)> …`
 * (rollout/SKILL.md Setup 2). Nothing here renders, fans out or PUTs a gap page — the drivers read the
 * flag; the sample stratum lives in gate-publish.mjs drawSample (cluster exemplars always drawn).
 *
 * Writes stardust/rollout/plan.json and prints a readable plan.
 * `--sample <n>` prints the first n pages per template in delivery order
 * (representative first) as `slug<TAB>path<TAB>templateId` and exits without
 * writing — an authoring-order listing. The gate sample of the site-scale sweep
 * is NOT this head: `gate-publish.mjs --sample <n> --seed <s> --exclude …`
 * draws it seeded at random (reference/sweep-protocol.md step 2).
 * Usage: node skills/rollout/scripts/plan.mjs [--out <rolloutDir>] [--pending-only] [--sample <n>]
 */
import { join } from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';

const OUT = (() => { const i = process.argv.indexOf('--out'); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'stardust/rollout'; })();
const PENDING_ONLY = process.argv.includes('--pending-only');
const SAMPLE = (() => { const i = process.argv.indexOf('--sample'); if (i === -1) return 0; const n = Number(process.argv[i + 1]); if (!Number.isInteger(n) || n < 1) { console.error('rollout plan: --sample needs a positive integer'); process.exit(1); } return n; })();
if (process.argv.includes('--help')) { console.log('Usage: node skills/rollout/scripts/plan.mjs [--out <rolloutDir>] [--pending-only] [--sample <n>]'); process.exit(0); }

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
const tmplDoc = readJSON(join(OUT, 'coverage', 'templates.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
if (!pagesDoc || !blocksDoc) {
  console.error('rollout plan: run inventory.mjs then blocks.mjs first.');
  process.exit(1);
}
const pages = pagesDoc.pages || [];
const bySlug = new Map(pages.map((p) => [p.slug, p]));
const blockById = new Map((blocksDoc.blocks || []).map((b) => [b.id, b]));
const edsNameOf = (id) => { const b = blockById.get(id); return b ? b.delivery.edsBlockName : null; };
const isChrome = (id) => { const b = blockById.get(id); return b && b.kind === 'chrome'; };

// --- Delivery order: representative-first per template ---------------------------
const templates = (tmplDoc && tmplDoc.templates) || [];
// Stable, deterministic template order: most pages first (unblocks the most), then id.
const orderedTemplates = [...templates].sort((a, b) => (b.pageCount - a.pageCount) || a.id.localeCompare(b.id));

const order = [];
const seen = new Set();
for (const t of orderedTemplates) {
  const rep = t.representativeSlug;
  const sibs = (t.pages || []).filter((s) => s !== rep).sort();
  for (const s of [rep, ...sibs]) {
    if (s && bySlug.has(s) && !seen.has(s)) { seen.add(s); order.push(s); }
  }
}
// Any pages not covered by a template grouping (shouldn't happen) appended.
for (const p of pages) if (!seen.has(p.slug)) { seen.add(p.slug); order.push(p.slug); }

// --sample <n>: the template sample (n per template, representative first), no writes.
if (SAMPLE) {
  const perTemplate = new Map();
  for (const slug of order) {
    const p = bySlug.get(slug);
    if (p.delivery && p.delivery.status === 'content-pending') continue; // no document to gate
    const t = p.templateId || 'untyped';
    const list = perTemplate.get(t) || [];
    if (list.length < SAMPLE) { list.push(p); perTemplate.set(t, list); }
  }
  for (const [, list] of perTemplate) for (const p of list) console.log(`${p.slug}\t${p.path}\t${p.templateId || 'untyped'}`);
  console.error(`rollout plan --sample ${SAMPLE}: ${[...perTemplate.values()].reduce((n, l) => n + l.length, 0)} pages across ${perTemplate.size} templates`);
  process.exit(0);
}

// --- Layout clusters → coverage gaps (read, never judged here) ---------------------
export function clusterGaps(doc) {
  const out = { total: 0, gated: 0, ungated: [], bySlug: new Map() };
  if (!doc || !Array.isArray(doc.types)) return out;
  const bps = Array.isArray(doc.breakpoints) && doc.breakpoints.length ? doc.breakpoints.map(String) : null;
  for (const t of doc.types) for (const c of t.clusters || []) {
    out.total += 1;
    const gated = c.gated || {};
    const keys = bps || Object.keys(gated);
    const ok = c.coveredBy || (keys.length > 0 && keys.every((W) => ['pass', 'accepted'].includes(gated[W])));
    if (ok) { out.gated += 1; continue; }
    const gap = { id: c.id, type: t.type, count: c.count ?? (c.pages || []).length, exemplar: c.exemplar || null };
    out.ungated.push(gap);
    for (const slug of c.pages || []) out.bySlug.set(slug, gap);
  }
  return out;
}
const clustersDoc = readJSON(join(OUT, '..', 'current', 'layout-clusters.json'), null);
const gaps = clusterGaps(clustersDoc);

// --- Walk once, assign each block a single conversion point -----------------------
const converted = new Map(); // block id -> slug that converts it
const steps = [];
for (const slug of order) {
  const p = bySlug.get(slug);
  const modules = (p.blocks || []).filter((id) => !isChrome(id));
  const convert = [];
  const reuse = [];
  for (const id of modules) {
    if (!converted.has(id)) { converted.set(id, slug); convert.push({ id, edsBlockName: edsNameOf(id) }); }
    else reuse.push({ id, edsBlockName: edsNameOf(id), convertedBy: converted.get(id) });
  }
  const pending = ['pending', 'stale', 'failed'].includes(p.delivery && p.delivery.status);
  const gap = gaps.bySlug.get(slug);
  steps.push({ slug, path: p.path, templateId: p.templateId, status: p.delivery.status, isRepresentative: convert.length > 0, convert, reuse, ...(gap ? { coverageGap: `ungated cluster ${gap.id} (${gap.count} pages)`, layoutCluster: gap.id, exemplar: gap.exemplar } : {}) });
}

const fragments = (blocksDoc.blocks || []).filter((b) => b.kind === 'chrome')
  .map((b) => ({ id: b.id, blockPath: b.delivery.blockPath, status: b.delivery.status }));

const now = new Date().toISOString();
const plan = {
  _provenance: { writtenBy: 'stardust:rollout/plan', writtenAt: now, readArtifacts: [join(OUT, 'coverage')], stardustVersion: (pagesDoc._provenance || {}).stardustVersion || '0.0.0' },
  generatedAt: now,
  fragments,
  ...(clustersDoc ? { clusters: { total: gaps.total, gated: gaps.gated, ungated: gaps.ungated } } : {}),
  deliveryOrder: steps.map((s) => s.slug),
  steps: PENDING_ONLY ? steps.filter((s) => ['pending', 'stale', 'failed'].includes(s.status)) : steps,
};
writeJSON(join(OUT, 'plan.json'), plan);

// --- Readable plan ---------------------------------------------------------------
console.log(`rollout plan → ${join(OUT, 'plan.json')}`);
console.log('='.repeat(64));
if (fragments.length) console.log(`Fragments (site-wide, deliver once): ${fragments.map((f) => `${f.id}${f.status === 'pending' ? '' : `[${f.status}]`}`).join(', ')}`);
console.log(`Delivery order (representative-first), ${steps.length} pages:\n`);
const show = PENDING_ONLY ? steps.filter((s) => ['pending', 'stale', 'failed'].includes(s.status)) : steps;
for (const s of show) {
  const tag = s.isRepresentative ? '◆ rep ' : '  sib ';
  const conv = s.convert.length ? `convert: ${s.convert.map((c) => c.edsBlockName).join(', ')}` : '';
  const reuse = s.reuse.length ? `reuse: ${s.reuse.map((c) => c.edsBlockName).join(', ')}` : '';
  console.log(`${tag}${s.slug.padEnd(28)} ${s.status.padEnd(10)} ${[conv, reuse].filter(Boolean).join('  |  ')}${s.coverageGap ? `  ⛔ coverage gap: ${s.coverageGap}` : ''}`);
}
if (clustersDoc) {
  for (const g of gaps.ungated) console.log(`coverage gap: ungated cluster ${g.id} (${g.count} pages) — ${g.type}: render nothing in it; gate the exemplar first: $stardust replica ${g.exemplar || '<exemplar>'}`);
  console.log(`clusters gated ${gaps.gated} of ${gaps.total}${gaps.ungated.length ? ` · ungated: ${gaps.ungated.map((g) => `${g.id} (${g.count})`).join(' ')}` : ''}`);
}
const totalConvert = steps.reduce((n, s) => n + s.convert.length, 0);
console.log(`\nEach of ${totalConvert} distinct module blocks converts on exactly ONE page; the rest reuse.`);
