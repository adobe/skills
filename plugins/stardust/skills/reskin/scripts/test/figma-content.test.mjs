#!/usr/bin/env node
// skills/reskin/scripts/test/figma-content.test.mjs — Figma as the content source (M4): the pure core
// (figma/content.mjs: reading order, visibility, casing, truncation, links, lists, images, placeholders,
// hostile strings), the I/O helpers (figma/content-run.mjs: sniff, svgUnsafe, overwrite guard, init, ack,
// blocklist), the text gate's pure comparison (figma-text-gate.mjs compareText) and --help-first CLIs.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyCase, buildContentModel, safeClassToken, safeHref, textReference, titleFromName,
} from '../figma/content.mjs';
import {
  acknowledge, blocklist, deltasFor, keyHash, overwriteRefusal, runInit, sniff, svgUnsafe, textOpsFor,
} from '../figma/content-run.mjs';
import { compareText } from '../figma-text-gate.mjs';
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
const T = (id, characters, x, y, w, h, style = {}, extra = {}) => ({ id, type: 'TEXT', name: extra.name || characters.slice(0, 20), characters, style: { fontSize: 16, ...style }, ...bb(x, y, w, h), ...extra });
const F = (id, name, x, y, w, h, children = [], extra = {}) => ({ id, type: 'FRAME', name, children, ...bb(x, y, w, h), ...extra });
const TOKENS = { type: { h1: { fontSize: '46px' }, h2: { fontSize: '32px' }, body: { fontSize: '16px' } } };
const build = (frame, more = {}) => buildContentModel({ frame, fileKey: 'K', version: '1', slug: 'p', tokens: TOKENS, capturedAt: '2026-01-01T00:00:00Z', ...more }).model;
const flagIds = (m) => m.flags.map((f) => f.id);
const allText = (m) => m.sections.map((s) => s.visibleText).join(' | ');

function page(bodyKids, { header = true, footer = true } = {}) {
  const kids = [];
  if (header) kids.push(F('h', 'Header', 0, 0, 1440, 80, [T('h1t', 'Brand', 20, 20, 100, 24)]));
  kids.push(...bodyKids);
  if (footer) kids.push(F('f', 'Footer', 0, 2000, 1440, 100, [T('f1t', 'Legal line', 20, 2020, 200, 20)]));
  return F('1:1', 'Page=Welcome, Device=Desktop', 0, 0, 1440, 2100, kids);
}

// ---- pure helpers ----------------------------------------------------------------------------------------------
await test('safeHref: allowlist http(s)/mailto/tel/root-relative; rejects javascript:, data:, protocol-relative', () => {
  assert.equal(safeHref('https://a.example/x').href, 'https://a.example/x');
  assert.equal(safeHref('mailto:a@b.c').href, 'mailto:a@b.c');
  assert.equal(safeHref('tel:+100').href, 'tel:+100');
  assert.equal(safeHref('/about').href, '/about');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.example', 'about', '', 'vbscript:x']) {
    const r = safeHref(bad);
    assert.equal(r.href, '#', bad);
    assert.ok(r.rejected, bad);
  }
});

await test('safeClassToken: only block-name-valid tokens survive', () => {
  assert.equal(safeClassToken('Hero Banner'), 'hero-banner');
  assert.equal(safeClassToken('.Card/Primary'), 'card-primary');
  for (const bad of ['"><script>', '1abc', 'a b"c', '', 'x'.repeat(80), 'é-card']) assert.equal(safeClassToken(bad), '', bad);
});

await test('applyCase / titleFromName', () => {
  assert.equal(applyCase('Sign in', 'UPPER'), 'SIGN IN');
  assert.equal(applyCase('Sign In', 'LOWER'), 'sign in');
  assert.equal(applyCase('sign in now', 'TITLE'), 'Sign In Now');
  assert.equal(applyCase('Sign in', 'SMALL_CAPS'), 'Sign in');
  assert.equal(applyCase('Sign in', 'SMALL_CAPS_FORCED'), 'Sign in');
  assert.equal(titleFromName('Page=Login Landing, Device=Desktop'), 'Login Landing');
  assert.equal(titleFromName('Registration'), 'Registration');
});

// ---- the model -------------------------------------------------------------------------------------------------
await test('chrome leaves the body; provenance records rules and source kind figma', () => {
  const m = build(page([F('b', 'Body', 0, 100, 1440, 400, [T('t1', 'Welcome aboard', 100, 120, 600, 56, { fontSize: 46 }), T('t2', 'Real intro copy for people.', 100, 200, 600, 24)])]));
  assert.equal(m._provenance.source.kind, 'figma');
  assert.equal(m._provenance.source.figma.node, '1:1');
  assert.ok(m._provenance.readingOrder.rule && m._provenance.segmentation.rule);
  assert.ok(!allText(m).includes('Brand') && !allText(m).includes('Legal line'), allText(m));
  assert.ok(allText(m).includes('Welcome aboard'));
  assert.equal(m.metadata.title, 'Welcome');
  assert.ok(flagIds(m).includes('metadata.title-derived'));
});

await test('reading order: auto-layout keeps child order; geometric frames read rows then x', () => {
  const auto = F('a', 'Stack', 0, 100, 800, 300, [T('a2', 'Second in flow', 0, 100, 300, 24), T('a1', 'First in flow', 0, 200, 300, 24)], { layoutMode: 'VERTICAL' });
  const geo = F('g', 'Free', 0, 500, 800, 300, [T('g2', 'Right cell', 400, 500, 300, 24), T('g1', 'Left cell', 0, 505, 300, 24), T('g3', 'Next row', 0, 600, 300, 24)]);
  const frame = page([F('w', 'Wrap', 0, 100, 1440, 800, [auto, geo])]);
  const m = build(frame);
  const t = allText(m);
  assert.ok(t.indexOf('Second in flow') < t.indexOf('First in flow'), t);
  assert.ok(t.indexOf('Left cell') < t.indexOf('Right cell') && t.indexOf('Right cell') < t.indexOf('Next row'), t);
  const refs = textReference(frame).map((r) => r.text);
  assert.deepEqual(refs.filter((s) => /cell|row|flow/.test(s)), ['Second in flow', 'First in flow', 'Left cell', 'Right cell', 'Next row']);
});

await test('overlapping text in a geometric frame is flagged order.ambiguous', () => {
  const m = build(page([F('o', 'Overlay', 0, 100, 800, 300, [T('o1', 'Layer one text', 0, 100, 300, 40), T('o2', 'Layer two text', 10, 110, 300, 40)])]));
  assert.ok(flagIds(m).includes('order.ambiguous'));
});

await test('effective visibility: a hidden ancestor hides its text in the model and the reference', () => {
  const frame = page([F('v', 'Body', 0, 100, 1440, 400, [T('v1', 'Shown copy here', 0, 100, 300, 24), F('vh', 'Hidden group', 0, 200, 300, 100, [T('v2', 'Secret copy here', 0, 200, 300, 24)], { visible: false })])]);
  assert.ok(!allText(build(frame)).includes('Secret'));
  assert.ok(!textReference(frame).some((r) => r.text.includes('Secret')));
});

await test('textCase: rendered text is cased; characters/textCase kept as side fields; TITLE refs are caseless', () => {
  const frame = page([F('c', 'Body', 0, 100, 1440, 400, [
    T('c1', 'Shout this', 0, 100, 300, 24, { textCase: 'UPPER' }),
    T('c2', 'Whisper THIS', 0, 140, 300, 24, { textCase: 'LOWER' }),
    T('c3', 'title me now', 0, 180, 300, 24, { textCase: 'TITLE' }),
    T('c4', 'Small caps forced', 0, 220, 300, 24, { textCase: 'SMALL_CAPS_FORCED' }),
  ])]);
  const m = build(frame);
  const t = allText(m);
  for (const s of ['SHOUT THIS', 'whisper this', 'Title Me Now', 'Small caps forced']) assert.ok(t.includes(s), `${s} in ${t}`);
  const json = JSON.stringify(m);
  assert.ok(json.includes('"textCase":"UPPER"') && json.includes('"characters":"Shout this"'));
  assert.ok(json.includes('"textCase":"SMALL_CAPS_FORCED"'));
  const refs = textReference(frame);
  assert.equal(refs.find((r) => r.node === 'c3').title, true);
});

await test('truncation keeps the full string and records maxLines; flagged info', () => {
  const long = 'A long paragraph that the design truncates after two lines but whose words all stay in the model';
  const m = build(page([F('tr', 'Body', 0, 100, 1440, 400, [T('tr1', long, 0, 100, 300, 48, { textTruncation: 'ENDING', maxLines: 2 })])]));
  assert.ok(allText(m).includes(long));
  assert.ok(JSON.stringify(m).includes('"maxLines":2'));
  assert.ok(m.flags.some((f) => f.id === 'text.truncated' && f.severity === 'info'));
});

await test('links: URL runs kept, javascript: rejected (block), NODE resolved via rules.pages or flagged', () => {
  const runText = 'Read terms or bad or help';
  const t = T('l1', runText, 0, 100, 600, 24, {}, {
    characterStyleOverrides: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 3, 3, 3, 3],
    styleOverrideTable: { 1: { hyperlink: { type: 'URL', url: 'https://a.example/terms' } }, 2: { hyperlink: { type: 'URL', url: 'javascript:alert(1)' } }, 3: { hyperlink: { type: 'NODE', nodeID: '9:9' } } },
  });
  const m = build(page([F('lb', 'Body', 0, 100, 1440, 400, [T('lh', 'Links page', 0, 50, 300, 56, { fontSize: 46 }), t])]), { rules: { pages: { '9:9': 'help' } } });
  const ctas = m.sections.flatMap((s) => s.ctas);
  assert.ok(ctas.some((c) => c.href === 'https://a.example/terms'), JSON.stringify(ctas));
  assert.ok(ctas.some((c) => c.href === '/help'), JSON.stringify(ctas));
  assert.ok(!JSON.stringify(ctas).includes('javascript:'));
  assert.ok(m.flags.some((f) => f.id === 'link.rejected' && f.severity === 'block'));
  const m2 = build(page([F('lb', 'Body', 0, 100, 1440, 400, [t])]));
  assert.ok(flagIds(m2).includes('link.unresolved'));
});

await test('lineTypes lists become listItems, one reference per line', () => {
  const frame = page([F('lst', 'Body', 0, 100, 1440, 400, [T('li', 'First point\nSecond point\nThird point', 0, 100, 300, 72, {}, { lineTypes: ['UNORDERED', 'UNORDERED', 'UNORDERED'], lineIndentations: [1, 1, 1] })])]);
  const m = build(frame);
  assert.deepEqual(m.sections.flatMap((s) => s.listItems), ['First point', 'Second point', 'Third point']);
  assert.deepEqual(textReference(frame).map((r) => r.text), ['First point', 'Second point', 'Third point']);
});

await test('image fill with crop → image entry, image.crop + image.alt flags; vector icon decorative', () => {
  const img = { id: 'im', type: 'RECTANGLE', name: 'Photo', fills: [{ type: 'IMAGE', imageRef: 'abc', scaleMode: 'CROP', imageTransform: [[0.5, 0, 0.1], [0, 0.5, 0.2]] }], ...bb(0, 100, 600, 400) };
  const icon = { id: 'ic', type: 'INSTANCE', name: 'Icon / Arrow', children: [{ id: 'icv', type: 'VECTOR', name: 'Vector', ...bb(700, 100, 24, 24) }], ...bb(700, 100, 24, 24) };
  const m = build(page([F('ib', 'Body', 0, 100, 1440, 500, [img, icon, T('it', 'Caption copy text', 0, 520, 300, 24)])]), { assets: (n) => ({ path: `assets/${n.id}.png` }) });
  const imgs = m.sections.flatMap((s) => s.images);
  assert.ok(imgs.length >= 1, JSON.stringify(imgs));
  for (const id of ['image.crop', 'image.alt']) assert.ok(flagIds(m).includes(id), id);
  assert.ok(Array.isArray(m._provenance.decorative));
});

await test('artwork: a text-less vector composition is media, an empty fill frame a placeholder, a backdrop decorative, a thin rule ignored', () => {
  const V = (id, x, y, w, h) => ({ id, type: 'VECTOR', name: 'Vector', ...bb(x, y, w, h) });
  const solid = [{ type: 'SOLID', color: { r: 0.8, g: 0.9, b: 1, a: 1 } }];
  const illo = { id: 'il', type: 'GROUP', name: 'Illustration', children: [V('il1', 800, 120, 200, 200), V('il2', 1000, 200, 100, 100)], ...bb(800, 120, 300, 300) };
  const empty = { id: 'ph', type: 'FRAME', name: 'Media', fills: solid, children: [], ...bb(800, 500, 400, 300) };
  const backdrop = { id: 'bd', type: 'GROUP', name: 'Waves', children: [V('bd1', -50, 120, 600, 200)], ...bb(-50, 120, 600, 200) };
  const rule = { id: 'rl', type: 'RECTANGLE', name: 'Line', fills: solid, ...bb(0, 900, 1200, 2) };
  const m = build(page([F('ab', 'Body', 0, 100, 1440, 900, [T('at', 'Plan your work together', 0, 150, 500, 40), illo, empty, backdrop, rule])]), { assets: (n) => ({ path: `assets/${n.id}.svg` }) });
  const ids = m.sections.flatMap((s) => s.ordered).filter((o) => o.kind === 'image').map((o) => o.node);
  assert.ok(ids.includes('il'), `illustration kept: ${ids}`);
  assert.ok(ids.includes('ph'), `placeholder kept: ${ids}`);
  assert.ok(!ids.includes('bd') && !ids.includes('rl'), `backdrop/rule not media: ${ids}`);
  assert.ok(m._provenance.decorative.includes('bd'));
  assert.ok(m.flags.some((f) => f.id === 'image.placeholder' && f.node === 'ph' && f.severity === 'review'), JSON.stringify(m.flags));
  assert.ok(m.flags.some((f) => f.id === 'image.decorative' && f.node === 'bd'));
});

await test('placeholders: lorem/kit-word/pattern block; all-placeholder page is placeholder-only', () => {
  const m = build(page([F('pb', 'Body', 0, 100, 1440, 400, [T('p1', 'Lorem ipsum dolor sit amet', 0, 100, 300, 24), T('p2', 'Button', 0, 140, 300, 24), T('p3', 'XX-XXXX-01', 0, 180, 300, 24)])]));
  for (const id of ['placeholder.lorem', 'placeholder.kit-word', 'placeholder.pattern', 'placeholder.only']) assert.ok(flagIds(m).includes(id), `${id} in ${flagIds(m)}`);
  assert.ok(m.flags.filter((f) => f.id.startsWith('placeholder.') && f.id !== 'placeholder.suspect').every((f) => f.severity === 'block'));
  const ok = build(page([F('pb', 'Body', 0, 100, 1440, 400, [T('p1', 'Find a clinic near you', 0, 100, 300, 24), T('p2', 'Lorem ipsum dolor sit amet', 0, 140, 300, 24)])]));
  assert.ok(!flagIds(ok).includes('placeholder.only'));
});

await test('placeholders: kit default copy the responsive frame replaces → placeholder.kit-default naming its copy', () => {
  const I = (id, x, y, kids, overrides = []) => F(id, 'Block Content', x, y, 1440, 300, kids, { type: 'INSTANCE', overrides });
  const desk = page([
    I('5:1', 0, 100, [T('I5:1;9:1', 'The most inspiring heading', 0, 100, 600, 40, { fontSize: 32 }), T('I5:1;9:2', 'One of the biggest challenges with DCM is its presentation.', 0, 160, 600, 24)]),
    I('5:2', 0, 500, [T('I5:2;9:3', 'Confirm Access', 0, 500, 200, 24)]),
    I('5:3', 0, 900, [T('I5:3;9:4', 'Signed copy', 0, 900, 200, 24)], [{ id: 'I5:3;9:4', overriddenFields: ['characters'] }]),
    I('5:4', 0, 1300, [T('I5:4;9:5', 'One of the biggest challenges with DCM is its presentation.', 0, 1300, 600, 24)]),
  ]);
  const resp = F('2:1', 'Page=Welcome, Device=Mobile', 0, 0, 390, 2100, [
    I('6:1', 0, 100, [T('I6:1;8:1', 'Account found', 0, 100, 300, 40, { fontSize: 32 }), T('I6:1;8:2', 'We sent a login link to your inbox.', 0, 160, 300, 24)], [{ id: 'I6:1;8:1', overriddenFields: ['characters'] }, { id: 'I6:1;8:2', overriddenFields: ['characters'] }]),
    I('6:2', 0, 500, [T('I6:2;8:3', 'Verify E-mail', 0, 500, 200, 24)], [{ id: 'I6:2;8:3', overriddenFields: ['characters'] }]),
    I('6:3', 0, 900, [T('I6:3;8:4', 'Other signed copy', 0, 900, 200, 24)], [{ id: 'I6:3;8:4', overriddenFields: ['characters'] }]),
  ]);
  const m = build(desk, { responsive: { frame: resp } });
  const kd = m.flags.filter((f) => f.id === 'placeholder.kit-default');
  const at = (node) => kd.find((f) => f.node === node);
  assert.equal(at('I5:1;9:1')?.severity, 'block');
  assert.match(at('I5:1;9:1').detail, /"Account found"/);
  assert.equal(at('I5:1;9:2')?.severity, 'block', 'the run holds kit-like copy: its body text blocks too');
  assert.match(at('I5:1;9:2').detail, /"We sent a login link/);
  assert.equal(at('I5:4;9:5')?.severity, 'block', 'the same sample copy in another instance blocks too');
  assert.equal(at('I5:2;9:3')?.severity, 'review', 'a lone default label is a question, not a placeholder');
  assert.ok(!at('I5:3;9:4'), 'overridden text is the designer\'s copy');
  assert.ok(!build(desk).flags.some((f) => f.id === 'placeholder.kit-default'), 'no responsive frame, no comparison');
});

await test('headings: first heading is h1, extra h1 demoted, no heading → heading.none', () => {
  const m = build(page([F('hb', 'Body', 0, 100, 1440, 400, [T('hh1', 'Main title text', 0, 100, 600, 56, { fontSize: 46 }), T('hh2', 'Another big title', 0, 200, 600, 56, { fontSize: 46 })])]));
  const heads = m.sections.flatMap((s) => s.ordered).filter((o) => o.kind === 'heading');
  const lv = (h) => String(h.tag ?? h.level).replace(/^h/, '');
  assert.equal(lv(heads[0]), '1');
  assert.equal(lv(heads[1]), '2');
  assert.ok(flagIds(m).includes('heading.level'));
  const none = build(page([F('nb', 'Body', 0, 100, 1440, 400, [T('n1', 'Only body copy here', 0, 100, 600, 24)])]));
  assert.ok(flagIds(none).includes('heading.none'));
});

await test('hostile strings stay raw in the model (renderers escape); layer names never become classes', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const frame = page([F('xb', '"><script>alert(1)</script>', 0, 100, 1440, 400, [T('x1', evil, 0, 100, 600, 24)])]);
  const m = build(frame);
  assert.ok(allText(m).includes(evil));
  assert.ok(!JSON.stringify(m.sections.map((s) => s.rootClass)).includes('script'));
});

await test('chrome names: the header/footer word at the frame edge is chrome; mid-page or a sub-component path stays body', () => {
  const frame = F('2:1', 'Page', 0, 0, 1440, 2400, [
    F('mh', 'Market Specific Header', 0, 0, 1440, 80, [T('mht', 'Brand', 20, 20, 100, 24)]),
    F('sh', 'Section Header', 0, 200, 1440, 100, [T('sht', 'Our programs', 20, 220, 300, 40)]),
    F('nv', 'Header / Navigation Item', 0, 400, 1440, 60, [T('nvt', 'Enrolment', 20, 410, 100, 24)]),
    F('bd', 'Body', 0, 600, 1440, 400, [T('bdt', 'Real intro copy for people.', 20, 620, 400, 24)]),
    F('sf', 'Specific Footer', 0, 2200, 1440, 200, [T('sft', 'Legal line', 20, 2220, 200, 20)]),
  ]);
  const m = build(frame);
  assert.deepEqual(m._provenance.segmentation.chrome, { header: ['mh'], footer: ['sf'] });
  assert.ok(allText(m).includes('Our programs') && allText(m).includes('Enrolment'), allText(m));
  assert.ok(!allText(m).includes('Brand') && !allText(m).includes('Legal line'));
  const notTop = build(F('2:2', 'Page', 0, 0, 1440, 900, [F('b0', 'Banner', 0, 0, 1440, 80, [T('b0t', 'Notice copy here', 0, 10, 300, 24)]), F('h2', 'Market Header', 0, 100, 1440, 80, [T('h2t', 'Brand', 0, 110, 100, 24)])]));
  assert.deepEqual(notTop._provenance.segmentation.chrome.header, [], 'body content above it: not the header');
  const exact = build(F('2:3', 'Page', 0, 0, 1440, 900, [F('b1', 'Banner', 0, 0, 1440, 80, [T('b1t', 'Notice copy here', 0, 10, 300, 24)]), F('h3', 'Header', 0, 100, 1440, 80, [T('h3t', 'Brand', 0, 110, 100, 24)])]));
  assert.deepEqual(exact._provenance.segmentation.chrome.header, ['h3'], 'an exact name is chrome wherever it sits');
});

await test('segmentation: a single wrapper with ≥ 2 bands is descended into sections', () => {
  const m = build(page([F('w', 'Wrapper', 0, 100, 1440, 900, [F('b1', 'Band one', 0, 100, 1440, 300, [T('b1t', 'Band one copy', 0, 120, 300, 24)]), F('b2', 'Band two', 0, 500, 1440, 300, [T('b2t', 'Band two copy', 0, 520, 300, 24)])])]));
  assert.equal(m.sections.length, 2);
  assert.equal(m._provenance.segmentation.descended, 1);
});

// ---- the text gate ---------------------------------------------------------------------------------------------
await test('compareText: PASS, missing, order swap, case, duplicate, extra, attr', () => {
  const refs = [{ node: 'a', text: 'Alpha one' }, { node: 'b', text: 'Beta two' }, { node: 'c', text: 'Gamma three' }];
  assert.equal(compareText(refs, { text: 'Alpha one Beta two Gamma three' }).verdict, 'PASS');
  const miss = compareText(refs, { text: 'Alpha one Gamma three' });
  assert.equal(miss.findings.missing[0].text, 'Beta two');
  const swap = compareText(refs, { text: 'Beta two Alpha one Gamma three' });
  assert.ok(swap.findings.order.length === 1 && swap.findings.extra.length === 0, JSON.stringify(swap.findings));
  const cased = compareText(refs, { text: 'ALPHA ONE Beta two Gamma three' });
  assert.equal(cased.findings.case.length, 1);
  assert.equal(compareText([{ node: 'a', text: 'Alpha one', title: true }], { text: 'Alpha One' }).verdict, 'PASS');
  const dup = compareText(refs, { text: 'Alpha one Beta two Gamma three Beta two' });
  assert.ok(dup.findings.duplicate.some((d) => d.text === 'Beta two'), JSON.stringify(dup.findings));
  const extra = compareText(refs, { text: 'Alpha one Injected words Beta two Gamma three' });
  assert.equal(extra.findings.extra[0].text, 'Injected words');
  const attrRefs = [{ node: 'l', text: 'Email' }, { node: 'p', text: 'e.g. a@b.c' }];
  const deltas = { text: [{ node: 'p', op: 'attr', field: 'f', text: 'e.g. a@b.c' }] };
  assert.equal(compareText(attrRefs, { text: 'Email', attrs: ['e.g. a@b.c'] }, deltas).verdict, 'PASS');
  assert.equal(compareText(attrRefs, { text: 'Email', attrs: [] }, deltas).findings.attr.missing.length, 1);
  assert.equal(compareText(refs, { text: 'Alpha one Gamma three' }, { text: [{ node: 'b', op: 'omit', why: 'x' }] }).verdict, 'PASS');
});

// ---- I/O helpers -----------------------------------------------------------------------------------------------
await test('deltasFor is a valid version-1 delta file (deployed/deltas.mjs); textOpsFor keeps the Figma text ops apart', async () => {
  const { loadDeltas, metadataPlan } = await import('../deployed/deltas.mjs');
  const m = build(page([F('b', 'Body', 0, 100, 1440, 400, [T('t1', 'Welcome aboard', 100, 120, 600, 56, { fontSize: 46, textCase: 'TITLE' })])]));
  const d = deltasFor(m);
  assert.deepEqual(d, { version: 1, metadata: { absent: ['description', 'canonical'] } });
  const dir = mkdtempSync(join(tmpdir(), 'fc-deltas-'));
  try {
    writeFileSync(join(dir, 'p.json'), JSON.stringify(d));
    const plan = metadataPlan(loadDeltas(join(dir, 'p.json')));
    assert.deepEqual([...plan.absent], ['description', 'canonical']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const ops = textOpsFor(m);
  assert.ok(ops.text.some((o) => o.node === 't1' && o.op === 'caseless'), JSON.stringify(ops));
  assert.ok(!('version' in ops) && !('metadata' in ops));
});

await test('sniff + svgUnsafe', () => {
  assert.equal(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'png');
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpg');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniff(Buffer.from('<html>nope</html>')), null);
  assert.ok(svgUnsafe('<svg><script>alert(1)</script></svg>'));
  assert.ok(svgUnsafe('<svg onload="x()"></svg>'));
  assert.ok(svgUnsafe('<svg><image href="https://evil.example/x.png"/></svg>'));
  assert.ok(!svgUnsafe('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>'));
});

await test('overwriteRefusal: another file or frame refuses; the same frame (also by key hash) does not', () => {
  const existing = { _provenance: { source: { kind: 'figma', figma: { fileKey: 'redacted', fileKeyHash: keyHash('K'), node: '1:1' } } } };
  assert.equal(overwriteRefusal(existing, { fileKey: 'K', node: '1:1' }), null);
  assert.ok(overwriteRefusal(existing, { fileKey: 'K2', node: '1:1' }));
  assert.ok(overwriteRefusal(existing, { fileKey: 'K', node: '2:2' }));
  assert.ok(overwriteRefusal({ _provenance: { source: { kind: 'live' } } }, { fileKey: 'K', node: '1:1' }));
});

await test('init: figma-only state; idempotent; refuses a live-site state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-init-'));
  try {
    const r = runInit({ dir, url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x?node-id=1-1', confidential: false, stateLib, at: '2026-01-01T00:00:00Z' });
    assert.ok(!r?.error, JSON.stringify(r));
    const s = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    assert.equal(s.flowSource, 'figma-only');
    assert.equal(s.site.contentSource.kind, 'figma');
    assert.equal(s.site.originUrl, null);
    const again = runInit({ dir, url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x', confidential: false, stateLib, at: '2026-01-01T00:00:00Z' });
    assert.ok(!again?.error, JSON.stringify(again));
    const live = mkdtempSync(join(tmpdir(), 'fc-live-'));
    writeFileSync(join(live, 'state.json'), JSON.stringify({ site: { originUrl: 'https://site.example' }, pages: [] }));
    let refused = false;
    try { const x = runInit({ dir: live, url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/x', confidential: false, stateLib, at: '2026-01-01T00:00:00Z' }); refused = Boolean(x?.error || x?.refused); } catch { refused = true; }
    assert.ok(refused, 'live-site state must be refused');
    rmSync(live, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await test('ack + blocklist: block/review items gate deploy until acknowledged with a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-ack-'));
  try {
    const d = join(dir, 'reskin', 'content-model', 'p');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'flags.json'), JSON.stringify({ counts: {}, items: [
      { key: 'image.alt@1', id: 'image.alt', severity: 'review', node: '1' },
      { key: 'link.rejected@2', id: 'link.rejected', severity: 'block', node: '2' },
      { key: 'text.truncated@3', id: 'text.truncated', severity: 'info', node: '3' },
    ], acknowledged: [] }));
    let b = blocklist(dir, ['p']);
    assert.equal(b[0].open.length, 2, JSON.stringify(b));
    acknowledge(dir, 'p', { keys: ['image.alt'], why: 'decorative photo, agreed', by: 't', at: '2026-01-01T00:00:00Z' });
    b = blocklist(dir, ['p']);
    assert.equal(b[0].open.length, 1, JSON.stringify(b));
    acknowledge(dir, 'p', { all: true, why: 'spike preview only', by: 't', at: '2026-01-01T00:00:00Z' });
    b = blocklist(dir, ['p']);
    assert.equal(b[0].open.length, 0, JSON.stringify(b));
    const f = JSON.parse(readFileSync(join(d, 'flags.json'), 'utf8'));
    assert.ok(f.acknowledged.every((a) => a.why && a.by && a.at));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- CLIs: --help first, no side effects -------------------------------------------------------------------------
await test('--help first: figma-donor, figma-text-gate, slot-coverage', () => {
  for (const [script, needle] of [['figma-donor.mjs', 'content'], ['figma-text-gate.mjs', '--text-ops'], ['slot-coverage.mjs', '--deltas']]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, script), '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${script}: ${r.stderr}`);
    assert.ok((r.stdout + r.stderr).includes(needle), `${script} help mentions ${needle}`);
  }
});

const { render } = await import('../stream-render.mjs');
await test('buttons: a Link variant is a link, never a button; a heading-styled text in a button is its own heading', () => {
  const I = (id, name, y, kids, extra = {}) => ({ id, type: 'INSTANCE', name, componentId: `c-${id}`, children: kids, ...bb(0, y, 400, 60), ...extra });
  const go = { interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'URL', url: 'https://example.test/report' }] }] };
  const linkProp = I('b1', 'Button', 100, [T('b1t', 'Read the report', 0, 110, 200, 24)], { componentProperties: { Type: { type: 'VARIANT', value: 'Link' } }, ...go });
  const linkName = I('b2', 'Button', 200, [T('b2t', 'See all news', 0, 210, 200, 24)]);
  const iconProp = I('b3', 'Button', 300, [T('b3t', 'Download now', 0, 310, 200, 24)], { componentProperties: { Icon: { type: 'VARIANT', value: 'Link' } } });
  const headed = I('b4', 'Card CTA button', 400, [T('b4h', 'Find a school', 0, 400, 300, 40, { fontSize: 32 }), T('b4t', 'Search', 0, 450, 100, 20)], go);
  const even = I('b5', 'Button', 500, [T('b5a', 'Apply', 0, 510, 60, 20), T('b5b', 'today', 70, 510, 60, 20)]);
  const lookup = { component: (n) => ({ 'c-b2': 'Type=Link, Size=Small' }[n.componentId]), componentSet: () => 'Button' };
  const m = build(page([F('bb', 'Body', 0, 100, 1440, 600, [linkProp, linkName, iconProp, headed, even])]), { lookup });
  const ord = m.sections.flatMap((s) => s.ordered);
  const of = (id) => ord.filter((o) => o.node === id || o.node?.startsWith?.(`${id}`));
  assert.deepEqual(of('b1').map((o) => [o.kind, o.text, o.classes, o.href, !!o.buttonLike]), [['cta', 'Read the report', 'link', 'https://example.test/report', false]]);
  assert.deepEqual(of('b2').map((o) => [o.kind, o.text, o.classes, o.href]), [['cta', 'See all news', 'link', '#']]);
  assert.ok(m.flags.some((f) => f.id === 'link.unresolved' && f.node === 'b2'));
  assert.deepEqual(of('b3').map((o) => [o.kind, o.text, !!o.inButton]), [['text', 'Download now', true]], 'an icon property is not the link variant');
  const b4 = ord.filter((o) => ['b4', 'b4h'].includes(o.node));
  assert.deepEqual(b4.map((o) => [o.kind, o.text]), [['heading', 'Find a school'], ['cta', 'Search']]);
  assert.equal(b4[1].buttonLike, true);
  assert.deepEqual(of('b5').map((o) => [o.kind, o.text]), [['text', 'Apply today']], 'equal-size texts stay one label');
});

await test('image opacity: node × fill opacity and the solid fill under it (else the nearest ancestor fill) are carried; opaque images unchanged', () => {
  const black = { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } };
  const stacked = { id: 'i1', type: 'RECTANGLE', name: 'Hero', fills: [black, { type: 'IMAGE', imageRef: 'a', opacity: 0.75 }], ...bb(0, 100, 600, 400) };
  const faded = { id: 'i2', type: 'RECTANGLE', name: 'Photo', opacity: 0.5, fills: [{ type: 'IMAGE', imageRef: 'b' }], ...bb(0, 600, 600, 400) };
  const plain = { id: 'i3', type: 'RECTANGLE', name: 'Plain', fills: [{ type: 'IMAGE', imageRef: 'c' }], ...bb(0, 1100, 600, 400) };
  const navy = F('bg', 'Band', 0, 600, 1440, 400, [faded], { fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0.5, a: 1 } }] });
  const m = build(page([F('ob', 'Body', 0, 100, 1440, 1500, [stacked, navy, plain, T('oc', 'Caption copy text', 0, 1550, 300, 24)])]));
  const imgs = m.sections.flatMap((s) => s.ordered).filter((o) => o.kind === 'image');
  const by = Object.fromEntries(imgs.map((o) => [o.node, o]));
  assert.equal(by.i1.opacity, 0.75); assert.equal(by.i1.backdrop, 'rgb(0, 0, 0)');
  assert.equal(by.i2.opacity, 0.5); assert.equal(by.i2.backdrop, 'rgb(0, 0, 128)');
  assert.ok(!('opacity' in by.i3) && !('backdrop' in by.i3));
  const html = render({ slug: 'p', model: m, tokens: {}, mapping: { pages: { p: { slots: {} } } } }).html;
  assert.match(html, /<figure class="media" style="background-color: rgb\(0, 0, 0\)"><img src="assets\/i1\.png" alt="" style="opacity: 0\.75"><\/figure>/);
  assert.match(html, /<figure class="media"><img src="assets\/i3\.png" alt=""><\/figure>/);
  const band = render({ slug: 'p', model: m, tokens: {}, mapping: { pages: { p: { slots: { s01: { layout: 'media-band' } } } } } }).html;
  assert.match(band, /<section class="band layout-media-band[^"]*" style="background-color: rgb\(0, 0, 0\)"[^>]*>\s*<img class="band-img" src="assets\/i1\.png" alt="" style="opacity: 0\.75">/);
  const split = render({ slug: 'p', model: m, tokens: {}, mapping: { pages: { p: { slots: { s01: { layout: 'split' } } } } } }).html;
  assert.match(split, /<span class="split-img img-backdrop" style="background-color: rgb\(0, 0, 0\)"><img src="assets\/i1\.png" alt="" style="opacity: 0\.75"><\/span>/);
  assert.match(split, /\.site-main \.img-backdrop \{ display: block; \}/);
});

await test('paragraphs: \\n-separated lines are separate paragraphs; a line separator (U+2028) is a <br>; the reference still matches', () => {
  const frame = page([F('pb', 'Body', 0, 100, 1440, 400, [T('p1', 'First paragraph here.\n\nSecond paragraph here.', 0, 100, 600, 96), T('p2', 'Line one\u2028line two', 0, 300, 600, 48)])]);
  const m = build(frame);
  const ord = m.sections.flatMap((s) => s.ordered);
  assert.deepEqual(ord.filter((o) => o.kind === 'paragraph').map((o) => o.text), ['First paragraph here.', 'Second paragraph here.', 'Line one line two']);
  const br = ord.find((o) => o.node === 'p2');
  assert.deepEqual(br.children.map((k) => [k.text, !!k.br]), [['Line one', false], ['line two', true]]);
  const html = render({ slug: 'p', model: m, tokens: {}, mapping: { pages: { p: { slots: {} } } } }).html;
  assert.match(html, /<p class="lead">First paragraph here\.<\/p>\s*<p class="lead">Second paragraph here\.<\/p>/);
  assert.match(html, /<p class="lead">Line one<br>line two<\/p>/);
  const refs = textReference(frame).map((r) => r.text);
  assert.deepEqual(refs, ['First paragraph here. Second paragraph here.', 'Line one line two']);
  assert.equal(compareText(textReference(frame), { text: 'First paragraph here.\n\nSecond paragraph here.\nLine one\nline two', attrs: [] }).verdict, 'PASS');
});

// ---- the renderer on a Figma-sourced model ---------------------------------------------------------------------
const RTOKENS = { palette: { pageBg: 'rgb(255, 255, 255)' }, type: { family: 'Inter' } };
const RMAP = { pages: { p: { template: 'p', slots: { s01: { module: 'M1', layout: 'stack', width: 'narrow' }, s02: { module: 'M1', layout: 'stack', width: 'narrow' } } } } };
const evil = '<img src=x onerror=alert(1)>';
const figmaFrame = page([F('w', 'Wrapper', 0, 100, 1440, 900, [
  F('b1', 'Band one', 0, 100, 1440, 300, [T('r1', `Title ${evil}`, 0, 120, 600, 56, { fontSize: 46 }), T('r2', 'shout this', 0, 200, 300, 24, { textCase: 'UPPER' }), T('r3', 'title case me', 0, 240, 300, 24, { textCase: 'TITLE' })]),
  F('b2', 'Band two', 0, 500, 1440, 300, [T('r4', 'A long clamped paragraph whose every word must stay in the innerText even when CSS clamps it to one line on screen', 0, 520, 200, 24, { textTruncation: 'ENDING', maxLines: 1 })]),
])]);
const rendered = render({ slug: 'p', model: build(figmaFrame), tokens: RTOKENS, mapping: RMAP, now: '2026-01-01T00:00:00Z' }).html;

await test('renderer: figma strings escaped; casing via CSS on the raw characters; truncation via a clamp span', () => {
  assert.ok(!rendered.includes(evil) && rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(rendered, /text-transform: uppercase[^>]*>shout this</);
  assert.match(rendered, /class="clamp"/);
});

let pw = null;
try { pw = await import('playwright'); } catch { /* no browser here */ }
if (!pw) console.log('-    browser checks skipped: playwright does not resolve from here');
else {
  await test('browser: rendered innerText equals the text-gate reference (clamp keeps words; TITLE caseless)', async () => {
    const browser = await pw.chromium.launch();
    try {
      const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await pg.setContent(rendered);
      const text = await pg.evaluate(() => document.querySelector('main').innerText);
      const res = compareText(textReference(figmaFrame), { text, attrs: [] });
      assert.equal(res.verdict, 'PASS', JSON.stringify(res.findings));
      assert.ok(text.includes('SHOUT THIS'));
      // record Chrome's capitalize: it upper-cases each word's first letter, so it matches Figma TITLE here
      assert.ok(/Title Case Me/.test(text), text);
    } finally { await browser.close(); }
  });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
