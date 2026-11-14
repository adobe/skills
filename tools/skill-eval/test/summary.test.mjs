import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate } from '../lib/report.mjs';
import { bucketOf, bucketRows, countBuckets, noiseStats, renderSummary } from '../lib/summary.mjs';

const v = (avg, { attempts = 2, failed = 0, used = 0, skills = [] } = {}) => ({ attempts, failed, score: { avg }, activation: { count: used, skills } });

test('bucketOf precedence: broken, hurts, helps, no signal, not picked up, headroom', () => {
  assert.equal(bucketOf({ label: 'lift', cand: v(90, { failed: 1 }), ref: v(70) }), 'broken');
  assert.equal(bucketOf({ label: 'n/a', cand: v(90), ref: v(70) }), 'broken');
  assert.equal(bucketOf({ label: 'lift', cand: undefined, ref: v(70) }), 'broken');
  assert.equal(bucketOf({ label: 'degraded', cand: v(60), ref: v(80) }), 'skill hurts');
  assert.equal(bucketOf({ label: 'lift', cand: v(95), ref: v(70) }), 'skill helps');
  assert.equal(bucketOf({ label: 'flat', cand: v(98), ref: v(97) }), 'no signal');
  assert.equal(bucketOf({ label: 'flat', cand: v(80), ref: v(80) }), 'not picked up');
  assert.equal(bucketOf({ label: 'flat', cand: v(80, { used: 1 }), ref: v(80) }), 'flat, headroom');
});

const mk = (scenario, model, variant, run, pct, extra = {}) => ({ plugin: 'p', scenario, model, variant, run, status: 'ok', score: { pct, checks: [], total: pct, max: 100 }, durationMs: 20000, turns: 3, tokens: { total: 1000, input: 900, output: 100 }, cost: 0.01, activatedSkills: variant === 'baseline' ? [] : ['s1'], ...extra });

function fixture() {
  const attempts = [];
  for (const model of ['m1', 'm2', 'm3']) {
    for (const run of [1, 2]) {
      attempts.push(mk('helps', model, 'baseline', run, 60 + run), mk('helps', model, 'with-plugin', run, 95 + run));
      attempts.push(mk('ceiling', model, 'baseline', run, 98), mk('ceiling', model, 'with-plugin', run, 99, { activatedSkills: [] }));
      attempts.push(mk('slow', model, 'baseline', run, 80), mk('slow', model, 'with-plugin', run, 80, { status: 'timeout', score: undefined }));
    }
  }
  return aggregate(attempts, ['baseline', 'with-plugin']);
}

test('bucketRows classify pooled and per-model; counts add up', () => {
  const [plugin] = fixture();
  const rows = bucketRows(plugin, 'with-plugin');
  const by = Object.fromEntries(rows.map((r) => [r.scenario, r]));
  assert.equal(by.helps.pooled.bucket, 'skill helps');
  assert.equal(by.ceiling.pooled.bucket, 'no signal');
  assert.equal(by.slow.pooled.bucket, 'broken');
  assert.equal(by.helps.models.m1.bucket, 'skill helps');
  assert.deepEqual(by.helps.pooled.skills, ['s1']);
  const counts = countBuckets(rows);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 3);
  assert.equal(counts['skill helps'], 1);
});

test('noiseStats counts zero SDs, floors and label changes', () => {
  const [plugin] = fixture();
  const n = noiseStats(plugin, 'with-plugin');
  const score = n.metrics.find((m) => m.key === 'score');
  assert.ok(score.cells > 0 && score.zeroSd > 0);
  const turns = n.metrics.find((m) => m.key === 'turns');
  assert.equal(turns.floorBinds, turns.comparisons);
  assert.ok(Number.isInteger(n.labelsChangedByFloor));
});

test('renderSummary produces the sections', () => {
  const [plugin] = fixture();
  const md = renderSummary({ meta: { runId: 'r', label: 'l', runs: 2, scorerModel: 'j', contexts: [] }, variants: ['baseline', 'with-plugin'], plugin, variant: 'with-plugin', attempts: plugin.scenarios.length ? [mk('a', 'm1', 'baseline', 1, 1, { status: 'error', error: 'x' })] : [], reportPath: 'report.md' });
  for (const s of ['## Bucket counts', '## Scenarios', '## Observed noise', '## Failures', '**skill helps**', 'a / m1 / baseline #1: error (x)']) assert.ok(md.includes(s), s);
});
