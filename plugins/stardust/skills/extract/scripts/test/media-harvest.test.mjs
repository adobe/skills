#!/usr/bin/env node
// skills/extract/scripts/test/media-harvest.test.mjs — the media-harvest.mjs contract. Part (a), pure:
// srcset parsing (descriptors, commas inside URLs, parenthesised descriptors), reference extraction
// (img/source/video/audio, data-src* incl. data-srcset, style url() with entity-encoded quotes,
// <style> blocks minus comments / @import / @font-face, comments and <script> bodies ignored, the
// first <base href>), resolution (skipped schemes, fragments, non-http, JSON-ish values; relative
// references without a base counted, not guessed), the naming and extension rules, the map merge,
// the summary lines and argument parsing. Part (b), end-to-end against a node:http server on
// 127.0.0.1 (no internet): images, a redirect, a 404, an oversize file by content-length and one by
// streaming under --max-bytes, a hang under --timeout — exit 0, map entries and files; a 2xx answer
// whose content-type is not media is not-media (no file), octet-stream and no content-type download;
// the second run requests only the failed URLs and leaves the map byte-identical (an unrelated entry
// survives); on a clean site the second run makes zero requests; a missing local file is fetched
// again; without --max-bytes a video (video/* or a video extension) over the default cap is too-large,
// declared or streamed, while an explicit --max-bytes replaces that default and images stay uncapped;
// the map is on disk after the first of two downloads, a run killed mid-download keeps it, the re-run
// fetches only the rest and the run after that changes nothing; a map that
// is not a JSON object is refused; usage errors; --help in an empty cwd writes nothing; the real-path
// main-module guard. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_MAX_BYTES, ASSET_TOTAL_MAX_BYTES, DEFAULTS, MAX_FAIL_LINES, VIDEO_MAX_BYTES, assetEntry, assetExt, assetKind, assetLocal, assetTypeOk,
  baseName, cssAssetRefs, cssUrls, download, extFor, extractRefs, hash8, keepPrior, mediaFileName, mergeMap, originalUrl,
  pageMedia, parseArgs, parseAssets, parseSrcset, resolveRef, serializeMap, summarize, summarizeAssets, urlExt,
} from '../media-harvest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'media-harvest.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'media-harvest-test-')));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// Async spawn: the fixture server lives in this process, so a blocking spawnSync would starve it.
const run = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});
const sha8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

// ---- part (a): pure ------------------------------------------------------------------------------
await check('parseSrcset: every candidate; descriptors dropped; commas inside a URL kept; a trailing comma ends a candidate; parenthesised descriptors', () => {
  assert.deepEqual(parseSrcset('a.jpg 1x, b.jpg 2x'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(parseSrcset('https://img.example.test/w_400,h_300/a.jpg 400w, https://img.example.test/w_800,h_600/a.jpg 800w'),
    ['https://img.example.test/w_400,h_300/a.jpg', 'https://img.example.test/w_800,h_600/a.jpg']);
  assert.deepEqual(parseSrcset('a.jpg, b.jpg'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(parseSrcset('  a.jpg  ,  b.jpg 2x ,c.jpg'), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.deepEqual(parseSrcset('a.jpg (max-width: 600px, x) 1x, b.jpg'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(parseSrcset('a.jpg,b.jpg 2x'), ['a.jpg,b.jpg'], 'no whitespace after the comma: one URL, as the HTML grammar reads it');
  assert.deepEqual(parseSrcset(''), []); assert.deepEqual(parseSrcset(' , '), []); assert.deepEqual(parseSrcset(null), []);
});

await check('cssUrls: double, single and unquoted url(); comments, @import rules and @font-face blocks are not read; escapes undone', () => {
  assert.deepEqual(cssUrls(`/* url(/c.png) */ .a { background: url(/a.png) } .b { background-image: url('/b.png'), url( "/c d.png" ) }`), ['/a.png', '/b.png', '/c d.png']);
  assert.deepEqual(cssUrls('@import url("/theme.css"); @import "/x.css"; @font-face { font-family: F; src: url(/f.woff2) format("woff2"), url(\'/f.woff\'); } .h { background: url(/h.jpg) }'), ['/h.jpg']);
  assert.deepEqual(cssUrls('.e { background: url("/a\\"b.png") } .f { background: url(/sp\\ ace.png) }'), ['/a"b.png', '/sp ace.png']);
  assert.deepEqual(cssUrls('.n { background: url() }'), []);
});

await check('extractRefs: img src/srcset, source srcset/src, video src/poster, data-src*, style attributes (entity-decoded), <style> blocks; comments, scripts, other attributes and a second <base> ignored', () => {
  const html = `<!DOCTYPE html><html><head><base href="/sub/"><base href="/ignored/">
<style>/* .x { background: url(/commented.png) } */ .a { background: url(/bg/a.png) } .b { background-image: url('/bg/b.png'), url( "/bg/c.png" ) }
@import url("/theme.css"); @font-face { font-family: F; src: url(/f.woff2) format("woff2"); }</style>
<script>document.write('<img src="/script.png">'); var s = "url(/script-bg.png)";</script>
</head><body>
<!-- <img src="/comment.png"> -->
<img src=" /i/a.jpg " srcset="/i/a-1x.jpg 1x, /i/a-2x.jpg 2x" alt='x > y'>
<picture><source srcset="/i/w_400,h_300/p.webp 400w, /i/p-800.webp 800w" type="image/webp"><img src="/i/p.jpg"></picture>
<div data-src="/lazy/a.jpg" data-srcset="/lazy/a-1.jpg 1x, /lazy/a-2.jpg 2x" DATA-SRC-RETINA="/lazy/a@2x.jpg" data-bg="/not-collected.jpg"></div>
<section style="background-image: url(&quot;/s/q.jpg?w=1&amp;h=2&quot;)"></section>
<section style='background: url(/s/plain.png) no-repeat'></section>
<video src="/v/clip.mp4" poster="/v/poster.jpg"><source src="/v/clip.webm" type="video/webm"></video><audio src=/a/track.mp3></audio>
<a href="/not-media.jpg">x</a><link rel="preload" href="/not-collected-either.jpg"><iframe src="/frame.html"></iframe>
</body></html>`;
  const { base, refs } = extractRefs(html);
  assert.equal(base, '/sub/', 'the first <base href> only');
  assert.deepEqual(refs, [
    '/i/a.jpg', '/i/a-1x.jpg', '/i/a-2x.jpg',
    '/i/w_400,h_300/p.webp', '/i/p-800.webp', '/i/p.jpg',
    '/lazy/a.jpg', '/lazy/a-1.jpg', '/lazy/a-2.jpg', '/lazy/a@2x.jpg',
    '/s/q.jpg?w=1&h=2', '/s/plain.png',
    '/v/clip.mp4', '/v/poster.jpg', '/v/clip.webm', '/a/track.mp3',
    '/bg/a.png', '/bg/b.png', '/bg/c.png',
  ]);
  assert.equal(extractRefs('<p>no media</p>').base, null);
});

await check('resolveRef: data:/blob:/javascript:/about:/#/empty/JSON-ish dropped; non-http after resolution dropped; fragment removed, query kept; no base → relative', () => {
  const b = 'https://example.test/dir/page';
  for (const r of ['data:image/gif;base64,R0lGOD', 'blob:https://example.test/1', 'JavaScript:void(0)', 'about:blank', '#top', '', '   ', '{"src":"/a.jpg"}', '[1]', 'mailto:a@example.test', 'ftp://example.test/a.jpg']) {
    assert.deepEqual(resolveRef(r, b), { drop: true }, JSON.stringify(r));
  }
  assert.deepEqual(resolveRef(' img/a.jpg#frag ', b), { url: 'https://example.test/dir/img/a.jpg' });
  assert.deepEqual(resolveRef('/a.jpg?w=1&h=2#x', b), { url: 'https://example.test/a.jpg?w=1&h=2' });
  assert.deepEqual(resolveRef('//cdn.example.test/a.jpg', b), { url: 'https://cdn.example.test/a.jpg' });
  assert.deepEqual(resolveRef('img/a.jpg', null), { relative: true });
  assert.deepEqual(resolveRef('//cdn.example.test/a.jpg', null), { relative: true });
  assert.deepEqual(resolveRef('https://cdn.example.test/a.jpg#x', null), { url: 'https://cdn.example.test/a.jpg' });
});

await check('pageMedia: <base href> wins over the record URL (resolved against it); the record URL otherwise; dedupe by URL without fragment; no base at all → relative refs counted, absolute ones kept', () => {
  const withBase = pageMedia('<base href="/sub/"><img src="n.gif"><img src="/n.gif#x" srcset="n.gif 1x, n.gif#y 2x">', 'https://example.test/about/');
  assert.equal(withBase.base, 'https://example.test/sub/');
  assert.deepEqual(withBase.urls, ['https://example.test/n.gif', 'https://example.test/sub/n.gif']);
  assert.equal(withBase.unresolved, 0);
  const absBase = pageMedia('<base href="https://cdn.example.test/root/"><img src="a.png">', null);
  assert.deepEqual([absBase.base, absBase.urls], ['https://cdn.example.test/root/', ['https://cdn.example.test/root/a.png']], 'an absolute <base href> needs no record');
  const rec = pageMedia('<img src="img/a.jpg"><img src="data:x"><div style="background:url(about:blank)"></div>', 'https://example.test/p/home');
  assert.deepEqual(rec.urls, ['https://example.test/p/img/a.jpg']);
  const none = pageMedia('<img src="a.png"><img src="a.png"><img src="/b.png"><img src="//cdn.example.test/c.png"><img src="https://example.test/d.png#f"><img src="data:x">', null);
  assert.deepEqual([none.base, none.urls, none.unresolved], [null, ['https://example.test/d.png'], 3], 'three distinct relative refs skipped and counted');
  const relBaseOnly = pageMedia('<base href="/sub/"><img src="a.png"><img src="https://example.test/z.png">', null);
  assert.deepEqual([relBaseOnly.base, relBaseOnly.urls, relBaseOnly.unresolved], [null, ['https://example.test/z.png'], 1], 'a relative <base href> with no record URL is no base');
});

await check('naming: base = path basename, percent-decoded, extension removed, lowercased, runs → "-", edge dashes trimmed, ≤ 60 chars, empty → media', () => {
  assert.equal(baseName('https://example.test/img/Hero%20Image.JPG?x=1'), 'hero-image');
  assert.equal(baseName('https://example.test/img/photo.large_v2.jpeg'), 'photo-large_v2');
  assert.equal(baseName('https://example.test/a/gallery/'), 'gallery');
  assert.equal(baseName('https://example.test/'), 'media');
  assert.equal(baseName('https://example.test/~~~.png'), 'media');
  assert.equal(baseName('https://example.test/img.php?id=3'), 'img');
  assert.equal(baseName(`https://example.test/${'x'.repeat(80)}.png`), 'x'.repeat(60));
  assert.equal(baseName(`https://example.test/${'a'.repeat(59)}%20b.png`), 'a'.repeat(59), 'a cut landing on a dash drops the dash');
});

await check('extension: the URL\'s known media extension (lowercased) wins; else the content-type (params ignored; jpeg→jpg, svg+xml→svg, x-icon→ico, mp4, webm); else bin', () => {
  assert.equal(urlExt('https://example.test/a.JPG'), 'jpg'); assert.equal(urlExt('https://example.test/a.jpeg'), 'jpeg');
  assert.equal(urlExt('https://example.test/a.php'), null); assert.equal(urlExt('https://example.test/a'), null);
  assert.equal(extFor('https://example.test/a.png', 'image/webp'), 'png');
  assert.equal(extFor('https://example.test/img.php', 'image/jpeg; charset=binary'), 'jpg');
  assert.equal(extFor('https://example.test/i', 'image/svg+xml'), 'svg'); assert.equal(extFor('https://example.test/i', 'image/x-icon'), 'ico');
  assert.equal(extFor('https://example.test/v', 'video/mp4'), 'mp4'); assert.equal(extFor('https://example.test/v', 'Video/WebM'), 'webm');
  assert.equal(extFor('https://example.test/i', 'image/avif'), 'avif'); assert.equal(extFor('https://example.test/i', 'image/gif'), 'gif');
  assert.equal(extFor('https://example.test/x', 'text/html'), 'bin'); assert.equal(extFor('https://example.test/x', null), 'bin');
});

await check('mediaFileName: <base>-<first 8 hex of sha256(bytes)>.<ext>; identical bytes under one base share a name, other bytes do not', () => {
  const bytes = Buffer.from('identical bytes');
  assert.equal(hash8(bytes), sha8(bytes));
  assert.equal(mediaFileName('https://example.test/img/hero.jpg', bytes, 'image/jpeg'), `hero-${sha8(bytes)}.jpg`);
  assert.equal(mediaFileName('https://cdn.example.test/v2/hero.jpg?w=800', bytes, null), mediaFileName('https://example.test/img/hero.jpg', bytes, 'image/jpeg'));
  assert.notEqual(mediaFileName('https://example.test/img/hero.jpg', Buffer.from('other'), 'image/jpeg'), mediaFileName('https://example.test/img/hero.jpg', bytes, 'image/jpeg'));
});

await check('mergeMap + serializeMap: keys sorted, unseen entries kept, this run\'s entries replace older ones; 2-space JSON with a trailing newline', () => {
  const merged = mergeMap({ 'https://z.example.test/a': { status: 'ok' }, 'https://a.example.test/a': { status: 'http-404' } }, { 'https://m.example.test/a': { status: 'ok' }, 'https://a.example.test/a': { status: 'ok' } });
  assert.deepEqual(Object.keys(merged), ['https://a.example.test/a', 'https://m.example.test/a', 'https://z.example.test/a']);
  assert.equal(merged['https://a.example.test/a'].status, 'ok');
  assert.equal(serializeMap({ a: { b: 1 } }), '{\n  "a": {\n    "b": 1\n  }\n}\n');
});

await check('summarize: the summary line (status breakdown sorted, no parenthesis without failures, the unresolved segment only when any), then ≤ 10 sorted fail lines', () => {
  assert.deepEqual(summarize({ urls: 3, pages: 1, downloaded: 1, reused: 2, failures: [], map: 'm.json' }),
    ['media-harvest: 3 url(s) from 1 page(s) · downloaded 1 · reused 2 · failed 0 → m.json']);
  const failures = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.test/${String(i).padStart(2, '0')}.jpg`, status: i % 3 ? 'http-404' : 'too-large' })).reverse();
  failures.push({ url: 'https://example.test/x.jpg', status: 'error' });
  const lines = summarize({ urls: 20, pages: 4, downloaded: 7, reused: 0, failures, map: 'm.json', unresolved: 2, unresolvedPages: 1 });
  assert.equal(lines[0], 'media-harvest: 20 url(s) from 4 page(s) · downloaded 7 · reused 0 · failed 13 (error ×1, http-404 ×8, too-large ×4) · unresolved 2 relative ref(s) on 1 page(s) without a base URL → m.json');
  assert.equal(lines.length, 1 + MAX_FAIL_LINES);
  assert.deepEqual(lines.slice(1, 4), ['fail error https://example.test/x.jpg', 'fail http-404 https://example.test/01.jpg', 'fail http-404 https://example.test/02.jpg']);
  assert.deepEqual([...lines.slice(1)].sort(), lines.slice(1), 'sorted');
});

await check('parseArgs: defaults; every flag; a value flag followed by nothing or by another --flag names the flag; bad numbers, unknown and positional arguments are usage errors', () => {
  assert.deepEqual(parseArgs([]), { ...DEFAULTS, assets: ['media'] });
  assert.deepEqual(DEFAULTS, {
    pages: 'stardust/current/pages', out: 'stardust/current/assets/media', map: 'stardust/current/assets/media-map.json', concurrency: 4, maxBytes: null, timeout: 30,
    assets: ['media'], assetsDir: 'stardust/current/assets', harvestMap: 'stardust/current/assets/harvest-map.json', maxTotalBytes: ASSET_TOTAL_MAX_BYTES,
  });
  assert.deepEqual(parseArgs(['--pages', 'p', '--out', 'o', '--map', 'm.json', '--concurrency', '2', '--max-bytes', '1000', '--timeout', '0.5']),
    { ...DEFAULTS, assets: ['media'], pages: 'p', out: 'o', map: 'm.json', concurrency: 2, maxBytes: 1000, timeout: 0.5 });
  assert.deepEqual(parseArgs(['--assets', 'svg,sheets,fonts,sheets', '--assets-dir', 'a', '--harvest-map', 'h.json', '--max-total-bytes', '9000']),
    { ...DEFAULTS, assets: ['sheets', 'fonts', 'svg'], assetsDir: 'a', harvestMap: 'h.json', maxTotalBytes: 9000 });
  const usage = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), argv.join(' '));
  usage(['--max-bytes'], /^--max-bytes needs a value/); usage(['--timeout', '--concurrency', '2'], /^--timeout needs a value/); usage(['--pages'], /^--pages needs a value/);
  usage(['--concurrency', '0'], /--concurrency needs an integer ≥ 1/); usage(['--max-bytes', '1.5'], /--max-bytes needs an integer/); usage(['--timeout', '0'], /--timeout needs a number/); usage(['--timeout', 'x'], /--timeout needs a number/);
  usage(['--bogus'], /unknown argument --bogus/); usage(['pages'], /unknown argument pages/);
  usage(['--assets'], /^--assets needs a value/); usage(['--assets', 'css'], /--assets: unknown kind "css" \(media, sheets, fonts, svg\)/);
  usage(['--assets', ','], /--assets names no kind/); usage(['--max-total-bytes', '0'], /--max-total-bytes needs an integer ≥ 1/);
});

// ---- part (a2): the browser path's pure parts ----------------------------------------------------
await check('parseAssets: canonical order media, sheets, fonts, svg; duplicates and spaces dropped; an unknown kind or an empty list is a usage error', () => {
  assert.deepEqual(parseAssets('fonts, svg ,sheets'), ['sheets', 'fonts', 'svg']);
  assert.deepEqual(parseAssets('svg,media'), ['media', 'svg']);
  assert.throws(() => parseAssets('images'), (e) => e.code === 2 && /unknown kind "images"/.test(e.message));
  assert.throws(() => parseAssets(' , '), (e) => e.code === 2 && /names no kind/.test(e.message));
});

await check('assetKind: the browser\'s resource type first (stylesheet → sheets, font → fonts), then the URL extension, then the content-type; svg only as svg; other images, scripts and documents are no asset', () => {
  assert.equal(assetKind({ resourceType: 'stylesheet', url: 'https://a.test/x', contentType: 'text/html' }), 'sheets', 'a denial page answering a stylesheet request is still a sheet (then not-media)');
  assert.equal(assetKind({ resourceType: 'font', url: 'https://a.test/f', contentType: null }), 'fonts');
  assert.equal(assetKind({ resourceType: 'image', url: 'https://a.test/i/icon.SVG?v=1', contentType: 'text/html' }), 'svg');
  assert.equal(assetKind({ resourceType: 'image', url: 'https://a.test/i/sprite', contentType: 'image/svg+xml' }), 'svg');
  assert.equal(assetKind({ resourceType: 'other', url: 'https://a.test/f/a.woff2', contentType: null }), 'fonts');
  assert.equal(assetKind({ resourceType: 'other', url: 'https://a.test/s/a.css', contentType: null }), 'sheets');
  assert.equal(assetKind({ resourceType: 'fetch', url: 'https://a.test/x', contentType: 'font/woff2' }), 'fonts');
  for (const [resourceType, url, contentType] of [['image', 'https://a.test/a.png', 'image/png'], ['script', 'https://a.test/a.js', 'text/javascript'], ['document', 'https://a.test/', 'text/html'], ['xhr', 'https://a.test/api', 'application/json']]) {
    assert.equal(assetKind({ resourceType, url, contentType }), null, url);
  }
});

await check('assetTypeOk: a sheet is text/css; a font is font/*, application/(x-)font-*, the embedded-type font or octet-stream; an svg is image/svg+xml or octet-stream; no content-type passes; an HTML answer never does', () => {
  for (const t of ['text/css', null]) assert.equal(assetTypeOk('sheets', t), true, String(t));
  for (const t of ['font/woff2', 'font/ttf', 'application/font-woff', 'application/x-font-ttf', 'application/vnd.ms-fontobject', 'application/octet-stream', 'binary/octet-stream', null]) assert.equal(assetTypeOk('fonts', t), true, String(t));
  for (const t of ['image/svg+xml', 'application/octet-stream', null]) assert.equal(assetTypeOk('svg', t), true, String(t));
  for (const k of ['sheets', 'fonts', 'svg']) assert.equal(assetTypeOk(k, 'text/html'), false, k);
  assert.equal(assetTypeOk('sheets', 'text/plain'), false);
});

await check('assetExt + assetLocal: the URL\'s own extension of the kind, else the content-type\'s, else css / bin / svg; <dir>/<kind>/<base>-<hash8>.<ext> with posix separators', () => {
  assert.equal(assetExt('sheets', 'https://a.test/s/site.CSS?v=3', 'text/css'), 'css');
  assert.equal(assetExt('sheets', 'https://a.test/s/bundle', null), 'css');
  assert.equal(assetExt('fonts', 'https://a.test/f/brand.woff2', 'application/octet-stream'), 'woff2');
  assert.equal(assetExt('fonts', 'https://a.test/f/brand', 'font/woff'), 'woff');
  assert.equal(assetExt('fonts', 'https://a.test/f/brand', 'application/octet-stream'), 'bin');
  assert.equal(assetExt('svg', 'https://a.test/i/sprite', 'image/svg+xml'), 'svg');
  const bytes = Buffer.from('body{}');
  assert.equal(assetLocal('stardust/current/assets', 'sheets', 'https://a.test/s/Site%20Main.css', bytes, 'text/css'), `stardust/current/assets/sheets/site-main-${hash8(bytes)}.css`);
});

await check('cssAssetRefs: @import (url() or string) → sheets, url() inside @font-face → fonts, any other url() ending .svg → svg; resolved against the sheet URL, fragments dropped, data: ignored, comments not read; sorted and unique', () => {
  const css = `/* url(/no.svg) @import "/no.css"; */
@import "theme.css" screen; @import url('/print.css') print;
@font-face { font-family: A; src: url(../fonts/a.woff2) format("woff2"), url("../fonts/a.woff") format("woff"); }
.i { background: url(icons/arrow.svg#x) } .j { mask: url("data:image/svg+xml;utf8,<svg/>") } .k { background: url(/img/photo.png) } .l { background: url(icons/arrow.svg) }`;
  assert.deepEqual(cssAssetRefs(css, 'https://a.test/css/site.css'), {
    sheets: ['https://a.test/css/theme.css', 'https://a.test/print.css'],
    fonts: ['https://a.test/fonts/a.woff', 'https://a.test/fonts/a.woff2'],
    svg: ['https://a.test/css/icons/arrow.svg'],
  });
  assert.deepEqual(cssAssetRefs('', 'https://a.test/'), { sheets: [], fonts: [], svg: [] });
});

await check('originalUrl: the first request of a redirect chain (the URL the page or sheet referenced), fragment removed', () => {
  const req = (url, from = null) => ({ url: () => url, redirectedFrom: () => from });
  assert.equal(originalUrl(req('https://cdn.test/b.css', req('https://a.test/m.css', req('https://a.test/a.css#x')))), 'https://a.test/a.css');
  assert.equal(originalUrl(req('https://a.test/a.woff2')), 'https://a.test/a.woff2');
});

await check('assetEntry + keepPrior: the map entry shape (local, bytes, contentType, status, kind, error?) in that key order; a failure never replaces an ok entry whose file is on disk', () => {
  assert.deepEqual(Object.keys(assetEntry('fonts', { status: 'ok', local: 'x/fonts/a-1.woff2', bytes: 4, contentType: 'font/woff2' })), ['local', 'bytes', 'contentType', 'status', 'kind']);
  assert.deepEqual(assetEntry('sheets', { status: 'not-media', contentType: 'text/html' }), { local: null, bytes: null, contentType: 'text/html', status: 'not-media', kind: 'sheets' });
  assert.deepEqual(assetEntry('svg', { status: 'too-large', error: 'e' }), { local: null, bytes: null, contentType: null, status: 'too-large', kind: 'svg', error: 'e' });
  const dir = join(root, 'keep'); mkdirSync(dir); writeFileSync(join(dir, 'a.css'), 'abcd');
  const prior = { local: join(dir, 'a.css'), bytes: 4, contentType: 'text/css', status: 'ok', kind: 'sheets' };
  assert.equal(keepPrior(prior, { status: 'not-media' }), true);
  assert.equal(keepPrior(prior, { status: 'ok' }), false, 'a fresh ok answer replaces it');
  assert.equal(keepPrior({ ...prior, local: join(dir, 'gone.css') }, { status: 'not-media' }), false, 'a prior whose file is gone does not');
  assert.equal(keepPrior(undefined, { status: 'error' }), false);
});

await check('summarizeAssets: one line — assets, pages, per-kind counts, downloaded / reused / failed (+ breakdown), pages not opened when any — then ≤ 10 sorted fail lines', () => {
  const lines = summarizeAssets({ pages: 3, kinds: ['sheets', 'fonts', 'svg'], byKind: { sheets: 2, fonts: 3, svg: 1 }, downloaded: 4, reused: 0, failures: [{ url: 'https://a.test/b.woff2', status: 'too-large' }, { url: 'https://a.test/a.svg', status: 'http-404' }], pageErrors: 1, map: 'h.json' });
  assert.deepEqual(lines, [
    'media-harvest (browser): 6 asset(s) from 3 page(s) — sheets 2 · fonts 3 · svg 1 · downloaded 4 · reused 0 · failed 2 (http-404 ×1, too-large ×1) · 1 page(s) not opened → h.json',
    'fail http-404 https://a.test/a.svg', 'fail too-large https://a.test/b.woff2',
  ]);
  assert.equal(summarizeAssets({ pages: 1, kinds: ['fonts'], byKind: { fonts: 0 }, downloaded: 0, reused: 0, failures: [], pageErrors: 0, map: 'h.json' })[0],
    'media-harvest (browser): 0 asset(s) from 1 page(s) — fonts 0 · downloaded 0 · reused 0 · failed 0 → h.json');
  assert.equal(ASSET_MAX_BYTES, 5 * 1024 * 1024);
});

// ---- part (b): end-to-end against 127.0.0.1 ---------------------------------------------------------
const fill = (seed, n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256));
const HERO = fill(1, 300); const HERO2X = fill(2, 400); const CARD = fill(3, 500); const NOEXT = fill(4, 200);
const NESTED = fill(5, 120); const LOGO = fill(6, 140); const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'); const BIG = fill(7, 5000);
const BLOB = fill(8, 90); const UNTYPED = fill(9, 80); const INC_A = fill(10, 110); const INC_B = fill(11, 130);
const ROUTES = {
  '/inc/a.jpg': ['image/jpeg', INC_A], '/inc/b.jpg': ['image/jpeg', INC_B],
  '/img/hero.jpg': ['image/jpeg', HERO], '/cdn/hero.jpg': ['image/jpeg', HERO], '/img/hero-2x.jpg': ['image/jpeg', HERO2X],
  '/img/card.webp?v=2': ['image/webp; charset=binary', CARD], '/img/noext': ['image/png', NOEXT], '/bg/Pattern%20Dark.svg': ['image/svg+xml', SVG],
  '/sub/nested.gif': ['image/gif', NESTED], '/img/logo.gif': ['image/gif', LOGO], '/big.mp4': ['video/mp4', BIG],
  '/embed/player': ['Text/HTML; charset=utf-8', Buffer.from('<!doctype html><title>player</title>')], '/raw/blob': ['application/octet-stream', BLOB], '/raw/untyped': [null, UNTYPED],
};
const hits = new Map();
const hanging = [];
let onRequest = null; // a test's hook: answers (returns true) or passes (false)
const server = createServer((req, res) => {
  hits.set(req.url, (hits.get(req.url) || 0) + 1);
  res.on('error', () => {}); req.socket.on('error', () => {});
  if (onRequest?.(req, res)) return;
  if (req.url === '/redirect/logo') { res.writeHead(302, { location: '/img/logo.gif' }); res.end(); return; }
  if (req.url === '/slow.jpg') { hanging.push(res); return; }
  if (req.url === '/huge.mp4' || req.url === '/raw/huge-clip.mp4') { // one byte over the video default, no body: only the declared length can stop it
    res.writeHead(200, { 'content-type': req.url === '/huge.mp4' ? 'video/mp4' : 'application/octet-stream', 'content-length': VIDEO_MAX_BYTES + 1 });
    res.flushHeaders(); hanging.push(res); return;
  }
  if (req.url === '/stream.mp4') { // no content-length: only streaming can see it is too large
    res.writeHead(200, { 'content-type': 'video/mp4' });
    for (let i = 0; i < 5; i += 1) res.write(BIG.subarray(i * 1000, (i + 1) * 1000));
    res.end(); return;
  }
  const r = ROUTES[req.url];
  if (!r) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>not found</h1>'); return; }
  res.writeHead(200, { ...(r[0] ? { 'content-type': r[0] } : {}), 'content-length': r[1].length }); res.end(r[1]);
});
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const totalHits = () => [...hits.values()].reduce((s, n) => s + n, 0);

const site = join(root, 'site');
const pagesDir = join(site, 'stardust/current/pages');
mkdirSync(pagesDir, { recursive: true });
writeFileSync(join(pagesDir, 'home.json'), `${JSON.stringify({ slug: 'home', url: `${ORIGIN}/`, finalUrl: `${ORIGIN}/home`, renderedHtml: 'pages/home.html' })}\n`);
writeFileSync(join(pagesDir, 'home.html'), `<!DOCTYPE html><html><head>
<style>/* url(/commented.png) */ .hero { background: url("/bg/Pattern%20Dark.svg") } @import url("/theme.css"); @font-face { font-family: X; src: url(/font.woff2) format("woff2"); }</style>
<script>var s = '<img src="/script-only.png">';</script></head><body>
<!-- <img src="/commented.jpg"> -->
<img src="img/hero.jpg" srcset="img/hero.jpg 1x, /img/hero-2x.jpg 2x" alt="">
<img src="data:image/gif;base64,R0lGOD" data-src="/img/card.webp?v=2#frag" alt="">
<picture><source srcset="/img/card.webp?v=2 800w, /img/noext 400w"><img src="/missing.png"></picture>
<div style="background-image: url(&quot;/redirect/logo&quot;)"></div>
<a href="/not-media.jpg">x</a>
<video src="/big.mp4" poster="/img/hero.jpg"><source src="/stream.mp4" type="video/mp4"></video>
<img src="/slow.jpg"><img src="javascript:void(0)"><img src="about:blank"><img src="#x"><img src=""><img src="mailto:a@example.test">
</body></html>`);
writeFileSync(join(pagesDir, 'about.json'), `${JSON.stringify({ slug: 'about', url: `${ORIGIN}/about/`, finalUrl: `${ORIGIN}/about/` })}\n`);
writeFileSync(join(pagesDir, 'about.html'), `<html><head><base href="/sub/"></head><body><img src="nested.gif"><div data-srcset="/cdn/hero.jpg 1x, /img/hero.jpg 2x"></div></body></html>`);
writeFileSync(join(pagesDir, 'orphan.html'), `<html><body><img src="relative.png"><img src="/root-relative.png"><img src="${ORIGIN}/img/hero.jpg"></body></html>`);
const MAP = join(site, 'stardust/current/assets/media-map.json');
const OUT = join(site, 'stardust/current/assets/media');
const OLD = { local: 'stardust/current/assets/media/old-00000000.jpg', bytes: 3, contentType: 'image/jpeg', status: 'ok' };
mkdirSync(dirname(MAP), { recursive: true });
writeFileSync(MAP, `${JSON.stringify({ 'https://example.test/old.jpg': OLD }, null, 2)}\n`);
const L = (name) => `stardust/current/assets/media/${name}`;
const ok = (name, bytes, contentType) => ({ local: L(name), bytes: bytes.length, contentType, status: 'ok' });
const FAIL_LINES = [`fail error ${ORIGIN}/slow.jpg`, `fail http-404 ${ORIGIN}/missing.png`, `fail too-large ${ORIGIN}/big.mp4`, `fail too-large ${ORIGIN}/stream.mp4`];
const FIXED_ARGS = ['--max-bytes', '2000', '--timeout', '0.5'];
let firstMap = null;

await check('e2e run 1: every reference collected once, images downloaded, the 404 / oversize (declared and streamed) / hang recorded, exit 0; the summary and fail lines exact', async () => {
  const r = await run(FIXED_ARGS, site);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [`media-harvest: 12 url(s) from 3 page(s) · downloaded 8 · reused 0 · failed 4 (error ×1, http-404 ×1, too-large ×2) · unresolved 2 relative ref(s) on 1 page(s) without a base URL → stardust/current/assets/media-map.json`, ...FAIL_LINES, ''].join('\n'));
  assert.match(r.err, /orphan\.html: no <base href> and no finalUrl\/url in orphan\.json — 2 relative ref\(s\) skipped/);
  for (const p of ['/theme.css', '/font.woff2', '/commented.png', '/commented.jpg', '/script-only.png', '/not-media.jpg', '/relative.png', '/root-relative.png']) assert.equal(hits.get(p), undefined, `${p} must not be requested`);
  for (const p of ['/img/hero.jpg', '/cdn/hero.jpg', '/img/hero-2x.jpg', '/img/card.webp?v=2', '/img/noext', '/bg/Pattern%20Dark.svg', '/sub/nested.gif', '/redirect/logo', '/img/logo.gif', '/missing.png', '/big.mp4', '/stream.mp4', '/slow.jpg']) assert.equal(hits.get(p), 1, `${p} requested once`);
});

await check('e2e map: the shared format exactly — keyed by source URL, sorted, ok entries with local/bytes/contentType, failures null with status (+ error); the unrelated entry kept', () => {
  firstMap = readFileSync(MAP);
  const map = JSON.parse(firstMap);
  assert.deepEqual(map, {
    [`${ORIGIN}/bg/Pattern%20Dark.svg`]: ok(`pattern-dark-${sha8(SVG)}.svg`, SVG, 'image/svg+xml'),
    [`${ORIGIN}/big.mp4`]: { local: null, bytes: null, contentType: null, status: 'too-large', error: 'content-length 5000 > --max-bytes 2000' },
    [`${ORIGIN}/cdn/hero.jpg`]: ok(`hero-${sha8(HERO)}.jpg`, HERO, 'image/jpeg'),
    [`${ORIGIN}/img/card.webp?v=2`]: ok(`card-${sha8(CARD)}.webp`, CARD, 'image/webp'),
    [`${ORIGIN}/img/hero-2x.jpg`]: ok(`hero-2x-${sha8(HERO2X)}.jpg`, HERO2X, 'image/jpeg'),
    [`${ORIGIN}/img/hero.jpg`]: ok(`hero-${sha8(HERO)}.jpg`, HERO, 'image/jpeg'),
    [`${ORIGIN}/img/noext`]: ok(`noext-${sha8(NOEXT)}.png`, NOEXT, 'image/png'),
    [`${ORIGIN}/missing.png`]: { local: null, bytes: null, contentType: null, status: 'http-404' },
    [`${ORIGIN}/redirect/logo`]: ok(`logo-${sha8(LOGO)}.gif`, LOGO, 'image/gif'),
    [`${ORIGIN}/slow.jpg`]: { local: null, bytes: null, contentType: null, status: 'error', error: 'timeout after 0.5s' },
    [`${ORIGIN}/stream.mp4`]: { local: null, bytes: null, contentType: null, status: 'too-large', error: 'body passed --max-bytes 2000 while streaming' },
    [`${ORIGIN}/sub/nested.gif`]: ok(`nested-${sha8(NESTED)}.gif`, NESTED, 'image/gif'),
    'https://example.test/old.jpg': OLD,
  });
  assert.deepEqual(Object.keys(map), Object.keys(map).sort(), 'keys sorted');
  assert.equal(firstMap.toString(), serializeMap(map), '2-space JSON + trailing newline');
});

await check('e2e files: one file per distinct name with the downloaded bytes (identical bytes under one base share a file); nothing for failures, no tmp files left', () => {
  assert.deepEqual(readdirSync(OUT).sort(), [`card-${sha8(CARD)}.webp`, `hero-${sha8(HERO)}.jpg`, `hero-2x-${sha8(HERO2X)}.jpg`, `logo-${sha8(LOGO)}.gif`, `nested-${sha8(NESTED)}.gif`, `noext-${sha8(NOEXT)}.png`, `pattern-dark-${sha8(SVG)}.svg`].sort());
  assert.ok(readFileSync(join(OUT, `hero-${sha8(HERO)}.jpg`)).equals(HERO)); assert.ok(readFileSync(join(OUT, `card-${sha8(CARD)}.webp`)).equals(CARD));
  assert.deepEqual(readdirSync(dirname(MAP)).sort(), ['media', 'media-map.json']);
});

await check('e2e run 2: no request for an ok entry, every failed entry retried once; the map byte-identical and not rewritten', async () => {
  const before = new Map(hits); const mtime = statSync(MAP).mtimeMs;
  const r = await run(FIXED_ARGS, site);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n')[0], 'media-harvest: 12 url(s) from 3 page(s) · downloaded 0 · reused 8 · failed 4 (error ×1, http-404 ×1, too-large ×2) · unresolved 2 relative ref(s) on 1 page(s) without a base URL → stardust/current/assets/media-map.json');
  const delta = Object.fromEntries([...hits].map(([k, n]) => [k, n - (before.get(k) || 0)]).filter(([, n]) => n));
  assert.deepEqual(delta, { '/missing.png': 1, '/big.mp4': 1, '/stream.mp4': 1, '/slow.jpg': 1 });
  assert.ok(readFileSync(MAP).equals(firstMap), 'map byte-identical'); assert.equal(statSync(MAP).mtimeMs, mtime, 'map not rewritten');
});

await check('e2e clean site: run 2 makes ZERO requests, map byte-identical; a deleted local file is fetched again (one request) under the same name; custom --pages/--out/--map', async () => {
  const clean = join(root, 'clean'); mkdirSync(join(clean, 'site/pages'), { recursive: true });
  writeFileSync(join(clean, 'site/pages/index.json'), `${JSON.stringify({ slug: 'index', url: `${ORIGIN}/` })}\n`);
  writeFileSync(join(clean, 'site/pages/index.html'), '<img src="/img/hero.jpg" srcset="/img/hero-2x.jpg 2x"><img data-src="/img/card.webp?v=2">');
  const args = ['--pages', 'site/pages', '--out', 'media', '--map', 'media-map.json', '--concurrency', '1'];
  const first = await run(args, clean);
  assert.equal(first.code, 0, first.err); assert.equal(first.out, 'media-harvest: 3 url(s) from 1 page(s) · downloaded 3 · reused 0 · failed 0 → media-map.json\n');
  const map1 = readFileSync(join(clean, 'media-map.json'));
  assert.equal(JSON.parse(map1)[`${ORIGIN}/img/hero.jpg`].local, `media/hero-${sha8(HERO)}.jpg`);
  const n = totalHits();
  const second = await run(args, clean);
  assert.equal(second.code, 0, second.err); assert.equal(second.out, 'media-harvest: 3 url(s) from 1 page(s) · downloaded 0 · reused 3 · failed 0 → media-map.json\n');
  assert.equal(totalHits(), n, 'zero requests on the second run');
  assert.ok(readFileSync(join(clean, 'media-map.json')).equals(map1), 'map byte-identical');
  rmSync(join(clean, `media/card-${sha8(CARD)}.webp`));
  const third = await run(args, clean);
  assert.equal(third.out, 'media-harvest: 3 url(s) from 1 page(s) · downloaded 1 · reused 2 · failed 0 → media-map.json\n');
  assert.equal(totalHits(), n + 1, 'only the missing file is fetched');
  assert.ok(readFileSync(join(clean, 'media-map.json')).equals(map1)); assert.ok(readFileSync(join(clean, `media/card-${sha8(CARD)}.webp`)).equals(CARD));
});

await check('a 2xx answer whose content-type is not media (an <iframe data-src> HTML endpoint) → not-media: contentType recorded, no file, retried; octet-stream and no content-type still download', async () => {
  const dir = join(root, 'not-media'); mkdirSync(join(dir, 'pages'), { recursive: true });
  writeFileSync(join(dir, 'pages/index.json'), `${JSON.stringify({ slug: 'index', url: `${ORIGIN}/` })}\n`);
  writeFileSync(join(dir, 'pages/index.html'), '<iframe data-src="/embed/player"></iframe><img data-src="/raw/blob"><img src="/raw/untyped">');
  const args = ['--pages', 'pages', '--out', 'media', '--map', 'm.json'];
  const r = await run(args, dir);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `media-harvest: 3 url(s) from 1 page(s) · downloaded 2 · reused 0 · failed 1 (not-media ×1) → m.json\nfail not-media ${ORIGIN}/embed/player\n`);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')), {
    [`${ORIGIN}/embed/player`]: { local: null, bytes: null, contentType: 'text/html', status: 'not-media' },
    [`${ORIGIN}/raw/blob`]: { local: `media/blob-${sha8(BLOB)}.bin`, bytes: BLOB.length, contentType: 'application/octet-stream', status: 'ok' },
    [`${ORIGIN}/raw/untyped`]: { local: `media/untyped-${sha8(UNTYPED)}.bin`, bytes: UNTYPED.length, contentType: null, status: 'ok' },
  });
  assert.deepEqual(readdirSync(join(dir, 'media')).sort(), [`blob-${sha8(BLOB)}.bin`, `untyped-${sha8(UNTYPED)}.bin`]);
  const n = hits.get('/embed/player');
  const again = await run(args, dir);
  assert.equal(again.code, 0, again.err); assert.equal(hits.get('/embed/player'), n + 1, 'a not-media entry is retried');
});

await check('without --max-bytes a video over the default cap is too-large — a video/* answer and an octet-stream answer at a video URL extension; no file, exit 0; an image beside them downloads; the re-run leaves the map untouched', async () => {
  const dir = join(root, 'video-cap'); mkdirSync(join(dir, 'pages'), { recursive: true });
  writeFileSync(join(dir, 'pages/index.json'), `${JSON.stringify({ slug: 'index', url: `${ORIGIN}/` })}\n`);
  writeFileSync(join(dir, 'pages/index.html'), '<video src="/huge.mp4" poster="/img/hero.jpg"><source src="/raw/huge-clip.mp4" type="video/mp4"></video>');
  const args = ['--pages', 'pages', '--out', 'media', '--map', 'm.json', '--timeout', '2'];
  const r = await run(args, dir);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `media-harvest: 3 url(s) from 1 page(s) · downloaded 1 · reused 0 · failed 2 (too-large ×2) → m.json\nfail too-large ${ORIGIN}/huge.mp4\nfail too-large ${ORIGIN}/raw/huge-clip.mp4\n`);
  const over = { local: null, bytes: null, contentType: null, status: 'too-large', error: `content-length ${VIDEO_MAX_BYTES + 1} > video cap ${VIDEO_MAX_BYTES} (the default without --max-bytes)` };
  const map = readFileSync(join(dir, 'm.json'));
  assert.deepEqual(JSON.parse(map), {
    [`${ORIGIN}/huge.mp4`]: over,
    [`${ORIGIN}/img/hero.jpg`]: { local: `media/hero-${sha8(HERO)}.jpg`, bytes: HERO.length, contentType: 'image/jpeg', status: 'ok' },
    [`${ORIGIN}/raw/huge-clip.mp4`]: over,
  });
  assert.deepEqual(readdirSync(join(dir, 'media')), [`hero-${sha8(HERO)}.jpg`], 'no file for an over-cap video');
  const mtime = statSync(join(dir, 'm.json')).mtimeMs; const before = hits.get('/huge.mp4');
  const again = await run(args, dir);
  assert.equal(again.code, 0, again.err); assert.equal(hits.get('/huge.mp4'), before + 1, 'a too-large entry is retried');
  assert.ok(readFileSync(join(dir, 'm.json')).equals(map), 'map byte-identical'); assert.equal(statSync(join(dir, 'm.json')).mtimeMs, mtime, 'map not rewritten');
});

await check('download(): the video cap also stops a streamed body (no content-length); an explicit --max-bytes replaces the video default; an image is not under the video default', async () => {
  assert.deepEqual(await download(`${ORIGIN}/stream.mp4`, { videoMaxBytes: 2000 }),
    { status: 'too-large', error: 'body passed video cap 2000 (the default without --max-bytes) while streaming' });
  const lifted = await download(`${ORIGIN}/big.mp4`, { maxBytes: 10000, videoMaxBytes: 2000 });
  assert.equal(lifted.status, 'ok', lifted.error); assert.ok(lifted.bytes.equals(BIG));
  const image = await download(`${ORIGIN}/img/hero.jpg`, { videoMaxBytes: 10 });
  assert.equal(image.status, 'ok', image.error); assert.ok(image.bytes.equals(HERO));
});

await check('the map is written after every download: on disk with the first of two files while the second is in flight; a run killed then keeps it; the re-run fetches only the second; the run after that makes no request and leaves the map untouched', async () => {
  const dir = join(root, 'incremental'); mkdirSync(join(dir, 'pages'), { recursive: true });
  writeFileSync(join(dir, 'pages/index.json'), `${JSON.stringify({ slug: 'index', url: `${ORIGIN}/` })}\n`);
  writeFileSync(join(dir, 'pages/index.html'), '<img src="/inc/b.jpg"><img src="/inc/a.jpg">');
  const MAPFILE = join(dir, 'm.json');
  writeFileSync(MAPFILE, serializeMap({ 'https://example.test/old.jpg': OLD }));
  const args = ['--pages', 'pages', '--out', 'media', '--map', 'm.json', '--concurrency', '1'];
  const A = { local: `media/a-${sha8(INC_A)}.jpg`, bytes: INC_A.length, contentType: 'image/jpeg', status: 'ok' };
  const B = { local: `media/b-${sha8(INC_B)}.jpg`, bytes: INC_B.length, contentType: 'image/jpeg', status: 'ok' };
  // --concurrency 1 takes the sorted URLs in order, so /inc/b.jpg is requested only once /inc/a.jpg is done.
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: dir });
  const closed = new Promise((resolve) => { child.on('close', (code, signal) => resolve({ code, signal })); });
  let midRun = null;
  onRequest = (req, res) => {
    if (req.url !== '/inc/b.jpg') return false;
    onRequest = null;
    midRun = readFileSync(MAPFILE, 'utf8');
    hanging.push(res);
    child.kill('SIGKILL');
    return true;
  };
  const end = await closed;
  onRequest = null;
  assert.equal(end.signal, 'SIGKILL', `killed while the second download was in flight (exit ${end.code})`);
  assert.equal(midRun, serializeMap({ [`${ORIGIN}/inc/a.jpg`]: A, 'https://example.test/old.jpg': OLD }), 'the first entry is on disk before the second request');
  assert.equal(readFileSync(MAPFILE, 'utf8'), midRun, 'the killed run kept every finished entry');
  assert.deepEqual(readdirSync(dir).sort(), ['m.json', 'media', 'pages'], 'no tmp file left');
  const resumed = await run(args, dir);
  assert.equal(resumed.code, 0, resumed.err);
  assert.equal(resumed.out, 'media-harvest: 2 url(s) from 1 page(s) · downloaded 1 · reused 1 · failed 0 → m.json\n');
  assert.deepEqual([hits.get('/inc/a.jpg'), hits.get('/inc/b.jpg')], [1, 2], 'only the unfinished file is fetched again');
  const full = readFileSync(MAPFILE);
  assert.equal(full.toString(), serializeMap({ [`${ORIGIN}/inc/a.jpg`]: A, [`${ORIGIN}/inc/b.jpg`]: B, 'https://example.test/old.jpg': OLD }));
  const mtime = statSync(MAPFILE).mtimeMs; const n = totalHits();
  const idle = await run(args, dir);
  assert.equal(idle.out, 'media-harvest: 2 url(s) from 1 page(s) · downloaded 0 · reused 2 · failed 0 → m.json\n');
  assert.equal(totalHits(), n, 'no request'); assert.ok(readFileSync(MAPFILE).equals(full), 'map byte-identical'); assert.equal(statSync(MAPFILE).mtimeMs, mtime, 'map not rewritten');
});

await check('an existing --map that is not a JSON object is refused (exit 2) before any request and left untouched', async () => {
  const bad = join(root, 'bad-map'); mkdirSync(join(bad, 'pages'), { recursive: true });
  writeFileSync(join(bad, 'pages/a.html'), `<img src="${ORIGIN}/img/hero.jpg">`);
  const n = totalHits();
  for (const content of ['[]\n', '{ not json']) {
    writeFileSync(join(bad, 'm.json'), content);
    const r = await run(['--pages', 'pages', '--out', 'media', '--map', 'm.json'], bad);
    assert.equal(r.code, 2, r.err); assert.match(r.err, /--map m\.json is not (a JSON object|valid JSON)/); assert.equal(r.out, '');
    assert.equal(readFileSync(join(bad, 'm.json'), 'utf8'), content);
  }
  assert.equal(totalHits(), n); assert.equal(existsSync(join(bad, 'media')), false);
});

await check('usage errors exit 2 with the synopsis on stderr and write nothing: --pages not a directory, a value flag with no value / followed by a flag, bad numbers, unknown argument', async () => {
  const empty = join(root, 'usage'); mkdirSync(empty);
  for (const args of [[], ['--pages', 'nope'], ['--max-bytes'], ['--timeout', '--concurrency', '2'], ['--concurrency', '0'], ['--bogus'], ['stray']]) {
    const r = await run(args, empty);
    assert.equal(r.code, 2, `${args.join(' ') || '(no args)'}: ${r.err}`); assert.equal(r.out, '');
    assert.match(r.err, /^media-harvest: /); assert.match(r.err, /usage: node media-harvest\.mjs .*--max-bytes <n>/);
  }
  const named = await run(['--timeout', '--concurrency', '2'], empty); assert.match(named.err, /--timeout needs a value/);
  const notDir = await run(['--pages', 'nope'], empty); assert.match(notDir.err, /--pages nope is not a directory/);
  assert.deepEqual(readdirSync(empty), []);
});

await check('--help (and -h, and alongside a bad flag) in an empty cwd: exit 0, the usage header, nothing written', async () => {
  const cwd = join(root, 'help'); mkdirSync(cwd);
  for (const args of [['--help'], ['-h'], ['--bogus', '--help']]) {
    const r = await run(args, cwd);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /Usage:/); assert.doesNotMatch(r.out, /\/\*\*/);
    for (const f of ['--pages <dir>', '--out <dir>', '--map <file>', '--concurrency <n>', '--max-bytes <n>', '--timeout <s>', '--assets <kinds>', '--assets-dir <dir>', '--harvest-map <file>', '--max-total-bytes <n>', 'harvest-map.json', '<assets-dir>/<kind>/<base>-<hash8>.<ext>   one file', 'Exit codes:']) assert.ok(r.out.includes(f), `header names ${f}`);
    assert.ok(r.out.includes(`${VIDEO_MAX_BYTES} bytes`), 'header states the video default cap');
  }
  assert.deepEqual(readdirSync(cwd), []);
});

await check('invoked through a symlink the script still acts (real-path main-module guard, not a silent no-op)', async () => {
  const link = join(root, 'media-harvest-link.mjs'); symlinkSync(SCRIPT, link);
  const r = await new Promise((resolve) => { const p = spawn(process.execPath, [link, '--pages', 'nope'], { cwd: root }); let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => resolve({ code, err })); });
  assert.equal(r.code, 2); assert.match(r.err, /--pages nope is not a directory/);
});

for (const res of hanging) res.destroy();
server.closeAllConnections();
await new Promise((resolve) => { server.close(resolve); });

// ---- part (c): the browser path behind a wall that refuses every non-browser client -------------------
// The fixture wall answers any request without a Sec-Fetch-Dest header — every Node fetch, the media path's
// included — with a 200 HTML denial page, the way a CDN wall answered a recorded hands-off run's direct fetches
// while its browser captures were never blocked. Runs only where playwright is importable (a project copy).
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; }
if (!chromium) {
  console.log('skip  e2e browser path (playwright not importable here)');
  await check('--assets sheets without playwright importable: exit 2 naming the project-copy setup, nothing written', async () => {
    const cwd = join(root, 'nopw'); mkdirSync(join(cwd, 'stardust/current/pages'), { recursive: true });
    writeFileSync(join(cwd, 'stardust/current/pages/home.html'), '<html></html>');
    writeFileSync(join(cwd, 'stardust/current/pages/home.json'), '{"url":"http://127.0.0.1:9/"}');
    const r = await run(['--assets', 'sheets'], cwd);
    assert.equal(r.code, 2, r.err); assert.match(r.err, /playwright is not importable/);
    assert.equal(existsSync(join(cwd, 'stardust/current/assets')), false);
  });
} else {
  const SHEET = Buffer.from('@import url("/css/theme.css");\n@font-face { font-family: Used; src: url(/fonts/used.woff2) format("woff2"); }\n@font-face { font-family: Unused; src: url("../fonts/unused.woff2") format("woff2"); }\n@font-face { font-family: Huge; src: url(/fonts/huge.woff2) format("woff2"); }\n.used { font-family: Used } .icon { background: url(/img/icon.svg) } .gone { background: url(/img/missing.svg) }\n');
  const THEME = Buffer.from('body { margin: 0 }\n');
  const FONT_A = fill(20, 600); const FONT_B = fill(21, 700); const FONT_HUGE = fill(22, 9000);
  const LOGO_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const ICON_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><circle r="2" cx="2" cy="2"/></svg>');
  const PAGE = '<!doctype html><html><head><link rel="stylesheet" href="/css/site.css"></head><body><p class="used">text</p><img src="/img/logo.svg" alt=""><img src="/img/photo.png" alt=""></body></html>';
  const WALL = { '/page': ['text/html', Buffer.from(PAGE)], '/css/site.css': ['text/css', SHEET], '/css/theme.css': ['text/css; charset=utf-8', THEME],
    '/fonts/used.woff2': ['font/woff2', FONT_A], '/fonts/unused.woff2': ['font/woff2', FONT_B], '/fonts/huge.woff2': ['font/woff2', FONT_HUGE],
    '/img/logo.svg': ['image/svg+xml', LOGO_SVG], '/img/icon.svg': ['image/svg+xml', ICON_SVG], '/img/photo.png': ['image/png', fill(23, 50)] };
  const DENIAL = Buffer.from('<!doctype html><title>System Down</title><h1>System Down</h1>');
  const STALL_SHEET = Buffer.from('@font-face { font-family: Stall; src: url(/fonts/stall.woff2) format("woff2"); }\n');
  WALL['/stall-page'] = ['text/html', Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="/css/stall.css"></head><body><p>x</p></body></html>')];
  WALL['/css/stall.css'] = ['text/css', STALL_SHEET];
  const stalled = [];
  const wallHits = []; let denyAll = false;
  const wall = createServer((req, res) => {
    const browser = Boolean(req.headers['sec-fetch-dest']);
    wallHits.push([req.url, browser]);
    // the CSS wants the fonts cross-origin-safe; the fixture serves them like a font CDN does
    res.setHeader('access-control-allow-origin', '*');
    if (!browser || (denyAll && req.url !== '/page')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(DENIAL); return; }
    if (req.url === '/fonts/stall.woff2') { // headers and a first chunk, then nothing: the body never completes
      res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': 4000 }); res.write(fill(30, 100)); stalled.push(res); return;
    }
    const r = WALL[req.url];
    if (!r) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>not found</h1>'); return; }
    res.writeHead(200, { 'content-type': r[0], 'content-length': r[1].length }); res.end(r[1]);
  });
  await new Promise((resolve) => { wall.listen(0, '127.0.0.1', resolve); });
  const W = `http://127.0.0.1:${wall.address().port}`;
  const wsite = join(root, 'wall');
  mkdirSync(join(wsite, 'stardust/current/pages'), { recursive: true });
  writeFileSync(join(wsite, 'stardust/current/pages/home.json'), `${JSON.stringify({ slug: 'home', url: `${W}/page` })}\n`);
  writeFileSync(join(wsite, 'stardust/current/pages/home.html'), PAGE);
  const HMAP = join(wsite, 'stardust/current/assets/harvest-map.json');
  const at = (kind, name, bytes, contentType) => ({ local: `stardust/current/assets/${kind}/${name}-${sha8(bytes)}.${kind === 'sheets' ? 'css' : kind === 'fonts' ? 'woff2' : 'svg'}`, bytes: bytes.length, contentType, status: 'ok', kind });
  const ARGS = ['--assets', 'sheets,fonts,svg', '--max-bytes', '5000'];
  let firstHarvest = null;

  await check('the wall: a Node fetch (the media path\'s client) of a stylesheet gets the 200 denial page', async () => {
    const r = await download(`${W}/css/site.css`);
    assert.equal(r.status, 'not-media'); assert.equal(r.contentType, 'text/html');
  });

  await check('e2e browser run 1: sheets (+ the @import), the used font AND the unused one (forced), the used svg AND the CSS-only one (forced) harvested through the browser; the over-cap font too-large, the missing svg http-404; no media, no media map; exit 0', async () => {
    wallHits.length = 0;
    const r = await run(ARGS, wsite);
    assert.equal(r.code, 0, r.err);
    const m = JSON.parse(readFileSync(HMAP, 'utf8'));
    assert.deepEqual(m, {
      [`${W}/css/site.css`]: at('sheets', 'site', SHEET, 'text/css'),
      [`${W}/css/theme.css`]: at('sheets', 'theme', THEME, 'text/css'),
      [`${W}/fonts/huge.woff2`]: { local: null, bytes: null, contentType: null, status: 'too-large', kind: 'fonts', error: `content-length 9000 > --max-bytes 5000` },
      [`${W}/fonts/unused.woff2`]: at('fonts', 'unused', FONT_B, 'font/woff2'),
      [`${W}/fonts/used.woff2`]: at('fonts', 'used', FONT_A, 'font/woff2'),
      [`${W}/img/icon.svg`]: at('svg', 'icon', ICON_SVG, 'image/svg+xml'),
      [`${W}/img/logo.svg`]: at('svg', 'logo', LOGO_SVG, 'image/svg+xml'),
      [`${W}/img/missing.svg`]: { local: null, bytes: null, contentType: null, status: 'http-404', kind: 'svg' },
    });
    assert.deepEqual(Object.keys(m), Object.keys(m).sort(), 'keys sorted');
    assert.equal(r.out.split('\n')[0], `media-harvest (browser): 8 asset(s) from 1 page(s) — sheets 2 · fonts 3 · svg 3 · downloaded 6 · reused 0 · failed 2 (http-404 ×1, too-large ×1) → stardust/current/assets/harvest-map.json`);
    for (const [k, e] of Object.entries(m)) if (e.status === 'ok') assert.ok(readFileSync(join(wsite, e.local)).equals(WALL[new URL(k).pathname][1]), `${e.local} holds the served bytes`);
    assert.equal(existsSync(join(wsite, 'stardust/current/assets/media-map.json')), false, 'the media path did not run');
    assert.equal(existsSync(join(wsite, 'stardust/current/assets/media')), false);
    assert.ok(wallHits.length > 0 && wallHits.every(([, browser]) => browser), 'every request of the run came from the browser');
    firstHarvest = readFileSync(HMAP);
  });

  await check('e2e browser run 2: the harvest map byte-identical (every ok entry reused), exit 0', async () => {
    const r = await run(ARGS, wsite);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^media-harvest \(browser\): 8 asset\(s\) from 1 page\(s\) — sheets 2 · fonts 3 · svg 3 · downloaded 0 · reused 6 · failed 2 /);
    assert.ok(readFileSync(HMAP).equals(firstHarvest), 'byte-identical');
  });

  await check('e2e browser run 3: when the wall later denies the browser too, a denial answer never replaces an ok entry whose file is on disk (kept, counted reused)', async () => {
    denyAll = true;
    try {
      const r = await run(ARGS, wsite);
      assert.equal(r.code, 0, r.err);
      assert.ok(readFileSync(HMAP).equals(firstHarvest), 'the map is unchanged');
    } finally { denyAll = false; }
  });

  await check('a font whose body stalls after its headers is an `error` after --timeout (the body read and the in-page load are bounded): the run ends, the page counts as opened, the sheet beside it is ok', async () => {
    const stall = join(root, 'wall-stall'); mkdirSync(join(stall, 'stardust/current/pages'), { recursive: true });
    writeFileSync(join(stall, 'stardust/current/pages/home.json'), `${JSON.stringify({ slug: 'home', url: `${W}/stall-page` })}\n`);
    writeFileSync(join(stall, 'stardust/current/pages/home.html'), '<html></html>');
    const t0 = Date.now();
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [SCRIPT, '--assets', 'sheets,fonts', '--timeout', '1'], { cwd: stall });
      let out = ''; let err = '';
      const kill = setTimeout(() => p.kill('SIGKILL'), 60000);
      p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => { clearTimeout(kill); resolve({ code, out, err }); });
    });
    assert.equal(r.code, 0, `exit ${r.code} after ${Date.now() - t0} ms: ${r.err}`);
    const h = JSON.parse(readFileSync(join(stall, 'stardust/current/assets/harvest-map.json'), 'utf8'));
    assert.equal(h[`${W}/css/stall.css`].status, 'ok');
    assert.equal(h[`${W}/fonts/stall.woff2`].status, 'error');
    assert.match(h[`${W}/fonts/stall.woff2`].error, /timeout after 1s/);
    assert.doesNotMatch(r.out, /not opened/);
  });

  await check('--assets media,sheets runs both paths: the media path (Node) is refused by the wall (photo.png not-media in media-map.json), the browser path harvests the sheets into harvest-map.json; --max-total-bytes stops the run total', async () => {
    const both = join(root, 'wall-both'); mkdirSync(join(both, 'stardust/current/pages'), { recursive: true });
    writeFileSync(join(both, 'stardust/current/pages/home.json'), `${JSON.stringify({ slug: 'home', url: `${W}/page` })}\n`);
    writeFileSync(join(both, 'stardust/current/pages/home.html'), PAGE);
    const r = await run(['--assets', 'media,sheets', '--max-total-bytes', String(SHEET.length + 1)], both);
    assert.equal(r.code, 0, r.err);
    const media = JSON.parse(readFileSync(join(both, 'stardust/current/assets/media-map.json'), 'utf8'));
    assert.equal(media[`${W}/img/photo.png`].status, 'not-media');
    const h = JSON.parse(readFileSync(join(both, 'stardust/current/assets/harvest-map.json'), 'utf8'));
    assert.deepEqual(Object.keys(h).sort(), [`${W}/css/site.css`, `${W}/css/theme.css`]);
    const statuses = Object.values(h).map((e) => e.status).sort();
    assert.deepEqual(statuses, ['ok', 'too-large'], 'the second sheet passes the run total');
    assert.match(Object.values(h).find((e) => e.status === 'too-large').error, /--max-total-bytes/);
  });

  for (const res of stalled) res.destroy();
  wall.closeAllConnections();
  await new Promise((resolve) => { wall.close(resolve); });
}

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nmedia-harvest: all checks passed');
process.exit(failed ? 1 : 0);
