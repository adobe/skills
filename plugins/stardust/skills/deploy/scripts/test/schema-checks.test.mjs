#!/usr/bin/env node
/**
 * schema-checks.mjs — the pure judgements behind qa-gate.mjs `generic-with-structure` (T28.4) and `h1Section`
 * (T21.2), plus ai-readability.mjs `verdict()` (T33.1). No browser: the facts are fixture JSON, the judgement
 * is what the test pins. The BLOCKING branches (a prose section with a tab strip → FAIL; a moved <h1> with an
 * auto-block → FAIL; an all-unmeasured readability run → exit 2, never 0) each have a case, and the escapes
 * (recorded `defaultContent.reason` / `dynamicsRow` → warn; no auto-blocks → warn) too.
 * Run: node --test skills/deploy/scripts/test/schema-checks.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagGenericWithStructure, h1SectionVerdict, hasStructure, defaultContentOf, INTERACTIVE_SELECTORS, MUSTACHE_MARKER } from '../schema-checks.mjs';
import { verdict } from '../ai-readability.mjs';

const sec = (section, defaultContent, structure, extra = {}) => ({ section, items: [], repeats: [], editableTexts: 1, ...(defaultContent === undefined ? {} : { defaultContent }), structure, ...extra });
const prose = { interactive: [], columns: 1 };
const tabs = { interactive: ['[role=tablist]', '[aria-controls]'], columns: 1 };
const cols = { interactive: [], columns: 2 };

test('generic-with-structure: default-content sections with interactive descendants or ≥ 2 columns are flagged; prose and block sections are not', () => {
  const schema = { sections: [sec('intro', true, prose), sec('compare-plans', true, cols), sec('tabs-band', true, tabs), sec('cards', undefined, cols), sec('legacy', false, tabs)] };
  const flagged = flagGenericWithStructure(schema);
  assert.deepEqual(flagged.map((f) => [f.section, f.facts, f.reason, f.dynamicsRow]), [
    ['compare-plans', 'interactive=[] columns=2', null, null],
    ['tabs-band', 'interactive=[[role=tablist] [aria-controls]] columns=1', null, null],
  ]);
  assert.equal(hasStructure(prose), false); assert.equal(hasStructure(tabs), true); assert.equal(hasStructure(cols), true);
  assert.equal(hasStructure(undefined), false, 'a schema written before structure facts existed flags nothing');
  assert.equal(hasStructure({ interactive: [], columns: '2' }), true, 'a numeric string counts');
});

test('generic-with-structure: the recorded object form carries reason / dynamicsRow (the escape qa-gate prints as ⚠, never a flag)', () => {
  assert.deepEqual(defaultContentOf({ defaultContent: true }), { flagged: true, reason: null, dynamicsRow: null });
  assert.deepEqual(defaultContentOf({ defaultContent: { reason: 'columns collapse on the source at 360 too' } }), { flagged: true, reason: 'columns collapse on the source at 360 too', dynamicsRow: null });
  assert.deepEqual(defaultContentOf({ defaultContent: { dynamicsRow: 'dyn#4', reason: ' ' } }), { flagged: true, reason: null, dynamicsRow: 'dyn#4' });
  assert.deepEqual(defaultContentOf({ defaultContent: false }), { flagged: false, reason: null, dynamicsRow: null });
  assert.deepEqual(defaultContentOf({}), { flagged: false, reason: null, dynamicsRow: null });
  const [f] = flagGenericWithStructure({ sections: [sec('tabs-band', { reason: 'tabs delivered by dynamics', dynamicsRow: 'dyn#4' }, tabs)] });
  assert.deepEqual([f.section, f.reason, f.dynamicsRow], ['tabs-band', 'tabs delivered by dynamics', 'dyn#4']);
  assert.deepEqual(flagGenericWithStructure(null), []); assert.deepEqual(flagGenericWithStructure({ sections: 'x' }), []);
});

test('INTERACTIVE_SELECTORS is the documented list (audit-and-naming.md § 2b) and every entry is a valid CSS selector', () => {
  for (const need of ['button', 'input', 'select', 'textarea', 'form', 'details', '[role=tab]', '[role=tablist]', '[role=tabpanel]', '[aria-expanded]', '[aria-controls]', '[data-reactroot]', '[data-v-app]', '[ng-app]', '[data-widget]']) assert.ok(INTERACTIVE_SELECTORS.includes(need), need);
  assert.equal(new Set(INTERACTIVE_SELECTORS).size, INTERACTIVE_SELECTORS.length);
  assert.equal(MUSTACHE_MARKER, 'text {{…}}');
});

test('h1Section: same section → ok; moved with a recorded auto-block → FAIL naming the builder; moved with none → warn; unknown → null', () => {
  assert.equal(h1SectionVerdict({ schemaIndex: 0, pageIndex: 0 }).level, 'ok');
  const fail = h1SectionVerdict({ schemaIndex: 0, pageIndex: 1, autoBlocks: [{ fn: 'buildHeroBlock', trigger: 'main h1, main picture', guard: 'h1 and picture share a section' }] });
  assert.equal(fail.level, 'fail');
  assert.match(fail.message, /h1 left its authored section: schema section #1 → page section #2 — an auto-block moved it \(runtime-contract\.json#autoBlocks: buildHeroBlock ← main h1, main picture\)/);
  const warn = h1SectionVerdict({ schemaIndex: 2, pageIndex: 0, autoBlocks: [] });
  assert.equal(warn.level, 'warn'); assert.match(warn.message, /no auto-block is recorded/);
  assert.equal(h1SectionVerdict({ schemaIndex: null, pageIndex: 0, autoBlocks: [{ fn: 'x' }] }), null, 'no schema hasH1 → nothing to judge');
  assert.equal(h1SectionVerdict({ schemaIndex: 0, pageIndex: -1 }), null, 'no h1 on the page is the count check\'s verdict, not this one');
  assert.equal(h1SectionVerdict({ schemaIndex: 0, pageIndex: 1, autoBlocks: 'not-a-list' }).level, 'warn', 'a malformed contract never FAILs by itself');
});

test('ai-readability verdict(): a scored FAIL → 1; only unmeasured pages → 2 (never 0 — the throttled-run hole); clean → 0; counts in the JSON', () => {
  const ok = { path: '/a', strict: { score: 100 }, code: { score: 99 }, exclusions: [] };
  const low = { path: '/b', strict: { score: 100 }, code: { score: 91 }, exclusions: [] };
  const undecided = { path: '/c', strict: { score: 100 }, code: { score: 100 }, exclusions: [{ block: 'calc', decided: false }] };
  const err = { path: '/d', error: 'served fetch HTTP 429' };
  assert.deepEqual(verdict([ok], 98), { exit: 0, failed: 0, unmeasured: 0, scored: 1 });
  assert.deepEqual(verdict([err, err], 98), { exit: 2, failed: 0, unmeasured: 2, scored: 0 }, 'every page 429 → exit 2, not the old `fail ? 1 : 0` pass');
  assert.deepEqual(verdict([ok, err], 98), { exit: 2, failed: 0, unmeasured: 1, scored: 1 });
  assert.deepEqual(verdict([low, err], 98), { exit: 1, failed: 1, unmeasured: 1, scored: 1 }, 'a scored FAIL wins over unmeasured');
  assert.deepEqual(verdict([undecided], 98), { exit: 1, failed: 1, unmeasured: 0, scored: 1 }, 'an undecided exclusion is a FAIL');
  assert.deepEqual(verdict([], 98), { exit: 0, failed: 0, unmeasured: 0, scored: 0 });
});
