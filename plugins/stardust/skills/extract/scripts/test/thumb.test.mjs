#!/usr/bin/env node
// skills/extract/scripts/test/thumb.test.mjs — the thumb.mjs contract: exact area-average bins,
// plan geometry (no upscale; --max-height crops in SOURCE rows; --offset starts lower), a 1-px rule
// surviving a 3× downscale as a darker row, the --max-bytes levers in order (the width ladder first,
// the whole page at each step; then the largest height under the cap by bisection on measured size,
// never below the --min-share floor; then the floor written anyway with exit 1), the stdout line
// (`scaled to`, `cropped at … = <share>%`, `for --max-bytes`, a slice's `rows a-bpx`), the --offset
// slice and its -<offset> file name, directory and --out inputs, refusal to overwrite a source or
// collide two outputs, --help with nothing written, usage and read-failure exit codes, the real-path
// main-module guard. Fixtures are generated with pngjs in a temp dir; the pure checks (bins, plans,
// the ladder, the share arithmetic, the fit search over a size model) need no pngjs. Without pngjs
// the pure checks run, then one skip line and exit 0; pngjs is resolved as an import or, failing
// that, through NODE_PATH (`NODE_PATH=<project>/node_modules node <this file>`). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, WIDTH_STEPS, binWeights, boxDownscale, cropShare, encodeThumb, expandInputs, fitToCap, floorHeight, parseArgs, planThumb, thumbNote, thumbPath, widthLadder } from '../thumb.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'thumb.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} ≠ ${b}`);

// ---- pure helpers (no pngjs needed) ---------------------------------------------------------------
check('binWeights: integer stride → equal shares; fractional stride → exact seam coverage; every bin sums to 1; no source index skipped', () => {
  const thirds = binWeights(6, 2);
  assert.deepEqual(thirds.map((b) => b.map(([i]) => i)), [[0, 1, 2], [3, 4, 5]]);
  for (const b of thirds) for (const [, w] of b) near(w, 1 / 3);
  const seam = binWeights(3, 2); // scale 1.5: [0, 1.5) and [1.5, 3)
  assert.deepEqual(seam.map((b) => b.map(([i]) => i)), [[0, 1], [1, 2]]);
  near(seam[0][0][1], 1 / 1.5); near(seam[0][1][1], 0.5 / 1.5); near(seam[1][0][1], 0.5 / 1.5); near(seam[1][1][1], 1 / 1.5);
  for (const [n, m] of [[1440, 480], [1440, 500], [6242, 2081], [1, 1], [7, 3], [390, 390]]) {
    const bins = binWeights(n, m);
    assert.equal(bins.length, m);
    for (const b of bins) near(b.reduce((s, [, w]) => s + w, 0), 1, `${n}→${m}: a bin does not sum to 1`);
    assert.equal(new Set(bins.flat().map(([i]) => i)).size, n, `${n}→${m}: a source index is never sampled`);
  }
});
check('boxDownscale: fractional weights average exactly; a lone dark row becomes a 1/3-grey pixel; alpha untouched', () => {
  const px = (...vals) => Buffer.from(vals.flatMap((v) => [v, v, v, 255]));
  assert.deepEqual([...boxDownscale(px(0, 255, 255), 3, 1, 2, 1)], [85, 85, 85, 255, 255, 255, 255, 255]); // (0·1 + 255·0.5)/1.5, (255·0.5 + 255·1)/1.5
  assert.deepEqual([...boxDownscale(px(255, 0, 255), 1, 3, 1, 1)], [170, 170, 170, 255]);
  assert.deepEqual([...boxDownscale(px(255, 0, 255, 9), 1, 3, 1, 1)], [170, 170, 170, 255], 'rows past `rows` are ignored (the crop)');
  const rgba = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80]);
  assert.deepEqual([...boxDownscale(rgba, 2, 1, 1, 1)], [30, 40, 50, 60], 'each channel averaged on its own');
});
check('planThumb: 3× geometry, no crop under --max-height, the cap crops in SOURCE rows, never upscales, 1-row floor; --offset starts lower and is always a crop', () => {
  assert.deepEqual(planThumb(1440, 3000), { w: 480, h: 1000, rows: 3000, start: 0, cropped: false });
  assert.deepEqual(planThumb(1440, 6242), { w: 480, h: 2081, rows: 6242, start: 0, cropped: false });
  assert.deepEqual(planThumb(1440, 8000), { w: 480, h: 2667, rows: 8000, start: 0, cropped: false }, '8000 rows at 3× is 2667 — under 3200');
  assert.deepEqual(planThumb(1440, 8000, { width: 720 }), { w: 720, h: 3200, rows: 6400, start: 0, cropped: true });
  assert.deepEqual(planThumb(1440, 8000, { maxHeight: 2000 }), { w: 480, h: 2000, rows: 6000, start: 0, cropped: true });
  assert.deepEqual(planThumb(1440, 12000, { width: 500 }), { w: 500, h: 3200, rows: 9216, start: 0, cropped: true }, 'fractional scale still lands on the cap');
  assert.deepEqual(planThumb(390, 2000), { w: 390, h: 2000, rows: 2000, start: 0, cropped: false }, 'narrower than --width: kept as is');
  assert.deepEqual(planThumb(1440, 1), { w: 480, h: 1, rows: 1, start: 0, cropped: false });
  assert.deepEqual(planThumb(1440, 3782, { offset: 2270 }), { w: 480, h: 504, rows: 1512, start: 2270, cropped: true }, 'the slice below a 60 % crop: the remaining 1512 rows at 3×');
  assert.deepEqual(planThumb(1440, 8000, { offset: 6000, maxHeight: 500 }), { w: 480, h: 500, rows: 1500, start: 6000, cropped: true }, '--max-height still bounds a slice');
  assert.deepEqual(planThumb(1440, 3800, { width: 240, maxHeight: 416 }), { w: 240, h: 416, rows: 2496, start: 0, cropped: true }, 'a bisection step: h is the knob, rows = h × 6');
});
check('widthLadder: --width first, then every standard step below it (480 → 400 → 320 → 240); nothing below 240; a small --width has no steps', () => {
  assert.deepEqual(WIDTH_STEPS, [480, 400, 320, 240]);
  assert.deepEqual(widthLadder(480), [480, 400, 320, 240]);
  assert.deepEqual(widthLadder(720), [720, 480, 400, 320, 240]);
  assert.deepEqual(widthLadder(300), [300, 240]);
  assert.deepEqual(widthLadder(240), [240]);
  assert.deepEqual(widthLadder(48), [48]);
});
check('cropShare: the kept percent of the page, floored — a crop never reads 100, the whole page does', () => {
  assert.equal(cropShare(6000, 8000), 75); assert.equal(cropShare(2270, 3782), 60); assert.equal(cropShare(426, 3782), 11, 'the recorded 142 px strip of a 3782 px page');
  assert.equal(cropShare(7999, 8000), 99, 'one row short is not 100'); assert.equal(cropShare(3, 60), 5); assert.equal(cropShare(1, 8000), 0); assert.equal(cropShare(8000, 8000), 100);
});
check('floorHeight: the smallest thumbnail height keeping ≥ --min-share of the rows below --offset, in source rows; exact at 3×, rounded up at a fractional scale', () => {
  assert.equal(floorHeight(1440, 8000, { width: 480 }), 1600); assert.equal(planThumb(1440, 8000, { width: 480, maxHeight: 1600 }).rows, 4800, 'exactly 60 %');
  assert.equal(floorHeight(1440, 3782, { width: 240 }), 379); assert.equal(cropShare(planThumb(1440, 3782, { width: 240, maxHeight: 379 }).rows, 3782), 60); assert.ok(cropShare(planThumb(1440, 3782, { width: 240, maxHeight: 378 }).rows, 3782) < 60, 'one row lower is under the floor');
  assert.equal(floorHeight(1440, 3800, { width: 240 }), 380); assert.equal(planThumb(1440, 3800, { width: 240, maxHeight: 380 }).rows, 2280);
  assert.equal(floorHeight(1440, 8000, { width: 400 }), 1334, 'scale 3.6: 1333 rows keep 4798 < 4800'); assert.ok(planThumb(1440, 8000, { width: 400, maxHeight: 1334 }).rows >= 4800);
  assert.equal(floorHeight(1440, 8000, { width: 480, offset: 6000 }), 400, '60 % of the 2000 rows below the offset');
  assert.equal(floorHeight(144, 60, { width: 48 }), 12); assert.equal(floorHeight(1440, 3000, { minShare: 100 }), 1000, '--min-share 100: the floor is the whole page'); assert.equal(floorHeight(1440, 3000, { minShare: 1 }), 10);
});
check('fitToCap over a size model: (a) narrower first — the whole page at 320 px when 480 and 400 are over, no crop', () => {
  const model = (plan) => ({ length: plan.w * plan.h * 2 }); // 480×1267 → 1 216 320; 400×1056 → 844 800; 320×844 → 540 160
  const r = fitToCap(1440, 3800, { maxBytes: 600000 }, model);
  assert.deepEqual(r.plan, { w: 320, h: 844, rows: 3800, start: 0, cropped: false });
  assert.deepEqual([r.scaled, r.forCap, r.unmet], [true, true, false]);
  assert.equal(thumbNote(r.plan, 3800, { ...r, maxBytes: 600000 }), '320x844 scaled to 320px for --max-bytes 600000');
  const ok = fitToCap(1440, 3800, { maxBytes: 1300000 }, model);
  assert.deepEqual([ok.plan.w, ok.scaled, ok.forCap, ok.unmet], [480, false, false, false], 'under the cap at once: no note');
  assert.equal(thumbNote(ok.plan, 3800, ok), '480x1267');
});
check('fitToCap: (b) at the narrowest width the height comes down by bisection on the measured size — the largest height under the cap, one step more would not fit; never below the floor', () => {
  const model = (plan) => ({ length: plan.w * plan.h * 2 });
  const r = fitToCap(1440, 3800, { maxBytes: 200000 }, model); // 240 px: full 633 rows → 303 840; floor 380 rows → 182 400; 480·h ≤ 200 000 → h = 416
  assert.deepEqual(r.plan, { w: 240, h: 416, rows: 2496, start: 0, cropped: true });
  assert.ok(model(planThumb(1440, 3800, { width: 240, maxHeight: 417 })).length > 200000, 'one row more is over the cap');
  assert.deepEqual([r.scaled, r.forCap, r.unmet], [true, true, false]);
  assert.equal(thumbNote(r.plan, 3800, { ...r, maxBytes: 200000 }), '240x416 scaled to 240px (cropped at 2496px of 3800 = 65%) for --max-bytes 200000');
  // Not linear in rows: a quadratic model. A byte-ratio guess from the full 240 px thumbnail
  // (633 × 274 000 / 424 689 × 0.92 = 375 rows) would land under the floor; measuring lands on 500.
  const quad = (plan) => ({ length: plan.w * 100 + plan.h * plan.h });
  const q = fitToCap(1440, 3800, { maxBytes: 274000 }, quad);
  assert.equal(q.plan.h, 500); assert.ok(quad(planThumb(1440, 3800, { width: 240, maxHeight: 501 })).length > 274000); assert.equal(q.unmet, false);
});
check('fitToCap: (c) over the cap at the floor — the floor thumbnail (60 % of the page) is the result, `unmet`; --max-height below the floor is respected and needs no floor encode; a source narrower than every step has no ladder', () => {
  const model = (plan) => ({ length: plan.w * plan.h * 2 });
  const c = fitToCap(1440, 3800, { maxBytes: 100000 }, model);
  assert.deepEqual(c.plan, { w: 240, h: 380, rows: 2280, start: 0, cropped: true }); assert.deepEqual([c.scaled, c.forCap, c.unmet], [true, true, true]);
  assert.equal(cropShare(c.plan.rows, 3800), 60); assert.equal(thumbNote(c.plan, 3800, { ...c, maxBytes: 100000 }), '240x380 scaled to 240px (cropped at 2280px of 3800 = 60%) for --max-bytes 100000');
  const e = fitToCap(1440, 8000, { maxHeight: 100, maxBytes: 10 }, model);
  assert.deepEqual([e.plan.w, e.plan.h, e.unmet], [240, 100, true], 'h never exceeds --max-height; the floor (1600) is above it, so nothing to bisect');
  const f = fitToCap(144, 60, { width: 48, maxBytes: 40 }, model);
  assert.deepEqual(f.plan, { w: 48, h: 12, rows: 36, start: 0, cropped: true }); assert.deepEqual([f.scaled, f.unmet], [false, true]);
  assert.equal(thumbNote(f.plan, 60, { ...f, maxBytes: 40 }), '48x12 (cropped at 36px of 60 = 60%) for --max-bytes 40');
  const low = fitToCap(1440, 3800, { maxBytes: 100000, minShare: 25 }, model);
  assert.equal(low.unmet, false); assert.ok(cropShare(low.plan.rows, 3800) >= 25 && cropShare(low.plan.rows, 3800) < 60, `--min-share 25 lets it fit: ${cropShare(low.plan.rows, 3800)} %`);
});
check('fitToCap: an explicit --max-height stays the upper bound through the ladder; --offset bisects the rows below it with the floor relative to them', () => {
  const model = (plan) => ({ length: plan.w * plan.h * 2 });
  const d = fitToCap(1440, 8000, { maxHeight: 2000, maxBytes: 1700000 }, model); // 480×2000 → 1 920 000 over; 400×2000 → 1 600 000 fits
  assert.deepEqual(d.plan, { w: 400, h: 2000, rows: 7200, start: 0, cropped: true });
  assert.equal(thumbNote(d.plan, 8000, { ...d, maxBytes: 1700000 }), '400x2000 scaled to 400px (cropped at 7200px of 8000 = 90%) for --max-bytes 1700000');
  const s = fitToCap(1440, 3800, { offset: 1900, maxBytes: 100000 }, model); // 1900 rows below: 240 px full 317 → 152 160; floor 60 % → 190 rows; 480·h ≤ 100 000 → 208
  assert.deepEqual(s.plan, { w: 240, h: 208, rows: 1248, start: 1900, cropped: true }); assert.equal(s.unmet, false);
  assert.equal(thumbNote(s.plan, 3800, { ...s, maxBytes: 100000 }), '240x208 scaled to 240px (rows 1900-3148px of 3800 = 32%) for --max-bytes 100000');
});
check('thumbNote: `<w>x<h> [scaled to <w>px] [(cropped at <n>px of <H> = <share>%)] [for --max-bytes <b>]`; a slice notes `rows a-bpx`; a crop always carries its share', () => {
  assert.equal(thumbNote({ w: 480, h: 1000, rows: 3000, start: 0 }, 3000), '480x1000');
  assert.equal(thumbNote({ w: 480, h: 2000, rows: 6000, start: 0 }, 8000), '480x2000 (cropped at 6000px of 8000 = 75%)', 'an explicit --max-height crop: share, no cap note');
  assert.equal(thumbNote({ w: 240, h: 633, rows: 3800, start: 0 }, 3800, { scaled: true, forCap: true, maxBytes: 150000 }), '240x633 scaled to 240px for --max-bytes 150000');
  assert.equal(thumbNote({ w: 480, h: 142, rows: 426, start: 0 }, 3782, { forCap: true, maxBytes: 120000 }), '480x142 (cropped at 426px of 3782 = 11%) for --max-bytes 120000', 'the recorded line, now with its share');
  assert.equal(thumbNote({ w: 480, h: 504, rows: 1512, start: 2270 }, 3782), '480x504 (rows 2270-3782px of 3782 = 39%)');
});
check('thumbPath: beside the source by default, --out redirects, suffix before .png, extension case-insensitive, --offset appended after the suffix', () => {
  assert.equal(thumbPath('/a/b/home.png'), '/a/b/home-thumb.png');
  assert.equal(thumbPath('/a/b/home.PNG', { out: '/t', suffix: '' }), '/t/home.png');
  assert.equal(thumbPath('x.png', { suffix: '.480' }), 'x.480.png');
  assert.equal(thumbPath('/a/b/home.png', { offset: 2270 }), '/a/b/home-thumb-2270.png'); assert.equal(thumbPath('/a/b/home.png', { offset: 0 }), '/a/b/home-thumb.png');
  assert.equal(thumbPath('/a/b/home.png', { suffix: '-x', offset: 5, out: '/t' }), '/t/home-x-5.png');
});
check('parseArgs: defaults, every flag, integer validation (--offset from 0, --min-share 1–100), unknown option, missing value, no inputs → exit-2 errors', () => {
  const { opts, pos } = parseArgs(['a.png', 'dir']);
  assert.deepEqual(opts, { width: 480, maxHeight: 3200, maxBytes: 150000, minShare: 60, offset: 0, suffix: '-thumb', out: null }); assert.deepEqual(opts, DEFAULTS); assert.deepEqual(pos, ['a.png', 'dir']);
  assert.deepEqual(parseArgs(['x', '--width', '320', '--max-height', '1000', '--max-bytes', '90000', '--min-share', '100', '--offset', '0', '--out', 'o', '--suffix', '']).opts, { width: 320, maxHeight: 1000, maxBytes: 90000, minShare: 100, offset: 0, suffix: '', out: 'o' });
  assert.deepEqual(parseArgs(['x', '--min-share', '1', '--offset', '2270']).opts, { ...DEFAULTS, minShare: 1, offset: 2270 });
  for (const bad of [['x', '--width', '0'], ['x', '--width', 'abc'], ['x', '--max-height', '1.5'], ['x', '--max-bytes', '0'], ['x', '--max-bytes', 'big'], ['x', '--min-share', '0'], ['x', '--min-share', '101'], ['x', '--min-share', '60%'], ['x', '--offset', '-1'], ['x', '--offset', '1.5'], ['x', '--bogus'], ['x', '-x'], ['x', '--out'], []]) {
    assert.throws(() => parseArgs(bad), (e) => e.code === 2, `should refuse: ${bad.join(' ') || '(no args)'}`);
  }
  assert.throws(() => parseArgs(['x', '--min-share', '0']), /--min-share needs a percent from 1 to 100, got "0"/);
  assert.throws(() => parseArgs(['x', '--offset', '-1']), /--offset needs a source row \(a non-negative integer\), got "-1"/);
});
check('parseArgs: a value flag followed by nothing or by another --flag is a usage error (exit 2) naming the flag — never swallowed; a single-dash value stays a value', () => {
  for (const [flag, ...tail] of [['--width'], ['--max-height'], ['--max-bytes'], ['--min-share'], ['--offset'], ['--out'], ['--suffix'], ['--width', '--out', 'o'], ['--out', '--suffix', '-s'], ['--suffix', '--width', '48'], ['--max-height', '--help'], ['--max-bytes', '--width', '48'], ['--offset', '--min-share', '60']]) {
    assert.throws(() => parseArgs(['x.png', flag, ...tail]), (e) => e.code === 2 && e.message === `${flag} needs a value`, `${flag} ${tail.join(' ')}`);
  }
  assert.equal(parseArgs(['x.png', '--suffix', '-720']).opts.suffix, '-720');
  assert.equal(parseArgs(['x.png', '--suffix', '']).opts.suffix, '');
});
check('expandInputs: files pass through (absent ones too — they fail at read time); a directory yields its sorted PNGs minus its own earlier output, slices (-<offset>) included', () => {
  assert.deepEqual(expandInputs(['/nope/x.png'], '-thumb'), ['/nope/x.png']);
  const d = mkdtempSync(join(tmpdir(), 'thumb-expand-'));
  for (const f of ['b.png', 'a.PNG', 'a-thumb.png', 'a-thumb-2270.png', 'notes.txt']) writeFileSync(join(d, f), '');
  const warnings = [];
  assert.deepEqual(expandInputs([d], '-thumb', (m) => warnings.push(m)), [join(d, 'a.PNG'), join(d, 'b.png')]);
  assert.deepEqual(warnings, [`${d}: skipped 2 existing *-thumb*.png`]);
  assert.deepEqual(expandInputs([d], ''), [join(d, 'a-thumb-2270.png'), join(d, 'a-thumb.png'), join(d, 'a.PNG'), join(d, 'b.png')], 'an empty suffix skips nothing');
  assert.deepEqual(expandInputs([d], '.480'), [join(d, 'a-thumb-2270.png'), join(d, 'a-thumb.png'), join(d, 'a.PNG'), join(d, 'b.png')], 'a suffix with a regex character matches literally');
  const empty = join(d, 'empty'); mkdirSync(empty); const w2 = [];
  assert.deepEqual(expandInputs([empty], '-thumb', (m) => w2.push(m)), []); assert.deepEqual(w2, [`no *.png in ${empty}`]);
  rmSync(d, { recursive: true, force: true });
});

// ---- fixtures + CLI (pngjs) ---------------------------------------------------------------------
// As an import first; then through NODE_PATH (CommonJS resolution honours it, ESM does not) — the way
// the script itself falls back, so a checkout without node_modules can borrow a project's pngjs.
let PNG = null;
try { ({ PNG } = await import('pngjs')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
if (!PNG) { try { ({ PNG } = createRequire(import.meta.url)('pngjs')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
if (!PNG) {
  console.log(failed ? `\n${failed} failing` : '\nskip  thumb: fixture and CLI checks need pngjs (run them in the image, or NODE_PATH=<project>/node_modules); pure checks passed');
  process.exit(failed ? 1 : 0);
}

// realpath: the script's main-module guard compares real paths, and the overwrite check does too.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'thumb-test-')));
const white = (w, h) => { const p = new PNG({ width: w, height: h }); p.data.fill(255); return p; };
const paintRows = (png, y0, y1, v) => { for (let y = y0; y < y1; y += 1) for (let x = 0; x < png.width; x += 1) { const i = (y * png.width + x) * 4; png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; } };
// Incompressible page: a random colour per 6×6 block plus ±32 of per-pixel jitter. At 240 px (6×) one
// block is one pixel, so the thumbnail is ~8-bit noise per channel (about 3.35 bytes per pixel once
// deflate has coded the constant alpha) and the cap can only be met by cropping; the jitter keeps the
// wider steps from compressing as duplicated blocks, so the encoded size falls with every width step.
const blockNoise = (w, h, b) => {
  const p = new PNG({ width: w, height: h }); const bw = Math.ceil(w / b); const blocks = randomBytes(bw * Math.ceil(h / b) * 3); const jitter = randomBytes(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const k = (Math.floor(y / b) * bw + Math.floor(x / b)) * 3; const i = (y * w + x) * 4; const j = (y * w + x) * 3;
    for (let c = 0; c < 3; c += 1) { const v = blocks[k + c] + (jitter[j + c] % 65) - 32; p.data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v; }
    p.data[i + 3] = 255;
  }
  return p;
};
const write = (file, png) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, PNG.sync.write(png, { deflateLevel: 1, filterType: 0 })); return file; };
const read = (file) => PNG.sync.read(readFileSync(file));
const bytes = (file) => statSync(file).size;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowMean = (png, y) => { let s = 0; for (let x = 0; x < png.width; x += 1) { const i = (y * png.width + x) * 4; s += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; } return s / png.width; };
const darkestRow = (png) => { let best = { y: -1, mean: Infinity }; for (let y = 0; y < png.height; y += 1) { const mean = rowMean(png, y); if (mean < best.mean) best = { y, mean }; } return best; };

const RULE_Y = 1501; // not on the 3× stride (rows 0, 3, 6, …): a nearest-neighbour sampler never lands on it
const rule = white(1440, 3000); paintRows(rule, RULE_Y, RULE_Y + 1, 0x22);
const tall = white(1440, 8000); paintRows(tall, 6000, 6400, 0); // a dark band between the two crop points exercised below
const heavy = blockNoise(1440, 3800, 6);
const shots = join(root, 'screenshots');
const ruleSrc = write(join(shots, 'home.png'), rule);
const tallSrc = write(join(shots, 'pricing.png'), tall);
const heavySrc = write(join(shots, 'gallery.png'), heavy);
// The size the script measures for a plan of the heavy page — the same encoder, so a cap can be set
// between two measured sizes and the checks do not depend on how well random blocks compress.
const heavySize = (opts) => encodeThumb(PNG, heavy, planThumb(1440, 3800, opts)).length;
const dir = join(root, 'dir');
write(join(dir, 'b.png'), white(144, 300)); write(join(dir, 'a.png'), white(144, 60)); write(join(dir, 'z-thumb.png'), white(48, 10)); write(join(dir, 'z-thumb-30.png'), white(48, 5)); writeFileSync(join(dir, 'notes.txt'), 'x');

check('1-px rule on a 1440×3000 page survives the 3× box downscale as a visibly darker row; the source is untouched', () => {
  const before = readFileSync(ruleSrc);
  const r = run([ruleSrc]);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const dst = join(shots, 'home-thumb.png');
  assert.equal(r.out, `${ruleSrc}: 1440x3000 -> 480x1000 -> ${dst} (${bytes(dst)} bytes)\n`);
  const t = read(dst); assert.equal(t.width, 480); assert.equal(t.height, 1000);
  const { y, mean } = darkestRow(t);
  assert.equal(y, Math.floor(RULE_Y / 3), 'the rule lands on its scaled row');
  assert.ok(mean < 235, `rule row mean ${mean} should be < 235`); near(Math.round(mean), 181, `rule row mean ${mean} should be ~(34+255+255)/3`);
  assert.equal(rowMean(t, y - 1), 255); assert.equal(rowMean(t, y + 1), 255);
  assert.equal(rowMean(rule, y * 3), 255, 'the source row a nearest-neighbour sampler would take for that output row is white — it loses the rule');
  for (let i = 3; i < t.data.length; i += 4) if (t.data[i] !== 255) throw new Error(`alpha drifted at byte ${i}`);
  assert.ok(readFileSync(ruleSrc).equals(before), 'source bytes unchanged');
});
check('1440×8000 lands at 480×2667 under the 3200 cap (no note); --max-height crops the SOURCE from the top and prints the share: --width 720 → 720×3200 (cropped at 6400px of 8000 = 80%), --max-height 2000 → 480×2000 (cropped at 6000px of 8000 = 75%)', () => {
  const out = join(root, 'crop');
  const r0 = run([tallSrc, '--out', out]); assert.equal(r0.code, 0, r0.err);
  assert.equal(r0.out, `${tallSrc}: 1440x8000 -> 480x2667 -> ${join(out, 'pricing-thumb.png')} (${bytes(join(out, 'pricing-thumb.png'))} bytes)\n`);
  // 8000 → 2667 rows is a 2.99963× vertical scale, so the band's top edge (source row 6000) falls at output row 2000.25: row 2000 is a seam that averages ¼ white + ¾ dark, the rows inside the band are 0.
  const t0 = read(join(out, 'pricing-thumb.png')); assert.equal(t0.height, 2667); assert.equal(rowMean(t0, 1999), 255);
  const seam = rowMean(t0, 2000); assert.ok(seam > 0 && seam < 255, `seam row averages, got ${seam}`); assert.equal(rowMean(t0, 2001), 0); assert.equal(rowMean(t0, 2132), 0); assert.equal(rowMean(t0, 2134), 255);
  const r1 = run([tallSrc, '--width', '720', '--max-height', '3200', '--out', out, '--suffix', '-720']); assert.equal(r1.code, 0, r1.err);
  assert.equal(r1.out, `${tallSrc}: 1440x8000 -> 720x3200 (cropped at 6400px of 8000 = 80%) -> ${join(out, 'pricing-720.png')} (${bytes(join(out, 'pricing-720.png'))} bytes)\n`);
  const t1 = read(join(out, 'pricing-720.png')); assert.equal(t1.width, 720); assert.equal(t1.height, 3200);
  assert.equal(rowMean(t1, 2999), 255); assert.equal(rowMean(t1, 3000), 0); assert.equal(rowMean(t1, 3199), 0, 'the band at source rows 6000–6399 is the thumbnail\'s tail');
  const r2 = run([tallSrc, '--max-height', '2000', '--out', out, '--suffix', '-2000']); assert.equal(r2.code, 0, r2.err);
  assert.equal(r2.out, `${tallSrc}: 1440x8000 -> 480x2000 (cropped at 6000px of 8000 = 75%) -> ${join(out, 'pricing-2000.png')} (${bytes(join(out, 'pricing-2000.png'))} bytes)\n`);
  const t2 = read(join(out, 'pricing-2000.png')); assert.equal(t2.height, 2000); assert.equal(darkestRow(t2).mean, 255, 'cropped just above the band: all white');
});
check('--max-bytes, lever (a): a heavy 1440×3800 page over the cap at 480 and 400 px is re-encoded at 320 px — the WHOLE page, not cropped — and the line says `scaled to 320px … for --max-bytes`; a light page is untouched and still prints its size', () => {
  const s480 = heavySize({ width: 480 }); const s400 = heavySize({ width: 400 }); const s320 = heavySize({ width: 320 }); const cap = Math.floor((s320 + Math.min(s400, s480)) / 2);
  assert.ok(s320 <= cap && cap < s400 && cap < s480, `fixture: 480 and 400 px over ${cap}, 320 px under (${s480} / ${s400} / ${s320})`);
  const out = join(root, 'cap-width');
  const r = run([heavySrc, '--out', out, '--max-bytes', String(cap)]);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const dst = join(out, 'gallery-thumb.png');
  assert.equal(r.out, `${heavySrc}: 1440x3800 -> 320x844 scaled to 320px for --max-bytes ${cap} -> ${dst} (${bytes(dst)} bytes)\n`);
  assert.ok(bytes(dst) <= cap, `${bytes(dst)} bytes is over the cap ${cap}`);
  const t = read(dst); assert.equal(t.width, 320); assert.equal(t.height, 844, '3800 rows at 4.5× — the whole page');
  const r3 = run([ruleSrc, '--out', out]); assert.equal(r3.code, 0, r3.err);
  assert.equal(r3.out, `${ruleSrc}: 1440x3000 -> 480x1000 -> ${join(out, 'home-thumb.png')} (${bytes(join(out, 'home-thumb.png'))} bytes)\n`, 'under the cap: no note, size printed');
});
check('--max-bytes, lever (b): when 240 px is still over, the height comes down by bisection on the MEASURED size — the file is under the cap, within a row of it (one row more would not fit), never below 60 % of the page; the line carries the share', () => {
  const hFloor = floorHeight(1440, 3800, { width: 240 }); assert.equal(hFloor, 380);
  const sFull = heavySize({ width: 240 }); const sFloor = heavySize({ width: 240, maxHeight: hFloor }); const cap = Math.floor((sFloor + sFull) / 2);
  assert.ok(sFloor <= cap && cap < sFull && cap < heavySize({ width: 320 }), `fixture: 320 px and the full 240 px over ${cap}, the 60 % floor under (${sFloor} / ${sFull})`);
  const out = join(root, 'cap-height');
  const r = run([heavySrc, '--out', out, '--max-bytes', String(cap)]);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const dst = join(out, 'gallery-thumb.png');
  const m = r.out.match(new RegExp(`^${esc(heavySrc)}: 1440x3800 -> 240x(\\d+) scaled to 240px \\(cropped at (\\d+)px of 3800 = (\\d+)%\\) for --max-bytes ${cap} -> ${esc(dst)} \\((\\d+) bytes\\)\\n$`));
  assert.ok(m, r.out);
  const [h, n, share, size] = m.slice(1).map(Number);
  assert.ok(h > hFloor && h < 633, `height ${h} between the floor and the full page`); assert.equal(n, h * 6, 'the crop row is the thumbnail height in source rows (6×)'); assert.equal(share, cropShare(n, 3800)); assert.ok(share >= 60 && share < 100, `share ${share}`);
  assert.equal(size, bytes(dst), 'the printed size is the file size'); assert.ok(size <= cap, `${size} > cap ${cap}`);
  assert.ok(size >= 0.75 * cap, `${size} bytes is not within 25 % of the cap ${cap} — the shrink overshot`);
  assert.ok(heavySize({ width: 240, maxHeight: h + 1 }) > cap, 'one row more is over the cap: the bisection stopped at the largest height that fits');
  const t = read(dst); assert.equal(t.width, 240); assert.equal(t.height, h);
});
check('--max-bytes, lever (c): over the cap even at 240 px and the 60 % floor (the default 150 000 on the heavy page) — the floor thumbnail is written, the line says 60%, one stderr line names the size, exit 1; a lower --min-share lets it fit', () => {
  const sFloor = heavySize({ width: 240, maxHeight: 380 }); assert.ok(sFloor > 150000, `fixture: the 60 % floor at 240 px must be over the default cap, is ${sFloor}`);
  const out = join(root, 'cap-unmet');
  const r = run([heavySrc, '--out', out]);
  assert.equal(r.code, 1, r.err);
  const dst = join(out, 'gallery-thumb.png');
  assert.equal(r.out, `${heavySrc}: 1440x3800 -> 240x380 scaled to 240px (cropped at 2280px of 3800 = 60%) for --max-bytes 150000 -> ${dst} (${bytes(dst)} bytes)\n`);
  assert.equal(r.err, `thumb: ${dst}: ${bytes(dst)} bytes at 240x380 (60% of the page — the narrowest width and the height floor) still exceeds --max-bytes 150000; written anyway — raise --max-bytes or lower --min-share for this page\n`);
  assert.ok(bytes(dst) > 150000); const t = read(dst); assert.equal(t.width, 240); assert.equal(t.height, 380);
  const low = run([heavySrc, '--out', out, '--suffix', '-low', '--min-share', '20']); assert.equal(low.code, 0, low.err); assert.equal(low.err, '');
  const lm = low.out.match(/ -> 240x(\d+) scaled to 240px \(cropped at (\d+)px of 3800 = (\d+)%\) for --max-bytes 150000 -> /); assert.ok(lm, low.out);
  assert.ok(Number(lm[3]) >= 20 && Number(lm[3]) < 60, `share ${lm[3]} between the lower floor and 60`); assert.ok(bytes(join(out, 'gallery-low.png')) <= 150000);
});
check('--offset <px>: the slice below a crop — starts at that source row, the file name gains -<offset>, the line reads `rows a-bpx of H = share%`; the first thumbnail stays; past the last row is a named exit-1 failure with nothing written', () => {
  const out = join(root, 'slices');
  const first = run([tallSrc, '--out', out, '--max-height', '2000']); assert.equal(first.code, 0, first.err);
  assert.match(first.out, /\(cropped at 6000px of 8000 = 75%\)/);
  const r = run([tallSrc, '--out', out, '--offset', '6000']);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const dst = join(out, 'pricing-thumb-6000.png');
  assert.equal(r.out, `${tallSrc}: 1440x8000 -> 480x667 (rows 6000-8000px of 8000 = 25%) -> ${dst} (${bytes(dst)} bytes)\n`);
  const t = read(dst); assert.equal(t.width, 480); assert.equal(t.height, 667);
  assert.equal(rowMean(t, 0), 0, 'the band at source rows 6000–6399 is the slice\'s head'); assert.equal(rowMean(t, 132), 0); assert.equal(rowMean(t, 134), 255); assert.equal(rowMean(t, 666), 255);
  assert.ok(existsSync(join(out, 'pricing-thumb.png')), 'the first thumbnail is not overwritten');
  const x = run([tallSrc, '--out', out, '--offset', '6000', '--suffix', '-x']); assert.equal(x.code, 0, x.err); assert.ok(existsSync(join(out, 'pricing-x-6000.png')));
  const past = run([tallSrc, '--out', out, '--offset', '8000']);
  assert.equal(past.code, 1); assert.equal(past.out, ''); assert.equal(past.err, `thumb: ${tallSrc}: --offset 8000 is past the last row of a 1440x8000 page\n`); assert.ok(!existsSync(join(out, 'pricing-thumb-8000.png')));
});
check('a cap that cannot be met on a small source: no width step below --width 48, the 60 % floor (12 rows) is still over — written, named on stderr, exit 1', () => {
  const out = join(root, 'cap-unmet-small');
  const r = run([join(dir, 'a.png'), '--out', out, '--width', '48', '--max-bytes', '40']);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, / 144x60 -> 48x12 \(cropped at 36px of 60 = 60%\) for --max-bytes 40 -> .*a-thumb\.png \(\d+ bytes\)\n$/);
  assert.match(r.err, /^thumb: .*a-thumb\.png: \d+ bytes at 48x12 \(60% of the page — the narrowest width and the height floor\) still exceeds --max-bytes 40; written anyway — raise --max-bytes or lower --min-share for this page\n$/);
  assert.equal(read(join(out, 'a-thumb.png')).height, 12);
});
check('a directory input takes its PNGs (sorted), skips the non-PNG file and its own earlier output — slices included — and writes beside the sources', () => {
  const r = run([dir, '--width', '48']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${join(dir, 'a.png')}: 144x60 -> 48x20 -> ${join(dir, 'a-thumb.png')} (${bytes(join(dir, 'a-thumb.png'))} bytes)\n${join(dir, 'b.png')}: 144x300 -> 48x100 -> ${join(dir, 'b-thumb.png')} (${bytes(join(dir, 'b-thumb.png'))} bytes)\n`);
  assert.equal(r.err, `thumb: ${dir}: skipped 2 existing *-thumb*.png\n`);
  assert.deepEqual(readdirSync(dir).sort(), ['a-thumb.png', 'a.png', 'b-thumb.png', 'b.png', 'notes.txt', 'z-thumb-30.png', 'z-thumb.png']);
  const again = run([dir, '--width', '48']); assert.equal(again.code, 0); assert.match(again.err, /skipped 4 existing/); assert.equal(readdirSync(dir).length, 7, 'a re-run refreshes, never chains -thumb-thumb');
});
check('--out <dir> is created (nested) and receives every thumbnail; the source directory gains nothing', () => {
  const out = join(root, 'out', 'nested'); const before = readdirSync(dir).sort();
  const r = run([join(dir, 'a.png'), join(dir, 'b.png'), '--out', out, '--width', '72']);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  assert.deepEqual(readdirSync(out).sort(), ['a-thumb.png', 'b-thumb.png']);
  assert.deepEqual(readdirSync(dir).sort(), before);
  assert.equal(read(join(out, 'b-thumb.png')).width, 72);
  assert.match(r.out, new RegExp(`^${esc(join(dir, 'a.png'))}: 144x60 -> 72x30 -> ${esc(join(out, 'a-thumb.png'))} \\(\\d+ bytes\\)$`, 'm'));
});
check('refuses to overwrite a source (empty suffix beside it, or via a symlinked --out) and two inputs colliding on one output: exit 2, nothing written', () => {
  const src = join(dir, 'a.png'); const bytes = readFileSync(src); const before = readdirSync(dir).sort();
  const r = run([src, '--suffix', '']); assert.equal(r.code, 2); assert.equal(r.out, ''); assert.match(r.err, /would overwrite its input/); assert.match(r.err, /usage: node thumb\.mjs/);
  const link = join(root, 'dir-link'); symlinkSync(dir, link);
  const s = run([src, '--suffix', '', '--out', link]); assert.equal(s.code, 2); assert.match(s.err, /would overwrite its input/);
  const other = join(root, 'dir2'); write(join(other, 'a.png'), white(10, 10)); const out = join(root, 'collide');
  const c = run([src, join(other, 'a.png'), '--out', out]); assert.equal(c.code, 2); assert.match(c.err, /both map to/); assert.ok(!existsSync(out));
  assert.ok(readFileSync(src).equals(bytes)); assert.deepEqual(readdirSync(dir).sort(), before);
});
check('--help and -h print the usage header (Usage, Writes:, exit codes, every flag) and exit 0 before touching anything — an empty cwd stays empty; --help wins over a bad flag', () => {
  const cwd = join(root, 'empty-help'); mkdirSync(cwd);
  for (const flag of ['--help', '-h']) {
    const r = run([flag], cwd); assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
    assert.match(r.out, /^skills\/extract\/scripts\/thumb\.mjs\n/); assert.match(r.out, /Usage:/); assert.match(r.out, /Writes:/); assert.match(r.out, /Exit codes:/);
    for (const f of ['--width <px>', '--max-height <px>', '--max-bytes <n>', '--min-share <pct>', '--offset <px>', '--out <dir>', '--suffix <s>']) assert.ok(r.out.includes(f), `header names ${f}`);
    assert.match(r.out, /480 → 400 → 320 → 240/); assert.match(r.out, /\[scaled to <w>px\] \[\(cropped at <n>px of <H> = <share>%\)\] \[for --max-bytes <b>\]/);
    assert.doesNotMatch(r.out, /\/\*\*/);
  }
  const mixed = run(['--bogus', 'x.png', '--help'], cwd); assert.equal(mixed.code, 0); assert.match(mixed.out, /Usage:/);
  assert.deepEqual(readdirSync(cwd), []);
});
check('usage errors exit 2 with the synopsis on stderr and write nothing: no args, unknown flag, bad --width, bad --offset, bad --min-share, missing value, a directory without PNGs', () => {
  const empty = join(root, 'empty-dir'); mkdirSync(empty);
  for (const args of [[], ['x.png', '--bogus'], ['x.png', '--width', 'abc'], ['x.png', '--offset', '-1'], ['x.png', '--min-share', '0'], ['x.png', '--out'], [empty]]) {
    const r = run(args, empty); assert.equal(r.code, 2, `${args.join(' ') || '(no args)'}: ${r.err}`); assert.equal(r.out, ''); assert.match(r.err, /^thumb: /); assert.match(r.err, /usage: node thumb\.mjs .*--min-share 60.*--offset 0/);
  }
  assert.deepEqual(readdirSync(empty), []);
});
check('an unreadable input exits 1 and is named on stderr; the readable inputs are still written', () => {
  const out = join(root, 'partial'); const missing = join(root, 'missing.png'); const notPng = join(root, 'text.png'); writeFileSync(notPng, 'not a png');
  const r = run([missing, join(dir, 'a.png'), notPng, '--out', out, '--width', '36']);
  assert.equal(r.code, 1); assert.match(r.err, /^thumb: .*missing\.png: ENOENT/m); assert.match(r.err, /^thumb: .*text\.png: /m);
  assert.equal(r.out, `${join(dir, 'a.png')}: 144x60 -> 36x15 -> ${join(out, 'a-thumb.png')} (${bytes(join(out, 'a-thumb.png'))} bytes)\n`);
  assert.deepEqual(readdirSync(out), ['a-thumb.png']);
});
check('invoked through a symlink the script still acts (real-path main-module guard, not a silent no-op)', () => {
  const link = join(root, 'thumb-link.mjs'); symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link, join(dir, 'a.png'), '--out', join(root, 'via-link'), '--width', '24'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, / 144x60 -> 24x10 -> /); assert.ok(existsSync(join(root, 'via-link', 'a-thumb.png')));
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nthumb: all checks passed');
process.exit(failed ? 1 : 0);
