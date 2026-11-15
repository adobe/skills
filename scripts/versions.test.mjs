import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDirs } from './lib/changed.mjs';
import { duplicateNames, ensureBaseline, isImported, isVersion, manifestVersion, skillVersion } from './lib/release.mjs';
import { commit, git, run, tree, write } from './lib/testing.mjs';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const plugin = (name, version) => `${JSON.stringify({ $schema: SCHEMA, name, version }, null, 2)}\n`;
const skill = (name, version, body = 'body') => `---\nname: ${name}\ndescription: d\n${version ? `metadata:\n  version: "${version}"\n` : ''}---\n${body}\n`;

test('the version of a skill is metadata.version in its frontmatter, and nothing else', () => {
  assert.equal(skillVersion('---\nname: a\nmetadata:\n  version: "1.2.3"\n---\n'), '1.2.3');
  assert.equal(skillVersion('---\nname: a\nmetadata:\n  author: x\n  version: 2.0.0\nlicense: MIT\n---\n'), '2.0.0');
  assert.equal(skillVersion('---\nname: a\nversion: 9.9.9\n---\n'), undefined);
  assert.equal(skillVersion('---\nname: a\n---\nmetadata:\n  version: "1.0.0"\n'), undefined);
  assert.equal(manifestVersion('{"version":"1.0.0"}'), '1.0.0');
  assert.equal(manifestVersion('not json'), undefined);
});

test('what is imported, what a version is, and which folder names are taken twice', () => {
  assert.equal(isImported('plugins/commerce/app-review'), true);
  assert.equal(isImported('plugins/creative-cloud/adobe-for-creativity/skills/adobe'), true);
  assert.equal(isImported('plugins/creative-cloud/run-workflow/skills/run-workflow'), true);
  assert.equal(isImported('plugins/creative-cloud/run-workflow'), false);
  assert.equal(isImported('plugins/commerce-tools'), false);
  assert.deepEqual([isVersion('1.2.3'), isVersion('0.38.6'), isVersion('1.0.0-rc.1'), isVersion('1.2'), isVersion('v1.2.3'), isVersion(undefined)], [true, true, true, false, false, false]);
  assert.deepEqual([...duplicateNames(['plugins/a/skills/x', 'plugins/b/skills/x', 'plugins/b/skills/y'])], ['x']);
});

test('only a root plugin.json with the Agent Plugins schema makes a plugin that is released', (t) => {
  const root = tree(t, {
    'plugins/a/plugin.json': plugin('a', '1.0.0'),
    'plugins/a/.claude-plugin/plugin.json': '{"name":"a"}',
    'plugins/product/b/plugin.json': plugin('b', '1.0.0'),
    'plugins/c/.claude-plugin/plugin.json': '{"name":"c"}',
    'plugins/d/plugin.json': '{"name":"d"}',
    'plugins/a/skills/s/assets/plugin.json': '{"name":"an asset"}',
  });
  assert.deepEqual(pluginDirs(root), ['plugins/a', 'plugins/product/b']);
  const before = commit(root);
  write(root, { 'plugins/a/skills/s/SKILL.md': 'changed', 'plugins/c/README.md': 'changed' });
  const after = commit(root);
  assert.equal(run(t, 'changed.mjs', ['plugins', `${before}..${after}`], { cwd: root }).stdout, 'plugins/a\n');
});

test('the tag a release counts from: made once, on the commit before the push, and pushed', (t) => {
  const origin = mkdtempSync(join(tmpdir(), 'skills-origin-'));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = tree(t, { 'a.txt': '1' });
  const before = commit(root, 'before');
  git(root, 'remote', 'add', 'origin', origin);
  write(root, { 'a.txt': '2' });
  commit(root, 'the push');
  git(root, 'push', '-q', 'origin', 'main');
  const args = { prefix: 'plugin/a/v', version: '0.38.6', before };
  assert.equal(ensureBaseline(root, args), 'created');
  assert.equal(git(root, 'rev-parse', 'plugin/a/v0.38.6^{commit}'), before);
  assert.equal(git(origin, 'rev-parse', 'plugin/a/v0.38.6^{commit}'), before);
  assert.equal(ensureBaseline(root, { ...args, version: '0.39.0' }), 'tagged');
  assert.equal(git(root, 'tag', '--list'), 'plugin/a/v0.38.6');
  // no version before the push: the first release is 1.0.0, no tag needed
  assert.equal(ensureBaseline(root, { prefix: 'new-v', version: undefined, before }), 'first');
  // a version, and no commit to put the tag on
  assert.equal(ensureBaseline(root, { prefix: 'old-v', version: '2.0.0', before: '0000000000000000000000000000000000000000' }), 'unknown');
  // a tag of another skill whose name starts the same does not count
  git(root, 'tag', 'web-cli-v1.0.0');
  assert.equal(ensureBaseline(root, { prefix: 'web-v', version: '1.1.0', before, push: false }), 'created');
});

// A repository on main, and a pull request's change on top of it.
function branch(t, change) {
  const root = tree(t, {
    'plugins/a/plugin.json': plugin('a', '1.0.0'),
    'plugins/a/skills/one/SKILL.md': skill('one', '1.2.0'),
    'plugins/a/skills/plain/SKILL.md': skill('plain'),
    'plugins/a/skills/same/SKILL.md': skill('same', '1.0.0'),
    'plugins/b/.claude-plugin/plugin.json': '{"name":"b","version":"1.0.0"}',
    'plugins/b/skills/same/SKILL.md': skill('same', '1.0.0'),
    'plugins/commerce/c/plugin.json': plugin('c', '4.0.0'),
    'plugins/commerce/c/skills/theirs/SKILL.md': skill('theirs', '4.0.0'),
  });
  const base = commit(root, 'base');
  write(root, change);
  commit(root, 'change');
  return run(t, 'check-versions.mjs', [base], { cwd: root });
}

test('a pull request that changes a skill and a plugin.json but no version passes', (t) => {
  const result = branch(t, { 'plugins/a/skills/one/SKILL.md': skill('one', '1.2.0', 'new body'), 'plugins/a/plugin.json': plugin('a', '1.0.0').replace('"a"', '"a"') + '\n' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No version that a release sets is changed here/);
});

test('a plugin version and a skill version changed by hand fail, and are named', (t) => {
  const result = branch(t, { 'plugins/a/plugin.json': plugin('a', '1.1.0'), 'plugins/a/skills/one/SKILL.md': skill('one', '2.0.0'), 'plugins/a/skills/plain/SKILL.md': skill('plain', '1.0.0') });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/a\/plugin\.json::The version of the plugin a is set by the release.* from 1\.0\.0 to 1\.1\.0/);
  assert.match(result.stdout, /::error file=plugins\/a\/skills\/one\/SKILL\.md::The version of the skill one .* from 1\.2\.0 to 2\.0\.0/);
  assert.match(result.stdout, /::error file=plugins\/a\/skills\/plain\/SKILL\.md::.* from none to 1\.0\.0/);
  assert.match(result.summary, /`plugins\/a\/plugin\.json`: 1\.0\.0 → 1\.1\.0/);
});

test('new skills and plugins, imported ones, a hand-written manifest and a folder name taken twice may change their version', (t) => {
  const result = branch(t, {
    'plugins/a/skills/new/SKILL.md': skill('new', '0.5.0'),
    'plugins/n/plugin.json': plugin('n', '0.1.0'),
    'plugins/commerce/c/plugin.json': plugin('c', '4.1.0'),
    'plugins/commerce/c/skills/theirs/SKILL.md': skill('theirs', '4.1.0'),
    'plugins/b/.claude-plugin/plugin.json': '{"name":"b","version":"1.1.0"}',
    'plugins/a/skills/same/SKILL.md': skill('same', '1.1.0'),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
