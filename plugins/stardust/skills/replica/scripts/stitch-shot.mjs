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
 *     (Accept / Accept-Language; sec-ch-ua* through the UA metadata below) are
 *     the other half of the fix.
 *   - CLIENT HINTS from the UA (--hints, default ua-metadata): a vendor wall
 *     answered a headless capture 200 "System Down" when the UA claimed Chrome
 *     but the requests' sec-ch-ua* did not back it. live-session sets the
 *     browser's UA metadata from the UA string, so a page's requests carry
 *     sec-ch-ua* with the UA's brands and version, the host's platform —
 *     documents and subresources, cross-origin too; out-of-process iframes and
 *     service workers keep the browser's own. Escape hatch: `--hints native` or
 *     env STARDUST_LIVE_HINTS=native (gate rounds included). The BROWSER BUILD:
 *     the full Chromium build when installed (the headless shell's own hints
 *     name a HeadlessChrome brand), otherwise the headless shell (one stderr
 *     line); --headed runs real Chrome. stdout (`browser: <build>, client
 *     hints: <hints>`) and capture.json (browserBuild, hints) record both.
 *   - a bot-management challenge/blocked interstitial FAILS LOUD (exit 3),
 *     never captured as if it were the source (the Access-Denied trap). So
 *     does a 2xx DENIAL PAGE — a vendor signature ("can't process your
 *     request" + "Incident Number", "Access Denied" + "Reference #", "Just a
 *     moment…", "System Down", …) or a page under 2 KB of text under one
 *     error heading: gotoLive reads the entry, and the page is read once more
 *     after the dismissal sweep(s), before --hide (a hide list could cover
 *     its text) and --inventory (a denial page a script renders after
 *     domcontentloaded). The message names the signature and says "origin
 *     blocked"; a re-check that cannot read the page is one stderr line
 *     (`denial-page check skipped`), never a pass. Escalate with --headed
 *     (stealth real Chrome).
 *   - waitUntil 'domcontentloaded' (never 'networkidle'): live sites with
 *     analytics beacons never reach networkidle — hard timeout otherwise.
 *   - THREE overlay classes dismissed: cookie consent (CLICKED accept, not DOM
 *     removal, so consent-gated layout settles the way a real visit does),
 *     timed marketing/newsletter interstitials (CH-1: an undismissed
 *     "Sign up!" modal bakes a pixel-diff contributor into the live capture
 *     that no prototype fidelity can null out) AND open DIALOGS — live-session's
 *     dialog pass: a native <dialog> gets close(), then its close control,
 *     then Escape; an aria-modal / .modal.show panel its close control, then
 *     Escape. The html/body SCROLL LOCK a closed dialog leaves is released for
 *     the capture (overflow-y visible, a hidden overflow-x clipped — clip, not
 *     hidden, so body never becomes an inner scroller) only when the pass
 *     closed one and none survives: a lock with no closed dialog is the page's
 *     own layout, and a lock over a survivor stays — the scroll stall below
 *     fails loud on either. Each sweep logs `dialog closed: …`, `dialog still
 *     open: …` and `scroll lock released …`; capture.json's `dismissed` merges
 *     the sweeps.
 *     The mouse is PARKED afterwards (bottom-left): a dismissal click leaves
 *     the cursor over the page, and any :hover-styled element under it would
 *     be silently captured in hover state. --consent / --dismiss add a site's
 *     own selectors; --no-dismiss turns all three classes off (gate.sh passes
 *     all three flags through to BOTH captures, so the live side is dismissed
 *     exactly like the build side).
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
 *   - a SCROLL STALL fails loud (exit 1, `scroll stall at chunk target …`):
 *     on an inner-scroller / scroll-jacked page window.scrollTo is a no-op
 *     and the rows below would stitch as black. A shortfall the document's
 *     own shrink explains is not a stall but a MORPH — a header that
 *     shrinks on scroll: the stitch continues from where the window
 *     stopped, at the shrunk height, and records `headerMorph` (px).
 *   - the OVERFLOW root line: one `overflow: scrollWidth=<n> viewport=<n>
 *     delta=<n>` line right before the `stitched` line — the document's
 *     scrollWidth, the viewport (window.innerWidth) and delta = scrollWidth
 *     minus the root's clientWidth (never below 0; measure.mjs semantics),
 *     read ONCE after the chunk loop: every scroll-revealed box has been in
 *     view (a pre-scroll read counts a slide-in still off to the side — a
 *     false overflow) and lazy content has loaded; then, the last chunk
 *     taken, the page is scrolled back to the top for 700 ms and finite
 *     animations the freeze holds are finished — the page at rest at the
 *     top, where measure.mjs reads it after its scroll pass (a header a
 *     scroll handler turns position:fixed further down counts its too-wide
 *     row there). Same page and width as the pixels: gate.sh's
 *     horizontal-overflow assert reads it from the build capture instead of
 *     loading the page a second time.
 *   - no timed late-modal poll on EDS build/preview hosts (*.aem.page|live,
 *     *.hlx.page|live — live-session lateWindowFor): they serve no timed
 *     third-party interstitials. ONE sweep still runs, after the EDS delayed
 *     phase (its 3 s timer after `load`, where a consent manager the build
 *     enables loads; waitEdsDelayedPhase), so such a banner is dismissed as
 *     on the live side. Live source sites keep the 6 s poll; local targets
 *     had none already. Both sides still stitch the same way.
 *   - --hide <sel,…> removes in-flow per-visitor regions (recorded: a geo-IP
 *     location-suggestion bar in flow above the header, pushing every box
 *     below it down) — not overlays, so dismissal cannot remove them. The
 *     shared live-session hideRegions measures each selector, hides every
 *     match inline and adds a `<style data-stardust-hide>` rule (a bar
 *     re-rendered later is hidden too) AFTER the last dismissal sweep (after
 *     --settle's) and the denial-page re-check, and BEFORE --inventory, the
 *     freeze and the height read: the inventories, the page height and every
 *     chunk see the same page. One
 *     `hidden: <sel> ×<n> (<h>px) [--hide]; …` line (×0: nothing matched at
 *     the hide pass). gate.sh / gate-all pass the SAME list to the live and
 *     build captures — symmetric, like overlay dismissal: the build has
 *     nothing to hide.
 *   - HIDE MISSES: right before the capture (after the freeze and the font
 *     check, before the height read) live-session recountHides counts every
 *     --hide selector again — nAtCapture on its record (a block injected
 *     after the hide pass is hidden by the persistent rule and counted
 *     here). A selector that matched nothing at both counts (hideMisses) hid
 *     nothing (recorded: a bar selector that matched ×0 on both sides of a
 *     hands-off run while the gate carried on as if hidden): the --json
 *     record's hideMiss { sels, candidates } names it with the in-flow
 *     blocks above the header read off that page (inFlowRegionsAboveHeader)
 *     — null when none; a derivation that could not run records candidates
 *     null + candidatesCheck "failed: <msg>" (not derived, never []) beside
 *     one stderr WARNING. stitch-shot prints no warning for the miss itself
 *     (it does not know the side): gate.sh / gate-all warn from the live
 *     capture's record.
 *   - the OVERLAY-LEFT check (live-session detectOverlayLeft) runs ONCE,
 *     after the last dismissal sweep and the --hide pass (a layer hidden on
 *     both sides is not reported), before --inventory and the freeze — under
 *     --no-dismiss too. A consent root still visible, a fixed/sticky layer
 *     over most of the viewport or a scroll lock prints ONE `overlay-left:
 *     <descriptor>` line there (a consent-sweep click that left the page:
 *     `(consent sweep navigated to <url>)`); exit stays 0 (gate.sh / gate-all
 *     decide).
 *     --json <file> writes the capture record once the PNG is written: the
 *     sweeps' dismissals, overlayLeft, fontsFailed (the font-load
 *     assertion's families — an array when it ran, null when it could not,
 *     with fontCheck "failed: <msg>"), the hide records (each with
 *     nAtCapture), hideMiss, height and the overflow line.
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
 *     --hide <sel,...>    in-flow per-visitor regions to remove before the
 *                         capture (repeatable; see above)
 *     --headed            escalation: headed stealth real Chrome
 *     --hints <v>         client hints: ua-metadata (sec-ch-ua* brands and
 *                         version from the UA) | native (the browser's own);
 *                         no flag → env STARDUST_LIVE_HINTS, else ua-metadata
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 1200; 3000 with --settle)
 *     --timeout <ms>      goto timeout (default: max(env STARDUST_NAV_TIMEOUT_MS,
 *                         2 × crawl.navMs.p95 from
 *                         stardust/current/_crawl-log.json) clamped to
 *                         20000–180000, else 60000; the flag always wins)
 *     --inventory <spec>  also write the presence / clip / unit inventories of
 *                         the settled page, before the freeze (gate-all --one-load)
 *     --json <file>       after the PNG, write the capture record (gate.sh /
 *                         gate-all read overlayLeft, fontsFailed and hideMiss)
 *
 * Output: <out.png> and, beside it, <stem>.capture.json (build.png →
 * build.capture.json — never <stem>.json, which gate.sh / gate-all write
 * after the capture): { writtenBy, url, width, vh, height (the PNG's),
 * chunks, headerMorph (px, 0 when none), overflow: { scrollWidth, viewport,
 * delta }, browserBuild ('chromium' | 'chromium-headless-shell' | 'chrome' |
 * 'unknown'), hints ('ua-metadata' | 'native' | 'unknown'), denialCheck ('ok'
 * | 'skipped: <reason>' — the post-sweep denial-page read), dismissed: {
 * extra, consent, marketing, dialogs, dialogsLeft, scrollLockReleased } — the
 * sweeps merged (arrays de-duplicated in order, the first consent, released by
 * any sweep, dialogsLeft from the last) — or null under --no-dismiss, at }.
 * Removed when a capture starts, written with the PNG — a failed capture
 * leaves none. stdout ends with the overflow line, then
 * `stitched <out>: <w>x<h> from <n> chunks` (+ ` — header morph <px> px`).
 *
 * Example:
 *   node skills/replica/scripts/stitch-shot.mjs https://www.example.com \
 *     stardust/replica/gates/home-1440/live.png --width 1440 --settle
 *
 * Requires: playwright, pngjs (project devDependencies; imported lazily, so
 * --help needs neither), and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 written (an overlay left included), 1 error (a scroll stall
 * included), 3 bot challenge (live side blocked — an edge interstitial or a
 * 2xx denial page; fail loud, never captured, no PNG, no capture.json and no
 * --json record; escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { writeFileSync, mkdirSync, existsSync, realpathSync, rmSync } from 'fs';
import { basename, dirname, extname, join, resolve as resolvePath } from 'path';
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
const { REAL_CHROME_UA, isEdsHost, lateWindowFor, waitEdsDelayedPhase, newLiveContext, gotoLive, dismissOverlays, detectOverlayLeft, parseHideList, hideRegions, formatHidden, recountHides, hideMisses, inFlowRegionsAboveHeader } = liveSession;
// --hints values (live-session's HINT_SCOPES; a copy older than the UA metadata has none — the same two values).
const HINT_VALUES = Array.isArray(liveSession.HINT_SCOPES) ? liveSession.HINT_SCOPES : ['ua-metadata', 'native'];

const HELP = `stitch-shot — scroll-and-stitch full-page screenshot (symmetric capture instrument)

Usage: node stitch-shot.mjs <url> <out.png> [options]
  --width <px>      viewport width (default 1440)
  --vh <px>         viewport height / chunk size (default 900)
  --settle          slow-scroll lazyload settle pass before capture
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors (marketing modals etc.)
  --no-dismiss      dismiss no overlay at all (gate.sh --no-dismiss pass-through)
  --hide <sel,…>    remove in-flow per-visitor regions (a location bar above the header — dismissal can't)
                    after dismissal + settle, before --inventory and the capture (repeatable)
  --headed          headed stealth real Chrome (escalation for bot-managed sites)
  --hints <v>       client hints: ua-metadata (sec-ch-ua* with the UA's brands and version, the host's platform;
                    out-of-process iframes and service workers keep the browser's own) | native (escape hatch: the
                    browser's own); no flag → env STARDUST_LIVE_HINTS, else ua-metadata
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB) for geo determinism
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 1200; 3000 with --settle)
  --timeout <ms>    goto timeout (default: max(env STARDUST_NAV_TIMEOUT_MS,
                    2 × crawl.navMs.p95 from stardust/current/_crawl-log.json) clamped to 20000–180000, else 60000;
                    the flag always wins)
  --inventory <f>   also write the probes' inventories of the settled page, before the freeze (gate-all --one-load)
  --json <file>     after the PNG, write the capture record (JSON, 2-space): url, out, width, vh, settle, dismissed
                    ({ consent, extra, marketing } over the sweeps; null under --no-dismiss), overlayLeft (null when
                    clean), fontsFailed ([] or the families whose face failed; null = the check could not run, then
                    fontCheck "failed: <msg>" follows), hidden (the --hide records: sel, source, n, h at the hide pass,
                    nAtCapture = the match count right before the capture), hideMiss ({ sels, candidates } when a
                    selector matched nothing at both counts — candidates = the in-flow blocks above the header,
                    { tag, id, classes, top, height, selector }; null when none), height, overflow
  --help            this text

Prints \`browser: <build>, client hints: <hints>\` once the page exists: the full Chromium build when installed, else the
headless shell (--headed: real Chrome).
Prints \`overlay-left: <sel> (<why>)\` once — after the last dismissal sweep and --hide, before the capture, also under
--no-dismiss — when the capture would still carry an overlay: a consent root still visible, a fixed / sticky layer
painting ≥ 80 % of the viewport, or a scroll lock (html / body overflow:hidden); a consent-sweep click that left the
page prints \`overlay-left: (consent sweep navigated to <url>)\`, a check that could not run
\`overlay-left: (overlay check failed: <msg>)\`. Exit stays 0: gate.sh gives no verdict, gate-all marks the row
INCONCLUSIVE. --json records it as overlayLeft; a failed capture writes no record.
Prints \`overflow: scrollWidth=<n> viewport=<n> delta=<n>\` right before the \`stitched\` line: the document width
vs the viewport at --width (delta = px over, 0 when it fits), read after the chunk loop, back at the top with
finite animations finished (the page at rest) — gate.sh's horizontal-overflow assert reads it from the build capture.
Writes <out.png> and <stem>.capture.json beside it (build.png → build.capture.json; removed when a capture starts, so a
failed one leaves none): { writtenBy, url, width, vh, height, chunks, headerMorph, overflow: { scrollWidth, viewport,
delta }, browserBuild, hints, denialCheck, dismissed, at } — denialCheck = 'ok' | 'skipped: <reason>' (the denial-page
read after the sweeps); dismissed = { extra, consent, marketing, dialogs, dialogsLeft, scrollLockReleased } over every
sweep (dialogsLeft from the last), null under --no-dismiss.
Overlays: consent, timed marketing modals, then open dialogs (close(), a close control, Escape — logged as
\`dialog closed: …\` / \`dialog still open: …\`). The html/body scroll lock is released
(overflow-y visible, a hidden overflow-x clipped) only when the pass closed a dialog and none is still open; any other
lock stays, and a scroll it stalls fails loud.
A scroll that does not move (window.scrollY stays put) short of its chunk target, the height unchanged,
is a scroll stall (an inner scroller / scroll-jacked page): exit 1. A shortfall the document's own shrink explains (a
header that shrinks on scroll) is a morph, not a stall: the stitch continues at the shrunk height, headerMorph records
the px and the stitched line ends " — header morph <px> px".
EDS build/preview hosts (*.aem.page|live, *.hlx.page|live) get no timed late-modal poll: one dismissal sweep,
after the EDS delayed phase (live source sites keep the 6 s poll, local targets have none).
With --hide: one \`hidden: <sel> ×<n> (<h>px) [--hide]; …\` line (×0 = nothing matched at the hide pass); gate.sh /
gate-all pass the same list to both captures. Right before the capture every selector is counted again (nAtCapture —
a block injected after the hide pass is hidden too and counted then); one that matched nothing at both counts is the
record's hideMiss, with the in-flow blocks above the header as candidates (could not be derived: candidates null +
candidatesCheck "failed: <msg>" and a WARNING). stitch-shot prints no line for a miss — it does not know the side:
gate.sh / gate-all warn from the live capture's record.
Run the SAME command shape against the live page and the served prototype.
Exit codes: 0 written (an overlay left included), 1 error (also --hide / --json without a value), 3 bot challenge
(live side blocked — fail loud): an edge interstitial, or a 2xx denial page (a vendor signature, or a page under 2 KB
of text under one error heading — the message names it and says "origin blocked"), read at the entry and again after
the dismissal sweeps (before --hide); no PNG, no capture.json, no --json record. Escalate with --headed.`;

// live-session's navTimeout, guarded as crawl.mjs guards it: a project copy of live-session.mjs older than navTimeout
// keeps the old 60000 and says so once on stderr — never a TypeError. An explicit --timeout never asks.
let staleNavWarned = false;
export function sessionNavTimeout(session, { fallback = 60000, ...nav } = {}) {
  if (session && typeof session.navTimeout === 'function') return session.navTimeout({ ...nav, fallback });
  const detail = `live-session.mjs predates navTimeout — ${fallback} ms (copy the diff skill's live-session.mjs alongside)`;
  if (!staleNavWarned) {
    staleNavWarned = true;
    console.error(`stitch-shot: live-session.mjs predates navTimeout — goto timeout ${fallback} ms; STARDUST_NAV_TIMEOUT_MS and the crawl figure are not read (copy the diff skill's live-session.mjs alongside to use them)`);
  }
  return { ms: fallback, source: 'default', detail };
}

// `nav` reaches live-session's navTimeout ({ env, crawlLog }) — the test seam; the CLI passes none.
export function parseArgs(argv, nav = {}) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, vh: 900, settle: false, consent: null, dismiss: [], noDismiss: false, hide: [], headed: false, hints: null, locale: null, ua: REAL_CHROME_UA, wait: null, timeout: null, json: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--vh') { opts.vh = Number(rest[i += 1]); }
    else if (a === '--settle') { opts.settle = true; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--no-dismiss') { opts.noDismiss = true; }
    else if (a === '--hide') {
      const v = rest[i += 1];
      if (v === undefined || v.startsWith('--')) { console.error(`--hide needs a selector list\n\n${HELP}`); process.exit(1); }
      opts.hide = parseHideList(opts.hide, v);
    }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--hints') {
      // null (no flag) passes through: live-session then reads env STARDUST_LIVE_HINTS, else ua-metadata
      opts.hints = rest[i += 1];
      if (!HINT_VALUES.includes(opts.hints)) { console.error(`hints must be one of ${HINT_VALUES.join(', ')} — got ${opts.hints}\n\n${HELP}`); process.exit(1); }
    }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a === '--inventory') { opts.inventory = rest[i += 1]; }
    else if (a === '--json') {
      const v = rest[i += 1];
      if (v === undefined || v === '' || v.startsWith('--')) { console.error(`--json needs a file path\n\n${HELP}`); process.exit(1); }
      opts.json = v;
    }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { console.error(`need <url> and <out.png>\n\n${HELP}`); process.exit(1); }
  if (opts.wait == null) opts.wait = opts.settle ? 3000 : 1200;
  // Resolved only without --timeout: one navigation timeout shared by every live instrument (a slow origin's
  // measured p95 sets it once, for all of them); an explicit flag is never second-guessed.
  if (opts.timeout == null) opts.timeout = sessionNavTimeout(liveSession, nav).ms;
  return { url, out, opts };
}

// Dismiss the overlay classes (consent, timed marketing modals, dialogs) via
// live-session, log what was closed, and note that the mouse is parked by
// dismissOverlays itself (bottom-left — rule 10).
async function dismissAndLog(page, url, opts) {
  const extra = [...(opts.consent ? [opts.consent] : []), ...opts.dismiss];
  // late-modal poll window only on live source sites — the served prototype's
  // overlays are not timed third-party scripts, they render immediately, and
  // an EDS build/preview host gets one sweep after its delayed phase (main()).
  const d = await dismissOverlays(page, { extra, lateWindowMs: lateWindowFor(url, 6000) });
  if (d.consent) console.log(`consent dismissed via ${d.consent}`);
  for (const sel of d.extra) console.log(`overlay dismissed via extra selector ${sel}`);
  for (const sel of d.marketing) console.log(`marketing modal dismissed via ${sel}`);
  // the dialog pass (a live-session copy older than it returns none of these fields)
  for (const entry of d.dialogs || []) console.log(`dialog closed: ${entry}`);
  for (const name of d.dialogsLeft || []) console.log(`dialog still open: ${name}`);
  if (d.scrollLockReleased) console.log('scroll lock released for the capture (overflow-y visible, a hidden overflow-x clipped)');
  return d;
}

// The sweeps (the first; the post-settle one under --settle) as ONE capture record: arrays concatenated and
// de-duplicated in order, the first consent, released when any sweep released — and dialogsLeft from the LAST sweep,
// the page state the capture carries (a dialog the second sweep closed is no longer open).
export function mergeDismissed(sweeps) {
  const all = (key) => [...new Set(sweeps.flatMap((d) => d[key] || []))];
  return {
    extra: all('extra'),
    consent: sweeps.map((d) => d.consent).find((c) => c != null) ?? null,
    marketing: all('marketing'),
    dialogs: all('dialogs'),
    dialogsLeft: [...((sweeps.at(-1) || {}).dialogsLeft || [])],
    scrollLockReleased: sweeps.some((d) => d.scrollLockReleased === true),
  };
}

// A project copy of live-session.mjs older than these exports never throws (as sessionNavTimeout above): no
// launchChromium → chromium.launch() (an untagged browser — build 'unknown'); no hintRecord → both 'unknown'.
export function launchCaptureBrowser(session, chromium, { headed = false } = {}) {
  if (headed) return session.launchStealthHeaded(chromium);
  return typeof session.launchChromium === 'function' ? session.launchChromium(chromium) : chromium.launch();
}
export function captureHintRecord(session, ctx) {
  return typeof session.hintRecord === 'function' ? session.hintRecord(ctx) : { browserBuild: 'unknown', hints: 'unknown' };
}

// R4: gotoLive reads the entry for a 2xx denial page; this reads the page once more after the dismissal sweep(s) — a
// denial page a script renders after domcontentloaded. A marker → BotChallengeError (exit 3), with the entry's status.
// A page the probe cannot read, or a copy without pageDenial / botChallengeError, is one stderr line — skipped, never
// a silent pass. → capture.json's denialCheck: 'ok' (read, no marker) | 'skipped: <reason>' — on the record, since
// gate-all keeps only stdout's last two lines and a skip on stderr alone would leave no trace in a gate round.
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

// The root line gate.sh's horizontal-overflow assert reads (measure.mjs root-line semantics: viewport =
// window.innerWidth, delta = scrollWidth − the root's clientWidth, never below 0); the --json record's `overflow` and
// the sidecar record the same read.
const overflowOf = ({ scrollWidth, innerWidth, clientWidth }) => ({ scrollWidth, viewport: innerWidth, delta: Math.max(0, scrollWidth - clientWidth) });
export function overflowLine(root) {
  const { scrollWidth, viewport, delta } = overflowOf(root);
  return `overflow: scrollWidth=${scrollWidth} viewport=${viewport} delta=${delta}`;
}

/** The families of declared faces that failed to load, as the --json record carries them: surrounding quotes
 * stripped, trimmed, empty dropped, unique, sorted. */
export function fontFamilies(list) {
  const names = (list || []).filter((s) => typeof s === 'string').map((s) => s.trim().replace(/^["']+|["']+$/g, '').trim());
  return [...new Set(names.filter(Boolean))].sort();
}

/** The font-load check's outcome for the --json record: its family list → { fontsFailed } (checked; [] = every
 * declared face loaded); an evaluate error, or no list → { fontsFailed: null, fontCheck: 'failed: <first line>' } —
 * a check that could not run is recorded as not checked, never as []. */
export function fontCheckOutcome(result, error) {
  if (error == null && Array.isArray(result)) return { fontsFailed: fontFamilies(result) };
  const why = error != null ? String((error && error.message) || error).split('\n')[0] : 'no family list returned';
  return { fontsFailed: null, fontCheck: `failed: ${why}` };
}

/** The --json record's hideMiss: the selectors that matched nothing (live-session hideMisses over the recounted records)
 * and the in-flow blocks above the header read off the page (inFlowRegionsAboveHeader) → null when no selector missed,
 * else { sels, candidates }; a derivation that threw, or returned no list → { sels, candidates: null, candidatesCheck:
 * 'failed: <first line>' } — candidates that could not be derived are recorded as not derived, never as []. */
export function hideMissOutcome(sels, candidates, error) {
  const missed = (sels || []).filter((s) => typeof s === 'string' && s);
  if (!missed.length) return null;
  if (error == null && Array.isArray(candidates)) return { sels: missed, candidates };
  const why = error != null ? String((error && error.message) || error).split('\n')[0] : 'no candidate list returned';
  return { sels: missed, candidates: null, candidatesCheck: `failed: ${why}` };
}

// <stem>.capture.json beside the PNG (build.png → build.capture.json) — never <stem>.json: gate.sh / gate-all write
// live.json, origin.json and eds.json AFTER the capture returns, and gate-all reads live.json to reuse live.png.
function captureSidecarPath(out) {
  return join(dirname(out), `${basename(out, extname(out))}.capture.json`);
}

// Fractional-scroll tolerance of the chunk loop (px): a smaller miss is scroll rounding, not a shortfall.
const SCROLL_SLACK = 4;
// A morph, not a scroll stall: the chunk's scroll fell short of its target and the document shrank under it (h2 =
// the re-read height, smaller than totalH) — by the shortfall (the browser's scroll anchoring moves scrollY up by
// exactly a header's loss above the viewport), or far enough that the scroll reached the target clamped to the
// shrunk height (the last chunk). A grown or unchanged document is never a morph.
export function isHeaderMorph({ y, target, actualY, totalH, h2, vh }) {
  const shortfall = target - actualY; const shrink = totalH - h2;
  if (shortfall <= SCROLL_SLACK || shrink <= SCROLL_SLACK) return false;
  return Math.abs(shortfall - shrink) <= SCROLL_SLACK || Math.abs(Math.max(0, Math.min(y, h2 - vh)) - actualY) <= SCROLL_SLACK;
}

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  // Before anything can fail: a failed capture never leaves a stale sidecar beside an older PNG.
  const sidecar = captureSidecarPath(out);
  rmSync(sidecar, { force: true });
  // Lazy: --help (inside parseArgs) answers without playwright / pngjs installed.
  const [{ chromium }, { PNG }] = await Promise.all([import('playwright'), import('pngjs')]);
  const browser = await launchCaptureBrowser(liveSession, chromium, opts);
  try {
    // UA + standard headers + webdriver spoof + the UA's client-hint metadata on the context (live-session).
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale, hints: opts.hints,
      viewport: { width: opts.width, height: opts.vh },
    });
    const page = await ctx.newPage();
    // Read once the page exists: the UA metadata is set per page, and a page it could not be set on runs 'native'.
    const { browserBuild, hints } = captureHintRecord(liveSession, ctx);
    console.log(`browser: ${browserBuild}, client hints: ${hints}`);
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page must never be stitched as if it were the source.
    // solveWindow only under --headed: headless clearance never lands, and
    // the solve loop would spend the Akamai block budget (1 hit vs up to 4).
    const entry = await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, solveWindow: opts.headed });
    await page.waitForTimeout(opts.wait);
    // The sweeps' results, kept twice: `sweeps` (each as returned) → capture.json's dismissed (mergeDismissed, the
    // first consent, the dialog pass); `dismissed` → the --json record's: consent = the last non-null one over the
    // sweeps, extra / marketing = every sweep's, unique.
    // A sweep whose consent click left the page (dismissOverlays' overlayLeft `(consent sweep navigated to <url>)`)
    // is kept for the overlay-left check below: the capture is of another page, whatever that page shows.
    const sweeps = [];
    const dismissed = opts.noDismiss ? null : { consent: null, extra: [], marketing: [] };
    let navigated = null;
    const sweep = async () => {
      const d = await dismissAndLog(page, url, opts);
      sweeps.push(d);
      if (d.consent) dismissed.consent = d.consent;
      for (const k of ['extra', 'marketing']) for (const s of d[k]) if (!dismissed[k].includes(s)) dismissed[k].push(s);
      if (!navigated && typeof d.overlayLeft === 'string' && d.overlayLeft.startsWith('(consent sweep navigated to ')) navigated = d.overlayLeft;
    };
    // --no-dismiss: the capture shows whatever the site shows (the gate's --no-dismiss reaches both sides).
    if (opts.noDismiss) console.log('overlays left as the page shows them (--no-dismiss)');
    else {
      // EDS build/preview host: no timed poll (lateWindowFor → 0) but the sweep waits for the EDS delayed phase,
      // where a consent manager the build enables loads; under --settle the post-settle sweep comes later anyway.
      if (isEdsHost(url)) {
        if (!opts.settle) await waitEdsDelayedPhase(page);
        console.log('late-modal window skipped on an EDS host (one sweep after the delayed phase)');
      }
      await sweep();
    }

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
      if (!opts.noDismiss) await sweep();
    }

    // A denial page a script rendered after domcontentloaded (gotoLive read the entry): exit 3, no PNG, no sidecar, no
    // --json record. Read before --hide: a hide list over the denial text would leave the probe nothing to read.
    const denialCheck = await recheckDenial(liveSession, page, url, entry.status());

    // --hide: after the last dismissal sweep and the denial re-check, before --inventory, the freeze and the height
    // read — the inventories, the page height and every chunk see the page without the in-flow regions (header, the
    // --hide bullet).
    const hidden = opts.hide.length ? await hideRegions(page, opts.hide) : [];
    if (opts.hide.length) console.log(`hidden: ${formatHidden(hidden)}`);

    // The overlay-left check (header): once, on the page the chunks will show — after the last sweep and --hide,
    // under --no-dismiss too; a sweep that navigated away is named instead. Never removed; the exit code stays 0
    // (gate.sh / gate-all decide).
    const overlayLeft = navigated || await detectOverlayLeft(page);
    if (overlayLeft) console.log(`overlay-left: ${overlayLeft}`);

    // --inventory: the probes read this settled page (read only, before the freeze; a failure never fails the capture).
    if (opts.inventory) await import(pathToFileURL(resolvePath(dirname(LIVE_SESSION), 'content-presence.mjs')).href).then((m) => m.inventoryToFile(page, opts.inventory, { url })).catch((e) => console.error(`stitch-shot WARNING: --inventory not taken (${e.message}) — the capture continues`));

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
    // decision procedure; this warning is what triggers it. A check that
    // could not run (the evaluate threw) is recorded as not checked —
    // fontsFailed null + fontCheck in the --json record, its own warning —
    // never as "every face loaded".
    let fontError = null;
    const failedFonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...new Set([...document.fonts].filter((f) => f.status === 'error').map((f) => f.family))];
    }).catch((e) => { fontError = e; return []; });
    const fonts = fontCheckOutcome(failedFonts, fontError);
    if (fonts.fontCheck) console.error(`stitch-shot WARNING: font-load check failed (${fonts.fontCheck.slice('failed: '.length)}) — the record says fontsFailed: null (not checked)`);
    if (failedFonts.length) {
      console.error(`stitch-shot WARNING: FONT LOAD FAILED for declared face(s) ${failedFonts.join(', ')} — this capture renders fallback type (silent false measurement, F-B2 class). Verify the face loads in a real browser: instrument-induced → fix the capture before gating; genuinely broken on the live site → log as capture-state.`);
    }

    // Hide misses (header): right before the capture, every --hide selector counted again (nAtCapture; a block injected
    // after the hide pass is hidden by the persistent rule and counted here). A selector that matched nothing at both
    // counts hid nothing: the record's hideMiss names it with the in-flow blocks above the header on this page. No line
    // for the miss itself — the caller knows the side (gate.sh / gate-all warn from the live capture's record).
    const hides = await recountHides(page, hidden);
    const missed = hideMisses(hides);
    let regionsError = null;
    const regions = missed.length ? await inFlowRegionsAboveHeader(page).catch((e) => { regionsError = e; return null; }) : null;
    const hideMiss = hideMissOutcome(missed, regions, regionsError);
    if (hideMiss && hideMiss.candidatesCheck) console.error(`stitch-shot WARNING: hide candidates not derived (${hideMiss.candidatesCheck.slice('failed: '.length)}) — the record says hideMiss.candidates: null (not derived)`);

    // Height is measured AFTER the settle pass, never before: entrance-
    // animated sites inflate scrollHeight until elements go inview (their
    // translate3d entrance transforms extend the document; recorded: 3183px
    // pre-settle vs 3093px settled). Pre-settle height is fake — mirror this
    // ordering in any ad-hoc probe that reads document height.
    const docHeight = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    let totalH = await page.evaluate(docHeight);
    if (!totalH || totalH < 10) throw new Error(`page height ${totalH}px — blank render? (bot challenge / hidden body)`);

    const chunks = [];
    let y = 0;
    let prevActualY = null;
    let headerMorph = 0;
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
      // Threshold is a small fractional-scroll tolerance (SCROLL_SLACK, 4px), NOT
      // a material shortfall (vh/2): a jacked page with settled height between
      // vh+1 and 1.5*vh puts chunk 2's clamped target at <= vh/2, which a vh/2
      // bar can never catch — those pages emitted silent black bands. On a legit
      // page actualY reaches the clamped target (the last chunk's totalH - vh is
      // reachable by construction), so the no-advance condition stays false —
      // unless the page shrinks under the scroll.
      // A shortfall the document's own shrink explains is a MORPH, not a stall:
      // a header that shrinks on scroll takes its loss out of the page mid-stitch
      // (recorded: a hands-off run's in-flow header lost 20 px, window.scrollY
      // stuck 20 px short of a chunk target, and the run's workaround was a
      // different --vh). So a short scroll re-reads the height; when the shrink
      // equals the shortfall or the scroll reached the target clamped to the new
      // height (isHeaderMorph), headerMorph records it, the loop and the PNG take
      // the new height, this chunk lands where the window stopped and the next
      // one starts a viewport below it. The second form also catches a shrink
      // that left the scroll short without a stall (the old guard let that
      // through with a black band at the bottom: the PNG kept the pre-morph
      // height). Only a no-op scroll with the height unchanged still throws.
      let next = y + opts.vh;
      if (target - actualY > SCROLL_SLACK) {
        const h2 = await page.evaluate(docHeight);
        if (isHeaderMorph({ y, target, actualY, totalH, h2, vh: opts.vh })) {
          headerMorph += totalH - h2;
          console.error(`stitch-shot: header morph ${totalH - h2} px — the document shrank ${totalH} → ${h2}px under the scroll to ${target}px (window.scrollY ${actualY}px): not a scroll stall, the stitch continues from there`);
          totalH = h2; next = actualY + opts.vh;
        } else if (prevActualY !== null && actualY <= prevActualY) {
          throw new Error(`scroll stall at chunk target ${target}px: window scroll is a no-op (window.scrollY stuck at ${actualY}px) while the document reports ${totalH}px — likely an inner scroll container / scroll-jacked layout (html/body overflow:hidden). Stitched capture cannot measure this page class (capturing the inner scroller is future work): record the page as gate-blocked for the pixel probe and rely on content-diff/visual-diff.`);
        }
      }
      prevActualY = actualY;
      const buf = await page.screenshot();
      chunks.push({ y: actualY, buf });
      y = next;
    }
    // Overflow root line (header): ONE read, after the chunk loop — every box below the fold has been scrolled into
    // view, so a scroll-reveal slide-in no longer sits off to the side (read earlier, it is a false overflow). The
    // chunks are taken, so nothing below touches build.png: back to the top for 700 ms first, as measure.mjs reads
    // (scrollTo(0, 0), 400 + 300 ms after its scroll pass) — a header a scroll handler switches to position:fixed
    // further down is static again there and counts its too-wide row; then finite animations the freeze holds (a
    // reveal keyframe started paused at its off-side frame) are finished: the page at rest. The freeze moves no box
    // and leaves scroll listeners, IntersectionObservers and rAF running (it cancels only timers pending when it
    // ran), so the scroll back reaches the same handlers measure.mjs's does.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    const root = await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); } catch { /* not finishable — leave it */ }
      }
      const de = document.documentElement;
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, innerWidth: window.innerWidth };
    });

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
    writeFileSync(sidecar, `${JSON.stringify({ writtenBy: 'skills/replica/scripts/stitch-shot.mjs', url, width: opts.width, vh: opts.vh, height: totalH, chunks: chunks.length, headerMorph, overflow: overflowOf(root), browserBuild, hints, denialCheck, dismissed: opts.noDismiss ? null : mergeDismissed(sweeps), at: new Date().toISOString() }, null, 2)}\n`);
    // --json: the capture record, only once the PNG is written (a failed capture leaves none).
    if (opts.json) {
      mkdirSync(dirname(opts.json), { recursive: true });
      writeFileSync(opts.json, `${JSON.stringify({ url, out, width: opts.width, vh: opts.vh, settle: opts.settle, dismissed, overlayLeft, ...fonts, hidden: hides, hideMiss, height: totalH, overflow: overflowOf(root) }, null, 2)}\n`);
    }
    console.log(overflowLine(root));
    // Last stdout line, no line after it: gate-all keeps the last two (overflow + stitched) in origin.json's log.
    console.log(`stitched ${out}: ${opts.width}x${totalH} from ${chunks.length} chunks${headerMorph > 0 ? ` — header morph ${headerMorph} px` : ''}`);
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (distinct from generic errors, so a
// gate runner can tell "blocked — escalate with --headed" from "capture broke").
// Main-module guard: importing the module (tests, an in-process driver) runs nothing.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`stitch-shot error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
