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
 * Idempotent: existing block delivery status is preserved; a `default-content` mapping (a module
 * that needs no block) keeps its name whatever its status.
 *
 * Delivered structure (coverage formatVersion 0.1.0): every module row whose EDS name is not
 * `default-content` also records what the delivered site made of it — `optionClasses` (classes
 * authored on its instances plus those its CSS chains to `.<name>`), `variants` (one per class set
 * in pages.json `delivered.blocks`: id, classes, pages, instances), `description` (first sentence of
 * the doc comment in <blocks>/<name>/<name>.js), `contract` (its bullet under a "Content contract"
 * heading of stardust/eds-conversion-log.md), `baseType`, and once judged in
 * <out>/workspace/judgement.json `purpose`, `reuseGuidance`, `colorScheme`. Free text is scrubbed of
 * project identity (tokens from rollout.json + state.json). Judged template names and descriptions are
 * refreshed in templates.json too, so a late judgement lands without re-running inventory. Chrome and
 * default-content rows are unchanged; a delivered block name with no module row is named on stdout.
 * `_provenance.inputs` maps each judgement, conversion-log and block-code file read (keyed by its path
 * relative to the project root, the dir holding stardust/, with / separators) to its sha256, so a reader
 * can tell when the ledger is stale. A coverage file whose content did not change is not rewritten.
 *
 * Usage: node skills/rollout/scripts/blocks.mjs [--out <rolloutDir>] [--blocks <dir>]   (defaults stardust/rollout, blocks)
 *
 * Reads <out>/coverage/pages.json (required — run inventory.mjs first). Writes
 * <out>/coverage/blocks.json (the ledger) and refreshes lastRun.blocks in <out>/rollout.json
 * when that file exists. The summary goes to stdout. Exit 1 when pages.json is missing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  readJSON, writeJSON, edsName, kindOf, blockCounts, DEFAULT_CONTENT, COVERAGE_FORMAT_VERSION, byStr, sha256, variantIdentity,
  cssOptionClasses, blockDescription, contractFor, baseTypeOf, identityTokens, scrubIdentity, judgedText, judgedGuidance,
  applyTemplateJudgement, writeCoverage,
} from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const flag = (name, fallback) => { const k = process.argv.indexOf(`--${name}`); return k !== -1 && process.argv[k + 1] ? process.argv[k + 1] : fallback; };
const OUT = flag('out', 'stardust/rollout');
const BLOCKS = flag('blocks', 'blocks');
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

// Delivered instances (pages.json `delivered.blocks`, kind 'block') by block name, then by variant identity.
const delivered = new Map();
for (const p of pages) {
  for (const r of (p.delivered && p.delivered.blocks) || []) {
    if (!r || r.kind !== 'block') continue;
    if (!delivered.has(r.block)) delivered.set(r.block, new Map());
    const byIdentity = delivered.get(r.block);
    const identity = variantIdentity(r.block, r.classes || []);
    if (!byIdentity.has(identity)) byIdentity.set(identity, { id: r.variantId, classes: r.classes || [], pages: new Set(), instances: 0 });
    const v = byIdentity.get(identity);
    v.pages.add(p.slug);
    v.instances += 1;
  }
}

/** The delivered-structure fields of a module row (DESIGN: coverage 0.1.0), in contract order. */
function deliveredFields(name) {
  const variants = [...(delivered.get(name) || new Map()).values()]
    .map((v) => ({ id: v.id, classes: v.classes, pages: v.pages.size, instances: v.instances }))
    .sort((a, b) => byStr(a.classes.join(' '), b.classes.join(' ')));
  const css = readInput(join(BLOCKS, name, `${name}.css`));
  const js = readInput(join(BLOCKS, name, `${name}.js`));
  const judged = (judgement && judgement.blocks && judgement.blocks[name]) || {};
  const fields = {
    optionClasses: [...new Set([...variants.flatMap((v) => v.classes), ...cssOptionClasses(name, css)])].sort(byStr),
    variants,
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

const blocks = [...agg.entries()].map(([id, a]) => {
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
    usedByTemplates: [...a.templates].sort(),
    usedByPages: [...new Set(a.pages)].sort(),
    instanceCount: a.count,
    delivery,
  };
  return kind === 'module' && delivery.edsBlockName !== DEFAULT_CONTENT
    ? { ...row, ...deliveredFields(delivery.edsBlockName || edsName(id)) }
    : row;
}).sort((x, y) => x.id.localeCompare(y.id));

const readArtifacts = [join(OUT, 'coverage', 'pages.json'), BLOCKS, ...(conversionLog === null ? [] : [logPath]), ...(judgementText === null ? [] : [judgementPath])];
const written = writeCoverage(blocksPath, {
  _provenance: {
    writtenBy: 'stardust:rollout/blocks', writtenAt: now, readArtifacts, stardustVersion: STARDUST_VERSION,
    inputs: Object.fromEntries(Object.keys(inputs).sort(byStr).map((k) => [k, inputs[k]])),
  },
  formatVersion: COVERAGE_FORMAT_VERSION,
  generatedAt: now,
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
console.log(`Reuse leverage   ${pages.reduce((n, p) => n + (p.blocks || []).length, 0)} instances → ${blocks.length} conversions`);
const top = [...modules].sort((a, b) => b.instanceCount - a.instanceCount).slice(0, 6);
if (top.length) console.log(`Most reused      ${top.map((b) => `${b.id}×${b.instanceCount}`).join(', ')}`);
if (chrome.length) console.log(`Fragments        ${chrome.map((b) => b.id).join(', ')}`);
const variantCount = modules.reduce((n, b) => n + (b.variants ? b.variants.length : 0), 0);
if (variantCount) console.log(`Delivered        ${variantCount} variant(s) of ${modules.filter((b) => b.variants && b.variants.length).length} block(s)`);
const named = new Set(modules.filter((b) => b.variants).map((b) => b.delivery.edsBlockName || edsName(b.id)));
const unmatched = [...delivered.keys()].filter((n) => !named.has(n)).sort(byStr);
if (unmatched.length) console.log(`Unmatched        ${unmatched.length} delivered block name(s) with no module row: ${unmatched.join(', ')} — record the conversion (update-coverage.mjs --block <id> --eds-name <name>)`);
if (templatesWritten) console.log('Templates        judged names/descriptions refreshed in templates.json');
