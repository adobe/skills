// Starts a Tessl eval for each changed plugin, waits for it, and fails if one fails or
// doesn't finish in time. Writes the links to the runs to a file for the pull request comment.
//   node scripts/tessl-eval.mjs <file with one directory per line> <file for the comment>
// POLL_INTERVAL (default 30) and TIMEOUT (default 900), both in seconds, come from the environment;
// TIMEOUT is the wait for one plugin. TOTAL_TIMEOUT (seconds, default none) is the budget of all
// the waits together: a wait gets at most what is left of it, and a plugin is not started once it
// is spent, because a run that nobody waits for spends credits for no result here.
//
// An organization without credits is not a failed eval: nothing ran. Those plugins count as
// skipped and don't fail the run. Each plugin is still asked: the answer costs nothing, and
// what the CLI checks before the credits (the Tessl project, the fixtures) shows up for every
// plugin. The step output `outcome` is `failed`, `no-credits` or `passed`, in that order of
// precedence.
//
// The CLI packs a commit fixture with `git archive` from the local repository, also one with a
// repoUrl of another repository. Such a commit is fetched from its repoUrl first.
//
// Each run is saved to the plugin's Tessl project (lib/tessl-project.mjs): a plugin of ours
// without one gets it before its run. A plugin brought in from another repository without a
// tessl.json of its own is not evaluated and doesn't fail the run: its owners decide.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { error, group, setOutput, summary, table, warning } from './lib/actions.mjs';
import { readDirs } from './lib/dirs.mjs';
import { isMain } from './lib/is-main.mjs';
import { outOfCredits } from './lib/tessl.mjs';
import { ensureProject, notOurs, originUri, tesslApi } from './lib/tessl-project.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
// `eval view --json` of a plugin with many scenarios is several MB: above spawnSync's
// default buffer of 1 MB, the answer is cut off and the status is null (ENOBUFS).
const tessl = (args) => spawnSync('tessl', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// The status of a run: completed, failed, or unknown while it isn't there yet or its
// answer can't be read, also when the view itself could not be run or read to its end.
// A view that exits with an error other than "not found" is final.
export function statusOf(view) {
  if (view.error || view.status === null) return 'unknown';
  if (view.status !== 0) return /not found/i.test(view.stderr ?? '') ? 'unknown' : 'failed';
  try {
    return JSON.parse(view.stdout).data.attributes.status;
  } catch {
    return 'unknown';
  }
}

// The commit fixtures of a plugin's scenarios, as { repoUrl, ref }: a fixture of type commit
// under `fixtures`, or the older single `fixture`, which is a commit fixture without a type.
export function commitFixtures(dir) {
  const found = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(path, entry.name));
      else if (entry.name === 'scenario.json') {
        let scenario;
        try {
          scenario = JSON.parse(readFileSync(join(path, entry.name), 'utf8'));
        } catch {
          continue; // the CLI reports it
        }
        const fixtures = scenario.fixtures ? Object.values(scenario.fixtures) : scenario.fixture ? [{ type: 'commit', ...scenario.fixture }] : [];
        for (const fixture of fixtures) {
          if (fixture?.type === 'commit' && typeof fixture.ref === 'string') found.push({ repoUrl: fixture.repoUrl, ref: fixture.ref });
        }
      }
    }
  };
  visit(join(dir, 'evals'));
  return found;
}

const SHA = /^[0-9a-f]{7,40}$/;

// Fetches the commit fixtures that the local repository lacks from their https repoUrl.
// Only a ref that is a commit SHA is fetched: anything else could be read as a git option
// or a refspec that writes local refs. One that isn't fetched is left to the CLI, which names it.
export function fetchFixtureCommits(dir, git = (args) => spawnSync('git', args, { encoding: 'utf8' })) {
  const seen = new Set();
  for (const { repoUrl, ref } of commitFixtures(dir)) {
    if (seen.has(ref) || !SHA.test(ref)) continue;
    seen.add(ref);
    if (git(['cat-file', '-e', `${ref}^{commit}`]).status === 0) continue;
    if (typeof repoUrl !== 'string' || !repoUrl.startsWith('https://')) continue;
    console.log(`Fetching commit fixture ${ref} from ${repoUrl}`);
    const fetched = git(['fetch', '--quiet', '--no-tags', repoUrl, ref]);
    if (fetched.status !== 0) warning(`Could not fetch commit fixture ${ref} from ${repoUrl}: ${(fetched.stderr ?? '').trim()}`);
  }
}

async function wait(runId, name, interval, timeout) {
  let status = 'unknown';
  for (let elapsed = interval; elapsed <= timeout; elapsed += interval) {
    await sleep(interval * 1000);
    const view = tessl(['eval', 'view', runId, '--json']);
    if (view.status !== 0) console.log(`  [${name}] tessl eval view exited ${view.status}: ${view.error?.code ?? view.stderr}`);
    status = statusOf(view);
    console.log(`  [${name}] Poll at ${elapsed}s: status=${status}`);
    if (status === 'completed' || status === 'failed') break;
  }
  return status;
}

async function main() {
  const [dirsFile, commentFile] = process.argv.slice(2);
  const interval = Number(process.env.POLL_INTERVAL || 30);
  const timeout = Number(process.env.TIMEOUT || 900);
  const deadline = process.env.TOTAL_TIMEOUT ? Date.now() + Number(process.env.TOTAL_TIMEOUT) * 1000 : Infinity;
  const left = () => (deadline - Date.now()) / 1000;
  const rows = [];
  const links = [];
  const count = { passed: 0, failed: 0, skipped: 0, foreign: 0 };
  const token = process.env.TESSL_TOKEN;
  const request = token
    ? tesslApi(token, process.env.TESSL_API_BASE_URL || undefined)
    : async () => {
        throw new Error('TESSL_TOKEN is not set');
      };
  const source = originUri(process.cwd());
  const skip = (name) => {
    count.skipped += 1;
    rows.push([name, 'not run', '⏭️ no credits']);
    console.log(`  ⏭️ ${name}: not run, the Tessl organization has run out of credits`);
  };
  const fail = (name, result, detail) => {
    count.failed += 1;
    rows.push([name, result, '❌']);
    console.log(`  ❌ ${name}: ${detail}`);
  };
  for (const dir of readDirs(dirsFile)) {
    const name = basename(dir);
    if (notOurs(dir) && !existsSync(join(dir, 'tessl.json'))) {
      count.foreign += 1;
      rows.push([name, 'not run', '⏭️ brought in from another repository']);
      console.log(`  ⏭️ ${name}: not run, it is brought in from another repository and has no Tessl project here`);
      continue;
    }
    if (left() < interval) {
      warning(`${name} was not started: the time budget of this step (TOTAL_TIMEOUT) is spent`);
      fail(name, 'not started', 'not started, the time budget of this step is spent');
      continue;
    }
    try {
      const { project, action } = await ensureProject(dir, { request, source });
      console.log(`${name}: Tessl project ${project} (${{ own: 'its own tessl.json', found: 'exists', created: 'created now' }[action]})`);
    } catch (problem) {
      warning(`No Tessl project for ${name}: ${problem.message}`);
      fail(name, 'no project', `no Tessl project: ${problem.message}`);
      continue;
    }
    const run = group(`Evaluating ${name} (${dir})`, () => {
      fetchFixtureCommits(dir);
      const started = tessl(['eval', 'run', dir]);
      console.log(`${started.stdout ?? ''}${started.stderr ?? ''}`);
      return started;
    });
    if (run.status !== 0 && outOfCredits(`${run.stdout ?? ''}${run.stderr ?? ''}`)) {
      skip(name);
      continue;
    }
    if (run.status !== 0) {
      warning(`tessl eval run failed for ${name} (exit code ${run.status})`);
      fail(name, 'error', `eval run failed (exit code ${run.status})`);
      continue;
    }
    const runId = `${run.stdout ?? ''}${run.stderr ?? ''}`.match(UUID)?.[0];
    if (!runId) {
      warning(`Could not extract run ID for ${name}`);
      fail(name, 'no run ID', 'could not extract run ID from output');
      continue;
    }
    console.log(`Eval run started for ${name} with run ID: ${runId}`);
    links.push(`- **${name}**: [View results](https://tessl.io/eval-runs/${runId})`);
    const limit = Math.round(Math.min(timeout, left()) * 100) / 100;
    const status = await wait(runId, name, interval, limit);
    if (status === 'completed' || status === 'failed') {
      group(`Eval results for ${name}`, () => spawnSync('tessl', ['eval', 'view', runId], { stdio: 'inherit' }));
    }
    if (status === 'completed') {
      count.passed += 1;
      rows.push([name, 'passed', '✅']);
    } else if (status === 'failed') {
      fail(name, 'failed', 'eval failed');
    } else {
      warning(`Eval for ${name} timed out after ${limit}s (last status: ${status}); it goes on on Tessl`);
      fail(name, 'timeout', `eval timed out after ${limit}s (last status: ${status})`);
    }
  }
  const total = count.passed + count.failed + count.skipped;
  rows.push(['**Total**', `**${count.passed}/${total} passed**`, count.failed > 0 ? '❌' : count.skipped > 0 ? '⏭️' : '✅']);
  const lines = ['## Skill Eval', '', ...table(['Plugin', 'Result', 'Status'], rows)];
  if (count.skipped > 0) {
    lines.push('', `> ⏭️ ${count.skipped} plugin(s) were not evaluated: the Tessl organization has run out of credits.`, '> This is not an eval result. Ask for the evals again once there are credits.');
    warning(`${count.skipped} plugin(s) were not evaluated: the Tessl organization has run out of credits`);
  }
  if (count.foreign > 0) {
    lines.push('', `> ⏭️ ${count.foreign} plugin(s) were not evaluated: they are brought in from another repository and have no Tessl project here. Their owners decide about their evals.`);
  }
  summary(lines);
  console.log(`Total: ${total}, passed: ${count.passed}, failed: ${count.failed}, skipped: ${count.skipped}, from another repository: ${count.foreign}`);
  setOutput('outcome', count.failed > 0 ? 'failed' : count.skipped > 0 ? 'no-credits' : total > 0 ? 'passed' : '');
  setOutput('has_results', links.length > 0);
  if (links.length > 0 && commentFile) writeFileSync(commentFile, `## Tessl Eval Results\n\n${links.join('\n')}\n`);
  if (count.failed > 0) {
    error(`${count.failed} plugin(s) failed evaluation`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) await main();
