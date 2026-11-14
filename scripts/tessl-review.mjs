// Runs the Tessl review of each changed skill and fails if one scores below the threshold
// or can't be reviewed at all. The two are told apart: a review that didn't run is a
// tooling or authentication problem, not a low score.
//   node scripts/tessl-review.mjs <file with one directory per line>
// THRESHOLD (default 80) and WORKSPACE (default adobe) come from the environment.
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { error, group, summary, table } from './lib/actions.mjs';
import { readDirs } from './lib/dirs.mjs';
import { isMain } from './lib/is-main.mjs';

// The overall score in the output of `tessl review run --json`, or null.
export function parseScore(output) {
  const patterns = [
    /"(?:overall_?score|review_?score)"\s*:\s*(\d+)/i,
    /"score"\s*:\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return Number(match[1]);
  }
  const percents = [...output.matchAll(/(\d+)%/g)];
  return percents.length > 0 ? Number(percents.at(-1)[1]) : null;
}

function main() {
  const threshold = process.env.THRESHOLD || '80';
  const workspace = process.env.WORKSPACE || 'adobe';
  const dirs = readDirs(process.argv[2]);
  const rows = [];
  const problems = [];
  const count = { passed: 0, failed: 0, errored: 0 };
  for (const dir of dirs) {
    const name = basename(dir);
    const result = group(`Reviewing ${name}`, () => {
      const run = spawnSync('tessl', ['review', 'run', dir, '--workspace', workspace, '--json', '--threshold', threshold], { encoding: 'utf8' });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      console.log(output);
      return { status: run.status, output };
    });
    const score = parseScore(result.output);
    if (result.status === 0) {
      count.passed += 1;
      rows.push([name, `${score ?? '?'}%`, '✅']);
    } else if (score !== null) {
      count.failed += 1;
      rows.push([name, `${score}%`, '❌']);
      problems.push(`❌ ${name}: ${score}% (below ${threshold}%)`);
    } else {
      error(`Review could not be run for ${name} (tessl exit code ${result.status}) — tooling/auth failure, not a low score`);
      count.errored += 1;
      rows.push([name, 'not run', '⚠️']);
      problems.push(`⚠️ ${name}: review could not be run (exit code ${result.status})`);
    }
  }
  const total = count.passed + count.failed + count.errored;
  if (total === 0) {
    error('No skills were reviewed — expected at least one');
    process.exit(1);
  }
  const bad = count.failed + count.errored;
  rows.push(['**Total**', `**${count.passed}/${total} passed**`, bad === 0 ? '✅' : '❌']);
  const lines = ['## Skill Review', '', ...table(['Skill', 'Score', 'Status'], rows)];
  if (count.errored > 0) {
    lines.push('', `> ⚠️ ${count.errored} skill(s) could not be reviewed because the Tessl CLI did not complete.`, '> This is a tooling or authentication problem, not a quality result.');
  }
  summary(lines);
  console.log(`Total: ${total}, passed: ${count.passed}, failed: ${count.failed}, errored: ${count.errored}`);
  for (const problem of problems) console.log(`  ${problem}`);
  if (count.failed > 0) error(`${count.failed} skill(s) scored below ${threshold}%`);
  if (bad > 0) process.exit(1);
}

if (isMain(import.meta.url)) main();
