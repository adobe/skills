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
 *     heights, wrong doc height, no error anywhere. Of the document route's
 *     set only Accept / Accept-Language / Upgrade-Insecure-Requests apply:
 *     Playwright drops its sec-* values as forbidden headers. A page's
 *     sec-ch-ua* comes from the browser, through the UA metadata
 *     applyUaMetadata sets from the UA string (a site behind a vendor wall
 *     served a 200 "System Down" page when the UA claimed Chrome and the
 *     hints did not back it); browser-set low-entropy hints trigger no CORS
 *     preflight, unlike F-B2's author headers. Escape hatch:
 *     STARDUST_LIVE_HINTS=native.
 *   - A challenge/blocked interstitial FAILS LOUD (BotChallengeError), never
 *     silently measured as the source (the Access-Denied trap: an "Access Denied"
 *     page diffs cleanly — wrongly). So does a 2xx DENIAL page (a vendor wall
 *     answering 200 with its denial text, no header to classify): a vendor
 *     signature (DENIAL_SIGNATURES — a pair anywhere in the title + text; a
 *     single phrase in the title, or in the text / an iframe src only on a page
 *     under 2 KB of text) or a page under 2 KB of text under ONE error heading.
 *     The message says "origin blocked" and names the --headed escalation.
 *   - Three overlay classes dismissed, not one: cookie consent (clicked, never
 *     DOM-removed), timed marketing/newsletter interstitials (CH-1:
 *     a fashion retailer's "Sign up, stay updated!" modal baked a large pixel-diff
 *     contributor into the live capture that no prototype fidelity could
 *     null out) AND open dialogs (closeDialogs: a native <dialog> close()d, else
 *     its close control, else Escape; a non-native modal its close control, else
 *     Escape). The html/body scroll lock a closed dialog leaves is released for
 *     the capture (overflow-y visible; a hidden overflow-x becomes clip) — only
 *     when the dialog pass closed one and none survived; dialogsLeft names a
 *     survivor. The mouse is parked afterwards (bottom-left) so no
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
 * live navigation — max(env STARDUST_NAV_TIMEOUT_MS, the crawl's measured
 * origin latency: stardust/current/_crawl-log.json crawl.navMs.p95 × 2),
 * clamped 20–180 s; the env is a floor, never a cut. Neither present → the
 * caller's own fallback (its current default; 60000 unless given). An
 * explicit timeout always wins.
 * withDeadline bounds a whole per-width read; isContextDestroyed names the
 * one failure worth a retry on a fresh page.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev-tool library: sequential page ops use awaited loops by design */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { dirname } from 'node:path';

// Current stable Chrome on macOS. Chrome's UA reduction freezes the platform
// token at 10_15_7 and the minor version at .0.0.0 — only the major matters.
// A page's sec-ch-ua* come from the browser's UA metadata, set from this string
// by applyUaMetadata (uaMetadata): brands and version match it, the platform is
// the host's (limits: § client hints). standardHeaders()' sec-ch-ua is the same
// brand list, but a route's sec-* never arrive (Playwright: forbidden headers).
export const REAL_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const CHROME_MAJOR = (REAL_CHROME_UA.match(/Chrome\/(\d+)/) || [])[1] || '143';

// The brands a Chrome of version `chrome` claims, the GREASE entry first (the order standardHeaders' sec-ch-ua sends):
// one list for the header and for uaMetadata's brands / fullVersionList.
const chromeBrands = (grease, chrome) => [{ brand: 'Not/A)Brand', version: grease }, { brand: 'Chromium', version: chrome }, { brand: 'Google Chrome', version: chrome }];

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
    'sec-ch-ua': chromeBrands('8', CHROME_MAJOR).map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  };
}

// ---- client hints: the UA's brands and version on a page's requests (V4) --------------------------------------------
// A site behind a vendor wall answered a recorded run with a 200 "System Down" page when the UA claimed Chrome and the
// requests' client hints did not back it. A route cannot fix that: Playwright drops every sec-* header override as a
// forbidden header. So each page's UA metadata is set from the UA string (applyUaMetadata): its requests — documents and
// subresources, same- and cross-origin — carry sec-ch-ua* with the UA's brands and version and the HOST's platform, no
// CORS preflight (browser-set hints are not author headers; F-B2 stays clear). Out-of-process iframes and service
// workers keep the browser's own; a popup's first requests are best effort. The value: the caller's `hints` option,
// else env STARDUST_LIVE_HINTS (reaches the instruments gate rounds spawn), else 'ua-metadata'; 'native' sets no
// metadata (the browser's own hints).
export const HINTS_ENV = 'STARDUST_LIVE_HINTS';
export const HINT_SCOPES = Object.freeze(['ua-metadata', 'native']);
let hintsEnvWarned = false; // one warning per process, not one per context
let cdpWarned = false; // likewise for a CDP failure in applyUaMetadata

/**
 * The client-hint value a context runs → 'ua-metadata' | 'native'. `hints` when non-null (outside HINT_SCOPES →
 * throws), else env STARDUST_LIVE_HINTS trimmed ('' = unset; outside HINT_SCOPES → ignored with ONE stderr warning per
 * process), else 'ua-metadata'.
 */
export function hintScope({ hints = null, env = process.env } = {}) {
  if (hints != null) {
    if (!HINT_SCOPES.includes(hints)) throw new Error(`hints must be one of ${HINT_SCOPES.join(', ')} — got ${hints}`);
    return hints;
  }
  const raw = env && env[HINTS_ENV] != null ? String(env[HINTS_ENV]).trim() : '';
  if (HINT_SCOPES.includes(raw)) return raw;
  if (raw && !hintsEnvWarned) {
    hintsEnvWarned = true;
    console.error(`[live-session] ${HINTS_ENV}=${raw} is not one of ${HINT_SCOPES.join(', ')} — ignored`);
  }
  return 'ua-metadata';
}

const UA_PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/**
 * The CDP userAgentMetadata a real Chrome of the UA's version would report on this host → null when `ua` has no
 * `Chrome/<n>`. Brands and fullVersionList from the UA (chromeBrands — the same list as standardHeaders' sec-ch-ua);
 * platform, platformVersion (macOS from the Darwin release: major ≥ 25 → major + 1, else major − 9; minor kept, patch
 * 0), architecture and bitness from the HOST.
 */
export function uaMetadata(ua = REAL_CHROME_UA, host = { platform: process.platform, release: osRelease(), arch: process.arch }) {
  const m = String(ua || '').match(/Chrome\/(\d+)((?:\.\d+)*)/);
  if (!m) return null;
  const fullVersion = `${m[1]}${m[2]}`;
  const release = String(host.release || '');
  let platformVersion = (release.match(/^\d+(\.\d+){0,2}/) || [''])[0];
  if (host.platform === 'darwin') {
    const d = release.match(/^(\d+)(?:\.(\d+))?/);
    platformVersion = d ? `${Number(d[1]) >= 25 ? Number(d[1]) + 1 : Number(d[1]) - 9}.${d[2] || 0}.0` : '';
  }
  return {
    brands: chromeBrands('8', m[1]),
    fullVersionList: chromeBrands('8.0.0.0', fullVersion),
    fullVersion,
    platform: UA_PLATFORMS[host.platform] || '',
    platformVersion,
    architecture: ['arm64', 'arm'].includes(host.arch) ? 'arm' : 'x86',
    bitness: ['arm64', 'x64', 'ppc64', 's390x'].includes(host.arch) ? '64' : '32',
    model: '',
    mobile: false,
    wow64: false,
  };
}

/**
 * Set the browser's UA metadata from `ua` on every page of `ctx` (Emulation.setUserAgentOverride on a CDP session of
 * our own — sent after Playwright's own init-time override, so it wins): the pages it has, each page ctx.newPage
 * returns (before it returns) and each page the site opens (popups; best effort). `locale` is the context's locale
 * option — the acceptLanguage Playwright itself sends — so Accept-Language is unchanged. `hints` (hintScope) is
 * validated first. 'native', or a UA with no Chrome version → nothing set, ctx.stardustHints 'native'. A CDP failure
 * (a non-Chromium browser, a closed page) → ONE stderr line per process and 'native'; else 'ua-metadata'.
 */
export async function applyUaMetadata(ctx, { ua = REAL_CHROME_UA, locale, hints = null } = {}) {
  const scope = hintScope({ hints });
  const userAgentMetadata = scope === 'ua-metadata' ? uaMetadata(ua) : null;
  if (!userAgentMetadata) { ctx.stardustHints = 'native'; return; }
  ctx.stardustHints = 'ua-metadata';
  // Out-of-process iframes and service workers keep Playwright's own metadata: the override is per page target.
  // page → the promise of its CDP session, kept referenced while the page lives: a detached session clears the override.
  const applied = new WeakMap();
  const apply = (page) => {
    if (!applied.has(page)) {
      applied.set(page, (async () => {
        try {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: locale, userAgentMetadata });
          return cdp;
        } catch (e) {
          ctx.stardustHints = 'native';
          if (!cdpWarned) {
            cdpWarned = true;
            console.error(`[live-session] the UA client-hint metadata could not be set (${String(e.message).split('\n')[0]}) — the browser's own client hints ride this context (hints: native)`);
          }
          return null;
        }
      })());
    }
    return applied.get(page);
  };
  for (const page of ctx.pages()) await apply(page);
  const open = ctx.newPage.bind(ctx);
  ctx.newPage = async (...args) => { const page = await open(...args); await apply(page); return page; };
  ctx.on('page', (page) => { apply(page); });
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
 * `hints` (null → env STARDUST_LIVE_HINTS → 'ua-metadata'; hintScope) is
 * validated before any context opens, then applyUaMetadata runs with the
 * context's UA and locale. The context records `stardustHints` and
 * `stardustBuild` (browserBuild) — hintRecord reads them for a capture record.
 */
export async function newLiveContext(browser, { ua, locale, viewport, authOrigin, authHeader, hints, ...rest } = {}) {
  // F-B2 (financial-services site, 2026-08-25): the standard header set must ride on
  // DOCUMENT requests only. Forcing it via extraHTTPHeaders on every request
  // makes cross-origin CORS-mode subresource fetches (Typekit/webfont CDNs)
  // non-simple; they die with net::ERR_FAILED and the live capture silently
  // renders FALLBACK type — an asymmetric false measurement (the prototype
  // side loads the same kit fine). Of the set below only Accept,
  // Accept-Language and Upgrade-Insecure-Requests apply: Playwright drops its
  // sec-* values as forbidden headers. A page's sec-ch-ua* comes from
  // the browser, through the UA metadata applyUaMetadata sets from the UA
  // string; browser-set low-entropy hints trigger no CORS preflight, unlike
  // the author headers above. Escape hatch: STARDUST_LIVE_HINTS=native.
  const scope = hintScope({ hints });
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
  ctx.stardustBuild = browserBuild(browser);
  await applyUaMetadata(ctx, { ua: base.userAgent, locale: base.locale, hints: scope });
  return ctx;
}

/** What a capture record names about the client hints: the build that ran and the hint value of its context. */
export const hintRecord = (ctx) => ({ browserBuild: ctx.stardustBuild || 'unknown', hints: ctx.stardustHints || 'native' });

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

// ---- denial pages: a vendor wall that answers 200 ---------------------------------------------------
// The header marker above only sees 4xx/5xx + an edge signature. A site behind a vendor wall answered a
// headless instrument with HTTP 200 and its denial text ("System Down", "Access Denied … Reference #",
// "Just a moment…") — no header to classify, so the gate measured the denial page as the source. The
// page itself is classified instead: a vendor signature in the title / visible text / iframe srcs, or a
// tiny page whose only heading is an error. A single phrase counts in the body only on a page under
// DENIAL_TEXT_MAX_BYTES of text: a full page that merely mentions "press & hold the button" is no denial
// page, while a pair ("Access Denied" + "Reference #") is specific enough anywhere.
export const DENIAL_TEXT_MAX_BYTES = 2048;
// One probe read's deadline (pageDenial): page.evaluate has no timeout of its own, and a renderer stuck in a busy
// loop never answers it — unbounded, the read inside gotoLive would undo the bounded navigation the callers rely on.
export const DENIAL_PROBE_MS = 10000;

const denialSignature = (id, label, all) => Object.freeze({ id, label, all: Object.freeze(all.map((p) => (Array.isArray(p) ? Object.freeze([...p]) : p))) });
/**
 * Vendor denial signatures, first match wins. `all` = phrases that must ALL occur (normalizeDenialText form);
 * an element that is an array lists alternatives (any one occurs). `label` names the vendor text in the marker.
 */
export const DENIAL_SIGNATURES = Object.freeze([
  denialSignature('cant-process', '"can\'t process your request" + "Incident Number"', ["can't process your request", 'incident number']),
  denialSignature('access-denied', '"Access Denied" + "Reference #"', ['access denied', 'reference #']),
  denialSignature('just-a-moment', '"Just a moment…"', ['just a moment...']),
  denialSignature('press-and-hold', '"Press & Hold"', ['press & hold']),
  denialSignature('incapsula', '"Incapsula"', ['incapsula']),
  denialSignature('datadome', '"DataDome"', [['datadome', 'captcha-delivery.com']]),
  denialSignature('request-unsuccessful', '"Request unsuccessful"', ['request unsuccessful']),
  denialSignature('system-down', '"System Down"', ['system down']),
]);

// The generic rule's heading (matched against the normalised heading): the words a block / error / bot-check
// page leads with. captcha is unbounded (recaptcha, hcaptcha); the rest are whole words.
export const DENIAL_ERROR_HEADING = /\b(?:errors?|denied|forbidden|blocked|unavailable|sorry|can't|cannot|unable|went wrong|not found|rejected|robots?|are you (?:a )?human|verify you are|security check|system down)\b|captcha/i;

/** Lower-case; curly apostrophes/quotes (’ ‘ ʼ) → ', … → ..., every whitespace run → one space; trimmed. */
export function normalizeDenialText(s) {
  return String(s ?? '').toLowerCase().replace(/[’‘ʼ]/g, "'").replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * page.evaluate(denialProbeInPage) → { title, text, bytes, headings, frames }: the title; the body's visible text,
 * whitespace-collapsed, first 32768 chars; `bytes` = UTF-8 length of the FULL collapsed text; the collapsed texts
 * of the displayed headings (h1–h6, [role=heading]; display, visibility and a ≥ 1×1 box), ≤ 10; iframe srcs, ≤ 10.
 * Self-contained: playwright serialises it.
 */
/* eslint-disable no-undef */
export function denialProbeInPage() {
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const full = collapse(document.body ? document.body.innerText : '');
  const headings = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
    if (headings.length >= 10) break;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width >= 1 && r.height >= 1) headings.push(collapse(el.innerText));
  }
  const frames = [...document.querySelectorAll('iframe[src]')].slice(0, 10).map((f) => f.src || f.getAttribute('src'));
  return { title: document.title, text: full.slice(0, 32768), bytes: new TextEncoder().encode(full).length, headings, frames };
}
/* eslint-enable no-undef */

/**
 * The denial marker of a denialProbeInPage probe, or null (pure). A probe that is not { title: string,
 * text: string, bytes: finite number, headings: array, frames: array } → null. Signatures in order: a pair
 * (`all.length >= 2`) matches when every element occurs in the title + text; a single phrase in the title, or —
 * only when bytes < DENIAL_TEXT_MAX_BYTES — in the text or an iframe src. First match → 'denial page — <label>'.
 * Else the generic rule: bytes < DENIAL_TEXT_MAX_BYTES, exactly ONE heading, matching DENIAL_ERROR_HEADING →
 * 'denial page — <bytes> B of text under one error heading "<heading, ≤ 80 chars>"'.
 */
export function denialMarker(probe) {
  if (!probe || typeof probe !== 'object' || typeof probe.title !== 'string' || typeof probe.text !== 'string'
    || !Number.isFinite(probe.bytes) || !Array.isArray(probe.headings) || !Array.isArray(probe.frames)) return null;
  const title = normalizeDenialText(probe.title);
  const text = normalizeDenialText(probe.text);
  const frames = probe.frames.map(normalizeDenialText);
  const small = probe.bytes < DENIAL_TEXT_MAX_BYTES;
  const has = (hay, el) => (Array.isArray(el) ? el : [el]).some((p) => hay.includes(p));
  for (const sig of DENIAL_SIGNATURES) {
    const hit = sig.all.length >= 2
      ? sig.all.every((el) => has(`${title} ${text}`, el))
      : has(title, sig.all[0]) || (small && (has(text, sig.all[0]) || frames.some((f) => has(f, sig.all[0]))));
    if (hit) return `denial page — ${sig.label}`;
  }
  if (small && probe.headings.length === 1) {
    const heading = String(probe.headings[0] ?? '').replace(/\s+/g, ' ').trim();
    if (DENIAL_ERROR_HEADING.test(normalizeDenialText(heading))) return `denial page — ${probe.bytes} B of text under one error heading "${heading.slice(0, 80)}"`;
  }
  return null;
}

/**
 * The page's denial marker → { marker, skipped }. Each read races `probeMs` (withDeadline, label 'denial-page
 * probe'): a wedged renderer never answers page.evaluate, so a read past the deadline is a failed read, like an
 * evaluate error (a navigation under the probe). A failed read is retried once after 500 ms; failing twice →
 * { marker: null, skipped: '<first line of the error>' } — the caller says the check was skipped, it never
 * silently passes.
 */
export async function pageDenial(page, { probeMs = DENIAL_PROBE_MS } = {}) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await page.waitForTimeout(500).catch(() => {});
    try {
      return { marker: denialMarker(await withDeadline(page.evaluate(denialProbeInPage), probeMs, 'denial-page probe')), skipped: null };
    } catch (e) { last = e; }
  }
  return { marker: null, skipped: String(last && last.message ? last.message : last).split('\n')[0] };
}

/**
 * The Error every instrument recognises as a blocked live side (exit 3): name 'BotChallengeError', `.marker`,
 * `.url`. `denial` = the marker came from the page (denialMarker), not the response headers.
 */
export function botChallengeError(url, marker, { denial = false } = {}) {
  const err = new Error(denial
    ? `bot challenge at ${url}: ${marker} — origin blocked: the live side served a denial page, NOT the page; refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it headless.`
    : `bot challenge at ${url}: ${marker} — the live side served an edge interstitial, NOT the page; `
      + 'refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is '
      + "still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the "
      + 'gate cannot run against it headless.');
  err.name = 'BotChallengeError';
  err.marker = marker;
  err.url = url;
  return err;
}

// ---- navigation timeout: one value, the larger of the operator's floor and the origin's measured latency ----
// A recorded hands-off run's measure.mjs hung 8× at 900 s on a site that navigates after load, while the
// instruments carried 20–90 s navigation defaults with no shared value and no origin-latency figure. One
// resolution now feeds them all: the larger of the operator's env and twice the crawl's p95 page-load time (a slow
// origin gets more room, a fast one fails sooner), clamped 20–180 s, else the caller's own default.
export const NAV_TIMEOUT_ENV = 'STARDUST_NAV_TIMEOUT_MS';
export const CRAWL_LOG = 'stardust/current/_crawl-log.json'; // relative to the cwd (project root), like LEDGER
export const NAV_TIMEOUT_DEFAULT_MS = 60000;
export const NAV_TIMEOUT_MIN_MS = 20000;
export const NAV_TIMEOUT_MAX_MS = 180000;
let navEnvWarned = false; // one warning per process, not one per navigation

/**
 * The navigation timeout → { ms, source: 'env' | 'crawl' | 'default', detail }. Never throws; reads only `crawlLog`.
 * Two inputs, either may be absent:
 *   - env STARDUST_NAV_TIMEOUT_MS: trimmed, a finite number that rounds to >= 1 ms. Set but invalid → ignored, with
 *     one stderr warning per process. Empty = unset.
 *   - `crawlLog` JSON `crawl.navMs.p95` (a finite number > 0) → round(p95 × 2). A missing, unreadable or malformed
 *     file or field is skipped silently (a crawl log from before the timing has no figure).
 * Either present → ms = max(present inputs) clamped to 20000–180000; source = the input that set the max ('env' on a
 * tie). The env is a FLOOR, not a replacement: a runner sets it from its discovery sample, while the crawl measured the
 * real pages — a slow origin's crawl figure must not be cut short by a smaller env. Neither → `fallback` (the caller's
 * current default; 60000 unless given), unclamped, source 'default'. An instrument's explicit flag bypasses all this.
 */
export function navTimeout({ env = process.env, crawlLog = CRAWL_LOG, fallback = NAV_TIMEOUT_DEFAULT_MS } = {}) {
  const raw = env && env[NAV_TIMEOUT_ENV] != null ? String(env[NAV_TIMEOUT_ENV]).trim() : '';
  let envMs = null;
  if (raw) {
    const n = Number(raw);
    // Math.round(0.4) is 0, and a 0 ms timeout means "no timeout" to playwright — the hang this exists to stop
    if (Number.isFinite(n) && Math.round(n) >= 1) envMs = Math.round(n);
    else if (!navEnvWarned) {
      navEnvWarned = true;
      console.error(`[live-session] ${NAV_TIMEOUT_ENV}=${raw} is not a positive number of ms — ignored`);
    }
  }
  let p95 = null;
  if (crawlLog) {
    try { p95 = JSON.parse(readFileSync(crawlLog, 'utf8')).crawl.navMs.p95; } catch { /* no crawl figure */ }
  }
  const crawlMs = Number.isFinite(p95) && p95 > 0 ? Math.round(p95 * 2) : null;
  const range = `${NAV_TIMEOUT_MIN_MS}–${NAV_TIMEOUT_MAX_MS} ms`;
  if (envMs == null && crawlMs == null) {
    const envNote = raw ? `no valid ${NAV_TIMEOUT_ENV} (${raw} ignored)` : `no ${NAV_TIMEOUT_ENV}`;
    return { ms: fallback, source: 'default', detail: `${envNote} and no crawl.navMs.p95 in ${crawlLog || '(no crawl log)'}` };
  }
  if (envMs == null) {
    const ms = Math.min(NAV_TIMEOUT_MAX_MS, Math.max(NAV_TIMEOUT_MIN_MS, crawlMs));
    return { ms, source: 'crawl', detail: `crawl.navMs.p95 ${p95} ms × 2, clamped to ${range} (${crawlLog})` };
  }
  const max = Math.max(envMs, crawlMs ?? 0);
  const ms = Math.min(NAV_TIMEOUT_MAX_MS, Math.max(NAV_TIMEOUT_MIN_MS, max));
  const clampNote = ms !== max ? `, clamped to ${range}` : '';
  if (crawlMs == null) {
    return { ms, source: 'env', detail: `${NAV_TIMEOUT_ENV}=${raw}${clampNote} (no crawl.navMs.p95 in ${crawlLog || '(no crawl log)'})` };
  }
  const detail = `max(${NAV_TIMEOUT_ENV}=${raw}, crawl.navMs.p95 ${p95} ms × 2 = ${crawlMs} in ${crawlLog}) = ${max} ms${clampNote ? `${clampNote} → ${ms} ms` : ''}`;
  return { ms, source: envMs >= crawlMs ? 'env' : 'crawl', detail };
}

/** navTimeout(opts).ms — the default every navigation helper takes when its caller passes no timeout. */
export function resolveNavTimeoutMs(opts = {}) {
  return navTimeout(opts).ms;
}

// ---- per-width deadlines: a navigation timeout bounds the goto, not the reads after it --------------
// The recorded 900 s hangs were in the reads after the goto (one page reused across widths on a site that
// navigates after load). Instruments race each width's whole read against a deadline and retry only a
// destroyed context (isContextDestroyed), once, on a fresh page.

// node fires a setTimeout longer than 2^31 − 1 ms after 1 ms: an explicit flag that large would fail every read at once
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
 *   - entry status < 400 (any host), after the settle: a DENIAL page
 *     (pageDenial / denialMarker — a vendor signature, or a page under 2 KB
 *     of text under one error heading) gets the same `solveWindow` treatment
 *     (each reload settled like the entry; a reload answered by an edge
 *     challenge or a >= 400, or one the probe cannot read, does not clear it),
 *     then THROWS BotChallengeError, marker `HTTP <status> denial page — …`,
 *     message "origin blocked" + the --headed escalation. Each probe read
 *     races DENIAL_PROBE_MS (a wedged renderer never answers it), so the
 *     navigation stays bounded; a probe that fails twice (an error or the
 *     deadline) is one stderr line ("denial-page check skipped"), never a pass.
 * `timeoutMs` (goto and each reload) defaults to resolveNavTimeoutMs() per call —
 * max(env, the crawl's p95 × 2) clamped to 20000–180000, else 60000.
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
  if (marker) throw botChallengeError(url, marker);
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
  // a 2xx denial page (vendor wall): read after the settle; the same solve window as the header path
  if (status < 400) {
    let d = await pageDenial(page);
    for (let attempt = 0; solveWindow && attempt < 3 && d.marker; attempt += 1) {
      await page.waitForTimeout(4000);
      const reloaded = await page.reload({ waitUntil, timeout: timeoutMs }).catch(() => null);
      if (reloaded) resp = reloaded;
      if (settleMs > 0) await page.waitForTimeout(settleMs); // the reloaded page is read (and returned) settled, like the entry
      // a reload answered by an edge challenge or an error status has not cleared the denial page
      if (!challengeMarker(resp) && resp.status() < 400) {
        const next = await pageDenial(page);
        // nor has one the probe cannot read: only a verdict replaces the confirmed denial (fail closed)
        if (next.skipped) console.error(`[live-session] denial-page check skipped at ${url}: ${next.skipped}`);
        else d = next;
      }
    }
    if (d.skipped) console.error(`[live-session] denial-page check skipped at ${url}: ${d.skipped}`);
    if (d.marker) throw botChallengeError(url, `HTTP ${status} ${d.marker}`, { denial: true });
  }
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
 * full Chromium build (`channel: 'chromium'`) is launched instead, else the
 * bundled default build, with the same stealth args and a loud stderr warning
 * naming the build that ran (the instrument is then the lesser tier — say so
 * in the log). Tags `stardustTier` (browserTier) and `stardustBuild`
 * (browserBuild: 'chrome', else 'chromium', else 'chromium-headless-shell'
 * unless the window is visible).
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
    b.stardustBuild = 'chrome';
    return b;
  } catch (e) {
    const { channel, ...rest } = opts;
    let b = null; let build = 'chromium';
    try { b = await chromium.launch({ ...rest, channel: 'chromium' }); } catch { /* the full build is not installed — no channel below */ }
    if (!b) {
      b = await chromium.launch(rest);
      build = visible ? 'chromium' : 'chromium-headless-shell';
    }
    const ran = build === 'chromium' ? 'the full Chromium build' : 'the Chromium headless shell';
    console.error(`[live-session] WARNING: real Chrome (channel: chrome) failed to launch (${String(e.message).split('\n')[0]}) — falling back to ${ran} with the stealth args; bot-managed origins may still block this tier`);
    b.stardustTier = 'chromium-fallback';
    b.stardustBuild = build;
    return b;
  }
}
/** The tier a browser from launchStealthHeaded / chromium.launch actually runs: 'chrome' | 'chrome-window' |
 * 'chromium-fallback' (Chrome elected, not installed) | 'chromium' (elected). Every probe records it in its
 * evidence so a run that degraded is visible in the artifact, not only in a log line. */
export const browserTier = (b) => b.stardustTier || 'chromium';

/** The build a browser runs, as this module tagged it at launch: 'chrome' (real Chrome) | 'chromium' (the full
 * Chromium build — `channel: 'chromium'`, or a headed bundled launch) | 'chromium-headless-shell' | 'unknown' (a
 * browser this module did not launch). hintRecord names it in a capture record. */
export const browserBuild = (b) => (b && b.stardustBuild) || 'unknown';

let shellWarned = false; // one warning per process, not one per launch

/**
 * chromium.launch preferring the full Chromium build (`channel: 'chromium'`) — the closer match to a real Chrome (the
 * headless shell's own client hints name a "HeadlessChrome" brand; the escape hatch 'native' sends those). Not
 * installed → `chromium.launch(launchOpts)` (the headless shell unless `headless: false`) with ONE stderr line per
 * process; newLiveContext's UA metadata still applies. Tags stardustTier 'chromium' and stardustBuild (browserBuild).
 * Takes the caller's `chromium` so this module stays import-free.
 */
export async function launchChromium(chromium, launchOpts = {}) {
  try {
    const b = await chromium.launch({ ...launchOpts, channel: 'chromium' });
    b.stardustTier = 'chromium';
    b.stardustBuild = 'chromium';
    return b;
  } catch (e) {
    if (!shellWarned) {
      shellWarned = true;
      console.error(`[live-session] the full Chromium build is not installed (channel chromium: ${String(e.message).split('\n')[0]}) — the headless shell runs; the UA client-hint metadata still applies (npx playwright install chromium)`);
    }
    const b = await chromium.launch(launchOpts);
    b.stardustTier = 'chromium';
    b.stardustBuild = launchOpts.headless === false ? 'chromium' : 'chromium-headless-shell';
    return b;
  }
}

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

// ---- dialogs: the third overlay class (V1) ------------------------------------------------------------
// The marketing pass above clicks only a close control it recognises inside a modal-like root. An open dialog it
// cannot close — a native <dialog>, a close button labelled in another language, a panel only Escape dismisses —
// captures as part of the page, and the scroll lock it set on html/body outlives it. closeDialogs closes them
// generically; dismissOverlays then releases the lock a CLOSED dialog leaves (dialogPass below says when, and why
// overflow-y visible; a hidden overflow-x becomes clip).
export const NATIVE_DIALOG = 'dialog[open]';
// Non-native modals. `[class*="modal"][class*="open"]` also matches a `body.modal-open` scroll-lock class and an
// in-content `.modal-opener` button — neither is a modal: closeDialogs acts only on an overlayLikeInPage match.
export const MODAL_DIALOGS = Object.freeze(['[role="dialog"][aria-modal="true"]', '.modal.show', '[class*="modal"][class*="open"]']);
// A dialog's close control, in order — the first selector with a VISIBLE match inside the dialog is clicked.
export const DIALOG_CLOSE_CANDIDATES = Object.freeze(['[aria-label*="close" i]', '[aria-label*="schließen" i]', '[data-dismiss]', 'button.close', '.modal__close', '[class*="close"]']);

// In-page helpers (self-contained: playwright serialises them into the page).
/* eslint-disable no-undef */
/** The element's record name: `<tag>` + `#id` (CSS.escape), else + its first two classes (`.a.b`), else the tag. */
export function describeElementInPage(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${CSS.escape(el.id)}`;
  return tag + [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
}
/**
 * Is `el` an overlay? Not html/body; displayed (display, visibility, a ≥ 2×2 box); in a positioned layer (itself or
 * an ancestor below body — across open shadow roots — is position fixed / absolute / sticky, or role=dialog /
 * aria-modal=true); and its box measures ≥ 5 % of the viewport's area or ≥ 50 % of its width.
 */
export function overlayLikeInPage(el) {
  if (!el || el === document.documentElement || el === document.body) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return false;
  let layered = false;
  for (let n = el; n && n !== document.body && n !== document.documentElement;
    n = n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null)) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky' || n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true') { layered = true; break; }
  }
  const vw = window.innerWidth; const vh = window.innerHeight;
  return layered && (r.width * r.height >= 0.05 * vw * vh || r.width >= 0.5 * vw);
}
/** The scroll lock: { html, body, locked } — the computed overflow-y of each (body null when absent); locked = either is hidden or clip. */
export function scrollLockInPage() {
  const oy = (el) => (el ? getComputedStyle(el).overflowY : null);
  const html = oy(document.documentElement); const body = oy(document.body);
  return { html, body, locked: [html, body].some((v) => v === 'hidden' || v === 'clip') };
}
/**
 * Release the scroll lock: overflow-y visible; a hidden overflow-x becomes clip — inline + !important (it outranks
 * the page's stylesheet), on each of html and body whose computed overflow-y is hidden or clip. Why clip: under the
 * recorded `overflow: hidden` shorthand a kept `overflow-x: hidden` makes the visible overflow-y COMPUTE to auto, so
 * body turns into a 100%-height inner scroller and the window still never scrolls; clip still hides horizontal
 * overflow (R2: a site's `overflow-x: hidden` never turns into exposed overflow) but makes no scroll container. An
 * overflow-x of auto / scroll is left alone (such a lock still stalls loudly). Returns the names released
 * (`['html', 'body']` subset, in that order).
 */
export function releaseScrollLockInPage() {
  const released = [];
  for (const [name, el] of [['html', document.documentElement], ['body', document.body]]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    const v = cs.overflowY;
    if (v === 'hidden' || v === 'clip') {
      const clipX = cs.overflowX === 'hidden';
      el.style.setProperty('overflow-y', 'visible', 'important');
      if (clipX) el.style.setProperty('overflow-x', 'clip', 'important');
      released.push(name);
    }
  }
  return released;
}
/* eslint-enable no-undef */

/**
 * Close the open dialogs → { closed: [...], left: [...] }: `<name> (close())`, `<name> (close control <selector>)`
 * or `<name> (Escape)` per dialog closed; the names of those still visible, de-duplicated (name =
 * describeElementInPage).
 *   - native: every visible `dialog[open]`: el.close(), 300 ms; still visible (page CSS keeps a closed dialog
 *     displayed) → the first DIALOG_CLOSE_CANDIDATES selector with a visible match inside it is clicked, 500 ms;
 *     still visible → Escape, 500 ms.
 *   - non-native: per MODAL_DIALOGS selector, every match that is visible AND overlayLikeInPage: the same close
 *     control → Escape sequence (a div has no close()).
 * Each selector's matches are a SNAPSHOT — element handles from the locator, which pierce open shadow roots as the
 * locator does: closing a dialog drops it from `dialog[open]` / its `show` / `open` class, so a lazy nth(i) would
 * skip the next match and lose the dialog close() left visible. ≤ 25 per selector; an element handled once is not
 * retried by a later selector; a match no longer visible is skipped; every step is per-element try/catch (a
 * detached element is skipped, never a throw out of the pass). A dialog the click / Escape detached counts closed.
 */
export async function closeDialogs(page) {
  const closed = []; const left = []; const handled = []; const held = [];
  const visible = (h) => h.isVisible().catch(() => false);
  const settle = (ms) => page.waitForTimeout(ms).catch(() => {});
  const snapshot = async (sel) => {
    const all = await page.locator(sel).elementHandles().catch(() => []);
    held.push(...all);
    return all.slice(0, 25);
  };
  // the close control → Escape tail both kinds share
  const closeOrEscape = async (h, name) => {
    for (const sel of DIALOG_CLOSE_CANDIDATES) {
      const ctl = await h.$(`${sel} >> visible=true`).catch(() => null);
      if (!ctl) continue;
      held.push(ctl);
      await ctl.click({ timeout: 3000 }).catch(() => {}); // not clickable → Escape below
      await settle(500);
      if (!(await visible(h))) { closed.push(`${name} (close control ${sel})`); return; }
      break;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await settle(500);
    if (!(await visible(h))) closed.push(`${name} (Escape)`);
    else if (!left.includes(name)) left.push(name);
  };
  try {
    for (const h of await snapshot(NATIVE_DIALOG)) {
      try {
        if (!(await visible(h))) continue;
        const name = await h.evaluate(describeElementInPage);
        handled.push(h);
        await h.evaluate((el) => el.close());
        await settle(300);
        if (!(await visible(h))) closed.push(`${name} (close())`);
        else await closeOrEscape(h, name);
      } catch { /* detached mid-pass — skipped */ }
    }
    for (const sel of MODAL_DIALOGS) {
      const hs = await snapshot(sel);
      const done = hs.length && handled.length
        ? await page.evaluate(([cands, seen]) => cands.map((c) => seen.includes(c)), [hs, handled]).catch(() => [])
        : [];
      for (let i = 0; i < hs.length; i += 1) {
        if (done[i]) continue;
        try {
          if (!(await visible(hs[i])) || !(await hs[i].evaluate(overlayLikeInPage))) continue;
          const name = await hs[i].evaluate(describeElementInPage);
          handled.push(hs[i]);
          await closeOrEscape(hs[i], name);
        } catch { /* detached mid-pass — skipped */ }
      }
    }
  } finally {
    await Promise.all(held.map((h) => h.dispose().catch(() => {})));
  }
  return { closed, left };
}

// The visible dialogs open NOW → their names (describeElementInPage), de-duplicated in selector order: per
// NATIVE_DIALOG and MODAL_DIALOGS selector, the first 25 matches that are visible — and, for a non-native one,
// overlayLikeInPage (closeDialogs' own test). A fresh read, not closeDialogs' snapshots: a dialog a close opened (a
// second step) or remounted (a re-render) after its selector's snapshot, or a native dialog opened during the modal
// pass, is in none of them. Never throws; every handle is disposed.
async function openDialogNames(page) {
  const names = [];
  for (const sel of [NATIVE_DIALOG, ...MODAL_DIALOGS]) {
    const hs = await page.locator(sel).elementHandles().catch(() => []);
    try {
      for (const h of hs.slice(0, 25)) {
        try {
          if (!(await h.isVisible())) continue;
          if (sel !== NATIVE_DIALOG && !(await h.evaluate(overlayLikeInPage))) continue;
          const name = await h.evaluate(describeElementInPage);
          if (!names.includes(name)) names.push(name);
        } catch { /* detached under the read — not open */ }
      }
    } finally {
      await Promise.all(hs.map((h) => h.dispose().catch(() => {})));
    }
  }
  return names;
}

// dismissOverlays' dialog pass: closeDialogs, then the scroll lock the closed dialogs leave. R1 — released only when
// THIS pass closed at least one dialog AND none survives — re-read after the pass (openDialogNames), so a dialog a
// close opened or remounted counts: a lock with no closed dialog is the page's own layout (an inner scroller /
// scroll-jacking — stitch-shot's scroll-stall guard stays loud), and a lock with a surviving dialog stays too (nothing
// else names the survivor: a released lock would turn a loud stall into a silently polluted capture; dialogsLeft names
// it). R2 — overflow-y visible; a hidden overflow-x becomes clip (releaseScrollLockInPage).
async function dialogPass(page) {
  const { closed: dialogs, left: dialogsLeft } = await closeDialogs(page);
  let scrollLockReleased = false;
  if (dialogs.length > 0 && dialogsLeft.length === 0) {
    await page.waitForTimeout(300).catch(() => {}); // a close handler that unlocks on a transition end gets its turn
    for (const name of await openDialogNames(page)) if (!dialogsLeft.includes(name)) dialogsLeft.push(name);
    if (dialogsLeft.length === 0) {
      const lock = await page.evaluate(scrollLockInPage).catch(() => null);
      if (lock && lock.locked) scrollLockReleased = (await page.evaluate(releaseScrollLockInPage).catch(() => [])).length > 0;
    }
  }
  return { dialogs, dialogsLeft, scrollLockReleased };
}

/**
 * Dismiss the three overlay classes that corrupt live measurement:
 *   (a) cookie consent — clicked (never removed), first candidate wins;
 *   (b) timed marketing/newsletter interstitials (CH-1) — every modal-like
 *       container with a VISIBLE close control gets it clicked, verified
 *       gone. Because these fire on a TIMER (recorded: a fashion retailer's panel
 *       appears ~5–9s after load), the sweep polls for late arrivals for up
 *       to `lateWindowMs` (default 6000) when nothing was dismissed yet.
 *       Callers pass `lateWindowFor(url, …)`: 0 on local targets and on EDS build/preview hosts, which get one
 *       sweep (stitch-shot runs it after waitEdsDelayedPhase, so a consent manager the build enables is up).
 *   (c) dialogs, after (b) (closeDialogs) — every visible native `dialog[open]` gets close(), then its close control,
 *       then Escape; a visible overlay-like non-native modal (MODAL_DIALOGS) its close control, then Escape. The
 *       html/body scroll lock left afterwards is released for the capture (overflow-y visible; a hidden overflow-x
 *       becomes clip — R2) ONLY when this pass closed a dialog and none survives — re-read after the pass, so a dialog
 *       a close opened or remounted counts (R1): a lock without a closed dialog is the page's own layout, and a lock
 *       over a survivor stays loud (dialogsLeft names the survivor).
 * `extra` selectors are site-specific dismissers, clicked first (each once).
 * Parks the mouse afterwards (bottom-left — dead space on virtually every
 * layout) so no :hover-styled element under the cursor captures hovered.
 * Returns { extra: [...], consent: <sel|null>, marketing: [...], dialogs: [...], dialogsLeft: [...],
 * scrollLockReleased: <bool> } — dialogs / dialogsLeft as closeDialogs' closed / left strings (dialogsLeft plus the
 * re-read's survivors, dialogPass).
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

  // (c) dialogs, and the scroll lock a closed dialog leaves
  Object.assign(dismissed, await dialogPass(page));

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
