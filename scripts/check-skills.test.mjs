import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findViolations } from './check-skills.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-skills.mjs');

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
// the other rules, without `orphaned`, which has its own tests below
const found = (root) => findViolations(root).filter(({ rule }) => rule !== 'orphaned').map(({ rule, file }) => `${rule} ${file}`);
const orphans = (root) => findViolations(root).filter(({ rule }) => rule === 'orphaned').map(({ file }) => file);

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
  assert.deepEqual(found(root), [
    'duplicate-in-plugin plugins/a/skills/group/two/SKILL.md',
    'duplicate-in-plugin plugins/a/skills/one/SKILL.md',
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
  assert.deepEqual(found(root), [
    'duplicate-across-plugins plugins/a/skills/x/SKILL.md',
    'duplicate-across-plugins plugins/product/b/skills/x/SKILL.md',
  ]);
  assert.match(violations[0].detail, /plugins\/product\/b\/skills\/x\/SKILL\.md/);
});

test('501 lines is too long, 500 is not', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/fits/SKILL.md': skill('fits', 496),
    'plugins/a/skills/long/SKILL.md': skill('long', 497),
  });
  assert.deepEqual(found(root), ['too-long plugins/a/skills/long/SKILL.md']);
});

test('node_modules is not searched', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/a/node_modules/dep/skills/one/SKILL.md': skill('one'),
  });
  assert.deepEqual(findViolations(root), []);
});

test('--list prints the files of one rule, one per line, and nothing for a clean rule', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/long/SKILL.md': skill('long', 600),
    'plugins/a/skills/short/SKILL.md': skill('short'),
  });
  assert.equal(execFileSync('node', [SCRIPT, '--list', 'too-long'], { cwd: root, encoding: 'utf8' }), 'plugins/a/skills/long/SKILL.md\n');
  assert.equal(execFileSync('node', [SCRIPT, '--list', 'duplicate-in-plugin'], { cwd: root, encoding: 'utf8' }), '');
});

test('--list with an unknown rule exits 2 and prints no list', (t) => {
  const root = repo(t, { 'plugins/a/skills/one/SKILL.md': skill('one') });
  const result = spawnSync('node', [SCRIPT, '--list', 'no-such-rule'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('a skill below another skill is orphaned; the folders directly under skills/ are not', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/top/SKILL.md': skill('top'),
    'plugins/a/skills/top/sub/SKILL.md': skill('sub'),
    'plugins/a/skills/top/deep/er/SKILL.md': skill('er'),
  });
  assert.deepEqual(orphans(root), ['plugins/a/skills/top/deep/er/SKILL.md', 'plugins/a/skills/top/sub/SKILL.md']);
  const [violation] = findViolations(root).filter(({ file }) => file.endsWith('sub/SKILL.md'));
  assert.match(violation.detail, /lies below skills\/top\/, where no client looks: move it to skills\/sub\//);
});

test('a folder the Claude Code manifest lists under "skills" is found, as a skill or as a directory of skills', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': '{"name":"p","skills":["./skills/","./skills/suite/one","./extra"]}',
    'plugins/a/skills/suite/SKILL.md': skill('suite'),
    'plugins/a/skills/suite/one/SKILL.md': skill('one'),
    'plugins/a/skills/suite/two/SKILL.md': skill('two'),
    'plugins/a/extra/three/SKILL.md': skill('three'),
    'plugins/b/.claude-plugin/plugin.json': '{"name":"q","skills":"./more"}',
    'plugins/b/more/four/SKILL.md': skill('four'),
  });
  assert.deepEqual(orphans(root), ['plugins/a/skills/suite/two/SKILL.md']);
});

test('a skill outside every plugin is orphaned', (t) => {
  const root = repo(t, { 'plugins/loose/skills/one/SKILL.md': skill('one') });
  const violations = findViolations(root);
  assert.deepEqual(violations.map(({ rule, file }) => `${rule} ${file}`), ['orphaned plugins/loose/skills/one/SKILL.md']);
  assert.match(violations[0].detail, /is in no plugin/);
});

test('a plugin that has only its root plugin.json yet is a plugin, and its Claude Code skills paths count', (t) => {
  const root = repo(t, {
    'plugins/new/plugin.json': '{"name":"new","extensions":{"io.github.ai-ecoverse.x927":{"targets":{"claude":{"skills":["./skills/suite/one"]}}}}}',
    'plugins/new/skills/suite/SKILL.md': skill('suite'),
    'plugins/new/skills/suite/one/SKILL.md': skill('one'),
    'plugins/new/skills/suite/two/SKILL.md': skill('two'),
  });
  assert.deepEqual(orphans(root), ['plugins/new/skills/suite/two/SKILL.md']);
});
