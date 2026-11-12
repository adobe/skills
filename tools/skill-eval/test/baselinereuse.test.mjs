import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baselineCompatible, reuseBaseline, scenarioFingerprint } from '../lib/baselinereuse.mjs';

async function scenario(files) {
  const dir = await mkdtemp(join(tmpdir(), 'skill-eval-fp-'));
  for (const [f, c] of Object.entries(files)) {
    await mkdir(join(dir, f, '..'), { recursive: true });
    await writeFile(join(dir, f), c);
  }
  return dir;
}

const opts = { thinking: undefined, scorerModel: 'judge', skipScoring: false };
const prior = { variant: 'baseline', status: 'ok', scenario: 's', model: 'm', run: 1, scenarioHash: 'h', thinking: null, score: { judgeModel: 'judge', pct: 50 } };
const a = { variant: 'baseline', scenario: { name: 's' }, model: 'm', run: 1, scenarioHash: 'h' };

test('fingerprint changes with any scenario file, including fixtures', async () => {
  const one = await scenario({ 'task.md': 't', 'criteria.json': '{}', 'fixtures/x/a.txt': 'a' });
  const same = await scenario({ 'task.md': 't', 'criteria.json': '{}', 'fixtures/x/a.txt': 'a' });
  const fixture = await scenario({ 'task.md': 't', 'criteria.json': '{}', 'fixtures/x/a.txt': 'b' });
  const task = await scenario({ 'task.md': 't2', 'criteria.json': '{}', 'fixtures/x/a.txt': 'a' });
  const h = await scenarioFingerprint(one);
  assert.equal(h, await scenarioFingerprint(same));
  assert.notEqual(h, await scenarioFingerprint(fixture));
  assert.notEqual(h, await scenarioFingerprint(task));
});

test('a baseline is reusable only when scenario, model, run, thinking and judge all match', () => {
  assert.equal(baselineCompatible(prior, a, opts), true);
  assert.equal(baselineCompatible({ ...prior, scenarioHash: 'x' }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, scenarioHash: undefined }, { ...a, scenarioHash: undefined }, opts), false);
  assert.equal(baselineCompatible({ ...prior, model: 'n' }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, run: 2 }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, thinking: 'high' }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, status: 'timeout' }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, score: { judgeModel: 'other' } }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, score: undefined }, a, opts), false);
  assert.equal(baselineCompatible({ ...prior, score: undefined }, a, { ...opts, skipScoring: true }), true);
  assert.equal(baselineCompatible({ ...prior, variant: 'main' }, a, opts), false);
  assert.equal(baselineCompatible(prior, { ...a, variant: 'main' }, opts), false);
});

test('reuseBaseline copies the attempt dir and records its origin', async () => {
  const oldRun = await mkdtemp(join(tmpdir(), 'skill-eval-old-'));
  const newRun = await mkdtemp(join(tmpdir(), 'skill-eval-new-'));
  const att = { plugin: { name: 'org/p' }, pluginSlug: 'org-p', scenario: { name: 's' }, modelSlug: 'm', variant: 'baseline', run: 1, model: 'm', scenarioHash: 'h' };
  const priorDir = join(oldRun, 'attempts', 'org-p', 's', 'm', 'baseline-1');
  await mkdir(priorDir, { recursive: true });
  await writeFile(join(priorDir, 'result.json'), JSON.stringify({ ...prior, pluginSlug: 'org-p', dir: priorDir }));
  await writeFile(join(priorDir, 'session.jsonl'), 'x');
  const dir = join(newRun, 'attempts', 'org-p', 's', 'm', 'baseline-1');
  const r = await reuseBaseline({ ...att, dir }, { runDirs: [oldRun], ...opts });
  assert.equal(r.reusedFrom, oldRun);
  assert.equal(r.dir, dir);
  assert.equal(await readFile(join(dir, 'session.jsonl'), 'utf8'), 'x');
  assert.equal(JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')).reusedFrom, oldRun);
  assert.equal(await reuseBaseline({ ...att, run: 2, dir }, { runDirs: [oldRun], ...opts }), null);
});
