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
 *     --max-height <px>  upper bound on the thumbnail height. The SOURCE is cropped at
 *                        max-height × (source width / width) rows, so the output is at
 *                        most this tall; the stdout line notes the crop and the kept
 *                        share of the page                                   (default 3200)
 *     --max-bytes <n>    cap on the thumbnail's PNG size in bytes — every thumbnail is
 *                        read into a model context (a recorded hands-off run read eight
 *                        of 268–608 KB, 3.2 MB, into one context). A thumbnail over the
 *                        cap is re-encoded, in this order, until one fits:
 *                          1. narrower: the WHOLE page again at each width step below
 *                             --width (480 → 400 → 320 → 240);
 *                          2. shorter, at the narrowest step only: the largest height
 *                             under the cap, found by bisection on the MEASURED encoded
 *                             size (PNG size is not linear in rows — a byte-ratio guess
 *                             overshoots by an order of magnitude), never below the
 *                             --min-share floor: the vision check reads the whole page
 *                             through the thumbnail, and a hero strip is not the page (a
 *                             recorded run kept a median 28 % of each page);
 *                          3. still over at the floor: the floor thumbnail is written
 *                             anyway, named on stderr, exit 1 — raise --max-bytes or
 *                             lower --min-share for that page.                (default 150000)
 *     --min-share <pct>  the least share of the page (of the rows from --offset down) a
 *                        cap-driven crop keeps, in percent, 1–100                (default 60)
 *     --offset <px>      first SOURCE row of the thumbnail — the slice below a crop. The
 *                        output name gains -<offset>, so the first thumbnail stays  (default 0)
 *     --out <dir>        where the thumbnails go, created if missing
 *                                          (default: each source's own directory)
 *     --suffix <s>       appended to the source basename                 (default -thumb)
 *     --help, -h         this header
 *
 *   A directory argument stands for the PNG files in it (sorted; files already
 *   carrying --suffix — or --suffix-<offset>, a slice — are skipped, so a re-run
 *   over the screenshots directory never thumbnails its own output). Any pngjs
 *   colour type is accepted — the decoder yields 8-bit RGBA. One line per file on
 *   stdout:
 *     <src>: <W>x<H> -> <w>x<h> [scaled to <w>px] [(cropped at <n>px of <H> = <share>%)] [for --max-bytes <b>] -> <dst> (<bytes> bytes)
 *   `scaled to` says the width stepped down for the cap; `cropped at <n>px` is the
 *   first source row NOT in the thumbnail and `<share>` the kept percent of the page
 *   (floored — a crop never reads 100): the rest of the page is one more call away,
 *   `--offset <n>`, whose line notes `(rows <offset>-<end>px of <H> = <share>%)`
 *   instead; `for --max-bytes` says the cap drove the scale or the crop.
 *
 * Example (every page capture at once, then read the thumbnails):
 *   node stardust/scripts/thumb.mjs stardust/current/assets/screenshots --width 480
 *   node stardust/scripts/thumb.mjs stardust/current/assets/screenshots/home.png --offset 2270
 *     — the rest of a page whose line read `cropped at 2270px of 3782 = 60%`; writes home-thumb-2270.png
 *
 * Writes:
 *   <out>/<basename><suffix>[-<offset>].png   one per input (default <out> = the source's directory)
 *   Nothing else. A source is never overwritten: an output path equal to its
 *   input (e.g. --suffix '' without --out) is refused before anything is written.
 *
 * Requires: pngjs (project devDependency — the same one the replica scripts
 * use; run the project copy, as Setup does for crawl.mjs, or point NODE_PATH at
 * the project's node_modules). --help needs nothing.
 * Exit codes: 0 ok · 1 an input failed to read or write, or --offset is past its
 * last row (named on stderr; the others are still written), or a thumbnail still
 * over --max-bytes at the narrowest width and the height floor — or --max-height,
 * when that is at or under the floor (written anyway, named on stderr) · 2 usage (no inputs, bad flag, a value flag followed by
 * nothing or by another --flag — named, never swallowed — or an output that would
 * overwrite an input or collide with another output).
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
const IS_MAIN = Boolean(process.argv[1]) && SELF === safeRealpath(process.argv[1]);

export const DEFAULTS = { width: 480, maxHeight: 3200, maxBytes: 150000, minShare: 60, offset: 0, suffix: '-thumb', out: null };
// The widths a thumbnail over --max-bytes is retried at (narrowest last); --width itself comes first.
export const WIDTH_STEPS = [480, 400, 320, 240];
const SYNOPSIS = 'usage: node thumb.mjs <png|dir…> [--width 480] [--max-height 3200] [--max-bytes 150000] [--min-share 60] [--offset 0] [--out <dir>] [--suffix -thumb]  (--help for the full header)';

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
const usageHeader = () => {
  const header = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
};

// pngjs is loaded here, after --help and argument checks, so those answer the same in a checkout
// that lacks the module (the plugin tree ships no node_modules — see Setup on running project copies).
// ESM resolution ignores NODE_PATH; CommonJS resolution honours it, so a checkout without a
// node_modules of its own can point NODE_PATH at a project's install (the test runs that way).
async function loadPng() {
  try { return (await import('pngjs')).PNG; } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    try { return createRequire(import.meta.url)('pngjs').PNG; } catch (e2) { if (e2.code !== 'MODULE_NOT_FOUND') throw e2; }
    throw new Error(`${e.message.split('\n')[0]} — pngjs is a project devDependency; copy this script into the project (stardust/scripts/thumb.mjs, beside crawl.mjs) and run that copy, or set NODE_PATH=<project>/node_modules`);
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

// One thumbnail's geometry: output size and which SOURCE rows feed it — `rows` rows from `start`
// (= offset, which the caller keeps below H). Never upscales; the crop is taken in source rows, so
// `h` never exceeds maxHeight and the kept part starts at the offset.
export function planThumb(W, H, { width = DEFAULTS.width, maxHeight = DEFAULTS.maxHeight, offset = 0 } = {}) {
  const w = Math.min(W, width);
  const scale = W / w;
  const start = offset;
  const rows = Math.min(H - start, Math.floor(maxHeight * scale));
  const h = Math.max(1, Math.min(maxHeight, Math.round(rows / scale)));
  return { w, h, rows, start, cropped: rows < H };
}

// The kept share of the page as the integer percent the line prints — floored, so anything short
// of the whole page never reads 100.
export const cropShare = (rows, H) => Math.floor((rows * 100) / H);

// The widths a thumbnail over --max-bytes is retried at: --width first, then each standard step below it.
export const widthLadder = (width) => [width, ...WIDTH_STEPS.filter((s) => s < width)];

// The lowest --max-height a cap-driven crop may go to: the smallest thumbnail height whose plan keeps
// at least minShare % of the rows from `offset` down (in source rows — floor(h × scale) of them).
export function floorHeight(W, H, { width = DEFAULTS.width, offset = 0, minShare = DEFAULTS.minShare } = {}) {
  const scale = W / Math.min(W, width);
  const need = Math.ceil(((H - offset) * minShare) / 100);
  let h = Math.max(1, Math.ceil(need / scale));
  while (Math.floor(h * scale) < need) h += 1; // the float seam of ceil(need / scale)
  return h;
}

// Fit a thumbnail under maxBytes — the three levers the usage header describes (narrower, then
// shorter by bisection down to the --min-share floor, then the floor itself with `unmet` set).
// `encode(plan)` returns the PNG bytes (anything with `.length`), so the search is pure.
export function fitToCap(W, H, opts, encode) {
  const { width = DEFAULTS.width, maxHeight = DEFAULTS.maxHeight, maxBytes = DEFAULTS.maxBytes, minShare = DEFAULTS.minShare, offset = 0 } = opts;
  const at = (w, mh) => { const plan = planThumb(W, H, { width: w, maxHeight: mh, offset }); return { plan, out: encode(plan) }; };
  const fits = (r) => r.out.length <= maxBytes;
  let best = at(width, maxHeight);
  if (fits(best)) return { ...best, scaled: false, forCap: false, unmet: false };
  // (a) narrower first — the vision check reads the whole page through the thumbnail.
  for (const step of widthLadder(width).slice(1)) {
    if (Math.min(W, step) >= best.plan.w) continue; // the source is narrower than this step: same geometry
    best = at(step, maxHeight);
    if (fits(best)) return { ...best, scaled: true, forCap: true, unmet: false };
  }
  const scaled = best.plan.w < Math.min(W, width);
  // (b) shorter, never below the floor — and only by measuring: PNG size is not linear in rows.
  const { w, h: hFull } = best.plan;
  const hFloor = Math.min(hFull, floorHeight(W, H, { width: w, offset, minShare }));
  if (hFloor >= hFull) return { ...best, scaled, forCap: true, unmet: true }; // --max-height already at or under the floor
  let lo = at(w, hFloor);
  if (!fits(lo)) return { ...lo, scaled, forCap: true, unmet: true }; // (c) the floor is over: written anyway, exit 1
  let loH = hFloor; let hi = hFull; // lo fits; hi was measured over the cap
  while (hi - loH > 1) {
    const mid = Math.floor((loH + hi) / 2);
    const r = at(w, mid);
    if (fits(r)) { lo = r; loH = mid; } else hi = mid;
  }
  return { ...lo, scaled, forCap: true, unmet: false };
}

// The stdout line's middle: `<w>x<h> [scaled to <w>px] [(cropped at <n>px of <H> = <share>%)] [for
// --max-bytes <b>]`; a slice (--offset) notes `(rows <start>-<end>px of <H> = <share>%)` instead.
export function thumbNote(plan, H, { scaled = false, forCap = false, maxBytes = DEFAULTS.maxBytes } = {}) {
  const { w, h, rows, start } = plan;
  const parts = [`${w}x${h}`];
  if (scaled) parts.push(`scaled to ${w}px`);
  if (rows < H) parts.push(start > 0 ? `(rows ${start}-${start + rows}px of ${H} = ${cropShare(rows, H)}%)` : `(cropped at ${rows}px of ${H} = ${cropShare(rows, H)}%)`);
  if (forCap) parts.push(`for --max-bytes ${maxBytes}`);
  return parts.join(' ');
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

// The PNG for a plan — its source rows (from `start`) box-downscaled to w×h, pngjs defaults: the
// bytes the cap measures and the file that is written.
export function encodeThumb(PNG, png, plan) {
  const t = new PNG({ width: plan.w, height: plan.h });
  t.data = boxDownscale(png.data.subarray(plan.start * png.width * 4), png.width, plan.rows, plan.w, plan.h);
  return PNG.sync.write(t);
}

export const thumbPath = (src, { out = null, suffix = DEFAULTS.suffix, offset = 0 } = {}) => join(out || dirname(src), `${basename(src, extname(src))}${suffix}${offset > 0 ? `-${offset}` : ''}.png`);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A directory stands for its PNG files (sorted); files already carrying the suffix — or the suffix
// plus a slice's -<offset> — are skipped so a re-run over the screenshots directory never thumbnails
// its own output. Anything else is taken as a file and, if it is not a readable PNG, fails at read
// time — named on stderr, exit 1.
export function expandInputs(paths, suffix, warn = () => {}) {
  const files = [];
  const ownRe = suffix ? new RegExp(`${escapeRe(suffix)}(?:-\\d+)?\\.png$`, 'i') : null;
  for (const p of paths) {
    let isDir = false;
    try { isDir = statSync(p).isDirectory(); } catch { /* absent: the read fails later and names it */ }
    if (!isDir) { files.push(p); continue; }
    const all = readdirSync(p).filter((f) => /\.png$/i.test(f)).sort();
    const own = ownRe ? all.filter((f) => ownRe.test(f)) : [];
    const take = all.filter((f) => !own.includes(f));
    if (!take.length) warn(`no *.png in ${p}`);
    else if (own.length) warn(`${p}: skipped ${own.length} existing *${suffix}*.png`);
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
    // A value flag followed by nothing or by another --flag is a usage error naming the flag (a
    // single-dash value like `--suffix -720` stays a value).
    const need = () => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`); i += 1; return argv[i]; };
    const int = (v, { min = 1, max = Infinity, what = 'a positive integer' } = {}) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${a} needs ${what}, got "${v}"`); return n; };
    if (a === '--width') opts.width = int(need());
    else if (a === '--max-height') opts.maxHeight = int(need());
    else if (a === '--max-bytes') opts.maxBytes = int(need());
    else if (a === '--min-share') opts.minShare = int(need(), { max: 100, what: 'a percent from 1 to 100' });
    else if (a === '--offset') opts.offset = int(need(), { min: 0, what: 'a source row (a non-negative integer)' });
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
      if (opts.offset >= png.height) throw new Error(`--offset ${opts.offset} is past the last row of a ${png.width}x${png.height} page`);
      const fit = fitToCap(png.width, png.height, opts, (plan) => encodeThumb(PNG, png, plan));
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, fit.out);
      log(`${src}: ${png.width}x${png.height} -> ${thumbNote(fit.plan, png.height, { ...fit, maxBytes: opts.maxBytes })} -> ${dst} (${fit.out.length} bytes)`);
      if (fit.unmet) {
        failed += 1;
        const { w, h, rows } = fit.plan;
        // What bounded the height: the --min-share floor, or an explicit --max-height already at or under it.
        const atFloor = h >= floorHeight(png.width, png.height, { width: w, offset: opts.offset, minShare: opts.minShare });
        const bound = atFloor ? 'the height floor' : `--max-height ${opts.maxHeight ?? DEFAULTS.maxHeight}`;
        warn(`thumb: ${dst}: ${fit.out.length} bytes at ${w}x${h} (${cropShare(rows, png.height)}% of the page — the narrowest width and ${bound}) still exceeds --max-bytes ${opts.maxBytes}; written anyway — raise --max-bytes${atFloor ? ' or lower --min-share' : ''} for this page`);
      }
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
