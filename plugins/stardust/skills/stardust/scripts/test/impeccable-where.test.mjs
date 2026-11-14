#!/usr/bin/env node
// skills/stardust/scripts/test/impeccable-where.test.mjs — the `--where` contract of
// impeccable-version-check.mjs: the skill directory from the plugin registry (CLAUDE_CONFIG_DIR),
// from a Copilot install dir (COPILOT_HOME), from --local (plugin root or the skill dir itself,
// manifest or not); exit 1 with nothing on stdout when no copy exists; no network call on the way
// (--offline is not needed). The version-check output itself is unchanged. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'impeccable-version-check.mjs');
const root = mkdtempSync(join(tmpdir(), 'impeccable-where-'));
const emptyHome = join(root, 'empty-claude');
const emptyCopilot = join(root, 'empty-copilot');
mkdirSync(emptyHome, { recursive: true });
mkdirSync(emptyCopilot, { recursive: true });

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: emptyHome, COPILOT_HOME: emptyCopilot, ...env },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const plant = (skill) => { mkdirSync(join(skill, 'reference'), { recursive: true }); writeFileSync(join(skill, 'SKILL.md'), '# impeccable\n'); };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('--where resolves the plugin registry entry to <installPath>/skills/impeccable', () => {
  const home = join(root, 'claude');
  const install = join(root, 'cache', 'impeccable', 'impeccable', '9.9.9');
  plant(join(install, 'skills', 'impeccable'));
  mkdirSync(join(home, 'plugins'), { recursive: true });
  writeFileSync(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'impeccable@impeccable': [{ scope: 'user', installPath: install, version: '9.9.9' }] } }));
  const r = run(['--where'], { CLAUDE_CONFIG_DIR: home });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, join(install, 'skills', 'impeccable'));
  assert.equal(r.err, '');
  // the version check itself still answers on the same registry (offline: no catalog → skipped, exit 0)
  const v = run(['--offline'], { CLAUDE_CONFIG_DIR: home });
  assert.equal(v.code, 0);
  assert.match(v.out, /^impeccable 9\.9\.9 installed \(Claude Code\) — version check skipped/);
});

check('--where resolves a Copilot install dir', () => {
  const copilot = join(root, 'copilot');
  const plugin = join(copilot, 'installed-plugins', 'some-marketplace', 'impeccable');
  plant(join(plugin, 'skills', 'impeccable'));
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.2.3' }));
  const r = run(['--where'], { COPILOT_HOME: copilot });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, join(plugin, 'skills', 'impeccable'));
});

check('--where --local accepts the plugin root or the skill dir itself, with or without a manifest', () => {
  const asRoot = join(root, 'local-root');
  plant(join(asRoot, 'skills', 'impeccable'));
  const r1 = run(['--where', '--local', asRoot]);
  assert.equal(r1.code, 0, r1.err); assert.equal(r1.out, join(asRoot, 'skills', 'impeccable'));
  const asSkill = join(root, 'local-skill');
  plant(asSkill);
  const r2 = run(['--where', '--local', asSkill]);
  assert.equal(r2.code, 0, r2.err); assert.equal(r2.out, asSkill);
  // without a manifest the version check still exits 0 and reports not-installed; --where is unaffected
  const v = run(['--offline', '--local', asSkill]);
  assert.equal(v.code, 0); assert.match(v.out, /impeccable not found/);
});

check('--where with no copy anywhere: exit 1, stderr names the registries, stdout empty', () => {
  const r = run(['--where']);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /impeccable skill directory not found/);
  const r2 = run(['--where', '--local', join(root, 'nowhere')]);
  assert.equal(r2.code, 1); assert.match(r2.err, /--local/);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nimpeccable-where: all checks passed');
process.exit(failed ? 1 : 0);
