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
 *     --offsets | --no-offsets  per-band ROW OFFSET (default on): for every band,
 *                          the vertical shift d (B relative to A, px) that best
 *                          aligns the two sides' mean-row-luminance profiles
 *                          (min mean |Lb[y] − La[y − d]| over the band, d in
 *                          ±--offset-range), plus a 0–1 confidence and the
 *                          `◄ seam` marker on the first band whose offset CHANGES
 *                          (> 2 px vs the band above) — the section that absorbed
 *                          the shift; every band below inherits its offset. A
 *                          flat band (row-luminance std below the floor) prints
 *                          `—`, never 0. Colour-independent and element-free, so
 *                          it works where row-profile --color and anchor.mjs
 *                          cannot (no brand colour, no main > section). One
 *                          field run hand-rolled exactly this search 23 times in
 *                          PIL after 18 missing-numpy failures.
 *     --offset-range <px>  search window (default 240; raised to |heightDelta|
 *                          + 40 when the height delta is larger)
 *     --mask <yA:h[@yB]>   exclude a row band from the number (repeatable, comma
 *                          list): rows yA..yA+h in A and yB..yB+h in B (yB
 *                          defaults to yA) are neutralised on BOTH sides before
 *                          matching and removed from the denominator. For
 *                          authored-volatile regions — campaign heroes, promo
 *                          slots — whose live content changes between capture and
 *                          gate: they are authored content, not conversion
 *                          fidelity, and they must not consume the fidelity bar.
 *                          Every mask is printed on the verdict line; a masked
 *                          number is never reported as an unmasked one — the
 *                          verdict line and --json also carry pixelPctUnmasked
 *                          (the same stitched PNGs matched with no mask; one
 *                          extra pixelmatch pass, only when masks are given)
 *                          and masks[] with each mask's area % of the compared
 *                          height, so the ledger copies both numbers instead
 *                          of typing them.
 *     --json               emit machine-readable summary on stdout
 *     --json-out <file>    write the same summary to <file> AND keep the human
 *                          verdict lines on stdout (gate.sh's per-round record)
 *     --force              compare even when the two captures' provenance
 *                          sidecars (<png>.json, written by stitch-shot) say
 *                          they are not comparable — different instrument,
 *                          width, vh, dpr or consent mode, or only one side
 *                          has a sidecar. Without it that pair exits 1 with a
 *                          named message (./capture-sidecar.mjs): a mixed
 *                          compare is a false round, not a measurement.
 *     --review <file>      write the review strip (review-image.mjs --bands: the 3
 *                          worst bands as [A | B] rows + diff heat bar, ≤ 1000×1500)
 *                          after the diff; gate.sh passes review-<label>.png. Runs
 *                          inside the supervised worker; a failure is one stderr
 *                          line and never touches the verdict or the exit code.
 *                          Read THIS first (one image per round — context-hygiene
 *                          § Image reads); crop-compare --out for one named band.
 *     --timeout <s>        hard wall-clock deadline (default 120; 0 disables).
 *                          Enforced from a supervising process (the compare
 *                          itself is synchronous, so an in-process timer could
 *                          never fire). Exit 124 = deadline hit, not a gate
 *                          verdict — re-run; raise the cap only for a
 *                          legitimately huge capture.
 *
 * The hang this guards against (three field migrations, 2026-08/09, "0 % CPU
 * for 10+ minutes after the verdict was printed") was reproduced on
 * 2026-09-18: with stdout redirected to a file or /dev/null — how gate.sh and
 * every agent pipeline runs it — `process.exit()` after the compare could
 * block forever inside Node's platform shutdown (stack: Environment::Exit →
 * DisposePlatform → WorkerThreadsTaskRunner::Shutdown → uv_thread_join), 1 in
 * ~4 runs on Node 25. Letting the process drain (`process.exitCode`) instead
 * of forcing exit did not hang in 10/10 runs. The deadline stays as the
 * belt to that fix's braces.
 *
 * Example:
 *   node skills/replica/scripts/pixel-compare.mjs \
 *     stardust/replica/gates/home-1440/live.png \
 *     stardust/replica/gates/home-1440/proto.png \
 *     --out stardust/replica/gates/home-1440/diff.png
 *
 * Requires: pixelmatch, pngjs (project devDependencies).
 * Exit codes: 0 under threshold, 1 error (incl. incomparable captures), 2 over
 * threshold (gate FAIL), 124 deadline exceeded (see --timeout; not a measurement).
 * The offset column, the seam marker and the review strip never affect the exit code.
 * Note: the height delta does NOT affect the exit code — the SKILL gate
 * requires height Δ ≈ 0 separately; a large delta is printed as a warning
 * because the overlap-crop can make the % look artificially healthy.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runCapped, DEADLINE_EXIT } from './run-capped.mjs';
import { requireComparable } from './capture-sidecar.mjs';
import { renderBands } from './review-image.mjs';

const HELP = `pixel-compare — pixelmatch two stitched full-page PNGs with per-band breakdown

Usage: node pixel-compare.mjs <a.png> <b.png> [options]
  --out <diff.png>    diff image path (default diff.png)
  --threshold <pct>   pass bar as percent; exit 2 above it (default 10)
  --band <px>         band height for the breakdown (default 500)
  --pm-threshold <n>  pixelmatch per-pixel color threshold (default 0.1)
  --no-offsets        skip the per-band row-offset column (default on: offset, confidence, ◄ seam)
  --offset-range <px> offset search window (default 240, or |heightDelta| + 40 if larger)
  --mask <yA:h[@yB]>  exclude a row band (authored-volatile region) on both sides;
                      repeatable / comma list; yB defaults to yA
  --json              machine-readable summary on stdout
  --json-out <file>   write the summary to <file>, keep the human verdict on stdout
  --force             compare captures whose provenance sidecars differ (exit 1 otherwise)
  --review <file>     write the review strip (3 worst bands, [A | B] + heat bar) — read it instead of crops
  --timeout <s>       hard deadline, exit 124 when hit (default 120; 0 disables)
  --help              this text

Convention: <a.png> = live/source capture, <b.png> = prototype capture.`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { out: 'diff.png', threshold: 10, band: 500, pmThreshold: 0.1, json: false, jsonOut: null, masks: [], timeout: 120, worker: false, force: false, review: null, offsets: true, offsetRange: 240 };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--threshold') { opts.threshold = Number(rest[i += 1]); }
    else if (a === '--band') { opts.band = Number(rest[i += 1]); }
    else if (a === '--pm-threshold') { opts.pmThreshold = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--json-out') { opts.jsonOut = rest[i += 1]; }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a === '--worker') { opts.worker = true; }
    else if (a === '--force') { opts.force = true; }
    else if (a === '--review') { opts.review = rest[i += 1]; }
    else if (a === '--offsets') { opts.offsets = true; }
    else if (a === '--no-offsets') { opts.offsets = false; }
    else if (a === '--offset-range') { opts.offsetRange = Number(rest[i += 1]); }
    else if (a === '--mask') {
      for (const spec of rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const m = spec.match(/^(\d+):(\d+)(?:@(\d+))?$/);
        if (!m) { console.error(`bad --mask "${spec}" — expected yA:h or yA:h@yB\n\n${HELP}`); process.exit(1); }
        opts.masks.push({ yA: Number(m[1]), h: Number(m[2]), yB: m[3] === undefined ? Number(m[1]) : Number(m[3]) });
      }
    }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [aPath, bPath] = pos;
  if (!aPath || !bPath) { console.error(`need <a.png> and <b.png>\n\n${HELP}`); process.exit(1); }
  return { aPath, bPath, opts };
}

// ---- per-band row offsets (pure; exported for tests) ----
/** Mean luminance per row (Float64Array); masked rows are NaN. */
export function rowLuminance(img, w, h, masked = null) {
  const L = new Float64Array(h);
  for (let y = 0; y < h; y += 1) {
    if (masked && masked[y]) { L[y] = NaN; continue; }
    let sum = 0;
    for (let x = 0; x < w; x += 1) { const i = (y * w + x) * 4; sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; }
    L[y] = sum / w;
  }
  return L;
}
/**
 * For each band, the offset d (B relative to A: Lb[y] ≈ La[y − d]) minimising the
 * mean |Lb[y] − La[y − d]| over the band's rows, d in [−range, range]. Returns
 * [{ offset, offsetScore }] — offset null when the band is flat (row std < floor)
 * or the search is inconclusive (best not clearly below the median).
 */
export function bandOffsets(La, Lb, bands, { range = 240, floor = 2 } = {}) {
  const h = Math.min(La.length, Lb.length);
  return bands.map(({ y0, y1 }) => {
    const rows = [];
    for (let y = y0; y < Math.min(y1, h); y += 1) if (!Number.isNaN(Lb[y])) rows.push(y);
    if (rows.length < 16) return { offset: null, offsetScore: 0 };
    const mean = rows.reduce((acc, y) => acc + Lb[y], 0) / rows.length;
    const std = Math.sqrt(rows.reduce((acc, y) => acc + (Lb[y] - mean) ** 2, 0) / rows.length);
    if (std < floor) return { offset: null, offsetScore: 0 };
    const costs = [];
    let best = Infinity; let bestD = 0;
    for (let d = -range; d <= range; d += 1) {
      let sum = 0; let n = 0;
      for (const y of rows) { const ya = y - d; if (ya < 0 || ya >= h || Number.isNaN(La[ya])) continue; sum += Math.abs(Lb[y] - La[ya]); n += 1; }
      if (n < rows.length / 2) continue;
      const c = sum / n; costs.push(c);
      if (c < best || (c === best && Math.abs(d) < Math.abs(bestD))) { best = c; bestD = d; }
    }
    if (!costs.length) return { offset: null, offsetScore: 0 };
    const sorted = [...costs].sort((p, q) => p - q); const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const score = median > 0 ? Math.max(0, Math.min(1, 1 - best / median)) : 0;
    if (score < 0.25) return { offset: null, offsetScore: Number(score.toFixed(2)) };
    return { offset: bestD, offsetScore: Number(score.toFixed(2)) };
  });
}
/** Mark the first band whose offset changes by > 2 px vs the band above (0 assumed above the page). Returns { bands, firstSeam }. */
export function markSeams(bands) {
  let prev = 0; let firstSeam = null;
  const out = bands.map((bd) => {
    const seam = bd.offset !== null && bd.offset !== undefined && Math.abs(bd.offset - prev) > 2;
    const row = { ...bd, seam };
    if (seam && !firstSeam) firstSeam = { y0: bd.y0, y1: bd.y1, from: prev, to: bd.offset };
    if (bd.offset !== null && bd.offset !== undefined) prev = bd.offset;
    return row;
  });
  return { bands: out, firstSeam };
}

function cropTo(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) img.data.copy(o.data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
  return o;
}

// --timeout: the compare is synchronous end to end, so the deadline lives in a
// supervising copy of this process: the parent re-spawns itself with --worker
// under run-capped and mirrors the worker's exit code (124 on the deadline).
async function supervise(timeoutSec) {
  const args = [fileURLToPath(import.meta.url), '--worker', ...process.argv.slice(2).filter((x, i, arr) => !(x === '--timeout' || arr[i - 1] === '--timeout'))];
  const code = await runCapped(process.execPath, args, { timeoutSec, label: 'pixel-compare' });
  if (code === DEADLINE_EXIT) console.error(`pixel-compare: no verdict — deadline ${timeoutSec}s exceeded (exit ${DEADLINE_EXIT}). Not a gate FAIL: re-run, or pass --timeout <s> above ${timeoutSec} for a legitimately huge capture.`);
  process.exitCode = code;
}

function main() {
  const { aPath, bPath, opts } = parseArgs(process.argv);
  if (!opts.worker && opts.timeout > 0) { supervise(opts.timeout); return; }
  // Comparability first (rule 15): same instrument, width, vh, dpr, consent mode.
  const prov = requireComparable('pixel-compare', aPath, bPath, { force: opts.force });
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const heightDelta = a.height - b.height;

  const ca = cropTo(a, w, h);
  const cb = cropTo(b, w, h);
  // --mask: neutralise authored-volatile row bands. The masked rows are painted
  // one flat colour on BOTH sides (so they can never differ) and removed from the
  // denominator. When yA ≠ yB the UNION of both row ranges is masked on both
  // sides — masking each side at its own offset would compare grey against real
  // content on the other side and manufacture a false diff.
  // Before painting, take the UNMASKED number off the same buffers: an outside
  // audit reads the page with no masks, and a ledger that carries only the
  // masked figure cannot be reconciled with it (residual logging format,
  // `pixelPctUnmasked`). One extra pass, only when masks are given.
  const nUnmasked = opts.masks.length ? pixelmatch(ca.data, cb.data, null, w, h, { threshold: opts.pmThreshold }) : null;
  const masked = new Uint8Array(h);
  const maskRows = opts.masks.map(() => 0);
  opts.masks.forEach((mk, k) => {
    for (const y0 of [mk.yA, mk.yB]) for (let y = Math.max(0, y0); y < Math.min(h, y0 + mk.h); y += 1) { if (!masked[y]) maskRows[k] += 1; masked[y] = 1; }
  });
  let maskedRows = 0;
  for (let y = 0; y < h; y += 1) {
    if (!masked[y]) continue;
    maskedRows += 1;
    for (const img of [ca, cb]) img.data.fill(128, y * w * 4, (y + 1) * w * 4);
  }
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: opts.pmThreshold });
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, PNG.sync.write(diff));
  const denom = w * (h - maskedRows);
  const pct = denom > 0 ? (100 * n) / denom : 0;
  const pctUnmasked = nUnmasked === null ? pct : (100 * nUnmasked) / (w * h);
  const maskSpec = (m) => `${m.yA}:${m.h}${m.yB !== m.yA ? `@${m.yB}` : ''}`;
  const masks = opts.masks.map((m, k) => ({ spec: maskSpec(m), yA: m.yA, h: m.h, yB: m.yB, rows: maskRows[k], areaPct: Number(((100 * maskRows[k]) / h).toFixed(1)) }));

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

  // --offsets: row-luminance cross-correlation per band, from the same cropped
  // buffers (masked rows excluded). Colour-independent; never on the verdict path.
  let firstSeam = null;
  let bandsOut = bands;
  if (opts.offsets) {
    const range = Math.max(opts.offsetRange, Math.abs(heightDelta) + 40);
    const La = rowLuminance(ca, w, h, masked); const Lb = rowLuminance(cb, w, h, masked);
    const offs = bandOffsets(La, Lb, bands, { range });
    ({ bands: bandsOut, firstSeam } = markSeams(bands.map((bd, k) => ({ ...bd, ...offs[k] }))));
  }

  // --review: the round's one image — rendered from the buffers already in
  // memory, written after the diff, never on the verdict path.
  let review = null;
  if (opts.review) {
    try {
      const { img } = renderBands({ a: ca, b: cb, diff, bands, width: 1000, top: 3 });
      const outPng = new PNG({ width: img.width, height: img.height }); img.data.copy(outPng.data);
      mkdirSync(dirname(opts.review), { recursive: true });
      writeFileSync(opts.review, PNG.sync.write(outPng));
      review = opts.review;
    } catch (e) { console.error(`pixel-compare: review strip not written (${e.message}) — verdict unaffected`); }
  }

  const pass = pct <= opts.threshold;
  // Field names mirror the ledger (source-fidelity-gate.md § Residual logging
  // format) so `result` is copied from here, never typed: pixelPct,
  // pixelPctUnmasked, heightDelta, pass, masks[].
  const summary = { a: aPath, b: bPath, compared: { width: w, height: h }, heightDelta, differingPixels: n, pct: Number(pct.toFixed(2)), pixelPct: Number(pct.toFixed(2)), pixelPctUnmasked: Number(pctUnmasked.toFixed(2)), threshold: opts.threshold, pass, diff: opts.out, masks, maskedRows, bands: bandsOut.map((x) => ({ ...x, pct: Number(x.pct.toFixed(1)) })), ...(opts.offsets ? { offsets: { range: Math.max(opts.offsetRange, Math.abs(heightDelta) + 40), firstSeam } } : {}), ...(review ? { review } : {}), ...prov };
  if (opts.jsonOut) { mkdirSync(dirname(opts.jsonOut), { recursive: true }); writeFileSync(opts.jsonOut, `${JSON.stringify(summary, null, 2)}\n`); }
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`A ${a.width}x${a.height}  B ${b.width}x${b.height}  → compare ${w}x${h}, height delta ${heightDelta}px`);
    if (Math.abs(heightDelta) > 8) console.log(`  ⚠ height delta ${heightDelta}px — overlap-crop hides the tail; fix heights before trusting the %`);
    console.log(`differing pixels: ${n} / ${denom} = ${pct.toFixed(2)}%  (threshold ${opts.threshold}%) → ${pass ? 'PASS' : 'FAIL'}${maskedRows ? `  [MASKED ${maskedRows} rows: ${masks.map((m) => `${m.spec} (${m.areaPct}%)`).join(', ')} — authored-volatile, excluded; unmasked ${pctUnmasked.toFixed(2)}%]` : ''}`);
    console.log(`diff image: ${opts.out}`);
    if (review) console.log(`review image: ${review}  (3 worst bands, A | B + heat bar — read this, not the crops; crop-compare --out for one band at full resolution)`);
    const sg = (n) => (n > 0 ? `+${n}` : String(n));
    if (opts.offsets) console.log(firstSeam ? `first seam: y ${firstSeam.y0}–${firstSeam.y1} (offset ${sg(firstSeam.from)} → ${sg(firstSeam.to)}px) — fix that section first; every band below inherits its offset` : 'no seam: every measurable band sits at the same offset (— = flat band, no measurement)');
    for (const bd of bandsOut) {
      const off = opts.offsets ? `  offset ${bd.offset === null || bd.offset === undefined ? '—' : `${sg(bd.offset)}px`.padStart(6)}${bd.offset !== null && bd.offset !== undefined ? ` (${bd.offsetScore.toFixed(2)})` : ''}` : '';
      console.log(`  y ${String(bd.y0).padStart(6)}–${bd.y1}: ${bd.pct.toFixed(1)}%${off}${bd.pct > 15 ? '  ◄◄ hot band' : ''}${bd.seam ? '  ◄ seam' : ''}`);
    }
  }
  // Never process.exit() here — see the header: forcing exit after the compare
  // hung Node's platform shutdown; the loop has nothing left and drains at once.
  process.exitCode = pass ? 0 : 2;
}

// CLI only when invoked directly (real paths — a symlinked tmpdir differs); the
// offset helpers import as a library.
const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) { try { main(); } catch (e) { console.error(`pixel-compare error: ${e.message}`); process.exit(1); } }
