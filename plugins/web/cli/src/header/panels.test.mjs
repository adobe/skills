import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { boxMismatch, hrefDiff, mobileVerdict, panelVerdict } from './open-panels.mjs';

const png = (w, h, paint = () => [255, 255, 255]) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = paint(x, y);
      p.data.set([r, g, b, 255], 4 * (y * w + x));
    }
  }
  return p;
};

test('boxMismatch: only the panel box counts, the page around it does not', () => {
  const src = png(100, 100);
  // black outside the box (x 50+): a different page around the panel
  const build = png(100, 100, (x) => (x >= 50 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(boxMismatch(src, build, { x: 0, y: 0, w: 50, h: 100 }), 0);
  assert.equal(boxMismatch(src, build), 50);
  assert.equal(boxMismatch(src, build, { x: 25, y: 0, w: 50, h: 10 }), 50);
});

test('boxMismatch: a box past the shot is clipped; a box fully outside scores null', () => {
  const a = png(100, 50);
  const b = png(100, 50, (x, y) => (y >= 40 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(boxMismatch(a, b, { x: 0, y: 30, w: 100, h: 500 }), 50);
  assert.equal(boxMismatch(a, b, { x: 0, y: 60, w: 10, h: 10 }), null);
});

test('hrefDiff: equal multisets; the page origin reads as the source origin', () => {
  const src = 'https://www.example.com';
  const expected = [`${src}/a`, `${src}/b`, 'https://other.com/x'];
  assert.deepEqual(hrefDiff(expected, ['http://localhost:3500/a', `${src}/b`, 'https://other.com/x'],
    'http://localhost:3500', src), { missing: [], extra: [] });
});

test('hrefDiff: a missing link, an invented one, and a duplicate count', () => {
  const s = 'https://e.com';
  assert.deepEqual(hrefDiff([`${s}/a`, `${s}/a`, `${s}/b`], [`${s}/a`, `${s}/c`], 'http://localhost:1', s),
    { missing: [`${s}/a`, `${s}/b`], extra: [`${s}/c`] });
  assert.deepEqual(hrefDiff([`${s}/a`], [`${s}/a/`], 'http://localhost:1', s),
    { missing: [`${s}/a`], extra: [`${s}/a/`] }, 'hrefs are compared exactly');
});

test('panelVerdict: at the bar passes, over it or with wrong hrefs fails', () => {
  assert.deepEqual(panelVerdict({ mismatch: 1.5, missing: [], extra: [] }), []);
  assert.deepEqual(panelVerdict({ mismatch: 1.51 }), ['panel mismatch 1.51 % > 1.5 %']);
  assert.deepEqual(panelVerdict({ mismatch: null }), ['panel mismatch - % > 1.5 %']);
  assert.equal(panelVerdict({ mismatch: 0, missing: ['u'], extra: ['v'] }).length, 2);
  assert.deepEqual(panelVerdict({ error: 'could not be opened' }), ['could not be opened']);
});

test('mobileVerdict: 2.0 % passes, more or no toggle fails', () => {
  assert.deepEqual(mobileVerdict({ mismatch: 2 }), []);
  assert.equal(mobileVerdict({ mismatch: 2.01 }).length, 1);
  assert.deepEqual(mobileVerdict({ error: 'no mobile menu toggle found' }), ['no mobile menu toggle found']);
});

test('boxMismatch: a semi-transparent source pixel equals its colour on white', () => {
  const src = png(10, 10);
  // alpha 0 over white is white: the build's opaque white must match it
  for (let i = 0; i < 10; i += 1) src.data[4 * i + 3] = 0;
  assert.equal(boxMismatch(src, png(10, 10)), 0);
});
