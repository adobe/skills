import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusters, cropPlan, diffMask, fits, maxPieceH, overviewScale, stackedSize, tokensOf }
  from './views.mjs';

const maskWith = (w, h, boxes) => {
  const m = new Uint8Array(w * h);
  for (const [x0, y0, bw, bh] of boxes) {
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) m[y * w + x] = 1;
  }
  return m;
};

test('fits checks pixels, tokens and base64 bytes', () => {
  assert.equal(tokensOf(1440, 2000), 52 * 72);
  assert.equal(fits({ w: 1440, h: 2000 }), true);
  assert.equal(fits({ w: 2000, h: 2000 }), false);
  assert.equal(fits({ w: 1000, h: 1000, b64Bytes: 4718593 }), false);
});

test('three stacked panels of the tallest piece fit the box', () => {
  assert.equal(maxPieceH(), 641);
  assert.ok(fits(stackedSize(1440, maxPieceH())));
  assert.equal(fits(stackedSize(1440, maxPieceH() + 1)), false);
});

test('diffMask marks pixelmatch red only, not anti-aliasing yellow or grey', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 255, 255, 0, 255, 200, 200, 200, 255]);
  assert.deepEqual([...diffMask(rgba, 3, 1)], [1, 0, 0]);
});

test('clusters merge near blobs, keep far ones apart, clamp padding at the edge', () => {
  const near = clusters(maskWith(400, 400, [[100, 100, 10, 10], [120, 100, 10, 10]]), 400, 400);
  assert.equal(near.length, 1);
  const far = clusters(maskWith(800, 400, [[100, 100, 10, 10], [400, 100, 10, 10]]), 800, 400);
  assert.equal(far.length, 2);
  const [edge] = clusters(maskWith(100, 100, [[0, 0, 5, 5]]), 100, 100);
  assert.deepEqual([edge.x, edge.y, edge.w, edge.h], [0, 0, 21, 21]);
  assert.equal(edge.pixels, 25);
});

test('cropPlan: none without differences, bands when they cover most of the region', () => {
  assert.deepEqual(cropPlan([], { w: 1440, h: 900 }), { mode: 'none', pieces: [] });
  const plan = cropPlan([{ x: 0, y: 0, w: 1440, h: 700 }], { w: 1440, h: 900 });
  assert.equal(plan.mode, 'bands');
  let next = 0;
  for (const p of plan.pieces) {
    assert.equal(p.y, next);
    assert.equal(p.w, 1440);
    assert.ok(p.h <= maxPieceH());
    next = p.y + p.h;
  }
  assert.equal(next, 900);
});

test('cropPlan cuts a tall cluster into pieces whose stacked view fits', () => {
  const plan = cropPlan([{ x: 0, y: 1000, w: 1440, h: 1500 }], { w: 1440, h: 5000 });
  assert.equal(plan.mode, 'crops');
  assert.equal(plan.pieces.length, 3);
  for (const p of plan.pieces) assert.ok(fits(stackedSize(p.w, p.h)));
  assert.equal(plan.pieces.reduce((s, p) => s + p.h, 0), 1500);
});

test('overviewScale shrinks today\'s desktop sheet into the box', () => {
  const s = overviewScale(4360, 1500);
  assert.ok(s < 1);
  assert.ok(fits({ w: Math.round(4360 * s), h: Math.round(1500 * s) }));
  assert.equal(overviewScale(1210, 600), 1);
});

test('cropPlan grows a small cluster to at least 480x160, centred and clamped', () => {
  const [p] = cropPlan([{ x: 300, y: 200, w: 40, h: 20 }], { w: 1440, h: 2000 }).pieces;
  assert.deepEqual([p.w, p.h], [480, 160]);
  assert.ok(p.x <= 300 && p.x + p.w >= 340 && p.y <= 200 && p.y + p.h >= 220);
  const [edge] = cropPlan([{ x: 0, y: 0, w: 10, h: 10 }], { w: 300, h: 2000 }).pieces;
  assert.deepEqual([edge.x, edge.y, edge.w, edge.h], [0, 0, 300, 160]);
});
