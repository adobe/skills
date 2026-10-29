#!/usr/bin/env node
// skills/reskin/scripts/test/image-crop.test.mjs — the content gate's image-crop measure (source-normalize.mjs
// visibleFraction, compareCrops, IMG_CROP): how much of an image each object-fit shows in a box, how clipping
// ancestors compound it, and when a rendered image counts as cut more than the source. Pure, no network, no browser.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { visibleFraction, compareCrops, IMG_CROP } from '../source-normalize.mjs';

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

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
