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

const fav = { file: 'stardust/current/assets/favicon.ico', url: 'https://x/favicon.ico' };
const set = { icons: [{ file: 'a.png' }, { file: null }], largestRaster: '180x180' };
assert.deepEqual(faviconLines(fav, null), ['[crawl] favicon captured: stardust/current/assets/favicon.ico (https://x/favicon.ico)'], 'favicon captured + set skipped (--no-assets) → no WARN');
assert.equal(faviconLines(null, set).filter((l) => l.startsWith('[crawl] WARN')).length, 0, 'set landed → no WARN');
assert.match(faviconLines(null, set)[0], /favicon set: 1 icon\(s\) .* \(largest raster 180x180\)/);
const none = faviconLines(null, null); assert.equal(none.length, 1, 'neither → one line'); assert.ok(none[0].startsWith('[crawl] WARN no favicon captured'), 'neither → the WARN');
assert.equal(faviconLines(fav, set).length, 2, 'both → two lines');
console.log('asset-pages test: ok (fonts attributed to the requesting pages, untagged entries run-wide, favicon lines never warn on a captured icon)');
