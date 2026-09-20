#!/usr/bin/env node
// Fixture test: crawl.mjs completion contract (T01.2 — progress file + one SUMMARY line).
//   parser   `--progress <file>` / `--no-progress` parse; the default is
//            <out>/../.work/extract/crawl.progress.json (the run-only write boundary),
//            so the default `--out stardust/current` lands on stardust/.work/extract/.
//            (Before the fix parseArgs threw `unknown arg: --progress`.)
//   helper   loadProgressHelper resolves skills/stardust/scripts/progress.mjs from the
//            plugin tree (createProgress + summaryLine exported).
//   e2e      when playwright resolves (repo-root node_modules or STARDUST_GATE_DEPS): a
//            local one-page site crawled with --single writes the progress file
//            (driver crawl, done 1, ok 1) and ends stdout with `SUMMARY crawl ok=1
//            failed=0 exit=0 details=<_crawl-log.json> …`; without playwright one SKIP line.
// Runs without playwright: crawl.mjs imports it lazily inside main().
// Usage: node plugins/stardust/evals/fixtures/crawl-progress.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, crawlProgressFile, loadProgressHelper } from '../../skills/extract/scripts/crawl.mjs';

const CRAWL = resolve(import.meta.dirname, '..', '..', 'skills', 'extract', 'scripts', 'crawl.mjs');
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

// parser + default path
let a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/']);
assert.equal(a.progress, resolve('stardust', 'current', '..', '.work', 'extract', 'crawl.progress.json'), 'default progress file under stardust/.work/extract/');
assert.ok(a.progress.endsWith(['stardust', '.work', 'extract', 'crawl.progress.json'].join(sep)));
a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--out', '/tmp/site/current']);
assert.equal(a.progress, resolve('/tmp/site/.work/extract/crawl.progress.json'), '--out moves the .work root with it');
assert.equal(crawlProgressFile({ out: '/tmp/site/current' }), resolve('/tmp/site/.work/extract/crawl.progress.json'));
a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--progress', '/tmp/p.json']);
assert.equal(a.progress, '/tmp/p.json', '--progress overrides');
a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--no-progress']);
assert.equal(a.progress, null, '--no-progress disables the file');
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--progres']), /unknown arg/);
// a value-taking flag never swallows the next flag (`--cap --all` once crawled 5 pages silently)
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--cap', '--all']), /--cap needs a value/);
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--concurrency', '--dynamics']), /--concurrency needs a value/);
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--pages']), /--pages needs a value/);
// --solve-wait starts at tier 3 whatever the order of --headed; runs[].args keeps the CLI concurrency
a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--solve-wait', '6000', '--headed', '--concurrency', '4']);
assert.equal(a.headed, 3, '--solve-wait <ms> --headed (that order) still starts at tier 3, window visible');
assert.equal(a.concurrencyRequested, 4, 'the CLI concurrency is kept apart from the run-time pool size (a bare 429 drops the latter to 1)');

// helper resolution from the plugin tree
const helper = await loadProgressHelper();
assert.equal(typeof helper.createProgress, 'function'); assert.equal(typeof helper.summaryLine, 'function');
assert.equal(helper.summaryLine({ driver: 'crawl', ok: 1, exit: 0, details: 'x' }), 'SUMMARY crawl ok=1 failed=0 exit=0 details=x');

// e2e — browser-dependent, self-skips
const deps = process.env.STARDUST_GATE_DEPS || join(REPO_ROOT, 'node_modules');
let pwOk = false;
try { createRequire(join(deps, 'x.js')).resolve('playwright'); pwOk = true; } catch { /* absent */ }
if (!pwOk) {
  console.log(`crawl-progress test: ok (parser + default path + helper); SKIP e2e — playwright not resolvable from ${deps} (set STARDUST_GATE_DEPS=<dir>/node_modules)`);
  process.exit(0);
}
// ESM `import('playwright')` resolves from the importing file, not NODE_PATH: run a copy of
// crawl.mjs + progress.mjs in a plugin-shaped temp tree whose node_modules links to the deps.
// realpath: crawl.mjs runs main() only when argv[1] resolves to its own import.meta.url, and
// Node realpaths the entry (macOS /var → /private/var) while path.resolve does not
const work = realpathSync(mkdtempSync(join(tmpdir(), 'crawl-progress-')));
mkdirSync(join(work, 'skills', 'extract', 'scripts'), { recursive: true });
mkdirSync(join(work, 'skills', 'stardust', 'scripts'), { recursive: true });
cpSync(CRAWL, join(work, 'skills', 'extract', 'scripts', 'crawl.mjs'));
cpSync(resolve(import.meta.dirname, '..', '..', 'skills', 'stardust', 'scripts', 'progress.mjs'), join(work, 'skills', 'stardust', 'scripts', 'progress.mjs'));
symlinkSync(deps, join(work, 'node_modules'));
const CRAWL_COPY = join(work, 'skills', 'extract', 'scripts', 'crawl.mjs');
const html = '<!doctype html><html><head><title>Fixture</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Fixture page</h1><p>' + 'Enough body text to pass the substance check. '.repeat(40) + '</p><h2>Second heading</h2><p>More words here so the page is not an SPA shell.</p></main><footer>f</footer></body></html>';
const server = createServer((q, r) => { if (q.url === '/robots.txt') { r.statusCode = 404; return r.end(); } r.setHeader('content-type', 'text/html'); r.end(html); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const out = join(work, 'stardust', 'current');
  const r = await new Promise((ok) => {
    const c = spawn(process.execPath, [CRAWL_COPY, '--url', `${origin}/`, '--single', '--out', out, '--mobile', 'none', '--no-consent-dismiss', '--wait', 'fast'], { cwd: work, env: { ...process.env, STARDUST_LIVE_FORCE: '1' } });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => ok({ status, stdout, stderr }));
  });
  assert.equal(r.status, 0, `crawl exit 0\n${r.stderr.slice(-2000)}`);
  const last = r.stdout.trim().split('\n').at(-1);
  assert.match(last, /^SUMMARY crawl ok=1 failed=0 exit=0 details=.*_crawl-log\.json discovered=\d+ skipped=0 technique=\S+ openFailures=0$/, `SUMMARY is the last stdout line: ${JSON.stringify(last)}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr.slice(-1500)}`);
  const pf = join(work, 'stardust', '.work', 'extract', 'crawl.progress.json');
  assert.ok(existsSync(pf), 'progress file written under stardust/.work/extract/');
  const p = JSON.parse(readFileSync(pf, 'utf8'));
  assert.deepEqual([p.driver, p.total, p.done, p.ok, p.failed, p.lastPath], ['crawl', 1, 1, 1, 0, 'index'], 'progress counts');
  console.log('crawl-progress test: ok (parser + default path + helper + e2e progress file and SUMMARY line)');
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
