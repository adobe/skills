#!/usr/bin/env node
/**
 * rollout/verify.mjs — full-site verification (Phase 2).
 *
 * For every delivered page, confirm it actually renders and that its internal
 * links resolve to known delivered paths. Flips each page to `verified` or
 * `failed` in the coverage ledger (re-deriving roll-ups), so the "what's missing"
 * report reflects reality, not just "we pushed it".
 *
 * Two modes:
 *   --base <url>     fetch <base><path> over HTTP (uses rollout.json liveHost if omitted)
 *   --root <dir>     offline: resolve <path> to a file under <dir> (for the migrated
 *                    tree or a local export) — checks existence + content
 *
 * Checks per page: reachable (HTTP 200 / file exists), body has no `about:error`
 * (#75 broken-image ingestion), and every internal href="/…" resolves to a page
 * in coverage.
 *
 * Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--all] [--out <rolloutDir>]
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const OUT = arg('out', 'stardust/rollout');
const ROOT = arg('root', null);
const onlySlug = arg('slug', null);
const ALL = process.argv.includes('--all');

const pagesPath = join(OUT, 'coverage', 'pages.json');
const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(pagesPath);
if (!pagesDoc) { console.error('rollout verify: run inventory.mjs first.'); process.exit(1); }
const pages = pagesDoc.pages || [];
const BASE = arg('base', (config.site && config.site.liveHost) ? `https://${config.site.liveHost}` : null);

if (!ROOT && !BASE) { console.error('rollout verify: need --base <url> or --root <dir> (or set site.liveHost).'); process.exit(2); }

const knownPaths = new Set(pages.map((p) => p.path.replace(/\/$/, '') || '/'));
const norm = (p) => (p.split(/[?#]/)[0].replace(/\/$/, '') || '/');

function resolveLocal(p) {
  // map a delivered extensionless path to a file under ROOT (migrated tree shape)
  const candidates = p === '/'
    ? ['index.html']
    : [`${p.slice(1)}.html`, `${p.slice(1)}/index.html`, p.slice(1)];
  for (const c of candidates) { const f = join(ROOT, c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

async function fetchPage(p) {
  if (ROOT) {
    const f = resolveLocal(p.path);
    if (!f) return { ok: false, reason: `not found under ${ROOT}` };
    return { ok: true, body: readFileSync(f, 'utf8') };
  }
  try {
    const res = await fetch(`${BASE}${p.path}`);
    const body = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, body };
  } catch (e) { return { ok: false, reason: `fetch error: ${e.message}` }; }
}

function checkLinks(body) {
  const broken = [];
  for (const m of body.matchAll(/href="(\/[^"]*)"/g)) {
    const target = norm(m[1]);
    if (target.startsWith('//')) continue; // protocol-relative external
    if (/\.(css|js|png|jpe?g|webp|svg|ico|woff2?|xml|txt|json)$/i.test(target)) continue; // assets
    if (!knownPaths.has(target)) broken.push(target);
  }
  return [...new Set(broken)];
}

const target = pages.filter((p) => {
  if (onlySlug) return p.slug === onlySlug;
  if (ALL) return true;
  return ['deployed', 'verified'].includes(p.delivery && p.delivery.status);
});

const now = new Date().toISOString();
const results = [];
for (const p of target) {
  const r = await fetchPage(p);
  let status = 'verified'; let reason = null;
  if (!r.ok) { status = 'failed'; reason = r.reason; }
  else if (r.body.includes('about:error')) { status = 'failed'; reason = 'about:error in body (#75 broken image)'; }
  else {
    const broken = checkLinks(r.body);
    if (broken.length) { status = 'failed'; reason = `broken internal links: ${broken.slice(0, 5).join(', ')}`; }
  }
  p.delivery = p.delivery || {};
  p.delivery.status = status;
  if (status === 'verified') { p.delivery.verifiedAt = now; p.delivery.error = null; }
  else p.delivery.error = reason;
  results.push({ slug: p.slug, status, reason });
}

// persist + re-roll
pagesDoc.generatedAt = now;
writeJSON(pagesPath, pagesDoc);
const tDoc = readJSON(join(OUT, 'coverage', 'templates.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
if (tDoc) { rollupTemplates(tDoc, pages); tDoc.generatedAt = now; writeJSON(join(OUT, 'coverage', 'templates.json'), tDoc); }
if (config && config.lastRun !== undefined) { rollupConfig(config, pages, blocksDoc && blocksDoc.blocks, now); writeJSON(join(OUT, 'rollout.json'), config); }

const ok = results.filter((r) => r.status === 'verified').length;
const bad = results.filter((r) => r.status === 'failed');
console.log(`rollout verify (${ROOT ? `root:${ROOT}` : BASE})`);
console.log('='.repeat(60));
console.log(`Checked ${results.length} · ${ok} verified · ${bad.length} failed`);
for (const r of bad) console.log(`  ✗ ${r.slug}: ${r.reason}`);
if (!target.length) console.log('Nothing to verify (no deployed pages). Deliver pages first, or pass --all.');
process.exit(bad.length ? 1 : 0);
