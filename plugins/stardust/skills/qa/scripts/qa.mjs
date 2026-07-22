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
 *   --checks <list>         comma list: routing,content,templates,metadata,links,browse,perf (default: all)
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
 *   --fail-on <error|warn>  exit 1 threshold (default: error)
 *
 * Exit codes: 0 clean (below threshold), 1 findings at/above threshold, 2 infra error.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import {
  arg, flag, provenance, writeJSON, ensureDir, loadAllowlist, applyAllowlist, buildInventory,
  createPageCache,
} from './lib.mjs';
import { htmlReport } from './report-html.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = (arg('base') || '').replace(/\/$/, '');
if (!BASE) { console.error('qa: --base <live-url> is required'); process.exit(2); }

const OUT = arg('out', 'stardust/qa');
const CHECKS = (arg('checks', 'routing,content,templates,metadata,links,browse,perf')).split(',').map((s) => s.trim()).filter(Boolean);
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
  browserConcurrency: Number(arg('browser-concurrency', 3)),
};

const MODULES = {
  routing: 'checks/routing.mjs',
  content: 'checks/content.mjs',
  templates: 'checks/templates.mjs',
  metadata: 'checks/metadata.mjs',
  links: 'checks/links.mjs',
  browse: 'checks/browse.mjs',
  perf: 'checks/perf.mjs',
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

const report = {
  provenance: provenance('qa', BASE),
  base: BASE,
  checksRun,
  inventory: { pages: inventory.pages.length, sitemapEntries: inventory.sitemapPaths ? inventory.sitemapPaths.length : null },
  durationSeconds: Math.round((Date.now() - started) / 1000),
  summary,
  findings,
};
writeJSON(join(OUT, 'report.json'), report);
writeFileSync(join(OUT, 'report.html'), htmlReport(report));

console.log(`\nstardust:qa — ${BASE}`);
console.log(`pages: ${inventory.pages.length} · duration: ${report.durationSeconds}s · checks: ${checksRun.join(', ')}`);
console.log(`findings: ${summary.error} error / ${summary.warn} warn / ${summary.info} info (+${summary.allowlisted} allowlisted)`);
for (const f of active.filter((x) => x.severity === 'error').slice(0, 30)) {
  console.log(`  ERROR [${f.check}/${f.id}] ${f.path || '(fleet)'} — ${f.message}`);
}
console.log(`report: ${join(OUT, 'report.json')} · ${join(OUT, 'report.html')}`);

const failOn = arg('fail-on', 'error');
const failing = failOn === 'warn' ? summary.error + summary.warn : summary.error;
process.exit(failing > 0 ? 1 : 0);
