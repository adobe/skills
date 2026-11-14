import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalPluginDirs, releaseDirs, skillDirs, tesslPluginDirs, touched } from './lib/changed.mjs';
import { commit, run, tree, write } from './lib/testing.mjs';

const TREE = {
  'plugins/a/.tessl-plugin/plugin.json': '{}',
  'plugins/a/skills/one/SKILL.md': 'one',
  'plugins/a/skills/one/references/r.md': 'r',
  'plugins/a/skills/one/inner/SKILL.md': 'inner',
  'plugins/a/skills/one-more/SKILL.md': 'one-more',
  'plugins/b/skills/two/SKILL.md': 'two',
  'plugins/b/README.md': 'readme',
  'plugins/b/node_modules/dep/skills/x/SKILL.md': 'x',
  'plugins/web/cli/src/index.mjs': 'cli',
  'README.md': 'root',
};

test('skill and plugin directories come from the tree, without node_modules', (t) => {
  const root = tree(t, TREE);
  assert.deepEqual(skillDirs(root), ['plugins/a/skills/one', 'plugins/a/skills/one-more', 'plugins/a/skills/one/inner', 'plugins/b/skills/two']);
  assert.deepEqual(tesslPluginDirs(root), ['plugins/a']);
});

test('a file belongs to the outermost skill it lies in, and a similar name is another skill', (t) => {
  const dirs = skillDirs(tree(t, TREE));
  assert.deepEqual(touched(['plugins/a/skills/one/inner/SKILL.md'], dirs), ['plugins/a/skills/one']);
  assert.deepEqual(touched(['plugins/a/skills/one-more/SKILL.md'], dirs), ['plugins/a/skills/one-more']);
  assert.deepEqual(touched(['plugins/b/README.md', 'README.md'], dirs), []);
});

test('touched directories are listed once, in the order they are first touched', (t) => {
  const dirs = skillDirs(tree(t, TREE));
  assert.deepEqual(
    touched(['plugins/b/skills/two/SKILL.md', 'plugins/a/skills/one/SKILL.md', 'plugins/a/skills/one/references/r.md'], dirs),
    ['plugins/b/skills/two', 'plugins/a/skills/one'],
  );
});

test('a change to the web CLI is released with the touched skills', (t) => {
  const dirs = skillDirs(tree(t, TREE));
  assert.deepEqual(releaseDirs(['plugins/web/cli/src/index.mjs', 'plugins/b/skills/two/SKILL.md'], dirs), ['plugins/b/skills/two', 'plugins/web/cli']);
  assert.deepEqual(releaseDirs(['plugins/web/README.md'], dirs), []);
});

test('a change outside every Tessl plugin evaluates all of them; one inside evaluates that one', () => {
  const plugins = ['plugins/a', 'plugins/c'];
  assert.deepEqual(evalPluginDirs(['plugins/c/skills/s/SKILL.md'], plugins), ['plugins/c']);
  assert.deepEqual(evalPluginDirs(['plugins/b/README.md'], plugins), ['plugins/a', 'plugins/c']);
  assert.deepEqual(evalPluginDirs(['README.md', '.github/workflows/x.yml'], plugins), []);
});

test('the command prints what changed between two commits', (t) => {
  const root = tree(t, TREE);
  const before = commit(root);
  write(root, { 'plugins/b/skills/two/SKILL.md': 'two, changed', 'plugins/web/cli/src/index.mjs': 'cli, changed' });
  const after = commit(root);
  assert.equal(run(t, 'changed.mjs', ['skills', before, after], { cwd: root }).stdout, 'plugins/b/skills/two\n');
  assert.equal(run(t, 'changed.mjs', ['release', `${before}..${after}`], { cwd: root }).stdout, 'plugins/b/skills/two\nplugins/web/cli\n');
  assert.equal(run(t, 'changed.mjs', ['tessl-plugins', `${before}...${after}`], { cwd: root }).stdout, 'plugins/a\n');
});

test('a directory name with shell syntax is printed, not run', (t) => {
  const root = tree(t, TREE);
  const before = commit(root);
  write(root, { 'plugins/b/skills/$(touch pwned)/SKILL.md': 'x' });
  const after = commit(root);
  const result = run(t, 'changed.mjs', ['skills', before, after], { cwd: root });
  assert.equal(result.stdout, 'plugins/b/skills/$(touch pwned)\n');
});

test('a range git cannot resolve uses the fallback, or fails without one', (t) => {
  const root = tree(t, TREE);
  commit(root);
  const zeros = '0'.repeat(40);
  const withFallback = run(t, 'changed.mjs', ['release', `${zeros}..HEAD`, '--fallback', 'HEAD'], { cwd: root });
  assert.equal(withFallback.status, 0);
  assert.equal(withFallback.stdout, '');
  assert.equal(run(t, 'changed.mjs', ['release', `${zeros}..HEAD`], { cwd: root }).status, 2);
});
