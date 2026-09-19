#!/usr/bin/env node
/**
 * qa.mjs — stardust:qa orchestrator. READ-ONLY: finds issues and writes a
 * report; it never edits site content, DA documents, or repo code. All output
 * lands under --out (default stardust/qa/).
 *
 * Usage:
 *   node skills/qa/scripts/qa.mjs --base <live-url> [options]
 *
 * Options:
 *   --base <url>            live host to sweep (required)
 *   --checks <list>         comma list: routing,content,templates,metadata,links,browse,perf,editability,dynamics,ai-readability
 *                           (default: all) or a preset — delivery = routing,content,templates,metadata,links ·
 *                           browse = browse,perf,editability · parity = dynamics,ai-readability. Fleets > 100 pages:
 *                           run the three presets as separate, sequential invocations.
 *   --baseline-reset        delete <baselines> before the sweep (the step after an approved fix batch)
 *   --paths-file <txt>      inventory source: one path per line
 *   --template-map <json>   inventory + template assignments (stardust/template-map.json)
 *   --scrape <dir>          stardust scrape captures for verbatim fidelity
 *   --expected-blocks <json> explicit per-template block expectations
 *   --allowlist <json>      documented non-defects (default: <out>/allowlist.json)
 *   --out <dir>             output dir (default: stardust/qa)
 *   --baselines <dir>       visual baselines (default: <out>/baselines)
 *   --max-pages <n>         cap the fleet (smoke runs)
 *   --no-sitemap-merge      inventory from explicit sources only (sitemap still
 *                           fetched for parity findings) — for sampled runs on
 *                           large fleets
 *   --perf-pages <n>        cap perf representatives (default 10)
 *   --budget-transfer-kb <n> --budget-js-kb <n>
 *   --skip-a11y             skip axe injection
 *   --probe-externals       probe unique external link targets (skipped by
 *                           default — dominates sweep time on blog fleets;
 *                           the skip is reported as links/externals-skipped)
 *   --ew-exempt <list>      editability: comma list of blocks whose authored rows are
 *                           config / derived / index fallback (dead texts reported as
 *                           exempt, not errors)
 *   --blocks-dir <dir>      editability: local blocks root — `@ew-exempt <reason>`
 *                           JSDoc tags in <dir>/<name>/<name>.js are honoured
 *   --fail-on <error|warn>  exit 1 threshold (default: error)
 *   --fetch-concurrency <n> per-host in-flight cap shared by every fetch and browser navigation
 *                           (default 4; halves on 429/503, +1 after 30 s clean)
 *   --browser-concurrency <n> parallel browser pages in browse/editability (default 2 — the observed
 *                           ceiling before aem.live answers 429 to ~3 concurrent headless crawlers)
 *   --throttle-max <pct>    share of pages left `unmeasured` by 429/503 above which the report is
 *                           incomplete: banner in report.html and exit 2 (default 5)
 *
 * Exit codes: 0 clean (below threshold), 1 findings at/above threshold, 2 infra error
 * (missing --base, empty inventory) OR report incomplete (throttled pages > --throttle-max —
 * exit 2 wins over exit 1: an incomplete sweep is not a verdict; re-run). report.json carries
 * `infra` { throttled, retries, serverErrors, unmeasuredPages, unmeasuredPct, incomplete }.
 * report.json is rewritten after every check with `partial: true` — a hang in a
 * later check never loses the findings already collected. stdout carries the
 * ranked class table only (summary.json / summary.md hold the per-page rows).
 */
import { join, dirname } from 'node:path';
import { classReport, renderTable, writeSummary } from '../../stardust/scripts/class-report.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import {
  arg, flag, provenance, writeJSON, ensureDir, loadAllowlist, applyAllowlist, buildInventory,
  createPageCache, resolveAuthHeader, setOriginAuth, createHostLimiter, setFetchLimiter, infraSummary,
} from './lib.mjs';
import { htmlReport } from './report-html.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (flag('help')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, '')); process.exit(0); }
const BASE = (arg('base') || '').replace(/\/$/, '');
if (!BASE) { console.error('qa: --base <live-url> is required'); process.exit(2); }

const OUT = arg('out', 'stardust/qa');
// preset names never collide with a module name, so `--checks browse` still runs that one module
const PRESETS = {
  delivery: ['routing', 'content', 'templates', 'metadata', 'links'],
  rendered: ['browse', 'perf', 'editability'],
  parity: ['dynamics', 'ai-readability'],
};
const CHECKS = [...new Set((arg('checks', 'routing,content,templates,metadata,links,browse,perf,editability,dynamics,ai-readability')).split(',').map((s) => s.trim()).filter(Boolean)
  .flatMap((s) => PRESETS[s] || [s]))];
const opts = {
  outDir: OUT,
  scrapeDir: arg('scrape', null),
  expectedBlocks: arg('expected-blocks', null),
  baselineDir: arg('baselines', join(OUT, 'baselines')),
  perfPages: Number(arg('perf-pages', 10)),
  budgetTransferKb: Number(arg('budget-transfer-kb', 800)),
  budgetJsKb: Number(arg('budget-js-kb', 250)),
  skipA11y: flag('skip-a11y'),
  probeExternals: flag('probe-externals'),
  browserConcurrency: Number(arg('browser-concurrency', 2)),
  fetchConcurrency: Number(arg('fetch-concurrency', 4)),
  throttleMaxPct: Number(arg('throttle-max', 5)),
  parity: arg('parity', null),
  blocksDir: arg('blocks-dir', null),
  ewExempt: arg('ew-exempt', null),
  authHeader: resolveAuthHeader(),
  baselineReset: flag('baseline-reset'),
};
if (opts.authHeader) setOriginAuth(BASE, opts.authHeader);
// every fetch and browser navigation of the sweep takes a slot here (lib.mjs § throttle / limiter)
setFetchLimiter(createHostLimiter({ maxInFlight: opts.fetchConcurrency }));
if (opts.baselineReset && opts.baselineDir) { rmSync(opts.baselineDir, { recursive: true, force: true }); console.error(`qa: --baseline-reset — removed ${opts.baselineDir}; this sweep re-establishes baselines`); }

const MODULES = {
  routing: 'checks/routing.mjs',
  content: 'checks/content.mjs',
  templates: 'checks/templates.mjs',
  metadata: 'checks/metadata.mjs',
  links: 'checks/links.mjs',
  browse: 'checks/browse.mjs',
  perf: 'checks/perf.mjs',
  editability: 'checks/editability.mjs',
  dynamics: 'checks/dynamics.mjs',
  'ai-readability': 'checks/ai-readability.mjs',
};

const started = Date.now();
console.error(`qa: sweeping ${BASE}`);
const inventory = await buildInventory({
  base: BASE,
  pathsFile: arg('paths-file', null),
  templateMap: arg('template-map', null),
  mergeSitemap: !flag('no-sitemap-merge'),
});
const maxPages = Number(arg('max-pages', 0));
if (maxPages > 0) inventory.pages = inventory.pages.slice(0, maxPages);
if (!inventory.pages.length) { console.error('qa: inventory is empty — pass --paths-file or --template-map, or check the sitemap'); process.exit(2); }
console.error(`qa: inventory ${inventory.pages.length} pages (sitemap ${inventory.sitemapPaths ? inventory.sitemapPaths.length : 'n/a'})`);
ensureDir(OUT);
writeJSON(join(OUT, 'inventory.json'), { _provenance: provenance('inventory', BASE), ...inventory });

// page + plain per page, with headroom for fragments and probe GETs
const ctx = {
  base: BASE, inventory, opts, shared: {},
  fetchPage: createPageCache(inventory.pages.length * 2 + 64),
};
const findings = [];
const checksRun = [];
// incremental: a check that hangs (perf on a throttled host) must not lose earlier findings
const writePartial = () => writeJSON(join(OUT, 'report.json'), { provenance: provenance('qa', BASE), base: BASE, partial: true, checksRun: [...checksRun], checksPlanned: CHECKS, inventory: { pages: inventory.pages.length }, findings });
for (const name of CHECKS) {
  if (!MODULES[name]) { console.error(`qa: unknown check "${name}" — skipping`); continue; }
  const t = Date.now();
  console.error(`qa: [${name}] running…`);
  try {
    const mod = await import(join(here, MODULES[name]));
    const f = await mod.run(ctx);
    findings.push(...f);
    checksRun.push(name);
    console.error(`qa: [${name}] ${f.length} finding(s) in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`qa: [${name}] FAILED: ${e.stack || e}`);
    findings.push({ check: name, id: 'check-crashed', severity: 'error', path: '', message: `check "${name}" crashed: ${String(e).slice(0, 300)}` });
  }
  writePartial();
}

const allowlistFile = arg('allowlist', join(OUT, 'allowlist.json'));
applyAllowlist(findings, loadAllowlist(allowlistFile));

const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => (a.allowlisted ? 1 : 0) - (b.allowlisted ? 1 : 0)
  || order[a.severity] - order[b.severity]
  || a.check.localeCompare(b.check) || (a.path || '').localeCompare(b.path || ''));

const active = findings.filter((f) => !f.allowlisted);
const summary = {
  error: active.filter((f) => f.severity === 'error').length,
  warn: active.filter((f) => f.severity === 'warn').length,
  info: active.filter((f) => f.severity === 'info').length,
  allowlisted: findings.length - active.length,
  byCheck: Object.fromEntries(checksRun.map((c) => [c, active.filter((f) => f.check === c || (c === 'browse' && ['rendered', 'visual', 'a11y'].includes(f.check))).length])),
};

const infra = infraSummary(findings, inventory.pages.length, { throttleMaxPct: opts.throttleMaxPct });
const report = {
  provenance: provenance('qa', BASE),
  base: BASE,
  checksRun,
  inventory: { pages: inventory.pages.length, sitemapEntries: inventory.sitemapPaths ? inventory.sitemapPaths.length : null },
  durationSeconds: Math.round((Date.now() - started) / 1000),
  summary,
  infra,
  findings,
};
writeJSON(join(OUT, 'report.json'), report);
writeFileSync(join(OUT, 'report.html'), htmlReport(report));
// class roll-up (stardust/reference/context-hygiene.md § Runner reports): the
// ranked class table is what the conversation may hold; per-page rows go to
// summary.json / summary.md, never to stdout.
const cls = classReport(active, { classKey: ['id', 'check'], pageKey: ['path'], pointerKey: ['evidence'], source: 'qa sweep' });
const summaryFiles = writeSummary(OUT, cls, { title: 'qa sweep' });

console.log(`\nstardust:qa — ${BASE}`);
console.log(`pages: ${inventory.pages.length} · duration: ${report.durationSeconds}s · checks: ${checksRun.join(', ')}`);
console.log(`findings: ${summary.error} error / ${summary.warn} warn / ${summary.info} info (+${summary.allowlisted} allowlisted)`);
if (infra.throttled || infra.retries) console.log(`infra: ${infra.throttled} throttled response(s) after retries · ${infra.retries} retr${infra.retries === 1 ? 'y' : 'ies'} · ${infra.unmeasuredPages} page(s) unmeasured (${infra.unmeasuredPct}% of the fleet, max ${infra.throttleMaxPct}%)${infra.incomplete ? ' — THROTTLED: results incomplete, re-run' : ''}`);
console.log(renderTable(cls, { title: 'qa sweep', maxLines: 60 }).join('\n'));
console.log(`report: ${join(OUT, 'report.json')} · ${join(OUT, 'report.html')} · ${summaryFiles.md}`);

const failOn = arg('fail-on', 'error');
const failing = failOn === 'warn' ? summary.error + summary.warn : summary.error;
// exit 2 wins over exit 1: an incomplete sweep is not a verdict on the site
if (infra.incomplete) { console.error(`qa: throttled — ${infra.unmeasuredPct}% of pages unmeasured (> --throttle-max ${infra.throttleMaxPct}); results incomplete, re-run`); process.exit(2); }
process.exit(failing > 0 ? 1 : 0);
