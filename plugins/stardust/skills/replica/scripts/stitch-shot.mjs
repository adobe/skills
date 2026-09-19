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
 *     never captured as if it were the source (the Access-Denied trap). The
 *     capture climbs the ladder itself (live-session launchLadder: headless →
 *     real Chrome headless → off-screen window; --headed starts at tier 2).
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
 *     failed to fetch renders the whole capture in fallback type — the same
 *     silent-false-measurement class as capturing a challenge page. After
 *     document.fonts.ready, any declared FontFace with status 'error' is
 *     reported LOUDLY with the family names; the operator must decide
 *     whether the failure is instrument-induced (a capture defect — fix the
 *     instrument) or real on the live site (capture-state — log it).
 *   - page height is measured AFTER the settle pass: entrance-animated
 *     sites inflate scrollHeight until elements go inview, so the
 *     pre-settle height is fake.
 *   - PROVENANCE SIDECAR: every capture writes <out>.png.json next to the
 *     PNG (schema in ./capture-sidecar.mjs): url, width, vh, dpr,
 *     capturedAt, instrument {name, version, options}, consent {mode, via},
 *     dismissed[], fontsFailed[], docHeight, chunks, source, technique.
 *     pixel-compare / crop-compare refuse a pair whose sidecars differ in
 *     instrument.name, width, vh, dpr or consent.mode — mixed-instrument and
 *     mixed-consent compares produced whole false rounds in the field.
 *   - CONSENT MODE is one instrument parameter, the same on capture and
 *     gate: --consent-mode accept (default) clicks accept; deny goes through
 *     live-session's dismissOverlays({ mode: 'deny' }), which clicks a
 *     reject-all control (--consent <sel> first, then OneTrust / Usercentrics
 *     / "Reject all") and NEVER tries the accept list. A consent dialog that
 *     is present but cannot be denied — or that got accepted anyway — is an
 *     INVALID CAPTURE: exit 5, no PNG, no sidecar, no verdict (never a FAIL,
 *     never a silently accept-state reference certified as deny-state). Deny
 *     is right when accepting loads nondeterministic third-party walls the
 *     build cannot carry. The mode is recorded in the sidecar; the project's
 *     choice lives in progress.json#captureState.consent.
 *   - the extract crawl's resolved consent selector
 *     (stardust/current/_crawl-log.json#consent.method = "dismissed:<sel>" or
 *     "text:<label>") is picked up as the default --consent when present.
 *
 * Usage:
 *   node skills/replica/scripts/stitch-shot.mjs <url> <out.png> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --vh <px>           viewport height / chunk size      (default 900)
 *     --settle            slow-scroll lazyload settle pass before capture
 *                         (use on live JS-heavy pages; harmless elsewhere)
 *     --consent <sel>     extra consent selector, tried before the built-in
 *                         candidates (the reject list in deny mode);
 *                         "text:<label>" matches a button by its exact label
 *                         (recorded as consent.via "text:<label>")
 *     --consent-mode <m>  accept | deny (default accept; see above)
 *     --dismiss <sel,...> extra overlay-dismiss selectors (marketing modals
 *                         with non-standard close controls)
 *     --headed[=window]    bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 1200; 3000 with --settle)
 *     --timeout <ms>      goto timeout                      (default 60000)
 *
 * Example:
 *   node skills/replica/scripts/stitch-shot.mjs https://www.example.com \
 *     stardust/replica/gates/home-1440/live.png --width 1440 --settle
 *
 * Requires: playwright, pngjs (project devDependencies), and the diff skill's
 * scripts dir alongside (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 written (PNG + sidecar), 1 error, 3 bot challenge (live side
 * blocked — fail loud, never captured), 5 invalid capture (--consent-mode
 * deny: consent dialog present but no reject control, or accepted — no verdict).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeSidecar } from './capture-sidecar.mjs';

// Bump when the capture PROCEDURE changes (settle, freeze, dismissal order):
// recorded in the sidecar so a reference taken by an older procedure is
// visibly older. Comparability is keyed on instrument.name, not version.
const INSTRUMENT = { name: 'stitch-shot', version: '2' };
// --consent-mode deny is implemented ONCE, in live-session's dismissOverlays
// ({ mode: 'deny' }): its reject list is tried, its accept list never is.
class InvalidCaptureError extends Error { constructor(m) { super(m); this.name = 'InvalidCaptureError'; } }

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
const { REAL_CHROME_UA, TIERS, isLiveHttpUrl, launchLadder, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, dismissOverlays } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `stitch-shot — scroll-and-stitch full-page screenshot (symmetric capture instrument)

Usage: node stitch-shot.mjs <url> <out.png> [options]
  --width <px>      viewport width (default 1440)
  --vh <px>         viewport height / chunk size (default 900)
  --settle          slow-scroll lazyload settle pass before capture
  --consent <sel>   extra consent selector (clicked, not removed); "text:<label>" for a label match
  --consent-mode <m> accept | deny (default accept; deny with no reject control, or accepted → exit 5)
  --dismiss <sel,…> extra overlay-dismiss selectors (marketing modals etc.)
  --headed[=window]  bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB) for geo determinism
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 1200; 3000 with --settle)
  --timeout <ms>    goto timeout (default 60000)
  --help            this text

Run the SAME command shape against the live page and the served prototype.
Writes <out.png>.json (provenance sidecar: schema in capture-sidecar.mjs).
Exit codes: 0 written, 1 error, 3 bot challenge (live side blocked — fail loud),
5 invalid capture (deny mode: consent present and not rejected — no verdict).`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, vh: 900, settle: false, consent: null, consentMode: 'accept', dismiss: [], headed: false, locale: null, ua: REAL_CHROME_UA, wait: null, timeout: 60000 };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--vh') { opts.vh = Number(rest[i += 1]); }
    else if (a === '--settle') { opts.settle = true; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--consent-mode') { opts.consentMode = rest[i += 1]; if (!['accept', 'deny'].includes(opts.consentMode)) { console.error(`--consent-mode must be accept or deny\n\n${HELP}`); process.exit(1); } }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed' || a.startsWith('--headed=')) { opts.headed = parseHeadedFlag(a); }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { console.error(`need <url> and <out.png>\n\n${HELP}`); process.exit(1); }
  if (opts.wait == null) opts.wait = opts.settle ? 3000 : 1200;
  // Default --consent from the extract crawl's resolved method, so lift,
  // capture and gate dismiss the same control.
  if (!opts.consent) {
    try {
      const m = JSON.parse(readFileSync('stardust/current/_crawl-log.json', 'utf8'))?.consent?.method;
      if (typeof m === 'string' && /^dismissed:/.test(m)) opts.consent = m.slice('dismissed:'.length);
      else if (typeof m === 'string' && /^text:/.test(m)) opts.consent = m;
    } catch { /* no crawl log — built-in candidates only */ }
  }
  return { url, out, opts };
}

// "text:<label>" → an exact-label button selector (narrow matcher: overlay
// buttons only, exact short label). Returns { sel, via } — via is what the
// sidecar records.
function consentSelector(spec) {
  if (!spec) return null;
  if (/^text:/.test(spec)) { const label = spec.slice(5).trim(); return { sel: `button:has-text(${JSON.stringify(label)})`, via: `text:${label}` }; }
  return { sel: spec, via: spec };
}

// Dismiss both overlay classes (consent + timed marketing modals) via
// live-session, log what was closed, and note that the mouse is parked by
// dismissOverlays itself (bottom-left — rule 10).
async function dismissAndLog(page, url, opts, prov) {
  const cs = consentSelector(opts.consent);
  const deny = opts.consentMode === 'deny';
  // live-session owns both consent passes: --consent is the accept selector
  // (tried first, via `extra`) in accept mode and the reject selector (tried
  // first, via `reject`) in deny mode. Late-modal poll window only on live
  // targets — a served prototype's overlays are not timed third-party scripts.
  const d = await dismissOverlays(page, {
    mode: opts.consentMode,
    reject: deny && cs ? [cs.sel] : [],
    extra: [...(!deny && cs ? [cs.sel] : []), ...opts.dismiss],
    lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0,
  });
  if (deny) {
    // A deny-state capture must be deny-state: an accepted dialog (instrument
    // defect) or a dialog still up with nothing to reject is NOT captured —
    // exit 5, no verdict; a deny-mode sidecar over an accept-state PNG would
    // certify a non-comparable reference.
    if (d.consent) throw new InvalidCaptureError(`--consent-mode deny: the consent dialog was ACCEPTED via ${d.consent} — instrument defect (accept list ran in deny mode); not captured.`);
    if (d.consentPresent && !d.rejected) throw new InvalidCaptureError(`--consent-mode deny: a consent dialog is present but no reject-all control was found — pass --consent <reject-sel> (or "text:<label>"), or capture in accept mode on BOTH sides. Not captured: an accepted-state or still-dialogued reference would not be comparable to a deny-state build.`);
    if (d.rejected) {
      const via = cs && d.rejected === cs.sel ? cs.via : d.rejected;
      console.log(`consent REJECTED via ${via}`);
      prov.dismissed.push({ kind: 'consent', sel: d.rejected });
      if (prov.consent.via === 'none-detected') prov.consent.via = via;
    }
  } else if (d.consent) {
    console.log(`consent dismissed via ${d.consent}`);
    prov.dismissed.push({ kind: 'consent', sel: d.consent });
    if (prov.consent.via === 'none-detected') prov.consent.via = d.consent;
  }
  for (const sel of d.extra) {
    console.log(`overlay dismissed via extra selector ${sel}`);
    const isConsent = cs && sel === cs.sel;
    prov.dismissed.push({ kind: isConsent ? 'consent' : 'extra', sel });
    if (isConsent && prov.consent.via === 'none-detected') prov.consent.via = cs.via;
  }
  for (const sel of d.marketing) { console.log(`marketing modal dismissed via ${sel}`); prov.dismissed.push({ kind: 'marketing', sel }); }
  return d;
}

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  // The whole capture is the ladder probe: a challenge fires at navigation,
  // before any output is written, so relaunching one tier up loses nothing.
  // Start tier = max(--headed tier, the tier extract recorded) — live-session.mjs.
  const { browser } = await launchLadder(chromium, resolveStartTier(opts.headed), async (browser, tier) => {
    opts.tier = tier;
    // UA + standard headers + webdriver spoof on the context (live-session).
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale,
      viewport: { width: opts.width, height: opts.vh },
    });
    const page = await ctx.newPage();
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page must never be stitched as if it were the source.
    // solve window only at tier 3 (live-session gotoLive): headless clearance never lands, and
    // the solve loop would spend the Akamai block budget (1 hit vs up to 4).
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, tier });
    // Tier 3 parks the window off-screen; an occluded/backgrounded tab reports
    // visibilityState 'hidden' and some edges challenge it where an on-screen
    // one is admitted (playwright-recipe.md § Bot-management fallback). Never
    // shoot a hidden renderer — exit 3, same class as a challenge: not the page.
    const vis = await page.evaluate(() => document.visibilityState);
    if (vis !== 'visible') {
      console.error(`[stitch-shot] window not visible to the renderer (visibilityState=${vis}) — capture would be challenged/backgrounded`);
      process.exit(3);
    }
    await page.waitForTimeout(opts.wait);
    // provenance accumulates through the run; written as <out>.json at the end
    const prov = { consent: { mode: opts.consentMode, via: 'none-detected' }, dismissed: [], fontsFailed: [] };
    await dismissAndLog(page, url, opts, prov);

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
      await dismissAndLog(page, url, opts, prov);
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
    prov.fontsFailed = failedFonts;
    if (failedFonts.length) {
      console.error(`stitch-shot WARNING: FONT LOAD FAILED for declared face(s) ${failedFonts.join(', ')} — this capture renders fallback type (silent false measurement, F-B2 class). Verify the face loads in a real browser: instrument-induced → fix the capture before gating; genuinely broken on the live site → log as capture-state.`);
    }

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
    const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
    const side = writeSidecar(out, {
      url, width: opts.width, vh: opts.vh, dpr, capturedAt: new Date().toISOString(),
      instrument: { ...INSTRUMENT, options: { settle: opts.settle, headed: opts.headed, startTier: resolveStartTier(opts.headed), locale: opts.locale, wait: opts.wait, timeout: opts.timeout, consent: opts.consent, dismiss: opts.dismiss } },
      consent: prov.consent, dismissed: prov.dismissed, fontsFailed: prov.fontsFailed,
      docHeight: totalH, chunks: chunks.length, source: 'stitch-shot', technique: TIERS[tier - 1], tier,
    });
    console.log(`stitched ${out}: ${opts.width}x${totalH} from ${chunks.length} chunks  (consent ${prov.consent.mode}/${prov.consent.via}; sidecar ${side})`);
  });
  await browser.close();
}

// exit 3 = bot challenge on the live side (distinct from generic errors, so a
// gate runner can tell "blocked at tier 3 — interactive solve" from "capture broke").
// exit 5 = invalid capture (deny mode: consent present and not rejected, or accepted): no verdict, never a FAIL.
main().catch((e) => { console.error(`stitch-shot error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : e.name === 'InvalidCaptureError' ? 5 : 1); });
