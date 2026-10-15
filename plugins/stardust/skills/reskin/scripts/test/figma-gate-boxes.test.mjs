#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-boxes.test.mjs — figma-gate/boxes.mjs over the synthetic kit
// (fixtures/figma-kit/nodes.json): box trees relative to the root, auto-layout padding and gap, text
// records, fill kinds, hidden subtrees dropped, the captured frame and offset of any node id (nested
// instance ids included), missing ids, outline lines, and loadBoxes' cache (served after nodes.json is
// gone, merged across calls, a clear error without a capture). Pure, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCurrent } from '../figma/cache.mjs';
import { buildBoxes, findBox, loadBoxes, outline } from '../figma-gate/boxes.mjs';
import { makeProject, KEY, VERSION } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-boxes-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const { roots, missing } = buildBoxes({ nodes, roots: ['1:7', '1:2', '9:9'] });
const f = roots['1:7'];

check('a root inside a frame: its frame, frame box and offset', () => {
  assert.equal(f.frame, '1:2');
  assert.deepEqual(f.offset, { x: 0, y: 640 });
  assert.deepEqual(f.frameBox, { x: 0, y: 0, w: 1440, h: 1840 });
  assert.equal(roots['1:2'].frame, '1:2');
  assert.deepEqual(roots['1:2'].offset, { x: 0, y: 0 });
});

check('auto layout: mode, padding [t, r, b, l] and gap; omitted paddings are 0', () => {
  assert.deepEqual(f.box.layout, { mode: 'VERTICAL', padding: [80, 120, 80, 120], gap: 32 });
  assert.deepEqual(findBox(roots['1:2'].box, '1:4').layout.padding, [0, 0, 0, 0]);
  assert.equal(f.box.text, null);
});

check('boxes are relative to the root, nested instance ids included', () => {
  const card = findBox(f.box, 'I1:7;5:7');
  assert.deepEqual([card.x, card.y, card.w, card.h], [120, 260, 560, 240]);
  assert.deepEqual(card.layout, { mode: 'VERTICAL', padding: [24, 24, 24, 24], gap: 12 });
  assert.equal(findBox(f.box, 'I1:7;5:4').x, 760);
  assert.deepEqual([f.box.x, f.box.y, f.box.w, f.box.h], [0, 0, 1440, 800]);
});

check('a text node carries its type values and color', () => {
  assert.deepEqual(findBox(f.box, 'I1:7;5:2').text, { characters: 'Everything in one place', fontFamily: 'Inter Display', fontWeight: 700, fontSize: 40, lineHeightPx: 48, lineHeightUnit: 'PIXELS', letterSpacing: -0.8, textCase: null, color: 'rgb(31, 58, 95)' });
});

check('fill and fillKind: solid, gradient (no fill), nothing', () => {
  const hero = findBox(roots['1:2'].box, '1:3');
  assert.equal(hero.fillKind, 'GRADIENT_LINEAR');
  assert.equal(hero.fill, null);
  assert.equal(f.box.fillKind, 'SOLID');
  assert.equal(f.box.fill, 'rgb(247, 247, 245)');
  const container = findBox(roots['1:2'].box, '1:4');
  assert.equal(container.fillKind, 'NONE');
  assert.equal(container.fill, null);
});

check('a hidden subtree is dropped; an unknown id is missing', () => {
  assert.equal(findBox(roots['1:2'].box, '1:8'), null);
  assert.equal(findBox(roots['1:2'].box, '1:12'), null);
  assert.deepEqual(missing, ['9:9']);
  assert.equal(findBox(f.box, 'nope'), null);
});

check('outline: root line, depth limit, indentation', () => {
  assert.equal(outline(f.box, 0)[0], '1:7 INSTANCE "Features" 0,0 1440×800 VERTICAL pad 80,120,80,120 gap 32');
  assert.equal(outline(f.box, 0).length, 1);
  const two = outline(f.box, 1);
  assert.equal(two.length, 5);
  assert.match(two[1], /^ {2}I1:7;5:2 TEXT "Section title" 120,80 1200×48/);
});

check('loadBoxes: builds from the capture, caches, and still answers without nodes.json', () => {
  const p = makeProject(scratch);
  const first = loadBoxes(p.dir, ['1:7']);
  assert.equal(first.fileKey, KEY);
  assert.equal(first.version, VERSION);
  assert.equal(first.confidential, false);
  assert.equal(first.roots['1:7'].frame, '1:2');
  const cachePath = join(p.dir, '.work', 'reskin', 'gates', 'figma-boxes', KEY, `${VERSION}.json`);
  assert.ok(JSON.parse(readFileSync(cachePath, 'utf8')).roots['1:7']);
  const more = loadBoxes(p.dir, ['1:3', '9:9']);
  assert.deepEqual(more.missing, ['9:9']);
  rmSync(join(p.dir, '.work', 'reskin', 'figma', KEY, VERSION, 'nodes.json'));
  const again = loadBoxes(p.dir, ['1:7', '1:3', '9:9']);
  assert.deepEqual(Object.keys(again.roots).sort(), ['1:3', '1:7']);
  assert.deepEqual(again.missing, ['9:9']);
  assert.deepEqual(findBox(again.roots['1:7'].box, 'I1:7;5:7').layout.gap, 12);
  assert.throws(() => loadBoxes(p.dir, ['2:1']), (e) => e.code === 2 && /figma-donor\.mjs capture/.test(e.message));
});

check('loadBoxes: a same-version re-capture of another frame replaces cached roots and missing ids', () => {
  const p = makeProject(join(scratch, 'recapture'));
  const v = join(p.dir, '.work', 'reskin', 'figma', KEY, VERSION);
  const first = loadBoxes(p.dir, ['1:7', '1:9']);
  assert.ok(first.roots['1:7']);
  const other = JSON.parse(readFileSync(join(v, 'nodes.json'), 'utf8'));
  const moved = { ...other, nodes: { '1:9': other.nodes['1:9'] } };
  const manifest = JSON.parse(readFileSync(join(v, 'manifest.json'), 'utf8'));
  writeFileSync(join(v, 'nodes.json'), JSON.stringify(moved));
  writeFileSync(join(v, 'manifest.json'), JSON.stringify({ ...manifest, capturedAt: '2026-02-02T00:00:00Z', frames: ['1:9'] }));
  assert.ok(!loadBoxes(p.dir, ['1:7']).roots['1:7'], 'the old selection must not be served');
  const swapped = { ...other, nodes: { '1:2': other.nodes['1:2'] } };
  writeFileSync(join(v, 'nodes.json'), JSON.stringify(swapped));
  writeFileSync(join(v, 'manifest.json'), JSON.stringify({ ...manifest, capturedAt: '2026-03-03T00:00:00Z', frames: ['1:2'] }));
  assert.ok(loadBoxes(p.dir, ['1:7']).roots['1:7'], 'a frame that was missing before the re-capture is found');
});

check('loadBoxes without a capture: setup error naming capture, the frames and the API cost', () => {
  const p = makeProject(join(scratch, 'bare'));
  rmSync(join(p.dir, '.work'), { recursive: true });
  assert.throws(() => loadBoxes(p.dir, ['1:7']), (e) => e.code === 2 && e.message.includes('figma-donor.mjs capture <figma-url> --frames 1:2,1:9') && e.message.includes('2 + 2 × ceil(2 / 5) = 4 API calls'));
  writeFileSync(join(p.dir, 'canon-source', '_crawl-log.json'), '{}');
  assert.throws(() => loadBoxes(p.dir, ['1:7']), (e) => /frame count unknown/.test(e.message) && e.message.includes('API calls'));
});

check('loadBoxes reports confidential from current.json', () => {
  const p = makeProject(join(scratch, 'conf'));
  writeCurrent(p.dir, KEY, VERSION, true);
  assert.equal(loadBoxes(p.dir, ['1:7']).confidential, true);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
