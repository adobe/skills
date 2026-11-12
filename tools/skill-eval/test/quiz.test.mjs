import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuizJudgePrompt, parseQuizVerdict, renderQuizMarkdown } from '../lib/quiz.mjs';

test('judge prompt contains question, claim and answer', () => {
  const p = buildQuizJudgePrompt({ question: 'Q?', claim: 'C.', answer: 'A.' });
  for (const s of ['Q?', 'C.', 'A.', '"verdict"']) assert.ok(p.includes(s));
  assert.ok(buildQuizJudgePrompt({ question: 'Q', claim: 'C', answer: '' }).includes('(no answer)'));
});

test('parses the last valid verdict, rejects unknown values', () => {
  assert.deepEqual(parseQuizVerdict('x {"verdict":"unknown"} {"verdict":"Partial","reasoning":"r"}'), { verdict: 'partial', reasoning: 'r' });
  assert.equal(parseQuizVerdict('{"verdict":"maybe"}'), null);
  assert.equal(parseQuizVerdict('nothing'), null);
  assert.equal(parseQuizVerdict(undefined), null);
});

test('renders a markdown table with symbols, repeats and failures', () => {
  const md = renderQuizMarkdown({
    facts: [{ id: 'f1' }, { id: 'f2' }],
    models: ['p/a', 'p/b'],
    labels: { 'p/a': 'a', 'p/b': 'b' },
    cells: {
      f1: { 'p/a': [{ verdict: 'known' }, { verdict: 'partial' }], 'p/b': [{ verdict: 'unknown' }] },
      f2: { 'p/a': [{ error: 'x' }] },
    },
    judge: 'j',
  });
  const lines = md.split('\n');
  assert.equal(lines[0], '| Fact | a | b |');
  assert.equal(lines[2], '| `f1` | ✓~ | ✗ |');
  assert.equal(lines[3], '| `f2` | ! | — |');
  assert.ok(md.includes('Judge: j.'));
});
