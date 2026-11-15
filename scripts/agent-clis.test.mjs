import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyPlatform, agyBehind, installAgy, latestAgy, sha512 } from './setup-agent-clis.mjs';
import { MODELS, RULES, RUNNERS, changedSince, listFiles } from './skill-eval.mjs';
import { run, tree } from './lib/testing.mjs';

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

test('the files a run wrote: new and changed ones, without what a client keeps for itself', (t) => {
  const dir = tree(t, { 'kept.md': 'same', 'changed.md': 'short', '.claude/settings.json': '{}', 'node_modules/x/index.js': '' });
  const before = listFiles(dir);
  assert.deepEqual(before.map((file) => file.path), ['changed.md', 'kept.md']);
  writeFileSync(join(dir, 'changed.md'), 'longer than before');
  writeFileSync(join(dir, 'new.md'), 'new');
  assert.deepEqual(changedSince(before, listFiles(dir)), [{ path: 'changed.md', bytes: 18 }, { path: 'new.md', bytes: 3 }]);
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
  assert.deepEqual(Object.keys(MODELS), ['claude', 'codex']);
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
  'plugins/p/evals/case/setup.sh': 'exit 1',
};
function claude(t, script) {
  const dir = temp(t);
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  return dir;
}
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
  assert.equal(report.arms.with.turns, 2);
  assert.deepEqual(report.criteria, { checklist: [{ name: 'done', max_score: 10 }] });
  assert.match(report.notes.join(' '), /setup\.sh, which this runner does not run/);
  assert.equal(readFileSync(join(out, 'claude-with', 'workdir', 'result.md'), 'utf8'), 'plugin yes\n');
  assert.equal(readFileSync(join(root, 'plugins/p/evals/case/resources/start.md'), 'utf8'), 'given'); // the scenario is not changed
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
