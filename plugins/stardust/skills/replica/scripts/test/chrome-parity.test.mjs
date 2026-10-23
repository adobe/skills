#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — chrome-parity.mjs: collapseOffset (a region moved by one Δy is
// one advisory OFFSET line — never texts moved inside a box that did not), compareRegion on hand-built probes (icons
// paired by pixels, a low nav row vs a shifted header), --live-cache ignoring another probe version, --help with no
// browser; then end to end where playwright is importable (a skip line otherwise): a live page with no
// <header> (auto-detected), its footer background on <footer> and an inline-svg logo, against a build with a <header>,
// the footer background on an inner wrapper, display:contents column titles, the logo as an <img> and 200 px more
// content above the footer — only the advisory OFFSET remains. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBE_VERSION, cacheKey, collapseOffset, compareRegion, readLiveCache } from '../chrome-parity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'chrome-parity.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// ---- pure ------------------------------------------------------------------------------------------
const dy = (kind, text, d, from) => ({ kind, text, msg: `Δy ${d > 0 ? '+' : ''}${d}px (${from}→${from + d})` });
await check('collapseOffset: a box and all its ≥ 2 paired texts moved by one Δy (±2 px) → one advisory OFFSET; other findings kept; mixed shifts untouched', () => {
  const out = collapseOffset([dy('REGION BOX', null, 3526, 34970), dy('PAIR', 'AI', 3527, 35090), dy('PAIR', 'Media', 3526, 35234), { kind: 'MISSING', text: 'Blog', msg: 'live <a> "Blog" has no build element with the same text' }], 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, 'OFFSET'); assert.equal(out[0].advisory, true);
  assert.match(out[0].msg, /^the region and its 2 paired text\(s\) sit Δy \+3526px from live as one block — content identical/);
  assert.equal(out[1].kind, 'MISSING');
  const mixed = [dy('PAIR', 'a', 10, 0), dy('PAIR', 'b', 40, 0), dy('PAIR', 'c', 10, 0)];
  assert.deepEqual(collapseOffset(mixed, 3), mixed);
  const one = [dy('REGION BOX', null, 10, 0), dy('PAIR', 'a', 10, 0)];
  assert.deepEqual(collapseOffset(one, 1), one, 'a region with one paired text stays as it is');
  const withWidth = [dy('REGION BOX', null, 10, 0), dy('PAIR', 'a', 10, 0), dy('PAIR', 'b', 10, 0), { kind: 'PAIR', text: 'c', msg: 'Δy +10px (0→10), Δw +4px (100→104)' }];
  assert.deepEqual(collapseOffset(withWidth, 3).map((f) => f.kind), ['OFFSET', 'PAIR'], 'a pair with more than a Δy is kept beside the offset');
});
await check('collapseOffset: texts moved inside a box that did not, or only some texts moved with the box → real deltas, not collapsed', () => {
  const navLow = [dy('PAIR', 'Pricing', 8, 20), dy('PAIR', 'Login', 8, 20), dy('PAIR', 'Docs', 8, 20)];
  assert.deepEqual(collapseOffset(navLow, 3), navLow, 'no REGION BOX: the box did not move');
  const boxWide = [{ kind: 'REGION BOX', msg: 'Δy +8px (0→8), Δh +8px (64→72)' }, ...navLow];
  assert.deepEqual(collapseOffset(boxWide, 3), boxWide, 'the box changed more than a Δy');
  const some = [dy('REGION BOX', null, 8, 0), ...navLow];
  assert.deepEqual(collapseOffset(some, 5), some, '3 of 5 paired texts moved');
  const otherDy = [dy('REGION BOX', null, 40, 0), ...navLow];
  assert.deepEqual(collapseOffset(otherDy, 3), otherDy, 'the texts moved by another Δy than the box');
});
const atom = (text, y) => ({ key: text.toLowerCase(), text, tag: 'a', boxTag: 'a', rect: { x: 24, y, w: 60, h: 24 }, box: { x: 24, y, w: 60, h: 24 }, style: { color: 'rgb(0, 0, 0)' }, boxStyle: null });
const nav = (y) => ['Pricing', 'Login', 'Docs'].map((t) => atom(t, y));
const logo = Array.from({ length: 12 * 12 * 3 }, (_, i) => (Math.floor(i / 3) % 3 ? 40 : 230)); // a 12×12 RGB grid, grey
const probe = (o = {}) => ({ found: true, sel: 'footer', rect: { x: 0, y: 1000, w: 800, h: 200 }, position: 'static', backgroundColor: 'rgb(18, 23, 55)', atoms: [], icons: [], ...o });
await check('compareRegion: icons with other file names but the same pixels are no delta; different pixels with another name are', () => {
  const icon = (sig, px) => ({ tag: 'img', rect: { x: 10, y: 1010, w: 80, h: 80 }, sig, px, near: 'case study' });
  const same = compareRegion('footer', probe({ icons: [icon('thumb.webp', logo)] }), probe({ icons: [icon('media_1a2b.webp', logo)] }), 1);
  assert.deepEqual(same.findings, []);
  const other = compareRegion('footer', probe({ icons: [icon('thumb.webp', logo)] }), probe({ icons: [icon('media_9z.webp', logo.map((v) => 255 - v))] }), 1);
  assert.deepEqual(other.findings.map((f) => f.kind), ['ICON']);
});
await check('compareRegion: a fixed-height header whose links all sit 8 px low → 3 counted PAIR deltas (exit 2); the header and its links all 8 px low → one advisory OFFSET (exit 0)', () => {
  const hdr = (y, links) => probe({ sel: 'header', rect: { x: 0, y, w: 800, h: 64 }, atoms: nav(links) });
  const low = compareRegion('header', hdr(0, 20), hdr(0, 28), 1);
  assert.deepEqual(low.findings.map((f) => f.kind), ['PAIR', 'PAIR', 'PAIR']);
  assert.equal(low.findings.filter((f) => !f.advisory).length, 3);
  const block = compareRegion('header', hdr(0, 20), hdr(8, 28), 1);
  assert.deepEqual(block.findings.map((f) => [f.kind, Boolean(f.advisory)]), [['OFFSET', true]]);
  assert.match(block.findings[0].msg, /^the region and its 3 paired text\(s\) sit Δy \+8px/);
});
await check('--live-cache: a cache from another probe version (or none recorded) is ignored and re-probed; the current one is reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-parity-'));
  const opts = { width: 1440, regions: [{ name: 'header', live: 'header' }] };
  const file = join(dir, 'chrome-live.json');
  try {
    const oldKey = cacheKey('https://x.test/', opts); delete oldKey.probe;
    writeFileSync(file, JSON.stringify({ key: oldKey, probedAt: 'then', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts), null, 'a pre-version cache');
    writeFileSync(file, JSON.stringify({ key: { ...oldKey, probe: PROBE_VERSION - 1 }, probedAt: 'then', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts), null, 'an older probe version');
    writeFileSync(file, JSON.stringify({ key: cacheKey('https://x.test/', opts), probedAt: 'now', data: {} }));
    assert.equal(readLiveCache(file, 'https://x.test/', opts).probedAt, 'now');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('--help answers with no browser', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^chrome-parity — /);
});

// ---- end to end (needs playwright) -----------------------------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end chrome-parity (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const mark = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="#fff"/><circle cx="12" cy="12" r="10" fill="#e33"/></svg>';
  const css = '<style>body{margin:0;font:16px/24px Arial}.bar{position:fixed;top:0;left:0;right:0;height:64px;background:#fff;display:flex;gap:24px;align-items:center;padding:0 24px}.bar a{color:#123;text-decoration:none}main{padding-top:64px}.fill{height:900px}footer{color:#fff}h3{margin:0;font-size:14px}.cols{display:flex;gap:40px;padding:32px}.cols>div{display:flex;flex-direction:column}</style>';
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${body}</body></html>`;
  const footerCols = (titleTag) => `<div class="cols"><div><${titleTag}>Trending</${titleTag}><a href="/t">Topics</a></div><div><${titleTag}>Company</${titleTag}><a href="/a">About</a></div></div>`;
  const pages = {
    '/live.html': page(`<div class="bar megaMenuWrapper"><a href="/">${mark}</a><a href="/p">Pricing</a><a href="/l">Login</a></div><main><div class="fill"></div></main>`
      + `<footer style="background:#121737">${footerCols('div')}</footer>`),
    '/build.html': page(`<header class="bar"><a href="/"><img src="data:image/svg+xml,${encodeURIComponent(mark)}" width="40" height="24" alt=""></a><a href="/p">Pricing</a><a href="/l">Login</a></header><main><div class="fill"></div><div style="height:200px"></div></main>`
      + `<footer><div style="background:#121737">${footerCols('h3').replace(/<h3>/g, '<h3 style="display:contents">')}</div></footer>`),
  };
  // the live side's footer titles are divs with the same look as the build's h3
  pages['/live.html'] = pages['/live.html'].replace('</style>', '.cols div>div{font-size:14px;font-weight:700}</style>');
  const server = createServer((req, res) => {
    const body = pages[req.url.split('?')[0]];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await new Promise((resolveRun) => {
    const child = spawn(process.execPath, [SCRIPT, `${base}/live.html`, `${base}/build.html`, '--width', '800']);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
  await check('e2e: the live header is auto-detected; display:contents titles pair; the painted footer background matches; the svg logo and its <img> are the same icon; the 200 px shift is one advisory OFFSET — exit 0', () => {
    assert.match(r.stdout, /\(live has no <header>: auto-detected div\.bar\.megaMenuWrapper — pass --region header=/, r.stdout);
    assert.match(r.stdout, /■ header: ✓ parity — 2 paired of 2\/2 texts/, r.stdout);
    assert.match(r.stdout, /■ footer: ✓ parity — 4 paired of 4\/4 texts/, r.stdout);
    assert.match(r.stdout, /OFFSET +the region and its 4 paired text\(s\) sit Δy \+200px from live as one block/, r.stdout);
    assert.doesNotMatch(r.stdout, /REGION STYLE|MISSING|ICON +/, r.stdout);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  server.close();
}

console.log(failed ? `\n${failed} failing` : '\nchrome-parity: all checks passed');
process.exit(failed ? 1 : 0);
