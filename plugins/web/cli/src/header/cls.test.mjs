import assert from 'node:assert/strict';
import test from 'node:test';
import { clsOf } from './cls.mjs';

test('clsOf: total of the shifts, and where elements moved, largest first', () => {
  const cls = clsOf([
    { v: 0.0446, at: ['.band-r2'] },
    { v: 0.1365, at: ['main', '.band-r2'] },
    { v: 0.001, at: ['footer'] },
    { v: 0.0005, at: ['header'] },
  ]);
  assert.equal(cls.value, 0.183);
  assert.deepEqual(cls.by, [
    ['.band-r2', 0.181],
    ['main', 0.137],
    ['footer', 0.001],
  ]);
  assert.deepEqual(cls.resized, []);
});

test('clsOf: no shift is 0 and nowhere', () => {
  assert.deepEqual(clsOf([]), { value: 0, by: [], resized: [] });
});

test('clsOf: boxes resized after they first showed; a first appearance from 0 is not one', () => {
  const cls = clsOf([
    { v: 0, at: [], heights: { header: 76, '.a': 0 } },
    { v: 0.13, at: ['main'], heights: { header: 0, '.a': 0 } },
    { v: 0, at: [], heights: { header: 76, '.a': 600 } },
  ]);
  assert.deepEqual(cls.resized, [['header', [76, 0, 76]]]);
});
