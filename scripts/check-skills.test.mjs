import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compare, findViolations, toBaseline } from './check-skills.mjs';

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'check-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const skill = (name, lines = 3) => `---\nname: ${name}\ndescription: d\n---\n${'line\n'.repeat(lines)}`;
const manifest = '{"name":"p"}';

test('a tree without violations has none', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/b/.claude-plugin/plugin.json': manifest,
    'plugins/b/skills/two/SKILL.md': skill('two'),
  });
  assert.deepEqual(findViolations(root), []);
});

test('the same name twice in one plugin is duplicate-in-plugin, for both skills', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('same'),
    'plugins/a/skills/group/two/SKILL.md': skill('same'),
  });
  assert.deepEqual(toBaseline(findViolations(root)), [
    { rule: 'duplicate-in-plugin', skill: 'plugins/a/skills/group/two' },
    { rule: 'duplicate-in-plugin', skill: 'plugins/a/skills/one' },
  ]);
});

test('the same name in two plugins is duplicate-across-plugins, not duplicate-in-plugin', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/x/SKILL.md': skill('same'),
    'plugins/product/b/.claude-plugin/plugin.json': manifest,
    'plugins/product/b/skills/x/SKILL.md': skill('"same"'),
  });
  const violations = findViolations(root);
  assert.deepEqual(toBaseline(violations), [
    { rule: 'duplicate-across-plugins', skill: 'plugins/a/skills/x' },
    { rule: 'duplicate-across-plugins', skill: 'plugins/product/b/skills/x' },
  ]);
  assert.match(violations[0].detail, /plugins\/product\/b\/skills\/x/);
});

test('501 lines is too long, 500 is not', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/fits/SKILL.md': skill('fits', 496),
    'plugins/a/skills/long/SKILL.md': skill('long', 497),
  });
  assert.deepEqual(toBaseline(findViolations(root)), [{ rule: 'too-long', skill: 'plugins/a/skills/long' }]);
});

test('node_modules is not searched', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/a/node_modules/dep/skills/one/SKILL.md': skill('one'),
  });
  assert.deepEqual(findViolations(root), []);
});

test('compare names what is new and what is fixed', () => {
  const known = { rule: 'too-long', skill: 'plugins/a/skills/known' };
  const gone = { rule: 'too-long', skill: 'plugins/a/skills/gone' };
  const fresh = { rule: 'duplicate-in-plugin', skill: 'plugins/a/skills/fresh', detail: 'x' };
  const { added, fixed } = compare([{ ...known, detail: 'x' }, fresh], [known, gone]);
  assert.deepEqual(added, [fresh]);
  assert.deepEqual(fixed, [gone]);
});

test('the same skill may break one rule knowingly and another newly', () => {
  const baseline = [{ rule: 'too-long', skill: 'plugins/a/skills/s' }];
  const { added } = compare([
    { rule: 'too-long', skill: 'plugins/a/skills/s', detail: 'x' },
    { rule: 'duplicate-in-plugin', skill: 'plugins/a/skills/s', detail: 'x' },
  ], baseline);
  assert.deepEqual(toBaseline(added), [{ rule: 'duplicate-in-plugin', skill: 'plugins/a/skills/s' }]);
});
