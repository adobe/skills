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
 * carries "no block" unmatched variants). A row already planned (its id, edsName(id) or
 * delivery.edsBlockName equals <name>; header and nav are one chrome, the canon header, so either
 * covers the other) is left alone; any other is registered with `source: blocks-dir`, its usage counted
 * like any module row's, and its prior delivery (by id) — else `converted` (a chrome name: a fragment,
 * fragments/<name>.html). A block deliberately left undelivered is recorded with
 * `update-coverage.mjs --block <name> --status not-delivered --reason "<text>"`; a re-run keeps it.
 *
 * Usage (`usedByTemplates`, `usedByPages`, `instanceCount`): a module row with an EDS block is counted from the
 * delivered documents — pages.json `delivered.blocks` records of kind `block` with its EDS name, the records
 * block-origin.mjs maps, so the ledger and the mapping agree instance for instance; a block no document shows
 * reads 0, truthfully, whatever the sidecars planned. Chrome and default-content rows count the pages whose
 * sidecar `modules[]` declare them (a fragment or default content leaves no block record).
 *
 * Idempotent: existing block delivery status is preserved; a `default-content` mapping (a module
 * that needs no block) keeps its name whatever its status. A second run writes the same bytes
 * except timestamps.
 *
 * Delivered structure (coverage formatVersion 0.1.0): every module row whose EDS name is not
 * `default-content` (a blocks-dir row too) also records what the delivered site made of it —
 * `optionClasses` (classes authored on its instances plus those its CSS chains to `.<name>`), `variants`
 * (one per class set in pages.json `delivered.blocks`: id, classes, pages, instances), `variantsSummary`
 * ({total, singleUse}: the variants, and those a single instance uses — an adopter emits one catalog block
 * per variant, so a high single-use count is an option-class explosion, not reuse), `description`
 * (first sentence of the doc comment in <blocks>/<name>/<name>.js), `contract` (its bullet under a
 * "Content contract" heading of stardust/eds-conversion-log.md), `baseType`, and once judged in
 * <out>/workspace/judgement.json `purpose`, `reuseGuidance`, `colorScheme`. Free text is scrubbed of
 * project identity (tokens from rollout.json + state.json). Judged template names and descriptions are
 * refreshed in templates.json too, so a late judgement lands without re-running inventory. Chrome and
 * default-content rows are unchanged; a delivered block name with no module row from the pages (a
 * blocks-dir row does not count) is named on stdout. The top-level `variantsSummary` {total, singleUse, blocks}
 * sums the module rows (one per EDS name), so a reviewer sees the explosion at a glance; the workspace manifest
 * recomputes the same figures.
 * `_provenance.inputs` maps each judgement, conversion-log and block-code file read (keyed by its path
 * relative to the project root, the dir holding stardust/, with / separators) to its sha256, so a reader
 * can tell when the ledger is stale. A coverage file whose content did not change is not rewritten.
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  readJSON, writeJSON, edsName, kindOf, blockCounts, DEFAULT_CONTENT, COVERAGE_FORMAT_VERSION, byStr, sha256, variantIdentity,
  cssOptionClasses, blockDescription, contractFor, baseTypeOf, identityTokens, scrubIdentity, judgedText, judgedGuidance,
  applyTemplateJudgement, writeCoverage, variantsSummary, variantsSummaryOf,
} from './lib.mjs';

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

// The blocks the sidecars plan (pages.json `blocks[]`, the sidecar modules[]): the row set, and the usage of the rows
// the delivered documents cannot count (chrome, default content).
const agg = new Map(); // id -> { templates:Set, pages:Set, count }
for (const p of pages) {
  for (const id of p.blocks || []) {
    if (!agg.has(id)) agg.set(id, { templates: new Set(), pages: new Set(), count: 0 });
    const a = agg.get(id);
    a.count += 1;
    a.pages.add(p.slug);
    if (p.templateId) a.templates.add(p.templateId);
  }
}

const now = new Date().toISOString();
const STARDUST_DIR = dirname(OUT);
// Every judgement / conversion-log / block-code file read is hashed into _provenance.inputs, keyed relative to
// the project root (the dir holding stardust/), POSIX separators: a moved clone or an absolute --out/--blocks
// records the same keys.
const PROJECT_ROOT = dirname(dirname(resolve(OUT)));
const inputs = {};
const readInput = (p) => {
  try {
    const buf = readFileSync(p);
    inputs[relative(PROJECT_ROOT, resolve(p)).split(sep).join('/')] = sha256(buf);
    return buf.toString('utf8');
  } catch { return null; }
};
const tokens = identityTokens({ rollout: readJSON(join(OUT, 'rollout.json')), state: readJSON(join(STARDUST_DIR, 'state.json')) });
const scrub = (text) => (text == null ? null : scrubIdentity(text, tokens));
const logPath = join(STARDUST_DIR, 'eds-conversion-log.md');
const conversionLog = readInput(logPath);
const judgementPath = join(OUT, 'workspace', 'judgement.json');
const judgementText = readInput(judgementPath);
let judgement = null;
try { judgement = judgementText === null ? null : JSON.parse(judgementText); } catch { judgement = null; }

// Delivered instances (pages.json `delivered.blocks`, kind 'block' — the records block-origin.mjs maps) by block
// name: the usage of every module row with an EDS block (usedBy), then by variant identity (variants[]).
const delivered = new Map();
const usedBy = new Map(); // EDS name -> { templates:Set, pages:Set, count }
for (const p of pages) {
  for (const r of (p.delivered && p.delivered.blocks) || []) {
    if (!r || r.kind !== 'block') continue;
    if (!usedBy.has(r.block)) usedBy.set(r.block, { templates: new Set(), pages: new Set(), count: 0 });
    const u = usedBy.get(r.block);
    u.count += 1;
    u.pages.add(p.slug);
    if (p.templateId) u.templates.add(p.templateId);
    if (!delivered.has(r.block)) delivered.set(r.block, new Map());
    const byIdentity = delivered.get(r.block);
    const identity = variantIdentity(r.block, r.classes || []);
    if (!byIdentity.has(identity)) byIdentity.set(identity, { id: r.variantId, classes: r.classes || [], pages: new Set(), instances: 0 });
    const v = byIdentity.get(identity);
    v.pages.add(p.slug);
    v.instances += 1;
  }
}

/**
 * A row's usage, in contract order. A module row with an EDS block: counted from the delivered documents by its EDS
 * name (a block no document shows reads 0, whatever the sidecars planned); chrome and default-content rows: the pages
 * whose sidecar modules[] declare them — a fragment or default content leaves no block record to count.
 */
function usageOf(id, kind, edsBlockName) {
  const u = kind === 'module' && edsBlockName !== DEFAULT_CONTENT ? usedBy.get(edsBlockName) : agg.get(id);
  return {
    usedByTemplates: [...(u ? u.templates : [])].sort(),
    usedByPages: [...(u ? u.pages : [])].sort(),
    instanceCount: u ? u.count : 0,
  };
}

/** The delivered-structure fields of a module row (DESIGN: coverage 0.1.0), in contract order. */
function deliveredFields(name) {
  const variants = [...(delivered.get(name) || new Map()).values()]
    .map((v) => ({ id: v.id, classes: v.classes, pages: v.pages.size, instances: v.instances }))
    .sort((a, b) => byStr(a.classes.join(' '), b.classes.join(' ')));
  const css = readInput(join(BLOCKS_DIR, name, `${name}.css`));
  const js = readInput(join(BLOCKS_DIR, name, `${name}.js`));
  const judged = (judgement && judgement.blocks && judgement.blocks[name]) || {};
  const fields = {
    optionClasses: [...new Set([...variants.flatMap((v) => v.classes), ...cssOptionClasses(name, css)])].sort(byStr),
    variants,
    variantsSummary: variantsSummary(variants),
    description: scrub(blockDescription(js)),
    contract: scrub(contractFor(conversionLog, name)),
    baseType: scrub(judgedText(judged.baseType)) || baseTypeOf(name),
  };
  const purpose = judgedText(judged.purpose);
  if (purpose) fields.purpose = scrub(purpose);
  const guidance = judgedGuidance(judged.reuseGuidance);
  if (guidance) fields.reuseGuidance = { suitableFor: guidance.suitableFor.map(scrub), notSuitableFor: guidance.notSuitableFor.map(scrub) };
  const colorScheme = judgedText(judged.colorScheme);
  if (colorScheme) fields.colorScheme = scrub(colorScheme);
  return fields;
}

/** A module row whose EDS name is not default-content gains the delivered-structure fields of block `name`. */
const withDelivered = (row, name) => (row.kind === 'module' && row.delivery.edsBlockName !== DEFAULT_CONTENT
  ? { ...row, ...deliveredFields(name) }
  : row);

const planned = [...agg.keys()].map((id) => {
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
  const row = {
    id,
    label: id,
    kind,
    signature: `${kind}:${id}`,
    source: null,
    ...usageOf(id, kind, delivery.edsBlockName || edsName(id)),
    delivery,
  };
  return withDelivered(row, delivery.edsBlockName || edsName(id));
});

// Delivered blocks under the blocks dir that no planned row covers (by id, EDS name or edsBlockName).
const blocksDirExists = existsSync(BLOCKS_DIR) && statSync(BLOCKS_DIR).isDirectory();
const dirNames = blocksDirExists
  ? readdirSync(BLOCKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ['js', 'css'].some((ext) => existsSync(join(BLOCKS_DIR, d.name, `${d.name}.${ext}`))))
    .map((d) => d.name)
    .sort((x, y) => x.localeCompare(y))
  : [];
// header and nav are one chrome (both deliver the canon header): either name covers the other.
const SAME_CHROME = ['header', 'nav'];
const withChromeAlias = (names) => names.flatMap((n) => (SAME_CHROME.includes(n) ? SAME_CHROME : [n]));
const covered = new Set(withChromeAlias(planned.flatMap((b) => [b.id, edsName(b.id), b.delivery && b.delivery.edsBlockName].filter(Boolean))));
const registered = dirNames.filter((name) => {
  if (covered.has(name)) return false;
  withChromeAlias([name]).forEach((n) => covered.add(n));
  return true;
}).map((name) => {
  const kind = kindOf(name);
  const p = prior.get(name);
  const delivery = (p && p.delivery) || {
    status: 'converted',
    edsBlockName: kind === 'chrome' ? null : name,
    blockPath: kind === 'chrome' ? `fragments/${name}.html` : null,
    convertedAt: null,
  };
  return withDelivered({
    id: name,
    label: name,
    kind,
    signature: `${kind}:${name}`,
    source: 'blocks-dir',
    ...usageOf(name, kind, delivery.edsBlockName || name),
    delivery,
  }, delivery.edsBlockName || name);
});
const blocks = [...planned, ...registered].sort((x, y) => x.id.localeCompare(y.id));

const readArtifacts = [
  join(OUT, 'coverage', 'pages.json'), ...(blocksDirExists ? [`${BLOCKS_SHOWN}/`] : []),
  ...(conversionLog === null ? [] : [logPath]), ...(judgementText === null ? [] : [judgementPath]),
];
const written = writeCoverage(blocksPath, {
  _provenance: {
    writtenBy: 'stardust:rollout/blocks', writtenAt: now, readArtifacts, stardustVersion: STARDUST_VERSION,
    inputs: Object.fromEntries(Object.keys(inputs).sort(byStr).map((k) => [k, inputs[k]])),
  },
  formatVersion: COVERAGE_FORMAT_VERSION,
  generatedAt: now,
  variantsSummary: variantsSummaryOf(blocks),
  blocks,
});

// Judged template names/descriptions land here too, so a judgement filled late needs no inventory re-run.
const templatesPath = join(OUT, 'coverage', 'templates.json');
const templatesDoc = readJSON(templatesPath);
let templatesWritten = false;
if (templatesDoc && Array.isArray(templatesDoc.templates) && applyTemplateJudgement(templatesDoc.templates, judgement, tokens)) {
  templatesWritten = writeCoverage(templatesPath, templatesDoc);
}

// Refresh the block counts in rollout.json.
const configPath = join(OUT, 'rollout.json');
const config = readJSON(configPath);
if (config) {
  config.lastRun = { ...(config.lastRun || {}), blocks: blockCounts(blocks) };
  writeJSON(configPath, config);
}

const modules = blocks.filter((b) => b.kind === 'module');
const chrome = blocks.filter((b) => b.kind === 'chrome');
console.log(`rollout blocks → ${blocksPath}${written ? '' : ' (unchanged)'}`);
console.log('='.repeat(60));
console.log(`Distinct blocks  ${blocks.length}  (${modules.length} module · ${chrome.length} chrome/fragment)`);
console.log(`Reuse leverage   ${pages.reduce((n, p) => n + (p.blocks || []).length, 0)} instances → ${planned.length} conversions`);
const top = modules.filter((b) => b.instanceCount > 0).sort((a, b) => b.instanceCount - a.instanceCount).slice(0, 6);
if (top.length) console.log(`Most reused      ${top.map((b) => `${b.id}×${b.instanceCount}`).join(', ')}`);
if (chrome.length) console.log(`Fragments        ${chrome.map((b) => b.id).join(', ')}`);
const summary = variantsSummaryOf(blocks);
if (summary.total) console.log(`Delivered        ${summary.total} variant(s) of ${summary.blocks} block(s), ${summary.singleUse} single-use (one catalog block per variant for an adopter)`);
const named = new Set(planned.filter((b) => b.variants).map((b) => b.delivery.edsBlockName || edsName(b.id)));
const unmatched = [...delivered.keys()].filter((n) => !named.has(n)).sort(byStr);
if (unmatched.length) console.log(`Unmatched        ${unmatched.length} delivered block name(s) with no module row: ${unmatched.join(', ')} — record the conversion (update-coverage.mjs --block <id> --eds-name <name>)`);
if (!blocksDirExists) console.log(`Note             no ${BLOCKS_SHOWN}/ directory — no delivered block registered from it (run from the project root, or pass --blocks <dir>)`);
if (registered.length) console.log(`Registered  ${registered.length} block(s) from ${BLOCKS_SHOWN}/ that no page lists: ${registered.map((b) => b.id).join(', ')}`);
if (templatesWritten) console.log('Templates        judged names/descriptions refreshed in templates.json');
