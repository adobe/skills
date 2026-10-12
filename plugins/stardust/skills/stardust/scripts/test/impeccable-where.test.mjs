#!/usr/bin/env node
// skills/stardust/scripts/test/impeccable-where.test.mjs — the `--where` contract of
// impeccable-version-check.mjs: the skill directory from the plugin registry (CLAUDE_CONFIG_DIR),
// from a Copilot install dir (COPILOT_HOME), from --local (plugin root or the skill dir itself,
// manifest or not); exit 1 with nothing on stdout when no copy exists; no network call on the way
// (--offline is not needed); loose skills-directory installs (project dirs up to the git root, user
// dirs of every target harness, Grok/Cursor plugin caches) with the SKILL.md frontmatter version;
// symlinked copies reported once. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'impeccable-version-check.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-where-'))); // the script sees the real cwd (/private/var on macOS)
const emptyHome = join(root, 'empty-claude');
const emptyCopilot = join(root, 'empty-copilot');
const userHome = join(root, 'home');
const project = join(root, 'project');
mkdirSync(emptyHome, { recursive: true });
mkdirSync(emptyCopilot, { recursive: true });
mkdirSync(join(project, '.git'), { recursive: true }); // stops the project-dir walk here

const run = (args, env = {}) => {
  const { cwd = project, ...rest } = env;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', cwd,
    env: { ...process.env, HOME: userHome, XDG_CONFIG_HOME: '', OPENCODE_CONFIG_DIR: '', CLAUDE_CONFIG_DIR: emptyHome, COPILOT_HOME: emptyCopilot, ...rest },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const plant = (skill, frontmatter = '') => { mkdirSync(join(skill, 'reference'), { recursive: true }); writeFileSync(join(skill, 'SKILL.md'), `${frontmatter ? `---\nname: impeccable\n${frontmatter}\n---\n` : ''}# impeccable\n`); };
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

check('project .agents/skills is found from a subdirectory, version from metadata.version', () => {
  const skill = join(project, '.agents', 'skills', 'impeccable');
  plant(skill, 'description: d\nmetadata:\n  version: 4.5.2');
  const sub = join(project, 'src', 'pages');
  mkdirSync(sub, { recursive: true });
  const r = run(['--where'], { cwd: sub });
  assert.equal(r.code, 0, r.err); assert.equal(r.out, skill);
  const v = run(['--offline'], { cwd: sub });
  assert.match(v.out, /^impeccable 4\.5\.2 installed \(agents skills dir, project\) — version check skipped/);
  rmSync(join(project, '.agents'), { recursive: true, force: true });
});

check('user skills dirs of each target harness, top-level version, update via npx impeccable update', () => {
  for (const [rel, label] of [[['.pi', 'agent', 'skills'], 'Pi, user'], [['.config', 'opencode', 'skills'], 'OpenCode, user'], [['.gemini', 'antigravity-cli', 'skills'], 'Antigravity CLI, user'], [['.cursor', 'skills'], 'Cursor, user']]) {
    const skill = join(userHome, ...rel, 'impeccable');
    plant(skill, 'version: 4.0.0');
    const r = run(['--where']);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, skill);
    const j = JSON.parse(run(['--offline', '--json']).out);
    assert.equal(j.installs[0].harness, label); assert.equal(j.installs[0].version, '4.0.0'); assert.equal(j.repo, 'pbakaus/impeccable');
    rmSync(join(userHome, rel[0]), { recursive: true, force: true });
  }
});

check('a symlinked copy (npx skills add) is reported once', () => {
  const canonical = join(project, '.agents', 'skills', 'impeccable');
  plant(canonical, 'version: 4.1.0');
  mkdirSync(join(project, '.claude', 'skills'), { recursive: true });
  symlinkSync(canonical, join(project, '.claude', 'skills', 'impeccable'));
  const v = run(['--offline']);
  assert.equal(v.out.split('\n').length, 1, v.out);
  rmSync(join(project, '.agents'), { recursive: true, force: true }); rmSync(join(project, '.claude'), { recursive: true, force: true });
});

check('Grok plugin cache: version from the plugin manifest', () => {
  const plugin = join(userHome, '.grok', 'plugins', 'cache', 'impeccable');
  plant(join(plugin, 'skills', 'impeccable'));
  mkdirSync(join(plugin, '.grok-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.grok-plugin', 'plugin.json'), JSON.stringify({ version: '4.5.2' }));
  assert.equal(run(['--where']).out, join(plugin, 'skills', 'impeccable'));
  assert.match(run(['--offline']).out, /^impeccable 4\.5\.2 installed \(Grok Build\)/);
  rmSync(join(userHome, '.grok'), { recursive: true, force: true });
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
