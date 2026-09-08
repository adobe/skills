#!/usr/bin/env node
/**
 * skills/replica/scripts/row-profile.mjs
 *
 * Row-level colour profiling of stitched captures for the stardust:replica
 * source-fidelity loop — two instruments the band table and the eye both lack:
 *
 *   1. COLUMN SCAN (layout boundaries). At N evenly spaced x positions, classify
 *      every row's pixel as white / dark / brand / photo and run-length encode
 *      the transitions. This is the honest way to establish section boundaries
 *      (photo heights, band starts, card overlaps): a stacked-crop visual read
 *      suggested a 415px photo with a white band under it; the scan of the same
 *      capture proved the photo full-bleed to 499px with the "white band" being
 *      an overlapping card. The wrong read cost two build/measure cycles. Treat
 *      crop eyeballing as hypothesis; the scan is the measurement.
 *
 *   2. LANDMARKS (cross-capture alignment). With --color, rows dominated by an
 *      unmistakable saturated brand colour — CTA buttons are ideal, they recur in
 *      every section — are grouped into runs and, when two captures are given,
 *      paired in order. The per-pair delta (B − A) says by how many pixels each
 *      landmark is offset; the CHANGE in delta between consecutive pairs names
 *      the inter-landmark gap that absorbed the shift, so vertical alignment
 *      becomes arithmetic: patch that one CSS gap, re-measure. Three passes
 *      driven this way took a page from 16.9% to 11.05% and a 1559px height
 *      delta to 48px; band percentages alone never say by how much.
 *
 * Usage:
 *   node skills/replica/scripts/row-profile.mjs <a.png> [<b.png>] [options]
 *     --color <#rrggbb>   brand landmark colour (enables LANDMARKS + the brand class)
 *     --tolerance <n>     RGB distance for a brand match          (default 48)
 *     --min-frac <f>      row fraction of brand pixels for a hit  (default 0.02)
 *     --columns <n>       x positions for the column scan         (default 7)
 *     --min-run <px>      runs shorter than this are merged away  (default 4)
 *     --json              machine-readable output
 *
 * Convention: <a.png> = live capture, <b.png> = prototype/build capture — the
 * same stitched PNGs pixel-compare.mjs consumed (no extra live hit). Crop with
 * pngjs (this file's technique), never `sips --cropOffset` — its band crops
 * were off by tens of pixels in the field.
 *
 * Requires: pngjs (already a gate dependency). Exit codes: 0 ok, 1 error.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { PNG } from 'pngjs';
import { readFileSync } from 'fs';

const HELP = `row-profile — column scan + brand-colour landmarks over stitched captures

Usage: node row-profile.mjs <a.png> [<b.png>] [options]
  --color <#rrggbb>  brand landmark colour (enables LANDMARKS + the brand class)
  --tolerance <n>    RGB distance for a brand match (default 48)
  --min-frac <f>     row fraction of brand pixels that makes a landmark row (default 0.02)
  --columns <n>      x positions for the column scan (default 7)
  --min-run <px>     merge runs shorter than this (default 4)
  --json             machine-readable output`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h') || !rest.length) { console.log(HELP); process.exit(rest.length ? 0 : 1); }
  const pos = [];
  const opts = { color: null, tolerance: 48, minFrac: 0.02, columns: 7, minRun: 4, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--color') { opts.color = rest[i += 1]; }
    else if (a === '--tolerance') { opts.tolerance = Number(rest[i += 1]); }
    else if (a === '--min-frac') { opts.minFrac = Number(rest[i += 1]); }
    else if (a === '--columns') { opts.columns = Number(rest[i += 1]); }
    else if (a === '--min-run') { opts.minRun = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (opts.color) {
    const m = opts.color.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) { console.error(`--color must be #rrggbb, got ${opts.color}`); process.exit(1); }
    opts.brand = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  return { paths: pos, opts };
}

const dist = (r, g, b, [br, bg, bb]) => Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2);

function classify(r, g, b, opts) {
  if (opts.brand && dist(r, g, b, opts.brand) <= opts.tolerance) return 'brand';
  if (Math.min(r, g, b) >= 240) return 'white';
  if (Math.max(r, g, b) <= 48) return 'dark';
  return 'photo';
}

// Run-length encode a per-row class sequence, merging runs shorter than minRun
// into the run before them (anti-aliased edges, 1–3px rules) so transitions
// reflect layout, not glyph noise.
function runs(classes, minRun) {
  const out = [];
  for (let y = 0; y < classes.length; y += 1) {
    const last = out[out.length - 1];
    if (last && last.cls === classes[y]) last.y1 = y + 1;
    else out.push({ cls: classes[y], y0: y, y1: y + 1 });
  }
  const merged = [];
  for (const r of out) {
    const prev = merged[merged.length - 1];
    if (prev && r.y1 - r.y0 < minRun) { prev.y1 = r.y1; continue; }
    if (prev && prev.cls === r.cls) { prev.y1 = r.y1; continue; }
    merged.push({ ...r });
  }
  return merged;
}

function columnScan(img, opts) {
  const cols = [];
  for (let c = 0; c < opts.columns; c += 1) {
    const x = Math.min(img.width - 1, Math.round((img.width * (c + 0.5)) / opts.columns));
    const classes = new Array(img.height);
    for (let y = 0; y < img.height; y += 1) {
      const i = (y * img.width + x) * 4;
      classes[y] = classify(img.data[i], img.data[i + 1], img.data[i + 2], opts);
    }
    cols.push({ x, runs: runs(classes, opts.minRun) });
  }
  return cols;
}

function landmarks(img, opts) {
  const hits = new Array(img.height);
  const need = Math.max(1, Math.round(img.width * opts.minFrac));
  for (let y = 0; y < img.height; y += 1) {
    let n = 0;
    for (let x = 0; x < img.width && n < need; x += 1) {
      const i = (y * img.width + x) * 4;
      if (dist(img.data[i], img.data[i + 1], img.data[i + 2], opts.brand) <= opts.tolerance) n += 1;
    }
    hits[y] = n >= need;
  }
  const out = [];
  for (let y = 0; y < img.height; y += 1) {
    if (!hits[y]) continue;
    const last = out[out.length - 1];
    if (last && last.y1 === y) last.y1 = y + 1;
    else out.push({ y0: y, y1: y + 1 });
  }
  return out.filter((l) => l.y1 - l.y0 >= opts.minRun).map((l) => ({ ...l, h: l.y1 - l.y0 }));
}

function main() {
  const { paths, opts } = parseArgs(process.argv);
  if (!paths.length) { console.error(`need <a.png>\n\n${HELP}`); process.exit(1); }
  const imgs = paths.map((p) => ({ path: p, png: PNG.sync.read(readFileSync(p)) }));
  const report = imgs.map(({ path, png }) => ({
    path,
    size: { width: png.width, height: png.height },
    columns: columnScan(png, opts),
    landmarks: opts.brand ? landmarks(png, opts) : null,
  }));

  let pairs = null;
  if (opts.brand && report.length === 2) {
    const [A, B] = report.map((r) => r.landmarks);
    const n = Math.min(A.length, B.length);
    pairs = [];
    for (let i = 0; i < n; i += 1) {
      const delta = B[i].y0 - A[i].y0;
      pairs.push({ i, a: A[i], b: B[i], delta, gapShift: i ? delta - pairs[i - 1].delta : delta });
    }
    if (A.length !== B.length) pairs.unpaired = { a: A.length - n, b: B.length - n };
  }

  if (opts.json) { console.log(JSON.stringify({ opts: { ...opts, brand: opts.brand || null }, images: report, pairs }, null, 2)); return; }

  for (const r of report) {
    console.log(`\n${r.path}  ${r.size.width}x${r.size.height}`);
    console.log('  column scan (class y0–y1; white/dark/brand/photo):');
    for (const c of r.columns) {
      console.log(`    x=${String(c.x).padStart(5)}: ${c.runs.map((k) => `${k.cls} ${k.y0}–${k.y1}`).join(' | ')}`);
    }
    if (r.landmarks) {
      console.log(`  landmarks (${opts.color}, ≥${Math.round(opts.minFrac * 100)}% of row): ${r.landmarks.length}`);
      r.landmarks.forEach((l, i) => console.log(`    #${String(i).padStart(2)}  y ${l.y0}–${l.y1}  (h ${l.h})`));
    }
  }
  if (pairs) {
    console.log('\nlandmark pairs (B − A; gapShift = how much the gap ABOVE this landmark absorbed):');
    console.log('    #   A.y0    B.y0   delta  gapShift');
    for (const p of pairs) console.log(`   ${String(p.i).padStart(2)}  ${String(p.a.y0).padStart(6)}  ${String(p.b.y0).padStart(6)}  ${String(p.delta).padStart(6)}  ${String(p.gapShift).padStart(8)}${Math.abs(p.gapShift) >= 8 ? '  ◄◄ fix the gap above this landmark' : ''}`);
    if (pairs.unpaired) console.log(`  ⚠ unpaired landmarks — A has ${pairs.unpaired.a} more, B has ${pairs.unpaired.b} more: a missing/duplicated section or a colour tolerance issue; pair by eye before trusting deltas below the mismatch`);
    console.log('  Read top-down: the first non-zero gapShift names the inter-landmark gap to patch; everything below it is offset-contaminated until it is fixed.');
  }
}

try { main(); } catch (e) { console.error(`row-profile error: ${e.message}`); process.exit(1); }
