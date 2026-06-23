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
 * Usage:
 *   node skills/rollout/scripts/inventory.mjs [--migrated <dir>] [--out <rolloutDir>] [--site-url <url>]
 *   defaults: --migrated stardust/migrated  --out stardust/rollout
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MIGRATED = arg('migrated', 'stardust/migrated');
const OUT = arg('out', 'stardust/rollout');
const SITE_URL = arg('site-url', null);

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
  const slug = meta.slug || (path === '/' ? 'home' : path.replace(/^\//, ''));

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

pages.sort((a, b) => a.slug.localeCompare(b.slug));

// --- Derive the template grouping ----------------------------------------------
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
  return {
    id: t.id,
    representativeSlug: t.pages[0] || null,
    pages: t.pages.sort(),
    pageCount: t.pages.length,
    blocks: [...t.blocks].sort(),
    delivery: {
      verified: count('verified'),
      deployed: count('deployed'),
      pending: t.pages.length - count('verified') - count('deployed'),
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
  stale: status('stale'),
  failed: status('failed'),
};

// --- Write ---------------------------------------------------------------------
const now = new Date().toISOString();
mkdirSync(coverageDir, { recursive: true });

const prov = (writtenBy) => ({
  writtenBy, writtenAt: now, readArtifacts: [MIGRATED], stardustVersion: STARDUST_VERSION,
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
    liveHost: (priorConfig && priorConfig.site && priorConfig.site.liveHost) || null,
  },
  lastRun: { at: now, pages: counts, blocks: { total: 0, converted: 0, pending: 0 }, verifyFailures: 0 },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

// --- Report --------------------------------------------------------------------
console.log(`rollout inventory → ${OUT}`);
console.log('='.repeat(60));
console.log(`Pages       ${counts.total} total · ${counts.verified} verified · ${counts.deployed} deployed · ${counts.pending} pending · ${counts.stale} stale`);
console.log(`Templates   ${templates.length} (${templates.map((t) => `${t.id}:${t.pageCount}`).join(', ')})`);
const todo = pages.filter((p) => ['pending', 'stale', 'failed'].includes(p.delivery.status));
if (todo.length) console.log(`To deliver  ${todo.length}: ${todo.slice(0, 8).map((p) => p.slug).join(', ')}${todo.length > 8 ? ' …' : ''}`);
else console.log('To deliver  0 — all pages delivered.');
