#!/usr/bin/env node
/**
 * rollout/redirects.mjs — the redirects sheet (Phase D) + the post-publish path probe.
 *
 * Reads stardust/redirects.tsv (`source<TAB>destination`, written by Gate 3 and
 * by hand for inbound legacy URLs) plus coverage/pages.json and emits the EDS
 * redirects sheet as JSON rows {Source, Destination}, one row per FORM of each
 * source: the extensionless path, its trailing-slash form, and — when the
 * source carried `.html` (or --html-variants is set) — the `.html` form. Folder
 * roots are served on one slash form only and the platform adds the slash
 * before redirects apply, so a sheet without the variants leaves inbound links
 * 404ing on the form that was not listed.
 *
 * Refuses (exit 2) any Source whose exact request form equals a delivered path
 * case-insensitively (`/It-IT` vs the page `/it-it`): such a row can only shadow
 * the page. Slash and `.html` variants of a delivered path are NOT shadows —
 * they are the rows this script exists to emit.
 *
 * --post-publish HEADs every delivered page in its canonical form and every
 * folder root (a page delivered from <dir>/index.html) in BOTH slash forms,
 * following redirects, and prints the failing form. Exit 2 on any failure.
 *
 * Usage:
 *   node skills/rollout/scripts/redirects.mjs [--tsv stardust/redirects.tsv] [--out stardust/rollout]
 *        [--html-variants] [--check] [--post-publish [--base <url>]]
 * Exit: 0 ok · 1 usage/missing input · 2 shadowing Source or post-publish failure
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, siteBase } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; }
const has = (f) => process.argv.includes(`--${f}`);
if (has('help')) {
  console.log('Usage: node skills/rollout/scripts/redirects.mjs [--tsv <file>] [--out <rolloutDir>] [--html-variants] [--check] [--post-publish [--base <url>]]\n  exit 0 ok · 1 usage/missing input · 2 shadowing Source / post-publish failure');
  process.exit(0);
}
const OUT = arg('out', 'stardust/rollout');
const TSV = arg('tsv', 'stardust/redirects.tsv');
const HTML_VARIANTS = has('html-variants');
const CHECK = has('check');
const POST = has('post-publish');

const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!pagesDoc) { console.error('rollout redirects: run inventory.mjs first (coverage/pages.json missing).'); process.exit(1); }
const pages = (pagesDoc.pages || []).filter((p) => p.path && !['content-pending'].includes(p.delivery && p.delivery.status));
const config = readJSON(join(OUT, 'rollout.json'), {});

// canonical form: lowercase, no trailing slash, no .html — the form delivered pages are keyed by
const canon = (p) => { let s = String(p).trim().split(/[?#]/)[0].toLowerCase(); s = s.replace(/\.html?$/, '').replace(/\/+$/, ''); return s || '/'; };
// exact request form: lowercase only (slash and extension kept) — what the platform matches a Source against
const exact = (p) => { const s = String(p).trim().split(/[?#]/)[0].toLowerCase().replace(/\/{2,}/g, '/'); return s || '/'; };
const isFolderRoot = (p) => p.path !== '/' && /\/index\.html$/.test((p.source && p.source.migratedHtml) || '');
const delivered = new Map(pages.map((p) => [exact(p.path), p]));

// --- Sheet emission -----------------------------------------------------------
let rows = [];
let shadow = [];
if (POST && !existsSync(TSV)) {
  // post-publish alone is a valid run on a site with no redirects
} else {
  if (!existsSync(TSV)) { console.error(`rollout redirects: ${TSV} not found — Gate 3 writes it; nothing to emit.`); process.exit(1); }
  const lines = readFileSync(TSV, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const seen = new Set();
  for (const line of lines) {
    const [src, dst] = line.split('\t').map((s) => (s || '').trim());
    if (!src || !dst) { console.error(`rollout redirects: malformed row (need source<TAB>destination): ${line}`); process.exit(1); }
    const base = canon(src);
    const destination = canon(dst);
    if (delivered.has(exact(src))) { shadow.push({ Source: src, page: delivered.get(exact(src)).path }); continue; }
    const forms = new Set([base]);
    if (base !== '/') forms.add(`${base}/`);
    if (HTML_VARIANTS || /\.html?$/i.test(src.split(/[?#]/)[0])) forms.add(`${base}.html`);
    const raw = src.split(/[?#]/)[0].replace(/\/+$/, '') || '/'; // original case, a request form too
    if (raw !== base) forms.add(raw);
    for (const f of forms) {
      // a form that IS a delivered page is not a redirect source (a /dir/ row keeps /dir intact)
      if (f === destination || seen.has(f) || delivered.has(exact(f))) continue;
      seen.add(f);
      rows.push({ Source: f, Destination: destination });
    }
  }
  if (shadow.length) {
    console.error(`rollout redirects: ${shadow.length} Source row(s) equal a delivered path (case-insensitive) — a redirect here can only shadow the page. Drop the row or rename the page:`);
    for (const s of shadow) console.error(`  ✗ ${s.Source}  shadows  ${s.page}`);
    process.exit(2);
  }
  const sheet = { total: rows.length, offset: 0, limit: rows.length, data: rows, ':type': 'sheet' };
  const sheetPath = join(OUT, 'site', 'redirects.json');
  if (!CHECK) writeJSON(sheetPath, sheet);
  const distinct = new Set(rows.map((r) => r.Destination)).size;
  console.log(`rollout redirects${CHECK ? ' (check)' : ` → ${sheetPath}`}: ${rows.length} rows (${lines.length} sources, ${distinct} destinations)`);
  const missing = rows.filter((r) => r.Destination !== '/' && !delivered.has(canon(r.Destination)));
  if (missing.length) console.log(`  ⚠ ${new Set(missing.map((m) => m.Destination)).size} destination(s) are not delivered pages (external or not yet shipped): ${[...new Set(missing.map((m) => m.Destination))].slice(0, 5).join(', ')}`);
}

// --- Post-publish probe ---------------------------------------------------------
if (POST) {
  const BASE = siteBase(config, arg('base', null));
  if (!BASE) { console.error('rollout redirects --post-publish: need --base <url> or rollout.json site.liveHost.'); process.exit(1); }
  const head = async (url) => {
    try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow' }); return r.status; } catch { return 0; }
  };
  const probes = [];
  for (const p of pages) {
    const c = canon(p.path);
    probes.push({ page: p.slug, form: c, kind: 'canonical' });
    if (isFolderRoot(p)) probes.push({ page: p.slug, form: `${c}/`, kind: 'folder-root slash form' });
  }
  const failures = [];
  const CONC = 6;
  for (let i = 0; i < probes.length; i += CONC) {
    await Promise.all(probes.slice(i, i + CONC).map(async (pr) => {
      const status = await head(`${BASE}${pr.form}`);
      if (status !== 200) failures.push({ ...pr, status });
    }));
  }
  console.log(`rollout redirects --post-publish (${BASE}): ${probes.length} forms probed · ${probes.length - failures.length} ok · ${failures.length} failing`);
  for (const f of failures) {
    const fix = f.kind === 'canonical' ? 'page not delivered on its canonical form — deliver/publish it' : `add the redirect row ${f.form} → ${f.form.replace(/\/$/, '')}; internal links keep the canonical form (no slash)`;
    console.log(`  ✗ ${f.page}: ${f.form} → HTTP ${f.status} (${f.kind}) — ${fix}`);
  }
  if (failures.length) process.exit(2);
}
