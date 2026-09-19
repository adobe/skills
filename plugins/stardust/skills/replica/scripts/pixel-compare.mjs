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
 *                          defaults to yA) — a full-width rect mask. For
 *                          authored-volatile regions — campaign heroes, promo
 *                          slots — whose live content changes between capture and
 *                          gate: they are authored content, not conversion
 *                          fidelity, and they must not consume the fidelity bar.
 *     --mask-from [a.json[,b.json]]  rect masks from the captures' sidecars
 *                          (default: both <png>.json — stitch-shot --mask-sel
 *                          writes masksRects[]): every `sel` rect from EITHER
 *                          side is painted on BOTH sides (union — symmetric by
 *                          construction). Rects marked fixed (pinned chrome) or
 *                          error ('bad selector') are skipped and printed once.
 *     --mask-iframes       also mask every `iframe` rect in masksRects (class
 *                          live-data-embed); a rect with no counterpart within
 *                          ±2 px on the other side is still masked, printed
 *                          `asymmetric` (a live-only embed is allowed)
 *     --mask-images        also mask `img` rects — ONLY those with a counterpart
 *                          within ±2 px on every edge on the other side (class
 *                          photo-reencoding): re-encoding noise leaves the
 *                          number, a missing / moved / resized image stays in
 *                          it, so no bar moves. Above 60 % image area the
 *                          verdict prints `photo-dominated` — ledger that line.
 *     --masks-json <file>  the project's inventory-declared masks
 *                          (stardust/replica/masks.json — schema and validator in
 *                          ./capture-sidecar.mjs): implies --mask-from and the
 *                          iframes/images flags it declares; a `sel` rect in a
 *                          sidecar that masks.json does not declare, or an entry
 *                          without class + source, is exit 1 — only inventory-
 *                          declared regions are auto-masked. `--check` alone
 *                          validates and prints the effective capture flags
 *                          (gate.sh runs it before the first capture).
 *                          Every mask, of every kind, is one rect model: painted
 *                          one flat colour on both sides, removed from the
 *                          denominator, printed on the verdict line with
 *                          kind/class/area % and listed in masks[]; a masked
 *                          number is never reported alone — pixelPctUnmasked
 *                          (the same PNGs matched with no mask; one extra pass,
 *                          only when masks apply) always accompanies it.
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
import { requireComparable, readSidecar, loadMasksJson, maskFlagsOf, AUTO_MASK_CLASS } from './capture-sidecar.mjs';
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
  --mask-from [a.json[,b.json]]  rect masks from the sidecars' masksRects[] (default: both <png>.json);
                      sel rects from either side are painted on both (symmetric); fixed / bad-selector rects skipped
  --mask-iframes      also mask every iframe rect (live-only ones allowed, printed asymmetric)
  --mask-images       also mask img rects matched within ±2 px on both sides only (photo-reencoding);
                      > 60 % image area prints photo-dominated — ledger it
  --masks-json <file> inventory-declared masks (stardust/replica/masks.json; schema: capture-sidecar.mjs);
                      implies --mask-from; entries need class + source (exit 1 otherwise)
  --check             with --masks-json: validate it and print the capture flags as JSON, no compare
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
  const opts = { out: 'diff.png', threshold: 10, band: 500, pmThreshold: 0.1, json: false, jsonOut: null, masks: [], maskFrom: null, maskIframes: false, maskImages: false, masksJson: null, check: false, timeout: 120, worker: false, force: false, review: null, offsets: true, offsetRange: 240 };
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
    else if (a === '--mask-from') { const v = rest[i + 1]; if (v && !v.startsWith('--') && /\.json(,|$)/.test(v)) { i += 1; opts.maskFrom = v.split(',').map((x) => x.trim()).filter(Boolean); if (opts.maskFrom.length > 2) { console.error(`--mask-from takes at most two sidecars\n\n${HELP}`); process.exit(1); } } else opts.maskFrom = 'auto'; }
    else if (a === '--mask-iframes') { opts.maskIframes = true; }
    else if (a === '--mask-images') { opts.maskImages = true; }
    else if (a === '--masks-json') { opts.masksJson = rest[i += 1]; }
    else if (a === '--check') { opts.check = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (opts.check) { if (!opts.masksJson) { console.error(`--check needs --masks-json <file>\n\n${HELP}`); process.exit(1); } return { aPath: null, bPath: null, opts }; }
  const [aPath, bPath] = pos;
  if (!aPath || !bPath) { console.error(`need <a.png> and <b.png>\n\n${HELP}`); process.exit(1); }
  if ((opts.maskIframes || opts.maskImages || opts.masksJson) && !opts.maskFrom) opts.maskFrom = 'auto';
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

// ---- rect mask model (pure; exported for tests) ----
const near = (a, b, tol = 2) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
const rectOf = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
/**
 * Pair rects of one kind across the two sides by geometry (±tol px on every
 * edge, greedy, each rect used once). Returns { pairs: [[a, b]], onlyA, onlyB }.
 */
export function pairRects(A, B, tol = 2) {
  const used = new Set(); const pairs = []; const onlyA = [];
  for (const a of A) { const j = B.findIndex((b, i) => !used.has(i) && near(a, b, tol)); if (j < 0) onlyA.push(a); else { used.add(j); pairs.push([a, B[j]]); } }
  return { pairs, onlyA, onlyB: B.filter((_, i) => !used.has(i)) };
}
/**
 * Build the mask list from --mask bands and the two sidecars' masksRects.
 * Every mask is { kind, class, label, rects[], side: 'both'|'A'|'B', asymmetric? }
 * and is painted on BOTH sides (union semantics). Returns { masks, notes,
 * imagesUnmatched } — notes are the once-printed skips (fixed, bad selector).
 * Throws on a masks.json violation (undeclared sel).
 */
export function buildMasks({ bands = [], A = null, B = null, iframes = false, images = false, declared = null, width = 0 }) {
  const masks = []; const notes = []; let imagesUnmatched = 0;
  for (const mk of bands) {
    const spec = `${mk.yA}:${mk.h}${mk.yB !== mk.yA ? `@${mk.yB}` : ''}`;
    const rects = [{ x: 0, y: mk.yA, w: width, h: mk.h }]; if (mk.yB !== mk.yA) rects.push({ x: 0, y: mk.yB, w: width, h: mk.h });
    masks.push({ kind: 'band', class: AUTO_MASK_CLASS.band, label: spec, spec, yA: mk.yA, h: mk.h, yB: mk.yB, rects, side: 'both' });
  }
  if (!A && !B) return { masks, notes, imagesUnmatched };
  const side = (list, tag) => (list || []).map((r) => ({ ...r, _side: tag }));
  const all = [...side(A, 'A'), ...side(B, 'B')];
  // sel: union per selector; fixed / error entries are skipped and said once
  const bySel = new Map(); const skipped = new Map(); // one note per (reason, sel), naming the sides
  const skip = (why, r) => { const k = `${why}:${r.sel}`; if (!skipped.has(k)) skipped.set(k, { why, sel: r.sel, sides: [] }); const e = skipped.get(k); if (!e.sides.includes(r._side)) e.sides.push(r._side); };
  for (const r of all.filter((x) => x.kind === 'sel')) {
    if (r.error) { skip('error', r); continue; }
    if (r.fixed) { skip('fixed', r); continue; }
    if (declared && !(r.sel in declared.classBySel)) throw new Error(`sidecar ${r._side} carries a --mask-sel rect for "${r.sel}" that masks.json does not declare — only inventory-declared regions are masked (add it with class + source, or recapture without it)`);
    if (!bySel.has(r.sel)) bySel.set(r.sel, { A: [], B: [] });
    bySel.get(r.sel)[r._side].push(rectOf(r));
  }
  for (const [k, e] of skipped) notes.push({ key: k, msg: e.why === 'error' ? `mask sel "${e.sel}": bad selector on ${e.sides.join(', ')} — skipped` : `mask sel ${e.sel}: inside pinned chrome on ${e.sides.join(', ')} — recorded, not masked (fixed-disc-at-seams)` });
  for (const [sel, sides] of bySel) {
    const sd = sides.A.length && sides.B.length ? 'both' : sides.A.length ? 'A' : 'B';
    masks.push({ kind: 'sel', class: (declared && declared.classBySel[sel]) || AUTO_MASK_CLASS.sel, label: sel, sel, rects: [...sides.A, ...sides.B], side: sd, ...(sd !== 'both' ? { asymmetric: true } : {}) });
  }
  if (iframes) {
    const fa = all.filter((x) => x.kind === 'iframe' && x._side === 'A'); const fb = all.filter((x) => x.kind === 'iframe' && x._side === 'B');
    const { pairs, onlyA, onlyB } = pairRects(fa, fb);
    const lab = (r) => (r.src ? r.src.slice(0, 40) : `iframe@${r.x},${r.y}`);
    for (const [a, b] of pairs) masks.push({ kind: 'iframe', class: AUTO_MASK_CLASS.iframe, label: lab(a), src: a.src, rects: [rectOf(a), rectOf(b)], side: 'both' });
    for (const [list, sd] of [[onlyA, 'A'], [onlyB, 'B']]) for (const r of list) masks.push({ kind: 'iframe', class: AUTO_MASK_CLASS.iframe, label: lab(r), src: r.src, rects: [rectOf(r)], side: sd, asymmetric: true });
  }
  if (images) {
    const ia = all.filter((x) => x.kind === 'img' && x._side === 'A'); const ib = all.filter((x) => x.kind === 'img' && x._side === 'B');
    const { pairs, onlyA, onlyB } = pairRects(ia, ib);
    for (const [a, b] of pairs) masks.push({ kind: 'img', class: AUTO_MASK_CLASS.img, label: `img@${a.x},${a.y} ${a.w}×${a.h}`, rects: [rectOf(a), rectOf(b)], side: 'both' });
    imagesUnmatched = onlyA.length + onlyB.length; // moved / missing / resized: stays in the number
  }
  return { masks, notes, imagesUnmatched };
}
/**
 * Rasterise the masks into a per-pixel Uint8Array (w×h, 1 = masked) and count
 * each mask's OWN newly-masked pixels. Returns { px, rows (fully masked rows,
 * Uint8Array h), maskedPixels }.
 */
export function rasterMasks(masks, w, h) {
  const px = new Uint8Array(w * h); let maskedPixels = 0;
  for (const m of masks) {
    m.pixels = 0;
    for (const r of m.rects) {
      const x0 = Math.max(0, r.x); const x1 = Math.min(w, r.x + r.w); const y0 = Math.max(0, r.y); const y1 = Math.min(h, r.y + r.h);
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const i = y * w + x; if (!px[i]) { px[i] = 1; m.pixels += 1; maskedPixels += 1; } }
    }
    m.areaPct = Number(((100 * m.pixels) / (w * h)).toFixed(1));
  }
  const rows = new Uint8Array(h);
  for (let y = 0; y < h; y += 1) { let full = 1; for (let x = 0; x < w; x += 1) if (!px[y * w + x]) { full = 0; break; } rows[y] = full; }
  return { px, rows, maskedPixels };
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
  // --masks-json --check: validate the project's mask inventory and print the
  // capture flags it implies (gate.sh: before the first capture; exit 1 names the entry).
  if (opts.check) { const m = loadMasksJson(opts.masksJson); console.log(JSON.stringify(maskFlagsOf(m))); return; }
  if (!opts.worker && opts.timeout > 0) { supervise(opts.timeout); return; }
  const declared = opts.masksJson ? loadMasksJson(opts.masksJson) : null;
  if (declared) { opts.maskIframes = opts.maskIframes || declared.iframes; opts.maskImages = opts.maskImages || declared.images; }
  // Comparability first (rule 15): same instrument, width, vh, dpr, consent mode.
  const prov = requireComparable('pixel-compare', aPath, bPath, { force: opts.force });
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const heightDelta = a.height - b.height;

  const ca = cropTo(a, w, h);
  const cb = cropTo(b, w, h);
  // Masks — ONE rect model: --mask bands are full-width rects; --mask-from
  // brings the sidecars' masksRects (sel: union of both sides; iframe: paired
  // or asymmetric; img: paired within ±2 px only). Every rect is painted one
  // flat colour on BOTH sides (so it can never differ) and removed from the
  // denominator — masking each side at its own place would compare grey
  // against real content on the other side and manufacture a false diff.
  // Before painting, take the UNMASKED number off the same buffers: an outside
  // audit reads the page with no masks, and a ledger that carries only the
  // masked figure cannot be reconciled with it (residual logging format,
  // `pixelPctUnmasked`). One extra pass, only when masks apply.
  let sideRects = { A: null, B: null, from: [] };
  if (opts.maskFrom) {
    const files = opts.maskFrom === 'auto' ? [`${aPath}.json`, `${bPath}.json`] : opts.maskFrom;
    const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
    const [sa, sb] = files.length === 2 ? files.map(rd) : [rd(files[0]), rd(files[0])];
    sideRects = { A: sa && sa.masksRects, B: sb && sb.masksRects, from: files };
    if (!sideRects.A && !sideRects.B) { console.error(`pixel-compare: --mask-from — no masksRects[] in ${files.join(' or ')}: capture both sides with stitch-shot --mask-sel / --mask-iframes / --mask-images (or --masks-json) first. Not a verdict (exit 1).`); process.exit(1); }
    if (!sideRects.A || !sideRects.B) console.error(`pixel-compare: masksRects[] on ${sideRects.A ? 'A' : 'B'} only — the other capture was taken without the mask flags; the union still applies to both sides, but recapture it with the same flags for a gate number.`);
  }
  const { masks, notes, imagesUnmatched } = buildMasks({ bands: opts.masks, A: sideRects.A, B: sideRects.B, iframes: opts.maskIframes, images: opts.maskImages, declared, width: w });
  const nUnmasked = masks.length ? pixelmatch(ca.data, cb.data, null, w, h, { threshold: opts.pmThreshold }) : null;
  const { px: maskPx, rows: masked, maskedPixels } = rasterMasks(masks, w, h);
  if (maskedPixels) for (let i = 0; i < w * h; i += 1) if (maskPx[i]) { ca.data.fill(128, i * 4, i * 4 + 4); cb.data.fill(128, i * 4, i * 4 + 4); }
  let maskedRows = 0; for (let y = 0; y < h; y += 1) maskedRows += masked[y];
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: opts.pmThreshold });
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, PNG.sync.write(diff));
  const denom = w * h - maskedPixels;
  const pct = denom > 0 ? (100 * n) / denom : 0;
  const pctUnmasked = nUnmasked === null ? pct : (100 * nUnmasked) / (w * h);
  const maskedPct = Number(((100 * maskedPixels) / (w * h)).toFixed(1));
  const imagePct = masks.filter((m) => m.kind === 'img').reduce((acc, m) => acc + m.pixels, 0) * 100 / (w * h);
  const photoDominated = imagePct > 60 ? Number((100 - imagePct).toFixed(1)) : null; // % of the page the masked number still covers
  const maskOut = masks.map(({ rects, pixels, label, ...m }) => ({ ...m, rects, pixels, label }));

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
  const summary = { a: aPath, b: bPath, compared: { width: w, height: h }, heightDelta, differingPixels: n, pct: Number(pct.toFixed(2)), pixelPct: Number(pct.toFixed(2)), pixelPctUnmasked: Number(pctUnmasked.toFixed(2)), threshold: opts.threshold, pass, diff: opts.out, masks: maskOut, maskedPixels, maskedPct, maskedRows, ...(sideRects.from.length ? { masksFrom: sideRects.from, masksSkipped: notes.map((x) => x.msg), imagesUnmatched } : {}), ...(opts.masksJson ? { masksJson: opts.masksJson } : {}), ...(photoDominated !== null ? { photoDominated, imageMaskPct: Number(imagePct.toFixed(1)) } : {}), bands: bandsOut.map((x) => ({ ...x, pct: Number(x.pct.toFixed(1)) })), ...(opts.offsets ? { offsets: { range: Math.max(opts.offsetRange, Math.abs(heightDelta) + 40), firstSeam } } : {}), ...(review ? { review } : {}), ...prov };
  if (opts.jsonOut) { mkdirSync(dirname(opts.jsonOut), { recursive: true }); writeFileSync(opts.jsonOut, `${JSON.stringify(summary, null, 2)}\n`); }
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`A ${a.width}x${a.height}  B ${b.width}x${b.height}  → compare ${w}x${h}, height delta ${heightDelta}px`);
    if (Math.abs(heightDelta) > 8) console.log(`  ⚠ height delta ${heightDelta}px — overlap-crop hides the tail; fix heights before trusting the %`);
    console.log(`differing pixels: ${n} / ${denom} = ${pct.toFixed(2)}%  (threshold ${opts.threshold}%) → ${pass ? 'PASS' : 'FAIL'}${masks.length ? `  [MASKED ${masks.length} mask(s), ${maskedPct}% of area: ${masks.map((m) => `${m.kind}/${m.class} ${m.label} (${m.areaPct}%${m.asymmetric ? `, asymmetric ${m.side}` : ''})`).join(', ')} — excluded from the number; unmasked ${pctUnmasked.toFixed(2)}%]` : ''}`);
    for (const x of notes) console.log(`  ${x.msg}`);
    if (opts.maskImages && sideRects.from.length) console.log(`  images: ${masks.filter((m) => m.kind === 'img').length} paired within ±2 px and masked, ${imagesUnmatched} unmatched (moved / missing / resized) kept in the number`);
    if (photoDominated !== null) console.log(`  photo-dominated: masked number covers ${photoDominated} % of the page (image masks ${imagePct.toFixed(1)} %) — the ledger carries this line`);
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
