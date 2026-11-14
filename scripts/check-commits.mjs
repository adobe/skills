// At least one commit of a pull request follows Conventional Commits. Pull requests are
// squash-merged under their title, but a branch with one conventional commit shows the
// author knows what the change is.
//   node scripts/check-commits.mjs <base sha> <head sha>
import { execFileSync } from 'node:child_process';
import { isMain } from './lib/is-main.mjs';

const PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9_-]+\))?!?: .+/;

export const isConventional = (subject) => PATTERN.test(subject);

function main() {
  const [base, head] = process.argv.slice(2);
  let log;
  try {
    log = execFileSync('git', ['log', `${base}..${head}`, '--pretty=format:%h %s'], { encoding: 'utf8' });
  } catch (error) {
    console.log(`::error::Failed to retrieve commits: ${error.message.split('\n')[0]}`);
    process.exit(1);
  }
  const commits = log.split('\n').filter(Boolean).map((line) => ({ hash: line.slice(0, line.indexOf(' ')), subject: line.slice(line.indexOf(' ') + 1) }));
  if (commits.length === 0) {
    console.log('No commits found in this PR.');
    process.exit(1);
  }
  for (const { hash, subject } of commits) console.log(`${isConventional(subject) ? '✅' : '❌'} ${hash} ${subject}`);
  if (commits.some(({ subject }) => isConventional(subject))) {
    console.log('\n✅ Pass: at least one commit follows the Conventional Commits format.');
    return;
  }
  console.log('\n❌ Fail: no commits follow the Conventional Commits format. At least one is required. Please use: type(scope): description');
  process.exit(1);
}

if (isMain(import.meta.url)) main();
