#!/usr/bin/env node
/**
 * rollout/inventory.mjs — build the delivery coverage from a migrated tree.
 *
 * Reads stardust/migrated/ (the platform-agnostic output of `migrate`) plus the
 * per-page _meta.json sidecars, and writes the rollout coverage:
 *   - stardust/rollout/coverage/pages.json     (one row per migrated page)
 *   - stardust/rollout/coverage/templates.json (grouping for delivery order/reuse)
 *   - stardust/rollout/rollout.json            (config + lastRun summary; created if absent)
 *
 * Idempotent + incremental: existing delivery status is preserved. When a page's
 * migrated HTML changed (sourceHash differs) after it was already deployed/verified,
 * it is re-flagged `stale` so the delivery loop re-delivers just that page.
 * The read-modify-write runs under update-coverage.mjs's lock (`<out>/.coverage.lock`,
 * taken before the prior coverage is read, released at exit), so a status a cluster
 * records meanwhile is never lost.
 *
 * Encoded pages: a sidecar whose `encode.output.path` names the encoder's document
 * (`stardust/encoded/<da-path>.html`, resolved from the project that holds
 * stardust/migrated, else the cwd) is a page even with no HTML beside it — row 2 drops
 * the clone for an encoded template. Its row has the same shape, built from the sidecar:
 * `path` and `source.encodedHtml` from that document (`source.migratedHtml` null);
 * `sourceHash` is the current clean encode's sha (migrate's encode/provenance.mjs
 * currentEncode decides), so a re-encode with new bytes marks a delivered page `stale`.
 * A page whose encode is not current (stopped, a hand-edited or stale document, a
 * document gone) keeps its last clean encode's sha (`encode.output.sha`) — never
 * re-flagged on that alone — and the `Not current` line names it. A sibling whose clone
 * is still on disk is listed once, as encoded (deploy stages its encoded document) while
 * its encode is clean — stopped, it is the A′ exception and keeps its clone row; the
 * template's archetype keeps its migrated-HTML row (deploy converts it from that HTML
 * and never stages it). An encoded page's prior `content-pending` becomes `pending`; any
 * other status a `--state` roster row carried (update-coverage.mjs recorded `deployed`)
 * stays — the roster row's hash was never the document's. Both rules are migrate's
 * (encode/provenance.mjs encodedPageOf, currentEncode), loaded only when a sidecar
 * records an encode; without that file beside this script such a run exits 1.
 *
 * Phase 1 scope: pages + template grouping only. Block dedup (blocks.json) is a
 * first-class step deferred to Phase 2 — see notes/rollout/PLAN.md § 8.
 *
 * Template grouping: a page's `template` from its sidecar. An archetype (fidelityTier
 * `archetype` or renderBranch `A`) whose `template` is null — the migrate spec's form —
 * groups under its OWN slug, which its siblings name in their `template`; `type` is the
 * last resort. A template's representative is its archetype. Sidecars with an empty
 * `modules[]` are counted in the report: Phase B (blocks.mjs) dedups from them.
 *
 * Archetypes-only mode (`--state <state.json>`): the migrated tree holds only the
 * template archetypes (one per template); the full page roster lives in state.json.
 * Pages present only in state.json (not yet individually migrated) are merged in as
 * `content-pending` siblings — keyed to the archetype their `type` names, inheriting
 * that archetype's blocks, pushing no document. Block code ships from the archetypes;
 * sibling content is populated later by a separate content track.
 *
 * Rows added by `update-coverage.mjs --new` (a page built outside the migrated tree —
 * a search results page from the dynamics phase; `source.migratedHtml` carries the
 * origin marker `<origin>:<slug>` instead of a file path) are KEPT on a re-run, status
 * untouched, so the page is registered once — never re-registered after every
 * inventory run (a recorded hands-off run lost its search page from coverage, the
 * sitemap and verify this way). Such a row gives way only when the migrated tree now
 * holds a file for its slug, or a migrated page owns its path.
 *
 * A sidecar's `variance` object (the sibling-variance verdict recorded on a cloned
 * sibling, or why it was skipped) is copied verbatim to the row's `source.variance`;
 * the key is absent when the sidecar carries no such object.
 *
 * Delivered structure: every row's `delivered` holds what the page's content file (<content>/index.html
 * for /, else <path>.html or <path>/index.html) is made of — blocks and default content in document
 * order with sections, lang, source snapshot and contentHash — or null while it has no content file.
 * Coverage files carry `formatVersion` (reference/coverage-contract.md); unchanged inputs leave them untouched.
 *
 * Usage:
 *   node skills/rollout/scripts/inventory.mjs [--migrated <dir>] [--out <rolloutDir>] [--site-url <url>] [--state <state.json>] [--content <dir>] [--export <name>]
 *   defaults: --migrated stardust/migrated  --out stardust/rollout  --content content
 *   --export migration-workspace opts this project into rollout's migration workspace (Phase I: manifest and
 *   judgement draft under stardust/rollout/workspace/); the name is added once to rollout.json `exports`, which
 *   survives every re-run. Another name exits 2 before any write.
 *
 * Exit: 0 coverage written · 1 the migrated tree is not found (message on stderr, nothing written), or an
 *   unexpected read/write failure · 2 an unknown --export name (message on stderr, nothing written).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import {
  COVERAGE_FORMAT_VERSION, byStr, sha256, parseDelivered, contentFileFor, variantIdentity, variantId, priorVariantIds,
  identityTokens, scrubIdentity, applyTemplateJudgement, writeCoverage, acquireLock,
} from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MIGRATED = arg('migrated', 'stardust/migrated');
const OUT = arg('out', 'stardust/rollout');
const SITE_URL = arg('site-url', null);
const STATE = arg('state', null);
const CONTENT = arg('content', 'content');

/** Every value of a repeatable flag, in order; a flag with no value yields ''. */
function args(name) {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1] || ''] : []));
}

// Opt-in exports (rollout.json `exports`, schemas/rollout-config.schema.json); `migration-workspace-files` is reserved.
const EXPORT_NAMES = ['migration-workspace', 'migration-workspace-files'];
const EXPORTS = args('export');
for (const name of EXPORTS) {
  if (EXPORT_NAMES.includes(name)) continue;
  console.error(`rollout inventory: --export needs one of ${EXPORT_NAMES.join(', ')}${name ? ` (got "${name}")` : ''}.`);
  process.exit(2);
}

const STARDUST_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pj = JSON.parse(readFileSync(join(here, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    return pj.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

/** Recursively collect *.html under dir, skipping the assets/ bundle. */
function walkHtml(dir, root = dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue;
      walkHtml(full, root, acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(relative(root, full));
    }
  }
  return acc;
}

/** Sidecar path for a migrated HTML rel path (index.html -> _meta.json; x.html -> x._meta.json). */
function sidecarFor(relHtml) {
  const dir = dirname(relHtml);
  const leaf = basename(relHtml);
  const name = leaf === 'index.html' ? '_meta.json' : `${leaf.replace(/\.html$/, '')}._meta.json`;
  return dir === '.' ? name : join(dir, name);
}

/** The HTML a sidecar sits beside (_meta.json -> index.html; x._meta.json -> x.html), or null for another file. */
function htmlFor(relSidecar) {
  const leaf = basename(relSidecar);
  const name = leaf === '_meta.json' ? 'index.html' : leaf.endsWith('._meta.json') ? `${leaf.slice(0, -'._meta.json'.length)}.html` : null;
  if (!name) return null;
  const dir = dirname(relSidecar);
  return dir === '.' ? name : join(dir, name);
}

/** Recursively collect the _meta.json sidecars under dir, skipping the assets/ bundle (as walkHtml does). */
function walkSidecars(dir, root = dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'assets') walkSidecars(full, root, acc); } else if (htmlFor(entry.name)) acc.push(relative(root, full));
  }
  return acc;
}

/** Delivered (extensionless) path on the EDS site for a migrated HTML rel path. */
function deliveredPath(relHtml) {
  const noExt = relHtml.replace(/\.html$/, '');
  if (noExt === 'index') return '/';
  if (noExt.endsWith('/index')) return `/${noExt.slice(0, -'/index'.length)}`;
  return `/${noExt}`;
}

/** Delivered (extensionless) path for an absolute page URL (archetypes-only roster). */
function urlToDeliveredPath(url) {
  let p;
  try { p = new URL(url).pathname; } catch { p = String(url); }
  p = p.replace(/\.html$/, '');
  if (p === '' || p === '/' || p === '/index') return '/';
  if (p.endsWith('/index')) return p.slice(0, -'/index'.length);
  return p;
}

/** Stable slug from a delivered path (de/x/y -> de-x-y; '/' -> home). */
function pathToSlug(path) {
  if (path === '/') return 'home';
  return path.replace(/^\//, '').replace(/\/+$/, '').replace(/\//g, '-');
}

function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** The page that IS the template: migrate's Path A (fidelityTier `archetype`, renderBranch `A`). */
const isArchetype = (meta) => meta.fidelityTier === 'archetype' || meta.renderBranch === 'A';
const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

if (!existsSync(MIGRATED)) {
  console.error(`rollout inventory: migrated tree not found at "${MIGRATED}". Run \`stardust migrate\` first.`);
  process.exit(1);
}

// --- Load prior coverage to preserve delivery state ----------------------------
const coverageDir = join(OUT, 'coverage');
const pagesPath = join(coverageDir, 'pages.json');
const templatesPath = join(coverageDir, 'templates.json');
const configPath = join(OUT, 'rollout.json');

// update-coverage.mjs's lock for the same files (cluster writers record rows under it): taken before the first read,
// released at exit, so a status recorded meanwhile is never lost.
try { acquireLock(join(OUT, '.coverage')); } catch (e) { console.error(`rollout inventory: ${e.message}`); process.exit(1); }
const priorPages = readJSON(pagesPath, { pages: [] });
const priorBySlug = new Map((priorPages.pages || []).map((p) => [p.slug, p]));
const priorConfig = readJSON(configPath, null);

// --- Inventory the migrated tree -----------------------------------------------
const htmlFiles = walkHtml(MIGRATED).sort();
// the source URL of each page (the join key with a spec's knowledge): the sidecar's, else state.json's by slug
const stateFile = STATE || (existsSync('stardust/state.json') ? 'stardust/state.json' : null);
const stateDoc = stateFile ? readJSON(stateFile, { pages: [] }) : null;
const statePages = (stateDoc && Array.isArray(stateDoc.pages) ? stateDoc.pages : []).filter((p) => p && p.slug);
const stateUrls = new Map(statePages.filter((p) => p.url).map((p) => [p.slug, p.url]));
// identity (DA org/site, project hosts) a free-text field must not carry; the source origin is not identity
const tokens = identityTokens({
  rollout: { site: { ...((priorConfig && priorConfig.site) || {}), ...(SITE_URL ? { sourceUrl: SITE_URL } : {}) } },
  state: stateDoc,
});
const sidecars = new Map();
const pages = [];

// "Is this sidecar an encoded page?" and "is it the current clean encode?" are migrate's (encode/provenance.mjs
// encodedPageOf, currentEncode), in either layout — loaded only when a sidecar records an encode output.
// encode.output.path is project-relative: the project is the directory holding stardust/migrated, else the cwd.
const sidecarFiles = walkSidecars(MIGRATED).sort();
const encoder = await (async () => {
  if (!sidecarFiles.some((rel) => typeof readJSON(join(MIGRATED, rel), {})?.encode?.output?.path === 'string')) return null;
  const here = dirname(fileURLToPath(import.meta.url));
  const f = [join(here, '..', '..', 'migrate', 'scripts', 'encode', 'provenance.mjs'), join(here, '..', 'migrate', 'encode', 'provenance.mjs')].find((x) => existsSync(x));
  if (!f) {
    console.error(`rollout inventory: sidecars under "${MIGRATED}" record an encode, but migrate's encode/provenance.mjs is not beside this script — copy the migrate scripts (stardust/scripts/migrate/) too.`);
    process.exit(1);
  }
  return import(pathToFileURL(f).href);
})();
const PROJECT = (() => { const m = MIGRATED.replace(/[/\\]+$/, ''); return basename(m) === 'migrated' && basename(dirname(m)) === 'stardust' ? dirname(dirname(m)) : '.'; })();

for (const relHtml of htmlFiles) {
  const absHtml = join(MIGRATED, relHtml);
  const sourceHash = sha256(readFileSync(absHtml));
  const sidecarRel = sidecarFor(relHtml);
  const meta = readJSON(join(MIGRATED, sidecarRel), {});
  if (encoder && encoder.encodedPageOf(meta, { hasHtml: true })) continue; // an encoded sibling: listed below, from its sidecar
  const path = deliveredPath(relHtml);
  const slug = meta.slug || (path === '/' ? 'home' : path.replace(/^\//, ''));
  sidecars.set(slug, meta);

  const prior = priorBySlug.get(slug);
  let delivery;
  if (prior && prior.delivery) {
    const changed = prior.source && prior.source.sourceHash !== sourceHash;
    if (changed && ['deployed', 'verified'].includes(prior.delivery.status)) {
      delivery = { ...prior.delivery, status: 'stale' };
    } else {
      delivery = prior.delivery;
    }
  } else {
    delivery = { status: 'pending', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null };
  }

  pages.push({
    slug,
    path,
    title: (meta.metadata && meta.metadata.title) || meta.slug || slug,
    templateId: meta.template || (isArchetype(meta) ? slug : null) || meta.type || null,
    source: {
      migratedHtml: join(MIGRATED, relHtml),
      metaJson: existsSync(join(MIGRATED, sidecarRel)) ? join(MIGRATED, sidecarRel) : null,
      sourceHash,
      sourceUrl: (meta.source && meta.source.url) || meta.sourceUrl || stateUrls.get(slug) || null,
      ...(meta.variance && typeof meta.variance === 'object' && !Array.isArray(meta.variance) ? { variance: meta.variance } : {}),
    },
    blocks: Array.isArray(meta.modules) ? meta.modules : [],
    delivery,
  });
}

// --- Encoded pages: the same row shape, from the sidecar and the encoded document (row 2 drops the clone) --------
const notCurrent = [];
const encodedTemplates = new Map(); // slug → the template its sidecar names (kept in --state mode)
if (encoder) {
  const htmlSet = new Set(htmlFiles);
  const listed = new Set(pages.flatMap((p) => [`slug:${p.slug}`, `path:${p.path}`]));
  const manifests = new Map();
  for (const sidecarRel of sidecarFiles) {
    const meta = readJSON(join(MIGRATED, sidecarRel), {});
    const enc = encoder.encodedPageOf(meta, { hasHtml: htmlSet.has(htmlFor(sidecarRel)) });
    if (!enc) continue;
    const path = deliveredPath(enc.rel);
    const slug = meta.slug || (path === '/' ? 'home' : path.replace(/^\//, ''));
    if (listed.has(`slug:${slug}`) || listed.has(`path:${path}`)) continue;
    listed.add(`slug:${slug}`).add(`path:${path}`);
    const st = encoder.currentEncode({ root: PROJECT, sidecarPath: relative(PROJECT, join(MIGRATED, sidecarRel)).split(/[\\/]/).join('/'), manifests });
    const lastClean = typeof meta.encode.output.sha === 'string' && /^sha256:[0-9a-f]{64}$/.test(meta.encode.output.sha) ? meta.encode.output.sha : null;
    const sourceHash = st.ok ? st.sha : lastClean;
    if (!st.ok) notCurrent.push(`${slug} (${st.kind})`);
    // delivery carried by slug: content-pending → pending (the document exists now); a roster row's status stays (its
    // hash was the roster's, never the document's); a delivered page whose document's bytes changed → stale
    const prior = priorBySlug.get(slug);
    let delivery = { status: 'pending', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null };
    if (prior && prior.delivery) {
      const rosterRow = !prior.source || (!prior.source.migratedHtml && !prior.source.encodedHtml);
      const changed = !rosterRow && sourceHash !== null && prior.source.sourceHash !== sourceHash;
      if (prior.delivery.status === 'content-pending') delivery = { ...prior.delivery, status: 'pending' };
      else if (changed && ['deployed', 'verified'].includes(prior.delivery.status)) delivery = { ...prior.delivery, status: 'stale' };
      else delivery = prior.delivery;
    }
    const templateId = meta.template || (isArchetype(meta) ? slug : null) || meta.type || null;
    encodedTemplates.set(slug, templateId);
    pages.push({
      slug,
      path,
      title: (meta.metadata && meta.metadata.title) || meta.slug || slug,
      templateId,
      source: {
        migratedHtml: null,
        encodedHtml: join(PROJECT, enc.docPath),
        metaJson: join(MIGRATED, sidecarRel),
        sourceHash,
        sourceUrl: (meta.source && meta.source.url) || meta.sourceUrl || stateUrls.get(slug) || null,
      },
      blocks: Array.isArray(meta.modules) ? meta.modules : [],
      delivery,
    });
  }
}

// --- Archetypes-only mode: merge content-pending siblings from state.json -------
// In --state mode each migrated archetype is keyed by its own fine slug (the
// archetypes are genuinely distinct templates that share only chrome). A roster
// page's `type` names the archetype slug it clones; it joins that archetype's
// template group as a `content-pending` sibling, inheriting the archetype's blocks
// and pushing no document of its own.
// An encoded sibling keeps the template its sidecar names (the archetype's slug)
// and its roster entry is not listed again.
if (STATE) {
  for (const p of pages) p.templateId = p.slug;
  for (const p of pages) if (encodedTemplates.has(p.slug)) p.templateId = encodedTemplates.get(p.slug);
  const encodedSlugs = new Set(encodedTemplates.keys());
  const archetypeBySlug = new Map(pages.map((p) => [p.slug, p]));
  const coveredPaths = new Set(pages.map((p) => p.path));
  const usedSlugs = new Set(pages.map((p) => p.slug));
  const state = readJSON(STATE, { pages: [] });
  for (const sp of (state.pages || [])) {
    if (!sp || !sp.url) continue;
    const path = urlToDeliveredPath(sp.url);
    if (coveredPaths.has(path)) continue; // the archetype itself — already inventoried
    if (encodedSlugs.has(sp.slug)) continue; // an encoded page, listed from its sidecar at its delivered (sanitised) path
    // A roster sibling names the archetype it clones via `representative` (preferred)
    // or its `type`; that archetype supplies the template grouping + block set.
    const rep = archetypeBySlug.get(sp.representative) || archetypeBySlug.get(sp.type) || null;
    let slug = sp.slug && !usedSlugs.has(sp.slug) ? sp.slug : pathToSlug(path);
    while (usedSlugs.has(slug)) slug = `${slug}-x`;
    usedSlugs.add(slug);
    const csPath = sp.currentStatePath && existsSync(sp.currentStatePath) ? sp.currentStatePath : null;
    const sourceHash = csPath ? sha256(readFileSync(csPath)) : sha256(Buffer.from(String(sp.url)));
    const prior = priorBySlug.get(slug);
    const delivery = (prior && prior.delivery)
      ? prior.delivery
      : { status: 'content-pending', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null };
    pages.push({
      slug,
      path,
      title: sp.title || slug,
      templateId: rep ? rep.slug : (sp.type || 'untyped'),
      representative: rep ? rep.slug : null,
      source: { migratedHtml: null, metaJson: null, sourceHash, currentStatePath: csPath, sourceUrl: sp.url },
      blocks: rep ? rep.blocks.slice() : [],
      delivery,
    });
    coveredPaths.add(path);
  }
}

// --- Keep the rows update-coverage.mjs --new added (pages built outside the migrated tree) ---
// The origin marker in source.migratedHtml (`<origin>:<slug>`, never a path with a slash) identifies
// them. A prior row with the marker whose slug has no migrated file — and whose path no migrated page
// owns — is carried over untouched (status included); otherwise the migrated row wins.
const isOriginMarker = (s) => typeof s === 'string' && /^[a-z][a-z0-9-]*:[^/]+$/.test(s);
const migratedSlugs = new Set(pages.map((p) => p.slug));
const migratedPaths = new Set(pages.map((p) => p.path));
const kept = [];
for (const prior of (priorPages.pages || [])) {
  if (!prior || !prior.source || !isOriginMarker(prior.source.migratedHtml)) continue;
  if (migratedSlugs.has(prior.slug) || migratedPaths.has(prior.path)) continue;
  pages.push(prior);
  kept.push(prior.slug);
  migratedSlugs.add(prior.slug);
  migratedPaths.add(prior.path);
}

// --- Delivered structure: what each page's content file is made of (null while it has none) ---
// A block record's variantId is minted from its identity (block + classes), unless the prior pages.json
// already gave that identity another id: an id a client stored never changes.
const priorIds = priorVariantIds(priorPages);
const inContent = (rel) => !rel.split('/').includes('..') && existsSync(join(CONTENT, rel)) && statSync(join(CONTENT, rel)).isFile();
const styleOf = (s) => (s == null ? null : scrubIdentity(s, tokens));
function deliveredFor(p) {
  const file = typeof p.path === 'string' ? contentFileFor(p.path, inContent) : null;
  if (!file) return null;
  const bytes = readFileSync(join(CONTENT, file));
  const { records, sections } = parseDelivered(bytes.toString('utf8'));
  const meta = sidecars.get(p.slug) || {};
  const snapshot = join(dirname(OUT), 'current', 'pages', `${p.slug}.html`);
  return {
    blocks: records.map((r) => ({
      ...r,
      section: styleOf(r.section),
      variantId: r.kind === 'block' ? priorIds.get(variantIdentity(r.block, r.classes)) || variantId(r.block, r.classes) : null,
    })),
    sections: sections.map((s) => ({ ...s, style: styleOf(s.style) })),
    lang: nonEmpty(meta.metadata && meta.metadata.lang),
    sourceSnapshot: existsSync(snapshot) ? snapshot : null,
    contentHash: sha256(bytes),
  };
}
/** The row with `delivered` right after `blocks` (a row carried over may hold a previous one). */
function withDelivered(row, delivered) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'delivered') continue;
    if (k === 'delivery' && !('delivered' in out)) out.delivered = delivered;
    out[k] = v;
    if (k === 'blocks') out.delivered = delivered;
  }
  if (!('delivered' in out)) out.delivered = delivered;
  return out;
}
for (let i = 0; i < pages.length; i++) pages[i] = withDelivered(pages[i], deliveredFor(pages[i]));

pages.sort((a, b) => a.slug.localeCompare(b.slug));

// --- Derive the template grouping ----------------------------------------------
const stateTypes = new Map(statePages.map((p) => [p.slug, p.type]));
const tmap = new Map();
for (const p of pages) {
  const id = p.templateId || 'untyped';
  if (!tmap.has(id)) tmap.set(id, { id, pages: [], blocks: new Set() });
  const t = tmap.get(id);
  t.pages.push(p.slug);
  p.blocks.forEach((b) => t.blocks.add(b));
}
const templates = [...tmap.values()].map((t) => {
  const tp = pages.filter((p) => t.pages.includes(p.slug));
  const count = (s) => tp.filter((p) => p.delivery.status === s).length;
  // The representative is the migrated archetype that converts the blocks — never a
  // content-pending sibling (which pushes no document).
  const rep = tp.find((p) => p.slug === t.id) || tp.find((p) => p.delivery.status !== 'content-pending') || tp[0];
  const repUrl = (rep && nonEmpty(rep.source && rep.source.sourceUrl)) || null;
  const urls = [...new Set(tp.map((p) => nonEmpty(p.source && p.source.sourceUrl)).filter((u) => u && u !== repUrl))].sort(byStr);
  return {
    id: t.id,
    type: (rep && (nonEmpty((sidecars.get(rep.slug) || {}).type) || nonEmpty(stateTypes.get(rep.slug)))) || null,
    representativeSlug: (rep && rep.slug) || null,
    representativeUrl: repUrl,
    pages: t.pages.sort(),
    pageCount: t.pages.length,
    urls: repUrl ? [repUrl, ...urls] : urls,
    blocks: [...t.blocks].sort(),
    delivery: {
      verified: count('verified'),
      deployed: count('deployed'),
      contentPending: count('content-pending'),
      pending: t.pages.length - count('verified') - count('deployed') - count('content-pending'),
    },
  };
}).sort((a, b) => a.id.localeCompare(b.id));

// --- Counts summary ------------------------------------------------------------
const status = (s) => pages.filter((p) => p.delivery.status === s).length;
const counts = {
  total: pages.length,
  verified: status('verified'),
  deployed: status('deployed'),
  pending: status('pending'),
  contentPending: status('content-pending'),
  stale: status('stale'),
  failed: status('failed'),
};

// --- Write ---------------------------------------------------------------------
const now = new Date().toISOString();
mkdirSync(coverageDir, { recursive: true });

const readArtifacts = [MIGRATED, ...(STATE ? [STATE] : []), ...(existsSync(CONTENT) ? [CONTENT] : [])];
const prov = (writtenBy) => ({ writtenBy, writtenAt: now, readArtifacts, stardustVersion: STARDUST_VERSION });

// judged template names and descriptions (the Phase I judgement pass) survive every re-run
applyTemplateJudgement(templates, readJSON(join(OUT, 'workspace', 'judgement.json'), null), tokens);
// unchanged coverage is not rewritten, so a re-run with unchanged inputs leaves both files byte-identical
const wrote = [
  writeCoverage(pagesPath, { _provenance: prov('stardust:rollout/inventory'), formatVersion: COVERAGE_FORMAT_VERSION, generatedAt: now, pages }),
  writeCoverage(templatesPath, { _provenance: prov('stardust:rollout/inventory'), formatVersion: COVERAGE_FORMAT_VERSION, generatedAt: now, templates }),
];

// The opt-in `exports` key is not derived from the tree: carry it forward (strings, once each, in order), then add --export.
const priorExports = priorConfig && Array.isArray(priorConfig.exports) ? priorConfig.exports.filter((e) => typeof e === 'string') : [];
const config = {
  _provenance: { writtenBy: 'stardust:rollout/inventory', writtenAt: now, stardustVersion: STARDUST_VERSION },
  target: 'aem-eds',
  site: {
    sourceUrl: SITE_URL || (priorConfig && priorConfig.site && priorConfig.site.sourceUrl) || 'about:blank',
    da: (priorConfig && priorConfig.site && priorConfig.site.da) || { org: '', site: '', ref: 'main' },
    liveHost: (priorConfig && priorConfig.site && priorConfig.site.liveHost) || null,
  },
  exports: [...new Set([...priorExports, ...EXPORTS])],
  lastRun: { at: now, pages: counts, blocks: { total: 0, converted: 0, pending: 0 }, verifyFailures: 0 },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

// --- Report --------------------------------------------------------------------
console.log(`rollout inventory → ${OUT}`);
console.log('='.repeat(60));
console.log(`Pages       ${counts.total} total · ${counts.verified} verified · ${counts.deployed} deployed · ${counts.pending} pending · ${counts.contentPending} content-pending · ${counts.stale} stale`);
console.log(`Templates   ${templates.length} (${templates.map((t) => `${t.id}:${t.pageCount}`).join(', ')})`);
if (kept.length) console.log(`Kept        ${kept.length} row(s) built outside the migrated tree (update-coverage.mjs --new), status untouched: ${kept.join(', ')}`);
const delivered = pages.filter((p) => p.delivered).length;
console.log(`Delivered   ${delivered}/${pages.length} pages parsed from ${CONTENT}${delivered < pages.length ? ` · ${pages.length - delivered} without a content file (delivered: null)` : ''}${wrote.some(Boolean) ? '' : ' · coverage unchanged, not rewritten'}`);
if (notCurrent.length) console.log(`Not current ${notCurrent.length} encoded page(s) — deploy stages none of them until each encodes clean; the row keeps the last clean encode's hash: ${notCurrent.join(', ')}`);
const blockless = pages.filter((p) => p.source.metaJson && !p.blocks.length).length;
if (blockless) console.log(`Blocks      modules[] empty on ${blockless}/${pages.length} sidecars — Phase B (blocks.mjs) dedups from them: fill each page's block ids (composite sections; title, text, image, button, separator are default content) and re-run the inventory`);
const todo = pages.filter((p) => ['pending', 'stale', 'failed'].includes(p.delivery.status));
if (todo.length) console.log(`To deliver  ${todo.length}: ${todo.slice(0, 8).map((p) => p.slug).join(', ')}${todo.length > 8 ? ' …' : ''}`);
else console.log('To deliver  0 — all pages delivered.');
