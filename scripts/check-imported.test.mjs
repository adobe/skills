import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviations, touchedImports } from './check-imported.mjs';
import { licenses, withoutSource } from './check-plugins.mjs';
import { findViolations } from './check-skills.mjs';
import { IMPORTED, importOf, isImported } from './lib/imported.mjs';
import { tree } from './lib/testing.mjs';

const creativity = IMPORTED.find(({ name }) => name === 'adobe-for-creativity');
const long = `---\nname: big\ndescription: d\n---\n${'word '.repeat(1200)}\n`;
const TREE = {
  // ours: a plugin with its source
  'plugins/ours/plugin.json': '{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"ours"}',
  'plugins/ours/.claude-plugin/plugin.json': '{}',
  'plugins/ours/skills/one/SKILL.md': '---\nname: one\nlicense: Apache-2.0\n---\nbody\n',
  // brought in: hand-written manifest, no Tessl manifest, a long skill without a license
  'plugins/creative-cloud/adobe-for-creativity/.claude-plugin/plugin.json': '{"name":"adobe-for-creativity"}',
  'plugins/creative-cloud/adobe-for-creativity/skills/big/SKILL.md': long,
};

test('what is brought in is found by path, a file or a directory, and nothing next to it', () => {
  assert.equal(importOf('plugins/creative-cloud/adobe-for-creativity'), creativity);
  assert.equal(importOf('plugins/creative-cloud/adobe-for-creativity/skills/configure/SKILL.md'), creativity);
  assert.equal(isImported('plugins/creative-cloud/adobe-for-creativity-next'), false);
  assert.equal(isImported('plugins/creative-cloud/run-workflow/.claude-plugin/plugin.json'), false);
  assert.equal(isImported('plugins/creative-cloud/run-workflow/skills/run-workflow/SKILL.md'), true);
});

test('the checks of the whole tree leave out what is brought in', (t) => {
  const root = tree(t, TREE);
  assert.deepEqual(withoutSource(root), []);
  assert.deepEqual(licenses(root).map(({ file }) => file), ['plugins/ours/skills/one/SKILL.md']);
  assert.deepEqual(findViolations(root).filter(({ file }) => isImported(file)), []);
});

test('a pull request that touches an import gets every rule the import breaks', (t) => {
  const root = tree(t, TREE);
  assert.deepEqual(touchedImports(['plugins/ours/skills/one/SKILL.md']), []);
  assert.deepEqual(touchedImports(['plugins/creative-cloud/adobe-for-creativity/skills/big/SKILL.md']), [creativity]);
  const found = deviations(root, creativity).map(({ rule, file }) => `${rule} ${file}`).sort();
  assert.deepEqual(found, [
    'license plugins/creative-cloud/adobe-for-creativity/skills/big/SKILL.md',
    'over-token-limit plugins/creative-cloud/adobe-for-creativity/skills/big/SKILL.md',
    'source plugins/creative-cloud/adobe-for-creativity/.claude-plugin/plugin.json',
    'tessl plugins/creative-cloud/adobe-for-creativity/.claude-plugin/plugin.json',
  ]);
});

test('the Tessl lint warnings of an import are listed when the CLI is there', (t) => {
  const root = tree(t, { ...TREE, 'plugins/creative-cloud/adobe-for-creativity/.tessl-plugin/plugin.json': '{}' });
  const lint = (dir) => [{ file: `${dir}/skills/big/SKILL.md`, text: 'too big' }];
  const found = deviations(root, creativity, lint).map(({ rule }) => rule);
  assert.ok(found.includes('tessl-lint-warning'));
  assert.ok(!found.includes('tessl'));
});
