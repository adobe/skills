import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './menus.mjs';

test('verdict: a menu opens with most of its captured links and closes when left', () => {
  assert.deepEqual(verdict({ expected: 29, opened: 29, left: 0 }), { ok: true, problems: [] });
  assert.deepEqual(verdict({ expected: 29, opened: 24, left: 0 }), { ok: true, problems: [] },
    '80 % of the links is enough: a capture can count a hidden duplicate');
});

test('verdict: too few links, still open after leaving, or not opened at all', () => {
  assert.deepEqual(verdict({ expected: 29, opened: 10, left: 0 }).problems,
    ['opens 10 of 29 links']);
  assert.deepEqual(verdict({ expected: 26, opened: 26, left: 26 }).problems,
    ['stays open when the pointer leaves']);
  assert.deepEqual(verdict({ expected: 14, opened: null, left: null }).problems,
    ['could not be opened (label not found or covered)']);
});

test('verdict: a menu that opened but could not be closed fails (close step threw: left is null)', () => {
  assert.deepEqual(verdict({ expected: 2, opened: 2, left: null }).problems,
    ['could not be closed (label covered or not clickable once open)']);
});
