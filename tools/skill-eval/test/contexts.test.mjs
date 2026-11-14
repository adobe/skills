import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachContexts, parseContextSpecs } from '../lib/contexts.mjs';
import { resolveTargets } from '../lib/scenarios.mjs';

async function file(p, content) {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, content);
}

async function makePlugin(name, skills, { scenarios = ['one'] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'skill-eval-ctx-'));
  await file(join(root, '.tessl-plugin', 'plugin.json'), JSON.stringify({ name }));
  for (const s of skills) await file(join(root, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: ${s}\n---\n${s} body`);
  for (const s of scenarios) {
    await file(join(root, 'evals', s, 'task.md'), `do ${s}`);
    await file(join(root, 'evals', s, 'criteria.json'), JSON.stringify({ checklist: [{ name: 'c', max_score: 1, description: 'd' }] }));
  }
  return root;
}

test('parseContextSpecs splits label=dir and validates labels', () => {
  const [a] = parseContextSpecs(['main=/x/plugin=odd']);
  assert.equal(a.label, 'main');
  assert.equal(a.dir, '/x/plugin=odd');
  for (const bad of ['main', '=x', 'main=', 'bad label=/x', 'baseline=/x', '../up=/x']) assert.throws(() => parseContextSpecs([bad]), /--context/);
  assert.throws(() => parseContextSpecs(['a=/x', 'A=/y']), /--context/);
});

test('without --context the source plugin is the with-plugin variant', async () => {
  const root = await makePlugin('org/p', ['alpha', 'beta']);
  const targets = await resolveTargets([root]);
  const { variants } = await attachContexts(targets, []);
  assert.deepEqual(variants, ['with-plugin']);
  assert.deepEqual(Object.keys(targets[0].contexts), ['with-plugin']);
  assert.equal(targets[0].contexts['with-plugin'], targets[0].plugin);
});

test('contexts become variants matched to source plugins by name', async () => {
  const src = await makePlugin('org/p', ['alpha']);
  const main = await makePlugin('org/p', ['alpha', 'beta'], { scenarios: [] });
  const branch = await makePlugin('org/p', ['alpha'], { scenarios: [] });
  const targets = await resolveTargets([src]);
  const { variants } = await attachContexts(targets, parseContextSpecs([`main=${main}`, `branch=${branch}`]));
  assert.deepEqual(variants, ['main', 'branch']);
  assert.equal(targets[0].contexts.main.root, main);
  assert.deepEqual(targets[0].contexts.main.skills.map((s) => s.name), ['alpha', 'beta']);
  assert.deepEqual(targets[0].contexts.branch.skills.map((s) => s.name), ['alpha']);
  assert.deepEqual(targets[0].scenarios.map((s) => s.name), ['one']);
});

test('a context must name a plugin root that matches every target', async () => {
  const src = await makePlugin('org/p', ['alpha']);
  const other = await makePlugin('org/other', ['alpha'], { scenarios: [] });
  const targets = await resolveTargets([src]);
  await assert.rejects(attachContexts(targets, parseContextSpecs([`main=${other}`])), /main.*org\/p/);
  await assert.rejects(attachContexts(targets, parseContextSpecs([`main=${join(src, 'skills')}`])), /not a plugin root/);
  await assert.rejects(attachContexts(targets, parseContextSpecs([`main=${src}`, `main=${src}`])), /twice/);
});

test('one label can cover several plugins', async () => {
  const p = await makePlugin('org/p', ['alpha']);
  const q = await makePlugin('org/q', ['gamma']);
  const targets = await resolveTargets([p, q]);
  const { variants } = await attachContexts(targets, parseContextSpecs([`v=${p}`, `v=${q}`]));
  assert.deepEqual(variants, ['v']);
  assert.deepEqual(targets.map((t) => t.contexts.v.name), ['org/p', 'org/q']);
});

test('--skill narrows every context; unknown everywhere is an error', async () => {
  const src = await makePlugin('org/p', ['alpha', 'beta']);
  const main = await makePlugin('org/p', ['alpha', 'beta', 'gamma'], { scenarios: [] });
  let targets = await resolveTargets([src]);
  await attachContexts(targets, parseContextSpecs([`main=${main}`, `head=${src}`]), ['gamma', 'alpha']);
  assert.deepEqual(targets[0].contexts.main.skills.map((s) => s.name), ['alpha', 'gamma']);
  assert.deepEqual(targets[0].contexts.head.skills.map((s) => s.name), ['alpha']);

  targets = await resolveTargets([src]);
  await assert.rejects(attachContexts(targets, [], ['nope']), /Unknown skill/);

  targets = await resolveTargets([src]);
  await attachContexts(targets, [], ['beta']);
  assert.deepEqual(targets[0].contexts['with-plugin'].skills.map((s) => s.name), ['beta']);
});

test('a plugin with none of the --skill skills in any context is dropped', async () => {
  const p = await makePlugin('org/p', ['alpha']);
  const q = await makePlugin('org/q', ['gamma']);
  const targets = await resolveTargets([p, q]);
  const { targets: kept } = await attachContexts(targets, [], ['gamma']);
  assert.deepEqual(kept.map((t) => t.plugin.name), ['org/q']);
});

test('baseline is reserved in any case', () => {
  for (const bad of ['Baseline=/x', 'BASELINE=/x']) assert.throws(() => parseContextSpecs([bad]), /reserved/);
});
