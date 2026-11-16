import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFacts, findProblems } from './check-facts.mjs';
import { parseFacts } from './lib/facts.mjs';
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

test('quoted values are decoded, and YAML this reader does not know is refused', () => {
  const one = (line) => parseFacts(`- id: f\n  claim: c\n  question: q\n  ${line}\n`)[0];
  assert.equal(one(`source: 'it''s here'`).source, "it's here");
  assert.equal(one('source: "a \\"b\\""').source, 'a "b"');
  for (const line of ['source: *alias', 'source: &anchor text', 'source: !tag x', 'source: "open', "source: 'open", "source: 'a'b'", 'source: text # comment', 'source: text\t# comment', 'source: # later', 'source: a: b']) {
    assert.throws(() => one(line), /quote it|does not end|escape/, line);
  }
  assert.throws(() => parseFacts('- id: f\n  claim: c\n  question: q\n  used_by:\n    - *alias\n'), /quote it/);
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

test('a path in used_by that leads out of the plugin is refused, and counts for nothing', (t) => {
  const root = tree(t, plugin({
    'CONTRIBUTING.md': 'x',
    'plugins/p/facts.yaml': [
      fact({ id: 'out', source: '', usedBy: ['skills/../../../CONTRIBUTING.md'] }),
      fact({ id: 'back', source: '', usedBy: ['skills\\..\\..\\..\\CONTRIBUTING.md'] }),
      fact({ id: 'mixed', source: '', usedBy: ['skills/..\\../../CONTRIBUTING.md'] }),
    ].join('\n'),
  }));
  const found = checkFacts(`${root}/plugins/p`, root).map(({ rule, id }) => `${rule} ${id}`);
  assert.deepEqual(found, ['missing-file out', 'no-source out', 'missing-file back', 'no-source back', 'missing-file mixed', 'no-source mixed']);
});

test('the script finds every plugin with facts, and exits 1 on a problem', (t) => {
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
