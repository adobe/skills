/**
 * rollout/lib.mjs — shared IO + roll-up helpers so every script derives the same
 * counts from the same per-unit truth (counts are always recomputed, never
 * incremented).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

const countBy = (rows, get, val) => rows.filter((r) => get(r) === val).length;

/** Page delivery counts from coverage/pages.json rows. */
export function pageCounts(pages) {
  const g = (p) => (p.delivery && p.delivery.status) || 'pending';
  return {
    total: pages.length,
    verified: countBy(pages, g, 'verified'),
    deployed: countBy(pages, g, 'deployed'),
    pending: countBy(pages, g, 'pending'),
    stale: countBy(pages, g, 'stale'),
    failed: countBy(pages, g, 'failed'),
  };
}

/** Block conversion counts from coverage/blocks.json rows. */
export function blockCounts(blocks) {
  const converted = blocks.filter((b) => ['converted', 'deployed', 'verified']
    .includes(b.delivery && b.delivery.status)).length;
  return { total: blocks.length, converted, pending: blocks.length - converted };
}

/** Recompute each template's delivery roll-up in place from the page rows. */
export function rollupTemplates(templatesDoc, pages) {
  if (!templatesDoc || !Array.isArray(templatesDoc.templates)) return;
  for (const t of templatesDoc.templates) {
    const tp = pages.filter((p) => (t.pages || []).includes(p.slug));
    const g = (p) => (p.delivery && p.delivery.status) || 'pending';
    t.delivery = {
      verified: countBy(tp, g, 'verified'),
      deployed: countBy(tp, g, 'deployed'),
      pending: tp.length - countBy(tp, g, 'verified') - countBy(tp, g, 'deployed'),
    };
  }
}

/** Recompute rollout.json lastRun from the page + (optional) block rows. */
export function rollupConfig(config, pages, blocks, now) {
  if (!config) return;
  const counts = pageCounts(pages);
  config.lastRun = {
    ...(config.lastRun || {}),
    at: now,
    pages: counts,
    blocks: blocks ? blockCounts(blocks) : (config.lastRun && config.lastRun.blocks) || { total: 0, converted: 0, pending: 0 },
    verifyFailures: counts.failed,
  };
}

/** EDS block name from a block id: kebab + guard against reserved EDS classes (#15). */
const RESERVED = new Set(['section', 'default-content', 'block-content', 'wrap', 'button']);
export function edsName(id) {
  let n = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!n) n = 'block';
  if (RESERVED.has(n)) n = `blk-${n}`;
  return n;
}

/** Chrome ids deliver as static fragments, not per-page blocks. */
export const CHROME_IDS = new Set(['header', 'nav', 'footer']);
export const kindOf = (id) => (CHROME_IDS.has(String(id).toLowerCase()) ? 'chrome' : 'module');

/** Map a delivered (extensionless) path to a file under root (migrated-tree shape). */
export function resolveLocalFile(root, p) {
  const candidates = p === '/' ? ['index.html'] : [`${p.slice(1)}.html`, `${p.slice(1)}/index.html`, p.slice(1)];
  for (const c of candidates) { const f = join(root, c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

/** Load a page's HTML by HTTP (base) or from a local root. Returns {ok, body, reason}. */
export async function loadPageHTML(page, { root, base }) {
  if (root) {
    const f = resolveLocalFile(root, page.path);
    if (!f) return { ok: false, reason: `not found under ${root}` };
    return { ok: true, body: readFileSync(f, 'utf8') };
  }
  try {
    const res = await fetch(`${base}${page.path}`);
    const body = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, body };
  } catch (e) { return { ok: false, reason: `fetch error: ${e.message}` }; }
}

// --- optimize: layers, scoring, and the AEM autofix registry --------------------
export const ALL_LAYERS = ['brand-tensions', 'design-ux', 'accessibility', 'seo', 'content-conversion', 'ai-search', 'cross-page'];
export const ASSESSED_BY_BASELINE = ['accessibility', 'seo', 'ai-search', 'cross-page'];
export const SEV_WEIGHT = { P1: 25, P2: 10, P3: 4 };

/**
 * AEM autofix registry: maps a finding's `check` to the EDS fixer that resolves it.
 * kind: 'deterministic' (mechanical edit) | 'content-draft' (generates copy needing
 * review — applied under the aggressive policy, logged) | 'manual' (autofix prepares
 * a payload/guidance but a human applies it). target is aem-eds for v1.
 */
export const AEM_AUTOFIX = {
  'title-missing': { strategy: 'eds-metadata-title', kind: 'content-draft' },
  'title-length': { strategy: 'eds-metadata-title', kind: 'content-draft' },
  'meta-description': { strategy: 'eds-metadata-description', kind: 'content-draft' },
  'single-h1': { strategy: 'eds-fix-h1', kind: 'deterministic' },
  'img-alt': { strategy: 'eds-alt-draft', kind: 'content-draft' },
  'duplicate-title': { strategy: 'eds-disambiguate-title', kind: 'content-draft' },
  'sitemap': { strategy: 'rollout-assemble', kind: 'deterministic' },
  'jsonld': { strategy: 'eds-jsonld', kind: 'manual' },
  'canonical': { strategy: 'eds-canonical', kind: 'manual' },
  'landmark-main': { strategy: 'eds-landmark-main', kind: 'manual' },
};

/** The autofix descriptor for a finding (check), or an unavailable stub. */
export function autofixFor(check) {
  const a = AEM_AUTOFIX[check];
  if (!a) return { available: false, target: 'aem-eds', strategy: null, kind: null, status: 'unavailable', appliedBy: null, at: null, detail: null };
  return { available: true, target: 'aem-eds', strategy: a.strategy, kind: a.kind, status: 'pending', appliedBy: null, at: null, detail: null };
}

/** Compute a scorecard snapshot from the full findings list. */
export function computeScorecard(findings, runId, now) {
  const open = findings.filter((x) => x.status === 'open' || x.status === 'in-progress');
  const fixed = findings.filter((x) => x.status === 'fixed');
  const assessed = new Set();
  for (const f of findings) assessed.add(f.layer);
  const dimensions = {};
  for (const layer of ALL_LAYERS) {
    if (!assessed.has(layer)) { dimensions[layer] = null; continue; }
    const penalty = open.filter((x) => x.layer === layer).reduce((n, x) => n + (SEV_WEIGHT[x.severity] || 0), 0);
    dimensions[layer] = Math.max(0, 100 - penalty);
  }
  const scored = ALL_LAYERS.map((l) => dimensions[l]).filter((v) => v !== null);
  const overall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const sev = (arr, s) => arr.filter((x) => x.severity === s).length;
  return {
    runId, at: now, overall, dimensions,
    severity: { P1: sev(open, 'P1'), P2: sev(open, 'P2'), P3: sev(open, 'P3') },
    fixed: { P1: sev(fixed, 'P1'), P2: sev(fixed, 'P2'), P3: sev(fixed, 'P3') },
  };
}
