import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildJudgePrompt, findJsonObjects, judgeCommands, judgeOutcome, parseJudgeResponse } from '../lib/judge.mjs';

const criteria = {
  context: 'ctx',
  type: 'weighted_checklist',
  checklist: [
    { name: 'Has A', max_score: 30, description: 'does A' },
    { name: 'no_b', max_score: 20, category: 'MUST_NOT', description: 'does not do B' },
    { name: 'Has C', max_score: 50, description: 'does C' },
  ],
};

test('scores partial credit, clamps, matches names case-insensitively', () => {
  const text = `Here you go:\n${JSON.stringify({
    checks: [
      { name: 'has a', score: 15, reasoning: 'half' },
      { name: 'no_b', score: 99, reasoning: 'over max' },
      { name: 'Has C', score: -5, reasoning: 'negative' },
    ],
  })}`;
  const r = parseJudgeResponse(text, criteria);
  assert.deepEqual(r.checks.map((c) => c.score), [15, 20, 0]);
  assert.equal(r.total, 35);
  assert.equal(r.max, 100);
  assert.equal(r.pct, 35);
});

test('missing items score zero and are flagged; last JSON with checks wins', () => {
  const text = `{"note":"x"} {"checks":[{"name":"Has A","score":1}]} {"checks":[{"name":"Has A","score":30},{"name":"no_b","score":20}]}`;
  const r = parseJudgeResponse(text, criteria);
  assert.equal(r.checks[0].score, 30);
  assert.equal(r.checks[2].missing, true);
  assert.equal(r.pct, 50);
});

test('returns null when no parseable checks', () => {
  assert.equal(parseJudgeResponse('no json here', criteria), null);
  assert.equal(parseJudgeResponse('{"checks": nope}', criteria), null);
});

test('judgeOutcome rejects scores from judge sessions that failed', () => {
  const json = JSON.stringify({ checks: [{ name: 'Has A', score: 30 }, { name: 'no_b', score: 20 }, { name: 'Has C', score: 50 }] });
  const ok = { exitCode: 0, timedOut: false };
  const session = { finalAnswer: json, errors: [], aborted: false, turns: 2 };

  assert.equal(judgeOutcome(ok, session, criteria).score.pct, 100);
  assert.match(judgeOutcome({ exitCode: null, timedOut: true }, session, criteria).error, /timed out/);
  assert.match(judgeOutcome({ exitCode: 1, timedOut: false }, session, criteria).error, /exited 1/);
  assert.match(judgeOutcome(ok, { ...session, errors: ['rate limited'] }, criteria).error, /rate limited/);
  assert.match(judgeOutcome(ok, { ...session, aborted: true }, criteria).error, /aborted/);
  assert.match(judgeOutcome(ok, { ...session, finalAnswer: 'nope' }, criteria).error, /no parseable scores/);
});

test('findJsonObjects handles braces inside strings', () => {
  assert.deepEqual(findJsonObjects('a {"x":"}{"} b {"y":1}'), ['{"x":"}{"}', '{"y":1}']);
});

test('judge commands come from bash tool calls when the scenario opts in', () => {
  const calls = [
    { name: 'read', arguments: { path: 'a' } },
    { name: 'bash', arguments: { command: 'aem up --no-open' } },
    { name: 'bash', arguments: {} },
  ];
  assert.deepEqual(judgeCommands({ config: { judge: { commands: true } } }, calls), ['aem up --no-open']);
  assert.equal(judgeCommands({ config: {} }, calls), undefined);
});

test('judge prompt lists shell commands only when given', () => {
  const changes = { files: [], diff: '', truncated: false };
  const commands = ['aem up --no-open', 'curl -s http://localhost:3665/drafts/stats'];
  const p = buildJudgePrompt({ task: 't', criteria, finalAnswer: 'a', changes, fileCount: 1, commands });
  assert.ok(p.includes('## Shell commands the agent ran'));
  assert.ok(p.includes('aem up --no-open') && p.includes('localhost:3665'));
  const none = buildJudgePrompt({ task: 't', criteria, finalAnswer: 'a', changes, fileCount: 1, commands: [] });
  assert.ok(none.includes('The agent ran no shell commands'));
  const off = buildJudgePrompt({ task: 't', criteria, finalAnswer: 'a', changes, fileCount: 1 });
  assert.ok(!off.includes('Shell commands'));
  const long = buildJudgePrompt({ task: 't', criteria, finalAnswer: 'a', changes, fileCount: 1, commands: ['x'.repeat(30000), 'tail-cmd'] });
  assert.ok(long.includes('truncated') && long.length < 25000);
});

test('judge prompt carries task, context, checklist, answer and the agent changes', () => {
  const changes = {
    files: [{ status: 'M', path: 'blocks/a/a.css' }, { status: 'A', path: 'b/c.js' }],
    diff: 'diff --git a/blocks/a/a.css b/blocks/a/a.css\n-old\n+new\n',
    truncated: true,
  };
  const p = buildJudgePrompt({ task: 'TASK', criteria, finalAnswer: 'ANSWER', changes, fileCount: 57 });
  for (const s of ['TASK', 'ctx', '"no_b"', 'MUST_NOT', 'ANSWER', 'M blocks/a/a.css', 'A b/c.js', '+new', 'truncated', '57 files']) assert.ok(p.includes(s), s);
  const empty = buildJudgePrompt({ task: 't', criteria: { checklist: [] }, finalAnswer: '', changes: { files: [], diff: '', truncated: false }, fileCount: 3 });
  assert.ok(empty.includes('(no final answer)'));
  assert.ok(empty.includes('The agent did not change any files'));
  const legacy = buildJudgePrompt({ task: 't', criteria, finalAnswer: 'a', changes: null, files: ['x.css', 'y.js'], fileCount: 2 });
  assert.ok(legacy.includes('## Files in the working directory') && legacy.includes('y.js'));
  assert.ok(!legacy.includes('## Changes the agent made'));
});
