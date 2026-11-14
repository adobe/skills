import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statusOf } from './tessl-eval.mjs';
import { fakeBin, run, tree } from './lib/testing.mjs';

test('a run is completed or failed as it says, unknown while it is not there, failed on any other error', () => {
  const view = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });
  assert.equal(statusOf(view(0, '{"data":{"attributes":{"status":"completed"}}}')), 'completed');
  assert.equal(statusOf(view(0, '{"data":{"attributes":{"status":"running"}}}')), 'running');
  assert.equal(statusOf(view(0, 'not json')), 'unknown');
  assert.equal(statusOf(view(1, '', 'Error: run Not Found')), 'unknown');
  assert.equal(statusOf(view(1, '', 'Error: unauthorized')), 'failed');
});

const ID = { ok: '11111111-1111-4111-8111-111111111111', bad: '22222222-2222-4222-8222-222222222222', slow: '33333333-3333-4333-8333-333333333333' };
// eval run prints a run id by plugin; eval view --json answers by run id. The run of
// "ok" is not found on the first poll and completed on the second.
const TESSL = `echo "$*" >> "$CALLS"
if [ "$1 $2" = "eval run" ]; then
  case "$3" in
    */ok) echo "Started eval run ${ID.ok}" ;;
    */bad) echo "Started eval run ${ID.bad}" ;;
    */slow) echo "Started eval run ${ID.slow}" ;;
    */noid) echo "Started something" ;;
    */refused) echo "no credits" >&2; exit 1 ;;
  esac
elif [ "$4" = "--json" ]; then
  case "$3" in
    ${ID.ok}) if [ -f "$CALLS.seen" ]; then echo '{"data":{"attributes":{"status":"completed"}}}'; else touch "$CALLS.seen"; echo "run not found" >&2; exit 1; fi ;;
    ${ID.bad}) echo '{"data":{"attributes":{"status":"failed"}}}' ;;
    ${ID.slow}) echo '{"data":{"attributes":{"status":"running"}}}' ;;
  esac
fi`;
const env = (t, root) => ({ PATH: fakeBin(t, { tessl: TESSL }), CALLS: join(root, 'calls'), POLL_INTERVAL: '0.01', TIMEOUT: '0.03' });

test('a completed eval passes, after a run that was not there yet on the first poll', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/ok\n' });
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.summary, /\| ok \| passed \| ✅ \|/);
  assert.match(result.output, /has_results=true/);
  assert.equal(readFileSync(join(root, 'comment.md'), 'utf8'), `## Tessl Eval Results\n\n- **ok**: [View results](https://tessl.io/eval-runs/${ID.ok})\n`);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').split('\n').filter((line) => line.includes('--json')).length, 2);
});

test('a failed eval, a timeout, a missing run id and a refused run each fail, with their own result', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/bad\nplugins/slow\nplugins/noid\nplugins/refused\nplugins/ok\n' });
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.summary, /\| bad \| failed \| ❌ \|/);
  assert.match(result.summary, /\| slow \| timeout \| ❌ \|/);
  assert.match(result.summary, /\| noid \| no run ID \| ❌ \|/);
  assert.match(result.summary, /\| refused \| error \| ❌ \|/);
  assert.match(result.summary, /\| ok \| passed \| ✅ \|/);
  assert.match(result.summary, /\*\*1\/5 passed\*\*/);
  const comment = readFileSync(join(root, 'comment.md'), 'utf8');
  assert.match(comment, new RegExp(ID.bad));
  assert.match(comment, new RegExp(ID.slow));
  assert.doesNotMatch(comment, /noid|refused/);
});

test('no run started: no comment file, and has_results is false', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/refused\n' });
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.output, /has_results=false/);
  assert.equal(existsSync(join(root, 'comment.md')), false);
});
