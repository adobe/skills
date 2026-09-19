#!/usr/bin/env node
/**
 * rollout/update-coverage.mjs — deterministic state-writer for the delivery loop.
 *
 * The per-page delivery itself is the LLM-driven `deploy` methodology; this helper
 * just records the outcome so the loop stays honest and resumable. Call it after
 * each page's deploy step, after each block converts — or ONCE per batch with the
 * driver's ledger, which replaces the per-page calls.
 *
 * Page:   node update-coverage.mjs <slug>  --status <s> [--url <deployedUrl>] [--error <msg>]
 * Block:  node update-coverage.mjs --block <id> --status <s> [--eds-name <name>]
 * Batch:  node update-coverage.mjs --from-ledger content/.deploy-ledger.json [--url-base <https://branch--repo--org.aem.page>]
 *   page  <status>: pending | converting | deployed | verified | content-pending | stale | failed
 *   block <status>: pending | converted | deployed | verified | failed
 *
 * --from-ledger reconciles deploy-batch.mjs's ledger (one row per web path) into
 * coverage/pages.json, keyed by the row's served path (`delivery.deployedPath` else
 * `path`; a normalised match — case, trailing slash, `.html|.jsp|.aspx|.php` — also
 * counts and, on a `live | previewed` row only, writes `deployedPath` when the served
 * path differs from `path` — a pending or failed row served nothing there):
 *   live | previewed  → `deployed` only when coverage is pending | converting | failed | stale;
 *                       `verified` is never downgraded (inventory.mjs owns `stale`);
 *                       `deployed`/`content-pending` rows are kept
 *   *-fail | body-invalid | overwrite-guard → `failed` with the row's lastError as `error`
 *                       (a `verified` row keeps its verdict when it is newer than the ledger row)
 *   pending           → kept (a halt reset; the next driver run decides)
 *   unmatched ledger paths are counted and listed, never invented as rows
 * Idempotent: a second run over the same ledger changes nothing but generatedAt.
 *
 * Re-derives templates.json + rollout.json roll-ups after every write.
 * Exit: 0 written · 1 coverage or ledger file missing/invalid · 2 usage.
 */
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, deliveredPathOf } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const now = new Date().toISOString();

// ---- batch reconcile from the driver's ledger ----
const LEDGER_OK = new Set(['live', 'previewed']);
const PROMOTABLE = new Set(['pending', 'converting', 'failed', 'stale']);
/** Served-path key: lower-case, no trailing slash, no `.html|.htm|.jsp|.aspx|.php`, `/index` → `/`. */
export function pathKey(p) {
  let s = String(p || '').trim().toLowerCase().replace(/[?#].*$/, '');
  s = `/${s.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
  s = s.replace(/\.(html?|jsp|aspx?|php)$/, '').replace(/\/index$/, '') || '/';
  return s;
}

/**
 * Pure merge — returns { changes: [{ slug, from, to, deployedPath }], counts, unmatched }.
 * Mutates the matched rows' `delivery`.
 */
export function mergeLedgerIntoCoverage(pages, ledger, { urlBase = null, at = now } = {}) {
  const byExact = new Map();
  const byKey = new Map();
  for (const p of pages) {
    byExact.set(deliveredPathOf(p), p);
    if (p.path) byExact.set(p.path, p);
    if (!byKey.has(pathKey(deliveredPathOf(p)))) byKey.set(pathKey(deliveredPathOf(p)), p);
    if (p.path && !byKey.has(pathKey(p.path))) byKey.set(pathKey(p.path), p);
  }
  const counts = { rows: 0, deployed: 0, failed: 0, kept: 0, unmatched: 0, deployedPath: 0 };
  const changes = [];
  const unmatched = [];
  for (const [webPath, rec] of Object.entries(ledger)) {
    counts.rows += 1;
    const page = byExact.get(webPath) || byKey.get(pathKey(webPath));
    if (!page) { counts.unmatched += 1; unmatched.push(webPath); continue; }
    page.delivery = page.delivery || { status: 'pending' };
    const d = page.delivery;
    const before = d.status || 'pending';
    const url = urlBase ? `${String(urlBase).replace(/\/+$/, '')}${webPath}` : null;
    if (LEDGER_OK.has(rec.status)) {
      // deployedPath = a path that was SERVED (coverage-model.md § Ledger reconcile); a pending / failed row served nothing
      if (page.path !== webPath && !d.deployedPath) { d.deployedPath = webPath; counts.deployedPath += 1; }
      if (PROMOTABLE.has(before)) {
        d.status = 'deployed';
        d.deployedAt = rec.ts || at;
        d.error = null;
        if (url) d.deployedUrl = url;
        counts.deployed += 1;
        changes.push({ slug: page.slug, from: before, to: 'deployed', deployedPath: d.deployedPath || null });
      } else {
        if (url && !d.deployedUrl) d.deployedUrl = url;
        counts.kept += 1;
      }
    } else if (rec.status && rec.status !== 'pending') {
      const newerVerdict = before === 'verified' && d.verifiedAt && rec.ts && rec.ts <= d.verifiedAt;
      if (newerVerdict) { counts.kept += 1; continue; }
      d.status = 'failed';
      d.error = rec.lastError || rec.status;
      counts.failed += 1;
      if (before !== 'failed' || d.error !== (rec.lastError || rec.status)) changes.push({ slug: page.slug, from: before, to: 'failed', deployedPath: d.deployedPath || null });
    } else counts.kept += 1;
  }
  return { changes, counts, unmatched };
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
function main() {
  const USAGE = [
    'usage: update-coverage.mjs <slug> --status <pending|converting|deployed|verified|content-pending|stale|failed> [--url <u>] [--error <m>] [--out <rolloutDir>]',
    '   or: update-coverage.mjs --block <id> --status <pending|converted|deployed|verified|failed> [--eds-name <n>] [--out <rolloutDir>]',
    '   or: update-coverage.mjs --from-ledger <content/.deploy-ledger.json> [--url-base <origin>] [--out <rolloutDir>]',
    '  exit 0 written · 1 coverage/ledger file missing or invalid · 2 usage',
  ].join('\n');
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0); }

  const OUT = arg('out', 'stardust/rollout');
  const status = arg('status', null);
  const blockId = arg('block', null);
  const fromLedger = arg('from-ledger', null);
  const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

  const pagesPath = join(OUT, 'coverage', 'pages.json');
  const blocksPath = join(OUT, 'coverage', 'blocks.json');
  const templatesPath = join(OUT, 'coverage', 'templates.json');
  const configPath = join(OUT, 'rollout.json');

  function reRoll() {
    const pagesDoc = readJSON(pagesPath);
    const blocksDoc = readJSON(blocksPath);
    const tDoc = readJSON(templatesPath);
    const config = readJSON(configPath);
    const pages = (pagesDoc && pagesDoc.pages) || [];
    if (tDoc) { rollupTemplates(tDoc, pages); tDoc.generatedAt = now; writeJSON(templatesPath, tDoc); }
    if (config) { rollupConfig(config, pages, blocksDoc && blocksDoc.blocks, now); writeJSON(configPath, config); }
  }

  if (fromLedger) {
    if (slug || status || blockId) { console.error(USAGE); process.exit(2); }
    const doc = readJSON(pagesPath);
    if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(1); }
    if (!existsSync(fromLedger)) { console.error(`rollout: ledger ${fromLedger} not found — run deploy-batch.mjs first.`); process.exit(1); }
    let ledger;
    try { ledger = JSON.parse(readFileSync(fromLedger, 'utf8')); } catch (e) { console.error(`rollout: ledger ${fromLedger} is not valid JSON (${e.message})`); process.exit(1); }
    const { counts, unmatched } = mergeLedgerIntoCoverage(doc.pages || [], ledger, { urlBase: arg('url-base', null) });
    doc.generatedAt = now;
    writeJSON(pagesPath, doc);
    reRoll();
    console.log(`from-ledger ${fromLedger}: ${counts.rows} rows · ${counts.deployed} → deployed · ${counts.failed} → failed · ${counts.kept} kept · ${counts.unmatched} unmatched${counts.deployedPath ? ` · ${counts.deployedPath} deployedPath written` : ''}`);
    if (unmatched.length) console.error(`  unmatched (no coverage row at that path; not invented): ${unmatched.slice(0, 10).join(' ')}${unmatched.length > 10 ? ` … +${unmatched.length - 10}` : ''}`);
    process.exit(0);
  }

  if (blockId) {
    const STATUSES = ['pending', 'converted', 'deployed', 'verified', 'failed'];
    if (!status || !STATUSES.includes(status)) { console.error(`block status must be one of ${STATUSES.join('|')}`); process.exit(2); }
    const doc = readJSON(blocksPath);
    if (!doc) { console.error(`rollout: ${blocksPath} not found — run blocks.mjs first.`); process.exit(1); }
    const b = (doc.blocks || []).find((x) => x.id === blockId);
    if (!b) { console.error(`rollout: no block "${blockId}".`); process.exit(1); }
    b.delivery = b.delivery || {};
    b.delivery.status = status;
    const edsNameArg = arg('eds-name', null);
    if (edsNameArg) b.delivery.edsBlockName = edsNameArg;
    if (status === 'converted') b.delivery.convertedAt = now;
    doc.generatedAt = now;
    writeJSON(blocksPath, doc);
    reRoll();
    console.log(`block ${blockId} → ${status}`);
    process.exit(0);
  }

  // Page update
  const STATUSES = ['pending', 'converting', 'deployed', 'verified', 'content-pending', 'stale', 'failed'];
  if (!slug || !status || !STATUSES.includes(status)) {
    console.error(USAGE);
    process.exit(2);
  }
  const doc = readJSON(pagesPath);
  if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(1); }
  const page = (doc.pages || []).find((p) => p.slug === slug);
  if (!page) { console.error(`rollout: no page with slug "${slug}".`); process.exit(1); }

  const url = arg('url', null);
  page.delivery = page.delivery || {};
  page.delivery.status = status;
  if (status === 'deployed') { page.delivery.deployedAt = now; if (url) page.delivery.deployedUrl = url; }
  if (status === 'verified') { page.delivery.verifiedAt = now; if (url) page.delivery.deployedUrl = url; }
  page.delivery.error = status === 'failed' ? (arg('error', 'unspecified')) : null;
  doc.generatedAt = now;
  writeJSON(pagesPath, doc);
  reRoll();

  const config = readJSON(configPath);
  const c = config && config.lastRun && config.lastRun.pages;
  console.log(`${slug} → ${status}${c ? `   (${c.verified} verified / ${c.deployed} deployed / ${c.pending + c.stale} remaining of ${c.total})` : ''}`);
}
if (isMain) main(); // imported for its helpers (fixture tests) — no CLI side effects
