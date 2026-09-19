#!/usr/bin/env node
/**
 * rollout/update-coverage.mjs — deterministic state-writer for the delivery loop.
 *
 * The per-page delivery itself is the LLM-driven `deploy` methodology; this helper
 * just records the outcome so the loop stays honest and resumable. Call it after
 * each page's deploy step, and after each block converts.
 *
 * Page:   node update-coverage.mjs <slug>  --status <s> [--url <deployedUrl>] [--error <msg>]
 * Block:  node update-coverage.mjs --block <id> --status <s> [--eds-name <name>]
 * Ledger: node update-coverage.mjs --from-ledger <content/.deploy-ledger.json>
 *   page  <status>: pending | converting | deployed | verified | stale | failed
 *   block <status>: pending | converted | deployed | verified | failed
 *
 * --from-ledger reconciles a deploy-batch ledger (one row per web path, status
 * `live | previewed | pending | *-fail | body-invalid | overwrite-guard`) into the
 * page rows in one pass — it replaces the per-page calls after a batch run:
 *   live | previewed  → `deployed` only when the row is pending | converting | failed |
 *                       stale; `verified` is never downgraded (inventory owns `stale`),
 *                       `deployed` keeps its deployedAt, `content-pending` is untouched
 *   *-fail            → `failed`, delivery.error = the ledger's lastError
 *   anything else     → no verdict, row untouched
 *   the ledger path is matched to path | deployedPath (`/index` ≡ `/`, trailing slash
 *   ignored); a match on a different form is carried into delivery.deployedPath; a
 *   ledger path with no coverage row is listed, never invented.
 * The ledger itself is read-only here (deploy-batch owns it).
 *
 * Re-derives templates.json + rollout.json roll-ups after every write.
 * Exit: 0 written · 1 unknown slug/block · 2 usage (bad status, ledger unreadable,
 *       coverage/blocks missing — run inventory.mjs / blocks.mjs first)
 */
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
if (process.argv.includes('--help')) {
  console.log('Usage: node skills/rollout/scripts/update-coverage.mjs <slug> --status <s> [--url <u>] [--error <m>] [--out <rolloutDir>]\n'
    + '   or: update-coverage.mjs --block <id> --status <s> [--eds-name <n>]\n'
    + '   or: update-coverage.mjs --from-ledger <content/.deploy-ledger.json>   (reconcile a deploy-batch ledger into coverage)\n'
    + '  exit 0 written · 1 unknown slug/block · 2 usage (bad status, ledger unreadable, coverage missing)');
  process.exit(0);
}

const OUT = arg('out', 'stardust/rollout');
const status = arg('status', null);
const blockId = arg('block', null);
const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

const pagesPath = join(OUT, 'coverage', 'pages.json');
const blocksPath = join(OUT, 'coverage', 'blocks.json');
const templatesPath = join(OUT, 'coverage', 'templates.json');
const configPath = join(OUT, 'rollout.json');
const now = new Date().toISOString();

function reRoll() {
  const pagesDoc = readJSON(pagesPath);
  const blocksDoc = readJSON(blocksPath);
  const tDoc = readJSON(templatesPath);
  const config = readJSON(configPath);
  const pages = (pagesDoc && pagesDoc.pages) || [];
  if (tDoc) { rollupTemplates(tDoc, pages); tDoc.generatedAt = now; writeJSON(templatesPath, tDoc); }
  if (config) { rollupConfig(config, pages, blocksDoc && blocksDoc.blocks, now); writeJSON(configPath, config); }
}

// --from-ledger: bulk reconcile (deploy-batch ledger → page rows)
const ledgerPath = arg('from-ledger', null);
if (ledgerPath || process.argv.includes('--from-ledger')) {
  const ledger = ledgerPath ? readJSON(ledgerPath) : null;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) { console.error(`usage: update-coverage.mjs --from-ledger <ledger.json> — ${ledgerPath ? `${ledgerPath} is not a ledger object` : 'path missing'}`); process.exit(2); }
  const doc = readJSON(pagesPath);
  if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(2); }
  const norm = (p) => { const s = String(p || '/').split(/[?#]/)[0].replace(/\/index$/, '/').replace(/\/+$/, ''); return s || '/'; };
  // exact: path | deployedPath. loose: the source slug with its extension dropped (a
  // `/about.jsp` row delivered at `/about`) — a loose hit carries the served path.
  const loose = (p) => norm(p).toLowerCase().replace(/\.(html?|jsp|aspx?|php)$/, '') || '/';
  const byPath = new Map(); const byLoose = new Map();
  for (const p of doc.pages || []) {
    if (p.delivery && p.delivery.deployedPath) byPath.set(norm(p.delivery.deployedPath), p);
    if (!byPath.has(norm(p.path))) byPath.set(norm(p.path), p);
    if (!byLoose.has(loose(p.path))) byLoose.set(loose(p.path), p);
  }
  const FLIPPABLE = new Set(['pending', 'converting', 'failed', 'stale']);
  const n = { rows: 0, deployed: 0, failed: 0, kept: 0, unmatched: [] };
  for (const [webPath, rec] of Object.entries(ledger)) {
    n.rows += 1;
    const key = norm(webPath);
    const page = byPath.get(key) || byLoose.get(loose(key));
    if (!page) { n.unmatched.push(webPath); continue; }
    page.delivery = page.delivery || { status: 'pending' };
    const cur = page.delivery.status || 'pending';
    const st = rec && rec.status;
    if (st === 'live' || st === 'previewed') {
      if (FLIPPABLE.has(cur)) { page.delivery.status = 'deployed'; page.delivery.deployedAt = rec.ts || now; page.delivery.error = null; n.deployed += 1; } else n.kept += 1;
    } else if (/-fail$/.test(st || '')) {
      page.delivery.status = 'failed'; page.delivery.error = rec.lastError || st; n.failed += 1;
    } else n.kept += 1;
    if (key !== norm(page.path) && norm(page.delivery.deployedPath) !== key) page.delivery.deployedPath = key;
  }
  doc.generatedAt = now;
  writeJSON(pagesPath, doc);
  reRoll();
  const um = n.unmatched.length ? ` · ${n.unmatched.length} unmatched (no coverage row): ${n.unmatched.slice(0, 5).join(' ')}${n.unmatched.length > 5 ? ' …' : ''}` : '';
  console.log(`from-ledger ${ledgerPath}: ${n.rows} rows · ${n.deployed} → deployed · ${n.failed} → failed · ${n.kept} kept${um}`);
  process.exit(0);
}

if (blockId) {
  const STATUSES = ['pending', 'converted', 'deployed', 'verified', 'failed'];
  if (!status || !STATUSES.includes(status)) { console.error(`block status must be one of ${STATUSES.join('|')}`); process.exit(2); }
  const doc = readJSON(blocksPath);
  if (!doc) { console.error(`rollout: ${blocksPath} not found — run blocks.mjs first.`); process.exit(2); }
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
  console.error(`usage: update-coverage.mjs <slug> --status <${STATUSES.join('|')}> [--url <u>] [--error <m>]`);
  console.error('   or: update-coverage.mjs --block <id> --status <pending|converted|deployed|verified|failed> [--eds-name <n>]');
  process.exit(2);
}
const doc = readJSON(pagesPath);
if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(2); }
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
