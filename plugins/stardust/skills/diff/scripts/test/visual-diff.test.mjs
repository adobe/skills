#!/usr/bin/env node
// skills/diff/scripts/test/visual-diff.test.mjs — visual-diff.mjs: --help in an empty cwd (no playwright needed, nothing
// written), importing the module starts no probe, liveCacheKey (the --live-cache key), gotoTimeoutMs (the shared goto
// timeout; an older live-session.mjs keeps 60000); then end-to-end against two fixture
// pages served from a temp dir: --live-cache writes the source side's metrics + screenshots once, a second run with another
// --out makes no source request, copies the source screenshots and prints the same red flags; a missing cached screenshot
// is named; a blank source render is never cached. --hide: parseArgs (repeatable comma lists; a missing value is a usage
// error), liveCacheKey gains the list only when set; e2e: an 88 px in-flow .geo-bar on the source only — with --hide the
// hidden lines are printed and the source screenshot is 88 px shorter, the cache keeps the records and is keyed on the
// list. The end-to-end part runs where playwright is importable and prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoTimeoutMs, liveCacheKey, parseArgs } from '../visual-diff.mjs';

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
await check('--hide: repeatable comma lists, trimmed, de-duplicated (default none), named in --help; liveCacheKey gains `hide` only when set; a missing value is a usage error', () => {
  const argv = (...a) => ['node', 'x', 'https://s.example/', 'https://b.example/', ...a];
  assert.deepEqual(parseArgs(argv()).opts.hide, []);
  const { opts } = parseArgs(argv('--hide', '.geo-bar, .location-bar', '--width', '360', '--hide', '.location-bar,,.promo-strip'));
  assert.deepEqual(opts.hide, ['.geo-bar', '.location-bar', '.promo-strip']); assert.equal(opts.width, 360);
  const base = { out: 'a', width: 1440, main: null, sections: [], profile: 'generic', ua: 'UA', locale: null, waitUntil: null, dismiss: [], headed: false };
  const k = liveCacheKey('https://s.example/', base);
  assert.deepEqual(liveCacheKey('https://s.example/', { ...base, hide: [] }), k, 'an empty list keys like none');
  assert.deepEqual(liveCacheKey('https://s.example/', { ...base, hide: ['.geo-bar'] }), { ...k, hide: ['.geo-bar'] });
  for (const tail of [['--hide'], ['--hide', '--headed']]) {
    const r = spawnSync(process.execPath, [SCRIPT, 'https://s.example/', 'https://b.example/', ...tail], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1, tail.join(' ')); assert.match(r.stderr, /^visual-diff: --hide needs a selector list\nusage:/);
  }
  assert.match(spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' }).stdout, /^ {2}--hide <sel,…> /m);
});

// ---- pure: the goto timeout ---------------------------------------------------------------------------
await check('gotoTimeoutMs: by default live-session\'s resolveNavTimeoutMs with fallback 60000; a live-session.mjs without it (an older copy) — no throw, 60000, ONE stderr line per process', async () => {
  const live = await import('../live-session.mjs');
  assert.equal(gotoTimeoutMs(), live.resolveNavTimeoutMs({ fallback: 60000 }), 'the default session is the sibling live-session.mjs');
  const asked = [];
  assert.equal(gotoTimeoutMs({ resolveNavTimeoutMs: (o) => { asked.push(o); return 84000; } }), 84000); assert.deepEqual(asked, [{ fallback: 60000 }]);
  const lines = []; const { write } = process.stderr;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let stale;
  try { stale = [gotoTimeoutMs({ gotoLive() {} }), gotoTimeoutMs({})]; } finally { process.stderr.write = write; }
  assert.deepEqual(stale, [60000, 60000]);
  assert.equal(lines.length, 1, lines.join(''));
  assert.match(lines[0], /^visual-diff: live-session\.mjs predates navTimeout — goto timeout 60000 ms; STARDUST_NAV_TIMEOUT_MS and the crawl figure are not read/);
});

// ---- end-to-end against two fixture pages (needs playwright) -------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end visual-diff (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>main{max-width:900px;margin:0 auto;padding:24px}</style></head><body><main>${body}</main></body></html>`;
  const h2s = (n) => Array.from({ length: n }, (_, i) => `<section class="band"><h2>Topic ${i + 1}</h2><p>Some body copy for topic ${i + 1}, long enough to read as text.</p></section>`).join('');
  // an 88 px in-flow per-visitor bar above the content on the source only
  const geo = (bar) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0} main{max-width:900px;margin:0 auto;padding:24px;min-height:1500px}</style></head><body>${bar ? '<div class="geo-bar" style="height:88px;background:#eee">Your region: <a href="/r">switch</a></div>' : ''}<main><h1>Welcome</h1>${h2s(2)}</main></body></html>`;
  const pages = { '/source.html': page(`<h1>Welcome</h1>${h2s(6)}`), '/build.html': page(`<h1>Welcome</h1>${h2s(1)}`), '/blank.html': page(''), '/geo-source.html': geo(true), '/geo-build.html': geo(false) };
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
  const runGeo = (out, extra = []) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, `${base}/geo-source.html`, `${base}/geo-build.html`, '--profile', 'generic', '--out', join(tmp, out), ...extra], { cwd: tmp, env: { ...process.env, STARDUST_ORIGIN_MAX_AGE_H: '1' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const pngH = (f) => readFileSync(f).readUInt32BE(20); // IHDR height
  const HIDDEN = /^ {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[--hide\]\n {2}hidden build: \.geo-bar ×0 \[--hide\]$/m;
  const RECORDS = { live: [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }], build: [{ sel: '.geo-bar', source: '--hide', n: 0, h: 0 }] };
  const geoCache = join(tmp, 'geo.json');
  await check('e2e --hide: the hidden lines follow the header, the JSON carries hidden { live, build }, and the source screenshot is 88 px shorter than without --hide (no lines, no key)', async () => {
    const without = await runGeo('g0');
    assert.equal(without.status, 0, without.stderr); assert.doesNotMatch(without.stdout, /hidden (live|build):/); assert.equal('hidden' in metricsJson(without.stdout), false);
    const r = await runGeo('g1', ['--hide', '.geo-bar', '--live-cache', geoCache]);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, HIDDEN, r.stdout);
    assert.ok(r.stdout.indexOf('hidden live:') > r.stdout.indexOf('Visual diff @') && r.stdout.indexOf('hidden live:') < r.stdout.indexOf('red flags'), 'in the header block');
    assert.deepEqual(metricsJson(r.stdout).hidden, RECORDS);
    assert.equal(pngH(join(tmp, 'g0', 'proto-full.png')) - pngH(join(tmp, 'g1', 'proto-full.png')), 88, 'the bar is gone from the source capture');
    assert.equal(pngH(join(tmp, 'g0', 'eds-full.png')), pngH(join(tmp, 'g1', 'eds-full.png')), 'the build has nothing to hide');
    const c = JSON.parse(readFileSync(geoCache, 'utf8'));
    assert.deepEqual(c.key.hide, ['.geo-bar'], 'the live cache is keyed on the list'); assert.deepEqual(c.data.hidden, RECORDS.live, 'and keeps the records');
  });
  await check('e2e --hide + --live-cache: the same list reuses the source (no request) and prints the cached records; no --hide is a key mismatch and probes again', async () => {
    const n = hits['/geo-source.html'];
    const r = await runGeo('g2', ['--hide', '.geo-bar', '--live-cache', geoCache]);
    assert.equal(r.status, 0, r.stderr); assert.equal(hits['/geo-source.html'], n, 'no source navigation');
    assert.match(r.stdout, /^source side from cache /m); assert.match(r.stdout, HIDDEN, r.stdout); assert.deepEqual(metricsJson(r.stdout).hidden, RECORDS);
    const r2 = await runGeo('g3', ['--live-cache', geoCache]);
    assert.equal(r2.status, 0, r2.stderr); assert.equal(hits['/geo-source.html'], n + 1);
    assert.match(r2.stdout, /^source side probed \(cache: key mismatch \(hide\)\)/m, r2.stdout); assert.doesNotMatch(r2.stdout, /hidden live:/);
  });
  rmSync(tmp, { recursive: true, force: true });
  server.close();
}

console.log(failed ? `\n${failed} failing` : '\nvisual-diff: all checks passed');
process.exit(failed ? 1 : 0);
