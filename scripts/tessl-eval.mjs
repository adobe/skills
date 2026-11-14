// Starts a Tessl eval for each changed plugin, waits for it, and fails if one fails or
// doesn't finish in time. Writes the links to the runs to a file for the pull request comment.
//   node scripts/tessl-eval.mjs <file with one directory per line> <file for the comment>
// POLL_INTERVAL (default 30) and TIMEOUT (default 900), both in seconds, come from the environment.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { error, group, setOutput, summary, table, warning } from './lib/actions.mjs';
import { readDirs } from './lib/dirs.mjs';
import { isMain } from './lib/is-main.mjs';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const tessl = (args) => spawnSync('tessl', args, { encoding: 'utf8' });

// The status of a run: completed, failed, or unknown while it isn't there yet or its
// answer can't be read. A view that fails for another reason than "not found" is final.
export function statusOf(view) {
  if (view.status !== 0) return /not found/i.test(view.stderr ?? '') ? 'unknown' : 'failed';
  try {
    return JSON.parse(view.stdout).data.attributes.status;
  } catch {
    return 'unknown';
  }
}

async function wait(runId, name, interval, timeout) {
  let status = 'unknown';
  for (let elapsed = interval; elapsed <= timeout; elapsed += interval) {
    await sleep(interval * 1000);
    const view = tessl(['eval', 'view', runId, '--json']);
    if (view.status !== 0) console.log(`  [${name}] tessl eval view exited ${view.status}: ${view.stderr}`);
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
  const rows = [];
  const links = [];
  const count = { passed: 0, failed: 0 };
  const fail = (name, result, detail) => {
    count.failed += 1;
    rows.push([name, result, '❌']);
    console.log(`  ❌ ${name}: ${detail}`);
  };
  for (const dir of readDirs(dirsFile)) {
    const name = basename(dir);
    const run = group(`Evaluating ${name} (${dir})`, () => {
      const started = tessl(['eval', 'run', dir]);
      console.log(`${started.stdout ?? ''}${started.stderr ?? ''}`);
      return started;
    });
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
    const status = await wait(runId, name, interval, timeout);
    if (status === 'completed' || status === 'failed') {
      group(`Eval results for ${name}`, () => spawnSync('tessl', ['eval', 'view', runId], { stdio: 'inherit' }));
    }
    if (status === 'completed') {
      count.passed += 1;
      rows.push([name, 'passed', '✅']);
    } else if (status === 'failed') {
      fail(name, 'failed', 'eval failed');
    } else {
      warning(`Eval for ${name} timed out after ${timeout}s (last status: ${status})`);
      fail(name, 'timeout', `eval timed out after ${timeout}s (last status: ${status})`);
    }
  }
  const total = count.passed + count.failed;
  rows.push(['**Total**', `**${count.passed}/${total} passed**`, count.failed === 0 ? '✅' : '❌']);
  summary(['## Skill Eval', '', ...table(['Plugin', 'Result', 'Status'], rows)]);
  console.log(`Total: ${total}, passed: ${count.passed}, failed: ${count.failed}`);
  setOutput('has_results', links.length > 0);
  if (links.length > 0 && commentFile) writeFileSync(commentFile, `## Tessl Eval Results\n\n${links.join('\n')}\n`);
  if (count.failed > 0) {
    error(`${count.failed} plugin(s) failed evaluation`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) await main();
