import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyPlatform, agyBehind, installAgy, latestAgy, sha512 } from './setup-agent-clis.mjs';
import { ENDPOINTS, MODELS, RULES, RUNNERS, changedSince, keeps, listFiles } from './skill-eval.mjs';
import { commit, run, tree, write } from './lib/testing.mjs';

const ROOT = join(import.meta.dirname, '..');
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-clis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const answers = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => body, json: async () => body });

// ---- setup-agent-clis.mjs ----

test('the pins: every platform CI and a contributor run on, with an https URL and a SHA-512', () => {
  const pins = JSON.parse(readFileSync(join(ROOT, 'scripts/agent-clis/agy.json'), 'utf8'));
  assert.match(pins.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(pins.platforms).sort(), ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64']);
  for (const pin of Object.values(pins.platforms)) {
    assert.match(pin.url, /^https:\/\/storage\.googleapis\.com\/antigravity-public\//);
    assert.ok(pin.url.includes(pins.version));
    assert.match(pin.sha512, /^[0-9a-f]{128}$/);
  }
  const clis = JSON.parse(readFileSync(join(ROOT, 'scripts/agent-clis/package.json'), 'utf8'));
  // exact versions: what a pull request test-drives does not change until Renovate says so
  for (const version of Object.values(clis.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(clis.devDependencies).sort(), ['@openai/codex', '@xai-official/grok']);
});

test('the platform of this machine, as Antigravity names it', () => {
  assert.equal(agyPlatform('linux', 'x64'), 'linux_amd64');
  assert.equal(agyPlatform('darwin', 'arm64'), 'darwin_arm64');
  assert.equal(agyPlatform('win32', 'x64'), null);
  assert.equal(agyPlatform('linux', 'riscv64'), null);
});

test('agy is unpacked from an archive with the pinned hash, and refused with another', async (t) => {
  const work = temp(t);
  writeFileSync(join(work, 'antigravity'), '#!/bin/sh\necho 9.9.9\n');
  execFileSync('tar', ['-czf', join(work, 'cli.tar.gz'), '-C', work, 'antigravity']);
  const archive = readFileSync(join(work, 'cli.tar.gz'));
  const pins = { version: '9.9.9', platforms: { linux_amd64: { url: 'https://example.com/cli.tar.gz', sha512: sha512(archive) } } };
  const bin = temp(t);

  const path = await installAgy(bin, { pins, platform: 'linux_amd64', fetchImpl: answers(archive) });
  assert.equal(path, join(bin, 'agy'));
  assert.equal(execFileSync(path, { encoding: 'utf8' }), '9.9.9\n');

  const other = temp(t);
  await assert.rejects(installAgy(other, { pins, platform: 'linux_amd64', fetchImpl: answers(Buffer.from('something else')) }), /has the SHA-512 [0-9a-f]{16}…, and agy\.json pins [0-9a-f]{16}…\. Not installed\./);
  assert.equal(existsSync(join(other, 'agy')), false);
  await assert.rejects(installAgy(other, { pins, platform: 'linux_amd64', fetchImpl: answers(archive, false) }), /answered 404/);
  await assert.rejects(installAgy(other, { pins, platform: 'win32_amd64', fetchImpl: answers(archive) }), /no build of Antigravity 9\.9\.9 for win32_amd64/);
});

test('the latest Antigravity is one version on every platform, or nothing is written', async () => {
  const asked = [];
  const manifests = (versions) => async (url) => {
    asked.push(url);
    const platform = url.match(/manifests\/(.*)\.json$/)[1];
    return { ok: true, json: async () => ({ version: versions[platform] ?? '2.0.0', url: `https://example.com/${platform}.tar.gz`, sha512: 'ab' }) };
  };
  const pins = await latestAgy(manifests({}));
  assert.equal(pins.version, '2.0.0');
  assert.deepEqual(pins.platforms.darwin_arm64, { url: 'https://example.com/darwin_arm64.tar.gz', sha512: 'ab' });
  assert.equal(asked.length, 4);
  await assert.rejects(latestAgy(manifests({ linux_arm64: '2.0.1' })), /different versions \(2\.0\.0 and 2\.0\.1\)/);
  await assert.rejects(latestAgy(async () => ({ ok: false, status: 503 })), /answered 503/);
});

test('a newer Antigravity than the pinned one is said, and a manifest service that is down is not a failure', async () => {
  const service = (version) => async (url) => ({ ok: true, json: async () => ({ version, url, sha512: 'ab' }) });
  assert.equal(await agyBehind({ version: '1.5.9' }, service('1.5.9')), null);
  assert.match(await agyBehind({ version: '1.5.9' }, service('1.6.0')), /Antigravity 1\.6\.0 is out and scripts\/agent-clis\/agy\.json pins 1\.5\.9\. To update: node scripts\/setup-agent-clis\.mjs --update-agy/);
  assert.equal(await agyBehind({ version: '1.5.9' }, async () => { throw new Error('offline'); }), null);
});

// ---- skill-eval.mjs ----

test('what a run did to the files: new, changed at the same size, and removed ones, without what a client keeps for itself', (t) => {
  const dir = tree(t, { 'kept.md': 'same', 'changed.md': 'value=1', 'removed.md': 'gone soon', '.claude/settings.json': '{}', 'node_modules/x/index.js': '' });
  const before = listFiles(dir);
  assert.deepEqual(before.map((file) => file.path), ['changed.md', 'kept.md', 'removed.md']);
  writeFileSync(join(dir, 'changed.md'), 'value=2'); // as many bytes as before
  writeFileSync(join(dir, 'new.md'), 'new');
  rmSync(join(dir, 'removed.md'));
  assert.deepEqual(changedSince(before, listFiles(dir)), { written: [{ path: 'changed.md', bytes: 7 }, { path: 'new.md', bytes: 3 }], removed: ['removed.md'] });
  assert.deepEqual(changedSince(before, before), { written: [], removed: [] });
});

test('credentials: each client names the variables it is given, and no others', () => {
  const bedrock = { AWS_BEARER_TOKEN_BEDROCK: 'x', AWS_REGION: 'us-west-2', GITHUB_TOKEN: 'never' };
  assert.deepEqual(RUNNERS.claude.credentials(bedrock), ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'AWS_DEFAULT_REGION']);
  assert.deepEqual(RUNNERS.claude.env('/home', true), { CLAUDE_CODE_USE_BEDROCK: '1' });
  assert.deepEqual(RUNNERS.claude.credentials({ ...bedrock, ANTHROPIC_API_KEY: 'k' }), ['ANTHROPIC_API_KEY']);
  assert.equal(RUNNERS.claude.bedrock({ ...bedrock, ANTHROPIC_API_KEY: 'k' }), false);
  assert.deepEqual(RUNNERS.codex.credentials(bedrock), ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'AWS_DEFAULT_REGION']);
  assert.deepEqual(RUNNERS.codex.credentials({ OPENAI_API_KEY: 'k' }), ['OPENAI_API_KEY']);
  assert.deepEqual(RUNNERS.grok.credentials({ XAI_API_KEY: 'k' }), ['XAI_API_KEY']);
  assert.deepEqual(RUNNERS.agy.credentials({ GEMINI_API_KEY: 'k' }), ['GEMINI_API_KEY']);
  for (const client of Object.values(RUNNERS)) assert.equal(client.credentials({ GITHUB_TOKEN: 'never' }), null);
  // on Bedrock: Grok reads the key from its own name; Antigravity gets it as its gateway's key
  assert.deepEqual(RUNNERS.grok.credentials(bedrock), ['AWS_BEARER_TOKEN_BEDROCK']);
  assert.equal(RUNNERS.grok.bedrock({ ...bedrock, XAI_API_KEY: 'k' }), false);
  assert.deepEqual(RUNNERS.agy.credentials(bedrock), []);
  assert.equal(RUNNERS.agy.bedrock({ ...bedrock, GEMINI_API_KEY: 'k' }), false);
  assert.deepEqual(RUNNERS.agy.env('/home', false), {});
  assert.deepEqual(RUNNERS.agy.env('/home', true, { model: 'global.xai.grok-4.6', baseUrl: ENDPOINTS.agy('us-west-2'), key: 'x' }), {
    AGY_LLM_GATEWAY_URL: 'https://bedrock-runtime.us-west-2.amazonaws.com/openai', // Antigravity adds /v1/chat/completions
    AGY_LLM_GATEWAY_API_KEY: 'x',
    AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai',
    AGY_LLM_GATEWAY_MODELS: 'global.xai.grok-4.6',
    AGY_CLI_DISABLE_AUTO_UPDATE: '1',
  });
  assert.deepEqual(Object.keys(MODELS), ['claude', 'codex', 'grok', 'agy']);
  assert.equal(ENDPOINTS.grok('eu-west-1'), 'https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1');
});

test('the commands: claude loads the plugin from its directory only in the run with it', () => {
  const plugin = { dir: '/repo/plugins/p' };
  const withPlugin = RUNNERS.claude.command({ prompt: 'task', model: 'm', maxTurns: 5, plugin, withPlugin: true });
  assert.deepEqual(withPlugin.slice(-2), ['--plugin-dir', '/repo/plugins/p']);
  assert.ok(!RUNNERS.claude.command({ prompt: 'task', maxTurns: 5, plugin, withPlugin: false }).includes('--plugin-dir'));
  assert.deepEqual(RUNNERS.claude.answer({ stdout: '{"result":"done","num_turns":3,"total_cost_usd":0.1,"is_error":false}' }), { text: 'done', turns: 3, costUsd: 0.1, failed: false });
  assert.deepEqual(RUNNERS.claude.answer({ stdout: 'not json' }), { text: 'not json' });
  assert.deepEqual(RUNNERS.grok.answer({ stdout: '{"text":"done","num_turns":2,"total_cost_usd":0.02}' }), { text: 'done', turns: 2, costUsd: 0.02 });
  assert.deepEqual(RUNNERS.codex.command({ prompt: 'task', workdir: '/w', lastMessage: '/o/last' }).slice(0, 2), ['exec', '--skip-git-repo-check']);
});

// A stand-in for a client: it writes a file and answers differently when a plugin is loaded.
const PLUGIN = {
  'plugins/p/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
  'plugins/p/skills/one/SKILL.md': '---\nname: one\n---\n',
  'plugins/p/evals/case/task.md': 'Do the task of the scenario.',
  'plugins/p/evals/case/criteria.json': JSON.stringify({ checklist: [{ name: 'done', max_score: 10 }] }),
  'plugins/p/evals/case/resources/start.md': 'given',
  'plugins/p/evals/case/setup.sh': 'cat resources/start.md > start.md',
};
function cli(t, name, script) {
  const dir = temp(t);
  writeFileSync(join(dir, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}
const claude = (t, script) => cli(t, 'claude', script);
const ANSWERS = `case "$*" in *--plugin-dir*) with=yes ;; *) with=no ;; esac
echo "plugin $with" > result.md
printf '{"result":"plugin %s, key %s, token %s, started with %s","num_turns":2,"total_cost_usd":0.01}' "$with" "\${AWS_BEARER_TOKEN_BEDROCK:-none}" "\${GITHUB_TOKEN:-none}" "$(cat start.md 2>/dev/null)"`;

test('an eval runs the task with the plugin and without it, and reports both answers and the files written', (t) => {
  const root = tree(t, PLUGIN);
  const out = temp(t);
  const result = run(t, 'skill-eval.mjs', ['--client', 'claude', '--plugin', 'plugins/p', '--scenario', 'plugins/p/evals/case', '--bin', claude(t, ANSWERS), '--out', out], {
    cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key', GITHUB_TOKEN: 'github-token' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.model, MODELS.claude);
  // the client gets the Bedrock key and nothing else of the runner's environment
  assert.equal(report.arms.with.answer, 'plugin yes, key bedrock-key, token none, started with given');
  assert.equal(report.arms.without.answer, 'plugin no, key bedrock-key, token none, started with given');
  assert.deepEqual(report.arms.with.files, [{ path: 'result.md', bytes: 11 }]);
  assert.deepEqual(report.arms.with.removed, []);
  assert.equal(report.arms.with.turns, 2);
  assert.deepEqual(report.criteria, { checklist: [{ name: 'done', max_score: 10 }] });
  assert.deepEqual(report.notes, []);
  assert.equal(readFileSync(join(out, 'claude-with', 'workdir', 'result.md'), 'utf8'), 'plugin yes\n');
  assert.equal(readFileSync(join(root, 'plugins/p/evals/case/resources/start.md'), 'utf8'), 'given'); // the scenario is not changed
});

// A stand-in for a client that answers with the files of its work directory and the branch it is on.
const LISTS = `printf '{"result":"%s on %s"}' "$(find . -type f -not -path './.git/*' | sort | tr '\\n' ' ')" "$( (git branch --show-current; git remote get-url origin) 2>/dev/null | tr '\\n' ' ')"`;

test('a scenario starts from its fixtures, includes and setup scripts, in that order, in each run\'s own directory', (t) => {
  const upstream = tree(t, { 'README.md': 'upstream', 'docs/guide.md': 'guide', 'src/app.js': 'app', 'src/app.test.js': 'test' });
  commit(upstream);
  const root = tree(t, {
    ...PLUGIN,
    'plugins/p/evals/case/setup.sh': 'echo "$(ls src | tr "\\n" " ")/ $(cat block/block.js)" > setup.txt; git add -A; git -c user.name=e -c user.email=e@example.com commit -q -m setup',
    'plugins/p/evals/case/first.sh': 'echo first > first.txt',
    'plugins/p/evals/case/data/seed.json': '{}',
    'plugins/p/evals/case/fixtures/block/block.js': 'block',
    'plugins/p/evals/case/fixtures/block/block.md': 'notes',
    'plugins/p/evals/case/scenario.json': JSON.stringify({
      fixture: { repoUrl: upstream, ref: 'HEAD', remote: 'https://github.com/org/site.git', exclude: ['*.md', 'src/*.test.js'] },
      fixtures: { block: { type: 'directory', path: './fixtures/block', installPath: 'block', include: ['*.js'] } },
      include: ['./data'],
      setup: ['./first.sh'],
    }),
  });
  const result = run(t, 'skill-eval.mjs', ['--client', 'claude', '--plugin', 'plugins/p', '--scenario', 'plugins/p/evals/case', '--bin', claude(t, LISTS), '--out', temp(t)], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  for (const arm of ['with', 'without']) {
    assert.equal(report.arms[arm].answer, './block/block.js ./data/seed.json ./first.txt ./resources/start.md ./setup.txt ./src/app.js  on main https://github.com/org/site.git ');
    assert.deepEqual(report.arms[arm].files, []); // what the scenario set up is not what the run wrote
  }
  assert.deepEqual(report.notes, []);
});

test('--no-setup leaves out what needs the network and says so; a step that fails is a failed run', (t) => {
  const root = tree(t, {
    ...PLUGIN,
    'plugins/p/evals/case/fixtures/block/block.js': 'block',
    'plugins/p/evals/case/scenario.json': JSON.stringify({
      fixture: { repoUrl: 'https://github.com/org/repo.git', ref: 'abc1234' },
      fixtures: { block: { type: 'directory', path: './fixtures/block', installPath: 'blocks/block' } },
    }),
  });
  const args = ['--client', 'claude', '--plugin', 'plugins/p', '--scenario', 'plugins/p/evals/case', '--arms', 'without', '--bin', claude(t, LISTS), '--out', temp(t)];
  const offline = run(t, 'skill-eval.mjs', [...args, '--no-setup'], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(offline.status, 0, offline.stdout + offline.stderr);
  const report = JSON.parse(offline.stdout);
  assert.equal(report.arms.without.answer, './blocks/block/block.js ./resources/start.md  on ');
  assert.deepEqual(report.notes, ['--no-setup: the work directory lacks the fixture codebase, a clone of https://github.com/org/repo.git at abc1234, the setup script ./setup.sh.']);

  write(root, { 'plugins/p/evals/case/scenario.json': '{}', 'plugins/p/evals/case/setup.sh': 'echo "no such ref" >&2; exit 1' });
  const failing = run(t, 'skill-eval.mjs', args, { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(failing.status, 1);
  assert.deepEqual(JSON.parse(failing.stdout).arms.without, { error: 'setting up the scenario: the setup script ./setup.sh failed: no such ref' });

  write(root, { 'plugins/p/evals/case/scenario.json': JSON.stringify({ fixtures: { up: { type: 'directory', path: './fixtures/block', installPath: '../outside' } } }) });
  const outside = run(t, 'skill-eval.mjs', args, { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(outside.status, 1);
  assert.match(JSON.parse(outside.stdout).arms.without.error, /the fixture up is installed at \.\.\/outside, outside the work directory/);

  // a work directory of one's own is taken as it is
  write(root, { 'mine/file.txt': 'x' });
  const given = run(t, 'skill-eval.mjs', [...args, '--workdir', 'mine'], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(given.status, 0, given.stdout + given.stderr);
  assert.equal(JSON.parse(given.stdout).arms.without.answer, './file.txt  on ');
  assert.match(JSON.parse(given.stdout).notes[0], /^The work directory is the one of --workdir/);
});

test('the setup scripts get a home of their own, without the sign-in that --auth-home gives the client', (t) => {
  const signedIn = tree(t, { '.claude/.credentials.json': '{"token":"secret"}' });
  const root = tree(t, {
    ...PLUGIN,
    'plugins/p/evals/case/setup.sh': 'if [ -e "$HOME/.claude/.credentials.json" ]; then echo read > setup.txt; else echo none > setup.txt; fi',
  });
  const reads = `printf '{"result":"setup %s, client %s"}' "$(cat setup.txt)" "$(grep -q secret "$HOME/.claude/.credentials.json" && echo read || echo none)"`;
  const result = run(t, 'skill-eval.mjs', ['--client', 'claude', '--plugin', 'plugins/p', '--scenario', 'plugins/p/evals/case', '--arms', 'without', '--auth-home', signedIn, '--bin', claude(t, reads), '--out', temp(t)], { cwd: root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).arms.without.answer, 'setup none, client read');
});

test('the globs of a fixture match a path, a directory above it, or a file name', () => {
  assert.equal(keeps('a/b.md', { exclude: ['*.md'] }), false);
  assert.equal(keeps('.tessl/x/y.json', { exclude: ['.tessl/'] }), false);
  assert.equal(keeps('src/auth/login.ts', { include: ['src/auth/**'] }), true);
  assert.equal(keeps('src/other.ts', { include: ['src/auth/**', 'package.json'] }), false);
  assert.equal(keeps('src/a/b.ts', { include: ['src/**/*.ts'], exclude: ['**/*.test.ts'] }), true);
  assert.equal(keeps('src/a/b.test.ts', { include: ['src/**/*.ts'], exclude: ['**/*.test.ts'] }), false);
  assert.equal(keeps('anything'), true);
});

test('a run that edits a file without changing its size, or only removes one, is reported and its work directory kept', (t) => {
  const root = tree(t, { ...PLUGIN, 'start/config.txt': 'value=1', 'start/old.txt': 'old' });
  const out = temp(t);
  const edits = `case "$*" in *--plugin-dir*) echo value=2 | tr -d '\\n' > config.txt ;; *) rm old.txt ;; esac; echo '{"result":"ok"}'`;
  const result = run(t, 'skill-eval.mjs', ['--client', 'claude', '--plugin', 'plugins/p', '--prompt', 'x', '--workdir', 'start', '--bin', claude(t, edits), '--out', out], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { arms } = JSON.parse(result.stdout);
  assert.deepEqual([arms.with.files, arms.with.removed], [[{ path: 'config.txt', bytes: 7 }], []]);
  assert.deepEqual([arms.without.files, arms.without.removed], [[], ['old.txt']]);
  assert.equal(readFileSync(join(out, 'claude-with', 'workdir', 'config.txt'), 'utf8'), 'value=2');
  assert.equal(existsSync(join(out, 'claude-without', 'workdir', 'old.txt')), false);
  assert.equal(readFileSync(join(out, 'claude-without', 'workdir', 'config.txt'), 'utf8'), 'value=1');
  assert.equal(readFileSync(join(root, 'start/config.txt'), 'utf8'), 'value=1'); // the files the task starts from are not changed
});

test('grok on Bedrock: a model of its own configuration with the key from the environment; an error it prints is a failed run', (t) => {
  const root = tree(t, PLUGIN);
  // prints its configuration and whether it got the key, as grok's JSON result
  const shows = `case "$1" in plugin) exit 0 ;; esac
printf '{"text":"key %s, xai %s, args %s, config %s","num_turns":1}' "\${AWS_BEARER_TOKEN_BEDROCK:-none}" "\${XAI_API_KEY:-none}" "$(echo "$*" | grep -o -- '-m [a-z.0-9-]*')" "$(tr '\\n"' '| ' < "$HOME/.grok/config.toml")"`;
  const result = run(t, 'skill-eval.mjs', ['--client', 'grok', '--plugin', 'plugins/p', '--prompt', 'x', '--arms', 'with', '--bin', cli(t, 'grok', shows), '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key', AWS_REGION: 'eu-west-1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual([report.model, report.endpoint], ['global.xai.grok-4.6', 'https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1']);
  assert.equal(report.arms.with.answer, 'key bedrock-key, xai none, args -m bedrock, config [model.bedrock]|model =  global.xai.grok-4.6 |base_url =  https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1 |name =  global.xai.grok-4.6 (Amazon Bedrock) |api_backend =  responses |reasoning_summary =  none |env_key =  AWS_BEARER_TOKEN_BEDROCK |');

  // with a key of xAI's, grok runs as it is: no configuration, the model as given
  const direct = run(t, 'skill-eval.mjs', ['--client', 'grok', '--plugin', 'plugins/p', '--prompt', 'x', '--arms', 'without', '--model', 'grok-4.6', '--bin', cli(t, 'grok', shows), '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key', XAI_API_KEY: 'xai-key' } });
  assert.equal(JSON.parse(direct.stdout).arms.without.answer, 'key none, xai xai-key, args -m grok-4.6, config ');
  assert.equal(JSON.parse(direct.stdout).endpoint, undefined);

  // grok exits 0 when the endpoint refuses the request
  const refused = run(t, 'skill-eval.mjs', ['--client', 'grok', '--plugin', 'plugins/p', '--prompt', 'x', '--arms', 'without', '--bin', cli(t, 'grok', `echo '{"type":"error","message":"model not found"}'`), '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'k' } });
  assert.equal(refused.status, 1);
  assert.deepEqual([JSON.parse(refused.stdout).arms.without.failed, JSON.parse(refused.stdout).arms.without.answer], [true, 'model not found']);
});

test('agy on Bedrock: its gateway mode, with the key as the gateway\'s key and --base-url for another endpoint', (t) => {
  const root = tree(t, PLUGIN);
  const shows = `case "$1" in plugin) exit 0 ;; esac
printf '{"status":"SUCCESS","response":"url %s, key %s, protocol %s, models %s, bedrock %s, args %s","num_turns":1}' "$AGY_LLM_GATEWAY_URL" "$AGY_LLM_GATEWAY_API_KEY" "$AGY_LLM_GATEWAY_WIRE_PROTOCOL" "$AGY_LLM_GATEWAY_MODELS" "\${AWS_BEARER_TOKEN_BEDROCK:-none}" "$(echo "$*" | grep -o -- '--model [a-z.0-9-]*')"`;
  const base = ['--client', 'agy', '--plugin', 'plugins/p', '--prompt', 'x', '--arms', 'with', '--bin', cli(t, 'agy', shows)];
  const result = run(t, 'skill-eval.mjs', [...base, '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).arms.with.answer, 'url https://bedrock-runtime.us-west-2.amazonaws.com/openai, key bedrock-key, protocol openai, models global.xai.grok-4.6, bedrock none, args --model global.xai.grok-4.6');

  const other = run(t, 'skill-eval.mjs', [...base, '--model', 'xai.grok-4.6', '--base-url', 'https://bedrock-mantle.us-west-2.api.aws/openai/v1', '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key' } });
  assert.match(JSON.parse(other.stdout).arms.with.answer, /^url https:\/\/bedrock-mantle\.us-west-2\.api\.aws\/openai, key bedrock-key, protocol openai, models xai\.grok-4\.6,/);

  const refused = run(t, 'skill-eval.mjs', [...base, '--bin', cli(t, 'agy', `case "$1" in plugin) exit 0 ;; esac; echo '{"status":"ERROR","response":""}'; exit 3`), '--out', temp(t)], { cwd: root, env: { AWS_BEARER_TOKEN_BEDROCK: 'k' } });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).arms.with.failed, true);
});

test('the task is given with the rule to stay in the work directory', (t) => {
  const root = tree(t, PLUGIN);
  const result = run(t, 'skill-eval.mjs', ['--client', 'claude', '--plugin', 'plugins/p', '--prompt', 'the task', '--arms', 'without', '--bin', claude(t, 'printf \'%s\' "$2" > "$HOME/../prompt.txt"; echo \'{"result":"ok"}\'; cat "$HOME/../prompt.txt" >&2')], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report.arms), ['without']);
  assert.equal(report.model, "the client's default");
  assert.equal(readFileSync(join(report.transcripts, 'claude-without', 'stderr.txt'), 'utf8'), `${RULES}\n\nthe task`);
  rmSync(report.transcripts, { recursive: true, force: true });
});

test('no credentials is exit 3, a failing run exit 1, and wrong arguments exit 2', (t) => {
  const root = tree(t, PLUGIN);
  const base = ['--client', 'claude', '--plugin', 'plugins/p', '--prompt', 'x'];
  const none = run(t, 'skill-eval.mjs', [...base, '--bin', claude(t, ANSWERS)], { cwd: root });
  assert.equal(none.status, 3);
  assert.match(none.stderr, /No credentials for claude here\. It needs AWS_BEARER_TOKEN_BEDROCK, or ANTHROPIC_API_KEY/);

  const failing = run(t, 'skill-eval.mjs', [...base, '--bin', claude(t, 'echo "model not available" >&2; exit 4'), '--out', temp(t)], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(failing.status, 1);
  assert.deepEqual([JSON.parse(failing.stdout).arms.with.exit, JSON.parse(failing.stdout).arms.with.stderr], [4, 'model not available']);

  const slow = run(t, 'skill-eval.mjs', [...base, '--arms', 'with', '--timeout', '1', '--bin', claude(t, 'sleep 20'), '--out', temp(t)], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(slow.status, 1);
  assert.equal(JSON.parse(slow.stdout).arms.with.exit, 'timed out after 1 s');

  const missing = run(t, 'skill-eval.mjs', [...base, '--bin', temp(t)], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /claude is not installed/);
  for (const args of [['--client', 'claude'], ['--client', 'nope', '--plugin', 'plugins/p', '--prompt', 'x'], [...base, '--task', 'also.md'], [...base, '--arms', 'both']]) {
    assert.equal(run(t, 'skill-eval.mjs', args, { cwd: root }).status, 2, args.join(' '));
  }
});
