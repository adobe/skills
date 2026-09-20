#!/usr/bin/env node
// Fixture test: crawl.mjs asset attribution + favicon lines (no browser — fake Playwright page/response objects).
//   * attachAssetRecorder tags every store entry with the pages (slugs) that requested it; fontUrlsFor(store, slug)
//     returns only the fonts THAT page loaded (before the fix every run-wide font was emitted for every page, so
//     _fonts-manifest.json#fonts[].pages named every page processed after the first capture);
//   * faviconLines(): a captured favicon is never reported missing when the icon set was skipped (--no-assets);
//     one WARN only when neither landed.
// Usage: node plugins/stardust/skills/extract/scripts/test/asset-pages.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { attachAssetRecorder, fontUrlsFor, faviconLines } from '../crawl.mjs';

const fakePage = () => { const h = {}; return { on(ev, cb) { h[ev] = cb; }, emit(ev, x) { h[ev](x); } }; };
const resp = (url, type, ct = 'font/woff2') => ({ url: () => url, request: () => ({ resourceType: () => type }), headers: () => ({ 'content-type': ct }), status: () => 200, body: async () => Buffer.from('x') });

const store = new Map();
const a = fakePage(); const recA = attachAssetRecorder(a, store, { slug: 'a' });
a.emit('response', resp('https://x/f1.woff2', 'font'));
a.emit('response', resp('https://x/img.png', 'image', 'image/png'));
await recA.settle();
const b = fakePage(); const recB = attachAssetRecorder(b, store, { slug: 'b' });
b.emit('response', resp('https://x/f1.woff2', 'font')); // page b loads f1 too (already captured → tagged, not re-buffered)
b.emit('response', resp('https://x/f2.woff2', 'font'));
await recB.settle();
assert.deepEqual([...store.get('https://x/f1.woff2').pages].sort(), ['a', 'b'], 'f1 is attributed to both pages');
assert.deepEqual([...store.get('https://x/f2.woff2').pages], ['b'], 'f2 only to page b');
assert.deepEqual(fontUrlsFor(store, 'a'), ['https://x/f1.woff2'], 'page a loaded f1 only — f2 is not emitted for it');
assert.deepEqual(fontUrlsFor(store, 'b').sort(), ['https://x/f1.woff2', 'https://x/f2.woff2']);
store.set('https://x/f3.woff2', { kind: 'font', bytes: Buffer.from('y'), source: 'fetch' }); // an untagged entry (legacy) still belongs to every page
assert.ok(fontUrlsFor(store, 'a').includes('https://x/f3.woff2'), 'untagged entries keep the run-wide attribution');
assert.equal(store.get('https://x/f1.woff2').bytes.length, 1, 'captured once per run');

// concurrent pages (--concurrency > 1): both first responses for the same font are in flight — the entry is a
// placeholder from the first sighting, so the racer tags it; the body lands once; the loser's settle waits for it.
// Before the fix the entry was written only when resp.body() resolved, so both racers saw an empty store, the
// first body stored an entry tagged with ITS slug only and the second returned untagged (fonts under-attributed).
const deferred = () => { let res; const promise = new Promise((r) => { res = r; }); return { promise, res }; };
const slow = (url, d) => ({ ...resp(url, 'font'), body: () => d.promise });
const c = fakePage(); const recC = attachAssetRecorder(c, store, { slug: 'c' });
const d = fakePage(); const recD = attachAssetRecorder(d, store, { slug: 'd' });
const bodyC = deferred(); const bodyD = deferred();
c.emit('response', slow('https://x/shared.woff2', bodyC));
d.emit('response', slow('https://x/shared.woff2', bodyD)); // in flight on c → tagged, not re-buffered
assert.equal(store.get('https://x/shared.woff2').pending, true, 'placeholder written before the body settles');
assert.deepEqual([...store.get('https://x/shared.woff2').pages].sort(), ['c', 'd'], 'the racer tags the placeholder');
let dSettled = false; const dWait = recD.settle().then(() => { dSettled = true; });
await new Promise((r) => { setTimeout(r, 5); });
assert.equal(dSettled, false, 'page d\'s settle waits for the body in flight on page c');
bodyC.res(Buffer.from('xy')); bodyD.res(Buffer.from('zz'));
await recC.settle(); await dWait;
const shared = store.get('https://x/shared.woff2');
assert.equal(shared.bytes.toString(), 'xy', 'one body stored (the first to settle)'); assert.equal(shared.pending, undefined);
assert.deepEqual([...shared.pages].sort(), ['c', 'd'], 'both racing pages stay attributed after the body lands');
assert.ok(fontUrlsFor(store, 'd').includes('https://x/shared.woff2') && fontUrlsFor(store, 'c').includes('https://x/shared.woff2'));
// the 4xx branch keeps the pages an earlier page recorded (before the fix it built a fresh object and dropped them)
const r404 = (url) => ({ ...resp(url, 'font'), status: () => 404 });
c.emit('response', r404('https://x/missing.woff2')); d.emit('response', r404('https://x/missing.woff2'));
assert.deepEqual([...store.get('https://x/missing.woff2').pages].sort(), ['c', 'd'], '4xx entries merge pages across pages');
assert.equal(store.get('https://x/missing.woff2').error, 'HTTP 404');

const fav = { file: 'stardust/current/assets/favicon.ico', url: 'https://x/favicon.ico' };
const set = { icons: [{ file: 'a.png' }, { file: null }], largestRaster: '180x180' };
assert.deepEqual(faviconLines(fav, null), ['[crawl] favicon captured: stardust/current/assets/favicon.ico (https://x/favicon.ico)'], 'favicon captured + set skipped (--no-assets) → no WARN');
assert.equal(faviconLines(null, set).filter((l) => l.startsWith('[crawl] WARN')).length, 0, 'set landed → no WARN');
assert.match(faviconLines(null, set)[0], /favicon set: 1 icon\(s\) .* \(largest raster 180x180\)/);
const none = faviconLines(null, null); assert.equal(none.length, 1, 'neither → one line'); assert.ok(none[0].startsWith('[crawl] WARN no favicon captured'), 'neither → the WARN');
assert.equal(faviconLines(fav, set).length, 2, 'both → two lines');
console.log('asset-pages test: ok (fonts attributed to the requesting pages, concurrent first sightings tag one placeholder, 4xx merges pages, untagged entries run-wide, favicon lines never warn on a captured icon)');
