#!/usr/bin/env node
/**
 * skills/replica/scripts/crop-compare.mjs
 *
 * Per-region crop gate for the stardust:replica source-fidelity loop and
 * deploy Step 10: pixelmatch a y-band of two stitched full-page captures
 * (produced by stitch-shot.mjs). Built for CHROME parity (#115): the
 * full-page bar (≤10%) dilutes the header/footer — they are a small share
 * of page pixels but carry disproportionate visual weight and repeat on
 * every page of a rollout. Two field runs shipped "green" pages whose
 * chrome measured only 93–97% match; cropped, the defects are unmissable.
 *
 * Usage:
 *   node skills/replica/scripts/crop-compare.mjs <a.png> <b.png> [options]
 *     --y <px>        band top in image A                    (default 0)
 *     --height <px>   band height (required; e.g. the nav height, or the
 *                     footer height with --y <docHeight-footerHeight>)
 *     --y-b <px>      band top in image B when the two sides carry a small
 *                     doc-height delta (default: --y). A ±1px offset delta
 *                     otherwise contaminates a footer crop with a false
 *                     full-band diff — align each side to ITS band first.
 *     --out <path>    diff PNG                               (default crop-diff.png)
 *     --threshold <pct>  pass bar; exit 2 above it           (default 2)
 *     --pm-threshold <n> pixelmatch per-pixel color threshold (default 0.1)
 *     --json          machine-readable summary on stdout
 *
 * Example (header band, then footer band with per-side offsets):
 *   node skills/replica/scripts/crop-compare.mjs live.png proto.png \
 *     --y 0 --height 120 --out gates/home-1440/chrome-header-diff.png
 *   node skills/replica/scripts/crop-compare.mjs live.png proto.png \
 *     --y 8840 --y-b 8846 --height 400 --out gates/home-1440/chrome-footer-diff.png
 *
 * Requires: pixelmatch, pngjs (project devDependencies — same as
 * pixel-compare.mjs). Exit codes: 0 under threshold, 1 error, 2 over
 * threshold (gate FAIL).
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const positional = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const t = process.argv[i];
  if (t.startsWith('--')) { if (t !== '--json') i += 1; continue; }
  positional.push(t);
}
const [fileA, fileB] = positional;
const y0 = Number(arg('y', 0));
const h = Number(arg('height', NaN));
const y1 = Number(arg('y-b', y0));
const out = arg('out', 'crop-diff.png');
const bar = Number(arg('threshold', 2));
const pmThreshold = Number(arg('pm-threshold', 0.1));
const asJson = process.argv.includes('--json');

if (!fileA || !fileB || Number.isNaN(h) || h <= 0) {
  console.error('usage: crop-compare.mjs <a.png> <b.png> --height <px> [--y <px>] [--y-b <px>] [--out diff.png] [--threshold pct]');
  process.exit(1);
}

let A;
let B;
try {
  A = PNG.sync.read(fs.readFileSync(fileA));
  B = PNG.sync.read(fs.readFileSync(fileB));
} catch (e) {
  console.error(`crop-compare error: ${e.message}`);
  process.exit(1);
}
const w = Math.min(A.width, B.width);
for (const [img, y, name] of [[A, y0, fileA], [B, y1, fileB]]) {
  if (y + h > img.height) {
    console.error(`crop-compare error: band y ${y}+${h} exceeds ${name} height ${img.height}`);
    process.exit(1);
  }
}

const crop = (img, y) => {
  const c = new PNG({ width: w, height: h });
  PNG.bitblt(img, c, 0, y, w, h, 0, 0);
  return c;
};
const ca = crop(A, y0);
const cb = crop(B, y1);
const diff = new PNG({ width: w, height: h });
const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: pmThreshold });
fs.writeFileSync(out, PNG.sync.write(diff));

const pct = (n / (w * h)) * 100;
const pass = pct <= bar;
if (asJson) {
  console.log(JSON.stringify({
    a: fileA, b: fileB, y: y0, yB: y1, height: h, width: w,
    diffPixels: n, diffPct: +pct.toFixed(2), matchPct: +(100 - pct).toFixed(2),
    threshold: bar, pass, diffImage: out,
  }));
} else {
  console.log(`crop y${y0}${y1 !== y0 ? `/y${y1}` : ''}+${h}: ${n} px = ${pct.toFixed(2)}% diff → match ${(100 - pct).toFixed(2)}% — ${pass ? 'PASS' : `FAIL (bar ${bar}%)`}`);
}
process.exit(pass ? 0 : 2);
