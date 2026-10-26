#!/usr/bin/env node
// skills/reskin/scripts/test/figma-foundation.test.mjs — buildFoundation over the synthetic kit
// (fixtures/figma-kit): hidden subtrees contribute nothing, gradients are never colors, every record
// cites a node (nested instance ids kept), style names key records, instance children supply the
// resolved button values (an overridden nested instance is reported divergent, not averaged), the 13
// probe paths each get ranked candidates, module candidates list sections by y with their components
// and instance properties, remote components are listed and not chased, spec tables are found, and
// the output is deterministic. Pure, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFoundation, headerRowOf, headerRowsOf, PROBE_PATHS, PROBE_SOURCES, RECOMMENDED_PATHS, RECOMMENDED_SOURCES } from '../figma/foundation.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'figma-kit');
const file = JSON.parse(readFileSync(join(KIT, 'file.json'), 'utf8'));
const nodes = JSON.parse(readFileSync(join(KIT, 'nodes.json'), 'utf8'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const out = buildFoundation({ file, nodes, frameIds: ['1:2', '1:9'] });
const { foundation, roleCandidates, moduleCandidates, specTables } = out;
const first = (path) => roleCandidates[path][0];

check('foundation has the six files', () => assert.deepEqual(Object.keys(foundation), ['colors', 'typography', 'effects', 'radii', 'spacing', 'components']));
check('hidden subtrees contribute nothing', () => {
  const s = JSON.stringify(foundation);
  assert.ok(!Object.values(foundation.colors).some((c) => c.value === 'rgb(255, 0, 0)'));
  assert.ok(!s.includes('Comic Hidden') && !s.includes('"1:8"') && !s.includes('99px') && !s.includes('pad-333'));
});
check('gradient fill is not a color', () => {
  assert.ok(!roleCandidates['palette.pageBg'].some((c) => /gradient/i.test(c.from)));
  assert.ok(!Object.values(foundation.colors).some((c) => c.nodes.includes('1:3')));
});
check('every record cites a node', () => { for (const f of Object.values(foundation)) for (const r of Object.values(f)) assert.match(r.node, /^I?\d+:\d+/); });
check('records carry value, figma, node, count, nodes (≤ 5)', () => {
  for (const f of Object.values(foundation)) for (const r of Object.values(f)) {
    for (const k of ['value', 'figma', 'node', 'count', 'nodes']) assert.ok(k in r, `missing ${k}`);
    assert.ok(r.nodes.length <= 5 && r.nodes[0] === r.node);
  }
});
check('nested instance ids kept', () => assert.ok(JSON.stringify(foundation).includes('I1:20;')));
check('style names key records; unstyled values get value-derived keys', () => {
  assert.equal(foundation.colors['brand-navy'].value, 'rgb(31, 58, 95)');
  assert.equal(foundation.colors['brand-navy'].hex, '#1f3a5f');
  assert.equal(foundation.colors['rgb-247-247-245'].value, 'rgb(247, 247, 245)');
  assert.equal(foundation.typography['display-large'].value.fontSize, '56px');
  assert.equal(foundation.typography['inter-16-600'].value.fontWeight, '600');
  assert.equal(foundation.effects['elevation-card'].value, 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px');
  assert.equal(foundation.radii['radius-12-12-0-0'].value, '12px 12px 0px 0px');
  assert.equal(foundation.spacing['max-width-1200'].value, '1200px');
});
check('typography keeps the raw Figma style for later normalizations', () => {
  const t = foundation.typography['display-large'];
  assert.equal(t.figma.lineHeightPx, 64);
  assert.equal(t.figma.letterSpacing, -1.12);
  assert.equal(t.value.letterSpacing, '-1.12px');
});
check('13 probe paths then the 7 recommended paths present as keys, in order', () => {
  assert.equal(PROBE_PATHS.length, 13);
  assert.deepEqual(Object.keys(roleCandidates), [...PROBE_PATHS, ...RECOMMENDED_PATHS]);
  for (const p of PROBE_PATHS) assert.ok(PROBE_SOURCES[p], `no source for ${p}`);
  for (const p of RECOMMENDED_PATHS) assert.ok(RECOMMENDED_SOURCES[p], `no source for ${p}`);
  assert.deepEqual(roleCandidates['buttons.primary.height'], roleCandidates['buttons.primary.background']);
  assert.deepEqual(roleCandidates['cards.primary.background'], [], 'the kit has no card component');
});
check('card components are records and card candidates (not button candidates); mobile frames give mobile candidates', () => {
  const fill = (r, g, b) => [{ type: 'SOLID', color: { r, g, b, a: 1 } }];
  const text = (id, y) => ({ id, name: 'Title', type: 'TEXT', absoluteBoundingBox: { x: 16, y, width: 200, height: 24 }, fills: fill(0, 0, 0), characters: 'Hi', style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 700, lineHeightPx: 24, lineHeightUnit: 'PIXELS' } });
  const card = { id: '9:3', name: 'Card', type: 'INSTANCE', componentId: 'C:card', absoluteBoundingBox: { x: 16, y: 40, width: 343, height: 200 }, fills: fill(1, 1, 1), cornerRadius: 12, layoutMode: 'VERTICAL', paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20, children: [text('9:4', 60)] };
  const doc = { id: '9:1', name: 'Mobile', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 800 }, fills: fill(1, 1, 1), children: [
    { id: '9:2', name: 'Band', type: 'FRAME', layoutMode: 'VERTICAL', paddingTop: 48, paddingBottom: 48, paddingLeft: 16, paddingRight: 16, absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 300 }, fills: [], children: [card] },
  ] };
  const r = buildFoundation({ file: { document: { children: [] } }, nodes: { nodes: { '9:1': { document: doc, components: { 'C:card': { name: 'Card' } } } } }, frameIds: ['9:1'] });
  const c = r.foundation.components.card;
  assert.deepEqual([c.value.background, c.value.borderRadius, c.value.padding, c.value.color], ['rgb(255, 255, 255)', '12px', '20px', 'rgb(0, 0, 0)']);
  assert.deepEqual(r.roleCandidates['cards.primary.titleColor'].map((x) => x.from), ['components/card']);
  assert.deepEqual(r.roleCandidates['buttons.primary.background'], []);
  assert.deepEqual(r.roleCandidates['layout.mobile.sectionPaddingY'].map((x) => x.from), ['spacing/pad-48']);
  assert.deepEqual(r.roleCandidates['layout.mobile.gutter'].map((x) => x.from), ['spacing/pad-16']);
});
check('candidates: ≤ 5 per path, each from a foundation record that exists', () => {
  for (const [p, list] of Object.entries(roleCandidates)) {
    assert.ok(list.length <= 5, p);
    for (const c of list) {
      const [f, key] = c.from.split('/');
      assert.ok(foundation[f]?.[key], `${p}: ${c.from} does not resolve`);
      assert.ok(c.evidence.length >= 1 && c.evidence.length <= 5);
    }
  }
});
check('pageBg: solid fills of the top-level frames', () => {
  assert.deepEqual(roleCandidates['palette.pageBg'].map((c) => c.from), ['colors/rgb-255-255-255', 'colors/rgb-247-247-245']);
  assert.deepEqual(first('palette.pageBg').evidence, ['1:2']);
});
check('bodyFg and headingFg: text fills at the modal size and at ≥ 1.5× it', () => {
  assert.equal(first('palette.bodyFg').from, 'colors/text-ink');
  assert.equal(first('palette.headingFg').from, 'colors/brand-navy');
});
check('type: family, body size by character weight, display weight from the largest text', () => {
  assert.equal(first('type.family').from, 'typography/body-regular');
  assert.equal(first('type.body.fontSize').from, 'typography/body-regular');
  assert.equal(first('type.display.fontWeight').from, 'typography/display-large');
});
check('primary button first', () => {
  assert.match(first('buttons.primary.background').from, /^components\//);
  assert.equal(first('buttons.primary.background').from, 'components/button-primary');
  for (const p of PROBE_PATHS.filter((x) => x.startsWith('buttons.'))) assert.equal(first(p).from, 'components/button-primary');
});
check('button values come from the instance and its label child', () => {
  const b = foundation.components['button-primary'];
  assert.deepEqual(
    { background: b.value.background, color: b.value.color, borderRadius: b.value.borderRadius, padding: b.value.padding, fontSize: b.value.fontSize, fontWeight: b.value.fontWeight },
    { background: 'rgb(31, 58, 95)', color: 'rgb(255, 255, 255)', borderRadius: '8px', padding: '12px 24px', fontSize: '16px', fontWeight: '600' },
  );
  assert.equal(b.node, '1:20');
  assert.equal(b.count, 2);
  assert.deepEqual(b.variant, { Variant: 'Primary' });
});
check('a padded label wrapper inside a padded filled button: padding is the button box, not the wrapper', () => {
  const b = foundation.components['button-primary'];
  assert.equal(b.value.padding, '12px 24px');
  assert.equal(b.figma.fields.padding.node, '1:20');
});
check('a component\'s height is its painted box, not a full-width row around it', () => {
  assert.equal(foundation.components['button-primary'].value.height, '48px');
  const row = foundation.components['cta-row'];
  assert.equal(row.value.height, '42px');
  assert.equal(row.figma.fields.height.node, 'I2:10;6:7');
});
check('container candidates: desktop-scale widths rank before narrower text measures, whatever their count', () => {
  const text = (id, mw) => ({ id, name: 'Copy', type: 'TEXT', maxWidth: mw, absoluteBoundingBox: { x: 0, y: 0, width: mw, height: 20 }, fills: [], characters: 'x', style: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeightPx: 24, lineHeightUnit: 'PIXELS' } });
  const doc = { id: '8:1', name: 'Kit page', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 }, fills: [], children: [
    { id: '8:2', name: 'Module', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 }, fills: [], children: [
      { id: '8:3', name: 'Container', type: 'FRAME', absoluteBoundingBox: { x: 64, y: 0, width: 1312, height: 900 }, fills: [], children: [text('8:4', 780), text('8:5', 780), text('8:6', 780)] },
    ] },
  ] };
  const r = buildFoundation({ file: { document: { children: [] } }, nodes: { nodes: { '8:1': { document: doc } } }, frameIds: ['8:1'] });
  assert.deepEqual(r.roleCandidates['layout.containerMaxWidth'].map((c) => c.from), ['spacing/width-1312', 'spacing/max-width-780']);
});
check('overridden label color: the first instance wins, the override is reported divergent', () => {
  const b = foundation.components['button-primary'];
  assert.deepEqual(b.divergent, [{ node: 'I1:7;5:6', fields: ['color'] }]);
  assert.ok(Object.values(foundation.colors).some((c) => c.value === 'rgb(255, 212, 0)' && c.node === 'I1:7;5:6;3:5'));
});
check('transparent button: background null with its kind; border from the stroke', () => {
  const b = foundation.components['button-secondary'];
  assert.equal(b.value.background, null);
  assert.equal(b.value.backgroundKind, 'NONE');
  assert.equal(b.value.border, '1px solid rgb(31, 58, 95)');
});
check('a same-size wrapper frame carries the box: values read through it', () => {
  const b = foundation.components['link-cta'];
  assert.deepEqual(
    { background: b.value.background, borderRadius: b.value.borderRadius, padding: b.value.padding, color: b.value.color, fontSize: b.value.fontSize },
    { background: 'rgb(26, 26, 26)', borderRadius: '4px', padding: '8px 16px', color: 'rgb(255, 255, 255)', fontSize: '14px' },
  );
  assert.deepEqual(b.figma.box, ['I2:9;6:2', '2:9']);
  assert.equal(b.figma.fields.padding.node, 'I2:9;6:2', 'padding cites the wrapper frame that paints it');
  assert.deepEqual(b.figma.fields.padding.raw, [8, 16, 8, 16]);
  assert.equal(b.figma.fields.color.node, 'I2:9;6:3');
  assert.equal(b.figma.fields.background.node, 'I2:9;6:2');
  assert.deepEqual(roleCandidates['buttons.primary.background'].map((c) => c.from), ['components/button-primary', 'components/button-secondary', 'components/link-cta', 'components/cta-row']);
});
check('a full-width instance around a hug frame with an absolute background layer: values read from the layers the label sits in', () => {
  const b = foundation.components['cta-row'];
  assert.deepEqual(
    { background: b.value.background, borderRadius: b.value.borderRadius, padding: b.value.padding, border: b.value.border, color: b.value.color },
    { background: 'rgb(208, 0, 111)', borderRadius: '4px', padding: '8px 16px', border: '1px solid rgb(208, 0, 111)', color: 'rgb(255, 255, 255)' },
  );
  assert.equal(b.figma.fields.background.node, 'I2:10;6:7');
  assert.equal(b.figma.fields.borderRadius.node, 'I2:10;6:7');
  assert.equal(b.figma.fields.padding.node, 'I2:10;6:6');
  assert.deepEqual(b.figma.box, ['I2:10;6:7', 'I2:10;6:6', '2:10']);
});
check('container and section padding candidates', () => {
  assert.deepEqual(roleCandidates['layout.containerMaxWidth'].map((c) => c.from), ['spacing/max-width-1200', 'spacing/width-1200', 'spacing/width-760']);
  assert.deepEqual(roleCandidates['layout.sectionPaddingY'].map((c) => c.from), ['spacing/pad-80', 'spacing/pad-96', 'spacing/pad-64']);
  assert.equal(first('layout.sectionPaddingY').count, 3);
});
check('component set variants', () => assert.deepEqual(moduleCandidates.componentSets, [{ node: '3:1', name: 'Button', variantOptions: { Variant: ['Primary', 'Secondary'] } }]));
check('frames: slug, size, sections sorted by y, hidden sections skipped', () => {
  const [home, article] = moduleCandidates.frames;
  assert.deepEqual([home.slug, home.width, home.height, article.slug], ['home', 1440, 1840, 'article']);
  const ys = home.sections.map((s) => s.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.deepEqual(home.sections.map((s) => s.name), ['Hero', 'Features', 'Footer']);
  assert.deepEqual(article.sections.map((s) => s.y), [0, 1200]);
});
check('sections: background kind, components used, instance properties without #ids', () => {
  const [hero, features, footer] = moduleCandidates.frames[0].sections;
  assert.equal(footer.background, 'rgb(31, 58, 95)', 'two fills, white under navy: the last (top) paint is the one seen');
  assert.equal(hero.backgroundKind, 'GRADIENT_LINEAR');
  assert.equal(hero.background, null);
  assert.deepEqual(hero.components, ['Button']);
  assert.equal(features.instanceOf, 'Feature Grid');
  assert.deepEqual(features.componentProperties, { 'Show heading': true, Eyebrow: 'Features' });
  assert.deepEqual(features.components, ['Feature Grid', 'Button']);
});
check('remote component listed, not chased', () => assert.deepEqual(moduleCandidates.remote, [{ componentId: '5:1', name: 'Feature Grid' }]));
check('a TEXT node holding a JSON token table is a spec table; plain text is not', () => {
  assert.deepEqual(specTables, [{ node: '2:6', name: 'Token table', json: { 'color/brand/primary': '#1f3a5f', 'space/section': '80px' } }]);
});
check('frames record the kit page they sit on; a deeper node has no page', () => {
  assert.deepEqual(moduleCandidates.frames.map((f) => f.page), [{ node: '0:1', name: 'Pages' }, { node: '0:1', name: 'Pages' }]);
  const container = nodes.nodes['1:2'].document.children[0].children[0];
  const r = buildFoundation({ file, nodes: { ...nodes, nodes: { ...nodes.nodes, [container.id]: { document: container } } }, frameIds: [container.id] });
  assert.equal(r.moduleCandidates.frames[0].page, null);
});
check('a frame missing from the nodes response is reported, not fatal', () => {
  const r = buildFoundation({ file, nodes: { ...nodes, nodes: { ...nodes.nodes, '1:9': null } }, frameIds: ['1:2', '1:9'] });
  assert.deepEqual(r.moduleCandidates.missing, ['1:9']);
  assert.equal(r.moduleCandidates.frames.length, 1);
});
check('no NaN or undefined anywhere (omitted paddings default to 0)', () => assert.ok(!/NaN|undefined/.test(JSON.stringify(out))));
check('deterministic', () => assert.equal(JSON.stringify(buildFoundation({ file, nodes, frameIds: ['1:2', '1:9'] })), JSON.stringify(out)));

check('headerRowOf: brand | menu | actions measured off the boxes; center, start, end; none below the top band or on mobile', () => {
  const bb = (x, y, width, height = 40) => ({ x, y, width, height });
  const text = (id, x) => ({ id, type: 'TEXT', characters: 'Item', absoluteBoundingBox: bb(x, 100, 80) });
  const item = (id, x) => ({ id, type: 'INSTANCE', absoluteBoundingBox: bb(x, 100, 80), children: [text(`${id}t`, x)] });
  const frame = (menuX, rowY = 80, width = 1440) => ({
    id: 'F', type: 'FRAME', absoluteBoundingBox: bb(0, 0, width, 900), children: [{
      id: 'H', type: 'FRAME', layoutMode: 'HORIZONTAL', absoluteBoundingBox: bb(130, rowY, 1180), children: [
        { id: 'L', type: 'FRAME', absoluteBoundingBox: bb(130, rowY, 136), children: [] },
        { id: 'M', type: 'FRAME', layoutMode: 'HORIZONTAL', absoluteBoundingBox: bb(menuX, rowY, 353), children: [item('a', menuX), item('b', menuX + 120)] },
        { id: 'R', type: 'FRAME', absoluteBoundingBox: bb(1174, rowY, 136), children: [] },
      ],
    }],
  });
  assert.deepEqual(headerRowOf(frame(543.5)), { node: 'H', menu: 'M', align: 'center', offset: 0, width: 1180 });
  assert.equal(headerRowOf(frame(300)).align, 'start');
  assert.equal(headerRowOf(frame(800)).align, 'end');
  assert.equal(headerRowOf(frame(450)), null);
  assert.equal(headerRowOf(frame(543.5, 400)), null);
  assert.equal(headerRowOf(frame(543.5, 80, 390)), null);
});

check('headerRowsOf: each screen of a canvas measured from its own top; deduped; footers skipped', () => {
  const bb = (x, y, width, height = 40) => ({ x, y, width, height });
  const item = (id, x, y) => ({ id, type: 'INSTANCE', absoluteBoundingBox: bb(x, y, 80), children: [{ id: `${id}t`, type: 'TEXT', characters: 'Item', absoluteBoundingBox: bb(x, y, 80) }] });
  const row = (p, x, y, menuX) => ({
    id: `${p}H`, type: 'FRAME', layoutMode: 'HORIZONTAL', absoluteBoundingBox: bb(x + 130, y, 1180), children: [
      { id: `${p}L`, type: 'FRAME', absoluteBoundingBox: bb(x + 130, y, 136), children: [] },
      { id: `${p}M`, type: 'FRAME', absoluteBoundingBox: bb(x + menuX, y, 353), children: [item(`${p}a`, x + menuX, y), item(`${p}b`, x + menuX + 120, y)] },
      { id: `${p}R`, type: 'FRAME', absoluteBoundingBox: bb(x + 1174, y, 136), children: [] },
    ],
  });
  const screen = (p, x, y, menuX, name = 'Breakpoint=Desktop') => ({ id: p, name, type: 'COMPONENT', absoluteBoundingBox: bb(x, y, 1440, 900), children: [row(p, x, y + 40, menuX)] });
  const canvas = {
    id: 'C', name: 'Page', type: 'FRAME', absoluteBoundingBox: bb(0, 0, 4400, 3000), children: [
      screen('A', 0, 100, 543.5), screen('B', 1500, 100, 543.5), screen('D', 0, 2000, 543.5), screen('E', 1500, 2000, 1174 - 353 - 20, 'Site Footer'),
    ],
  };
  const rows = headerRowsOf(canvas);
  assert.deepEqual(rows.map((r) => [r.node, r.align, r.screen]), [['AH', 'center', 'A'], ['BH', 'center', 'B'], ['DH', 'center', 'D']]);
  assert.deepEqual(headerRowsOf({ ...canvas, name: 'Footer' }), []);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
