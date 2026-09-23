#!/usr/bin/env node
// skills/extract/scripts/test/thumb.test.mjs — the thumb.mjs contract: exact area-average bins,
// plan geometry (no upscale; the cap crops in SOURCE rows), a 1-px rule surviving a 3× downscale as
// a darker row, the "cropped at" note, the --max-bytes cap (a heavy page re-encoded at a lower
// --max-height until it fits, the final size on the line, exit 1 when one row still exceeds it),
// directory and --out inputs, refusal to overwrite a source or collide two outputs, --help with
// nothing written, usage and read-failure exit codes, the real-path main-module guard. Fixtures are
// generated with pngjs in a temp dir; without pngjs (this checkout) the pure checks still run, then one
// skip line and exit 0. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binWeights, boxDownscale, expandInputs, nextMaxHeight, parseArgs, planThumb, thumbPath } from '../thumb.mjs';

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
check('planThumb: 3× geometry, no crop under the cap, the cap crops in SOURCE rows, never upscales, 1-row floor', () => {
  assert.deepEqual(planThumb(1440, 3000), { w: 480, h: 1000, rows: 3000, cropped: false });
  assert.deepEqual(planThumb(1440, 6242), { w: 480, h: 2081, rows: 6242, cropped: false });
  assert.deepEqual(planThumb(1440, 8000), { w: 480, h: 2667, rows: 8000, cropped: false }, '8000 rows at 3× is 2667 — under 3200');
  assert.deepEqual(planThumb(1440, 8000, { width: 720 }), { w: 720, h: 3200, rows: 6400, cropped: true });
  assert.deepEqual(planThumb(1440, 8000, { maxHeight: 2000 }), { w: 480, h: 2000, rows: 6000, cropped: true });
  assert.deepEqual(planThumb(1440, 12000, { width: 500 }), { w: 500, h: 3200, rows: 9216, cropped: true }, 'fractional scale still lands on the cap');
  assert.deepEqual(planThumb(390, 2000), { w: 390, h: 2000, rows: 2000, cropped: false }, 'narrower than --width: kept as is');
  assert.deepEqual(planThumb(1440, 1), { w: 480, h: 1, rows: 1, cropped: false });
});
check('nextMaxHeight: proportional to the byte ratio with an 8 % margin, always at least one row lower, floor at one row', () => {
  assert.equal(nextMaxHeight(1000, 1400000, 150000), 98); // floor(1000 × 150000 / 1400000 × 0.92)
  assert.equal(nextMaxHeight(100, 150001, 150000), 91, 'barely over: the margin, not one row, does the work');
  assert.equal(nextMaxHeight(2, 200, 100), 1);
  assert.equal(nextMaxHeight(1, 999, 10), 1, 'never below one row');
  assert.equal(nextMaxHeight(500, 160000, 150000), 431);
});
check('thumbPath: beside the source by default, --out redirects, suffix before .png, extension case-insensitive', () => {
  assert.equal(thumbPath('/a/b/home.png'), '/a/b/home-thumb.png');
  assert.equal(thumbPath('/a/b/home.PNG', { out: '/t', suffix: '' }), '/t/home.png');
  assert.equal(thumbPath('x.png', { suffix: '.480' }), 'x.480.png');
});
check('parseArgs: defaults, every flag, positive-integer validation, unknown option, missing value, no inputs → exit-2 errors', () => {
  const { opts, pos } = parseArgs(['a.png', 'dir']);
  assert.deepEqual(opts, { width: 480, maxHeight: 3200, maxBytes: 150000, suffix: '-thumb', out: null }); assert.deepEqual(pos, ['a.png', 'dir']);
  assert.deepEqual(parseArgs(['x', '--width', '320', '--max-height', '1000', '--max-bytes', '90000', '--out', 'o', '--suffix', '']).opts, { width: 320, maxHeight: 1000, maxBytes: 90000, suffix: '', out: 'o' });
  for (const bad of [['x', '--width', '0'], ['x', '--width', 'abc'], ['x', '--max-height', '1.5'], ['x', '--max-bytes', '0'], ['x', '--max-bytes', 'big'], ['x', '--bogus'], ['x', '-x'], ['x', '--out'], []]) {
    assert.throws(() => parseArgs(bad), (e) => e.code === 2, `should refuse: ${bad.join(' ') || '(no args)'}`);
  }
});
check('parseArgs: a value flag followed by nothing or by another --flag is a usage error (exit 2) naming the flag — never swallowed; a single-dash value stays a value', () => {
  for (const [flag, ...tail] of [['--width'], ['--max-height'], ['--max-bytes'], ['--out'], ['--suffix'], ['--width', '--out', 'o'], ['--out', '--suffix', '-s'], ['--suffix', '--width', '48'], ['--max-height', '--help'], ['--max-bytes', '--width', '48']]) {
    assert.throws(() => parseArgs(['x.png', flag, ...tail]), (e) => e.code === 2 && e.message === `${flag} needs a value`, `${flag} ${tail.join(' ')}`);
  }
  assert.equal(parseArgs(['x.png', '--suffix', '-720']).opts.suffix, '-720');
  assert.equal(parseArgs(['x.png', '--suffix', '']).opts.suffix, '');
});
check('expandInputs: files pass through (absent ones too — they fail at read time); a directory yields its sorted PNGs minus its own earlier output', () => {
  assert.deepEqual(expandInputs(['/nope/x.png'], '-thumb'), ['/nope/x.png']);
  const d = mkdtempSync(join(tmpdir(), 'thumb-expand-'));
  for (const f of ['b.png', 'a.PNG', 'a-thumb.png', 'notes.txt']) writeFileSync(join(d, f), '');
  const warnings = [];
  assert.deepEqual(expandInputs([d], '-thumb', (m) => warnings.push(m)), [join(d, 'a.PNG'), join(d, 'b.png')]);
  assert.deepEqual(warnings, [`${d}: skipped 1 existing *-thumb.png`]);
  assert.deepEqual(expandInputs([d], ''), [join(d, 'a-thumb.png'), join(d, 'a.PNG'), join(d, 'b.png')], 'an empty suffix skips nothing');
  const empty = join(d, 'empty'); mkdirSync(empty); const w2 = [];
  assert.deepEqual(expandInputs([empty], '-thumb', (m) => w2.push(m)), []); assert.deepEqual(w2, [`no *.png in ${empty}`]);
  rmSync(d, { recursive: true, force: true });
});

// ---- fixtures + CLI (pngjs) ---------------------------------------------------------------------
let PNG = null;
try { ({ PNG } = await import('pngjs')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
if (!PNG) {
  console.log(failed ? `\n${failed} failing` : '\nskip  thumb: fixture and CLI checks need pngjs (run them in the image); pure checks passed');
  process.exit(failed ? 1 : 0);
}

// realpath: the script's main-module guard compares real paths, and the overwrite check does too.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'thumb-test-')));
const white = (w, h) => { const p = new PNG({ width: w, height: h }); p.data.fill(255); return p; };
const paintRows = (png, y0, y1, v) => { for (let y = y0; y < y1; y += 1) for (let x = 0; x < png.width; x += 1) { const i = (y * png.width + x) * 4; png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; } };
const write = (file, png) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, PNG.sync.write(png, { deflateLevel: 1, filterType: 0 })); return file; };
const read = (file) => PNG.sync.read(readFileSync(file));
const bytes = (file) => statSync(file).size;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowMean = (png, y) => { let s = 0; for (let x = 0; x < png.width; x += 1) { const i = (y * png.width + x) * 4; s += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; } return s / png.width; };
const darkestRow = (png) => { let best = { y: -1, mean: Infinity }; for (let y = 0; y < png.height; y += 1) { const mean = rowMean(png, y); if (mean < best.mean) best = { y, mean }; } return best; };

const RULE_Y = 1501; // not on the 3× stride (rows 0, 3, 6, …): a nearest-neighbour sampler never lands on it
const rule = white(1440, 3000); paintRows(rule, RULE_Y, RULE_Y + 1, 0x22);
const tall = white(1440, 8000); paintRows(tall, 6000, 6400, 0); // a dark band between the two crop points exercised below
const shots = join(root, 'screenshots');
const ruleSrc = write(join(shots, 'home.png'), rule);
const tallSrc = write(join(shots, 'pricing.png'), tall);
// a page that does not compress — noise — so its 480-wide thumbnail is far over the default 150 KB cap
const noise = new PNG({ width: 1440, height: 3000 }); noise.data = randomBytes(1440 * 3000 * 4); for (let i = 3; i < noise.data.length; i += 4) noise.data[i] = 255;
const noiseSrc = write(join(shots, 'gallery.png'), noise);
const dir = join(root, 'dir');
write(join(dir, 'b.png'), white(144, 300)); write(join(dir, 'a.png'), white(144, 60)); write(join(dir, 'z-thumb.png'), white(48, 10)); writeFileSync(join(dir, 'notes.txt'), 'x');

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
check('1440×8000 lands at 480×2667 under the 3200 cap (no note); the cap crops the SOURCE from the top: --width 720 → 720×3200 (cropped at 6400px of 8000), --max-height 2000 → 480×2000 (cropped at 6000px of 8000)', () => {
  const out = join(root, 'crop');
  const r0 = run([tallSrc, '--out', out]); assert.equal(r0.code, 0, r0.err);
  assert.equal(r0.out, `${tallSrc}: 1440x8000 -> 480x2667 -> ${join(out, 'pricing-thumb.png')} (${bytes(join(out, 'pricing-thumb.png'))} bytes)\n`);
  // 8000 → 2667 rows is a 2.99963× vertical scale, so the band's top edge (source row 6000) falls at output row 2000.25: row 2000 is a seam that averages ¼ white + ¾ dark, the rows inside the band are 0.
  const t0 = read(join(out, 'pricing-thumb.png')); assert.equal(t0.height, 2667); assert.equal(rowMean(t0, 1999), 255);
  const seam = rowMean(t0, 2000); assert.ok(seam > 0 && seam < 255, `seam row averages, got ${seam}`); assert.equal(rowMean(t0, 2001), 0); assert.equal(rowMean(t0, 2132), 0); assert.equal(rowMean(t0, 2134), 255);
  const r1 = run([tallSrc, '--width', '720', '--max-height', '3200', '--out', out, '--suffix', '-720']); assert.equal(r1.code, 0, r1.err);
  assert.equal(r1.out, `${tallSrc}: 1440x8000 -> 720x3200 (cropped at 6400px of 8000) -> ${join(out, 'pricing-720.png')} (${bytes(join(out, 'pricing-720.png'))} bytes)\n`);
  const t1 = read(join(out, 'pricing-720.png')); assert.equal(t1.width, 720); assert.equal(t1.height, 3200);
  assert.equal(rowMean(t1, 2999), 255); assert.equal(rowMean(t1, 3000), 0); assert.equal(rowMean(t1, 3199), 0, 'the band at source rows 6000–6399 is the thumbnail\'s tail');
  const r2 = run([tallSrc, '--max-height', '2000', '--out', out, '--suffix', '-2000']); assert.equal(r2.code, 0, r2.err);
  assert.equal(r2.out, `${tallSrc}: 1440x8000 -> 480x2000 (cropped at 6000px of 8000) -> ${join(out, 'pricing-2000.png')} (${bytes(join(out, 'pricing-2000.png'))} bytes)\n`);
  const t2 = read(join(out, 'pricing-2000.png')); assert.equal(t2.height, 2000); assert.equal(darkestRow(t2).mean, 255, 'cropped just above the band: all white');
});
check('--max-bytes (default 150000): a thumbnail over the cap is re-encoded at a lower --max-height — the same bottom crop — until it fits; the line carries the crop, the cap and the final size; a larger cap keeps more rows; a light page is untouched and still prints its size', () => {
  const out = join(root, 'cap');
  const r = run([noiseSrc, '--out', out]);
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  const dst = join(out, 'gallery-thumb.png'); const size = bytes(dst);
  assert.ok(size <= 150000, `${size} bytes is over the default cap`);
  assert.ok(size > 75000, `${size} bytes: the shrink is proportional, not a collapse`);
  const m = r.out.match(new RegExp(`^${esc(noiseSrc)}: 1440x3000 -> 480x(\\d+) \\(cropped at (\\d+)px of 3000; re-encoded for --max-bytes 150000\\) -> ${esc(dst)} \\((\\d+) bytes\\)\\n$`));
  assert.ok(m, r.out);
  const t = read(dst); assert.equal(t.width, 480); assert.equal(t.height, Number(m[1])); assert.ok(t.height < 1000 && t.height >= 1, `height ${t.height}`);
  assert.equal(Number(m[2]), t.height * 3, 'the crop is the thumbnail height in source rows (3×)');
  assert.equal(Number(m[3]), size, 'the printed size is the file size');
  const r2 = run([noiseSrc, '--out', out, '--suffix', '-big', '--max-bytes', '600000']); assert.equal(r2.code, 0, r2.err);
  const bigDst = join(out, 'gallery-big.png'); assert.ok(bytes(bigDst) <= 600000); assert.ok(read(bigDst).height > t.height, 'a larger cap keeps more rows');
  assert.match(r2.out, /re-encoded for --max-bytes 600000\)/);
  const r3 = run([ruleSrc, '--out', out]); assert.equal(r3.code, 0, r3.err);
  assert.equal(r3.out, `${ruleSrc}: 1440x3000 -> 480x1000 -> ${join(out, 'home-thumb.png')} (${bytes(join(out, 'home-thumb.png'))} bytes)\n`, 'under the cap: no note, size printed');
});
check('a cap that cannot be met even at one row: the one-row thumbnail is still written, one stderr line names it, exit 1', () => {
  const out = join(root, 'cap-unmet');
  const r = run([join(dir, 'a.png'), '--out', out, '--width', '48', '--max-bytes', '40']);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, / 144x60 -> 48x1 \(cropped at 3px of 60; re-encoded for --max-bytes 40\) -> .*a-thumb\.png \(\d+ bytes\)\n$/);
  assert.match(r.err, /^thumb: .*a-thumb\.png: \d+ bytes at 1 row\(s\) still exceeds --max-bytes 40 — the cap cannot be met at this --width; written anyway\n$/);
  assert.equal(read(join(out, 'a-thumb.png')).height, 1);
});
check('a directory input takes its PNGs (sorted), skips the non-PNG file and its own earlier output, writes beside the sources', () => {
  const r = run([dir, '--width', '48']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${join(dir, 'a.png')}: 144x60 -> 48x20 -> ${join(dir, 'a-thumb.png')} (${bytes(join(dir, 'a-thumb.png'))} bytes)\n${join(dir, 'b.png')}: 144x300 -> 48x100 -> ${join(dir, 'b-thumb.png')} (${bytes(join(dir, 'b-thumb.png'))} bytes)\n`);
  assert.equal(r.err, `thumb: ${dir}: skipped 1 existing *-thumb.png\n`);
  assert.deepEqual(readdirSync(dir).sort(), ['a-thumb.png', 'a.png', 'b-thumb.png', 'b.png', 'notes.txt', 'z-thumb.png']);
  const again = run([dir, '--width', '48']); assert.equal(again.code, 0); assert.match(again.err, /skipped 3 existing/); assert.equal(readdirSync(dir).length, 6, 'a re-run refreshes, never chains -thumb-thumb');
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
check('--help and -h print the usage header (Usage, Writes:, exit codes) and exit 0 before touching anything — an empty cwd stays empty; --help wins over a bad flag', () => {
  const cwd = join(root, 'empty-help'); mkdirSync(cwd);
  for (const flag of ['--help', '-h']) {
    const r = run([flag], cwd); assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
    assert.match(r.out, /^skills\/extract\/scripts\/thumb\.mjs\n/); assert.match(r.out, /Usage:/); assert.match(r.out, /Writes:/); assert.match(r.out, /Exit codes:/); assert.match(r.out, /--max-height/); assert.match(r.out, /--max-bytes <n>/);
    assert.doesNotMatch(r.out, /\/\*\*/);
  }
  const mixed = run(['--bogus', 'x.png', '--help'], cwd); assert.equal(mixed.code, 0); assert.match(mixed.out, /Usage:/);
  assert.deepEqual(readdirSync(cwd), []);
});
check('usage errors exit 2 with the synopsis on stderr and write nothing: no args, unknown flag, bad --width, missing value, a directory without PNGs', () => {
  const empty = join(root, 'empty-dir'); mkdirSync(empty);
  for (const args of [[], ['x.png', '--bogus'], ['x.png', '--width', 'abc'], ['x.png', '--out'], [empty]]) {
    const r = run(args, empty); assert.equal(r.code, 2, `${args.join(' ') || '(no args)'}: ${r.err}`); assert.equal(r.out, ''); assert.match(r.err, /^thumb: /); assert.match(r.err, /usage: node thumb\.mjs/);
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
