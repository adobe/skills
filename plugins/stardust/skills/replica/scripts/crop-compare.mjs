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
 *     --out <path>    the band diff (default crop-diff.png), written as a
 *                     capped JPEG at its .jpg sibling (crop-diff.png →
 *                     crop-diff.jpg): at most 1400 × 1000 px, quality 80 —
 *                     the image to look at
 *     --full-res      also write the full-resolution PNG at the --out (and
 *                     --strip) path — the old output; a .jpg path gets its
 *                     .png sibling. Never needed to read the verdict.
 *     --threshold <pct>  pass bar; exit 2 above it           (default 2)
 *     --pm-threshold <n> pixelmatch per-pixel color threshold (default 0.1)
 *     --json          machine-readable summary on stdout
 *     --strip <path>  also write the bands side by side (A | B [| C]) — the
 *                     evidence image for an inconsistency-register entry
 *                     (replica target breakpoints: source | before | after);
 *                     capped like --out, at its .jpg sibling
 *     --c <c.png>     third column for --strip; --y-c <px> its band top
 *                     (default: --y-b). Never part of the diff or the verdict.
 *
 *   Also prints the diff TEXTURE (share of differing pixels with ≥5 differing
 *   neighbours): thin-edge = glyph-antialiasing noise, thick = blocks/bands.
 *   Reported only — it never changes the exit code (see the gate doc, pass bar
 *   item 5, for the glyph-dense alternative pass it supports).
 *
 *   Then one line per written file (the capped diff and strip, each full-res
 *   PNG). --json adds diffImage and stripImage (the JPEG paths; stripImage
 *   null without --strip) and fullRes (the PNG paths written, [] without
 *   --full-res). Look at the JPEGs: the cap (inspect-image.mjs) keeps an
 *   image an agent reads small; the verdict never depends on it.
 *
 * Example (header band, then footer band with per-side offsets):
 *   node skills/replica/scripts/crop-compare.mjs live.png proto.png \
 *     --y 0 --height 120 --out gates/home-1440/chrome-header-diff.png
 *     # → gates/home-1440/chrome-header-diff.jpg (add --full-res for the PNG too)
 *   node skills/replica/scripts/crop-compare.mjs live.png proto.png \
 *     --y 8840 --y-b 8846 --height 400 --out gates/home-1440/chrome-footer-diff.png
 *
 * Requires: pixelmatch, pngjs (project devDependencies — same as
 * pixel-compare.mjs; imported after --help, so --help and the exported
 * helpers need neither) and inspect-image.mjs beside this file.
 * Exit codes: 0 under threshold, 1 error, 2 over threshold (gate FAIL).
 */
import fs, { readFileSync, realpathSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSPECT_QUALITY, inspectionPath, toInspectionJpeg } from './inspect-image.mjs';

export const DEFAULT_OUT = 'crop-diff.png';
const INSTALL_LINE = 'npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps';
const BOOLEAN_FLAGS = new Set(['--json', '--full-res']);

/**
 * Where a run writes: the capped JPEG of the diff (and of the strip when asked) at the .jpg sibling of the
 * given path; with --full-res also the PNG at the given path (a .jpg/.jpeg path gets its .png sibling, so the
 * PNG never lands on the JPEG). fullRes lists the PNGs in write order: diff, then strip.
 */
export function outputPaths({ out = DEFAULT_OUT, strip = null, fullRes = false } = {}) {
  const png = (p) => (/^\.jpe?g$/i.test(extname(p)) ? `${p.slice(0, -extname(p).length)}.png` : p);
  return {
    diffImage: inspectionPath(out),
    stripImage: strip ? inspectionPath(strip) : null,
    fullRes: fullRes ? [png(out), ...(strip ? [png(strip)] : [])] : [],
  };
}

/** The band verdict: diff share in % of the band's pixels, PASS at or under the bar. */
export function verdict(n, w, h, bar) {
  const pct = (n / (w * h)) * 100;
  return { pct, pass: pct <= bar };
}

/** The --json object: the verdict fields, then the written images, then the texture. */
export function jsonSummary({ fileA, fileB, y0, y1, h, w, n, bar, thickPct, texture, paths }) {
  const { pct, pass } = verdict(n, w, h, bar);
  return {
    a: fileA, b: fileB, y: y0, yB: y1, height: h, width: w,
    diffPixels: n, diffPct: +pct.toFixed(2), matchPct: +(100 - pct).toFixed(2),
    threshold: bar, pass,
    diffImage: paths.diffImage, stripImage: paths.stripImage, fullRes: paths.fullRes,
    texture: { thickPct: +thickPct.toFixed(1), label: texture },
  };
}

/** The text lines naming each written file; sizes are the capped JPEGs' {width, height}. */
export function writtenLines(paths, { diff, strip = null }, quality = INSPECT_QUALITY) {
  const lines = [`  diff image: ${paths.diffImage} (${diff.width}×${diff.height} JPEG q${quality} — look at this one)`];
  if (paths.stripImage) lines.push(`  strip image: ${paths.stripImage} (${strip.width}×${strip.height} JPEG q${quality})`);
  for (const p of paths.fullRes) lines.push(`  full-res PNG: ${p}`);
  return lines;
}

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
function printHelp() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { printHelp(); return 0; }
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : fallback;
  };
  const positional = [];
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith('--')) { if (!BOOLEAN_FLAGS.has(t)) i += 1; continue; }
    positional.push(t);
  }
  const [fileA, fileB] = positional;
  const y0 = Number(arg('y', 0));
  const h = Number(arg('height', NaN));
  const y1 = Number(arg('y-b', y0));
  const out = arg('out', DEFAULT_OUT);
  const bar = Number(arg('threshold', 2));
  const pmThreshold = Number(arg('pm-threshold', 0.1));
  const asJson = argv.includes('--json');
  const fullRes = argv.includes('--full-res');
  const strip = arg('strip', null);
  const fileC = arg('c', null);
  const y2 = Number(arg('y-c', y1));

  if (!fileA || !fileB || Number.isNaN(h) || h <= 0) {
    console.error('usage: crop-compare.mjs <a.png> <b.png> --height <px> [--y <px>] [--y-b <px>] [--out diff.png] [--strip strip.png] [--full-res] [--threshold pct]');
    return 1;
  }

  let PNG;
  let pixelmatch;
  try {
    ({ PNG } = await import('pngjs'));
    ({ default: pixelmatch } = await import('pixelmatch'));
  } catch (e) {
    console.error(`crop-compare error: pngjs / pixelmatch not importable (${String(e.message).split('\n')[0]}) — from the project root: ${INSTALL_LINE} (replica/SKILL.md § Setup)`);
    return 1;
  }

  let A;
  let B;
  let C = null;
  try {
    A = PNG.sync.read(fs.readFileSync(fileA));
    B = PNG.sync.read(fs.readFileSync(fileB));
    if (strip && fileC) C = PNG.sync.read(fs.readFileSync(fileC));
  } catch (e) {
    console.error(`crop-compare error: ${e.message}`);
    return 1;
  }
  const w = Math.min(A.width, B.width, C ? C.width : Infinity);
  for (const [img, y, name] of [[A, y0, fileA], [B, y1, fileB], ...(C ? [[C, y2, fileC]] : [])]) {
    if (y + h > img.height) {
      console.error(`crop-compare error: band y ${y}+${h} exceeds ${name} height ${img.height}`);
      return 1;
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
  const paths = outputPaths({ out, strip, fullRes });
  const fullResPaths = [...paths.fullRes];
  const diffCopy = toInspectionJpeg(diff);
  fs.writeFileSync(paths.diffImage, diffCopy.jpeg);
  if (fullRes) fs.writeFileSync(fullResPaths.shift(), PNG.sync.write(diff));
  let stripCopy = null;
  if (strip) {
    const cols = C ? [ca, cb, crop(C, y2)] : [ca, cb];
    const GAP = 16;
    const s = new PNG({ width: cols.length * w + (cols.length - 1) * GAP, height: h });
    s.data.fill(255);
    cols.forEach((c, k) => PNG.bitblt(c, s, 0, 0, w, h, k * (w + GAP), 0));
    stripCopy = toInspectionJpeg(s);
    fs.writeFileSync(paths.stripImage, stripCopy.jpeg);
    if (fullRes) fs.writeFileSync(fullResPaths.shift(), PNG.sync.write(s));
  }

  // Diff TEXTURE — separates glyph-antialiasing noise from real misalignment.
  // A differing pixel is "thick" when ≥5 of its 8 neighbours also differ: blocks,
  // bands and shifted shapes are thick; per-glyph antialiasing between two font
  // rasterisations (a hinted licensed face vs a self-hosted webfont) is thin —
  // numerically identical family/size/weight/colour/pitch/position can still
  // bottom out at ~5% pixel diff on a ~50-link footer. The share is REPORTED,
  // never used to pass: the alternative pass (source-fidelity-gate.md § Pass bar,
  // item 5 — glyph-dense regions) also needs chrome-parity.mjs quiet for the
  // region and a logged residual carrying both artifacts.
  const isRed = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return false; const i = (y * w + x) * 4; return diff.data[i] === 255 && diff.data[i + 1] < 100; };
  let thick = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isRed(x, y)) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && isRed(x + dx, y + dy)) k += 1;
      if (k >= 5) thick += 1;
    }
  }
  const thickPct = n ? (thick / n) * 100 : 0;
  const texture = n === 0 ? 'none' : thickPct <= 15 ? 'thin-edge (glyph-antialiasing texture)' : thickPct >= 40 ? 'thick (blocks/bands — misalignment or missing paint)' : 'mixed';

  const { pct, pass } = verdict(n, w, h, bar);
  if (asJson) {
    console.log(JSON.stringify(jsonSummary({ fileA, fileB, y0, y1, h, w, n, bar, thickPct, texture, paths })));
  } else {
    console.log(`crop y${y0}${y1 !== y0 ? `/y${y1}` : ''}+${h}: ${n} px = ${pct.toFixed(2)}% diff → match ${(100 - pct).toFixed(2)}% — ${pass ? 'PASS' : `FAIL (bar ${bar}%)`}`);
    if (n) console.log(`  texture: ${thickPct.toFixed(1)}% thick → ${texture}${!pass && thickPct <= 15 ? ' — glyph-dense region? run chrome-parity.mjs; if it is quiet, log as a justified residual (gate doc § Pass bar, item 5)' : ''}`);
    for (const line of writtenLines(paths, { diff: diffCopy, strip: stripCopy })) console.log(line);
  }
  return pass ? 0 : 2;
}

// Main-module guard by REAL path (the exported helpers are imported by the test). Exit through exitCode, not
// process.exit(): see pixel-compare.mjs's header — a forced exit can hang in Node's platform shutdown.
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  main(process.argv).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`crop-compare error: ${e.message}`);
    process.exitCode = 1;
  });
}
