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
 * New:    node update-coverage.mjs --new <slug> --path </delivered/path> --template <id> --origin <origin> [--title <t>] [--status <s>]
 *   page  <status>: pending | converting | deployed | verified | stale | failed
 *   block <status>: pending | converted | deployed | verified | failed
 *   A module mapped to EDS default content (no block needed) is recorded
 *   `--block <id> --status converted --eds-name default-content`; it is never counted pending.
 *
 *   --new adds a page that was built OUTSIDE the migrated tree — a search results page from the
 *   dynamics phase (D2), a landing page for a redirect — so it enters coverage, `verify.mjs --all`,
 *   `optimize.mjs` and the assembled sitemap (a recorded hands-off run left its D2-built search
 *   page out of all three because only captured pages had rows). The row: `templateId` = --template,
 *   `blocks` [], `delivery` pending (or --status). The pages schema allows no origin property, so
 *   the origin is recorded in `source.migratedHtml` as `<origin>:<slug>` (there is no migrated file
 *   to hash; `sourceHash` is a stable digest of origin + slug + path). The template row in
 *   templates.json is created or extended. Idempotent: the same slug again updates the row (a slug
 *   that belongs to a captured page is refused; a path already owned by another slug is refused).
 *   `inventory.mjs` rebuilds pages.json from the migrated tree and drops these rows — re-run the
 *   same --new line after every inventory run.
 *
 * Re-derives templates.json + rollout.json roll-ups after every write.
 *
 * Safe under a fan-out: the whole read-modify-write (pages or blocks, then the roll-ups) runs
 * under one cross-process lock, `<out>/.coverage.lock`, and every file is written through a
 * tmp + rename, so several cluster subagents recording rows at once never lose one and a reader
 * never sees a half-written file. A lock older than 60 s (a crashed writer) is reclaimed; waiting
 * longer than 30 s for one is an error (exit 1) naming the owner.
 *
 * Writes (under --out, default stardust/rollout): coverage/pages.json (page + new forms) or
 * coverage/blocks.json (block form), then coverage/templates.json and rollout.json when
 * they exist. One result line on stdout. Exit 0 ok, 2 usage, 1 missing ledger / refused row.
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, acquireLock } from './lib.mjs';
import { readFileSync } from 'node:fs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = arg('out', 'stardust/rollout');
const status = arg('status', null);
const blockId = arg('block', null);
const newSlug = arg('new', null);
const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

const pagesPath = join(OUT, 'coverage', 'pages.json');
const blocksPath = join(OUT, 'coverage', 'blocks.json');
const templatesPath = join(OUT, 'coverage', 'templates.json');
const configPath = join(OUT, 'rollout.json');
const now = new Date().toISOString();
const PAGE_STATUSES = ['pending', 'converting', 'deployed', 'verified', 'content-pending', 'stale', 'failed'];

// One lock for the four files: taken BEFORE the first read, released at exit (every path below
// ends in process.exit or falls off the end). The reads that follow therefore see the latest write.
try { acquireLock(join(OUT, '.coverage')); } catch (e) { console.error(`rollout: ${e.message}`); process.exit(1); }

function reRoll() {
  const pagesDoc = readJSON(pagesPath);
  const blocksDoc = readJSON(blocksPath);
  const tDoc = readJSON(templatesPath);
  const config = readJSON(configPath);
  const pages = (pagesDoc && pagesDoc.pages) || [];
  if (tDoc) { rollupTemplates(tDoc, pages); tDoc.generatedAt = now; writeJSON(templatesPath, tDoc); }
  if (config) { rollupConfig(config, pages, blocksDoc && blocksDoc.blocks, now); writeJSON(configPath, config); }
}

// --- New row (a page built outside the migrated tree) ---------------------------
// The origin marker lives in source.migratedHtml (`<origin>:<slug>`) — a real migrated file is a
// path with a slash, so the two never collide.
const isOriginMarker = (s) => typeof s === 'string' && /^[a-z][a-z0-9-]*:[^/]+$/.test(s);

if (newSlug) {
  const path = arg('path', null);
  const template = arg('template', null);
  const origin = arg('origin', null);
  const title = arg('title', null);
  const newStatus = status || 'pending';
  const errs = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(newSlug)) errs.push('--new <slug>: letters, digits, . _ - only');
  if (!path || !path.startsWith('/')) errs.push('--path </delivered/path> required (root-relative, extensionless)');
  if (!template) errs.push('--template <id> required');
  if (!origin || !/^[a-z][a-z0-9-]*$/.test(origin)) errs.push('--origin <token> required (lowercase, e.g. dynamics)');
  if (!PAGE_STATUSES.includes(newStatus)) errs.push(`--status must be one of ${PAGE_STATUSES.join('|')}`);
  if (errs.length) {
    console.error('usage: update-coverage.mjs --new <slug> --path </delivered/path> --template <id> --origin <origin> [--title <t>] [--status <s>]');
    for (const e of errs) console.error(`  ${e}`);
    process.exit(2);
  }
  const doc = readJSON(pagesPath);
  if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(1); }
  doc.pages = Array.isArray(doc.pages) ? doc.pages : [];
  const normPath = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const clash = doc.pages.find((p) => p.slug !== newSlug && (p.path || '') === normPath);
  if (clash) { console.error(`rollout: path ${normPath} already belongs to "${clash.slug}" — not added.`); process.exit(1); }
  let row = doc.pages.find((p) => p.slug === newSlug);
  if (row && !(row.source && isOriginMarker(row.source.migratedHtml))) {
    console.error(`rollout: "${newSlug}" is a captured page (source ${row.source && row.source.migratedHtml}) — record its status with \`${newSlug} --status <s>\` instead.`);
    process.exit(1);
  }
  const source = {
    migratedHtml: `${origin}:${newSlug}`,
    metaJson: null,
    sourceHash: `sha256:${createHash('sha256').update(`${origin}:${newSlug}:${normPath}`).digest('hex')}`,
  };
  let verb;
  if (row) {
    row.path = normPath;
    if (title) row.title = title;
    row.templateId = template;
    row.source = source;
    row.blocks = Array.isArray(row.blocks) ? row.blocks : [];
    row.delivery = row.delivery || { status: newStatus, deployedUrl: null, deployedAt: null, verifiedAt: null, error: null };
    if (status) row.delivery.status = newStatus;
    verb = 'updated';
  } else {
    row = { slug: newSlug, path: normPath, title: title || newSlug, templateId: template, source, blocks: [], delivery: { status: newStatus, deployedUrl: null, deployedAt: null, verifiedAt: null, error: null } };
    doc.pages.push(row);
    doc.pages.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
    verb = 'added';
  }
  doc.generatedAt = now;
  writeJSON(pagesPath, doc);

  // The row joins its template group (created when new) so the template roll-up counts it.
  const tDoc = readJSON(templatesPath);
  if (tDoc && Array.isArray(tDoc.templates)) {
    for (const t of tDoc.templates) {
      if (t.id !== template && Array.isArray(t.pages) && t.pages.includes(newSlug)) { t.pages = t.pages.filter((s) => s !== newSlug); t.pageCount = t.pages.length; }
    }
    let t = tDoc.templates.find((x) => x.id === template);
    if (!t) { t = { id: template, representativeSlug: newSlug, pages: [], pageCount: 0, blocks: [] }; tDoc.templates.push(t); tDoc.templates.sort((a, b) => String(a.id).localeCompare(String(b.id))); }
    t.pages = Array.isArray(t.pages) ? t.pages : [];
    if (!t.pages.includes(newSlug)) t.pages.push(newSlug);
    t.pages.sort();
    t.pageCount = t.pages.length;
    tDoc.generatedAt = now;
    writeJSON(templatesPath, tDoc);
  }
  reRoll();
  console.log(`${newSlug} ${verb} (${origin}) → ${normPath}   template ${template} · ${row.delivery.status}`);
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
if (!slug || !status || !PAGE_STATUSES.includes(status)) {
  console.error(`usage: update-coverage.mjs <slug> --status <${PAGE_STATUSES.join('|')}> [--url <u>] [--error <m>]`);
  console.error('   or: update-coverage.mjs --block <id> --status <pending|converted|deployed|verified|failed> [--eds-name <n>]');
  console.error('   or: update-coverage.mjs --new <slug> --path </path> --template <id> --origin <origin> [--title <t>] [--status <s>]');
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
