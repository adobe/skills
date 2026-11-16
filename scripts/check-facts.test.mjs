import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFacts, checkTriggerSets, findProblems } from './check-facts.mjs';
import { parseFacts, parseTriggerSet } from './lib/facts.mjs';
import { run, tree } from './lib/testing.mjs';

const skill = (name) => `---\nname: ${name}\ndescription: d\n---\nbody\n`;
const fact = ({ id = 'f', source = 'https://example.com/doc', usedBy = ['skills/one/SKILL.md'] } = {}) => [
  `- id: ${id}`,
  '  claim: >-',
  '    The thing is',
  '    configured in x.json.',
  '  question: Where is the thing configured?',
  ...(source ? [`  source: ${source}`] : []),
  ...(usedBy.length ? ['  used_by:', ...usedBy.map((path) => `    - ${path}`)] : ['  used_by: []']),
].join('\n');

const plugin = (files) => ({
  'plugins/p/plugin.json': '{"name":"p"}',
  'plugins/p/skills/one/SKILL.md': skill('one'),
  'plugins/p/evals/one-case/task.md': 'task',
  ...files,
});

test('a fact is read with its block scalars and lists', () => {
  const [entry] = parseFacts(`# comment\n${fact()}\n`);
  assert.deepEqual(entry, {
    id: 'f',
    claim: 'The thing is configured in x.json.',
    question: 'Where is the thing configured?',
    source: 'https://example.com/doc',
    used_by: ['skills/one/SKILL.md'],
  });
});

test('the reader refuses what it does not know, rather than guess', () => {
  assert.throws(() => parseFacts(`${fact()}\n  opinion: yes\n`), /unknown key opinion/);
  assert.throws(() => parseFacts('- id: f\n  claim: c\n  question: q\n  used_by: [a, b]\n'), /one item per line/);
  assert.throws(() => parseFacts('- id: f\n  claim: c\n'), /has no question/);
  assert.throws(() => parseFacts(`${fact()}\n${fact()}\n`), /the id f twice/);
  assert.throws(() => parseFacts('id: f\n'), /syntax/);
});

test('a set of trigger queries needs a query, a skill and a yes or no for each', () => {
  const set = parseTriggerSet({ queries: [{ query: 'q', should_trigger: true, skill: 'one' }] });
  assert.deepEqual(set.queries, [{ id: 'q1', query: 'q', should_trigger: true, skill: 'one' }]);
  assert.throws(() => parseTriggerSet({ queries: [] }), /no queries/);
  assert.throws(() => parseTriggerSet({ queries: [{ query: 'q', should_trigger: 'yes', skill: 'one' }] }), /true or false/);
  assert.throws(() => parseTriggerSet({ fixture: { repoUrl: 'x' }, queries: [{ query: 'q', should_trigger: true, skill: 'one' }] }), /repoUrl and a ref/);
});

test('facts that a skill states, or that an eval tests and a source backs, pass', (t) => {
  const root = tree(t, plugin({
    'plugins/p/facts.yaml': `${fact()}\n${fact({ id: 'g', usedBy: ['evals/one-case/task.md'] })}\n${fact({ id: 'h', source: '' })}\n`,
  }));
  assert.deepEqual(checkFacts(`${root}/plugins/p`, root), []);
});

test('a fact without a consumer, with a missing file, or outside the skills without a source is reported', (t) => {
  const root = tree(t, plugin({
    'plugins/p/facts.yaml': [
      fact({ id: 'orphan', usedBy: [] }),
      fact({ id: 'gone', usedBy: ['skills/two/SKILL.md'] }),
      fact({ id: 'unsourced', source: '', usedBy: ['evals/one-case/task.md'] }),
    ].join('\n'),
  }));
  assert.deepEqual(checkFacts(`${root}/plugins/p`, root).map(({ rule, id }) => `${rule} ${id}`), [
    'no-consumer orphan',
    'missing-file gone',
    'no-source unsourced',
  ]);
});

test('a trigger query about a skill the plugin does not have is reported', (t) => {
  const query = (skillName) => ({ query: 'q', should_trigger: true, skill: skillName });
  const root = tree(t, plugin({
    'plugins/p/trigger-queries/one.json': JSON.stringify({ queries: [query('one')] }),
    'plugins/p/trigger-queries/two.json': JSON.stringify({ queries: [query('two')] }),
    'plugins/p/trigger-queries/broken.json': '{',
  }));
  assert.deepEqual(checkTriggerSets(`${root}/plugins/p`, root).map(({ rule, file }) => `${rule} ${file}`), [
    'unreadable plugins/p/trigger-queries/broken.json',
    'unknown-skill plugins/p/trigger-queries/two.json',
  ]);
});

test('the script finds every plugin with facts or trigger queries, and exits 1 on a problem', (t) => {
  const root = tree(t, {
    ...plugin({ 'plugins/p/facts.yaml': fact() }),
    'plugins/group/q/plugin.json': '{"name":"q"}',
    'plugins/group/q/facts.yaml': fact({ usedBy: [] }),
  });
  assert.deepEqual(findProblems(root).map(({ rule, file }) => `${rule} ${file}`), ['no-consumer plugins/group/q/facts.yaml']);
  const result = run(t, 'check-facts.mjs', [], { cwd: root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /plugins\/group\/q\/facts.yaml: f: no skill states it/);
});

test('the script passes a tree without problems', (t) => {
  const root = tree(t, plugin({ 'plugins/p/facts.yaml': fact() }));
  const result = run(t, 'check-facts.mjs', [], { cwd: root });
  assert.equal(result.status, 0);
});
