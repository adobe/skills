#!/usr/bin/env node
/**
 * rollout/update-coverage.mjs — deterministic state-writer for the delivery loop.
 *
 * The per-page delivery itself is the LLM-driven `deploy` methodology; this helper
 * just records the outcome so the loop stays honest and resumable. Call it after
 * each page's deploy step, and after each block converts.
 *
 * Page:   node update-coverage.mjs <slug>  --status <s> [--url <deployedUrl>] [--error <msg>]
 * Block:  node update-coverage.mjs --block <id|edsName> --status <s> [--eds-name <name>] [--reason "<text>"]
 *   the row is found by `id`, then by `delivery.edsBlockName` (several rows sharing that name: refused,
 *   name the id instead).
 * Gate:   node update-coverage.mjs --gate <table | dir>
 *   <table> = a gate-all table: the roster stardust/replica/gates/all-<w>/summary.json, or the
 *   runs/<ts>-<slug>.json an --only run writes instead (never summary.json; same rows, fewer); <dir> = the
 *   gate dir all-<w>/: its summary.json when present, then runs/*.json in name order, every table ingested
 *   with the newest-row rule below. A summary.json that is absent while the runs/ beside it holds tables
 *   ingests those tables and says so on stdout:
 *     summary.json absent — an --only run writes runs/<ts>-<slug>.json; ingested <n> table(s) from <dir>/runs/
 *   Refused (exit 1, nothing written; every table is read before any write): `<path> not found` (no file,
 *   and no runs/ table beside a summary.json); `<path> cannot be read (<code>)` (the read fails — e.g. EISDIR,
 *   a directory named *.json in runs/); `<path> does not parse as JSON (<error>)`; a parsed file
 *   without a rows array, `<path> is not a gate-all summary (no rows[])`; a dir holding no table,
 *   `<dir> holds no gate-all table (no summary.json, no runs/*.json)`. One bad table in a dir refuses the ingest.
 *   Writes each row's verdict into the page's `delivery.gate` {pass, pct, heightDelta, clipped, content,
 *   reasons, inconclusive, override, table, at, width, atByWidth, passByWidth, rounds, host} (`table` = the file
 *   the row came from) and flips a failing page (no valid override) from deployed / verified to `failed` (error
 *   `gate: <reasons>`), a passing one out of that failure back to `deployed` only when no recorded width's verdict
 *   (passByWidth) is false; verify.mjs never marks a page `verified` while its `delivery.gate.pass` or any recorded
 *   width's verdict is false (#125 —
 *   completion derives from one place: a page the pixel table failed cannot read as verified).
 *   `override` = gate-all's validated {verdict, reason, valid}; only `valid: true` passes a failing row (a table
 *   whose override has no `valid` predates the check: not valid). An INCONCLUSIVE row (a polluted capture — no
 *   verdict) is recorded `pass: false` with `inconclusive: <reasons>` and never flips the status either way.
 *   The newest row per page and width wins: `delivery.gate.atByWidth` ({"<width>": ISO}) keeps the newest applied
 *   row time per width across ingests; a row older than its width's time is skipped (nothing of that page changes)
 *   and counted, so an older table of either width never reverts a newer verdict. A width with no time yet, or a
 *   gate recorded without `atByWidth` (before 0.34.4), is applied. Row time (`at`) = `reused.at` of a whole-row
 *   reuse (when the row was measured), else the table's `_provenance.writtenAt`, else null (never skipped, no map
 *   entry); `width` = the table's `_provenance.breakpoint`.
 *   `pass` is the verdict of the row applied last, whatever its width; `delivery.gate.passByWidth`
 *   ({"<width>": bool | null}, keys as atByWidth) keeps each width's own verdict (a valid override passes it; an
 *   INCONCLUSIVE row records null — no verdict, never a new false, never true — and keeps an earlier false):
 *   the row sets its table's width, other widths' entries are kept, a skipped older row touches none, a table
 *   without a breakpoint none. done-check.mjs
 *   proves a page only when every width is true, and lists it in pages_failed while any recorded width is false.
 *   `delivery.gate.rounds` ({"<width>": n}) = the row's fix-round count (`round`, a non-negative integer) per
 *   width, merged across ingests like `atByWidth` (the newest applied row of a width sets it, also a lower count
 *   after a round reset); a row without a valid `round` (a table written before gate-all counted rounds), a
 *   table without a width, or a skipped older row leaves the map unchanged.
 *   `delivery.gate.host` = the EDS origin (scheme + host) the row was measured against — a published gate measures
 *   the preview host (coverage `deployedUrl`) by default, a gate run with `--eds-host` the host it names (the final
 *   roster gate: the live host): the row's `host`, else its own table's `_provenance.eds`, else null (a trailing
 *   slash trimmed, nothing else normalised). Part of the record: the newest applied row sets it, a skipped older
 *   row leaves it.
 * New:    node update-coverage.mjs --new <slug> --path </delivered/path> --template <id> --origin <origin> [--title <t>] [--status <s>]
 *   page  <status>: pending | converting | deployed | verified | stale | failed
 *   block <status>: pending | converted | deployed | verified | failed | not-delivered
 *   A module mapped to EDS default content (no block needed) is recorded
 *   `--block <id> --status converted --eds-name default-content`; it is never counted pending.
 *   A block deliberately left undelivered (one under blocks/ no page uses, a module the site drops) is
 *   recorded `--block <name> --status not-delivered --reason "<text>"` — --reason is required for it
 *   (exit 2 otherwise) and kept as `delivery.reason`; any other status deletes `delivery.reason`.
 *   rollout.json lastRun.blocks counts it apart: {total, converted, notDelivered, pending}.
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
 *   `inventory.mjs` keeps these rows on a re-run (the origin marker identifies them; status untouched)
 *   until the migrated tree holds a file for the slug or a migrated page owns the path — the line runs once.
 *   Without a source.sourceUrl the row is synthesized: gate-all skips it, done-check asks it for no sidecar
 *   or gate (`sidecars_missing` never counts it) and names it under `info: synthesized_pages:N`; its status
 *   still counts (verify.mjs --all proves it live). It is never removed from pages.json by hand.
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
 * they exist. One result line on stdout (a --gate ingest of an absent summary.json: the note line first).
 * Exit 0 ok, 2 usage (also a not-delivered block without --reason), 1 missing ledger / refused row (no such page
 * or block, an EDS block name several block rows share) / refused --gate input (not found, cannot be read, unparsable,
 * no rows[], a dir that holds no gate-all table).
 */
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, acquireLock } from './lib.mjs';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

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
  const STATUSES = ['pending', 'converted', 'deployed', 'verified', 'failed', 'not-delivered'];
  if (!status || !STATUSES.includes(status)) { console.error(`block status must be one of ${STATUSES.join('|')}`); process.exit(2); }
  const reason = (arg('reason', '') || '').trim();
  if (status === 'not-delivered' && !reason) {
    console.error('usage: update-coverage.mjs --block <id> --status not-delivered --reason "<text>"   (--reason is required: why the block is not delivered)');
    process.exit(2);
  }
  const doc = readJSON(blocksPath);
  if (!doc) { console.error(`rollout: ${blocksPath} not found — run blocks.mjs first.`); process.exit(1); }
  const rows = doc.blocks || [];
  let b = rows.find((x) => x.id === blockId);
  if (!b) {
    const byEds = rows.filter((x) => x.delivery && x.delivery.edsBlockName === blockId);
    if (byEds.length > 1) { console.error(`rollout: "${blockId}" is the EDS block of ${byEds.length} rows (${byEds.map((x) => x.id).join(', ')}) — name one by its id.`); process.exit(1); }
    [b] = byEds;
  }
  if (!b) { console.error(`rollout: no block "${blockId}".`); process.exit(1); }
  b.delivery = b.delivery || {};
  b.delivery.status = status;
  const edsNameArg = arg('eds-name', null);
  if (edsNameArg) b.delivery.edsBlockName = edsNameArg;
  if (status === 'converted') b.delivery.convertedAt = now;
  if (status === 'not-delivered') b.delivery.reason = reason;
  else delete b.delivery.reason;
  doc.generatedAt = now;
  writeJSON(blocksPath, doc);
  reRoll();
  console.log(`block ${b.id === blockId ? blockId : `${b.id} (${blockId})`} → ${status}${status === 'not-delivered' ? `   reason: ${reason}` : ''}`);
  process.exit(0);
}

// --gate <path> → { label, tables: [{ file, table }] in ingest order, note } — every table parsed before anything is
// written; a refusal (exit 1) names its case: not found, cannot be read, does not parse, no rows[], a dir with no table.
function gateTables(path) {
  const refuse = (msg) => { console.error(`rollout: ${msg}`); process.exit(1); };
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const runsOf = (dir) => (isDir(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, 'runs', f)) : []);
  const load = (file) => {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch (e) { refuse(`${file} cannot be read (${e.code || e.message})`); }
    let table;
    try { table = JSON.parse(text); } catch (e) { refuse(`${file} does not parse as JSON (${e.message})`); }
    if (!table || !Array.isArray(table.rows)) refuse(`${file} is not a gate-all summary (no rows[])`);
    return { file, table };
  };
  if (isDir(path)) {
    const files = [...(existsSync(join(path, 'summary.json')) ? [join(path, 'summary.json')] : []), ...runsOf(path)];
    if (!files.length) refuse(`${path} holds no gate-all table (no summary.json, no runs/*.json)`);
    return { label: `${path} (${files.length} table${files.length === 1 ? '' : 's'})`, tables: files.map(load), note: null };
  }
  if (existsSync(path)) return { label: path, tables: [load(path)], note: null };
  // an --only run writes runs/<ts>-<slug>.json and never summary.json
  const dir = dirname(path);
  const runs = basename(path) === 'summary.json' ? runsOf(dir) : [];
  if (!runs.length) refuse(`${path} not found`);
  return {
    label: `${dir}/runs/ (${runs.length} table${runs.length === 1 ? '' : 's'})`,
    tables: runs.map(load),
    note: `summary.json absent — an --only run writes runs/<ts>-<slug>.json; ingested ${runs.length} table(s) from ${dir}/runs/`,
  };
}

// Gate ingest (#125): the pixel table's rows into delivery.gate
const gateArg = arg('gate', null);
// the EDS origin a verdict was measured against, as recorded — only a trailing slash trimmed; absent / empty → null
const originOf = (v) => (typeof v === 'string' && v.replace(/\/+$/, '')) || null;
if (gateArg) {
  const { label, tables, note } = gateTables(gateArg);
  const doc = readJSON(pagesPath);
  if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(1); }
  let matched = 0; let flipped = 0; let skipped = 0; let inconclusive = 0; let rowCount = 0;
  // summary.json first, then runs/ in name order (= time order); the newest row per page and width wins regardless
  for (const { file: gateFile, table } of tables) {
    const prov = table._provenance || {};
    const width = prov.breakpoint ?? null;
    const tableHost = originOf(prov.eds);
    rowCount += table.rows.length;
    for (const r of table.rows) {
      const p = (doc.pages || []).find((x) => x.slug === r.slug || (r.path && x.path === r.path));
      if (!p) continue;
      matched += 1;
      const at = (r.reused && r.reused.what === 'row' && r.reused.at) || prov.writtenAt || null;
      const rec = p.delivery && p.delivery.gate;
      const recAt = width != null && rec && rec.atByWidth ? rec.atByWidth[width] : null;
      if (at && recAt && Date.parse(at) < Date.parse(recAt)) { skipped += 1; continue; }
      const atByWidth = { ...((rec && rec.atByWidth) || {}) };
      if (at && width != null) atByWidth[width] = at;
      const rounds = { ...((rec && rec.rounds) || {}) };
      if (Number.isInteger(r.round) && r.round >= 0 && width != null) rounds[width] = r.round;
      p.delivery = p.delivery || {};
      // gate-all's validated override; a table written before the check carries none with `valid` — not earned
      const ov = r.override ? { verdict: r.override.verdict ?? null, reason: r.override.reason ?? null, valid: r.override.valid === true } : null;
      const pass = !r.inconclusive && !!(r.pass || (ov && ov.valid));
      const passByWidth = { ...((rec && rec.passByWidth) || {}) };
      // an inconclusive row has no verdict at its width: it keeps an earlier false (no measured verdict cleared that
      // failure), else null — never a new false (done-check: gates_inconclusive, not pages_failed) and never true
      // (unit_unproven needs every width true)
      if (width != null) passByWidth[String(width)] = r.inconclusive ? (passByWidth[String(width)] === false ? false : null) : pass;
      const widthFailed = Object.values(passByWidth).some((v) => v === false);
      p.delivery.gate = { pass, pct: r.pct, heightDelta: r.heightDelta, clipped: r.clipped ?? null, content: r.content || null, reasons: r.reasons || [], inconclusive: r.inconclusive ? (r.reasons || []).join('; ') || 'no verdict' : null, override: ov, table: gateFile, at, width, atByWidth, passByWidth, rounds, host: originOf(r.host) ?? tableHost };
      if (r.inconclusive) inconclusive += 1;
      else if (!pass && ['deployed', 'verified'].includes(p.delivery.status)) { p.delivery.status = 'failed'; p.delivery.error = `gate: ${(r.reasons || []).join('; ') || 'FAIL'}`; flipped += 1; }
      else if (pass && !widthFailed && p.delivery.status === 'failed' && /^gate: /.test(p.delivery.error || '')) { p.delivery.status = 'deployed'; p.delivery.error = null; flipped += 1; }
    }
  }
  doc.generatedAt = now;
  writeJSON(pagesPath, doc);
  reRoll();
  if (note) console.log(note);
  console.log(`gate ${label} → ${matched} of ${rowCount} rows matched, ${flipped} status flip(s), ${skipped} older row(s) skipped${inconclusive ? `, ${inconclusive} inconclusive (status unchanged)` : ''}`);
  process.exit(0);
}

// Page update
if (!slug || !status || !PAGE_STATUSES.includes(status)) {
  console.error(`usage: update-coverage.mjs <slug> --status <${PAGE_STATUSES.join('|')}> [--url <u>] [--error <m>]`);
  console.error('   or: update-coverage.mjs --block <id|edsName> --status <pending|converted|deployed|verified|failed|not-delivered> [--eds-name <n>] [--reason "<text>"]   (--reason required with not-delivered)');
  console.error('   or: update-coverage.mjs --gate <table | dir>   (stardust/replica/gates/all-<w>/summary.json, …/runs/<ts>-<slug>.json, or all-<w>/)');
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
