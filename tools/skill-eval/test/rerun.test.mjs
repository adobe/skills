import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { attemptDir, judgeLabel, loadRunSkills, modelList, positiveInt, refreshAttempts, tagJudgeModels, tagWorkerModels, workerSucceeded } from '../lib/rerun.mjs';
import { makeSandboxRoot, removeDir } from '../lib/sandbox.mjs';

const SKILL = [
  '---',
  'name: alpha',
  'description: "Use when doing alpha things in a project."',
  '---',
  'Scan the blocks/ folder and list every block directory.',
  'Search the Block Collection for blocks that match the request.',
  'Return the inventory in the format identify-page-structure expects.',
].join('\n');

const line = (o) => JSON.stringify(o);

test('workerSucceeded separates worker failures from judge failures', () => {
  assert.equal(workerSucceeded({ status: 'ok' }), true);
  assert.equal(workerSucceeded({ status: 'error', error: 'judge timed out', turns: 3 }), true);
  assert.equal(workerSucceeded({ status: 'error', error: 'judge returned no parseable scores', turns: 2 }), true);
  assert.equal(workerSucceeded({ status: 'error', error: 'pi exited 1', turns: 2 }), false);
  assert.equal(workerSucceeded({ status: 'timeout', turns: 9 }), false);
  assert.equal(workerSucceeded({ status: 'error', error: 'judge timed out', turns: 0 }), false);
});

const SESSION = () =>
  [
    line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: {} }], usage: { input: 5, output: 5, totalTokens: 10, cost: { total: 0.25 } } } }),
    line({ type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: SKILL }] } }),
    line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { totalTokens: 5, cost: { total: 0.25 } } } }),
  ].join('\n');

async function makeRun(run) {
  await mkdir(join(run, 'context', 'org-p', 'skills', 'alpha'), { recursive: true });
  await writeFile(join(run, 'context', 'org-p', 'skills', 'alpha', 'SKILL.md'), SKILL);
  for (const v of ['with-plugin-1', 'baseline-1']) {
    await mkdir(join(run, 'attempts', 'org-p', 's1', v), { recursive: true });
    await writeFile(join(run, 'attempts', 'org-p', 's1', v, 'session.jsonl'), SESSION());
  }
}

const savedAttempts = (oldRunDir) => [
  { plugin: 'org/p', pluginSlug: 'org-p', scenario: 's1', variant: 'with-plugin', run: 1, dir: join(oldRunDir, 'attempts/org-p/s1/with-plugin-1'), status: 'ok', score: { pct: 80 }, activatedSkills: [], turns: 0 },
  { plugin: 'org/p', scenario: 's1', variant: 'baseline', run: 1, dir: join(oldRunDir, 'attempts/org-p/s1/baseline-1'), status: 'ok', score: { pct: 50 }, activatedSkills: ['x'] },
];

test('refreshAttempts recomputes metrics and skill use from saved sessions, keeping scores', async () => {
  const run = await makeSandboxRoot();
  try {
    await makeRun(run);
    const skills = await loadRunSkills(run);
    assert.deepEqual(Object.keys(skills), ['with-plugin']);
    assert.deepEqual(Object.keys(skills['with-plugin']), ['org-p']);
    const refreshed = await refreshAttempts(savedAttempts(run), skills, run);
    assert.deepEqual(refreshed[0].activatedSkills, ['alpha']);
    assert.equal(refreshed[0].turns, 2);
    assert.equal(refreshed[0].cost, 0.5);
    assert.equal(refreshed[0].score.pct, 80);
    assert.deepEqual(refreshed[1].activatedSkills, []);
  } finally {
    await removeDir(run);
  }
});

test('a moved run resolves attempts under the given run dir', async () => {
  const moved = await makeSandboxRoot();
  try {
    await makeRun(moved);
    const refreshed = await refreshAttempts(savedAttempts('/gone/original/run'), await loadRunSkills(moved), moved);
    assert.equal(attemptDir(moved, savedAttempts('/x')[1]), join(moved, 'attempts', 'org-p', 's1', 'baseline-1'));
    assert.equal(refreshed[0].dir, join(moved, 'attempts', 'org-p', 's1', 'with-plugin-1'));
    assert.equal(refreshed[0].turns, 2);
  } finally {
    await removeDir(moved);
  }
});

test('a missing session is an error, not zeroed metrics', async () => {
  const run = await makeSandboxRoot();
  try {
    await makeRun(run);
    await rm(join(run, 'attempts', 'org-p', 's1', 'baseline-1', 'session.jsonl'));
    await assert.rejects(refreshAttempts(savedAttempts(run), await loadRunSkills(run), run), /session\.jsonl/);
  } finally {
    await removeDir(run);
  }
});

test('judgeLabel reports the judges that actually produced the scores', () => {
  const a = (m) => ({ score: { pct: 1, ...(m ? { judgeModel: m } : {}) } });
  assert.equal(judgeLabel([a(), a()], 'old-judge'), 'old-judge');
  assert.equal(judgeLabel([a('new'), a('new')], 'old-judge'), 'new');
  assert.equal(judgeLabel([a('new'), a()], 'old-judge'), 'new, old-judge');
  assert.equal(judgeLabel([{ status: 'error' }], null), null);
});

test('successive partial re-judges never list a judge that produced no current score', () => {
  const attempts = [{ score: { pct: 1 } }, { score: { pct: 2 } }];
  let meta = { scorerModel: 'old' };
  tagJudgeModels(attempts, meta.scorerModel);
  attempts[1].score = { pct: 3, judgeModel: 'new-1' };
  meta = { scorerModel: judgeLabel(attempts, meta.scorerModel) };
  assert.equal(meta.scorerModel, 'new-1, old');
  tagJudgeModels(attempts, meta.scorerModel);
  attempts[1].score = { pct: 4, judgeModel: 'new-2' };
  assert.equal(judgeLabel(attempts, meta.scorerModel), 'new-2, old');
  assert.equal(attempts[0].score.judgeModel, 'old');
});

test('positiveInt rejects zero, negatives and non-integers', () => {
  assert.equal(positiveInt('4', '--concurrency'), 4);
  for (const bad of ['0', '-1', '1.5', 'x']) assert.throws(() => positiveInt(bad, '--concurrency'), /--concurrency/);
});

test('modelList splits commas, trims, dedupes and keeps order', () => {
  assert.deepEqual(modelList(['a/x, b/y', 'a/x', 'c/z']), ['a/x', 'b/y', 'c/z']);
  assert.deepEqual(modelList([], 'd/default'), ['d/default']);
  assert.throws(() => modelList([' , '], 'd/default'), /--model/);
});

test('attempts with a model live under a per-model dir; old runs keep their path', () => {
  const a = { pluginSlug: 'org-p', scenario: 's1', variant: 'baseline', run: 2 };
  assert.equal(attemptDir('/r', { ...a, model: 'gh/kimi-k3', modelSlug: 'gh-kimi-k3' }), join('/r', 'attempts', 'org-p', 's1', 'gh-kimi-k3', 'baseline-2'));
  assert.equal(attemptDir('/r', { ...a, model: 'gh/kimi-k3' }), join('/r', 'attempts', 'org-p', 's1', 'baseline-2'));
});

test('tagWorkerModels fills the run model into attempts saved before multi-model', () => {
  const attempts = [{ run: 1 }, { run: 2, model: 'other' }];
  tagWorkerModels(attempts, 'old/model');
  assert.deepEqual(attempts.map((a) => a.model), ['old/model', 'other']);
});

test('modelList rejects models whose dir names collide', () => {
  assert.throws(() => modelList(['custom/foo-bar,custom-foo/bar']), /custom\/foo-bar.*custom-foo\/bar/);
  assert.throws(() => modelList(['gh/Kimi,gh/kimi']), /collide/);
  assert.deepEqual(modelList(['a/x,b/x']), ['a/x', 'b/x']);
});

test('per-variant context dirs: each variant is checked against its own skills', async () => {
  const run = await makeSandboxRoot();
  try {
    await mkdir(join(run, 'context', 'main', 'org-p', 'skills', 'alpha'), { recursive: true });
    await writeFile(join(run, 'context', 'main', 'org-p', 'skills', 'alpha', 'SKILL.md'), SKILL);
    await mkdir(join(run, 'context', 'branch', 'org-p', 'skills'), { recursive: true });
    for (const v of ['main-1', 'branch-1']) {
      await mkdir(join(run, 'attempts', 'org-p', 's1', v), { recursive: true });
      await writeFile(join(run, 'attempts', 'org-p', 's1', v, 'session.jsonl'), SESSION());
    }
    const skills = await loadRunSkills(run, { contexts: [] });
    assert.deepEqual(Object.keys(skills).sort(), ['branch', 'main']);
    const base = { plugin: 'org/p', pluginSlug: 'org-p', scenario: 's1', run: 1, status: 'ok' };
    const [main, branch] = await refreshAttempts([{ ...base, variant: 'main' }, { ...base, variant: 'branch' }], skills, run);
    assert.deepEqual(main.activatedSkills, ['alpha']);
    assert.deepEqual(branch.activatedSkills, []);
  } finally {
    await removeDir(run);
  }
});

test('run meta, not dir shape, picks the context layout (plugin slug "skills")', async () => {
  const run = await makeSandboxRoot();
  try {
    await mkdir(join(run, 'context', 'main', 'skills', 'skills', 'alpha'), { recursive: true });
    await writeFile(join(run, 'context', 'main', 'skills', 'skills', 'alpha', 'SKILL.md'), SKILL);
    const skills = await loadRunSkills(run, { contexts: [] });
    assert.deepEqual(Object.keys(skills), ['main']);
    assert.deepEqual(skills.main.skills.map((s) => s.name), ['alpha']);
  } finally {
    await removeDir(run);
  }
});

test('labels and plugin slugs that shadow Object.prototype keys load safely', async () => {
  const run = await makeSandboxRoot();
  try {
    await mkdir(join(run, 'context', 'constructor', 'name', 'skills', 'alpha'), { recursive: true });
    await writeFile(join(run, 'context', 'constructor', 'name', 'skills', 'alpha', 'SKILL.md'), SKILL);
    const skills = await loadRunSkills(run, { contexts: [] });
    assert.deepEqual(skills.constructor.name.map((s) => s.name), ['alpha']);
    assert.equal(skills.toString, undefined);
  } finally {
    await removeDir(run);
  }
});
