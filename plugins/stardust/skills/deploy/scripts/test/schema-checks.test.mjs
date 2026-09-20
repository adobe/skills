#!/usr/bin/env node
/**
 * schema-checks.mjs — the pure judgements behind qa-gate.mjs `generic-with-structure` (T28.4) and `h1Section`
 * (T21.2), plus ai-readability.mjs `verdict()` (T33.1), the in-page repeat-unit grouping `repeatUnitGroups`
 * (T28.2 — run over a plain-object DOM, no browser) and qa-gate.mjs's argument table `parseQaGateArgs`. No
 * browser: the facts are fixture JSON, the judgement is what the test pins. The BLOCKING branches (a prose
 * section with a tab strip → FAIL; a moved <h1> with an auto-block → FAIL; an all-unmeasured readability run →
 * exit 2, never the old exit 1 FAIL) each have a case, and the escapes (recorded `defaultContent.reason` /
 * `dynamicsRow` → warn; no auto-blocks → warn) too. NEGATIVE: section-schema-structure.test.mjs against a stub
 * playwright ends in a FAIL summary, not an uncaught ENOENT.
 * Run: node --test skills/deploy/scripts/test/schema-checks.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { flagGenericWithStructure, h1SectionVerdict, hasStructure, defaultContentOf, INTERACTIVE_SELECTORS, MUSTACHE_MARKER, repeatUnitGroups, inPageCall, parseQaGateArgs } from '../schema-checks.mjs';
import { verdict } from '../ai-readability.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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

test('ai-readability verdict(): a scored FAIL → 1; only unmeasured pages → 2 (no verdict — the pre-fix run exited 1 FAIL); clean → 0; counts in the JSON', () => {
  const ok = { path: '/a', strict: { score: 100 }, code: { score: 99 }, exclusions: [] };
  const low = { path: '/b', strict: { score: 100 }, code: { score: 91 }, exclusions: [] };
  const undecided = { path: '/c', strict: { score: 100 }, code: { score: 100 }, exclusions: [{ block: 'calc', decided: false }] };
  const err = { path: '/d', error: 'served fetch HTTP 429' };
  assert.deepEqual(verdict([ok], 98), { exit: 0, failed: 0, unmeasured: 0, scored: 1 });
  assert.deepEqual(verdict([err, err], 98), { exit: 2, failed: 0, unmeasured: 2, scored: 0 }, 'every page 429 → exit 2 (no verdict), not the old exit 1 FAIL (`fail = true` on r.error)');
  assert.deepEqual(verdict([ok, err], 98), { exit: 2, failed: 0, unmeasured: 1, scored: 1 });
  assert.deepEqual(verdict([low, err], 98), { exit: 1, failed: 1, unmeasured: 1, scored: 1 }, 'a scored FAIL wins over unmeasured');
  assert.deepEqual(verdict([undecided], 98), { exit: 1, failed: 1, unmeasured: 0, scored: 1 }, 'an undecided exclusion is a FAIL');
  assert.deepEqual(verdict([], 98), { exit: 0, failed: 0, unmeasured: 0, scored: 0 });
});

// ---- repeatUnitGroups over a plain-object DOM (the in-page contract: DOM API only, no module-scope identifiers) ----
const el = (tagName, className, children = [], text = '') => {
  const node = { tagName, className, children, childNodes: [], parentElement: null };
  node.childNodes = [...(text ? [{ nodeType: 3, textContent: text }] : []), ...children];
  for (const c of children) c.parentElement = node;
  const all = () => children.flatMap((c) => [c, ...c.querySelectorAll('*')]);
  node.querySelectorAll = (sel) => all().filter((n) => sel === '*' || sel.split(',').map((t) => t.trim().toUpperCase()).includes(n.tagName));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] || null;
  node.contains = (n) => n === node || all().includes(n);
  Object.defineProperty(node, 'textContent', { get: () => text + children.map((c) => c.textContent).join('') });
  return node;
};
const card = (t) => el('DIV', 'card', [el('H3', '', [], t), el('P', '', [], 'body'), el('A', 'cta', [], 'Read')]);

test('repeatUnitGroups: ≥ 2 same tag+class content-bearing siblings form one outermost group; an inner list is part of the unit; skip/atoms honoured', () => {
  const li = () => el('LI', '', [el('SPAN', '', [], 'item')]); // a bare text <li> has no text RUN below it (the rule counts descendants) — one span makes it content
  const section = el('SECTION', 'cards', [el('H2', '', [], 'Cards'), el('DIV', 'grid', [card('A'), card('B'), el('UL', '', [li(), li()])]), el('SCRIPT', '', [el('SPAN', 'x', [], 'a'), el('SPAN', 'x', [], 'b')])]);
  const groups = repeatUnitGroups(section, { skip: ['SCRIPT'] });
  assert.deepEqual(groups.map(({ members, ...g }) => g), [
    { unitSelector: 'DIV.card', tag: 'DIV', count: 2, unit: { headings: 1, ctas: 1, imgs: 0, textRuns: 3 }, uniform: true, depth: 1 },
    { unitSelector: 'LI.', tag: 'LI', count: 2, unit: { headings: 0, ctas: 0, imgs: 0, textRuns: 1 }, uniform: true, depth: 2 },
  ], 'the ul is a sibling of the cards, so its items are a second (deeper) group; SCRIPT children are never scanned');
  assert.equal(groups[0].members.length, 2, 'members are the elements themselves (stripped before crossing the evaluate boundary)');
  const nested = el('SECTION', '', [el('DIV', 'grid', [el('DIV', 'card', [el('UL', '', [li(), li()])]), el('DIV', 'card', [el('UL', '', [li(), li()])])])]);
  assert.deepEqual(repeatUnitGroups(nested).map((g) => g.unitSelector), ['DIV.card'], 'a reported unit\'s inner list is part of the unit, not a second group');
  assert.deepEqual(repeatUnitGroups(section, { skip: ['SCRIPT'], atoms: ['LI'] }).map((g) => g.unitSelector), ['DIV.card'], 'atoms are never grouped');
  assert.deepEqual(repeatUnitGroups(el('SECTION', '', [el('DIV', 'sp', []), el('DIV', 'sp', [])])), [], 'empty siblings are not a group');
  assert.doesNotMatch(repeatUnitGroups.toString(), /INTERACTIVE_SELECTORS|MUSTACHE_MARKER|QA_GATE_VALUE_FLAGS|import\b/, 'in-page body names no module-scope identifier');
});

test('inPageCall: one expression with the helper in scope — evaluable as a string, JSON args', () => {
  const src = inPageCall((a) => helperFn(a.n) + 1, { n: 2 }, { helperFn: (v) => v * 10 }); // eslint-disable-line no-undef
  assert.equal(eval(src), 21); // eslint-disable-line no-eval
  assert.doesNotMatch(src, /new Function|\beval\(/, 'no page-side eval (a strict prototype CSP is irrelevant)');
});

test('parseQaGateArgs: the URL is the first positional that is not a flag value; value flags refuse a following --flag; unknown flags are usage errors', () => {
  assert.deepEqual(parseQaGateArgs(['--schema', 'x.json', 'http://h/p.html']), { url: 'http://h/p.html', schema: 'x.json', maxw: 1340, fullBleed: [], marker: null, error: null }, 'NEGATIVE: the old first-non-flag rule read x.json as the URL');
  assert.deepEqual(parseQaGateArgs(['http://h/p.html', '--maxw', '1600', '--full-bleed', 'hero, band', '--marker', 'm1']), { url: 'http://h/p.html', schema: null, maxw: 1600, fullBleed: ['hero', 'band'], marker: 'm1', error: null });
  assert.equal(parseQaGateArgs(['http://h/p.html', '--marker', '--schema', 's.json']).error, '--marker needs a value', 'NEGATIVE: the old opt() took --schema as the marker');
  assert.equal(parseQaGateArgs(['http://h/p.html', '--schema']).error, '--schema needs a value');
  assert.equal(parseQaGateArgs(['http://h/p.html', '--maxw', 'wide']).error, '--maxw needs a positive number of px');
  assert.match(parseQaGateArgs(['http://h/p.html', '--json']).error, /unknown flag --json/);
  assert.match(parseQaGateArgs(['http://h/p.html', 'other']).error, /unexpected argument other/);
  assert.equal(parseQaGateArgs([]).url, null);
});

test('NEGATIVE: section-schema-structure.test.mjs with a stub playwright ends in a FAIL summary (exit 1), never an uncaught ENOENT stack', () => {
  let resolvable = false;
  try { createRequire(join(here, '..', 'x.mjs')).resolve('playwright'); resolvable = true; } catch { /* the plugin tree: STARDUST_PW_ROOT decides */ }
  if (resolvable) return; // an EDS project resolves the real playwright first — the stub cannot be injected here
  const stub = mkdtempSync(join(tmpdir(), 'pw-stub-'));
  mkdirSync(join(stub, 'node_modules', 'playwright'), { recursive: true });
  writeFileSync(join(stub, 'node_modules', 'playwright', 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0-stub', main: 'index.js' }));
  writeFileSync(join(stub, 'node_modules', 'playwright', 'index.js'), 'module.exports = { chromium: { launch: async () => { throw new Error("stub playwright: no browser"); } } };\n');
  try {
    const r = spawnSync(process.execPath, [join(here, 'section-schema-structure.test.mjs')], { encoding: 'utf8', env: { ...process.env, STARDUST_PW_ROOT: stub, STARDUST_GATE_DEPS: '' }, timeout: 80000 });
    assert.equal(r.status, 1, `exit 1: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^FAIL section-schema exits 0/m);
    assert.match(r.stdout, /^FAIL section-schema wrote no .*schema\.json \(exit 1\)/m);
    assert.match(r.stdout, /section-schema-structure test: FAILED$/m);
    assert.doesNotMatch(r.stderr, /ENOENT|at .*readFileSync/, 'no uncaught stack');
  } finally { rmSync(stub, { recursive: true, force: true }); }
});
