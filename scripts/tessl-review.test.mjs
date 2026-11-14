import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScore } from './tessl-review.mjs';
import { fakeBin, run, tree } from './lib/testing.mjs';

test('the score is the overall score, then any score, then the last percentage', () => {
  assert.equal(parseScore('{"skill":{"score": 40},"overall_score": 91}'), 91);
  assert.equal(parseScore('{"reviewScore":77}'), 77);
  assert.equal(parseScore('{"score": 64}'), 64);
  assert.equal(parseScore('content 50%\nactivation 80%\noverall 72%'), 72);
  assert.equal(parseScore('error: not authenticated'), null);
});

// tessl answers by the name of the skill directory
const TESSL = `echo "$*" >> "$CALLS"
case "$3" in
  */good) echo '{"overall_score": 92}' ;;
  */low) echo '{"overall_score": 61}'; exit 1 ;;
  */broken) echo 'error: not authenticated' >&2; exit 2 ;;
esac`;
const env = (t, root) => ({ PATH: fakeBin(t, { tessl: TESSL }), CALLS: join(root, 'calls') });

test('a skill at or above the threshold passes, with the workspace and threshold handed to tessl', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/a/skills/good\n' });
  const result = run(t, 'tessl-review.mjs', ['dirs.txt'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8'), 'review run plugins/a/skills/good --workspace adobe --json --threshold 80\n');
  assert.match(result.summary, /\| good \| 92% \| ✅ \|/);
  assert.match(result.summary, /\*\*1\/1 passed\*\*/);
});

test('a low score and a review that could not run both fail, and are told apart', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/a/skills/low\nplugins/a/skills/broken\nplugins/a/skills/good\n' });
  const result = run(t, 'tessl-review.mjs', ['dirs.txt'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.summary, /\| low \| 61% \| ❌ \|/);
  assert.match(result.summary, /\| broken \| not run \| ⚠️ \|/);
  assert.match(result.summary, /\| good \| 92% \| ✅ \|/);
  assert.match(result.summary, /\*\*1\/3 passed\*\*/);
  assert.match(result.summary, /tooling or authentication problem, not a quality result/);
  assert.match(result.stdout, /::error::1 skill\(s\) scored below 80%/);
  assert.match(result.stdout, /::error::Review could not be run for broken \(tessl exit code 2\)/);
});

test('THRESHOLD and WORKSPACE change what tessl is asked', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/a/skills/good\n' });
  run(t, 'tessl-review.mjs', ['dirs.txt'], { cwd: root, env: { ...env(t, root), THRESHOLD: '90', WORKSPACE: 'other' } });
  assert.equal(readFileSync(join(root, 'calls'), 'utf8'), 'review run plugins/a/skills/good --workspace other --json --threshold 90\n');
});

test('no skill to review is a failure', (t) => {
  const root = tree(t, { 'dirs.txt': '\n' });
  const result = run(t, 'tessl-review.mjs', ['dirs.txt'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /No skills were reviewed/);
});
