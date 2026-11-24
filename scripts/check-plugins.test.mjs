import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLicense, hookProblems, licenses, uncoveredPlugins, withoutSource, withoutTessl } from './check-plugins.mjs';
import { run, tree } from './lib/testing.mjs';

const TREE = {
  'plugins/a/.claude-plugin/plugin.json': '{}',
  'plugins/a/skills/one/SKILL.md': '---\nname: one\nlicense: Apache-2.0\n---\nbody\n',
  'plugins/product/b/.claude-plugin/plugin.json': '{}',
  'plugins/product/b/skills/two/SKILL.md': '---\nname: two\n---\nlicense: only in the body\n',
  'plugins/product/bb/.claude-plugin/plugin.json': '{}',
};

test('a plugin is covered by a line that starts with its path and a slash or white space', (t) => {
  const root = tree(t, TREE);
  assert.deepEqual(uncoveredPlugins(root, '*  @admin\n/plugins/a/  @x\n/plugins/product/b @y\n/plugins/product/bb\t@z\n'), []);
  assert.deepEqual(uncoveredPlugins(root, '*  @admin\n# /plugins/a/ @x\n/plugins/product/bb/ @z\n'), ['/plugins/a', '/plugins/product/b']);
});

test('a plugin that has only its root plugin.json yet needs a CODEOWNERS line too, and is counted once when it has both', (t) => {
  const root = tree(t, {
    'plugins/new/plugin.json': '{}',
    'plugins/both/plugin.json': '{}',
    'plugins/both/.claude-plugin/plugin.json': '{}',
    'plugins/both/.tessl-plugin/plugin.json': '{}',
  });
  assert.deepEqual(uncoveredPlugins(root, '/plugins/both/ @x\n'), ['/plugins/new']);
  assert.deepEqual(uncoveredPlugins(root, ''), ['/plugins/both', '/plugins/new']);
});

test('a license field counts only in the frontmatter', (t) => {
  assert.equal(hasLicense('---\nname: x\nlicense: Apache-2.0\n---\n'), true);
  assert.equal(hasLicense('---\nname: x\n---\nlicense: Apache-2.0\n'), false);
  assert.equal(hasLicense('no frontmatter\nlicense: Apache-2.0\n'), false);
  assert.deepEqual(licenses(tree(t, TREE)), [
    { file: 'plugins/a/skills/one/SKILL.md', ok: true },
    { file: 'plugins/product/b/skills/two/SKILL.md', ok: false },
  ]);
});

test('the commands fail with an annotation per violation, and pass on a clean tree', (t) => {
  const root = tree(t, { ...TREE, '.github/CODEOWNERS': '/plugins/a/ @x\n/plugins/product/bb/ @z\n' });
  const owners = run(t, 'check-plugins.mjs', ['codeowners'], { cwd: root });
  assert.equal(owners.status, 1);
  assert.match(owners.stdout, /::error file=\.github\/CODEOWNERS::\/plugins\/product\/b is not covered/);
  const license = run(t, 'check-plugins.mjs', ['license'], { cwd: root });
  assert.equal(license.status, 1);
  assert.match(license.stdout, /::error file=plugins\/product\/b\/skills\/two\/SKILL\.md::/);
  assert.match(license.summary, /\| plugins\/a\/skills\/one\/SKILL\.md \| ✅ Pass \|/);

  const clean = tree(t, { 'plugins/a/.claude-plugin/plugin.json': '{}', 'plugins/a/skills/one/SKILL.md': TREE['plugins/a/skills/one/SKILL.md'], '.github/CODEOWNERS': '/plugins/a/ @x\n' });
  assert.equal(run(t, 'check-plugins.mjs', ['codeowners'], { cwd: clean }).status, 0);
  assert.equal(run(t, 'check-plugins.mjs', ['license'], { cwd: clean }).status, 0);
});

test('without a CODEOWNERS file the codeowners check fails', (t) => {
  const result = run(t, 'check-plugins.mjs', ['codeowners'], { cwd: tree(t, TREE) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /CODEOWNERS file not found/);
});

test('a plugin with a root plugin.json keeps its hooks where Claude Code and Copilot CLI both look, the same in both', (t) => {
  const SCHEMA = '"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"';
  const root = tree(t, {
    'plugins/both/plugin.json': `{${SCHEMA},"name":"both"}`,
    'plugins/both/hooks/hooks.json': '{"hooks":{}}',
    'plugins/both/com.github.copilot/hooks/hooks.json': '{"hooks":{}}',
    'plugins/none/plugin.json': `{${SCHEMA},"name":"none"}`,
    'plugins/claude-only/plugin.json': `{${SCHEMA},"name":"claude-only"}`,
    'plugins/claude-only/hooks/hooks.json': '{"hooks":{}}',
    'plugins/copilot-only/plugin.json': `{${SCHEMA},"name":"copilot-only"}`,
    'plugins/copilot-only/com.github.copilot/hooks/hooks.json': '{"hooks":{}}',
    'plugins/drift/plugin.json': `{${SCHEMA},"name":"drift"}`,
    'plugins/drift/hooks/hooks.json': '{"hooks":{"PreToolUse":[]}}',
    'plugins/drift/com.github.copilot/hooks/hooks.json': '{"hooks":{}}',
    'plugins/inline/plugin.json': `{${SCHEMA},"name":"inline","extensions":{"io.github.ai-ecoverse.x927":{"targets":{"claude":{"hooks":{}}}}}}`,
    // without a root plugin.json, Copilot CLI reads hooks/hooks.json itself
    'plugins/legacy/.claude-plugin/plugin.json': '{"name":"legacy"}',
    'plugins/legacy/hooks/hooks.json': '{"hooks":{}}',
  });
  assert.deepEqual(hookProblems(root).map(({ file, problem }) => `${file}: ${problem.split(';')[0].slice(0, 40)}`), [
    'plugins/claude-only/hooks/hooks.json: GitHub Copilot CLI does not read this fi',
    'plugins/copilot-only/com.github.copilot/hooks/hooks.json: Claude Code does not read this file',
    'plugins/drift/com.github.copilot/hooks/hooks.json: differs from plugins/drift/hooks/hooks.j',
    'plugins/inline/plugin.json: has hooks inline for Claude Code only',
  ]);
  const result = run(t, 'check-plugins.mjs', ['hooks'], { cwd: root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/drift\/com\.github\.copilot\/hooks\/hooks\.json::/);
});

test('a plugin with a Claude Code manifest and no root plugin.json is found', (t) => {
  const root = tree(t, {
    'plugins/a/plugin.json': '{}',
    'plugins/a/.claude-plugin/plugin.json': '{}',
    'plugins/product/b/.claude-plugin/plugin.json': '{}',
  });
  assert.deepEqual(withoutSource(root), ['plugins/product/b']);
  const result = run(t, 'check-plugins.mjs', ['source'], { cwd: root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/product\/b\/\.claude-plugin\/plugin\.json::plugins\/product\/b has no root plugin\.json/);
});

test('a plugin whose plugin.json has no Tessl target is found: every plugin is published to the Tessl registry', (t) => {
  const source = (targets) => JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'p', extensions: { 'io.github.ai-ecoverse.x927': { targets } } });
  const root = tree(t, {
    'plugins/published/plugin.json': source({ claude: {}, tessl: { name: 'adobe/published' } }),
    'plugins/product/claude-only/plugin.json': source({ claude: {} }),
    'plugins/nameless/plugin.json': source({ claude: {}, tessl: {} }),
    // not a plugin's source: a generated manifest, and a plugin.json of another kind
    'plugins/published/.tessl-plugin/plugin.json': '{}',
    'plugins/published/skills/s/assets/plugin.json': '{"name":"an asset"}',
  });
  assert.deepEqual(withoutTessl(root), ['plugins/nameless', 'plugins/product/claude-only']);
  const result = run(t, 'check-plugins.mjs', ['source'], { cwd: root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/product\/claude-only\/plugin\.json::plugins\/product\/claude-only has no Tessl target/);
  assert.match(result.stdout, /Every plugin has a root plugin\.json\./);
  assert.match(result.stdout, /2 plugin\(s\) have no Tessl target\./);
});
