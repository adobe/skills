#!/usr/bin/env node
// Fixture test: crawl.mjs asset harvest (--assets intercept|full|none; extract/SKILL.md
// § Phase 2, current-state-schema.md § Media `localPath`).
//   pure exports (no browser): stripCdnParams keeps unknown DAM params and drops transform
//   params; sniffMime by magic bytes with a URL-extension mismatch flag; assetPath =
//   <basename>-<sha1:8>.<sniffed ext> (identical bytes → identical path); mergeManifest keeps
//   successes, replaces a downloadError on success, never drops a URL; licensingFlagFor;
//   fullAssetCandidates; buildFontsManifest matches @font-face descriptors and folds iconFonts.
//   e2e (browser-dependent, self-skips with a SKIP line, exit 0): a copy of crawl.mjs crawls the
//   local fixture page — assets/media + assets/fonts written from the render's own responses,
//   images[].localPath | downloadError stamped, manifests + favicon-set.json present,
//   the page hit once, no source-origin request beyond the render's own.
// Usage: node plugins/stardust/evals/fixtures/crawl-assets.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { stripCdnParams, sniffMime, assetPath, mergeManifest, licensingFlagFor, fullAssetCandidates, buildFontsManifest, FONT_URL_RE, parseArgs } from '../../skills/extract/scripts/crawl.mjs';

// ---- pure ----
assert.equal(stripCdnParams('https://cdn.example/a/b.png?quality=85&fit=bounds&format=jpg'), 'https://cdn.example/a/b.png', 'transform params dropped');
assert.equal(stripCdnParams('https://cdn.example/connect/9f/hero.jpg?MOD=AJPERES&CACHEID=abc&w=600'), 'https://cdn.example/connect/9f/hero.jpg?MOD=AJPERES&CACHEID=abc', 'unknown DAM params kept (stripping them 404s), width dropped');
assert.equal(stripCdnParams('https://x.example/i.png'), 'https://x.example/i.png'); assert.equal(stripCdnParams('not a url'), 'not a url');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(12, 1)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
assert.deepEqual(sniffMime(PNG, 'https://x/a.png'), { ext: 'png', mime: 'image/png', mismatch: false });
assert.deepEqual(sniffMime(JPG, 'https://x/a.png?format=jpg'), { ext: 'jpg', mime: 'image/jpeg', mismatch: true }, 'JPEG bytes behind a .png URL → transformSuspect');
assert.deepEqual(sniffMime(WOFF2, 'https://x/f.woff2'), { ext: 'woff2', mime: 'font/woff2', mismatch: false });
assert.deepEqual(sniffMime(SVG, 'https://x/logo.svg'), { ext: 'svg', mime: 'image/svg+xml', mismatch: false });
assert.deepEqual(sniffMime(SVG, 'https://x/wordmark.png', 'image/svg+xml'), { ext: 'svg', mime: 'image/svg+xml', mismatch: true });
assert.deepEqual(sniffMime(Buffer.from('nope'), 'https://x/a', 'image/webp'), { ext: 'webp', mime: 'image/webp', mismatch: false }, 'no magic → content-type ext');
assert.deepEqual(sniffMime(Buffer.alloc(0), 'https://x/a.gif'), { ext: 'gif', mime: 'image/gif', mismatch: false }, 'empty → URL ext');
assert.equal(sniffMime(Buffer.from('??'), 'https://x/a').ext, 'bin');
assert.ok(FONT_URL_RE.test('https://x/f.woff2?v=3') && FONT_URL_RE.test('/f.ttf') && !FONT_URL_RE.test('/f.woff2.map'));

const p1 = assetPath('https://cdn.example/img/hero.png?w=1', PNG);
assert.match(p1, /^assets\/media\/hero-[0-9a-f]{8}\.png$/);
assert.equal(assetPath('https://other.example/x/hero.png', PNG), p1, 'identical bytes at two URLs share one path (basename equal)');
assert.notEqual(assetPath('https://cdn.example/img/hero.png', JPG), p1);
assert.match(assetPath('https://cdn.example/img/photo.png?format=jpg', JPG), /\.jpg$/, 'ext follows the sniffed mime, not the URL');
assert.match(assetPath('https://x/fonts/Brand-Bold.woff2', WOFF2, 'fonts'), /^assets\/fonts\/Brand-Bold-[0-9a-f]{8}\.woff2$/);
assert.match(assetPath('https://x/', PNG), /^assets\/media\/asset-[0-9a-f]{8}\.png$/, 'no basename → asset');

const prev = { assets: { 'https://x/a.png': { localPath: 'assets/media/a-1.png', pages: ['index'] }, 'https://x/b.png': { localPath: null, downloadError: 'HTTP 403', pages: ['index'] }, 'https://x/c.png': { localPath: 'assets/media/c-1.png', pages: ['about'] } } };
const next = { assets: { 'https://x/a.png': { localPath: null, downloadError: 'HTTP 500', pages: ['pricing'] }, 'https://x/b.png': { localPath: 'assets/media/b-2.png', pages: ['pricing'] }, 'https://x/d.png': { localPath: 'assets/media/d-1.png', pages: ['pricing'] } } };
const merged = mergeManifest(prev, next);
assert.equal(Object.keys(merged)[0], '_provenance', '_provenance first');
assert.equal(merged.assets['https://x/a.png'].localPath, 'assets/media/a-1.png', 'an earlier success survives a later failure');
assert.deepEqual(merged.assets['https://x/a.png'].pages, ['index', 'pricing'], 'pages union');
assert.equal(merged.assets['https://x/b.png'].localPath, 'assets/media/b-2.png', 'a success replaces the earlier downloadError');
assert.ok(merged.assets['https://x/c.png'] && merged.assets['https://x/d.png'], 'nothing dropped, new URLs added');
assert.equal(Object.keys(mergeManifest(null, next).assets).length, 3);

assert.equal(licensingFlagFor('Inter'), 'open-license'); assert.equal(licensingFlagFor('"Roboto Mono"'), 'open-license'); assert.equal(licensingFlagFor('Sharp Grotesk'), 'verify'); assert.equal(licensingFlagFor(null), 'unknown');

const store = new Map([['https://x/img/wide.png', { bytes: PNG }]]);
const cands = fullAssetCandidates({ images: [{ src: 'https://x/img/fallback.png', currentSrc: 'https://x/img/wide.png?w=600&format=webp', srcset: '/img/wide.png 1x, /img/wide@2x.png 2x', sources: [{ srcset: '/img/narrow.png 400w, /img/mid.png 800w' }] }], cssBackgrounds: [{ url: 'https://x/img/hero-bg.png' }, { url: 'https://x/img/wide.png' }] }, store);
assert.deepEqual(cands.sort(), ['https://x/img/hero-bg.png', 'https://x/img/mid.png', 'https://x/img/wide@2x.png'].sort(), 'CDN master (already in store → skipped), largest srcset + <source> candidates, unrequested background');

const fm = buildFontsManifest({ 'https://x/fonts/brand-700.woff2': { kind: 'font', localPath: 'assets/fonts/brand-700-abcd1234.woff2', mime: 'font/woff2', bytes: 16, pages: ['index'], downloadError: null }, 'https://x/img/a.png': { kind: 'image', localPath: 'assets/media/a-1.png' } },
  [{ family: 'Brand Sans', weight: '700', style: 'normal', unicodeRange: null, urls: ['https://x/fonts/brand-700.woff2'], sourceCssRule: '@font-face { … }' }],
  { index: [{ family: 'atlas-icon', classes: ['ecs-glyph'], glyphs: ['U+E001'] }], about: [{ family: 'atlas-icon', classes: ['ecs-glyph', 'ecs-glyph-2'], glyphs: ['U+E001', 'U+E002'] }] });
assert.equal(fm.fonts.length, 1); assert.equal(fm.fonts[0].family, 'Brand Sans'); assert.equal(fm.fonts[0].weight, '700'); assert.equal(fm.fonts[0].licensingFlag, 'verify'); assert.equal(fm.fonts[0].localPath, 'assets/fonts/brand-700-abcd1234.woff2');
assert.deepEqual(fm.iconFonts, [{ family: 'atlas-icon', classes: ['ecs-glyph', 'ecs-glyph-2'], codepoints: 2, glyphs: ['U+E001', 'U+E002'], localPath: null, pages: ['index', 'about'] }], 'iconFonts aggregated across pages');

// flags
let a = parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/']);
assert.equal(a.assets, 'intercept', 'harvest is default on'); assert.equal(a.assetsMax, 200); assert.equal(a.assetsMaxBytes, 25 * 1024 * 1024);
assert.equal(parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--no-assets']).assets, 'none');
assert.equal(parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--assets', 'full', '--assets-max', '20']).assetsMax, 20);
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--assets', 'yes']), /--assets must be/);
assert.throws(() => parseArgs(['node', 'crawl.mjs', '--url', 'https://example.test/', '--wait', 'short']), /--wait must be one of/);

// ---- e2e: the real crawler over the local fixture page (browser-dependent, self-skips) ----
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const deps = process.env.STARDUST_GATE_DEPS || join(REPO_ROOT, 'node_modules');
let pwOk = false;
try { createRequire(join(deps, 'x.js')).resolve('playwright'); pwOk = true; } catch { /* absent */ }
if (!pwOk) { console.log(`crawl-assets test: ok (pure exports + flags); SKIP e2e — playwright not resolvable from ${deps}`); process.exit(0); }

const html = readFileSync(new URL('../lint/fixtures/crawl-capture/page.html', import.meta.url), 'utf8');
const svgImg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#147aff"/></svg>`;
const FONT_BODY = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(120, 7)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(40, 2)]);
const hits = [];
const server = createServer((q, r) => {
  hits.push(q.url);
  if (q.url === '/robots.txt' || q.url.startsWith('/sitemap')) { r.statusCode = 404; return r.end(); }
  if (q.url === '/' || q.url === '/index.html') { r.setHeader('content-type', 'text/html'); return r.end(html); }
  if (q.url === '/favicon.ico') { r.setHeader('content-type', 'image/x-icon'); return r.end(ICO); }
  if (q.url === '/img/does-not-exist.png') { r.statusCode = 404; return r.end('nope'); }
  if (q.url.startsWith('/img/')) { const big = /hero|wide|fallback/.test(q.url); r.setHeader('content-type', 'image/svg+xml'); return r.end(svgImg(big ? 600 : 180, big ? 300 : 32)); }
  if (q.url.startsWith('/fonts/')) { r.setHeader('content-type', 'font/woff2'); return r.end(FONT_BODY); }
  r.statusCode = 404; r.end();
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = realpathSync(mkdtempSync(join(tmpdir(), 'crawl-assets-')));
mkdirSync(join(work, 'skills', 'extract', 'scripts'), { recursive: true });
mkdirSync(join(work, 'skills', 'stardust', 'scripts'), { recursive: true });
cpSync(resolve(import.meta.dirname, '..', '..', 'skills', 'extract', 'scripts', 'crawl.mjs'), join(work, 'skills', 'extract', 'scripts', 'crawl.mjs'));
cpSync(resolve(import.meta.dirname, '..', '..', 'skills', 'stardust', 'scripts', 'progress.mjs'), join(work, 'skills', 'stardust', 'scripts', 'progress.mjs'));
symlinkSync(deps, join(work, 'node_modules'));
try {
  const out = join(work, 'stardust', 'current');
  const r = await new Promise((ok) => {
    const c = spawn(process.execPath, [join(work, 'skills', 'extract', 'scripts', 'crawl.mjs'), '--url', `${origin}/`, '--single', '--out', out, '--mobile', 'none', '--no-consent-dismiss', '--wait', 'fast'], { cwd: work, env: { ...process.env, STARDUST_LIVE_FORCE: '1' } });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => ok({ code, stdout, stderr }));
  });
  assert.equal(r.code, 0, `crawl exit 0\n${r.stderr.slice(-2000)}`);
  assert.match(r.stdout.trim().split('\n').pop(), /^SUMMARY crawl ok=1 failed=0/, `captured\n${r.stderr.slice(-2000)}`);
  const rec = JSON.parse(readFileSync(join(out, 'pages', 'index.json'), 'utf8'));
  assert.equal(rec._provenance.schemaVersion, 2);
  const media = readdirSync(join(out, 'assets', 'media')); const fonts = readdirSync(join(out, 'assets', 'fonts'));
  assert.ok(media.length >= 2, `media bodies written from the render's own responses: ${media}`);
  assert.ok(fonts.length >= 1 && fonts.every((f) => /-[0-9a-f]{8}\.woff2$/.test(f)), `font bodies written with sniffed ext: ${fonts}`);
  const wide = rec.media.images.find((im) => /wide\.png/.test(im.currentSrc));
  assert.ok(wide && /^assets\/media\/wide-[0-9a-f]{8}\.svg$/.test(wide.localPath) && wide.mime === 'image/svg+xml' && wide.transformSuspect === true, `svg bytes behind a .png URL → sniffed ext + transformSuspect: ${JSON.stringify(wide)}`);
  const broken = rec.media.images.find((im) => /does-not-exist/.test(im.src));
  assert.ok(broken && broken.localPath === null && broken.downloadError === 'HTTP 404', `404 image → downloadError: ${JSON.stringify(broken)}`);
  const bg = rec.media.cssBackgrounds.find((b) => /hero-bg\.png/.test(b.url));
  assert.ok(bg && bg.localPath && bg.mime === 'image/svg+xml', `css background harvested: ${JSON.stringify(bg)}`);
  assert.equal(bg.localPath, wide.localPath, 'identical bytes at two URLs share one file (content hash, not URL)');
  const mm = JSON.parse(readFileSync(join(out, 'assets', '_media-manifest.json'), 'utf8'));
  assert.equal(Object.keys(mm)[0], '_provenance');
  const row = mm.assets[wide.currentSrc]; assert.ok(row && row.localPath === wide.localPath && row.pages.includes('index') && row.status === 200, JSON.stringify(row));
  assert.equal(mm.assets[broken.src].downloadError, 'HTTP 404');
  const fm2 = JSON.parse(readFileSync(join(out, 'assets', '_fonts-manifest.json'), 'utf8'));
  const sans = fm2.fonts.find((f) => f.family === 'Fixture Sans');
  assert.ok(sans && sans.weight === '700' && sans.localPath && sans.licensingFlag === 'verify' && sans.mime === 'font/woff2', `@font-face descriptors matched: ${JSON.stringify(fm2.fonts)}`);
  assert.ok(fm2.iconFonts.some((f) => f.family === 'atlas-icon' && f.classes.includes('ecs-glyph')) && fm2.iconFonts.find((f) => f.family === 'fixture-icons').localPath, `iconFonts table with the harvested file: ${JSON.stringify(fm2.iconFonts)}`);
  const fs2 = JSON.parse(readFileSync(join(out, 'assets', 'favicon-set.json'), 'utf8'));
  assert.ok(fs2.icons.some((i) => /favicon\.ico$/.test(i.url) && i.file && i.mime === 'image/x-icon') && fs2.largestRaster, JSON.stringify(fs2));
  assert.ok(existsSync(join(out, 'assets', 'favicon.ico')), 'captureFavicon still writes assets/favicon.<ext>');
  const log = JSON.parse(readFileSync(join(out, '_crawl-log.json'), 'utf8'));
  const run = log.runs[log.runs.length - 1];
  assert.equal(run.args.assets, 'intercept'); assert.ok(run.assets.saved >= 4 && run.assets.failed >= 1 && run.assets.fonts >= 1 && run.assets.extraFetches === 0, JSON.stringify(run.assets));
  assert.equal(log.favicon.set.icons >= 1, true);
  // hit minimisation: the harvest adds no request — every media/font hit belongs to a page load
  // (the probe and the capture each render the page once), and no URL outside the render is fetched
  const mediaHits = hits.filter((u) => u.startsWith('/img/') || u.startsWith('/fonts/'));
  const loads = hits.filter((u) => u === '/').length;
  assert.equal(loads, 2, `probe + capture loads: ${loads}`);
  for (const u of new Set(mediaHits)) assert.ok(mediaHits.filter((x) => x === u).length <= loads, `${u} fetched by the harvest, not the render`);
  assert.equal(hits.filter((u) => u === '/favicon.ico').length, 1, 'the favicon set reuses captureFavicon\'s fetch — one icon hit');
  console.log(`crawl-assets test: ok (pure exports + flags + e2e: ${media.length} media, ${fonts.length} font(s), manifests, favicon set)`);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
