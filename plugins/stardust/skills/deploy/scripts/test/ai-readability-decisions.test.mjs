#!/usr/bin/env node
/**
 * ai-readability.mjs `checkExclusions()` (T33.2): an `--exclude-blocks` entry that removed words must
 * carry a decision — an allowlist entry `{ block, exclude: true, reason, fallback: authored |
 * owner-accepted, decision }`. Without one the page FAILs (exit 1); the record is the escape hatch.
 * Pure: the fnbo-shaped gate JSON (one page with an excluded block of 263 words, one with 0) is the
 * fixture; the module's CLI runs behind an isMain guard.
 * Run: node --test skills/deploy/scripts/test/ai-readability-decisions.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExclusions } from '../ai-readability.mjs';

const page = (words, name = 'calculator') => ({
  path: `/tools/${name}`,
  strict: { score: 100, served: 400, rendered: 400, missing: 0 },
  code: { score: 100, served: 400, rendered: 400 - words, excludedWords: words },
  blocks: [
    { block: 'default-content', words: 380, servedGap: 0, excluded: false },
    { block: name, words, servedGap: words, excluded: true, undecided: words > 0 },
    { block: 'footer', words: 60, servedGap: 60, excluded: false },
  ],
});

test('a word-removing exclusion with no allowlist entry is undecided (the fnbo shape: 263 words)', () => {
  const r = checkExclusions(page(263), []);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].block, r[0].words, r[0].decided, r[0].why], ['calculator', 263, false, 'no allowlist entry']);
});

test('an excluded block that removed 0 words is not a decision (fnbo final JSON: excludedWords 0 on every page)', () => {
  assert.deepEqual(checkExclusions(page(0), []), []);
});

test('a complete entry decides it; fallback and decision are carried into the report row', () => {
  const allow = [{ block: 'calculator', exclude: true, reason: 'third-party loan calculator', fallback: 'authored', decision: 'dyn#6' }];
  const r = checkExclusions(page(263), allow);
  assert.deepEqual([r[0].decided, r[0].fallback, r[0].decision, r[0].why], [true, 'authored', 'dyn#6', null]);
  const accepted = checkExclusions(page(263), [{ ...allow[0], fallback: 'owner-accepted' }]);
  assert.equal(accepted[0].decided, true);
});

test('an incomplete entry stays undecided and names the missing field', () => {
  const base = { block: 'calculator', exclude: true, reason: 'r', fallback: 'authored', decision: 'dyn#6' };
  assert.match(checkExclusions(page(10), [{ ...base, reason: undefined }])[0].why, /reason/);
  assert.match(checkExclusions(page(10), [{ ...base, fallback: 'maybe' }])[0].why, /fallback/);
  assert.match(checkExclusions(page(10), [{ ...base, decision: '' }])[0].why, /decision/);
});

test('string entries (block + string) never decide an exclusion; entries name a block, never a page', () => {
  const r = checkExclusions(page(40), [{ block: 'calculator', string: 'Monthly payment', reason: 'runtime value' }]);
  assert.equal(r[0].decided, false);
  const other = checkExclusions(page(40), [{ block: 'widget', exclude: true, reason: 'r', fallback: 'authored', decision: 'd' }]);
  assert.equal(other[0].decided, false, 'a decision for another block does not carry over');
});

test('analyse() removes an excluded block\'s words from the code denominator only when decided (source contract)', () => {
  const src = readFileSync(new URL('../ai-readability.mjs', import.meta.url), 'utf8');
  assert.match(src, /const undecided = excluded && ws\.length > 0 && !decidedExclude\.has\(name\)/, 'undecided flag per block');
  assert.match(src, /if \(excluded && !undecided\) excludedWords \+= ws\.length/, 'only decided exclusions leave the denominator');
  assert.match(src, /if \(undecided\.length\) fail = true/, 'an undecided exclusion fails the page');
  assert.match(src, /routeFromHAR/, '--har replays a recorded vendor session');
});
