import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProblems } from './check-trigger-queries.mjs';
import { expectedSkill, skillsLoaded, streamResult, watcher } from './lib/skill-loads.mjs';
import { delimiter } from 'node:path';
import { commit, fakeBin, run, tree } from './lib/testing.mjs';
import { markdown, parseTriggerSet, summarize } from './lib/triggers.mjs';

const assistant = (...blocks) => JSON.stringify({ type: 'assistant', message: { content: blocks } });
const tool = (name, input) => ({ type: 'tool_use', name, input });
const SKILLS = ['one', 'two'];

test('a set of trigger queries needs a query, a skill and a yes or no for each', () => {
  const set = parseTriggerSet({ queries: [{ query: 'q', should_trigger: true, skill: 'one', note: 'n' }] });
  assert.deepEqual(set.queries, [{ id: 'q1', query: 'q', should_trigger: true, skill: 'one' }]);
  assert.throws(() => parseTriggerSet({ queries: [] }), /no queries/);
  assert.throws(() => parseTriggerSet({ queries: [{ query: 'q', should_trigger: 'yes', skill: 'one' }] }), /true or false/);
  assert.throws(() => parseTriggerSet({ queries: [{ id: 'a', query: 'q', should_trigger: true, skill: 'one' }, { id: 'a', query: 'r', should_trigger: false, skill: 'one' }] }), /the id a twice/);
  assert.throws(() => parseTriggerSet({ fixture: { repoUrl: 'x' }, queries: [{ query: 'q', should_trigger: true, skill: 'one' }] }), /repoUrl and a ref/);
});

test('the check reports sets it cannot read and queries about skills the plugin does not have', (t) => {
  const query = (skill) => ({ query: 'q', should_trigger: true, skill });
  const root = tree(t, {
    'plugins/p/skills/one/SKILL.md': '---\nname: one\n---\n',
    'plugins/p/trigger-queries/one.json': JSON.stringify({ queries: [query('one')] }),
    'plugins/p/trigger-queries/two.json': JSON.stringify({ queries: [query('two')] }),
    'plugins/p/trigger-queries/broken.json': '{',
  });
  assert.deepEqual(findProblems(root).map(({ rule, file }) => `${rule} ${file}`), [
    'unreadable plugins/p/trigger-queries/broken.json',
    'unknown-skill plugins/p/trigger-queries/two.json',
  ]);
  assert.equal(run(t, 'check-trigger-queries.mjs', [], { cwd: root }).status, 1);
});

test('a skill counts as loaded through the Skill tool, with or without its plugin, or by reading its SKILL.md', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    assistant(tool('Read', { file_path: '/repo/README.md' })),
    assistant(tool('Read', { file_path: '/repo/plugins/p/skills/two/SKILL.md' })),
    assistant(tool('Skill', { skill: 'p:one' }), tool('Skill', { skill: 'p:not-ours' })),
    assistant(tool('Read', { file_path: '/elsewhere/skills/one/SKILL.md' })),
    JSON.stringify({ type: 'result', result: 'done', num_turns: 4, total_cost_usd: 0.02, is_error: false }),
  ].join('\n');
  assert.deepEqual(skillsLoaded(stream, SKILLS), ['two', 'one']);
  assert.deepEqual(streamResult(stream), { text: 'done', turns: 4, costUsd: 0.02, failed: false });
  assert.equal(streamResult('not a stream'), null);
});

test('a watcher stops at the first skill or the first write, unless told to keep going', () => {
  const skill = watcher(SKILLS);
  assert.equal(skill.feed(`${assistant(tool('Bash', { command: 'ls' }))}\n`), null);
  assert.equal(skill.feed(`${assistant(tool('Skill', { skill: 'one' }))}\n`), 'skill');
  assert.deepEqual(skill.result(), { loaded: ['one'], order: [{ skill: 'one', turn: 2 }], turns: 2, stopped: 'skill' });
  const write = watcher(SKILLS);
  assert.equal(write.feed(`${assistant(tool('Write', { file_path: '/repo/.claude/skills/one/SKILL.md' }))}\n`), 'write');
  assert.deepEqual(write.result().loaded, [], 'writing a SKILL.md is not loading it');
  const going = watcher(SKILLS, { keepGoing: true });
  const half = assistant(tool('Skill', { skill: 'one' }));
  assert.equal(going.feed(half.slice(0, 10)), null);
  assert.equal(going.feed(`${half.slice(10)}\n${assistant(tool('Write', {}))}\n`), null);
  assert.deepEqual(going.result().loaded, ['one']);
});

test('a turn is a message of the agent, sent in one event or several; a subagent\'s loads count, its messages are not turns', () => {
  const block = (id, ...content) => JSON.stringify({ type: 'assistant', message: { id, content } });
  const watch = watcher(SKILLS, { keepGoing: true });
  watch.feed([
    block('m1', { type: 'thinking', thinking: '…' }),
    block('m1', { type: 'text', text: 'Let me look.' }),
    block('m1', tool('Skill', { skill: 'p:one' })),
    JSON.stringify({ type: 'assistant', parent_tool_use_id: 't1', message: { id: 's1', content: [tool('Skill', { skill: 'two' })] } }),
    block('m2', tool('Grep', { path: '/repo/plugins/p/skills/two/SKILL.md' })),
    '',
  ].join('\n'));
  assert.deepEqual(watch.result(), { loaded: ['one', 'two'], order: [{ skill: 'one', turn: 1 }, { skill: 'two', turn: 1 }], turns: 2, stopped: 'finished' });
});

test('a scenario tests the skill with the longest name it starts with', () => {
  const skills = ['aem-cli', 'aem-cli-extra', 'da-content'];
  assert.equal(expectedSkill('aem-cli-worktree-port', skills), 'aem-cli');
  assert.equal(expectedSkill('aem-cli-extra-case', skills), 'aem-cli-extra');
  assert.equal(expectedSkill('da-content', skills), 'da-content');
  assert.equal(expectedSkill('other', skills), null);
});

test('the summary counts a query as loading its skill when half its runs did', () => {
  const queries = [
    { id: 'y1', query: 'build a block', should_trigger: true, skill: 'one' },
    { id: 'n1', query: 'review a PR', should_trigger: false, skill: 'one' },
  ];
  const runs = [
    { query: 'y1', loaded: ['one'] }, { query: 'y1', loaded: [] }, { query: 'y1', loaded: ['two'] }, { query: 'y1', error: 'timed out', loaded: [] },
    { query: 'n1', loaded: ['two'] }, { query: 'n1', loaded: ['two'] },
  ];
  const summary = summarize(queries, runs);
  assert.deepEqual(summary.rows.map(({ id, runs: n, rate, loaded, instead }) => ({ id, n, rate, loaded, instead })), [
    { id: 'y1', n: 3, rate: 1 / 3, loaded: false, instead: { two: 1 } },
    { id: 'n1', n: 2, rate: 0, loaded: false, instead: { two: 2 } },
  ]);
  assert.deepEqual(summary.skills, [{ skill: 'one', tp: 0, fn: 1, fp: 0, tn: 1, precision: null, recall: 0 }]);
  assert.match(markdown(summary), /\| y1: build a block \| yes \| 33% ✗ \| two ×1 \|/);
});

// A stand-in for Claude Code that loads the skill a query names, or writes a file.
const claudeScript = (log) => `for a in "$@"; do last="$a"; done
prompt=$(printf '%s' "$*")
echo "$@" >> "${log}"
echo '{"type":"system","subtype":"init"}'
case "$prompt" in
  *"load one"*) echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"p:one"}}]}}' ;;
  *) echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"x"}}]}}' ;;
esac
sleep 5
echo '{"type":"result","result":"done","num_turns":1}'`;

test('the runner runs each query n times in Claude Code with the plugin, stops early, and reports the loads', (t) => {
  const upstream = tree(t, { 'README.md': 'site' });
  commit(upstream);
  const root = tree(t, {
    'plugins/p/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
    'plugins/p/skills/one/SKILL.md': '---\nname: one\ndescription: d\n---\n',
    'plugins/p/trigger-queries/one.json': JSON.stringify({
      fixture: { repoUrl: upstream, ref: 'HEAD' },
      queries: [
        { id: 'y1', query: 'please load one', should_trigger: true, skill: 'one' },
        { id: 'n1', query: 'something else', should_trigger: false, skill: 'one' },
      ],
    }),
  });
  const log = join(root, 'args.log');
  const bin = fakeBin(t, { claude: claudeScript(log) }).split(delimiter)[0];
  const started = Date.now();
  const result = run(t, 'skill-trigger.mjs', ['--plugin', 'plugins/p', '--queries', 'plugins/p/trigger-queries/one.json', '-n', '2', '--bin', bin, '--json', join(root, 'out', 'r.json')], {
    cwd: root, env: { ANTHROPIC_API_KEY: 'key-for-tests' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(Date.now() - started < 4000, 'runs were stopped as soon as they loaded a skill or wrote');
  const report = JSON.parse(readFileSync(join(root, 'out', 'r.json'), 'utf8'));
  assert.deepEqual(report.summary.skills, [{ skill: 'one', tp: 1, fn: 0, fp: 0, tn: 1, precision: 1, recall: 1 }]);
  assert.deepEqual(report.results.filter((entry) => entry.query === 'n1').map((entry) => entry.stopped), ['write', 'write']);
  const args = readFileSync(log, 'utf8');
  assert.match(args, /--output-format stream-json --verbose/);
  assert.match(args, /--plugin-dir \S+\/plugins\/p/);
  assert.doesNotMatch(result.stdout + result.stderr, /key-for-tests/);
});

test('the runner says what it needs without credentials, and exits 3', (t) => {
  const root = tree(t, {
    'plugins/p/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
    'plugins/p/skills/one/SKILL.md': '---\nname: one\n---\n',
    'plugins/p/trigger-queries/one.json': JSON.stringify({ queries: [{ query: 'q', should_trigger: true, skill: 'one' }] }),
  });
  const bin = fakeBin(t, { claude: 'exit 0' }).split(delimiter)[0];
  const result = run(t, 'skill-trigger.mjs', ['--plugin', 'plugins/p', '--queries', 'plugins/p/trigger-queries/one.json', '--bin', bin], { cwd: root });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /AWS_BEARER_TOKEN_BEDROCK/);
});

test('a run that leaves a process behind holding the pipes ends when Claude Code exits', (t) => {
  const root = tree(t, {
    'plugins/p/plugin.json': JSON.stringify({ name: 'p', version: '1.0.0' }),
    'plugins/p/skills/one/SKILL.md': '---\nname: one\ndescription: d\n---\n',
    'plugins/p/trigger-queries/one.json': JSON.stringify({ queries: [{ id: 'q', query: 'q', should_trigger: false, skill: 'one' }] }),
  });
  const bin = fakeBin(t, { claude: `(trap '' TERM; sleep 30) &\necho '{"type":"result","result":"done","num_turns":1}'\nexit 0` }).split(delimiter)[0];
  const started = Date.now();
  const result = run(t, 'skill-trigger.mjs', ['--plugin', 'plugins/p', '--queries', 'plugins/p/trigger-queries/one.json', '-n', '1', '--timeout', '20', '--bin', bin], { cwd: root, env: { ANTHROPIC_API_KEY: 'k' } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 10000, 'the run did not wait for the process it left behind');
  assert.match(result.stderr, /q #1: none \(finished\)/);
});
