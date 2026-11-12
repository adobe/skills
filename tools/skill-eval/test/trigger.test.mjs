import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWatcher, parseQuerySet, renderTriggerMarkdown, summarizeTriggers, timeoutMs } from '../lib/trigger.mjs';

const skills = [
  { name: 'building-blocks', dir: '/p/.agents/skills/building-blocks', header: ['---', 'name: building-blocks', 'description: x'], signature: [] },
  { name: 'content-driven-development', dir: '/p/.agents/skills/content-driven-development', header: ['---', 'name: cdd', 'description: y'], signature: [] },
];
const line = (o) => `${JSON.stringify(o)}\n`;
const assistant = (...content) => line({ type: 'message_end', message: { role: 'assistant', content } });
const call = (name, args) => ({ type: 'toolCall', name, arguments: args });

test('stops when a tool call reads a skill dir, even across chunk splits', () => {
  const w = createWatcher(skills);
  const text = assistant(call('read', { path: '/p/.agents/skills/building-blocks/SKILL.md' }));
  assert.equal(w.feed(text.slice(0, 30)), false);
  assert.equal(w.feed(text.slice(30)), true);
  assert.deepEqual(w.result(), { triggered: ['building-blocks'], order: [{ skill: 'building-blocks', turn: 1 }], stopReason: 'skill', turns: 1 });
});

test('detects a skill from tool result content', () => {
  const w = createWatcher(skills);
  const stop = w.feed(line({ type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: '---\nname: cdd\ndescription: y\n' }] } }));
  assert.equal(stop, true);
  assert.deepEqual(w.result().triggered, ['content-driven-development']);
});

test('stops at the first write or edit with nothing triggered', () => {
  const w = createWatcher(skills);
  assert.equal(w.feed(assistant(call('bash', { command: 'ls' }))), false);
  assert.equal(w.feed(assistant(call('write', { path: 'a.js', content: 'x' }))), true);
  assert.deepEqual(w.result(), { triggered: [], order: [], stopReason: 'write', turns: 2 });
});

test('a skill read in the same message as a write still counts as triggered', () => {
  const w = createWatcher(skills);
  w.feed(assistant(call('read', { path: '/p/.agents/skills/content-driven-development/SKILL.md' }), call('write', { path: 'a' })));
  assert.deepEqual(w.result().triggered, ['content-driven-development']);
  assert.equal(w.result().stopReason, 'skill');
});

test('stops after maxTurns', () => {
  const w = createWatcher(skills, { maxTurns: 2 });
  assert.equal(w.feed(assistant(call('bash', { command: 'ls' }))), false);
  assert.equal(w.feed(assistant(call('bash', { command: 'pwd' }))), true);
  assert.equal(w.result().stopReason, 'max-turns');
});

test('finished when never stopped', () => {
  assert.equal(createWatcher(skills).result().stopReason, 'finished');
});

const toolResult = (text) => line({ type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text }] } });

test('keepGoing continues past skills and writes and records the open order with turns', () => {
  const w = createWatcher(skills, { keepGoing: true, maxTurns: 10 });
  assert.equal(w.feed(assistant(call('read', { path: '/p/.agents/skills/content-driven-development/SKILL.md' }))), false);
  assert.equal(w.feed(toolResult('---\nname: cdd\ndescription: y\n')), false);
  assert.equal(w.feed(assistant(call('write', { path: 'a.js', content: 'x' }))), false);
  assert.equal(w.feed(assistant(call('read', { path: '/p/.agents/skills/building-blocks/SKILL.md' }))), false);
  assert.equal(w.feed(assistant(call('read', { path: '/p/.agents/skills/content-driven-development/references/x.md' }))), false);
  assert.deepEqual(w.result(), {
    triggered: ['building-blocks', 'content-driven-development'],
    order: [{ skill: 'content-driven-development', turn: 1 }, { skill: 'building-blocks', turn: 3 }],
    stopReason: 'finished',
    turns: 4,
  });
});

test('keepGoing still stops at maxTurns', () => {
  const w = createWatcher(skills, { keepGoing: true, maxTurns: 2 });
  assert.equal(w.feed(assistant(call('read', { path: '/p/.agents/skills/building-blocks/SKILL.md' }))), false);
  assert.equal(w.feed(assistant(call('write', { path: 'a' }))), true);
  assert.equal(w.result().stopReason, 'max-turns');
  assert.deepEqual(w.result().order, [{ skill: 'building-blocks', turn: 1 }]);
});

test('a skill seen first in a tool result gets the turn that produced it', () => {
  const w = createWatcher(skills, { keepGoing: true });
  w.feed(assistant(call('bash', { command: 'cat SKILL.md' })));
  w.feed(toolResult('---\nname: building-blocks\ndescription: x\n'));
  assert.deepEqual(w.result().order, [{ skill: 'building-blocks', turn: 1 }]);
});

test('one tool call opening several skills records them in read order, not inventory order', () => {
  const w = createWatcher(skills, { keepGoing: true });
  w.feed(assistant(call('bash', { command: 'cat /p/.agents/skills/content-driven-development/SKILL.md /p/.agents/skills/building-blocks/SKILL.md' })));
  assert.deepEqual(w.result().order.map((o) => o.skill), ['content-driven-development', 'building-blocks']);
});

test('one tool result showing several skills records them in text order', () => {
  const w = createWatcher(skills, { keepGoing: true });
  w.feed(assistant(call('bash', { command: 'cat a b' })));
  w.feed(toolResult('---\nname: cdd\ndescription: y\n---\nname: building-blocks\ndescription: x\n'));
  assert.deepEqual(w.result().order.map((o) => o.skill), ['content-driven-development', 'building-blocks']);
});

test('shared header lines do not decide the order of skills in one tool result', () => {
  const hdr = (n) => ['---', `name: ${n}`, 'description: >-'];
  const three = ['appbuilder-ui-scaffolder', 'appbuilder-testing', 'appbuilder-cicd-pipeline'].map((n) => ({ name: n, dir: `/p/.agents/skills/${n}`, header: hdr(n), signature: [] }));
  const w = createWatcher(three, { keepGoing: true });
  w.feed(assistant(call('bash', { command: 'cat a b c' })));
  w.feed(toolResult(['appbuilder-ui-scaffolder', 'appbuilder-testing', 'appbuilder-cicd-pipeline'].map((n) => `---\nname: ${n}\ndescription: >-\n  text\n`).join('')));
  assert.deepEqual(w.result().order.map((o) => o.skill), ['appbuilder-ui-scaffolder', 'appbuilder-testing', 'appbuilder-cicd-pipeline']);
});

test('a skill whose name is a prefix of another is not ordered by the longer name', () => {
  const hdr = (n) => ['---', `name: ${n}`, 'description: >-'];
  const two = ['foo', 'foo-bar'].map((n) => ({ name: n, dir: `/p/.agents/skills/${n}`, header: hdr(n), signature: [] }));
  const w = createWatcher(two, { keepGoing: true });
  w.feed(assistant(call('bash', { command: 'cat a b' })));
  w.feed(toolResult(['foo-bar', 'foo'].map((n) => `---\nname: ${n}\ndescription: >-\n  text\n`).join('')));
  assert.deepEqual(w.result().order.map((o) => o.skill), ['foo-bar', 'foo']);
});

test('timeoutMs accepts finite positive minutes within the timer limit', () => {
  assert.equal(timeoutMs('3'), 180_000);
  assert.equal(timeoutMs('0.5'), 30_000);
  for (const bad of ['0', '-1', 'x', 'Infinity', '1e9']) assert.throws(() => timeoutMs(bad), /--timeout/);
});

test('parseQuerySet validates and defaults ids', () => {
  const s = parseQuerySet({ fixture: { repoUrl: 'u', ref: 'r' }, queries: [{ query: 'q', should_trigger: true, skill: 'a' }, { id: 'x', query: 'q2', should_trigger: false, skill: 'a', split: 'test' }] });
  assert.deepEqual(s.queries.map((q) => q.id), ['q1', 'x']);
  assert.throws(() => parseQuerySet({ queries: [] }), /non-empty/);
  assert.throws(() => parseQuerySet({ queries: [{ query: 'q', skill: 'a' }] }), /should_trigger/);
  assert.throws(() => parseQuerySet({ queries: [{ id: 'a', query: 'q', should_trigger: true, skill: 's' }, { id: 'a', query: 'q', should_trigger: true, skill: 's' }] }), /duplicate/);
  assert.throws(() => parseQuerySet({ queries: [{ query: 'q', should_trigger: true, skill: 's', split: 'x' }] }), /split/);
});

test('summarize: rates per model, precision/recall, fired instead', () => {
  const queries = [
    { id: 'a', query: 'qa', should_trigger: true, skill: 's' },
    { id: 'b', query: 'qb', should_trigger: true, skill: 's' },
    { id: 'c', query: 'qc', should_trigger: false, skill: 's' },
    { id: 'd', query: 'qd', should_trigger: false, skill: 's' },
  ];
  const r = (query, model, triggered, status = 'ok') => ({ query, model, triggered, status });
  const results = [
    r('a', 'm1', ['s']), r('a', 'm1', ['s']), r('a', 'm2', []),
    r('b', 'm1', ['t']), r('b', 'm2', []),
    r('c', 'm1', ['s']), r('c', 'm2', ['s']),
    r('d', 'm1', []), r('d', 'm1', [], 'error'),
  ];
  const { rows, skills: sk } = summarizeTriggers(queries, results);
  assert.equal(rows[0].rate, 2 / 3);
  assert.deepEqual(rows[0].byModel, { m1: 1, m2: 0 });
  assert.equal(rows[0].triggeredHit, true);
  assert.deepEqual(rows[1].instead, { t: 1 });
  assert.equal(rows[3].runs, 1);
  assert.deepEqual(sk[0], { skill: 's', tp: 1, fn: 1, fp: 1, tn: 1, precision: 0.5, recall: 0.5 });
  const md = renderTriggerMarkdown({ summary: { rows, skills: sk }, models: ['m1', 'm2'], labels: { m1: 'one', m2: 'two' }, meta: { name: 'n', variant: 'v', runs: 2 } });
  assert.ok(md.includes('| s | 50% | 50% | 1 | 1 | 1 | 1 |'));
  assert.ok(md.includes('b: qb') && md.includes('t ×1'));
  assert.ok(md.includes('0% ✗'));
});

test('summarize counts the first skill per run; markdown shows it only in keep-going mode', () => {
  const queries = [{ id: 'a', query: 'qa', should_trigger: true, skill: 's' }];
  const r = (order) => ({ query: 'a', model: 'm1', status: 'ok', triggered: order.map((o) => o).sort(), order: order.map((skill, i) => ({ skill, turn: i + 1 })) });
  const summary = summarizeTriggers(queries, [r(['t', 's']), r(['t', 's']), r(['s']), r([]), { query: 'a', model: 'm1', status: 'ok', triggered: ['s'] }]);
  assert.deepEqual(summary.rows[0].first, { t: 2, s: 1, none: 2 });
  assert.equal(summary.rows[0].rate, 4 / 5);
  const meta = { name: 'n', variant: 'v', runs: 5 };
  const plain = renderTriggerMarkdown({ summary, models: ['m1'], labels: {}, meta });
  assert.ok(!plain.includes('First opened'));
  const kg = renderTriggerMarkdown({ summary, models: ['m1'], labels: {}, meta: { ...meta, keepGoing: true, maxTurns: 12 } });
  assert.ok(kg.includes('| Fired instead | First opened |'));
  assert.ok(kg.includes('| t ×2 | t ×2, none ×2, s ×1 |'));
  assert.ok(kg.includes('up to 12 turns'));
});
