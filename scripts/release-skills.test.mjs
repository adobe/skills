import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit, fakeBin, git, run, tree, write } from './lib/testing.mjs';

const skill = (name, version) => `---\nname: ${name}\n${version ? `metadata:\n  version: "${version}"\n` : ''}---\nbody\n`;
const TREE = {
  'release.config.cjs': '',
  'plugins/a/skills/good/SKILL.md': skill('good', '1.2.0'),
  'plugins/a/skills/bad/SKILL.md': skill('bad'),
  'plugins/a/skills/fresh/SKILL.md': skill('fresh'),
  'plugins/a/skills/same/SKILL.md': skill('same'),
  'plugins/b/skills/same/SKILL.md': skill('same'),
  'plugins/commerce/x/skills/theirs/SKILL.md': skill('theirs', '3.0.0'),
  'plugins/web/cli/release.config.cjs': '',
  'plugins/a/docs/README.md': 'no skill',
};
// npx records where it was called and with what, and fails in the skill named "bad"
const NPX = 'echo "$(basename "$PWD") $*" >> "$CALLS"; case "$PWD" in */bad) exit 3 ;; esac';

// A repository with one commit before the push and one that is the push.
function pushed(t, dirs) {
  const root = tree(t, TREE);
  const before = commit(root, 'before');
  write(root, { 'dirs.txt': dirs.join('\n'), 'plugins/a/skills/good/SKILL.md': `${skill('good', '1.2.0')}more\n` });
  commit(root, 'fix: the push');
  // no remote here: the tag is made, and the push of it fails with a warning
  const result = run(t, 'release-skills.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: before } });
  const calls = existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n') : [];
  return { root, before, result, calls };
}

test('a skill needs no release files: semantic-release runs in its directory with the shared config', (t) => {
  const { root, result, calls } = pushed(t, ['plugins/a/skills/good']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^good semantic-release --extends \S+\/release\.config\.cjs$/);
  assert.match(result.summary, /\| good \| released, or nothing to release \| ✅ \|/);
});

test('a skill without a tag is tagged on the commit before the push: with its version, or 1.0.0 when it had none; a new skill is not', (t) => {
  const root = tree(t, TREE);
  const before = commit(root, 'before');
  write(root, { 'dirs.txt': 'plugins/a/skills/good\nplugins/a/skills/fresh\nplugins/a/skills/brand-new\n', 'plugins/a/skills/brand-new/SKILL.md': skill('brand-new', '0.3.0') });
  commit(root, 'feat: the push');
  const result = run(t, 'release-skills.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: before } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git(root, 'rev-parse', 'good-v1.2.0^{commit}'), before);
  assert.match(result.stdout, /good: counting from 1\.2\.0, its version before this push/);
  assert.equal(git(root, 'rev-parse', 'fresh-v1.0.0^{commit}'), before);
  assert.equal(git(root, 'tag', '--list', 'brand-new-v*'), '');
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').length, 3);
});

test('an imported skill, a folder name that two skills have and a directory without a SKILL.md are skipped, and say why', (t) => {
  const { result, calls } = pushed(t, ['plugins/commerce/x/skills/theirs', 'plugins/a/skills/same', 'plugins/a/docs', 'plugins/a/skills/good']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^good semantic-release --extends /);
  assert.match(result.summary, /\| theirs \| skipped \(brought in from another repository\) \| ⏭️ \|/);
  assert.match(result.summary, /\| same \| skipped \(another skill has the folder name same\) \| ⏭️ \|/);
  assert.match(result.summary, /\| docs \| skipped \(no SKILL\.md\) \| ⏭️ \|/);
  assert.match(result.summary, /\*\*1 run, 3 skipped, 0 failed\*\*/);
});

test('a directory with a release config of its own, the web CLI, is released with that', (t) => {
  const { result, calls } = pushed(t, ['plugins/web/cli']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(calls, ['cli semantic-release']);
});

test('a skill with a version is not released when the commit before the push is unknown', (t) => {
  const root = tree(t, TREE);
  commit(root, 'only commit');
  write(root, { 'dirs.txt': 'plugins/a/skills/good\n' });
  const result = run(t, 'release-skills.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls'), BEFORE: '0000000000000000000000000000000000000000' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, 'calls')), false);
  assert.match(result.summary, /\| good \| skipped \(it is at 1\.2\.0, and the commit before this push is not known\) \| ⏭️ \|/);
});

test('a failed release fails the step, after the other skills were released', (t) => {
  const { result, calls } = pushed(t, ['plugins/a/skills/bad', 'plugins/a/skills/good']);
  assert.equal(result.status, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^bad semantic-release/);
  assert.match(calls[1], /^good semantic-release/);
  assert.match(result.summary, /\| bad \| failed \| ❌ \|/);
  assert.match(result.stdout, /::error::Release failed for bad \(exit code 3\)/);
});
