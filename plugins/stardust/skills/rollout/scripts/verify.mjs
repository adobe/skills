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
 * (#75 broken-image ingestion), an <h1> count that matches its source capture (below), and
 * `delivery.gate.pass` is not false (the pixel table's verdict, written by
 * `update-coverage.mjs --gate` — #125) nor any recorded width's verdict in
 * `delivery.gate.passByWidth` (a failure at any width fails the page: `gate: FAIL at <width>`).
 * Media and text-track links are assets, not pages (`.vtt`, `.srt`, `.mp3`, `.m3u8`, … like
 * `.css` or `.pdf`): neither a link nor a trait.
 *
 * The <h1> count is judged against the source capture (<current>/pages/<slug>.json, extract's
 * crawl), because content is never edited to satisfy a verifier. One <h1> verifies. No <h1>, or
 * more than one, is a FAILURE unless the capture carries the same trait — a capture with no h1
 * (none rendered) or a capture with more than one h1 (more than one rendered): then it is a
 * recorded source trait, the page verifies, and a stdout line reads
 * `trait: <slug>: source has <n> h1 (recorded source trait)`. A missing capture, or a capture
 * whose h1 count the render does not match, fails as before.
 *
 * Out-of-plan links are E2's, not a verify failure. Phase E2 (link audit + repoints) runs BEFORE
 * Phase E (this verify); an internal `href="/…"` that still resolves to no page in coverage is
 * reported `e2_pending: <slug>: <paths>` for E2 to repoint, never a page failure — a recorded run
 * failed and re-deployed pages over links E2 was about to repoint.
 *
 * Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--all] [--out <rolloutDir>]
 *        [--current <dir>]
 *   --out defaults to stardust/rollout; --current (the source capture) to stardust/current
 *
 * Writes (under <out>/): coverage/pages.json (each checked page flipped to verified | failed),
 * coverage/templates.json (roll-up) and rollout.json (lastRun) when they exist. The per-page
 * result lines go to stdout; the summary line gains `· <t> trait(s)` and `· <p> e2_pending`
 * when there are any.
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

// The source capture records the page's headings; its h1 count (null when there is no capture) is the
// trait the render must match — content is never edited to satisfy a verifier.
function sourceH1Count(slug) {
  const cap = slug ? readJSON(join(CURRENT, 'pages', `${slug}.json`)) : null;
  if (!cap || !Array.isArray(cap.headings)) return null;
  return cap.headings.filter((h) => h && String(h.tag).toLowerCase() === 'h1').length;
}

// Typed render-truth: returns a failure reason or null, pushing source traits to `traits` and out-of-plan
// links to `pending` (neither fails the page). Pages render an <h1> count the capture shares (one, or a
// recorded 0/>1 trait); fragments skip the <h1> rule; indexes must be valid JSON with rows. An out-of-plan
// internal href is E2's repoint (Phase E2 runs before this), reported e2_pending, never a failure.
const traits = [];
const pending = [];
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
    const capH1 = sourceH1Count(slug); // null when no capture
    // one h1 verifies; no h1 or more than one is a FAIL unless the capture carries the same trait (0 or >1)
    if (h1 !== 1) {
      if ((h1 === 0 && capH1 === 0) || (h1 > 1 && capH1 !== null && capH1 > 1)) traits.push(`trait: ${slug}: source has ${capH1} h1 (recorded source trait)`);
      else return `page should render exactly one <h1>, found ${h1}`;
    }
  }
  const outOfPlan = checkLinks(body);
  if (outOfPlan.length) pending.push(`e2_pending: ${slug}: out-of-plan link(s) for E2 to repoint: ${outOfPlan.slice(0, 5).join(', ')}`);
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
const extra = [...(traits.length ? [`${traits.length} trait(s)`] : []), ...(pending.length ? [`${pending.length} e2_pending`] : [])];
console.log(`rollout verify (${ROOT ? `root:${ROOT}` : BASE})`);
console.log('='.repeat(60));
console.log(`Checked ${results.length} · ${ok} verified · ${bad.length} failed${extra.length ? ` · ${extra.join(' · ')}` : ''} · types: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ')}`);
for (const r of bad) console.log(`  ✗ ${r.slug} (${r.type}): ${r.reason}`);
for (const n of traits) console.log(n);
for (const n of pending) console.log(n);
if (!target.length) console.log('Nothing to verify (no deployed pages). Deliver pages first, or pass --all.');
process.exit(bad.length ? 1 : 0);
