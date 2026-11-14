import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargeWarnings, parseWarnings, tesslPlugins } from './tessl-lint-debt.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'tessl-lint-debt.mjs');

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'tessl-lint-debt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const skill = (name) => `---\nname: ${name}\ndescription: d\n---\nbody\n`;
const TREE = {
  'plugins/a/.tessl-plugin/plugin.json': '{"name":"x/a"}',
  'plugins/a/skills/one/SKILL.md': skill('one'),
  'plugins/a/skills/folder/SKILL.md': skill('"named-in-frontmatter"'),
  'plugins/product/b/.tessl-plugin/plugin.json': '{"name":"x/b"}',
  'plugins/product/b/skills/two/SKILL.md': skill('two'),
  'plugins/c/.claude-plugin/plugin.json': '{"name":"c"}',
  'plugins/c/skills/three/SKILL.md': skill('three'),
};
const OUTPUT = `
⚠ Skill 'one': SKILL.md is approximately 8420 tokens (recommended maximum: 5000). Consider moving detailed content to separate reference files.
  ⚠ Skill 'named-in-frontmatter': SKILL.md is approximately 6000 tokens (recommended maximum: 5000).
⚠ The manifest has no description
⚠ Skill 'gone': something about a skill that is not in the tree

✔ Plugin x/a@1.0.0 is valid
`;

test('only directories with a Tessl manifest are Tessl plugins', (t) => {
  const root = repo(t, TREE);
  assert.deepEqual(tesslPlugins(root), [join(root, 'plugins/a'), join(root, 'plugins/product/b')]);
});

test('warnings are the lines that start with the warning sign, with the skill they name', () => {
  assert.deepEqual(parseWarnings(OUTPUT).map(({ skill }) => skill), ['one', 'named-in-frontmatter', null, 'gone']);
  assert.deepEqual(parseWarnings('✔ Plugin x/a@1.0.0 is valid\n'), []);
});

test('a skill warning is charged to its SKILL.md, anything else to the Tessl manifest', (t) => {
  const root = repo(t, TREE);
  const charged = chargeWarnings(root, join(root, 'plugins/a'), parseWarnings(OUTPUT));
  assert.deepEqual(charged.map(({ file }) => file), [
    'plugins/a/skills/one/SKILL.md',
    'plugins/a/skills/folder/SKILL.md',
    'plugins/a/.tessl-plugin/plugin.json',
    'plugins/a/.tessl-plugin/plugin.json',
  ]);
});

function fakeTessl(t, script) {
  const bin = mkdtempSync(join(tmpdir(), 'fake-tessl-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'tessl'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, 'tessl'), 0o755);
  return `${bin}${delimiter}${dirname(process.execPath)}`;
}

test('the command prints each file with a warning once, sorted, also when the lint fails', (t) => {
  const root = repo(t, TREE);
  // warnings on stderr, as the CLI prints them; plugin b is invalid and still has a warning
  const PATH = fakeTessl(t, `case "$3" in
  */plugins/a) echo "⚠ Skill 'one': too long" >&2; echo "⚠ Skill 'one': and another" >&2; echo "✔ valid" ;;
  *) echo "⚠ Skill 'two': too long" >&2; echo "✖ invalid" >&2; exit 1 ;;
esac`);
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env: { PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'plugins/a/skills/one/SKILL.md\nplugins/product/b/skills/two/SKILL.md\n');
});

test('without the tessl CLI the command exits 2 and prints no list', (t) => {
  const root = repo(t, TREE);
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env: { PATH: dirname(process.execPath) } });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /tessl CLI/);
});
