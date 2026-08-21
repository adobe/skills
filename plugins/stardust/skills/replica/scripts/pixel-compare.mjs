#!/usr/bin/env node
/**
 * skills/replica/scripts/pixel-compare.mjs
 *
 * Pixel gate for the stardust:replica source-fidelity loop: pixelmatch over
 * two STITCHED full-page PNGs (produced by stitch-shot.mjs — never fullPage
 * captures, see that tool's header). Compares the overlapping region, reports
 * the height delta separately, and emits a per-band breakdown.
 *
 * The band breakdown is the navigation instrument, not decoration: the
 * overall % hides WHERE drift starts. The first hot band points at the
 * section whose height/geometry is wrong; every band below it is contaminated
 * by vertical offset and must be re-read after that section is fixed. Fix
 * top-down, one hot band at a time, re-capture, re-compare.
 *
 * Usage:
 *   node skills/replica/scripts/pixel-compare.mjs <a.png> <b.png> [options]
 *     --out <diff.png>     diff image path            (default diff.png)
 *     --threshold <pct>    pass bar; exit 2 above it  (default 10)
 *     --band <px>          band height for breakdown  (default 500)
 *     --pm-threshold <n>   pixelmatch per-pixel color threshold (default 0.1)
 *     --json               emit machine-readable summary on stdout
 *
 * Example:
 *   node skills/replica/scripts/pixel-compare.mjs \
 *     stardust/replica/gates/home-1440/live.png \
 *     stardust/replica/gates/home-1440/proto.png \
 *     --out stardust/replica/gates/home-1440/diff.png
 *
 * Requires: pixelmatch, pngjs (project devDependencies).
 * Exit codes: 0 under threshold, 1 error, 2 over threshold (gate FAIL).
 * Note: the height delta does NOT affect the exit code — the SKILL gate
 * requires height Δ ≈ 0 separately; a large delta is printed as a warning
 * because the overlap-crop can make the % look artificially healthy.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const HELP = `pixel-compare — pixelmatch two stitched full-page PNGs with per-band breakdown

Usage: node pixel-compare.mjs <a.png> <b.png> [options]
  --out <diff.png>    diff image path (default diff.png)
  --threshold <pct>   pass bar as percent; exit 2 above it (default 10)
  --band <px>         band height for the breakdown (default 500)
  --pm-threshold <n>  pixelmatch per-pixel color threshold (default 0.1)
  --json              machine-readable summary on stdout
  --help              this text

Convention: <a.png> = live/source capture, <b.png> = prototype capture.`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { out: 'diff.png', threshold: 10, band: 500, pmThreshold: 0.1, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--threshold') { opts.threshold = Number(rest[i += 1]); }
    else if (a === '--band') { opts.band = Number(rest[i += 1]); }
    else if (a === '--pm-threshold') { opts.pmThreshold = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [aPath, bPath] = pos;
  if (!aPath || !bPath) { console.error(`need <a.png> and <b.png>\n\n${HELP}`); process.exit(1); }
  return { aPath, bPath, opts };
}

function cropTo(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) img.data.copy(o.data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
  return o;
}

function main() {
  const { aPath, bPath, opts } = parseArgs(process.argv);
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const heightDelta = a.height - b.height;

  const ca = cropTo(a, w, h);
  const cb = cropTo(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: opts.pmThreshold });
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, PNG.sync.write(diff));
  const pct = (100 * n) / (w * h);

  // Per-band breakdown: count pixelmatch's red diff pixels (anti-aliased
  // pixels are drawn yellow and are NOT counted — matches pixelmatch's own count).
  const bands = [];
  for (let y0 = 0; y0 < h; y0 += opts.band) {
    const hh = Math.min(opts.band, h - y0);
    let count = 0;
    for (let y = y0; y < y0 + hh; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        if (diff.data[i] === 255 && diff.data[i + 1] < 100) count += 1;
      }
    }
    bands.push({ y0, y1: y0 + hh, pct: (100 * count) / (w * hh) });
  }

  const pass = pct <= opts.threshold;
  if (opts.json) {
    console.log(JSON.stringify({ a: aPath, b: bPath, compared: { width: w, height: h }, heightDelta, differingPixels: n, pct: Number(pct.toFixed(2)), threshold: opts.threshold, pass, diff: opts.out, bands: bands.map((x) => ({ ...x, pct: Number(x.pct.toFixed(1)) })) }, null, 2));
  } else {
    console.log(`A ${a.width}x${a.height}  B ${b.width}x${b.height}  → compare ${w}x${h}, height delta ${heightDelta}px`);
    if (Math.abs(heightDelta) > 8) console.log(`  ⚠ height delta ${heightDelta}px — overlap-crop hides the tail; fix heights before trusting the %`);
    console.log(`differing pixels: ${n} / ${w * h} = ${pct.toFixed(2)}%  (threshold ${opts.threshold}%) → ${pass ? 'PASS' : 'FAIL'}`);
    console.log(`diff image: ${opts.out}`);
    for (const bd of bands) {
      console.log(`  y ${String(bd.y0).padStart(6)}–${bd.y1}: ${bd.pct.toFixed(1)}%${bd.pct > 15 ? '  ◄◄ hot band' : ''}`);
    }
  }
  process.exit(pass ? 0 : 2);
}

try { main(); } catch (e) { console.error(`pixel-compare error: ${e.message}`); process.exit(1); }
