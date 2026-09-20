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
 *     is present but cannot be denied — or still up after the reject click —
 *     is an INVALID CAPTURE: exit 5, no PNG, no sidecar, no verdict (never a FAIL,
 *     never a silently accept-state reference certified as deny-state). Deny
 *     is right when accepting loads nondeterministic third-party walls the
 *     build cannot carry. The mode is recorded in the sidecar; the project's
 *     choice lives in progress.json#captureState.consent.
 *   - the extract crawl's resolved consent selector
 *     (stardust/current/_crawl-log.json#consent.method = "dismissed:<sel>" or
 *     "text:<label>") is picked up as the default --consent when present.
 *   - PINNED CHROME hidden on chunks 2+ (opacity:0 !important on every
 *     position:fixed element and every sticky element currently stuck,
 *     restored after each chunk; --keep-pinned restores the old behaviour).
 *     A fixed header re-painted once per chunk was 5–17 % of "diff" on short
 *     pages and 10–20 % across four archetypes in two field runs, and two
 *     projects patched this script locally for it. Chunk 1 keeps everything
 *     (the chrome-crop gate reads chunk-1 rows). opacity, not visibility:
 *     descendants can override visibility (EDS `header .header{visibility:
 *     visible}`), nothing undoes an ancestor's opacity, and layout is kept.
 *     A SEAM DETECTOR then compares the same viewport-relative rows of
 *     consecutive chunks and WARNs when chrome the hide missed (iframe /
 *     shadow-hosted, --keep-pinned) is still baked into ≥ 2 seams.
 *   - INTEGER SCROLL: window.scrollY is rounded before a chunk is placed —
 *     a fractional scrollY put every row of a chunk half a width off
 *     (recorded twice: "half-width rotation", 26–41 % bands). A scroll that
 *     lands > 4 px short of its target fails loud (same class as the stall
 *     guard) instead of leaving an unfilled black band.
 *   - DECODE RACE: in-viewport images are img.decode()d (1.5 s bound inside
 *     the existing 3 s window) before the chunk is shot; pendingDecodes is
 *     recorded in the sidecar.
 *   - SHORT / INVALID CAPTURE → exit 5, no PNG, no verdict: the settled
 *     height is re-measured after one more --wait (a > 25 % growth is a load
 *     race — the settle re-runs and says so); --expect-height <px> (gate.sh
 *     fills it from the crawl screenshot) makes a height under 40 % of it a
 *     retry with the wait doubled, then exit 5; an error-boundary page
 *     ("Something went wrong" in main, height < 2·vh) or a fixed / dialog
 *     element still covering > 30 % of the first viewport after dismissal
 *     (--allow-overlay to capture anyway) is exit 5 too.
 *   - TAIL LINE: rows below the footer are reported (`tail Npx below footer:
 *     <elements>`) so a residual under the footer is named, not eyeballed.
 *   - --exclude <sel,…> display:none's in-flow third-party widgets AFTER the
 *     settle (layout drops them — a chat launcher in flow was Δ+32 px); run it
 *     on both sides. --exclude-live-only says ASYMMETRIC on the verdict line.
 *
 * Usage:
 *   node skills/replica/scripts/stitch-shot.mjs <url> <out.png> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --vh <px>           viewport height / chunk size      (default 900)
 *     --settle            slow-scroll lazyload settle pass before capture
 *                         (use on live JS-heavy pages; harmless elsewhere)
 *     --keep-pinned       do NOT hide fixed / stuck-sticky chrome on chunks 2+
 *     --expect-height <px> exit 5 when the settled height is < 40 % of this
 *                         (after one retry with --wait doubled)
 *     --exclude <sel,…>   display:none these after the settle (both sides)
 *     --exclude-live-only marks the --exclude list as applied on this side only
 *     --mask-sel <sel,…>  record the page-space rects of matched elements in the
 *                         sidecar masksRects[] (kind sel); fixed/sticky matches
 *                         are recorded fixed:true and are NOT to be masked
 *     --mask-iframes      record every iframe box (kind iframe)
 *     --mask-images       record every img box ≥ 40×40 (kind img)
 *     --masks-json <file> the project's inventory-declared masks
 *                         (stardust/replica/masks.json; schema + validator in
 *                         capture-sidecar.mjs): adds its sel entries to
 *                         --mask-sel and switches on the iframes/images flags it
 *                         declares; an invalid file is exit 1 before any capture
 *                         Rects are read at scroll 0 after the settle; nothing
 *                         is painted — masks are applied by the compare side,
 *                         symmetrically, from both sidecars (pixel-compare
 *                         --mask-from / --masks-json)
 *     --allow-overlay     capture even when a fixed / dialog element covers
 *                         > 30 % of the first viewport after dismissal
 *     --consent <sel>     extra consent selector, tried before the built-in
 *                         candidates (the reject list in deny mode);
 *                         "text:<label>" matches a button by its exact label
 *                         (recorded as consent.via "text:<label>")
 *     --consent-mode <m>  accept | deny (default accept; see above)
 *     --allow-consent     capture even when a consent container is still
 *                         visible after the dismissal window (default exit 5)
 *     --no-dismiss-defaults  keep live-session's persistent-widget HIDE list
 *                         off (the click passes always run)
 *     --remove-text <phrase>  hide the nearest fixed/sticky ancestor of any
 *                         element containing <phrase> (repeatable; last
 *                         resort for an undismissable bar — run on BOTH sides)
 *     --dismiss <sel,...> extra overlay-dismiss selectors (marketing modals
 *                         with non-standard close controls)
 *     --block <substr,...> abort every request whose URL contains one of the
 *                         substrings (undismissable iframe/shadow widgets); the
 *                         main-frame navigation and the page's own origin are
 *                         never blocked. Run the SAME value on both sides —
 *                         the sidecar records `blocked` and an asymmetric pair
 *                         is refused by pixel-compare
 *     --headed[=window]    bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
 *     --storage-state <file> | --fresh-state | --solve-wait <ms>  admitted-session reuse / clean start / interactive solve (live-session.mjs § Admitted-session reuse; --solve-wait implies a visible tier-3 window)
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
 * Exit codes: 0 written (PNG + sidecar), 1 error (incl. scroll stall /
 * deflection), 3 bot challenge (live side blocked, or a stitched capture
 * that is short AND challenge-phrased / near-empty — fail loud, never
 * captured), 5 invalid capture — no PNG, no sidecar, NO VERDICT, never a
 * FAIL: a consent container still visible after the dismissal window (deny
 * mode: no reject control, or still visible after the reject click; accept
 * mode: nothing matched — --consent <sel>/"text:<label>" or --allow-consent
 * on BOTH sides); settled
 * height < 40 % of --expect-height after one retry; an
 * error-boundary page; an overlay still covering > 30 % of the first
 * viewport after dismissal (--allow-overlay). gate.sh maps 5 like 3.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeSidecar, loadMasksJson } from './capture-sidecar.mjs';

// Bump when the capture PROCEDURE changes (settle, freeze, dismissal order):
// recorded in the sidecar so a reference taken by an older procedure is
// visibly older. Comparability is keyed on instrument.name, not version.
// 3: pinned chrome hidden on chunks 2+, integer scroll, decode race,
//    growth re-measure, reducedMotion on the context.
export const INSTRUMENT = { name: 'stitch-shot', version: '3' };
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
const { REAL_CHROME_UA, TIERS, isLiveHttpUrl, launchLadder, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, sessionContextOptions, parseSolveWaitFlag, challengeInDom, captureSanity, dismissOverlays, installOverlayWatch, readOverlayWatch, parseBlockList, resolveSiteAuth } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `stitch-shot — scroll-and-stitch full-page screenshot (symmetric capture instrument)

Usage: node stitch-shot.mjs <url> <out.png> [options]
  --width <px>      viewport width (default 1440)
  --vh <px>         viewport height / chunk size (default 900)
  --settle          slow-scroll lazyload settle pass before capture
  --keep-pinned     keep fixed / stuck-sticky chrome painted on chunks 2+ (default: hidden, opacity 0)
  --expect-height <px>  exit 5 when the settled height is < 40 % of this (one retry, --wait doubled)
  --exclude <sel,…> display:none these after the settle — run on BOTH sides
  --exclude-live-only   the --exclude list is applied on this side only (verdict line says ASYMMETRIC)
  --mask-sel <sel,…>  record matched elements' page-space rects in the sidecar masksRects[] (fixed/sticky: fixed:true, never masked)
  --mask-iframes      record every iframe box in masksRects[]
  --mask-images       record every img box ≥ 40×40 in masksRects[] (only geometry-matched pairs are masked by the compare)
  --masks-json <file>  inventory-declared masks (stardust/replica/masks.json; schema: capture-sidecar.mjs) — adds its sel
                    entries to --mask-sel and its iframes/images flags; an invalid file is exit 1 before any capture
  --allow-overlay   capture even when a fixed / dialog element covers > 30 % of the first viewport
  --consent <sel>   extra consent selector (clicked, not removed); "text:<label>" for a label match
  --consent-mode <m> accept | deny (default accept; deny: no reject control, or still visible after the reject click → exit 5)
  --allow-consent   capture even when a consent container is still visible after dismissal (default: exit 5)
  --no-dismiss-defaults  do not hide the persistent-widget list (CMP launcher, feedback tab…); clicks still run
  --remove-text <phrase> hide the nearest fixed/sticky ancestor of an element containing <phrase> (repeatable; last resort, BOTH sides)
  --dismiss <sel,…> extra overlay-dismiss selectors (marketing modals etc.)
  --block <substr,…> abort requests whose URL contains a substring (3rd-party widgets with no close control; never the page's own origin) — SAME value on both sides
  --headed[=window]  bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
  --storage-state <file> | --fresh-state | --solve-wait <ms>  admitted-session reuse / clean start / interactive solve (live-session.mjs; --solve-wait implies a visible tier-3 window)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB) for geo determinism
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --token-env <NAME> | --auth-header "token …"  site auth for a LOCKED delivery host (deploy lockdown.mjs writes
                    SITE_TOKEN_<SLUG>): attached as an origin-scoped route header (live-session resolveSiteAuth) to
                    .aem.page / .aem.live hosts ONLY — the live source side never receives it, so gate.sh may pass it to both calls
  --wait <ms>       initial post-load wait (default 1200; 3000 with --settle)
  --timeout <ms>    goto timeout (default 60000)
  --help            this text

Run the SAME command shape against the live page and the served prototype.
Writes <out.png>.json (provenance sidecar: schema in capture-sidecar.mjs).
Prints: pinned hidden on chunks 2+, tail below footer, WARN fixed overlay baked into N seams.
Exit codes: 0 written, 1 error (incl. scroll stall/deflection), 3 bot challenge (live side
blocked, or a short capture with a challenge DOM/phrase or near-empty text — fail loud, nothing
written), 5 invalid capture — no PNG, no sidecar, no verdict, never a FAIL:
  accept mode: consent present, not dismissed (--consent <sel>/"text:<label>" or --allow-consent, BOTH sides);
  deny mode: consent present and not rejected, or still visible after the reject click;
  height < 40 % of --expect-height after one retry; error-boundary page; overlay > 30 % (--allow-overlay).`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, vh: 900, settle: false, block: [], consent: null, consentMode: 'accept', dismiss: [], headed: false, locale: null, ua: REAL_CHROME_UA, wait: null, timeout: 60000, keepPinned: false, expectHeight: null, exclude: [], excludeLiveOnly: false, allowOverlay: false, allowConsent: false, hideDefaults: true, removeText: [], maskSel: [], maskIframes: false, maskImages: false, tokenEnv: null, authHeader: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--vh') { opts.vh = Number(rest[i += 1]); }
    else if (a === '--settle') { opts.settle = true; }
    else if (a === '--keep-pinned') { opts.keepPinned = true; }
    else if (a === '--expect-height') { opts.expectHeight = Number(rest[i += 1]); if (!(opts.expectHeight > 0)) { console.error(`--expect-height needs a positive px value\n\n${HELP}`); process.exit(1); } }
    else if (a === '--exclude') { opts.exclude = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--exclude-live-only') { opts.excludeLiveOnly = true; }
    else if (a === '--mask-sel') { opts.maskSel = (rest[i += 1] || '').split(',').map((x) => x.trim()).filter(Boolean); }
    else if (a === '--mask-iframes') { opts.maskIframes = true; }
    else if (a === '--mask-images') { opts.maskImages = true; }
    else if (a === '--masks-json') {
      let m; try { m = loadMasksJson(rest[i += 1] || ''); } catch (e) { console.error(`stitch-shot: ${e.message} — nothing captured (exit 1)`); process.exit(1); }
      for (const sel of m.sels) if (!opts.maskSel.includes(sel)) opts.maskSel.push(sel);
      opts.maskIframes = opts.maskIframes || m.iframes; opts.maskImages = opts.maskImages || m.images; opts.masksJson = rest[i];
    }
    else if (a === '--allow-overlay') { opts.allowOverlay = true; }
    else if (a === '--allow-consent') { opts.allowConsent = true; }
    else if (a === '--block') { opts.block = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--no-dismiss-defaults') { opts.hideDefaults = false; }
    else if (a === '--remove-text') { const v = rest[i += 1]; if (!v) { console.error(`--remove-text needs a phrase\n\n${HELP}`); process.exit(1); } opts.removeText.push(v); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--consent-mode') { opts.consentMode = rest[i += 1]; if (!['accept', 'deny'].includes(opts.consentMode)) { console.error(`--consent-mode must be accept or deny\n\n${HELP}`); process.exit(1); } }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed' || a.startsWith('--headed=')) { opts.headed = parseHeadedFlag(a); }
    else if (a === '--storage-state') { opts.storageState = rest[i += 1]; }
    else if (a === '--fresh-state') { opts.freshState = true; }
    else if (a === '--solve-wait') { opts.solveWaitMs = parseSolveWaitFlag(rest[i += 1]); opts.headed = 3; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--token-env') { opts.tokenEnv = rest[i += 1]; }
    else if (a === '--auth-header') { opts.authHeader = rest[i += 1]; }
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
async function dismissAndLog(page, url, opts, prov, { lateWindowMs = isLiveHttpUrl(url) ? 6000 : 0 } = {}) {
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
    lateWindowMs,
    hideDefaults: opts.hideDefaults,
    removeText: opts.removeText,
  });
  // Persistent widgets hidden by live-session (both sides, layout kept) —
  // printed and recorded so the pair's hidden lists can be compared.
  // dismissAndLog runs up to three times per capture (initial, --settle, late
  // overlay re-sweep): a hide already reported is not printed again; a count
  // that grew (late-mounted target) updates the sidecar entry and prints.
  for (const h of d.hidden || []) {
    const prev = prov.hidden.find((x) => x.kind === h.kind && x.sel === h.sel);
    if (prev && prev.count >= h.count) continue;
    if (prev) prev.count = h.count; else prov.hidden.push(h);
    if (h.count > 0) console.log(`hidden ${h.count} persistent widget(s) via ${h.sel} (${h.kind}; visibility, layout kept)`);
    else if (h.kind === 'remove-text') console.log(`--remove-text ${h.sel.slice(5)}: no element matched`);
  }
  // Fail loud (accept mode): a consent container still up after the window
  // is not the reference state — exit 5 unless --allow-consent (both sides).
  if (!deny && d.consentPresent) {
    if (!opts.allowConsent) throw new InvalidCaptureError(`consent present, not dismissed — ${d.consentContainer}: pass --consent <sel> (or "text:<label>") or --allow-consent (BOTH sides). Not captured: a banner baked into every chunk is not the page.`);
    console.log(`WARN consent present, not dismissed (${d.consentContainer}) — captured anyway (--allow-consent)`);
  }
  if (deny) {
    // A deny-state capture must be deny-state: an accepted dialog (instrument
    // defect) or a dialog still up with nothing to reject is NOT captured —
    // exit 5, no verdict; a deny-mode sidecar over an accept-state PNG would
    // certify a non-comparable reference.
    // live-session never runs the accept list in deny mode (d.consent stays
    // null), so the only invalid states are: nothing to reject, or a reject
    // control clicked while the dialog is STILL up (a reject that did not close
    // the layer — second layer, failed handler). Both are exit 5.
    if (d.consentPresent && !d.rejected) throw new InvalidCaptureError(`--consent-mode deny: a consent dialog is present (${d.consentContainer}) but no reject-all control was found — pass --consent <reject-sel> (or "text:<label>"), or capture in accept mode on BOTH sides. Not captured: an accepted-state or still-dialogued reference would not be comparable to a deny-state build.`);
    if (d.consentPresent && d.rejected && !opts.allowConsent) throw new InvalidCaptureError(`--consent-mode deny: reject control ${d.rejected} was clicked but the consent dialog is still visible (${d.consentContainer}) — the click did not close the layer (a second layer, or a handler that failed). Pass --consent <reject-sel> for the control that closes it, or --allow-consent on BOTH sides. Not captured, no verdict.`);
    if (d.consentPresent && d.rejected) console.log(`WARN consent present after reject via ${d.rejected} (${d.consentContainer}) — captured anyway (--allow-consent)`);
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
  for (const f of d.frames || []) { console.log(`frame overlay dismissed via ${f}`); prov.dismissed.push({ kind: 'frame', sel: f }); }
  return d;
}

// ---- in-page helpers (serialised into page.evaluate; keep them self-contained) ----

// Slow-scroll settle: fires scroll-triggered lazy loaders the way a real
// visit does. Do NOT force data-src→src swaps: on CDN-defended sites the
// forced rendition requests 403 and produce broken-image icons — worse
// than the site's own designed placeholders. Ground truth is the page as
// observable by this instrument (capture-state policy).
async function settlePass(page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => { setTimeout(r, 220); });
    }
  });
  await page.waitForTimeout(3000);
}

const measureHeight = (page) => page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));

// Sticky baseline: Chromium's offsetTop INCLUDES the sticky shift, so "displaced
// from layout" cannot be read off offsetTop (recorded: stuck-sticky chrome was
// never hidden — only fixed). Record every sticky element's document y at
// scroll 0, before the chunk loop; hidePinned compares against it.
function recordStickyBase(page) {
  return page.evaluate(() => {
    const m = new WeakMap();
    for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).position === 'sticky') m.set(el, el.getBoundingClientRect().top + window.scrollY);
    window.__stitchStickyBase = m;
  });
}

// Pinned chrome on chunks 2+: every position:fixed element and every sticky
// element currently STUCK (displaced from its scroll-0 position and resting at
// its top/bottom offset) gets opacity:0 !important + a marker; restorePinned
// undoes exactly that set. Returns short descriptors for the log/sidecar.
function hidePinned(page) {
  return page.evaluate(() => {
    const desc = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('');
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
    };
    const base = window.__stitchStickyBase;
    const out = [];
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh) continue;
      if (cs.position === 'sticky') {
        const docY = r.top + window.scrollY;
        const b = base && base.get(el);
        const displaced = b === undefined ? true : Math.abs(docY - b) > 1; // no baseline (mounted later): trust the offset test alone
        const top = parseFloat(cs.top); const bottom = parseFloat(cs.bottom);
        const atTop = Number.isFinite(top) && r.top <= top + 2;
        const atBottom = Number.isFinite(bottom) && r.bottom >= vh - bottom - 2;
        if (!displaced || !(atTop || atBottom)) continue;
      }
      el.setAttribute('data-stitch-hidden', el.style.getPropertyValue('opacity') || '');
      el.style.setProperty('opacity', '0', 'important');
      out.push(desc(el));
    }
    return out;
  });
}
function restorePinned(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-stitch-hidden]')) {
      const prev = el.getAttribute('data-stitch-hidden');
      el.style.removeProperty('opacity');
      if (prev) el.style.setProperty('opacity', prev);
      el.removeAttribute('data-stitch-hidden');
    }
  });
}

// Seam detector: chrome the hide missed (iframe-hosted, shadow DOM,
// --keep-pinned) repeats at the SAME viewport-relative rows of consecutive
// chunks. Compare the top 96 and bottom 96 rows of chunk N with chunk N+1 —
// same viewport rows, different page rows by construction — skipping
// uniform-colour rows (a white band, a flat header background, would
// false-positive) AND texture rows: a row byte-identical to its own in-chunk
// neighbour 8 rows up or down is a persistent vertical texture (bordered
// max-width container, side rail, 1px rule, column gutters) that is identical
// across chunks without anything being baked in. A seam "fires" when ≥ 8
// remaining rows are byte-identical, or ≥ 60 % of the compared rows are.
export function seamRepeats(chunks, width) {
  const ROWS = 96; const STRIDE = 8;
  const rowOf = (img, row) => img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4);
  const uniform = (buf) => { const [r, g, b] = buf; for (let i = 4; i < buf.length; i += 4) if (buf[i] !== r || buf[i + 1] !== g || buf[i + 2] !== b) return false; return true; };
  let seams = 0;
  for (let i = 0; i + 1 < chunks.length; i += 1) {
    const a = chunks[i].img; const b = chunks[i + 1].img;
    if (a.width !== b.width || a.height !== b.height || a.width !== width) continue;
    const rows = [...Array(ROWS).keys(), ...Array.from({ length: ROWS }, (_, k) => a.height - 1 - k)].filter((r) => r >= 0 && r < a.height);
    const texture = (r, ra) => (r - STRIDE >= 0 && Buffer.compare(ra, rowOf(a, r - STRIDE)) === 0) || (r + STRIDE < a.height && Buffer.compare(ra, rowOf(a, r + STRIDE)) === 0);
    let compared = 0; let same = 0;
    for (const r of rows) {
      const ra = rowOf(a, r);
      if (uniform(ra) || texture(r, ra)) continue;
      compared += 1;
      if (Buffer.compare(ra, rowOf(b, r)) === 0) same += 1;
    }
    if (same >= 8 || (compared >= 4 && same / compared >= 0.6)) seams += 1;
  }
  return seams;
}

// Validity (exit 5 class): an error-boundary page, or an overlay the
// dismissal did not clear. Geometric only — the consent-semantic check
// (consentPresent) is live-session's. Returns null or a reason string.
function invalidityReason(page, vh) {
  return page.evaluate((viewH) => {
    const main = document.querySelector('main, [role=main]');
    const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const txt = ((main || document.body).innerText || '').replace(/\s+/g, ' ').trim();
    if (docH < 2 * viewH && txt.length < 600 && /(something went wrong|application error|an error occurred|this page isn.t working|internal server error|service unavailable|unexpected error)/i.test(txt)) {
      return `error-boundary text in ${main ? 'main' : 'body'} on a ${docH}px page ("${txt.slice(0, 80)}")`;
    }
    const area = window.innerWidth * viewH;
    for (const el of document.querySelectorAll('[role=dialog], [aria-modal=true], body *')) {
      const cs = getComputedStyle(el);
      const dialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
      if (!dialog && cs.position !== 'fixed') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
      const z = Number(cs.zIndex);
      if (!dialog && !(z >= 100)) continue;
      if (!dialog && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') && !cs.backgroundImage.includes('url')) continue;
      const r = el.getBoundingClientRect();
      const x0 = Math.max(0, r.left); const x1 = Math.min(window.innerWidth, r.right);
      const y0 = Math.max(0, r.top); const y1 = Math.min(viewH, r.bottom);
      if (x1 <= x0 || y1 <= y0) continue;
      const cover = ((x1 - x0) * (y1 - y0)) / area;
      if (cover > 0.3) {
        const id = el.id ? `#${el.id}` : ''; const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('');
        return `${dialog ? 'dialog' : 'fixed'} element ${el.tagName.toLowerCase()}${id}${cls} covers ${Math.round(cover * 100)} % of the first viewport after dismissal (z ${cs.zIndex})`;
      }
    }
    return null;
  }, vh);
}

// Mask rects (T17.3, capture side): page-space boxes of --mask-sel matches,
// iframes and images ≥ 40×40, read at scroll 0 after the settle. Nothing is
// painted here — the compare applies masks from BOTH sidecars, symmetrically.
// A match inside fixed/sticky chrome is recorded fixed:true and never masked
// (it repeats per chunk; the recreation must replicate it — fixed-disc-at-seams).
function collectMaskRects(page, { sels, iframes, images }) {
  return page.evaluate(({ sels: ss, iframes: fi, images: im }) => {
    const sy = window.scrollY; const out = [];
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) }; };
    const pinned = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
    const push = (kind, el, extra) => { const r = rectOf(el); if (r.w < 1 || r.h < 1) return; out.push({ kind, ...extra, ...r, ...(pinned(el) ? { fixed: true } : {}) }); };
    for (const sel of ss) { try { for (const el of document.querySelectorAll(sel)) push('sel', el, { sel }); } catch { out.push({ kind: 'sel', sel, x: 0, y: 0, w: 0, h: 0, error: 'bad selector' }); } }
    if (fi) for (const el of document.querySelectorAll('iframe')) push('iframe', el, { src: (el.getAttribute('src') || '').slice(0, 80) });
    if (im) for (const el of document.querySelectorAll('img')) { const r = el.getBoundingClientRect(); if (r.width >= 40 && r.height >= 40) push('img', el, {}); }
    return out;
  }, { sels, iframes, images });
}

// Rows below the footer: a residual there is named, not eyeballed.
function tailBelowFooter(page, totalH) {
  return page.evaluate((docH) => {
    const footer = document.querySelector('footer');
    if (!footer) return null;
    const fb = Math.round(footer.getBoundingClientRect().bottom + window.scrollY);
    const px = docH - fb;
    if (px <= 8) return { px: Math.max(0, px), elements: [] };
    const els = [];
    for (const el of document.querySelectorAll('body *')) {
      if (footer.contains(el) || el.contains(footer)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 1 || r.width < 1) continue;
      const top = r.top + window.scrollY;
      if (top < fb - 1) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
      const id = el.id ? `#${el.id}` : ''; const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('');
      els.push(`${el.tagName.toLowerCase()}${id}${cls} ${Math.round(r.height)}px`);
      if (els.length >= 6) break;
    }
    return { px, elements: els };
  }, totalH);
}

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  // The whole capture is the ladder probe: a challenge fires at navigation,
  // before any output is written, so relaunching one tier up loses nothing.
  // Start tier = max(--headed tier, the tier extract recorded) — live-session.mjs.
  const { browser } = await launchLadder(chromium, resolveStartTier(opts.headed), async (browser, tier) => {
    opts.tier = tier;
    // UA + standard headers + webdriver spoof on the context (live-session).
    // reducedMotion: 'reduce' — symmetric, and one less class of entrance
    // animation to freeze (crawl.mjs captures under the same preference).
    // Site auth (T12.2): only when asked, only on a delivery host — the source side never sees the token.
    const isDeliveryHost = /\.(aem|hlx)\.(page|live)$/i.test(new URL(url).hostname); // both pipeline host families; the source side never sees the token
    const siteAuth = (opts.tokenEnv || opts.authHeader) && isDeliveryHost ? resolveSiteAuth({ authHeader: opts.authHeader, tokenEnv: opts.tokenEnv }) : null;
    if ((opts.tokenEnv || opts.authHeader) && !isDeliveryHost) console.log(`site auth not attached: ${new URL(url).hostname} is not a delivery host (.aem.page / .aem.live / .hlx.page / .hlx.live)`);
    else if ((opts.tokenEnv || opts.authHeader) && !siteAuth) console.log(`site auth not attached: ${opts.tokenEnv || 'auth header'} does not resolve — reading anonymously (a locked host will answer 401)`);
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale,
      viewport: { width: opts.width, height: opts.vh },
      reducedMotion: 'reduce',
      block: opts.block,
      ...(siteAuth ? { authOrigin: new URL(url).origin, authHeader: siteAuth } : {}),
      ...sessionContextOptions(url, opts), // the run's admitted session, live side only
    });
    const page = await ctx.newPage();
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page must never be stitched as if it were the source.
    // solve window only at tier 3 (live-session gotoLive): headless clearance never lands, and
    // the solve loop would spend the Akamai block budget (1 hit vs up to 4).
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, tier, solveWaitMs: opts.solveWaitMs });
    // provenance accumulates through the run; written as <out>.json at the end
    const prov = { consent: { mode: opts.consentMode, via: 'none-detected' }, dismissed: [], fontsFailed: [], hidden: [], visibilityState: 'visible' };
    // Tier 3 parks the window off-screen with the anti-backgrounding flags
    // (live-session OFFSCREEN_ARGS); headless renderers are always 'visible'.
    // A 'hidden' renderer defers media loading (recorded on a CDP-driven tab:
    // a false 4.75 → 11.49 % regression), so say it loudly — a WARN, not an
    // exit: a challenge is gotoLive's to detect, and the decode race +
    // pendingDecodes below report what a backgrounded tab left undecoded.
    const vis = await page.evaluate(() => document.visibilityState).catch(() => 'visible');
    if (vis !== 'visible') console.log(`WARN document.visibilityState=${vis} — the renderer is backgrounded/occluded (tier ${tier}); media may load deferred — read pendingDecodes, re-run with STARDUST_HEADED_WINDOW=1 if it is non-zero`);
    prov.visibilityState = vis;
    await page.waitForTimeout(opts.wait);
    await dismissAndLog(page, url, opts, prov);
    // Late-mount watch: overlays that mount AFTER the dismissal window would be
    // baked into every chunk below their arrival (recorded: a consent banner
    // in ~7 chunks). A MutationObserver flags new fixed/dialog nodes; the
    // settle re-sweep and the chunk loop re-sweep (one pass each, no window)
    // when it reports any. Installed BEFORE the settle so the settle's mounts
    // are seen too.
    await installOverlayWatch(page);

    if (opts.settle) {
      await settlePass(page);
      // Timed marketing/newsletter modals (CH-1) often fire DURING the settle
      // window — sweep again so a late interstitial isn't baked into the
      // stitched capture (recorded: a fashion retailer's "Sign up, stay updated!").
      // ONE pass: the 6 s late window already ran once on this page load; a
      // second full window doubled every live capture's wall-clock for nothing
      // the watch + chunk-loop re-sweep would not catch.
      await dismissAndLog(page, url, opts, prov, { lateWindowMs: 0 });
    }

    // --exclude: in-flow third-party widgets (chat launchers, feedback tabs)
    // that no dismissal removes. display:none AFTER the settle so layout
    // drops them the same way on both sides; the sidecar records the list.
    if (opts.exclude.length) {
      const counts = await page.evaluate((sels) => sels.map((sel) => { let n = 0; try { for (const el of document.querySelectorAll(sel)) { el.style.setProperty('display', 'none', 'important'); n += 1; } } catch { n = -1; } return n; }), opts.exclude);
      opts.exclude.forEach((sel, i) => {
        prov.hidden.push({ kind: 'exclude', sel, count: counts[i], liveOnly: opts.excludeLiveOnly });
        console.log(`excluded ${counts[i] < 0 ? '(bad selector)' : `${counts[i]} element(s)`} via ${sel}${opts.excludeLiveOnly ? '  ASYMMETRIC (--exclude-live-only: applied on this side only)' : ''}`);
      });
    }

    // Short-capture guard, instrument-internal first: a load race leaves the
    // page short at the settled height (recorded: a 360 capture of 1557 px on
    // a 39 k-px page). Re-measure after one more --wait; > 25 % growth means
    // the page was still loading — settle again and say so.
    let h1 = await measureHeight(page);
    await page.waitForTimeout(opts.wait);
    let h2 = await measureHeight(page);
    if (h2 > 1.25 * h1) {
      console.log(`height grew ${h1}→${h2}px after extra wait (load race) — re-running settle`);
      if (opts.settle) await settlePass(page); else await page.waitForTimeout(opts.wait);
      h1 = h2; h2 = await measureHeight(page);
    }
    // --expect-height (gate.sh: the crawl screenshot's height): a valid page
    // is never < 40 % of it. Retry once with the wait doubled, then exit 5.
    if (opts.expectHeight && h2 < 0.4 * opts.expectHeight) {
      console.log(`settled height ${h2}px < 40 % of expected ${opts.expectHeight}px — retrying once with --wait ${opts.wait * 2}`);
      await page.waitForTimeout(opts.wait * 2);
      if (opts.settle) await settlePass(page);
      h2 = await measureHeight(page);
      if (h2 < 0.4 * opts.expectHeight) throw new InvalidCaptureError(`capture invalid (short): settled height ${h2}px is < 40 % of the expected ${opts.expectHeight}px after one retry — load race or a wrong/blocked page; not captured, no verdict. Re-run with a longer --wait, or drop --expect-height if the page is genuinely that short.`);
    }
    // Validity: an error-boundary page or an overlay still covering the first
    // viewport is not the page — exit 5 (--allow-overlay to shoot anyway).
    await page.evaluate(() => window.scrollTo(0, 0));
    const invalid = await invalidityReason(page, opts.vh).catch(() => null);
    if (invalid && !(opts.allowOverlay && !/error-boundary/.test(invalid))) {
      throw new InvalidCaptureError(`capture invalid: ${invalid} — not captured, no verdict.${/error-boundary/.test(invalid) ? '' : ' Pass --allow-overlay to capture it anyway (both sides), or --dismiss/--exclude the element.'}`);
    }
    if (invalid) console.log(`WARN ${invalid} — captured anyway (--allow-overlay)`);

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

    await recordStickyBase(page).catch(() => {});
    // --mask-sel / --mask-iframes / --mask-images: rects into the sidecar (scroll 0, settled layout)
    const wantMasks = opts.maskSel.length || opts.maskIframes || opts.maskImages;
    const masksRects = wantMasks ? await collectMaskRects(page, { sels: opts.maskSel, iframes: opts.maskIframes, images: opts.maskImages }).catch(() => []) : null;

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
    let pendingDecodes = 0;
    const pinnedHidden = new Set();
    while (y < totalH) {
      const target = Math.max(0, Math.min(y, totalH - opts.vh));
      await page.evaluate((ty) => window.scrollTo(0, ty), target);
      await page.waitForTimeout(450);
      // wait for in-viewport images to complete (max 3s per chunk), then race
      // img.decode() for the completed ones (1.5 s bound inside the same
      // window): `complete` says the bytes arrived, not that the bitmap is
      // decoded — a chunk shot in between paints a placeholder (recorded).
      pendingDecodes += await page.evaluate(async () => {
        const t0 = Date.now();
        const inView = () => [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 10; });
        const pend = () => inView().some((i) => !i.complete || i.naturalWidth === 0);
        while (pend() && Date.now() - t0 < 3000) await new Promise((r) => { setTimeout(r, 150); });
        const left = Math.max(200, 3000 - (Date.now() - t0));
        const todo = inView().filter((i) => i.complete && i.naturalWidth > 0 && typeof i.decode === 'function');
        // count per image: the decodes still unresolved when the bound fires are
        // the pending ones (counting every image in the race overcounted — one
        // slow decode read as "all N pending")
        let done = 0;
        await Promise.race([
          Promise.all(todo.map((i) => i.decode().catch(() => {}).then(() => { done += 1; }))),
          new Promise((r) => { setTimeout(r, Math.min(1500, left)); }),
        ]);
        return todo.length - done;
      });
      // Integer scroll: a fractional window.scrollY placed every row of the
      // chunk half a width off in the stitch (byte offset mid-row) —
      // recorded as a "half-width rotation" and 26–41 % bands. Round it.
      const actualY = Math.round(await page.evaluate(() => window.scrollY));
      if (target - actualY > 4) {
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
        // reachable by construction). A scroll that ADVANCED but landed short
        // (scroll snapping, an anchored scroll) is the same class — the rows
        // between the landing and the next target would stitch black.
        if (prevActualY !== null && actualY <= prevActualY) {
          throw new Error(`scroll stall at chunk target ${target}px: window scroll is a no-op (window.scrollY stuck at ${actualY}px) while the document reports ${totalH}px — likely an inner scroll container / scroll-jacked layout (html/body overflow:hidden). Stitched capture cannot measure this page class (capturing the inner scroller is future work): record the page as gate-blocked for the pixel probe and rely on content-diff/visual-diff.`);
        }
        throw new Error(`scroll deflection at chunk target ${target}px: window.scrollY landed at ${actualY}px (${target - actualY}px short) — scroll snapping / scroll anchoring moved the viewport; the stitched rows in between would be unfilled. Not captured.`);
      }
      prevActualY = actualY;
      const late = await readOverlayWatch(page);
      if (late.length) {
        console.log(`late overlay mounted before chunk ${chunks.length + 1}: ${late.join(', ')} — re-sweeping`);
        await dismissAndLog(page, url, opts, prov, { lateWindowMs: 0 });
        await page.evaluate((ty) => window.scrollTo(0, ty), target);
        await page.waitForTimeout(200);
      }
      // Chunks 2+: hide pinned chrome (fixed + stuck sticky) for the shot,
      // restore right after — chunk 1 keeps everything for the chrome crop gate.
      const hideNow = !opts.keepPinned && chunks.length > 0;
      if (hideNow) { for (const d of await hidePinned(page)) pinnedHidden.add(d); await page.waitForTimeout(60); }
      const buf = await page.screenshot();
      if (hideNow) await restorePinned(page);
      chunks.push({ y: actualY, buf, img: PNG.sync.read(buf) });
      y += opts.vh;
    }

    const outPng = new PNG({ width: opts.width, height: totalH });
    for (const { y: cy, img } of chunks) {
      for (let row = 0; row < img.height; row += 1) {
        const destY = cy + row;
        if (!Number.isInteger(destY)) throw new Error(`internal: non-integer stitch row ${destY} (chunk y ${cy}) — integer-scroll assertion failed`);
        if (destY >= totalH) break;
        img.data.copy(outPng.data, (destY * opts.width) * 4, (row * img.width) * 4, (row * img.width + Math.min(img.width, opts.width)) * 4);
      }
    }
    // Post-capture sanity (live-session captureSanity): a wall that passed the
    // header stage — a 200 PerimeterX page, an Akamai body — must not be
    // stitched as the source (recorded: a 1-chunk challenge page, exit 0).
    // Live side: short AND (challenge DOM/phrase OR near-empty text) → exit 3,
    // nothing written; short alone (a legal / contact page) → one WARN line.
    // Local side: a wall is impossible — a thin prototype is a real (failing)
    // measurement, so both verdicts are WARNs and the PNG is written.
    const dom = await challengeInDom(page);
    if (dom.pending) console.error('[stitch-shot] WARN post-capture sanity skipped: the page was navigating when its text was read');
    else {
      const sanity = captureSanity({ totalH, vh: opts.vh, textLen: dom.st.len, walled: dom.walled });
      if (sanity.verdict === 'suspect' && isLiveHttpUrl(url)) throw Object.assign(new Error(`suspect challenge/blank capture at ${url}: ${sanity.reason} — not the page; nothing written (a hand solve: --solve-wait <ms>)`), { name: 'BotChallengeError' });
      if (sanity.verdict === 'short') console.error(`[stitch-shot] WARN short capture: ${sanity.reason} — verify it is not a block page`);
      else if (sanity.verdict === 'suspect') console.error(`[stitch-shot] WARN thin local capture: ${sanity.reason} — the prototype renders almost nothing at this width`);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, PNG.sync.write(outPng));
    const seams = seamRepeats(chunks, opts.width);
    const tail = await tailBelowFooter(page, totalH).catch(() => null);
    const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
    const side = writeSidecar(out, {
      url, width: opts.width, vh: opts.vh, dpr, capturedAt: new Date().toISOString(),
      instrument: { ...INSTRUMENT, options: { settle: opts.settle, headed: opts.headed, startTier: resolveStartTier(opts.headed), locale: opts.locale, wait: opts.wait, timeout: opts.timeout, consent: opts.consent, dismiss: opts.dismiss, keepPinned: opts.keepPinned, exclude: opts.exclude, excludeLiveOnly: opts.excludeLiveOnly, expectHeight: opts.expectHeight, allowOverlay: opts.allowOverlay, allowConsent: opts.allowConsent, hideDefaults: opts.hideDefaults, removeText: opts.removeText, block: opts.block, maskSel: opts.maskSel, maskIframes: opts.maskIframes, maskImages: opts.maskImages } },
      consent: prov.consent, dismissed: prov.dismissed, fontsFailed: prov.fontsFailed,
      docHeight: totalH, chunks: chunks.length, source: 'stitch-shot', technique: TIERS[tier - 1], tier,
      pinnedHidden: [...pinnedHidden], pendingDecodes, tail, hidden: prov.hidden, seamRepeats: seams, blocked: parseBlockList(opts.block), visibilityState: prov.visibilityState,
      ...(masksRects ? { masksRects } : {}),
    });
    console.log(`stitched ${out}: ${opts.width}x${totalH} from ${chunks.length} chunks  (consent ${prov.consent.mode}/${prov.consent.via}; sidecar ${side})`);
    if (!opts.keepPinned && chunks.length > 1) console.log(`pinned hidden on chunks 2+: ${pinnedHidden.size}${pinnedHidden.size ? ` [${[...pinnedHidden].join(', ')}]` : ''}`);
    else if (opts.keepPinned) console.log('pinned chrome kept on every chunk (--keep-pinned)');
    if (pendingDecodes) console.log(`WARN ${pendingDecodes} in-viewport image decode(s) did not finish inside the 1.5 s bound — chunk may carry a placeholder`);
    if (seams >= 2) console.log(`WARN fixed overlay baked into ${seams} seams — chrome the pinned hide missed (iframe/shadow-hosted, or --keep-pinned): pass --exclude <sel> on both sides, or mask the seam rows (pixel-compare --mask)`);
    if (tail && tail.px > 8) console.log(`tail ${tail.px}px below footer: ${tail.elements.join(', ') || '(no element boxes — margin/padding)'}`);
    if (opts.block.length) console.log(`blocked: ${parseBlockList(opts.block).join(', ')} — run the same --block on the other side (the sidecar refuses an asymmetric pair)`);
    if (masksRects) {
      const n = (k) => masksRects.filter((m) => m.kind === k && !m.fixed && !m.error).length; const fixed = masksRects.filter((m) => m.fixed).length; const bad = masksRects.filter((m) => m.error).map((m) => m.sel);
      console.log(`mask rects: ${masksRects.length - fixed - bad.length} (sel ${n('sel')}, iframe ${n('iframe')}, img ${n('img')}; fixed skipped ${fixed}${bad.length ? `; bad selector ${bad.join(', ')}` : ''}) → sidecar masksRects[] — same flags on the other side`);
    }
    if (opts.excludeLiveOnly && opts.exclude.length) console.log(`ASYMMETRIC: --exclude applied on this side only (${opts.exclude.join(', ')}) — the pair is not a gate number`);
  });
  await browser.close();
}

// exit 3 = bot challenge on the live side, incl. the post-capture sanity refusal
// (distinct from generic errors, so a gate runner can tell "blocked at tier 3 —
// interactive solve" from "capture broke").
// exit 5 = invalid capture (consent present after the window — accept mode: not dismissed;
// deny mode: not rejected, or still up after the reject click; short capture under
// --expect-height; error-boundary page; overlay > 30 %): no verdict, never a FAIL.
// CLI only when invoked directly (real paths — a symlinked tmpdir makes argv[1]
// and import.meta.url differ); importable otherwise, so the pure halves
// (parseArgs, seamRepeats, INSTRUMENT) run in the fixture runner without a browser.
const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
// exit 124 = no browser slot in time (live-session launchTier, fan-out.md § Machine budget): no verdict, never a FAIL
if (isMain) main().catch((e) => { console.error(`stitch-shot error: ${e.message}`); process.exit(e.code === 124 ? 124 : e.name === 'BotChallengeError' ? 3 : e.name === 'InvalidCaptureError' ? 5 : 1); });
