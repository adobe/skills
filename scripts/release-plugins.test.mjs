import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { released, withVersion } from './prepare-plugin-release.mjs';
import { commit, fakeBin, git, run, tree, write } from './lib/testing.mjs';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const plugin = (name, version) => JSON.stringify({ $schema: SCHEMA, name, ...(version ? { version } : {}) });
const NPX = 'echo "$(basename "$PWD") $*" >> "$CALLS"; case "$PWD" in */bad) exit 3 ;; esac';

test('the new version goes to plugin.json, to a target that overrides the version, and the Tessl skills list is what ships', () => {
  const manifest = {
    name: 'p',
    version: '1.0.0',
    extensions: { 'io.github.ai-ecoverse.x927': { targets: { claude: {}, tessl: { name: 'x/p', version: '0.1.0', skills: ['skills/gone'] }, cursor: { displayName: 'P' } } } },
  };
  const next = withVersion(manifest, '1.1.0', ['skills/a', 'skills/b']);
  assert.equal(next.version, '1.1.0');
  assert.deepEqual(next.extensions['io.github.ai-ecoverse.x927'].targets, { claude: {}, tessl: { name: 'x/p', version: '1.1.0', skills: ['skills/a', 'skills/b'] }, cursor: { displayName: 'P' } });
  assert.equal(manifest.version, '1.0.0', 'the input is not changed');
  assert.deepEqual(withVersion({ name: 'q' }, '2.0.0', []), { name: 'q', version: '2.0.0' });
});

test('the first Unreleased heading of a hand-written changelog becomes the version', () => {
  assert.equal(released('# Changelog\n\n## Unreleased — a title\n\ntext\n\n## 1.0.0\n', '1.1.0'), '# Changelog\n\n## 1.1.0 — a title\n\ntext\n\n## 1.0.0\n');
  assert.equal(released('## Unreleased\n\n## Unreleased\n', '2.0.0'), '## 2.0.0\n\n## Unreleased\n');
  assert.equal(released('## 1.0.0\n\nUnreleased work is mentioned here.\n', '1.1.0'), '## 1.0.0\n\nUnreleased work is mentioned here.\n');
});

// A repository with one commit before the push and one that is the push.
function pushed(t, files, dirs) {
  const root = tree(t, { 'plugin.release.config.cjs': '', ...files });
  const before = commit(root, 'before');
  write(root, { 'dirs.txt': dirs.join('\n') });
  commit(root, 'fix: the push');
  const result = run(t, 'release-plugins.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: before } });
  const calls = existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n') : [];
  return { root, before, result, calls };
}

test('a plugin is released in its directory with the shared config, counting from its version before the push', (t) => {
  const { root, before, result, calls } = pushed(t, { 'plugins/a/plugin.json': plugin('alpha', '0.38.6') }, ['plugins/a']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^a semantic-release --extends \S+\/plugin\.release\.config\.cjs$/);
  assert.equal(git(root, 'rev-parse', 'plugin/alpha/v0.38.6^{commit}'), before);
  assert.match(result.summary, /\| alpha \| released, or nothing to release \| ✅ \|/);
});

test('a plugin that got its plugin.json in this push counts from its Claude Code manifest; a new plugin from nothing', (t) => {
  const root = tree(t, { 'plugin.release.config.cjs': '', 'plugins/old/.claude-plugin/plugin.json': '{"name":"old","version":"2.3.0"}' });
  const before = commit(root, 'before');
  write(root, { 'plugins/old/plugin.json': plugin('old', '2.3.0'), 'plugins/new/plugin.json': plugin('new', '0.0.1'), 'dirs.txt': 'plugins/old\nplugins/new\n' });
  commit(root, 'feat: the push');
  const result = run(t, 'release-plugins.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: before } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git(root, 'rev-parse', 'plugin/old/v2.3.0^{commit}'), before);
  assert.equal(git(root, 'tag', '--list', 'plugin/new/*'), '');
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').length, 2);
});

test('tags that are there are left alone; an imported plugin and an unknown commit before the push are skipped', (t) => {
  const { root, result, calls } = pushed(t, {
    'plugins/a/plugin.json': plugin('alpha', '1.0.0'),
    'plugins/commerce/c/plugin.json': plugin('theirs', '4.0.0'),
  }, ['plugins/commerce/c', 'plugins/a']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.length, 1);
  assert.match(result.summary, /\| theirs \| skipped \(brought in from another repository\) \| ⏭️ \|/);
  // a second push: the tag is there, none is added
  const again = run(t, 'release-plugins.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: git(root, 'rev-parse', 'HEAD') } });
  assert.equal(again.status, 0);
  assert.equal(git(root, 'tag', '--list', 'plugin/alpha/*'), 'plugin/alpha/v1.0.0');
  // a plugin with a version, no tag, and no known commit before the push: not released
  const other = tree(t, { 'plugin.release.config.cjs': '', 'plugins/b/plugin.json': plugin('beta', '5.0.0'), 'dirs.txt': 'plugins/b\n' });
  commit(other, 'only commit');
  const unknown = run(t, 'release-plugins.mjs', ['dirs.txt'], { cwd: other, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(other, 'calls'), BEFORE: '' } });
  assert.equal(unknown.status, 0, unknown.stdout + unknown.stderr);
  assert.equal(existsSync(join(other, 'calls')), false);
  assert.match(unknown.summary, /\| beta \| skipped \(it is at 5\.0\.0, and the commit before this push is not known\) \| ⏭️ \|/);
});

test('a failed release fails the step, after the other plugins were released', (t) => {
  const { root, before, result, calls } = pushed(t, { 'plugins/bad/plugin.json': plugin('bad'), 'plugins/a/plugin.json': plugin('alpha') }, ['plugins/bad', 'plugins/a']);
  assert.equal(result.status, 1);
  // a plugin that was there without a version counts as 1.0.0
  assert.equal(git(root, 'rev-parse', 'plugin/alpha/v1.0.0^{commit}'), before);
  assert.equal(calls.length, 2);
  assert.match(result.stdout, /::error::Release failed for the plugin bad \(exit code 3\)/);
});
