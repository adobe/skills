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
// again; a map that
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
  DEFAULTS, MAX_FAIL_LINES, baseName, cssUrls, extFor, extractRefs, hash8, mediaFileName, mergeMap, pageMedia,
  parseArgs, parseSrcset, resolveRef, serializeMap, summarize, urlExt,
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
  assert.deepEqual(parseArgs([]), { ...DEFAULTS });
  assert.deepEqual(DEFAULTS, { pages: 'stardust/current/pages', out: 'stardust/current/assets/media', map: 'stardust/current/assets/media-map.json', concurrency: 4, maxBytes: null, timeout: 30 });
  assert.deepEqual(parseArgs(['--pages', 'p', '--out', 'o', '--map', 'm.json', '--concurrency', '2', '--max-bytes', '1000', '--timeout', '0.5']),
    { pages: 'p', out: 'o', map: 'm.json', concurrency: 2, maxBytes: 1000, timeout: 0.5 });
  const usage = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), argv.join(' '));
  usage(['--max-bytes'], /^--max-bytes needs a value/); usage(['--timeout', '--concurrency', '2'], /^--timeout needs a value/); usage(['--pages'], /^--pages needs a value/);
  usage(['--concurrency', '0'], /--concurrency needs an integer ≥ 1/); usage(['--max-bytes', '1.5'], /--max-bytes needs an integer/); usage(['--timeout', '0'], /--timeout needs a number/); usage(['--timeout', 'x'], /--timeout needs a number/);
  usage(['--bogus'], /unknown argument --bogus/); usage(['pages'], /unknown argument pages/);
});

// ---- part (b): end-to-end against 127.0.0.1 ---------------------------------------------------------
const fill = (seed, n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256));
const HERO = fill(1, 300); const HERO2X = fill(2, 400); const CARD = fill(3, 500); const NOEXT = fill(4, 200);
const NESTED = fill(5, 120); const LOGO = fill(6, 140); const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'); const BIG = fill(7, 5000);
const BLOB = fill(8, 90); const UNTYPED = fill(9, 80);
const ROUTES = {
  '/img/hero.jpg': ['image/jpeg', HERO], '/cdn/hero.jpg': ['image/jpeg', HERO], '/img/hero-2x.jpg': ['image/jpeg', HERO2X],
  '/img/card.webp?v=2': ['image/webp; charset=binary', CARD], '/img/noext': ['image/png', NOEXT], '/bg/Pattern%20Dark.svg': ['image/svg+xml', SVG],
  '/sub/nested.gif': ['image/gif', NESTED], '/img/logo.gif': ['image/gif', LOGO], '/big.mp4': ['video/mp4', BIG],
  '/embed/player': ['Text/HTML; charset=utf-8', Buffer.from('<!doctype html><title>player</title>')], '/raw/blob': ['application/octet-stream', BLOB], '/raw/untyped': [null, UNTYPED],
};
const hits = new Map();
const hanging = [];
const server = createServer((req, res) => {
  hits.set(req.url, (hits.get(req.url) || 0) + 1);
  res.on('error', () => {}); req.socket.on('error', () => {});
  if (req.url === '/redirect/logo') { res.writeHead(302, { location: '/img/logo.gif' }); res.end(); return; }
  if (req.url === '/slow.jpg') { hanging.push(res); return; }
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
    for (const f of ['--pages <dir>', '--out <dir>', '--map <file>', '--concurrency <n>', '--max-bytes <n>', '--timeout <s>', 'Exit codes:']) assert.ok(r.out.includes(f), `header names ${f}`);
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
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nmedia-harvest: all checks passed');
process.exit(failed ? 1 : 0);
