#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-console, no-continue */
/**
 * skills/replica/scripts/sbs-crop.mjs — side-by-side crop of the SAME region from two stitched captures
 * (origin | served), for reading a gate finding by eye without opening two 30 000 px PNGs (#125 D0 — folds
 * the project's sbs-preview / crop-sbs / crop2 helpers into one script).
 *
 * Usage:
 *   node skills/replica/scripts/sbs-crop.mjs <a.png> <b.png> <out.png> [options]
 *     --y <px> --height <px>   row band to crop (default: whole height, capped at --max-rows after scaling)
 *     --x <px> --width <px>    column band (default: full width)
 *     --y-b <px>               b's row offset when the two sides drift (default: same as --y)
 *     --scale <n>              downscale factor, integer (default 1; 4 for a whole-page preview)
 *     --gap <px>               separator width (default 8)
 *     --max-rows <px>          cap on the output height (default 3000)
 *
 * Requires: pngjs. Exit 0 written, 1 error. Read-only on the inputs; writes only <out.png>.
 */
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const HELP = `sbs-crop — the same region of two captures side by side

Usage: node sbs-crop.mjs <a.png> <b.png> <out.png> [--y <px> --height <px>] [--x <px> --width <px>] [--y-b <px>] [--scale <n>] [--gap 8] [--max-rows 3000]`;

const rest = process.argv.slice(2);
if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
const pos = []; const o = { y: 0, yB: null, height: null, x: 0, width: null, scale: 1, gap: 8, maxRows: 3000 };
for (let i = 0; i < rest.length; i += 1) {
  const a = rest[i]; const v = () => Number(rest[++i]);
  if (a === '--y') o.y = v(); else if (a === '--y-b') o.yB = v(); else if (a === '--height') o.height = v(); else if (a === '--x') o.x = v(); else if (a === '--width') o.width = v();
  else if (a === '--scale') o.scale = Math.max(1, Math.round(v())); else if (a === '--gap') o.gap = v(); else if (a === '--max-rows') o.maxRows = v();
  else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); } else pos.push(a);
}
if (pos.length < 3) { console.error(`need <a.png> <b.png> <out.png>\n\n${HELP}`); process.exit(1); }
try {
  const A = PNG.sync.read(readFileSync(pos[0])); const B = PNG.sync.read(readFileSync(pos[1]));
  const yB = o.yB == null ? o.y : o.yB;
  const width = o.width || Math.min(A.width, B.width) - o.x;
  const height = o.height || Math.max(A.height - o.y, B.height - yB);
  const w = Math.ceil(width / o.scale); const h = Math.min(Math.ceil(height / o.scale), o.maxRows);
  const O = new PNG({ width: w * 2 + o.gap, height: h }); O.data.fill(120);
  const blit = (src, ox, y0) => { for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const sy = y0 + y * o.scale; const sx = o.x + x * o.scale; if (sy < 0 || sy >= src.height || sx >= src.width) continue; const si = (sy * src.width + sx) * 4; const di = (y * O.width + x + ox) * 4; O.data[di] = src.data[si]; O.data[di + 1] = src.data[si + 1]; O.data[di + 2] = src.data[si + 2]; O.data[di + 3] = 255; } };
  blit(A, 0, o.y); blit(B, w + o.gap, yB);
  mkdirSync(dirname(pos[2]) || '.', { recursive: true }); writeFileSync(pos[2], PNG.sync.write(O));
  console.log(`wrote ${pos[2]} (${O.width}x${O.height}; a rows ${o.y}..${o.y + height}, b rows ${yB}..${yB + height}, scale ${o.scale})`);
} catch (e) { console.error(`sbs-crop error: ${e.message}`); process.exit(1); }
