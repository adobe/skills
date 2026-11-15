// Rebuilds the generated plugin files on the checked-out branch and pushes them.
//
// A pull request changes a plugin's root plugin.json or mcp.json and leaves the files that
// x927 generates from them alone (scripts/check-generated.mjs). After the merge, the Release
// workflow runs this: `x927 build --all`, one commit with what it wrote, and a push.
//
//   node scripts/rebuild-plugins.mjs          BRANCH (default main), REMOTE (default origin)
//
// The commit says [skip ci], like a release commit, so that it starts no release of its own.
// x927 has to be on the PATH (npm run puts it there).
//
// A push that is refused leaves the checkout as it was, without the commit. Why it was
// refused decides what happens next:
// - The branch has moved on: a newer push has its own run of this workflow, which builds
//   every plugin. This run sets the output `behind` to true and ends well, with a warning.
//   The workflow then releases nothing, because semantic-release does not release from a
//   branch that is behind its remote.
// - The branch has not moved: the token may not push to it, for example because of a
//   ruleset or a branch protection. The script fails and says so. Nothing can be released
//   then either: a release pushes its commit to the same branch.
import { execFileSync, spawnSync } from 'node:child_process';
import { error, setOutput, summary, warning } from './lib/actions.mjs';
import { isMain } from './lib/is-main.mjs';

export const MESSAGE = 'chore: rebuild the plugin manifests from plugin.json [skip ci]';
// the commit is the bot's, whatever identity the environment has
const NAME = 'github-actions[bot]';
const EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const BOT = { GIT_AUTHOR_NAME: NAME, GIT_AUTHOR_EMAIL: EMAIL, GIT_COMMITTER_NAME: NAME, GIT_COMMITTER_EMAIL: EMAIL };

// The files that `x927 build` reports as written.
export function written(output) {
  return [...output.matchAll(/^wrote (\S.*)$/gm)].map((match) => match[1].trim());
}

function main() {
  const root = process.cwd();
  const branch = process.env.BRANCH || 'main';
  const remote = process.env.REMOTE || 'origin';
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...BOT } });
  const build = spawnSync('x927', ['build', '--all'], { cwd: root, encoding: 'utf8' });
  console.log(`${build.stdout ?? ''}${build.stderr ?? ''}`);
  if (build.status !== 0) {
    error(`x927 build --all failed (exit code ${build.status ?? build.error?.message})`);
    process.exit(1);
  }
  setOutput('behind', false);
  const files = written(build.stdout ?? '');
  if (files.length === 0) {
    console.log('The generated plugin files are up to date.');
    setOutput('rebuilt', false);
    return;
  }
  const start = git('rev-parse', 'HEAD').trim();
  git('add', '--', ...files);
  git('commit', '--quiet', '-m', MESSAGE);
  const push = spawnSync('git', ['push', remote, `HEAD:refs/heads/${branch}`], { cwd: root, encoding: 'utf8' });
  if (push.status === 0) {
    console.log(`Pushed ${git('rev-parse', '--short', 'HEAD').trim()} to ${branch}: ${files.join(', ')}`);
    summary(['## Plugin manifests', '', `Rebuilt from \`plugin.json\` and pushed to \`${branch}\`:`, '', ...files.map((file) => `- \`${file}\``)]);
    setOutput('rebuilt', true);
    return;
  }
  const refusal = (push.stderr ?? '').trim();
  console.log(`The push was refused: ${refusal}`);
  setOutput('rebuilt', false);
  // the checkout is again what this run was started for
  git('reset', '--quiet', '--hard', start);
  git('fetch', '--quiet', remote, branch);
  const tip = git('rev-parse', 'FETCH_HEAD').trim();
  if (tip === start) {
    error(`${branch} did not take the push of the rebuilt plugin manifests, and it has not moved. The token of this workflow may not push to ${branch}: a ruleset or a branch protection has to let GitHub Actions bypass it. Nothing was released or published. Git said: ${refusal}`);
    process.exit(1);
  }
  warning(`${branch} moved on from ${start.slice(0, 8)} to ${tip.slice(0, 8)} while this run was building. The run for that push rebuilds the plugin manifests. This run releases nothing; a skill or plugin that only this push changed is released with its next change.`);
  summary(['## Plugin manifests', '', `Not rebuilt: \`${branch}\` moved on to \`${tip.slice(0, 8)}\` while this run was building. The run for that push rebuilds them, and this run releases nothing.`]);
  setOutput('behind', true);
}

if (isMain(import.meta.url)) main();
