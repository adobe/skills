#!/usr/bin/env node
// skills/diff/scripts/test/visual-diff.test.mjs — visual-diff.mjs: --help in an empty cwd (no playwright needed, nothing
// written), importing the module starts no probe, liveCacheKey (the --live-cache key); then end-to-end against two fixture
// pages served from a temp dir: --live-cache writes the source side's metrics + screenshots once, a second run with another
// --out makes no source request, copies the source screenshots and prints the same red flags; a missing cached screenshot
// is named; a blank source render is never cached. The end-to-end part runs where playwright is importable and prints a
// skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCacheKey } from '../visual-diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'visual-diff.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// ---- cli + module ----------------------------------------------------------------------------------
await check('--help: exit 0, usage on stdout naming --live-cache, nothing written in an empty cwd; two missing args → usage on stderr, exit 1', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'visual-diff-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
  const wrote = readdirSync(cwd); rmSync(cwd, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^usage: node skills\/diff\/scripts\/visual-diff\.mjs/); assert.deepEqual(wrote, []);
  assert.match(r.stdout, /--live-cache <f>/); assert.match(r.stdout, /visual-live\.json/);
  const u = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 15000 });
  assert.equal(u.status, 1); assert.match(u.stderr, /^usage:/);
});
await check('importing the module starts no probe (main-module guard; playwright imported lazily)', () => {
  assert.equal(typeof liveCacheKey, 'function');
});

// ---- pure: the live-side cache key ------------------------------------------------------------------
await check('liveCacheKey: source URL, width, --main, --sections, profile, UA, locale, wait state, dismiss set, tier — each changes it; --out does not', () => {
  const opts = { out: 'a', width: 1440, main: null, sections: [], profile: 'generic', ua: 'UA', locale: null, waitUntil: null, dismiss: [], headed: false };
  const k = liveCacheKey('https://s.example/', opts);
  assert.deepEqual(k, { url: 'https://s.example/', width: 1440, main: null, sections: [], profile: 'generic', ua: 'UA', locale: null, waitUntil: null, dismiss: [], headed: false });
  assert.deepEqual(liveCacheKey('https://s.example/', { ...opts, out: 'b' }), k, '--out is where the copies land, not part of the key');
  for (const [field, v] of [['width', 360], ['main', '#content'], ['sections', ['.hero']], ['profile', 'eds'], ['locale', 'de-DE'], ['waitUntil', 'load'], ['dismiss', ['.promo-close']], ['dismiss', null], ['headed', true]]) {
    assert.notDeepEqual(liveCacheKey('https://s.example/', { ...opts, [field]: v }), k, field);
  }
  assert.notDeepEqual(liveCacheKey('https://s.example/other', opts), k, 'url');
});

// ---- end-to-end against two fixture pages (needs playwright) -------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end visual-diff (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>main{max-width:900px;margin:0 auto;padding:24px}</style></head><body><main>${body}</main></body></html>`;
  const h2s = (n) => Array.from({ length: n }, (_, i) => `<section class="band"><h2>Topic ${i + 1}</h2><p>Some body copy for topic ${i + 1}, long enough to read as text.</p></section>`).join('');
  const pages = { '/source.html': page(`<h1>Welcome</h1>${h2s(6)}`), '/build.html': page(`<h1>Welcome</h1>${h2s(1)}`), '/blank.html': page('') };
  const hits = {};
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0]; hits[path] = (hits[path] || 0) + 1;
    if (!pages[path]) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(pages[path]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'visual-diff-cache-')));
  const cacheFile = join(tmp, 'vd.json');
  const run = (out, src = 'source', cache = cacheFile) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, `${base}/${src}.html`, `${base}/build.html`, '--profile', 'generic', '--sections', '.band,.absent', '--out', join(tmp, out), '--live-cache', cache], { cwd: tmp, env: { ...process.env, STARDUST_ORIGIN_MAX_AGE_H: '1' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const flagLines = (s) => s.split('\n').filter((l) => /^ {2}• /.test(l));
  const metricsJson = (s) => JSON.parse(s.slice(s.indexOf('\n', s.indexOf('Full metrics JSON')) + 1));
  let first;
  await check('e2e --live-cache: run 1 probes both sides, writes the cache (metrics, out dir, the source screenshot list) and records the miss', async () => {
    first = await run('v1');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(hits['/source.html'], 1); assert.equal(hits['/build.html'], 1);
    assert.match(first.stdout, new RegExp(`^source side probed \\(cache: absent\\) → ${cacheFile}$`, 'm'), first.stdout);
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    assert.equal(c.writtenBy, 'visual-diff.mjs'); assert.equal(c.data.outDir, join(tmp, 'v1')); assert.deepEqual(c.data.shots, ['proto-full.png', 'proto-band.png'], 'the section shots that were taken');
    assert.equal(c.data.metrics.headings.length, 7);
    assert.ok(flagLines(first.stdout).some((l) => /CONTENT GAP/.test(l)), first.stdout);
    const lc = metricsJson(first.stdout).liveCache;
    assert.equal(lc.hit, false); assert.equal(lc.at, c.at); assert.equal(lc.reason, 'absent');
  });
  await check('e2e --live-cache: run 2 (another --out) makes no source request, copies the source screenshots, re-measures the build and prints the same red flags', async () => {
    const r = await run('v2');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(hits['/source.html'], 1, 'no source navigation'); assert.equal(hits['/build.html'], 2, 'the build side is always re-measured');
    assert.deepEqual(readdirSync(join(tmp, 'v2')).sort(), ['eds-band.png', 'eds-full.png', 'proto-band.png', 'proto-full.png']);
    assert.deepEqual(flagLines(r.stdout), flagLines(first.stdout));
    const { at } = JSON.parse(readFileSync(cacheFile, 'utf8'));
    assert.match(r.stdout, new RegExp(`^source side from cache ${cacheFile} \\(probed ${at}, max-age 1h\\)$`, 'm'), r.stdout);
    assert.deepEqual(metricsJson(r.stdout).liveCache, { file: cacheFile, hit: true, at, policy: 'max-age 1h' });
  });
  await check('e2e --live-cache: a cached screenshot that is gone is named on stdout; the metrics are still reused', async () => {
    unlinkSync(join(tmp, 'v1', 'proto-full.png'));
    const r = await run('v3');
    assert.equal(r.status, 0, r.stderr); assert.equal(hits['/source.html'], 1);
    assert.match(r.stdout, new RegExp(`^ {2}source screenshot\\(s\\) not found in ${join(tmp, 'v1')}: proto-full\\.png$`, 'm'), r.stdout);
    assert.deepEqual(flagLines(r.stdout), flagLines(first.stdout));
  });
  await check('e2e --live-cache: a blank source render (BLANK RENDER on the source metrics) is measured but never cached — the next run captures it again', async () => {
    const blankCache = join(tmp, 'blank.json');
    let r = await run('b1', 'blank', blankCache);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^source side probed \(cache: absent\) — not cached \(blank render\)$/m, r.stdout);
    assert.equal(existsSync(blankCache), false); assert.equal(metricsJson(r.stdout).source.blankRender, true);
    r = await run('b2', 'blank', blankCache);
    assert.equal(r.status, 0, r.stderr); assert.equal(hits['/blank.html'], 2);
  });
  rmSync(tmp, { recursive: true, force: true });
  server.close();
}

console.log(failed ? `\n${failed} failing` : '\nvisual-diff: all checks passed');
process.exit(failed ? 1 : 0);
