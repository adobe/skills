#!/usr/bin/env node
// skills/reskin/scripts/test/vocabulary-check.test.mjs — vocabulary-check (pure part): donor-modules.md rows →
// dispositions, checked against an in-memory EDS project. Every included module is built whether a page uses it
// or not; blockless kinds and default-content overrides say why. Run: node --test <this file>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disposition, dispositionLabel, parseDisposition } from '../figma/eds-map.mjs';
import { checkVocabulary, parseModulesMd } from '../vocabulary-check.mjs';

const MD = `# Donor modules — kit

| # | Module | EDS block | Disposition | Where seen | Description |
|---|--------|-----------|-------------|-----------|-------------|
| M1 | Accordion | accordion | block | s.png · node 1:1 | rows |
| M2 | Tabs | accordion (tabs) | variant | s.png · node 1:2 | tab row |
| M3 | Back To Top | default content | feature: back-to-top button (scripts/features.js) | s.png · node 1:3 | a |
| M4 | Email | default content | section-style (email): default content on a band | s.png · node 1:4 | a |
| M5 | Input | default content | style: shared form fields in styles.css | s.png · node 1:5 | a |
| M6 | Modal | default content | default-content | s.png · node 1:6 | a |
| M7 | Calculator | calculator | block | s.png · node 1:7 | a |
| M8 | Footer | footer | chrome | s.png · node 1:8 | a |
| — | Related | — | — | s.png · node 1:9 | excluded — do not develop: dup |
| M9 | Pipe \\| name | default content | default-content: prose only | s.png · node 1:10 | a |
`;

const FILES = {
  'blocks/accordion/accordion.js': "if (block.classList.contains('tabs')) makeTabs();",
  'blocks/accordion/accordion.css': '.accordion.tabs { display: grid; }',
  'blocks/accordion/metadata.json': '{ "variants": ["tabs"] }',
  'blocks/calculator/calculator.js': 'export default function decorate() {}',
  'blocks/footer/footer.js': 'export default function decorate() {}',
  'styles/styles.css': 'main .section.email { background: #eee; }',
  'lib/accordion.plain.html': '<div class="accordion"></div><div class="accordion tabs"></div>',
  'lib/calculator.plain.html': '<div class="calculator"></div>',
};
const reader = (files) => (p) => (p in files ? files[p] : null);
const run = (files = FILES, opts = {}) => {
  const rows = checkVocabulary(parseModulesMd(MD), reader(files), { blocks: ['accordion', 'calculator', 'footer'], ...opts });
  return Object.fromEntries(rows.map((r) => [r.id, r]));
};

test('disposition: derived for blocks, eds.as for blockless kinds; the label round-trips', () => {
  assert.equal(disposition({ block: 'cards', variant: 'focus' }).kind, 'variant');
  assert.equal(disposition({ block: 'header', variant: null }).kind, 'chrome');
  assert.equal(disposition({ block: null, variant: null }).kind, 'default-content');
  const d = disposition({ block: null, as: 'section-style', name: 'email' }, ' tinted band ');
  assert.equal(dispositionLabel(d), 'section-style (email): tinted band');
  assert.deepEqual(parseDisposition(dispositionLabel(d)), { kind: 'section-style', name: 'email', why: 'tinted band' });
  assert.equal(parseDisposition('widget: x'), null);
});

test('parseModulesMd: excluded rows skipped, escaped pipes kept, EDS block column parsed', () => {
  const mods = parseModulesMd(MD);
  assert.deepEqual(mods.map((m) => m.id), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']);
  assert.deepEqual(mods[1].eds, { block: 'accordion', variant: 'tabs' });
  assert.equal(mods[8].name, 'Pipe | name');
});

test('a table without a Disposition column (pre-0.34) is read from the EDS block column', () => {
  const old = MD.replace(/ \| (block|variant|chrome|default-content|feature: [^|]*|section-style[^|]*|style: [^|]*|—) \| s\.png/g, ' | s.png')
    .replace('| Disposition ', '').replace('|-------------', '');
  const mods = parseModulesMd(old);
  assert.equal(mods[1].disposition.kind, 'variant');
  assert.equal(mods[2].disposition.kind, 'default-content');
});

test('the built project passes; a new block without a why is a NOTE; the library is checked when given', () => {
  const r = run(FILES, { library: 'lib' });
  for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9']) assert.equal(r[id].verdict, 'PASS', `${id}: ${r[id].why}`);
  assert.equal(r.M7.verdict, 'NOTE');
  assert.equal(r.M6.verdict, 'FAIL', 'default content without a why');
  assert.match(r.M6.why, /default-content needs a why/);
});

test('an unbuilt block, an unhandled or unlisted variant, an unstyled section style, a missing sample → FAIL', () => {
  const without = (k) => Object.fromEntries(Object.entries(FILES).filter(([p]) => p !== k));
  assert.match(run(without('blocks/calculator/calculator.js')).M7.why, /does not exist: build it/);
  assert.match(run({ ...FILES, 'blocks/accordion/accordion.js': '', 'blocks/accordion/accordion.css': '' }).M2.why, /no rule or code for the variant "tabs"/);
  assert.match(run({ ...FILES, 'blocks/accordion/metadata.json': '{ "variants": [] }' }).M2.why, /metadata.json "variants" does not list "tabs"/);
  assert.match(run({ ...FILES, 'styles/styles.css': '.email { color: red; }' }).M4.why, /no \.section\.email rule/);
  assert.match(run(without('lib/accordion.plain.html'), { library: 'lib' }).M1.why, /no library sample/);
  assert.match(run({ ...FILES, 'lib/accordion.plain.html': '<div class="accordion"></div>' }, { library: 'lib' }).M2.why, /no "accordion \(tabs\)" section/);
});

test('variant-first: an invented block a project block hosts (chips → links) fails without a why', () => {
  const md = MD.replace('| M7 | Calculator | calculator | block |', '| M7 | Chips | chips | block |');
  const files = { ...FILES, 'blocks/chips/chips.js': 'export default function decorate() {}' };
  const check = (m, blocks) => Object.fromEntries(checkVocabulary(parseModulesMd(m), reader(files), { blocks }).map((x) => [x.id, x]));
  assert.match(check(md, ['links', 'chips']).M7.why, /variant-first: blocks\/links hosts it — build it as links \(chips\)/);
  assert.equal(check(md, ['chips']).M7.verdict, 'NOTE', 'no links block: an invented block, noted');
  assert.equal(check(md.replace('| chips | block |', '| chips | block: a chip carries a count badge the links rows cannot |'), ['links', 'chips']).M7.verdict, 'PASS');
});

test('a blockless kind without a why, or a malformed Disposition cell → FAIL', () => {
  const md = MD.replace('feature: back-to-top button (scripts/features.js)', 'feature').replace('| M5 | Input | default content | style: shared form fields in styles.css', '| M5 | Input | default content | widget');
  const rows = Object.fromEntries(checkVocabulary(parseModulesMd(md), reader(FILES), {}).map((x) => [x.id, x]));
  assert.match(rows.M3.why, /feature needs a why/);
  assert.match(rows.M5.why, /Disposition cell is not/);
});
