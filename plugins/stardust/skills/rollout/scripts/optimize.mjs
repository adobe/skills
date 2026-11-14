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
 * Source parity: when the page's capture exists (`<current>/pages/<slug>.json`, with its
 * rendered-DOM sidecar `pages/<slug>.html`), a finding whose condition the SOURCE shares — the
 * same <title> (title-length / title-missing), no meta description on the source either, no
 * JSON-LD on the source either, the same title or description shared by the same pages — is
 * tagged `fixability: out-of-scope` with the evidence prefix `source parity: ` (the findings
 * schema has no parity property). Such findings are informational: listed in their own report
 * section, excluded from the health score and the open P1/P2/P3 counts, never gated, never
 * auto-fixed. A recorded hands-off run accepted 63 of them by hand.
 *
 * Automated layers: accessibility, seo, ai-search, cross-page. The judgment layers
 * (brand-tensions, design-ux, content-conversion) are left null (not assessed) for
 * a future LLM-driven enrichment pass.
 *
 * Usage: node skills/rollout/scripts/optimize.mjs [--base <url> | --root <dir>]
 *          [--slug <s>] [--all] [--out <rolloutDir>] [--current <captureDir>]
 *   --base defaults to rollout.json's site.liveHost; --out to stardust/rollout;
 *   --current to stardust/current (the extract capture; parity is not assessed when absent)
 *
 * Reads <out>/coverage/pages.json (required — run inventory.mjs first) and rollout.json.
 * Writes (under <out>/optimize/): findings.json (the ledger, with this run appended) and
 * scorecard.json (current snapshot + history). The report and the GATE line go to stdout.
 * Exit 1 on an open P1 finding or a missing pages.json, 2 when neither --base nor --root resolves.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readJSON, writeJSON, loadPageHTML, computeScorecard, autofixFor, ASSESSED_BY_BASELINE,
  markSourceParity, isSourceParity, sourceParityCounts,
} from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const OUT = arg('out', 'stardust/rollout');
const ROOT = arg('root', null);
const CURRENT = arg('current', 'stardust/current');
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
const hasJsonLd = (html) => /application\/ld\+json/i.test(html);

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
  if (!hasJsonLd(html)) f.push(mk('ai-search', 'jsonld', 'P2', 'platform-migration', lvl, id, 'no JSON-LD structured data', 'Emit page-type JSON-LD in the head (metadata-and-jsonld).'));
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

// --- Source parity (the capture, when present) ---------------------------------
// The capture is extract's `pages/<slug>.json` (document.title, meta description) plus the
// rendered-DOM sidecar it names in `renderedHtml` (default `pages/<slug>.html`) for JSON-LD.
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const norm = (s) => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();

function loadCapture(slug) {
  const rec = readJSON(join(CURRENT, 'pages', `${slug}.json`));
  if (!rec) return null;
  const sidecar = rec.renderedHtml ? join(CURRENT, rec.renderedHtml) : join(CURRENT, 'pages', `${slug}.html`);
  let jsonld = null; // null = unknown (no rendered sidecar)
  if (existsSync(sidecar)) { try { jsonld = hasJsonLd(readFileSync(sidecar, 'utf8')); } catch { jsonld = null; } }
  return { title: norm(rec.title || (rec.og && rec.og.title) || ''), description: norm(rec.description || ''), jsonld };
}

/** The shared condition when `f` mirrors the source, else null. */
function parityReason(f, captures, deliveredBySlug) {
  const ids = f.scope.ids;
  if (f.scope.level === 'page' && ids.length === 1) {
    const cap = captures.get(ids[0]); const got = deliveredBySlug.get(ids[0]);
    if (!cap || !got) return null;
    if (f.check === 'title-missing') return !cap.title ? 'the source page has no <title> either' : null;
    if (f.check === 'title-length') return cap.title && norm(got.title) === cap.title ? 'the source page carries the same <title>' : null;
    if (f.check === 'meta-description') return !cap.description ? 'the source page has no meta description either' : null;
    if (f.check === 'jsonld') return cap.jsonld === false ? 'the source page has no JSON-LD either' : null;
    return null;
  }
  if (f.check === 'duplicate-title' || f.check === 'duplicate-description') {
    const key = f.check === 'duplicate-title' ? 'title' : 'description';
    const caps = ids.map((s) => captures.get(s)); const gots = ids.map((s) => deliveredBySlug.get(s));
    if (caps.some((c) => !c) || gots.some((g) => !g)) return null;
    const shared = norm(gots[0][key === 'title' ? 'title' : 'desc']);
    if (!shared) return null;
    return caps.every((c) => c[key] === shared) ? `the source shares this ${key} across the same pages` : null;
  }
  return null;
}

// --- Select pages + load HTML --------------------------------------------------
const target = pages.filter((p) => {
  if (onlySlug) return p.slug === onlySlug;
  if (ALL) return true;
  return ['deployed', 'verified'].includes(p.delivery && p.delivery.status);
});

const inspectedSlugs = new Set();
const loaded = [];
const rawDetected = [];
const captures = new Map();
for (const p of target) {
  const r = await loadPageHTML(p, { root: ROOT, base: BASE });
  if (!r.ok) continue; // unreachable pages are verify.mjs's concern, not optimize's
  inspectedSlugs.add(p.slug);
  loaded.push({ slug: p.slug, title: titleOf(r.body), desc: descOf(r.body) });
  const cap = loadCapture(p.slug);
  if (cap) captures.set(p.slug, cap);
  rawDetected.push(...detectPage(r.body, p.slug));
}
const ranSite = target.length === pages.length || ALL || !onlySlug;
if (ranSite) rawDetected.push(...detectSite(loaded));

const deliveredBySlug = new Map(loaded.map((l) => [l.slug, l]));
const detected = rawDetected.map((d) => { const why = parityReason(d, captures, deliveredBySlug); return why ? markSourceParity(d, why) : d; });

// --- Merge with prior findings (detect -> fix -> verify) -----------------------
const findingsPath = join(OUT, 'optimize', 'findings.json');
const scorecardPath = join(OUT, 'optimize', 'scorecard.json');
const prior = readJSON(findingsPath, { runs: [], findings: [] });
const priorById = new Map((prior.findings || []).map((x) => [x.id, x]));
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
    // the parity tag follows this run's detection; autofix state is re-derived only when the tag flips
    const autofix = isSourceParity(d) !== isSourceParity(p) ? d.autofix : p.autofix;
    out.push({ ...p, severity: d.severity, fixability: d.fixability, evidence: d.evidence, recommendedMove: d.recommendedMove, autofix });
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
const parity = open.filter(isSourceParity);
const scored = open.filter((x) => !isSourceParity(x));
const snapshot = computeScorecard(out, runId, now);
const parityCounts = sourceParityCounts(out);
const dimensions = snapshot.dimensions;
const overall = snapshot.overall;
const priorSc = readJSON(scorecardPath, { history: [] });
writeJSON(scorecardPath, { _provenance: { writtenBy: 'stardust:rollout/optimize', writtenAt: now, stardustVersion: (config._provenance || {}).stardustVersion || '0.0.0' }, current: snapshot, history: [...(priorSc.history || []), snapshot] });

// --- Report + gate -------------------------------------------------------------
const openP1 = scored.filter((x) => x.severity === 'P1');
const line = (x) => `  ${x.severity} ${x.layer}/${x.check} [${x.scope.ids.join(',')}] — ${x.evidence}`;
console.log(`rollout optimize (${ROOT ? `root:${ROOT}` : BASE})  run ${runId}`);
console.log('='.repeat(64));
console.log(`Inspected   ${inspectedSlugs.size} pages${ranSite ? ' + site checks' : ''}`);
console.log(`Health      ${overall}/100   (a11y ${dimensions.accessibility} · seo ${dimensions.seo} · ai ${dimensions['ai-search']} · xpage ${dimensions['cross-page']})`);
console.log(`Open        P1 ${snapshot.severity.P1} · P2 ${snapshot.severity.P2} · P3 ${snapshot.severity.P3}   ·   Fixed this history: P1 ${snapshot.fixed.P1} · P2 ${snapshot.fixed.P2} · P3 ${snapshot.fixed.P3}`);
if (captures.size) console.log(`Source parity  ${parityCounts.total} (P1 ${parityCounts.P1} · P2 ${parityCounts.P2} · P3 ${parityCounts.P3}) — mirror the source capture (${captures.size}/${inspectedSlugs.size} pages captured under ${join(CURRENT, 'pages')}); informational, not scored`);
else console.log(`Source parity  not assessed — no capture under ${join(CURRENT, 'pages')} (pass --current <dir> to point at the extract capture)`);
const route = (fx) => scored.filter((x) => x.fixability === fx);
for (const fx of ['platform-migration', 'design-pass', 'out-of-scope']) {
  const items = route(fx);
  if (!items.length) continue;
  const who = fx === 'platform-migration' ? 'rollout re-deploy fixes' : fx === 'design-pass' ? 'UPSTREAM (migrate/prototype)' : 'informational';
  console.log(`\n${fx} — ${who}:`);
  for (const x of items.slice(0, 12)) console.log(line(x));
  if (items.length > 12) console.log(`  … ${items.length - 12} more`);
}
if (parity.length) {
  console.log('\nsource parity — informational (mirrors the source capture; not scored, not gated, not auto-fixed):');
  for (const x of parity.slice(0, 12)) console.log(line(x));
  if (parity.length > 12) console.log(`  … ${parity.length - 12} more`);
}
if (openP1.length) { console.log(`\n✗ GATE: ${openP1.length} open P1 finding(s) — rollout is not delivery-clean.`); process.exit(1); }
console.log('\n✓ GATE: no open P1 findings.');
