import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit, fakeBin, run, tree, write } from './lib/testing.mjs';

const manifest = (version) => JSON.stringify({ name: 'x/p', version });
const TESSL = 'echo "$*" >> "$CALLS"; case "$3" in */broken) exit 1 ;; esac';

function repo(t) {
  const root = tree(t, {
    'plugins/same/.tessl-plugin/plugin.json': manifest('1.0.0'),
    'plugins/bumped/.tessl-plugin/plugin.json': manifest('1.0.0'),
    'plugins/broken/.tessl-plugin/plugin.json': manifest('1.0.0'),
  });
  const before = commit(root);
  return { root, before, env: { PATH: fakeBin(t, { tessl: TESSL }), CALLS: join(root, 'calls') } };
}
const calls = (root) => (existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8') : '');

test('a plugin is published when its version differs from the one before the push', (t) => {
  const { root, before, env } = repo(t);
  write(root, { 'plugins/bumped/.tessl-plugin/plugin.json': manifest('1.1.0'), 'plugins/same/README.md': 'changed, but not the version' });
  const after = commit(root);
  const result = run(t, 'publish-tessl-plugins.mjs', [before, after], { cwd: root, env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls(root), 'plugin publish plugins/bumped\n');
  assert.match(result.summary, /\| bumped \| published \| ✅ \|/);
});

test('a plugin that is new in the push is published', (t) => {
  const { root, before, env } = repo(t);
  write(root, { 'plugins/new/.tessl-plugin/plugin.json': manifest('0.1.0') });
  const after = commit(root);
  run(t, 'publish-tessl-plugins.mjs', [before, after], { cwd: root, env });
  assert.equal(calls(root), 'plugin publish plugins/new\n');
});

test('nothing changed: nothing is published and there is no summary', (t) => {
  const { root, before, env } = repo(t);
  const after = commit(root, 'empty');
  const result = run(t, 'publish-tessl-plugins.mjs', [before, after], { cwd: root, env });
  assert.equal(result.status, 0);
  assert.equal(calls(root), '');
  assert.equal(result.summary, '');
  assert.match(result.stdout, /No plugin versions changed/);
});

test('a failed publish fails the step, after the other plugins were published', (t) => {
  const { root, before, env } = repo(t);
  write(root, { 'plugins/broken/.tessl-plugin/plugin.json': manifest('2.0.0'), 'plugins/bumped/.tessl-plugin/plugin.json': manifest('1.1.0') });
  const after = commit(root);
  const result = run(t, 'publish-tessl-plugins.mjs', [before, after], { cwd: root, env });
  assert.equal(result.status, 1);
  assert.equal(calls(root), 'plugin publish plugins/broken\nplugin publish plugins/bumped\n');
  assert.match(result.summary, /\*\*1 published, 1 failed\*\*/);
});

test('without a commit before the push, nothing is published from a clean tree', (t) => {
  const { root, env } = repo(t);
  write(root, { 'plugins/bumped/.tessl-plugin/plugin.json': manifest('1.1.0') });
  const after = commit(root);
  for (const before of ['', '0'.repeat(40)]) {
    const result = run(t, 'publish-tessl-plugins.mjs', [before, after], { cwd: root, env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.equal(calls(root), '');
});
