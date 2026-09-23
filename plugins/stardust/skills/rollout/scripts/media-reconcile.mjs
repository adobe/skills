#!/usr/bin/env node
/**
 * rollout/media-reconcile.mjs — per-image reconciliation for migrations.
 *
 * Imagery is the #1 fidelity risk at scale. This systematizes the decision the
 * delivery gates make ad-hoc: for every authored image URL, classify origin,
 * RESOLVE it on the network, apply known repairs, and emit a decision:
 *   optimize  — same-origin (Content Bus) asset; safe to run createOptimizedPicture
 *   hosted    — on the site's content host (content|admin.da.live); verified against the
 *               media ledger offline, never fetched anonymously (auth-gated); missing
 *               from an existing ledger = gate fail. Only a ledger-verified URL is hosted:
 *               with no ledger at all the URL is `unresolved` (reason: no media ledger —
 *               pass --media-ledger <file>) — an unverified content-host image never passes
 *   keep      — external, resolves 200; reference as-is but skip block optimization
 *   rewrite   — repairable break (missing ?-delimiter, wrong host) → suggested URL
 *   omit      — unresolvable; drop the <img> (render gracefully), never ship about:error
 *
 * Reference: skills/migrate/reference/media-reconciliation.md and
 * skills/rollout/reference/delivery-gates.md § Gate 2.
 *
 * Usage:
 *   node skills/rollout/scripts/media-reconcile.mjs --file <html>
 *        --deploy-host <host> [--host-rewrite badhost=goodhost] [--json] [--apply]
 *        [--media-ledger <file>]
 *   --apply rewrites the file in place (rewrite → suggested URL, omit → remove <img>).
 *   --media-ledger <file>  the deploy step's media ledger (default: auto-detect
 *        stardust/deploy/media-ledger.json under the cwd; none → every content-host URL is
 *        `unresolved` with a NOTE on stderr, and the gate fails).
 *
 * Writes: --file IN PLACE, only with --apply; otherwise nothing (the per-image decisions,
 * text or --json, go to stdout). Resolves every non-hosted image URL over the network.
 * Exit 2 without --file or when the media ledger will not load; exit 1 on omit, unresolved
 * (a content-host URL with no ledger to verify it included), or a hosted URL missing from
 * the ledger.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fb) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const FILE = arg('file', null);
const DEPLOY_HOST = arg('deploy-host', null);
const JSON_OUT = process.argv.includes('--json');
const APPLY = process.argv.includes('--apply');
const rewrites = process.argv.filter((a, i) => process.argv[i - 1] === '--host-rewrite').map((s) => s.split('='));
const LEDGER_FLAG = process.argv.includes('--media-ledger');
const LEDGER_ARG = arg('media-ledger', null);
if (!FILE) { console.error('media-reconcile: need --file <html>'); process.exit(2); }
if (LEDGER_FLAG && !LEDGER_ARG) {
  console.error('media-reconcile: --media-ledger needs <file>'); process.exit(2);
}
let html = readFileSync(FILE, 'utf8');

/* collect image URLs: <img src>, srcset, inline style url(), <style> url() */
function collect(h) {
  const urls = new Set();
  for (const m of h.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/\bsrcset="([^"]+)"/gi)) m[1].split(',').forEach((part) => { const u = part.trim().split(/\s+/)[0]; if (u) urls.add(u); });
  for (const m of h.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi)) urls.add(m[2]);
  return [...urls].filter((u) => u && !u.startsWith('data:'));
}

function repairUrl(u) {
  // missing query delimiter: …/<id>&wid=… → …/<id>?wid=…
  if (!u.includes('?') && u.includes('&')) return u.replace('&', '?');
  // host rewrite (e.g. cdn.shopify.com → www.store.com)
  for (const [bad, good] of rewrites) { if (u.includes(bad)) return u.replace(bad, good); }
  return null;
}

async function resolve(u) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(u, { method: 'GET', signal: ac.signal, headers: { 'user-agent': 'stardust-media-reconcile' } });
    return r.status; // 0 is reserved for network error / timeout
  } catch (e) { return 0; } finally { clearTimeout(t); }
}

function originOf(u) { try { return new URL(u).host; } catch { return null; } }

// The site's content host is auth-gated: an anonymous GET is 401 by design, so it is never
// fetched here — such a URL is verified offline against the deploy step's media ledger instead.
const HOSTED_HOST = /^(content|admin)\.da\.live$/;
function isHostedUrl(u) {
  try { return HOSTED_HOST.test(new URL(u).hostname); } catch { return false; }
}

const stripQuery = (u) => u.replace(/[?#].*$/s, '');
const NO_LEDGER_REASON = 'no media ledger — pass --media-ledger <file>';

// Canonical form for ledger matching: query/fragment dropped, every path segment re-encoded.
// The uploader encodeURIComponent()s each segment; authored HTML may carry either form.
function canonUrl(u) {
  const bare = stripQuery(u);
  try {
    const url = new URL(bare);
    const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    const segs = url.pathname.split('/').map((s) => encodeURIComponent(decode(s)));
    return `${url.origin}${segs.join('/')}`;
  } catch { return bare; }
}

// The media ledger (deploy/scripts/da-media-upload.mjs): an object keyed by DA path, each record
// carrying the authored contentUrl. An explicit path must load; the auto-detected default may be
// absent (content-host URLs are then `unresolved`, with a NOTE). A ledger that exists but will not load
// is a defect, not a reason to pass hosted URLs → exit 2. Returns { path, urls: Set | null }.
function loadLedger(explicit) {
  const path = explicit || join(process.cwd(), 'stardust', 'deploy', 'media-ledger.json');
  if (!explicit && !existsSync(path)) return { path, urls: null };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') throw new Error('not a JSON object');
  } catch (e) {
    const why = e.code === 'ENOENT' ? 'not found' : e.message;
    console.error(`media-reconcile: media ledger ${path}: ${why}`);
    process.exit(2);
  }
  const table = raw.entries && typeof raw.entries === 'object' ? raw.entries : raw;
  const urls = new Set();
  for (const rec of Array.isArray(table) ? table : Object.values(table)) {
    if (!rec || rec.status !== 'uploaded' || typeof rec.contentUrl !== 'string') continue;
    urls.add(rec.contentUrl); urls.add(canonUrl(rec.contentUrl));
  }
  return { path, urls };
}

// 'uploaded' | 'missing' | 'no-ledger' — exact, query-stripped and re-encoded forms all count.
function ledgerVerdict(u, ledger) {
  if (!ledger.urls) return 'no-ledger';
  return [u, stripQuery(u), canonUrl(u)].some((k) => ledger.urls.has(k)) ? 'uploaded' : 'missing';
}

// boundary-anchored replace: only swap the URL where it ends at a real delimiter,
// so a URL that is a prefix of a longer one is never corrupted.
function replaceUrl(h, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return h.replace(new RegExp(`${esc}(?=["'\\s,)>])`, 'g'), to);
}

// remove an image by URL: drop the whole enclosing <picture> if present (so no
// dangling <source>), else the standalone <img>, else a <source> carrying it.
function removeImageUrl(h, url) {
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = h.replace(new RegExp(`<picture>(?:(?!</picture>)[\\s\\S])*?${esc}[\\s\\S]*?</picture>`, 'gi'), '');
  out = out.replace(new RegExp(`<img\\b[^>]*\\ssrc="${esc}"[^>]*>`, 'gi'), '');
  out = out.replace(new RegExp(`<source\\b[^>]*${esc}[^>]*>`, 'gi'), '');
  return out;
}

const ledger = loadLedger(LEDGER_ARG);
const results = [];
for (const u of collect(html)) {
  const host = originOf(u);
  const sameOrigin = DEPLOY_HOST && host && host === DEPLOY_HOST;
  let decision; let suggested = null; let status = null; let verdict = null; let reason = null;
  if (sameOrigin) {
    decision = 'optimize';
  } else if (isHostedUrl(u)) {
    verdict = ledgerVerdict(u, ledger); // offline — never an anonymous GET
    // `hosted` only when a ledger vouches for the URL (or exists and can be checked); with no
    // ledger nothing has verified the image, and an unverified content-host image never passes.
    if (verdict === 'no-ledger') { decision = 'unresolved'; reason = NO_LEDGER_REASON; }
    else decision = 'hosted';
  } else {
    status = await resolve(u);
    if (status === 200) {
      decision = 'keep';
    } else {
      const fixed = repairUrl(u);
      if (fixed) {
        const fstatus = await resolve(fixed);
        if (fstatus === 200) { decision = 'rewrite'; suggested = fixed; status = fstatus; }
      }
      // only a definitive 4xx (gone/forbidden/not-found) is safe to auto-omit;
      // a 0 (network/timeout) or 5xx is transient — flag 'unresolved' for a human,
      // never delete a possibly-good image on a blip.
      if (!decision) decision = (status >= 400 && status < 500) ? 'omit' : 'unresolved';
    }
  }
  results.push({ url: u, host, status, decision, suggested, ledger: verdict, ...(reason ? { reason } : {}) });
}

/* optionally apply rewrites/omits */
if (APPLY) {
  for (const r of results) {
    // 'unresolved' is left untouched on purpose — never auto-delete on a transient;
    // 'hosted' is never touched either, whatever the ledger says (the deploy step owns it).
    if (r.decision === 'rewrite' && r.suggested) html = replaceUrl(html, r.url, r.suggested);
    else if (r.decision === 'omit') html = removeImageUrl(html, r.url);
  }
  html = html.replace(/<picture>\s*<\/picture>/gi, ''); // sweep any now-empty <picture>
  writeFileSync(FILE, html);
}

const counts = results.reduce((a, r) => { a[r.decision] = (a[r.decision] || 0) + 1; return a; }, {});
const notInLedger = (r) => r.decision === 'hosted' && r.ledger === 'missing';
// gate fails on omit (broken), unresolved (needs a human) AND a hosted URL the ledger never
// uploaded (would 404 on the live site) — none is shippable as-is.
const failing = results
  .filter((r) => ['omit', 'unresolved'].includes(r.decision) || notInLedger(r));
const mediaLedger = ledger.urls ? ledger.path : null;
const noLedger = results.filter((r) => r.ledger === 'no-ledger').length;
if (noLedger) {
  console.error(`media-reconcile: no media ledger at ${ledger.path}`
    + ` — ${noLedger} content-host URL(s) unverified → unresolved (pass --media-ledger <file>)`);
}
if (JSON_OUT) {
  const report = {
    file: FILE, deployHost: DEPLOY_HOST, mediaLedger, applied: APPLY, counts, results,
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`media-reconcile ${FILE}${APPLY ? ' (APPLIED)' : ''}`);
  console.log('='.repeat(60));
  const TAGS = {
    optimize: '✓ optimize', hosted: '✓ hosted  ', keep: '✓ keep    ', rewrite: '→ rewrite ',
    omit: '✗ omit    ', unresolved: '? manual  ',
  };
  for (const r of results) {
    const tag = notInLedger(r) ? '✗ hosted  ' : TAGS[r.decision];
    const note = notInLedger(r) ? ' (not in ledger)' : r.reason ? ` (${r.reason})` : '';
    console.log(`  ${tag} ${r.status ? `[${r.status}] ` : ''}${r.url.slice(0, 70)}${note}${r.suggested ? `\n              → ${r.suggested.slice(0, 70)}` : ''}`);
  }
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
}
process.exit(failing.length ? 1 : 0);
