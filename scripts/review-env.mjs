// The `environment` hook of the AI review (.github/workflows/ai-review.yml): what the
// reviewers get besides the two trees. The review workflow runs it in the head tree and in
// the base tree; it does its work in the head and nothing in the base.
//
// 1. Installs the agent CLIs (setup-agent-clis.mjs) below RUNNER_TEMP, where test-drive.mjs
//    and skill-eval.mjs find them. Not on the PATH: the reviewers are a claude and a codex
//    of the review workflow's own versions, and must stay that.
// 2. Test-drives the plugins this pull request changes in each client (test-drive.mjs):
//    the diff from the merge base, as the Plugin Test Drive workflow takes it. Not the
//    difference to the base tree, which is the tip of main and has moved on for most pull
//    requests. A
//    pull request leaves the generated manifests alone, so the test drive builds them and
//    puts them back (--build): the reviewers get the tree as the pull request has it.
// 3. Writes notes for the prompt: what each client loaded, where the full report is, and
//    how to run a skill with and without its plugin (skill-eval.mjs).
//
// REVIEW_SIDE, REVIEW_ENV_DIR and RUNNER_TEMP come from the review workflow. A step that
// fails is said in the notes; the hook itself only fails when it can't write them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CLIENTS } from './lib/clients.mjs';
import { isMain } from './lib/is-main.mjs';

// The notes for the prompt, which takes their first 4000 bytes: one line per plugin and
// client, then the commands.
export function notes({ results, report, bin, setupFailed, driveStatus }) {
  const lines = ['**Agent CLIs and the plugin test drive**', ''];
  if (setupFailed) lines.push(`Setting up the CLIs failed: ${setupFailed}`, '');
  lines.push(`\`claude\`, \`codex\`, \`grok\` and \`agy\` (Google Antigravity) are installed in ${bin}. The two scripts below find them there; they are not on the PATH.`, '');
  if (results === null) {
    lines.push('The test drive did not produce a result. Run it yourself: `node scripts/test-drive.mjs --build <plugin dir>`.');
  } else if (results.length === 0) {
    lines.push('This pull request changes no plugin, so nothing was test-driven.');
  } else {
    lines.push(`Each changed plugin was installed into each client with an empty home directory${driveStatus === 0 ? '' : ' — **and the test drive failed**'}. Skills a client loaded, of the skills the plugin has directly under \`skills/\`:`, '');
    for (const { plugin, results: clients } of results) {
      const cells = CLIENTS.map((client) => {
        const result = clients[client];
        if (!result || result.missing) return `${client} not installed`;
        if (result.installed === null) return `${client} skipped`;
        if (result.installed === false) return `${client} FAILED to install`;
        const loaded = result.skills.filter((skill) => plugin.skills.includes(skill)).length;
        const more = [];
        if (plugin.hasMcp) more.push(result.mcpServers.length > 0 ? 'MCP server' : 'no MCP server');
        if (plugin.hasHooks) more.push(result.hooks === null ? 'hooks not checked' : (Array.isArray(result.hooks) ? result.hooks.length : result.hooks) > 0 ? 'hooks' : 'no hooks');
        return `${client} ${loaded}/${plugin.skills.length}${more.length > 0 ? ` (${more.join(', ')})` : ''}`;
      });
      lines.push(`- \`${plugin.dir}\`: ${cells.join('; ')}`);
    }
    lines.push('', `The full report, with each client's warnings: ${report}`);
  }
  lines.push(
    '',
    'To run it again: `node scripts/test-drive.mjs --build <plugin dir>`.',
    'To see what a skill changes, run a task with and without its plugin: `node scripts/skill-eval.mjs --client claude --plugin <plugin dir> --prompt "<task>"`, or `--scenario <plugin dir>/evals/<name>` for a scenario the plugin has. It prints both answers and the files each run wrote or removed. All four clients run on the Bedrock key of this review: `claude` and `codex` on their own models, `grok` and `agy` on Grok\'s model, since Bedrock has no Gemini. The script says so (exit 3) when a client has no credentials.',
  );
  return `${lines.join('\n')}\n`;
}

// The commit the pull request is compared with: the one the base tree of the review is at,
// when this checkout has it, and the remote's main otherwise. `git diff <it>...HEAD` then
// starts from the merge base.
export function baseCommit(root = process.cwd(), env = process.env) {
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const base = env.RUNNER_TEMP ? join(env.RUNNER_TEMP, 'base') : null;
  const commit = base && existsSync(base) ? git(base, 'rev-parse', 'HEAD').stdout.trim() : '';
  return commit && git(root, 'cat-file', '-e', `${commit}^{commit}`).status === 0 ? commit : `origin/${env.GITHUB_BASE_REF || 'main'}`;
}

function main() {
  const side = process.env.REVIEW_SIDE ?? 'head';
  const out = process.env.REVIEW_ENV_DIR ?? resolve('.review-env');
  mkdirSync(out, { recursive: true });
  if (side !== 'head') {
    console.log('Nothing to do in the base tree.');
    return;
  }
  const bin = join(process.env.RUNNER_TEMP ?? resolve('.agent-clis'), 'agent-clis', 'bin');
  const setup = spawnSync(process.execPath, ['scripts/setup-agent-clis.mjs', bin], { stdio: 'inherit', env: { ...process.env, AGENT_CLIS_NO_PATH: '1' } });
  const json = join(out, 'test-drive.json');
  const report = join(out, 'test-drive.md');
  const { status } = spawnSync(process.execPath, ['scripts/test-drive.mjs', '--build', '--bin', bin, '--json', json, '--markdown', report, '--changed', `${baseCommit()}...HEAD`], { stdio: 'inherit' });
  let results = null;
  try {
    results = JSON.parse(readFileSync(json, 'utf8'));
  } catch {
    // the notes say that there is no result
  }
  writeFileSync(join(out, 'notes.md'), notes({ results, report, bin, setupFailed: setup.status === 0 ? null : `exit ${setup.status}`, driveStatus: status }));
}

if (isMain(import.meta.url)) main();
