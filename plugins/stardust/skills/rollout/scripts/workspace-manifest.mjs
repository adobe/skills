#!/usr/bin/env node
/**
 * rollout/workspace-manifest.mjs — hashes, placeholders and handover state for the coverage a client reads (the
 * migration export: required when rollout.json `exports` lists `migration-workspace`).
 *
 * Usage: node skills/rollout/scripts/workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--captures <dir>] [--allow-no-mapping] [--draft-judgement] [--force] [--dry-run] [--json]
 *   defaults: --out stardust/rollout  --project .  --content <project>/content  --blocks <project>/blocks
 *             --captures <project>/stardust/current/pages
 *
 * The export, in order: inventory.mjs + blocks.mjs, block-origin.mjs --verify (→ <out>/workspace/mapping.json),
 * then this script. When the captures dir holds a capture (<slug>.html or <slug>.json) and mapping.json is absent,
 * the manifest is written WITHOUT `handover` (not ready to hand over), `missing: <out>/workspace/mapping.json — run
 * block-origin.mjs --verify first` goes to stderr and the exit is 2; --allow-no-mapping writes it as before
 * (handover null, exit 0). A project without captures needs no mapping.
 *
 * The coverage (<out>/coverage/{pages,templates,blocks}.json with formatVersion, written by
 * inventory.mjs and blocks.mjs) is what a client reads; reference/coverage-contract.md documents
 * it. This script writes <out>/workspace/manifest.json beside it: the hashes of the coverage files
 * and of <out>/workspace/mapping.json when present (outputs) and of what the coverage was built
 * from (inputs: every <content>/**.html as one entry, each <blocks>/<name>/<name>.{js,css},
 * <out>/workspace/judgement.json when present), placeholders
 * (fields not judged, pages without a content file) and the handover state. It refuses (exit 1,
 * nothing written, --force included) coverage without formatVersion and stale coverage: a content
 * file whose hash is not its page's delivered.contentHash (re-run inventory.mjs and blocks.mjs), or
 * a file blocks.json records in _provenance.inputs that changed or is gone, a judgement.json it did
 * not read, or no such record at all (re-run blocks.mjs). Unchanged inputs give a byte-identical
 * manifest, and then nothing is rewritten ("unchanged"); a write goes to a temp file renamed into
 * place.
 *
 * --draft-judgement writes only <out>/workspace/judgement.json, and only when it is absent; it needs
 * the three coverage files with formatVersion, fresh or not. Every field to judge is empty (toFill
 * lists them) and counts as judged once non-empty; blocks.mjs and inventory.mjs carry judged values
 * into coverage. `defaults` are suggestions: a template name or description left empty stays absent
 * in coverage (clients fall back to the template's type), an empty base type keeps the coverage
 * default. colorScheme is optional: its empty field is there to fill, but it is neither in toFill
 * nor a placeholder. --dry-run computes and prints what would be written, writing nothing. --json
 * prints one JSON object (`missing` lists what the export lacks: [] or [<mapping.json>]).
 *
 * Handover: when <out>/workspace/handover.json exists (a client that adopted the project writes
 * it; this script never does), the last manifest records a handover, or the content the last
 * manifest recorded as tracked by git is no longer tracked, it writes nothing and exits 3.
 * --force writes the manifest anyway, records the handover (a later forced run keeps it) and marks
 * it degraded with the inputs that differ from the last manifest before it.
 *
 * Exit 0 written or unchanged, 1 coverage missing, without formatVersion, stale or unreadable,
 * 2 usage, or mapping.json missing while captures exist (the manifest written or unchanged without handover —
 * a handover a forced run recorded is kept; the `missing:` line on stderr tells it from a usage error),
 * 3 handed over.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readJSON, sha256, byStr, kebab, edsName, kindOf, DEFAULT_CONTENT, contentFileFor, identityTokens, scrubIdentity,
  COVERAGE_FORMAT_VERSION,
} from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

export const FORMAT_VERSION = '0.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const WRITTEN_BY = 'stardust:rollout/workspace-manifest';
const FILES = { manifest: 'manifest.json', judgement: 'judgement.json', handover: 'handover.json', mapping: 'mapping.json' };
const COVERAGE = ['pages', 'templates', 'blocks'];
const VALUE_FLAGS = ['out', 'project', 'content', 'blocks', 'captures'];
const BOOL_FLAGS = ['draft-judgement', 'force', 'dry-run', 'json', 'allow-no-mapping'];
const USAGE = 'usage: workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--captures <dir>] [--allow-no-mapping] [--draft-judgement] [--force] [--dry-run] [--json] (--help for details)';

const serialize = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const fail = (code, msg) => { console.error(`rollout workspace-manifest: ${msg}`); return code; };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function parseArgs(argv) {
  const opts = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (VALUE_FLAGS.includes(name)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `--${name} needs a value` };
      opts[name] = v;
      i += 1;
    } else if (BOOL_FLAGS.includes(name)) opts.flags.add(name);
    else return { error: `unknown argument "${argv[i]}"` };
  }
  return opts;
}

/** git without a shell; GIT_DIR & co. from a calling hook would point it at another repository. */
function git(project, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)));
  const r = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
  return r.status === 0 ? r.stdout : null;
}

/** Whether git tracks the content: true/false only when the project is its own repository root, else null. */
function contentTracked(project, contentRel) {
  const top = git(project, ['rev-parse', '--show-toplevel']);
  let own = false;
  try { own = top !== null && realpathSync(top.trim()) === realpathSync(project); } catch { own = false; }
  const listed = own ? git(project, ['ls-files', '--', contentRel || '.']) : null;
  return listed === null ? null : listed.trim() !== '';
}

/** The installed plugin's version: a hidden `<name>-plugin` dir holding stardust's plugin.json; null in a project copy. */
function stardustVersion() {
  for (let dir = HERE, level = 0; level <= 5; dir = dirname(dir), level += 1) {
    let names = [];
    try { names = readdirSync(dir).filter((n) => /^\.[a-z]+-plugin$/.test(n)).sort(byStr); } catch { /* unreadable */ }
    for (const n of names) {
      const pj = readJSON(join(dir, n, 'plugin.json'));
      if (pj && pj.name === 'stardust') return typeof pj.version === 'string' ? pj.version : null;
    }
  }
  return null;
}

const subdirs = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(byStr); } catch { return []; }
};

function walkHtml(dir, acc = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) walkHtml(join(dir, e.name), acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(join(dir, e.name));
  }
  return acc;
}

/** Whether a capture dir holds a capture (a <slug>.html or <slug>.json file): the export then needs mapping.json. */
export function hasCaptures(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && !e.name.startsWith('.') && /\.(html|json)$/.test(e.name)); } catch { return false; }
}

/**
 * The manifest's inputs as on disk, keys sorted: `content` {files, sha256[, tracked when given]} (one hash over the
 * sorted "<project-relative path> <sha>" lines of every <content>/**.html), each <blocks>/<n>/<n>.{js,css}, and the
 * judgement when it is a file. Also returns the content hashes by content-relative path and the counts readArtifacts
 * needs. done-check.mjs compares a manifest against it.
 */
export function inputHashes({ project, contentDir, blocksDir, judgementFile, tracked }) {
  const relP = (abs) => relative(project, abs).split(sep).join('/');
  const contentHashes = new Map(walkHtml(contentDir).map((abs) => [relative(contentDir, abs).split(sep).join('/'), sha256(readFileSync(abs))]));
  const lines = [...contentHashes].map(([rel, sha]) => `${relP(join(contentDir, rel))} ${sha}\n`).sort(byStr);
  const inputs = { content: { files: lines.length, sha256: sha256(lines.join('')), ...(tracked === undefined ? {} : { tracked }) } };
  let blockFiles = 0;
  for (const name of subdirs(blocksDir)) {
    for (const ext of ['js', 'css']) {
      const file = join(blocksDir, name, `${name}.${ext}`);
      if (isFile(file)) { inputs[relP(file)] = sha256(readFileSync(file)); blockFiles += 1; }
    }
  }
  const judged = isFile(judgementFile);
  if (judged) inputs[relP(judgementFile)] = sha256(readFileSync(judgementFile));
  return { inputs: Object.fromEntries(Object.keys(inputs).sort(byStr).map((k) => [k, inputs[k]])), contentHashes, contentFiles: lines.length, blockFiles, judged };
}

/** blocks.json module rows blocks.mjs enriches (kind module, EDS name not default-content), by EDS name, first row wins. */
export function moduleBlocks(blocksDoc) {
  const byName = new Map();
  for (const b of (blocksDoc && blocksDoc.blocks) || []) {
    if (!b || (b.kind || kindOf(b.id)) !== 'module') continue;
    const name = (b.delivery && b.delivery.edsBlockName) || edsName(b.id);
    if (name !== DEFAULT_CONTENT && !byName.has(name)) byName.set(name, b);
  }
  return byName;
}

/** Summary lines for what a client gets as a default: fields not judged (colorScheme is optional), pages without a content file. Sorted. */
export function placeholdersOf(coverage) {
  const templates = coverage.templates.templates;
  const blocks = [...moduleBlocks(coverage.blocks).values()];
  const count = (rows, test) => rows.filter(test).length;
  return [
    ['templates[].name', count(templates, (t) => !t.name), 'template(s) without a name (not judged)'],
    ['templates[].description', count(templates, (t) => !t.description), 'template(s) without a description (not judged)'],
    ['blocks[].baseType', count(blocks, (b) => !b.baseType || b.baseType === 'unknown'), 'block(s) unknown (not judged)'],
    ['blocks[].purpose', count(blocks, (b) => !b.purpose), 'block(s) without purpose (not judged)'],
    ['blocks[].reuseGuidance', count(blocks, (b) => !b.reuseGuidance), 'block(s) without reuse guidance (not judged)'],
    ['pages[].delivered', count(coverage.pages.pages, (p) => p.delivered == null), 'page(s) without a content file (null)'],
  ].filter(([, n]) => n).map(([field, n, why]) => `${field}: ${n} ${why}`).sort(byStr);
}

/**
 * The judgement.json a model fills, from coverage: every field to judge empty (a known base type pre-filled),
 * suggestions under `defaults` (scrubbed; an empty template name or description stays absent in coverage, an empty
 * base type keeps the coverage default), and `toFill` (informational) listing the empty fields to judge — colorScheme
 * is optional and not listed.
 */
export function draftJudgement(coverage, provenance, tokens = []) {
  const [templates, blocks, toFill, used] = [{}, {}, [], new Set()];
  const defaults = { templates: {}, blocks: {} };
  for (const t of [...coverage.templates.templates].sort((a, b) => byStr(a.id, b.id))) {
    const base = kebab(t.type || t.id) || 'template';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
    used.add(name);
    const ids = [...new Set((t.blocks || []).filter((id) => kindOf(id) === 'module'))].sort(byStr);
    const pages = typeof t.pageCount === 'number' ? t.pageCount : (t.pages || []).length;
    templates[t.id] = { name: '', description: '' };
    defaults.templates[t.id] = {
      name: scrubIdentity(name, tokens),
      description: scrubIdentity(`${name}: ${pages} page(s); blocks ${ids.length ? ids.join(', ') : 'none'}.`, tokens),
    };
    toFill.push(`templates.${t.id}.name`, `templates.${t.id}.description`);
  }
  for (const [name, b] of [...moduleBlocks(coverage.blocks)].sort(([a], [c]) => byStr(a, c))) {
    const baseType = b.baseType && b.baseType !== 'unknown' ? b.baseType : '';
    blocks[name] = { baseType, purpose: '', reuseGuidance: { suitableFor: [], notSuitableFor: [] }, colorScheme: '' };
    defaults.blocks[name] = { baseType: b.baseType || 'unknown' };
    toFill.push(`blocks.${name}.purpose`, `blocks.${name}.reuseGuidance`);
    if (!baseType) toFill.push(`blocks.${name}.baseType`);
  }
  return { _provenance: provenance, templates, blocks, defaults, toFill: toFill.sort(byStr) };
}

/** Write through a sibling temp file renamed into place; on failure the temp file (and a dir this call made) is removed. */
export function writeAtomic(path, text, hooks = {}) {
  const made = mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    if (hooks.beforeRename) hooks.beforeRename(path);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    if (made) rmSync(made, { recursive: true, force: true });
    throw e;
  }
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) return fail(2, `${opts.error}\n${USAGE}`);
  const { flags } = opts;
  const dry = flags.has('dry-run');
  const out = opts.out || join('stardust', 'rollout');
  const OUT = resolve(out);
  const project = resolve(opts.project || '.');
  const contentDir = resolve(opts.content || join(project, 'content'));
  const blocksDir = resolve(opts.blocks || join(project, 'blocks'));
  const W = join(OUT, 'workspace');
  const shown = join(out, 'workspace');
  const relP = (abs) => relative(project, abs).split(sep).join('/');

  // --- Handover: once a client adopted the project, stardust stops writing --------
  const priorManifest = readJSON(join(W, FILES.manifest));
  const tracked = contentTracked(project, relP(contentDir));
  let detectedFrom = null;
  if (existsSync(join(W, FILES.handover))) detectedFrom = 'marker';
  else if (priorManifest && priorManifest.handover) detectedFrom = 'manifest';
  else if (priorManifest?.inputs?.content?.tracked === true && tracked === false) detectedFrom = 'untracked-content';
  if (detectedFrom && !flags.has('force')) {
    const why = {
      marker: `${join(shown, FILES.handover)} exists (a client adopted the project)`,
      manifest: 'the last manifest records a handover (a forced run)',
      'untracked-content': 'the content the last manifest was built from is no longer tracked by git',
    }[detectedFrom];
    if (flags.has('json')) {
      console.log(JSON.stringify({ status: 'handed-over', dir: shown, hashes: {}, counts: null, placeholders: 0, handover: { at: null, detectedFrom }, degraded: false }));
    }
    return fail(3, `handed over: ${why} — nothing written; --force writes the manifest anyway`);
  }
  // a handover already recorded (an earlier forced run) is kept as is, so a forced re-run stays byte-identical
  const recorded = priorManifest && priorManifest.handover;
  const handover = !detectedFrom ? null
    : recorded ? { at: recorded.at, detectedFrom: recorded.detectedFrom } : { at: new Date().toISOString(), detectedFrom };

  // --- Coverage: the three files, this format, and fresh ---------------------------
  const coverage = {};
  const outputs = {};
  for (const name of COVERAGE) {
    const file = join(OUT, 'coverage', `${name}.json`);
    const shownFile = join(out, 'coverage', `${name}.json`);
    let buf = null;
    let doc = null;
    try { buf = readFileSync(file); doc = JSON.parse(buf.toString('utf8')); } catch { doc = null; }
    if (!doc || !Array.isArray(doc[name]) || typeof doc.formatVersion !== 'string') {
      return fail(1, `${shownFile} missing, unreadable or without formatVersion — run inventory.mjs and blocks.mjs first`);
    }
    if (doc.formatVersion !== COVERAGE_FORMAT_VERSION) {
      return fail(1, `${shownFile} has formatVersion ${doc.formatVersion}; this script reads ${COVERAGE_FORMAT_VERSION} — run this release's inventory.mjs and blocks.mjs`);
    }
    coverage[name] = doc;
    outputs[relP(file)] = sha256(buf);
  }
  const mappingFile = join(W, FILES.mapping);
  if (isFile(mappingFile)) outputs[relP(mappingFile)] = sha256(readFileSync(mappingFile));
  const capturesDir = resolve(opts.captures || join(project, 'stardust', 'current', 'pages'));
  const missing = !flags.has('allow-no-mapping') && hasCaptures(capturesDir) && !isFile(mappingFile) ? [join(shown, FILES.mapping)] : [];

  // --- Inputs: what the coverage was built from ------------------------------------
  const judgementFile = join(W, FILES.judgement);
  const { inputs: sortedInputs, contentHashes, contentFiles, blockFiles, judged } = inputHashes({ project, contentDir, blocksDir, judgementFile, tracked });

  const readArtifacts = [...Object.keys(outputs), ...(contentFiles ? [relP(contentDir)] : []),
    ...(blockFiles ? [relP(blocksDir)] : []), ...(judged ? [relP(judgementFile)] : [])].sort(byStr);
  const provenance = {
    writtenBy: WRITTEN_BY,
    writtenAt: coverage.pages.generatedAt || coverage.pages._provenance?.writtenAt || null,
    readArtifacts,
    stardustVersion: stardustVersion(),
  };
  const placeholders = placeholdersOf(coverage);
  const mods = [...moduleBlocks(coverage.blocks).values()];
  const variants = mods.flatMap((b) => (Array.isArray(b.variants) ? b.variants : []));
  const counts = {
    templates: coverage.templates.templates.length,
    pages: coverage.pages.pages.length,
    blocks: mods.length,
    variants: variants.length,
    instances: variants.reduce((n, v) => n + (typeof v.instances === 'number' ? v.instances : 0), 0),
  };

  const report = (status, hashes, extra = {}) => {
    const degraded = !!extra.degraded;
    const lacking = extra.missing || [];
    if (flags.has('json')) {
      console.log(JSON.stringify({ status, dir: shown, hashes, counts, placeholders: placeholders.length, handover, degraded, missing: lacking }));
    } else {
      const withoutContent = coverage.pages.pages.filter((p) => p && p.delivered == null).length;
      console.log(`rollout workspace-manifest → ${shown}`);
      console.log('='.repeat(60));
      console.log(`Coverage      ${counts.templates} templates · ${counts.pages} pages (${withoutContent} without a content file) · ${counts.blocks} blocks (${counts.variants} variants, ${counts.instances} instances)`);
      console.log(`Placeholders  ${placeholders.length}${placeholders.length ? ' (listed in manifest.json)' : ''}`);
      if (handover) console.log(`Handover      forced (detected from ${handover.detectedFrom})${degraded ? `; degraded: ${extra.degraded.inputs.length} input(s) changed` : ''}`);
      console.log(`Status        ${extra.line}`);
    }
    for (const m of lacking) console.error(`missing: ${m} — run block-origin.mjs --verify first`);
    return lacking.length ? 2 : 0;
  };

  // --- --draft-judgement: only judgement.json, only when absent --------------------
  if (flags.has('draft-judgement')) {
    if (judged) {
      return report('draft-present', { [FILES.judgement]: sha256(readFileSync(judgementFile)) }, { line: `${FILES.judgement} present — left as is` });
    }
    const tokens = identityTokens({ rollout: readJSON(join(OUT, 'rollout.json')), state: readJSON(join(dirname(OUT), 'state.json')) });
    const text = serialize(draftJudgement(coverage, provenance, tokens));
    const hashes = { [FILES.judgement]: sha256(text) };
    if (dry) return report('dry-run', hashes, { line: `would write ${join(shown, FILES.judgement)} (dry run: nothing written)` });
    try { writeAtomic(judgementFile, text); } catch (e) { return fail(1, `write failed: ${e.message}`); }
    return report('drafted', hashes, { line: `drafted ${join(shown, FILES.judgement)}: fill the empty fields listed in toFill (colorScheme too, optionally), then re-run blocks.mjs and this script; \`defaults\` are suggestions — an empty template name or description stays absent in coverage, an empty base type keeps its default` });
  }

  // --- Freshness: coverage must describe the files on disk (the manifest run only) --
  const stale = coverage.pages.pages.filter((p) => {
    if (!p) return false;
    const rel = contentFileFor(p.path, (k) => contentHashes.has(k));
    return rel ? !p.delivered || p.delivered.contentHash !== contentHashes.get(rel) : p.delivered != null;
  }).map((p) => p.slug);
  if (stale.length) {
    return fail(1, `coverage is stale: ${stale.length} page(s) whose content file changed, appeared or went away since inventory.mjs ran (${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', …' : ''}) — re-run inventory.mjs and blocks.mjs`);
  }
  const blocksShown = join(out, 'coverage', 'blocks.json');
  const read = coverage.blocks._provenance && coverage.blocks._provenance.inputs;
  if (!read || typeof read !== 'object' || Array.isArray(read)) {
    return fail(1, `${blocksShown} records no _provenance.inputs (written by an older blocks.mjs) — re-run blocks.mjs`);
  }
  const at = (p) => (isAbsolute(p) ? p : resolve(project, p));
  const samePath = (a, b) => { if (a === b) return true; try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
  const off = Object.keys(read).sort(byStr).filter((p) => !isFile(at(p)) || sha256(readFileSync(at(p))) !== read[p])
    .map((p) => `${p} (${isFile(at(p)) ? 'changed' : 'gone'})`);
  if (judged && !Object.keys(read).some((p) => samePath(at(p), judgementFile))) off.push(`${relP(judgementFile)} (not read)`);
  if (off.length) return fail(1, `coverage is stale: ${blocksShown} was built from other files — ${off.join(', ')} — re-run blocks.mjs`);

  // --- Manifest ---------------------------------------------------------------------
  let degraded = null;
  if (handover && priorManifest) {
    const was = priorManifest.inputs || {};
    const norm = (k, v) => JSON.stringify(k === 'content' && v ? [v.files, v.sha256] : v ?? null);
    const changed = [...Object.keys(was), ...Object.keys(sortedInputs)].filter((k) => norm(k, was[k]) !== norm(k, sortedInputs[k]));
    const union = [...new Set([...(priorManifest.degraded?.inputs || []), ...changed])].sort(byStr);
    if (union.length) degraded = { reason: `forced run after handover (${handover.detectedFrom}): inputs differ from the last manifest before it`, inputs: union };
  }
  const manifest = {
    _provenance: provenance,
    formatVersion: FORMAT_VERSION,
    inputs: sortedInputs,
    outputs: Object.fromEntries(Object.keys(outputs).sort(byStr).map((k) => [k, outputs[k]])),
    placeholders,
    // an export without its mapping is not ready to hand over: no handover key (a recorded handover is kept)
    ...(missing.length && !handover ? {} : { handover }),
    ...(degraded ? { degraded } : {}),
  };
  const text = serialize(manifest);
  const hashes = { [FILES.manifest]: sha256(text) };
  const file = join(W, FILES.manifest);
  if (isFile(file) && readFileSync(file).equals(Buffer.from(text))) {
    return report('unchanged', hashes, { degraded, missing, line: 'unchanged — the same bytes; nothing written' });
  }
  if (dry) return report('dry-run', hashes, { degraded, missing, line: `would write ${join(shown, FILES.manifest)} (dry run: nothing written)` });
  try { writeAtomic(file, text); } catch (e) { return fail(1, `write failed: ${e.message}`); }
  return report('written', hashes, { degraded, missing, line: `written ${join(shown, FILES.manifest)}${missing.length ? ' without handover' : ''}` });
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.exitCode = fail(1, e.message);
  }
}
