import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit, fakeBin, run, tree, write } from './lib/testing.mjs';

import { publishOutcome } from './lib/tessl.mjs';

const manifest = (version, name = 'p') => JSON.stringify({ name: `x/${name}`, version });
// A stand-in for the Tessl CLI. What a publish does depends on the plugin's folder name and
// on how often it was tried; the texts are the ones of CLI 0.119.0.
const TIMEOUT = 'echo "✘ Publish timed out after 20 seconds: The operation timed out."; exit 1';
const EXISTS = 'echo "✘ x/$name@1.1.0 already exists. Bump the version in .tessl-plugin/plugin.json or use --bump patch|minor|major to auto-increment."; exit 1';
const TESSL = `echo "$*" >> "$CALLS"
[ "$2" = info ] && { echo "registry entry of $3"; exit 0; }
name=$(basename "$3")
tries=$(grep -c "^plugin publish $3\$" "$CALLS")
case "$name" in
  broken) echo "✘ Something went wrong"; exit 1 ;;
  slow) [ "$tries" -lt 3 ] && { ${TIMEOUT}; } ;;
  ghost) [ "$tries" -lt 2 ] && { ${TIMEOUT}; }; ${EXISTS} ;;
  stuck) ${TIMEOUT} ;;
  again) ${EXISTS} ;;
  blocked) echo "Upload accepted, but publication is blocked. Improve the plugin and publish a higher version."; exit 0 ;;
esac
echo "Upload accepted. Publication checks are running; this version becomes available only after they pass."`;

function repo(t) {
  const root = tree(t, {
    'plugins/same/.tessl-plugin/plugin.json': manifest('1.0.0'),
    'plugins/bumped/.tessl-plugin/plugin.json': manifest('1.0.0'),
    'plugins/broken/.tessl-plugin/plugin.json': manifest('1.0.0'),
  });
  const before = commit(root);
  return { root, before, env: { PATH: fakeBin(t, { tessl: TESSL }), CALLS: join(root, 'calls'), RETRY_DELAY: '0' } };
}
const all = (root) => (existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8').split('\n').filter(Boolean) : []);
// the publish calls, as the tests from before the retry expect them; the info calls apart
const calls = (root) => all(root).filter((line) => line.startsWith('plugin publish')).map((line) => `${line}\n`).join('');
const infos = (root) => all(root).filter((line) => line.startsWith('plugin info')).map((line) => line.slice('plugin info '.length));

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

test('what a publish did is read from its exit status and its output', () => {
  assert.equal(publishOutcome(0, 'Upload accepted. This version is available to use.'), 'published');
  assert.equal(publishOutcome(0, 'Upload accepted. Publication checks are running; this version becomes available only after they pass.'), 'published');
  assert.equal(publishOutcome(1, '✘ Publish timed out after 20 seconds: The operation timed out.'), 'timeout');
  assert.equal(publishOutcome(1, '✘ adobe/web@1.0.0 already exists. Bump the version in .tessl-plugin/plugin.json or use --bump patch|minor|major to auto-increment.'), 'exists');
  assert.equal(publishOutcome(0, 'Upload accepted, but publication is blocked. Improve the plugin and publish a higher version.'), 'blocked');
  assert.equal(publishOutcome(0, 'Upload accepted, but publication checks could not complete. This version is not available; contact Tessl support.'), 'blocked');
  assert.equal(publishOutcome(1, '✘ Please authenticate with Tessl to continue.'), 'failed');
  assert.equal(publishOutcome(null, undefined), 'failed');
  // a file of the plugin that already exists is not the version on the registry
  assert.equal(publishOutcome(1, 'error: tile.json already exists'), 'failed');
});

// A push that changes the version of the named plugins, and the run of the publish for it.
function publishOf(t, names, env = {}) {
  const context = repo(t);
  write(context.root, Object.fromEntries(names.map((name) => [`plugins/${name}/.tessl-plugin/plugin.json`, manifest('1.1.0', name)])));
  const after = commit(context.root);
  return { ...context, result: run(t, 'publish-tessl-plugins.mjs', [context.before, after], { cwd: context.root, env: { ...context.env, ...env } }) };
}

test('a publish that times out is tried again, and the others go on', (t) => {
  const { root, result } = publishOf(t, ['slow', 'fine']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls(root), 'plugin publish plugins/fine\nplugin publish plugins/slow\nplugin publish plugins/slow\nplugin publish plugins/slow\n');
  assert.match(result.stdout, /::warning::The publish of slow timed out\. Trying again in 0 seconds\./);
  assert.match(result.summary, /\| slow \| published, at attempt 3 \| ✅ \|/);
  assert.match(result.summary, /\*\*2 published, 0 failed\*\*/);
});

test('a timeout whose upload went through counts as published: the next attempt finds the version on the registry', (t) => {
  const { root, result } = publishOf(t, ['ghost']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls(root), 'plugin publish plugins/ghost\nplugin publish plugins/ghost\n');
  assert.match(result.summary, /\| ghost \| published: the attempt that timed out went through \| ✅ \|/);
});

test('a version that is on the registry already is not a failure, so the job can run again', (t) => {
  const { root, result } = publishOf(t, ['again']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(calls(root), 'plugin publish plugins/again\n');
  assert.match(result.summary, /\| again \| 1\.1\.0 was on the registry already \| ✅ \|/);
});

test('a publish that times out every time fails, after the number of attempts it was given', (t) => {
  const { root, result } = publishOf(t, ['stuck'], { ATTEMPTS: '2' });
  assert.equal(result.status, 1);
  assert.equal(calls(root), 'plugin publish plugins/stuck\nplugin publish plugins/stuck\n');
  assert.match(result.stdout, /::error::Publish failed for stuck \(timed out 2 times\)/);
});

test('an upload that Tessl accepts and then blocks fails the step', (t) => {
  const { result } = publishOf(t, ['blocked']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::Publish failed for blocked \(the upload was accepted, but the version is not available\)/);
});

test('at the end the registry is asked about every version that may be on it, not about one that failed', (t) => {
  const { root, result } = publishOf(t, ['fine', 'again', 'stuck', 'broken'], { ATTEMPTS: '1' });
  assert.equal(result.status, 1);
  assert.deepEqual(infos(root), ['x/again@1.1.0', 'x/fine@1.1.0', 'x/stuck@1.1.0']);
  assert.match(result.stdout, /::group::On the registry: x\/fine@1\.1\.0\nregistry entry of x\/fine@1\.1\.0/);
  // the info calls come after the last publish
  const lines = readFileSync(join(root, 'calls'), 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.findLastIndex((line) => line.startsWith('plugin publish')) < lines.findIndex((line) => line.startsWith('plugin info')));
});

