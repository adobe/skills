#!/usr/bin/env node
/**
 * skills/replica/scripts/inspect-image.mjs
 *
 * A capped JPEG copy of a gate image for an agent to LOOK at. Full-page
 * captures and wide bands are measurement inputs (pixel-compare.mjs and
 * crop-compare.mjs read them at full resolution); read into context they
 * cost far more than an agent needs to see a defect. Every image meant to be
 * looked at is capped at 1400 × 1000 px and JPEG quality 80; the PNG stays
 * untouched beside it.
 *
 * Library (zero runtime dependencies): INSPECT_MAX, INSPECT_QUALITY,
 * fitWithin, downscale (area average), encodeJpeg (an original baseline
 * encoder: JFIF APP0, Annex K quantisation tables scaled by the usual quality
 * formula, 4:4:4 — no chroma subsampling, so a single-pixel diff mark or
 * coloured text keeps its colour — standard Huffman tables, alpha composited
 * on white, deterministic), toInspectionJpeg, inspectionPath,
 * inspectionCopyPath. CLI: see HELP below (--help).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-bitwise, no-plusplus */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSPECT_MAX = { width: 1400, height: 1000 };
export const INSPECT_QUALITY = 80;

const INSTALL_LINE = 'npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps';

const HELP = `inspect-image — a capped JPEG copy of a gate image for an agent to look at

Usage: node inspect-image.mjs <in.png> [--out <file.jpg>] [--max 1400x1000] [--quality 80]
  --out <file.jpg>   where to write; must end in .jpg or .jpeg
                     (default: <in>.inspect.jpg beside the input — live.png → live.inspect.jpg)
  --max <W>x<H>      fit within this box, aspect kept, never upscaled (default 1400x1000)
  --quality <1-100>  JPEG quality (default 80)
  --help             this text

Look at the copy, never the full-resolution PNG: the PNG stays untouched as the
measurement input of pixel-compare / crop-compare. Baseline JPEG, 4:4:4 (no chroma
subsampling), alpha composited on white, deterministic: the same PNG and flags
give the same bytes.

Prints one line: inspect-image: <in> <w>×<h> → <out> <w2>×<h2> q<q> (<n> KB)
Requires: pngjs (a project devDependency, imported only after --help). Missing →
from the project root: ${INSTALL_LINE}
(replica/SKILL.md § Setup).
Exit codes: 0 written · 1 unreadable input, not a PNG, or pngjs missing · 2 usage.`;

// ---- sizes and paths --------------------------------------------------------------------------------------

const positiveInt = (n) => Number.isInteger(n) && n > 0;

/** The size that fits {width, height} within max: aspect kept, integer sides ≥ 1, never upscaled. */
export function fitWithin(w, h, max = INSPECT_MAX) {
  if (!positiveInt(w) || !positiveInt(h)) throw new RangeError(`fitWithin: size must be positive integers, got ${w}×${h}`);
  if (!positiveInt(max.width) || !positiveInt(max.height)) throw new RangeError(`fitWithin: box must be positive integers, got ${max.width}×${max.height}`);
  const scale = Math.min(1, max.width / w, max.height / h);
  if (scale === 1) return { width: w, height: h };
  return {
    width: Math.min(max.width, Math.max(1, Math.round(w * scale))),
    height: Math.min(max.height, Math.max(1, Math.round(h * scale))),
  };
}

const stem = (path) => { const ext = extname(path); return ext ? path.slice(0, -ext.length) : path; };

/** The .jpg sibling an inspection copy is written to: x.png → x.jpg; x.jpg / x.jpeg → itself; x → x.jpg. */
export function inspectionPath(path) {
  return /^\.jpe?g$/i.test(extname(path)) ? path : `${stem(path)}.jpg`;
}

/** The CLI's default output beside the input: x.png → x.inspect.jpg. */
export function inspectionCopyPath(path) {
  return `${stem(path)}.inspect.jpg`;
}

// ---- downscale: area-average (box filter) resample --------------------------------------------------------

// For each destination index along one axis, the source indices it covers and their share of its area.
function boxTaps(srcN, dstN) {
  const scale = srcN / dstN;
  const taps = [];
  for (let i = 0; i < dstN; i += 1) {
    const start = i * scale;
    const end = Math.min(srcN, (i + 1) * scale);
    const index = [];
    const weight = [];
    for (let s = Math.floor(start); s < end; s += 1) {
      const w = Math.min(end, s + 1) - Math.max(start, s);
      if (w > 0) { index.push(s); weight.push(w); }
    }
    const total = weight.reduce((a, b) => a + b, 0);
    taps.push({ index, weight: weight.map((w) => w / total) });
  }
  return taps;
}

/**
 * Resamples an RGBA image to target {width, height}; every output pixel is the area-weighted average of the
 * source pixels it covers. Colour is averaged weighted by alpha, so transparent pixels do not darken the
 * result. Returns the input itself when the target is its own size.
 */
export function downscale(img, target) {
  const { width: sw, height: sh, data } = img;
  const { width: dw, height: dh } = target;
  if (dw === sw && dh === sh) return img;
  if (!positiveInt(dw) || !positiveInt(dh)) throw new RangeError(`downscale: target must be positive integers, got ${dw}×${dh}`);
  if (data.length !== sw * sh * 4) throw new RangeError(`downscale: ${sw}×${sh} RGBA needs ${sw * sh * 4} bytes, got ${data.length}`);
  const xTaps = boxTaps(sw, dw);
  const yTaps = boxTaps(sh, dh);
  // One source row resampled horizontally, alpha-premultiplied: [r·a, g·a, b·a, a] per destination column.
  const rows = new Map();
  const rowAt = (sy) => {
    let row = rows.get(sy);
    if (row) return row;
    row = new Float64Array(dw * 4);
    const base = sy * sw * 4;
    for (let dx = 0; dx < dw; dx += 1) {
      const { index, weight } = xTaps[dx];
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let k = 0; k < index.length; k += 1) {
        const i = base + index[k] * 4;
        const wa = weight[k] * data[i + 3];
        r += wa * data[i]; g += wa * data[i + 1]; b += wa * data[i + 2]; a += wa;
      }
      row[dx * 4] = r; row[dx * 4 + 1] = g; row[dx * 4 + 2] = b; row[dx * 4 + 3] = a;
    }
    rows.set(sy, row);
    return row;
  };
  const out = Buffer.alloc(dw * dh * 4);
  const acc = new Float64Array(dw * 4);
  const byte = (v) => Math.min(255, Math.max(0, Math.round(v)));
  for (let dy = 0; dy < dh; dy += 1) {
    const { index, weight } = yTaps[dy];
    for (const sy of rows.keys()) if (sy < index[0]) rows.delete(sy);
    acc.fill(0);
    for (let k = 0; k < index.length; k += 1) {
      const row = rowAt(index[k]);
      for (let i = 0; i < acc.length; i += 1) acc[i] += weight[k] * row[i];
    }
    for (let dx = 0; dx < dw; dx += 1) {
      const o = (dy * dw + dx) * 4;
      const a = acc[dx * 4 + 3];
      if (a > 0) for (let c = 0; c < 3; c += 1) out[o + c] = byte(acc[dx * 4 + c] / a);
      out[o + 3] = byte(a);
    }
  }
  return { width: dw, height: dh, data: out };
}

// ---- encodeJpeg: baseline (SOF0) JPEG, 4:4:4 --------------------------------------------------------------

// ITU-T T.81 Annex K, Tables K.1 and K.2 — quantisation tables in natural (row-major) order.
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
];

// ZIGZAG[k] = natural index of the k-th coefficient in zig-zag order: anti-diagonals, alternating direction.
const ZIGZAG = (() => {
  const order = [];
  for (let s = 0; s < 15; s += 1) {
    const rows = [];
    for (let r = Math.max(0, s - 7); r <= Math.min(s, 7); r += 1) rows.push(r);
    if (s % 2 === 0) rows.reverse();
    for (const r of rows) order.push(r * 8 + (s - r));
  }
  return order;
})();

// Annex K, Tables K.3–K.6 — the standard Huffman tables: code counts per length 1..16, then the symbols.
// The AC tables list their codes of length ≤ 15 explicitly; the 16-bit codes are every remaining symbol in
// ascending order (DC tables: the 12 size categories in order).
const DC_SYMBOLS = Array.from({ length: 12 }, (_, i) => i);
const AC_SYMBOLS = [0x00, 0xf0];
for (let run = 0; run < 16; run += 1) for (let size = 1; size <= 10; size += 1) AC_SYMBOLS.push((run << 4) | size);
const acTable = (bits, short) => ({ bits, values: [...short, ...AC_SYMBOLS.filter((s) => !short.includes(s)).sort((a, b) => a - b)] });
const HUFFMAN = {
  dcLuma: { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], values: DC_SYMBOLS },
  dcChroma: { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], values: DC_SYMBOLS },
  acLuma: acTable([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82,
  ]),
  acChroma: acTable([0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1,
  ]),
};

// Canonical code assignment (Annex C): symbol → [code, length].
function huffmanCodes({ bits, values }) {
  const codes = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < bits[len - 1]; i += 1) codes.set(values[k++], [code++, len]);
    code <<= 1;
  }
  return codes;
}
const CODES = Object.fromEntries(Object.entries(HUFFMAN).map(([name, t]) => [name, huffmanCodes(t)]));

/** The quality formula: an Annex K table scaled by 5000/q below 50, 200−2q from 50; entries clamped to 1..255. */
function scaleQuant(table, quality) {
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - 2 * quality;
  return table.map((q) => Math.min(255, Math.max(1, Math.floor((q * scale + 50) / 100))));
}

// DCT_MATRIX[u*8+x] = C(u)/2 · cos((2x+1)uπ/16): F = M · f · Mᵀ is the 2-D forward DCT of T.81 A.3.3.
const DCT_MATRIX = (() => {
  const m = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) for (let x = 0; x < 8; x += 1) m[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return m;
})();

const FDCT_ROWS = new Float64Array(64);
function fdct(block, out) {
  const tmp = FDCT_ROWS;
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let x = 0; x < 8; x += 1) s += block[y * 8 + x] * DCT_MATRIX[u * 8 + x];
      tmp[y * 8 + u] = s;
    }
  }
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let s = 0;
      for (let y = 0; y < 8; y += 1) s += DCT_MATRIX[v * 8 + y] * tmp[y * 8 + u];
      out[v * 8 + u] = s;
    }
  }
}

class ByteWriter {
  constructor(capacity) { this.buf = Buffer.alloc(capacity); this.length = 0; this.acc = 0; this.bits = 0; }

  byte(b) {
    if (this.length === this.buf.length) { const grown = Buffer.alloc(this.buf.length * 2); this.buf.copy(grown); this.buf = grown; }
    this.buf[this.length++] = b;
  }

  bytes(list) { for (const b of list) this.byte(b); }

  u16(n) { this.byte(n >> 8); this.byte(n & 0xff); }

  segment(marker, payload) { this.u16(0xff00 | marker); this.u16(payload.length + 2); this.bytes(payload); }

  // Entropy-coded bits, most significant first; a 0xFF byte is followed by a stuffed 0x00.
  bitsOut(value, length) {
    this.acc = (this.acc << length) | (value & ((1 << length) - 1));
    this.bits += length;
    while (this.bits >= 8) {
      const b = (this.acc >> (this.bits - 8)) & 0xff;
      this.byte(b);
      if (b === 0xff) this.byte(0);
      this.bits -= 8;
    }
    this.acc &= (1 << this.bits) - 1;
  }

  // Pads the last byte with 1-bits (T.81 F.1.2.3).
  flushBits() { if (this.bits > 0) this.bitsOut((1 << (8 - this.bits)) - 1, 8 - this.bits); }
}

const bitLength = (n) => (n === 0 ? 0 : 32 - Math.clz32(n));
const roundHalfAway = (v) => (v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5));

/**
 * Encodes an RGBA image as a baseline JPEG (SOF0, 8-bit, YCbCr 4:4:4, standard Huffman tables). Alpha is
 * composited on white. Deterministic: the same pixels and quality give the same bytes.
 */
export function encodeJpeg({ width, height, data }, quality = INSPECT_QUALITY) {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new RangeError(`encodeJpeg: quality must be an integer 1..100, got ${quality}`);
  if (!positiveInt(width) || !positiveInt(height) || width > 65535 || height > 65535) throw new RangeError(`encodeJpeg: size must be 1..65535, got ${width}×${height}`);
  if (data.length !== width * height * 4) throw new RangeError(`encodeJpeg: ${width}×${height} RGBA needs ${width * height * 4} bytes, got ${data.length}`);
  const quant = [scaleQuant(LUMA_QUANT, quality), scaleQuant(CHROMA_QUANT, quality)];
  const w = new ByteWriter(Math.max(4096, width * height));

  w.u16(0xffd8); // SOI
  w.segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // APP0: JFIF 1.01, aspect 1:1, no thumbnail
  w.segment(0xdb, [0, ...ZIGZAG.map((i) => quant[0][i]), 1, ...ZIGZAG.map((i) => quant[1][i])]); // DQT: tables 0 and 1
  w.segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]); // SOF0
  const dht = [];
  for (const [id, t] of [[0x00, HUFFMAN.dcLuma], [0x10, HUFFMAN.acLuma], [0x01, HUFFMAN.dcChroma], [0x11, HUFFMAN.acChroma]]) dht.push(id, ...t.bits, ...t.values);
  w.segment(0xc4, dht);
  w.segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]); // SOS: Y → tables 0/0, Cb and Cr → 1/1; full spectrum

  const components = [
    { quant: quant[0], dc: CODES.dcLuma, ac: CODES.acLuma, pred: 0, block: new Float64Array(64) },
    { quant: quant[1], dc: CODES.dcChroma, ac: CODES.acChroma, pred: 0, block: new Float64Array(64) },
    { quant: quant[1], dc: CODES.dcChroma, ac: CODES.acChroma, pred: 0, block: new Float64Array(64) },
  ];
  const coef = new Float64Array(64);
  const zz = new Int32Array(64);
  const huff = (codes, symbol) => { const [code, len] = codes.get(symbol); w.bitsOut(code, len); };
  const magnitude = (v, size) => w.bitsOut(v < 0 ? v - 1 : v, size); // T.81 F.1.2.1: negatives as v − 1, low bits

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      // Colour conversion (JFIF YCbCr, level-shifted by −128); a partial block repeats its last row/column.
      for (let y = 0; y < 8; y += 1) {
        const py = Math.min(height - 1, by + y);
        for (let x = 0; x < 8; x += 1) {
          const i = (py * width + Math.min(width - 1, bx + x)) * 4;
          const a = data[i + 3] / 255;
          const r = data[i] * a + 255 * (1 - a);
          const g = data[i + 1] * a + 255 * (1 - a);
          const b = data[i + 2] * a + 255 * (1 - a);
          const k = y * 8 + x;
          components[0].block[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          components[1].block[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          components[2].block[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (const c of components) {
        fdct(c.block, coef);
        for (let k = 0; k < 64; k += 1) zz[k] = roundHalfAway(coef[ZIGZAG[k]] / c.quant[ZIGZAG[k]]);
        // Baseline ranges: DC within 11 bits, AC within 10 (only reachable through rounding at q100).
        const dc = Math.max(-2047, Math.min(2047, zz[0]));
        const diff = dc - c.pred;
        c.pred = dc;
        const dcSize = bitLength(Math.abs(diff));
        huff(c.dc, dcSize);
        if (dcSize) magnitude(diff, dcSize);
        let run = 0;
        for (let k = 1; k < 64; k += 1) {
          const v = Math.max(-1023, Math.min(1023, zz[k]));
          if (v === 0) { run += 1; continue; }
          while (run >= 16) { huff(c.ac, 0xf0); run -= 16; } // ZRL: sixteen zeros
          const size = bitLength(Math.abs(v));
          huff(c.ac, (run << 4) | size);
          magnitude(v, size);
          run = 0;
        }
        if (run > 0) huff(c.ac, 0x00); // EOB
      }
    }
  }
  w.flushBits();
  w.u16(0xffd9); // EOI
  return Buffer.from(w.buf.subarray(0, w.length));
}

/** Fits an RGBA image within max (area average), then encodes it: { width, height, jpeg }. */
export function toInspectionJpeg(img, { max = INSPECT_MAX, quality = INSPECT_QUALITY } = {}) {
  const size = fitWithin(img.width, img.height, max);
  const small = downscale(img, size);
  return { width: size.width, height: size.height, jpeg: encodeJpeg(small, quality) };
}

// ---- CLI --------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class CliError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
const usage = (msg) => new CliError(`${msg}\n\n${HELP}`, 2);

function parseArgs(rest) {
  const pos = [];
  const opts = { out: null, max: INSPECT_MAX, quality: INSPECT_QUALITY };
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw usage(`${flag} needs a value`); return rest[i + 1]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = need(i, a); i += 1; }
    else if (a === '--max') {
      const m = need(i, a).match(/^(\d+)[x×](\d+)$/);
      if (!m || !positiveInt(Number(m[1])) || !positiveInt(Number(m[2]))) throw usage(`--max wants <W>x<H> in px, got "${rest[i + 1]}"`);
      opts.max = { width: Number(m[1]), height: Number(m[2]) };
      i += 1;
    }
    else if (a === '--quality') {
      const q = Number(need(i, a));
      if (!Number.isInteger(q) || q < 1 || q > 100) throw usage(`--quality wants an integer 1..100, got "${rest[i + 1]}"`);
      opts.quality = q;
      i += 1;
    }
    else if (a.startsWith('--')) throw usage(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 1) throw usage(`need exactly one <in.png>, got ${pos.length}`);
  [opts.input] = pos;
  opts.out = opts.out ?? inspectionCopyPath(opts.input);
  if (!/^\.jpe?g$/i.test(extname(opts.out))) throw usage(`--out must end in .jpg or .jpeg (the PNG is a measurement input — never overwrite it), got ${opts.out}`);
  if (resolve(opts.out) === resolve(opts.input)) throw usage('--out is the input itself');
  return opts;
}

async function main(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); return 0; }
  const opts = parseArgs(rest);
  let buf;
  try { buf = readFileSync(opts.input); } catch (e) { throw new CliError(`cannot read ${opts.input}: ${e.code || e.message}`, 1); }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new CliError(`${opts.input} is not a PNG (no PNG signature)`, 1);
  let PNG;
  try { ({ PNG } = await import('pngjs')); }
  catch { throw new CliError(`pngjs is not importable from this script's location — from the project root: ${INSTALL_LINE} (replica/SKILL.md § Setup)`, 1); }
  let img;
  try { img = PNG.sync.read(buf); } catch (e) { throw new CliError(`${opts.input} is not a readable PNG: ${e.message}`, 1); }
  const { width, height, jpeg } = toInspectionJpeg(img, { max: opts.max, quality: opts.quality });
  mkdirSync(dirname(opts.out) || '.', { recursive: true });
  writeFileSync(opts.out, jpeg);
  console.log(`inspect-image: ${opts.input} ${img.width}×${img.height} → ${opts.out} ${width}×${height} q${opts.quality} (${Math.ceil(jpeg.length / 1024)} KB)`);
  return 0;
}

// Main-module guard by REAL path: node resolves the entry's symlinks for import.meta.url but leaves process.argv[1]
// as typed, so a symlinked checkout or temp dir would otherwise make the CLI a silent no-op.
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  main(process.argv).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`inspect-image error: ${e.message}`);
    process.exitCode = e instanceof CliError ? e.code : 1;
  });
}

