#!/usr/bin/env node
/**
 * rollout/blocks.mjs — build the block dedup ledger (Phase 2).
 *
 * Reads coverage/pages.json (produced by inventory.mjs) and derives the set of
 * DISTINCT blocks across the whole site — the dedup unit. Each distinct block is
 * converted to an EDS block (or the /nav + /footer chrome documents) exactly ONCE; this
 * ledger + plan.mjs make that dedup a driving step, not a post-hoc reconcile.
 *
 * Dedup signal (Phase 2): brand-module ids carried per page in the _meta.json
 * sidecar `modules[]` (shared by construction) + chrome (header/nav/footer,
 * site-wide singletons). Finer section-archetype dedup via structural signatures
 * is a later refinement; the `signature` field is reserved for it.
 *
 * Idempotent: existing block delivery status is preserved.
 *
 * Usage: node skills/rollout/scripts/blocks.mjs [--out <rolloutDir>]
 */
import { join } from 'node:path';
import { readJSON, writeJSON, edsName, kindOf, blockCounts } from './lib.mjs';

const i = process.argv.indexOf('--out');
const OUT = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'stardust/rollout';
const STARDUST_VERSION = (readJSON(join(OUT, 'rollout.json'), {})._provenance || {}).stardustVersion || '0.0.0';

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!pagesDoc) {
  console.error(`rollout blocks: ${join(OUT, 'coverage', 'pages.json')} not found — run inventory.mjs first.`);
  process.exit(1);
}
const pages = pagesDoc.pages || [];
const blocksPath = join(OUT, 'coverage', 'blocks.json');
const prior = new Map(((readJSON(blocksPath, { blocks: [] }) || {}).blocks || []).map((b) => [b.id, b]));

// Aggregate block instances across pages.
const agg = new Map(); // id -> { templates:Set, pages:[], count }
for (const p of pages) {
  for (const id of p.blocks || []) {
    if (!agg.has(id)) agg.set(id, { templates: new Set(), pages: [], count: 0 });
    const a = agg.get(id);
    a.count += 1;
    a.pages.push(p.slug);
    if (p.templateId) a.templates.add(p.templateId);
  }
}

const now = new Date().toISOString();
const blocks = [...agg.entries()].map(([id, a]) => {
  const kind = kindOf(id);
  const p = prior.get(id);
  const delivery = (p && p.delivery) || {
    status: 'pending',
    edsBlockName: kind === 'chrome' ? null : edsName(id),
    blockPath: kind === 'chrome' ? `fragments/${edsName(id)}.html` : null,
    convertedAt: null,
  };
  // Keep the derived EDS name fresh for not-yet-converted blocks.
  if (delivery.status === 'pending') {
    delivery.edsBlockName = kind === 'chrome' ? null : edsName(id);
    delivery.blockPath = kind === 'chrome' ? `fragments/${edsName(id)}.html` : delivery.blockPath || null;
  }
  return {
    id,
    label: id,
    kind,
    signature: `${kind}:${id}`,
    source: null,
    usedByTemplates: [...a.templates].sort(),
    usedByPages: [...new Set(a.pages)].sort(),
    instanceCount: a.count,
    delivery,
  };
}).sort((x, y) => x.id.localeCompare(y.id));

writeJSON(blocksPath, {
  _provenance: { writtenBy: 'stardust:rollout/blocks', writtenAt: now, readArtifacts: [join(OUT, 'coverage', 'pages.json')], stardustVersion: STARDUST_VERSION },
  generatedAt: now,
  blocks,
});

// Refresh the block counts in rollout.json.
const configPath = join(OUT, 'rollout.json');
const config = readJSON(configPath);
if (config) {
  config.lastRun = { ...(config.lastRun || {}), blocks: blockCounts(blocks) };
  writeJSON(configPath, config);
}

const modules = blocks.filter((b) => b.kind === 'module');
const chrome = blocks.filter((b) => b.kind === 'chrome');
console.log(`rollout blocks → ${blocksPath}`);
console.log('='.repeat(60));
console.log(`Distinct blocks  ${blocks.length}  (${modules.length} module · ${chrome.length} chrome/fragment)`);
console.log(`Reuse leverage   ${pages.reduce((n, p) => n + (p.blocks || []).length, 0)} instances → ${blocks.length} conversions`);
const top = [...modules].sort((a, b) => b.instanceCount - a.instanceCount).slice(0, 6);
if (top.length) console.log(`Most reused      ${top.map((b) => `${b.id}×${b.instanceCount}`).join(', ')}`);
if (chrome.length) console.log(`Fragments        ${chrome.map((b) => b.id).join(', ')}`);
