import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeBin, run, tree } from './lib/testing.mjs';

const TREE = {
  'plugins/a/skills/good/package.json': '{}',
  'plugins/a/skills/bad/package.json': '{}',
  'plugins/a/skills/plain/SKILL.md': 'no package.json',
};
// npx records where it was called and with what, and fails in the skill named "bad"
const NPX = 'echo "$(basename "$PWD") $*" >> "$CALLS"; case "$PWD" in */bad) exit 3 ;; esac';

test('each skill with a package.json is released in its own directory; the others are skipped', (t) => {
  const root = tree(t, { ...TREE, 'dirs.txt': 'plugins/a/skills/good\nplugins/a/skills/plain\n' });
  const result = run(t, 'release-skills.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8'), 'good semantic-release\n');
  assert.match(result.summary, /\| good \| released \| ✅ \|/);
  assert.match(result.summary, /\| plain \| skipped \(no package\.json\) \| ⏭️ \|/);
  assert.match(result.summary, /\*\*1 released, 1 skipped, 0 failed\*\*/);
});

test('a failed release fails the step, after the other skills were released', (t) => {
  const root = tree(t, { ...TREE, 'dirs.txt': 'plugins/a/skills/bad\nplugins/a/skills/good\n' });
  const result = run(t, 'release-skills.mjs', ['dirs.txt'], { cwd: root, env: { PATH: fakeBin(t, { npx: NPX }), CALLS: join(root, 'calls') } });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8'), 'bad semantic-release\ngood semantic-release\n');
  assert.match(result.summary, /\| bad \| failed \| ❌ \|/);
  assert.match(result.summary, /\| good \| released \| ✅ \|/);
  assert.match(result.stdout, /::error::Release failed for bad \(exit code 3\)/);
});
