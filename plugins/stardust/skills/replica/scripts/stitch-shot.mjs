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
 *     never captured as if it were the source (the Access-Denied trap). Escalate
 *     with --headed (stealth real Chrome).
 *   - waitUntil 'domcontentloaded' (never 'networkidle'): live sites with
 *     analytics beacons never reach networkidle — hard timeout otherwise.
 *   - TWO overlay classes dismissed: cookie consent (CLICKED accept, not DOM
 *     removal, so consent-gated layout settles the way a real visit does)
 *     AND timed marketing/newsletter interstitials (CH-1: an undismissed
 *     "Sign up!" modal bakes a pixel-diff contributor into the live capture
 *     that no prototype fidelity can null out). The mouse is PARKED
 *     afterwards (bottom-left): a dismissal click leaves the cursor over the
 *     page, and any :hover-styled element under it would be silently
 *     captured in hover state.
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
 *     failed to load renders the whole capture in fallback type — the same
 *     silent-false-measurement class as capturing a challenge page. After
 *     document.fonts.ready, every declared face with FontFace status 'error'
 *     and no LOADED face of the same family, weight and style is a DEAD FACE
 *     (deadFontFaces): a file that failed to fetch, or a local() source
 *     naming a font this browser does not have (recorded: metric fallback
 *     faces declared as local() platform fonts the gate's Linux browser
 *     lacks — the build rendered another face than the live site, and the
 *     type metrics forked). Reported LOUDLY with the family names and
 *     recorded as the --json record's fontsFailed; a failed declaration
 *     beside a loaded twin is not dead (that weight and style renders in the
 *     family), an 'unloaded' face was never needed. A check that could not
 *     run is recorded as fontsFailed null (fontCheck says why) with one
 *     stderr line — never as "every face loaded". The operator decides
 *     whether a dead face is instrument-induced (a capture defect — fix the
 *     instrument) or real on the live site (capture-state — log it).
 *   - page height is measured AFTER the settle pass: entrance-animated
 *     sites inflate scrollHeight until elements go inview, so the
 *     pre-settle height is fake.
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
 *     --headed            escalation: headed stealth real Chrome
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 1200; 3000 with --settle)
 *     --timeout <ms>      goto timeout                      (default 60000)
 *     --json <file>       after the PNG, write the capture record: url, out,
 *                         width, vh, settle, fontsFailed ([] = every declared
 *                         face loaded; the dead faces' families; null = the
 *                         check could not run, then fontCheck "failed: <msg>"),
 *                         height — gate.sh / gate-all read fontsFailed
 *
 * Example:
 *   node skills/replica/scripts/stitch-shot.mjs https://www.example.com \
 *     stardust/replica/gates/home-1440/live.png --width 1440 --settle
 *
 * Requires: playwright, pngjs (project devDependencies; imported lazily, so
 * --help and the pure helpers need neither), and the diff skill's scripts dir
 * alongside (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 written (dead faces included — gate.sh / gate-all decide),
 * 1 error, 3 bot challenge (live side blocked — fail loud, never captured). A
 * capture that fails writes no --json record (an earlier one is removed first).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { writeFileSync, mkdirSync, existsSync, realpathSync, rmSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
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
const { REAL_CHROME_UA, isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `stitch-shot — scroll-and-stitch full-page screenshot (symmetric capture instrument)

Usage: node stitch-shot.mjs <url> <out.png> [options]
  --width <px>      viewport width (default 1440)
  --vh <px>         viewport height / chunk size (default 900)
  --settle          slow-scroll lazyload settle pass before capture
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors (marketing modals etc.)
  --headed          headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB) for geo determinism
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 1200; 3000 with --settle)
  --timeout <ms>    goto timeout (default 60000)
  --json <file>     after the PNG, write the capture record (JSON, 2-space): url, out, width, vh, settle,
                    fontsFailed ([] = every declared face loaded, or the dead faces' families — a face with status
                    'error' and no loaded face of its family, weight and style: a file that failed to fetch, or a
                    local() source this browser cannot resolve; null = the check could not run, then fontCheck
                    "failed: <msg>" follows), height. gate.sh / gate-all read fontsFailed.
  --help            this text

A dead face is one stderr WARNING naming the families (the capture renders fallback type for them); a font check that
could not run is one stderr line and fontsFailed: null — never "every face loaded". Exit stays 0 either way: gate.sh
prints the check per side, gate-all fails the row (font-not-loaded:<family>, font-check-skipped:<side>).
Run the SAME command shape against the live page and the served prototype.
Exit codes: 0 written, 1 error, 3 bot challenge (live side blocked — fail loud).`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, vh: 900, settle: false, consent: null, dismiss: [], headed: false, locale: null, ua: REAL_CHROME_UA, wait: null, timeout: 60000, json: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--vh') { opts.vh = Number(rest[i += 1]); }
    else if (a === '--settle') { opts.settle = true; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a === '--json') {
      const v = rest[i += 1];
      if (v === undefined || v.startsWith('--')) { console.error(`--json needs a file\n\n${HELP}`); process.exit(1); }
      opts.json = v;
    }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { console.error(`need <url> and <out.png>\n\n${HELP}`); process.exit(1); }
  if (opts.wait == null) opts.wait = opts.settle ? 3000 : 1200;
  return { url, out, opts };
}

// ── The font check (header § FONT-LOAD assertion) — pure, no browser: the tests read these ──────────────────────────

/** Family names for the record: surrounding quotes stripped, trimmed, empties dropped, unique, sorted. */
export function fontFamilies(list) {
  const names = (list || []).map((f) => String(f ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim());
  return [...new Set(names.filter(Boolean))].sort();
}

/**
 * A face's identity for the dead-face rule: family (unquoted, case-folded) + weight + style — normal = 400, bold = 700,
 * an absent descriptor is the default. `f` is { family, weight, style } (a FontFace's descriptors) or a bare family.
 */
export function faceKey(f) {
  const face = typeof f === 'string' ? { family: f } : f || {};
  const family = fontFamilies([face.family])[0] || '';
  const w = String(face.weight ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const weight = !w || w === 'normal' ? '400' : w === 'bold' ? '700' : w;
  const style = String(face.style ?? '').trim().toLowerCase() || 'normal';
  return `${family.toLowerCase()}|${weight}|${style}`;
}

/**
 * The dead faces of a capture. `faces` = every FontFace of document.fonts after document.fonts.ready, as
 * { family, weight, style, status }. A face is dead when its status is 'error' and no face with the same key (faceKey:
 * family + weight + style) has status 'loaded' — a file that failed to fetch, or a local() source naming a font this
 * browser does not have (a FontFace does not say which; the family is what the fix needs). A failed declaration beside
 * a loaded twin is not dead (the text in that weight and style renders in the family); an 'unloaded' face was never
 * needed by any text and is not dead either. → the dead faces' families: unquoted, unique, sorted (fontFamilies).
 */
export function deadFontFaces(faces) {
  const list = Array.isArray(faces) ? faces.filter((f) => f && typeof f === 'object') : [];
  const loaded = new Set(list.filter((f) => f.status === 'loaded').map(faceKey));
  return fontFamilies(list.filter((f) => f.status === 'error' && !loaded.has(faceKey(f))).map((f) => f.family));
}

/**
 * The font check's outcome for the --json record: a face list → { fontsFailed } (checked; [] = every declared face
 * loaded, else the dead faces); an evaluate error, or no list → { fontsFailed: null, fontCheck: 'failed: <first line>' }
 * — a check that could not run is recorded as not checked, never as [].
 */
export function fontCheckOutcome(faces, error) {
  if (error == null && Array.isArray(faces)) return { fontsFailed: deadFontFaces(faces) };
  const why = error != null ? String((error && error.message) || error).split('\n')[0] : 'no face list returned';
  return { fontsFailed: null, fontCheck: `failed: ${why}` };
}

/**
 * The stderr lines for a font check's outcome (fontCheckOutcome): one WARNING naming the dead faces, or one saying the
 * check could not run (the record says fontsFailed: null); none when every declared face loaded.
 */
export function fontCheckLines({ fontsFailed, fontCheck } = {}) {
  if (!Array.isArray(fontsFailed)) return [`stitch-shot WARNING: font-load check failed (${String(fontCheck || 'failed: unknown').replace(/^failed: /, '')}) — the record says fontsFailed: null (not checked): no face is known to have loaded`];
  if (!fontsFailed.length) return [];
  return [`stitch-shot WARNING: FONT LOAD FAILED for declared face(s) ${fontsFailed.join(', ')} — this capture renders fallback type for them (silent false measurement, F-B2 class): the file failed to fetch, or a local() source names a font this browser does not have (recreation-procedure.md § Fonts policy). Verify the face loads in a real browser: instrument-induced → fix the capture before gating; genuinely broken on the live site → log as capture-state.`];
}

// Dismiss both overlay classes (consent + timed marketing modals) via
// live-session, log what was closed, and note that the mouse is parked by
// dismissOverlays itself (bottom-left — rule 10).
async function dismissAndLog(page, url, opts) {
  const extra = [...(opts.consent ? [opts.consent] : []), ...opts.dismiss];
  // late-modal poll window only on live targets — the served prototype's
  // overlays are not timed third-party scripts, they render immediately.
  const d = await dismissOverlays(page, { extra, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  if (d.consent) console.log(`consent dismissed via ${d.consent}`);
  for (const sel of d.extra) console.log(`overlay dismissed via extra selector ${sel}`);
  for (const sel of d.marketing) console.log(`marketing modal dismissed via ${sel}`);
  return d;
}

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  // Before anything can fail: a failed capture never leaves an earlier run's record beside a newer PNG.
  if (opts.json) rmSync(opts.json, { force: true });
  // Lazy: --help (inside parseArgs) and the pure helpers above need neither playwright nor pngjs.
  const [{ chromium }, { PNG }] = await Promise.all([import('playwright'), import('pngjs')]);
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
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, solveWindow: opts.headed });
    await page.waitForTimeout(opts.wait);
    await dismissAndLog(page, url, opts);

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
      await dismissAndLog(page, url, opts);
    }

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

    // Font-load assertion (F-B2 companion): a webfont that failed to load
    // renders the ENTIRE capture in fallback type — wrong wraps, wrong
    // heights, wrong doc height — with no error anywhere, the same silent
    // false-measurement class as capturing a challenge page. Every declared
    // face is read with its descriptors and status; deadFontFaces (header)
    // names the faces that failed with no loaded twin of the same family,
    // weight and style — a fetch that failed, or a local() source this
    // browser cannot resolve. Reported loudly, recorded as fontsFailed. Not a
    // hard exit: the instrument can't tell an instrument-induced failure (a
    // capture defect — recorded F-B2: forced request headers killed the
    // Typekit CORS fetch, live doc height moved 6669→6518 after the fix) from
    // a face that genuinely fails for real browsers too (capture-state —
    // fallback is then the truthful capture). The gate doc
    // (source-fidelity-gate.md § Hardening rule 14) owns the decision
    // procedure; the warning is what triggers it. A check that could not run
    // (the evaluate threw) is recorded as not checked — fontsFailed null +
    // fontCheck in the --json record, its own stderr line — never as "every
    // face loaded".
    let fontError = null;
    const faces = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
    }).catch((e) => { fontError = e; return null; });
    const fonts = fontCheckOutcome(faces, fontError);
    for (const line of fontCheckLines(fonts)) console.error(line);

    // Height is measured AFTER the settle pass, never before: entrance-
    // animated sites inflate scrollHeight until elements go inview (their
    // translate3d entrance transforms extend the document; recorded: 3183px
    // pre-settle vs 3093px settled). Pre-settle height is fake — mirror this
    // ordering in any ad-hoc probe that reads document height.
    const totalH = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    if (!totalH || totalH < 10) throw new Error(`page height ${totalH}px — blank render? (bot challenge / hidden body)`);

    const chunks = [];
    let y = 0;
    let prevActualY = null;
    while (y < totalH) {
      const target = Math.max(0, Math.min(y, totalH - opts.vh));
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
      if (prevActualY !== null && actualY <= prevActualY && target - actualY > 4) {
        throw new Error(`scroll stall at chunk target ${target}px: window scroll is a no-op (window.scrollY stuck at ${actualY}px) while the document reports ${totalH}px — likely an inner scroll container / scroll-jacked layout (html/body overflow:hidden). Stitched capture cannot measure this page class (capturing the inner scroller is future work): record the page as gate-blocked for the pixel probe and rely on content-diff/visual-diff.`);
      }
      prevActualY = actualY;
      const buf = await page.screenshot();
      chunks.push({ y: actualY, buf });
      y += opts.vh;
    }

    const outPng = new PNG({ width: opts.width, height: totalH });
    for (const { y: cy, buf } of chunks) {
      const img = PNG.sync.read(buf);
      for (let row = 0; row < img.height; row += 1) {
        const destY = cy + row;
        if (destY >= totalH) break;
        img.data.copy(outPng.data, (destY * opts.width) * 4, (row * img.width) * 4, (row * img.width + Math.min(img.width, opts.width)) * 4);
      }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, PNG.sync.write(outPng));
    // --json: the capture record, only once the PNG is written (a failed capture leaves none). fontCheck follows
    // fontsFailed and appears only when the check could not run.
    if (opts.json) {
      mkdirSync(dirname(opts.json), { recursive: true });
      writeFileSync(opts.json, `${JSON.stringify({ url, out, width: opts.width, vh: opts.vh, settle: opts.settle, ...fonts, height: totalH }, null, 2)}\n`);
    }
    console.log(`stitched ${out}: ${opts.width}x${totalH} from ${chunks.length} chunks`);
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (distinct from generic errors, so a
// gate runner can tell "blocked — escalate with --headed" from "capture broke").
// Main-module guard: importing the module (the tests) runs nothing.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`stitch-shot error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
