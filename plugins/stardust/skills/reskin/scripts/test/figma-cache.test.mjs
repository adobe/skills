#!/usr/bin/env node
// skills/reskin/scripts/test/figma-cache.test.mjs — the capture cache (pure, temp dirs, no network):
// a staging capture is promoted whole and replaces the complete one without keeping any of its files,
// staging dirs are per version and selection, a swap cut short between its two renames (an injected
// EIO, or a killed run) leaves the last complete capture readable through version() — the API every
// consumer uses — and recover() or the next promote() puts it back, moveTargets lists where a swap
// parks files, and cacheProblem names a manifest, selection and node set that disagree.
// Run: node <this file>.
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheFor, cacheProblem } from '../figma/cache.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const scratch = mkdtempSync(join(tmpdir(), 'figma-cache-test-'));
let n = 0;
const fresh = () => { n += 1; return cacheFor(join(scratch, `d${n}`), 'AbCdEf1234567890'); };
// An I/O error on the renames `fails(from)` matches; the live named imports of node:fs follow.
const realRename = fs.renameSync;
const withFailingRenames = (fails, fn) => {
  fs.renameSync = (from, to) => { if (fails(String(from))) throw Object.assign(new Error(`EIO: i/o error, rename '${from}'`), { code: 'EIO' }); return realRename(from, to); };
  syncBuiltinESMExports();
  try { return fn(); } finally { fs.renameSync = realRename; syncBuiltinESMExports(); }
};
const intoStaging = (from) => /\/\.staging\/[^/]+$/.test(from);
const fromParking = (from) => /\/\.prev\/[^/]+$/.test(from);
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
check('recover: a run killed between the two renames of promote() gets the previous capture back; readers had it meanwhile', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  mkdirSync(join(c.root, '.prev'), { recursive: true });
  renameSync(c.version('v1').dir, join(c.root, '.prev', 'v1'));
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:2'], 'served from .prev while the version dir is missing');
  c.recover();
  assert.ok(existsSync(join(c.root, 'v1', 'manifest.json')));
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:2']);
  assert.ok(!existsSync(join(c.root, '.prev')));
});
check('promote cut short after its first rename (injected EIO, rollback failing too): version() still serves the last complete capture, and a retry finishes the swap', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  const next = capture(c.staging('v1', ['1:9']), ['1:9']);
  assert.throws(() => withFailingRenames((from) => intoStaging(from) || fromParking(from), () => c.promote('v1', next)), /EIO/);
  assert.ok(!existsSync(join(c.root, 'v1')), 'the version dir is gone');
  assert.ok(existsSync(join(c.root, '.prev', 'v1', 'nodes.json')), 'parked');
  // the calls the box cache, curate and stamp make
  const v = c.version('v1');
  assert.deepEqual(v.read('manifest.json').frames, ['1:2']);
  assert.deepEqual(Object.keys(v.read('nodes.json').nodes), ['1:2']);
  assert.ok(v.has('images.json') && existsSync(v.path('nodes.json')) && v.dir.endsWith('/.prev/v1'));
  assert.equal(cacheProblem(v, v.read('manifest.json')), null);
  assert.deepEqual(c.latest(), { version: 'v1' });
  c.promote('v1', next);
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:9']);
  assert.deepEqual(readdirSync(c.root).sort(), ['latest.json', 'v1']);
});
check('promote: an I/O error on the second rename alone puts the previous capture back and keeps the staged one for a retry', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  const next = capture(c.staging('v1', ['1:9']), ['1:9']);
  assert.throws(() => withFailingRenames(intoStaging, () => c.promote('v1', next)), /EIO/);
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:2']);
  assert.ok(existsSync(join(c.root, 'v1', 'manifest.json')) && !existsSync(join(c.root, '.prev', 'v1')));
  assert.ok(next.has('manifest.json'));
  c.promote('v1', next);
  assert.deepEqual(c.version('v1').read('manifest.json').frames, ['1:9']);
});
check('a write through a version handle lands in the version dir, never in the parked copy it reads from', () => {
  const c = fresh();
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  mkdirSync(join(c.root, '.prev'), { recursive: true });
  renameSync(c.version('v1').dir, join(c.root, '.prev', 'v1'));
  const v = c.version('v1');
  v.write('probe.json', { ok: true });
  assert.ok(existsSync(join(c.root, 'v1', 'probe.json')) && !existsSync(join(c.root, '.prev', 'v1', 'probe.json')));
  assert.deepEqual(v.read('manifest.json').frames, ['1:2'], 'still the complete capture');
});
check('moveTargets: where a promote parks the old files, and where recover would put parked ones', () => {
  const c = fresh();
  assert.deepEqual(c.moveTargets('v1'), []);
  c.promote('v1', capture(c.staging('v1', ['1:2']), ['1:2']));
  mkdirSync(join(c.root, 'v1', 'images'), { recursive: true });
  writeFileSync(join(c.root, 'v1', 'images', '1-2.png'), 'x');
  const names = ['file.json', 'images.json', 'images/1-2.png', 'manifest.json', 'nodes.json', 'selection.json'];
  assert.deepEqual(c.moveTargets('v1').sort(), names.map((f) => join(c.root, '.prev', 'v1', f)));
  assert.deepEqual(c.moveTargets(), []);
  mkdirSync(join(c.root, '.prev'), { recursive: true });
  renameSync(join(c.root, 'v1'), join(c.root, '.prev', 'v1'));
  assert.deepEqual(c.moveTargets().sort(), names.map((f) => join(c.root, 'v1', f)));
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
