#!/usr/bin/env node
// skills/reskin/scripts/test/figma-pages.test.mjs — every page of a Figma-only site and its kit (M4):
// figma/pages.mjs (canvas groups, page discovery from variant sets and standalone frames, homes, the kit
// registry, module seed, unused kit, chrome page), the content model's kit binding (figma/content.mjs kit,
// content-run.mjs kitResolver), pages-run.mjs runPages/runContentAll against a stub client, mappingSeed,
// stream-render kitAttrs and the CLI's --help.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blockNameOf, breakpointOf, buildKitRegistry, chromeSource, classifyCanvases, compileKit, discoverPages, figmaName, homesFrom,
  instanceKit, KIT_GROUPS, kitLibrary, libraryEds, linkMap, markerName, moduleSeed, offKitEds, pageSlug, parseVariant, setClass, topInstances,
  unusedKit, variantClasses,
} from '../figma/pages.mjs';
import { buildContentModel } from '../figma/content.mjs';
import { kitResolver, locate, runInit } from '../figma/content-run.mjs';
import { runContentAll, runPages } from '../figma/pages-run.mjs';
import { kitAttrs } from '../stream-render.mjs';
import * as stateLib from '../../../stardust/scripts/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
let failures = 0;
let passes = 0;
async function test(name, fn) {
  try { await fn(); passes += 1; console.log(`ok   ${name}`); } catch (e) { failures += 1; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); }
}

// ---- synthetic Figma nodes -----------------------------------------------------------------------------------
const bb = (x, y, width, height) => ({ absoluteBoundingBox: { x, y, width, height } });
const T = (id, characters, x, y, w, h) => ({ id, type: 'TEXT', name: characters.slice(0, 20), characters, style: { fontSize: 16 }, ...bb(x, y, w, h) });
const F = (id, name, x, y, w, h, children = [], type = 'FRAME') => ({ id, type, name, children, ...bb(x, y, w, h) });
const I = (id, name, componentId, x, y, w, h, children = []) => ({ id, type: 'INSTANCE', name, componentId, children, ...bb(x, y, w, h) });

// The One AZ v3.2 canvas list, abbreviated (names as the file has them).
const CANVASES = [
  ['0:1', '👋 WELCOME'], ['0:2', '🕚 Changelog'], ['0:3', '---'],
  ['1:0', 'FOUNDATIONS'], ['1:1', '    ↪ Typography'], ['1:2', '    ↪ Colors'],
  ['2:0', 'COMPONENTS'], ['2:1', '    ❖ Button'], ['2:2', '    ❖ Modal'], ['2:3', '    ❖ Tabs'],
  ['3:0', 'TEMPLATE SECTIONS'], ['3:1', '    ❏ Header'], ['3:2', '    ❏ Footer'], ['3:3', '    ❏ Block Content'], ['3:4', '    ❏ Quiz'],
  ['4:0', 'FULL PAGES'], ['4:1', '    --- Login & Registration'], ['4:2', '    --- Overlays'],
].map(([id, name]) => ({ id, name }));

// components: header (set H, 2 variants), footer (lone component), block content (set B), modal (set M)
const MAPS = {
  components: {
    'h:full': { name: 'Type=Full, Breakpoint=Desktop', componentSetId: 'H' },
    'h:reg': { name: 'Type=Registration, Breakpoint=Desktop', componentSetId: 'H' },
    'h:reg-m': { name: 'Type=Registration, Breakpoint=Mobile', componentSetId: 'H' },
    foot: { name: 'Footer' },
    'b:d': { name: 'Breakpoint=Desktop', componentSetId: 'B' },
    'm:d': { name: 'Type=Text Only, Alignment=Horizontal', componentSetId: 'M' },
  },
  componentSets: { H: { name: 'Header' }, B: { name: 'Block Content' }, M: { name: 'Modal' } },
};
const header = (id, comp = 'h:reg', y = 0) => I(id, 'Header', comp, 0, y, 1440, 80, [T(`${id}t`, 'Brand', 20, y + 20, 100, 24)]);
const footer = (id, y) => I(id, 'Footer', 'foot', 0, y, 1440, 100, [T(`${id}t`, 'Legal line', 20, y + 20, 200, 20)]);
const blockContent = (id, y, text) => I(id, 'Block Content', 'b:d', 120, y, 1200, 200, [T(`${id}t`, text, 140, y + 20, 600, 40)]);
const pageFrame = (id, name, kids, w = 1440) => F(id, name, 0, 0, w, 1200, kids, 'COMPONENT');

function fixture() {
  const login = pageFrame('10:1', 'Type=Login Landing, Breakpoint=Desktop', [header('10:2', 'h:full'), blockContent('10:3', 200, 'Welcome back'), footer('10:4', 1000)]);
  const loginM = pageFrame('10:5', 'Type=Login Landing, Breakpoint=Mobile', [header('10:6', 'h:reg-m'), blockContent('10:7', 200, 'Welcome back'), footer('10:8', 1000)], 375);
  const reg = pageFrame('11:1', 'Type=Registration, Breakpoint=Desktop', [header('11:2'), blockContent('11:3', 200, 'Create account'), blockContent('11:4', 500, 'Your details'), footer('11:5', 1000)]);
  const forgot = pageFrame('12:1', 'Type=Forgot Password, Breakpoint=Desktop', [header('12:2'), F('12:9', 'Wrapper', 0, 100, 1440, 400, [blockContent('12:3', 200, 'Reset it')]), footer('12:5', 1000)]);
  const set = { id: '9:1', type: 'COMPONENT_SET', name: 'Page: Login & Registration', children: [login, loginM, reg, forgot], ...bb(0, 0, 5000, 5000) };
  const doc = F('9:2', 'Page: Login & Registration', 0, -900, 800, 600);
  const overlay = pageFrame('20:1', 'Inactivity Desktop', [I('20:2', 'Modal', 'm:d', 400, 300, 640, 300, [T('20:3', 'Still there?', 420, 320, 300, 30)])]);
  const overlayM = pageFrame('20:4', 'Inactivity - Mobile', [I('20:5', 'Modal', 'm:d', 10, 300, 355, 300, [T('20:6', 'Still there?', 20, 320, 300, 30)])], 375);
  const cover = F('20:9', 'Cover', 0, -900, 800, 600);
  return { login, loginM, reg, forgot, set, doc, overlay, overlayM, cover };
}
const kit = compileKit({});
const classified = () => classifyCanvases(CANVASES, kit);
const canvasNodes = (fx, cs = classified()) => [
  { canvas: cs.find((c) => c.id === '4:1'), children: [fx.doc, fx.set] },
  { canvas: cs.find((c) => c.id === '4:2'), children: [fx.cover, fx.overlay, fx.overlayM] },
];
const responseFor = (frames) => ({ name: 'File', version: '7', nodes: Object.fromEntries(frames.map((f) => [f.id, { document: f, ...MAPS }])) });
// The kit canvases' documents (sets inside a documentation frame, as One AZ draws them).
const SET = (id, name, variants) => ({ id, type: 'COMPONENT_SET', name, children: variants.map((v, i) => ({ id: `${id}.${i}`, type: 'COMPONENT', name: v, children: [] })) });
const KIT_DOCS = {
  '2:1': F('2:1d', 'Button docs', 0, 0, 1, 1, [SET('BTN', 'Button', ['Size=Medium, Type=Primary'])]),
  '2:2': F('2:2d', 'Modal docs', 0, 0, 1, 1, [F('2:2w', 'Wrap', 0, 0, 1, 1, [SET('M', 'Modal', ['Type=Text Only, Alignment=Horizontal'])])]),
  '2:3': F('2:3d', 'Tabs docs', 0, 0, 1, 1, [SET('TB', '.Tabs base', ['State=On']), SET('TG', 'Tabs Group', ['Count=2'])]),
  '3:1': F('3:1d', 'Header docs', 0, 0, 1, 1, [SET('HA', '.Header / Actions', ['State=A']), SET('H', 'Header', ['Type=Full, Breakpoint=Desktop', 'Type=Registration, Breakpoint=Desktop'])]),
  '3:2': F('3:2d', 'Footer docs', 0, 0, 1, 1, [{ id: 'foot', type: 'COMPONENT', name: 'Footer', children: [] }]),
  '3:3': F('3:3d', 'Block docs', 0, 0, 1, 1, [SET('B', 'Block Content', ['Breakpoint=Desktop']), SET('BC', '.Buttons Collage', ['Alignment=Center'])]),
  '3:4': F('3:4d', 'Quiz docs', 0, 0, 1, 1, [F('3:4n', 'Notes', 0, 0, 1, 1)]),
};
const libraryOf = (cs = classified(), k = kit) => kitLibrary(cs.filter((c) => KIT_GROUPS.includes(c.group) && !c.marker).map((c) => ({ canvas: c, document: KIT_DOCS[c.id] })), k);
const HOMES = { H: { canvasId: '3:1', canvasName: '❏ Header', group: 'template' }, foot: { canvasId: '3:2', canvasName: '❏ Footer', group: 'template' }, B: { canvasId: '3:3', canvasName: '❏ Block Content', group: 'template' }, M: { canvasId: '2:2', canvasName: '❖ Modal', group: 'component' } };

// ---- canvases ------------------------------------------------------------------------------------------------
await test('classifyCanvases: markers group the indented canvases; prefix glyphs win; welcome/changelog/dividers stay ungrouped', () => {
  const g = Object.fromEntries(classified().map((c) => [c.id, c.group]));
  assert.equal(g['0:1'], null); assert.equal(g['0:2'], null); assert.equal(g['0:3'], null);
  assert.equal(g['1:0'], 'foundation'); assert.equal(g['1:2'], 'foundation');
  assert.equal(g['2:1'], 'component'); assert.equal(g['3:3'], 'template');
  assert.equal(g['4:0'], 'pages'); assert.equal(g['4:1'], 'pages'); assert.equal(g['4:2'], 'pages');
  assert.ok(classified().find((c) => c.id === '4:0').marker);
});

await test('classifyCanvases: rules.kit.canvases overrides a canvas; an unknown group is refused', () => {
  const k = compileKit({ kit: { canvases: { '0:1': 'pages' } } });
  assert.equal(classifyCanvases(CANVASES, k).find((c) => c.id === '0:1').group, 'pages');
  assert.throws(() => compileKit({ kit: { canvases: { '0:1': 'stuff' } } }), /not one of/);
});

await test('markerName / parseVariant / breakpointOf / pageSlug', () => {
  assert.equal(markerName('    --- Login & Registration'), 'login registration');
  assert.equal(markerName('❖ Button'), 'button');
  assert.deepEqual(parseVariant('Type=Login Landing, Breakpoint=Desktop'), [['Type', 'Login Landing'], ['Breakpoint', 'Desktop']]);
  assert.equal(parseVariant('Header'), null);
  assert.equal(breakpointOf('Mobile'), 'mobile');
  assert.equal(breakpointOf(null, 768), 'tablet');
  assert.equal(breakpointOf(null, 1440), 'desktop');
  assert.equal(pageSlug('3rd Party Login'), '3rd-party-login');
  assert.equal(pageSlug('Terms & Conditions'), 'terms-and-conditions');
});

// ---- pages ---------------------------------------------------------------------------------------------------
await test('discoverPages: a page set → one page per non-breakpoint value, breakpoints paired, documentation skipped', () => {
  const fx = fixture();
  const { pages, skipped } = discoverPages(canvasNodes(fx), kit);
  assert.deepEqual(pages.map((p) => p.slug), ['login-landing', 'registration', 'forgot-password', 'inactivity']);
  const ll = pages[0];
  assert.equal(ll.frame, '10:1'); assert.equal(ll.responsive, '10:5');
  assert.deepEqual(Object.keys(ll.variants), ['desktop', 'mobile']);
  assert.equal(ll.template, 'login-and-registration');
  assert.equal(pages[1].responsive, null);
  assert.ok(skipped.some((s) => s.node === '9:2' && /beside the page component set/.test(s.why)));
  assert.ok(skipped.some((s) => s.node === '20:9' && /exclude/.test(s.why)));
});

await test('discoverPages: standalone frames pair by name with breakpoint words stripped', () => {
  const fx = fixture();
  const p = discoverPages(canvasNodes(fx), kit).pages.find((x) => x.slug === 'inactivity');
  assert.equal(p.frame, '20:1'); assert.equal(p.responsive, '20:4');
  assert.equal(p.template, 'overlays');
});

await test('discoverPages: a duplicate breakpoint is skipped with the kept id; slugs stay unique', () => {
  const fx = fixture();
  const dup = { ...fx.reg, id: '11:9' };
  fx.set.children.push(dup);
  const { pages, skipped } = discoverPages(canvasNodes(fx), kit);
  assert.equal(pages.filter((p) => p.slug === 'registration').length, 1);
  assert.ok(skipped.some((s) => s.node === '11:9' && /second desktop frame/.test(s.why) && /11:1/.test(s.why)));
});

await test('linkMap: every breakpoint variant resolves to its page slug', () => {
  const links = linkMap(discoverPages(canvasNodes(fixture()), kit).pages);
  assert.equal(links['10:1'], 'login-landing'); assert.equal(links['10:5'], 'login-landing'); assert.equal(links['20:4'], 'inactivity');
});

// ---- kit -----------------------------------------------------------------------------------------------------
await test('topInstances: wrappers descended, hidden skipped, reading order', () => {
  const fx = fixture();
  fx.forgot.children.push({ ...blockContent('12:8', 600, 'hidden'), visible: false });
  assert.deepEqual(topInstances(fx.forgot).map((n) => n.id), ['12:2', '12:3', '12:5']);
});

await test('instanceKit / blockNameOf / variantClasses: set identity, block-valid names, breakpoint and default values dropped', () => {
  assert.equal(instanceKit({ componentId: 'h:full' }, MAPS).key, 'H');
  assert.equal(instanceKit({ componentId: 'foot' }, MAPS).key, 'foot');
  assert.equal(instanceKit({ componentId: 'nope' }, MAPS).set, null);
  assert.equal(blockNameOf('.Buttons Collage', 'x'), 'buttons-collage');
  assert.equal(blockNameOf('🔥', '1:2'), 'kit-1-2');
  assert.deepEqual(variantClasses([['Type', 'Text Only'], ['Breakpoint', 'Desktop'], ['Status', 'Default']], kit), ['text-only']);
  assert.deepEqual(variantClasses([['Type', 'Desktop']], kit), []);
});

await test('homesFrom: the canvas an id sits on, with its group', () => {
  const file = { document: { children: [{ id: '3:1', name: '❏ Header', children: [{ id: 'X', children: [{ id: 'H', children: [] }] }] }, { id: '2:2', name: '❖ Modal', children: [{ id: 'M' }] }] } };
  const homes = homesFrom(file, ['H', 'M', 'Q'], classified());
  assert.deepEqual(homes.H, { canvasId: '3:1', canvasName: '❏ Header', group: 'template' });
  assert.equal(homes.M.group, 'component');
  assert.equal(homes.Q, undefined);
});

await test('kitLibrary: every template/component canvas is a block — public sets are variants, "." sets parts; empty canvases listed', () => {
  const lib = libraryOf();
  assert.deepEqual(lib.blocks.map((b) => b.block), ['button', 'modal', 'tabs', 'header', 'footer', 'block-content']);
  const tabs = lib.blocks.find((b) => b.block === 'tabs');
  assert.equal(tabs.set.id, 'TG', 'the main set is the first public one');
  assert.deepEqual(tabs.parts.map((p) => p.name), ['.Tabs base']);
  assert.deepEqual(lib.blocks.find((b) => b.block === 'header').sets.map((x) => x.class), [null], 'one public set: no class');
  assert.deepEqual(lib.index.BC, { block: 'block-content', class: 'buttons-collage', part: true });
  assert.deepEqual(lib.empty.map((e) => e.name), ['❏ Quiz']);
  assert.equal(setClass('Teaser / Card', 'teaser'), 'card');
  assert.equal(setClass('Header', 'header'), null);
});

await test('kitLibrary: each kit block carries its EDS name (deploy Step 2); several canvases on one EDS block are its variants', () => {
  const lib = libraryOf();
  assert.deepEqual(lib.blocks.map((b) => `${b.figma}→${b.eds.block}${b.eds.variant ? `(${b.eds.variant})` : ''}`), ['Button→null', 'Modal→modal', 'Tabs→tabs', 'Header→header', 'Footer→footer', 'Block Content→null']);
  const canvas = (id, name) => ({ canvas: { id, name, group: 'component', marker: false }, document: F(`${id}d`, 'docs', 0, 0, 1, 1, [SET(`S${id}`, name.replace(/^\W+/, ''), ['State=On'])]) });
  const kitd = kitLibrary([canvas('5:1', '❖ Q&A'), canvas('5:2', '❖ Teaser'), canvas('5:3', '❖ Input'), canvas('5:4', '❖ Dropdown'), canvas('5:5', '❖ Chips'), canvas('5:6', '❖ Card'), canvas('5:7', '❖ Cards')], kit).blocks;
  assert.deepEqual(kitd.map((b) => [b.block, b.eds.block, b.eds.variant]), [
    ['q-a', 'accordion', null], ['teaser', 'cards', 'teaser'], ['input', 'form', null], ['dropdown', 'form', null], ['chips', 'chips', null], ['card', 'cards', null], ['cards', 'cards', 'cards'],
  ], 'Q&A → accordion, Teaser → cards (teaser), Input/Dropdown → form (field rows, no variant), Chips keeps its name; a second plain cards becomes a variant, never cards-2');
  assert.equal(figmaName('❖ Q&A'), 'Q&A');
  assert.deepEqual(libraryEds([{ block: 'x', eds: { block: 'tabs', variant: 'nav', reason: 'r' } }]), [{ block: 'tabs', variant: 'nav', reason: 'r' }], 'a recorded eds is kept');
});

await test('offKitEds: an off-kit set joins the EDS block it maps to (kit or EDS), else default content — never a new block', () => {
  const blocks = kitLibrary([{ canvas: { id: '6:1', name: '❖ Teaser', group: 'component', marker: false }, document: F('6:1d', 'docs', 0, 0, 1, 1, [SET('T6', 'Teaser', ['State=On'])]) }], kit).blocks;
  assert.deepEqual(offKitEds('Product Card', 'product-card', blocks), { block: 'cards', variant: 'product-card', reason: offKitEds('Product Card', 'product-card', blocks).reason });
  assert.equal(offKitEds('FAQ', 'faq', blocks).block, 'accordion', 'a Block Collection block the kit lacks');
  assert.equal(offKitEds('Promo Ribbon', 'promo-ribbon', blocks).block, null);
  assert.equal(offKitEds('Link', 'link', blocks).block, null);
  assert.equal(offKitEds('Teaser', 'teaser-2', blocks).variant, 'teaser-2', 'the same EDS variant again: a distinct variant');
});

await test('kitLibrary: blockPer "set" makes one block per public set; bad blockPer/depth refused', () => {
  const perSet = compileKit({ kit: { blockPer: 'set' } });
  assert.deepEqual(libraryOf(classified(), perSet).blocks.map((b) => b.block), ['button', 'modal', 'tabs', 'header', 'footer', 'block-content'], 'one public set per canvas: unchanged');
  const toggle = { canvas: { id: '2:9', name: '❖ Toggle', group: 'component', marker: false }, document: F('2:9d', 'Toggle docs', 0, 0, 1, 1, [SET('TS', 'Toggle switches', ['On=true']), SET('TGR', 'Toggle group', ['Count=2']), SET('TK', '.Knob', ['On=true'])]) };
  assert.deepEqual(kitLibrary([toggle], kit).blocks.map((b) => [b.block, b.sets.map((x) => x.class)]), [['toggle', ['switches', 'group']]]);
  const split = kitLibrary([toggle], perSet).blocks;
  assert.deepEqual(split.map((b) => [b.block, b.parts.length]), [['toggle-switches', 1], ['toggle-group', 0]]);
  assert.throws(() => compileKit({ kit: { blockPer: 'page' } }), /blockPer/);
  assert.throws(() => compileKit({ kit: { depth: 40 } }), /depth/);
});

await test('buildKitRegistry: the whole library ships, pages bind only what they instance — by EDS block (deploy Step 2), off-kit sets to default content', () => {
  const fx = fixture();
  MAPS.components.x = { name: 'Loose' };
  fx.forgot.children.push(I('12:7', 'Loose', 'x', 0, 700, 100, 100, [T('12:8', 'Loose', 0, 700, 50, 20)]));
  const { pages } = discoverPages(canvasNodes(fx), kit);
  const r = responseFor([fx.login, fx.loginM, fx.reg, fx.forgot, fx.overlay, fx.overlayM]);
  const reg = buildKitRegistry({ pages, frameOf: (id) => locate([r], id), homes: { x: { canvasId: '0:1', canvasName: '👋 WELCOME', group: null } }, kit, library: libraryOf() });
  delete MAPS.components.x;
  assert.deepEqual(reg.blocks.map((b) => `${b.module}:${b.block}:${b.used ? 'used' : '-'}`), ['M1:button:-', 'M2:modal:used', 'M3:tabs:-', 'M4:header:used', 'M5:footer:used', 'M6:block-content:used', 'M7:loose:used']);
  const h = reg.blocks.find((b) => b.block === 'header');
  assert.deepEqual(h.variants, [['full'], ['registration']]);
  assert.deepEqual(h.usedBy, ['login-landing', 'registration', 'forgot-password']);
  assert.equal(reg.blocks.find((b) => b.block === 'block-content').instances, 4);
  assert.deepEqual(reg.bindings.registration.map((b) => `${b.block ?? 'default content'}/${b.module}`), ['header/M4', 'default content/M6', 'default content/M6', 'footer/M5'], 'Block Content is default content (D1): no block');
  assert.deepEqual(reg.bindings.registration.map((b) => b.kit), ['header', 'block-content', 'block-content', 'footer']);
  assert.ok(reg.bindings.registration[1].defaultContent);
  assert.deepEqual(reg.bindings.inactivity.map((b) => `${b.block}:${b.variant.join(' ')}`), ['modal:text-only horizontal']);
  assert.deepEqual(reg.blocks.map((b) => b.eds.block), [null, 'modal', 'tabs', 'header', 'footer', null, null], 'Button, Block Content: D1; Loose: off-kit, no EDS match');
  assert.deepEqual(reg.offKit.map((o) => o.block), ['loose']);
  assert.match(reg.offKit[0].why, /WELCOME/);
  assert.match(reg.blocks.at(-1).eds.reason, /never a new block/);
  const loose = reg.bindings['forgot-password'].find((b) => b.kit === 'loose');
  assert.deepEqual([loose.block, loose.defaultContent], [null, true]);
});

await test('buildKitRegistry: a used "." part binds to its block with the part class', () => {
  const fx = fixture();
  MAPS.components['bc:c'] = { name: 'Alignment=Center', componentSetId: 'BC' };
  fx.reg.children.push(I('11:9', '.Buttons Collage', 'bc:c', 120, 800, 600, 60, [T('11:10', 'Go', 130, 810, 30, 20)]));
  const { pages } = discoverPages(canvasNodes(fx), kit);
  const r = responseFor([fx.reg]);
  const reg = buildKitRegistry({ pages: pages.filter((p) => p.slug === 'registration'), frameOf: (id) => locate([r], id), kit, library: libraryOf() });
  delete MAPS.components['bc:c'];
  const b = reg.bindings.registration.find((x) => x.node === '11:9');
  assert.deepEqual([b.block, b.kit, b.variant, b.part, b.defaultContent], [null, 'block-content', ['buttons-collage', 'center'], true, true]);
});

await test('moduleSeed / unusedKit / chromeSource: a module per library block, unused ones marked', () => {
  const fx = fixture();
  const { pages } = discoverPages(canvasNodes(fx), kit);
  const r = responseFor([fx.login, fx.loginM, fx.reg, fx.forgot, fx.overlay, fx.overlayM]);
  const reg = buildKitRegistry({ pages, frameOf: (id) => locate([r], id), kit, library: libraryOf() });
  const seed = moduleSeed(reg.blocks);
  assert.equal(seed.length, 6);
  const h = seed.find((x) => x.block === 'header');
  assert.deepEqual({ ...h, anatomy: null }, { id: 'M4', name: 'Header', frame: 'H', family: 'template', anatomy: null, variants: ['full', 'registration'], components: [], status: 'include', block: 'header', eds: { block: 'header', variant: null }, used: true });
  assert.deepEqual(seed.find((x) => x.block === 'block-content').eds, { block: null, variant: null });
  assert.match(h.anatomy, /parts \.Header \/ Actions; instanced 3× on 3 page/);
  assert.match(seed.find((x) => x.block === 'tabs').anatomy, /on no page \(library block\)/);
  assert.deepEqual(unusedKit(reg.blocks).map((u) => u.block), ['button', 'tabs']);
  assert.equal(chromeSource(pages, reg.bindings), 'registration');
});

// ---- the content model's kit binding --------------------------------------------------------------------------
const registryOf = (fx) => {
  const { pages } = discoverPages(canvasNodes(fx), kit);
  const r = responseFor([fx.login, fx.loginM, fx.reg, fx.forgot, fx.overlay, fx.overlayM]);
  return { r, reg: { version: 1, ...buildKitRegistry({ pages, frameOf: (id) => locate([r], id), homes: HOMES, kit, library: libraryOf() }) } };
};
const model = (frame, r, k) => {
  const hit = locate([r], frame.id);
  return buildContentModel({ frame: hit.frame, fileKey: 'K', version: '1', slug: 'p', lookup: hit.lookup, capturedAt: '2026-01-01T00:00:00Z', kit: k ? kitResolver(k, hit.maps, {}) : null });
};

await test('content kit: each band binds to its instance; chrome binds to header/footer; no kit leaves the model unchanged', () => {
  const fx = fixture();
  const { r, reg } = registryOf(fx);
  const plain = model(fx.reg, r, null);
  const bound = model(fx.reg, r, reg);
  assert.equal(plain.model.sections.length, bound.model.sections.length);
  assert.ok(plain.model.sections.every((s) => s.kit === undefined));
  assert.equal(plain.model._provenance.kit, undefined);
  assert.deepEqual(bound.model.sections.map((s) => [s.kit.block, s.kit.defaultContent, s.kit.kit, s.kit.instances]), [[null, true, 'block-content', ['11:3']], [null, true, 'block-content', ['11:4']]], 'Block Content: default content, no block');
  assert.equal(bound.model.sections[0].kit.module, 'M6');
  assert.deepEqual(bound.chrome.map((c) => c.kit?.block), ['header', 'footer']);
  assert.deepEqual(bound.flags.filter((f) => f.id.startsWith('kit.')), []);
  assert.match(bound.model._provenance.kit.rule, /outermost/);
});

await test('content kit: a section drawn inside one instance binds to that enclosing instance', () => {
  const fx = fixture();
  const { r, reg } = registryOf(fx);
  const b = model(fx.overlay, r, reg);
  assert.ok(b.model.sections.length >= 1);
  assert.ok(b.model.sections.every((s) => s.kit.block === 'modal' && s.kit.instance === '20:2'));
  assert.deepEqual(b.model.sections[0].kit.variant, ['text-only', 'horizontal']);
});

await test('content kit: kit.unbound for a section outside the kit, kit.mixed for two blocks in one band', () => {
  const fx = fixture();
  const { r, reg } = registryOf(fx);
  fx.reg.children.splice(2, 0, F('11:7', 'Loose', 120, 800, 600, 60, [T('11:8', 'Drawn by hand', 130, 810, 300, 30)]));
  fx.forgot.children[1].children.push(I('12:6', 'Modal', 'm:d', 800, 200, 300, 200, [T('12:7', 'Inline modal', 810, 210, 200, 30)]));
  const r2 = responseFor([fx.reg, fx.forgot]);
  const one = model(fx.forgot, r2, reg).model.sections.find((s) => s.kit?.block === 'modal' && s.kit.instance === '12:6');
  assert.ok(one, 'a default-content instance beside a modal leaves the section the modal (not mixed)');
  fx.forgot.children[1].children.push(I('12:10', 'Header', 'h:full', 400, 220, 300, 60, [T('12:11', 'Inline header', 410, 230, 200, 30)]));
  const a = model(fx.reg, r2, reg);
  assert.ok(a.flags.some((f) => f.id === 'kit.unbound' && f.severity === 'review'));
  assert.equal(a.model.sections.find((s) => s.kit === null)?.slot !== undefined, true);
  const m = model(fx.forgot, r2, reg);
  const mixed = m.model.sections.find((s) => s.kit?.mixed);
  assert.ok(mixed, 'a mixed section');
  assert.deepEqual(mixed.kit.mixed.map((x) => x.block).sort(), ['header', 'modal']);
  assert.ok(m.flags.some((f) => f.id === 'kit.mixed' && f.severity === 'review'));
});

await test('stream-render kitAttrs: block, variant and instance only when block-name-valid', () => {
  assert.equal(kitAttrs({}), '');
  assert.equal(kitAttrs({ block: 'Bad Name' }), '');
  assert.equal(kitAttrs({ block: 'modal', variant: ['text-only', '"><x'], instance: '20:2' }), ' data-block="modal" data-block-variant="text-only" data-kit-instance="20:2"');
  assert.equal(kitAttrs({ block: 'footer', instance: 'javascript:1' }), ' data-block="footer"');
});

// ---- I/O: runPages + runContentAll against a stub client --------------------------------------------------------
function stubClient(fx) {
  const calls = [];
  const all = [fx.login, fx.loginM, fx.reg, fx.forgot, fx.overlay, fx.overlayM];
  const homeFile = { document: { children: [
    { id: '3:1', name: '    ❏ Header', children: [{ id: 'H' }] }, { id: '3:2', name: '    ❏ Footer', children: [{ id: 'foot' }] },
    { id: '3:3', name: '    ❏ Block Content', children: [{ id: 'B' }] }, { id: '2:2', name: '    ❖ Modal', children: [{ id: 'M' }] },
  ] } };
  return {
    calls,
    hasToken: true,
    async getJson(path, params = {}) {
      calls.push({ path, params });
      if (/\/v1\/files\/[^/]+$/.test(path) && params.depth === 1) return { name: 'One', version: '7', document: { children: CANVASES } };
      if (/\/v1\/files\/[^/]+$/.test(path) && params.ids) return homeFile;
      if (/\/nodes$/.test(path) && params.depth === 5) return { version: '7', nodes: Object.fromEntries(params.ids.split(',').map((id) => [id, KIT_DOCS[id] ? { document: { id, children: [KIT_DOCS[id]] } } : null])) };
      if (/\/nodes$/.test(path) && params.depth === 2) return { version: '7', nodes: { '4:1': { document: { id: '4:1', children: [fx.doc, fx.set] } }, '4:2': { document: { id: '4:2', children: [fx.cover, fx.overlay, fx.overlayM] } } } };
      if (/\/nodes$/.test(path)) return responseFor(all.filter((f) => params.ids.split(',').includes(f.id)));
      if (/\/images/.test(path)) return { meta: { images: {} }, images: {} };
      throw new Error(`unexpected ${path}`);
    },
    async getBytes() { throw new Error('no bytes'); },
  };
}

await test('runPages: writes figma-pages.json (pages, kit, chrome page, links, captureFrames, module seed); a re-run reads the cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  try {
    const fx = fixture();
    const url = 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/One?node-id=10-1';
    const c = stubClient(fx);
    const { manifest, fetched } = await runPages({ dir, url, client: c, at: '2026-01-01T00:00:00Z' });
    assert.equal(fetched, 6);
    assert.deepEqual(manifest.pages.map((p) => p.slug), ['login-landing', 'registration', 'forgot-password', 'inactivity']);
    assert.deepEqual(manifest.kit.blocks.map((b) => b.block), ['button', 'modal', 'tabs', 'header', 'footer', 'block-content']);
    assert.deepEqual(manifest.kit.unused.map((u) => u.block), ['button', 'tabs']);
    assert.deepEqual(manifest.kit.emptyCanvases.map((e) => e.name), ['❏ Quiz']);
    assert.deepEqual(manifest.captureFrames, ['BTN', 'M', 'TG', 'H', 'foot', 'B']);
    assert.equal(manifest.kit.index.BC.block, 'block-content');
    assert.equal(manifest.chromeSource, 'registration');
    assert.equal(manifest.links['20:4'], 'inactivity');
    assert.equal(manifest.modules.length, 6);
    assert.equal(manifest._provenance.source.fileKey, 'AbCdEfGhIjKlMnOpQrStUv');
    const before = c.calls.length;
    const again = await runPages({ dir, url, client: c, at: '2026-01-01T00:00:00Z' });
    assert.equal(again.fetched, 0);
    assert.equal(c.calls.length - before, 1, 'only the depth-1 file read');
    const conf = await runPages({ dir, url, client: c, at: 'x', confidential: true });
    assert.equal(conf.manifest._provenance.source.fileKey, 'redacted');
    assert.equal(conf.manifest._provenance.source.fileName, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('runPages: no pages canvas → a usage error naming the canvases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  try {
    const c = { hasToken: true, getJson: async () => ({ version: '1', document: { children: [{ id: '1:1', name: 'Page 1' }] } }) };
    await assert.rejects(runPages({ dir, url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x', client: c, at: 'x' }), /no pages canvas.*"Page 1"/s);
    await assert.rejects(runPages({ dir, url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x', client: null, at: 'x' }), /FIGMA_TOKEN/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('runContentAll: every page modelled from the cached frames, chrome once from the chrome page, mapping seed written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  try {
    const fx = fixture();
    const url = 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/One';
    const c = stubClient(fx);
    runInit({ dir, url, stateLib, at: '2026-01-01T00:00:00Z' });
    await runPages({ dir, url, client: c, at: '2026-01-01T00:00:00Z' });
    const before = c.calls.filter((x) => /\/nodes$/.test(x.path)).length;
    const r = await runContentAll({ dir, url, client: c, stateLib, at: '2026-01-01T00:00:00Z' });
    assert.equal(c.calls.filter((x) => /\/nodes$/.test(x.path)).length, before, 'no node re-fetch');
    assert.deepEqual(Object.keys(r.results), ['registration', 'login-landing', 'forgot-password', 'inactivity']);
    assert.deepEqual(r.failed, []);
    assert.ok(r.results.registration.chrome);
    assert.equal(r.results['login-landing'].chrome, null);
    const chrome = JSON.parse(readFileSync(join(dir, 'reskin', 'content-model', '_chrome', 'content-model.json'), 'utf8'));
    assert.equal(chrome._provenance.source.figma.node, '11:1');
    const seed = JSON.parse(readFileSync(join(dir, 'reskin', 'mapping.seed.json'), 'utf8'));
    assert.deepEqual(seed.pages.registration.slots, {}, 'Block Content is default content: no slot block');
    assert.deepEqual(Object.values(seed.pages.registration.defaultContent).map((s) => s.module), ['M6', 'M6']);
    assert.equal(seed.pages.registration.template, 'login-and-registration');
    assert.equal(Object.values(seed.pages.inactivity.slots)[0].block, 'modal');
    assert.deepEqual(Object.values(seed.chrome.kit).map((k) => k.block), ['header', 'footer']);
    assert.deepEqual(seed.library.map((b) => `${b.figma}→${b.block}:${b.used}`), ['Button→null:false', 'Modal→modal:true', 'Tabs→tabs:false', 'Header→header:true', 'Footer→footer:true', 'Block Content→null:true'], 'the seed carries the whole library, each kit block with its EDS name');
    assert.match(seed.library[0].reason, /deploy Step 2 D1/);
    assert.equal(seed.library[5].key, 'block-content');
    assert.ok(!existsSync(join(dir, 'reskin', 'mapping.json')), 'mapping.json is never written');
    const st = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    assert.equal(st.pages.length, 4);
    const sub = await runContentAll({ dir, url, client: c, stateLib, at: 'x', only: ['inactivity'] });
    assert.deepEqual(Object.keys(sub.results), ['inactivity']);
    assert.ok(sub.seed.pages.registration, 'an --only run keeps the other pages of the seed');
    await assert.rejects(runContentAll({ dir, url, client: c, stateLib, at: 'x', only: ['nope'] }), /--only: nope/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('CLI: --help lists pages and content --all; content --all refuses --frame', () => {
  const help = spawnSync(process.execPath, [join(SCRIPTS, 'figma-donor.mjs'), '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /figma-donor\.mjs pages <figma-url>/);
  assert.match(help.stdout, /content <figma-url> --all/);
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  try {
    const bad = spawnSync(process.execPath, [join(SCRIPTS, 'figma-donor.mjs'), 'content', 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x', '--all', '--frame', '1:2', '--dir', dir], { encoding: 'utf8', env: { ...process.env, FIGMA_TOKEN: '' } });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /drop --frame/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
