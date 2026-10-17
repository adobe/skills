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
 * Delivered blocks no page lists: every subdirectory <name> of the project's blocks dir holding
 * <name>.js or <name>.css is a delivered block, and the export sees every one of them — so each
 * gets a ledger row even when no page's modules[] names it (otherwise the workspace manifest
 * carries "no block" unmatched variants). A row already planned (its id or delivery.edsBlockName
 * equals <name>) is left alone; any other is registered with `source: blocks-dir`, no pages, 0
 * instances and its prior delivery (by id) — else `converted` (a chrome name: a fragment,
 * fragments/<name>.html). A block deliberately left undelivered is recorded with
 * `update-coverage.mjs --block <name> --status not-delivered --reason "<text>"`; a re-run keeps it.
 *
 * Idempotent: existing block delivery status is preserved; a `default-content` mapping (a module
 * that needs no block) keeps its name whatever its status. A second run writes the same bytes
 * except timestamps.
 *
 * Usage: node skills/rollout/scripts/blocks.mjs [--out <rolloutDir>] [--blocks <dir>]
 *   --out     rollout dir (default stardust/rollout)
 *   --blocks  the project's blocks dir (default blocks, relative to the cwd = the project root);
 *             a missing dir is a note in the summary, not an error
 *
 * Reads <out>/coverage/pages.json (required — run inventory.mjs first) and the blocks dir. Writes
 * <out>/coverage/blocks.json (the ledger) and refreshes lastRun.blocks in <out>/rollout.json
 * when that file exists. The summary goes to stdout (`Registered  <n> block(s) from <dir>/ that
 * no page lists: …` when the blocks dir added rows). Exit 0 ok, 1 when pages.json is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, edsName, kindOf, blockCounts, DEFAULT_CONTENT } from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const argOf = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k !== -1 && process.argv[k + 1] ? process.argv[k + 1] : fallback;
};
const OUT = argOf('out', 'stardust/rollout');
const BLOCKS_DIR = argOf('blocks', 'blocks');
const BLOCKS_SHOWN = BLOCKS_DIR.replace(/\/+$/, '') || BLOCKS_DIR;
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
const planned = [...agg.entries()].map(([id, a]) => {
  const kind = kindOf(id);
  const p = prior.get(id);
  const delivery = (p && p.delivery) || {
    status: 'pending',
    edsBlockName: kind === 'chrome' ? null : edsName(id),
    blockPath: kind === 'chrome' ? `fragments/${edsName(id)}.html` : null,
    convertedAt: null,
  };
  // Keep the derived EDS name fresh for not-yet-converted blocks — never over a default-content
  // mapping, which is a resolved decision (no block to build) even while its status reads pending.
  if (delivery.status === 'pending' && delivery.edsBlockName !== DEFAULT_CONTENT) {
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
});

// Delivered blocks under the blocks dir that no planned row covers (by id or edsBlockName).
const blocksDirExists = existsSync(BLOCKS_DIR) && statSync(BLOCKS_DIR).isDirectory();
const dirNames = blocksDirExists
  ? readdirSync(BLOCKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ['js', 'css'].some((ext) => existsSync(join(BLOCKS_DIR, d.name, `${d.name}.${ext}`))))
    .map((d) => d.name)
    .sort((x, y) => x.localeCompare(y))
  : [];
const covered = new Set(planned.flatMap((b) => [b.id, b.delivery && b.delivery.edsBlockName].filter(Boolean)));
const registered = dirNames.filter((name) => !covered.has(name)).map((name) => {
  const kind = kindOf(name);
  const p = prior.get(name);
  return {
    id: name,
    label: name,
    kind,
    signature: `${kind}:${name}`,
    source: 'blocks-dir',
    usedByTemplates: [],
    usedByPages: [],
    instanceCount: 0,
    delivery: (p && p.delivery) || {
      status: 'converted',
      edsBlockName: kind === 'chrome' ? null : name,
      blockPath: kind === 'chrome' ? `fragments/${name}.html` : null,
      convertedAt: null,
    },
  };
});
const blocks = [...planned, ...registered].sort((x, y) => x.id.localeCompare(y.id));

writeJSON(blocksPath, {
  _provenance: { writtenBy: 'stardust:rollout/blocks', writtenAt: now, readArtifacts: [join(OUT, 'coverage', 'pages.json'), ...(blocksDirExists ? [`${BLOCKS_SHOWN}/`] : [])], stardustVersion: STARDUST_VERSION },
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
console.log(`Reuse leverage   ${pages.reduce((n, p) => n + (p.blocks || []).length, 0)} instances → ${planned.length} conversions`);
const top = modules.filter((b) => b.instanceCount > 0).sort((a, b) => b.instanceCount - a.instanceCount).slice(0, 6);
if (top.length) console.log(`Most reused      ${top.map((b) => `${b.id}×${b.instanceCount}`).join(', ')}`);
if (chrome.length) console.log(`Fragments        ${chrome.map((b) => b.id).join(', ')}`);
if (!blocksDirExists) console.log(`Note             no ${BLOCKS_SHOWN}/ directory — no delivered block registered from it (run from the project root, or pass --blocks <dir>)`);
if (registered.length) console.log(`Registered  ${registered.length} block(s) from ${BLOCKS_SHOWN}/ that no page lists: ${registered.map((b) => b.id).join(', ')}`);
