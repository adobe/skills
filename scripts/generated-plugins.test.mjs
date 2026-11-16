import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { editedFields, planned } from './check-generated.mjs';
import { MESSAGE, written } from './rebuild-plugins.mjs';
import { SCRIPTS, commit, fakeBin, git, run, tree, write } from './lib/testing.mjs';

// ---- the check of a pull request, with the real x927 from node_modules ----

const BIN = join(SCRIPTS, '..', 'node_modules', '.bin');
const REAL = { PATH: [BIN, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const plugin = (name, more = {}) => json({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name, version: '1.0.0', description: `Plugin ${name}.`, ...more });
const catalog = (...plugins) => json({ name: 'fixture', owner: { name: 'X' }, plugins });
const entry = (name, more = {}) => ({ name, source: `./plugins/${name}`, ...more });

const SOURCE = 'plugins/a/plugin.json';
const CLAUDE = 'plugins/a/.claude-plugin/plugin.json';
const MARKET = '.claude-plugin/marketplace.json';

test('what x927 would write is read from its dry run, without the notes after the last file', () => {
  const files = planned('--- plugins/a/.claude-plugin/plugin.json ---\n{\n  "name": "a"\n}\n\n--- .claude-plugin/marketplace.json ---\n{\n  "plugins": []\n}\n\nnote: plugins/b is not listed\n');
  assert.deepEqual([...files], [
    ['plugins/a/.claude-plugin/plugin.json', '{\n  "name": "a"\n}\n'],
    ['.claude-plugin/marketplace.json', '{\n  "plugins": []\n}\n'],
  ]);
});

test('in a marketplace file, only a generated field that the pull request changed counts as edited', () => {
  const base = { plugins: [entry('a', { description: 'old', version: '1.0.0', category: 'x' })] };
  const built = { plugins: [entry('a', { description: 'new', version: '1.1.0', category: 'y' }), entry('b', { description: 'B', version: '1.0.0' })] };
  // behind, and untouched: not edited. A hand-written field and a new entry: not edited.
  assert.deepEqual(editedFields({ plugins: [entry('a', { description: 'old', version: '1.0.0', category: 'y' }), entry('b')] }, built, base), []);
  assert.deepEqual(editedFields({ plugins: [entry('a', { description: 'mine', version: '1.0.0', category: 'y' })] }, built, base), ['the `description` of the `a` entry']);
  assert.deepEqual(editedFields({ plugins: [entry('b')] }, built, null), []);
});

// Both scripts read what x927 prints. This is the real x927 from node_modules, so that an
// update of x927 that prints something else fails here, in the pull request that brings it.
test('the real x927 prints what the scripts read: the files of a dry run, and the files it wrote', (t) => {
  const root = tree(t, { [SOURCE]: plugin('a'), [MARKET]: catalog(entry('a', { category: 'x' })) });
  const x927 = (...args) => spawnSync(join(BIN, 'x927'), args, { cwd: root, encoding: 'utf8' });
  const dry = x927('build', '--all', '--dry-run');
  assert.equal(dry.status, 0, `the real x927 has to be installed (npm ci): ${dry.stderr || dry.error}`);
  const files = planned(dry.stdout);
  assert.deepEqual([...files.keys()].sort(), [MARKET, CLAUDE].sort());
  assert.equal(JSON.parse(files.get(CLAUDE)).name, 'a');
  assert.equal(JSON.parse(files.get(MARKET)).plugins[0].version, '1.0.0');
  const built = x927('build', '--all');
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(written(built.stdout).sort(), [MARKET, CLAUDE].sort());
  // what the dry run announced is, byte for byte, what the build wrote
  for (const [file, content] of files) assert.equal(readFileSync(join(root, file), 'utf8'), content, file);
  assert.deepEqual(written(x927('build', '--all').stdout), []);
});

// A repository whose main has one plugin with everything built, and a change on top of it.
function branch(t, change) {
  const root = tree(t, { [SOURCE]: plugin('a'), [MARKET]: catalog(entry('a', { category: 'x' })), 'README.md': 'readme' });
  const built = spawnSync(join(BIN, 'x927'), ['build', '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `the real x927 has to be installed (npm ci): ${built.stderr || built.error}`);
  const base = commit(root, 'base');
  write(root, typeof change === 'function' ? change(root) : change);
  commit(root, 'change');
  return { root, base };
}
const check = (t, { root, base }) => run(t, 'check-generated.mjs', [base], { cwd: root, env: REAL });
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

test('a pull request that changes nothing generated passes', (t) => {
  const result = check(t, branch(t, { 'README.md': 'changed' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Every generated plugin file is what the build writes/);
});

test('a changed plugin.json with the generated files left alone passes: CI rebuilds them after the merge', (t) => {
  const result = check(t, branch(t, { [SOURCE]: plugin('a', { version: '1.1.0' }) }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CI rebuilds them on main after the merge:\n  plugins\/a\/\.claude-plugin\/plugin\.json\n  \.claude-plugin\/marketplace\.json/);
  assert.doesNotMatch(result.stdout, /::error/);
});

test('a generated manifest edited by hand fails, and is named', (t) => {
  const result = check(t, branch(t, (root) => ({ [CLAUDE]: json({ ...read(root, CLAUDE), description: 'edited by hand' }) })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/a\/\.claude-plugin\/plugin\.json::.* is generated/);
  assert.match(result.stdout, /::error::1 generated file\(s\) are changed here, and not to what the build writes: plugins\/a\/\.claude-plugin\/plugin\.json/);
  assert.match(result.summary, /git checkout \S+ -- plugins\/a\/\.claude-plugin\/plugin\.json/);
});

test('a hand edit fails also when plugin.json changed with it; the marketplace file is only behind', (t) => {
  const result = check(t, branch(t, (root) => ({ [SOURCE]: plugin('a', { version: '1.1.0' }), [CLAUDE]: json({ ...read(root, CLAUDE), version: '9.9.9' }) })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /not to what the build writes: plugins\/a\/\.claude-plugin\/plugin\.json\n/);
  assert.match(result.stdout, /CI rebuilds them on main after the merge:\n  \.claude-plugin\/marketplace\.json/);
});

test('generated files changed to exactly what the build writes pass', (t) => {
  const result = check(t, branch(t, (root) => {
    write(root, { [SOURCE]: plugin('a', { version: '1.1.0' }) });
    spawnSync(join(BIN, 'x927'), ['build', '--all'], { cwd: root });
    return {};
  }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Every generated plugin file is what the build writes/);
});

test('a new plugin with its plugin.json and a hand-written marketplace entry passes', (t) => {
  const result = check(t, branch(t, (root) => ({
    'plugins/b/plugin.json': plugin('b'),
    [MARKET]: json({ ...read(root, MARKET), plugins: [...read(root, MARKET).plugins, entry('b', { category: 'x' })] }),
  })));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CI rebuilds them on main after the merge:\n  plugins\/b\/\.claude-plugin\/plugin\.json\n  \.claude-plugin\/marketplace\.json/);
});

test('the description of an existing marketplace entry changed by hand fails; its category is hand-written and passes', (t) => {
  const edit = (field, value) => (root) => {
    const market = read(root, MARKET);
    market.plugins[0][field] = value;
    return { [MARKET]: json(market) };
  };
  const description = check(t, branch(t, edit('description', 'Mine.')));
  assert.equal(description.status, 1);
  assert.match(description.stdout, /::error file=\.claude-plugin\/marketplace\.json::the `description` of the `a` entry in \.claude-plugin\/marketplace\.json comes from the plugin's plugin\.json/);
  assert.doesNotMatch(description.summary, /git checkout/);
  const category = check(t, branch(t, edit('category', 'y')));
  assert.equal(category.status, 0, category.stdout + category.stderr);
});

test('a plugin.json that x927 refuses fails the check', (t) => {
  const result = check(t, branch(t, { [SOURCE]: plugin('Not A Name') }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::x927 build --all --dry-run failed: \S/);
});

// ---- the rebuild on main ----

// A stand-in for x927: each plugins/<p>/plugin.json is the source of two generated files
// that have to equal it. `build --all` writes the ones that differ and names them;
// HOOK is a shell command that the first build runs.
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

const TESSL = 'plugins/a/.tessl-plugin/plugin.json';
const IN_SYNC = { [SOURCE]: 'v1', [CLAUDE]: 'v1', [TESSL]: 'v1', 'README.md': 'readme' };

test('the files x927 names as written', () => {
  assert.deepEqual(written('wrote plugins/a/.mcp.json\nnote: y\nwrote .claude-plugin/marketplace.json\nx927: 1 plugin(s)\n'), ['plugins/a/.mcp.json', '.claude-plugin/marketplace.json']);
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
  assert.match(result.output, /^behind=false$/m);
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

test('when the branch moved on in the meantime, the run leaves its checkout as it was and says it is behind', (t) => {
  const { root, origin, env } = onMain(t);
  const start = git(root, 'rev-parse', 'HEAD');
  const other = mkdtempSync(join(tmpdir(), 'skills-other-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  git(other, 'clone', '-q', origin, '.');
  // while the build runs, someone else pushes: plugin.json moves on to v3
  const HOOK = `cd "${other}" && echo v3 > ${SOURCE} && git add ${SOURCE} && git commit -q -m "another merge" && git push -q origin main`;
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env: { ...env, HOOK, HOOK_DONE: join(other, '.git', 'hook-done') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /::warning::main moved on from [0-9a-f]{8} to [0-9a-f]{8} while this run was building/);
  assert.match(result.output, /^behind=true$/m);
  assert.match(result.output, /^rebuilt=false$/m);
  // nothing of this run reached the branch, and the checkout is the commit it started from
  assert.deepEqual(log(origin), ['another merge|t', 'merge a pull request|t']);
  assert.equal(git(root, 'rev-parse', 'HEAD'), start);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(root, TESSL), 'utf8'), 'v1');
});

test('a branch that refuses the push without having moved fails the rebuild, and says why', (t) => {
  const { root, origin, env } = onMain(t);
  const start = git(root, 'rev-parse', 'HEAD');
  // a ruleset or a branch protection, as a hook of the remote
  write(origin, { 'hooks/pre-receive': '#!/bin/sh\necho "protected branch hook declined" >&2\nexit 1\n' });
  chmodSync(join(origin, 'hooks', 'pre-receive'), 0o755);
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::main did not take the push of the rebuilt plugin manifests, and it has not moved\. The token of this workflow may not push to main/);
  assert.match(result.stdout, /protected branch hook declined/);
  assert.match(result.output, /^behind=false$/m);
  assert.deepEqual(log(origin), ['merge a pull request|t']);
  assert.equal(git(root, 'rev-parse', 'HEAD'), start);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a build that fails stops the rebuild before anything is committed', (t) => {
  const { root, origin } = onMain(t);
  const result = run(t, 'rebuild-plugins.mjs', [], { cwd: root, env: { PATH: fakeBin(t, { x927: 'echo broken >&2; exit 1' }) } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::x927 build --all failed/);
  assert.deepEqual(log(origin), ['merge a pull request|t']);
});
