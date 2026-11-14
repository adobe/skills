import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, diff, failedAttempts, mean, modelLabels, renderMarkdown, sd, stats } from '../lib/report.mjs';

const attempt = (variant, pct, extra = {}) => ({
  plugin: 'org/p',
  model: 'gh/sonnet',
  scenario: 's1',
  variant,
  run: 1,
  status: 'ok',
  durationMs: 1000,
  turns: 2,
  tokens: { input: 10, output: 20, cacheRead: 60, cacheWrite: 10, total: 100 },
  cost: 0.1,
  activatedSkills: [],
  score: { pct, checks: [{ name: 'c1', max: 10, score: pct / 10 }], judgeCost: 0.01 },
  ...extra,
});

test('mean, sample sd and stats', () => {
  assert.equal(mean([]), null);
  assert.equal(sd([5]), 0);
  assert.equal(sd([2, 4, 4, 4, 5, 5, 7, 9]).toFixed(4), '2.1381');
  assert.deepEqual(stats([3, null, 1, 2]), { n: 3, avg: 2, min: 1, max: 3, sd: 1 });
  assert.deepEqual(stats([]), { n: 0, avg: null, min: null, max: null, sd: null });
  assert.deepEqual(diff({ avg: 80, min: 70, max: 90 }, { avg: 50, min: 40, max: 75 }), { avg: 30, min: 30, max: 15 });
});

test('scenario differential on avg, min and max; per-solve metrics', () => {
  const variants = ['baseline', 'with-plugin'];
  const plugins = aggregate(
    [
      attempt('baseline', 40),
      attempt('baseline', 60, { run: 2, durationMs: 3000, turns: 4, cost: 0.3 }),
      attempt('with-plugin', 90, { activatedSkills: ['alpha'] }),
      attempt('with-plugin', 70, { run: 2, activatedSkills: ['alpha', 'beta'] }),
    ],
    variants,
  );
  const sc = plugins[0].scenarios[0];
  assert.deepEqual(sc.differential['with-plugin'], { avg: 30, min: 30, max: 30 });
  const base = sc.variants.baseline;
  assert.deepEqual([base.score.min, base.score.max], [40, 60]);
  assert.deepEqual([base.duration.avg, base.turns.max, base.cost.avg], [2000, 4, 0.2]);
  assert.equal(base.solves[0].tokens.input, 80);
  const wp = sc.variants['with-plugin'];
  assert.deepEqual(wp.activation, { count: 2, skills: ['alpha', 'beta'] });
  assert.deepEqual(wp.solves.map((s) => s.skillsUsed), [['alpha'], ['alpha', 'beta']]);

  const summary = plugins[0].summary['with-plugin'];
  assert.deepEqual(summary.differential, { avg: 30, worstScenario: 30, bestScenario: 30 });
  assert.equal(summary.totalCost.toFixed(2), '0.20');
  assert.equal(summary.totalJudgeCost.toFixed(2), '0.02');

  const md = renderMarkdown({ meta: { runId: 'r', model: 'w', scorerModel: 'j', runs: 2 }, plugins, variants });
  assert.match(md, /\| sonnet \| with-plugin \| 80\.0% \| \+30\.0 \| \+30\.0 \| \+30\.0 \| 2\/2 \| 0 \|/);
  assert.match(md, /\| sonnet \| baseline \| 50\.0% \(40\.0%–60\.0%\) \|/);
  assert.match(md, /\| sonnet \| with-plugin #2 \| ok \| 70\.0% \| alpha, beta \| 1s \| 2 \| 80 \/ 20 \/ 100 \| \$0\.100 \|/);
  assert.match(md, /\| c1 \| 5\.0\/10 \| 8\.0\/10 \|/);
  assert.doesNotMatch(md, /\| pooled \|/);
});

test('plugin worst and best scenario differential', () => {
  const plugins = aggregate(
    [
      attempt('baseline', 50),
      attempt('with-plugin', 70),
      attempt('baseline', 80, { scenario: 's2' }),
      attempt('with-plugin', 60, { scenario: 's2' }),
    ],
    ['baseline', 'with-plugin'],
  );
  assert.deepEqual(plugins[0].summary['with-plugin'].differential, { avg: 0, worstScenario: -20, bestScenario: 20 });
});

test('failed or timed-out attempts are excluded from scores even when judged', () => {
  const plugins = aggregate(
    [
      attempt('with-plugin', 40),
      attempt('with-plugin', 100, { run: 2, status: 'error', error: 'boom' }),
      attempt('with-plugin', 100, { run: 3, status: 'timeout' }),
    ],
    ['with-plugin'],
  );
  const v = plugins[0].scenarios[0].variants['with-plugin'];
  assert.equal(v.score.avg, 40);
  assert.equal(v.scored, 1);
  assert.equal(v.failed, 2);
  assert.equal(v.solves[1].score, null);
  const md = renderMarkdown({ meta: { runId: 'r', model: 'w', runs: 3 }, plugins, variants: ['with-plugin'] });
  assert.match(md, /\| sonnet \| with-plugin #2 \| error: boom \| — \|/);
});

test('every non-ok status counts toward a failing exit', () => {
  const results = [{ status: 'ok' }, { status: 'timeout' }, { status: 'error' }];
  assert.deepEqual(failedAttempts(results).map((r) => r.status), ['timeout', 'error']);
  assert.equal(failedAttempts([{ status: 'ok' }]).length, 0);
});

test('several models: per-model and pooled scenario stats and summaries', () => {
  const variants = ['baseline', 'with-plugin'];
  const plugins = aggregate(
    [
      attempt('baseline', 40, { model: 'gh/a' }),
      attempt('with-plugin', 80, { model: 'gh/a' }),
      attempt('baseline', 60, { model: 'gh/b', turns: 6 }),
      attempt('with-plugin', 60, { model: 'gh/b', turns: 4 }),
    ],
    variants,
  );
  const p = plugins[0];
  assert.deepEqual(p.models, ['gh/a', 'gh/b']);
  const sc = p.scenarios[0];
  assert.equal(sc.differential['with-plugin'].avg, 20);
  assert.equal(sc.variants.baseline.score.avg, 50);
  assert.equal(sc.models['gh/a'].differential['with-plugin'].avg, 40);
  assert.equal(sc.models['gh/b'].differential['with-plugin'].avg, 0);
  assert.equal(sc.models['gh/b'].variants.baseline.turns.avg, 6);
  assert.equal(p.summary['with-plugin'].differential.avg, 20);
  assert.equal(p.summaryByModel['gh/a']['with-plugin'].differential.avg, 40);
  assert.equal(p.summaryByModel['gh/b'].baseline.attempts, 1);

  const md = renderMarkdown({ meta: { runId: 'r', models: ['gh/a', 'gh/b'], runs: 1 }, plugins, variants });
  assert.match(md, /- Workers: `gh\/a`, `gh\/b`/);
  assert.match(md, /\| a \| with-plugin \| 80\.0% \| \+40\.0 \|/);
  assert.match(md, /\| b \| with-plugin \| 60\.0% \| \+0\.0 \|/);
  assert.match(md, /\| pooled \| with-plugin \| 70\.0% \| \+20\.0 \|/);
  assert.match(md, /\| pooled \| with-plugin \| 70\.0% \(60\.0%–80\.0%\) \|/);
  assert.match(md, /\| b \| baseline #1 \| ok \| 60\.0% \|/);
});

test('attempts without a model are grouped under unknown', () => {
  const { model, ...noModel } = attempt('baseline', 50);
  const p = aggregate([noModel], ['baseline'])[0];
  assert.deepEqual(p.models, ['unknown']);
  const md = renderMarkdown({ meta: { runId: 'r', model: 'old/m', runs: 1 }, plugins: [p], variants: ['baseline'] });
  assert.match(md, /- Workers: `old\/m`/);
});

test('modelLabels keeps the provider only where short names collide', () => {
  const labels = modelLabels(['anthropic/sonnet', 'github-copilot/sonnet', 'github-copilot/kimi-k3']);
  assert.deepEqual(labels, { 'anthropic/sonnet': 'anthropic/sonnet', 'github-copilot/sonnet': 'github-copilot/sonnet', 'github-copilot/kimi-k3': 'kimi-k3' });
  const plugins = aggregate([attempt('baseline', 40, { model: 'x/m' }), attempt('baseline', 60, { model: 'y/m' })], ['baseline']);
  const md = renderMarkdown({ meta: { runId: 'r', models: ['x/m', 'y/m'], runs: 1 }, plugins, variants: ['baseline'] });
  assert.match(md, /\| x\/m \| baseline \| 40\.0% \|/);
  assert.match(md, /\| y\/m \| baseline #1 \| ok \| 60\.0% \|/);
});

test('report header lists each context with its commit', () => {
  const contexts = [
    { variant: 'main', plugin: 'org/p', dir: '/wt/main/p', commit: 'abcdef1234567890', dirty: false },
    { variant: 'branch', plugin: 'org/p', dir: '/wt/br/p', commit: '1234567890abcdef', dirty: true },
    { variant: 'x', plugin: 'org/p', dir: '/not/git', commit: null, dirty: null },
  ];
  const md = renderMarkdown({ meta: { runId: 'r', models: ['m'], runs: 1, contexts }, plugins: [], variants: ['baseline', 'main', 'branch', 'x'] });
  assert.match(md, /- Context `main` \(org\/p\): `\/wt\/main\/p` @ `abcdef123456`\n/);
  assert.match(md, /- Context `branch` \(org\/p\): `\/wt\/br\/p` @ `1234567890ab` \+ uncommitted changes/);
  assert.match(md, /- Context `x` \(org\/p\): `\/not\/git`\n/);
});

test('a variant named like an Object.prototype key is not invented for scenarios without it', () => {
  const variants = ['baseline', 'toString'];
  const plugins = aggregate([attempt('baseline', 50), attempt('toString', 70), attempt('baseline', 60, { scenario: 's2' })], variants);
  const s2 = plugins[0].scenarios.find((s) => s.name === 's2');
  assert.equal(s2.variants.toString, undefined);
  assert.equal(s2.differential.toString, undefined);
  const md = renderMarkdown({ meta: { runId: 'r', models: ['gh/sonnet'], runs: 1 }, plugins, variants });
  assert.match(md, /\| sonnet \| toString \| 70\.0% \| \+20\.0 \|/);
});
