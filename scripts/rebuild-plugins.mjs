// Rebuilds the generated plugin files on the checked-out branch and pushes them.
//
// A pull request changes a plugin's root plugin.json or mcp.json and leaves the files that
// x927 generates from them alone (scripts/check-generated.mjs). After the merge, the Release
// workflow runs this: `x927 build --all`, one commit with what it wrote, and a push. If the
// branch moved in the meantime, it takes the new tip, builds again and tries once more.
//
//   node scripts/rebuild-plugins.mjs          BRANCH (default main), REMOTE (default origin)
//
// The commit says [skip ci], like a release commit, so that it starts no release of its own.
// x927 has to be on the PATH (npm run puts it there).
import { execFileSync, spawnSync } from 'node:child_process';
import { error, setOutput, summary } from './lib/actions.mjs';
import { isMain } from './lib/is-main.mjs';

export const MESSAGE = 'chore: rebuild the plugin manifests from plugin.json [skip ci]';
// the commit is the bot's, whatever identity the environment has
const NAME = 'github-actions[bot]';
const EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const BOT = { GIT_AUTHOR_NAME: NAME, GIT_AUTHOR_EMAIL: EMAIL, GIT_COMMITTER_NAME: NAME, GIT_COMMITTER_EMAIL: EMAIL };
const ATTEMPTS = 3;

// The files that `x927 build` reports as written.
export function written(output) {
  return [...output.matchAll(/^wrote (\S.*)$/gm)].map((match) => match[1].trim());
}

function main() {
  const root = process.cwd();
  const branch = process.env.BRANCH || 'main';
  const remote = process.env.REMOTE || 'origin';
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...BOT } });
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const build = spawnSync('x927', ['build', '--all'], { cwd: root, encoding: 'utf8' });
    console.log(`${build.stdout ?? ''}${build.stderr ?? ''}`);
    if (build.status !== 0) {
      error(`x927 build --all failed (exit code ${build.status ?? build.error?.message})`);
      process.exit(1);
    }
    const files = written(build.stdout ?? '');
    if (files.length === 0) {
      console.log('The generated plugin files are up to date.');
      setOutput('rebuilt', attempt > 1);
      return;
    }
    git('add', '--', ...files);
    git('commit', '--quiet', '-m', MESSAGE);
    const push = spawnSync('git', ['push', remote, `HEAD:refs/heads/${branch}`], { cwd: root, encoding: 'utf8' });
    if (push.status === 0) {
      console.log(`Pushed ${git('rev-parse', '--short', 'HEAD').trim()} to ${branch}: ${files.join(', ')}`);
      summary(['## Plugin manifests', '', `Rebuilt from \`plugin.json\` and pushed to \`${branch}\`:`, '', ...files.map((file) => `- \`${file}\``)]);
      setOutput('rebuilt', true);
      return;
    }
    console.log(`The push was refused (attempt ${attempt} of ${ATTEMPTS}): ${(push.stderr ?? '').trim()}`);
    // someone else pushed: take their tip, which already has the commit this run is for
    git('fetch', '--quiet', remote, branch);
    git('reset', '--quiet', '--hard', 'FETCH_HEAD');
  }
  error(`Could not push the rebuilt plugin manifests to ${branch} after ${ATTEMPTS} attempts`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
