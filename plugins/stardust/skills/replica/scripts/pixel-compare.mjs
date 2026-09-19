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
 * Exit codes: 0 under threshold, 1 error, 2 over threshold (gate FAIL),
 * 124 deadline exceeded (see --timeout; not a measurement).
 * Note: the height delta does NOT affect the exit code — the SKILL gate
 * requires height Δ ≈ 0 separately; a large delta is printed as a warning
 * because the overlap-crop can make the % look artificially healthy.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCapped, DEADLINE_EXIT } from './run-capped.mjs';

const HELP = `pixel-compare — pixelmatch two stitched full-page PNGs with per-band breakdown

Usage: node pixel-compare.mjs <a.png> <b.png> [options]
  --out <diff.png>    diff image path (default diff.png)
  --threshold <pct>   pass bar as percent; exit 2 above it (default 10)
  --band <px>         band height for the breakdown (default 500)
  --pm-threshold <n>  pixelmatch per-pixel color threshold (default 0.1)
  --mask <yA:h[@yB]>  exclude a row band (authored-volatile region) on both sides;
                      repeatable / comma list; yB defaults to yA
  --json              machine-readable summary on stdout
  --json-out <file>   write the summary to <file>, keep the human verdict on stdout
  --timeout <s>       hard deadline, exit 124 when hit (default 120; 0 disables)
  --help              this text

Convention: <a.png> = live/source capture, <b.png> = prototype capture.`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { out: 'diff.png', threshold: 10, band: 500, pmThreshold: 0.1, json: false, jsonOut: null, masks: [], timeout: 120, worker: false };
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

  const pass = pct <= opts.threshold;
  // Field names mirror the ledger (source-fidelity-gate.md § Residual logging
  // format) so `result` is copied from here, never typed: pixelPct,
  // pixelPctUnmasked, heightDelta, pass, masks[].
  const summary = { a: aPath, b: bPath, compared: { width: w, height: h }, heightDelta, differingPixels: n, pct: Number(pct.toFixed(2)), pixelPct: Number(pct.toFixed(2)), pixelPctUnmasked: Number(pctUnmasked.toFixed(2)), threshold: opts.threshold, pass, diff: opts.out, masks, maskedRows, bands: bands.map((x) => ({ ...x, pct: Number(x.pct.toFixed(1)) })) };
  if (opts.jsonOut) { mkdirSync(dirname(opts.jsonOut), { recursive: true }); writeFileSync(opts.jsonOut, `${JSON.stringify(summary, null, 2)}\n`); }
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`A ${a.width}x${a.height}  B ${b.width}x${b.height}  → compare ${w}x${h}, height delta ${heightDelta}px`);
    if (Math.abs(heightDelta) > 8) console.log(`  ⚠ height delta ${heightDelta}px — overlap-crop hides the tail; fix heights before trusting the %`);
    console.log(`differing pixels: ${n} / ${denom} = ${pct.toFixed(2)}%  (threshold ${opts.threshold}%) → ${pass ? 'PASS' : 'FAIL'}${maskedRows ? `  [MASKED ${maskedRows} rows: ${masks.map((m) => `${m.spec} (${m.areaPct}%)`).join(', ')} — authored-volatile, excluded; unmasked ${pctUnmasked.toFixed(2)}%]` : ''}`);
    console.log(`diff image: ${opts.out}`);
    for (const bd of bands) {
      console.log(`  y ${String(bd.y0).padStart(6)}–${bd.y1}: ${bd.pct.toFixed(1)}%${bd.pct > 15 ? '  ◄◄ hot band' : ''}`);
    }
  }
  // Never process.exit() here — see the header: forcing exit after the compare
  // hung Node's platform shutdown; the loop has nothing left and drains at once.
  process.exitCode = pass ? 0 : 2;
}

try { main(); } catch (e) { console.error(`pixel-compare error: ${e.message}`); process.exit(1); }
