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
 *     DOM-removed) AND timed marketing/newsletter interstitials (CH-1:
 *     a fashion retailer's "Sign up, stay updated!" modal baked a large pixel-diff
 *     contributor into the live capture that no prototype fidelity could
 *     null out). The mouse is parked afterwards (bottom-left) so no
 *     :hover-styled element under the resting cursor captures in hover state.
 *   - `--locale` determinism: geo-redirecting sites (a car brand → /ch-de/,
 *     a fashion brand → /ww/) capture a different locale per run unless
 *     Accept-Language + context locale are pinned.
 *
 * Escalation ladder (documented in replica/reference/source-fidelity-gate.md):
 *   headers+UA (default) → --headed (launchStealthHeaded) → if STILL blocked,
 *   the site needs crawl.mjs-class capture and the gate must fail, not degrade.
 *
 * Navigation timeout (navTimeout / resolveNavTimeoutMs): ONE value for every
 * live navigation — env STARDUST_NAV_TIMEOUT_MS (as given) → the crawl's
 * measured origin latency (stardust/current/_crawl-log.json crawl.navMs.p95
 * × 2, clamped 20–180 s) → 60000. Callers pass their own fallback (their
 * current default) for the last step; an explicit timeout always wins.
 * withDeadline bounds a whole per-width read; isContextDestroyed names the
 * one failure worth a retry on a fresh page.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev-tool library: sequential page ops use awaited loops by design */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

// ---- navigation timeout: one value, from the operator, else the origin's measured latency ----------
// A recorded hands-off run's measure.mjs hung 8× at 900 s on a site that navigates after load, while the
// instruments carried 20–90 s navigation defaults with no shared value and no origin-latency figure. One
// resolution now feeds them all: the operator's env, else twice the crawl's p95 page-load time (a slow
// origin gets more room, a fast one fails sooner), else the caller's own default.
export const NAV_TIMEOUT_ENV = 'STARDUST_NAV_TIMEOUT_MS';
export const CRAWL_LOG = 'stardust/current/_crawl-log.json'; // relative to the cwd (project root), like LEDGER
export const NAV_TIMEOUT_DEFAULT_MS = 60000;
export const NAV_TIMEOUT_MIN_MS = 20000;
export const NAV_TIMEOUT_MAX_MS = 180000;
let navEnvWarned = false; // one warning per process, not one per navigation

/**
 * The navigation timeout → { ms, source: 'env' | 'crawl' | 'default', detail }. Never throws; reads only `crawlLog`.
 *   1. env STARDUST_NAV_TIMEOUT_MS: trimmed, a finite number that rounds to >= 1 ms → used as given (no clamp —
 *      the operator's figure wins). Set but invalid → ignored, with one stderr warning per process. Empty = unset.
 *   2. `crawlLog` JSON `crawl.navMs.p95` (a finite number > 0) → round(p95 × 2) clamped to 20000–180000. A missing,
 *      unreadable or malformed file or field is skipped silently (a crawl log from before the timing has no figure).
 *   3. `fallback` (the caller's current default; 60000 unless given).
 */
export function navTimeout({ env = process.env, crawlLog = CRAWL_LOG, fallback = NAV_TIMEOUT_DEFAULT_MS } = {}) {
  const raw = env && env[NAV_TIMEOUT_ENV] != null ? String(env[NAV_TIMEOUT_ENV]).trim() : '';
  if (raw) {
    const n = Number(raw);
    // Math.round(0.4) is 0, and a 0 ms timeout means "no timeout" to playwright — the hang this exists to stop
    if (Number.isFinite(n) && Math.round(n) >= 1) return { ms: Math.round(n), source: 'env', detail: `${NAV_TIMEOUT_ENV}=${raw}` };
    if (!navEnvWarned) {
      navEnvWarned = true;
      console.error(`[live-session] ${NAV_TIMEOUT_ENV}=${raw} is not a positive number of ms — ignored`);
    }
  }
  if (crawlLog) {
    let p95 = null;
    try { p95 = JSON.parse(readFileSync(crawlLog, 'utf8')).crawl.navMs.p95; } catch { /* no crawl figure — fall through */ }
    if (Number.isFinite(p95) && p95 > 0) {
      const ms = Math.min(NAV_TIMEOUT_MAX_MS, Math.max(NAV_TIMEOUT_MIN_MS, Math.round(p95 * 2)));
      return { ms, source: 'crawl', detail: `crawl.navMs.p95 ${p95} ms × 2, clamped to ${NAV_TIMEOUT_MIN_MS}–${NAV_TIMEOUT_MAX_MS} ms (${crawlLog})` };
    }
  }
  const envNote = raw ? `no valid ${NAV_TIMEOUT_ENV} (${raw} ignored)` : `no ${NAV_TIMEOUT_ENV}`;
  return { ms: fallback, source: 'default', detail: `${envNote} and no crawl.navMs.p95 in ${crawlLog || '(no crawl log)'}` };
}

/** navTimeout(opts).ms — the default every navigation helper takes when its caller passes no timeout. */
export function resolveNavTimeoutMs(opts = {}) {
  return navTimeout(opts).ms;
}

// ---- per-width deadlines: a navigation timeout bounds the goto, not the reads after it --------------
// The recorded 900 s hangs were in the reads after the goto (one page reused across widths on a site that
// navigates after load). Instruments race each width's whole read against a deadline and retry only a
// destroyed context (isContextDestroyed), once, on a fresh page.

// node fires a setTimeout longer than 2^31 − 1 ms after 1 ms: an (unclamped) env figure that large would fail every read at once
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Race `promise` against `ms`: on expiry reject with an Error named 'DeadlineError', message
 * `${label}: deadline ${ms} ms exceeded`. The timer is cleared when the promise settles first; the abandoned
 * promise gets a no-op catch (its late rejection is not an unhandled rejection). `ms` not a finite number > 0,
 * or above setTimeout's 2^31 − 1 ms ceiling → `promise` itself, unchanged (no deadline).
 */
export function withDeadline(promise, ms, label = 'step') {
  if (!(Number.isFinite(ms) && ms > 0 && ms <= MAX_TIMER_MS)) return promise;
  const work = Promise.resolve(promise);
  work.catch(() => {});
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label}: deadline ${ms} ms exceeded`);
      err.name = 'DeadlineError';
      reject(err);
    }, ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

// The playwright messages for "the page's execution context / frame went away under a navigation".
const CONTEXT_DESTROYED_RE = /Execution context was destroyed|Cannot find context with specified id|[Ff]rame (?:was|got) detached/;

/** Did this playwright error come from the page navigating away under a read (the one retryable failure)? A
 * BotChallengeError or a DeadlineError never is, whatever its message quotes — neither is ever retried. */
export function isContextDestroyed(err) {
  if (!err || err.name === 'BotChallengeError' || err.name === 'DeadlineError') return false;
  return CONTEXT_DESTROYED_RE.test(String(err.message ?? err));
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
 * `timeoutMs` (goto and each reload) defaults to resolveNavTimeoutMs() per call —
 * env, then the crawl's p95 × 2, then 60000.
 * Returns the response.
 */
export async function gotoLive(page, url, { waitUntil = 'domcontentloaded', timeoutMs = resolveNavTimeoutMs(), settleMs = 1200, httpError = 'throw', solveWindow = false } = {}) {
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
// layout settles the way a real visit does) — stitch-shot's proven list.
// Exported for the test that pins the list; every instrument goes through
// dismissOverlays below.
export const CONSENT_CANDIDATES = [
  '#onetrust-accept-btn-handler',
  // cmp-prefixed consent managers: the welcome box's "yes" button, its box
  // variant and the button's text span
  '#cmpwelcomebtnyes',
  '.cmpboxbtnyes',
  '#cmpbntyestxt',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  '[data-testid*="accept"]',
];

// Container candidates for timed marketing/newsletter interstitials (CH-1).
// [role=dialog]/[aria-modal]/.modal alone is NOT enough: the recorded
// fashion-retailer "Sign up, stay updated!" panel is a bare `#wps_popup` div —
// no role, no modal class, and the wrapper itself measures 0x0 while its
// visible panel is a fixed child. Hence the popup/newsletter id+class
// markers, and hence the close-control-visibility test below (the ROOT may
// be 0x0 even while the interstitial is showing).
const MODAL_ROOTS = '[role="dialog"], [aria-modal="true"], .modal, [id*="popup" i], [class*="popup" i], [id*="newsletter" i], [class*="newsletter" i]';
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
 *   (a) cookie consent — clicked (never removed), first candidate wins;
 *   (b) timed marketing/newsletter interstitials (CH-1) — every modal-like
 *       container with a VISIBLE close control gets it clicked, verified
 *       gone. Because these fire on a TIMER (recorded: a fashion retailer's panel
 *       appears ~5–9s after load), the sweep polls for late arrivals for up
 *       to `lateWindowMs` (default 6000) when nothing was dismissed yet.
 *       Callers pass `lateWindowFor(url, …)`: 0 on local targets and on EDS build/preview hosts, which get one
 *       sweep (stitch-shot runs it after waitEdsDelayedPhase, so a consent manager the build enables is up).
 * `extra` selectors are site-specific dismissers, clicked first (each once).
 * Parks the mouse afterwards (bottom-left — dead space on virtually every
 * layout) so no :hover-styled element under the cursor captures hovered.
 * Returns { extra: [...], consent: <sel|null>, marketing: [...] }.
 */
export async function dismissOverlays(page, { extra = [], lateWindowMs = 6000 } = {}) {
  const dismissed = { extra: [], consent: null, marketing: [] };

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

  // park the mouse (rule 10): a dismissal click leaves the virtual cursor at
  // the button's coordinates; anything :hover-styled under it captures hovered.
  const vp = page.viewportSize();
  await page.mouse.move(0, (vp ? vp.height : 900) - 1).catch(() => {});

  return dismissed;
}

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
