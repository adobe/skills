#!/usr/bin/env node
/**
 * rollout/verify.mjs — full-site verification (Phase E).
 *
 * For every delivered row, confirm it actually renders and that its internal
 * links resolve. Flips each row to `verified` or `failed` in the coverage
 * ledger (re-deriving roll-ups), so the "what's missing" report reflects
 * reality, not just "we pushed it".
 *
 * Two modes:
 *   --base <url>     fetch <base><path> over HTTP (default: rollout.json site.liveHost,
 *                    normalised with or without a scheme — lib.mjs siteBase)
 *   --root <dir>     offline: resolve <path> to a file under <dir> (the migrated
 *                    tree or a local export) — checks existence + content
 *
 * Which rows (coverage-model.md § Verify):
 *   default            deployed | verified rows
 *   --all              every DELIVERED row (deployed | verified | failed | stale). Rows
 *                      that were never delivered (pending | content-pending |
 *                      converting) have nothing to GET: they are counted on one
 *                      summary line (`not delivered: N (skipped)`) and never written —
 *                      a skipped row is "no verdict", not a FAIL. Offline `--root`
 *                      verifies the tree itself, so `--all` covers every row there.
 *   --include-undelivered   with --all over HTTP: probe the undelivered rows too (the line
 *                      then reads `not delivered: N (probed — --include-undelivered)`)
 *   --slug <s>         that one row, whatever its status
 * The path fetched is `delivery.deployedPath` when set (update-coverage
 * --from-ledger / inventory --redirects), else `path`.
 *
 * Checks per row, by artifact type (`delivery.type` page|fragment|index, inferred
 * from the path when unset): reachable (HTTP 200 / file exists), body has no
 * `about:error` (#75 broken-image ingestion), a page renders exactly one <h1>,
 * an index is JSON with data[]. A folder root (a page delivered from
 * <dir>/index.html) is fetched in BOTH slash forms over HTTP: a 404 on either
 * form is a redirect row, not a pass.
 *
 * Internal links (`href="/…"`) fall in three classes:
 *   ok               target is a coverage row that is delivered
 *   pending-target   target is a coverage row not yet delivered — advisory: the page
 *                    stays `verified`, `delivery.pendingLinks` records the targets
 *   outside-inventory  target is no coverage row at all — governed by rollout.json
 *                    `links.outsideInventory: "fail" | "warn"` (default `fail` =
 *                    the page is `failed`; `warn` records `delivery.outsideLinks`
 *                    and the page stays `verified`)
 * Offline (--root) every coverage row counts as delivered for link purposes.
 *
 * Output (context-hygiene.md § Runner reports): stdout carries the counts and
 * the ranked class table — at most 60 lines, nothing per page unless --verbose.
 * `--report <dir>` (default <out>/verify/; under --slug <out>/verify/slug-<s>/, so a
 * spot re-check never overwrites the site-wide report) receives summary.json
 * ({ total, checked, verified, failed, skipped, classes:[{ class, count, severity,
 * worstExample, pointer }], pages:[…] }), summary.md (the same table) and pages.md
 * (the per-page rows, per class — where the pointers lead).
 *
 * Runs from the plugin tree or the project copy (stardust/scripts/rollout/): the
 * class-report helper is loaded from skills/stardust/scripts/ or, beside a project
 * copy, stardust/scripts/stardust/class-report.mjs — copy it along with this file.
 *
 * Throttling is not a verdict: a 429/503 is retried inline (Retry-After, capped at
 * 60 s, else 2 s then 4 s — 3 attempts); a page still throttled is reported as
 * `unverified` — its ledger status is NOT written — and the run exits 2: re-run,
 * never a failed page.
 *
 * Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>]
 *          [--all [--include-undelivered]] [--out <rolloutDir>] [--report <dir>] [--verbose]
 * Exit: 0 no row failed · 1 at least one row is `failed` (advisory classes never set
 *       it) · 2 usage (no base/root, coverage missing — run inventory.mjs first — or
 *       class-report.mjs not found next to this script) or a page left `unverified`
 *       by 429/503 throttling after the inline retry (re-run)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, siteBase, deliveredPathOf, isDelivered, artifactType, loadPageHTML } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; }
const has = (f) => process.argv.includes(`--${f}`);
if (has('help')) {
  console.log('Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--all [--include-undelivered]] [--out <rolloutDir>] [--report <dir>] [--verbose]\n  exit 0 no failed row · 1 at least one failed row · 2 usage (no base/root, no coverage, helper missing) or a page left unverified by 429/503 throttling (re-run)');
  process.exit(0);
}
// class-report.mjs lives in skills/stardust/scripts/ (plugin tree) or stardust/scripts/stardust/ (project copy)
const { classReport, renderTable } = await (async () => {
  for (const c of ['../../stardust/scripts/class-report.mjs', '../stardust/class-report.mjs']) {
    try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  console.error('rollout verify: class-report.mjs not found next to this script — copy skills/stardust/scripts/class-report.mjs to stardust/scripts/stardust/.');
  process.exit(2);
})();
const OUT = arg('out', 'stardust/rollout');
const ROOT = arg('root', null);
const onlySlug = arg('slug', null);
const ALL = has('all');
const INCLUDE_UNDELIVERED = has('include-undelivered');
const VERBOSE = has('verbose');
const REPORT = arg('report', onlySlug ? join(OUT, 'verify', `slug-${onlySlug}`) : join(OUT, 'verify'));
const MAX_LINES = 60;

const pagesPath = join(OUT, 'coverage', 'pages.json');
const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(pagesPath);
if (!pagesDoc) { console.error('rollout verify: run inventory.mjs first.'); process.exit(2); }
const pages = pagesDoc.pages || [];
const BASE = siteBase(config, arg('base', null));
if (!ROOT && !BASE) { console.error('rollout verify: need --base <url> or --root <dir> (or set site.liveHost).'); process.exit(2); }
const OUTSIDE_POLICY = (config.links && config.links.outsideInventory) === 'warn' ? 'warn' : 'fail';

// --- known targets: every coverage row by BOTH its path and its deployedPath ------
const norm = (p) => (String(p).split(/[?#]/)[0].replace(/\/$/, '') || '/');
const rowByPath = new Map();
for (const p of pages) { for (const k of new Set([p.path, deliveredPathOf(p)])) if (k) rowByPath.set(norm(k), p); }
// offline, the tree is the artefact: a coverage row IS reachable
const targetDelivered = (row) => (ROOT ? true : isDelivered(row));

// A page delivered from <dir>/index.html — served on one slash form only, so both are probed.
const isFolderRoot = (p) => p.path && p.path !== '/' && /\/index\.html$/.test((p.source && p.source.migratedHtml) || '');
async function headStatus(url) {
  try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow' }); return r.status; } catch { return 0; }
}

// 429/503 = the host is throttling, not failing: retry inline (Retry-After capped at 60 s,
// else 2 s / 4 s), then hand back `throttled` — a no-verdict the loop keeps out of the ledger.
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function fetchPage(p) {
  if (ROOT) return loadPageHTML(p, { root: ROOT, base: BASE });
  const url = `${BASE}${deliveredPathOf(p)}`;
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try { res = await fetch(url); } catch (e) { return { ok: false, reason: `fetch error: ${e.message}` }; }
    if (res.status !== 429 && res.status !== 503) return res.ok ? { ok: true, body: await res.text() } : { ok: false, reason: `HTTP ${res.status}` };
    if (attempt === 3) return { ok: false, throttled: true, reason: `HTTP ${res.status} after 3 attempts — throttled, no verdict (re-run verify)` };
    const ra = Number(res.headers.get('retry-after'));
    await sleep((Number.isFinite(ra) && res.headers.has('retry-after') ? Math.min(ra, 60) : attempt * 2) * 1000);
  }
}

const ASSET_RE = /\.(css|js|png|jpe?g|gif|webp|avif|svg|ico|woff2?|xml|txt|json|pdf|mp4|webm|mov|zip)$/i;
function checkLinks(body) {
  const outside = new Set(); const pending = new Set();
  for (const m of body.matchAll(/href="(\/[^"]*)"/g)) {
    const target = norm(m[1]);
    if (target.startsWith('//')) continue; // protocol-relative external
    if (ASSET_RE.test(target)) continue; // assets
    const row = rowByPath.get(target);
    if (!row) outside.add(target);
    else if (!targetDelivered(row)) pending.add(target);
  }
  return { outside: [...outside], pending: [...pending] };
}

// Typed render-truth: returns { reason, pending, outside }. Pages must render one
// <h1> and carry no about:error; fragments skip the <h1> rule; indexes must be
// valid JSON with data[]. Link integrity applies to pages and fragments.
function renderCheck(type, body) {
  const r = { reason: null, pending: [], outside: [] };
  if (type === 'index') {
    // a valid index with zero rows is a legitimate state (nothing published yet)
    try { const j = JSON.parse(body); if (!Array.isArray(j.data)) r.reason = 'index missing data[] array'; }
    catch { r.reason = 'index is not valid JSON'; }
    return r;
  }
  if (/about:error/.test(body)) { r.reason = 'about:error in body (#75 broken image)'; return r; }
  if (type === 'page') {
    const h1 = (body.match(/<h1[\s>]/gi) || []).length;
    if (h1 !== 1) { r.reason = `page should render exactly one <h1>, found ${h1}`; return r; }
  }
  const links = checkLinks(body);
  r.pending = links.pending; r.outside = links.outside;
  if (links.outside.length && OUTSIDE_POLICY === 'fail') r.reason = `broken internal links: ${links.outside.slice(0, 5).join(', ')}`;
  return r;
}

// failure class = the reason's stable prefix, so the class table groups rows by
// defect kind while the per-page detail stays in the message.
function failureClass(reason) {
  if (!reason) return null;
  if (/^HTTP \d+/.test(reason)) return reason.match(/^HTTP \d+/)[0];
  if (/^not found under/.test(reason)) return 'not found under --root';
  if (/^fetch error/.test(reason)) return 'fetch error';
  if (/^folder root/.test(reason)) return 'folder root slash form';
  if (/^broken internal links/.test(reason)) return 'outside-inventory link';
  if (/about:error/.test(reason)) return 'about:error';
  if (/<h1>/.test(reason)) return 'h1 count';
  if (/^index /.test(reason)) return 'index shape';
  return reason;
}

// --- select rows ------------------------------------------------------------------
let undelivered = 0; // never-delivered rows met under --all over HTTP: skipped, or probed with --include-undelivered
const target = pages.filter((p) => {
  if (onlySlug) return p.slug === onlySlug;
  if (ALL) {
    if (ROOT || isDelivered(p)) return true;
    undelivered += 1; return INCLUDE_UNDELIVERED;
  }
  return ['deployed', 'verified'].includes(p.delivery && p.delivery.status);
});
const skipped = INCLUDE_UNDELIVERED ? 0 : undelivered;

const now = new Date().toISOString();
const results = []; // one row per checked page: { slug, path, type, status, reason, class, severity }
const advisories = []; // pending-target / outside-inventory(warn) rows — never flip the exit
const unverified = []; // throttled rows (429/503 through the retry) — ledger untouched, exit 2
for (const p of target) {
  const r = await fetchPage(p);
  const type = artifactType(p);
  const served = deliveredPathOf(p);
  if (r.throttled) { unverified.push({ slug: p.slug, path: served, type, status: 'unverified', reason: r.reason, class: 'throttled (429/503)', severity: 'warn' }); continue; }
  let status = 'verified'; let reason = null; let pending = []; let outside = [];
  if (!r.ok) { status = 'failed'; reason = r.reason; }
  else { const c = renderCheck(type, r.body); reason = c.reason; pending = c.pending; outside = c.outside; if (reason) status = 'failed'; }
  if (status === 'verified' && !ROOT && isFolderRoot(p)) {
    const slashForm = `${served.replace(/\/$/, '')}/`;
    const st = await headStatus(`${BASE}${slashForm}`);
    if (st !== 200) { status = 'failed'; reason = `folder root ${slashForm} → HTTP ${st}: add the redirect row ${slashForm} → ${served} (redirects.mjs emits both slash forms); internal links keep the canonical form ${served} (no slash)`; }
  }
  p.delivery = p.delivery || {};
  p.delivery.status = status;
  if (status === 'verified') { p.delivery.verifiedAt = now; p.delivery.error = null; }
  else p.delivery.error = reason;
  p.delivery.pendingLinks = pending.length ? pending : undefined;
  p.delivery.outsideLinks = outside.length && status === 'verified' ? outside : undefined;
  results.push({ slug: p.slug, path: served, type, status, reason, class: failureClass(reason), severity: status === 'failed' ? 'error' : undefined });
  if (pending.length) advisories.push({ slug: p.slug, path: served, type, status, class: 'pending-target link', reason: `links to undelivered coverage rows: ${pending.slice(0, 5).join(', ')}`, severity: 'info' });
  if (outside.length && status === 'verified') advisories.push({ slug: p.slug, path: served, type, status, class: 'outside-inventory link (warn)', reason: `links outside coverage: ${outside.slice(0, 5).join(', ')}`, severity: 'warn' });
}

// --- persist + re-roll ------------------------------------------------------------
pagesDoc.generatedAt = now;
writeJSON(pagesPath, pagesDoc);
const tDoc = readJSON(join(OUT, 'coverage', 'templates.json'));
const blocksDoc = readJSON(join(OUT, 'coverage', 'blocks.json'));
if (tDoc) { rollupTemplates(tDoc, pages); tDoc.generatedAt = now; writeJSON(join(OUT, 'coverage', 'templates.json'), tDoc); }
if (config && config.lastRun !== undefined) { rollupConfig(config, pages, blocksDoc && blocksDoc.blocks, now); writeJSON(join(OUT, 'rollout.json'), config); }

// --- class roll-up + report files ---------------------------------------------------
const ok = results.filter((r) => r.status === 'verified').length;
const bad = results.filter((r) => r.status === 'failed');
const byType = results.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
const pendingPages = advisories.filter((a) => a.severity === 'info').length;
const outsideWarnPages = advisories.filter((a) => a.severity === 'warn').length;
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pagesMd = join(REPORT, 'pages.md');
const report = classReport([...bad, ...unverified, ...advisories], { classKey: ['class'], pageKey: ['slug'], messageKey: ['reason'], pointerKey: ['pointer'], source: 'rollout verify' });
for (const c of report.classes) { const ptr = `${pagesMd}#${anchor(c.class)}`; for (const pg of c.pages) pg.pointer = ptr; if (c.worst) c.worst.pointer = ptr; }

const head = [
  `rollout verify (${ROOT ? `root:${ROOT}` : BASE})`,
  '='.repeat(60),
  `Checked ${results.length} · ${ok} verified · ${bad.length} failed · types: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`,
];
if (unverified.length) head.push(`unverified: ${unverified.length} page(s) throttled (429/503 through the inline retry) — ledger untouched, exit 2: re-run verify`);
if (ALL && !ROOT) head.push(`not delivered: ${undelivered} (${INCLUDE_UNDELIVERED ? 'probed — --include-undelivered' : 'skipped'})`);
if (pendingPages) head.push(`pending-target links: ${pendingPages} page(s) (advisory — the targets are coverage rows not yet delivered)`);
if (outsideWarnPages) head.push(`outside-inventory links: ${outsideWarnPages} page(s) (links.outsideInventory: warn)`);
const tail = [`summary: ${join(REPORT, 'summary.md')} · per-page rows: ${pagesMd}`];
if (!target.length) tail.push(ALL && skipped ? 'Nothing delivered yet — every row is pending/content-pending/converting.' : 'Nothing to verify (no deployed pages). Deliver pages first, or pass --all.');
const table = report.total ? renderTable(report, { title: 'rollout verify — findings by class', maxLines: MAX_LINES - head.length - tail.length }) : [];
const lines = [...head, ...table, ...tail];

mkdirSync(REPORT, { recursive: true });
writeJSON(join(REPORT, 'summary.json'), {
  generatedAt: now, source: ROOT ? `root:${ROOT}` : BASE, mode: ROOT ? 'root' : 'http', outsideInventory: OUTSIDE_POLICY,
  total: pages.length, checked: results.length, verified: ok, failed: bad.length, skipped, undelivered, unverified: unverified.length,
  pendingTargetPages: pendingPages, outsideWarnPages,
  classes: report.classes.map((c) => ({ class: c.class, count: c.count, severity: c.severity ?? null, worstExample: c.worst ? `${c.worst.page} — ${c.worst.message}` : null, pointer: c.worst ? c.worst.pointer : null })),
  pages: [...results, ...unverified, ...advisories].map(({ slug, path, type, status, class: cls, reason, severity }) => ({ slug, path, type, status, class: cls, reason, severity: severity ?? null })),
});
writeFileSync(join(REPORT, 'summary.md'), `${['# rollout verify', '', `Generated ${now}.`, '', ...lines.slice(0, MAX_LINES - 4)].join('\n')}\n`);
const md = ['# rollout verify — per-page rows', '', `Generated ${now}. Ranked table: summary.md · data: summary.json`, ''];
for (const c of report.classes) {
  md.push(`## ${c.class} (${c.count})`, '');
  for (const pg of c.pages) md.push(`- ${pg.page}${pg.severity ? ` [${pg.severity}]` : ''} — ${pg.message}`);
  md.push('');
}
writeFileSync(pagesMd, md.join('\n'));

console.log(lines.join('\n'));
if (VERBOSE) for (const r of [...bad, ...unverified, ...advisories]) console.log(`  ${r.status === 'failed' ? '✗' : '·'} ${r.slug} (${r.type}): ${r.reason}`);
process.exit(unverified.length ? 2 : bad.length ? 1 : 0);
