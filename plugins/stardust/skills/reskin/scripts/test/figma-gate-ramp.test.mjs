#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-ramp.test.mjs — B3, the :root tokens and the per-module type ramp:
// textExpect, rampSpecs and tokenLiterals (pure, over the synthetic kit), then runRamp and the CLI `ramp`
// against fixtures/figma-gate/page.html through donor-probe in plain Chromium (needs playwright; prints a
// skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseNormalizations } from '../figma/rules.mjs';
import { buildBoxes, findBox } from '../figma-gate/boxes.mjs';
import { prepare } from '../figma-gate/prepare.mjs';
import { rampSpecs, runRamp, textExpect, tokenLiterals } from '../figma-gate/ramp.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const FIX = join(HERE, 'fixtures');
const read = (...p) => JSON.parse(readFileSync(join(FIX, ...p), 'utf8'));
const nodes = read('figma-kit', 'nodes.json');
const rules = read('figma-kit', 'curation-rules.json');
const donorTokens = read('figma-gate', 'donor-tokens.json');
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-ramp-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const norm = parseNormalizations(rules.normalizations, []);
const rootEntries = rootTokens(donorTokens).entries;
const root = boxes.roots['1:7'].box;
const join_ = { sections: [{ slot: 's01', module: 'M1', node: '1:3', selector: 'main section[data-slot="s01"]', index: 0 }, { slot: 's02', module: 'M2', node: '1:7', selector: 'main section[data-slot="s02"]', index: 1 }] };
const section = (rootId, type) => ({ root: rootId, width: 1440, roots: { 1440: rootId }, geometry: [], type: type.map((t) => ({ ...t, width: 1440 })), pixel: { mode: 'auto' } });
const checks = {
  s01: section('1:3', [{ id: 't1', selector: 'h1', node: '1:5' }, { id: 't2', selector: '.btn', node: 'I1:20;3:5' }]),
  s02: section('1:7', [{ id: 't1', selector: 'h2', node: 'I1:7;5:2' }, { id: 't2', selector: '.card-label', node: 'I1:7;5:8' }]),
};

await check('textExpect: M1 normalizers in px, then weightMap and familyEquivalence, color from the box', () => {
  assert.deepEqual(textExpect(findBox(root, 'I1:7;5:2').text, norm), { fontSize: '40px', fontWeight: '700', lineHeight: '48px', letterSpacing: '-0.8px', fontFamily: 'Inter', color: 'rgb(31, 58, 95)' });
  assert.equal(textExpect(findBox(boxes.roots['1:3'].box, 'I1:20;3:5').text, norm).fontWeight, '500');
  assert.equal(textExpect(findBox(boxes.roots['1:3'].box, 'I1:20;3:5').text, norm).letterSpacing, 'normal');
});

await check('rampSpecs: six entries per type entry, :root once at the first section width', () => {
  const specs = rampSpecs({ join: join_, checks, boxes, rootEntries, norm });
  assert.deepEqual([...specs.keys()], [1440]);
  const at = specs.get(1440);
  assert.ok(at.some((e) => e.selector === 'main section[data-slot="s02"] h2' && e.property === 'fontSize' && e.value === '40px'));
  assert.ok(at.some((e) => e.selector === ':root' && e.property === '--max-width' && e.value === '1200px'));
  assert.equal(at.find((e) => e.label.startsWith('s02 t1 lineHeight')).tolerancePx, 0.1);
  assert.equal(at.find((e) => e.label.startsWith('s02 t1 letterSpacing')).tolerancePx, 0.1);
  assert.equal(at.find((e) => e.label.startsWith('s02 t1 fontFamily')).compare, 'firstFamily');
  assert.equal(at.find((e) => e.label.startsWith('s02 t1 fontSize')).tolerancePx, undefined);
  assert.equal(at.filter((e) => e.selector === ':root').length, rootEntries.length);
  assert.equal(at.filter((e) => e.selector !== ':root').length, 4 * 6);
  assert.equal(at.find((e) => e.label === 's02 t2 fontSize (I1:7;5:8)').value, '14px');
  assert.ok(at.some((e) => e.label === ':root --max-width'));
});

await check('rampSpecs: an entry at another width goes to that width; :root stays at the first section width', () => {
  const wide = { ...checks, s02: { ...checks.s02, roots: { 1440: '1:7', 390: '1:7' }, type: [{ id: 't1', selector: 'h2', node: 'I1:7;5:2', width: 390 }] } };
  const specs = rampSpecs({ join: join_, checks: wide, boxes, rootEntries, norm });
  assert.deepEqual([...specs.keys()], [1440, 390]);
  assert.equal(specs.get(390).length, 6);
  assert.ok(specs.get(1440).some((e) => e.selector === ':root'));
});

await check('rampSpecs: a Figma value that is absent is reported as an unasserted property, not dropped', () => {
  const bare = structuredClone(boxes);
  Object.assign(findBox(bare.roots['1:7'].box, 'I1:7;5:2').text, { color: null, fontSize: null });
  const unasserted = [];
  const at = rampSpecs({ join: join_, checks, boxes: bare, rootEntries, norm, unasserted }).get(1440);
  assert.equal(at.filter((e) => e.selector !== ':root').length, 4 * 6 - 2);
  assert.deepEqual(unasserted, [
    { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'UNASSERTED', detail: 'Figma has no font size' },
    { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'color', status: 'UNASSERTED', detail: 'Figma has no solid color' },
  ]);
});

await check('tokenLiterals: a color literal outside :root that equals a root value; px lengths only on request', () => {
  const html = '<style>:root{--color-accent: rgb(31, 58, 95)}\n.card{color:#1f3a5f; margin: 80px}</style>';
  const entries = [{ name: '--color-accent', value: 'rgb(31, 58, 95)' }, { name: '--section-padding', value: '80px' }];
  const lit = tokenLiterals(html, entries);
  assert.deepEqual(lit.map((l) => [l.literal, l.token]), [['#1f3a5f', '--color-accent']]);
  assert.equal(lit[0].line, 2);
  assert.deepEqual(tokenLiterals(html, entries, { lengths: true }).map((l) => [l.literal, l.token]), [['#1f3a5f', '--color-accent'], ['80px', '--section-padding']]);
});

await check('tokenLiterals: rgb(), rgba() with alpha 1 and 3-digit hex normalize; translucent, other colors and body text do not match', () => {
  const html = [
    '<p style="color:#fff">#fff in a body attribute</p>',
    '<style>',
    'a { color: rgb(31,58,95); }',
    'b { color: rgba(31, 58, 95, 1); }',
    'i { color: rgba(31, 58, 95, 0.5); }',
    'u { color: #FFF; }',
    's { color: #123456; }',
    '#abc { margin: 0 }',
    '</style>',
  ].join('\n');
  const entries = [{ name: '--color-accent', value: 'rgb(31, 58, 95)' }, { name: '--color-bg', value: 'rgb(255, 255, 255)' }];
  assert.deepEqual(tokenLiterals(html, entries).map((l) => [l.line, l.literal, l.token]), [
    [3, 'rgb(31,58,95)', '--color-accent'],
    [4, 'rgba(31, 58, 95, 1)', '--color-accent'],
    [6, '#FFF', '--color-bg'],
  ]);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  runRamp and the ramp CLI against page.html (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const project = (n) => makeProject(join(scratch, n));
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const rampOf = (p) => JSON.parse(readFileSync(join(p.dir, '.work', 'reskin', 'gates', p.slug, 'figma', 'ramp.json'), 'utf8'));
  const urlOf = (p) => pathToFileURL(p.page).href;
  const gate = async (p, extra = {}) => {
    const ready = await prepare({ dir: p.dir, slug: p.slug, url: urlOf(p) });
    assert.equal(ready.drift, false);
    return runRamp({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, rules: ready.rules, out: ready.out, ...extra });
  };
  const total = 4 * 6 + rootEntries.length;

  await check('every :root entry and type entry of the fixture passes on page.html; ramp.json and the probe files are written', async () => {
    const p = project('pass');
    const r = await gate(p);
    assert.equal(r.results.length, total);
    assert.deepEqual(r.results.filter((x) => x.status !== 'PASS'), [], JSON.stringify(r.results.filter((x) => x.status !== 'PASS')));
    assert.equal(r.pass, true);
    assert.deepEqual(r.perWidth.map((w) => [w.width, w.exit]), [[1440, 0]]);
    assert.deepEqual(r.results.find((x) => x.slot === 's02' && x.id === 't1' && x.property === 'fontSize'), { slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'fontSize', status: 'PASS', detail: '40px vs 40px' });
    assert.deepEqual(r.results.find((x) => x.property === '--max-width'), { slot: null, id: '--max-width', node: null, property: '--max-width', status: 'PASS', detail: '1200px vs 1200px' });
    const work = join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma');
    for (const f of ['ramp-spec.1440.json', 'ramp.1440.md', 'ramp.1440.json', 'ramp.json']) assert.ok(existsSync(join(work, f)), f);
    assert.deepEqual(Object.keys(rampOf(p)), ['pass', 'results', 'perWidth', 'literals']);
    assert.deepEqual(rampOf(p).results, r.results);
    assert.ok(r.literals.length > 0);
  });

  await check('.card-label { font-size: 16px } fails s02 t2 fontSize; the CLI exits 1 with one indented line', () => {
    const p = project('card-label');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('</style>', '.card-label { font-size: 16px }\n</style>'));
    const r = run(['ramp', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^ramp FAIL 1/${total}$`, 'm'));
    assert.match(r.stdout, /^ {2}s02 t2 fontSize \(node I1:7;5:8\): 16px vs 14px$/m);
    const j = rampOf(p);
    assert.equal(j.pass, false);
    assert.deepEqual(j.results.filter((x) => x.status === 'FAIL').map((x) => `${x.slot} ${x.id} ${x.property} (${x.node})`), ['s02 t2 fontSize (I1:7;5:8)']);
  });

  await check('a :root value that drifted fails as ":root --max-width"', async () => {
    const p = project('root-drift');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('--max-width: 1200px', '--max-width: 1100px'));
    const r = await gate(p);
    const bad = r.results.filter((x) => x.status === 'FAIL');
    assert.deepEqual(bad.map((x) => [x.slot, x.id, x.detail]), [[null, '--max-width', '1100px vs 1200px']]);
  });

  await check('CLI ramp on page.html: PASS line, an advisory line for token literals, exit 0', () => {
    const p = project('cli-pass');
    const r = run(['ramp', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^ramp PASS ${total}/${total}$`, 'm'));
    assert.match(r.stdout, /^advisory ramp: \d+ token literal\(s\) outside :root/m);
  });

  await check('CLI ramp stops at join drift: FAIL join line, exit 1, no ramp.json', () => {
    const p = project('cli-drift');
    writeFileSync(p.page, readFileSync(p.page, 'utf8').replace('data-slot="s02"', 'data-slot="s09"'));
    const r = run(['ramp', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL join/);
    assert.ok(!/ramp (PASS|FAIL)/.test(r.stdout));
    assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'ramp.json')));
  });

  await check('a probe that exits 2 is a crash: runRamp throws with its stderr and writes no ramp.json', async () => {
    const p = project('crash');
    const stub = join(p.root, 'probe-stub.mjs');
    writeFileSync(stub, 'console.error("stub probe: no playwright"); process.exit(2);\n');
    await assert.rejects(gate(p, { donorProbe: stub }), /stub probe: no playwright/);
    assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'ramp.json')));
  });

  const nonSolid = (p) => {
    const dir = join(p.dir, '.work', 'reskin', 'figma');
    const file = readdirSync(dir, { recursive: true }).find((f) => f.endsWith('nodes.json'));
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const walk = (n) => {
      if (n.id === 'I1:7;5:2') n.fills = [{ type: 'GRADIENT_LINEAR', blendMode: 'NORMAL', gradientStops: [] }];
      (n.children || []).forEach(walk);
    };
    Object.values(doc.nodes).forEach((f) => walk(f.document ?? f));
    writeFileSync(join(dir, file), JSON.stringify(doc));
  };

  await check('a TEXT node without a single solid fill: the color is UNASSERTED, not dropped; ramp.json lists it; pass stays true', async () => {
    const p = project('unasserted');
    nonSolid(p);
    const r = await gate(p);
    const skipped = r.results.filter((x) => x.status === 'UNASSERTED');
    assert.deepEqual(skipped, [{ slot: 's02', id: 't1', node: 'I1:7;5:2', property: 'color', status: 'UNASSERTED', detail: 'Figma has no solid color' }]);
    assert.equal(r.results.length, total);
    assert.equal(r.pass, true);
    assert.deepEqual(rampOf(p).results.filter((x) => x.status === 'UNASSERTED'), skipped);
  });

  await check('CLI ramp: "ramp PASS n/n (1 unasserted)" and an indented advisory line, exit 0', () => {
    const p = project('cli-unasserted');
    nonSolid(p);
    const r = run(['ramp', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^ramp PASS ${total - 1}/${total - 1} \\(1 unasserted\\)$`, 'm'));
    assert.match(r.stdout, /^ {2}s02 t1 color \(node I1:7;5:2\): advisory, Figma has no solid color$/m);
  });

  await check('a probe that exits 1 without a fresh JSON is a crash; a ramp.<w>.json left by an earlier run is not read', async () => {
    const p = project('stale');
    const stub = join(p.root, 'probe-stub.mjs');
    writeFileSync(stub, 'console.error("stub probe: bad selector"); process.exit(1);\n');
    const figma = join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma');
    const ok = await gate(p);
    assert.equal(ok.pass, true);
    assert.ok(existsSync(join(figma, 'ramp.1440.json')));
    await assert.rejects(gate(p, { donorProbe: stub }), /stub probe: bad selector/);
    assert.ok(!existsSync(join(figma, 'ramp.1440.json')));
  });

  await check('a probe that exits with any code other than 0 or 1 is a crash even when a JSON is present', async () => {
    const p = project('odd-exit');
    const stub = join(p.root, 'probe-stub.mjs');
    writeFileSync(stub, 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify({ results: [] })); console.error("stub probe: odd exit"); process.exit(4);\n');
    await assert.rejects(gate(p, { donorProbe: stub }), /stub probe: odd exit/);
  });

  await check('CLI ramp: missing --page or --url exits 2', () => {
    const p = project('cli-usage');
    assert.equal(run(['ramp', '--url', p.page, '--dir', p.dir], p.root).status, 2);
    assert.equal(run(['ramp', '--page', p.slug, '--dir', p.dir], p.root).status, 2);
  });
}

await check('--help lists ramp and its flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: scratch });
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['ramp', 'ramp.json', 'advisory', ':root']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
