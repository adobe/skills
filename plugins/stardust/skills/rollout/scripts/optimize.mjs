#!/usr/bin/env node
/**
 * rollout/optimize.mjs — the in-flow delivery-quality gate (Phase 3).
 *
 * Runs deterministic detectors over the delivered (or migrated) HTML, records a
 * findings ledger + scorecard, and GATES the rollout: exits non-zero if any open
 * P1 finding is in scope. Implements the detect -> fix -> verify loop — on re-run,
 * a prior open finding no longer detected flips to `fixed`; a regressed `fixed`
 * finding re-opens. Findings are tagged by fixability so the report routes them:
 *   platform-migration → rollout fixes by re-running deploy
 *   design-pass        → upstream (fix in migrate/prototype); rollout surfaces only
 *   out-of-scope       → informational
 *
 * Automated layers: accessibility, seo, ai-search, cross-page. The judgment layers
 * (brand-tensions, design-ux, content-conversion) are left null (not assessed) for
 * a future LLM-driven enrichment pass.
 *
 * Usage: node skills/rollout/scripts/optimize.mjs [--base <url> | --root <dir>]
 *          [--slug <s>] [--all] [--out <rolloutDir>]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, loadPageHTML, computeScorecard, autofixFor, ASSESSED_BY_BASELINE } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const OUT = arg('out', 'stardust/rollout');
const ROOT = arg('root', null);
const onlySlug = arg('slug', null);
const ALL = process.argv.includes('--all');

const SOURCE = 'rollout:baseline';
const ASSESSED = ASSESSED_BY_BASELINE;
const PHASE_FOR = { 'platform-migration': 'deploy', 'design-pass': 'migrate', 'out-of-scope': 'rollout' };

const config = readJSON(join(OUT, 'rollout.json'), {});
const BASE = arg('base', (config.site && config.site.liveHost) ? `https://${config.site.liveHost}` : null);
const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!pagesDoc) { console.error('rollout optimize: run inventory.mjs first.'); process.exit(1); }
if (!ROOT && !BASE) { console.error('rollout optimize: need --base <url> or --root <dir> (or set site.liveHost).'); process.exit(2); }
const pages = pagesDoc.pages || [];

const fid = (layer, check, level, ids) => `f-${createHash('sha1').update(`${SOURCE}|${layer}|${check}|${level}|${[...ids].sort().join(',')}`).digest('hex').slice(0, 10)}`;
const mk = (layer, check, severity, fixability, level, ids, evidence, recommendedMove) =>
  ({ id: fid(layer, check, level, ids), source: SOURCE, layer, check, severity, fixability, scope: { level, ids }, evidence, recommendedMove, autofix: autofixFor(check) });

// --- Detectors -----------------------------------------------------------------
const has = (re, s) => re.test(s);
const titleOf = (html) => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || null;
const descOf = (html) => (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1]?.trim() || null;

function detectPage(html, slug) {
  const f = [];
  const lvl = 'page'; const id = [slug];
  // accessibility
  if (!has(/<main[\s>]/i, html)) f.push(mk('accessibility', 'landmark-main', 'P1', 'platform-migration', lvl, id, 'no <main> landmark in delivered HTML', 'EDS decorates <main>; ensure block output lands inside <main> (deploy anti-pattern 17).'));
  const imgsNoAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length;
  if (imgsNoAlt) f.push(mk('accessibility', 'img-alt', 'P2', 'design-pass', lvl, id, `${imgsNoAlt} <img> without alt`, 'Author alt text upstream (migrate/prototype); rollout cannot synthesize it.'));
  // seo
  const title = titleOf(html);
  if (!title) f.push(mk('seo', 'title-missing', 'P1', 'platform-migration', lvl, id, 'no <title>', 'Add a metadata block (deploy #34); EDS derives <title> from it.'));
  else if (title.length < 10 || title.length > 70) f.push(mk('seo', 'title-length', 'P3', 'platform-migration', lvl, id, `<title> is ${title.length} chars ("${title.slice(0, 40)}")`, 'Aim for ~50-60 chars: brand + primary keyword (deploy #34).'));
  if (!descOf(html)) f.push(mk('seo', 'meta-description', 'P2', 'platform-migration', lvl, id, 'no <meta name="description">', 'Add a Description row to the metadata block (deploy #34).'));
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) f.push(mk('seo', 'single-h1', 'P1', 'platform-migration', lvl, id, `${h1} <h1> (expected exactly 1)`, 'Hero/lead headline = the page\'s single <h1>; other titles <h2> (deploy #35).'));
  if (!has(/<link[^>]+rel=["']canonical["']/i, html)) f.push(mk('seo', 'canonical', 'P2', 'platform-migration', lvl, id, 'no rel=canonical', 'Emit a self-canonical link at delivery.'));
  // ai-search
  if (!has(/application\/ld\+json/i, html)) f.push(mk('ai-search', 'jsonld', 'P2', 'platform-migration', lvl, id, 'no JSON-LD structured data', 'Emit page-type JSON-LD in the head (metadata-and-jsonld).'));
  return f;
}

function detectSite(loaded) {
  const f = [];
  // cross-page title / description uniqueness
  const byTitle = new Map(); const byDesc = new Map();
  for (const { slug, title, desc } of loaded) {
    if (title) { if (!byTitle.has(title)) byTitle.set(title, []); byTitle.get(title).push(slug); }
    if (desc) { if (!byDesc.has(desc)) byDesc.set(desc, []); byDesc.get(desc).push(slug); }
  }
  for (const [title, slugs] of byTitle) if (slugs.length > 1) f.push(mk('cross-page', 'duplicate-title', 'P2', 'design-pass', 'page', slugs, `${slugs.length} pages share <title> "${title.slice(0, 40)}"`, 'Give each page a unique title upstream (migrate metadata).'));
  for (const [, slugs] of byDesc) if (slugs.length > 1) f.push(mk('cross-page', 'duplicate-description', 'P3', 'design-pass', 'page', slugs, `${slugs.length} pages share a meta description`, 'Write per-page descriptions upstream.'));
  // sitemap present
  const sitemapLocal = existsSync(join(OUT, 'site', 'sitemap.xml'));
  if (!sitemapLocal) f.push(mk('seo', 'sitemap', 'P2', 'platform-migration', 'site', ['*'], 'no sitemap.xml assembled', 'Run assemble.mjs and deploy the sitemap.'));
  return f;
}

// --- Select pages + load HTML --------------------------------------------------
const target = pages.filter((p) => {
  if (onlySlug) return p.slug === onlySlug;
  if (ALL) return true;
  return ['deployed', 'verified'].includes(p.delivery && p.delivery.status);
});

const inspectedSlugs = new Set();
const loaded = [];
const detected = [];
for (const p of target) {
  const r = await loadPageHTML(p, { root: ROOT, base: BASE });
  if (!r.ok) continue; // unreachable pages are verify.mjs's concern, not optimize's
  inspectedSlugs.add(p.slug);
  loaded.push({ slug: p.slug, title: titleOf(r.body), desc: descOf(r.body) });
  detected.push(...detectPage(r.body, p.slug));
}
const ranSite = target.length === pages.length || ALL || !onlySlug;
if (ranSite) detected.push(...detectSite(loaded));

// --- Merge with prior findings (detect -> fix -> verify) -----------------------
const findingsPath = join(OUT, 'optimize', 'findings.json');
const scorecardPath = join(OUT, 'optimize', 'scorecard.json');
const prior = readJSON(findingsPath, { runs: [], findings: [] });
const priorById = new Map((prior.findings || []).map((x) => [x.id, x]));
const detectedById = new Map(detected.map((d) => [d.id, d]));
const now = new Date().toISOString();
const runId = `run-${(prior.runs || []).length + 1}`;

// scope test: is a prior finding inside what this run actually inspected?
const inScope = (fnd) => {
  if (fnd.scope.level === 'site') return ranSite;
  return fnd.scope.ids.every((s) => inspectedSlugs.has(s));
};

const out = [];
const seen = new Set();
for (const d of detected) {
  seen.add(d.id);
  const p = priorById.get(d.id);
  if (p && (p.status === 'accepted' || p.status === 'wontfix')) { out.push(p); continue; }
  if (p && (p.status === 'open' || p.status === 'in-progress')) {
    out.push({ ...p, severity: d.severity, fixability: d.fixability, evidence: d.evidence, recommendedMove: d.recommendedMove });
  } else if (p && p.status === 'fixed') {
    out.push({ ...d, status: 'open', firstSeenRun: p.firstSeenRun, resolvedBy: null }); // regression
  } else {
    out.push({ ...d, status: 'open', firstSeenRun: runId, resolvedBy: null });
  }
}
for (const p of prior.findings || []) {
  if (seen.has(p.id)) continue;
  // Only a run of THIS source may auto-resolve its own findings. Findings from
  // other sources (impeccable, marketing skills, stardust tensions) are preserved
  // untouched — they are resolved by re-recording from their own audit.
  if (p.source === SOURCE && (p.status === 'open' || p.status === 'in-progress') && inScope(p)) {
    out.push({ ...p, status: 'fixed', resolvedBy: { phase: PHASE_FOR[p.fixability] || 'rollout', at: now, note: 'no longer detected on delivered page' } });
  } else {
    out.push(p); // other source, out-of-scope, or already-terminal — preserve
  }
}
const sevRank = { P1: 0, P2: 1, P3: 2 };
out.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || a.id.localeCompare(b.id));

const runs = [...(prior.runs || []), { id: runId, at: now, scopePages: [...inspectedSlugs].sort(), layersRun: ASSESSED, trigger: onlySlug ? 'reverify' : 'deliver', source: ROOT ? `root:${ROOT}` : BASE }];
writeJSON(findingsPath, { _provenance: { writtenBy: 'stardust:rollout/optimize', writtenAt: now, stardustVersion: (config._provenance || {}).stardustVersion || '0.0.0' }, runs, findings: out });

// --- Scorecard (over ALL sources in the ledger, not just baseline) -------------
const open = out.filter((x) => x.status === 'open' || x.status === 'in-progress');
const snapshot = computeScorecard(out, runId, now);
const dimensions = snapshot.dimensions;
const overall = snapshot.overall;
const priorSc = readJSON(scorecardPath, { history: [] });
writeJSON(scorecardPath, { _provenance: { writtenBy: 'stardust:rollout/optimize', writtenAt: now, stardustVersion: (config._provenance || {}).stardustVersion || '0.0.0' }, current: snapshot, history: [...(priorSc.history || []), snapshot] });

// --- Report + gate -------------------------------------------------------------
const openP1 = open.filter((x) => x.severity === 'P1');
console.log(`rollout optimize (${ROOT ? `root:${ROOT}` : BASE})  run ${runId}`);
console.log('='.repeat(64));
console.log(`Inspected   ${inspectedSlugs.size} pages${ranSite ? ' + site checks' : ''}`);
console.log(`Health      ${overall}/100   (a11y ${dimensions.accessibility} · seo ${dimensions.seo} · ai ${dimensions['ai-search']} · xpage ${dimensions['cross-page']})`);
console.log(`Open        P1 ${snapshot.severity.P1} · P2 ${snapshot.severity.P2} · P3 ${snapshot.severity.P3}   ·   Fixed this history: P1 ${snapshot.fixed.P1} · P2 ${snapshot.fixed.P2} · P3 ${snapshot.fixed.P3}`);
const route = (fx) => open.filter((x) => x.fixability === fx);
for (const fx of ['platform-migration', 'design-pass', 'out-of-scope']) {
  const items = route(fx);
  if (!items.length) continue;
  const who = fx === 'platform-migration' ? 'rollout re-deploy fixes' : fx === 'design-pass' ? 'UPSTREAM (migrate/prototype)' : 'informational';
  console.log(`\n${fx} — ${who}:`);
  for (const x of items.slice(0, 12)) console.log(`  ${x.severity} ${x.layer}/${x.check} [${x.scope.ids.join(',')}] — ${x.evidence}`);
  if (items.length > 12) console.log(`  … ${items.length - 12} more`);
}
if (openP1.length) { console.log(`\n✗ GATE: ${openP1.length} open P1 finding(s) — rollout is not delivery-clean.`); process.exit(1); }
console.log('\n✓ GATE: no open P1 findings.');
