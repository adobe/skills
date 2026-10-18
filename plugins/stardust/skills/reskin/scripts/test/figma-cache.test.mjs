#!/usr/bin/env node
// skills/reskin/scripts/test/figma-cache.test.mjs — the capture cache (pure, temp dirs, no network):
// a staging capture is promoted whole and replaces the complete one without keeping any of its files,
// staging dirs are per version and selection, a run killed between promote()'s two renames is
// recovered, and cacheProblem names a manifest, selection and node set that disagree.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheFor, cacheProblem } from '../figma/cache.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const scratch = mkdtempSync(join(tmpdir(), 'figma-cache-test-'));
let n = 0;
const fresh = () => { n += 1; return cacheFor(join(scratch, `d${n}`), 'AbCdEf1234567890'); };
const capture = (v, frames, extra = {}) => {
  v.write('file.json', { version: 'v1' });
  v.write('selection.json', { frames });
  v.write('nodes.json', { nodes: Object.fromEntries(frames.map((f) => [f, { document: {} }])) });
  v.write('images.json', Object.fromEntries(frames.map((f) => [f, v.imageFile(f)])));
  v.write('manifest.json', { version: 'v1', frames, ...extra });
  return v;
};

check('promote swaps the staging capture in whole: no file of the replaced capture survives, latest points at it, staging is gone', () => {
  const c = fresh();
  const old = capture(c.staging('v1', ['1:2']), ['1:2']);
  writeFileSync(old.path('stray.txt'), 'x');
  c.promote('v1', old);
  assert.ok(c.version('v1').has('stray.txt'));
  const next = capture(c.staging('v1', ['1:9']), ['1:9']);
  c.promote('v1', next);
  const v = c.version('v1');
  assert.ok(!v.has('stray.txt'), 'the old capture leaked into the new one');
  assert.deepEqual(v.read('manifest.json').frames, ['1:9']);
  assert.deepEqual(c.latest(), { version: 'v1' });
  assert.deepEqual(readdirSync(c.root).sort(), ['latest.json', 'v1']);
});
check('staging dirs are per version and selection; promote drops the stale ones of its version only', () => {
  const c = fresh();
  assert.equal(c.staging('v1', ['1:2']).dir, c.staging('v1', ['1:2']).dir);
  assert.notEqual(c.staging('v1', ['1:2']).dir, c.staging('v1', ['1:9']).dir);
  assert.notEqual(c.staging('v1', ['1:2']).dir, c.staging('v2', ['1:2']).dir);
  const a = capture(c.staging('v1', ['1:2']), ['1:2']);
  capture(c.staging('v1', ['1:9']), ['1:9']);
  capture(c.staging('v2', ['1:2']), ['1:2']);
  assert.deepEqual(c.stalled(), ['v1', 'v2']);
  c.promote('v1', a);
  assert.deepEqual(c.stalled(), ['v2']);
  assert.ok(existsSync(c.staging('v2', ['1:2']).path('manifest.json')));
});
check('a failed capture never reaches the complete one: nothing but promote() writes outside staging', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  const partial = c.staging('v1', ['1:9']);
  partial.write('selection.json', { frames: ['1:9'] });
  partial.write('nodes.json', { nodes: { '1:9': {} } });
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:2']);
  assert.equal(cacheProblem(c.version('v1'), c.version('v1').read('manifest.json')), null);
  assert.deepEqual(c.stalled(), ['v1']);
});
check('recover: a run killed between the two renames of promote() gets the previous capture back', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  mkdirSync(join(c.root, '.prev'), { recursive: true });
  renameSync(c.version('v1').dir, join(c.root, '.prev', 'v1'));
  assert.equal(c.version('v1').read('manifest.json'), null);
  c.recover();
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:2']);
  assert.ok(!existsSync(join(c.root, '.prev')));
});
check('recover: a new capture already in place wins; an incomplete leftover is dropped', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:9']), ['1:9']));
  mkdirSync(join(c.root, '.prev'), { recursive: true });
  renameSync(capture(c.version('v0'), ['1:2']).dir, join(c.root, '.prev', 'v1'));
  c.recover();
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:9']);
  assert.ok(!existsSync(join(c.root, '.prev')));
  mkdirSync(join(c.root, '.prev', 'v1'), { recursive: true });
  writeFileSync(join(c.root, '.prev', 'v1', 'file.json'), '{}');
  rmSync(c.version('v1').dir, { recursive: true });
  c.recover();
  assert.ok(!c.version('v1').has('file.json') && !existsSync(join(c.root, '.prev')));
});
check('cacheProblem: consistent → null; each disagreement or missing file is named', () => {
  const c = fresh();
  const v = capture(c.version('v1'), ['1:2', '1:9']);
  const manifest = v.read('manifest.json');
  assert.equal(cacheProblem(v, manifest), null);
  v.write('selection.json', { frames: ['1:9'] });
  assert.match(cacheProblem(v, manifest), /^manifest\.json lists frames 1:2,1:9, but selection\.json names 1:9$/);
  v.write('selection.json', { frames: ['1:9', '1:2'] });
  assert.equal(cacheProblem(v, manifest), null, 'order does not matter');
  v.write('nodes.json', { nodes: { '1:2': {} } });
  assert.match(cacheProblem(v, manifest), /nodes\.json holds 1:2$/);
  v.write('nodes.json', { nodes: { '1:2': {}, '1:9': null } });
  v.write('images.json', { '1:2': 'x', '4:4': 'y' });
  assert.match(cacheProblem(v, manifest), /images\.json holds 1:2,4:4$/);
  rmSync(v.path('nodes.json'));
  assert.match(cacheProblem(v, manifest), /nodes\.json is missing/);
  rmSync(v.path('selection.json'));
  rmSync(v.path('images.json'));
  assert.match(cacheProblem(v, manifest), /images\.json is missing/);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
