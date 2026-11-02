#!/usr/bin/env node
/**
 * skills/replica/scripts/stitch-shot.mjs
 *
 * Scroll-and-stitch full-page screenshot for the stardust:replica
 * source-fidelity gate. Chromium's fullPage:true (captureBeyondViewport)
 * renders lazy-decoded images as gray placeholders on JS-heavy live sites —
 * a fullPage shot of a page whose DOM says "loaded" can still be visually
 * wrong. This tool scrolls viewport by viewport, waits for in-viewport image
 * completeness per chunk, screenshots each chunk, and stitches the PNG.
 *
 * Run it IDENTICALLY on the live page and on the served prototype so the
 * instrument is symmetric — an asymmetric capture (fullPage on one side,
 * stitch on the other) manufactures pixel diffs that aren't there.
 *
 * Hardening baked in (each one is a recorded false-measurement trap; the
 * live-navigation pieces live in the shared ../../diff/scripts/live-session.mjs):
 *   - real-Chrome UA + the STANDARD REQUEST HEADERS by default: the default
 *     HeadlessChrome UA gets a Cloudflare managed challenge on many live
 *     sites, and UA alone still 403s on Akamai (F-R1) — the standard headers
 *     (Accept / Accept-Language / sec-ch-ua*) are the other half of the fix.
 *   - a bot-management challenge/blocked interstitial FAILS LOUD (exit 3),
 *     never captured as if it were the source (the Access-Denied trap). So
 *     does a 2xx DENIAL PAGE (live-session's pageDenial owns the rule): gotoLive
 *     reads the entry, and the page is read once more after the dismissal
 *     sweep(s), before the capture (a denial page a script renders after
 *     domcontentloaded). The message names the signature and says "origin
 *     blocked"; a re-check that cannot read the page is one stderr line
 *     (`denial-page check skipped`), never a pass. Escalate with --headed
 *     (stealth real Chrome).
 *   - waitUntil 'domcontentloaded' (never 'networkidle'): live sites with
 *     analytics beacons never reach networkidle — hard timeout otherwise.
 *   - TWO overlay classes dismissed: cookie consent (CLICKED accept, not DOM
 *     removal, so consent-gated layout settles the way a real visit does)
 *     AND timed marketing/newsletter interstitials (CH-1: an undismissed
 *     "Sign up!" modal bakes a pixel-diff contributor into the live capture
 *     that no prototype fidelity can null out). The mouse is PARKED
 *     afterwards (bottom-left): a dismissal click leaves the cursor over the
 *     page, and any :hover-styled element under it would be silently
 *     captured in hover state. --consent / --dismiss add a site's own
 *     selectors; --no-dismiss turns both classes off (gate.sh passes all
 *     three through to BOTH captures, so the live side is dismissed exactly
 *     like the build side).
 *   - --locale pins Accept-Language + context locale: geo-redirecting sites
 *     (recorded: a car brand → /ch-de/, a fashion brand → /ww/) otherwise capture
 *     a different locale per run — nondeterministic live side.
 *   - animation/transition freeze is injected AFTER the lazyload settle
 *     pass: injecting it before breaks some lazy loaders' swap logic. The
 *     freeze also pauses every <video> at t=0 and clears all pending JS
 *     timeouts/intervals (CSS-only freezing stops neither <video> playback
 *     nor slick-style autoplay timers — the same page never pixel-matched
 *     itself), then clicks the first slick-convention carousel dot so both
 *     sides capture slide 1 deterministically. All symmetric — applied
 *     identically to live and prototype, so it cannot bias the diff.
 *   - FONT-LOAD assertion before capture (F-B2 companion): a webfont that
 *     failed to fetch renders the whole capture in fallback type — the same
 *     silent-false-measurement class as capturing a challenge page. After
 *     document.fonts.ready, any declared FontFace with status 'error' is
 *     reported LOUDLY with the family names; the operator must decide
 *     whether the failure is instrument-induced (a capture defect — fix the
 *     instrument) or real on the live site (capture-state — log it).
 *   - page height is measured AFTER the settle pass: entrance-animated
 *     sites inflate scrollHeight until elements go inview, so the
 *     pre-settle height is fake.
 *   - FIXED / STICKY layers are captured ONCE: chunk 1 shows the page's top
 *     as a visitor sees it; from chunk 2 on, a fixed layer is made
 *     transparent (opacity, so layout never moves) and a sticky one too while
 *     it is stuck (displaced from its own place). A repeated header
 *     covered a band of content at every seam on both sides, and a defect
 *     under a seam scored 0 % (layerAction). The scan re-runs after every
 *     chunk's scroll, so a header a scroll class makes fixed, or a widget
 *     injected later, is caught where it appears (a WARNING names it). A
 *     backdrop (negative z-index, or ≥ 90 % of the viewport) is never hidden
 *     (isBackdrop). Not seen: a fixed element inside a shadow root. A fixed
 *     layer still showing after the dismissal sweeps whose text reads like
 *     consent / sign-up copy is printed as a WARNING (overlaySuspects) — an
 *     overlay no candidate closed.
 *
 * Usage:
 *   node skills/replica/scripts/stitch-shot.mjs <url> <out.png> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --vh <px>           viewport height / chunk size      (default 900)
 *     --settle            slow-scroll lazyload settle pass before capture
 *                         (use on live JS-heavy pages; harmless elsewhere)
 *     --consent <sel>     extra consent-accept selector, tried before the
 *                         built-in candidates (OneTrust, "Accept all", …)
 *     --dismiss <sel,...> extra overlay-dismiss selectors (marketing modals
 *                         with non-standard close controls)
 *     --no-dismiss        dismiss no overlay at all (gate.sh --no-dismiss)
 *     --headed            escalation: headed stealth real Chrome
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 1200; 3000 with --settle)
 *     --timeout <ms>      goto timeout                      (default 60000)
 *     --freeze-baseline   origin baseline (opt-in, default OFF): the capture is
 *                         frozen as <dir>/baseline.png + baseline.json beside
 *                         <out.png>, for gate.sh --gate-against-baseline (below)
 *     --check-baseline    print a fresh shot's Δheight vs the frozen baseline
 *     --force             re-freeze over an existing baseline
 *   node skills/replica/scripts/stitch-shot.mjs baseline <dir> [--url <u>] [--width <px>]
 *   node skills/replica/scripts/stitch-shot.mjs record <live.json> --origin live|baseline …
 *                         the gate's bookkeeping, no browser (HELP § Origin baseline)
 *
 * Example:
 *   node skills/replica/scripts/stitch-shot.mjs https://www.example.com \
 *     stardust/replica/gates/home-1440/live.png --width 1440 --settle
 *
 * Writes <out.png> and <stem>.capture.json beside it (live.png →
 * live.capture.json): { writtenBy, url, width, vh, height (the PNG's),
 * chunks, denialCheck ('ok' | 'skipped: <reason>' — the denial-page read
 * after the dismissal sweeps), fixedLayers ('once', the count, late = those that
 * appeared after scroll 0), at }. Removed when a capture starts, written
 * with the PNG — a failed or refused capture leaves none. A --freeze-baseline
 * capture writes baseline.json instead (HELP § Origin baseline), fixedLayers included.
 *
 * Requires: playwright, pngjs (project devDependencies; imported lazily, so
 * --help and the two subcommands need neither), and the diff skill's scripts
 * dir alongside (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 written, 1 error, 2 a baseline refusal (exists without --force,
 * fonts failed, a check aimed at baseline.png), 3 bot challenge (live side
 * blocked — an edge interstitial or a 2xx denial page; fail loud, never
 * captured, no PNG and no capture.json; escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync, renameSync, rmSync } from 'fs';
import { basename, dirname, join, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/replica/scripts ↔ skills/diff/scripts) and the
// documented project copy (scripts/replica ↔ scripts/diff) — resolve either,
// so a project re-copy can't silently sever the shared hardening.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('stitch-shot error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const liveSession = await import(pathToFileURL(LIVE_SESSION).href);
const { REAL_CHROME_UA, isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } = liveSession;

const HELP = `stitch-shot — scroll-and-stitch full-page screenshot (symmetric capture instrument)

Usage: node stitch-shot.mjs <url> <out.png> [options]
  --width <px>      viewport width (default 1440)
  --vh <px>         viewport height / chunk size (default 900)
  --settle          slow-scroll lazyload settle pass before capture
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors (marketing modals etc.)
  --no-dismiss      dismiss no overlay at all (gate.sh --no-dismiss pass-through)
  --headed          headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB) for geo determinism
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 1200; 3000 with --settle)
  --timeout <ms>    goto timeout (default 60000)
  --freeze-baseline freeze this capture as the origin baseline (opt-in; default OFF): it is ALWAYS written as
                    baseline.png in <out.png>'s dir (+ baseline.json: capturedAt, url, width, vh, height, settle,
                    chunks, fontsFailed), both atomic — <out.png> names the dir only; a freeze aimed at live.png
                    writes baseline.png beside it and never touches live.png (one stderr line). Refused (exit 2,
                    nothing written) when a baseline exists (pass --force) or the capture's fonts failed.
  --check-baseline  capture a fresh shot to <out.png> and print its Δheight vs the frozen baseline in <out.png>'s
                    dir — no verdict; never writes baseline.png: <out.png> named baseline.png is refused (exit 2)
  --force           re-freeze over an existing baseline (with --freeze-baseline)
  --help            this text

Origin baseline (opt-in, default OFF — gate.sh --gate-against-baseline): one frozen origin per page and width,
so the live site changing between rounds cannot move the pixel gate's target. Two subcommands carry the gate's
bookkeeping — no browser, no network:
  node stitch-shot.mjs baseline <dir> [--url <u>] [--width <px>]
                    is a usable frozen baseline there? baseline.png AND baseline.json (a lone PNG is not one),
                    readable, frozen for this URL and width when given → its capturedAt on stdout, exit 0;
                    else the one-line reason (missing, lone file, unreadable, stale: another URL or width) on
                    stdout, exit 1 — a caller captures one line either way
  node stitch-shot.mjs record <live.json> --origin live|baseline --url <u> --width <px>
                    [--baseline <baseline.json>] [--at <iso>]
                    write the round's live.json beside live.png (atomic): writtenBy, origin, url, width, at —
                    "baseline" (the frozen origin copied over live.png: --baseline required, at = its capturedAt,
                    plus originBaseline { capturedAt, height }) or "live" (a fresh capture, at = --at).
                    A round without the flag retakes a live.png whose record says "baseline". Exit 0; 1 usage.

Writes <out.png> and <stem>.capture.json beside it (live.png → live.capture.json; removed when a capture starts, so a
failed or refused one leaves none): { writtenBy, url, width, vh, height, chunks, denialCheck, at } — denialCheck = 'ok' |
'skipped: <reason>' (the denial-page read after the dismissal sweeps). A --freeze-baseline capture writes baseline.json
instead. Fixed/sticky layers are captured once: chunk 1, or where one turns fixed later (a WARNING); a backdrop
(negative z-index, or ≥ 90 % of the viewport) stays in every chunk. A fixed layer left showing that reads like
consent / sign-up copy is a WARNING.
Run the SAME command shape against the live page and the served prototype.
Exit codes: 0 written, 1 error, 2 baseline refusal, 3 bot challenge (live side blocked — an edge interstitial or a
2xx denial page, read by live-session's pageDenial at the entry and after the dismissal sweeps; fail loud, never
captured: no PNG, no capture.json; escalate --headed).`;
export { HELP };
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); process.exit(0); }
export class UsageError extends Error { constructor(msg) { super(msg); this.name = 'UsageError'; } }

export function parseArgs(argv) {
  const rest = argv.slice(2);
  const pos = [];
  const opts = { width: 1440, vh: 900, settle: false, consent: null, dismiss: [], noDismiss: false, headed: false, locale: null, ua: REAL_CHROME_UA, wait: null, timeout: 60000, freezeBaseline: false, checkBaseline: false, force: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--vh') { opts.vh = Number(rest[i += 1]); }
    else if (a === '--settle') { opts.settle = true; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--no-dismiss') { opts.noDismiss = true; }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a === '--freeze-baseline') { opts.freezeBaseline = true; }
    else if (a === '--check-baseline') { opts.checkBaseline = true; }
    else if (a === '--force') { opts.force = true; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a}`); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { throw new UsageError('need <url> and <out.png>'); }
  if (opts.wait == null) opts.wait = opts.settle ? 3000 : 1200;
  return { url, out, opts };
}

// The extra selectors handed to dismissOverlays: the consent selector first, then the dismiss list.
export const overlayExtras = (opts) => [...(opts.consent ? [opts.consent] : []), ...opts.dismiss];
// Scroll target of the chunk starting at y, clamped so the last chunk ends at the document's bottom.
export const chunkTarget = (y, totalH, vh) => Math.max(0, Math.min(y, totalH - vh));
// Scroll-stall guard (chunk loop below): the window did not advance although the target is > 4 px away.
export const scrollStalled = (prevActualY, actualY, target) => prevActualY !== null && actualY <= prevActualY && target - actualY > 4;
// Copy each decoded chunk ({ y, img: { width, height, data } }) into one RGBA buffer of width × totalH;
// rows past totalH and columns past width are dropped.
export function stitchRows(chunks, width, totalH) {
  const out = Buffer.alloc(width * totalH * 4);
  for (const { y: cy, img } of chunks) {
    for (let row = 0; row < img.height; row += 1) {
      const destY = cy + row;
      if (destY >= totalH) break;
      img.data.copy(out, (destY * width) * 4, (row * img.width) * 4, (row * img.width + Math.min(img.width, width)) * 4);
    }
  }
  return out;
}

// ── Origin baseline (opt-in, default OFF) ─────────────────────────────────────────────────────
// One frozen, provenance-stamped origin capture per page × width (baseline.png + baseline.json in the gate
// dir), so a gate round can compare against it instead of a live site that may have changed since the
// last round. The capture itself is the stitch flow in main(); everything here is pure bookkeeping — no
// browser — shared by --freeze-baseline / --check-baseline, the `baseline` and `record` subcommands and
// the tests. Without the flags stitch-shot behaves exactly as before.
export const BASELINE_PNG = 'baseline.png';
export const BASELINE_JSON = 'baseline.json';
export const BASELINE_SCHEMA = 1;
export const BASELINE_WRITER = 'skills/replica/scripts/stitch-shot.mjs --freeze-baseline';
export const LIVE_RECORD_WRITER = { live: 'gate.sh', baseline: 'gate.sh --gate-against-baseline' };

// --freeze-baseline / --check-baseline resolve their targets from <out.png>: a freeze ALWAYS lands in
// <dir>/baseline.png whatever <out.png> was named (a freeze aimed at live.png would otherwise leave the
// round's live shot as the only copy and nothing for baselineExists to find), and a check NEVER writes
// baseline.png (its fresh shot would overwrite the very baseline it compares against — refused before any
// capture). → { out, baselineDir, redirected, refusal }; baselineDir is null without the flags.
export function baselineTargets(out, { freezeBaseline = false, checkBaseline = false } = {}) {
  if (!freezeBaseline && !checkBaseline) return { out, baselineDir: null, redirected: false, refusal: null };
  const baselineDir = dirname(out);
  if (freezeBaseline) {
    const target = join(baselineDir, BASELINE_PNG);
    return { out: target, baselineDir, redirected: target !== out, refusal: null };
  }
  if (basename(out) === BASELINE_PNG) {
    return { out, baselineDir, redirected: false, refusal: `--check-baseline captures a fresh shot to compare against ${BASELINE_PNG} and never writes it — name another output (e.g. ${join(baselineDir, 'live.png')})` };
  }
  return { out, baselineDir, redirected: false, refusal: null };
}

// Both files must exist — a lone baseline.png (an interrupted freeze) is not a baseline.
export function baselineExists(dir) {
  return Boolean(dir) && existsSync(join(dir, BASELINE_PNG)) && existsSync(join(dir, BASELINE_JSON));
}
export function readBaselineProvenance(dir) {
  try { const p = JSON.parse(readFileSync(join(dir, BASELINE_JSON), 'utf8')); return p && typeof p === 'object' ? p : null; } catch { return null; }
}

// baseline.json: when the origin was frozen, for which page (url, width) and under which capture settings
// (vh, settle), what it measured (height, chunks) and whether every declared font face loaded.
export function baselineProvenance({ url, width, vh, height, settle = false, chunks = null, fontsFailed = [], fixedLayers = null, capturedAt = new Date().toISOString() }) {
  return {
    writtenBy: BASELINE_WRITER,
    schema: BASELINE_SCHEMA,
    capturedAt,
    url,
    width: Number(width),
    vh: vh == null ? null : Number(vh),
    height: Number(height),
    settle: Boolean(settle),
    chunks: chunks == null ? null : Number(chunks),
    fontsFailed: Array.isArray(fontsFailed) ? fontsFailed : [],
    fixedLayers,
  };
}

// A JSON file written atomically (sibling temp + rename, pretty, trailing newline): a crash mid-write never
// leaves a half-written record for a later round to read. Used for baseline.json and the round's live.json.
export function writeJsonAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

// Two URLs name the same page when they parse to the same href (a missing trailing slash on an origin, host
// case); unparseable ones compare as strings.
const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };

// Is there a usable frozen baseline in `dir` for this round? → { ok: true, provenance } or { ok: false, why }
// — the one line gate.sh prints when it refuses: missing, a lone file, unreadable, or stale (frozen for
// another URL or width than the round's, when those are given). A frozen baseline is meant to be old;
// "stale" is only ever "not this page at this width".
export function baselineStatus(dir, { url = null, width = null } = {}) {
  const png = join(dir, BASELINE_PNG); const json = join(dir, BASELINE_JSON);
  const hasPng = existsSync(png); const hasJson = existsSync(json);
  if (!hasPng && !hasJson) return { ok: false, why: `no frozen baseline in ${dir} (${BASELINE_PNG} + ${BASELINE_JSON})` };
  if (!hasJson) return { ok: false, why: `${png} has no ${BASELINE_JSON} beside it (an interrupted freeze) — re-freeze with --force` };
  if (!hasPng) return { ok: false, why: `${json} has no ${BASELINE_PNG} beside it — re-freeze with --force` };
  const provenance = readBaselineProvenance(dir);
  if (!provenance) return { ok: false, why: `${json} is unreadable — re-freeze with --force` };
  if (url && typeof provenance.url === 'string' && !sameUrl(provenance.url, url)) return { ok: false, why: `stale: ${json} was frozen for ${provenance.url}, this round's live URL is ${url} — re-freeze with --force` };
  if (width != null && provenance.width != null && Number(provenance.width) !== Number(width)) return { ok: false, why: `stale: ${json} was frozen at ${provenance.width}px, this round is ${width}px — re-freeze with --force` };
  // the one capture-method change that also makes a baseline stale: frozen before fixed/sticky layers were captured
  // once, it would be compared with a build captured the new way
  if (!provenance.fixedLayers) return { ok: false, why: `stale: ${json} was frozen before fixed/sticky layers were captured once (no fixedLayers) — re-freeze with --force` };
  return { ok: true, provenance };
}

// --check-baseline: a fresh shot's height against the frozen baseline. No verdict — it only says how far the
// origin moved.
export function compareBaseline(baseline, fresh) {
  const bh = typeof baseline?.height === 'number' ? baseline.height : null;
  const fh = typeof fresh?.height === 'number' ? fresh.height : null;
  return { baselineHeight: bh, freshHeight: fh, dHeight: bh != null && fh != null ? fh - bh : null };
}

// The round's live.json — gate.sh's record of which origin live.png is: "baseline" (the frozen origin copied
// over live.png; at = its capturedAt, originBaseline carries its figures) or "live" (a fresh capture). A round
// without --gate-against-baseline retakes a live.png whose record says "baseline"; a live.png with no record is a
// live capture, as it always was.
export function liveRecord({ origin, url, width, at = null, baseline = null }) {
  const rec = { writtenBy: LIVE_RECORD_WRITER[origin], origin, url, width: Number(width) };
  if (origin === 'baseline') {
    const b = baseline && typeof baseline === 'object' ? baseline : {};
    return { ...rec, at: b.capturedAt ?? null, originBaseline: { capturedAt: b.capturedAt ?? null, height: typeof b.height === 'number' ? b.height : null } };
  }
  return { ...rec, at };
}

// `stitch-shot.mjs baseline <dir> [--url <u>] [--width <px>]` (HELP § Origin baseline): the capturedAt or the
// one-line reason on stdout; exit 0 usable, 1 not.
export function baselineCommand(argv) {
  const [dir, ...rest] = argv;
  const usage = (msg) => { console.error(`stitch-shot baseline: ${msg}\n\n${HELP}`); return 1; };
  if (!dir || dir.startsWith('--')) return usage('needs <dir>');
  const o = { url: null, width: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`);
    if (a === '--url') o.url = v; else if (a === '--width') o.width = v; else return usage(`unknown flag ${a}`);
    i += 1;
  }
  if (o.width != null && !/^\d+$/.test(o.width)) return usage('--width needs a whole number of px');
  const s = baselineStatus(dir, o);
  process.stdout.write(`${s.ok ? String(s.provenance.capturedAt || 'unknown') : s.why}\n`);
  return s.ok ? 0 : 1;
}

// `stitch-shot.mjs record <live.json> --origin live|baseline --url <u> --width <px> [--baseline <json>] [--at <iso>]`
// (HELP § Origin baseline): the round's live.json, written atomically. Exit 0 written; 1 usage.
export function recordCommand(argv) {
  const [file, ...rest] = argv;
  const usage = (msg) => { console.error(`stitch-shot record: ${msg}\n\n${HELP}`); return 1; };
  if (!file || file.startsWith('--')) return usage('needs <live.json>');
  const o = { origin: null, url: null, width: null, baseline: null, at: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`);
    if (a === '--origin') o.origin = v; else if (a === '--url') o.url = v; else if (a === '--width') o.width = v;
    else if (a === '--baseline') o.baseline = v; else if (a === '--at') o.at = v;
    else return usage(`unknown flag ${a}`);
    i += 1;
  }
  if (!LIVE_RECORD_WRITER[o.origin]) return usage('--origin must be live or baseline');
  if (!o.url || !o.width || !/^\d+$/.test(o.width)) return usage('--url <u> and --width <px> are required');
  if (o.origin === 'baseline' && !o.baseline) return usage('--origin baseline needs --baseline <baseline.json>');
  let baseline = null;
  if (o.baseline) {
    try { baseline = JSON.parse(readFileSync(o.baseline, 'utf8')); } catch (e) { return usage(`cannot read ${o.baseline} (${e.message})`); }
  }
  writeJsonAtomic(file, liveRecord({ origin: o.origin, url: o.url, width: o.width, at: o.at, baseline }));
  return 0;
}

// Dismiss both overlay classes (consent + timed marketing modals) via
// live-session, log what was closed, and note that the mouse is parked by
// dismissOverlays itself (bottom-left — rule 10).
async function dismissAndLog(page, url, opts) {
  const extra = overlayExtras(opts);
  // late-modal poll window only on live targets — the served prototype's
  // overlays are not timed third-party scripts, they render immediately.
  const d = await dismissOverlays(page, { extra, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  if (d.consent) console.log(`consent dismissed via ${d.consent}`);
  for (const sel of d.extra) console.log(`overlay dismissed via extra selector ${sel}`);
  for (const sel of d.marketing) console.log(`marketing modal dismissed via ${sel}`);
  return d;
}

// Fixed / sticky layers, captured once. A layer is { kind: 'fixed' | 'sticky' | other, top0, backdrop } (top0 = the
// document top it has in its own place, measured as position: static — the sticky offset dropped, nothing else moves). Chunk 1 shows every
// layer; from chunk 2 a fixed layer is hidden, a sticky one while it is stuck (displaced from top0), so a sticky element
// still in its own place mid-page stays in the capture. A backdrop is never hidden; a layer a scroll class took back
// into the flow (neither fixed nor sticky now) shows. Runs in the page too (layerPassScript) — this is the rule there.
export const layerAction = (layer, chunkIndex, docTopNow) => {
  if (chunkIndex === 0 || layer.backdrop) return 'show';
  if (layer.kind === 'fixed') return 'hide';
  if (layer.kind === 'sticky') return Math.abs(docTopNow - layer.top0) > 1 ? 'hide' : 'show';
  return 'show';
};
// A layer that is the page's backdrop, not chrome: a negative z-index, or ≥ 90 % of the viewport covered (a
// `position: fixed; inset: 0` background or video) — hiding it would show the body background from chunk 2 on.
export const isBackdrop = (layer, vw, vh) => {
  if (layer.z < 0) return true;
  const w = Math.max(0, Math.min(layer.x + layer.w, vw) - Math.max(layer.x, 0));
  const h = Math.max(0, Math.min(layer.y + layer.h, vh) - Math.max(layer.y, 0));
  return w * h >= 0.9 * vw * vh;
};
// Runs IN THE PAGE, once per chunk after its scroll (layerPassScript serializes it with layerAction and isBackdrop, so
// the rule the tests check is the rule that runs): tags the outermost fixed / sticky elements not tagged yet — at chunk
// 1 every one at scroll 0; later a header a scroll class made fixed, a widget injected since — then applies the rule
// to every tagged layer: opacity 0 (layout never moves), the page's own inline opacity and its priority kept aside and
// restored. Tagging is idempotent (data-sd-layer). → the layers tagged in this pass.
function layerPass(chunkIndex, action, backdropOf) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const docTop = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
  const inFlowTop = (el) => {
    const s = el.style; const v = s.getPropertyValue('position'); const p = s.getPropertyPriority('position');
    s.setProperty('position', 'static', 'important'); const t = docTop(el);
    if (v) s.setProperty('position', v, p); else s.removeProperty('position');
    return t;
  };
  const tagged = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.hasAttribute('data-sd-layer')) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (el.parentElement && el.parentElement.closest('[data-sd-layer]')) continue; // the outermost layer only
    const r = el.getBoundingClientRect();
    const l = { kind: cs.position, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), z: parseInt(cs.zIndex, 10), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && cs.visibility !== 'hidden', text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160), name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` };
    l.backdrop = backdropOf(l, vw, vh);
    el.setAttribute('data-sd-layer', l.backdrop ? 'backdrop' : '');
    tagged.push(l);
  }
  for (const el of document.querySelectorAll('[data-sd-layer]')) {
    const kind = getComputedStyle(el).position;
    const sticky = kind === 'sticky';
    const hide = action({ kind, top0: sticky ? inFlowTop(el) : null, backdrop: el.getAttribute('data-sd-layer') === 'backdrop' }, chunkIndex, sticky ? docTop(el) : null) === 'hide';
    const hidden = el.hasAttribute('data-sd-opacity');
    if (hide && !hidden) {
      el.setAttribute('data-sd-opacity', el.style.getPropertyValue('opacity')); el.setAttribute('data-sd-opacity-priority', el.style.getPropertyPriority('opacity'));
      el.style.setProperty('opacity', '0', 'important');
    }
    if (!hide && hidden) {
      const o = el.getAttribute('data-sd-opacity'); const p = el.getAttribute('data-sd-opacity-priority') || '';
      el.removeAttribute('data-sd-opacity'); el.removeAttribute('data-sd-opacity-priority');
      if (o) el.style.setProperty('opacity', o, p); else el.style.removeProperty('opacity');
    }
  }
  return tagged;
}
// The expression page.evaluate runs for chunk `chunkIndex`: layerPass with the exported rule passed in as source (a
// string, so the page's CSP never sees an eval).
export const layerPassScript = (chunkIndex) => `(${layerPass})(${Number(chunkIndex)}, ${layerAction}, ${isBackdrop})`;
// A fixed layer still on screen after the dismissal sweeps, sized like an overlay (≥ 5 % of the viewport; below the top
// bar, or a full-viewport one) and reading like consent / sign-up copy: an overlay no candidate closed (pass --consent
// / --dismiss). A full-viewport one is a backdrop, kept in every chunk — the WARNING matters most there.
const OVERLAY_TEXT = /cookie|consent|privacy|gdpr|newsletter|subscribe|sign up|sign-up/i;
export function overlaySuspects(layers, vw, vh) {
  return layers.filter((l) => l.kind === 'fixed' && l.visible && l.w * l.h >= 0.05 * vw * vh && (l.y > 0.1 * vh || l.backdrop) && OVERLAY_TEXT.test(l.text || ''));
}
// <out.png> → the record beside it (live.png → live.capture.json).
export const sidecarOf = (out) => `${out.replace(/\.png$/i, '')}.capture.json`;

// gotoLive reads the entry for a 2xx denial page; this reads the page once more after the dismissal sweep(s) — a
// denial page a script renders after domcontentloaded. A marker → BotChallengeError (exit 3), with the entry's
// status. Returns capture.json's denialCheck: 'ok' (read, no marker) | 'skipped: <reason>' (the probe failed twice,
// or a live-session.mjs copy that predates pageDenial) — a skip is one stderr line AND on the record, never a
// silent pass.
export async function recheckDenial(session, page, url, status) {
  if (typeof session.pageDenial !== 'function' || typeof session.botChallengeError !== 'function') {
    console.error('stitch-shot: denial-page check skipped (live-session.mjs predates pageDenial — copy the diff skill\'s live-session.mjs alongside)');
    return 'skipped: live-session.mjs predates pageDenial';
  }
  const { marker, skipped } = await session.pageDenial(page);
  if (skipped) console.error(`stitch-shot: denial-page check skipped (${skipped})`);
  if (marker) throw session.botChallengeError(url, `HTTP ${status} ${marker}`, { denial: true });
  return skipped ? `skipped: ${skipped}` : 'ok';
}

// exit 3 = bot challenge on the live side — an edge interstitial or a 2xx denial page (distinct from generic errors,
// so a gate runner can tell "blocked — escalate with --headed" from "capture broke").
export const exitCodeFor = (e) => (e && e.name === 'BotChallengeError' ? 3 : 1);

async function main() {
  // The browserless subcommands gate.sh calls (HELP § Origin baseline) — before parseArgs, which needs <url> <out.png>.
  const sub = process.argv[2];
  if (sub === 'record' || sub === 'baseline') process.exit(sub === 'record' ? recordCommand(process.argv.slice(3)) : baselineCommand(process.argv.slice(3)));
  const { url, out: given, opts } = parseArgs(process.argv);
  // --freeze-baseline / --check-baseline: the targets are settled before any capture — a freeze always lands in
  // <dir>/baseline.png (never the given live.png), a check never writes baseline.png (refused, exit 2), a
  // re-freeze over an existing baseline refuses without --force. Without the flags `out` is the given path.
  const targets = baselineTargets(given, opts);
  if (targets.refusal) { console.error(`stitch-shot: ${targets.refusal}`); process.exit(2); }
  if (targets.redirected) console.error(`stitch-shot: --freeze-baseline writes the frozen origin baseline to ${targets.out}, not ${given} (live.png is a round's live shot, never a freeze target)`);
  const { out, baselineDir } = targets;
  if (opts.freezeBaseline && baselineExists(baselineDir) && !opts.force) {
    const prev = readBaselineProvenance(baselineDir);
    console.error(`stitch-shot: a frozen baseline already exists in ${baselineDir} (captured ${prev?.capturedAt ?? 'unknown'}) — pass --force to re-freeze`);
    process.exit(2);
  }
  // The capture record beside <out.png>; a freeze writes baseline.json instead and leaves no capture record.
  const sidecar = opts.freezeBaseline ? null : sidecarOf(out);
  if (sidecar) rmSync(sidecar, { force: true }); // a refused or failed capture leaves no record of an earlier one
  // Lazy: --help, the subcommands, the refusals above and the pure tests need neither playwright nor pngjs.
  let chromium; let PNG;
  try { ({ chromium } = await import('playwright')); ({ PNG } = await import('pngjs')); } catch (e) { throw new Error(`playwright / pngjs not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`); }
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    // UA + standard headers + webdriver spoof on the context (live-session).
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale,
      viewport: { width: opts.width, height: opts.vh },
    });
    const page = await ctx.newPage();
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page must never be stitched as if it were the source.
    // solveWindow only under --headed: headless clearance never lands, and
    // the solve loop would spend the Akamai block budget (1 hit vs up to 4).
    const entry = await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, solveWindow: opts.headed });
    await page.waitForTimeout(opts.wait);
    // --no-dismiss: the capture shows whatever the site shows (the gate's --no-dismiss reaches both sides).
    if (opts.noDismiss) console.log('overlays left as the page shows them (--no-dismiss)');
    else await dismissAndLog(page, url, opts);

    if (opts.settle) {
      // Slow-scroll settle: fires scroll-triggered lazy loaders the way a real
      // visit does. Do NOT force data-src→src swaps: on CDN-defended sites the
      // forced rendition requests 403 and produce broken-image icons — worse
      // than the site's own designed placeholders. Ground truth is the page as
      // observable by this instrument (capture-state policy).
      await page.evaluate(async () => {
        for (let y = 0; y <= document.body.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((r) => { setTimeout(r, 220); });
        }
      });
      await page.waitForTimeout(3000);
      // Timed marketing/newsletter modals (CH-1) often fire DURING the settle
      // window — sweep again so a late interstitial isn't baked into the
      // stitched capture (recorded: a fashion retailer's "Sign up, stay updated!").
      if (!opts.noDismiss) await dismissAndLog(page, url, opts);
    }

    // A denial page a script rendered after domcontentloaded (gotoLive read the entry): exit 3, no PNG, no sidecar.
    const denialCheck = await recheckDenial(liveSession, page, url, entry.status());

    // Freeze animations/transitions/carets for stable chunks — AFTER settle.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;}html{scroll-behavior:auto!important}' });
    // The CSS freeze above stabilizes CSS animations only (an energy-company replica run,
    // 2026-08-26 — field-validated instrument fix). It does NOT stop
    // (a) <video> playback — autoplaying teaser videos capture an arbitrary
    // frame per run, so the same page never pixel-matches itself; (b) JS-timer
    // carousels (slick autoplay swaps slides between/during chunk captures
    // even with transition:none). Fix, applied symmetrically to both sides:
    // pause every video and seek it to t=0 (frame 0 is deterministic), and
    // clear all pending timeouts/intervals so timer-driven UI stops mutating
    // mid-capture. Runs AFTER settle, so clearing timers can't starve
    // lazyload — the settle pass already ran.
    await page.evaluate(async () => {
      const vids = [...document.querySelectorAll('video')];
      await Promise.all(vids.map((v) => new Promise((res) => {
        try {
          v.pause();
          v.removeAttribute('autoplay');
          if (v.readyState >= 1) { v.currentTime = 0; }
          if (v.seeking) { v.addEventListener('seeked', () => res(), { once: true }); setTimeout(res, 1500); }
          else { setTimeout(res, 200); }
        } catch { res(); }
      })));
      let id = window.setTimeout(() => {}, 0);
      while (id-- > 0) { window.clearTimeout(id); window.clearInterval(id); }
    });
    // Carousel t=0 determinism (same field run): autoplay advances during the
    // settle window, so each capture lands on an arbitrary slide (the replica
    // freeze policy is slide 1 at t=0). Clicking the first slick-convention
    // dot resets BOTH sides to slide 1 — transitions are already frozen, so
    // the reset is instant and symmetric; no-op on pages without the
    // convention. Took the residual 4% → 0.8% in the field.
    await page.evaluate(() => {
      const dot = document.querySelector('.slick-dots li:first-child button');
      if (dot) {
        dot.click();
        // slick can re-arm its autoplay interval on interaction, and the
        // chunk loop below is long — clear timers again after the click so
        // nothing mutates mid-capture.
        let id = window.setTimeout(() => {}, 0);
        while (id-- > 0) { window.clearTimeout(id); window.clearInterval(id); }
      }
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);

    // Font-load assertion (F-B2 companion): a webfont that failed to fetch
    // renders the ENTIRE capture in fallback type — wrong wraps, wrong
    // heights, wrong doc height — with no error anywhere, the same silent
    // false-measurement class as capturing a challenge page. Report failed
    // faces loudly. Not a hard exit: the instrument can't tell an
    // instrument-induced failure (a capture defect — recorded F-B2: forced
    // request headers killed the Typekit CORS fetch, live doc height moved
    // 6669→6518 after the fix) from a face that genuinely fails for real
    // browsers too (capture-state — fallback is then the truthful capture).
    // The gate doc (source-fidelity-gate.md § Hardening rule 14) owns the
    // decision procedure; this warning is what triggers it.
    const failedFonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...new Set([...document.fonts].filter((f) => f.status === 'error').map((f) => f.family))];
    }).catch(() => []);
    if (failedFonts.length) {
      console.error(`stitch-shot WARNING: FONT LOAD FAILED for declared face(s) ${failedFonts.join(', ')} — this capture renders fallback type (silent false measurement, F-B2 class). Verify the face loads in a real browser: instrument-induced → fix the capture before gating; genuinely broken on the live site → log as capture-state.`);
    }
    // --freeze-baseline never freezes a capture whose fonts failed: a baseline in fallback type would bake the
    // wrong wraps and heights into every later round. Nothing is written — fix the capture, then re-freeze.
    if (opts.freezeBaseline && failedFonts.length) {
      console.error(`stitch-shot: not freezing a baseline — the capture's font load failed (${failedFonts.join(', ')}); fix the capture, then re-freeze`);
      process.exitCode = 2;
      return;
    }

    // Height is measured AFTER the settle pass, never before: entrance-
    // animated sites inflate scrollHeight until elements go inview (their
    // translate3d entrance transforms extend the document; recorded: 3183px
    // pre-settle vs 3093px settled). Pre-settle height is fake — mirror this
    // ordering in any ad-hoc probe that reads document height.
    const totalH = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    if (!totalH || totalH < 10) throw new Error(`page height ${totalH}px — blank render? (bot challenge / hidden body)`);

    const chunks = [];
    const layers = []; let lateLayers = 0;
    let y = 0;
    let prevActualY = null;
    while (y < totalH) {
      const target = chunkTarget(y, totalH, opts.vh);
      await page.evaluate((ty) => window.scrollTo(0, ty), target);
      await page.waitForTimeout(450);
      // wait for in-viewport images to complete (max 3s per chunk)
      await page.evaluate(async () => {
        const t0 = Date.now();
        const pend = () => [...document.querySelectorAll('img')].some((i) => {
          const r = i.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.width > 10 && (!i.complete || i.naturalWidth === 0);
        });
        while (pend() && Date.now() - t0 < 3000) await new Promise((r) => { setTimeout(r, 150); });
      });
      const actualY = await page.evaluate(() => window.scrollY);
      // layers captured once (layerPassScript — layerAction in the page): chunk 1 tags them at scroll 0, and a fixed
      // or sticky layer that appears later (a scroll class, an injected widget) is tagged when it does — one WARNING
      const tagged = await page.evaluate(layerPassScript(chunks.length));
      layers.push(...tagged);
      if (!chunks.length) {
        for (const l of overlaySuspects(tagged, opts.width, opts.vh)) {
          console.error(`stitch-shot WARNING: a fixed overlay is still showing after the dismissal sweeps (${l.w}x${l.h} at y ${l.y}: "${l.text.slice(0, 60)}…") — a consent / marketing overlay no candidate closed? Pass --consent <accept selector> or --dismiss <close selector> (to both sides).`);
        }
      } else if (tagged.length) {
        lateLayers += tagged.length;
        console.error(`stitch-shot WARNING: ${tagged.map((l) => `${l.kind} ${l.name}${l.backdrop ? ' (backdrop, kept)' : ''}`).join(', ')} turned fixed / sticky after scroll 0 (chunk ${chunks.length + 1}, y ${actualY}: a scroll-triggered header or an injected widget) — tagged there and captured once from there on.`);
      }
      // Scroll-stall guard: on inner-scroller / scroll-jacked pages (html/body
      // overflow:hidden with a scrolling wrapper) the document reports totalH px
      // but window.scrollTo is a NO-OP — window.scrollY stays put, every chunk
      // captures the top viewport, and the rows below stitch as zero-filled
      // black: a silently fictitious pixel diff. Fail loud instead.
      // Threshold is a small fractional-scroll tolerance (4px), NOT a material
      // shortfall (vh/2): a jacked page with settled height between vh+1 and
      // 1.5*vh puts chunk 2's clamped target at <= vh/2, which a vh/2 bar can
      // never catch — those pages emitted silent black bands. On a legit page
      // actualY reaches the clamped target (the last chunk's totalH - vh is
      // reachable by construction), so the no-advance condition stays false;
      // the 4px slack absorbs fractional-pixel scroll rounding.
      if (scrollStalled(prevActualY, actualY, target)) {
        throw new Error(`scroll stall at chunk target ${target}px: window scroll is a no-op (window.scrollY stuck at ${actualY}px) while the document reports ${totalH}px — likely an inner scroll container / scroll-jacked layout (html/body overflow:hidden). Stitched capture cannot measure this page class (capturing the inner scroller is future work): record the page as gate-blocked for the pixel probe and rely on content-diff/visual-diff.`);
      }
      prevActualY = actualY;
      const buf = await page.screenshot();
      chunks.push({ y: actualY, buf });
      y += opts.vh;
    }

    const outPng = new PNG({ width: opts.width, height: totalH });
    outPng.data = stitchRows(chunks.map(({ y: cy, buf }) => ({ y: cy, img: PNG.sync.read(buf) })), opts.width, totalH);
    mkdirSync(dirname(out), { recursive: true });
    const pngBuf = PNG.sync.write(outPng);
    // --freeze-baseline writes baseline.png atomically (sibling temp + rename): a crash mid-write never leaves a
    // torn PNG a gate round would read as the origin. A normal capture keeps the plain write.
    if (opts.freezeBaseline) { const tmp = `${out}.${process.pid}.tmp`; writeFileSync(tmp, pngBuf); renameSync(tmp, out); }
    else writeFileSync(out, pngBuf);
    if (opts.freezeBaseline) {
      writeJsonAtomic(join(baselineDir, BASELINE_JSON), baselineProvenance({ url, width: opts.width, vh: opts.vh, height: totalH, settle: opts.settle, chunks: chunks.length, fontsFailed: failedFonts, fixedLayers: { capture: 'once', count: layers.length, late: lateLayers } }));
      console.log(`froze origin baseline in ${baselineDir}: ${BASELINE_PNG} + ${BASELINE_JSON} (${opts.width}x${totalH}px)`);
    }
    if (sidecar) writeFileSync(sidecar, `${JSON.stringify({ writtenBy: 'skills/replica/scripts/stitch-shot.mjs', url, width: opts.width, vh: opts.vh, height: totalH, chunks: chunks.length, denialCheck, fixedLayers: { capture: 'once', count: layers.length, late: lateLayers }, at: new Date().toISOString() }, null, 2)}\n`);
    if (opts.checkBaseline) {
      const base = readBaselineProvenance(baselineDir);
      if (!base) console.log(`check-baseline: no frozen baseline in ${baselineDir} — freeze one first (nothing to compare)`);
      else {
        const d = compareBaseline(base, { height: totalH });
        const dh = d.dHeight === null ? 'unknown' : `${d.dHeight >= 0 ? '+' : ''}${d.dHeight}px`;
        console.log(`check-baseline ${baselineDir}: Δheight ${dh} (baseline ${d.baselineHeight ?? '?'} → fresh ${d.freshHeight}; frozen ${base.capturedAt ?? 'unknown'})`);
      }
    }
    console.log(`stitched ${out}: ${opts.width}x${totalH} from ${chunks.length} chunks`);
  } finally {
    await browser.close();
  }
}

// Main-module guard by real path (a symlinked checkout or temp dir must not turn the CLI into a silent no-op): the
// test imports the helpers above without starting a capture.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => {
    if (e instanceof UsageError) { console.error(`${e.message}\n\n${HELP}`); process.exit(1); }
    console.error(`stitch-shot error: ${e.message}`); process.exit(exitCodeFor(e));
  });
}
