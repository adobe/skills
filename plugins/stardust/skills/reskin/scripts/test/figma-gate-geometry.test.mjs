#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-geometry.test.mjs — B1, geometry: expected, observed and judge
// (pure, over the synthetic kit), then runGeometry and the CLI `geometry` against fixtures/figma-gate/page.html
// in plain Chromium (needs playwright; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { expected, judge, observed, runGeometry } from '../figma-gate/geometry.mjs';
import { prepare } from '../figma-gate/prepare.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-geometry-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const root = boxes.roots['1:7'].box;

await check('expected: measures relative to the root box, from a node or a token', () => {
  assert.deepEqual(expected({ measure: 'width', node: 'I1:7;5:7' }, root, {}), { want: 560, source: 'node I1:7;5:7' });
  assert.equal(expected({ measure: 'right', node: 'I1:7;5:7' }, root, {}).want, 760);
  assert.equal(expected({ measure: 'gapX', nodes: ['I1:7;5:3', 'I1:7;5:4'] }, root, {}).want, 80);
  assert.equal(expected({ measure: 'paddingTop', node: '1:7' }, root, {}).want, 80);
  assert.deepEqual(expected({ measure: 'paddingLeft', token: 'layout.containerPaddingMobile' }, root, { layout: { containerPaddingMobile: '24px' } }), { want: 24, source: 'token layout.containerPaddingMobile' });
});

await check('judge: within tolerancePx passes, beyond fails with "got vs want (±tol)", null is unmeasurable', () => {
  assert.equal(judge({ tolerancePx: 1 }, 560, 561).status, 'PASS');
  assert.deepEqual(judge({ tolerancePx: 1 }, 560, 562), { status: 'FAIL', detail: '562 vs 560 (±1)' });
  assert.equal(judge({ tolerancePx: 4 }, 560, 556).status, 'PASS');
  assert.match(judge({ tolerancePx: 1 }, 80, null, 'one match for a gap').detail, /^unmeasurable: one match for a gap/);
  assert.equal(judge({ tolerancePx: 1 }, 80, null, 'x').status, 'FAIL');
});

const S = 'main section[data-slot="s02"]';
const items = [
  { sel: S, x: 0, y: 640, w: 1440, h: 800, pad: '80 120 80 120' },
  { sel: `${S} .card`, x: 120, y: 900, w: 560, h: 240, pad: '24 24 24 24' },
  { sel: `${S} .feature`, x: 120, y: 800, w: 560, h: 56 },
  { sel: `${S} .feature`, x: 760, y: 800, w: 560, h: 56 },
];

await check('observed: rects relative to the section, paddings from "T R B L", gaps between two matches', () => {
  const geo = [
    { id: 'w', selector: '.card', measure: 'width' },
    { id: 'l', selector: '.card', measure: 'left' },
    { id: 'g', selector: '.feature', measure: 'gapX' },
    { id: 'p', selector: ':scope', measure: 'paddingTop' },
  ];
  assert.deepEqual(observed(geo, items, S).map((o) => o.value), [560, 120, 80, 80]);
  const more = [
    { id: 'r', selector: '.card', measure: 'right' },
    { id: 't', selector: '.card', measure: 'top' },
    { id: 'pl', selector: '.card', measure: 'paddingLeft' },
    { id: 'i', selector: '.feature', measure: 'left', index: 1 },
  ];
  assert.deepEqual(observed(more, items, S).map((o) => o.value), [760, 260, 24, 760]);
});

await check('observed: null with a reason for a missing selector, a lone gap match, a zero-size box, no section', () => {
  assert.match(observed([{ id: 'x', selector: '.nope', measure: 'width' }], [items[0], { sel: `${S} .nope`, missing: true }], S)[0].why, /matched nothing/);
  const lone = observed([{ id: 'g', selector: '.card', measure: 'gapX' }], items, S)[0];
  assert.equal(lone.value, null);
  assert.match(lone.why, /gap needs two/);
  const flat = observed([{ id: 'z', selector: '.card', measure: 'width' }], [items[0], { sel: `${S} .card`, x: 0, y: 0, w: 0, h: 0, pad: '0 0 0 0' }], S)[0];
  assert.match(flat.why, /zero-size/);
  assert.match(observed([{ id: 'x', selector: '.card', measure: 'width' }], [{ sel: S, missing: true }], S)[0].why, /matched nothing/);
});

await check('observed: observed items are looked up by the scoped selector: :scope > …, a comma list scoped branch by branch, a plain descendant as before', () => {
  const rows = [
    { sel: S, x: 0, y: 640, w: 1440, h: 800, pad: '80 120 80 120' },
    { sel: `${S} > .card`, x: 120, y: 900, w: 560, h: 240, pad: '24 24 24 24' },
    { sel: `${S} .nope, ${S} .card`, x: 120, y: 900, w: 560, h: 240, pad: '24 24 24 24' },
    { sel: `${S} .nope`, missing: true },
    { sel: `${S} :is(.card, .feature)`, x: 120, y: 800, w: 560, h: 56 },
  ];
  assert.deepEqual(observed([{ id: 'a', selector: ':scope > .card', measure: 'width' }], rows, S), [{ id: 'a', value: 560 }]);
  assert.deepEqual(observed([{ id: 'b', selector: '.nope, .card', measure: 'left' }], rows, S), [{ id: 'b', value: 120 }]);
  assert.deepEqual(observed([{ id: 'c', selector: ':is(.card, .feature)', measure: 'height' }], rows, S), [{ id: 'c', value: 56 }], 'a comma inside :is() is not a branch');
  assert.match(observed([{ id: 'd', selector: ':scope > .gone', measure: 'width' }], rows, S)[0].why, /^:scope > \.gone matched nothing in the section/);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  runGeometry and the geometry CLI against page.html (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const project = (n) => makeProject(join(scratch, n));
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const geometryOf = (p) => JSON.parse(readFileSync(join(p.dir, '.work', 'reskin', 'gates', p.slug, 'figma', 'geometry.json'), 'utf8'));
  const urlOf = (p) => pathToFileURL(p.page).href;
  const gate = async (p) => {
    const ready = await prepare({ dir: p.dir, slug: p.slug, url: urlOf(p) });
    assert.equal(ready.drift, false);
    return runGeometry({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, out: ready.out });
  };

  await check('every geometry entry of the fixture checks passes on page.html; geometry.json is written', async () => {
    const p = project('pass');
    const r = await gate(p);
    assert.equal(r.results.length, 10);
    assert.deepEqual(r.results.filter((x) => x.status !== 'PASS'), []);
    assert.equal(r.pass, true);
    assert.deepEqual(r.results.find((x) => x.slot === 's02' && x.id === 'g3'), { slot: 's02', id: 'g3', measure: 'gapX', node: 'I1:7;5:3', root: '1:7', want: 80, got: 80, status: 'PASS', detail: '80 vs 80 (±1)' });
    assert.deepEqual(r.results.map((x) => [x.slot, x.root]), [...Array(6).fill(['s01', '1:3']), ...Array(4).fill(['s02', '1:7'])]);
    assert.deepEqual(geometryOf(p).results, r.results);
  });

  await check('on a local page previewSelector is not used: the entry is measured by its selector', async () => {
    const p = project('local-ignores');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    checks.sections.s02.geometry[0].previewSelector = '.cards > div';
    writeFileSync(file, JSON.stringify(checks));
    const r = await gate(p);
    assert.equal(r.results.find((x) => x.slot === 's02' && x.id === 'g1').status, 'PASS');
    assert.deepEqual(r.results.filter((x) => x.status !== 'PASS'), []);
  });

  await check(':scope > …, a comma list and a descendant selector all resolve inside the section on a real page', async () => {
    const p = project('scoped');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    const [g1, g2, g3] = checks.sections.s02.geometry;
    g1.selector = ':scope > .card';
    g2.selector = '.nope, :scope > .card';
    g3.selector = ':scope > .columns .feature';
    writeFileSync(file, JSON.stringify(checks));
    const r = await gate(p);
    assert.deepEqual(r.results.filter((x) => x.status !== 'PASS'), []);
    assert.deepEqual(r.results.filter((x) => x.slot === 's02').map((x) => [x.id, x.got]), [['g1', 560], ['g2', 24], ['g3', 80], ['g4', 80]]);
  });

  await check('a branch of a comma list cannot reach outside its section: .card is in s02, so s01 has no match', async () => {
    const p = project('escape');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    checks.sections.s01.geometry[0].selector = '.nope, .card';
    writeFileSync(file, JSON.stringify(checks));
    const r = await gate(p);
    const g1 = r.results.find((x) => x.slot === 's01' && x.id === 'g1');
    assert.equal(g1.status, 'FAIL');
    assert.equal(g1.detail, 'unmeasurable: .nope, .card matched nothing in the section');
    assert.deepEqual(r.results.filter((x) => x.status !== 'PASS').map((x) => `${x.slot} ${x.id}`), ['s01 g1']);
  });

  await check('a token entry measured at another width opens the page at that width', async () => {
    const p = project('width');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    checks.sections.s02.geometry.push({ id: 'g5', selector: ':scope', token: 'layout.sectionPaddingY', measure: 'paddingTop', width: 390 });
    writeFileSync(file, JSON.stringify(checks));
    const r = await gate(p);
    const got = r.results.find((x) => x.slot === 's02' && x.id === 'g5');
    assert.deepEqual([got.status, got.node, got.want, got.got], ['PASS', null, 80, 80], r.results.map((x) => x.detail).join('\n'));
  });

  await check('.card { width: 540px } fails the card width as "540 vs 560 (±1)"; CLI exits 1 with one indented line', () => {
    const p = project('narrow');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('.card { width: 560px;', '.card { width: 540px;'));
    const r = run(['geometry', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^geometry FAIL 1\/10$/m);
    assert.match(r.stdout, /^ {2}s02 g1 width \(node I1:7;5:7\): 540 vs 560 \(±1\)$/m);
    const g = geometryOf(p);
    assert.equal(g.pass, false);
    assert.equal(g.results.filter((x) => x.status === 'FAIL').length, 1);
  });

  await check('a page with one .feature fails the gap as unmeasurable', async () => {
    const p = project('lone');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace(/ {6}<p class="feature">Ship[^\n]*\n/, ''));
    const r = await gate(p);
    const gap = r.results.find((x) => x.slot === 's02' && x.id === 'g3');
    assert.equal(gap.status, 'FAIL');
    assert.match(gap.detail, /^unmeasurable: /);
    assert.equal(gap.got, null);
  });

  await check('CLI geometry on page.html: PASS line, exit 0, geometry.json', () => {
    const p = project('cli-pass');
    const r = run(['geometry', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^geometry PASS 10\/10$/m);
    assert.ok(existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'geometry.json')));
  });

  await check('CLI geometry stops at join drift: FAIL join line, exit 1, no geometry.json', () => {
    const p = project('cli-drift');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('data-slot="s02"', 'data-slot="s09"'));
    const r = run(['geometry', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL join/);
    assert.ok(!/geometry (PASS|FAIL)/.test(r.stdout));
    assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'geometry.json')));
  });

  await check('CLI geometry: an invalid checks file lists every problem, exit 2; missing --page/--url exit 2', () => {
    const p = project('cli-usage');
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checks = JSON.parse(readFileSync(file, 'utf8'));
    checks.sections.s01.geometry[0].node = 'nope:1';
    checks.sections.s02.geometry[0].measure = 'depth';
    writeFileSync(file, JSON.stringify(checks));
    const r = run(['geometry', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /2 problem\(s\)/);
    assert.match(r.stderr, /nope:1 is not inside/);
    assert.match(r.stderr, /unknown measure depth/);
    assert.equal(run(['geometry', '--url', p.page, '--dir', p.dir], p.root).status, 2);
    assert.equal(run(['geometry', '--page', p.slug, '--dir', p.dir], p.root).status, 2);
  });
}

await check('--help lists geometry and its flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: scratch });
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['geometry', 'tolerancePx', 'unmeasurable', 'geometry.json', '":scope > .a .b"', 'branch by branch', 'sibling combinator']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
