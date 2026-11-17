#!/usr/bin/env node
/**
 * skills/replica/scripts/reference.mjs
 *
 * The frozen origin reference of one page × width, measured before it is trusted: stitch-shot.mjs captures,
 * pixel-compare.mjs compares, this script only orchestrates the two (child processes — it needs no browser and no
 * image library itself) and decides.
 *
 * Why: a live reference captured once can be the session's FIRST-VISIT state (a consent or app banner, a cookie the
 * first visit sets — every later capture differs from it), and a page with rotating or time-driven content differs
 * from ITSELF on every capture, so a pixel bar below that variation cannot be met by any build. Nothing measured
 * either. `freeze` therefore
 *   1. PRIMES: one capture that is discarded — it puts the shared live session (live-session.mjs's per-host jar)
 *      into its steady state; its height and its distance from the first kept capture are recorded (prime);
 *   2. captures the page N times with identical flags (ref-1.png … ref-N.png + stitch-shot's capture records);
 *   3. compares them pairwise: noiseFloor = the largest full-page %, heightSpread = max − min height;
 *   4. derives the VARIABLE REGIONS — the row ranges where the page differs from itself: pixel-compare's bands at
 *      --band rows (default 20; the diff image is not read), every band above --band-min % of its pixels, the
 *      largest value per band over all pairs, each padded by --pad rows, touching ranges merged — and re-compares
 *      each pair with those rows masked: `outside` = the largest % left outside them;
 *   5. decides: STABLE when the heights agree within --height-max px, `outside` is at most --floor-max %, the
 *      variable regions cover at most --variable-max % of the rows and the kept captures agree on their dead font faces (a face dead on the
 *      source is recorded in fontsFailed for the gates' font rule, not a reason to refuse). Then baseline.png =
 *      ref-1 and baseline.json are written (both atomic) in the shape stitch-shot's `baseline <dir>` check accepts,
 *      extended (below). UNSTABLE (two different pages, not one noisy page): exit 2, one line, NO baseline — the
 *      captures and reference-unstable.json stay for inspection — unless --force.
 *
 * Usage:
 *   node skills/replica/scripts/reference.mjs freeze <url> <dir> --width <px> [options]
 *     --consent <sel> | --dismiss <sel,…> | --no-dismiss | --locale <tag> | --vh <px> | --headed
 *                          passed to every stitch-shot capture unchanged (--settle always rides)
 *     --captures <n>       kept captures, 2 or 3                                   (default 2)
 *     --floor-max <pct>    largest % allowed outside the variable regions           (default 1)
 *     --height-max <px>    largest height spread                                    (default 8)
 *     --variable-max <pct> largest share of rows the variable regions may cover     (default 50)
 *     --band <px>          row resolution of the regions                            (default 20)
 *     --band-min <pct>     a band varies above this % of its pixels                 (default 0.5)
 *     --pad <px>           rows added on each side of a region                      (default 8)
 *     --timeout <s>        per capture                                              (default 300)
 *     --force              re-freeze over an existing baseline; freeze an unstable one (stable: false)
 *   A usable baseline for this URL and width (stitch-shot's `baseline <dir>` check) is reused: no capture, exit 0.
 *   node skills/replica/scripts/reference.mjs status <dir> [--json] [--url <u>] [--width <px>]
 *   node skills/replica/scripts/reference.mjs mask <dir>      only the --mask argument for pixel-compare ('' = none)
 *   node skills/replica/scripts/reference.mjs assess <a.png> <b.png> [<c.png>] [--json] [threshold flags]
 *                          the same decision over EXISTING captures; writes nothing
 *
 * baseline.json: stitch-shot's fields (writtenBy, schema, capturedAt, url, width, vh, height, settle, chunks,
 * fontsFailed, fixedLayers) + { primed: true, prime: { height, pct, heightDelta }, captures, heights, noiseFloor,
 * heightSpread, outside, variable: [{ y, h, pct }], variableShare, maskArg, stable, reason, frozenAt, flags,
 * thresholds }.
 *
 * Exit codes: 0 frozen / reused / usable (status, mask) / stable (assess), 1 error or no usable reference,
 * 2 unstable (not frozen), 3 bot challenge (stitch-shot's), 124 a capture exceeded --timeout (no verdict), 125 usage.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-continue */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = `reference — freeze a page's origin reference after priming the session and measuring its noise floor

Usage: node reference.mjs freeze <url> <dir> --width <px> [options]
  --consent <sel> | --dismiss <sel,…> | --no-dismiss | --locale <tag> | --vh <px> | --headed
                       passed to every stitch-shot capture unchanged (--settle always rides)
  --captures <n>       kept captures, 2 or 3 (default 2)
  --floor-max <pct>    largest % allowed outside the variable regions (default 1)
  --height-max <px>    largest height spread between captures (default 8)
  --variable-max <pct> largest share of rows the variable regions may cover (default 50)
  --band <px>          row resolution of the variable regions (default 20)
  --band-min <pct>     a band varies above this % of its pixels (default 0.5)
  --pad <px>           rows added on each side of a region (default 8)
  --timeout <s>        per capture (default 300)
  --force              re-freeze over an existing baseline; freeze an unstable reference too (stable: false)
       node reference.mjs status <dir> [--json] [--url <u>] [--width <px>]   the stored reference on one line
       node reference.mjs mask <dir>                                         only the pixel-compare --mask argument
       node reference.mjs assess <a.png> <b.png> [<c.png>] [--json]          the decision over existing captures; writes nothing

freeze: one PRIMING capture is discarded (the shared live session reaches its steady state: cookies set, consent
accepted), then N captures with identical flags (ref-1.png …) are compared pairwise. noiseFloor = the largest
full-page %; variable regions = the rows where the page differs from itself (pixel-compare bands of --band rows above
--band-min %, padded, merged; the diff image is not read); outside = the largest % with those rows masked. Stable
(heights within --height-max, outside ≤ --floor-max, regions ≤ --variable-max % of the rows, the same dead font faces on every capture) →
baseline.png (= ref-1) + baseline.json in <dir>, atomic: stitch-shot's baseline record plus primed, prime { height,
pct, heightDelta }, captures, heights, noiseFloor, heightSpread, outside, variable [{ y, h, pct }], variableShare,
maskArg, stable, reason, frozenAt, flags, thresholds. Unstable → nothing frozen; ref-*.png and
reference-unstable.json stay. A usable baseline for this URL and width is reused without a capture.
One verdict line on stdout; the children's output goes to stderr.
Exit codes: 0 frozen / reused / usable / stable, 1 error or no usable reference, 2 unstable (not frozen),
3 bot challenge (stitch-shot's exit 3), 124 a capture exceeded --timeout, 125 usage.`;

if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }

const HERE = dirname(fileURLToPath(import.meta.url)); // stitch-shot.mjs and pixel-compare.mjs sit beside this file in both layouts
export const WRITER = 'skills/replica/scripts/reference.mjs freeze';
export const DEFAULTS = { captures: 2, floorMax: 1, heightMax: 8, variableMax: 50, band: 20, bandMin: 0.5, pad: 8, timeout: 300 };
export class UsageError extends Error {}
const round2 = (n) => Number(Number(n).toFixed(2));

// ── pure ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const NUM = { '--width': 'width', '--vh': 'vh', '--captures': 'captures', '--floor-max': 'floorMax', '--height-max': 'heightMax', '--variable-max': 'variableMax', '--band': 'band', '--band-min': 'bandMin', '--pad': 'pad', '--timeout': 'timeout' };
const STR = { '--consent': 'consent', '--dismiss': 'dismiss', '--locale': 'locale', '--url': 'url' };
const BOOL = { '--no-dismiss': 'noDismiss', '--headed': 'headed', '--force': 'force', '--json': 'json' };
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd, pos: [], width: null, vh: null, consent: null, dismiss: null, noDismiss: false, locale: null, headed: false, force: false, json: false, url: null, ...DEFAULTS };
  if (!['freeze', 'status', 'mask', 'assess'].includes(cmd)) throw new UsageError(`unknown command ${cmd ?? '(none)'} — freeze | status | mask | assess`);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (BOOL[a]) { o[BOOL[a]] = true; continue; }
    if (NUM[a] || STR[a]) {
      const v = rest[i += 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      if (NUM[a] && !(Number.isFinite(Number(v)) && Number(v) >= 0)) throw new UsageError(`${a} needs a number, got ${v}`);
      o[NUM[a] || STR[a]] = NUM[a] ? Number(v) : v;
      continue;
    }
    if (a.startsWith('--')) throw new UsageError(`unknown flag ${a}`);
    o.pos.push(a);
  }
  if (cmd === 'freeze') {
    [o.url, o.dir] = o.pos;
    if (o.pos.length !== 2) throw new UsageError('freeze needs <url> <dir>');
    if (!Number.isInteger(o.width) || o.width < 1) throw new UsageError('freeze needs --width <px>');
    if (![2, 3].includes(o.captures)) throw new UsageError('--captures is 2 or 3');
    if (o.noDismiss && (o.consent || o.dismiss)) throw new UsageError('--no-dismiss contradicts --consent / --dismiss');
  } else if (cmd === 'assess') {
    if (o.pos.length < 2 || o.pos.length > 3) throw new UsageError('assess needs two or three PNGs');
  } else {
    [o.dir] = o.pos;
    if (o.pos.length !== 1) throw new UsageError(`${cmd} needs <dir>`);
  }
  if (!(o.band >= 1)) throw new UsageError('--band needs at least 1 px');
  return o;
}

// The flags every capture of one freeze gets (prime and kept alike).
export function captureArgs(o) {
  return ['--width', String(o.width), '--settle', ...(o.vh ? ['--vh', String(o.vh)] : []), ...(o.consent ? ['--consent', o.consent] : []),
    ...(o.dismiss ? ['--dismiss', o.dismiss] : []), ...(o.noDismiss ? ['--no-dismiss'] : []), ...(o.locale ? ['--locale', o.locale] : []), ...(o.headed ? ['--headed'] : [])];
}

// Several comparisons' bands → one list: per band start, the largest % any pair measured there.
export function mergeBands(lists) {
  const by = new Map();
  for (const list of lists) {
    for (const b of list || []) {
      const p = by.get(b.y0);
      by.set(b.y0, p ? { y0: b.y0, y1: Math.max(p.y1, b.y1), pct: Math.max(p.pct, b.pct) } : { ...b });
    }
  }
  return [...by.values()].sort((a, b) => a.y0 - b.y0);
}

// Bands [{ y0, y1, pct }] → the page's self-varying row ranges [{ y, h, pct }]: every band above `min` %, padded by
// `pad` rows on each side (clamped to 0..height), ranges that overlap or lie within `pad` rows of each other merged; pct = the largest band % inside.
export function variableRegions(bands, { min = DEFAULTS.bandMin, pad = DEFAULTS.pad, height = Infinity } = {}) {
  const out = [];
  for (const b of [...(bands || [])].sort((x, y) => x.y0 - y.y0)) {
    if (!(b.pct > min)) continue;
    const y0 = Math.max(0, b.y0 - pad); const y1 = Math.min(height, b.y1 + pad);
    const last = out[out.length - 1];
    if (last && y0 <= last.y1 + pad) { last.y1 = Math.max(last.y1, y1); last.pct = Math.max(last.pct, b.pct); } else out.push({ y0, y1, pct: b.pct });
  }
  return out.filter((r) => r.y1 > r.y0).map((r) => ({ y: r.y0, h: r.y1 - r.y0, pct: r.pct }));
}

// pixel-compare's --mask argument for the regions ('' when there is none).
export const maskArg = (regions) => (regions || []).map((r) => `${r.y}:${r.h}`).join(',');

// The decision. → { stable, reason } — reason is the one-line why when unstable, null otherwise.
export function decide({ heights, outside, variableShare = 0, fontsDiffer = null }, { heightMax = DEFAULTS.heightMax, floorMax = DEFAULTS.floorMax, variableMax = DEFAULTS.variableMax } = {}) {
  const spread = Math.max(...heights) - Math.min(...heights);
  if (spread > heightMax) return { stable: false, reason: `heights ${heights.join(' vs ')}` };
  if (variableShare > variableMax) return { stable: false, reason: `${round2(variableShare)}% of the rows differ between captures (bar ${variableMax}%)` };
  if (outside > floorMax) return { stable: false, reason: `${round2(outside)}% still differs outside the variable regions (bar ${floorMax}%)` };
  // A face dead on the source is what the source serves: it is recorded (fontsFailed) and the gates' font rule reads
  // it. Only captures that DISAGREE on their dead faces are not one page.
  if (fontsDiffer) return { stable: false, reason: `the captures' dead font faces differ (${fontsDiffer})` };
  return { stable: true, reason: null };
}

// Compare the captures pairwise and decide. deps.size(png) → { width, height }; deps.compare(a, b, { band, mask, out })
// → { pct, heightDelta, bands }. Deterministic for the same captures.
export function assess(pngs, o, deps, { diffDir, fontsDiffer = null } = {}) {
  const sizes = pngs.map((p) => deps.size(p));
  const heights = sizes.map((s) => s.height);
  const pairs = [];
  for (let i = 0; i < pngs.length; i += 1) for (let j = i + 1; j < pngs.length; j += 1) pairs.push([i, j]);
  const out = (i, j, tag = '') => join(diffDir, `ref-diff-${i + 1}-${j + 1}${tag}.png`);
  const full = pairs.map(([i, j]) => deps.compare(pngs[i], pngs[j], { band: o.band, out: out(i, j) }));
  const noiseFloor = Math.max(...full.map((r) => r.pct));
  const overlap = Math.min(...heights);
  const variable = variableRegions(mergeBands(full.map((r) => r.bands)), { min: o.bandMin, pad: o.pad, height: overlap });
  const mask = maskArg(variable);
  const outside = mask ? Math.max(...pairs.map(([i, j]) => deps.compare(pngs[i], pngs[j], { band: o.band, mask, out: out(i, j, '-masked') }).pct)) : noiseFloor;
  const variableShare = overlap > 0 ? round2((100 * variable.reduce((n, r) => n + r.h, 0)) / overlap) : 0;
  const verdict = decide({ heights, outside, variableShare, fontsDiffer }, o);
  return { width: sizes[0].width, height: heights[0], captures: pngs.length, heights, noiseFloor, heightSpread: Math.max(...heights) - Math.min(...heights), outside, variable, variableShare, maskArg: mask, ...verdict,
    thresholds: { floorMax: o.floorMax, heightMax: o.heightMax, variableMax: o.variableMax, band: o.band, bandMin: o.bandMin, pad: o.pad } };
}

// The one line. `how` = 'frozen' | 'reused' | 'stable' (assess) …
export function verdictLine(r, how = 'frozen') {
  if (!r.stable && !r.forced) return `reference: UNSTABLE — ${r.reason}${r.primed ? ' after priming' : ''}; not frozen`;
  const size = `${r.width}×${r.height}`;
  const primed = r.primed ? ', primed' : '';
  const fonts = Array.isArray(r.fontsFailed) && r.fontsFailed.length ? `; dead on the source: ${r.fontsFailed.join(', ')}` : r.fontsFailed === null ? '; fonts not checked' : '';
  const forced = `${fonts}${r.stable ? '' : ` (FORCED, unstable: ${r.reason})`}`;
  if (typeof r.noiseFloor !== 'number') return `reference: ${how} ${size}${primed}, noise floor not measured (frozen by stitch-shot --freeze-baseline; freeze --force measures it)`;
  const floor = `noise floor ${r.noiseFloor.toFixed(2)}%`;
  if (!r.variable.length) return `reference: ${how} ${size}${primed}, ${floor}, no variable region${forced}`;
  return `reference: ${how} ${size}${primed}, ${floor} in ${r.variable.length} variable region(s) (rows ${r.variable.map((v) => `${v.y}–${v.y + v.h}`).join(', ')}) → mask ${r.maskArg}; outside them ${r.outside.toFixed(2)}%${forced}`;
}

// ── the freeze (every side effect through deps, so the tests run it on stubs) ─────────────────────────────────────
const recordOf = (png) => `${png.replace(/\.png$/i, '')}.capture.json`;
function writeJsonAtomic(file, obj) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`); renameSync(tmp, file); }
const OURS = /^(prime|ref-\d|ref-diff-.*)\.(png|capture\.json)$|^reference-unstable\.json$/;

// The font check of the first kept capture, as its record has it: the dead faces (families, and the faces themselves
// when recorded), or null + fontCheck when the check could not run — never [] for a check that did not run.
export function fontsOfRecord(rec) {
  if (rec && Array.isArray(rec.fontsFailed)) return { fontsFailed: rec.fontsFailed, ...(Array.isArray(rec.deadFaces) ? { deadFaces: rec.deadFaces } : {}) };
  return { fontsFailed: null, fontCheck: rec && typeof rec.fontCheck === 'string' ? rec.fontCheck : 'failed: the capture record has no font check' };
}
// → null when every kept capture reports the same dead faces (or none could be checked), else "a vs b".
export function fontsDiffer(records) {
  const keys = records.map((r) => (r && Array.isArray(r.fontsFailed) ? [...r.fontsFailed].sort().join(', ') || 'none' : 'not checked'));
  return new Set(keys).size > 1 ? keys.join(' vs ') : null;
}
// → { code, line, result }.
export function freeze(o, deps) {
  const have = deps.baselineCheck(o.dir, { url: o.url, width: o.width });
  if (have.ok && !o.force) {
    const b = deps.readJson(join(o.dir, 'baseline.json')) || {};
    return { code: 0, line: verdictLine({ ...b, stable: b.stable !== false, forced: true }, 'reused'), result: b, reused: true };
  }
  mkdirSync(o.dir, { recursive: true });
  for (const f of readdirSync(o.dir)) if (OURS.test(f)) rmSync(join(o.dir, f), { force: true });
  const names = ['prime', ...Array.from({ length: o.captures }, (_, i) => `ref-${i + 1}`)].map((n) => join(o.dir, `${n}.png`));
  for (const png of names) {
    const code = deps.capture(o.url, png, o);
    if (code !== 0) return { code: code === 3 || code === 124 ? code : 1, line: `reference: not frozen — the ${png === names[0] ? 'priming ' : ''}capture ${code === 3 ? 'met a bot challenge (stitch-shot exit 3)' : code === 124 ? `exceeded its ${o.timeout}s deadline (exit 124 — no verdict, re-run)` : `failed (stitch-shot exit ${code})`}` };
  }
  const [primePng, ...refs] = names;
  const first = deps.compare(primePng, refs[0], { band: o.band, out: join(o.dir, 'ref-diff-prime.png') });
  const prime = { height: deps.size(primePng).height, pct: first.pct, heightDelta: first.heightDelta };
  for (const f of [primePng, recordOf(primePng), join(o.dir, 'ref-diff-prime.png')]) rmSync(f, { force: true });
  const rec = deps.readJson(recordOf(refs[0])) || {};
  const a = assess(refs, o, deps, { diffDir: o.dir, fontsDiffer: fontsDiffer(refs.map((p) => deps.readJson(recordOf(p)))) });
  const frozenAt = deps.now();
  const result = {
    writtenBy: WRITER, schema: 1, capturedAt: rec.at ?? frozenAt, url: o.url, width: o.width, vh: rec.vh ?? o.vh ?? null, height: a.height, settle: true,
    chunks: rec.chunks ?? null, ...fontsOfRecord(rec), fixedLayers: rec.fixedLayers ?? null,
    primed: true, prime, captures: a.captures, heights: a.heights, noiseFloor: a.noiseFloor, heightSpread: a.heightSpread, outside: a.outside,
    variable: a.variable, variableShare: a.variableShare, maskArg: a.maskArg, stable: a.stable, reason: a.reason, frozenAt,
    flags: { consent: o.consent, dismiss: o.dismiss, noDismiss: o.noDismiss, locale: o.locale, vh: o.vh, headed: o.headed }, thresholds: a.thresholds,
  };
  if (!a.stable && !o.force) {
    writeJsonAtomic(join(o.dir, 'reference-unstable.json'), result);
    return { code: 2, line: verdictLine({ ...result, width: a.width }), result };
  }
  const tmp = join(o.dir, `baseline.png.${process.pid}.tmp`);
  copyFileSync(refs[0], tmp); renameSync(tmp, join(o.dir, 'baseline.png'));
  writeJsonAtomic(join(o.dir, 'baseline.json'), result);
  return { code: 0, line: verdictLine({ ...result, width: a.width, forced: !a.stable }), result };
}

// ── the real children ─────────────────────────────────────────────────────────────────────────────────────────────
function pngSize(file) { // the IHDR chunk: width and height at bytes 16..24
  const fd = openSync(file, 'r'); const b = Buffer.alloc(24);
  try { if (readSync(fd, b, 0, 24, 0) < 24 || b.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`); } finally { closeSync(fd); }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function compare(a, b, { band, mask, out }) {
  const r = spawnSync(process.execPath, [join(HERE, 'pixel-compare.mjs'), a, b, '--json', '--threshold', '100', '--band', String(band), '--out', out, ...(mask ? ['--mask', mask] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (!j || typeof j.pct !== 'number' || !Array.isArray(j.bands)) throw new Error(`pixel-compare gave no measurement for ${a} vs ${b} (exit ${r.status}): ${String(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}`);
  return { pct: j.pct, heightDelta: j.heightDelta, bands: j.bands };
}
const readJson = (f) => { try { const j = JSON.parse(readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
export const realDeps = {
  size: pngSize,
  compare,
  readJson,
  now: () => new Date().toISOString(),
  // stitch-shot's own pacing, jar and exit codes; its output goes to stderr so stdout stays the verdict line
  capture(url, png, o) {
    const r = spawnSync(process.execPath, [join(HERE, 'stitch-shot.mjs'), url, png, ...captureArgs(o)], { stdio: ['ignore', 2, 2], timeout: o.timeout > 0 ? o.timeout * 1000 : undefined });
    if (r.error) console.error(`reference: stitch-shot ${r.error.code === 'ETIMEDOUT' ? `exceeded ${o.timeout}s` : r.error.message}`);
    return r.error && r.error.code === 'ETIMEDOUT' ? 124 : r.status ?? 1;
  },
  // stitch-shot's `baseline <dir>` — the one definition of a usable frozen baseline
  baselineCheck(dir, { url = null, width = null } = {}) {
    const r = spawnSync(process.execPath, [join(HERE, 'stitch-shot.mjs'), 'baseline', dir, ...(url ? ['--url', url] : []), ...(width ? ['--width', String(width)] : [])], { encoding: 'utf8' });
    return { ok: r.status === 0, line: String(r.stdout || r.stderr || '').trim().split('\n')[0] };
  },
};

export function main(argv, deps = realDeps) {
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`reference: ${e.message} (--help)`); return 125;
  }
  if (o.cmd === 'freeze') { const r = freeze(o, deps); console.log(r.line); return r.code; }
  if (o.cmd === 'assess') {
    const diffDir = mkdtempSync(join(tmpdir(), 'reference-assess-'));
    try {
      const r = assess(o.pos, o, deps, { diffDir });
      console.log(o.json ? JSON.stringify(r) : verdictLine({ ...r, forced: false }, 'stable'));
      return r.stable ? 0 : 2;
    } finally { rmSync(diffDir, { recursive: true, force: true }); }
  }
  const have = deps.baselineCheck(o.dir, { url: o.url, width: o.width });
  const b = have.ok ? deps.readJson(join(o.dir, 'baseline.json')) || {} : null;
  if (o.cmd === 'mask') { console.log(b?.maskArg || ''); return b ? 0 : 1; }
  if (o.json) console.log(JSON.stringify(b ? { usable: true, ...b } : { usable: false, why: have.line }));
  else console.log(b ? verdictLine({ ...b, stable: b.stable !== false, forced: true }, 'frozen') : `reference: none — ${have.line}`);
  return b ? 0 : 1;
}

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && fileURLToPath(import.meta.url) === real(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`reference error: ${e.message}`); process.exitCode = 1; }
}
