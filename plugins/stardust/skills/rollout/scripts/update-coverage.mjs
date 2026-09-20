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
 * Gate:   node update-coverage.mjs --gate <ai-readability|editability> <gate.json> [--min 98]
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
 * --gate <name> <json> is the generic per-page GATE INGEST (reference/delivery-gates.md § Gate 5,
 * § Gate 6): the gate's own JSON artifact is matched to coverage rows (pages[].path | url | content
 * → served path / slug) and copied — never typed — into `delivery.gates.<name>`; a page below the
 * gate's bar flips to `failed` with the reason; a page the instrument could not measure is
 * `unmeasured: true` and its status is UNTOUCHED (no verdict ≠ FAIL); rows the artifact does not
 * name are not written. The roll-up `rollout.json.lastRun.gates.<name>` is recomputed from the rows.
 *   ai-readability  ai-readability.mjs --json: pages[{path, strict{score}, code{score}} | {path, error}];
 *                   bar = the artifact's `min` (else --min, default 98): code < min → failed
 *                   ("ai-readability code N < min — top: <blocks>"); error → unmeasured.
 *   editability     ew-editability-probe.mjs --json: [{content|url, totals{authored, editable, dead,
 *                   duplicated, exempt}, blocks[{block, dead, duplicated, exempt, …}], errors[]}];
 *                   dead > 0 or duplicated > 0 → failed; errors[] (a block failed to install) →
 *                   unmeasured; blocks[] rows map to coverage/blocks.json by edsBlockName →
 *                   delivery.ewGate = pass | fail | exempt | unmeasured + ew{} counts.
 *
 * Re-derives templates.json + rollout.json roll-ups after every write.
 * Exit: 0 written · 1 unknown slug/block · 2 usage (bad status, ledger missing/unreadable/not an
 *       object, unknown --gate name or unreadable gate JSON, coverage/blocks missing — run
 *       inventory.mjs / blocks.mjs first: the rollout family's precondition code, coverage-model.md
 *       § Verify (Exit)). A --gate run with unmeasured pages still exits 0: the re-drive is the
 *       instrument's, the ingest recorded what it saw.
 */
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, deliveredPathOf } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`rollout update-coverage: --${name} needs a value`); process.exit(2); } // never swallow the next flag
  return v;
}
const now = new Date().toISOString();

// ---- batch reconcile from the driver's ledger ----
const LEDGER_OK = new Set(['live', 'previewed']);
const PROMOTABLE = new Set(['pending', 'converting', 'failed', 'stale']);
/** Same resource, not a different served path: only `/index` ≡ `/` and a trailing slash are ignored (case and extension differences ARE a different served path). */
export function sameResource(a, b) {
  const n = (p) => { const s = String(p || '/').split(/[?#]/)[0].replace(/\/index$/, '/').replace(/\/+$/, ''); return s || '/'; };
  return n(a) === n(b);
}
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
      // deployedPath = a path that was SERVED (coverage-model.md § Page delivery status lifecycle (Ledger reconcile)); a pending / failed row served nothing
      if (!sameResource(page.path, webPath) && !d.deployedPath) { d.deployedPath = webPath; counts.deployedPath += 1; }
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

// ---- generic per-page gate ingest (T33.1 / T32.1) ----
export const GATE_NAMES = ['ai-readability', 'editability'];
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
/** Normalise one gate artifact into rows [{ key, result }] where key is a served path or a content file. */
export function gateRows(name, doc, { min = 98 } = {}) {
  if (name === 'ai-readability') {
    const bar = Number.isFinite(Number(doc && doc.min)) ? Number(doc.min) : min;
    return { bar, origin: (doc && doc.origin) || null, at: (doc && doc.generatedAt) || now, rows: ((doc && doc.pages) || []).map((r) => (r.error
      ? { key: r.path, result: { strict: null, code: null, unmeasured: true, error: r.error } }
      : { key: r.path, result: { strict: r.strict && r.strict.score, code: r.code && r.code.score, unmeasured: false, below: (r.code && r.code.score) < bar, top: (r.blocks || []).filter((b) => b.servedGap > 0).sort((a, b) => b.servedGap - a.servedGap).slice(0, 3).map((b) => b.block) } })) };
  }
  if (name === 'editability') {
    const list = Array.isArray(doc) ? doc : (doc && doc.pages) || [];
    return { bar: 0, origin: null, at: now, rows: list.map((r) => { const t = r.totals || {}; const errors = (r.errors || []).length; const unmeasured = errors > 0 && !(t.dead > 0 || t.duplicated > 0); return { key: r.url || r.content, result: { authored: t.authored ?? 0, editable: t.editable ?? 0, dead: t.dead ?? 0, duplicated: t.duplicated ?? 0, exempt: t.exempt ?? 0, unmeasured, exemptSource: (Object.values(r.exemptions || {}).some((e) => e && e.source === '--exempt') ? 'cli' : '@ew-exempt'), origin: r.url ? 'url' : 'harness', below: t.dead > 0 || t.duplicated > 0, blocks: (r.blocks || []).map((b) => ({ block: b.block, authored: b.authored, editable: b.editable, dead: b.dead, duplicated: b.duplicated, exempt: b.exempt })), errors: r.errors || [] } }; }) };
  }
  return null;
}
/** Match a gate row key (path / url / content file) to a coverage row. */
export function matchPage(pages, key) {
  if (!key) return null;
  let k = String(key);
  try { if (/^https?:/i.test(k)) k = new URL(k).pathname; } catch { /* keep */ }
  k = k.replace(/\.plain\.html$/, '');
  const m = k.match(/(?:^|\/)content(\/.*)$/); if (m && !k.startsWith('/')) k = m[1]; // content/<page>.html → /<page>
  k = k.replace(/\.html?$/, '');
  const pk = pathKey(k);
  return pages.find((p) => deliveredPathOf(p) === k || p.path === k) || pages.find((p) => pathKey(deliveredPathOf(p)) === pk || (p.path && pathKey(p.path) === pk)) || null;
}
/**
 * Pure ingest — writes delivery.gates[name] on matched rows; below-bar → failed; unmeasured → status
 * untouched. Returns { matched, failed, unmeasured, unmatched[], rollup }.
 */
export function ingestGate(pages, name, doc, { min = 98, at = now, blocks = null } = {}) {
  const g = gateRows(name, doc, { min });
  if (!g) return null;
  const out = { matched: 0, failed: 0, unmeasured: 0, unmatched: [], measured: 0, touched: [] };
  const strict = []; const code = []; let ewAuthored = 0; let ewEditable = 0; let ewDead = 0; let ewExempt = 0;
  for (const { key, result } of g.rows) {
    const page = matchPage(pages, key);
    if (!page) { out.unmatched.push(key); continue; }
    out.matched += 1; out.touched.push(page.slug);
    page.delivery = page.delivery || { status: 'pending' };
    page.delivery.gates = page.delivery.gates || {};
    const rec = { ...result, at: g.at, ...(name === 'ai-readability' ? { origin: g.origin, min: g.bar } : {}) };
    delete rec.below; delete rec.top; delete rec.blocks; delete rec.errors;
    page.delivery.gates[name] = rec;
    if (result.unmeasured) { out.unmeasured += 1; continue; }
    out.measured += 1;
    if (name === 'ai-readability') { strict.push(result.strict); code.push(result.code); }
    if (name === 'editability') { ewAuthored += result.authored; ewEditable += result.editable; ewDead += result.dead; ewExempt += result.exempt; }
    if (result.below) {
      out.failed += 1;
      page.delivery.status = 'failed';
      page.delivery.error = name === 'ai-readability' ? `ai-readability code ${result.code} < ${g.bar}${result.top && result.top.length ? ` — top: ${result.top.join(', ')}` : ''}` : `editability: dead ${result.dead}${result.duplicated ? `, duplicated ${result.duplicated}` : ''}${(result.blocks || []).filter((b) => b.dead > 0 || b.duplicated > 0).slice(0, 3).map((b) => ` in ${b.block}`).join('')}`;
    }
    // editability: block rows by edsBlockName (T32.1) — a block's worst page verdict wins
    if (name === 'editability' && blocks) {
      for (const b of result.blocks || []) {
        const row = blocks.find((x) => x.delivery && x.delivery.edsBlockName === b.block) || blocks.find((x) => x.id === b.block);
        if (!row) continue;
        row.delivery = row.delivery || { status: 'pending' };
        const verdict = b.dead > 0 || b.duplicated > 0 ? 'fail' : b.exempt > 0 && b.editable === 0 ? 'exempt' : 'pass';
        const rank = { fail: 3, unmeasured: 2, exempt: 1, pass: 0 };
        if (!row.delivery.ewGate || rank[verdict] >= rank[row.delivery.ewGate]) row.delivery.ewGate = verdict;
        row.delivery.ew = { authored: b.authored ?? 0, editable: b.editable ?? 0, dead: b.dead ?? 0, exempt: b.exempt ?? 0, duplicated: b.duplicated ?? 0 };
      }
    }
  }
  if (name === 'editability' && blocks) for (const { result } of g.rows) if (result.unmeasured) for (const b of result.blocks || []) { const row = blocks.find((x) => x.delivery && x.delivery.edsBlockName === b.block); if (row && (!row.delivery.ewGate || row.delivery.ewGate === 'pass')) row.delivery.ewGate = 'unmeasured'; }
  out.rollup = name === 'ai-readability'
    ? { strictMedian: median(strict), codeMedian: median(code), below: out.failed, unmeasured: out.unmeasured, measured: out.measured, min: g.bar, at: g.at }
    : { authored: ewAuthored, editable: ewEditable, dead: ewDead, exempt: ewExempt, unmeasured: out.unmeasured, pagesFailed: out.failed, measured: out.measured, at: g.at };
  return out;
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
function main() {
  const USAGE = [
    'usage: update-coverage.mjs <slug> --status <pending|converting|deployed|verified|content-pending|stale|failed> [--url <u>] [--error <m>] [--out <rolloutDir>]',
    '   or: update-coverage.mjs --gate <ai-readability|editability> <gate.json> [--min 98] [--out <rolloutDir>]   (per-page gate ingest; unmeasured = status untouched)',
    '   or: update-coverage.mjs --block <id> --status <pending|converted|deployed|verified|failed> [--eds-name <n>] [--out <rolloutDir>]',
    '   or: update-coverage.mjs --from-ledger <content/.deploy-ledger.json> [--url-base <origin>] [--out <rolloutDir>]',
    '  exit 0 written · 1 unknown slug/block · 2 usage (bad status, ledger unreadable, coverage/blocks missing)',
  ].join('\n');
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0); }

  const OUT = arg('out', 'stardust/rollout');
  const status = arg('status', null);
  const blockId = arg('block', null);
  const fromLedger = arg('from-ledger', null);
  const gateName = arg('gate', null);
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

  if (gateName) {
    if (slug || status || blockId || fromLedger) { console.error(USAGE); process.exit(2); }
    if (!GATE_NAMES.includes(gateName)) { console.error(`rollout: --gate must be one of ${GATE_NAMES.join('|')} (got ${gateName})`); process.exit(2); }
    const gi = process.argv.indexOf('--gate'); const gateFile = process.argv[gi + 2];
    if (!gateFile || gateFile.startsWith('--') || !existsSync(gateFile)) { console.error(`rollout: --gate ${gateName} needs the instrument's JSON artifact (${gateFile || 'missing'} not found)\n${USAGE}`); process.exit(2); }
    let gdoc; try { gdoc = JSON.parse(readFileSync(gateFile, 'utf8')); } catch (e) { console.error(`rollout: ${gateFile} is not valid JSON (${e.message})`); process.exit(2); }
    const doc = readJSON(pagesPath);
    if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(2); }
    const blocksDoc = readJSON(blocksPath);
    const res = ingestGate(doc.pages || [], gateName, gdoc, { min: Number(arg('min', '98')), blocks: blocksDoc && blocksDoc.blocks });
    doc.generatedAt = now; writeJSON(pagesPath, doc);
    if (blocksDoc && gateName === 'editability') { blocksDoc.generatedAt = now; writeJSON(blocksPath, blocksDoc); }
    reRoll();
    const config = readJSON(configPath);
    if (config) { config.lastRun = config.lastRun || {}; config.lastRun.gates = { ...(config.lastRun.gates || {}), [gateName]: res.rollup }; writeJSON(configPath, config); }
    const r = res.rollup;
    console.log(gateName === 'ai-readability'
      ? `gate ai-readability ${gateFile}: ${res.matched} rows · strict median ${r.strictMedian ?? '—'} · code median ${r.codeMedian ?? '—'} · pages < ${r.min}: ${r.below} → failed · unmeasured: ${r.unmeasured} (status untouched — re-drive) · unmatched ${res.unmatched.length}`
      : `gate editability ${gateFile}: ${res.matched} rows · ${r.editable}/${r.authored} editable · dead ${r.dead} · exempt ${r.exempt} · unmeasured ${r.unmeasured} (status untouched — URL mode on preview) · pages failed ${r.pagesFailed} · unmatched ${res.unmatched.length}`);
    if (res.unmatched.length) console.error(`  unmatched (no coverage row; not invented): ${res.unmatched.slice(0, 10).join(' ')}${res.unmatched.length > 10 ? ` … +${res.unmatched.length - 10}` : ''}`);
    process.exit(0);
  }

  if (fromLedger) {
    if (slug || status || blockId) { console.error(USAGE); process.exit(2); }
    const doc = readJSON(pagesPath);
    if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(2); }
    if (fromLedger.startsWith('--') || !existsSync(fromLedger)) { console.error(`rollout: ledger ${fromLedger} not found — run deploy-batch.mjs first.\n${USAGE}`); process.exit(2); }
    let ledger;
    try { ledger = JSON.parse(readFileSync(fromLedger, 'utf8')); } catch (e) { console.error(`rollout: ledger ${fromLedger} is not valid JSON (${e.message})`); process.exit(2); }
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) { console.error(`rollout: ledger ${fromLedger} is not a ledger object (one row per web path)`); process.exit(2); }
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
    console.error(USAGE);
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
}
if (isMain) main(); // imported for its helpers (fixture tests) — no CLI side effects
