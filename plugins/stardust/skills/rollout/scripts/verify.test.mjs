#!/usr/bin/env node
// Fixture test: rollout/scripts/verify.mjs — the ledger contract and the runner-output contract.
//
//   A. Runner output (context-hygiene.md § Runner reports) on the shared post-migrate
//      fixture (evals/_shared/fixture-post-migrate), offline: --report <dir> writes
//      summary.json { total, checked, verified, failed, classes:[{ class, count,
//      worstExample, pointer }], pages[] } + summary.md (the ≤ 60-line table, then the
//      per-page rows per class — no third file); stdout is ≤ 60 lines and carries no
//      per-page ✗ row unless --verbose; every seeded defect class is ranked; the counts
//      on stdout equal the JSON.
//   B. Ledger semantics over a local HTTP server: --all skips never-delivered rows
//      (status untouched, one summary line) unless --include-undelivered; a link to a
//      coverage row not yet delivered is `pending-target` (page stays verified,
//      delivery.pendingLinks); a link outside coverage fails under the default
//      links.outsideInventory: fail and stays verified under warn (delivery.outsideLinks);
//      the fetched path is delivery.deployedPath when set and links to the source
//      path of such a row resolve; fragment rows skip the <h1> rule; index rows are
//      JSON-checked; siteBase never yields https://https://; a --slug run writes its
//      report under verify/slug-<s>/ and leaves the site-wide verify/summary.json intact;
//      a 429/503 is retried inline (Retry-After honoured) — a page recovering on the retry
//      is verified, a page still throttled is `unverified` (ledger status untouched) and
//      the run exits 2, never a failed page.
//   C. Project-copy layout: verify.mjs + lib.mjs copied to <tmp>/stardust/scripts/rollout/
//      run --help without the plugin tree; the class-report helper resolves from
//      stardust/scripts/stardust/ once copied there, and its absence is a clear exit 2.
//
// This test is the offline ledger fixture the T27.7 prescription named as
// `evals/rollout-verify-ledger/` — shipped as a fixture test chained into lint:stardust
// (B2 rule: every changed script ships one) instead of an LLM-judged eval directory.
//
// Usage: node plugins/stardust/skills/rollout/scripts/verify.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { siteBase } from './lib.mjs';

const HERE = import.meta.dirname;
const VERIFY = join(HERE, 'verify.mjs');
const INVENTORY = join(HERE, 'inventory.mjs');
const SHARED = join(HERE, '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate', 'stardust');
const run = (args) => spawnSync(process.execPath, [VERIFY, ...args], { encoding: 'utf8' });
// async variant for part B: the HTTP server lives in THIS process, so a blocking spawnSync would starve it
const runAsync = (args) => new Promise((ok) => {
  const c = spawn(process.execPath, [VERIFY, ...args]); let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => ok({ status, stdout, stderr }));
});
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lines = (s) => s.split('\n').filter((l) => l.length);

// ---- A. runner-output contract on the shared fixture ------------------------------
{
  const T = mkdtempSync(join(tmpdir(), 'verify-test-a-'));
  cpSync(SHARED, join(T, 'stardust'), { recursive: true });
  const MIG = join(T, 'stardust', 'migrated'); const OUT = join(T, 'stardust', 'rollout'); const REP = join(T, 'report');
  assert.equal(spawnSync(process.execPath, [INVENTORY, '--migrated', MIG, '--out', OUT], { encoding: 'utf8' }).status, 0, 'inventory runs on the shared fixture');

  // clean tree: every row verified, files written, nothing per page
  let r = run(['--root', MIG, '--all', '--out', OUT, '--report', REP]);
  assert.equal(r.status, 0, `clean fixture → exit 0\n${r.stderr}`);
  for (const f of ['summary.json', 'summary.md']) assert.ok(existsSync(join(REP, f)), `${f} written under --report`);
  assert.ok(!existsSync(join(REP, 'pages.md')), 'no third file: the per-page rows live in summary.md');
  let s = json(join(REP, 'summary.json'));
  assert.deepEqual([s.total, s.checked, s.verified, s.failed, s.classes], [6, 6, 6, 0, []], 'clean shape');
  assert.ok(lines(r.stdout).length <= 60 && !/✗/.test(r.stdout), 'stdout ≤ 60 lines, no ✗ rows');

  // seed three defect classes (the seeded eval's D1/D3/D4) and re-run
  const edit = (rel, fn) => { const p = join(MIG, rel); const t = readFileSync(p, 'utf8'); const o = fn(t); assert.notEqual(o, t, `seed anchor present in ${rel}`); writeFileSync(p, o); };
  for (const rel of ['index.html', 'business/index.html', 'insurance/home/index.html', 'insurance/auto/index.html', 'news/storm-season-checklist/index.html', 'news/annual-report-2025/index.html']) edit(rel, (t) => t.replace(/    <\/nav>\n  <\/footer>/, '      <a href="/claims/">File a claim</a>\n    </nav>\n  </footer>'));
  edit('news/annual-report-2025/index.html', (t) => t.replace(/<h2 data-slot="heading">([^<]*)<\/h2>/, '<h1 data-slot="heading">$1</h1>'));
  edit('business/index.html', (t) => t.replace(/(<p data-slot="copy">Commercial lines desk[^<]*<\/p>)/, '$1\n      <img src="about:error" alt="x" width="320" height="120">'));
  r = run(['--root', MIG, '--all', '--out', OUT, '--report', REP]);
  assert.equal(r.status, 1, 'seeded defects → exit 1');
  s = json(join(REP, 'summary.json'));
  assert.deepEqual([s.total, s.checked, s.verified, s.failed], [6, 6, 0, 6], 'every page fails on one class');
  const classes = s.classes.map((c) => c.class);
  assert.deepEqual(classes, ['outside-inventory link', 'about:error', 'h1 count'], `ranked by count, ties by name: ${classes}`);
  assert.deepEqual(s.classes.map((c) => c.count), [4, 1, 1], 'class counts (an earlier check masks the link on two pages)');
  for (const c of s.classes) {
    assert.ok(typeof c.worstExample === 'string' && / — /.test(c.worstExample), `${c.class}: worstExample = slug — reason`);
    assert.ok(c.pointer && c.pointer.startsWith(`${join(REP, 'summary.md')}#`), `${c.class}: pointer into summary.md#anchor`);
  }
  assert.ok(s.pages.length === 6 && s.pages.every((p) => p.slug && p.class), 'summary.json carries the per-page rows');
  const md = readFileSync(join(REP, 'summary.md'), 'utf8');
  const [top, perPage] = md.split('\n## Per-page rows\n');
  assert.ok(perPage, 'summary.md carries a Per-page rows section after the table');
  assert.ok(lines(top).length <= 64, `summary.md table block ≤ 60 lines + title (${lines(top).length})`);
  assert.ok(/\| outside-inventory link \| 4 \|/.test(top), 'summary.md ranks the class table');
  assert.ok(/### h1 count \(1\)\n\n- news__annual-report-2025/.test(perPage), 'summary.md lists the affected page under its class section');
  assert.ok(s.classes.find((c) => c.class === 'h1 count').pointer.endsWith('#h1-count-1'), 'the pointer anchor is the class section heading');
  const out = lines(r.stdout);
  assert.ok(out.length <= 60, `stdout ≤ 60 lines (${out.length})`);
  assert.ok(!/✗/.test(r.stdout), 'no per-page ✗ row on stdout by default');
  assert.ok(/Checked 6 · 0 verified · 6 failed/.test(r.stdout) && /\| outside-inventory link \| 4 \|/.test(r.stdout), 'stdout counts equal the JSON');
  r = run(['--root', MIG, '--all', '--out', OUT, '--report', REP, '--verbose']);
  assert.equal((r.stdout.match(/^ {2}✗ /gm) || []).length, 6, '--verbose prints the per-page ✗ rows');
  assert.ok(!existsSync(join(OUT, 'verify')), '--report overrides the default <out>/verify/');
  rmSync(T, { recursive: true, force: true });
}

// ---- B. ledger semantics over HTTP ------------------------------------------------
{
  const pagesHtml = {
    '/a': '<html><body><main><h1>A</h1><a href="/b">b</a> <a href="/outside">x</a> <a href="/old.jsp">f</a> <a href="/nav">n</a></main></body></html>',
    '/new': '<html><body><main><h1>F</h1></main></body></html>',
    '/nav': '<html><body><ul><li><a href="/a">A</a></li></ul></body></html>',
    '/query-index.json': '{"total":0,"data":[]}',
  };
  let hits503 = 0;
  const srv = createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/t429') { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); }
    else if (p === '/t503' && hits503++ < 1) { res.writeHead(503, { 'retry-after': '0' }); res.end('busy'); }
    else if (p === '/t503') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><main><h1>T</h1></main></body></html>'); }
    else if (pagesHtml[p]) { res.writeHead(200, { 'content-type': p.endsWith('.json') ? 'application/json' : 'text/html' }); res.end(pagesHtml[p]); }
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const T = mkdtempSync(join(tmpdir(), 'verify-test-b-'));
  const OUT = join(T, 'rollout');
  const row = (slug, path, status, extra = {}) => ({ slug, path, title: slug, templateId: 't', source: { migratedHtml: null, metaJson: null, sourceHash: 'sha256:0' }, blocks: [], delivery: { status, deployedUrl: null, deployedAt: null, verifiedAt: null, error: null, ...extra } });
  const seed = (links) => {
    rmSync(OUT, { recursive: true, force: true }); mkdirSync(join(OUT, 'coverage'), { recursive: true });
    writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ pages: [
      row('a', '/a', 'deployed'), row('b', '/b', 'pending'), row('c', '/c', 'content-pending'), row('d', '/d', 'converting'),
      row('f', '/old.jsp', 'deployed', { deployedPath: '/new' }),
      row('chrome-nav', '/nav', 'deployed', { type: 'fragment' }), row('index-query-index', '/query-index.json', 'deployed', { type: 'index' }),
    ] }));
    writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { liveHost: 'https://main--x--y.aem.live/' }, links, lastRun: {} }));
  };
  const status = (slug) => json(join(OUT, 'coverage', 'pages.json')).pages.find((p) => p.slug === slug).delivery;

  // default policy (fail): outside link fails A; never-delivered rows untouched under --all
  seed(undefined);
  let r = await runAsync(['--base', BASE, '--all', '--out', OUT]);
  assert.equal(r.status, 1, 'outside-inventory link under fail → exit 1');
  assert.equal(status('a').status, 'failed'); assert.match(status('a').error, /broken internal links: \/outside$/, 'only the outside target is broken (pending + deployedPath source resolve)');
  assert.deepEqual(status('a').pendingLinks, ['/b'], 'pending-target recorded even when the page fails');
  assert.deepEqual([status('b').status, status('c').status, status('d').status], ['pending', 'content-pending', 'converting'], 'never-delivered rows are not written');
  assert.ok([status('b'), status('c'), status('d')].every((d) => d.error === null), 'no error on skipped rows');
  assert.match(r.stdout, /not delivered: 3 \(skipped\)/, 'one summary line for the skipped rows');
  assert.equal(status('f').status, 'verified', 'row fetched at delivery.deployedPath');
  assert.equal(status('chrome-nav').status, 'verified', 'fragment row skips the <h1> rule');
  assert.equal(status('index-query-index').status, 'verified', 'index row is JSON-checked');
  assert.match(r.stdout, /Checked 4 · 3 verified · 1 failed · types: page:2 fragment:1 index:1/, 'counts + type distribution');
  const sj = json(join(OUT, 'verify', 'summary.json'));
  assert.equal(sj.skipped, 3); assert.equal(sj.classes[0].class, 'outside-inventory link');
  assert.ok(sj.classes.some((c) => c.class === 'pending-target link' && c.severity === 'info'), 'pending-target is an advisory class in the report');
  // defect 7: one pages[] entry per slug — a failed page with a pending-target advisory used to appear twice
  assert.equal(new Set(sj.pages.map((p) => p.slug)).size, sj.pages.length, `summary.json.pages[] lists every slug once (${sj.pages.map((p) => p.slug)})`);
  const aRow = sj.pages.find((p) => p.slug === 'a');
  assert.deepEqual([aRow.status, aRow.class, aRow.advisories.map((x) => x.class)], ['failed', 'outside-inventory link', ['pending-target link']], 'the failure is the row class; the advisory rides on advisories[]');

  // warn policy: A stays verified, both link lists recorded, exit 0
  seed({ outsideInventory: 'warn' });
  r = await runAsync(['--base', BASE, '--all', '--out', OUT]);
  assert.equal(r.status, 0, 'outside-inventory link under warn → exit 0');
  assert.equal(status('a').status, 'verified');
  assert.deepEqual([status('a').pendingLinks, status('a').outsideLinks], [['/b'], ['/outside']], 'pendingLinks + outsideLinks recorded');
  assert.match(r.stdout, /pending-target links: 1 page\(s\)/); assert.match(r.stdout, /outside-inventory links: 1 page\(s\) \(links.outsideInventory: warn\)/);
  const wj = json(join(OUT, 'verify', 'summary.json')); const aWarn = wj.pages.find((p) => p.slug === 'a');
  assert.equal(wj.pages.filter((p) => p.slug === 'a').length, 1, 'a verified page with two advisories is one pages[] row');
  assert.deepEqual([aWarn.status, aWarn.class, aWarn.severity, aWarn.advisories.length], ['verified', 'pending-target link', 'info', 2], 'no failure → the first advisory is the row class, both advisories listed');

  // --include-undelivered restores the probe of never-delivered rows (404 → failed)
  seed({ outsideInventory: 'warn' });
  r = await runAsync(['--base', BASE, '--all', '--include-undelivered', '--out', OUT]);
  assert.equal(r.status, 1); assert.equal(status('b').status, 'failed'); assert.equal(status('b').error, 'HTTP 404');
  // defect 7: the line must count the undelivered rows that were probed, not print `skipped 0`
  assert.match(r.stdout, /not delivered: 3 \(probed — --include-undelivered\)/, 'the summary line counts the probed undelivered rows');
  assert.doesNotMatch(r.stdout, /skipped 0/, 'no `skipped 0` under --include-undelivered');
  const uj = json(join(OUT, 'verify', 'summary.json'));
  assert.deepEqual([uj.skipped, uj.undelivered, uj.checked], [0, 3, 7], 'summary.json: skipped 0, undelivered 3, all seven rows checked');

  // --slug targets any row regardless of status
  seed({ outsideInventory: 'warn' });
  await runAsync(['--base', BASE, '--all', '--out', OUT]);
  const siteWide = json(join(OUT, 'verify', 'summary.json')).checked;
  assert.equal(siteWide, 4, 'site-wide run before the spot check');
  r = await runAsync(['--base', BASE, '--slug', 'c', '--out', OUT]);
  assert.equal(status('c').status, 'failed', '--slug probes a content-pending row on request');
  assert.equal(json(join(OUT, 'verify', 'slug-c', 'summary.json')).checked, 1, '--slug reports under verify/slug-<s>/');
  assert.equal(json(join(OUT, 'verify', 'summary.json')).checked, siteWide, 'a --slug re-check leaves the site-wide summary.json untouched');

  // throttling: 503-then-200 recovers on the inline retry; a persistent 429 is `unverified`
  // (ledger status untouched, no error written), reported once, exit 2 — not a failed page
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(join(OUT, 'coverage'), { recursive: true });
  writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ pages: [row('t429', '/t429', 'deployed'), row('t503', '/t503', 'deployed'), row('new', '/new', 'deployed')] }));
  writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { liveHost: 'https://main--x--y.aem.live/' }, lastRun: {} }));
  r = await runAsync(['--base', BASE, '--out', OUT]);
  assert.equal(r.status, 2, `a throttled page → exit 2 (no verdict)\n${r.stderr}`);
  assert.equal(hits503, 2, 'the 503 page was fetched twice: 503, then 200 on the inline retry');
  assert.deepEqual([status('t503').status, status('new').status], ['verified', 'verified'], '503 → 200 on the retry is verified');
  assert.deepEqual([status('t429').status, status('t429').error, status('t429').verifiedAt], ['deployed', null, null], 'a still-throttled row keeps its ledger status, no error written');
  assert.match(r.stdout, /Checked 2 · 2 verified · 0 failed/, 'the throttled page is not counted as checked, verified or failed');
  assert.match(r.stdout, /unverified: 1 page\(s\) throttled/, 'one summary line for the throttled rows');
  const tj = json(join(OUT, 'verify', 'summary.json'));
  assert.equal(tj.unverified, 1); assert.ok(tj.classes.some((c) => c.class === 'throttled (429/503)' && c.severity === 'warn'), 'throttled is a warn class in the report');
  assert.ok(tj.pages.some((p) => p.slug === 't429' && p.status === 'unverified'), 'summary.json carries the unverified row');

  // usage errors
  seed(undefined); rmSync(join(OUT, 'rollout.json'));
  assert.equal((await runAsync(['--all', '--out', OUT])).status, 2, 'no base/root → exit 2');
  assert.equal((await runAsync(['--base', BASE, '--out', join(T, 'nowhere')])).status, 2, 'coverage missing → exit 2');
  assert.equal((await runAsync(['--help'])).status, 0, '--help exits 0');

  srv.close();
  rmSync(T, { recursive: true, force: true });
}

// ---- C. project-copy layout: stardust/scripts/rollout/ + stardust/scripts/stardust/ -----
{
  const T = mkdtempSync(join(tmpdir(), 'verify-test-c-'));
  const ROLLOUT = join(T, 'stardust', 'scripts', 'rollout'); mkdirSync(ROLLOUT, { recursive: true });
  for (const f of ['verify.mjs', 'lib.mjs']) cpSync(join(HERE, f), join(ROLLOUT, f));
  const copy = (args) => spawnSync(process.execPath, [join(ROLLOUT, 'verify.mjs'), ...args], { encoding: 'utf8', cwd: T });
  assert.equal(copy(['--help']).status, 0, 'project copy: --help works without the plugin tree');
  let r = copy(['--base', 'http://127.0.0.1:9', '--out', join(T, 'nowhere')]);
  assert.equal(r.status, 2); assert.match(r.stderr, /class-report\.mjs not found/, 'project copy without the helper → clear exit 2');
  mkdirSync(join(T, 'stardust', 'scripts', 'stardust'), { recursive: true });
  cpSync(join(HERE, '..', '..', 'stardust', 'scripts', 'class-report.mjs'), join(T, 'stardust', 'scripts', 'stardust', 'class-report.mjs'));
  r = copy(['--base', 'http://127.0.0.1:9', '--out', join(T, 'nowhere')]);
  assert.equal(r.status, 2); assert.match(r.stderr, /run inventory\.mjs first/, 'project copy resolves the helper from stardust/scripts/stardust/');
  rmSync(T, { recursive: true, force: true });
}

// ---- siteBase: one helper, no https://https:// ------------------------------------
assert.equal(siteBase({ site: { liveHost: 'https://main--x--y.aem.live/' } }), 'https://main--x--y.aem.live');
assert.equal(siteBase({ site: { liveHost: 'main--x--y.aem.live' } }), 'https://main--x--y.aem.live');
assert.equal(siteBase({ site: { liveHost: 'http://main--x--y.aem.page' } }), 'https://main--x--y.aem.page', 'scheme is stripped, https re-applied');
assert.equal(siteBase({ site: { liveHost: 'main--x--y.aem.live' } }, 'http://127.0.0.1:9/'), 'http://127.0.0.1:9', '--base override wins verbatim (trailing slash stripped)');
assert.equal(siteBase({}), null);

console.log('verify.test: ok (runner-output contract on the shared fixture; --all guard, link classes, deployedPath, typed rows, --slug report dir, 429/503 retry → unverified/exit 2, project-copy layout, siteBase)');
