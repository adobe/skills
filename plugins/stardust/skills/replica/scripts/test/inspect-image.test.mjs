#!/usr/bin/env node
// skills/replica/scripts/test/inspect-image.test.mjs — the inspect-image.mjs contract, no npm package needed:
// fitWithin (aspect kept, integer, ≥ 1, never upscaled, the 1400 × 1000 default box), downscale (area average —
// a 2×2 checkerboard averages to grey; transparent pixels do not darken the average; unchanged when no scaling),
// encodeJpeg read back marker by marker (SOI … EOI, JFIF APP0, SOF0 with the exact size, two 8-bit DQT tables
// scaled from Annex K by the quality formula, four DHT tables, byte-stuffed scan; alpha composited on white;
// deterministic; a flat 1400×1000 image under 60 KB), the inspection paths, and the CLI: --help before any import
// or I/O, usage exit 2, unreadable / not-a-PNG exit 1, and — on a generated PNG — either a written copy (pngjs
// importable here) or exit 1 naming the install line (pngjs absent). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  INSPECT_MAX, INSPECT_QUALITY, downscale, encodeJpeg, fitWithin, inspectionCopyPath, inspectionPath, toInspectionJpeg,
} from '../inspect-image.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'inspect-image.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd = HERE) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 60000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };

// ---- fixtures ---------------------------------------------------------------------------------------------
const image = (width, height, px) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(px(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const flat = (width, height, rgba = [200, 200, 200, 255]) => image(width, height, () => rgba);
// Deterministic noise (an LCG): the worst case for size, and plenty of 0xFF bytes in the scan to stuff.
const noise = (width, height) => { let s = 12345; const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s >>> 24; }; return image(width, height, () => [r(), r(), r(), 255]); };

// Walks the marker segments of a JPEG; the scan's entropy-coded bytes are returned with the SOS segment.
function segments(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'starts with SOI FF D8');
  const out = [];
  let off = 2;
  while (off < buf.length) {
    assert.equal(buf[off], 0xff, `marker expected at ${off}`);
    const marker = buf[off + 1];
    if (marker === 0xd9) { out.push({ marker, offset: off }); off += 2; break; }
    const len = buf.readUInt16BE(off + 2);
    const seg = { marker, offset: off, data: buf.subarray(off + 4, off + 2 + len) };
    off += 2 + len;
    if (marker === 0xda) {
      let end = off;
      while (!(buf[end] === 0xff && buf[end + 1] !== 0x00)) end += 1;
      seg.scan = buf.subarray(off, end);
      off = end;
    }
    out.push(seg);
  }
  assert.equal(off, buf.length, 'EOI is the last thing in the file');
  return out;
}
const sof0 = (buf) => { const s = segments(buf).find((g) => g.marker === 0xc0); return { precision: s.data[0], height: s.data.readUInt16BE(1), width: s.data.readUInt16BE(3), components: s.data[5] }; };
function dqtTables(buf) {
  const tables = {};
  for (const s of segments(buf).filter((g) => g.marker === 0xdb)) {
    for (let i = 0; i < s.data.length; i += 65) {
      assert.equal(s.data[i] >> 4, 0, 'baseline: 8-bit quantisation entries');
      tables[s.data[i] & 15] = [...s.data.subarray(i + 1, i + 65)];
    }
  }
  return tables;
}
// The usual (IJG) quality scaling of an Annex K entry.
const qScale = (q) => (q < 50 ? Math.floor(5000 / q) : 200 - 2 * q);
const scaled = (base, q) => Math.min(255, Math.max(1, Math.floor((base * qScale(q) + 50) / 100)));

// A minimal RGBA PNG writer (stored rows, filter 0) so the CLI can be driven without pngjs.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function png({ width, height, data }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- fitWithin --------------------------------------------------------------------------------------------
check('fitWithin: the default box is 1400 × 1000 at quality 80', () => {
  assert.deepEqual(INSPECT_MAX, { width: 1400, height: 1000 });
  assert.equal(INSPECT_QUALITY, 80);
});
check('fitWithin: a tall full-page capture fits the height, aspect kept (1400×20000 → 70×1000, 3000×20000 → 150×1000)', () => {
  assert.deepEqual(fitWithin(1400, 20000), { width: 70, height: 1000 });
  assert.deepEqual(fitWithin(3000, 20000), { width: 150, height: 1000 });
  assert.deepEqual(fitWithin(1440, 9000), { width: 160, height: 1000 });
});
check('fitWithin: a wide band fits the width (2880×1800 → 1400×875, 1440×120 → 1400×117, a 3-column strip 4352×400 → 1400×129)', () => {
  assert.deepEqual(fitWithin(2880, 1800), { width: 1400, height: 875 });
  assert.deepEqual(fitWithin(1440, 120), { width: 1400, height: 117 });
  assert.deepEqual(fitWithin(4352, 400), { width: 1400, height: 129 });
});
check('fitWithin: a small image is unchanged — never upscaled; the box edge itself is unchanged', () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1400, 1000), { width: 1400, height: 1000 });
  assert.deepEqual(fitWithin(1, 1), { width: 1, height: 1 });
});
check('fitWithin: integer sides, never below 1 (1×50000 → 1×1000, 50000×3 → 1400×1); a custom box', () => {
  assert.deepEqual(fitWithin(1, 50000), { width: 1, height: 1000 });
  assert.deepEqual(fitWithin(50000, 3), { width: 1400, height: 1 });
  assert.deepEqual(fitWithin(300, 200, { width: 100, height: 100 }), { width: 100, height: 67 });
});
check('fitWithin: a non-positive or non-integer size throws', () => {
  assert.throws(() => fitWithin(0, 10), RangeError);
  assert.throws(() => fitWithin(10.5, 10), RangeError);
  assert.throws(() => fitWithin(10, 10, { width: 0, height: 10 }), RangeError);
});

// ---- downscale --------------------------------------------------------------------------------------------
check('downscale: a 2×2 black/white checkerboard averages to one grey pixel', () => {
  const board = image(2, 2, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const g = downscale(board, { width: 1, height: 1 });
  assert.equal(g.width, 1); assert.equal(g.height, 1);
  const [r, gg, b, a] = g.data;
  assert.ok(r === gg && gg === b && Math.abs(r - 127.5) <= 0.5, `grey, got ${[r, gg, b]}`);
  assert.equal(a, 255);
});
check('downscale: area average — halves stay pure (4×2 black|white → 2×1), a 3→2 resample weights the shared pixel by its area', () => {
  const halves = downscale(image(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])), { width: 2, height: 1 });
  assert.deepEqual([...halves.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  // Source 0 | 90 | 180 into two pixels of 1.5 source pixels each: (0 + 90/2) / 1.5 = 30, (90/2 + 180) / 1.5 = 150.
  const third = downscale(image(3, 1, (x) => [x * 90, x * 90, x * 90, 255]), { width: 2, height: 1 });
  assert.deepEqual([...third.data], [30, 30, 30, 255, 150, 150, 150, 255]);
});
check('downscale: a transparent pixel does not darken its opaque neighbour (alpha-weighted colour)', () => {
  const g = downscale(image(2, 1, (x) => (x ? [0, 0, 0, 0] : [255, 0, 0, 255])), { width: 1, height: 1 });
  assert.deepEqual([...g.data], [255, 0, 0, 128]);
});
check('downscale: returns the input unchanged when the target is its own size; the output has the target size', () => {
  const img = noise(5, 4);
  assert.equal(downscale(img, { width: 5, height: 4 }), img);
  const out = downscale(noise(300, 200), fitWithin(300, 200, { width: 120, height: 120 }));
  assert.equal(out.width, 120); assert.equal(out.height, 80); assert.equal(out.data.length, 120 * 80 * 4);
});

// ---- encodeJpeg -------------------------------------------------------------------------------------------
check('encodeJpeg: SOI first, EOI last, JFIF APP0 right after SOI, baseline SOF0 with the exact size and three components', () => {
  for (const [w, h] of [[1, 1], [9, 17], [37, 23], [1400, 1000]]) {
    const jpg = encodeJpeg(flat(w, h));
    assert.ok(Buffer.isBuffer(jpg));
    assert.deepEqual([jpg[0], jpg[1]], [0xff, 0xd8]);
    assert.deepEqual([jpg.at(-2), jpg.at(-1)], [0xff, 0xd9]);
    const segs = segments(jpg);
    assert.equal(segs[0].marker, 0xe0, 'APP0 first');
    assert.equal(segs[0].data.subarray(0, 5).toString('latin1'), 'JFIF\0');
    const markers = segs.map((s) => s.marker);
    assert.ok(!markers.some((m) => m >= 0xc1 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc), 'no non-baseline SOF');
    assert.deepEqual(sof0(jpg), { precision: 8, height: h, width: w, components: 3 }, `${w}×${h}`);
    assert.equal(markers.filter((m) => m === 0xc4).length > 0, true, 'DHT present');
    assert.equal(markers.indexOf(0xda) < markers.indexOf(0xd9), true, 'SOS before EOI');
  }
});
check('encodeJpeg: two DQT tables; the first luminance entry is Annex K\'s 16 scaled for q80 (→ 6), chrominance 17 → 7; quality changes them', () => {
  const t = dqtTables(encodeJpeg(flat(16, 16)));
  assert.deepEqual(Object.keys(t).sort(), ['0', '1']);
  assert.equal(t[0][0], scaled(16, 80)); assert.equal(t[0][0], 6);
  assert.equal(t[1][0], scaled(17, 80));
  assert.equal(t[0].length, 64); assert.equal(t[1].length, 64);
  assert.equal(dqtTables(encodeJpeg(flat(16, 16), 50))[0][0], 16);
  assert.equal(dqtTables(encodeJpeg(flat(16, 16), 100))[0][0], 1);
  assert.equal(dqtTables(encodeJpeg(flat(16, 16), 10))[0][0], scaled(16, 10));
});
check('encodeJpeg: four Huffman tables (DC/AC × luminance/chrominance) and a three-component scan', () => {
  const segs = segments(encodeJpeg(noise(24, 24)));
  const ids = [];
  for (const s of segs.filter((g) => g.marker === 0xc4)) {
    let i = 0;
    while (i < s.data.length) { ids.push(s.data[i]); const n = s.data.subarray(i + 1, i + 17).reduce((a, b) => a + b, 0); i += 17 + n; }
  }
  assert.deepEqual(ids.sort((a, b) => a - b), [0x00, 0x01, 0x10, 0x11]);
  const sos = segs.find((g) => g.marker === 0xda);
  assert.equal(sos.data[0], 3);
});
check('encodeJpeg: every 0xFF inside the scan is byte-stuffed (followed by 0x00)', () => {
  const { scan } = segments(encodeJpeg(noise(64, 64), 95)).find((g) => g.marker === 0xda);
  let ff = 0;
  for (let i = 0; i < scan.length; i += 1) if (scan[i] === 0xff) { ff += 1; assert.equal(scan[i + 1], 0x00, `stuffed at ${i}`); }
  assert.ok(ff > 0, 'the noise fixture produced at least one 0xFF to stuff');
});
check('encodeJpeg: deterministic — two encodes of the same image are byte-identical', () => {
  const img = noise(130, 70);
  assert.ok(encodeJpeg(img).equals(encodeJpeg(img)));
});
check('encodeJpeg: alpha is composited on white — a transparent image encodes exactly like a white one', () => {
  assert.ok(encodeJpeg(flat(20, 12, [0, 0, 0, 0])).equals(encodeJpeg(flat(20, 12, [255, 255, 255, 255]))));
});
check('encodeJpeg: a flat 1400×1000 image is under 60 KB; noise costs more at higher quality', () => {
  const size = encodeJpeg(flat(1400, 1000)).length;
  assert.ok(size < 60 * 1024, `${size} bytes`);
  const img = noise(64, 64);
  assert.ok(encodeJpeg(img, 30).length < encodeJpeg(img, 95).length);
});
check('encodeJpeg: a bad quality or a data length that does not match the size throws', () => {
  assert.throws(() => encodeJpeg(flat(2, 2), 0), RangeError);
  assert.throws(() => encodeJpeg(flat(2, 2), 101), RangeError);
  assert.throws(() => encodeJpeg({ width: 2, height: 2, data: Buffer.alloc(8) }), RangeError);
});
check('toInspectionJpeg: fits within the box, then encodes — the SOF0 carries the capped size', () => {
  const r = toInspectionJpeg(flat(2800, 200));
  assert.deepEqual([r.width, r.height], [1400, 100]);
  assert.deepEqual([sof0(r.jpeg).width, sof0(r.jpeg).height], [1400, 100]);
  const small = toInspectionJpeg(flat(300, 40), { max: { width: 100, height: 100 }, quality: 50 });
  assert.deepEqual([small.width, small.height], [100, 13]);
  assert.equal(dqtTables(small.jpeg)[0][0], 16);
});

// ---- paths ------------------------------------------------------------------------------------------------
check('inspectionPath: the .jpg sibling — x.png → x.jpg, a .jpg/.jpeg is itself, no extension → x.jpg', () => {
  assert.equal(inspectionPath('x.png'), 'x.jpg');
  assert.equal(inspectionPath('gates/home-1440/chrome-header-diff.png'), 'gates/home-1440/chrome-header-diff.jpg');
  assert.equal(inspectionPath('a/b/X.PNG'), 'a/b/X.jpg');
  assert.equal(inspectionPath('x.jpg'), 'x.jpg');
  assert.equal(inspectionPath('x.JPEG'), 'x.JPEG');
  assert.equal(inspectionPath('x'), 'x.jpg');
  assert.equal(inspectionPath('dir.v2/x'), 'dir.v2/x.jpg', 'a dot in a directory name is not an extension');
});
check('inspectionCopyPath: <stem>.inspect.jpg — the CLI default beside the input', () => {
  assert.equal(inspectionCopyPath('x.png'), 'x.inspect.jpg');
  assert.equal(inspectionCopyPath('gates/home-1440/live.png'), 'gates/home-1440/live.inspect.jpg');
  assert.equal(inspectionCopyPath('x'), 'x.inspect.jpg');
  assert.equal(inspectionCopyPath('dir.v2/x'), 'dir.v2/x.inspect.jpg');
});

// ---- CLI --------------------------------------------------------------------------------------------------
check('--help in an empty cwd: exit 0, usage with the box, the quality and the exit codes, nothing written — no pngjs needed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'inspect-image-help-'));
  try {
    const r = run(['--help'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Usage: node inspect-image\.mjs <in\.png>/);
    assert.match(r.out, /1400x1000/); assert.match(r.out, /--quality/); assert.match(r.out, /Exit codes/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
check('usage errors exit 2: no input, two inputs, an unknown flag, a bad --max / --quality, an --out that is not .jpg/.jpeg', () => {
  for (const args of [[], ['a.png', 'b.png'], ['a.png', '--bogus'], ['a.png', '--max', '1400'], ['a.png', '--max', '0x10'], ['a.png', '--quality', '0'],
    ['a.png', '--quality', '101'], ['a.png', '--quality', 'high'], ['a.png', '--out'], ['a.png', '--out', 'a-copy.png']]) {
    const r = run(args);
    assert.equal(r.code, 2, `${args.join(' ')} → ${r.code}\n${r.err}`);
    assert.match(r.err, /inspect-image error/);
  }
});
check('an unreadable input or a file that is not a PNG exits 1 and writes nothing', () => {
  const missing = run([join(HERE, 'no-such-image.png')]);
  assert.equal(missing.code, 1); assert.match(missing.err, /cannot read/);
  const notPng = run([SCRIPT, '--out', join(HERE, 'never-written.jpg')]);
  assert.equal(notPng.code, 1); assert.match(notPng.err, /not a PNG/);
  assert.equal(existsSync(join(HERE, 'never-written.jpg')), false);
});

let hasPngjs = true;
try { await import('pngjs'); } catch { hasPngjs = false; }
check(`a generated 2000×300 PNG: ${hasPngjs ? 'written as a 1400×210 q80 copy beside it, one summary line' : 'exit 1 naming the install line (pngjs is not importable here)'}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspect-image-cli-'));
  try {
    const input = join(dir, 'live.png');
    writeFileSync(input, png(image(2000, 300, (x, y) => [x % 256, y % 256, (x + y) % 256, 255])));
    const r = run([input]);
    const out = join(dir, 'live.inspect.jpg');
    if (hasPngjs) {
      assert.equal(r.code, 0, r.err);
      assert.match(r.out.trim(), /^inspect-image: \S+live\.png 2000×300 → \S+live\.inspect\.jpg 1400×210 q80 \(\d+ KB\)$/);
      assert.deepEqual([sof0(readFileSync(out)).width, sof0(readFileSync(out)).height], [1400, 210]);
      const custom = join(dir, 'small.jpeg');
      const r2 = run([input, '--out', custom, '--max', '200x200', '--quality', '60']);
      assert.equal(r2.code, 0, r2.err);
      assert.match(r2.out, /200×30 q60/);
      assert.equal(dqtTables(readFileSync(custom))[0][0], scaled(16, 60));
    } else {
      assert.equal(r.code, 1, r.err);
      assert.match(r.err, /pngjs/); assert.match(r.err, /npm i -D playwright pixelmatch pngjs cheerio/);
      assert.equal(existsSync(out), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} check(s) failing` : '\ninspect-image: all checks passed');
process.exit(failed ? 1 : 0);
