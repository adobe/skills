import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLicense, licenses, uncoveredPlugins } from './check-plugins.mjs';
import { run, tree } from './lib/testing.mjs';

const TREE = {
  'plugins/a/.claude-plugin/plugin.json': '{}',
  'plugins/a/skills/one/SKILL.md': '---\nname: one\nlicense: Apache-2.0\n---\nbody\n',
  'plugins/product/b/.claude-plugin/plugin.json': '{}',
  'plugins/product/b/skills/two/SKILL.md': '---\nname: two\n---\nlicense: only in the body\n',
  'plugins/product/bb/.claude-plugin/plugin.json': '{}',
};

test('a plugin is covered by a line that starts with its path and a slash or white space', (t) => {
  const root = tree(t, TREE);
  assert.deepEqual(uncoveredPlugins(root, '*  @admin\n/plugins/a/  @x\n/plugins/product/b @y\n/plugins/product/bb\t@z\n'), []);
  assert.deepEqual(uncoveredPlugins(root, '*  @admin\n# /plugins/a/ @x\n/plugins/product/bb/ @z\n'), ['/plugins/a', '/plugins/product/b']);
});

test('a license field counts only in the frontmatter', (t) => {
  assert.equal(hasLicense('---\nname: x\nlicense: Apache-2.0\n---\n'), true);
  assert.equal(hasLicense('---\nname: x\n---\nlicense: Apache-2.0\n'), false);
  assert.equal(hasLicense('no frontmatter\nlicense: Apache-2.0\n'), false);
  assert.deepEqual(licenses(tree(t, TREE)), [
    { file: 'plugins/a/skills/one/SKILL.md', ok: true },
    { file: 'plugins/product/b/skills/two/SKILL.md', ok: false },
  ]);
});

test('the commands fail with an annotation per violation, and pass on a clean tree', (t) => {
  const root = tree(t, { ...TREE, '.github/CODEOWNERS': '/plugins/a/ @x\n/plugins/product/bb/ @z\n' });
  const owners = run(t, 'check-plugins.mjs', ['codeowners'], { cwd: root });
  assert.equal(owners.status, 1);
  assert.match(owners.stdout, /::error file=\.github\/CODEOWNERS::\/plugins\/product\/b is not covered/);
  const license = run(t, 'check-plugins.mjs', ['license'], { cwd: root });
  assert.equal(license.status, 1);
  assert.match(license.stdout, /::error file=plugins\/product\/b\/skills\/two\/SKILL\.md::/);
  assert.match(license.summary, /\| plugins\/a\/skills\/one\/SKILL\.md \| ✅ Pass \|/);

  const clean = tree(t, { 'plugins/a/.claude-plugin/plugin.json': '{}', 'plugins/a/skills/one/SKILL.md': TREE['plugins/a/skills/one/SKILL.md'], '.github/CODEOWNERS': '/plugins/a/ @x\n' });
  assert.equal(run(t, 'check-plugins.mjs', ['codeowners'], { cwd: clean }).status, 0);
  assert.equal(run(t, 'check-plugins.mjs', ['license'], { cwd: clean }).status, 0);
});

test('without a CODEOWNERS file the codeowners check fails', (t) => {
  const result = run(t, 'check-plugins.mjs', ['codeowners'], { cwd: tree(t, TREE) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CODEOWNERS file not found/);
});
