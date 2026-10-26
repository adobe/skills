// skills/reskin/scripts/test/figma-gate-eds.test.mjs — the preview join reads each module's EDS block by deploy
// Step 2 (io.mjs edsModules: curation-rules eds, else figma/eds-map.mjs on the name) and lists, advisory, each slot
// whose authored section does not hold that block (plainJoin naming). Run: node --test <this file>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edsModules } from '../figma-gate/io.mjs';
import { plainJoin, plainSections } from '../figma-gate/plain-join.mjs';

const rules = { modules: [
  { id: 'M1', name: 'Q&A', status: 'include' },
  { id: 'M2', name: 'Teaser', status: 'include' },
  { id: 'M3', name: 'Button', status: 'include' },
  { id: 'M4', name: 'Promo', status: 'include', eds: { block: 'columns', variant: 'promo' } },
  { name: 'Related', status: 'excluded' },
] };

test('edsModules: deploy Step 2 on the module name, an eds override wins, excluded modules are absent', () => {
  const eds = edsModules(rules);
  assert.deepEqual([...eds.keys()], ['M1', 'M2', 'M3', 'M4']);
  assert.equal(eds.get('M1').block, 'accordion');
  assert.deepEqual([eds.get('M2').block, eds.get('M2').variant], ['cards', 'teaser']);
  assert.equal(eds.get('M3').block, null);
  assert.deepEqual(eds.get('M4'), { block: 'columns', variant: 'promo' });
});

const doc = (...divs) => `<body><main>${divs.join('')}</main></body>`;
const html = doc(
  '<div><div class="accordion"><div><div><h2>Questions</h2></div></div></div></div>',
  '<div><div class="columns"><div><div><h2>Read more</h2></div></div></div></div>',
  '<div><h2>Go</h2><div class="section-metadata"><div><div>style</div><div>dark</div></div></div></div>',
  '<div><div class="cards"><div><div><h2>Promo time</h2></div></div></div></div>',
);
const plain = plainSections(html);
const local = [
  { slot: 's01', module: 'M1', text: 'Questions', nested: false },
  { slot: 's02', module: 'M2', text: 'Read more', nested: false },
  { slot: 's03', module: 'M3', text: 'Go', nested: false },
  { slot: 's04', module: 'M4', text: 'Promo time', nested: false },
];
const mapping = local.map(({ slot, module }) => ({ slot, module, status: 'mapped' }));
const anchors = new Map([['s01', 'questions'], ['s02', 'read more'], ['s03', 'go'], ['s04', 'promo time']]);
const modules = new Map([['M1', '1:1'], ['M2', '1:2'], ['M3', '1:3'], ['M4', '1:4']]);

test('plainSections: each section lists the blocks authored in it, metadata blocks aside', () => {
  assert.deepEqual(plain.map((s) => s.blocks), [['accordion'], ['columns'], [], ['cards']]);
});

test('plainJoin naming: a slot not authored as its module\'s EDS block is listed, never a failure', () => {
  const r = plainJoin({ local, plain, decorated: plain.map((s) => s.text), mapping, anchors, modules, eds: edsModules(rules) });
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.naming, [
    's02: M2 is the EDS block "cards" (deploy Step 2 D11) but plain section 1 authors columns',
    's04: M4 is the EDS block "columns" (deploy Step 2 D11) but plain section 3 authors cards',
  ]);
});

test('plainJoin naming: default content (D1) authored as a block is listed; no eds map lists nothing', () => {
  const bad = plainSections(html.replace('<h2>Go</h2>', '<div class="button"><div><div><h2>Go</h2></div></div></div>'));
  const r = plainJoin({ local, plain: bad, decorated: bad.map((s) => s.text), mapping, anchors, modules, eds: edsModules(rules) });
  assert.ok(r.naming.includes('s03: M3 is default content (deploy Step 2 D1) but plain section 2 authors button'), r.naming.join('\n'));
  const none = plainJoin({ local, plain, decorated: plain.map((s) => s.text), mapping, anchors, modules });
  assert.deepEqual(none.naming, []);
});
