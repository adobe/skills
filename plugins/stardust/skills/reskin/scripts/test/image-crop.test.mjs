#!/usr/bin/env node
// skills/reskin/scripts/test/image-crop.test.mjs — the content gate's image-crop measures (source-normalize.mjs
// visibleRegion + compareRegions: which area shows, gating; visibleFraction + compareCrops: how much, informational; IMG_CROP): how much of an image each object-fit shows in a box, how clipping
// ancestors compound it, and when a rendered image counts as cut more than the source. Pure, no network, no browser.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { visibleFraction, visibleRegion, compareCrops, compareRegions, IMG_CROP } from '../source-normalize.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≉ ${b}`);
const img = (naturalWidth, naturalHeight, boxWidth, boxHeight, fit, clipFraction) => visibleFraction({ naturalWidth, naturalHeight, boxWidth, boxHeight, fit, clipFraction });

check('cover: a square portrait in a 16:9 frame shows 9/16 of its area', () => near(img(750, 750, 574, 324, 'cover'), 324 / 574));
check('cover: an image already the frame\'s shape shows all of it', () => near(img(1148, 648, 574, 324, 'cover'), 1));
check('cover: a tall 9:16 story in a 5:3 card shows about a third', () => near(img(1080, 1920, 367, 220, 'cover'), (220 / 367) * (1080 / 1920)));
check('cover is independent of scale (a 2x source crops the same)', () => near(img(1500, 1500, 574, 324, 'cover'), img(750, 750, 574, 324, 'cover')));
check('fill, contain and scale-down draw every pixel', () => {
  for (const fit of ['fill', 'contain', 'scale-down']) near(img(750, 750, 574, 324, fit), 1);
});
check('none: a natural-size image larger than its box shows the overlap', () => near(img(800, 600, 400, 600, 'none'), 0.5));
check('none: an image smaller than its box shows all of it', () => near(img(200, 100, 400, 300, 'none'), 1));
check('a clipping ancestor compounds the fit', () => near(img(1148, 648, 574, 324, 'cover', 0.5), 0.5));
check('an unknown size (lazy image never loaded) is unmeasured, not 0', () => {
  assert.equal(img(0, 0, 574, 324, 'cover'), null);
  assert.equal(img(750, 750, 0, 0, 'cover'), null);
});

const f = (fraction, label = '') => ({ fraction, label, box: '574x324', fit: 'cover', natural: '750x750' });
check('compareCrops: a render cut far more than the source fails, naming the image', () => {
  const r = compareCrops([f(0.96, 'Principal')], [f(0.56, 'Principal')], { tolerance: 0.1 });
  assert.equal(r.pass, false);
  assert.equal(r.worse.length, 1);
  assert.equal(r.worse[0].label, 'Principal');
  assert.equal(r.worse[0].index, 0);
});
check('compareCrops: within tolerance passes', () => assert.equal(compareCrops([f(1)], [f(0.93)], { tolerance: 0.1 }).pass, true));
check('compareCrops: showing more than the source passes (the source crop is the floor, not a target)', () => assert.equal(compareCrops([f(0.31)], [f(0.84)]).pass, true));
check('compareCrops: tolerance 0 fails any extra crop', () => assert.equal(compareCrops([f(1)], [f(0.99)], { tolerance: 0 }).pass, false));
check('compareCrops: unmeasured images are counted, never failed', () => {
  const r = compareCrops([f(null), f(1)], [f(0.2), f(1)]);
  assert.deepEqual([r.pass, r.measured, r.unmeasured], [true, 1, 1]);
});
check('compareCrops: different image counts skip the check (the image-set check already fails)', () => {
  const r = compareCrops([f(1)], [f(0.1), f(1)]);
  assert.equal(r.pass, true);
  assert.equal(r.skipped, 'image counts differ');
});
check('IMG_CROP is a function source that embeds the same visibleFraction', () => {
  assert.match(IMG_CROP, /^\(\(img\) => \{/);
  assert.ok(IMG_CROP.includes(visibleFraction.toString()), 'IMG_CROP must inline visibleFraction verbatim');
  assert.doesNotThrow(() => new Function(`return ${IMG_CROP}`)());
});

const reg = (nw, nh, bw, bh, fit, y = 50, x = 50) => visibleRegion({ naturalWidth: nw, naturalHeight: nh, boxWidth: bw, boxHeight: bh, fit, position: [{ v: x }, { v: y }] });
const near4 = (a, b) => a.forEach((v, k) => near(v, b[k]));
check('region: cover crops top/bottom of a tall image, placed by object-position y', () => {
  near4(reg(1000, 2000, 500, 500, 'cover', 50), [0, 0.25, 1, 0.75]);
  near4(reg(1000, 2000, 500, 500, 'cover', 0), [0, 0, 1, 0.5]);
  near4(reg(1000, 2000, 500, 500, 'cover', 100), [0, 0.5, 1, 1]);
});
check('region: fill and contain show the whole image', () => {
  near4(reg(750, 750, 574, 324, 'fill'), [0, 0, 1, 1]);
  near4(reg(750, 750, 574, 324, 'contain'), [0, 0, 1, 1]);
});
check('region: a pixel object-position offsets the drawn image', () => near4(visibleRegion({ naturalWidth: 1000, naturalHeight: 2000, boxWidth: 500, boxHeight: 500, fit: 'cover', position: [{ v: 50 }, { v: -250, px: true }] }), [0, 0.25, 1, 0.75]));
check('region: a clipping ancestor narrows it', () => near4(visibleRegion({ naturalWidth: 1000, naturalHeight: 1000, boxWidth: 500, boxHeight: 500, fit: 'fill', clip: [0, 0, 500, 250] }), [0, 0, 1, 0.5]));
const side = (region, position, fit = 'cover', natural = '') => ({ region, position, fit, box: 'b', natural });
check('compareRegions: a centred crop of a post the source frames at its upper third fails, with the fix', () => {
  const src = reg(1080, 1920, 368, 200, 'cover', 30); const rnd = reg(1080, 1920, 367, 220, 'cover', 50);
  const r = compareRegions([side(src, '50% 30%')], [side(rnd, '50% 50%')]);
  assert.equal(r.pass, false); assert.match(r.wrong[0].fix, /^50% (29|30|31)%$/);
  const fixed = reg(1080, 1920, 367, 220, 'cover', parseFloat(r.wrong[0].fix.split(' ')[1]));
  assert.equal(compareRegions([side(src, '50% 30%')], [side(fixed, r.wrong[0].fix)]).pass, true);
});
check('compareRegions: a smaller frame inside the source area passes (the donor frame keeps its size)', () => {
  const src = reg(750, 577, 368, 200, 'cover'); const rnd = reg(750, 577, 367, 220, 'cover');
  assert.equal(compareRegions([side(src, '50% 50%')], [side(rnd, '50% 50%')]).pass, true);
});
check('compareRegions: a frame grown to the whole image contains the source area (the Figma geometry gate holds the frame size)', () => {
  const src = reg(1080, 1920, 368, 200, 'cover', 30); const rnd = reg(1080, 1920, 367, 652, 'cover', 50);
  assert.equal(compareRegions([side(src, '50% 30%')], [side(rnd, '50% 50%')]).pass, true);
});
check('compareRegions: the source\'s off-centre anchor is kept even where its own box shows the whole image', () => {
  const src = reg(736, 600, 368, 300, 'cover', 0); // the photo's own shape: the whole image shows
  const centred = reg(736, 600, 367, 220, 'cover', 50); const top = reg(736, 600, 367, 220, 'cover', 0);
  const r = compareRegions([side(src, '50% 0%')], [side(centred, '50% 50%')]);
  assert.equal(r.pass, false); assert.equal(r.wrong[0].anchorOff, true); assert.equal(r.wrong[0].fix, '50% 0%');
  assert.equal(compareRegions([side(src, '50% 0%')], [side(top, '50% 0%')]).pass, true);
});
check('compareRegions: a wider donor frame that contains the source area passes (more width is unavoidable)', () => {
  const src = reg(750, 501, 468, 450, 'cover'); const rnd = reg(750, 501, 574, 324, 'cover'); // source crops the sides, ours top/bottom
  assert.equal(compareRegions([side(src, '50% 50%')], [side(rnd, '50% 50%')]).pass, true);
});
check('compareRegions: a pair of different shapes (a live feed re-ordered) is unpaired, its area never judged', () => {
  const r = compareRegions([side(reg(1080, 1920, 368, 200, 'cover', 50), '50% 50%', 'cover', '1080x1920')], [side(reg(720, 720, 367, 220, 'cover'), '50% 50%', 'cover', '720x720')]);
  assert.deepEqual([r.pass, r.unpaired, r.measured], [true, 1, 0]);
});
check('compareRegions: an unpaired image still keeps the source component\'s anchor', () => {
  const r = compareRegions([side(reg(1080, 1920, 368, 200, 'cover', 30), '50% 30%', 'cover', '1080x1920')], [side(reg(720, 1000, 367, 220, 'cover'), '50% 50%', 'cover', '720x1000')]);
  assert.deepEqual([r.pass, r.unpaired, r.wrong[0].fix, r.wrong[0].inside], [false, 1, '50% 30%', null]);
});
check('compareRegions: a fill render clipped by a rounded container keeps no anchor to keep', () => {
  const src = reg(750, 500, 368, 300, 'cover', 0); const rnd = [0, 0.004, 1, 0.996]; // fill, a 1px corner clip
  assert.equal(compareRegions([side(src, '50% 0%')], [side(rnd, '50% 50%', 'fill')]).pass, true);
});
check('compareRegions: unmeasured images are counted, never failed; count mismatch skips', () => {
  assert.deepEqual([compareRegions([side(null, '')], [side([0, 0, 1, 1], '')]).unmeasured, compareRegions([side([0, 0, 1, 1], '')], []).skipped], [1, 'image counts differ']);
});
check('IMG_CROP inlines visibleRegion too', () => assert.ok(IMG_CROP.includes(visibleRegion.toString())));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
