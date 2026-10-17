/**
 * skills/diff/scripts/live-session.mjs
 *
 * The single home for "hit a live site to measure it, as robustly as the
 * capture engine". Every live-side navigation in the gate instruments
 * (content-diff, visual-diff, replica's stitch-shot) goes through here, so
 * capture-hardening and gate-hardening are the SAME surface — a luggage retailer's
 * field finding was that they weren't: crawl.mjs's bot-management ladder
 * cleared Akamai while the headless gate instruments were served "Access
 * Denied" and would have silently measured it as the source.
 *
 * Ports the SEMANTICS of extract/scripts/crawl.mjs's bot-management ladder
 * (do not import crawl.mjs — it is a crawler, this is a measurement session):
 *   - challenge/interstitial detection on the entry response
 *     (cf-mitigated: challenge; 403/429/503 + an edge/CDN signature);
 *   - the challenge-solve wait+reload window before declaring a hard block —
 *     under STEALTH-HEADED sessions only (gotoLive `solveWindow`): headless
 *     clearance never lands, and the loop's extra hits would spend the
 *     ~3–4-request Akamai block budget before --headed escalation;
 *   - headed real-Chrome stealth escalation (`--disable-blink-features=
 *     AutomationControlled`, dropped `--enable-automation`, navigator.webdriver
 *     spoof on EVERY context — the challenge re-fires per context).
 *
 * Hardening this module owns (each is a recorded false-measurement trap):
 *   - REAL-CHROME UA **plus the standard request headers** on every context.
 *     Field-proven (F-R1, a nonprofit site): the real-Chrome UA ALONE still got
 *     HTTP 403 from Akamai; adding Accept / Accept-Language /
 *     Upgrade-Insecure-Requests / sec-ch-ua* produced HTTP 200. Akamai
 *     bot-manager fingerprints on the ABSENCE of the standard headers every
 *     real Chrome sends, not just on the UA string.
 *   - The standard headers ride DOCUMENT requests only, never subresources
 *     (F-B2, a financial-services site): forcing them via extraHTTPHeaders on every
 *     request makes cross-origin CORS-mode font fetches (Typekit, Google
 *     Fonts, any font CDN) non-simple; they die with net::ERR_FAILED and the
 *     live capture silently renders FALLBACK type — wrong wraps, wrong
 *     heights, wrong doc height, no error anywhere. Bot managers fingerprint
 *     the navigation request, which still carries the full set.
 *   - A challenge/blocked interstitial FAILS LOUD (BotChallengeError), never
 *     silently measured as the source (the Access-Denied trap: an "Access Denied"
 *     page diffs cleanly — wrongly).
 *   - Two overlay classes dismissed, not one: cookie consent (clicked, never
 *     DOM-removed — one consent table: each consent manager's own accept
 *     button, then a multilingual label sweep guarded to overlay containers)
 *     AND timed marketing/newsletter interstitials (CH-1:
 *     a fashion retailer's "Sign up, stay updated!" modal baked a large pixel-diff
 *     contributor into the live capture that no prototype fidelity could
 *     null out). The mouse is parked afterwards (bottom-left) so no
 *     :hover-styled element under the resting cursor captures in hover state.
 *     What no sweep removed (a consent banner still shown, an open modal dialog, a
 *     fixed/sticky layer that paints over the page across most of the viewport,
 *     a scroll lock) is reported as `overlayLeft`, never captured silently —
 *     so is a label-sweep click that navigated away from the page.
 *   - `--locale` determinism: geo-redirecting sites (a car brand → /ch-de/,
 *     a fashion brand → /ww/) capture a different locale per run unless
 *     Accept-Language + context locale are pinned.
 *   - In-flow per-visitor regions (a geo-IP location bar above the header) are
 *     no overlay — dismissal cannot remove them and they push every box below
 *     them down — so `--hide` / presence.json `hide` reach every instrument
 *     through hideRegions: measured, hidden inline AND by a
 *     `<style data-stardust-hide>` rule that also hides a bar rendered later.
 *
 * Escalation ladder (documented in replica/reference/source-fidelity-gate.md):
 *   headers+UA (default) → --headed (launchStealthHeaded) → if STILL blocked,
 *   the site needs crawl.mjs-class capture and the gate must fail, not degrade.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev-tool library: sequential page ops use awaited loops by design */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Current stable Chrome on macOS. Chrome's UA reduction freezes the platform
// token at 10_15_7 and the minor version at .0.0.0 — only the major matters,
// and standardHeaders() derives sec-ch-ua from it so the two never disagree.
export const REAL_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const CHROME_MAJOR = (REAL_CHROME_UA.match(/Chrome\/(\d+)/) || [])[1] || '143';

// 'en' → the exact field-proven value ('en-US,en;q=0.9' — the B-probe that
// turned a nonprofit site's 403 into a 200); a regioned tag keeps its base as fallback.
function acceptLanguage(locale) {
  const tag = locale === 'en' ? 'en-US' : locale;
  const base = tag.split('-')[0];
  return tag === base ? tag : `${tag},${base};q=0.9`;
}

/**
 * Is this a LIVE http(s) URL (not localhost)? The callers key two defaults
 * off it: waitUntil (via defaultWaitUntil below) and the timed-modal late
 * window (0 on local targets — a prototype's overlays are not timed
 * third-party scripts, they render immediately).
 */
export function isLiveHttpUrl(url) {
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !local;
  } catch { return false; }
}

// EDS/Helix build + preview origins (…aem.page / …aem.live / …hlx.page /
// …hlx.live) — they decorate asynchronously after domcontentloaded, so an
// inventory taken at domcontentloaded measures the undecorated page.
const EDS_HOST_RE = /(^|\.)(aem|hlx)\.(page|live)$/i;

/** Is this an EDS build/preview origin (http(s), hostname ends in .aem.page / .aem.live / .hlx.page / .hlx.live)? False on anything unparseable. */
export function isEdsHost(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && EDS_HOST_RE.test(u.hostname);
  } catch { return false; }
}

/**
 * The timed late-modal window for dismissOverlays: `liveMs` on live source sites, 0 on local targets AND on EDS
 * build/preview hosts — neither serves timed third-party interstitials. The EDS page's own late phase (delayed.js,
 * where a consent manager the build enables loads) is awaited once with waitEdsDelayedPhase, then ONE sweep runs.
 */
export const lateWindowFor = (url, liveMs = 6000) => (isLiveHttpUrl(url) && !isEdsHost(url) ? liveMs : 0);

/**
 * Wait until the EDS delayed phase has fired (aem.js loads delayed.js on a 3 s timer after `load`): resolves once
 * the navigation entry's loadEventEnd is set and `afterLoadMs` have passed since it, or at `timeoutMs`. Never throws
 * — a timeout or a closed page ends the wait and the caller's sweep runs anyway. Returns the ms waited.
 */
export async function waitEdsDelayedPhase(page, { afterLoadMs = 3200, timeoutMs = 6000 } = {}) {
  const t0 = Date.now();
  try {
    await page.waitForFunction((after) => {
      const nav = performance.getEntriesByType('navigation')[0];
      return Boolean(nav) && nav.loadEventEnd > 0 && performance.now() - nav.loadEventEnd >= after;
    }, afterLoadMs, { timeout: timeoutMs, polling: 100 });
  } catch { /* timeout / closed page — never fatal */ }
  return Date.now() - t0;
}

/**
 * The SINGLE default-waitUntil rule for every probe (--wait-until always
 * overrides). Three tiers:
 *   - localhost/127.0.0.1 (and file:) → 'networkidle' — local prototypes/
 *     harnesses, unchanged legacy behavior;
 *   - EDS build/preview origins (hostname ends in .aem.page / .aem.live /
 *     .hlx.page / .hlx.live) → 'networkidle' — they decorate async and
 *     reliably reach networkidle; measuring them at domcontentloaded reads
 *     the pre-decoration DOM (flaky false reds / FONT FORK on deploy Step 10);
 *   - all other live http(s) → 'domcontentloaded' — the field-proven live-site
 *     rule (analytics beacons never reach networkidle; hard timeout otherwise).
 */
export function defaultWaitUntil(url) {
  if (!isLiveHttpUrl(url)) return 'networkidle';
  if (isEdsHost(url)) return 'networkidle';
  return 'domcontentloaded';
}

/**
 * The standard header set every real Chrome sends and Playwright's minimal
 * default set omits. UA alone is NOT sufficient against Akamai-class bot
 * management (F-R1); these headers are the other half of the fix.
 */
export function standardHeaders(locale = 'en') {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': acceptLanguage(locale),
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': `"Not/A)Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  };
}

/**
 * Ready-to-spread options for browser.newContext(): UA + standard headers
 * (+ viewport, + navigator.language coherence when a locale is pinned).
 * Callers add their own instrument-specific options (reducedMotion etc.).
 * NOTE: newLiveContext strips extraHTTPHeaders back out and delivers the
 * header set per-request instead (document requests only — F-B2 below);
 * spreading these options raw would re-introduce the font-fork trap.
 */
export function contextOptions({ ua, locale, viewport } = {}) {
  const opts = {
    userAgent: ua || REAL_CHROME_UA,
    extraHTTPHeaders: standardHeaders(locale || 'en'),
  };
  if (locale) opts.locale = locale === 'en' ? 'en-US' : locale;
  if (viewport) opts.viewport = viewport;
  return opts;
}

/**
 * newContext + contextOptions + the navigator.webdriver spoof on EVERY
 * context (crawl.mjs semantics: the challenge re-fires per context, so a
 * context that skipped the spoof is re-challenged even after another one
 * cleared it; the spoof is harmless on non-challenging sites). Extra
 * Playwright context options pass through (reducedMotion, ...).
 */
export async function newLiveContext(browser, { ua, locale, viewport, authOrigin, authHeader, ...rest } = {}) {
  // F-B2 (financial-services site, 2026-08-25): the standard header set must ride on
  // DOCUMENT requests only. Forcing it via extraHTTPHeaders on every request
  // makes cross-origin CORS-mode subresource fetches (Typekit/webfont CDNs)
  // non-simple; they die with net::ERR_FAILED and the live capture silently
  // renders FALLBACK type — an asymmetric false measurement (the prototype
  // side loads the same kit fine). Bot-manager fingerprinting happens on the
  // navigation request, which still carries the full set below.
  const { extraHTTPHeaders, ...base } = contextOptions({ ua, locale, viewport });
  const ctx = await browser.newContext({ ...rest, ...base });
  await ctx.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.continue({ headers: { ...route.request().headers(), ...extraHTTPHeaders } });
    } else {
      route.continue();
    }
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  if (authOrigin && authHeader) await attachOriginAuth(ctx, authOrigin, authHeader);
  return ctx;
}

/**
 * Origin-scoped site auth (protected demo origins: access allow-list + site
 * secret). Resolve from `--auth-header "token …"` or `--token-env NAME`
 * (process.env, then a cwd `.env`; default SITE_TOKEN). Attach through a route
 * filter on ONE origin — never via extraHTTPHeaders: the secret would ride every
 * third-party request and their CORS checks would fail a credentialed request,
 * reporting a vendor error real users never see (recorded on a video vendor's
 * playback API inside a modal). Every origin-reading instrument (stitch-shot,
 * qa, rollout verify, dynamics-check) uses these two.
 */
export function resolveSiteAuth({ authHeader, tokenEnv } = {}) {
  const idx = (k) => process.argv.indexOf(`--${k}`);
  const direct = authHeader || (idx('auth-header') >= 0 ? process.argv[idx('auth-header') + 1] : null);
  if (direct) return direct;
  const name = tokenEnv || (idx('token-env') >= 0 ? process.argv[idx('token-env') + 1] : null) || 'SITE_TOKEN';
  let v = process.env[name];
  if (!v && existsSync('.env')) v = (readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1];
  if (!v) return null;
  v = v.trim().replace(/^["']|["']$/g, '');
  return /^(token|bearer) /i.test(v) ? v : `token ${v}`;
}
export async function attachOriginAuth(context, origin, headerValue) {
  if (!headerValue || !origin) return;
  const o = new URL(origin).origin;
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u === o || u.startsWith(`${o}/`)) route.continue({ headers: { ...route.request().headers(), authorization: headerValue } });
    else route.continue();
  });
}

// The marker that classifies a response as a bot-management challenge/block,
// or null. Same semantics as crawl.mjs isChallengeResponse: a bare 403 with
// NO edge signature is a genuine app-level status (fail loud as HTTP, not as
// a challenge — no 12s solve loop on an auth-gated page).
function challengeMarker(resp) {
  if (!resp) return null;
  const status = resp.status();
  const h = resp.headers();
  // Cloudflare stamps this header specifically on managed/JS-challenge responses.
  if ((h['cf-mitigated'] || '').toLowerCase() === 'challenge') return 'cf-mitigated: challenge';
  if (status === 403 || status === 429 || status === 503) {
    const server = (h.server || '').toLowerCase();
    if (h['cf-ray'] || server.includes('cloudflare')) return `HTTP ${status} + Cloudflare edge signature (cf-ray/server)`;
    if (h['x-akamai-transformed'] || server.includes('akamai') || server.includes('edgesuite')) return `HTTP ${status} + Akamai edge signature`;
    if (resp.url().includes('edgesuite.net')) return `HTTP ${status} + errors.edgesuite.net interstitial`;
    if (server.includes('big-ip') || server.includes('imperva') || h['x-iinfo']) return `HTTP ${status} + F5/Imperva edge signature`;
    // no edge signature — a genuine app-level status, not a challenge.
  }
  // Akamai escalates to HTTP 400 {"result":"Bad Request"} after a burst of headless
  // probes (#125): the instruments refused to measure it but never suggested
  // escalation. A 400 stamped by AkamaiGHost is a challenge marker.
  if (status === 400) {
    const server = (h.server || '').toLowerCase();
    if (server.includes('akamaighost') || server.includes('akamai') || h['x-akamai-transformed']) return 'HTTP 400 + Akamai edge signature (bot-management escalation)';
  }
  return null;
}

/** crawl.mjs semantics: is this response a bot-management challenge/block? */
export function isChallengeResponse(response) {
  return challengeMarker(response) !== null;
}

/**
 * Navigate + settle, with the full fail-loud contract:
 *   - challenge/blocked interstitial → per `solveWindow`:
 *       false (default — plain headless): THROW BotChallengeError after the
 *         FIRST challenge-classified response, 1 hit total. Clearance only
 *         lands under a stealth-headed session (module docstring), so a
 *         headless solve loop just burns the documented ~3–4-request Akamai
 *         IP-block budget (source-fidelity-gate.md § Hit minimization)
 *         before the operator can escalate --headed.
 *       true (set it when the browser came from launchStealthHeaded): run
 *         the challenge-solve window first (wait + reload, 3 attempts —
 *         Cloudflare's non-interactive challenge sets its clearance cookie
 *         in that window under a stealth-headed session), THEN throw if
 *         still challenged.
 *     Either way a challenge must NEVER be silently measured as the source
 *     (the Access-Denied trap) — regardless of `httpError`.
 *   - non-challenge entry status >= 400 → per `httpError`:
 *       'throw' (default): THROW LiveHTTPError. Measuring a 404/500 page is
 *         as false a measurement as measuring a challenge — the reskin byte
 *         gate must never measure an error page.
 *       'measure': warn loudly and RETURN the response so capture proceeds —
 *         the diff probes' advisory contract (a 404 build side is normal on
 *         aem.page before preview propagation; the probe's flags carry the
 *         signal, exit stays 0).
 * Returns the response.
 */
export async function gotoLive(page, url, { waitUntil = 'domcontentloaded', timeoutMs = 60000, settleMs = 1200, httpError = 'throw', solveWindow = false } = {}) {
  let resp = await page.goto(url, { waitUntil, timeout: timeoutMs });
  if (!resp) {
    const err = new Error(`no response navigating to ${url} — network-level failure or non-HTTP navigation`);
    err.name = 'LiveNavigationError';
    throw err;
  }
  // challenge-solve window (crawl.mjs clearChallenge semantics) — HEADED
  // sessions only (solveWindow). In plain headless the clearance never
  // lands, so the loop's up-to-3 extra hits are pure spent block budget:
  // fail loud on the first challenge-classified response instead (1 hit).
  if (solveWindow) {
    for (let attempt = 0; attempt < 3 && isChallengeResponse(resp); attempt += 1) {
      await page.waitForTimeout(4000);
      const reloaded = await page.reload({ waitUntil, timeout: timeoutMs }).catch(() => null);
      if (reloaded) resp = reloaded;
    }
  }
  const marker = challengeMarker(resp);
  if (marker) {
    const err = new Error(
      `bot challenge at ${url}: ${marker} — the live side served an edge interstitial, NOT the page; `
      + 'refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is '
      + "still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the "
      + 'gate cannot run against it headless.',
    );
    err.name = 'BotChallengeError';
    err.marker = marker;
    err.url = url;
    throw err;
  }
  const status = resp.status();
  if (status >= 400) {
    if (httpError === 'measure') {
      console.error(`[live-session] WARNING: HTTP ${status} at ${url} — measuring the error page; flags will reflect it`);
    } else {
      const err = new Error(`HTTP ${status} at ${url} — not a challenge marker, but not the page either; refusing to measure it`);
      err.name = 'LiveHTTPError';
      err.status = status;
      throw err;
    }
  }
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return resp;
}

/**
 * Stealth escalation tier (crawl.mjs launchHeadedStealth semantics): the REAL
 * Chrome binary (`channel: 'chrome'`) clears TLS/H2-fingerprint blocks, and the
 * stealth args strip the automation signals Cloudflare's managed challenge
 * probes for. Pair with newLiveContext so the navigator.webdriver spoof lands
 * on every context. Takes the caller's `chromium` so this module stays import-free.
 *
 * WINDOW-FREE BY DEFAULT (#125). The window was never what cleared the block, the
 * binary was: `channel:'chrome'` + headless gets HTTP 200 from Akamai where bundled
 * headless Chromium gets 400. Visible windows blocked an operator's desktop under
 * four parallel agents. A window is opt-in: `STARDUST_HEADED_WINDOW=1`, for a
 * challenge that genuinely needs a human. Every `--headed` flag means THIS tier.
 *
 * `channel: 'chrome'` needs Google Chrome installed; when the launch fails the
 * bundled Chromium is launched instead with the same stealth args and a loud
 * stderr warning (the instrument is then the lesser tier — say so in the log).
 */
export async function launchStealthHeaded(chromium) {
  const visible = process.env.STARDUST_HEADED_WINDOW === '1';
  const opts = {
    headless: !visible,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  try {
    const b = await chromium.launch(opts);
    b.stardustTier = visible ? 'chrome-window' : 'chrome';
    return b;
  } catch (e) {
    console.error(`[live-session] WARNING: real Chrome (channel: chrome) failed to launch (${String(e.message).split('\n')[0]}) — falling back to bundled Chromium with the stealth args; bot-managed origins may still block this tier`);
    const { channel, ...rest } = opts;
    const b = await chromium.launch(rest);
    b.stardustTier = 'chromium-fallback';
    return b;
  }
}
/** The tier a browser from launchStealthHeaded / chromium.launch actually runs: 'chrome' | 'chrome-window' |
 * 'chromium-fallback' (Chrome elected, not installed) | 'chromium' (elected). Every probe records it in its
 * evidence so a run that degraded is visible in the artifact, not only in a log line. */
export const browserTier = (b) => b.stardustTier || 'chromium';

// Consent-accept candidates (clicked, never DOM-removed, so consent-gated
// layout settles the way a real visit does): each consent manager's own
// accept-all button first (OneTrust, Cookiebot, Usercentrics, TrustArc, Didomi,
// the cmp-prefixed managers; Playwright's CSS pierces the open shadow root
// Usercentrics renders in), then the text fallbacks. One table with
// CONSENT_LABEL_SWEEP below; every instrument goes through dismissOverlays.
export const CONSENT_CANDIDATES = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#usercentrics-root [data-testid="uc-accept-all-button"]',
  '.truste-button2',
  '#didomi-notice-agree-button',
  // cmp-prefixed consent managers: the welcome box's "yes" button, its box
  // variant and the button's text span
  '#cmpwelcomebtnyes',
  '.cmpboxbtnyes',
  '#cmpbntyestxt',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Allow all")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  '[data-testid*="accept"]',
];

// The label sweep when no candidate matched (a custom banner, a consent manager the list lacks): exact short labels,
// in PRIORITY order — accept-like first, 'decline' the last resort (a banner without an accept control still goes).
// A control counts only inside an overlay container (`containerPattern` id/class, a dialog, fixed/sticky, or
// positioned with z-index ≥ `zIndex`), so an in-content "Accept" link is never clicked; one that would leave the page
// (a form submit, a link off the document) needs more than a sticky / high-z container — a site header is one.
export const CONSENT_LABEL_SWEEP = Object.freeze({
  labels: Object.freeze([
    'accept all cookies', 'accept all', 'accept cookies', 'accept and close', 'i accept', 'accept',
    'allow all cookies', 'allow all', 'allow cookies', 'allow', 'i agree', 'agree',
    'alle akzeptieren', 'akzeptieren', 'zustimmen', 'tout accepter', 'accepter', 'aceptar todo', 'aceptar',
    'accetta tutto', 'accetta', 'got it', 'understood', 'okay', 'ok', 'decline',
  ]),
  maxLength: 32,
  containerPattern: 'cookie|consent|gdpr|privacy|banner',
  zIndex: 100,
  controls: 'button, [role="button"], a, input[type="button"], input[type="submit"]',
});

/* eslint-disable no-undef */
/**
 * The label sweep, run in the page: `page.evaluate(consentLabelSweepInPage, CONSENT_LABEL_SWEEP)` (self-contained —
 * Playwright serialises it). Controls are read from the document and every open shadow root, recursively; a control's
 * text is its whitespace-collapsed `value` (inputs), else textContent, else aria-label. For each label in order, the
 * first control whose lower-cased text IS that label (≤ maxLength), that is displayed (display, visibility, a 2×2
 * box) and that sits in an overlay container (itself or an ancestor below <body>, crossing shadow hosts) is clicked —
 * never removed. A control that would leave the page (a form submit, a link off this document) counts only under a
 * dialog / aria-modal / consent-pattern / fixed container — a sticky or high-z one alone is a site header's search.
 * → its text in the page's own case, or null.
 */
export function consentLabelSweepInPage(table) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const container = new RegExp(table.containerPattern, 'i');
  const wanted = new Set(table.labels);
  const roots = [];
  const addRoot = (root) => { roots.push(root); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) addRoot(el.shadowRoot); };
  addRoot(document);
  const found = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll(table.controls)) {
      const text = el.tagName === 'INPUT' ? norm(el.value) : norm(el.textContent) || norm(el.getAttribute('aria-label'));
      if (text && text.length <= table.maxLength && wanted.has(text.toLowerCase())) found.push({ el, text, label: text.toLowerCase() });
    }
  }
  const displayed = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width >= 2 && r.height >= 2;
  };
  const up = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  // the overlay kind around a control: 'strong' (a dialog, aria-modal, a consent-pattern id/class, position:fixed),
  // else 'weak' (sticky, or positioned with a high z-index — a site header is one too), else null. <body> and <html>
  // contain every control — a scroll-lock class or position on them guards nothing
  const overlayKind = (el) => {
    let weak = false;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = up(n)) {
      if (n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true') return 'strong';
      if (container.test(`${n.id} ${typeof n.className === 'string' ? n.className : n.getAttribute('class') || ''}`)) return 'strong';
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') return 'strong';
      if (cs.position === 'sticky' || (cs.position !== 'static' && Number(cs.zIndex) >= table.zIndex)) weak = true;
    }
    return weak ? 'weak' : null;
  };
  // a control that leaves the page: a form submit, or a link off this document (not "#…", not javascript:)
  const leaves = (el) => {
    if (el.tagName === 'INPUT') return el.type === 'submit';
    if (el.tagName === 'BUTTON') return el.type === 'submit' && Boolean(el.form);
    if (el.tagName === 'A' && el.hasAttribute('href')) { const h = el.getAttribute('href').trim(); return !h.startsWith('#') && !/^javascript:/i.test(h); }
    return false;
  };
  const inOverlay = (el) => {
    const kind = overlayKind(el);
    return kind === 'strong' || (kind === 'weak' && !leaves(el));
  };
  for (const label of table.labels) {
    const hit = found.find((c) => c.label === label && displayed(c.el) && inOverlay(c.el));
    if (hit) { hit.el.click(); return hit.text; }
  }
  return null;
}

/**
 * What a capture would still show after the sweeps, run in the page: `page.evaluate(detectOverlayLeftInPage,
 * { roots, coverage })` (self-contained). "Shown" = displayed, not visibility-hidden, opacity > 0 (ancestors too, via
 * checkVisibility where the browser has it) and a 2×2 box. In order:
 *   1. a modal dialog left open — the first shown element matching `:modal` (document order, open shadow roots
 *      included): its ::backdrop is a pseudo-element, the page beneath is inert to the hit test and the scroll is not
 *      locked, so no step below would name it → `<tag>[#id | .first.two classes] (modal open)`;
 *   2. a consent root (`roots`) still shown and banner-sized — the element or anything in its open shadow root whose
 *      box covers ≥ 5 % of the viewport area or ≥ 50 % of its width (a persistent privacy trigger does not) →
 *      `<root> (consent root visible)`;
 *   3. the first shown fixed/sticky element (document order, open shadow roots included) with a non-negative z-index
 *      that paints (background colour alpha > 0, a background image or a backdrop filter) over ≥ `coverage` of the
 *      viewport AND over the page — at the viewport centre an element that is not its own (outside its subtree, not
 *      its ancestor) lies beneath it → `<tag>[#id | .first.two classes] (<position>, <pct> % of the viewport)`;
 *   4. a scroll lock: `html (overflow:hidden)` when html's overflow-y is hidden/clip, else `body (overflow:hidden)`
 *      when body's is while html's is visible (it then locks the viewport).
 * → that descriptor, or null.
 */
export function detectOverlayLeftInPage({ roots, coverage }) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  // depth-first over a root and every open shadow root below it; the first element `pick` accepts
  const find = (root, pick) => {
    for (const el of root.querySelectorAll('*')) {
      if (pick(el)) return el;
      const inner = el.shadowRoot ? find(el.shadowRoot, pick) : null;
      if (inner) return inner;
    }
    return null;
  };
  // a descriptor's name for an element: its tag, then #id or its first two classes
  const nameOf = (el) => {
    const classes = [...el.classList].slice(0, 2);
    return `${el.tagName.toLowerCase()}${el.id ? `#${CSS.escape(el.id)}` : classes.map((c) => `.${CSS.escape(c)}`).join('')}`;
  };
  // a modal dialog left open: the page beneath is inert and its ::backdrop a pseudo-element — no later step sees it
  let modal = null;
  try { modal = find(document, (el) => el.matches(':modal') && shown(el)); } catch { /* no :modal in this browser */ }
  if (modal) return `${nameOf(modal)} (modal open)`;
  // banner-sized: the box covers ≥ 5 % of the viewport area or ≥ half its width — a consent manager's persistent
  // privacy trigger (a small fixed button left after consent) is not the banner
  const banner = (el) => {
    if (!shown(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height >= 0.05 * vw * vh || r.width >= 0.5 * vw;
  };
  for (const sel of roots) {
    let els = [];
    try { els = [...document.querySelectorAll(sel)]; } catch { /* not a selector here — skip it */ }
    if (els.some((el) => banner(el) || (el.shadowRoot && find(el.shadowRoot, banner)))) return `${sel} (consent root visible)`;
  }
  const alpha = (c) => {
    const m = /\(([^)]*)\)/.exec(c || '');
    if (!m) return c && c !== 'transparent' ? 1 : 0;
    const slash = m[1].split('/');
    const a = (slash.length > 1 ? slash[1] : m[1].split(',')[3] || '1').trim();
    return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  };
  let share = 0;
  // "covering" = painting over the page's own content: at the viewport centre an element outside the layer's subtree
  // and not its ancestor lies BENEATH it (after it in elementsFromPoint — of the layer's own tree scope, so a layer in
  // a shadow root is not retargeted away); a layer the hit test skips (pointer-events: none) counts when such an
  // element is there at all. A sticky hero over nothing yet, a fixed background under positioned content: no overlay.
  const up = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  const ancestorOf = (a, d) => { for (let n = up(d); n; n = up(n)) if (n === a) return true; return false; };
  const overPage = (el) => {
    const scope = el.getRootNode();
    const stack = (typeof scope.elementsFromPoint === 'function' ? scope : document).elementsFromPoint(vw / 2, vh / 2);
    const i = stack.indexOf(el);
    return (i < 0 ? stack : stack.slice(i + 1)).some((x) => x !== el && !el.contains(x) && !ancestorOf(x, el));
  };
  const layer = find(document, (el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    if (parseInt(cs.zIndex, 10) < 0 || !shown(el)) return false;
    const paints = alpha(cs.backgroundColor) > 0 || (cs.backgroundImage && cs.backgroundImage !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none');
    if (!paints) return false;
    const r = el.getBoundingClientRect();
    const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    share = (ix * iy) / (vw * vh);
    return share >= coverage && overPage(el);
  });
  if (layer) return `${nameOf(layer)} (${getComputedStyle(layer).position}, ${Math.round(share * 100)} % of the viewport)`;
  const locked = (el) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowY);
  if (locked(document.documentElement)) return 'html (overflow:hidden)';
  if (document.body && locked(document.body) && getComputedStyle(document.documentElement).overflowY === 'visible') return 'body (overflow:hidden)';
  return null;
}
/* eslint-enable no-undef */

// Each consent manager's banner root: still shown after the sweeps, the capture carries the banner.
export const CONSENT_ROOTS = [
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#usercentrics-root',
  '#truste-consent-track',
  '.truste_box_overlay',
  '#didomi-notice',
  '#didomi-popup',
  '#cmpbox',
  '#qc-cmp2-container',
];
// A fixed/sticky layer painting over the page's own content across at least this share of the viewport is an
// overlay left behind.
export const OVERLAY_COVERAGE = 0.8;

/**
 * The overlay a capture of `page` would still carry → descriptor (detectOverlayLeftInPage with CONSENT_ROOTS and
 * OVERLAY_COVERAGE) or null. An evaluate error → `(overlay check failed: <first line>)` — an unchecked capture is
 * never reported clean.
 */
export async function detectOverlayLeft(page) {
  try {
    return await page.evaluate(detectOverlayLeftInPage, { roots: CONSENT_ROOTS, coverage: OVERLAY_COVERAGE });
  } catch (e) {
    return `(overlay check failed: ${String((e && e.message) || e).split('\n')[0]})`;
  }
}

// Container candidates for timed marketing/newsletter interstitials (CH-1).
// [role=dialog]/[aria-modal]/.modal alone is NOT enough: the recorded
// fashion-retailer "Sign up, stay updated!" panel is a bare `#wps_popup` div —
// no role, no modal class, and the wrapper itself measures 0x0 while its
// visible panel is a fixed child. Hence the popup/newsletter id+class
// markers, and hence the close-control-visibility test below (the ROOT may
// be 0x0 even while the interstitial is showing). A native <dialog> opened
// with showModal() carries no role attribute: dialog[open].
const MODAL_ROOTS = 'dialog[open], [role="dialog"], [aria-modal="true"], .modal, [id*="popup" i], [class*="popup" i], [id*="newsletter" i], [class*="newsletter" i]';
const MODAL_CLOSE_CANDIDATES = [
  '[aria-label*="close" i]',
  'button[class*="close" i]',
  '[class*="close" i] button',
  '[class*="close-button" i]',
  '[data-dismiss]',
  'button:has-text("×")',
  'button:has-text("✕")',
  'button:has-text("Close")',
  'button:has-text("No thanks")',
  'button:has-text("No, thanks")',
];

/**
 * Dismiss the two overlay classes that corrupt live measurement:
 *   (a) cookie consent — clicked (never removed): the first CONSENT_CANDIDATES
 *       match wins; when none matched, the label sweep (consentLabelSweepInPage
 *       with CONSENT_LABEL_SWEEP) — `consent` is then `label "<text>"`;
 *   (b) timed marketing/newsletter interstitials (CH-1) — every modal-like
 *       container with a VISIBLE close control gets it clicked, verified
 *       gone. Because these fire on a TIMER (recorded: a fashion retailer's panel
 *       appears ~5–9s after load), the sweep polls for late arrivals for up
 *       to `lateWindowMs` (default 6000) when nothing was dismissed yet.
 *       Callers pass `lateWindowFor(url, …)`: 0 on local targets and on EDS build/preview hosts, which get one
 *       sweep (stitch-shot runs it after waitEdsDelayedPhase, so a consent manager the build enables is up).
 * `extra` selectors are site-specific dismissers, clicked first (each once).
 * Then detectOverlayLeft names what the capture would still carry (null when
 * clean) — reported, never removed; when a label-sweep click left the page (the
 * URL differs, fragment aside), overlayLeft is `(consent sweep navigated to <url>)`
 * instead. Parks the mouse afterwards (bottom-left —
 * dead space on virtually every layout) so no :hover-styled element under the
 * cursor captures hovered.
 * Returns { extra: [...], consent: <sel|label "<text>"|null>, marketing: [...], overlayLeft: <descriptor|null> }.
 */
export async function dismissOverlays(page, { extra = [], lateWindowMs = 6000 } = {}) {
  const dismissed = { extra: [], consent: null, marketing: [], overlayLeft: null };

  for (const sel of extra) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() && await btn.isVisible()) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        dismissed.extra.push(sel);
      }
    } catch { /* candidate absent — try next */ }
  }

  for (const sel of CONSENT_CANDIDATES) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() && await btn.isVisible()) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        dismissed.consent = sel;
        break;
      }
    } catch { /* candidate absent — try next */ }
  }
  // a sweep click can leave the page (a consent link to another path, a form post): the URL before it, fragment aside
  const sansHash = (u) => u.split('#')[0];
  let sweptFrom = null;
  if (!dismissed.consent) {
    const before = page.url();
    const hit = await page.evaluate(consentLabelSweepInPage, CONSENT_LABEL_SWEEP).catch(() => null);
    if (hit) {
      dismissed.consent = `label "${hit}"`;
      sweptFrom = before;
      await page.waitForTimeout(1500);
    }
  }

  // marketing/newsletter interstitials — close every modal container that
  // shows a visible close control. Gate on the CONTROL's visibility, not the
  // root's: the recorded fashion-retailer wrapper is 0x0 while its panel shows.
  const closeVisibleDialogs = async () => {
    let acted = 0;
    const roots = page.locator(MODAL_ROOTS);
    const n = Math.min(await roots.count().catch(() => 0), 25);
    for (let i = 0; i < n; i += 1) {
      const root = roots.nth(i);
      for (const sel of MODAL_CLOSE_CANDIDATES) {
        try {
          const btn = root.locator(sel).first();
          if (!(await btn.count()) || !(await btn.isVisible())) continue;
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          // verify the interstitial actually went away before crediting the click
          if (!(await btn.isVisible().catch(() => false))) {
            dismissed.marketing.push(sel);
            acted += 1;
          }
          break;
        } catch { /* candidate absent — try next */ }
      }
    }
    return acted;
  };
  // timed modals fire late (recorded: ~5–9s post-load) — poll until one is
  // dismissed or the window closes; a page with no interstitial burns the
  // window once, which is the price of not baking a modal into the capture.
  const deadline = Date.now() + lateWindowMs;
  let acted = await closeVisibleDialogs();
  while (!acted && Date.now() < deadline) {
    await page.waitForTimeout(1500);
    acted = await closeVisibleDialogs();
  }

  // what the capture would still carry (a banner no sweep reached, a backdrop, a scroll lock) — reported, never fixed;
  // a page the sweep navigated away from is never clean, whatever the new page shows
  const now = page.url();
  dismissed.overlayLeft = sweptFrom !== null && sansHash(now) !== sansHash(sweptFrom)
    ? `(consent sweep navigated to ${now})`
    : await detectOverlayLeft(page);

  // park the mouse (rule 10): a dismissal click leaves the virtual cursor at
  // the button's coordinates; anything :hover-styled under it captures hovered.
  const vp = page.viewportSize();
  await page.mouse.move(0, (vp ? vp.height : 900) - 1).catch(() => {});

  return dismissed;
}

// ---- in-flow per-visitor regions: one hide vocabulary for every live instrument ----------------
// `--hide <sel,…>` and presence.json `hide` (`"*"` for every slug, then the slug's own) name the regions; two-sided
// instruments apply the SAME list to both sides (the build has nothing to hide, like overlay dismissal). The site-wide
// stardust/replica/presence.json (SITE_PRESENCE) is merged under a gate dir's presence.json (mergePresence).

/** `--hide` values → selectors: each value a comma list string or an array of them; trimmed, empty dropped,
 * de-duplicated in order. Anything that is not a string or an array is ignored. */
export function parseHideList(...values) {
  const out = [];
  const add = (v) => {
    if (Array.isArray(v)) { v.forEach(add); return; }
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) { const sel = part.trim(); if (sel && !out.includes(sel)) out.push(sel); }
  };
  values.forEach(add);
  return out;
}

/** A slug's effective presence.json `hide` list: `"*".hide` then `<slug>.hide` (each entry may be a comma list),
 * de-duplicated. Only `hide` is read from `"*"`; `main` / `variable` are not hide lists. null / {} json or a missing
 * key → []. */
export function presenceHide(json, slug) {
  const hideOf = (k) => (json && typeof json === 'object' && json[k] && typeof json[k] === 'object' ? json[k].hide : null);
  return parseHideList(hideOf('*'), hideOf(slug));
}

/** The project's site-wide presence.json, cwd-relative like every `stardust/…` default: the same shape as a gate dir's
 * (`"*"` and `<slug>` → { hide?, main?, variable?, reasons? }), where a region on every page (a location bar) is listed
 * once. readPresenceFile merges it UNDER a gate dir's presence.json. */
export const SITE_PRESENCE = 'stardust/replica/presence.json';

/** Two parsed presence.json objects → one: per top-level key `{ ...site[k], ...gate[k] }` — the gate dir's field wins
 * (a whole field: its `hide` replaces the site's for that key), keys and fields only one file has are kept; a missing
 * or non-object file = {}. Pure: a new object, the inputs untouched. */
export function mergePresence(site, gate) {
  const obj = (x) => (x && typeof x === 'object' ? x : {});
  const s = obj(site); const g = obj(gate);
  return Object.fromEntries([...new Set([...Object.keys(s), ...Object.keys(g)])].map((k) => [k, { ...s[k], ...g[k] }]));
}

const readPresenceJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`presence.json ${file} unreadable (${e.message})`); }
};

/**
 * gate-all's presence.json for one slug → { file, slug, found, variable: [{ live, build }], hide, note }.
 * `variable` as gate-all's specFor reads it: the entries joined on ',' and split again, trimmed, each split on the
 * first '=' → live = left, build = right || left. `hide` = presenceHide. A missing file → found: false, empty
 * lists and a note; malformed JSON throws `presence.json <file> unreadable (<msg>)`.
 * The site-wide file (`site`, default SITE_PRESENCE; null = no merge, for callers that merged already) is merged UNDER
 * `file` by mergePresence when it exists — `file` may then be missing, null or the site file itself; `found` when
 * either exists. A merge adds `site` (its path), `hideSources` ([{ sel, source }] in `hide` order: `presence.json` or
 * `site presence.json` — the file whose `hide` field the merge kept) and `variableSource` (the same for `variable`,
 * null when empty); its note names both sources (`<file> over <site>`, `<site> (<file> not found)` or `<site>`; a null
 * slug reads `"*"` only and is shown as `"*"`). A malformed site file throws the same error naming it. Without a site
 * file the result is exactly the gate file's, as before.
 */
export function readPresenceFile(file, slug, { site = SITE_PRESENCE } = {}) {
  const siteFile = site && existsSync(site) ? site : null;
  const gateFile = file && existsSync(file) && !(siteFile && resolve(file) === resolve(siteFile)) ? file : null;
  if (!gateFile && !siteFile) return { file, slug, found: false, variable: [], hide: [], note: `${file} not found — nothing hidden` };
  const gate = gateFile ? readPresenceJson(gateFile) : null;
  const all = siteFile ? mergePresence(readPresenceJson(siteFile), gate) : gate;
  const entry = (all && typeof all === 'object' && all[slug]) || {};
  const variable = [].concat(entry.variable || []).join(',').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    const live = (i < 0 ? s : s.slice(0, i)).trim();
    return { live, build: (i < 0 ? '' : s.slice(i + 1)).trim() || live };
  });
  const hide = presenceHide(all, slug);
  if (!siteFile) {
    const note = !variable.length && !hide.length ? `${file} has no variable regions for ${slug} — nothing hidden`
      : `${file} → ${slug}: ${variable.length} variable region(s)${hide.length ? `, ${hide.length} hide selector(s)` : ''}`;
    return { file, slug, found: true, variable, hide, note };
  }
  // which file a merged field came from: the gate file's when its entry has the field itself ({ ...site[k], ...gate[k] })
  const sourceOf = (k, field) => {
    const e = gate && typeof gate === 'object' ? gate[k] : null;
    return e && typeof e === 'object' && Object.hasOwn(e, field) ? 'presence.json' : 'site presence.json';
  };
  const hideSources = [];
  for (const k of ['*', slug]) {
    for (const sel of parseHideList(all[k] && typeof all[k] === 'object' ? all[k].hide : null)) {
      if (!hideSources.some((x) => x.sel === sel)) hideSources.push({ sel, source: sourceOf(k, 'hide') });
    }
  }
  let label = siteFile;
  if (gateFile) label = `${gateFile} over ${siteFile}`;
  else if (file && resolve(file) !== resolve(siteFile)) label = `${siteFile} (${file} not found)`;
  const key = slug == null ? '"*"' : slug;
  const note = !variable.length && !hide.length ? `${label} has no variable regions for ${key} — nothing hidden`
    : `${label} → ${key}: ${variable.length} variable region(s)${hide.length ? `, ${hide.length} hide selector(s)` : ''}`;
  return { file, slug, found: true, variable, hide, note, site: siteFile, hideSources, variableSource: variable.length ? sourceOf(slug, 'variable') : null };
}

/** A hide list → [{ sel, source }]: strings are comma lists (parseHideList) tagged `source`; { sel, source }
 * objects keep their own source. A repeated selector keeps its first entry. */
export function hideEntries(list, source = '--hide') {
  const out = [];
  const add = (sel, src) => { if (sel && !out.some((x) => x.sel === sel)) out.push({ sel, source: src }); };
  for (const x of [].concat(list || [])) {
    if (x && typeof x === 'object' && !Array.isArray(x)) add(typeof x.sel === 'string' ? x.sel.trim() : '', x.source || source);
    else parseHideList(x).forEach((sel) => add(sel, source));
  }
  return out;
}

/* eslint-disable no-undef */
// Runs in the page (Playwright serialises it — no outer-scope references). Every selector's matches are measured
// before any is hidden (nested selectors read their rendered size), then hidden inline; ONE <style data-stardust-hide>
// carries one rule per valid selector (the union across calls), so an element inserted later is hidden too — or, when
// a CSP blocks inline styles, one adopted constructed sheet carries them. Each rule is parsed alone first and kept in
// the browser's own serialisation: a selector the query accepts but a style sheet would not (an unterminated comment)
// is an error that hides nothing, never a broken sheet. Then two frames or `settleMs`, whichever comes first.
async function hideInPage({ list, settleMs }) {
  const rows = list.map(({ sel, source }) => {
    try {
      const els = [...document.querySelectorAll(sel)];
      let rule = `${sel} { display: none !important; }`;
      let probe = null;
      try { probe = new CSSStyleSheet(); } catch { /* no constructable style sheets — keep the plain rule */ }
      if (probe) {
        probe.replaceSync(rule);
        if (probe.cssRules.length !== 1) throw new Error(`'${sel}' is not a valid style rule selector`);
        rule = probe.cssRules[0].cssText;
      }
      return { row: { sel, source, n: els.length, h: Math.round(els.reduce((s, el) => s + el.getBoundingClientRect().height, 0)) }, els, rule };
    } catch (e) { return { row: { sel, source, n: 0, h: 0, error: String(e.message || e).split('\n')[0] }, els: [], rule: null }; }
  });
  for (const { els } of rows) for (const el of els) el.style.setProperty('display', 'none', 'important');
  let tag = document.querySelector('style[data-stardust-hide]');
  if (!tag) {
    tag = document.createElement('style');
    tag.setAttribute('data-stardust-hide', '');
    (document.head || document.documentElement).appendChild(tag);
  }
  const rules = tag.textContent.split('\n').filter(Boolean);
  for (const { rule } of rows) if (rule && !rules.includes(rule)) rules.push(rule);
  tag.textContent = `${rules.join('\n')}\n`;
  // A CSP without 'unsafe-inline' leaves the tag without a sheet: the same rules then ride ONE constructed sheet
  // adopted by the document (not CSP-gated), found again by its marker and replaced with the union on every call.
  if (!tag.sheet) {
    try {
      let sheet = document.adoptedStyleSheets.find((s) => s.stardustHide);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.stardustHide = true;
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(rules.join('\n'));
    } catch { /* no adoptable style sheets — the inline hide still holds for the matches measured above */ }
  }
  await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, settleMs); });
  return rows.map((x) => x.row);
}
/* eslint-enable no-undef */

/**
 * Hide in-flow per-visitor regions on a Playwright `page` — after the instrument's dismissal + settle, before it
 * measures / inventories / captures. `entries` = [{ sel, source }] or plain strings (source `--hide`), normalised by
 * hideEntries. One page.evaluate: measure every selector (match count n, summed rendered height h, px rounded),
 * hide every match inline (`display: none !important`) and add one rule per valid selector to the page's single
 * `<style data-stardust-hide>` (idempotent: re-applying keeps one tag, its rules the union; under a CSP that blocks
 * inline styles the same rules ride one adopted constructed sheet), then wait two animation frames or `settleMs`,
 * whichever comes first. → records [{ sel, source, n, h, error? }] in input order; an invalid
 * selector is a record with `error`, never a throw. An empty list → [] without touching the page.
 */
export async function hideRegions(page, entries, { settleMs = 250 } = {}) {
  const list = hideEntries(entries, '--hide');
  if (!list.length) return [];
  return page.evaluate(hideInPage, { list, settleMs });
}

/** Records → one text line's worth: `<sel> ×<n> (<h>px) [<source>]`, `<sel> ×0 [<source>]`,
 * `<sel> error: <msg> [<source>]`, joined with '; ' ('' for none). */
export const formatHidden = (records) => (records || []).map((x) => `${x.sel} ${x.error ? `error: ${x.error}` : `×${x.n}${x.n ? ` (${x.h}px)` : ''}`} [${x.source}]`).join('; ');

// ---- evidence freshness: when a source-side capture may be reused ------------------------------
// One policy for every reuse of source-side evidence (an origin capture, a live inventory, the live
// half of a diff probe). The default reuses only the run's OWN captures: a capture taken at or after
// the run's opener line in the ledger is fresh ('same-run'); a new run recaptures once, then reuses
// for its fix rounds. Cross-run reuse is opt-in via a max age in hours ('max-age <h>h'). Every verdict
// carries the policy (fresh) or the reason (stale) so the caller records the reuse where it lands.

export const LEDGER = 'stardust/status.jsonl';
// (skill, phase) pairs whose `start` line opens a run: rollout's inventory opens every rollout (its
// published stage runs later, inside C-deliver); replica's extract opens a replica run.
export const RUN_OPENERS = [['stardust:rollout', 'A-inventory'], ['stardust:replica', 'extract']];
const FUTURE_SLACK_MS = 5 * 60e3; // clock skew tolerated before a capture time counts as "in the future"

/** The `ts` of the LAST opener `start` line in the ledger (`text` instead of the file, for tests);
 * malformed lines are skipped; an opener whose ts does not parse drops the anchor; no ledger or no opener → null. */
export function runStartAt({ ledger = LEDGER, text = null } = {}) {
  let body = text;
  if (body == null) {
    try { body = readFileSync(ledger, 'utf8'); } catch { return null; }
  }
  let at = null;
  for (const raw of String(body).split('\n')) {
    let rec;
    try { rec = JSON.parse(raw); } catch { continue; }
    if (!rec || rec.event !== 'start') continue;
    const skill = String(rec.skill || '');
    const full = skill.startsWith('stardust:') ? skill : `stardust:${skill}`;
    if (!RUN_OPENERS.some(([s, p]) => s === full && p === rec.phase)) continue;
    // an opener whose ts does not parse still opened a new run: drop the anchor rather than fall
    // back to the previous run's (its captures must not count as same-run)
    at = typeof rec.ts === 'string' && !Number.isNaN(Date.parse(rec.ts)) ? rec.ts : null;
  }
  return at;
}

/** The opt-in cross-run max age in hours: a finite number > 0, else null (off). */
export function maxAgeHours(v = process.env.STARDUST_ORIGIN_MAX_AGE_H) {
  const n = Number(v); // '' / null → 0, junk → NaN: both off
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * May a source-side capture (`meta.at`, ISO) be reused? → { fresh, policy, reason, runStart }.
 * `runStart` undefined → runStartAt({ ledger }); `maxAgeH` undefined → the env (maxAgeHours()).
 * Fresh: at >= runStart → 'same-run' (wins), else now - at <= maxAgeH hours → 'max-age <h>h'.
 * Stale reasons: 'no capture time' | 'capture time in the future' (> 5 min ahead) |
 * 'captured before this run (<runStart>)' | 'no run anchor in <ledger> (cross-run reuse is opt-in: …)',
 * the last two with '; older than max-age <h>h' when a max age was set and exceeded.
 */
export function freshness(meta, { runStart, maxAgeH, now = Date.now(), ledger } = {}) {
  const anchor = runStart === undefined ? runStartAt({ ledger }) : runStart;
  const startMs = anchor ? Date.parse(anchor) : NaN;
  const maxH = maxAgeHours(maxAgeH); // undefined falls through to the env default
  const nowMs = typeof now === 'string' ? Date.parse(now) : Number(now);
  const atMs = meta && meta.at ? Date.parse(meta.at) : NaN;
  const stale = (reason) => ({ fresh: false, policy: null, reason, runStart: anchor });
  if (Number.isNaN(atMs)) return stale('no capture time');
  if (atMs > nowMs + FUTURE_SLACK_MS) return stale('capture time in the future');
  if (!Number.isNaN(startMs) && atMs >= startMs) return { fresh: true, policy: 'same-run', reason: null, runStart: anchor };
  if (maxH != null && nowMs - atMs <= maxH * 3600e3) return { fresh: true, policy: `max-age ${maxH}h`, reason: null, runStart: anchor };
  const why = Number.isNaN(startMs)
    ? `no run anchor in ${ledger || LEDGER} (cross-run reuse is opt-in: --origin-max-age / STARDUST_ORIGIN_MAX_AGE_H)`
    : `captured before this run (${anchor})`;
  return stale(maxH != null ? `${why}; older than max-age ${maxH}h` : why);
}

/** Boolean form of freshness() for callers that only branch on it. */
export const isFreshCapture = (meta, opts) => freshness(meta, opts).fresh;

/** What a caller records where a reuse lands (a row, origin.json, a probe's JSON). */
export const reuseRecord = (from, meta, verdict) => ({ reused: true, from, at: meta.at, policy: verdict.policy });

// Canonical form of a cache key: object keys sorted recursively, arrays kept in order.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
const canonJson = (v) => JSON.stringify(canon(v));
const firstDifference = (a, b) => {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return canonJson(a) === canonJson(b) ? null : 'key';
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().find((k) => canonJson(a[k]) !== canonJson(b[k])) || null;
};

/**
 * Side cache `{ key, at, writtenBy, data }`: a hit needs the canonical key equal AND `at` fresh per
 * freshness(_, opts) → { hit: true, data, at, policy, file }; else { hit: false, reason } with reason
 * 'absent' | 'unreadable (<msg>)' | 'key mismatch (<first differing field>)' | the freshness reason.
 */
export function readSideCache(file, key, opts = {}) {
  if (!file || !existsSync(file)) return { hit: false, reason: 'absent' };
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { hit: false, reason: `unreadable (${String(e.message).split('\n')[0]})` }; }
  if (!doc || typeof doc !== 'object' || !('data' in doc)) return { hit: false, reason: 'unreadable (not a side-cache record)' };
  const field = firstDifference(doc.key, key);
  if (field) return { hit: false, reason: `key mismatch (${field})` };
  const verdict = freshness({ at: doc.at }, opts);
  if (!verdict.fresh) return { hit: false, reason: verdict.reason };
  return { hit: true, data: doc.data, at: doc.at, policy: verdict.policy, file };
}

/** Write a side cache atomically (mkdir -p, `<file>.<pid>.tmp`, rename) → file. */
export function writeSideCache(file, key, data, { at = new Date().toISOString(), writtenBy = null } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ key: canon(key), at, writtenBy, data }, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}
