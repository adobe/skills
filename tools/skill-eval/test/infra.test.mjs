import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBreaker, isInfraError, reusablePrior, withInfraRetries } from '../lib/infra.mjs';

test('isInfraError matches network and provider failures only', () => {
  for (const m of ['Connection error.', 'read ECONNRESET', 'getaddrinfo ENOTFOUND api.x', 'fetch failed', 'Stream ended without finish_reason', '429 rate limit exceeded', 'setup setup.sh failed (exit 128)', 'judge error: Connection error.']) assert.equal(isInfraError(m), true, m);
  for (const m of ['judge returned no parseable scores', 'setup setup.sh failed (exit 1)', 'pi exited 1', 'timed out', '', undefined]) assert.equal(isInfraError(m), false, String(m));
});

test('withInfraRetries retries failures with delays, stops on success, returns last result', async () => {
  const slept = [];
  const calls = [];
  const r = await withInfraRetries(async (i) => (calls.push(i), { ok: i === 1 }), { isFailure: (x) => !x.ok, delays: [5, 20], sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(calls, [0, 1]);
  assert.deepEqual(slept, [5]);
  assert.equal(r.ok, true);
  const seen = [];
  const last = await withInfraRetries(async (i) => ({ ok: false, i }), { isFailure: (x) => !x.ok, delays: [1, 2], sleep: async () => {}, onRetry: (n) => seen.push(n) });
  assert.equal(last.i, 2);
  assert.deepEqual(seen, [1, 2]);
});

test('breaker trips after consecutive infra failures and resets on any other result', () => {
  const b = createBreaker(3);
  b.record(true);
  b.record(true);
  assert.equal(b.tripped, false);
  b.record(false);
  b.record(true);
  b.record(true);
  assert.equal(b.tripped, false);
  b.record(true);
  assert.equal(b.tripped, true);
});

test('only ok and timeout results are reused on resume', () => {
  assert.equal(reusablePrior({ status: 'ok' }), true);
  assert.equal(reusablePrior({ status: 'timeout' }), true);
  assert.equal(reusablePrior({ status: 'error' }), false);
  assert.equal(reusablePrior(null), false);
});
