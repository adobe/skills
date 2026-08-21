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
 *   page  <status>: pending | converting | deployed | verified | stale | failed
 *   block <status>: pending | converted | deployed | verified | failed
 *
 * Re-derives templates.json + rollout.json roll-ups after every write.
 */
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
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
  console.error(`usage: update-coverage.mjs <slug> --status <${STATUSES.join('|')}> [--url <u>] [--error <m>]`);
  console.error('   or: update-coverage.mjs --block <id> --status <pending|converted|deployed|verified|failed> [--eds-name <n>]');
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
