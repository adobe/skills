import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFacts } from '../lib/facts.mjs';

const sample = `# header comment
- id: a
  claim: >-
    first line
    second line
  question: Where?
  source: aem-boilerplate 5cea543, x
  used_by:
    - evals/one
    - skills/two/SKILL.md

- id: b
  claim: "quoted: value"
  question: >-
    Q
    more
  used_by: []
`;

test('parses ids, folded and plain scalars, lists and empty lists', () => {
  const [a, b] = parseFacts(sample);
  assert.equal(a.id, 'a');
  assert.equal(a.claim, 'first line second line');
  assert.equal(a.question, 'Where?');
  assert.equal(a.source, 'aem-boilerplate 5cea543, x');
  assert.deepEqual(a.used_by, ['evals/one', 'skills/two/SKILL.md']);
  assert.equal(b.claim, 'quoted: value');
  assert.equal(b.question, 'Q more');
  assert.deepEqual(b.used_by, []);
});

test('literal block keeps newlines', () => {
  const [f] = parseFacts('- id: a\n  claim: |\n    one\n    two\n  question: q\n');
  assert.equal(f.claim, 'one\ntwo');
});

test('rejects missing required keys, duplicates and unsupported syntax', () => {
  assert.throws(() => parseFacts('- id: a\n  claim: c\n'), /needs a non-empty question/);
  assert.throws(() => parseFacts('- id: a\n  claim: c\n  question: q\n- id: a\n  claim: c\n  question: q\n'), /duplicate fact id a/);
  assert.throws(() => parseFacts('- id: a\n  claim: [x, y]\n  question: q\n'), /flow collections/);
  assert.throws(() => parseFacts('id: a\n'), /expected a "- id:"|unsupported/);
  assert.throws(() => parseFacts('- id: a\n  claim: c\n  claim: d\n  question: q\n'), /duplicate key claim/);
});
