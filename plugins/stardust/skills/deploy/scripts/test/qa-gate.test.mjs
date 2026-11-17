#!/usr/bin/env node
// skills/deploy/scripts/test/qa-gate.test.mjs — the pure part of qa-gate.mjs (checkUnits: each schema repeat
// group held to its own block instance, found by ORDER among the non-chrome sections, never by section name)
// and --help. No browser, no network: the rendered block measurements are plain objects.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkUnits } from '../qa-gate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-gate.mjs');

// A rendered block as the page evaluation measures it.
const inst = (name, unitCount = 0, extra = {}) => ({
  name, unitCount, headingUnits: 0, tagCounts: {}, ...extra,
});
const rep = (count, unitSelector = '') => ({ count, unitSelector });
const lines = (found, kind) => found.filter((f) => f.kind === kind).map((f) => f.text);

// A reskin page: every section is `class="m m-<module>"`, so section-schema names every one of them "m".
const SAME_NAME = {
  sections: [
    { section: 'header' },
    { section: 'm', repeats: [] },
    { section: 'm', repeats: [rep(3, 'article.card')] },
    { section: 'm', repeats: [] },
    { section: 'm', repeats: [rep(4, 'li.tab')] },
    { section: 'footer', repeats: [rep(2, 'li')] },
  ],
};

test('sections sharing one name: each repeat group is checked against the block at its own position', () => {
  // positions 1 and 3 among the non-chrome sections; the hero (0) and the plain section (2) hold no units
  const instances = [inst('hero', 0), inst('cards', 3), inst('text', 0), inst('tabs', 4)];
  const found = checkUnits(SAME_NAME, instances);
  assert.deepEqual(lines(found, 'fail'), []);
  const ok = lines(found, 'ok');
  assert.equal(ok.length, 2);
  assert.match(ok[0], /^units: "m" #2 → block cards renders ≥3 — rendered 3 /);
  assert.match(ok[1], /^units: "m" #4 → block tabs renders ≥4 — rendered 4 /);
});

test('a short block fails against its own instance, not against the hero', () => {
  const instances = [inst('hero', 9), inst('cards', 3), inst('text', 0), inst('tabs', 2)];
  const found = checkUnits(SAME_NAME, instances);
  const fail = lines(found, 'fail');
  assert.equal(fail.length, 1);
  assert.match(fail[0], /^units: "m" #4 → block tabs renders ≥4 — rendered 2 /);
  assert.equal(lines(found, 'ok').length, 1);
});

test('distinct names resolve to the same positions as shared ones', () => {
  const named = {
    sections: SAME_NAME.sections.map((s, i) => (['header', 'footer'].includes(s.section) ? s : { ...s, section: `s${i}` })),
  };
  const instances = [inst('hero', 0), inst('cards', 3), inst('text', 0), inst('tabs', 4)];
  const found = checkUnits(named, instances);
  assert.deepEqual(lines(found, 'fail'), []);
  assert.deepEqual(lines(found, 'ok').map((t) => t.match(/→ block (\w+)/)[1]), ['cards', 'tabs']);
});

test('the unit count is the densest of grid kids, unit headings and the unitSelector tag', () => {
  const schema = { sections: [{ section: 'm', repeats: [rep(5, 'article.card')] }] };
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { tagCounts: { article: 5 } })]), 'ok').length, 1);
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { headingUnits: 5 })]), 'ok').length, 1);
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { tagCounts: { li: 9 } })]), 'fail').length, 1);
});

test('a repeat group with no block at its position, or in chrome, warns instead of checking another block', () => {
  const found = checkUnits(SAME_NAME, [inst('hero', 0), inst('cards', 3)]);
  assert.deepEqual(lines(found, 'warn'), [
    'schema section "m" (repeats) has no matching page block by order — verify manually',
    'schema section "footer" (repeats) has no matching page block by order — verify manually',
  ]);
  assert.equal(lines(found, 'ok').length, 1);
});

test('groups below 2 units and a schema without sections check nothing', () => {
  assert.deepEqual(checkUnits({ sections: [{ section: 'm', repeats: [rep(1)] }] }, [inst('x')]), []);
  assert.deepEqual(checkUnits(null, []), []);
  assert.deepEqual(checkUnits({}, []), []);
});

test('--help: exit 0 and the usage header, before any browser or file work', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skills\/deploy\/scripts\/qa-gate\.mjs — the stock Local-QA assertion gate/);
  assert.match(r.stdout, /matched by ORDER among\s+the non-chrome/);
  assert.equal(r.stderr, '');
});
