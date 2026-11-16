import test from 'node:test';
import assert from 'node:assert/strict';
import { savingPercent, readPrice } from './plans.js';

test('saving rounds to a whole percentage', () => {
  assert.equal(savingPercent(20, 16), 20);
  assert.equal(savingPercent(15, 10), 33);
});

test('no saving when prices are equal, zero or invalid', () => {
  assert.equal(savingPercent(10, 10), 0);
  assert.equal(savingPercent(0, 0), 0);
  assert.equal(savingPercent(10, 12), 0);
  assert.equal(savingPercent(NaN, 5), 0);
});

test('reads a price from text', () => {
  assert.equal(readPrice('$12 / month'), 12);
  assert.equal(readPrice('9,50 €'), 9.5);
  assert.ok(Number.isNaN(readPrice('Free')));
});
