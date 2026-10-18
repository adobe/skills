#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-checks.test.mjs — figma-gate/checks.mjs over the synthetic kit
// (fixtures/figma-kit/nodes.json, fixtures/figma-gate/checks.json): defaults, every problem of an invalid
// checks file collected at once, token sources, per-width roots, skip, pixel modes and rootsNamed, and the
// coverage floor (text styles, mobile variants, waivers) over a small module built in this file.
// Pure, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { MEASURES, leavesSection, mobileCandidates, mobileVariants, rootsNamed, scopeSelector, selectorBranches, styleKey, textStyles, validateChecks } from '../figma-gate/checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const fixtureChecks = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-gate', 'checks.json'), 'utf8'));
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const join2 = { sections: [{ slot: 's01', module: 'M1', node: '1:3' }, { slot: 's02', module: 'M2', node: '1:7' }] };
const ctx = { join: join2, boxes, tokens: {} };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const skipped = { skip: 'not under test', geometry: [], type: [] };
const problemsOf = (sections, extra = ctx) => validateChecks({ version: 1, page: 'home', sections: { s01: skipped, ...sections } }, extra).problems.join('\n');
// The four text styles of M2's frame (1:7): section title, feature copy, card label, card button label.
const typeS02 = [
  { id: 't1', selector: 'h2', node: 'I1:7;5:2' },
  { id: 't2', selector: '.feature', node: 'I1:7;5:3' },
  { id: 't3', selector: '.card-label', node: 'I1:7;5:8' },
  { id: 't4', selector: '.card-btn', node: 'I1:7;5:6;3:5' },
];
const geo = (entry) => ({ s02: { geometry: [{ id: 'x', selector: '.card', ...entry }], type: typeS02 } });

check('the fixture is valid and gets its defaults', () => {
  const ok = validateChecks(fixtureChecks, ctx);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.sections.s02.root, '1:7');
  assert.equal(ok.sections.s02.width, 1440);
  assert.deepEqual(ok.sections.s02.roots, { 1440: '1:7' });
  assert.equal(ok.sections.s02.geometry[0].tolerancePx, 1);
  assert.equal(ok.sections.s02.geometry[0].index, 0);
  assert.equal(ok.sections.s02.pixel.mode, 'auto');
  assert.equal(ok.sections.s01.geometry.length, 6);
  assert.deepEqual(ok.sections.s02.waive, []);
  assert.deepEqual(ok.coverage, {
    s01: { styles: { covered: 4, total: 4 }, widths: [1440], waived: 0 },
    s02: { styles: { covered: 4, total: 4 }, widths: [1440], waived: 0 },
  });
});

check('an invalid file lists every problem at once', () => {
  const bad = validateChecks({ version: 1, page: 'home', sections: {
    s09: { geometry: [], type: [] },
    s02: { geometry: [
      { id: 'a', selector: '.card', node: 'I2:8;5:3', measure: 'width' },
      { id: 'b', selector: '.lead', node: 'I1:7;5:3', measure: 'height' },
      { id: 'c', selector: '.feature', nodes: ['I1:7;5:3'], measure: 'gapX' },
      { id: 'd', selector: 'h2', node: 'I1:7;5:2', measure: 'paddingTop' },
      { id: 'e', selector: ':scope', token: 'layout.nope', measure: 'paddingLeft', width: 360 },
      { id: 'f', selector: '.card', node: 'I1:7;5:7', measure: 'width', width: 360 } ], type: [] },
    s01: {} } }, ctx).problems.join('\n');
  assert.match(bad, /s09 is not a joined section/);
  assert.match(bad, /a: I2:8;5:3 is not inside s02's root 1:7/);
  assert.match(bad, /b: height is content-dependent: needs tolerancePx and why/);
  assert.match(bad, /c: gapX needs nodes: \[a, b\]/);
  assert.match(bad, /d: I1:7;5:2 has no auto-layout padding/);
  assert.match(bad, /e: token layout.nope is not a px value in donor-tokens.json/);
  assert.match(bad, /f: width 360 needs sections.s02.roots\["360"\] or a token/);
  assert.match(bad, /s02 has no type checks/);
  assert.match(bad, /s01 has no geometry checks: add one or "skip": "<why>"/);
  assert.doesNotMatch(bad, /e: width 360 needs/);
});

check('measures: the list, unknown measure, tolerance rules', () => {
  assert.deepEqual(MEASURES, ['width', 'left', 'right', 'top', 'height', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'bottom' })), /x: unknown measure bottom/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'top' })), /x: top is content-dependent: needs tolerancePx and why/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'top', tolerancePx: 8 })), /x: top is content-dependent/);
  assert.equal(problemsOf(geo({ node: 'I1:7;5:7', measure: 'height', tolerancePx: 8, why: 'wraps with the copy' })), '');
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'width', tolerancePx: 3 })), /x: tolerancePx 3 above 1 needs why/);
  assert.equal(problemsOf(geo({ node: 'I1:7;5:7', measure: 'width', tolerancePx: 3, why: 'fluid column' })), '');
  assert.match(problemsOf(geo({ nodes: ['I1:7;5:3', 'I1:7;5:4', 'I1:7;5:7'], measure: 'gapY' })), /x: gapY needs nodes: \[a, b\]/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'gapX' })), /x: gapX needs nodes: \[a, b\]/);
  assert.match(problemsOf(geo({ measure: 'width' })), /x: needs one of node, nodes or token/);
});

check('tokens: a px value is accepted, anything else is a problem', () => {
  const t = (tokens, token = 'layout.pad') => problemsOf(geo({ token, measure: 'paddingLeft' }), { ...ctx, tokens });
  assert.equal(t({ layout: { pad: '24px' } }), '');
  assert.equal(t({ layout: { pad: '-1.5px' } }), '');
  assert.match(t({ layout: { pad: '2rem' } }), /x: token layout.pad is not a px value in donor-tokens.json/);
  assert.match(t({ layout: { pad: { a: '1px' } } }), /x: token layout.pad is not a px value/);
  assert.match(t({}), /x: token layout.pad is not a px value/);
});

check('per-width roots: a root is found, a node must sit under it', () => {
  const kitCtx = { ...ctx, boxes: buildBoxes({ nodes, roots: ['1:3', '1:7', '1:20'] }) };
  const file = (s01) => ({ version: 1, page: 'home', sections: { s01, s02: { geometry: [{ id: 'g', selector: '.card', node: 'I1:7;5:7', measure: 'width' }], type: typeS02 } } });
  const hero = (over = {}) => ({
    roots: { 280: '1:20' }, // the hero's Button instance (140 wide): an outermost instance of the module, half of 280
    geometry: [{ id: 'x', selector: '.btn', node: '1:20', measure: 'width', width: 280 }],
    type: [...fixtureChecks.sections.s01.type, { id: 't5', selector: '.btn.primary', node: 'I1:20;3:5', width: 280 }],
    ...over,
  });
  const ok = validateChecks(file(hero()), kitCtx);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.sections.s01.roots, { 280: '1:20', 1440: '1:3' });
  assert.equal(ok.sections.s01.geometry[0].width, 280);
  const bad = validateChecks(file(hero({ geometry: [{ id: 'x', selector: '.btn', node: '1:4', measure: 'width', width: 280 }], type: fixtureChecks.sections.s01.type })), kitCtx).problems.join('\n');
  assert.match(bad, /x: 1:4 is not inside s01's root 1:20/);
  assert.match(bad, /s01 @280: text style 16\/600\/24 #ffffff \("Get started", node I1:20;3:5\) has no type entry or waiver/, 'a second width is held to the same floor');
});

check('type entries: the node must be TEXT and inside the root', () => {
  const t = (type) => problemsOf({ s02: { geometry: [{ id: 'g', selector: '.card', node: 'I1:7;5:7', measure: 'width' }], type } });
  assert.match(t([{ id: 't', selector: '.card', node: 'I1:7;5:7' }]), /t: I1:7;5:7 is not TEXT/);
  assert.match(t([{ id: 't', selector: 'h2', node: '1:5' }]), /t: 1:5 is not inside s02's root 1:7/);
});

check('skip with a why replaces the checks; a joined section without a module needs none', () => {
  assert.equal(problemsOf({ s01: { skip: 'static banner', geometry: [], type: [] }, s02: geo({ node: 'I1:7;5:7', measure: 'width' }).s02 }), '');
  assert.match(problemsOf({ s01: { skip: '', geometry: [], type: [] }, s02: geo({ node: 'I1:7;5:7', measure: 'width' }).s02 }), /s01 has no geometry checks/);
  const noModule = { join: { sections: [{ slot: 's05', module: null, node: null }] }, boxes, tokens: {} };
  assert.deepEqual(validateChecks({ version: 1, page: 'home', sections: {} }, noModule).problems, []);
});

check('pixel modes', () => {
  const p = (pixel) => problemsOf({ s01: { skip: 'x', geometry: [], type: [], pixel }, s02: { skip: 'x', geometry: [], type: [] } });
  assert.equal(p({ mode: 'off', why: 'animated' }), '');
  assert.equal(p({ mode: 'fixture', fixtureUrl: 'http://127.0.0.1:1/f.html' }), '');
  assert.match(p({ mode: 'fixture' }), /s01: pixel fixture needs fixtureUrl/);
  assert.match(p({ mode: 'off' }), /s01: pixel off needs why/);
  assert.match(p({ mode: 'blur' }), /s01: pixel mode blur is not auto, fixture or off/);
});

check('structure: version, page, ids, root nodes missing from the boxes', () => {
  assert.match(validateChecks({ version: 2, page: 'home', sections: {} }, ctx).problems.join('\n'), /version must be 1/);
  assert.match(validateChecks({ version: 1, sections: {} }, ctx).problems.join('\n'), /page must be a slug/);
  const dup = problemsOf({ s02: { geometry: [{ id: 'a', selector: '.card', node: 'I1:7;5:7', measure: 'width' }, { id: 'a', selector: '.card', node: 'I1:7;5:7', measure: 'left' }], type: [{ id: 't', selector: 'h2', node: 'I1:7;5:2' }] }, s01: { skip: 'x', geometry: [], type: [] } });
  assert.match(dup, /s02: duplicate id a/);
  const lost = validateChecks({ version: 1, page: 'home', sections: {} }, { ...ctx, boxes: { roots: {} } }).problems.join('\n');
  assert.match(lost, /s01: root 1:3 is not in the loaded boxes/);
});

check('rootsNamed: the roots a checks file needs loaded', () => {
  assert.deepEqual(rootsNamed(fixtureChecks, join2), ['1:3', '1:7']);
  const named = { version: 1, page: 'home', sections: { s02: { node: '1:9', roots: { 360: '1:8' }, geometry: [], type: [] } } };
  assert.deepEqual(rootsNamed(named, join2), ['1:3', '1:9', '1:7', '1:8'], 'the joined module frame is loaded too: the mobile rule reads it');
  assert.deepEqual(rootsNamed({}, { sections: [] }), []);
});

// The coverage floor, over one module built here: a frame that documents the card at three widths.
const solid = (r, g, b) => [{ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }];
const shape = (id, name, type, w, h, children = []) => ({ id, name, type, absoluteBoundingBox: { x: 0, y: 0, width: w, height: h }, fills: [], children });
const words = (id, characters, family, size, weight, lineHeightPx, rgb, letterSpacing = 0) => ({
  ...shape(id, characters, 'TEXT', 200, lineHeightPx), characters, fills: solid(...rgb), style: { fontFamily: family, fontSize: size, fontWeight: weight, lineHeightPx, letterSpacing, lineHeightUnit: 'PIXELS' },
});
const WHITE = [255, 255, 255]; const INK = [51, 51, 51]; const GREY = [102, 102, 102];
const floorNodes = { nodes: { 'F:0': { document: shape('F:0', 'Page', 'FRAME', 1440, 3000, [
  shape('F:1', 'Card module', 'FRAME', 1440, 1600, [
    shape('F:2', 'Documentation', 'FRAME', 400, 300, [words('F:3', 'Notation for spacing and radii', 'Inter', 12, 500, 16, [136, 136, 136])]),
    shape('F:10', 'Card, Device=Desktop', 'INSTANCE', 1440, 700, [
      words('F:11', 'Card title for the third quarter', 'Inter Display', 24, 700, 28.8, WHITE),
      words('F:12', 'Second title', 'Inter Display', 24, 700, 28.84, WHITE, 0.04),
      words('F:13', 'Body copy', 'Inter', 16, 400, 24, INK),
      shape('F:14', 'Notes', 'FRAME', 600, 40, [words('F:15', 'Legal text', 'Inter', 12, 400, 16, GREY)]),
      shape('F:16', 'mobile', 'INSTANCE', 24, 24),
      { ...words('F:17', 'Hidden promo', 'Comic', 99, 300, 120, GREY), visible: false },
      shape('F:18', 'Card', 'INSTANCE', 560, 200, [words('F:19', 'Nested card copy', 'Inter', 16, 400, 24, INK)]),
    ]),
    shape('F:20', 'Card, Device=Tablet', 'INSTANCE', 768, 600, [words('F:21', 'Tablet title', 'Inter Display', 20, 700, 24, WHITE)]),
    shape('F:30', 'Card, Device=Mobile', 'INSTANCE', 382, 900, [words('F:31', 'Mobile title', 'Inter Display', 20, 700, 24, WHITE), words('F:32', 'Body copy', 'Inter', 16, 400, 24, INK)]),
    shape('F:40', 'Backdrop', 'COMPONENT', 1440, 700),
    shape('F:50', 'Legend chip', 'INSTANCE', 120, 32, [words('F:51', 'Legend', 'Inter', 16, 400, 24, INK)]),
    shape('F:60', 'Card, content width', 'INSTANCE', 1184, 700, [words('F:61', 'Content copy', 'Inter', 16, 400, 24, INK)]),
    shape('F:62', 'Card, half width', 'INSTANCE', 720, 700, [words('F:63', 'Half copy', 'Inter', 16, 400, 24, INK)]),
    shape('F:64', 'Card, just under half', 'INSTANCE', 719, 700, [words('F:65', 'Under copy', 'Inter', 16, 400, 24, INK)]),
  ]),
  shape('G:1', 'Plain module', 'FRAME', 1440, 900, [
    words('G:2', 'Plain heading', 'Inter Display', 24, 700, 28.8, WHITE),
    shape('G:3', 'Plain, Device=Tablet', 'INSTANCE', 768, 500, [words('G:4', 'Tablet body', 'Inter', 16, 400, 24, INK)]),
    shape('G:5', 'mobile', 'INSTANCE', 24, 24),
  ]),
  shape('H:1', 'Image module', 'FRAME', 1440, 600, [shape('H:2', 'Hero image', 'INSTANCE', 1440, 500)]),
  shape('K:1', 'Sets module', 'FRAME', 1440, 2200, [
    shape('K:2', 'Card', 'COMPONENT_SET', 900, 800, [
      shape('K:3', 'Device=Desktop', 'COMPONENT', 800, 400, [words('K:4', 'Card heading', 'Inter Display', 24, 700, 28.8, WHITE)]),
      shape('K:5', 'Device=Mobile', 'COMPONENT', 414, 600, [words('K:6', 'Card mobile heading', 'Inter Display', 20, 700, 24, WHITE)]),
    ]),
    shape('K:10', 'Hero', 'COMPONENT_SET', 1600, 1000, [
      shape('K:11', 'Device=Desktop', 'COMPONENT', 1440, 600, [words('K:12', 'Hero heading', 'Inter Display', 40, 700, 46, WHITE, 0.4), words('K:15', 'Hero kicker', 'Inter Display', 40, 700, 46, WHITE, -0.4)]),
      shape('K:13', 'Device=Mobile', 'COMPONENT', 414, 800, [words('K:14', 'Hero mobile heading', 'Inter Display', 32, 700, 36.8, WHITE)]),
    ]),
  ]),
]) } } };
const floorBoxes = buildBoxes({ nodes: floorNodes, roots: ['F:1', 'F:2', 'F:10', 'F:11', 'F:14', 'F:18', 'F:20', 'F:30', 'F:31', 'F:40', 'F:50', 'F:60', 'F:62', 'F:64', 'G:1', 'H:1', 'K:1', 'K:3', 'K:5', 'K:11', 'K:13'] });
const floorJoin = { sections: [{ slot: 's03', module: 'M3', node: 'F:1' }, { slot: 's04', module: 'M4', node: 'G:1' }] };
const floorCtx = { join: floorJoin, boxes: floorBoxes, tokens: {} };
const s04 = { geometry: [{ id: 'g1', selector: 'h2', node: 'G:2', measure: 'width' }], type: [{ id: 't1', selector: 'h2', node: 'G:2' }, { id: 't2', selector: 'p', node: 'G:4' }] };
const at382 = [{ id: 't4', selector: 'h3', node: 'F:31', width: 382 }, { id: 't5', selector: 'p', node: 'F:32', width: 382 }];
const s03 = (over = {}) => ({
  node: 'F:10',
  roots: { 382: 'F:30' },
  geometry: [{ id: 'g1', selector: '.card', node: 'F:11', measure: 'width' }],
  type: [{ id: 't1', selector: 'h3', node: 'F:11' }, { id: 't2', selector: 'p', node: 'F:13' }, { id: 't3', selector: '.legal', node: 'F:15' }, ...at382],
  ...over,
});
const floor = (section, extra = {}) => validateChecks({ version: 1, page: 'home', sections: { s03: section, s04, ...extra } }, floorCtx);
const floorProblems = (section) => floor(section).problems;
const withoutType = (...ids) => s03().type.filter((e) => !ids.includes(e.id));
const MOBILE_LINE = 's03: module has a mobile variant (Card, Device=Mobile, 382 wide) but no roots[<w>] ≤ 480 and no { width: "mobile" } waiver';
const TAIL = ' — name the module\'s outermost instance or variant';

check('styleKey: the tuple of family, size, weight, line height and letter spacing rounded to 0.1, and colour', () => {
  const t = { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, lineHeightPx: 28.8, letterSpacing: 0, color: 'rgb(255, 255, 255)' };
  assert.equal(styleKey({ ...t, lineHeightPx: 28.84, letterSpacing: 0.04 }), styleKey(t), 'to 0.1px');
  assert.equal(styleKey({ ...t, lineHeightPx: 28.86 }) === styleKey(t), false);
  for (const other of [{ fontFamily: 'Inter Display' }, { fontSize: 25 }, { fontWeight: 600 }, { letterSpacing: -0.5 }, { color: 'rgb(0, 0, 0)' }]) assert.notEqual(styleKey({ ...t, ...other }), styleKey(t), JSON.stringify(other));
  assert.equal(styleKey({ ...t, color: 'rgb(255, 255, 255)' }), styleKey({ ...t, color: '#ffffff' }), 'one hex form of the same colour');
});

check('textStyles: equal styles across nodes are one group; hidden nodes are not in the boxes; a container waiver drops its subtree, a TEXT waiver its style', () => {
  const desktop = floorBoxes.roots['F:10'].box;
  const all = textStyles(desktop);
  assert.equal(all.size, 3);
  const [title, body, legal] = [...all.values()];
  assert.deepEqual(title.nodes, ['F:11', 'F:12']);
  assert.equal(title.sample, 'Card title for the thir…');
  assert.deepEqual(body.nodes, ['F:13', 'F:19'], 'a nested instance\'s text is a node of the root as well');
  assert.deepEqual(legal.nodes, ['F:15']);
  assert.equal(title.label, '24/700/28.8 #ffffff');
  assert.equal(textStyles(desktop, []).size, 3);
  assert.deepEqual([...textStyles(desktop, ['F:14']).keys()].length, 2, 'the Notes frame is waived');
  assert.equal(textStyles(desktop, ['F:14']).has([...all.keys()][2]), false);
  assert.deepEqual([...textStyles(desktop, ['F:15']).values()].map((s) => s.nodes[0]), ['F:11', 'F:13'], 'a TEXT waiver on the legal line');
  assert.deepEqual([...textStyles(desktop, ['F:12']).values()].map((s) => s.nodes[0]), ['F:13', 'F:15'], 'a TEXT waiver speaks for its style, as an entry does');
  const module = floorBoxes.roots['F:1'].box;
  assert.ok([...textStyles(module).values()].some((s) => s.nodes.includes('F:3')), 'the documentation panel is enumerated');
  assert.ok(![...textStyles(module, ['F:2']).values()].some((s) => s.nodes.includes('F:3')), 'and a container waiver removes it');
});

check('mobileVariants: a COMPONENT or INSTANCE named mobile, at most 480 wide; a tablet and a 24px icon named mobile are not', () => {
  assert.deepEqual(mobileVariants(floorBoxes.roots['F:1'].box), [{ id: 'F:30', name: 'Card, Device=Mobile', w: 382, parent: { id: 'F:1', name: 'Card module' } }]);
  assert.deepEqual(mobileVariants(floorBoxes.roots['G:1'].box), [], 'a tablet instance and a 24px icon named mobile');
  const sized = (w, name = 'Device=Mobile', type = 'INSTANCE') => ({ id: `n${w}`, name, type, w, children: [] });
  const found = (...kids) => mobileVariants({ id: 'm', name: 'm', type: 'FRAME', w: 1440, children: kids }).map((v) => v.w);
  assert.deepEqual(found(sized(480), sized(481), sized(320), sized(319)), [480, 320], 'a mobile page is 320 to 480 wide');
  assert.deepEqual(found(sized(390, 'Mobile'), sized(390, 'mobile-nav'), sized(390, 'Mobilephone'), sized(390, 'Device=Tablet'), sized(390, 'Mobile', 'FRAME'), sized(390, 'Mobile', 'COMPONENT')), [390, 390, 390], 'the word, an instance or a component');
  assert.deepEqual(found({ ...sized(900, 'Tablet'), children: [sized(375)] }), [375], 'at any depth');
});

check('coverage floor: entries for every style at both widths validate, and coverage counts them', () => {
  const ok = floor(s03());
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.coverage, {
    s03: { styles: { covered: 5, total: 5 }, widths: [382, 1440], waived: 0 },
    s04: { styles: { covered: 2, total: 2 }, widths: [1440], waived: 0 },
  });
});

check('coverage floor: one uncovered style is exactly one problem, naming its width, style, text and node', () => {
  const lacking = floor(s03({ type: withoutType('t3') }));
  assert.deepEqual(lacking.problems, ['s03 @1440: text style 12/400/16 #666666 ("Legal text", node F:15) has no type entry or waiver']);
  assert.deepEqual(lacking.coverage.s03, { styles: { covered: 4, total: 5 }, widths: [382, 1440], waived: 0 });
  assert.deepEqual(floorProblems(s03({ type: withoutType('t5') })), ['s03 @382: text style 16/400/24 #333333 ("Body copy", node F:32) has no type entry or waiver']);
  assert.deepEqual(floorProblems(s03({ type: withoutType('t1') })), ['s03 @1440: text style 24/700/28.8 #ffffff ("Card title for the thir…", node F:11) has no type entry or waiver']);
});

check('coverage floor: a style is covered by an entry whose node has it, any node of that style, and only at the entry\'s width', () => {
  assert.deepEqual(floorProblems(s03({ type: [...withoutType('t1'), { id: 't1', selector: 'h3', node: 'F:12' }] })), [], 'F:12 shares the title style with F:11');
  assert.deepEqual(floorProblems(s03({ type: [...withoutType('t5'), { id: 't5', selector: 'p', node: 'F:13' }] })), ['s03 @382: text style 16/400/24 #333333 ("Body copy", node F:32) has no type entry or waiver'], 't5 now measures the 1440 copy: the 382 one is still open');
  assert.deepEqual(floorProblems(s03({ type: [...withoutType('t5'), { id: 't5', selector: 'p', node: 'F:13', width: 382 }] })), [
    't5: F:13 is not inside s03\'s root F:30',
    's03 @382: text style 16/400/24 #333333 ("Body copy", node F:32) has no type entry or waiver',
  ], 'an entry that cannot be resolved covers nothing');
});

check('coverage floor: every miss of every section and width is listed in one run', () => {
  const lost = floor(s03({ type: [] }), { s04: { ...s04, type: [] } }).problems;
  assert.equal(lost.filter((p) => /has no type entry or waiver/.test(p)).length, 5 + 2);
  assert.ok(lost.includes('s03 has no type checks: add one or "skip": "<why>"'));
});

check('coverage floor: a TEXT-node waiver and a container waiver each clear their styles and count as waived', () => {
  const text = floor(s03({ type: withoutType('t3'), waive: [{ node: 'F:15', why: 'legal line, set by the rich-text block' }] }));
  assert.deepEqual(text.problems, []);
  assert.deepEqual(text.coverage.s03, { styles: { covered: 4, total: 5 }, widths: [382, 1440], waived: 1 });
  assert.deepEqual(text.sections.s03.waive, [{ node: 'F:15', why: 'legal line, set by the rich-text block' }]);
  const container = floor(s03({ type: withoutType('t3'), waive: [{ node: 'F:14', why: 'the notes frame is documentation' }] }));
  assert.deepEqual(container.problems, []);
  assert.deepEqual(container.coverage.s03, { styles: { covered: 4, total: 5 }, widths: [382, 1440], waived: 1 });
  assert.equal(floor(s03({ waive: [{ node: 'F:15', why: 'x' }] })).coverage.s03.styles.covered, 5, 'an entry still counts as covering a waived style');
  assert.deepEqual(floorProblems(s03({ type: withoutType('t3', 't2'), waive: [{ node: 'F:15', why: 'legal' }] })), ['s03 @1440: text style 16/400/24 #333333 ("Body copy", node F:13) has no type entry or waiver'], 'a waiver clears what it names');
});

check('coverage floor: a waiver names a node inside one of the section\'s roots, one of node or width "mobile" | "desktop", and a why', () => {
  const w = (waive) => floorProblems(s03({ waive }));
  assert.deepEqual(w([{ node: 'F:15', why: '' }]), ['s03: waive[0] needs why']);
  assert.deepEqual(w([{ node: 'F:15' }]), ['s03: waive[0] needs why']);
  assert.deepEqual(w([{ node: 'F:15', width: 'mobile', why: 'both' }]), ['s03: waive[0] needs exactly one of node and width']);
  assert.deepEqual(w([{ why: 'neither' }]), ['s03: waive[0] needs exactly one of node and width']);
  assert.deepEqual(w([{ width: 390, why: 'a number' }]), ['s03: waive[0]: width must be "mobile" or "desktop"']);
  assert.deepEqual(w([{ width: 'tablet', why: 'not a class' }]), ['s03: waive[0]: width must be "mobile" or "desktop"']);
  assert.deepEqual(w([{ width: 'desktop', why: 'the page is shown at phone width only' }]), []);
  assert.deepEqual(w([{ node: 'F:99', why: 'typo' }]), ['s03: waive[0]: F:99 is not inside any of the section\'s roots']);
  assert.deepEqual(w([{ node: 'F:3', why: 'in the module frame, not in a root' }]), ['s03: waive[0]: F:3 is not inside any of the section\'s roots']);
  assert.deepEqual(w(['F:15']), ['s03: waive[0] must be { node | width: "mobile" | "desktop", why }']);
  assert.deepEqual(w({ node: 'F:15' }), ['s03: waive must be a list of { node | width: "mobile" | "desktop", why }']);
  assert.deepEqual(w([{ node: 'F:15', why: 'ok' }, { node: 'F:15', why: '  ' }]), ['s03: waive[1] needs why']);
});

check('coverage floor: a module with a mobile variant needs a mobile root or a { width: "mobile" } waiver', () => {
  const noMobile = { roots: undefined, type: withoutType('t4', 't5') };
  assert.deepEqual(floorProblems(s03(noMobile)), [MOBILE_LINE]);
  assert.deepEqual(floorProblems(s03({ ...noMobile, waive: [{ width: 'mobile', why: 'the card is not responsive: the page shows the desktop card scaled' }] })), []);
  assert.deepEqual(floor(s03({ ...noMobile, waive: [{ width: 'mobile', why: 'desktop-only card' }] })).coverage.s03, { styles: { covered: 3, total: 3 }, widths: [1440], waived: 1 });
  assert.deepEqual(floorProblems(s03({ ...noMobile, waive: [{ width: 'mobile', why: '' }] })), ['s03: waive[0] needs why']);
  assert.deepEqual(floorProblems(s03({ roots: { 360: 'F:30' }, type: [...withoutType('t4', 't5'), ...at382.map((e) => ({ ...e, width: 360 }))] })), [], 'any root up to 480 wide');
  assert.match(floorProblems(s03({ roots: { 768: 'F:20' }, type: [...withoutType('t4', 't5'), { id: 't6', selector: 'h3', node: 'F:21', width: 768 }] })).join('\n'), /module has a mobile variant/, 'a tablet-width root is not a mobile root');
});

// A module frame that holds several variant sets (a card and a hero, each with a desktop and a mobile variant): the mobile
// root is the one of the desktop root's own set.
const setsCtx = { join: { sections: [{ slot: 's05', module: 'M5', node: 'K:1' }] }, boxes: floorBoxes, tokens: {} };
const s05 = (over = {}) => ({
  node: 'K:11',
  geometry: [{ id: 'g1', selector: '.hero', node: 'K:12', measure: 'width' }],
  type: [{ id: 't1', selector: 'h1', node: 'K:12' }, { id: 't2', selector: '.kicker', node: 'K:15' }],
  ...over,
});
const inSets = (section) => validateChecks({ version: 1, page: 'home', sections: { s05: section } }, setsCtx);
const mobileType = [{ id: 't3', selector: 'h1', node: 'K:14', width: 414 }];

check('coverage floor: with several variant sets in the frame the mobile root is the one of the desktop root\'s own set, and a miss names it, with its parent, not an unrelated one', () => {
  assert.deepEqual(mobileCandidates(floorBoxes.roots['K:1'].box, floorBoxes.roots['K:11'].box), { list: [{ id: 'K:13', name: 'Device=Mobile', w: 414, parent: { id: 'K:10', name: 'Hero' } }], apart: true, total: 2 });
  assert.deepEqual(inSets(s05({ roots: { 414: 'K:13' }, type: [...s05().type, ...mobileType] })).problems, [], 'the hero\'s own mobile variant');
  assert.deepEqual(inSets(s05()).problems, ['s05: module has a mobile variant (Device=Mobile, 414 wide, K:13, in Hero) but no roots[<w>] ≤ 480 and no { width: "mobile" } waiver'], 'the card\'s variant comes first in the tree and is not named');
  const unrelated = inSets(s05({ roots: { 414: 'K:5' }, type: [...s05().type, { id: 't3', selector: 'h1', node: 'K:6', width: 414 }] })).problems;
  assert.deepEqual(unrelated, ['s05: roots[414] (Device=Mobile) is not one of the desktop root\'s own mobile variants (Device=Mobile (414 wide, K:13, in Hero)) and no { width: "mobile" } waiver'], 'another set\'s mobile variant is no pair for the hero');
  assert.deepEqual(inSets(s05({ waive: [{ width: 'mobile', why: 'the hero is not responsive' }] })).problems, []);
});

check('coverage floor: two styles that differ only in letter spacing or colour never print the same label', () => {
  const miss = inSets({ node: 'K:11', geometry: s05().geometry, type: [], waive: [{ width: 'mobile', why: 'covered elsewhere' }] }).problems.filter((p) => /has no type entry/.test(p));
  assert.deepEqual(miss, [
    's05 @1440: text style 40/700/46 ls 0.4 #ffffff ("Hero heading", node K:12) has no type entry or waiver',
    's05 @1440: text style 40/700/46 ls -0.4 #ffffff ("Hero kicker", node K:15) has no type entry or waiver',
  ]);
  const labels = [...textStyles(floorBoxes.roots['K:11'].box).values()].map((s) => s.label);
  assert.equal(new Set(labels).size, labels.length);
  const t = { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeightPx: 24, letterSpacing: 0, color: 'rgb(0, 0, 0)' };
  const labelOf = (over) => [...textStyles({ id: 'r', name: 'r', type: 'FRAME', w: 1, h: 1, text: null, children: [{ id: 'a', name: 'a', type: 'TEXT', w: 1, h: 1, children: [], text: { characters: 'x', ...t, ...over } }] }).values()][0].label;
  assert.equal(labelOf({}), '16/400/24 #000000', 'no letter spacing, nothing printed');
  assert.notEqual(labelOf({ color: 'rgb(1, 1, 1)' }), labelOf({}));
  assert.notEqual(labelOf({ letterSpacing: 0.5 }), labelOf({}));
});

check('coverage floor: when the box tree cannot tell the sets apart, every candidate is named with its parent', () => {
  const asFrame = inSets({ geometry: s05().geometry, type: [...s05().type, { id: 't0', selector: 'h2', node: 'K:4' }, { id: 't9', selector: 'h2', node: 'K:6' }], waive: [{ node: 'K:2', why: 'the card set is another module' }] }).problems;
  assert.ok(asFrame.includes('s05: module has a mobile variant (Device=Mobile, 414 wide, K:5, in Card; Device=Mobile, 414 wide, K:13, in Hero) but no roots[<w>] ≤ 480 and no { width: "mobile" } waiver; name the desktop instance in "node"'), asFrame.join('\n'));
});

check('coverage floor: a module with no mobile variant needs no mobile root (a tablet instance, a 24px icon named mobile)', () => {
  assert.deepEqual(floor(s03()).sections.s04.roots, { 1440: 'G:1' });
  assert.deepEqual(floor(s03()).problems, [], 's04 is the plain module: its frame holds a Device=Tablet instance and a 24px icon named mobile');
  assert.deepEqual(validateChecks(fixtureChecks, ctx).problems, [], 'and so is a kit module documented at one width');
});

check('coverage floor: a joined module frame as the root floods the floor, a container waiver drops a documentation panel, and the first style line and the mobile line say to name the desktop instance', () => {
  const HINT = '; name the desktop instance in "node"';
  const asRoot = (waive, type) => floorProblems({
    geometry: s03().geometry,
    type: type ?? [{ id: 't1', selector: 'h3', node: 'F:11' }, { id: 't2', selector: 'p', node: 'F:13' }, { id: 't3', selector: '.legal', node: 'F:15' }, { id: 't4', selector: 'h3', node: 'F:31' }],
    ...(waive ? { waive } : {}),
  });
  const flood = asRoot();
  assert.deepEqual(flood, [
    `s03 @1440: text style 12/500/16 #888888 ("Notation for spacing an…", node F:3) has no type entry or waiver${HINT}`,
    `${MOBILE_LINE}${HINT}`,
  ]);
  assert.deepEqual(asRoot([{ node: 'F:2', why: 'documentation panel: notation text, not the module' }]), [flood[1]]);
  const several = asRoot(undefined, [{ id: 't1', selector: 'h3', node: 'F:11' }, { id: 't4', selector: 'h3', node: 'F:31' }]).filter((p) => /has no type entry/.test(p));
  assert.equal(several.length, 3, 'the notation, the body copy and the legal line');
  assert.deepEqual(several.map((p) => p.endsWith(HINT)), [true, false, false], 'the hint is on the first style line only');
  assert.deepEqual(floorProblems(s03({ type: withoutType('t3') })), ['s03 @1440: text style 12/400/16 #666666 ("Legal text", node F:15) has no type entry or waiver'], 'a section whose root is an instance gets none');
});

check('roots: the base node and every roots[w] are the module frame or an outermost instance/variant: never a TEXT node, a frame, a nested instance or a node of another module', () => {
  const asNode = (node, over = {}) => floor({ node, width: 1440, geometry: [{ id: 'g1', selector: '.card', node: 'F:19', measure: 'width' }], type: [{ id: 't1', selector: 'p', node: 'F:19' }, ...at382], roots: { 382: 'F:30' }, ...over }).problems;
  assert.ok(asNode('F:18').includes(`s03 @1440: root F:18 (Card) is nested inside Card, Device=Desktop${TAIL}`), 'a card instance inside the desktop variant');
  assert.ok(floorProblems(s03({ node: 'F:11', width: 1440 })).includes(`s03 @1440: root F:11 (Card title for the third quarter) is a TEXT, not a component or instance${TAIL}`), 'a TEXT leaf as the base node');
  assert.ok(floorProblems(s03({ node: 'F:14', width: 1440 })).includes(`s03 @1440: root F:14 (Notes) is a FRAME, not a component or instance${TAIL}`), 'a frame inside the instance');
  assert.ok(floorProblems(s03({ node: 'F:2', width: 1440 })).includes(`s03 @1440: root F:2 (Documentation) is a FRAME, not a component or instance${TAIL}`), 'a documentation frame');
  assert.ok(floorProblems(s03({ node: 'G:1', width: 1440 })).includes(`s03 @1440: root G:1 (Plain module) is not inside the module frame F:1${TAIL}`), 'a frame of another module');
  assert.ok(floorProblems(s03({ roots: { 382: 'F:18' } })).includes(`s03 @382: root F:18 (Card) is nested inside Card, Device=Desktop${TAIL}`), 'every roots[w], not only the base');
});

check('roots: a mobile root that is a TEXT leaf passes nothing (a reviewed bypass: roots[375] = one mobile TEXT leaf and one type entry)', () => {
  const leaf = s03({ roots: { 375: 'F:31' }, type: [...withoutType('t4', 't5'), { id: 't6', selector: 'h3', node: 'F:31', width: 375 }] });
  const ps = floorProblems(leaf);
  assert.ok(ps.includes('s03 @375: root F:31 (Mobile title) is a TEXT, not a component or instance — name the module\'s outermost instance or variant'), ps.join('\n'));
  assert.ok(ps.some((p) => /^s03: roots\[375\] \(Mobile title\) is not one of the module's mobile variants \(Card, Device=Mobile \(382 wide, F:30\)\)/.test(p)), ps.join('\n'));
  const base = floorProblems(s03({ node: 'F:31', width: 375, roots: undefined, geometry: [{ id: 'g1', selector: 'h3', node: 'F:31', measure: 'width' }], type: [{ id: 't1', selector: 'h3', node: 'F:31' }] }));
  assert.ok(base.some((p) => /^s03 @375: root F:31 .* is a TEXT/.test(p)), 'the same shrink on the base node');
  assert.ok(base.some((p) => /is not one of the module's mobile variants/.test(p)));
});

check('roots: with a mobile variant in the module, a mobile root must be one of the variants; a waiver names the alternative', () => {
  const tablet = (over = {}) => s03({ roots: { 400: 'F:20' }, type: [...withoutType('t4', 't5'), { id: 't6', selector: 'h3', node: 'F:21', width: 400 }], ...over });
  assert.deepEqual(floorProblems(tablet()), ['s03: roots[400] (Card, Device=Tablet) is not one of the module\'s mobile variants (Card, Device=Mobile (382 wide, F:30)) and no { width: "mobile" } waiver'], 'an outermost instance, but not a mobile variant');
  assert.deepEqual(floorProblems(tablet({ waive: [{ width: 'mobile', why: 'the tablet layout serves phones as well' }] })), []);
  assert.deepEqual(floorProblems(tablet({ roots: { 400: 'F:20', 382: 'F:30' }, type: [...tablet().type, ...at382] })), [], 'one of the mobile roots is the variant');
  assert.deepEqual(floorProblems(s03()), [], 'the Device=Desktop instance as node and the Device=Mobile variant as roots[382]');
});

check('roots: the module frame as the root is legitimate; with a variant as the mobile root and its documentation waived it validates', () => {
  const asModule = {
    roots: { 382: 'F:30' },
    geometry: s03().geometry,
    type: [{ id: 't1', selector: 'h3', node: 'F:11' }, { id: 't2', selector: 'p', node: 'F:13' }, { id: 't3', selector: '.legal', node: 'F:15' }, { id: 't6', selector: 'h3', node: 'F:21' }, ...at382],
    waive: [{ node: 'F:2', why: 'documentation panel: notation text, not the module' }],
  };
  assert.deepEqual(floorProblems(asModule), []);
  assert.deepEqual(floor(asModule).sections.s03.roots, { 382: 'F:30', 1440: 'F:1' });
});


check('roots (a): a root is at least half as wide as the width it is checked at; a legend chip is no 1440 root, a content-width instance is', () => {
  const asBase = (node, own) => floor({ node, width: 1440, roots: { 382: 'F:30' }, geometry: [{ id: 'g1', selector: '.x', node: own, measure: 'width' }], type: [{ id: 't1', selector: 'p', node: own }, ...at382] }).problems;
  assert.deepEqual(asBase('F:50', 'F:51'), [`s03 @1440: root F:50 (Legend chip) is 120 wide, under half of 1440${TAIL}`], 'a chip as the base node: one text style, covered, and nothing else checked');
  assert.deepEqual(asBase('F:60', 'F:61'), [], 'an instance 1184 wide under 1440');
  assert.deepEqual(asBase('F:62', 'F:63'), [], 'exactly half');
  assert.deepEqual(asBase('F:64', 'F:65'), [`s03 @1440: root F:64 (Card, just under half) is 719 wide, under half of 1440${TAIL}`], 'a pixel under half');
  const mobile = floorProblems(s03({ roots: { 382: 'F:30', 1000: 'F:30' }, type: [...s03().type, ...at382.map((e) => ({ ...e, id: `${e.id}b`, width: 1000 }))] }));
  assert.deepEqual(mobile, [`s03 @1000: root F:30 (Card, Device=Mobile) is 382 wide, under half of 1000${TAIL}`], 'every roots[w]');
});

check('roots (b): at least one root is checked wider than 480, the base root counts, unless { width: "desktop", why } waives it', () => {
  const mobileOnly = (over = {}) => s03({ node: 'F:30', roots: undefined, type: at382, geometry: [{ id: 'g1', selector: '.card', node: 'F:31', measure: 'width' }], ...over });
  const LINE = 's03: no root is checked wider than 480 (382) and no { width: "desktop" } waiver';
  assert.deepEqual(floorProblems(mobileOnly()), [LINE], 'node = the mobile variant only, a reviewed bypass');
  assert.deepEqual(floorProblems(mobileOnly({ roots: { 400: 'F:30' }, type: [...at382, ...at382.map((e) => ({ ...e, id: `${e.id}b`, width: 400 }))] })), [`s03: no root is checked wider than 480 (382, 400) and no { width: "desktop" } waiver`]);
  const waived = floor(mobileOnly({ waive: [{ width: 'desktop', why: 'the card is only ever shown at phone width' }] }));
  assert.deepEqual(waived.problems, []);
  assert.deepEqual(waived.coverage.s03, { styles: { covered: 2, total: 2 }, widths: [382], waived: 1 });
  assert.deepEqual(floorProblems(mobileOnly({ waive: [{ width: 'desktop', why: '' }] })), ['s03: waive[0] needs why']);
  assert.deepEqual(floorProblems(s03()), [], 'the desktop instance as node: its width, 1440, is a non-mobile root');
  const wide = floorProblems(mobileOnly({ roots: { 1200: 'F:62' }, type: [...at382, { id: 't6', selector: 'p', node: 'F:63', width: 1200 }] }));
  assert.deepEqual(wide, [], 'a roots[w] above 480 counts as well as the base root');
  assert.deepEqual(validateChecks({ version: 1, page: 'home', sections: { s03: { ...mobileOnly(), skip: 'static', waive: undefined }, s04 } }, floorCtx).problems, [], 'a skipped section has no floor');
});

check('roots (c): a root with no visible text style after waivers is a problem unless the module frame has none', () => {
  const LINE = (id, name) => `s03 @1440: root ${id} (${name}) holds no text style to check (after waivers) and the module frame has some${TAIL}`;
  const backdrop = floorProblems({ node: 'F:40', width: 1440, roots: { 382: 'F:30' }, geometry: [{ id: 'g1', selector: '.bg', node: 'F:40', measure: 'width' }], type: at382 });
  assert.deepEqual(backdrop, [LINE('F:40', 'Backdrop')], 'a text-less 1440 component plus the mobile variant, a reviewed bypass: nothing at 1440 was asked for');
  const allWaived = floorProblems(s03({ waive: [{ node: 'F:11', why: 'title' }, { node: 'F:13', why: 'body' }, { node: 'F:15', why: 'legal' }] }));
  assert.deepEqual(allWaived, [LINE('F:10', 'Card, Device=Desktop')], 'every style waived leaves nothing to check: skip says it');
  assert.deepEqual(floorProblems(s03({ waive: [{ node: 'F:15', why: 'legal' }] })), [], 'some left');
  const imageOnly = { join: { sections: [{ slot: 's05', module: 'M5', node: 'H:1' }] }, boxes: floorBoxes, tokens: {} };
  const check5 = (section) => validateChecks({ version: 1, page: 'home', sections: { s05: section } }, imageOnly);
  assert.deepEqual(check5({ geometry: [{ id: 'g1', selector: 'img', node: 'H:2', measure: 'width' }], type: [] }).problems, ['s05 has no type checks: add one or "skip": "<why>"'], 'no text style anywhere: nothing to find at the root');
  assert.deepEqual(check5({ skip: 'an image-only module', geometry: [], type: [] }).problems, []);
  const skipped = validateChecks({ version: 1, page: 'home', sections: { s03: { skip: 'static banner', node: 'F:40', width: 1440, geometry: [], type: [] }, s04 } }, floorCtx);
  assert.deepEqual(skipped.problems, [], 'a skipped section has no floor');
});

check('roots (d): the base node is checked even when roots[<its width>] replaces it, and the section\'s root is the one checked at the base width', () => {
  const hidden = (node, over = {}) => floor({
    node, width: 1440, roots: { 1440: 'F:10', 382: 'F:30' },
    geometry: [{ id: 'g1', selector: '.card', node: 'F:11', measure: 'width' }],
    type: [{ id: 't1', selector: 'h3', node: 'F:11' }, { id: 't2', selector: 'p', node: 'F:13' }, { id: 't3', selector: '.legal', node: 'F:15' }, ...at382],
    ...over,
  });
  const chip = hidden('F:50');
  assert.deepEqual(chip.problems, [`s03 @1440: root F:50 (Legend chip) is 120 wide, under half of 1440${TAIL}`], 'a chip as node, hidden by roots[1440]');
  assert.equal(chip.sections.s03.root, 'F:10', 'the root actually checked at 1440');
  assert.ok(hidden('F:11').problems.includes(`s03 @1440: root F:11 (Card title for the third quarter) is a TEXT, not a component or instance${TAIL}`), 'a TEXT node hidden the same way');
  assert.ok(hidden('F:18').problems.includes(`s03 @1440: root F:18 (Card) is nested inside Card, Device=Desktop${TAIL}`), 'a nested instance hidden the same way');
  assert.equal(floor(s03()).sections.s03.root, 'F:10');
  assert.equal(floor(s03({ node: undefined, roots: { 1440: 'F:10', 382: 'F:30' }, width: 1440 })).sections.s03.root, 'F:10', 'the module frame as the unnamed node, replaced by roots[1440]');
  assert.deepEqual(hidden('F:10').problems, [], 'the same node twice is fine');
});

check('coverage floor: skip waives the floor and is counted as a waiver; coverage still reports what the root holds', () => {
  const skippedAll = validateChecks({ version: 1, page: 'home', sections: { s03: { skip: 'static banner', node: 'F:10', geometry: [], type: [] }, s04 } }, floorCtx);
  assert.deepEqual(skippedAll.problems, []);
  assert.deepEqual(skippedAll.coverage.s03, { styles: { covered: 0, total: 3 }, widths: [1440], waived: 1 });
});

const S = 'main section[data-slot="s02"]';
const P = 'main > div:nth-child(3)';

check('scopeSelector: a plain selector is a descendant of the section, :scope is the section, and a :scope branch keeps its combinator', () => {
  assert.equal(scopeSelector(S, '.card'), `${S} .card`);
  assert.equal(scopeSelector(S, 'h2 + p'), `${S} h2 + p`);
  assert.equal(scopeSelector(S, ':scope'), S);
  assert.equal(scopeSelector(S, ':scope > div'), `${S} > div`);
  assert.equal(scopeSelector(S, ':scope > .x .y'), `${S} > .x .y`);
  assert.equal(scopeSelector(S, ':scope  .y'), `${S}  .y`);
  assert.equal(scopeSelector(S, ':scope.open'), `${S}.open`);
  assert.equal(scopeSelector(S, ':SCOPE > p'), `${S} > p`);
  assert.equal(scopeSelector(P, ':scope > div'), `${P} > div`);
  assert.equal(scopeSelector(S, '> p'), `${S} > p`);
  assert.equal(scopeSelector(S, ':scoped-thing'), `${S} :scoped-thing`, ':scope is a whole pseudo-class name');
});

check('scopeSelector: every top-level branch of a comma list is scoped; a comma inside :is(), :where(), :not(), an attribute value or a string stays', () => {
  assert.equal(scopeSelector(S, '.a, .b'), `${S} .a, ${S} .b`);
  assert.equal(scopeSelector(S, ':scope > .a,\n .b .c , :scope'), `${S} > .a, ${S} .b .c, ${S}`);
  assert.equal(scopeSelector(S, ':is(.a, .b) > p'), `${S} :is(.a, .b) > p`);
  assert.equal(scopeSelector(S, '.x:where(.a, .b), .y:not(.c, .d)'), `${S} .x:where(.a, .b), ${S} .y:not(.c, .d)`);
  assert.equal(scopeSelector(S, 'a[title="x, y"], a[title=\'p,q\']'), `${S} a[title="x, y"], ${S} a[title='p,q']`);
  assert.equal(scopeSelector(S, 'a[title="a\\"b, c"], i'), `${S} a[title="a\\"b, c"], ${S} i`);
  assert.equal(scopeSelector(S, '.a\\,b, .c'), `${S} .a\\,b, ${S} .c`);
  assert.equal(scopeSelector(S, ':is(.a, :is(.b, .c)), .d'), `${S} :is(.a, :is(.b, .c)), ${S} .d`);
});

check('scopeSelector: a stray comma stays an invalid selector instead of becoming the section', () => {
  assert.equal(scopeSelector(S, '.a,'), `${S} .a, `);
  assert.equal(scopeSelector(S, ', .a'), `, ${S} .a`);
  assert.deepEqual(selectorBranches('a, b'), ['a', ' b']);
  assert.deepEqual(selectorBranches(':is(a, b'), [':is(a, b'], 'an unbalanced (…) is one branch, and the browser rejects it');
});

check('leavesSection: a branch whose first combinator, after any :scope and its compound, is a sibling one reaches outside the section', () => {
  for (const ok of ['.a, :scope', ':scope', ':scope > .a', ':scope .a ~ .b', '> p', '.a + .b', ':is(.a, .b) ~ p', ':scope > .a, .b ~ .c', ':scoped + p', ':scope[title="a +b"] > p']) assert.equal(leavesSection(ok), null, ok);
  for (const bad of [':scope + p', ':scope~p', ':scope.x ~ p', ':scope:not(.x, .y) + p', '+ p', '.a, ~ p', ':scope > .a, :scope + p']) assert.match(leavesSection(bad), /reaches the section's siblings/, bad);
  assert.match(leavesSection('.a, ~ p'), /^selector "~ p" reaches/);
});

check('a selector or previewSelector that reaches the section\'s siblings is a problem, naming the entry', () => {
  assert.equal(problemsOf(geo({ selector: ':scope > .card', node: 'I1:7;5:7', measure: 'width' })), '');
  assert.equal(problemsOf(geo({ selector: '.card, :scope', node: 'I1:7;5:7', measure: 'width' })), '');
  assert.match(problemsOf(geo({ selector: ':scope + .card', node: 'I1:7;5:7', measure: 'width' })), /^x: selector ":scope \+ \.card" reaches the section's siblings/);
  assert.match(problemsOf(geo({ selector: '.card', previewSelector: '.a, ~ .b', node: 'I1:7;5:7', measure: 'width' })), /^x: previewSelector: selector "~ \.b" reaches the section's siblings/);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
