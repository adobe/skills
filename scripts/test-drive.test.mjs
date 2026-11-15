import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyWarnings, findCli, parseClaudeDetails, parseCodexSkills, parseGrokInspect } from './lib/clients.mjs';
import { baseCommit, notes } from './review-env.mjs';
import { buildManifests, describePlugin, pluginsToDrive, problems, report } from './test-drive.mjs';
import { commit, git, run, tree, write } from './lib/testing.mjs';

// ---- what the clients print, as captured from claude 2.1.322, codex 0.169.0, grok 1.0.77, agy 1.5.9 ----

const CLAUDE_DETAILS = `Adobe for Developers (adobe-for-developers) 1.0.0
  Description: Search the developer.adobe.com docs.
  Source: adobe-for-developers@adobe-skills

Component inventory
  Skills (3)  dev-console-context, dev-console-create-project, io-events-fil
  Agents (0)
  Hooks (1)  PreToolUse  (harness-only — no model context cost)
  MCP servers (1)  adobe-for-developers  (tool schemas resolved at runtime; not counted)
  LSP servers (0)

Projected token cost
  Always-on:   ~1,117 tok   added to every session

Per-component (rounded)
  component                    always-on  on-invoke
  io-events-filtering               ~150      ~3.5k
  dev-console-create-project        ~150       ~970
  dev-console-context               ~220      ~1.6k

  On-invoke cost is paid each time a skill or agent fires.
  Token counts are estimates and may differ from actual usage.
`;

test('claude plugin details: the names come from the component table, because the inventory line is cut off', () => {
  const details = parseClaudeDetails(CLAUDE_DETAILS);
  assert.deepEqual(details.skills, ['dev-console-context', 'dev-console-create-project', 'io-events-filtering']);
  assert.deepEqual(details.hooks, ['PreToolUse']);
  assert.deepEqual(details.mcpServers, ['adobe-for-developers']);
  assert.equal(details.alwaysOnTokens, 1117);
  assert.deepEqual(details.components[0], { name: 'io-events-filtering', alwaysOn: 150, onInvoke: 3500 });
  assert.deepEqual(parseClaudeDetails('nothing of the kind'), { skills: [], skillCount: 0, hooks: [], mcpServers: [], agents: 0, alwaysOnTokens: 0, components: [] });
});

test('codex debug prompt-input: the skills of one plugin, each once', () => {
  const prompt = '(file: r0/skill-installer/SKILL.md)\\n- adobe-for-developers:dev-console-context: Use when…\\n- adobe-for-developers:io-events-filtering: Use…\\n- other-plugin:not-mine: x\\n adobe-for-developers:dev-console-context: again';
  assert.deepEqual(parseCodexSkills(prompt, 'adobe-for-developers'), ['dev-console-context', 'io-events-filtering']);
  // a plugin whose name ends another's is not confused with it
  assert.deepEqual(parseCodexSkills('- my-adobe-for-developers:x: y', 'adobe-for-developers'), []);
});

test('grok inspect: only what came from the plugin', () => {
  const plugin = { type: 'plugin', plugin_name: 'p' };
  const inspect = {
    skills: [{ name: 'b', source: plugin }, { name: 'a', source: plugin }, { name: 'bundled', source: { type: 'bundled' } }, { name: 'c', source: { type: 'plugin', plugin_name: 'q' } }],
    hooks: [{ event: '(plugin)', source: plugin }],
    mcpServers: [{ name: 'server', source: plugin }, { name: 'mine', source: { type: 'user' } }],
  };
  assert.deepEqual(parseGrokInspect(inspect, 'p'), { skills: ['a', 'b'], hooks: 1, mcpServers: ['server'] });
  assert.deepEqual(parseGrokInspect(null, 'p'), { skills: [], hooks: 0, mcpServers: [] });
});

test('agy plugin validate: warnings are reported, notes are not', () => {
  const validation = { findings: [
    { severity: 'warning', file: 'hooks/hooks.json', message: 'never loaded: plugin hooks are read only from hooks.json at the plugin root' },
    { severity: 'note', file: 'plugin.json', message: 'no logo' },
  ] };
  assert.deepEqual(agyWarnings(validation), ['hooks/hooks.json: never loaded: plugin hooks are read only from hooks.json at the plugin root']);
  assert.deepEqual(agyWarnings(null), []);
});

test('a CLI is found in the directory given, in the one CI fills, or on the PATH', (t) => {
  const root = tree(t, { 'given/claude': '', 'runner/agent-clis/bin/claude': '', 'path/claude': '', 'path/grok': '' });
  const env = { RUNNER_TEMP: join(root, 'runner'), PATH: join(root, 'path') };
  assert.equal(findCli('claude', { bin: join(root, 'given'), root, env }), join(root, 'given', 'claude'));
  assert.equal(findCli('grok', { bin: join(root, 'given'), root, env }), null); // a directory given is the only place looked in
  assert.equal(findCli('claude', { root, env }), join(root, 'runner', 'agent-clis', 'bin', 'claude'));
  assert.equal(findCli('grok', { root, env }), join(root, 'path', 'grok'));
  assert.equal(findCli('agy', { root, env }), null);
});

// ---- the report ----

const skill = (name) => `---\nname: ${name}\nlicense: Apache-2.0\n---\n# ${name}\n`;
const PLUGIN = {
  'plugins/p/plugin.json': JSON.stringify({ name: 'p', version: '1.2.0' }),
  'plugins/p/mcp.json': '{}',
  'plugins/p/hooks/hooks.json': '{}',
  'plugins/p/skills/one/SKILL.md': skill('one'),
  'plugins/p/skills/two/SKILL.md': skill('two'),
  'plugins/p/skills/two/deep/SKILL.md': skill('deep'),
  'plugins/p/skills/not-a-skill/notes.md': 'x',
  '.claude-plugin/marketplace.json': JSON.stringify({ name: 'market', plugins: [{ name: 'p', source: './plugins/p' }] }),
};

test('a plugin is described from its files: the skills directly under skills/, MCP, hooks, and its marketplace', (t) => {
  const root = tree(t, { ...PLUGIN, 'plugins/unlisted/plugin.json': JSON.stringify({ name: 'unlisted', version: '0.1.0' }) });
  const plugin = describePlugin(root, 'plugins/p');
  assert.deepEqual([plugin.name, plugin.version, plugin.path, plugin.skills, plugin.hasMcp, plugin.hasHooks, plugin.marketplace], ['p', '1.2.0', 'plugins/p', ['one', 'two'], true, true, 'market']);
  const unlisted = describePlugin(root, 'plugins/unlisted');
  assert.deepEqual([unlisted.skills, unlisted.hasMcp, unlisted.hasHooks, unlisted.marketplace], [[], false, false, null]);
});

test('a client that can not install, or loads fewer skills than the plugin has, is a problem; more skills are not', () => {
  const plugin = { skills: ['one', 'two'] };
  assert.deepEqual(problems(plugin, { installed: true, skills: ['one', 'two'] }), []);
  assert.deepEqual(problems(plugin, { installed: true, skills: ['deep', 'one', 'two'] }), []);
  assert.deepEqual(problems(plugin, { installed: true, skills: ['two'] }), ['did not load 1 of 2 skills: one']);
  assert.deepEqual(problems(plugin, { installed: false, skills: [], notes: ['install: no manifest'] }), ['could not install: install: no manifest']);
  assert.deepEqual(problems(plugin, { installed: null, skills: [], notes: [] }), []); // a client the plugin is not installed into
});

test('the report has a row per client and says what was not loaded, not checked, or found deeper', () => {
  const plugin = { name: 'p', version: '1.2.0', path: 'plugins/p', skills: ['one', 'two'], hasMcp: true, hasHooks: true };
  const lines = report(plugin, {
    claude: { installed: true, skills: ['one', 'two'], mcpServers: ['server'], hooks: ['PreToolUse'], notes: [] },
    codex: { installed: true, skills: ['one', 'two'], mcpServers: ['server'], hooks: null, notes: [] },
    grok: { installed: true, skills: ['deep', 'one', 'two'], mcpServers: ['server'], hooks: 1, notes: [] },
    agy: { installed: true, skills: ['one'], mcpServers: [], hooks: 0, notes: ['hooks/hooks.json: never loaded'] },
    other: { missing: true, notes: [] },
  }).join('\n');
  assert.match(lines, /\| claude \| ✅ installed \| 2 of 2 \| 1 \(server\) \| 1 \(PreToolUse\) \|/);
  assert.match(lines, /\| codex \| ✅ installed \| 2 of 2 \| 1 \(server\) \| not checked \|/);
  assert.match(lines, /\| grok \| ✅ installed \| 2 of 2, and 1 from deeper folders \| 1 \(server\) \| 1 \|/);
  assert.match(lines, /\| agy \| ❌ installed \| 1 of 2 \| not loaded \| not loaded \|/);
  assert.match(lines, /\| other \| CLI not installed \|/);
  assert.match(lines, /- \*\*agy:\*\* did not load 1 of 2 skills: two\n- \*\*agy:\*\* hooks\/hooks\.json: never loaded/);
});

test('a change to a CLI or to the test drive itself test-drives every plugin', () => {
  const all = ['plugins/a', 'plugins/b'];
  assert.deepEqual(pluginsToDrive(['plugins/a/skills/s/SKILL.md', 'README.md'], all), ['plugins/a']);
  assert.deepEqual(pluginsToDrive(['README.md', 'scripts/check-skills.mjs'], all), []);
  for (const file of ['scripts/agent-clis/package-lock.json', 'scripts/agent-clis/agy.json', 'scripts/setup-agent-clis.mjs', 'scripts/test-drive.mjs', 'scripts/lib/clients.mjs', 'package-lock.json']) {
    assert.deepEqual(pluginsToDrive([file], all), all, file);
  }
});

function manifest(name) {
  return JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name, version: '1.0.0' });
}

// ---- a run, with stand-ins for the CLIs ----

// Each stand-in answers the commands its driver sends. The clients run with a clean
// environment, so what a stand-in does differently is written into it (WHAT).
const STUBS = {
  claude: `case "$1 $2" in
  "plugin validate") echo "✔ Validation passed" ;;
  "plugin marketplace") echo added ;;
  "plugin install") [ "$WHAT" = claude-fails ] && { echo "✘ Plugin not found in marketplace"; exit 1; }; echo installed ;;
  "plugin details") printf 'p 1.2.0\\n\\nComponent inventory\\n  Skills (2)  one, two\\n  Hooks (1)  PreToolUse\\n  MCP servers (1)  server\\n\\nProjected token cost\\n  Always-on:   ~300 tok\\n\\nPer-component (rounded)\\n  component  always-on  on-invoke\\n  one              ~100       ~1k\\n  two              ~200       ~2k\\n' ;;
esac`,
  codex: `case "$1 $2" in
  "plugin marketplace"|"plugin add") echo ok ;;
  "mcp list") echo '[{"name":"server"}]' ;;
  "debug prompt-input") if [ "$WHAT" = codex-misses ]; then echo '- p:one: first'; else echo '- p:one: first\\n- p:two: second'; fi ;;
esac`,
  grok: `case "$1 $2" in
  "plugin validate"|"plugin install") echo ok ;;
  "inspect --json") echo '{"skills":[{"name":"one","source":{"type":"plugin","plugin_name":"p"}},{"name":"two","source":{"type":"plugin","plugin_name":"p"}},{"name":"deep","source":{"type":"plugin","plugin_name":"p"}}],"hooks":[{"source":{"type":"plugin","plugin_name":"p"}}],"mcpServers":[{"name":"server","source":{"type":"plugin","plugin_name":"p"}}]}' ;;
esac`,
  agy: `case "$1 $2" in
  "plugin validate") echo '{"findings":[{"severity":"warning","file":"hooks/hooks.json","message":"never loaded"}]}' ;;
  "plugin install") echo ok ;;
  "plugin list") echo '[{"name":"p","skills":["two","one"]}]' ;;
esac`,
};
function bin(t, names = Object.keys(STUBS), what = '') {
  const dir = mkdtempSync(join(tmpdir(), 'test-drive-bin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of names) {
    writeFileSync(join(dir, name), `#!/bin/sh\nWHAT=${what}\n${STUBS[name]}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

test('a test drive installs the plugin into every client and reports what each loaded', (t) => {
  const root = tree(t, PLUGIN);
  const out = join(root, 'result.json');
  const result = run(t, 'test-drive.mjs', ['--bin', bin(t), '--json', out, 'plugins/p'], { cwd: root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /p: claude 2\/2, codex 2\/2, grok 2\/2, agy 2\/2/);
  assert.match(result.summary, /\| claude \| ✅ installed \| 2 of 2 \| 1 \(server\) \| 1 \(PreToolUse\) \|/);
  assert.match(result.summary, /\| agy \| ✅ installed \| 2 of 2 \| not loaded \| not loaded \|/);
  const [{ plugin, results }] = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(plugin.dir, 'plugins/p');
  assert.equal(results.claude.alwaysOnTokens, 300);
  assert.deepEqual(results.grok.skills, ['deep', 'one', 'two']);
  assert.deepEqual(results.agy.notes, ['hooks/hooks.json: never loaded']);
});

test('a client that loads fewer skills than the plugin has, or can not install it, fails the run', (t) => {
  const root = tree(t, PLUGIN);
  const missing = run(t, 'test-drive.mjs', ['--bin', bin(t, undefined, 'codex-misses'), 'plugins/p'], { cwd: root });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /::error::p in codex: did not load 1 of 2 skills: two/);
  const failing = run(t, 'test-drive.mjs', ['--bin', bin(t, undefined, 'claude-fails'), 'plugins/p'], { cwd: root });
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /::error::p in claude: could not install: install: ✘ Plugin not found in marketplace/);
});

test('a CLI that is not installed is reported and does not fail the run; a plugin outside the marketplace is not installed into claude and codex', (t) => {
  const files = { ...PLUGIN };
  delete files['.claude-plugin/marketplace.json'];
  const root = tree(t, files);
  const result = run(t, 'test-drive.mjs', ['--bin', bin(t, ['claude', 'codex', 'grok']), 'plugins/p'], { cwd: root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /p: claude skipped, codex skipped, grok 2\/2, agy n\/a/);
  assert.match(result.summary, /\| agy \| CLI not installed \|/);
  assert.match(result.summary, /\*\*claude:\*\* not in the marketplace: validated, not installed/);
});

test('without a changed plugin there is nothing to test-drive, and wrong arguments print the usage', (t) => {
  const root = tree(t, PLUGIN);
  commit(root);
  write(root, { 'README.md': 'not a plugin' });
  const head = commit(root);
  const none = run(t, 'test-drive.mjs', ['--bin', bin(t), '--changed', 'HEAD~1...HEAD'], { cwd: root });
  assert.ok(head);
  assert.equal(none.status, 0);
  assert.match(none.summary, /No plugin is touched by this change/);
  for (const args of [[], ['--clients', 'claude,nope', 'plugins/p'], ['--what']]) {
    const wrong = run(t, 'test-drive.mjs', args, { cwd: root });
    assert.equal(wrong.status, 2, args.join(' '));
    assert.match(wrong.stderr, /usage: test-drive\.mjs/);
  }
});

test('--build builds the manifests for the test drive and puts the files back, except one with changes of its own', (t) => {
  const root = tree(t, { ...PLUGIN, 'plugins/p/.claude-plugin/plugin.json': 'checked in', 'plugins/p/.cursor-plugin/plugin.json': 'checked in' });
  git(root, 'init', '-q');
  commit(root);
  // a stand-in for x927 that writes three manifests: a clean tracked one, a new one, and one the contributor edited
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules/.bin/x927'), `#!/bin/sh
for file in plugins/p/.claude-plugin/plugin.json plugins/p/.tessl-plugin/plugin.json plugins/p/.cursor-plugin/plugin.json; do
  mkdir -p "$(dirname "$file")"; echo built > "$file"; echo "wrote $file"
done`);
  chmodSync(join(root, 'node_modules/.bin/x927'), 0o755);
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  writeFileSync(join(root, 'plugins/p/.cursor-plugin/plugin.json'), 'edited by hand');

  const restore = buildManifests(root);
  assert.equal(readFileSync(join(root, 'plugins/p/.claude-plugin/plugin.json'), 'utf8'), 'built\n');
  assert.deepEqual(restore(), ['plugins/p/.cursor-plugin/plugin.json']);
  assert.equal(readFileSync(join(root, 'plugins/p/.claude-plugin/plugin.json'), 'utf8'), 'checked in');
  assert.equal(existsSync(join(root, 'plugins/p/.tessl-plugin/plugin.json')), false);

  const result = run(t, 'test-drive.mjs', ['--build', '--bin', bin(t), 'plugins/p'], { cwd: root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /plugins\/p\/\.cursor-plugin\/plugin\.json had changes of its own and stays as the build wrote it/);
  assert.equal(readFileSync(join(root, 'plugins/p/.claude-plugin/plugin.json'), 'utf8'), 'checked in');
});

// ---- the notes for the reviewers ----

const plugin = (name) => ({ [`plugins/${name}/plugin.json`]: manifest(name), [`plugins/${name}/skills/s/SKILL.md`]: skill('s') });

test('the review test-drives what the pull request changes, not what main changed since the branch was cut', (t) => {
  // main moves on after the branch is cut: it changes plugin "theirs"; the branch changes "mine"
  const root = tree(t, { ...plugin('mine'), ...plugin('theirs'), ...plugin('untouched') });
  const start = commit(root);
  git(root, 'checkout', '-q', '-b', 'branch');
  write(root, { 'plugins/mine/skills/s/SKILL.md': skill('s') + 'changed here\n' });
  commit(root);
  git(root, 'checkout', '-q', 'main');
  write(root, { 'plugins/theirs/skills/s/SKILL.md': skill('s') + 'changed on main\n' });
  const tip = commit(root);
  // the review has the base tree at the tip of main, in a checkout of its own
  const runner = mkdtempSync(join(tmpdir(), 'review-runner-'));
  t.after(() => rmSync(runner, { recursive: true, force: true }));
  git(root, 'worktree', 'add', '-q', '--detach', join(runner, 'base'), tip);
  git(root, 'checkout', '-q', 'branch');

  assert.equal(baseCommit(root, { RUNNER_TEMP: runner }), tip);
  assert.notEqual(tip, start);
  const result = run(t, 'test-drive.mjs', ['--bin', bin(t), '--changed', `${baseCommit(root, { RUNNER_TEMP: runner })}...HEAD`], { cwd: root });
  assert.match(result.stdout, /^mine: /m);
  assert.doesNotMatch(result.stdout, /theirs|untouched/);
  // without a base tree, or with one this checkout doesn't know, it is the remote's main
  assert.equal(baseCommit(root, {}), 'origin/main');
  assert.equal(baseCommit(root, { RUNNER_TEMP: tmpdir(), GITHUB_BASE_REF: 'release' }), 'origin/release');
});


test('the notes for the reviewers fit the prompt and name what each client loaded', () => {
  const plugin = { name: 'p', dir: 'plugins/p', skills: ['one', 'two'], hasMcp: true, hasHooks: true };
  const results = [{ plugin, results: {
    claude: { installed: true, skills: ['one', 'two'], mcpServers: ['server'], hooks: ['PreToolUse'] },
    codex: { installed: true, skills: ['one', 'two'], mcpServers: ['server'], hooks: null },
    grok: { installed: false, skills: [], mcpServers: [], hooks: 0 },
    agy: { installed: true, skills: ['one'], mcpServers: [], hooks: 0 },
  } }];
  const text = notes({ results, report: '/tmp/report.md', bin: '/tmp/bin', setupFailed: null, driveStatus: 1 });
  assert.match(text, /- `plugins\/p`: claude 2\/2 \(MCP server, hooks\); codex 2\/2 \(MCP server, hooks not checked\); grok FAILED to install; agy 1\/2 \(no MCP server, no hooks\)/);
  assert.match(text, /and the test drive failed/);
  assert.match(text, /node scripts\/skill-eval\.mjs --client claude/);
  assert.ok(Buffer.byteLength(text) < 4000);
  assert.match(notes({ results: [], report: 'r', bin: 'b', setupFailed: null, driveStatus: 0 }), /changes no plugin/);
  assert.match(notes({ results: null, report: 'r', bin: 'b', setupFailed: 'exit 1', driveStatus: 1 }), /Setting up the CLIs failed: exit 1[\s\S]*did not produce a result/);
});
