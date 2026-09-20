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
 *                      summary line (`not delivered: N (skipped)`, N > 0 only) and never written —
 *                      a skipped row is "no verdict", not a FAIL. Offline `--root`
 *                      verifies the tree itself, so `--all` covers every row there.
 *   --include-undelivered   with --all over HTTP: probe the undelivered rows too (the line
 *                      then reads `not delivered: N (probed — --include-undelivered)`)
 *   --slug <s>         that one row, whatever its status
 *   --token-env <NAME> site token for a LOCKED delivery host (deploy lockdown.mjs writes
 *                      SITE_TOKEN_<SLUG>; state.json credentials.siteTokenEnv names it): sent as
 *                      `Authorization` to --base only, never printed. Without it a locked site is
 *                      HTTP 401 on every row — a governance state, not a delivery regression.
 *   --paths <file|a,b,c>  restrict the selected set (default or --all) to these served paths — the
 *                      consumer of `wave.mjs regate-list` / a wave's deploy-paths file (T06.4). Same
 *                      shape as deploy-batch --paths (one per line or comma-separated, `#` comments);
 *                      `/index` ≡ `/`, case, trailing slash and `.html|.jsp|.aspx|.php` are ignored
 *                      (lib.mjs pathKey). Listed paths with no coverage row are counted and listed on
 *                      stderr, never invented; listed rows outside the status set are `not selected`.
 *                      The report lands under <out>/verify/paths/ so the site-wide summary stays intact.
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
 * spot re-check never overwrites the site-wide report) receives two files:
 *   summary.json  { total, checked, verified, failed, skipped, undelivered, unverified,
 *                   classes:[{ class, count, severity, worstExample, pointer }],
 *                   pages:[{ slug, path, type, status, class, reason, severity, advisories[] }] }
 *                 — one pages[] row per slug; the failure is the row's class, advisory
 *                 findings ride on advisories[]
 *   summary.md    the same table, then one `### <class> (<count>)` section per class
 *                 listing its pages — every pointer in the table leads there.
 *
 * Runs from the plugin tree or the project copy (stardust/scripts/rollout/): the
 * class-report helper is loaded from skills/stardust/scripts/ or, beside a project
 * copy, stardust/scripts/stardust/class-report.mjs — copy it along with this file
 * (and update-coverage.mjs + lib.mjs for --ai-readability).
 *
 * Throttling is not a verdict: a 429/503 is retried inline (Retry-After, capped at
 * 60 s, else 2 s then 4 s — 3 attempts); a page still throttled is reported as
 * `unverified` — its ledger status is NOT written — and the run exits 2: re-run,
 * never a failed page.
 *
 * Completion contract (skills/stardust/scripts/progress.mjs): the LAST stdout line is
 * `SUMMARY verify ok=<verified> failed=<failed> [noverdict=<unverified>] exit=<code>
 * details=<report>/summary.json skipped=<n>` — the line a background launch's hand-off
 * quotes; `noverdict` carries the throttled rows, never `failed`. The helper resolves
 * like class-report.mjs (plugin tree, else stardust/scripts/stardust/); missing, the
 * line still prints in the same format. No progress file: the run is one HTTP pass.
 *
 * Published-origin page gate (`--gate-report <stardust/rollout/gate-report.json>`, written by
 * gate-publish.mjs): each checked row's `delivery.gate` is merged from the report
 * (`{status, at, breakpoints, report}`; a row the report does not name is `ungated`). Under
 * `flow: replica` (state.json) a row renders-verified here is `verified` ONLY when its gate
 * status is `pass`; otherwise it stays `deployed` and the class table carries one advisory
 * row per gate status (`published-origin gate: fail | unmeasured | ungated | published-failing`)
 * — the gate is never re-judged here, only read (reference/publish-gate.md § Gate 8).
 *
 * AI-readability (`--ai-readability <ai-readability.mjs --json artifact>`, the Phase E live-origin run;
 * reference/measured-gates.md § Gate 5): ingested with the same matcher as update-coverage --gate —
 * `code < min` flips the row to `failed` (reason "ai-readability code N < min — top: <blocks>"),
 * an `error` row is `unmeasured` (status untouched, counted, exit 2 — a re-drive, never a pass,
 * never a FAIL); `delivery.gates.ai-readability` is copied from the artifact, never typed; the
 * class table gains `ai-readability below min` / `ai-readability unmeasured` rows.
 *
 * Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--paths <file|a,b,c>]
 *          [--all [--include-undelivered]] [--out <rolloutDir>] [--report <dir>] [--verbose] [--token-env <NAME>]
 *          [--gate-report <gate-report.json>] [--ai-readability <json> [--min 98]] [--state <state.json>]
 * Exit: 0 no row failed · 1 at least one row is `failed` (advisory classes never set
 *       it) · 2 usage (no base/root, coverage missing — run inventory.mjs first — an empty
 *       --paths list, or class-report.mjs not found next to this script) or a page left `unverified`
 *       by 429/503 throttling after the inline retry (re-run)
 */
import { writeFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, writeJSON, rollupTemplates, rollupConfig, siteBase, deliveredPathOf, isDelivered, artifactType, loadPageHTML, siteAuthHeader, pathKey } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; }
const has = (f) => process.argv.includes(`--${f}`);
if (has('help')) {
  console.log('Usage: node skills/rollout/scripts/verify.mjs [--base <url> | --root <dir>] [--slug <s>] [--paths <file|a,b,c>] [--all [--include-undelivered]] [--out <rolloutDir>] [--report <dir>] [--verbose] [--token-env <NAME>] [--gate-report <gate-report.json>] [--ai-readability <json> [--min 98]] [--state <state.json>]\n  --paths restricts the selected rows to the listed served paths (regate-list / wave deploy-paths file); report under <out>/verify/paths/\n  exit 0 no failed row · 1 at least one failed row · 2 usage (no base/root, no coverage, empty --paths, helper missing, gate report / readability artifact unreadable) or a page left unverified by 429/503 throttling or unmeasured by the readability gate (re-run)');
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
// progress.mjs (the SUMMARY line format) resolves the same two ways; absent → inline format, never a failure
const summaryLine = await (async () => {
  for (const c of ['../../stardust/scripts/progress.mjs', '../stardust/progress.mjs']) {
    try { return (await import(new URL(c, import.meta.url))).summaryLine; } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  return ({ driver, ok = 0, failed = 0, noverdict = 0, exit = 0, details = '-', extra = {} }) => [`SUMMARY ${driver}`, `ok=${ok}`, `failed=${failed}`, ...(noverdict ? [`noverdict=${noverdict}`] : []), `exit=${exit}`, `details=${details}`, ...Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`)].join(' ');
})();
const OUT = arg('out', 'stardust/rollout');
const ROOT = arg('root', null);
const onlySlug = arg('slug', null);
const ALL = has('all');
const INCLUDE_UNDELIVERED = has('include-undelivered');
const VERBOSE = has('verbose');
const PATHS_SPEC = arg('paths', null);
const REPORT = arg('report', onlySlug ? join(OUT, 'verify', `slug-${onlySlug}`) : PATHS_SPEC ? join(OUT, 'verify', 'paths') : join(OUT, 'verify'));
const GATE_REPORT_PATH = arg('gate-report', null);
const AIR_PATH = arg('ai-readability', null);
const AIR_MIN = Number(arg('min', '98'));
const STATE_PATH = arg('state', 'stardust/state.json');
const MAX_LINES = 60;

const pagesPath = join(OUT, 'coverage', 'pages.json');
const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(pagesPath);
if (!pagesDoc) { console.error('rollout verify: run inventory.mjs first.'); process.exit(2); }
const pages = pagesDoc.pages || [];
if (onlySlug && !pages.some((pg) => pg.slug === onlySlug)) { console.error(`rollout verify: no page with slug "${onlySlug}" in ${pagesPath}`); process.exit(2); } // a typo'd slug once wrote an empty summary and exited 0
// --paths: the list restricts the selection; keys compared through pathKey (deploy-batch's `/index` for the home page matches `/`)
let wantedPaths = null;
if (PATHS_SPEC) {
  const raw = existsSync(PATHS_SPEC) && statSync(PATHS_SPEC).isFile() ? readFileSync(PATHS_SPEC, 'utf8').split(/[\n,]/) : PATHS_SPEC.split(',');
  wantedPaths = new Map(raw.map((x) => x.trim()).filter((x) => x && !x.startsWith('#')).map((x) => [pathKey(x), x]));
  if (!wantedPaths.size) { console.error(`rollout verify: --paths ${PATHS_SPEC} lists no path`); process.exit(2); }
}
const BASE = siteBase(config, arg('base', null));
// T12.2: a locked site (lockdown.mjs) answers 401 anonymously — the token rides to --base only, by NAME
const AUTH = ROOT ? null : await siteAuthHeader(arg('token-env', null), 'rollout verify');
const authFor = (url) => (AUTH && BASE && String(url).startsWith(BASE) ? { authorization: AUTH } : {});
if (!ROOT && !BASE) { console.error('rollout verify: need --base <url> or --root <dir> (or set site.liveHost).'); process.exit(2); }
const OUTSIDE_POLICY = (config.links && config.links.outsideInventory) === 'warn' ? 'warn' : 'fail';
// --gate-report: the published-origin page gate, read never re-judged. Under flow: replica a
// render-verified row is `verified` only with gate status `pass`; else it stays `deployed`.
const gateReport = GATE_REPORT_PATH ? readJSON(GATE_REPORT_PATH) : null;
if (GATE_REPORT_PATH && (!gateReport || typeof gateReport.pages !== 'object')) { console.error(`rollout verify: --gate-report ${GATE_REPORT_PATH} unreadable or not a gate-report (pages{} missing) — run gate-publish.mjs first.`); process.exit(2); }
const REPLICA_FLOW = ((readJSON(STATE_PATH, {}) || {}).flow) === 'replica';
const airDoc = AIR_PATH ? readJSON(AIR_PATH) : null;
if (AIR_PATH && (!airDoc || !Array.isArray(airDoc.pages))) { console.error(`rollout verify: --ai-readability ${AIR_PATH} unreadable or not an ai-readability.mjs --json artifact (pages[] missing).`); process.exit(2); }
// the ingest lives in update-coverage.mjs (one matcher for every gate); loaded only when asked, so a
// project copy without it still runs the structural verify (copy update-coverage.mjs along for --ai-readability)
const ingestGate = airDoc ? await (async () => { try { return (await import(new URL('./update-coverage.mjs', import.meta.url))).ingestGate; } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; console.error('rollout verify: --ai-readability needs update-coverage.mjs next to this script (the gate ingest) — copy it along.'); process.exit(2); } })() : null;
const GATE_STATUSES = ['fail', 'published-failing', 'blocked', 'unmeasured', 'ungated'];
function gateOf(p) {
  if (!gateReport) return null;
  const served = deliveredPathOf(p);
  const r = gateReport.pages[served] || gateReport.pages[p.path] || Object.values(gateReport.pages).find((x) => x.slug === p.slug);
  if (!r || !r.latest) return { status: 'ungated', at: null, breakpoints: {}, report: GATE_REPORT_PATH };
  const bps = Object.fromEntries(Object.entries(r.latest.breakpoints || {}).map(([W, b]) => [W, { pixelPct: b.pixelPct ?? null, heightDelta: b.heightDelta ?? null, cropsOk: b.cropsOk ?? null, pass: !!b.pass }]));
  return { status: r.latest.status, at: r.latest.at, breakpoints: bps, report: GATE_REPORT_PATH };
}

// --- known targets: every coverage row by BOTH its path and its deployedPath ------
const norm = (p) => (String(p).split(/[?#]/)[0].replace(/\/$/, '') || '/');
const rowByPath = new Map();
for (const p of pages) { for (const k of new Set([p.path, deliveredPathOf(p)])) if (k) rowByPath.set(norm(k), p); }
// offline, the tree is the artefact: a coverage row IS reachable
const targetDelivered = (row) => (ROOT ? true : isDelivered(row));

// A page delivered from <dir>/index.html — served on one slash form only, so both are probed.
const isFolderRoot = (p) => p.path && p.path !== '/' && /\/index\.html$/.test((p.source && p.source.migratedHtml) || '');
async function headStatus(url) {
  try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: authFor(url) }); return r.status; } catch { return 0; }
}

// 429/503 = the host is throttling, not failing: retry inline (Retry-After capped at 60 s,
// else 2 s / 4 s), then hand back `throttled` — a no-verdict the loop keeps out of the ledger.
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function fetchPage(p) {
  if (ROOT) return loadPageHTML(p, { root: ROOT, base: BASE });
  const url = `${BASE}${deliveredPathOf(p)}`;
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try { res = await fetch(url, { headers: authFor(url) }); } catch (e) { return { ok: false, reason: `fetch error: ${e.message}` }; }
    if (res.status === 401 && !AUTH) return { ok: false, reason: `HTTP 401${res.headers.get('x-error') ? ` (x-error: ${res.headers.get('x-error')})` : ''} — a locked site? pass --token-env <credentials.siteTokenEnv>` };
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
const listed = (p) => !wantedPaths || wantedPaths.has(pathKey(deliveredPathOf(p))) || wantedPaths.has(pathKey(p.path));
const notSelected = []; // listed rows outside the status set (pending, content-pending …)
const target = pages.filter((p) => {
  if (onlySlug) return p.slug === onlySlug;
  if (!listed(p)) return false;
  if (ALL) {
    if (ROOT || isDelivered(p)) return true;
    undelivered += 1; return INCLUDE_UNDELIVERED;
  }
  const sel = ['deployed', 'verified'].includes(p.delivery && p.delivery.status);
  if (!sel && wantedPaths) notSelected.push(p.slug);
  return sel;
});
const skipped = INCLUDE_UNDELIVERED ? 0 : undelivered;
const noRow = wantedPaths ? [...wantedPaths].filter(([k]) => !pages.some((p) => pathKey(deliveredPathOf(p)) === k || pathKey(p.path) === k)).map(([, raw]) => raw) : [];
if (noRow.length) console.error(`rollout verify: --paths: ${noRow.length} path(s) with no coverage row (not invented): ${noRow.slice(0, 10).join(' ')}${noRow.length > 10 ? ` … +${noRow.length - 10}` : ''}`);

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
  const gate = gateOf(p);
  if (gate) p.delivery.gate = gate;
  // fidelity-tiers.md § Declaration: `published-origin` in the row's gatesPassed[] follows the report's LATEST round —
  // pass adds it, any other status removes it (read, never re-judged; a stale pass never survives a failed re-gate)
  if (gate) { const gp = (Array.isArray(p.gatesPassed) ? p.gatesPassed : []).filter((g) => g !== 'published-origin'); if (gate.status === 'pass') gp.push('published-origin'); if (gp.length || Array.isArray(p.gatesPassed)) p.gatesPassed = gp; }
  if (gate && status === 'verified' && REPLICA_FLOW && gate.status !== 'pass') {
    status = 'deployed'; // renders, but the page gate has not passed: not verified (D1 — the gate is read, not re-judged)
    advisories.push({ slug: p.slug, path: served, type, status, class: `published-origin gate: ${GATE_STATUSES.includes(gate.status) ? gate.status : 'ungated'}`, reason: `renders, stays deployed — gate ${gate.status}${Object.entries(gate.breakpoints).map(([W, b]) => ` · ${W} ${b.pass ? 'PASS' : b.pixelPct === null ? 'no number' : `${b.pixelPct} %`}`).join('')} (${gate.report})`, severity: 'warn' });
  } else if (gate && gate.status !== 'pass' && status !== 'failed') {
    advisories.push({ slug: p.slug, path: served, type, status, class: `published-origin gate: ${GATE_STATUSES.includes(gate.status) ? gate.status : 'ungated'}`, reason: `gate ${gate.status} (${gate.report})`, severity: 'info' });
  }
  p.delivery.status = status;
  if (status === 'verified') { p.delivery.verifiedAt = now; p.delivery.error = null; }
  else if (status === 'deployed') p.delivery.error = null;
  else p.delivery.error = reason;
  p.delivery.pendingLinks = pending.length ? pending : undefined;
  p.delivery.outsideLinks = outside.length && status === 'verified' ? outside : undefined;
  results.push({ slug: p.slug, path: served, type, status, reason, class: failureClass(reason), severity: status === 'failed' ? 'error' : undefined });
  if (pending.length) advisories.push({ slug: p.slug, path: served, type, status, class: 'pending-target link', reason: `links to undelivered coverage rows: ${pending.slice(0, 5).join(', ')}`, severity: 'info' });
  if (outside.length && status === 'verified') advisories.push({ slug: p.slug, path: served, type, status, class: 'outside-inventory link (warn)', reason: `links outside coverage: ${outside.slice(0, 5).join(', ')}`, severity: 'warn' });
}

// --- AI-readability ingest (Phase E live run): below min → failed; error → unmeasured, exit 2 ---
let airRollup = null; let airUnmeasured = 0; let airBelow = 0;
if (airDoc) {
  const checked = new Set(target.map((p) => p.slug));
  const res = ingestGate(pages, 'ai-readability', airDoc, { min: AIR_MIN, at: now });
  airRollup = res.rollup; airUnmeasured = res.unmeasured; airBelow = res.failed;
  const touched = new Set(res.touched);
  for (const p of pages) {
    const g = p.delivery && p.delivery.gates && p.delivery.gates['ai-readability'];
    if (!g || !touched.has(p.slug)) continue;
    const served = deliveredPathOf(p); const type = artifactType(p);
    if (g.unmeasured) { unverified.push({ slug: p.slug, path: served, type, status: 'unmeasured', reason: `ai-readability unmeasured (${g.error}) — infrastructure state, re-run the gate on this page`, class: 'ai-readability unmeasured', severity: 'warn' }); continue; }
    if (p.delivery.status === 'failed' && /^ai-readability code/.test(p.delivery.error || '')) {
      const row = results.find((r) => r.slug === p.slug);
      if (row) { row.status = 'failed'; row.reason = p.delivery.error; row.class = 'ai-readability below min'; row.severity = 'error'; }
      else results.push({ slug: p.slug, path: served, type, status: 'failed', reason: p.delivery.error, class: 'ai-readability below min', severity: 'error' });
    } else if (!checked.has(p.slug)) advisories.push({ slug: p.slug, path: served, type, status: p.delivery.status, class: 'ai-readability ok (not in this verify set)', reason: `code ${g.code} ≥ ${AIR_MIN}`, severity: 'info' });
  }
  if (config) { config.lastRun = config.lastRun || {}; config.lastRun.gates = { ...(config.lastRun.gates || {}), 'ai-readability': airRollup }; }
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
const heldByGate = results.filter((r) => r.status === 'deployed').length;
const bad = results.filter((r) => r.status === 'failed');
const byType = results.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
const pendingPages = advisories.filter((a) => a.severity === 'info').length;
const outsideWarnPages = advisories.filter((a) => a.severity === 'warn').length;
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const summaryMd = join(REPORT, 'summary.md');
const report = classReport([...bad, ...unverified, ...advisories], { classKey: ['class'], pageKey: ['slug'], messageKey: ['reason'], pointerKey: ['pointer'], source: 'rollout verify' });
for (const c of report.classes) { const ptr = `${summaryMd}#${anchor(`${c.class} (${c.count})`)}`; for (const pg of c.pages) pg.pointer = ptr; if (c.worst) c.worst.pointer = ptr; }

const head = [
  `rollout verify (${ROOT ? `root:${ROOT}` : BASE})`,
  '='.repeat(60),
  `Checked ${results.length} · ${ok} verified · ${bad.length} failed · types: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`,
];
const throttledRows = unverified.filter((u) => u.class === 'throttled (429/503)').length;
if (throttledRows) head.push(`unverified: ${throttledRows} page(s) throttled (429/503 through the inline retry) — ledger untouched, exit 2: re-run verify`);
if (airRollup) head.push(`Readability  strict median ${airRollup.strictMedian ?? '—'} · code median ${airRollup.codeMedian ?? '—'} · pages < ${AIR_MIN}: ${airBelow} · unmeasured: ${airUnmeasured}${airUnmeasured ? ' (exit 2 — re-run the gate on those pages; never a pass)' : ''}`);
if (gateReport) { const g = gateReport.coverage || {}; head.push(`published-gated ${g.gated ?? 0} of ${g.delivered ?? 0} · PASS ${g.pass ?? 0} · FAIL ${g.fail ?? 0} · unmeasured ${g.unmeasured ?? 0} · ungated ${g.ungated ?? 0}${g.publishedFailing ? ` · published-failing ${g.publishedFailing}` : ''} (${GATE_REPORT_PATH})`); if (heldByGate) head.push(`renders but stays deployed: ${heldByGate} page(s) — page gate not passed (flow: replica; verified counts only gate PASS)`); }
if (ALL && !ROOT && undelivered) head.push(`not delivered: ${undelivered} (${INCLUDE_UNDELIVERED ? 'probed — --include-undelivered' : 'skipped'})`);
if (wantedPaths) head.push(`--paths: ${target.length} of ${wantedPaths.size} listed selected${noRow.length ? ` · ${noRow.length} no coverage row` : ''}${notSelected.length ? ` · ${notSelected.length} not delivered (${notSelected.slice(0, 5).join(' ')})` : ''}`);
if (pendingPages) head.push(`pending-target links: ${pendingPages} page(s) (advisory — the targets are coverage rows not yet delivered)`);
if (outsideWarnPages) head.push(`outside-inventory links: ${outsideWarnPages} page(s) (links.outsideInventory: warn)`);
const tail = [`report: ${summaryMd} (table, then per-page rows per class) · data: ${join(REPORT, 'summary.json')}`];
if (!target.length) tail.push(ALL && skipped ? 'Nothing delivered yet — every row is pending/content-pending/converting.' : 'Nothing to verify (no deployed pages). Deliver pages first, or pass --all.');
const table = report.total ? renderTable(report, { title: 'rollout verify — findings by class', maxLines: MAX_LINES - head.length - tail.length }) : [];
const lines = [...head, ...table, ...tail];

// one pages[] row per slug: the failure (or the throttle) is the row's class; advisory
// findings ride on advisories[] and only lend the row its class when nothing failed.
const rowBySlug = new Map();
for (const { slug, path, type, status, class: cls, reason, severity } of [...results, ...unverified]) rowBySlug.set(slug, { slug, path, type, status, class: cls, reason, severity: severity ?? null, advisories: [] });
for (const a of advisories) {
  const row = rowBySlug.get(a.slug);
  row.advisories.push({ class: a.class, reason: a.reason, severity: a.severity });
  if (!row.class) { row.class = a.class; row.reason = a.reason; row.severity = a.severity; }
}
const pageRows = [...rowBySlug.values()];

mkdirSync(REPORT, { recursive: true });
writeJSON(join(REPORT, 'summary.json'), {
  generatedAt: now, source: ROOT ? `root:${ROOT}` : BASE, mode: ROOT ? 'root' : 'http', outsideInventory: OUTSIDE_POLICY,
  total: pages.length, checked: results.length, verified: ok, failed: bad.length, skipped, undelivered, unverified: unverified.length,
  ...(wantedPaths ? { paths: { listed: wantedPaths.size, selected: target.length, noRow, notSelected } } : {}),
  pendingTargetPages: pendingPages, outsideWarnPages, gateReport: GATE_REPORT_PATH, heldByGate, aiReadability: airRollup,
  classes: report.classes.map((c) => ({ class: c.class, count: c.count, severity: c.severity ?? null, worstExample: c.worst ? `${c.worst.page} — ${c.worst.message}` : null, pointer: c.worst ? c.worst.pointer : null })),
  pages: pageRows,
});
// summary.md = the stdout block, then the per-page rows per class (where the pointers lead)
const md = ['# rollout verify', '', `Generated ${now}.`, '', ...lines, ''];
if (report.classes.length) {
  md.push('## Per-page rows', '', 'One section per class, ranked as in the table. Triage per class; never paste these into the conversation.', '');
  for (const c of report.classes) {
    md.push(`### ${c.class} (${c.count})`, '');
    for (const pg of c.pages) md.push(`- ${pg.page}${pg.severity ? ` [${pg.severity}]` : ''} — ${pg.message}`);
    md.push('');
  }
}
writeFileSync(summaryMd, md.join('\n'));

console.log(lines.join('\n'));
if (VERBOSE) for (const r of [...bad, ...unverified, ...advisories]) console.log(`  ${r.status === 'failed' ? '✗' : '·'} ${r.slug} (${r.type}): ${r.reason}`);
const exitCode = unverified.length ? 2 : bad.length ? 1 : 0; // unverified carries throttled AND readability-unmeasured rows: no verdict ≠ FAIL
console.log(summaryLine({ driver: 'verify', ok, failed: bad.length, noverdict: unverified.length, exit: exitCode, details: join(REPORT, 'summary.json'), extra: { skipped: ALL && !ROOT ? skipped : undefined, mode: ROOT ? 'root' : 'http', gateHeld: heldByGate || undefined, paths: wantedPaths ? wantedPaths.size : undefined } }));
process.exit(exitCode);
