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
 * Chrome (header/nav/footer) loads as site-wide static fragments, so it is listed
 * once under `fragments`, not per page.
 *
 * Writes stardust/rollout/plan.json and prints a readable plan.
 * Usage: node skills/rollout/scripts/plan.mjs [--out <rolloutDir>] [--pending-only]
 */
import { join } from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';

const OUT = (() => { const i = process.argv.indexOf('--out'); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'stardust/rollout'; })();
const PENDING_ONLY = process.argv.includes('--pending-only');

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
  steps.push({ slug, path: p.path, templateId: p.templateId, status: p.delivery.status, isRepresentative: convert.length > 0, convert, reuse });
}

const fragments = (blocksDoc.blocks || []).filter((b) => b.kind === 'chrome')
  .map((b) => ({ id: b.id, blockPath: b.delivery.blockPath, status: b.delivery.status }));

const now = new Date().toISOString();
const plan = {
  _provenance: { writtenBy: 'stardust:rollout/plan', writtenAt: now, readArtifacts: [join(OUT, 'coverage')], stardustVersion: (pagesDoc._provenance || {}).stardustVersion || '0.0.0' },
  generatedAt: now,
  fragments,
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
  console.log(`${tag}${s.slug.padEnd(28)} ${s.status.padEnd(10)} ${[conv, reuse].filter(Boolean).join('  |  ')}`);
}
const totalConvert = steps.reduce((n, s) => n + s.convert.length, 0);
console.log(`\nEach of ${totalConvert} distinct module blocks converts on exactly ONE page; the rest reuse.`);
