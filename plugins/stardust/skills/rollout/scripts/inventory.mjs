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
 *
 * Phase 1 scope: pages + template grouping only. Block dedup (blocks.json) is a
 * first-class step deferred to Phase 2 — see notes/rollout/PLAN.md § 8.
 *
 * Archetypes-only mode (`--state <state.json>`): the migrated tree holds only the
 * template archetypes (one per template); the full page roster lives in state.json.
 * Pages present only in state.json (not yet individually migrated) are merged in as
 * `content-pending` siblings — keyed to the archetype their `type` names, inheriting
 * that archetype's blocks, pushing no document. Block code ships from the archetypes;
 * sibling content is populated later by a separate content track.
 *
 * Typed rows (`--content <eds-root>/content`): the chrome documents, fragments
 * and sheets the site serves are coverage rows too, so verify/assemble/optimize
 * see them with their type instead of a hand-added row that the next run drops:
 *   nav*.html / footer*.html at the content root → delivery.type `fragment`, path /nav, /footer, /nav-<lang>…, slug chrome-<name>
 *   fragments/**\/*.html                         → `fragment`, path /fragments/<x>, slug fragment-<x-with-dashes>
 *   **\/*.json                                   → `index`, path /<x>.json, slug index-<x-with-dashes>
 * Prior delivery is preserved by slug. A typed row whose source file is gone is
 * KEPT with `source.missing: true` — never silently dropped; a re-run without
 * --content, or with a --content dir that does not exist (warned), carries every
 * typed row over unchanged (flag preserved). Typed rows are excluded from the
 * template roll-ups (templates.json).
 *
 * `--redirects <tsv>` (source<TAB>destination, the Gate 3 file) seeds
 * `delivery.deployedPath` on a row whose `path` is a Source: the page is served
 * at the Destination (the source slug stays the key). Never overwrites a value
 * update-coverage --from-ledger already wrote.
 *
 * Usage:
 *   node skills/rollout/scripts/inventory.mjs [--migrated <dir>] [--out <rolloutDir>] [--site-url <url>] [--state <state.json>]
 *        [--content <dir>] [--redirects <tsv>]
 *   defaults: --migrated stardust/migrated  --out stardust/rollout
 * Exit: 0 written · 1 migrated tree missing
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`rollout inventory: --${name} needs a value`); process.exit(2); } // `--state --content <dir>` once read STATE='--content' and silently ran archetypes-only
  return v;
}

if (process.argv.includes('--help')) { console.log('Usage: node skills/rollout/scripts/inventory.mjs [--migrated <dir>] [--out <rolloutDir>] [--site-url <url>] [--state <state.json>] [--content <dir>] [--redirects <tsv>]\n  exit 0 written · 1 migrated tree missing'); process.exit(0); }
const MIGRATED = arg('migrated', 'stardust/migrated');
const CONTENT = arg('content', null);
const REDIRECTS = arg('redirects', null);
const OUT = arg('out', 'stardust/rollout');
const SITE_URL = arg('site-url', null);
const STATE = arg('state', null);

const STARDUST_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pj = JSON.parse(readFileSync(join(here, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    return pj.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

function sha256(buf) { return `sha256:${createHash('sha256').update(buf).digest('hex')}`; }

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

/** Stable slug from a delivered path (de/x/y -> de-x-y; '/' -> index — ia-extraction.md § Slug derivation). */
function pathToSlug(path) {
  if (path === '/') return 'index';
  return path.replace(/^\//, '').replace(/\/+$/, '').replace(/\//g, '-');
}

function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

if (!existsSync(MIGRATED)) {
  console.error(`rollout inventory: migrated tree not found at "${MIGRATED}". Run \`stardust migrate\` first.`);
  process.exit(1);
}

// --- Load prior coverage to preserve delivery state ----------------------------
const coverageDir = join(OUT, 'coverage');
const pagesPath = join(coverageDir, 'pages.json');
const templatesPath = join(coverageDir, 'templates.json');
const configPath = join(OUT, 'rollout.json');

const priorPages = readJSON(pagesPath, { pages: [] });
const priorBySlug = new Map((priorPages.pages || []).map((p) => [p.slug, p]));

// --- Inventory the migrated tree -----------------------------------------------
const htmlFiles = walkHtml(MIGRATED).sort();
const pages = [];

for (const relHtml of htmlFiles) {
  const absHtml = join(MIGRATED, relHtml);
  const sourceHash = sha256(readFileSync(absHtml));
  const sidecarRel = sidecarFor(relHtml);
  const meta = readJSON(join(MIGRATED, sidecarRel), {});
  const path = deliveredPath(relHtml);
  const slug = meta.slug || (path === '/' ? 'index' : path.replace(/^\//, ''));

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
    templateId: meta.template || meta.type || null,
    source: {
      migratedHtml: join(MIGRATED, relHtml),
      metaJson: existsSync(join(MIGRATED, sidecarRel)) ? join(MIGRATED, sidecarRel) : null,
      sourceHash,
    },
    blocks: Array.isArray(meta.modules) ? meta.modules : [],
    delivery,
  });
}

// --- Archetypes-only mode: merge content-pending siblings from state.json -------
// In --state mode each migrated archetype is keyed by its own fine slug (the
// archetypes are genuinely distinct templates that share only chrome). A roster
// page's `type` names the archetype slug it clones; it joins that archetype's
// template group as a `content-pending` sibling, inheriting the archetype's blocks
// and pushing no document of its own.
if (STATE) {
  for (const p of pages) p.templateId = p.slug;
  const archetypeBySlug = new Map(pages.map((p) => [p.slug, p]));
  const coveredPaths = new Set(pages.map((p) => p.path));
  const usedSlugs = new Set(pages.map((p) => p.slug));
  const state = readJSON(STATE, { pages: [] });
  for (const sp of (state.pages || [])) {
    if (!sp || !sp.url) continue;
    const path = urlToDeliveredPath(sp.url);
    if (coveredPaths.has(path)) continue; // the archetype itself — already inventoried
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
      source: { migratedHtml: null, metaJson: null, sourceHash, currentStatePath: csPath },
      blocks: rep ? rep.blocks.slice() : [],
      delivery,
    });
    coveredPaths.add(path);
  }
}

// --- Typed rows: chrome documents, fragments, sheets ----------------------------
// Seeded from the EDS content tree (--content) and preserved across runs: a hand-
// or script-added fragment row must survive the next inventory (it used to be
// rebuilt from the migrated tree alone and lost).
const TYPED = new Set(['fragment', 'index']);
const typedSlugs = new Set();
// Only a content dir that was actually walked can say a source file is gone: a
// --content that does not exist carries every typed row over unchanged.
const CONTENT_DIR = CONTENT && existsSync(CONTENT) ? CONTENT : null;
if (CONTENT && !CONTENT_DIR) console.error(`rollout inventory: --content "${CONTENT}" not found — typed rows carried over unchanged (source.missing not touched).`);
const seedTyped = (slug, path, type, absFile) => {
  if (typedSlugs.has(slug) || pages.some((p) => p.slug === slug)) return;
  typedSlugs.add(slug);
  const prior = priorBySlug.get(slug);
  const sourceHash = sha256(readFileSync(absFile));
  let delivery = (prior && prior.delivery) ? { ...prior.delivery } : { status: 'pending', deployedUrl: null, deployedAt: null, verifiedAt: null, error: null };
  if (prior && prior.source && prior.source.sourceHash !== sourceHash && ['deployed', 'verified'].includes(delivery.status)) delivery.status = 'stale';
  delivery.type = type;
  pages.push({ slug, path, title: (prior && prior.title) || slug, templateId: null, source: { contentFile: absFile, sourceHash, missing: false }, blocks: [], delivery });
};
if (CONTENT_DIR) {
  const walkAll = (dir, root = dir, acc = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walkAll(full, root, acc); else acc.push(relative(root, full));
    }
    return acc;
  };
  for (const rel of walkAll(CONTENT_DIR).sort()) {
    const abs = join(CONTENT_DIR, rel);
    const noExt = rel.replace(/\.(html|json)$/, '');
    const dashed = noExt.replace(/\//g, '-');
    if (/^(nav|footer)[^/]*\.html$/.test(rel)) seedTyped(`chrome-${noExt}`, `/${noExt}`, 'fragment', abs);
    else if (/^fragments\/.+\.html$/.test(rel)) seedTyped(`fragment-${dashed.replace(/^fragments-/, '')}`, `/${noExt}`, 'fragment', abs);
    else if (/\.json$/.test(rel)) seedTyped(`index-${dashed}`, `/${rel}`, 'index', abs);
  }
}
// carry over prior typed rows not re-seeded this run (source gone, or no content dir walked)
for (const prior of priorPages.pages || []) {
  const t = prior.delivery && prior.delivery.type;
  if (!TYPED.has(t) || typedSlugs.has(prior.slug) || pages.some((p) => p.slug === prior.slug)) continue;
  typedSlugs.add(prior.slug);
  pages.push({ ...prior, source: { ...(prior.source || {}), missing: CONTENT_DIR ? true : (prior.source && prior.source.missing) || false } });
}

// --- Redirect-seeded served paths (source slug key, destination served) ----------
if (REDIRECTS && !existsSync(REDIRECTS)) console.error(`rollout inventory: --redirects "${REDIRECTS}" not found — no deployedPath seeded (renamed pages verify at their old URL).`);
if (REDIRECTS && existsSync(REDIRECTS)) {
  const canon = (p) => { let s = String(p).trim().split(/[?#]/)[0].toLowerCase(); s = s.replace(/\.html?$/, '').replace(/\/+$/, ''); return s || '/'; };
  const dest = new Map();
  for (const line of readFileSync(REDIRECTS, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const [src, dst] = t.split('\t').map((x) => (x || '').trim());
    if (src && dst) dest.set(canon(src), canon(dst));
  }
  for (const p of pages) {
    const d = dest.get(canon(p.path));
    if (d && d !== canon(p.path) && !(p.delivery && p.delivery.deployedPath)) p.delivery.deployedPath = d;
  }
}

pages.sort((a, b) => a.slug.localeCompare(b.slug));

// --- Derive the template grouping (page rows only — typed rows are not templated)
const tmap = new Map();
for (const p of pages) {
  if (TYPED.has(p.delivery && p.delivery.type)) continue;
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
  const rep = tp.find((p) => p.delivery.status !== 'content-pending') || tp[0];
  return {
    id: t.id,
    representativeSlug: (rep && rep.slug) || null,
    pages: t.pages.sort(),
    pageCount: t.pages.length,
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
const typedCount = pages.filter((p) => TYPED.has(p.delivery && p.delivery.type)).length;

// --- Write ---------------------------------------------------------------------
const now = new Date().toISOString();
mkdirSync(coverageDir, { recursive: true });

const prov = (writtenBy) => ({
  writtenBy, writtenAt: now, readArtifacts: [MIGRATED, STATE, CONTENT_DIR, REDIRECTS].filter(Boolean), stardustVersion: STARDUST_VERSION,
});

writeFileSync(pagesPath, `${JSON.stringify({ _provenance: prov('stardust:rollout/inventory'), generatedAt: now, pages }, null, 2)}\n`);
writeFileSync(templatesPath, `${JSON.stringify({ _provenance: prov('stardust:rollout/inventory'), generatedAt: now, templates }, null, 2)}\n`);

const priorConfig = readJSON(configPath, null);
const config = {
  _provenance: { writtenBy: 'stardust:rollout/inventory', writtenAt: now, stardustVersion: STARDUST_VERSION },
  target: 'aem-eds',
  site: {
    sourceUrl: SITE_URL || (priorConfig && priorConfig.site && priorConfig.site.sourceUrl) || 'about:blank',
    da: (priorConfig && priorConfig.site && priorConfig.site.da) || { org: '', site: '', ref: 'main' },
    liveHost: (priorConfig && priorConfig.site && priorConfig.site.liveHost) || null, // stored as given; scripts normalise on read (lib.mjs siteBase)
  },
  links: (priorConfig && priorConfig.links) || { outsideInventory: 'fail' },
  lastRun: { at: now, pages: counts, blocks: { total: 0, converted: 0, pending: 0 }, verifyFailures: 0 },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

// --- Report --------------------------------------------------------------------
console.log(`rollout inventory → ${OUT}`);
console.log('='.repeat(60));
console.log(`Pages       ${counts.total} total · ${counts.verified} verified · ${counts.deployed} deployed · ${counts.pending} pending · ${counts.contentPending} content-pending · ${counts.stale} stale${typedCount ? ` · typed rows ${typedCount} (fragment/index)` : ''}`);
console.log(`Templates   ${templates.length} (${templates.map((t) => `${t.id}:${t.pageCount}`).join(', ')})`);
const todo = pages.filter((p) => ['pending', 'stale', 'failed'].includes(p.delivery.status));
if (todo.length) console.log(`To deliver  ${todo.length}: ${todo.slice(0, 8).map((p) => p.slug).join(', ')}${todo.length > 8 ? ' …' : ''}`);
else console.log('To deliver  0 — all pages delivered.');
