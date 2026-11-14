import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drifted } from './check-generated.mjs';
import { MESSAGE, written } from './rebuild-plugins.mjs';
import { commit, fakeBin, git, run, tree, write } from './lib/testing.mjs';

// A stand-in for x927: each plugins/<p>/plugin.json is the source of two generated files
// that have to equal it. `build --all` writes the ones that differ and names them;
// `diff --all` names them and exits 1. HOOK is a shell command that the first build runs.
const X927 = `status=0
for src in plugins/*/plugin.json; do
  [ -f "$src" ] || continue
  dir=$(dirname "$src")
  for out in "$dir/.claude-plugin/plugin.json" "$dir/.tessl-plugin/plugin.json"; do
    if [ "$1" = build ]; then
      if ! cmp -s "$src" "$out"; then mkdir -p "$(dirname "$out")"; cp "$src" "$out"; echo "wrote $out"; fi
    elif [ ! -f "$out" ]; then echo "missing: $out"; status=1
    elif ! cmp -s "$src" "$out"; then echo "drift:   $out"; status=1
    fi
  done
done
if [ "$1" = build ] && [ -n "$HOOK" ] && [ ! -f "$HOOK_DONE" ]; then touch "$HOOK_DONE"; sh -c "$HOOK"; fi
if [ "$1" = build ]; then echo "x927: built"; fi
exit $status`;

const SOURCE = 'plugins/a/plugin.json';
const CLAUDE = 'plugins/a/.claude-plugin/plugin.json';
const TESSL = 'plugins/a/.tessl-plugin/plugin.json';
const IN_SYNC = { [SOURCE]: 'v1', [CLAUDE]: 'v1', [TESSL]: 'v1', 'README.md': 'readme' };

test('the files x927 names as behind, and the files it names as written', () => {
  assert.deepEqual(drifted('note: x\nmissing: plugins/a/.mcp.json\ndrift:   plugins/a/.claude-plugin/plugin.json\n'), ['plugins/a/.mcp.json', 'plugins/a/.claude-plugin/plugin.json']);
  assert.deepEqual(drifted('x927: 3 file(s) in sync with plugin.json\n'), []);
  assert.deepEqual(written('wrote plugins/a/.mcp.json\nnote: y\nwrote .claude-plugin/marketplace.json\nx927: 1 plugin(s)\n'), ['plugins/a/.mcp.json', '.claude-plugin/marketplace.json']);
});

// A repository on main with everything in sync, and a branch on top of it.
function branch(t, change) {
  const root = tree(t, IN_SYNC);
  const base = commit(root, 'base');
  write(root, change);
  commit(root, 'change');
  return { root, base, env: { PATH: fakeBin(t, { x927: X927 }) } };
}
const check = (t, { root, base, env }) => run(t, 'check-generated.mjs', [`${base}...HEAD`], { cwd: root, env });

test('a pull request that changes nothing generated passes', (t) => {
  const result = check(t, branch(t, { 'README.md': 'changed' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Every generated plugin file is what the build writes/);
});

test('a changed plugin.json with the generated files left alone passes: CI rebuilds them after the merge', (t) => {
  const result = check(t, branch(t, { [SOURCE]: 'v2' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CI rebuilds them on main after the merge/);
  assert.match(result.stdout, new RegExp(`  ${CLAUDE.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(result.stdout, /::error/);
});

test('a generated file edited by hand fails, and is named', (t) => {
  const result = check(t, branch(t, { [CLAUDE]: 'edited by hand' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`::error file=${CLAUDE.replaceAll('.', '\\.')}::.* is generated`));
  assert.match(result.stdout, /::error::1 generated file\(s\) are changed here, and not to what the build writes/);
  assert.match(result.summary, /git checkout origin\/main -- plugins\/a\/\.claude-plugin\/plugin\.json/);
  assert.doesNotMatch(result.stdout, new RegExp(`file=${TESSL.replaceAll('.', '\\.')}`));
});

test('a hand edit fails also when plugin.json changed with it, and only the edited file is blamed', (t) => {
  const result = check(t, branch(t, { [SOURCE]: 'v2', [CLAUDE]: 'something else' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::1 generated file\(s\) are changed here, and not to what the build writes: plugins\/a\/\.claude-plugin\/plugin\.json/);
  assert.match(result.stdout, /CI rebuilds them on main after the merge:\n  plugins\/a\/\.tessl-plugin\/plugin\.json/);
});

test('generated files changed to exactly what the build writes pass', (t) => {
  const result = check(t, branch(t, { [SOURCE]: 'v2', [CLAUDE]: 'v2', [TESSL]: 'v2' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('x927 failing for another reason than files that are behind fails the check', (t) => {
  const { root, base } = branch(t, { 'README.md': 'changed' });
  const result = run(t, 'check-generated.mjs', [`${base}...HEAD`], { cwd: root, env: { PATH: fakeBin(t, { x927: 'echo "plugin.json: not valid" >&2; exit 2' }) } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::x927 diff --all failed: plugin\.json: not valid/);
});

// A clone on main whose origin is a bare repository, with plugin.json ahead of the generated files.
function onMain(t) {
  const origin = mkdtempSync(join(tmpdir(), 'skills-origin-'));
  t.after(() => rmSync(origin, { recursive: true, force: true }));
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = tree(t, { ...IN_SYNC, [SOURCE]: 'v2' });
  commit(root, 'merge a pull request');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  return { root, origin, env: { PATH: fakeBin(t, { x927: X927 }) } };
}
const log = (repo) => git(repo, 'log', '--format=%s|%an', 'main').split('\n');

test('the rebuild commits what the build wrote as the bot and pushes it', (t) => {
  const { root, origin, env } = onMain(t);
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(log(origin), [`${MESSAGE}|github-actions[bot]`, 'merge a pull request|t']);
  assert.equal(git(origin, 'show', `main:${CLAUDE}`), 'v2');
  assert.equal(git(origin, 'show', `main:${TESSL}`), 'v2');
  assert.deepEqual(git(origin, 'show', '--name-only', '--format=', 'main').split('\n'), [CLAUDE, TESSL]);
  assert.match(result.output, /^rebuilt=true$/m);
  assert.match(result.summary, /Rebuilt from `plugin\.json` and pushed to `main`/);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('nothing to rebuild: no commit, no push', (t) => {
  const { root, origin, env } = onMain(t);
  write(root, { [CLAUDE]: 'v2', [TESSL]: 'v2' });
  commit(root, 'already built');
  git(root, 'push', '-q', 'origin', 'main');
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(log(origin), ['already built|t', 'merge a pull request|t']);
  assert.match(result.output, /^rebuilt=false$/m);
});

test('when the branch moved in the meantime, the rebuild takes the new tip and pushes on top of it', (t) => {
  const { root, origin, env } = onMain(t);
  const other = mkdtempSync(join(tmpdir(), 'skills-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  git(other, 'clone', '-q', origin, '.');
  // while the first build runs, someone else pushes: plugin.json moves on to v3
  const HOOK = `cd "${other}" && echo v3 > ${SOURCE} && git add ${SOURCE} && git commit -q -m "another merge" && git push -q origin main`;
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env: { ...env, HOOK, HOOK_DONE: join(other, '.git', 'hook-done') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /The push was refused \(attempt 1 of 3\)/);
  assert.deepEqual(log(origin), [`${MESSAGE}|github-actions[bot]`, 'another merge|t', 'merge a pull request|t']);
  assert.equal(git(origin, 'show', `main:${CLAUDE}`), 'v3');
  assert.equal(readFileSync(join(root, TESSL), 'utf8'), 'v3\n');
});

test('a build that fails stops the rebuild before anything is committed', (t) => {
  const { root, origin } = onMain(t);
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env: { PATH: fakeBin(t, { x927: 'echo broken >&2; exit 1' }) } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::x927 build --all failed/);
  assert.deepEqual(log(origin), ['merge a pull request|t']);
});
