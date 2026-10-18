#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-register.test.mjs — B4, the divergence register: contrast and
// mandateConflicts (pure), buildRegister over step results (mandated / unmandated / out-of-kit /
// conflict / pre-existing, "not run" steps), registerMd, and the CLI `register` reading the step JSON
// files from the work dir (no browser). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCurrent } from '../figma/cache.mjs';
import { canonicalFigmaUrl } from '../figma/url.mjs';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { readInputs, workDir } from '../figma-gate/io.mjs';
import { checksFor } from '../figma-gate/prepare.mjs';
import { buildRegister, contrast, coverageLine, mandateConflicts, registerMd } from '../figma-gate/register.mjs';
import { sectionStamp, stampsOf } from '../figma-gate/stamp.mjs';
import { waiverImpacts } from '../figma-gate/waivers.mjs';
import { KEY, VERSION, makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-register-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const t = (size, weight, color = 'rgb(200, 200, 200)') => ({ id: 'T', type: 'TEXT', x: 0, y: 0, w: 10, h: 10, layout: null, fill: null, fillKind: 'NONE', children: [], text: { characters: 'x', fontSize: size, fontWeight: weight, color } });
const frame = (fill, kids, fillKind = fill ? 'SOLID' : 'NONE') => ({ id: 'F', type: 'FRAME', x: 0, y: 0, w: 10, h: 10, layout: null, text: null, fill, fillKind, children: kids });
const WHITE = 'rgb(255, 255, 255)';

check('contrast: equal colors 1, black on white 21, rgba alpha ignored', () => {
  assert.equal(contrast(WHITE, WHITE), 1);
  assert.equal(contrast('rgb(0, 0, 0)', WHITE).toFixed(1), '21.0');
  assert.equal(contrast('rgba(0, 0, 0, 0.5)', WHITE).toFixed(1), '21.0');
  assert.equal(contrast(WHITE, 'rgb(0, 0, 0)').toFixed(1), '21.0');
});

check('mandateConflicts: need 4.5 for body text, 3 for large text (24px, or 18.66px at 700)', () => {
  assert.equal(mandateConflicts(frame(WHITE, [t(16, 400)]))[0].need, 4.5);
  assert.equal(mandateConflicts(frame(WHITE, [t(24, 400)]))[0].need, 3);
  assert.equal(mandateConflicts(frame(WHITE, [t(18.66, 700)]))[0].need, 3);
  assert.equal(mandateConflicts(frame(WHITE, [t(18.66, 400)]))[0].need, 4.5);
});

check('mandateConflicts: a hit names node, ratio, fg and bg; a pass is no hit', () => {
  const [hit] = mandateConflicts(frame(WHITE, [t(16, 400)]));
  assert.equal(hit.node, 'T');
  assert.equal(hit.fg, 'rgb(200, 200, 200)');
  assert.equal(hit.bg, WHITE);
  assert.ok(hit.ratio > 1 && hit.ratio < 4.5);
  assert.deepEqual(mandateConflicts(frame(WHITE, [t(16, 400, 'rgb(0, 0, 0)')])), []);
});

check('mandateConflicts: no painting ancestor, a gradient ground, or a text without a solid color: no hit', () => {
  assert.deepEqual(mandateConflicts(frame(null, [t(16, 400)])), []);
  assert.deepEqual(mandateConflicts(frame(null, [t(16, 400)], 'GRADIENT_LINEAR')), []);
  assert.deepEqual(mandateConflicts(frame(WHITE, [t(16, 400, null)])), []);
});

check('mandateConflicts: the nearest painting ancestor is the ground, and a text does not ground itself', () => {
  const dark = frame('rgb(10, 10, 10)', [t(16, 400)]);
  assert.deepEqual(mandateConflicts(frame(WHITE, [dark])), []);
  const noPaint = frame(null, [t(16, 400)]);
  assert.equal(mandateConflicts(frame(WHITE, [noPaint])).length, 1);
  const grad = frame(null, [t(16, 400)], 'IMAGE');
  assert.deepEqual(mandateConflicts(frame(WHITE, [grad])), []);
});

check('mandateConflicts: the figma-kit roots 1:3 and 1:7 have no conflict', () => {
  assert.deepEqual(mandateConflicts(boxes.roots['1:3'].box), []);
  assert.deepEqual(mandateConflicts(boxes.roots['1:7'].box), []);
});

const joined = { pass: true, regime: 'local', width: 1440, sections: [
  { slot: 's01', module: 'M1', node: '1:3', selector: '[data-slot="s01"]', index: 0 },
  { slot: 's02', module: 'M2', node: '1:7', selector: '[data-slot="s02"]', index: 1 },
] };
const mapping = [
  { slot: 's01', module: 'M1', status: 'mapped' },
  { slot: 's02', module: 'M2', status: 'mapped' },
  { slot: 's03', module: null, status: 'chrome' },
];
const link = (id) => canonicalFigmaUrl({ fileKey: 'KITKEY', nodeId: id });
const checks = {
  s01: { root: '1:3', width: 1440, roots: { 1440: '1:3' }, geometry: [{ id: 'g1', measure: 'width', node: '1:4' }], type: [{ id: 't1', node: '1:5' }], waive: [] },
  s02: { root: '1:7', width: 1440, roots: { 1440: '1:7' }, geometry: [{ id: 'g1', measure: 'width', node: 'I1:7;5:7' }], type: [{ id: 't1', node: 'I1:7;5:2' }], waive: [] },
};
// The results as geometry.json and ramp.json record them: with the stamp of the checks they were measured against
// (`over` replaces sections of those checks).
const stamped = (results, over = {}) => ({ checksStamp: stampsOf({ ...checks, ...over }), results });
const geometry = stamped([
  { slot: 's01', id: 'g1', node: '1:4', measure: 'width', status: 'PASS' },
  { slot: 's02', id: 'g1', node: 'I1:7;5:7', measure: 'width', status: 'FAIL', detail: '540 vs 560 (±1)' },
]);
const ramp = stamped([
  { slot: 's01', id: 't1', node: '1:5', property: 'fontSize', status: 'PASS' },
  { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'PASS' },
]);
const full = { styles: { covered: 4, total: 4 }, widths: [1440], waived: 0 };
const coverage = { s01: full, s02: full };
const base = { join: joined, geometry, ramp, pixel: { results: [] }, mapping: [...mapping, { slot: 's04', module: null, status: 'new-module' }], boxes, flags: ['source JSON-LD carried verbatim'], link, checks, coverage };
const COUNTS = { mandated: 1, waived: 0, unmandated: 1, 'out-of-kit': 1, conflict: 0, 'pre-existing': 1 };

check('buildRegister: one class per kind, counts, and Figma links on the rows with a node', () => {
  const reg = buildRegister(base);
  assert.deepEqual(reg.counts, COUNTS);
  assert.match(reg.rows.find((r) => r.class === 'unmandated').link, /node-id=I1-7%3B5-7$/);
  const un = reg.rows.find((r) => r.class === 'unmandated');
  assert.deepEqual([un.slot, un.module, un.node, un.check, un.detail], ['s02', 'M2', 'I1:7;5:7', 'geometry g1 width', '540 vs 560 (±1)']);
  const man = reg.rows.find((r) => r.class === 'mandated');
  assert.deepEqual([man.slot, man.module, man.node], ['s01', 'M1', '1:3']);
  const oot = reg.rows.find((r) => r.class === 'out-of-kit');
  assert.deepEqual([oot.slot, oot.module, oot.node, oot.link], ['s04', null, null, null]);
  const pre = reg.rows.find((r) => r.class === 'pre-existing');
  assert.equal(pre.detail, 'source JSON-LD carried verbatim');
  assert.deepEqual(reg.notRun, []);
  assert.equal(reg.regime, 'local');
});

check('buildRegister: a result carrying root points its rows at the checks root: node and link of the unmandated and the mandated row', () => {
  const rooted = {
    geometry: stamped([
      { slot: 's01', id: 'g1', node: '1:4', root: '7:7', measure: 'width', status: 'PASS' },
      { slot: 's02', id: 'g1', node: 'I1:7;5:7', root: '9:9', measure: 'width', status: 'FAIL', detail: '540 vs 560 (±1)' },
    ]),
    ramp: stamped([
      { slot: 's01', id: 't1', node: '1:5', root: '7:7', property: 'fontSize', status: 'PASS' },
      { slot: 's02', id: 't1', node: 'I1:7;5:2', root: '9:9', property: 'fontSize', status: 'FAIL', detail: '16px vs 14px' },
      { slot: null, id: '--max-width', node: null, root: null, property: '--max-width', status: 'FAIL', detail: '1px vs 2px' },
    ]),
  };
  const reg = buildRegister({ ...base, ...rooted });
  const un = reg.rows.filter((r) => r.class === 'unmandated');
  assert.deepEqual(un.map((r) => [r.slot, r.node, r.check]), [['s02', '9:9', 'geometry g1 width'], ['s02', '9:9', 'type t1 fontSize'], [null, null, ':root --max-width']]);
  assert.ok(un.slice(0, 2).every((r) => /node-id=9-9$/.test(r.link)), JSON.stringify(un.map((r) => r.link)));
  assert.equal(un[2].link, null);
  const ok = buildRegister({ ...base, geometry: stamped([rooted.geometry.results[0]]), ramp: stamped([rooted.ramp.results[0]]) });
  const man = ok.rows.find((r) => r.class === 'mandated' && r.slot === 's01');
  assert.deepEqual([man.node, man.module], ['7:7', 'M1']);
  assert.match(man.link, /node-id=7-7$/);
});

check('buildRegister: a mandated section with no root in its results keeps the join frame, a failing entry its own node', () => {
  const reg = buildRegister(base);
  assert.equal(reg.rows.find((r) => r.class === 'mandated').node, '1:3');
  assert.equal(reg.rows.find((r) => r.class === 'unmandated').node, 'I1:7;5:7');
});

check('buildRegister: a failing type entry is unmandated too; UNASSERTED is ignored', () => {
  const r = stamped([
    { slot: 's01', id: 't1', node: '1:5', property: 'fontSize', status: 'FAIL', detail: '16px vs 14px' },
    { slot: 's01', id: 't2', node: '1:6', property: 'color', status: 'UNASSERTED', detail: 'no solid fill' },
    { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'PASS' },
  ]);
  const reg = buildRegister({ ...base, ramp: r, geometry: stamped([{ slot: 's01', id: 'g1', node: '1:4', measure: 'width', status: 'PASS' }, { slot: 's02', id: 'g1', node: 'x', measure: 'width', status: 'PASS' }]) });
  assert.deepEqual(reg.counts, COUNTS);
  assert.equal(reg.rows.find((x) => x.class === 'mandated').slot, 's02');
  assert.equal(reg.rows.find((x) => x.class === 'unmandated').check, 'type t1 fontSize');
});

check('buildRegister: a section whose only results are UNASSERTED is not mandated', () => {
  const reg = buildRegister({ ...base, geometry: stamped([]), ramp: stamped([{ slot: 's01', id: 't1', node: '1:5', property: 'color', status: 'UNASSERTED' }]) });
  assert.equal(reg.counts.mandated, 0);
});

check('buildRegister: a failing :root entry is an unmandated row with no slot, module or node', () => {
  const reg = buildRegister({ ...base, ramp: stamped([...ramp.results, { slot: null, id: '--color-brand', node: null, property: 'custom-property', status: 'FAIL', detail: '#fff vs #000' }]) });
  const row = reg.rows.find((r) => r.check === ':root --color-brand');
  assert.deepEqual([row.class, row.slot, row.module, row.node, row.link, row.detail], ['unmandated', null, null, null, null, '#fff vs #000']);
  assert.equal(reg.counts.unmandated, 2);
});

check('buildRegister: no geometry.json or ramp.json means "not run" and nothing is mandated', () => {
  const noRamp = buildRegister({ ...base, ramp: null });
  assert.deepEqual(noRamp.notRun, ['ramp']);
  assert.equal(noRamp.counts.mandated, 0);
  assert.equal(noRamp.counts.unmandated, 1);
  const none = buildRegister({ ...base, geometry: null, ramp: null, pixel: null });
  assert.deepEqual(none.notRun, ['geometry', 'ramp', 'pixel']);
  assert.equal(none.counts.mandated, 0);
  assert.equal(none.pixel, null);
});

check('buildRegister: a drifted join (pass false) mandates no section and lists "join drift" as not run', () => {
  const reg = buildRegister({ ...base, join: { ...joined, pass: false } });
  assert.equal(reg.counts.mandated, 0);
  assert.deepEqual(reg.notRun, ['join drift']);
  assert.equal(reg.counts.unmandated, 1);
  assert.deepEqual(buildRegister({ ...base, join: { ...joined, pass: false }, geometry: null, ramp: null, pixel: null }).notRun, ['join drift', 'geometry', 'ramp', 'pixel']);
  assert.equal(buildRegister({ ...base, join: { ...joined, pass: true } }).counts.mandated, 1);
});

check('buildRegister: a conflicting Figma text color in a joined root is a conflict row', () => {
  const bad = { roots: { '1:3': { box: frame(WHITE, [t(16, 400)]) }, '1:7': boxes.roots['1:7'] } };
  const reg = buildRegister({ ...base, boxes: bad });
  assert.equal(reg.counts.conflict, 1);
  const row = reg.rows.find((r) => r.class === 'conflict');
  assert.deepEqual([row.slot, row.module, row.node, row.check], ['s01', 'M1', 'T', 'contrast']);
  assert.match(row.detail, /^\d\.\d{2}:1 < 4\.5:1 \(rgb\(200, 200, 200\) on rgb\(255, 255, 255\)\)$/);
  assert.match(row.link, /node-id=T$/);
});

check('buildRegister: a section with a conflict is not for that reason unmandated, and no link without a link function', () => {
  const bad = { roots: { '1:3': { box: frame(WHITE, [t(16, 400)]) }, '1:7': boxes.roots['1:7'] } };
  const reg = buildRegister({ ...base, boxes: bad, link: () => null });
  assert.equal(reg.counts.mandated, 1);
  assert.ok(reg.rows.every((r) => r.link === null));
});

check('registerMd: counts, rows, the not-run line and the advisory pixel block with uncalibrated classes', () => {
  const pixel = { results: [
    { slot: 's02', mode: 'auto', verdict: 'advisory', pct: 0.42, textPct: 1.1, heightDelta: 0, fonts: [] },
    { slot: 's01', mode: 'auto', verdict: 'n/a', reason: 'frame content differs', fonts: [] },
  ] };
  const reg = { page: 'home', ...buildRegister({ ...base, pixel, ramp: null }) };
  const md = registerMd(reg);
  assert.match(md, /^# Divergence register: home/);
  assert.match(md, /mandated 0 · waived 0 · unmandated 1 · out-of-kit 1 · conflict 0 · pre-existing 1/);
  assert.match(md, /Not run: ramp/);
  assert.match(md, /geometry g1 width/);
  assert.match(md, /540 vs 560/);
  assert.match(md, /\[Figma\]\(https:\/\/www\.figma\.com\/design\/KITKEY\?node-id=I1-7%3B5-7\)/);
  assert.match(md, /Pixel \(advisory\)/);
  assert.match(md, /uncalibrated/);
  assert.match(md, /s02 0\.42% \(text 1\.10%, Δh 0\)/);
  assert.match(md, /s01 n\/a: frame content differs/);
  assert.doesNotMatch(registerMd({ page: 'home', ...buildRegister({ ...base, pixel: null }) }), /Pixel \(advisory\)/);
  assert.match(registerMd({ page: 'home', ...buildRegister({ ...base, pixel: null }) }), /Not run: pixel/);
});

const passing = {
  geometry: stamped([
    { slot: 's01', id: 'g1', node: '1:4', measure: 'width', status: 'PASS' },
    { slot: 's02', id: 'g1', node: 'I1:7;5:7', measure: 'width', status: 'PASS' },
  ]),
  ramp,
};
const waiving = (slot, section, cov) => ({ ...base, ...passing, checks: { ...checks, [slot]: { ...checks[slot], ...section } }, coverage: { ...coverage, [slot]: { ...full, ...cov } } });

check('buildRegister: a passing section with full coverage and no waiver is mandated', () => {
  const reg = buildRegister({ ...base, ...passing });
  assert.deepEqual(reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot), ['s01', 's02']);
  assert.deepEqual(reg.counts, { ...COUNTS, mandated: 2, unmandated: 0 });
});

check('buildRegister: one waiver makes the same section not mandated, with one waived row: node name and id, why, what it drops, the Figma link', () => {
  const reg = buildRegister(waiving('s01', { waive: [{ node: '1:6', why: 'lead copy is long-form' }] }, { styles: { covered: 3, total: 4 }, waived: 1 }));
  assert.deepEqual(reg.counts, { ...COUNTS, mandated: 1, unmandated: 0, waived: 1 });
  assert.deepEqual(reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot), ['s02']);
  const w = reg.rows.find((r) => r.class === 'waived');
  assert.deepEqual([w.slot, w.module, w.node, w.check], ['s01', 'M1', '1:6', 'waive node "Lead" (1:6)']);
  assert.equal(w.detail, '"lead copy is long-form": drops 1 text style (1 text node) at 1440px · 1 geometry and 1 type entries pass');
  assert.match(w.link, /node-id=1-6$/);
});

check('buildRegister: a container waiver says how many styles and nodes its subtree drops; a failing section keeps its unmandated rows beside it', () => {
  const reg = buildRegister(waiving('s02', { waive: [{ node: 'I1:7;5:7', why: 'card is a documentation panel' }] }, { styles: { covered: 2, total: 4 }, waived: 1 }));
  const w = reg.rows.find((r) => r.class === 'waived');
  assert.deepEqual([w.slot, w.check, w.detail], ['s02', 'waive node "Card" (I1:7;5:7)', '"card is a documentation panel": drops 2 text styles (2 text nodes) at 1440px · 1 geometry and 1 type entries pass']);
  const failed = buildRegister({ ...waiving('s02', { waive: [{ node: 'I1:7;5:7', why: 'card is a documentation panel' }] }, { waived: 1 }), geometry });
  assert.deepEqual([failed.counts.waived, failed.counts.unmandated, failed.counts.mandated], [1, 1, 1]);
  assert.equal(failed.rows.find((r) => r.class === 'waived').detail, '"card is a documentation panel": drops 2 text styles (2 text nodes) at 1440px', 'no pass tally on a failing section');
});

check('buildRegister: a TEXT waiver drops its style wherever the root has it', () => {
  const reg = buildRegister(waiving('s02', { waive: [{ node: 'I1:7;5:3', why: 'two feature lines, one style' }] }, { waived: 1 }));
  assert.match(reg.rows.find((r) => r.class === 'waived').detail, /^"two feature lines, one style": drops 1 text style \(2 text nodes\) at 1440px/);
});

check('buildRegister: a skipped section has no mandated row and a waived row for the skip; no coverage floor left but the skip says what it drops', () => {
  const skipped = { ...checks.s01, geometry: [], type: [], skip: 'composed beyond the kit' };
  const reg = buildRegister({ ...base, ...passing, geometry: stamped([passing.geometry.results[1]], { s01: skipped }), ramp: stamped([ramp.results[1]], { s01: skipped }),
    checks: { ...checks, s01: skipped },
    coverage: { ...coverage, s01: { styles: { covered: 0, total: 4 }, widths: [1440], waived: 1 } } });
  assert.deepEqual(reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot), ['s02']);
  const w = reg.rows.find((r) => r.class === 'waived');
  assert.deepEqual([w.slot, w.check, w.node, w.detail], ['s01', 'skip', '1:3', '"composed beyond the kit": drops the whole section, no geometry or type entries required: 4 text styles (4 text nodes) at 1440px']);
});

check('buildRegister: incomplete coverage with no waiver is an unmandated "coverage" row, never mandated', () => {
  const reg = buildRegister(waiving('s01', {}, { styles: { covered: 3, total: 4 } }));
  assert.deepEqual(reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot), ['s02']);
  const row = reg.rows.find((r) => r.class === 'unmandated');
  assert.deepEqual([row.slot, row.check, row.detail], ['s01', 'coverage', 'text styles 3/4 have a type entry']);
});

check('buildRegister: no coverage means nothing is mandated and "coverage" is not run (a join drift says only that)', () => {
  const reg = buildRegister({ ...base, ...passing, checks: undefined, coverage: undefined });
  assert.equal(reg.counts.mandated, 0);
  assert.deepEqual(reg.notRun, ['coverage']);
  assert.deepEqual(buildRegister({ ...base, join: { ...joined, pass: false }, checks: undefined, coverage: undefined }).notRun, ['join drift']);
});

const text = (id, size) => ({ id, name: id, type: 'TEXT', x: 0, y: 0, w: 10, h: 10, layout: null, fill: null, fillKind: 'NONE', children: [], text: { characters: 'x', fontFamily: 'Inter', fontSize: size, fontWeight: 400, lineHeightPx: 20, letterSpacing: 0, color: 'rgb(0, 0, 0)' } });
const group = (id, name, type, w, kids) => ({ id, name, type, x: 0, y: 0, w, h: 10, layout: null, text: null, fill: null, fillKind: 'NONE', children: kids });

check('waiverImpacts: a container whose style also lives outside it drops the nodes, not the style; the widths are the roots holding it', () => {
  const desktop = group('D', 'Desktop', 'INSTANCE', 1440, [group('A', 'Panel', 'FRAME', 600, [text('a1', 16), text('a2', 40)]), text('b1', 16)]);
  const tablet = group('T', 'Tablet', 'INSTANCE', 768, [group('A', 'Panel', 'FRAME', 600, [text('a3', 12)])]);
  const synth = { roots: { D: { box: desktop }, T: { box: tablet } } };
  const section = { root: 'D', roots: { 1440: 'D', 768: 'T' }, waive: [{ node: 'A', why: 'notation' }] };
  const [w] = waiverImpacts(section, { node: 'D' }, synth);
  assert.equal(w.check, 'waive node "Panel" (A)');
  assert.equal(w.detail, '"notation": drops 1 text style (1 text node) at 768px; 1 text style (2 text nodes) at 1440px');
});

check('waiverImpacts: a mobile waiver names the mobile variant of the module frame, its styles, nodes and width', () => {
  const desktop = group('D', 'Desktop', 'INSTANCE', 1440, [text('d1', 16)]);
  const mobile = group('V', 'Hero / Mobile', 'INSTANCE', 360, [text('m1', 14), text('m2', 18), text('m3', 14)]);
  const kit = group('M', 'Hero', 'FRAME', 2000, [desktop, mobile]);
  const synth = { roots: { M: { box: kit }, D: { box: desktop } } };
  const section = { root: 'D', roots: { 1440: 'D' }, waive: [{ width: 'mobile', why: 'phone layout is built later' }] };
  const [w] = waiverImpacts(section, { node: 'M' }, synth);
  assert.deepEqual([w.check, w.node], ['waive width mobile', 'V']);
  assert.equal(w.detail, '"phone layout is built later": drops the mobile root "Hero / Mobile" (V): 2 text styles (3 text nodes) at 360px');
  const [none] = waiverImpacts(section, { node: 'D' }, { roots: { D: { box: desktop } } });
  assert.equal(none.detail, '"phone layout is built later": drops the mobile root, which the module frame does not hold: 0 text styles (0 text nodes)');
});

check('waiverImpacts: a desktop waiver names the module frame\'s desktop variant, its styles, nodes and width; a page section is its own desktop', () => {
  const desktop = group('D', 'Hero / Desktop', 'INSTANCE', 1440, [text('d1', 16), text('d2', 40), text('d3', 16)]);
  const mobile = group('V', 'Hero / Mobile', 'INSTANCE', 360, [text('m1', 14)]);
  const kit = group('M', 'Hero', 'FRAME', 2000, [group('W', 'Wrapper', 'FRAME', 1500, [desktop]), mobile]);
  const synth = { roots: { M: { box: kit }, V: { box: mobile } } };
  const section = { root: 'V', roots: { 360: 'V' }, waive: [{ width: 'desktop', why: 'the hero is only shown at phone width' }] };
  const [w] = waiverImpacts(section, { node: 'M' }, synth);
  assert.deepEqual([w.check, w.node], ['waive width desktop', 'D']);
  assert.equal(w.detail, '"the hero is only shown at phone width": drops the desktop root "Hero / Desktop" (D): 2 text styles (3 text nodes) at 1440px');
  const page = group('P', 'Home section', 'FRAME', 1440, [text('p1', 16)]);
  const [own] = waiverImpacts({ root: 'P', roots: { 360: 'P' }, waive: section.waive }, { node: 'P' }, { roots: { P: { box: page } } });
  assert.equal(own.detail, '"the hero is only shown at phone width": drops the desktop root "Home section" (P): 1 text style (1 text node) at 1440px');
  assert.equal(own.node, 'P');
  const [none] = waiverImpacts(section, { node: 'V' }, { roots: { V: { box: mobile } } });
  assert.equal(none.detail, '"the hero is only shown at phone width": drops the desktop root, which the module frame does not hold: 0 text styles (0 text nodes)');
  assert.equal(none.node, 'V', 'the section root when no desktop root is held');
  const [mixed] = waiverImpacts(section, { node: 'M' }, { roots: { M: { box: group('M', 'Hero', 'FRAME', 2000, [mobile]) } } });
  assert.match(mixed.detail, /which the module frame does not hold/, 'a frame holding a mobile variant and no desktop variant is not itself the desktop');
});

check('buildRegister: a desktop waiver is a waived row naming desktop, its why and what it drops; the section is not mandated', () => {
  const reg = buildRegister(waiving('s01', { waive: [{ width: 'desktop', why: 'the hero is only shown at phone width' }] }, { waived: 1 }));
  assert.deepEqual(reg.counts, { ...COUNTS, mandated: 1, unmandated: 0, waived: 1 });
  assert.deepEqual(reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot), ['s02']);
  const w = reg.rows.find((r) => r.class === 'waived');
  assert.deepEqual([w.slot, w.module, w.node, w.check], ['s01', 'M1', '1:3', 'waive width desktop']);
  assert.equal(w.detail, '"the hero is only shown at phone width": drops the desktop root "Hero" (1:3): 4 text styles (4 text nodes) at 1440px · 1 geometry and 1 type entries pass');
  const md = registerMd({ page: 'home', ...reg });
  assert.match(md, /## waived \(1\)/);
  assert.match(md, /\| s01 \| M1 \| 1:3 \| waive width desktop \| "the hero is only shown at phone width": drops the desktop root "Hero" \(1:3\)/);
});

check('coverageLine: text styles, the widths of every section, waivers; empty is none', () => {
  assert.equal(coverageLine({ s01: { styles: { covered: 4, total: 4 }, widths: [360, 1440], waived: 0 }, s02: { styles: { covered: 3, total: 4 }, widths: [1440], waived: 1 } }), 'text styles 7/8 · widths 360,1440 · waived 1');
  assert.equal(coverageLine({}), 'text styles 0/0 · widths none · waived 0');
});

const staleRows = (reg) => reg.rows.filter((r) => r.check === 'stale');
const mandatedSlots = (reg) => reg.rows.filter((r) => r.class === 'mandated').map((r) => r.slot);

check('buildRegister: step files of an older checks file never make a section mandated: an entry with no result is a "stale" row saying so', () => {
  // The run was made when a container waiver excused these type entries; the file now has them and no waiver.
  const grown = { ...checks, s01: { ...checks.s01, type: [...checks.s01.type, { id: 't2', node: '1:6' }, { id: 't3', node: 'I1:20;3:5' }] } };
  const reg = buildRegister({ ...base, ...passing, checks: grown });
  assert.deepEqual(mandatedSlots(reg), ['s02']);
  const [row] = staleRows(reg);
  assert.deepEqual([row.class, row.slot, row.module, row.node, row.detail], ['unmandated', 's01', 'M1', '1:3', '2 entries of the checks file have no result (t2, t3): re-run figma-gate all']);
  assert.equal(staleRows(reg).length, 1);
  const lone = buildRegister({ ...base, ...passing, checks: { ...checks, s02: { ...checks.s02, geometry: [...checks.s02.geometry, { id: 'g2', measure: 'height', node: '1:7' }] } } });
  assert.equal(staleRows(lone)[0].detail, '1 entry of the checks file has no result (g2): re-run figma-gate all');
});

check('buildRegister: the same ids on another version of the section (a tolerance, a node) are stale too: the stamp of each step file is compared', () => {
  const changed = { ...checks.s01, geometry: [{ ...checks.s01.geometry[0], tolerancePx: 3 }] };
  const now = { ...checks, s01: changed };
  const reg = buildRegister({ ...base, ...passing, checks: now });
  assert.deepEqual(mandatedSlots(reg), ['s02']);
  assert.equal(staleRows(reg)[0].detail, 'geometry.json and ramp.json measured another version of the section: re-run figma-gate all');
  const geometryOnly = buildRegister({ ...base, ...passing, checks: now, ramp: stamped(ramp.results, { s01: changed }) });
  assert.equal(staleRows(geometryOnly)[0].detail, 'geometry.json measured another version of the section: re-run figma-gate all');
  const unstamped = buildRegister({ ...base, ...passing, geometry: { results: passing.geometry.results } });
  assert.deepEqual(mandatedSlots(unstamped), [], 'step files that recorded no stamp vouch for nothing');
  assert.deepEqual(staleRows(unstamped).map((r) => [r.slot, r.detail]), ['s01', 's02'].map((slot) => [slot, 'geometry.json measured another version of the section: re-run figma-gate all']));
});

check('buildRegister: results of this checks file are mandated, and a waiver or skip added since is no staleness (it measures nothing)', () => {
  assert.deepEqual(mandatedSlots(buildRegister({ ...base, ...passing })), ['s01', 's02']);
  assert.equal(staleRows(buildRegister({ ...base, ...passing })).length, 0);
  const waived = buildRegister(waiving('s01', { waive: [{ node: '1:6', why: 'lead copy is long-form' }] }, { waived: 1 }));
  assert.equal(staleRows(waived).length, 0);
  assert.deepEqual([mandatedSlots(waived), waived.counts.waived], [['s02'], 1]);
});

check('sectionStamp: key order, waivers, skip and pixel do not change it; a node, a tolerance, an entry or a root do', () => {
  const s = checks.s01;
  const stamp = sectionStamp(s);
  assert.match(stamp, /^[0-9a-f]{16}$/);
  assert.equal(sectionStamp({ ...s, geometry: [{ node: '1:4', measure: 'width', id: 'g1' }] }), stamp);
  assert.equal(sectionStamp({ ...s, waive: [{ node: '1:6', why: 'x' }], skip: 'y', pixel: { mode: 'off', why: 'z' } }), stamp);
  for (const other of [
    { ...s, geometry: [{ ...s.geometry[0], node: '1:5' }] },
    { ...s, geometry: [{ ...s.geometry[0], tolerancePx: 2 }] },
    { ...s, type: [...s.type, { id: 't2', node: '1:6' }] },
    { ...s, roots: { 1440: '1:7' } },
    { ...s, width: 1280 },
  ]) assert.notEqual(sectionStamp(other), stamp);
  assert.deepEqual(Object.keys(stampsOf(checks)), ['s01', 's02']);
});

check('registerMd: a waived section lists each waiver row with its node name and id, why and what it drops', () => {
  const reg = buildRegister(waiving('s02', { waive: [{ node: 'I1:7;5:7', why: 'card is a documentation panel' }] }, { waived: 1 }));
  const md = registerMd({ page: 'home', ...reg });
  assert.match(md, /mandated 1 · waived 1 · /);
  assert.match(md, /## waived \(1\)/);
  assert.match(md, /\| s02 \| M2 \| I1:7;5:7 \| waive node "Card" \(I1:7;5:7\) \| "card is a documentation panel": drops 2 text styles \(2 text nodes\) at 1440px/);
});

const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
let n = 0;
const project = () => { n += 1; return makeProject(join(scratch, `p${n}`)); };
const put = (p, name, obj, regime = 'local') => { const d = workDir(p.dir, p.slug, regime); mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), `${JSON.stringify(obj, null, 2)}\n`); };
// The step files `all` would write for the checks file the project has now: a result for every entry, PASS but for
// `fail` ({ "<slot> <id>": detail }), each with the stamp of the checks; `roots` ({ "<slot> <id>": node }) sets a result's root.
const measured = (p, fail = {}, roots = {}) => {
  const { checks } = checksFor({ dir: p.dir, slug: p.slug, inputs: readInputs(p.dir, p.slug, ['checks', 'donorTokens']), join: joined });
  const result = (slot, e, extra) => ({ slot, id: e.id, node: e.node ?? e.nodes?.[0] ?? null, ...(roots[`${slot} ${e.id}`] ? { root: roots[`${slot} ${e.id}`] } : {}), ...extra, ...(fail[`${slot} ${e.id}`] ? { status: 'FAIL', detail: fail[`${slot} ${e.id}`] } : { status: 'PASS' }) });
  const files = (kind, extra) => Object.entries(checks).flatMap(([slot, s]) => s[kind].map((e) => result(slot, e, extra(e))));
  const geometryResults = files('geometry', (e) => ({ measure: e.measure }));
  const rampResults = files('type', () => ({ property: 'fontSize' }));
  return {
    geometry: { pass: geometryResults.every((r) => r.status === 'PASS'), checksStamp: stampsOf(checks), results: geometryResults },
    ramp: { pass: rampResults.every((r) => r.status === 'PASS'), checksStamp: stampsOf(checks), results: rampResults },
  };
};
const DETAIL = { 's02 g1': '540 vs 560 (±1)' };
const seed = (p, { fail = DETAIL, roots = {}, regime = 'local', files = {} } = {}) => {
  const m = measured(p, fail, roots);
  put(p, 'join.json', { ...joined, regime }, regime);
  put(p, 'geometry.json', m.geometry, regime);
  put(p, 'ramp.json', m.ramp, regime);
  for (const [name, obj] of Object.entries(files)) put(p, name, obj, regime);
};

check('register without join.json: exit 2 naming the steps to run first, nothing written', () => {
  const p = project();
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /join/);
  assert.match(r.stderr, /all/);
  assert.ok(!existsSync(join(workDir(p.dir, p.slug), 'register.json')));
});

check('register without --page: exit 2', () => {
  const p = project();
  assert.equal(run(['register'], p.root).status, 2);
  assert.equal(run(['register', '--page'], p.root).status, 2);
});

check('register reads the step files, writes register.json and register.md, prints counts, exit 0', () => {
  const p = project();
  seed(p, { files: { 'pixel.json': { results: [{ slot: 's01', mode: 'auto', verdict: 'n/a', reason: 'frame content differs', fonts: [] }] } } });
  writeFileSync(join(p.dir, 'reskin', 'ledger.json'), JSON.stringify({ pages: { home: { flags: ['carried verbatim'] } } }));
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /register written: mandated 1 · waived 0 · unmandated 1 · out-of-kit 0 · conflict 0 · pre-existing 1/);
  const md = join(workDir(p.dir, p.slug), 'register.md');
  assert.ok(r.stdout.includes(join('stardust', '.work', 'reskin', 'gates', 'home', 'figma', 'register.md')), r.stdout);
  const reg = JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'register.json'), 'utf8'));
  assert.deepEqual(Object.keys(reg), ['page', 'regime', 'counts', 'rows', 'notRun', 'pixel']);
  assert.equal(reg.page, 'home');
  assert.equal(reg.regime, 'local');
  assert.deepEqual(reg.notRun, []);
  assert.match(reg.rows.find((x) => x.class === 'unmandated').link, /^https:\/\/www\.figma\.com\/design\/KITKEY\?node-id=/);
  assert.match(readFileSync(md, 'utf8'), /carried verbatim/);
});

check('register --target preview reads and writes the preview run\'s directory; the local run\'s files stay as they were', () => {
  const p = project();
  seed(p);
  seed(p, { regime: 'preview', roots: { 's02 g1': '9:9' } });
  const local = workDir(p.dir, p.slug);
  const preview = workDir(p.dir, p.slug, 'preview');
  assert.ok(preview.endsWith(join('gates', 'home', 'figma-preview')) && local.endsWith(join('gates', 'home', 'figma')), `${preview} ${local}`);
  const before = readFileSync(join(local, 'geometry.json'), 'utf8');
  const r = run(['register', '--page', 'home', '--target', 'preview'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(join(preview, 'register.md').replace(`${p.root}/`, '')), r.stdout);
  const reg = JSON.parse(readFileSync(join(preview, 'register.json'), 'utf8'));
  assert.equal(reg.regime, 'preview');
  assert.deepEqual(reg.rows.find((x) => x.class === 'unmandated').node, '9:9');
  assert.equal(existsSync(join(local, 'register.json')), false, 'nothing was written to the local directory');
  assert.equal(readFileSync(join(local, 'geometry.json'), 'utf8'), before);
  assert.equal(run(['register', '--page', 'home'], p.root).status, 0);
  assert.equal(JSON.parse(readFileSync(join(local, 'register.json'), 'utf8')).regime, 'local');
  assert.equal(JSON.parse(readFileSync(join(preview, 'register.json'), 'utf8')).regime, 'preview', 'the local register did not overwrite the preview one');
});

check('register without a join.json of its regime names the other regime\'s when there is one', () => {
  const p = project();
  put(p, 'join.json', { ...joined, regime: 'preview' }, 'preview');
  const local = run(['register', '--page', 'home'], p.root);
  assert.equal(local.status, 2);
  assert.match(local.stderr, /figma[/\\]join\.json/);
  assert.match(local.stderr, /there is a join\.json for --target preview/);
  const none = run(['register', '--page', 'home', '--target', 'preview'], project().root);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /figma-preview[/\\]join\.json.*--target preview --reskin/);
  assert.equal(run(['register', '--page', 'home', '--target', 'remote'], p.root).status, 2);
  assert.equal(run(['register', '--page', 'home', '--reskin', 'x.html'], p.root).status, 2, 'local takes no --reskin');
});

check('register reads the waivers of the checks file: a waived row names the node, quotes the why, counts what it drops; the section is not mandated', () => {
  const p = project();
  seed(p);
  const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
  const checksFile = JSON.parse(readFileSync(file, 'utf8'));
  checksFile.sections.s01.waive = [{ node: '1:6', why: 'lead copy is long-form' }];
  writeFileSync(file, JSON.stringify(checksFile));
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /register written: mandated 0 · waived 1 · unmandated 1 /);
  const reg = JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'register.json'), 'utf8'));
  const w = reg.rows.find((x) => x.class === 'waived');
  assert.deepEqual([w.slot, w.module, w.node, w.check], ['s01', 'M1', '1:6', 'waive node "Lead" (1:6)']);
  assert.match(w.detail, /^"lead copy is long-form": drops 1 text style \(1 text node\) at 1440px/);
  assert.match(readFileSync(join(workDir(p.dir, p.slug), 'register.md'), 'utf8'), /## waived \(1\)[^]*waive node "Lead" \(1:6\)[^]*"lead copy is long-form"/);
});

check('register run on its own after the checks file changed since the run: the section is not mandated and a stale row says to re-run all; a fresh run is mandated', () => {
  const p = project();
  const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
  const fixture = readFileSync(file, 'utf8');
  // The run is made while a container waiver stands in for most of s01's type entries.
  const first = JSON.parse(fixture);
  first.sections.s01.type = first.sections.s01.type.filter((t) => t.id !== 't2');
  first.sections.s01.waive = [{ node: '1:20', why: 'documentation button' }];
  writeFileSync(file, JSON.stringify(first));
  seed(p, { fail: {} });
  const registerOf = () => JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'register.json'), 'utf8'));
  let r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mandated 1 · waived 1 · unmandated 0 /);
  // The author removes the waiver and adds the entries the floor wants, then runs register without a new run.
  writeFileSync(file, fixture);
  r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mandated 1 · waived 0 · unmandated 1 /);
  const reg = registerOf();
  assert.deepEqual(reg.rows.filter((x) => x.class === 'mandated').map((x) => x.slot), ['s02']);
  const stale = reg.rows.find((x) => x.check === 'stale');
  assert.deepEqual([stale.class, stale.slot, stale.detail], ['unmandated', 's01', '1 entry of the checks file has no result (t2): re-run figma-gate all']);
  assert.match(readFileSync(join(workDir(p.dir, p.slug), 'register.md'), 'utf8'), /\| s01 \| M1 \| 1:3 \| stale \| 1 entry of the checks file has no result/);
  // A changed tolerance with every id still present is stale as well.
  const tuned = JSON.parse(fixture);
  tuned.sections.s01.geometry[0].tolerancePx = 3;
  tuned.sections.s01.geometry[0].why = 'content moves it';
  seed(p, { fail: {} });
  writeFileSync(file, JSON.stringify(tuned));
  run(['register', '--page', 'home'], p.root);
  assert.equal(registerOf().rows.find((x) => x.check === 'stale').detail, 'geometry.json and ramp.json measured another version of the section: re-run figma-gate all');
  // A run made with the file as it stands: both sections are mandated.
  seed(p, { fail: {} });
  r = run(['register', '--page', 'home'], p.root);
  assert.match(r.stdout, /mandated 2 · waived 0 · unmandated 0 /);
  assert.equal(registerOf().rows.some((x) => x.check === 'stale'), false);
});

check('register needs the checks file: missing or invalid is exit 2 naming it, a drifted join excepted from validation', () => {
  const p = project();
  seed(p);
  const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
  const good = readFileSync(file, 'utf8');
  const bad = JSON.parse(good);
  bad.sections.s01.waive = [{ node: '1:6' }];
  writeFileSync(file, JSON.stringify(bad));
  const invalid = run(['register', '--page', 'home'], p.root);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /home\.json has 1 problem\(s\)[^]*waive\[0\] needs why/);
  assert.equal(existsSync(join(workDir(p.dir, p.slug), 'register.json')), false);
  put(p, 'join.json', { ...joined, pass: false, problems: ['section drift: s02 before s01'] });
  assert.equal(run(['register', '--page', 'home'], p.root).status, 0, 'a drifted join has no sections to validate');
  rmSync(file);
  const missing = run(['register', '--page', 'home'], p.root);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing .*figma-checks[/\\]home\.json/);
});

check('register on step files whose results carry root: the rows and register.md link to the root, the regime comes from join.json', () => {
  const p = project();
  seed(p, { regime: 'preview', roots: { 's02 g1': '9:9' } });
  const r = run(['register', '--page', 'home', '--target', 'preview'], p.root);
  assert.equal(r.status, 0, r.stderr);
  const out = workDir(p.dir, p.slug, 'preview');
  const reg = JSON.parse(readFileSync(join(out, 'register.json'), 'utf8'));
  assert.equal(reg.regime, 'preview');
  const un = reg.rows.find((x) => x.class === 'unmandated');
  assert.deepEqual([un.node, un.link], ['9:9', 'https://www.figma.com/design/KITKEY?node-id=9-9']);
  assert.match(readFileSync(join(out, 'register.md'), 'utf8'), /regime preview/);
  assert.match(readFileSync(join(out, 'register.md'), 'utf8'), /\[Figma\]\(https:\/\/www\.figma\.com\/design\/KITKEY\?node-id=9-9\)/);
});

check('register without geometry/ramp/pixel files: those steps are "not run", nothing mandated, exit 0, no ledger needed', () => {
  const p = project();
  put(p, 'join.json', joined);
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mandated 0 · waived 0 · unmandated 0 · out-of-kit 0 · conflict 0 · pre-existing 0/);
  const reg = JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'register.json'), 'utf8'));
  assert.deepEqual(reg.notRun, ['geometry', 'ramp', 'pixel']);
  assert.match(readFileSync(join(workDir(p.dir, p.slug), 'register.md'), 'utf8'), /Not run: geometry, ramp, pixel/);
});

check('register on a drifted join.json: nothing mandated, "Not run: join drift" in register.md, exit 0', () => {
  const p = project();
  seed(p);
  put(p, 'join.json', { ...joined, pass: false, problems: ['section drift: s02 before s01'] });
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mandated 0 /);
  assert.match(readFileSync(join(workDir(p.dir, p.slug), 'register.md'), 'utf8'), /Not run: join drift/);
});

check('register under --confidential: node ids without file links', () => {
  const p = project();
  spawnSync('git', ['init', '-q'], { cwd: p.root });
  writeFileSync(join(p.dir, '.gitignore'), '.work/\nreskin/figma-checks/\n');
  writeCurrent(p.dir, KEY, VERSION, true);
  seed(p);
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  const dirOut = workDir(p.dir, p.slug);
  const reg = JSON.parse(readFileSync(join(dirOut, 'register.json'), 'utf8'));
  assert.ok(reg.rows.length > 0);
  assert.ok(reg.rows.every((x) => x.link === null));
  assert.ok(reg.rows.some((x) => x.node === 'I1:7;5:7'));
  assert.doesNotMatch(readFileSync(join(dirOut, 'register.md'), 'utf8'), /figma\.com/);
});

check('register with a corrupt step file: exit 2 naming the file', () => {
  const p = project();
  put(p, 'join.json', joined);
  writeFileSync(join(workDir(p.dir, p.slug), 'geometry.json'), '{ nope');
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /geometry\.json/);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
