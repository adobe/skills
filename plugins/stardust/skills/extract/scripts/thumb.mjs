#!/usr/bin/env node
/**
 * skills/extract/scripts/thumb.mjs
 *
 * Whole-page thumbnails of the captured full-page screenshots
 * (`stardust/current/assets/screenshots/<slug>.png` — 1440 px wide, often
 * 5000–6500 px tall) for the extract brand reads: the one-image gestalt view
 * of a page at a size a multimodal model can actually take in. Box-filter
 * (area-average) downscale — every source pixel feeds exactly one output
 * pixel's mean — so a 1-px rule or hairline border at 3× survives as a
 * ~1/3-intensity line. Nearest-neighbour sampling (what gets hand-rolled when
 * no image tool is present; recorded at two turns per run) keeps one source
 * row in three and drops the rest — exactly the thin motifs a brand read is
 * looking for. Details are read as crops of the full capture, never from the
 * thumbnail.
 *
 * Usage:
 *   node skills/extract/scripts/thumb.mjs <png|dir…> [options]
 *     --width <px>       thumbnail width; a narrower source is not upscaled (default 480)
 *     --max-height <px>  cap on the thumbnail height. The SOURCE is cropped at
 *                        max-height × (source width / --width) rows first, so the
 *                        output is at most this tall; a crop is noted on the
 *                        stdout line                                     (default 3200)
 *     --out <dir>        where the thumbnails go, created if missing
 *                                          (default: each source's own directory)
 *     --suffix <s>       appended to the source basename                 (default -thumb)
 *     --help, -h         this header
 *
 *   A directory argument stands for the PNG files in it (sorted; files already
 *   carrying --suffix are skipped, so a re-run over the screenshots directory
 *   never thumbnails its own output). Any pngjs colour type is accepted — the
 *   decoder yields 8-bit RGBA. One line per file on stdout:
 *     <src>: <W>x<H> -> <w>x<h>[ (cropped at <n>px of <H>)] -> <dst>
 *
 * Example (every page capture at once, then read the thumbnails):
 *   node stardust/scripts/thumb.mjs stardust/current/assets/screenshots --width 480
 *
 * Writes:
 *   <out>/<basename><suffix>.png   one per input (default <out> = the source's directory)
 *   Nothing else. A source is never overwritten: an output path equal to its
 *   input (e.g. --suffix '' without --out) is refused before anything is written.
 *
 * Requires: pngjs (project devDependency — the same one the replica scripts
 * use; run the project copy, as Setup does for crawl.mjs). --help needs nothing.
 * Exit codes: 0 ok · 1 an input failed to read or write (named on stderr; the
 * others are still written) · 2 usage (no inputs, bad flag, an output that
 * would overwrite an input or collide with another output).
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
const IS_MAIN = Boolean(process.argv[1]) && SELF === safeRealpath(process.argv[1]);

export const DEFAULTS = { width: 480, maxHeight: 3200, suffix: '-thumb', out: null };
const SYNOPSIS = 'usage: node thumb.mjs <png|dir…> [--width 480] [--max-height 3200] [--out <dir>] [--suffix -thumb]  (--help for the full header)';

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
const usageHeader = () => {
  const header = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
};

// pngjs is loaded here, after --help and argument checks, so those answer the same in a checkout
// that lacks the module (the plugin tree ships no node_modules — see Setup on running project copies).
async function loadPng() {
  try { return (await import('pngjs')).PNG; } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    throw new Error(`${e.message.split('\n')[0]} — pngjs is a project devDependency; copy this script into the project (stardust/scripts/thumb.mjs, beside crawl.mjs) and run that copy`);
  }
}

// ---- pure helpers (exported for tests) ---------------------------------------------------------

// Area-average bins: n source samples onto m output bins (m ≤ n). Each bin lists its
// [sourceIndex, weight] pairs, weights summing to 1 and fractional at the seams when n/m is not an
// integer — the exact box filter. Every source index lands in some bin; a stride sampler skips most.
export function binWeights(n, m) {
  const scale = n / m;
  const bins = [];
  for (let o = 0; o < m; o += 1) {
    const start = o * scale;
    const end = Math.min(n, (o + 1) * scale);
    const entries = [];
    for (let i = Math.floor(start); i < end; i += 1) {
      const w = Math.min(i + 1, end) - Math.max(i, start);
      if (w > 1e-9) entries.push([i, w / scale]);
    }
    bins.push(entries);
  }
  return bins;
}

// One thumbnail's geometry: output size and how many SOURCE rows feed it. Never upscales; the crop
// is taken in source rows, so `h` never exceeds maxHeight and the kept part is the page top.
export function planThumb(W, H, { width = DEFAULTS.width, maxHeight = DEFAULTS.maxHeight } = {}) {
  const w = Math.min(W, width);
  const scale = W / w;
  const rows = Math.min(H, Math.floor(maxHeight * scale));
  const h = Math.max(1, Math.min(maxHeight, Math.round(rows / scale)));
  return { w, h, rows, cropped: rows < H };
}

// Box-filter downscale of the top `rows` rows of an RGBA buffer `W` wide to w×h. Separable: each
// output row accumulates its weighted source rows once, then that row is reduced across x. Straight
// (un-premultiplied) averaging on all four channels — page captures are opaque.
export function boxDownscale(src, W, rows, w, h) {
  const xb = binWeights(W, w);
  const yb = binWeights(rows, h);
  const out = Buffer.alloc(w * h * 4);
  const acc = new Float64Array(W * 4);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let oy = 0; oy < h; oy += 1) {
    acc.fill(0);
    for (const [sy, wy] of yb[oy]) {
      const base = sy * W * 4;
      for (let i = 0; i < acc.length; i += 1) acc[i] += src[base + i] * wy;
    }
    for (let ox = 0; ox < w; ox += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const [sx, wx] of xb[ox]) { const i = sx * 4; r += acc[i] * wx; g += acc[i + 1] * wx; b += acc[i + 2] * wx; a += acc[i + 3] * wx; }
      const o = (oy * w + ox) * 4;
      out[o] = clamp(r); out[o + 1] = clamp(g); out[o + 2] = clamp(b); out[o + 3] = clamp(a);
    }
  }
  return out;
}

export const thumbPath = (src, { out = null, suffix = DEFAULTS.suffix } = {}) => join(out || dirname(src), `${basename(src, extname(src))}${suffix}.png`);

// A directory stands for its PNG files (sorted); files already carrying the suffix are skipped so a
// re-run over the screenshots directory never thumbnails its own output. Anything else is taken as
// a file and, if it is not a readable PNG, fails at read time — named on stderr, exit 1.
export function expandInputs(paths, suffix, warn = () => {}) {
  const files = [];
  for (const p of paths) {
    let isDir = false;
    try { isDir = statSync(p).isDirectory(); } catch { /* absent: the read fails later and names it */ }
    if (!isDir) { files.push(p); continue; }
    const all = readdirSync(p).filter((f) => /\.png$/i.test(f)).sort();
    const own = suffix ? all.filter((f) => f.toLowerCase().endsWith(`${suffix}.png`.toLowerCase())) : [];
    const take = all.filter((f) => !own.includes(f));
    if (!take.length) warn(`no *.png in ${p}`);
    else if (own.length) warn(`${p}: skipped ${own.length} existing *${suffix}.png`);
    files.push(...take.map((f) => join(p, f)));
  }
  return files;
}

// ---- argv --------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = () => { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); i += 1; return argv[i]; };
    const int = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new UsageError(`${a} needs a positive integer, got "${v}"`); return n; };
    if (a === '--width') opts.width = int(need());
    else if (a === '--max-height') opts.maxHeight = int(need());
    else if (a === '--out') opts.out = need();
    else if (a === '--suffix') opts.suffix = need();
    else if (a.startsWith('-') && a !== '-') throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  if (!pos.length) throw new UsageError('no inputs — give one or more PNG files or a directory of them');
  return { opts, pos };
}

// ---- main --------------------------------------------------------------------------------------
// Real directory + basename: the overwrite/collision checks see through a symlinked --out or source
// directory even though the output file does not exist yet.
const realKey = (p) => join(safeRealpath(dirname(resolve(p))), basename(p));

export async function main(argv, { log = console.log, warn = console.error } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(usageHeader()); return 0; }
  const { opts, pos } = parseArgs(argv);
  const inputs = expandInputs(pos, opts.suffix, (m) => warn(`thumb: ${m}`));
  if (!inputs.length) throw new UsageError('no PNG inputs found');

  // Every output path is planned first: one that equals its input, or two inputs sharing one
  // output, is refused before anything is written.
  const jobs = inputs.map((src) => ({ src, dst: thumbPath(src, opts) }));
  const taken = new Map();
  for (const { src, dst } of jobs) {
    const key = realKey(dst);
    if (key === realKey(src)) throw new UsageError(`${dst} would overwrite its input — pass --out <dir> or a non-empty --suffix`);
    if (taken.has(key)) throw new UsageError(`${src} and ${taken.get(key)} both map to ${dst} — run them with one --out per source directory`);
    taken.set(key, src);
  }

  const PNG = await loadPng();
  let failed = 0;
  for (const { src, dst } of jobs) {
    try {
      const png = PNG.sync.read(readFileSync(src));
      const { w, h, rows, cropped } = planThumb(png.width, png.height, opts);
      const thumb = new PNG({ width: w, height: h });
      thumb.data = boxDownscale(png.data, png.width, rows, w, h);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, PNG.sync.write(thumb));
      log(`${src}: ${png.width}x${png.height} -> ${w}x${h}${cropped ? ` (cropped at ${rows}px of ${png.height})` : ''} -> ${dst}`);
    } catch (e) {
      failed += 1;
      warn(`thumb: ${src}: ${e.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (IS_MAIN) {
  // process.exitCode, not process.exit(): let stdout drain after the synchronous decode/encode work.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    const usage = e instanceof UsageError;
    console.error(`thumb: ${e.message}${usage ? `\n${SYNOPSIS}` : ''}`);
    process.exitCode = usage ? e.code : 1;
  });
}
