import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareMetric, comparisonPairs, compareVariants, judge } from '../lib/lift.mjs';
import { aggregate, renderMarkdown } from '../lib/report.mjs';

const st = (avg, sd, n = 2) => ({ n, avg, sd, min: avg, max: avg });

test('comparisonPairs: every variant vs baseline, later contexts vs the first', () => {
  assert.deepEqual(comparisonPairs(['baseline', 'with-plugin']), [{ candidate: 'with-plugin', reference: 'baseline', rule: 'baseline' }]);
  assert.deepEqual(comparisonPairs(['baseline', 'main', 'branch', 'alt']), [
    { candidate: 'main', reference: 'baseline', rule: 'baseline' },
    { candidate: 'branch', reference: 'baseline', rule: 'baseline' },
    { candidate: 'alt', reference: 'baseline', rule: 'baseline' },
    { candidate: 'branch', reference: 'main', rule: 'version' },
    { candidate: 'alt', reference: 'main', rule: 'version' },
  ]);
  assert.deepEqual(comparisonPairs(['main', 'branch']), [{ candidate: 'branch', reference: 'main', rule: 'version' }]);
  assert.deepEqual(comparisonPairs(['with-plugin']), []);
});

test('compareMetric: Tessl band, direction, and n<2', () => {
  const up = compareMetric(st(90, 3), st(80, 4), 'up');
  assert.equal(up.delta, 10);
  assert.equal(up.band, 5);
  assert.equal(up.effect, 'better');
  assert.equal(compareMetric(st(84, 3), st(80, 4), 'up').effect, null);
  assert.equal(compareMetric(st(10, 1), st(20, 1), 'down').effect, 'better');
  assert.equal(compareMetric(st(30, 1), st(20, 1), 'down').effect, 'worse');
  const small = compareMetric(st(90, 0, 1), st(80, 4), 'up');
  assert.equal(small.delta, 10);
  assert.equal(small.band, null);
  assert.equal(small.effect, 'n/a');
  assert.equal(compareMetric(st(80, 0), st(80, 0), 'up').effect, null);
  assert.equal(compareMetric({ n: 0, avg: null, sd: null }, st(80, 0), 'up').effect, 'n/a');
});

const effects = (o) => ({ score: null, time: null, turns: null, tokens: null, cost: null, ...o });

test('judge, baseline rule: score decides; flat score needs time and turns both down', () => {
  assert.equal(judge('baseline', effects({ score: 'better' })), 'lift');
  assert.equal(judge('baseline', effects({ score: 'worse', time: 'better', turns: 'better' })), 'degraded');
  assert.equal(judge('baseline', effects({ time: 'better', turns: 'better' })), 'lift');
  assert.equal(judge('baseline', effects({ time: 'better' })), 'flat');
  assert.equal(judge('baseline', effects({ tokens: 'worse', cost: 'worse' })), 'flat');
  assert.equal(judge('baseline', effects({ score: 'n/a' })), 'n/a');
});

test('judge, version rule: any metric better with none worse; trade-offs are mixed', () => {
  assert.equal(judge('version', effects({ tokens: 'better' })), 'lift');
  assert.equal(judge('version', effects({ cost: 'worse' })), 'degraded');
  assert.equal(judge('version', effects({ score: 'better', time: 'worse' })), 'mixed');
  assert.equal(judge('version', effects({})), 'flat');
  assert.equal(judge('version', effects({ score: 'n/a', tokens: 'better' })), 'n/a');
});

const v = (score, time, turns = st(3, 0), tokens = st(1000, 0), cost = st(0.1, 0)) => ({ score, duration: time, turns, tokens: { total: tokens }, cost });

test('compareVariants: pooled effect needs the band and same sign on 2 of 3 models', () => {
  const pooled = { cand: v(st(90, 2, 6), st(10, 1, 6)), ref: v(st(80, 2, 6), st(10, 1, 6)) };
  const models = {
    a: { cand: v(st(95, 1), st(10, 1)), ref: v(st(70, 1), st(10, 1)) },
    b: { cand: v(st(88, 1), st(10, 1)), ref: v(st(90, 2), st(10, 1)) },
    c: { cand: v(st(87, 1), st(10, 1)), ref: v(st(80, 1), st(10, 1)) },
  };
  const r = compareVariants({ rule: 'baseline', pooled, models });
  assert.equal(r.models.a.label, 'lift');
  assert.equal(r.models.b.label, 'flat');
  assert.equal(r.models.b.metrics.score.delta, -2);
  assert.equal(r.models.c.label, 'lift');
  assert.equal(r.pooled.metrics.score.agree, 2);
  assert.equal(r.pooled.label, 'lift');

  models.c.cand.score = st(79, 1);
  const r2 = compareVariants({ rule: 'baseline', pooled, models });
  assert.equal(r2.pooled.metrics.score.agree, 1);
  assert.equal(r2.pooled.metrics.score.effect, null);
  assert.equal(r2.pooled.label, 'flat');
});

test('compareVariants: a single model needs only its own band', () => {
  const m = { cand: v(st(90, 1), st(10, 1)), ref: v(st(80, 1), st(10, 1)) };
  const r = compareVariants({ rule: 'baseline', pooled: m, models: { a: m } });
  assert.equal(r.pooled.label, 'lift');
  assert.equal(r.pooled.metrics.score.agree, 1);
});

const attempt = (model, variant, run, pct, extra = {}) => ({
  plugin: 'org/p',
  scenario: 's1',
  model,
  variant,
  run,
  status: 'ok',
  durationMs: 10_000,
  turns: 3,
  tokens: { total: 1000 },
  cost: 0.1,
  activatedSkills: [],
  score: { pct, checks: [] },
  ...extra,
});

test('aggregate labels scenarios and counts labels per comparison; markdown shows bands', () => {
  const xs = [];
  for (const m of ['gh/a', 'gh/b', 'gh/c']) {
    xs.push(attempt(m, 'baseline', 1, 60), attempt(m, 'baseline', 2, 62));
    xs.push(attempt(m, 'with-plugin', 1, 90), attempt(m, 'with-plugin', 2, 92));
  }
  xs.push(attempt('gh/a', 'baseline', 1, 50, { scenario: 's2' }), attempt('gh/a', 'with-plugin', 1, 50, { scenario: 's2' }));
  const variants = ['baseline', 'with-plugin'];
  const [p] = aggregate(xs, variants);
  const s1 = p.scenarios.find((s) => s.name === 's1');
  assert.equal(s1.comparisons.length, 1);
  assert.equal(s1.comparisons[0].pooled.label, 'lift');
  assert.equal(s1.comparisons[0].models['gh/b'].label, 'lift');
  const s2 = p.scenarios.find((s) => s.name === 's2');
  assert.equal(s2.comparisons[0].pooled.label, 'n/a');
  assert.deepEqual(p.results[0].pooled, { lift: 1, flat: 0, degraded: 0, mixed: 0, 'n/a': 1 });
  assert.deepEqual(p.results[0].models['gh/a'], { lift: 1, flat: 0, degraded: 0, mixed: 0, 'n/a': 1 });

  const md = renderMarkdown({ meta: { runId: 'r', models: ['gh/a', 'gh/b', 'gh/c'], runs: 2 }, plugins: [p], variants });
  assert.match(md, /\| with-plugin vs baseline \| pooled \| 1 \| 0 \| 0 \| — \| 1 \|/);
  assert.match(md, /\| with-plugin vs baseline \| pooled \| lift \| \*\*\+30\.0\*\* ±5\.0 \(3\/3\) \| \+0s ±10s \(0\/3\) \|/);
  assert.match(md, /\| with-plugin vs baseline \| a \| lift \| \*\*\+30\.0\*\* ±5\.0 \|/);
});

test('compareMetric: minimum band floors a zero-SD band; delta must exceed it', () => {
  assert.equal(compareMetric(st(81, 0), st(80, 0), 'up').effect, 'better');
  assert.equal(compareMetric(st(81, 0), st(80, 0), 'up', 5).effect, null);
  assert.equal(compareMetric(st(81, 0), st(80, 0), 'up', 5).band, 5);
  assert.equal(compareMetric(st(86, 0), st(80, 0), 'up', 5).effect, 'better');
  assert.equal(compareMetric(st(5, 0), st(4, 0), 'down', 1).effect, null);
  assert.equal(compareMetric(st(5, 3), st(4, 3), 'down', 1).band, Math.sqrt(18));
});

test('compareVariants applies per-metric floors', () => {
  const side = (score, turns) => ({ score: st(score, 0), duration: st(20000, 0), turns: st(turns, 0), tokens: { ...st(1, 0), total: 1 }, cost: st(1, 0) });
  const stats = (s) => ({ score: s.score, duration: s.duration, turns: s.turns, tokens: { n: 2, avg: 1, sd: 0 }, cost: s.cost });
  const m = { cand: stats(side(81, 3)), ref: stats(side(80, 2)) };
  const r = compareVariants({ rule: 'baseline', pooled: m, models: { a: m, b: m, c: m } });
  assert.equal(r.pooled.label, 'flat');
  assert.equal(r.models.a.metrics.score.effect, null);
  assert.equal(r.models.a.metrics.turns.effect, null);
});
