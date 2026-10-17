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
 *   --base <url>     fetch each page over HTTP where it was deployed: <base> + lib.mjs publicUrl (the
 *                    delivery.deployedUrl pathname, else <path>); rollout.json liveHost if omitted
 *   --root <dir>     offline: resolve <path> to a file under <dir> (for the migrated
 *                    tree or a local export) — checks existence + content
 *
 * Checks per page: reachable (HTTP 200 / file exists), body has no `about:error`
 * (#75 broken-image ingestion), a page renders exactly one <h1>, every internal href="/…"
 * resolves to a page in coverage, and `delivery.gate.pass` is not false (the pixel table's
 * verdict, written by `update-coverage.mjs --gate` — #125) nor any recorded width's verdict in
 * `delivery.gate.passByWidth` (a failure at any width fails the page: `gate: FAIL at <width>`).
 * Media and text-track links are assets, not pages (`.vtt`, `.srt`, `.mp3`, `.m3u8`, … like
 * `.css` or `.pdf`): never a broken internal link.
 *
 * A page that renders no <h1> while its source capture (<current>/pages/<slug>.json, extract's
 * crawl) records headings without an h1 is NOT failed: the source's trait is kept — content is
 * never edited to satisfy a verifier — and the page is verified with a stdout line
 * `note: <slug>: source has no h1 (recorded source trait)`. More than one <h1>, a missing
 * capture, or a capture with an h1 → the page fails as before.
 *
 * Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--all] [--out <rolloutDir>]
 *        [--current <dir>]
 *   --out defaults to stardust/rollout; --current (the source capture) to stardust/current
 *
 * Writes (under <out>/): coverage/pages.json (each checked page flipped to verified | failed),
 * coverage/templates.json (roll-up) and rollout.json (lastRun) when they exist. The per-page
 * result lines go to stdout; the summary line gains `· <n> note(s)` when there are notes.
 * Exit: 0 = no checked page failed, 1 = a page failed (or no pages.json), 2 = no --base/--root.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, publicUrl } from './lib.mjs';

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
const onlySlug = arg('slug', null);
const ALL = process.argv.includes('--all');
const CURRENT = arg('current', 'stardust/current');

const pagesPath = join(OUT, 'coverage', 'pages.json');
const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(pagesPath);
if (!pagesDoc) { console.error('rollout verify: run inventory.mjs first.'); process.exit(1); }
const pages = pagesDoc.pages || [];
const BASE = arg('base', (config.site && config.site.liveHost) ? `https://${config.site.liveHost}` : null);

if (!ROOT && !BASE) { console.error('rollout verify: need --base <url> or --root <dir> (or set site.liveHost).'); process.exit(2); }

const knownPaths = new Set(pages.map((p) => (p.path || '/').replace(/\/$/, '') || '/'));
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
    const res = await fetch(`${BASE}${publicUrl(p)}`);
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
    if (/\.(css|js|png|jpe?g|gif|webp|avif|svg|ico|woff2?|xml|txt|json|pdf|mp4|webm|mov|zip|vtt|srt|ttml|dfxp|sbv|mp3|m4a|aac|oga|ogg|wav|flac|m4v|ogv|m3u8|mpd)$/i.test(target)) continue; // assets, media and text tracks included
    if (!knownPaths.has(target)) broken.push(target);
  }
  return [...new Set(broken)];
}

// Artifact type drives what "renders correctly" means — a fragment has no <h1>,
// an index is JSON not a page. A one-size <h1> check false-fails fragments.
function artifactType(p) {
  const t = (p.delivery && p.delivery.type) || p.type;
  if (t) return t; // explicit wins
  const s = (p.path || '').toLowerCase();
  // anchor to top-level /nav,/footer or a /fragments/ path so a content page
  // named e.g. /about/nav is not mistyped out of the page render checks.
  if (/^\/(nav|footer)$/.test(s) || /\/fragments?\//.test(s)) return 'fragment';
  if (/query-index(\.json)?$/.test(s) || /\.json$/.test(s)) return 'index';
  return 'page';
}

// The source capture records the page's headings; one without an h1 is a source trait the page keeps.
function sourceLacksH1(slug) {
  const cap = slug ? readJSON(join(CURRENT, 'pages', `${slug}.json`)) : null;
  return !!cap && Array.isArray(cap.headings) && !cap.headings.some((h) => h && String(h.tag).toLowerCase() === 'h1');
}

// Typed render-truth: returns a failure reason or null. Pages must render one
// <h1> (none only when the source has none — a note) and carry no about:error;
// fragments skip the <h1> rule; indexes must be valid JSON with rows. Link
// integrity applies to pages and fragments.
const notes = [];
function renderCheck(type, body, slug) {
  if (type === 'index') {
    // a valid index with zero rows is a legitimate state (nothing published yet),
    // not a failure — only malformed JSON or a missing data[] array fails.
    try { const j = JSON.parse(body); if (!Array.isArray(j.data)) return 'index missing data[] array'; }
    catch { return 'index is not valid JSON'; }
    return null;
  }
  if (/about:error/.test(body)) return 'about:error in body (#75 broken image)';
  if (type === 'page') {
    const h1 = (body.match(/<h1[\s>]/gi) || []).length;
    if (h1 === 0 && sourceLacksH1(slug)) notes.push(`note: ${slug}: source has no h1 (recorded source trait)`);
    else if (h1 !== 1) return `page should render exactly one <h1>, found ${h1}`;
  }
  const broken = checkLinks(body);
  if (broken.length) return `broken internal links: ${broken.slice(0, 5).join(', ')}`;
  return null;
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
  const type = artifactType(p);
  let status = 'verified'; let reason = null;
  if (!r.ok) { status = 'failed'; reason = r.reason; }
  else { reason = renderCheck(type, r.body, p.slug); if (reason) status = 'failed'; }
  // #125: a page the pixel table failed — at the width gated last (pass) or at any recorded width (passByWidth) —
  // is not verified (update-coverage.mjs --gate wrote delivery.gate)
  const gate = p.delivery && p.delivery.gate;
  const failedWidths = gate && gate.passByWidth && typeof gate.passByWidth === 'object' && !Array.isArray(gate.passByWidth)
    ? Object.keys(gate.passByWidth).filter((w) => gate.passByWidth[w] === false) : [];
  if (status === 'verified' && gate && gate.pass === false) { status = 'failed'; reason = `gate: ${(gate.reasons || []).join('; ') || 'FAIL'}`; }
  else if (status === 'verified' && failedWidths.length) { status = 'failed'; reason = `gate: FAIL at ${failedWidths.join(', ')}`; }
  p.delivery = p.delivery || {};
  p.delivery.status = status;
  if (status === 'verified') { p.delivery.verifiedAt = now; p.delivery.error = null; }
  else p.delivery.error = reason;
  results.push({ slug: p.slug, type, status, reason });
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
const byType = results.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
console.log(`rollout verify (${ROOT ? `root:${ROOT}` : BASE})`);
console.log('='.repeat(60));
console.log(`Checked ${results.length} · ${ok} verified · ${bad.length} failed${notes.length ? ` · ${notes.length} note(s)` : ''} · types: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ')}`);
for (const r of bad) console.log(`  ✗ ${r.slug} (${r.type}): ${r.reason}`);
for (const n of notes) console.log(n);
if (!target.length) console.log('Nothing to verify (no deployed pages). Deliver pages first, or pass --all.');
process.exit(bad.length ? 1 : 0);
