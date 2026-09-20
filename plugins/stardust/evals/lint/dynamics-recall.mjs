#!/usr/bin/env node
/**
 * dynamics-recall.mjs — detector recall eval for skills/dynamics/scripts/dynamics-detect.mjs
 * over the static fixture in evals/_shared/dynamics-recall/ (no source-site hits; nothing
 * leaves the machine — a throw-away http server on an ephemeral port serves the pages and
 * the detector runs with --offline, so vendor script tags never resolve).
 *
 * Two passes, scored against expected.json:
 *   reach  (always)      lib.mjs reachSignals() over sidecars/pages/*.json — the rows `--reach`
 *                        mints or annotates from extract --dynamics sidecars; plus the sidecar
 *                        contract: extract/scripts/crawl.mjs still writes every `dynamic` field
 *                        they read (lib.mjs REACH_SIDECAR_FIELDS ⊆ crawl's `dynamicDom` keys — read
 *                        from crawl's DYNAMIC_DOM_FIELDS export when present, else parsed from the
 *                        object literal with lib.mjs objectLiteralKeys, whatever its formatting).
 *   depth  (playwright)  dynamics-detect.mjs --urls <fixture pages> --reach <sidecars> --offline;
 *                        every `depth` row must be found on its page, every `reach` row must carry
 *                        reach.pages ≥ minPages, and `reachOnly` rows must (not) be hint reach-only.
 *                        Skipped with a notice when playwright is not resolvable from the cwd;
 *                        `--static` leaves it out on purpose (the lint:stardust chain — CI installs
 *                        no browser; run the full eval from an EDS project before a dynamics release).
 *
 * Prints recall per class and the unexpected findings (noise — informational, never a failure).
 * Usage: node plugins/stardust/evals/lint/dynamics-recall.mjs [--static] [--keep] [--help]
 * Exit: 0 every expected row found · 1 a miss, a wrong reach-only flag, or a sidecar field the crawl
 *       no longer writes · 2 fixture unreadable. No gate threshold: the eval fails only on its own fixture.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

if (process.argv.includes('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, '')); process.exit(0); }
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', '..');
const FIXTURE = join(PLUGIN, 'evals', '_shared', 'dynamics-recall');
const DETECT = join(PLUGIN, 'skills', 'dynamics', 'scripts', 'dynamics-detect.mjs');
const CRAWL = join(PLUGIN, 'skills', 'extract', 'scripts', 'crawl.mjs');
const KEEP = process.argv.includes('--keep');
const STATIC = process.argv.includes('--static');

let expected;
try { expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')).rows; } catch (e) { console.error(`dynamics-recall: fixture unreadable — ${e.message}`); process.exit(2); }
const { reachSignals, REACH_SIDECAR_FIELDS, objectLiteralKeys } = await import(pathToFileURL(join(PLUGIN, 'skills', 'dynamics', 'scripts', 'lib.mjs')).href);

let failed = 0;
const ok = (name, pass, detail = '') => { if (!pass) failed += 1; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const recallTable = (label, rows, found) => {
  const byClass = {};
  for (const r of rows) { const c = byClass[r.class] || (byClass[r.class] = { want: 0, got: 0 }); c.want += 1; if (found(r)) c.got += 1; }
  console.log(`${label} recall: ${Object.entries(byClass).map(([k, v]) => `${k} ${v.got}/${v.want}`).join(' · ')}`);
};

/* ------------------------------------------------------- reach (static) -- */
const sidecarDir = join(FIXTURE, 'sidecars', 'pages');
const records = readdirSync(sidecarDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(sidecarDir, f), 'utf8')));
const { summary, rows } = reachSignals(records);
ok('reach: every sidecar carries evidence', summary.pagesWithEvidence === records.length, `${summary.pagesWithEvidence}/${records.length}`);
const reachRows = expected.filter((r) => r.via === 'reach');
const findReach = (r) => rows.find((x) => x.class === r.class && new RegExp(r.feature).test(x.feature));
for (const r of reachRows) { const x = findReach(r); ok(`reach: ${r.id}`, !!x && x.pages >= (r.minPages || 1), x ? `${x.class} "${x.feature}" on ${x.pages} sidecar(s)` : 'not minted'); }
recallTable('reach', reachRows, findReach);
const reachNoise = rows.filter((x) => !reachRows.some((r) => r.class === x.class && new RegExp(r.feature).test(x.feature)));
if (reachNoise.length) console.log(`reach noise (informational): ${reachNoise.map((x) => `${x.class} "${x.feature}"`).join(' · ')}`);

// crawl.mjs must still write every field the reach pass reads (the sidecar contract, extract/reference/current-state-schema.md § dynamic).
// The key list comes from crawl's own export when it has one; otherwise the `dynamicDom: { … }` literal is parsed
// (comments, strings and nested `{}` are fine) — never a regex cut at the first `}` of the source.
const crawlMod = await import(pathToFileURL(CRAWL).href);
const crawlFields = Array.isArray(crawlMod.DYNAMIC_DOM_FIELDS) ? crawlMod.DYNAMIC_DOM_FIELDS : objectLiteralKeys(readFileSync(CRAWL, 'utf8'), 'dynamicDom');
ok('crawl.mjs dynamicDom contract located', Array.isArray(crawlFields) && crawlFields.length > 0, crawlFields ? `${crawlFields.length} field(s) via ${crawlMod.DYNAMIC_DOM_FIELDS ? 'DYNAMIC_DOM_FIELDS export' : 'object-literal parse'}` : 'no `dynamicDom: {…}` literal in crawl.mjs');
for (const field of REACH_SIDECAR_FIELDS) ok(`crawl.mjs dynamicDom writes ${field}`, !!crawlFields && crawlFields.includes(field));

/* ------------------------------------------------------ depth (browser) -- */
let playwright = false;
try { const { createRequire } = await import('node:module'); createRequire(join(process.cwd(), 'package.json')).resolve('playwright'); playwright = true; } catch { try { await import('playwright'); playwright = true; } catch { /* not installed */ } }
if (STATIC) {
  console.log('depth: not run (--static — the lint-chain mode; run without the flag from an EDS project for the browser half)');
} else if (!playwright) {
  console.log('depth: SKIPPED — playwright not resolvable from the cwd (run from an EDS project whose stardust/node_modules preflight-runtime.mjs installed, for the browser half)');
} else {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
  const ROUTES = { '/mfe/remoteEntry.js': 'mfe-remoteEntry.js', '/api/items': 'api-items.json', '/api/search': 'api-items.json' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = ROUTES[path] ? join(FIXTURE, ROUTES[path]) : join(FIXTURE, 'pages', path.replace(/^\//, ''));
    if (!file.startsWith(FIXTURE) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(ROUTES[path] || file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pages = readdirSync(join(FIXTURE, 'pages')).filter((f) => f.endsWith('.html')).sort();
  const out = mkdtempSync(join(tmpdir(), 'dynamics-recall-'));
  // async spawn: the fixture server lives in this process, so a blocking spawnSync would starve every page load
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [DETECT, '--urls', pages.map((p) => `${origin}/${p}`).join(','), '--out', out, '--reach', join(FIXTURE, 'sidecars'), '--offline', '--settle', '400'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stderr }); });
  });
  server.close();
  ok('depth: dynamics-detect.mjs exit 0', r.status === 0, r.status !== 0 ? (r.stderr || '').split('\n').slice(-6).join(' | ') : '');
  const report = existsSync(join(out, '_dynamics.json')) ? JSON.parse(readFileSync(join(out, '_dynamics.json'), 'utf8')) : { findings: [] };
  const depthRows = expected.filter((r) => r.via === 'depth');
  const findDepth = (row) => report.findings.find((f) => f.class === row.class && new RegExp(row.feature).test(f.feature) && (!row.page || f.pages.some((p) => p && p.endsWith(`/${row.page}`))));
  for (const row of depthRows) { const f = findDepth(row); ok(`depth: ${row.id}`, !!f, f ? `${f.class} "${f.feature}" on ${f.pages.length} page(s)` : `not detected on ${row.page}`); }
  recallTable('depth', depthRows, findDepth);
  for (const row of reachRows) {
    const f = report.findings.find((x) => x.class === row.class && new RegExp(row.feature).test(x.feature));
    const reachOk = !!f && !!f.reach && f.reach.pages >= (row.minPages || 1);
    const flagOk = !!f && ((f.hint === 'reach-only') === !!row.reachOnly);
    ok(`reach→report: ${row.id}`, reachOk && flagOk, f ? `reach ${f.reach ? `${f.reach.pages}/${f.reach.of}` : 'none'} · hint ${f.hint}${flagOk ? '' : ` (expected ${row.reachOnly ? '' : 'not '}reach-only)`}` : 'no finding');
  }
  const noise = report.findings.filter((f) => !expected.some((row) => row.class === f.class && new RegExp(row.feature).test(f.feature)));
  if (noise.length) console.log(`depth noise (informational, ${noise.length}): ${noise.map((f) => `${f.class} "${f.feature}"`).join(' · ')}`);
  if (KEEP) console.log(`kept ${out}`); else rmSync(out, { recursive: true, force: true });
}

if (failed) { console.error(`dynamics-recall: ${failed} check(s) failed`); process.exit(1); }
console.log(`dynamics-recall: all expected rows found${STATIC ? ' (reach + sidecar contract; depth not run — --static)' : ''}`);
