#!/usr/bin/env node
// skills/replica/scripts/test/crop-compare.test.mjs — crop-compare.mjs's output contract: the band diff and the
// strip are written as capped JPEG inspection copies at the .jpg sibling of --out / --strip; --full-res also writes
// the full-resolution PNG at the given path (a .jpg path gets its .png sibling); the --json shape (diffImage,
// stripImage — null when not asked —, fullRes) beside the unchanged verdict fields; the text lines naming each
// written file; --help and usage before pngjs / pixelmatch are imported (the pure helpers import without them).
// Where pngjs + pixelmatch are importable, one end-to-end run on two generated PNGs; otherwise a skip line.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, jsonSummary, outputPaths, writtenLines } from '../crop-compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'crop-compare.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd = HERE) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 60000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };

// ---- output paths -----------------------------------------------------------------------------------------
check('outputPaths: the default --out writes crop-diff.jpg only; no strip asked → stripImage null; no --full-res → fullRes []', () => {
  assert.equal(DEFAULT_OUT, 'crop-diff.png');
  assert.deepEqual(outputPaths({}), { diffImage: 'crop-diff.jpg', stripImage: null, fullRes: [] });
  assert.deepEqual(outputPaths({ out: 'gates/home-1440/chrome-header-diff.png' }), { diffImage: 'gates/home-1440/chrome-header-diff.jpg', stripImage: null, fullRes: [] });
});
check('outputPaths: --strip writes its .jpg sibling; --full-res adds the PNG at each given path, diff first', () => {
  assert.deepEqual(outputPaths({ out: 'g/h-diff.png', strip: 'g/h-strip.png' }), { diffImage: 'g/h-diff.jpg', stripImage: 'g/h-strip.jpg', fullRes: [] });
  assert.deepEqual(outputPaths({ out: 'g/h-diff.png', strip: 'g/h-strip.png', fullRes: true }), { diffImage: 'g/h-diff.jpg', stripImage: 'g/h-strip.jpg', fullRes: ['g/h-diff.png', 'g/h-strip.png'] });
  assert.deepEqual(outputPaths({ out: 'g/h-diff.png', fullRes: true }), { diffImage: 'g/h-diff.jpg', stripImage: null, fullRes: ['g/h-diff.png'] });
});
check('outputPaths: a .jpg / .jpeg path is the JPEG itself; with --full-res its PNG goes to the .png sibling, never over the JPEG', () => {
  assert.deepEqual(outputPaths({ out: 'd.jpg', strip: 's.JPEG', fullRes: true }), { diffImage: 'd.jpg', stripImage: 's.JPEG', fullRes: ['d.png', 's.png'] });
  assert.deepEqual(outputPaths({ out: 'diff', fullRes: true }), { diffImage: 'diff.jpg', stripImage: null, fullRes: ['diff'] });
});

// ---- the JSON summary and the text lines ------------------------------------------------------------------
const base = { fileA: 'live.png', fileB: 'proto.png', y0: 0, y1: 2, h: 100, w: 1440, n: 1440, bar: 2, thickPct: 12.345, texture: 'thin-edge (glyph-antialiasing texture)' };
check('jsonSummary: the verdict fields as before, then diffImage, stripImage, fullRes, then texture', () => {
  const j = jsonSummary({ ...base, paths: outputPaths({ out: 'd.png' }) });
  assert.deepEqual(Object.keys(j), ['a', 'b', 'y', 'yB', 'height', 'width', 'diffPixels', 'diffPct', 'matchPct', 'threshold', 'pass', 'diffImage', 'stripImage', 'fullRes', 'texture']);
  assert.deepEqual(j, {
    a: 'live.png', b: 'proto.png', y: 0, yB: 2, height: 100, width: 1440, diffPixels: 1440, diffPct: 1, matchPct: 99, threshold: 2, pass: true,
    diffImage: 'd.jpg', stripImage: null, fullRes: [], texture: { thickPct: 12.3, label: 'thin-edge (glyph-antialiasing texture)' },
  });
  const over = jsonSummary({ ...base, n: 2900, paths: outputPaths({ out: 'd.png', strip: 's.png', fullRes: true }) });
  assert.equal(over.pass, false); assert.equal(over.diffPct, 2.01); assert.equal(over.matchPct, 97.99);
  assert.equal(over.stripImage, 's.jpg'); assert.deepEqual(over.fullRes, ['d.png', 's.png']);
  assert.equal(jsonSummary({ ...base, n: 2880, paths: outputPaths({}) }).pass, true, 'exactly at the bar passes, as before');
});
check('writtenLines: one line per written file — the capped diff and strip with their size and quality, each full-res PNG', () => {
  assert.deepEqual(writtenLines(outputPaths({ out: 'd.png' }), { diff: { width: 1400, height: 97 } }), [
    '  diff image: d.jpg (1400×97 JPEG q80 — look at this one)',
  ]);
  assert.deepEqual(writtenLines(outputPaths({ out: 'd.png', strip: 's.png', fullRes: true }), { diff: { width: 1400, height: 97 }, strip: { width: 1400, height: 32 } }), [
    '  diff image: d.jpg (1400×97 JPEG q80 — look at this one)',
    '  strip image: s.jpg (1400×32 JPEG q80)',
    '  full-res PNG: d.png',
    '  full-res PNG: s.png',
  ]);
});

// ---- CLI without the image packages -----------------------------------------------------------------------
check('--help in an empty cwd: exit 0, names --full-res and the 1400×1000 / q80 cap, writes nothing — no pngjs / pixelmatch needed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'crop-compare-help-'));
  try {
    const r = run(['--help'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /crop-compare\.mjs <a\.png> <b\.png>/);
    assert.match(r.out, /--full-res/); assert.match(r.out, /1400 × 1000/); assert.match(r.out, /quality 80/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
check('usage (no --height) exits 1 before any package import; unreadable inputs exit 1', () => {
  const u = run(['a.png', 'b.png']);
  assert.equal(u.code, 1); assert.match(u.err, /usage: crop-compare\.mjs/);
  const missing = run([join(HERE, 'no-such-a.png'), join(HERE, 'no-such-b.png'), '--height', '10']);
  assert.equal(missing.code, 1); assert.match(missing.err, /crop-compare error/);
});

// ---- end-to-end (needs pngjs + pixelmatch importable from here) -------------------------------------------
let PNG = null;
try { ({ PNG } = await import('pngjs')); await import('pixelmatch'); } catch { PNG = null; }
if (!PNG) {
  console.log('skipped: pngjs/pixelmatch not installed');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'crop-compare-e2e-'));
  try {
    const write = (name, paint) => {
      const img = new PNG({ width: 1600, height: 120 });
      for (let y = 0; y < 120; y += 1) for (let x = 0; x < 1600; x += 1) img.data.set(paint(x, y), (y * 1600 + x) * 4);
      const p = join(dir, name); writeFileSync(p, PNG.sync.write(img)); return p;
    };
    const a = write('a.png', () => [255, 255, 255, 255]);
    const b = write('b.png', (x, y) => (x >= 100 && x < 200 && y >= 10 && y < 60 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    check('e2e: without --full-res only the capped JPEGs are written (.jpg sibling of --out / --strip, no .png); JSON names them', () => {
      const r = run([a, b, '--height', '100', '--out', join(dir, 'd.png'), '--strip', join(dir, 's.png'), '--json']);
      assert.equal(r.code, 2, r.err);
      const j = JSON.parse(r.out);
      assert.equal(j.pass, false); assert.ok(j.diffPixels > 0);
      assert.equal(j.diffImage, join(dir, 'd.jpg')); assert.equal(j.stripImage, join(dir, 's.jpg')); assert.deepEqual(j.fullRes, []);
      assert.ok(existsSync(join(dir, 'd.jpg')) && existsSync(join(dir, 's.jpg')));
      assert.ok(!existsSync(join(dir, 'd.png')) && !existsSync(join(dir, 's.png')));
    });
    check('e2e: --full-res also writes the full-resolution PNGs; the text output names every written file', () => {
      const r = run([a, b, '--height', '100', '--out', join(dir, 'f.png'), '--strip', join(dir, 'fs.png'), '--full-res']);
      assert.equal(r.code, 2, r.err);
      assert.match(r.out, /^crop y0\+100: \d+ px = [\d.]+% diff → match [\d.]+% — FAIL \(bar 2%\)$/m);
      for (const f of ['f.jpg', 'fs.jpg', 'f.png', 'fs.png']) { assert.ok(existsSync(join(dir, f)), f); assert.ok(r.out.includes(join(dir, f)), `${f} named`); }
      assert.match(r.out, /diff image: \S+f\.jpg \(1400×88 JPEG q80/);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} check(s) failing` : '\ncrop-compare: all checks passed');
process.exit(failed ? 1 : 0);
