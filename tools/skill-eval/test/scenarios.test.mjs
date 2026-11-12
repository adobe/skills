import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPlugin, matchesFilter, resolveTargets } from '../lib/scenarios.mjs';

async function file(p, content) {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, content);
}

async function makePlugin(manifest = {}) {
  const root = await mkdtemp(join(tmpdir(), 'skill-eval-test-'));
  await file(join(root, '.tessl-plugin', 'plugin.json'), JSON.stringify({ name: 'org/demo', ...manifest }));
  await file(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha-skill\ndescription: a\n---\nbody');
  await file(join(root, 'skills', 'beta', 'SKILL.md'), '---\nname: "beta"\ndescription: b\n---\nbody');
  await mkdir(join(root, 'skills', 'not-a-skill'), { recursive: true });
  for (const name of ['one', 'two', 'other']) {
    await file(join(root, 'evals', name, 'task.md'), `do ${name}`);
    await file(
      join(root, 'evals', name, 'criteria.json'),
      JSON.stringify({ type: 'weighted_checklist', checklist: [{ name: 'c', max_score: 10, description: 'd' }] }),
    );
  }
  await mkdir(join(root, 'evals', 'no-task'), { recursive: true });
  return root;
}

test('loadPlugin discovers skills by convention and reads names from frontmatter', async () => {
  const root = await makePlugin();
  const p = await loadPlugin(root);
  assert.deepEqual(p.skills.map((s) => s.name), ['alpha-skill', 'beta']);
  assert.equal(p.name, 'org/demo');
  assert.deepEqual(p.unsupported, []);
});

test('loadPlugin honours an explicit skills array and flags unsupported features', async () => {
  const root = await makePlugin({ skills: ['skills/beta'], hooks: {} });
  await file(join(root, 'rules', 'style.md'), 'rule');
  const p = await loadPlugin(root);
  assert.deepEqual(p.skills.map((s) => s.name), ['beta']);
  assert.equal(p.rules.length, 1);
  assert.deepEqual(p.unsupported, ['hooks']);
});

test('resolveTargets accepts plugin roots and scenario dirs, deduped, with filters', async () => {
  const root = await makePlugin();
  const all = await resolveTargets([root]);
  assert.deepEqual(all[0].scenarios.map((s) => s.name), ['one', 'other', 'two']);

  const one = await resolveTargets([join(root, 'evals', 'one'), join(root, 'evals', 'one')]);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].scenarios.map((s) => s.name), ['one']);

  const filtered = await resolveTargets([root], { scenarioFilters: ['o*'] });
  assert.deepEqual(filtered[0].scenarios.map((s) => s.name), ['one', 'other']);
});

test('resolveTargets rejects paths outside a plugin', async () => {
  await assert.rejects(resolveTargets([tmpdir()]), /not inside a plugin/);
});

test('matchesFilter supports exact names and * wildcards', () => {
  assert.equal(matchesFilter('analyze-hero', []), true);
  assert.equal(matchesFilter('analyze-hero', ['analyze-*']), true);
  assert.equal(matchesFilter('analyze-hero', ['analyze']), false);
  assert.equal(matchesFilter('a.b', ['a*b']), true);
});
