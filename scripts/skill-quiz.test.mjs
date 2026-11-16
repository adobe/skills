import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { BEDROCK, SYSTEM, bedrockAsker, factVerdict, markdown, parseGrade, quiz, selectFacts, verdict } from './skill-quiz.mjs';
import { fakeBin, run, tree } from './lib/testing.mjs';

const fact = (id, usedBy = ['skills/one/SKILL.md']) => ({ id, claim: `claim ${id}`, question: `question ${id}?`, used_by: usedBy });

test('the grade is the last JSON object in the answer that has one', () => {
  assert.deepEqual(parseGrade('thinking {"x":1} then {"grade":"Known","why":"w"}'), { grade: 'known', why: 'w' });
  assert.equal(parseGrade('{"grade":"maybe"}'), null);
  assert.equal(parseGrade('no json'), null);
});

test('a model knew a line when every answer knew it, as the review counts it', () => {
  assert.equal(verdict(['known', 'known']), 'redundant');
  assert.equal(verdict(['known', 'unknown']), 'partly known');
  assert.equal(verdict(['partial', 'partial']), 'partly known');
  assert.equal(verdict(['unknown', 'unknown']), 'missed');
  assert.equal(verdict(['known', undefined]), 'failed');
  assert.equal(factVerdict({ a: 'missed', b: 'redundant' }), 'redundant');
  assert.equal(factVerdict({ a: 'missed', b: 'partly known' }), 'partly known');
  assert.equal(factVerdict({ a: 'missed', b: 'missed' }), 'missed');
  assert.equal(factVerdict({ a: 'missed', b: 'failed' }), 'failed');
});

test('--changed keeps the facts about changed files, and names changed skill Markdown no fact covers', () => {
  const facts = [fact('a'), fact('b', ['skills/two/SKILL.md']), fact('c', ['evals/x/task.md'])];
  const changed = ['plugins/p/skills/one/SKILL.md', 'plugins/p/skills/one/references/new.md', 'plugins/q/skills/two/SKILL.md', 'README.md'];
  const { selected, uncovered } = selectFacts(facts, { changed, pluginPath: 'plugins/p' });
  assert.deepEqual(selected.map((entry) => entry.id), ['a']);
  assert.deepEqual(uncovered, ['skills/one/references/new.md']);
  assert.deepEqual(selectFacts(facts, { patterns: ['b*', 'c'] }).selected.map((entry) => entry.id), ['b', 'c']);
});

test('each answer is graded by a model of another vendor, and the table says what to do', async () => {
  const asked = [];
  const ask = async ({ model, system, prompt }) => {
    asked.push({ model, system, prompt });
    if (system === SYSTEM) return `answer of ${model}`;
    return prompt.includes('answer of global.anthropic') ? '{"grade":"known","why":"w"}' : '{"grade":"unknown","why":"w"}';
  };
  const { rows, results } = await quiz({ facts: [fact('a')], models: BEDROCK.models, runs: 2, ask, judgeOf: BEDROCK.judge });
  assert.equal(results.length, 4);
  assert.deepEqual(results.filter((entry) => entry.model.includes('anthropic')).map((entry) => entry.judge), ['global.openai.gpt-6.1-sol', 'global.openai.gpt-6.1-sol']);
  assert.deepEqual(results.filter((entry) => entry.model.includes('openai')).map((entry) => entry.judge), ['global.anthropic.claude-opus-5-5', 'global.anthropic.claude-opus-5-5']);
  assert.ok(asked.filter((entry) => entry.system === SYSTEM).every((entry) => entry.prompt === 'question a?'));
  assert.equal(rows[0].verdict, 'redundant');
  assert.deepEqual(rows[0].marks, { 'global.anthropic.claude-haiku-5-5': '✓✓', 'global.openai.gpt-5.6-luna': '✗✗' });
  assert.match(markdown({ rows, models: BEDROCK.models }), /\| `a` \| ✓✓ \| ✗✗ \| redundant: cut the line \|/);
});

test('a judge without a grade is asked once more, then the ask counts as failed', async () => {
  let grades = 0;
  const ask = async ({ system }) => {
    if (system === SYSTEM) return 'answer';
    grades += 1;
    return 'no grade';
  };
  const { rows, results } = await quiz({ facts: [fact('a')], models: ['m'], runs: 1, ask, judgeOf: () => 'j' });
  assert.equal(grades, 2);
  assert.equal(results[0].error, 'the judge gave no grade');
  assert.equal(rows[0].verdict, 'failed');
});

test('Bedrock is asked as the review asks its baseline: the system prompt, the question, no tools', async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    const status = requests.length === 1 ? 200 : 429;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(status === 200 ? { output: { message: { content: [{ reasoningContent: {} }, { text: ' an answer ' }] } } } : { message: 'slow down' }));
  });
  await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
  t.after(() => server.close());
  const ask = bedrockAsker({ key: 'key-for-tests', endpoint: `http://127.0.0.1:${server.address().port}` });
  assert.equal(await ask({ model: 'global.small-1', system: SYSTEM, prompt: 'How?' }), 'an answer');
  assert.equal(requests[0].url, '/model/global.small-1/converse');
  assert.equal(requests[0].authorization, 'Bearer key-for-tests');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['inferenceConfig', 'messages', 'system']);
  assert.equal(requests[0].body.system[0].text, SYSTEM);
  await assert.rejects(ask({ model: 'm', system: SYSTEM, prompt: 'again' }), /Bedrock answered 429/);
});

test('without credentials the script says what it needs and exits 3', (t) => {
  const root = tree(t, { 'plugins/p/facts.yaml': '' });
  const result = run(t, 'skill-quiz.mjs', ['plugins/p'], { cwd: root });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /AWS_BEARER_TOKEN_BEDROCK/);
});

test('--ask goes through Claude Code with no tools and the review\'s system prompt', (t) => {
  const root = tree(t, { 'plugins/p/plugin.json': '{}' });
  const log = join(root, 'args.txt');
  const path = fakeBin(t, { claude: `for a in "$@"; do printf '%s\\n' "$a"; done >> "${log}"; echo '{"result":"use node -v","is_error":false}'` });
  const result = run(t, 'skill-quiz.mjs', ['plugins/p', '--ask', 'Which Node is active?', '-n', '1'], { cwd: root, env: { PATH: path, ANTHROPIC_API_KEY: 'key-for-tests' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## haiku #1\n\nuse node -v/);
  const args = readFileSync(log, 'utf8').split('\n');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--system-prompt') + 1], SYSTEM);
  assert.equal(args[args.indexOf('-p') + 1], 'Which Node is active?');
  assert.doesNotMatch(result.stdout + result.stderr, /key-for-tests/);
});
