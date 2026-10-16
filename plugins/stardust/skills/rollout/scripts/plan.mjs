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
 * Local harness launches (C14): every step carries `needsHarness` and `harnessWhy`. A page runs
 * section-schema, the whole-page block-roundtrip --ew and qa-gate unless it is an encoded page of a
 * template with a map (stardust/import/<archetype>/vocabulary.json) whose current clean encode's
 * shape (sidecar audit.encode.shape) the archetype's passedOn covers under the template's current
 * harness key (a record holding the archetype's own pass; the archetype re-runs first after a key
 * change) — or will cover once the pages flagged before it in this plan pass (the first page with
 * a new shape is its representative). A sibling that converts a block (until it passes under the
 * current key), a stopped or stale encode, a clone and any page of a template without a map run
 * them; a key change (encoder, map, the map's block JS/CSS, the frozen foundation) re-arms the
 * archetype and the representatives. migrate's
 * encode/shape.mjs decides (either layout; loaded only when a template has a map); the project root
 * is the directory holding stardust/rollout (else the cwd). Re-run the plan after encoding a
 * template's siblings and after `migrate.mjs harness` records a pass.
 *
 * Usage: node skills/rollout/scripts/plan.mjs [--out <rolloutDir>] [--pending-only]
 *   --out defaults to stardust/rollout; --pending-only lists only pages not yet delivered
 *
 * Reads <out>/coverage/pages.json and coverage/blocks.json (both required — run inventory.mjs
 * then blocks.mjs first) and coverage/templates.json; for an encoded template also each page's
 * sidecar (source.metaJson), its encoded document, the template's map and manifest, blocks/ and
 * stardust/rollout/foundation-freeze.json's frozen set. Writes <out>/plan.json and prints the
 * readable plan on stdout. Exit 1 when an input is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJSON, writeJSON } from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

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

// --- C14: which pages run the local harness launches (migrate's encode/shape.mjs) -----
const PROJECT = (() => { const o = normalize(OUT).replace(/[/\\]+$/, ''); return basename(o) === 'rollout' && basename(dirname(o)) === 'stardust' ? dirname(dirname(o)) : '.'; })();
const hasMap = (t) => typeof t.representativeSlug === 'string' && existsSync(join(PROJECT, 'stardust', 'import', t.representativeSlug, 'vocabulary.json'));
const shapeLib = !templates.some(hasMap) ? null : await (async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const f = [join(here, '..', '..', 'migrate', 'scripts', 'encode', 'shape.mjs'), join(here, '..', 'migrate', 'encode', 'shape.mjs')].find((x) => existsSync(x));
  return f ? import(pathToFileURL(f).href) : null;
})();
const harness = new Map(); // slug → { needsHarness, why }
const sideRel = (p) => (p && p.source && p.source.metaJson ? relative(PROJECT, p.source.metaJson).split(sep).join('/') : null);
for (const t of orderedTemplates) {
  const members = new Set([t.representativeSlug, ...(t.pages || [])]);
  const slugs = order.filter((s) => members.has(s));
  if (!hasMap(t) || !shapeLib) {
    const why = hasMap(t) ? 'C14 not judged: migrate\'s encode/shape.mjs not found' : `template ${t.id} is not encoded (no stardust/import/${t.representativeSlug}/vocabulary.json): it runs the launches`;
    for (const s of slugs) if (!harness.has(s)) harness.set(s, { needsHarness: true, why });
    continue;
  }
  const a = t.representativeSlug;
  let key = null; let keyError = null;
  try { ({ key } = await shapeLib.harnessKey(PROJECT, a)); } catch (e) { keyError = e.message; }
  const archMeta = sideRel(bySlug.get(a)) ? readJSON(join(PROJECT, sideRel(bySlug.get(a)))) : null;
  const manifests = new Map();
  const pagesIn = slugs.map((slug) => {
    const rel = sideRel(bySlug.get(slug));
    const meta = rel ? readJSON(join(PROJECT, rel)) : null;
    const encoded = meta && meta.encode && meta.encode.output && typeof meta.encode.output.path === 'string' ? shapeLib.encodedShape({ root: PROJECT, sidecarPath: rel, archetype: a, manifests }) : null;
    const step = steps.find((x) => x.slug === slug);
    return { slug, isArchetype: slug === a, encoded, convert: step ? step.convert.map((c) => c.edsBlockName || c.id) : [] };
  });
  for (const [slug, v] of shapeLib.planHarness({ key, keyError, passedOn: archMeta && archMeta.passedOn, pages: pagesIn, archetype: a })) if (!harness.has(slug)) harness.set(slug, v);
}
for (const s of steps) {
  const h = harness.get(s.slug) || { needsHarness: true, why: 'in no template: it runs the launches' };
  s.needsHarness = h.needsHarness; s.harnessWhy = h.why;
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
  console.log(`${tag}${s.slug.padEnd(28)} ${s.status.padEnd(10)} ${[conv, reuse, s.needsHarness ? 'harness' : 'inherits harness'].filter(Boolean).join('  |  ')}`);
}
const totalConvert = steps.reduce((n, s) => n + s.convert.length, 0);
console.log(`\nEach of ${totalConvert} distinct module blocks converts on exactly ONE page; the rest reuse.`);
const inherit = show.filter((s) => !s.needsHarness);
console.log(`Local harness launches (C14): ${show.length - inherit.length} page(s) run them; ${inherit.length} inherit them (harnessWhy in plan.json).`);
