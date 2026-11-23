import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitFixtures, fetchFixtureCommits, statusOf } from './tessl-eval.mjs';
import { ensureProject, notOurs, sourceUri } from './lib/tessl-project.mjs';
import { fakeBin, run, tree, write } from './lib/testing.mjs';

test('a run is completed or failed as it says, unknown while it is not there, failed on any other error', () => {
  const view = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });
  assert.equal(statusOf(view(0, '{"data":{"attributes":{"status":"completed"}}}')), 'completed');
  assert.equal(statusOf(view(0, '{"data":{"attributes":{"status":"running"}}}')), 'running');
  assert.equal(statusOf(view(0, 'not json')), 'unknown');
  assert.equal(statusOf(view(1, '', 'Error: run Not Found')), 'unknown');
  assert.equal(statusOf(view(1, '', 'Error: unauthorized')), 'failed');
  assert.equal(statusOf({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync tessl ENOBUFS'), { code: 'ENOBUFS' }) }), 'unknown');
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
    */refused) echo "not authenticated" >&2; exit 1 ;;
    */broke) echo "✘ Your organization has run out of credits. Upgrade your plan or buy more credits to continue." >&2; exit 1 ;;
  esac
elif [ "$4" = "--json" ]; then
  case "$3" in
    ${ID.ok}) if [ -f "$CALLS.seen" ]; then echo '{"data":{"attributes":{"status":"completed"}}}'; else touch "$CALLS.seen"; echo "run not found" >&2; exit 1; fi ;;
    ${ID.bad}) echo '{"data":{"attributes":{"status":"failed"}}}' ;;
    ${ID.slow}) echo '{"data":{"attributes":{"status":"running"}}}' ;;
  esac
fi`;
// Every plugin of these tests brings its own tessl.json, so no project is looked up.
const plugins = (files) => {
  const all = { ...files };
  for (const list of Object.values(files)) for (const dir of list.split('\n').filter(Boolean)) all[`${dir}/tessl.json`] = '{"name": "adobe/x"}';
  return all;
};
const env = (t, root) => ({ PATH: fakeBin(t, { tessl: TESSL }), CALLS: join(root, 'calls'), POLL_INTERVAL: '0.01', TIMEOUT: '0.03' });

test('a completed eval passes, after a run that was not there yet on the first poll', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/ok\n' }));
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.summary, /\| ok \| passed \| ✅ \|/);
  assert.match(result.output, /has_results=true/);
  assert.equal(readFileSync(join(root, 'comment.md'), 'utf8'), `## Tessl Eval Results\n\n- **ok**: [View results](https://tessl.io/eval-runs/${ID.ok})\n`);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').split('\n').filter((line) => line.includes('--json')).length, 2);
});

test('a failed eval, a timeout, a missing run id and a refused run each fail, with their own result', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/bad\nplugins/slow\nplugins/noid\nplugins/refused\nplugins/ok\n' }));
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
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/refused\n' }));
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.output, /has_results=false/);
  assert.equal(existsSync(join(root, 'comment.md')), false);
});

test('an organization out of credits is skipped, not failed, and every plugin is still asked', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/ok\nplugins/broke\nplugins/other/broke\n' }));
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.output, /^outcome=no-credits$/m);
  assert.match(result.summary, /\| ok \| passed \| ✅ \|/);
  assert.equal(result.summary.match(/\| broke \| not run \| ⏭️ no credits \|/g).length, 2);
  assert.match(result.summary, /2 plugin\(s\) were not evaluated: the Tessl organization has run out of credits/);
  assert.match(result.stdout, /::warning::2 plugin\(s\) were not evaluated/);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').split('\n').filter((line) => line.startsWith('eval run')).length, 3, 'the plugin after the first skip is asked too');
});

test('a setup error after the credits ran out still fails', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/broke\nplugins/refused\n' }));
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 1);
  assert.match(result.output, /^outcome=failed$/m);
  assert.match(result.summary, /\| refused \| error \| ❌ \|/);
});

test('a failed eval before the credits run out still fails; a clean run has the outcome passed', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/bad\nplugins/broke\n', 'clean.txt': 'plugins/ok\n' }));
  const failed = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(failed.status, 1);
  assert.match(failed.output, /^outcome=failed$/m);
  const clean = run(t, 'tessl-eval.mjs', ['clean.txt', 'comment.md'], { cwd: root, env: { ...env(t, root), CALLS: join(root, 'calls-clean') } });
  assert.match(clean.output, /^outcome=passed$/m);
});

test('commit fixtures come from fixtures of type commit and from the older single fixture', (t) => {
  const root = tree(t, {
    'evals/a/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: 'aaa' } }),
    'evals/group/b/scenario.json': JSON.stringify({ fixtures: { c: { type: 'commit', repoUrl: 'https://github.com/o/s.git', ref: 'bbb' }, d: { type: 'directory', path: './x', installPath: 'x' } } }),
    'evals/c/scenario.json': JSON.stringify({ description: 'no fixture' }),
    'evals/d/scenario.json': 'not json',
  });
  assert.deepEqual(commitFixtures(root).sort((x, y) => x.ref.localeCompare(y.ref)), [
    { repoUrl: 'https://github.com/o/r.git', ref: 'aaa' },
    { repoUrl: 'https://github.com/o/s.git', ref: 'bbb' },
  ]);
  assert.deepEqual(commitFixtures(join(root, 'missing')), []);
});

test('a commit fixture the repository lacks is fetched from its https repoUrl, once, and only by SHA', (t) => {
  const missing = 'a'.repeat(40);
  const present = 'b'.repeat(40);
  const root = tree(t, {
    'evals/a/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: missing } }),
    'evals/b/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: missing } }),
    'evals/c/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: present } }),
    'evals/d/scenario.json': JSON.stringify({ fixture: { repoUrl: 'file:///etc', ref: 'c'.repeat(40) } }),
    'evals/e/scenario.json': JSON.stringify({ fixture: { ref: 'd'.repeat(40) } }),
    'evals/f/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: '--upload-pack=touch pwned' } }),
    'evals/g/scenario.json': JSON.stringify({ fixture: { repoUrl: 'https://github.com/o/r.git', ref: 'x:refs/heads/main' } }),
  });
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    return { status: args[0] === 'cat-file' && args[2] !== `${present}^{commit}` ? 1 : 0, stderr: '' };
  };
  fetchFixtureCommits(root, git);
  assert.deepEqual(calls.filter((call) => call.startsWith('fetch')), [`fetch --quiet --no-tags https://github.com/o/r.git ${missing}`]);
  assert.ok(calls.every((call) => !call.includes('pwned') && !call.includes('refs/heads')), calls.join('\n'));
});

test('a plugin brought in from another repository without a tessl.json is skipped, not failed', (t) => {
  const root = tree(t, plugins({ 'dirs.txt': 'plugins/ok\n' }));
  write(root, { 'dirs.txt': 'plugins/ok\nplugins/creative-cloud/run-workflow\nplugins/commerce/app-review\n' });
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: env(t, root) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.output, /^outcome=passed$/m);
  assert.match(result.summary, /\| run-workflow \| not run \| ⏭️ brought in from another repository \|/);
  assert.match(result.summary, /\| app-review \| not run \| ⏭️ brought in from another repository \|/);
  assert.match(result.summary, /2 plugin\(s\) were not evaluated: they are brought in from another repository/);
  assert.equal(readFileSync(join(root, 'calls'), 'utf8').split('\n').filter((line) => line.startsWith('eval run')).length, 1);
});

test('a plugin of ours without a project fails with what is missing, and is not run', (t) => {
  const root = tree(t, { 'dirs.txt': 'plugins/new\n', 'plugins/new/.tessl-plugin/plugin.json': '{"name": "adobe/new"}' });
  const result = run(t, 'tessl-eval.mjs', ['dirs.txt', 'comment.md'], { cwd: root, env: { ...env(t, root), TESSL_TOKEN: '' } });
  assert.equal(result.status, 1);
  assert.match(result.summary, /\| new \| no project \| ❌ \|/);
  assert.match(result.stdout, /No Tessl project for new: /);
  assert.equal(existsSync(join(root, 'calls')), false, 'tessl eval run is not called');
});

test('only plugins of ours are ours: imports and run-workflow, which holds an imported skill, are not', () => {
  assert.equal(notOurs('plugins/web'), false);
  assert.equal(notOurs('plugins/aem/edge-delivery-services'), false);
  assert.equal(notOurs('plugins/creative-cloud/run-workflow'), true);
  assert.equal(notOurs('plugins/creative-cloud/adobe-for-creativity'), true);
  assert.equal(notOurs('plugins/commerce/app-review'), true);
});

test('a git source is named as the CLI names it', () => {
  assert.equal(sourceUri('https://github.com/adobe/skills\n'), 'github.com/adobe/skills');
  assert.equal(sourceUri('https://github.com/adobe/skills.git'), 'github.com/adobe/skills');
  assert.equal(sourceUri('git@github.com:adobe/skills.git'), 'github.com/adobe/skills');
  assert.equal(sourceUri('not a url'), null);
});

// A fake Tessl API: the workspace adobe, and the projects given, by name.
function fakeApi(projects = {}) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push(body ? `${method} ${path} ${JSON.stringify(body)}` : `${method} ${path}`);
    if (method === 'GET' && path === '/v1/workspaces/adobe') return { status: 200, body: { data: { id: 'ws-1', attributes: { name: 'adobe' } } } };
    if (method === 'GET' && path.startsWith('/v1/workspaces/')) return { status: 404, body: { errors: [{ title: 'Not Found' }] } };
    if (method === 'GET' && path.startsWith('/v1/projects?')) {
      const name = new URLSearchParams(path.split('?')[1]).get('filter[name][eq]');
      return { status: 200, body: { data: projects[name] ? [{ id: 'p-1', attributes: { name, ...projects[name] } }] : [] } };
    }
    if (method === 'POST' && path === '/v1/projects') return { status: 201, body: { data: { id: 'p-2', attributes: body } } };
    return { status: 500, body: null };
  };
  return { calls, request };
}
const SOURCE = 'github.com/adobe/skills';

test('a plugin without a project gets one, named and sourced after it, and a tessl.json in the checkout', async (t) => {
  const root = tree(t, { 'plugins/web/.tessl-plugin/plugin.json': '{"name": "adobe/web"}' });
  const api = fakeApi();
  const dir = join(root, 'plugins/web');
  assert.deepEqual(await ensureProject('plugins/web', { request: api.request, source: SOURCE, root }), { project: 'adobe/web', action: 'created' });
  assert.deepEqual(api.calls, [
    'GET /v1/workspaces/adobe',
    'GET /v1/projects?filter%5BworkspaceId%5D%5Beq%5D=ws-1&filter%5Bname%5D%5Beq%5D=web',
    'POST /v1/projects {"workspaceId":"ws-1","name":"web","sourceType":"git","sourceUri":"github.com/adobe/skills","repoSubpath":"plugins/web"}',
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'tessl.json'), 'utf8')), { name: 'adobe/web', mode: 'vendored', dependencies: {} });
});

test('an existing project of the same source is used; one of another source, or a missing workspace, is an error', async (t) => {
  const root = tree(t, {
    'plugins/web/.tessl-plugin/plugin.json': '{"name": "adobe/web"}',
    'plugins/stardust/.tessl-plugin/plugin.json': '{"name": "adobe/stardust"}',
    'plugins/other/.tessl-plugin/plugin.json': '{"name": "elsewhere/other"}',
    'plugins/own/tessl.json': '{"name": "adobe/own-project"}',
  });
  const api = fakeApi({ web: { sourceType: 'git', sourceUri: SOURCE, repoSubpath: 'plugins/web' }, stardust: { sourceType: 'git', sourceUri: 'github.com/someone/else', repoSubpath: '' } });
  assert.deepEqual(await ensureProject('plugins/web', { request: api.request, source: SOURCE, root }), { project: 'adobe/web', action: 'found' });
  assert.ok(!api.calls.some((call) => call.startsWith('POST')), 'nothing is created');
  await assert.rejects(ensureProject('plugins/stardust', { request: api.request, source: SOURCE, root }), /exists with the source git github.com\/someone\/else \(root\)/);
  assert.equal(existsSync(join(root, 'plugins/stardust/tessl.json')), false);
  await assert.rejects(ensureProject('plugins/other', { request: api.request, source: SOURCE, root }), /workspace elsewhere: HTTP 404, Not Found/);
  assert.deepEqual(await ensureProject('plugins/own', { request: api.request, source: SOURCE, root }), { project: 'adobe/own-project', action: 'own' });
});
