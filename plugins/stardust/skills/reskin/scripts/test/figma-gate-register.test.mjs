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
import { workDir } from '../figma-gate/io.mjs';
import { buildRegister, contrast, mandateConflicts, registerMd } from '../figma-gate/register.mjs';
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
const geometry = { results: [
  { slot: 's01', id: 'g1', node: '1:4', measure: 'width', status: 'PASS' },
  { slot: 's02', id: 'g1', node: 'I1:7;5:7', measure: 'width', status: 'FAIL', detail: '540 vs 560 (±1)' },
] };
const ramp = { results: [
  { slot: 's01', id: 't1', node: '1:5', property: 'fontSize', status: 'PASS' },
  { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'PASS' },
] };
const base = { join: joined, geometry, ramp, pixel: { results: [] }, mapping: [...mapping, { slot: 's04', module: null, status: 'new-module' }], boxes, flags: ['source JSON-LD carried verbatim'], link };

check('buildRegister: one class per kind, counts, and Figma links on the rows with a node', () => {
  const reg = buildRegister(base);
  assert.deepEqual(reg.counts, { mandated: 1, unmandated: 1, 'out-of-kit': 1, conflict: 0, 'pre-existing': 1 });
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

check('buildRegister: a failing type entry is unmandated too; UNASSERTED is ignored', () => {
  const r = { results: [
    { slot: 's01', id: 't1', node: '1:5', property: 'fontSize', status: 'FAIL', detail: '16px vs 14px' },
    { slot: 's01', id: 't2', node: '1:6', property: 'color', status: 'UNASSERTED', detail: 'no solid fill' },
    { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'PASS' },
  ] };
  const reg = buildRegister({ ...base, ramp: r, geometry: { results: [{ slot: 's02', id: 'g1', node: 'x', measure: 'width', status: 'PASS' }] } });
  assert.deepEqual(reg.counts, { mandated: 1, unmandated: 1, 'out-of-kit': 1, conflict: 0, 'pre-existing': 1 });
  assert.equal(reg.rows.find((x) => x.class === 'mandated').slot, 's02');
  assert.equal(reg.rows.find((x) => x.class === 'unmandated').check, 'type t1 fontSize');
});

check('buildRegister: a section whose only results are UNASSERTED is not mandated', () => {
  const reg = buildRegister({ ...base, geometry: { results: [] }, ramp: { results: [{ slot: 's01', id: 't1', node: '1:5', property: 'color', status: 'UNASSERTED' }] } });
  assert.equal(reg.counts.mandated, 0);
});

check('buildRegister: a failing :root entry is an unmandated row with no slot, module or node', () => {
  const reg = buildRegister({ ...base, ramp: { results: [...ramp.results, { slot: null, id: '--color-brand', node: null, property: 'custom-property', status: 'FAIL', detail: '#fff vs #000' }] } });
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
  assert.match(md, /mandated 0 · unmandated 1 · out-of-kit 1 · conflict 0 · pre-existing 1/);
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

const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
let n = 0;
const project = () => { n += 1; return makeProject(join(scratch, `p${n}`)); };
const put = (p, name, obj) => { const d = workDir(p.dir, p.slug); mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), `${JSON.stringify(obj, null, 2)}\n`); };
const seed = (p, extra = {}) => {
  put(p, 'join.json', joined);
  put(p, 'geometry.json', { pass: true, results: geometry.results });
  put(p, 'ramp.json', ramp);
  for (const [name, obj] of Object.entries(extra)) put(p, name, obj);
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
  seed(p, { 'pixel.json': { results: [{ slot: 's01', mode: 'auto', verdict: 'n/a', reason: 'frame content differs', fonts: [] }] } });
  writeFileSync(join(p.dir, 'reskin', 'ledger.json'), JSON.stringify({ pages: { home: { flags: ['carried verbatim'] } } }));
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /register written: mandated 1 · unmandated 1 · out-of-kit 0 · conflict 0 · pre-existing 1/);
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

check('register without geometry/ramp/pixel files: those steps are "not run", nothing mandated, exit 0, no ledger needed', () => {
  const p = project();
  put(p, 'join.json', joined);
  const r = run(['register', '--page', 'home'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mandated 0 · unmandated 0 · out-of-kit 0 · conflict 0 · pre-existing 0/);
  const reg = JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'register.json'), 'utf8'));
  assert.deepEqual(reg.notRun, ['geometry', 'ramp', 'pixel']);
  assert.match(readFileSync(join(workDir(p.dir, p.slug), 'register.md'), 'utf8'), /Not run: geometry, ramp, pixel/);
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
