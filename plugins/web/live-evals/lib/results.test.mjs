// Run: npm test (node --test lib/*.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGood, stats } from './results.mjs';

const floor = { min_pass_rate: 0.9, max_latency_s: 120 };
const run = (over) => ({ case: 'c', pass: true, latency_s: 30, cost_usd: 0.01, timed_out: false, ...over });

test('a run aborted at the budget is outside it even when its artifacts pass', () => {
  // summarize.mjs rounds latency to tenths, so an aborted run can read exactly 120.0
  assert.equal(isGood(run({ latency_s: 120, timed_out: true }), floor), false);
  assert.equal(isGood(run({ latency_s: 120 }), floor), true);
  assert.equal(isGood(run({ latency_s: 120.1 }), floor), false);
});

test('rows without the timed_out flag keep their previous classification', () => {
  const legacy = { case: 'c', pass: true, latency_s: 50, cost_usd: 0 };
  assert.equal(isGood(legacy, floor), true);
  assert.equal(isGood({ ...legacy, pass: false }, floor), false);
});

test('stats count timed-out repeats as misses and the case as flaky', () => {
  const s = stats([run(), run({ latency_s: 120, timed_out: true }), run()], floor);
  assert.equal(s.n, 3);
  assert.equal(s.good, 2);
  assert.equal(s.flaky, 1);
  assert.equal(s.timeouts, 1);
  assert.equal(s.meets, false);
});

test('stats on empty input neither meet nor divide by zero', () => {
  const s = stats([], floor);
  assert.equal(s.n, 0);
  assert.equal(s.meets, false);
  assert.equal(s.avg, 0);
});
