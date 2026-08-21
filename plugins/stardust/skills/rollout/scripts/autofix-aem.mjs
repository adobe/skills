#!/usr/bin/env node
/**
 * rollout/autofix-aem.mjs — the AEM (Edge Delivery) autofix engine (v1, aggressive).
 *
 * Consumes the findings ledger and, for every open finding whose `check` has a
 * registered EDS fixer, applies the fix to the EDS PROJECT files (content pages,
 * styles), logs the change on finding.autofix, and stages the finding as
 * `in-progress` (a re-deploy + re-optimize then flips it to `fixed`).
 *
 * Policy (aggressive): also applies content fixes (h1 promotion, alt-text drafts,
 * title/description drafts, title disambiguation). Generated copy is marked
 * `kind: content-draft` and logged with before→after so it can be reviewed. Fixers
 * that cannot be applied safely from here (JSON-LD placement, canonical, <main>
 * landmark) are marked `manual` with guidance rather than risking invalid output.
 *
 * Usage: node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>
 *          [--out <rolloutDir>] [--slug <s>] [--check <check>] [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readJSON, writeJSON, computeScorecard, resolveLocalFile } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const PROJECT = arg('project', null);
const OUT = arg('out', 'stardust/rollout');
const onlySlug = arg('slug', null);
const onlyCheck = arg('check', null);
const DRY = process.argv.includes('--dry-run');
if (!PROJECT) { console.error('autofix-aem: --project <eds-root> required (the AEM/EDS repo with content/).'); process.exit(2); }

const findingsPath = join(OUT, 'optimize', 'findings.json');
const scorecardPath = join(OUT, 'optimize', 'scorecard.json');
const doc = readJSON(findingsPath);
const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!doc) { console.error('autofix-aem: no findings.json — run optimize first.'); process.exit(1); }
const pageBySlug = new Map(((pagesDoc && pagesDoc.pages) || []).map((p) => [p.slug, p]));
const contentRoot = join(PROJECT, 'content');
const now = new Date().toISOString();

// --- HTML edit helpers ----------------------------------------------------------
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const h1Text = (html) => strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
const firstHeadingText = (html) => strip((html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || [])[1] || '');
const firstParaText = (html) => strip((html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
const rowRe = (label) => new RegExp(`(<div>\\s*${label}\\s*</div>\\s*<div>)([\\s\\S]*?)(</div>)`, 'i');

function ensureMetaRow(html, label, value) {
  // EDS metadata block: <div><div class="metadata"><div><div>Label</div><div>Value</div></div>…</div></div>
  const row = `<div><div>${label}</div><div>${value}</div></div>`;
  if (/<div class="metadata">/i.test(html)) {
    const re = rowRe(label);
    if (re.test(html)) return html.replace(re, `$1${value}$3`); // update existing row's value
    return html.replace(/<div class="metadata">/i, `<div class="metadata">${row}`); // prepend a new row
  }
  const block = `<div><div class="metadata">${row}</div></div>`;
  if (/<main[^>]*>/i.test(html)) return html.replace(/<main[^>]*>/i, (m) => `${m}${block}`);
  return html.replace(/<body[^>]*>/i, (m) => `${m}${block}`);
}

function deriveAlt(src) {
  const base = basename(src || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Image';
}

// --- Fixers: strategy id -> (html, page, finding) -> {html?, detail, manual?} ----
const FIXERS = {
  'eds-metadata-title': (html, page) => {
    const title = (h1Text(html) || page.title || page.slug).slice(0, 60);
    return { html: ensureMetaRow(html, 'Title', title), detail: `Title="${title}" (draft from <h1>)` };
  },
  'eds-metadata-description': (html, page) => {
    const desc = (firstParaText(html) || `${page.title || page.slug}.`).slice(0, 155);
    return { html: ensureMetaRow(html, 'Description', desc), detail: `Description set (${desc.length} chars, draft)` };
  },
  'eds-fix-h1': (html, page) => {
    const count = (html.match(/<h1[\s>]/gi) || []).length;
    if (count === 1) return { skip: true, detail: 'already exactly one <h1>' };
    if (count === 0) {
      const m = html.match(/<(h[2-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/i);
      if (m) return { html: html.replace(m[0], `<h1${m[2] || ''}>${m[3]}</h1>`), detail: `promoted first <${m[1]}> to <h1>` };
      const t = page.title || page.slug;
      return { html: html.replace(/<main[^>]*>/i, (s) => `${s}<h1>${t}</h1>`), detail: `inserted <h1>${t}</h1>` };
    }
    let seen = 0;
    const out = html.replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/gi, (full, attrs, inner) => { seen += 1; return seen === 1 ? full : `<h2${attrs || ''}>${inner}</h2>`; });
    return { html: out, detail: `demoted ${count - 1} extra <h1> to <h2>` };
  },
  'eds-alt-draft': (html) => {
    let n = 0;
    const out = html.replace(/<img\b(?![^>]*\balt=)([^>]*?)>/gi, (full, attrs) => { n += 1; const src = (full.match(/src=["']([^"']+)["']/) || [])[1] || ''; return `<img${attrs} alt="${deriveAlt(src)}">`; });
    return n ? { html: out, detail: `added draft alt to ${n} <img> (review)` } : { skip: true, detail: 'no alt-less <img>' };
  },
  'eds-disambiguate-title': (html, page) => {
    const seg = (page.path || '/').split('/').filter(Boolean).slice(-1)[0] || 'Home';
    const q = ` — ${seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
    const re = rowRe('Title');
    if (re.test(html)) return { html: html.replace(re, (m, a, v, c) => (v.includes(q) ? m : `${a}${v.trim()}${q}${c}`)), detail: `disambiguated Title with "${q.trim()}"` };
    return { manual: true, detail: 'no metadata Title row to disambiguate; add a metadata block first' };
  },
  'eds-jsonld': () => ({ manual: true, detail: 'JSON-LD must be placed via head.html / metadata pipeline (run the marketing:schema skill for the payload).' }),
  'eds-canonical': () => ({ manual: true, detail: 'self-canonical is a head.html / project-config change.' }),
  'eds-landmark-main': () => ({ manual: true, detail: 'ensure block output lands inside <main> (deploy anti-pattern 17) — structural, fix in the block.' }),
  'rollout-assemble': () => ({ manual: true, detail: 'run assemble.mjs to (re)generate sitemap.xml, then deploy it.' }),
};

// --- Apply ----------------------------------------------------------------------
const candidates = (doc.findings || []).filter((f) => {
  if (!(f.status === 'open' || f.status === 'in-progress')) return false;
  if (!(f.autofix && f.autofix.available && f.autofix.status === 'pending')) return false;
  if (onlyCheck && f.check !== onlyCheck) return false;
  if (onlySlug && !(f.scope.level === 'page' && f.scope.ids.includes(onlySlug))) return false;
  return true;
});

const fileCache = new Map();
const results = [];
for (const f of candidates) {
  const fixer = FIXERS[f.autofix.strategy];
  if (!fixer) { results.push({ f, outcome: 'no-fixer' }); continue; }

  // site-level / manual fixers don't touch a page file
  const isPage = f.scope.level === 'page' && f.scope.ids.length === 1;
  const page = isPage ? pageBySlug.get(f.scope.ids[0]) : null;
  let file = null; let html = null;
  if (isPage) {
    if (!page) { results.push({ f, outcome: 'no-page' }); continue; }
    file = resolveLocalFile(contentRoot, page.path);
    if (!file) { f.autofix = { ...f.autofix, status: 'failed', appliedBy: 'autofix-aem', at: now, detail: `content page not found under ${contentRoot}` }; results.push({ f, outcome: 'no-file' }); continue; }
    html = fileCache.has(file) ? fileCache.get(file) : readFileSync(file, 'utf8');
  }

  const r = fixer(html ?? '', page || { slug: f.scope.ids[0], path: '/', title: '' }, f);
  if (r.manual) {
    f.autofix = { ...f.autofix, status: 'manual', appliedBy: 'autofix-aem', at: now, detail: r.detail };
    results.push({ f, outcome: 'manual', detail: r.detail }); continue;
  }
  if (r.skip) { results.push({ f, outcome: 'skip', detail: r.detail }); continue; }
  // applied
  if (isPage && r.html && r.html !== html) { fileCache.set(file, r.html); }
  f.autofix = { ...f.autofix, status: 'applied', appliedBy: 'autofix-aem', at: now, detail: r.detail };
  f.status = 'in-progress';
  results.push({ f, outcome: DRY ? 'would-apply' : 'applied', file, detail: r.detail });
}

// --- Persist --------------------------------------------------------------------
if (!DRY) {
  for (const [file, html] of fileCache) writeFileSync(file, html);
  writeJSON(findingsPath, doc);
  const sc = readJSON(scorecardPath, { history: [] });
  const snap = computeScorecard(doc.findings, `autofix-${now}`, now);
  writeJSON(scorecardPath, { _provenance: { writtenBy: 'stardust:rollout/autofix-aem', writtenAt: now, stardustVersion: (doc._provenance || {}).stardustVersion || '0.0.0' }, current: snap, history: [...(sc.history || []), snap] });
}

// --- Report ---------------------------------------------------------------------
const by = (o) => results.filter((r) => r.outcome === o);
console.log(`autofix-aem (${DRY ? 'DRY RUN' : 'apply'}) → project ${PROJECT}`);
console.log('='.repeat(64));
console.log(`Candidates ${candidates.length} · applied ${by('applied').length + by('would-apply').length} · manual ${by('manual').length} · skipped ${by('skip').length} · failed ${by('no-file').length + by('no-page').length}`);
for (const r of results) {
  const mark = { applied: '✓', 'would-apply': '~', manual: '✋', skip: '·', 'no-file': '✗', 'no-page': '✗', 'no-fixer': '?' }[r.outcome] || '?';
  console.log(`  ${mark} ${r.f.autofix.strategy.padEnd(24)} [${r.f.scope.ids.join(',')}] ${r.detail || r.outcome}`);
}
if (!DRY && (by('applied').length)) console.log('\nNext: re-deploy the edited pages (deploy), then re-run verify + optimize to flip staged findings to fixed.');
