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
 *                          number is never reported as an unmasked one.
 *     --json               emit machine-readable summary on stdout
 *     --text-boxes <json>  AUXILIARY number (#125 D4): a JSON file with the
 *                          ORIGIN's text boxes ({ boxes: [{x,y,w,h}, …] } in A's
 *                          page coordinates — content-presence.mjs --json writes
 *                          one per side under `textBoxes`); the differing-pixel
 *                          share is re-computed over those boxes only and
 *                          reported as `textPct`. Pixelmatch underweights small
 *                          text inside otherwise matching shapes (a recorded page
 *                          read 6.7 % full-page, 16.5 % text-only). Not a verdict
 *                          criterion; summary.md carries it beside the pixel %.
 *     --align              ALIGNED comparison beside the overlap one (opt-in). The
 *                          overlap number lays B on A from the top-left corner, so
 *                          one vertical shift near the top makes every row below it
 *                          differ. --align finds a piecewise-constant vertical offset
 *                          map (see "Aligned mode" below), re-counts with the same
 *                          per-pixel rule and reports it as `aligned` — offset steps,
 *                          inserted / deleted rows, and a per-band aligned % that
 *                          names every band still differing, in one run.
 *     --align-max <px>     largest |offset| the map may reach (default 400, cap 4000)
 *     --verdict <which>    unaligned (default) | aligned — which number the exit
 *                          code and `pass` compare against --threshold. `aligned`
 *                          implies --align.
 *     --offset-max <b>     THE PIXEL CRITERION of the gates (gate.sh, gate-all.mjs —
 *                          its one definition, `pixelVerdict`): implies --verdict
 *                          aligned, and `pass` / the exit code also need the offsets
 *                          to be small — aligned % ≤ --threshold AND
 *                          aligned.totalShift (the sum of |shift| over the steps) ≤
 *                          the bound. <b> = a number of px, or a stage: `prototype`
 *                          = 8 px, `published` = the larger of 8 px and 1 % of A's
 *                          height. A low aligned % with large offsets is a page
 *                          whose sections sit in the wrong place: it fails with
 *                          `offsets: <n> step(s), <px>px total — …` (the fix list:
 *                          every step in one round), never a percentage. Alignment
 *                          not used (`aligned.used` false) → the unaligned rule.
 *                          Adds `offsets { bound, totalShift, pass }` and `reason`
 *                          to the JSON and one `pixel:` line to the text.
 *     --json-out <file>    also write the --json summary to <file> (the text output
 *                          stays on stdout) — gate.sh's pixel-<label>.json
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
 * Aligned mode (--align). B's rows are A's rows moved by an integer offset that
 * is constant within a segment; between segments rows were inserted in B
 * (shift > 0) or deleted from it (shift < 0).
 *   1. Each row of both images becomes a signature: mean luminance in up to 48
 *      column buckets plus two colour-difference means in a quarter as many.
 *   2. A banded global sequence alignment (affine gaps, integer costs, offset
 *      within ±--align-max) matches A rows to B rows. A matched pair costs its
 *      signature distance (capped); an unmatched row costs more than half that
 *      cap, so "delete here, insert there" never beats comparing in place; and
 *      opening a gap costs ALIGN.minRun fully mismatching rows — a third of that
 *      where the first unmatched row is uniform (a blank separator).
 *   3. A delete next to an insert is folded: the rows are paired and compared.
 *   4. Each offset change is moved to the last row that splits its stretch best
 *      (so the rows after it are the ones it explains) and re-decided on pixels: it may stay only
 *      when at least ALIGN.minRun rows follow it and those rows differ at most
 *      half as much under the new offset as under the one before, and the set
 *      that stays is the one with the lowest count of step 5.
 *   5. The count: matched rows by pixelmatch (same --pm-threshold); every A row
 *      without a B row (deleted) and every B row without an A row (inserted) as
 *      a fully differing row. Denominator = width × (A rows + inserted B rows −
 *      masked rows). --mask rows are painted flat before step 1 (A's range in A,
 *      B's range in B) and excluded: a matched pair when either row is masked,
 *      an unmatched row when it is masked on its own side.
 *   6. The aligned number is never above the overlap number: when it is not
 *      lower, or the map is implausible (more than ALIGN.maxSteps steps, or
 *      back-and-forth shifts above ALIGN.maxChurn rows), `aligned.used` is false,
 *      `aligned.reason` says why and the aligned figures equal the overlap ones.
 * steps[] = { y, shift, cumulative }: y in A's rows; the shifts sum to
 * B height − A height. What alignment cannot hide: a changed region is either
 * compared in place or counted whole as unmatched rows. Its limit: content
 * that really is a vertical move of the same pixels reads as a move.
 *
 * Example:
 *   node skills/replica/scripts/pixel-compare.mjs \
 *     stardust/replica/gates/home-1440/live.png \
 *     stardust/replica/gates/home-1440/proto.png \
 *     --out stardust/replica/gates/home-1440/diff.png
 *
 * Requires: pixelmatch, pngjs (project devDependencies).
 * Exit codes: 0 under threshold, 1 error, 2 over threshold (gate FAIL; on the
 * overlap number unless --verdict aligned; under --offset-max also offsets over
 * the bound), 124 deadline exceeded (see
 * --timeout; not a measurement).
 * Note: the height delta does NOT affect the exit code — the SKILL gate
 * requires height Δ ≈ 0 separately; a large delta is printed as a warning
 * because the overlap-crop can make the % look artificially healthy.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len */
// pngjs and pixelmatch load inside main(): the aligner below is pure and its test imports this module without them.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, rmSync } from 'fs';
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
  --text-boxes <json> also report the % over the origin's text boxes only — auxiliary (#125 D4)
  --align             also compute the ALIGNED number: a piecewise-constant vertical offset map
                      between A and B (rows inserted / deleted in B), so one shift near the top
                      does not make every row below it differ. Adds \`aligned\` to --json
                      { used, pct, differingPixels, compared, steps: [{ y, shift, cumulative }],
                      maxOffset, totalShift, insertedRows, deletedRows, bands, diff, reason }, one
                      "aligned:" line and a per-band aligned % to the text output, and
                      <out stem>-aligned.png (A's coordinates; unmatched rows solid red).
                      Unmatched rows count as fully differing; denominator = width x (A rows +
                      inserted B rows - masked rows). Never above the unaligned number: when it
                      is not lower or the map is implausible, used is false and it equals it.
  --align-max <px>    largest |offset| the map may reach (default 400)
  --verdict <which>   unaligned (default) | aligned: the number the exit code and \`pass\` use
                      against --threshold; aligned implies --align
  --offset-max <b>    the gates' pixel criterion (implies --verdict aligned): pass = aligned % <= threshold
                      AND aligned.totalShift <= the bound — <b> px, or a stage: prototype = 8,
                      published = the larger of 8 and 1 % of A's height. Over the bound the reason is
                      "offsets: <n> step(s), <px>px total — …" (the fix list), not a percentage; alignment
                      not used → the unaligned rule. JSON: offsets { bound, totalShift, pass }, reason
  --json-out <file>   also write the --json summary to <file> (text stays on stdout)
  --timeout <s>       hard deadline, exit 124 when hit (default 120; 0 disables)
  --help              this text

Convention: <a.png> = live/source capture, <b.png> = prototype capture.`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { out: 'diff.png', threshold: 10, band: 500, pmThreshold: 0.1, json: false, masks: [], timeout: 120, worker: false, textBoxes: null, align: false, alignMax: 400, verdict: 'unaligned', offsetMax: null, jsonOut: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--threshold') { opts.threshold = Number(rest[i += 1]); }
    else if (a === '--band') { opts.band = Number(rest[i += 1]); }
    else if (a === '--pm-threshold') { opts.pmThreshold = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a === '--worker') { opts.worker = true; }
    else if (a === '--text-boxes') { opts.textBoxes = rest[i += 1]; }
    else if (a === '--align') { opts.align = true; }
    else if (a === '--align-max') {
      opts.alignMax = Number(rest[i += 1]);
      if (!Number.isInteger(opts.alignMax) || opts.alignMax < 1 || opts.alignMax > 4000) { console.error(`bad --align-max "${rest[i]}" — expected an integer 1..4000\n\n${HELP}`); process.exit(1); }
    }
    else if (a === '--verdict') {
      opts.verdict = rest[i += 1];
      if (opts.verdict !== 'aligned' && opts.verdict !== 'unaligned') { console.error(`bad --verdict "${opts.verdict}" — expected unaligned or aligned\n\n${HELP}`); process.exit(1); }
    }
    else if (a === '--offset-max') {
      const v = rest[i += 1];
      opts.offsetMax = v === 'prototype' || v === 'published' ? v : Number(v);
      if (typeof opts.offsetMax === 'number' && !(Number.isFinite(opts.offsetMax) && opts.offsetMax >= 0 && v !== '' && v !== undefined)) { console.error(`bad --offset-max "${v}" — expected a number of px, prototype or published\n\n${HELP}`); process.exit(1); }
      opts.verdict = 'aligned';
    }
    else if (a === '--json-out') { opts.jsonOut = rest[i += 1]; }
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
  if (opts.verdict === 'aligned') opts.align = true;
  const [aPath, bPath] = pos;
  if (!aPath || !bPath) { console.error(`need <a.png> and <b.png>\n\n${HELP}`); process.exit(1); }
  return { aPath, bPath, opts };
}

// ── Aligned mode (--align; header "Aligned mode") ────────────────────────────
// Pure and deterministic: integer arithmetic, fixed tie-breaks, no pngjs / pixelmatch — the per-pixel rule comes in
// as `countDiff(a, b, out|null, w, rows) → differing pixels` (pixelmatch in main(), a stand-in in the test).
export const ALIGN = {
  buckets: 48, // luminance buckets per row (fewer on narrow images)
  tol: 2, // per-bucket difference ignored as rendering noise
  capPerBucket: 4, // row-pair cost cap = capPerBucket × signature length
  minRun: 24, // rows: a gap costs this many fully mismatching rows to open; a step needs this many rows after it
  flatOpenDiv: 3, // opening a gap on a uniform row costs 1/flatOpenDiv of that
  flatRange: 6, // a row is uniform when its luminance spans at most this
  keepRatio: 0.5, // a step stays when its rows differ at most this share of what they differ under the previous offset
  window: 5, // distinct earlier offsets a segment may fall back to
  maxSteps: 40, // more steps than this = implausible map → used: false
  maxChurn: 600, // back-and-forth rows (Σ|shift| − |Σshift|) above this = implausible map → used: false
};
const NONE = -0x40000000;

function cropWidth(img, w) {
  if (img.width === w) return { width: w, height: img.height, data: img.data };
  const data = Buffer.allocUnsafe(w * img.height * 4);
  for (let y = 0; y < img.height; y += 1) img.data.copy(data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
  return { width: w, height: img.height, data };
}

// The aligned diff picture beside <out>: <out stem>-aligned.png (diff-report's pickDiff skips it).
export const alignedPathOf = (stem) => `${stem}-aligned.png`;
// A mean colour difference (−255..255) as one signature byte: 128 ± half, clamped — 128 + 128 would wrap to 0.
export const chroma = (mean) => Math.max(0, Math.min(255, 128 + Math.round(mean / 2)));
// Per-row signature of an RGBA buffer: K luminance means, then C (R−G) and C (B−G) means; `flat` marks uniform rows.
export function rowSignatures(data, w, h) {
  const K = Math.max(1, Math.min(ALIGN.buckets, w >> 2)); const C = Math.max(1, K >> 2); const S = K + 2 * C;
  const sig = new Uint8Array(h * S); const flat = new Uint8Array(h);
  const kOf = new Uint8Array(w); const cOf = new Uint8Array(w); const kN = new Int32Array(K); const cN = new Int32Array(C);
  for (let x = 0; x < w; x += 1) { kOf[x] = Math.min(K - 1, Math.floor((x * K) / w)); cOf[x] = Math.min(C - 1, Math.floor((x * C) / w)); kN[kOf[x]] += 1; cN[cOf[x]] += 1; }
  const lum = new Int32Array(K); const cr = new Int32Array(C); const cb = new Int32Array(C);
  for (let y = 0; y < h; y += 1) {
    lum.fill(0); cr.fill(0); cb.fill(0);
    let lo = 255; let hi = 0; let p = y * w * 4;
    for (let x = 0; x < w; x += 1, p += 4) {
      const r = data[p]; const g = data[p + 1]; const b = data[p + 2];
      const l = (77 * r + 150 * g + 29 * b) >> 8;
      if (l < lo) lo = l; if (l > hi) hi = l;
      lum[kOf[x]] += l; cr[cOf[x]] += r - g; cb[cOf[x]] += b - g;
    }
    const o = y * S;
    for (let k = 0; k < K; k += 1) sig[o + k] = Math.round(lum[k] / kN[k]);
    for (let c = 0; c < C; c += 1) { sig[o + K + c] = chroma(cr[c] / cN[c]); sig[o + K + C + c] = chroma(cb[c] / cN[c]); }
    flat[y] = hi - lo <= ALIGN.flatRange ? 1 : 0;
  }
  return { sig, S, flat, rows: h };
}

// Banded global alignment of A's rows to B's rows, affine gaps. Cell (i, d): i rows of A and i + d rows of B consumed,
// |d| ≤ max. States: 0 = last pair matched, 1 = last A row unmatched (deleted in B), 2 = last B row unmatched
// (inserted in B). Returns, per A row, the offset of the B row it is matched to, or NONE.
export function alignRows(sa, sb, { max = 400 } = {}) {
  const A = sa.sig; const B = sb.sig; const { S } = sa; const fA = sa.flat; const fB = sb.flat;
  const HA = sa.rows; const HB = sb.rows;
  const M = Math.max(1, Math.min(max, Math.max(HA, HB)));
  const n = Math.min(HA, HB + M); // A rows past HB + M can match nothing: they stay unmatched
  const D = 2 * M + 1; const INF = 0x3fffffff; const { tol } = ALIGN;
  const CAP = ALIGN.capPerBucket * S; const EXT = (CAP >> 1) + 1; const OPEN = ALIGN.minRun * CAP; const OPENF = Math.floor(OPEN / ALIGN.flatOpenDiv);
  let pM = new Int32Array(D); let pX = new Int32Array(D); let pY = new Int32Array(D);
  let cM = new Int32Array(D).fill(INF); let cX = new Int32Array(D).fill(INF); let cY = new Int32Array(D).fill(INF);
  const tb = new Uint8Array((n + 1) * D);
  cM[M] = 0;
  for (let di = M + 1; di < D && di - M <= HB; di += 1) {
    const fromM = cM[di - 1] + (fB[di - M - 1] ? OPENF : OPEN); const fromY = cY[di - 1];
    if (fromM <= fromY) { cY[di] = fromM + EXT; } else { cY[di] = fromY + EXT; tb[di] = 2 << 4; }
  }
  for (let i = 1; i <= n; i += 1) {
    let t = pM; pM = cM; cM = t; t = pX; pX = cX; cX = t; t = pY; pY = cY; cY = t;
    cM.fill(INF); cX.fill(INF); cY.fill(INF);
    const lo = Math.max(0, M - i); const hi = Math.min(D - 1, HB - i + M);
    const ao = (i - 1) * S; const oA = fA[i - 1] ? OPENF : OPEN; const row = i * D;
    for (let di = lo; di <= hi; di += 1) {
      const j = i + di - M; let bits = 0;
      if (j >= 1) {
        let best = pM[di]; let st = 0;
        if (pX[di] < best) { best = pX[di]; st = 1; }
        if (pY[di] < best) { best = pY[di]; st = 2; }
        if (best < INF) {
          let c = 0; const bo = (j - 1) * S;
          for (let k = 0; k < S; k += 1) {
            let v = A[ao + k] - B[bo + k]; if (v < 0) v = -v;
            if (v > tol) { c += v - tol; if (c >= CAP) { c = CAP; break; } }
          }
          cM[di] = best + c; bits = st;
        }
      }
      if (di + 1 < D) {
        let best = pM[di + 1] + oA; let st = 0;
        if (pX[di + 1] < best) { best = pX[di + 1]; st = 1; }
        if (pY[di + 1] + oA < best) { best = pY[di + 1] + oA; st = 2; }
        if (best < INF) { cX[di] = best + EXT; bits |= st << 2; }
      }
      if (j >= 1 && di > lo) {
        const oB = fB[j - 1] ? OPENF : OPEN;
        let best = cM[di - 1] + oB; let st = 0;
        if (cX[di - 1] + oB < best) { best = cX[di - 1] + oB; st = 1; }
        if (cY[di - 1] < best) { best = cY[di - 1]; st = 2; }
        if (best < INF) { cY[di] = best + EXT; bits |= st << 4; }
      }
      tb[row + di] = bits;
    }
  }
  // end: all n rows of A consumed; B rows left over are one more gap
  let endCost = INF; let di = M; let st = 0;
  const lo = Math.max(0, M - n); const hi = Math.min(D - 1, HB - n + M);
  for (let e = lo; e <= hi; e += 1) {
    const j = n + e - M; const left = HB - j;
    const tailOpen = left > 0 ? (fB[j] ? OPENF : OPEN) + EXT * left : 0;
    const cand = [cM[e] + tailOpen, cX[e] + tailOpen, cY[e] + (left > 0 ? EXT * left : 0)];
    for (let s = 0; s < 3; s += 1) if (cand[s] < endCost) { endCost = cand[s]; di = e; st = s; }
  }
  const dOf = new Int32Array(HA).fill(NONE);
  let i = n;
  while (i > 0 || di !== M) {
    const bits = tb[i * D + di];
    if (st === 0) { dOf[i - 1] = di - M; st = bits & 3; i -= 1; }
    else if (st === 1) { st = (bits >> 2) & 3; i -= 1; di += 1; }
    else { st = (bits >> 4) & 3; di -= 1; }
  }
  return { dOf, cost: endCost };
}

// Matched runs → breakpoints { a0: first A row of the run, d: its offset }, in order, d differing from the run before.
export function offsetBreakpoints(dOf) {
  const bps = []; let d = 0;
  for (let i = 0; i < dOf.length; i += 1) {
    if (dOf[i] === NONE || dOf[i] === d) continue;
    d = dOf[i]; bps.push({ a0: i, d });
  }
  return bps;
}

// Where exactly a change takes effect is a tie wherever the rows match under neither offset (a replaced section) or
// under both (a blank band): each breakpoint is moved to the LAST row that splits its stretch best between the
// offset before and its own, so the rows after it are the ones that match under the new offset — the evidence
// chooseOffsets asks for.
export function settleBreakpoints(bps, sa, sb) {
  const { S } = sa; const CAP = ALIGN.capPerBucket * S; const HB = sb.rows;
  const cost = (i, d) => {
    const j = i + d; if (j < 0 || j >= HB) return CAP;
    let c = 0; const ao = i * S; const bo = j * S;
    for (let k = 0; k < S; k += 1) { let v = sa.sig[ao + k] - sb.sig[bo + k]; if (v < 0) v = -v; if (v > ALIGN.tol) { c += v - ALIGN.tol; if (c >= CAP) return CAP; } }
    return c;
  };
  const out = []; let dp = 0;
  bps.forEach(({ a0, d }, k) => {
    const end = k + 1 < bps.length ? bps[k + 1].a0 : sa.rows;
    let own = 0; for (let i = a0; i < end; i += 1) own += cost(i, d);
    let best = own; let at = a0; let run = own;
    for (let r = a0 + 1; r <= end; r += 1) { run += cost(r - 1, dp) - cost(r - 1, d); if (run <= best) { best = run; at = r; } }
    if (at < end) out.push({ a0: at, d });
    dp = d;
  });
  return out;
}

// Step 4 of the header: which offset changes stay, decided on pixels. Segment k = the rows from breakpoint k to the
// next one; it may run at its own offset or at one of the offsets before it (the last ALIGN.window distinct ones,
// and 0). A segment may CHANGE offset only on evidence (ALIGN.minRun rows, differing at most ALIGN.keepRatio of what
// they differ under the offset it would otherwise keep), and the choice minimises the number that is reported:
// differing pixels + width × rows left unmatched by every change and by the height difference at the end.
// evalRows(y0, y1, d) → differing pixels of A rows y0..y1 against B rows y0+d..y1+d.
export function chooseOffsets(bps, HA, HB, w, evalRows) {
  if (!bps.length) return [];
  const segs = [{ y0: 0, y1: bps[0].a0, cands: [0] }];
  const recent = [0];
  bps.forEach(({ a0, d }, k) => {
    const at = recent.indexOf(d); if (at >= 0) recent.splice(at, 1);
    recent.push(d);
    const cands = recent.slice(-ALIGN.window); if (!cands.includes(0)) cands.unshift(0);
    segs.push({ y0: a0, y1: k + 1 < bps.length ? bps[k + 1].a0 : HA, cands });
  });
  let prevCost = new Map([[0, 0]]); const back = [];
  for (const seg of segs) {
    const memo = new Map();
    const ev = (d) => { if (!memo.has(d)) memo.set(d, evalRows(seg.y0, seg.y1, d)); return memo.get(d); };
    const cost = new Map(); const from = new Map();
    for (const c of seg.cands) {
      let best = Infinity; let bestP = null;
      for (const [p, pc] of prevCost) {
        let t;
        if (p === c) t = pc;
        else if (seg.y1 - seg.y0 >= ALIGN.minRun && ev(p) > 0 && ev(c) <= ev(p) * ALIGN.keepRatio) t = pc + Math.abs(c - p) * w;
        else continue;
        if (t < best || (t === best && p === c)) { best = t; bestP = p; }
      }
      if (bestP !== null) { cost.set(c, best + ev(c)); from.set(c, bestP); }
    }
    prevCost = cost; back.push(from);
  }
  let end = 0; let endCost = Infinity;
  for (const [c, cc] of prevCost) { const t = cc + Math.abs(HB - HA - c) * w; if (t < endCost) { endCost = t; end = c; } }
  const chosen = new Array(segs.length);
  for (let k = segs.length - 1, c = end; k >= 0; k -= 1) { chosen[k] = c; c = back[k].get(c); }
  const kept = []; let dp = 0;
  for (let k = 1; k < segs.length; k += 1) if (chosen[k] !== dp) { dp = chosen[k]; kept.push({ a0: segs[k].y0, d: dp }); }
  return kept;
}

// Breakpoints → the row map (B row per A row, −1 = no counterpart). A delete next to an insert is folded here: the
// run before a breakpoint is extended over the rows both sides have, so a boundary is a pure insert or a pure delete.
export function offsetMap(bps, HA, HB) {
  const mapB = new Int32Array(HA).fill(-1);
  let lastJ = -1; let dp = 0; let from = 0;
  const fill = (y0, y1, d) => {
    for (let i = y0; i < y1; i += 1) { const j = i + d; if (j > lastJ && j < HB) { mapB[i] = j; lastJ = j; } }
  };
  for (const { a0, d } of bps) {
    const y = d > dp ? a0 : Math.max(from, a0 - (dp - d));
    fill(from, y, dp);
    from = y + Math.max(0, dp - d); dp = d;
  }
  fill(Math.min(from, HA), HA, dp);
  return mapB;
}

// The row map → steps { y, shift, cumulative } (their shifts sum to HB − HA), the inserts (B rows without an A row,
// attributed to the A row they precede) and the row counts.
export function stepsOf(mapB, HA, HB) {
  const steps = []; const inserts = [];
  let cum = 0; let lastJ = -1; let del = 0; let insertedRows = 0; let deletedRows = 0; let maxOffset = 0; let totalShift = 0;
  const boundary = (i, j) => {
    const ins = j - lastJ - 1;
    if (ins > 0) { inserts.push({ y: i, j0: lastJ + 1, count: ins }); insertedRows += ins; }
    const shift = ins - del;
    if (shift !== 0) {
      cum += shift; steps.push({ y: i - del, shift, cumulative: cum });
      totalShift += Math.abs(shift); if (Math.abs(cum) > maxOffset) maxOffset = Math.abs(cum);
    }
    del = 0;
  };
  for (let i = 0; i < HA; i += 1) {
    const j = mapB[i];
    if (j < 0) { del += 1; deletedRows += 1; continue; }
    boundary(i, j); lastJ = j;
  }
  boundary(HA, HB);
  return { steps, inserts, insertedRows, deletedRows, maxOffset, totalShift };
}

const isRed = (data, i) => data[i] === 255 && data[i + 1] < 100;

// The aligned candidate for two same-width RGBA buffers (masked rows already painted flat by the caller).
// Returns the map's steps and the count of header step 5; the caller decides `used` (never-worse, plausibility).
export function alignedCompare(A, B, w, HA, HB, { alignMax = 400, band = 500, maskA = null, maskB = null, countDiff }) {
  const stride = w * 4;
  const evalRows = (y0, y1, d) => {
    const s = Math.max(y0, -d); const e = Math.min(y1, HB - d); // rows whose B row exists
    if (e <= s) return (y1 - y0) * w;
    return ((s - y0) + (y1 - e)) * w + countDiff(A.subarray(s * stride, e * stride), B.subarray((s + d) * stride, (e + d) * stride), null, w, e - s);
  };
  const sa = rowSignatures(A, w, HA); const sb = rowSignatures(B, w, HB);
  const { dOf } = alignRows(sa, sb, { max: alignMax });
  const mapB = offsetMap(chooseOffsets(settleBreakpoints(offsetBreakpoints(dOf), sa, sb), HA, HB, w, evalRows), HA, HB);
  const shape = stepsOf(mapB, HA, HB);
  // B in A's coordinates; an unmatched A row is compared with itself and counted whole below
  const moved = Buffer.allocUnsafe(HA * stride);
  for (let i = 0; i < HA;) {
    let e = i + 1; const j = mapB[i];
    while (e < HA && (j < 0 ? mapB[e] < 0 : mapB[e] === j + (e - i))) e += 1;
    (j < 0 ? A : B).copy(moved, i * stride, (j < 0 ? i : j) * stride, (j < 0 ? e : j + (e - i)) * stride);
    i = e;
  }
  const diff = Buffer.alloc(HA * stride);
  if (HA > 0) countDiff(A, moved, diff, w, HA);
  const rowDiff = new Int32Array(HA); const rowDen = new Uint8Array(HA);
  let differing = 0; let rows = 0;
  for (let i = 0; i < HA; i += 1) {
    const j = mapB[i]; const o = i * stride;
    if ((maskA && maskA[i]) || (j >= 0 && maskB && maskB[j])) { diff.fill(128, o, o + stride); for (let x = 3; x < stride; x += 4) diff[o + x] = 255; continue; }
    let c = 0;
    if (j < 0) { c = w; for (let x = 0; x < stride; x += 4) { diff[o + x] = 255; diff[o + x + 1] = 0; diff[o + x + 2] = 0; diff[o + x + 3] = 255; } }
    else for (let x = 0; x < stride; x += 4) if (isRed(diff, o + x)) c += 1;
    rowDiff[i] = c; rowDen[i] = 1; differing += c; rows += 1;
  }
  const insAt = new Int32Array(HA + 1); // counted inserted rows per A row they precede
  for (const ins of shape.inserts) {
    let c = 0;
    for (let j = ins.j0; j < ins.j0 + ins.count; j += 1) if (!(maskB && maskB[j])) c += 1;
    insAt[ins.y] += c; differing += c * w; rows += c;
    // marker: a blue flag on the left edge where B has rows A lacks (drawn after the count)
    for (let y = ins.y; y < Math.min(HA, ins.y + Math.max(2, Math.min(c, 24))); y += 1) for (let x = 0; x < Math.min(w, 12); x += 1) { const p = y * stride + x * 4; diff[p] = 0; diff[p + 1] = 90; diff[p + 2] = 255; diff[p + 3] = 255; }
  }
  const bands = [];
  for (let y0 = 0; y0 < HA; y0 += band) {
    const y1 = Math.min(HA, y0 + band); let num = 0; let den = 0;
    for (let y = y0; y < y1; y += 1) { num += rowDiff[y] + insAt[y] * w; den += (rowDen[y] + insAt[y]) * w; }
    if (y1 === HA) { num += insAt[HA] * w; den += insAt[HA] * w; }
    bands.push({ y0, y1, pct: den ? (100 * num) / den : 0 });
  }
  const { steps, insertedRows, deletedRows, maxOffset, totalShift } = shape;
  return { differing, rows, pct: rows ? (100 * differing) / (rows * w) : 0, steps, insertedRows, deletedRows, maxOffset, totalShift, bands, diff };
}

// Header step 6: the reason a candidate map is not used, or null.
export function alignVerdict(cand, unalignedPct, heightDiff) {
  if (cand.steps.length > ALIGN.maxSteps) return `implausible map: ${cand.steps.length} offset steps (limit ${ALIGN.maxSteps})`;
  const churn = cand.totalShift - Math.abs(heightDiff);
  if (churn > ALIGN.maxChurn) return `implausible map: ${churn} rows of back-and-forth shift (limit ${ALIGN.maxChurn})`;
  if (!(cand.pct < unalignedPct)) return cand.steps.length ? 'aligned number not lower than the unaligned one' : 'no offset step found';
  return null;
}

const signed = (n) => `${n < 0 ? '−' : '+'}${Math.abs(n)}`;
export function alignedLine(al, pct) {
  if (!al.used) return `aligned: ${al.pct.toFixed(2)}% = unaligned — alignment not used (${al.reason}${al.candidate ? `; candidate ${al.candidate.pct.toFixed(2)}% with ${al.candidate.steps} steps` : ''})`;
  const shown = al.steps.slice(0, 8).map((s) => `${signed(s.shift)}px at y=${s.y}`).join(', ');
  return `aligned: ${al.pct.toFixed(2)}% (unaligned ${pct.toFixed(2)}%) — ${al.steps.length} offset step${al.steps.length === 1 ? '' : 's'}: ${shown}${al.steps.length > 8 ? ', …' : ''}${al.insertedRows || al.deletedRows ? `  [${al.insertedRows} rows only in B, ${al.deletedRows} only in A — counted as differing]` : ''}`;
}

// ── The gates' pixel criterion (--offset-max; header) — its one definition, read by gate.sh through this CLI and by
// gate-all.mjs through the import. Pure: `px` is this script's --json summary (an older one without `aligned` reads
// as alignment not used).
export const OFFSETS = { px: 8, share: 0.01, shown: 6, kept: 12 };
/** The bound in px: a number as given; 'prototype' → 8; 'published' → the larger of 8 and 1 % of the origin height; null → no bound. */
export function offsetBound(spec, originHeight = 0) {
  if (spec === null || spec === undefined || spec === '') return null;
  if (spec === 'prototype') return OFFSETS.px;
  if (spec === 'published') return Math.max(OFFSETS.px, Math.round(OFFSETS.share * (Number(originHeight) || 0)));
  return Number(spec);
}
/** `−5px at y=103, −20px at y=2125, … 2 more` — at most `max` steps. */
export function offsetsText(steps, max = OFFSETS.shown) {
  const list = steps || [];
  return `${list.slice(0, max).map((s) => `${signed(s.shift)}px at y=${s.y}`).join(', ')}${list.length > max ? `, … ${list.length - max} more` : ''}`;
}
/**
 * pixelVerdict(px, { threshold, offsetMax }) → { pass, used, pct, alignedPct, totalShift, steps (≤ 12), stepCount,
 * bound, offsetsPass, offsets, reason, line }. Used: aligned % ≤ threshold AND totalShift ≤ bound (offsetMax: px |
 * 'prototype' | 'published' | null = no bound). Not used: unaligned % ≤ threshold. `reason` (null on a pass) names the
 * offsets when they alone fail, else the percentage; `offsets` is the step list as text ('' when none).
 */
export function pixelVerdict(px, { threshold = 10, offsetMax = null } = {}) {
  const al = px && px.aligned && px.aligned.used ? px.aligned : null;
  const pct = px.pct; const alignedPct = al ? al.pct : pct;
  const all = al ? al.steps || [] : []; const totalShift = al ? al.totalShift || 0 : 0;
  const originH = px.compared && Number.isFinite(px.heightDelta) ? px.compared.height + Math.max(0, px.heightDelta) : 0;
  const bound = al ? offsetBound(offsetMax, originH) : null;
  const pctPass = alignedPct <= threshold; const offsetsPass = bound === null || totalShift <= bound;
  const offsets = all.length ? `offsets: ${all.length} step(s), ${totalShift}px total — ${offsetsText(all)}${bound === null ? '' : ` (bound ${bound}px)`}` : '';
  const shown = al ? `aligned ${alignedPct}% (unaligned ${pct}%)` : `${pct}%`;
  const reason = !pctPass ? `pixel ${shown} > ${threshold}%` : !offsetsPass ? offsets : null;
  const pass = pctPass && offsetsPass;
  const head = al ? `pixel: aligned ${alignedPct.toFixed(2)}% (unaligned ${pct.toFixed(2)}%)` : `pixel: ${pct.toFixed(2)}% (alignment not used — the unaligned number rules)`;
  const line = `${head}${pctPass ? '' : ` > ${threshold}%`} → ${pass ? 'PASS' : 'FAIL'}${offsets ? ` — ${offsets}` : ''}`;
  return { pass, used: !!al, pct, alignedPct, totalShift, steps: all.slice(0, OFFSETS.kept), stepCount: all.length, bound, offsetsPass, offsets, reason, line };
}

// --text-boxes: the share of differing pixels inside the origin's text boxes
// (A's page coordinates), read off the diff image already computed over the
// overlap crop. Masked rows are skipped like everywhere else. Exported for the test.
export function textBoxPct(diff, boxes, w, h, masked) {
  let total = 0; let differing = 0;
  for (const bx of boxes) {
    const x0 = Math.max(0, Math.floor(bx.x)); const x1 = Math.min(w, Math.ceil(bx.x + bx.w));
    const y0 = Math.max(0, Math.floor(bx.y)); const y1 = Math.min(h, Math.ceil(bx.y + bx.h));
    for (let y = y0; y < y1; y += 1) {
      if (masked && masked[y]) continue;
      for (let x = x0; x < x1; x += 1) {
        total += 1;
        const i = (y * w + x) * 4;
        if (diff.data[i] === 255 && diff.data[i + 1] < 100) differing += 1;
      }
    }
  }
  return { boxes: boxes.length, pixels: total, pct: total ? (100 * differing) / total : 0 };
}

function readTextBoxes(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.textBoxes || raw.boxes || []);
  return list.filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0);
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

async function main() {
  const { aPath, bPath, opts } = parseArgs(process.argv);
  if (!opts.worker && opts.timeout > 0) { await supervise(opts.timeout); return; }
  const { PNG } = await import('pngjs');
  const { default: pixelmatch } = await import('pixelmatch');
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const heightDelta = a.height - b.height;
  const stem = opts.out.replace(/\.png$/i, '');
  mkdirSync(dirname(opts.out), { recursive: true });

  // Full-height, width-cropped sides; the overlap compare reads their first h rows.
  const fa = cropWidth(a, w); const fb = cropWidth(b, w);
  // --align runs first: it needs each side masked at its OWN rows, and the union painted below is a superset.
  let cand = null;
  if (opts.align) {
    const maskA = new Uint8Array(a.height); const maskB = new Uint8Array(b.height);
    for (const mk of opts.masks) {
      for (let y = Math.max(0, mk.yA); y < Math.min(a.height, mk.yA + mk.h); y += 1) { maskA[y] = 1; fa.data.fill(128, y * w * 4, (y + 1) * w * 4); }
      for (let y = Math.max(0, mk.yB); y < Math.min(b.height, mk.yB + mk.h); y += 1) { maskB[y] = 1; fb.data.fill(128, y * w * 4, (y + 1) * w * 4); }
    }
    cand = alignedCompare(fa.data, fb.data, w, a.height, b.height, { alignMax: opts.alignMax, band: opts.band, maskA, maskB, countDiff: (x, y, out, ww, hh) => pixelmatch(x, y, out, ww, hh, { threshold: opts.pmThreshold }) });
  }

  const ca = { data: fa.data.subarray(0, h * w * 4) };
  const cb = { data: fb.data.subarray(0, h * w * 4) };
  // --mask: neutralise authored-volatile row bands. The masked rows are painted
  // one flat colour on BOTH sides (so they can never differ) and removed from the
  // denominator. When yA ≠ yB the UNION of both row ranges is masked on both
  // sides — masking each side at its own offset would compare grey against real
  // content on the other side and manufacture a false diff.
  const masked = new Uint8Array(h);
  for (const mk of opts.masks) {
    for (const y0 of [mk.yA, mk.yB]) for (let y = Math.max(0, y0); y < Math.min(h, y0 + mk.h); y += 1) masked[y] = 1;
  }
  let maskedRows = 0;
  for (let y = 0; y < h; y += 1) {
    if (!masked[y]) continue;
    maskedRows += 1;
    for (const img of [ca, cb]) img.data.fill(128, y * w * 4, (y + 1) * w * 4);
  }
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: opts.pmThreshold });
  writeFileSync(opts.out, PNG.sync.write(diff));
  const denom = w * (h - maskedRows);
  const pct = denom > 0 ? (100 * n) / denom : 0;

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

  // --align: the candidate is used only when it is plausible and LOWER; otherwise the aligned figures are the overlap ones.
  let aligned = null;
  if (cand) {
    const reason = alignVerdict(cand, pct, b.height - a.height);
    const r1 = (x) => Number(x.toFixed(1));
    if (reason) {
      rmSync(alignedPathOf(stem), { force: true }); // an earlier run's aligned picture is not this run's
      aligned = { used: false, pct: Number(pct.toFixed(2)), differingPixels: n, compared: { width: w, height: h, mode: 'overlap' }, steps: [], maxOffset: 0, totalShift: 0, insertedRows: 0, deletedRows: 0, bands: bands.map((x) => ({ y0: x.y0, y1: x.y1, pct: r1(x.pct), unaligned: r1(x.pct) })), diff: null, reason, candidate: { pct: Number(cand.pct.toFixed(2)), steps: cand.steps.length, totalShift: cand.totalShift } };
    } else {
      const alignedOut = alignedPathOf(stem);
      writeFileSync(alignedOut, PNG.sync.write({ width: w, height: a.height, data: cand.diff }));
      aligned = { used: true, pct: Number(cand.pct.toFixed(2)), differingPixels: cand.differing, compared: { width: w, height: cand.rows, mode: 'aligned' }, steps: cand.steps, maxOffset: cand.maxOffset, totalShift: cand.totalShift, insertedRows: cand.insertedRows, deletedRows: cand.deletedRows, bands: cand.bands.map((x, i) => ({ y0: x.y0, y1: x.y1, pct: r1(x.pct), unaligned: bands[i] && bands[i].y1 === x.y1 ? r1(bands[i].pct) : null })), diff: alignedOut, reason: null };
    }
  }

  // --offset-max: the gates' criterion (pixelVerdict) decides; else the chosen number against the threshold.
  const round2 = (x) => Number(x.toFixed(2));
  const crit = opts.offsetMax === null ? null : pixelVerdict({ pct: round2(pct), heightDelta, compared: { width: w, height: h }, aligned }, { threshold: opts.threshold, offsetMax: opts.offsetMax });
  const pass = crit ? crit.pass : (opts.verdict === 'aligned' ? aligned.pct : pct) <= opts.threshold;
  // Auxiliary number (never the verdict — header): --text-boxes text-only %.
  const text = opts.textBoxes ? textBoxPct(diff, readTextBoxes(opts.textBoxes), w, h, masked) : null;
  const summary = () => JSON.stringify({ a: aPath, b: bPath, compared: { width: w, height: h, mode: 'overlap' }, heightDelta, differingPixels: n, pct: Number(pct.toFixed(2)), threshold: opts.threshold, pass, diff: opts.out, masks: opts.masks, maskedRows, textPct: text ? Number(text.pct.toFixed(2)) : null, textBoxes: text ? text.boxes : null, textPixels: text ? text.pixels : null, bands: bands.map((x) => ({ ...x, pct: Number(x.pct.toFixed(1)) })), ...(aligned ? { verdict: opts.verdict, aligned } : {}), ...(crit ? { offsets: { bound: crit.bound, totalShift: crit.totalShift, pass: crit.offsetsPass }, reason: crit.reason } : {}) }, null, 2);
  if (opts.jsonOut) writeFileSync(opts.jsonOut, `${summary()}\n`);
  if (opts.json) {
    console.log(summary());
  } else {
    console.log(`A ${a.width}x${a.height}  B ${b.width}x${b.height}  → compare ${w}x${h}, height delta ${heightDelta}px`);
    if (Math.abs(heightDelta) > 8) console.log(`  ⚠ height delta ${heightDelta}px — overlap-crop hides the tail; fix heights before trusting the %`);
    console.log(`differing pixels: ${n} / ${denom} = ${pct.toFixed(2)}%  (threshold ${opts.threshold}%) → ${pass ? 'PASS' : 'FAIL'}${maskedRows ? `  [MASKED ${maskedRows} rows: ${opts.masks.map((m) => `${m.yA}:${m.h}${m.yB !== m.yA ? `@${m.yB}` : ''}`).join(', ')} — authored-volatile, excluded]` : ''}`);
    if (aligned) console.log(`${alignedLine(aligned, pct)}${opts.verdict === 'aligned' ? '  [verdict on the aligned number]' : ''}`);
    if (crit) console.log(crit.line);
    if (text) console.log(`  text-boxes only: ${text.pct.toFixed(2)}% over ${text.boxes} boxes / ${text.pixels} px — auxiliary (#125 D4)`);
    console.log(`diff image: ${opts.out}${aligned && aligned.used ? `  aligned: ${aligned.diff}` : ''}`);
    const ab = aligned && aligned.used ? aligned.bands : null;
    for (let i = 0; i < Math.max(bands.length, ab ? ab.length : 0); i += 1) {
      const bd = bands[i]; const al = ab && ab[i];
      const y0 = bd ? bd.y0 : al.y0; const y1 = al && (!bd || al.y1 > bd.y1) ? al.y1 : bd.y1;
      console.log(`  y ${String(y0).padStart(6)}–${y1}: ${bd ? `${bd.pct.toFixed(1)}%` : '—'}${bd && bd.pct > 15 ? '  ◄◄ hot band' : ''}${al ? `  aligned ${al.pct.toFixed(1)}%${al.pct > 15 ? '  ◄◄ still differs' : ''}` : ''}`);
    }
  }
  // Never process.exit() here — see the header: forcing exit after the compare
  // hung Node's platform shutdown; the loop has nothing left and drains at once.
  process.exitCode = pass ? 0 : 2;
}

// Main-module guard by real path: the contract test imports textBoxPct without running a compare.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`pixel-compare error: ${e.message}`); process.exit(1); });
}
