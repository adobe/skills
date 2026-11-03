/**
 * skills/diff/scripts/live-session.mjs
 *
 * The single home for "hit a live site to measure it, as robustly as the
 * capture engine". Every live-side navigation in the gate instruments
 * (content-diff, visual-diff, replica's stitch-shot, measure-live's probes)
 * goes through here, so capture-hardening and gate-hardening are the SAME
 * surface — a field finding was that they weren't: the crawler cleared the
 * edge while headless gate instruments were served "Access Denied" and would
 * have silently measured it as the source.
 *
 * THE IDENTITY RULE — every context presents the running browser's own user
 * agent with the headless token removed, or the caller's override. Real Chrome
 * presents matching client hints; a bundled Chromium's own hints ride.
 * The existing automation-signal handling stays on unless STARDUST_STEALTH=0.
 *   - Default tier (launchLiveBrowser): real Chrome headless (`channel:
 *     'chrome'`) — its own user agent without the headless token, its own
 *     client hints, its own identity; bundled Chromium only when Chrome is not
 *     installed (tier 'chromium-fallback', one stderr line). Every context gets
 *     the existing navigator.webdriver spoof unless STARDUST_STEALTH=0.
 *   - The sec-ch-ua* client hints are derived from the browser's real version
 *     and running OS (or from the caller's UA string). A bundled Chromium's
 *     own hints ride untouched — it is not Chrome and the headers must not say so.
 *   - The STANDARD request headers (Accept, Accept-Language,
 *     Upgrade-Insecure-Requests) ride on DOCUMENT requests only (F-R1: a bot
 *     manager fingerprints their absence; F-B2: on every request they make
 *     cross-origin font fetches non-simple → silent fallback type).
 *   - --headed (launchStealthHeaded) is the same real Chrome, window-free, plus
 *     the challenge-solve window (gotoLive `solveWindow`) and the existing
 *     launch flags. STARDUST_STEALTH=0 disables the flags and spoof with one
 *     stderr line; STARDUST_HEADED_WINDOW=1 opens a window.
 *
 * Fail-loud contract: a challenge / edge block (header signature, CloudFront /
 * AWS WAF included) or a 2xx DENIAL page (pageDenial / denialMarker own the
 * rule) throws BotChallengeError — never measured as the source. Overlays:
 * consent clicked (never DOM-removed), timed marketing modals closed, the mouse
 * parked. `--locale` pins Accept-Language + context locale for geo determinism.
 *
 * PACING (paceLiveNavigation, inside gotoLive): live navigations to one host
 * are spaced STARDUST_LIVE_PACE_MS apart (default 2000; 0 disables) within the
 * process — an Akamai-fronted origin answered 403 to back-to-back navigations
 * and to parallel browsers, 200 once they were spaced. Process-local by design;
 * the first wait per host is one stderr line.
 * The escalation ladder is documented in replica/reference/source-fidelity-gate.md.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev-tool library: sequential page ops use awaited loops by design */
import { existsSync, readFileSync } from 'node:fs';

// ---- pacing: live navigations to one host, spaced ------------------------------------------------------------------
export const LIVE_PACE_MS_DEFAULT = 2000;
/** STARDUST_LIVE_PACE_MS as a non-negative integer; unset, empty or unparsable → the default (2000); 0 disables. */
export function livePaceMs(env = process.env) {
  const raw = env.STARDUST_LIVE_PACE_MS;
  if (raw === undefined || String(raw).trim() === '') return LIVE_PACE_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : LIVE_PACE_MS_DEFAULT;
}
/**
 * Pure: the slot a navigation takes given the host's next free time (`nextFree`, ms epoch, undefined for a host never
 * navigated), `now` and the pace → { wait, nextFree }: wait = how long to hold before navigating (0 when the host is
 * free), nextFree = when the host is free again. A pace of 0 (or less, or not a number) never waits.
 */
export function paceSlot(nextFree, now, paceMs) {
  if (!(Number.isFinite(paceMs) && paceMs > 0)) return { wait: 0, nextFree: now };
  const at = Math.max(now, Number.isFinite(nextFree) ? nextFree : 0);
  return { wait: at - now, nextFree: at + paceMs };
}
const nextFreeByHost = new Map(); // host → ms epoch when the next live navigation may start
const pacedHosts = new Set(); // hosts whose first wait has been logged
/**
 * Hold `page` until the host of `url` is free, then take the next slot (reserved synchronously, so concurrent
 * callers in one process queue up instead of sharing a slot). Live URLs only (isLiveHttpUrl — localhost and loopback
 * are never paced). Returns the ms waited. Every instrument's live goto goes through here (gotoLive; the crawler
 * calls it before its own gotos).
 */
export async function paceLiveNavigation(page, url, { paceMs = livePaceMs(), now = Date.now } = {}) {
  if (!isLiveHttpUrl(url) || !(paceMs > 0)) return 0;
  const { host } = new URL(url);
  const { wait, nextFree } = paceSlot(nextFreeByHost.get(host), now(), paceMs);
  nextFreeByHost.set(host, nextFree);
  if (wait > 0) {
    if (!pacedHosts.has(host)) {
      pacedHosts.add(host);
      console.error(`[live-session] pacing live navigations to ${host} ${paceMs} ms apart (STARDUST_LIVE_PACE_MS; 0 disables) — first wait ${wait} ms`);
    }
    await page.waitForTimeout(wait);
  }
  return wait;
}
/** Forget every host's slot (tests). */
export function resetLivePacing() { nextFreeByHost.clear(); pacedHosts.clear(); }

// ---- identity: what the browser is, said once, derived never invented ----------------------------------------------
/** Whether the existing automation-signal handling is active; only STARDUST_STEALTH=0 disables it. */
export const stealthEnabled = () => process.env.STARDUST_STEALTH !== '0';
let stealthDisabledReported = false;
function reportStealthDisabled() {
  if (!stealthDisabledReported) {
    stealthDisabledReported = true;
    console.error('[live-session] STARDUST_STEALTH=0: automation-signal handling is OFF for this process');
  }
}

/** process.platform → the sec-ch-ua-platform label: darwin → macOS, win32 → Windows, anything else → Linux. */
export function platformLabel(platform = process.platform) {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  return 'Linux';
}

/** The Chrome/Chromium major of a version string ('156.0.8078.74' → '156') or of a UA ('… Chrome/156.0.0.0 …'); null when absent. */
export function chromeMajor(s) {
  const m = String(s ?? '').match(/(?:Chrome|Chromium|CriOS|HeadlessChrome)\/(\d+)/) || String(s ?? '').match(/^(\d+)\.\d+/);
  return m ? m[1] : null;
}

/** The running browser's user agent without the headless token, cached once per browser. */
export async function browserUserAgent(browser) {
  if (Object.hasOwn(browser, 'stardustUserAgent')) return browser.stardustUserAgent;
  const pending = (async () => {
    let resolved = null;
    if (typeof browser.newBrowserCDPSession === 'function') {
      try {
        const cdp = await browser.newBrowserCDPSession();
        let userAgent;
        try {
          ({ userAgent } = await cdp.send('Browser.getVersion'));
        } finally {
          await cdp.detach();
        }
        if (typeof userAgent === 'string') resolved = userAgent.replace(/\bHeadlessChrome\//, 'Chrome/');
      } catch { /* browser.version() fallback below */ }
    }
    if (!resolved) {
      let major = null;
      try {
        major = chromeMajor(typeof browser.version === 'function' ? browser.version() : '');
      } catch { /* no readable browser version */ }
      if (major) {
        const token = process.platform === 'darwin'
          ? 'Macintosh; Intel Mac OS X 10_15_7'
          : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
        resolved = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
      }
    }
    return resolved;
  })();
  browser.stardustUserAgent = pending;
  const resolved = await pending;
  browser.stardustUserAgent = resolved;
  return resolved;
}

/**
 * The identity the context's document headers state, or null for "the browser's own hints ride untouched".
 * Without a caller UA: the real-Chrome tiers ('chrome' / 'chrome-window') → { major: browser.version()'s major,
 * platform: the running OS, chrome: true } — exactly what the binary itself sends, so stating it is honest; any other
 * tier → null (a bundled Chromium announces its own brands, which this module must not rewrite into Chrome's).
 * With a caller UA: the major and platform read from the UA string, chrome = it names Chrome; a UA without a Chrome
 * token → null (nothing honest to derive).
 */
export function browserIdentity(browser, { ua = null, platform = process.platform } = {}) {
  if (ua) {
    const major = chromeMajor(ua);
    if (!major) return null;
    const p = /Windows/i.test(ua) ? 'win32' : /Macintosh|Mac OS X/i.test(ua) ? 'darwin' : /Linux|X11|Android/i.test(ua) ? 'linux' : platform;
    return { major, platform: platformLabel(p), chrome: /(?<!Headless)Chrome\//.test(ua) };
  }
  const tier = browserTier(browser);
  if (tier !== 'chrome' && tier !== 'chrome-window') return null;
  const major = chromeMajor(typeof browser.version === 'function' ? browser.version() : '');
  return major ? { major, platform: platformLabel(platform), chrome: true } : null;
}

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
  try {
    if (EDS_HOST_RE.test(new URL(url).hostname)) return 'networkidle';
  } catch { /* unparseable — fall through to the live default */ }
  return 'domcontentloaded';
}

/**
 * The standard header set every real Chrome sends on a navigation and a bare Playwright context can omit
 * (the bundled headless shell sends no Accept-Language at all). A UA alone is NOT sufficient against
 * Akamai-class bot management (F-R1); these headers are the other half. The sec-ch-ua* client hints are
 * stated ONLY from a given `identity` ({ major, platform, chrome } — browserIdentity); with none, the trio
 * is left out and the browser's own hints ride (newLiveContext merges over the request's headers).
 */
export function standardHeaders(locale = 'en', identity = null) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': acceptLanguage(locale),
    'Upgrade-Insecure-Requests': '1',
  };
  if (identity && identity.major) {
    const brands = [`"Chromium";v="${identity.major}"`, '"Not:A-Brand";v="8"'];
    if (identity.chrome) brands.push(`"Google Chrome";v="${identity.major}"`);
    headers['sec-ch-ua'] = brands.join(', ');
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = `"${identity.platform || platformLabel()}"`;
  }
  return headers;
}

/**
 * Ready-to-spread options for browser.newContext(): the standard headers, userAgent ONLY when the caller passed one,
 * viewport, and navigator.language coherence when a locale is pinned. newLiveContext resolves the browser default
 * before calling this helper. Callers add their own instrument-specific options (reducedMotion etc.).
 * NOTE: newLiveContext strips extraHTTPHeaders back out and delivers the header set per-request instead
 * (document requests only — F-B2 below); spreading these options raw would re-introduce the font-fork trap.
 */
export function contextOptions({ ua, locale, viewport, identity = null } = {}) {
  const opts = { extraHTTPHeaders: standardHeaders(locale || 'en', identity) };
  if (ua) opts.userAgent = ua;
  if (locale) opts.locale = locale === 'en' ? 'en-US' : locale;
  if (viewport) opts.viewport = viewport;
  return opts;
}

/**
 * newContext + contextOptions, resolving userAgent to the caller's `ua` or the cached browserUserAgent. Header identity
 * still receives the caller's `ua`: real-Chrome tiers state their version and OS, while bundled Chromium hints ride.
 * The existing navigator.webdriver spoof lands on every context unless STARDUST_STEALTH=0. Extra Playwright context
 * options pass through (reducedMotion, ...).
 */
export async function newLiveContext(browser, { ua, locale, viewport, authOrigin, authHeader, ...rest } = {}) {
  // F-B2 (financial-services site, 2026-08-25): the standard header set must ride on
  // DOCUMENT requests only. Forcing it via extraHTTPHeaders on every request
  // makes cross-origin CORS-mode subresource fetches (Typekit/webfont CDNs)
  // non-simple; they die with net::ERR_FAILED and the live capture silently
  // renders FALLBACK type — an asymmetric false measurement (the prototype
  // side loads the same kit fine). Bot-manager fingerprinting happens on the
  // navigation request, which still carries the full set below.
  const resolvedUa = ua || await browserUserAgent(browser);
  const { extraHTTPHeaders, ...base } = contextOptions({ ua: resolvedUa, locale, viewport, identity: browserIdentity(browser, { ua }) });
  const ctx = await browser.newContext({ ...rest, ...base });
  await ctx.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.continue({ headers: { ...route.request().headers(), ...extraHTTPHeaders } });
    } else {
      route.continue();
    }
  });
  if (stealthEnabled()) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  } else reportStealthDisabled();
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
export function challengeMarker(resp) {
  if (!resp) return null;
  const status = resp.status();
  const h = resp.headers();
  // Cloudflare stamps this header specifically on managed/JS-challenge responses.
  if ((h['cf-mitigated'] || '').toLowerCase() === 'challenge') return 'cf-mitigated: challenge';
  // AWS WAF stamps its action (captcha / challenge) on the response it intercepts, whatever the status.
  if (h['x-amzn-waf-action']) return `HTTP ${status} + CloudFront/AWS WAF edge signature (x-amzn-waf-action: ${h['x-amzn-waf-action']})`;
  if (status === 403 || status === 429 || status === 503) {
    const server = (h.server || '').toLowerCase();
    if (h['cf-ray'] || server.includes('cloudflare')) return `HTTP ${status} + Cloudflare edge signature (cf-ray/server)`;
    if (h['x-akamai-transformed'] || server.includes('akamai') || server.includes('edgesuite')) return `HTTP ${status} + Akamai edge signature`;
    if (resp.url().includes('edgesuite.net')) return `HTTP ${status} + errors.edgesuite.net interstitial`;
    if (server.includes('big-ip') || server.includes('bigip') || server.includes('imperva') || h['x-iinfo']) return `HTTP ${status} + F5/Imperva edge signature`;
    // A CloudFront distribution answering 403 itself ("The request could not be satisfied. Request blocked.") is
    // the AWS WAF block after a burst of requests — recorded on a CloudFront-fronted site; the body pair is also
    // a denial signature below. A 403 the origin produced and CloudFront merely relayed carries the same two
    // headers, so the label names the edge, not a verdict on the origin.
    if (status === 403 && (server.includes('cloudfront') || (h['x-cache'] || '').toLowerCase().includes('error from cloudfront'))) return 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)';
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
// headless instrument with HTTP 200 and its denial text ("can't process your request … Incident Number",
// "Access Denied … Reference #", "System Down") — no header to classify, so the gate measured the denial
// page as the source. The page itself is classified instead: a vendor signature in the title / visible
// text / iframe srcs, or a tiny page whose only heading is an error. A single phrase counts only on a page
// under DENIAL_TEXT_MAX_BYTES of text (title, text or iframe src): a full page that mentions "press & hold the
// button", or an article titled "System Down", is no denial page; a pair ("Access Denied" + "Reference #") is
// specific enough anywhere.
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
  // CloudFront's own 403 body for an AWS WAF block (an origin's error page relayed by CloudFront reads differently)
  denialSignature('cloudfront-blocked', '"The request could not be satisfied" + "Request blocked"', ['the request could not be satisfied', 'request blocked']),
  denialSignature('just-a-moment', '"Just a moment…"', ['just a moment...']),
  // the openresty-style verification interstitial: served 200 to every client, reloads itself every few seconds
  denialSignature('one-moment', '"One moment, please…"', ['one moment, please']),
  denialSignature('request-verified', '"Please wait while your request is being verified"', ['please wait while your request is being verified']),
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
 * (`all.length >= 2`) matches when every element occurs in the title + text; a single phrase only when bytes <
 * DENIAL_TEXT_MAX_BYTES, in the title, the text or an iframe src (a title alone is no evidence on a full page).
 * First match → 'denial page — <label>'.
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
      : small && (has(title, sig.all[0]) || has(text, sig.all[0]) || frames.some((f) => has(f, sig.all[0])));
    if (hit) return `denial page — ${sig.label}`;
  }
  if (small && probe.headings.length === 1) {
    const heading = String(probe.headings[0] ?? '').replace(/\s+/g, ' ').trim();
    if (DENIAL_ERROR_HEADING.test(normalizeDenialText(heading))) return `denial page — ${probe.bytes} B of text under one error heading "${heading.slice(0, 80)}"`;
  }
  return null;
}

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
    ? `bot challenge at ${url}: ${marker} — origin blocked: the live side served a denial page, NOT the page; refusing to measure it as the source. Escalate with --headed (real Chrome with the challenge-solve window); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it unattended.`
    : `bot challenge at ${url}: ${marker} — the live side served an edge interstitial, NOT the page; `
      + 'refusing to measure it as the source. Escalate with --headed (real Chrome with the challenge-solve window); if that is '
      + "still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the "
      + 'gate cannot run against it unattended.');
  err.name = 'BotChallengeError';
  err.marker = marker;
  err.url = url;
  return err;
}

/**
 * Navigate + settle, with the full fail-loud contract:
 *   - challenge/blocked interstitial → per `solveWindow`:
 *       false (default tier): THROW BotChallengeError after the FIRST
 *         challenge-classified response, 1 hit total — a solve loop on the
 *         default tier just burns the documented ~3–4-request Akamai
 *         IP-block budget (source-fidelity-gate.md § Hit minimization)
 *         before the operator can escalate --headed.
 *       true (set it when the browser came from launchStealthHeaded): run
 *         the challenge-solve window first (wait + reload, 3 attempts —
 *         Cloudflare's non-interactive challenge sets its clearance cookie
 *         in that window when it clears at all), THEN throw if still
 *         challenged.
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
 *   - entry status < 400 on a live URL (isLiveHttpUrl — never localhost or
 *     loopback), after the settle: a DENIAL page (pageDenial /
 *     denialMarker) gets the same `solveWindow` treatment (each reload
 *     settled like the entry; a reload answered by an edge challenge or a
 *     >= 400, or one the probe cannot read, does not clear it), then THROWS
 *     BotChallengeError, marker `HTTP <status> denial page — …`, message
 *     "origin blocked" + the --headed escalation. Each probe read races
 *     DENIAL_PROBE_MS (a wedged renderer never answers it), so the navigation
 *     stays bounded; a probe that fails twice (an error or the deadline) is
 *     one stderr line ("denial-page check skipped"), never a pass.
 * Returns the response.
 */
export async function gotoLive(page, url, { waitUntil = 'domcontentloaded', timeoutMs = 60000, settleMs = 1200, httpError = 'throw', solveWindow = false } = {}) {
  await paceLiveNavigation(page, url);
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
  // a 2xx denial page (vendor wall): read after the settle; the same solve window as the header path. Live URLs
  // only — localhost and loopback serve no vendor wall, and a tiny build page under an error heading is the page.
  if (status < 400 && isLiveHttpUrl(url)) {
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

// The existing headed-tier launch flags strip the automation signals a managed challenge probes for.
// STARDUST_STEALTH=0 disables them together with the per-context navigator.webdriver spoof.
const STEALTH_LAUNCH = Object.freeze({ args: Object.freeze(['--disable-blink-features=AutomationControlled']), ignoreDefaultArgs: Object.freeze(['--enable-automation']) });

// Chrome first, bundled Chromium when Chrome is not installed. The binary is what clears TLS/H2-fingerprint blocks
// (#125: `channel:'chrome'` + headless gets HTTP 200 from Akamai where the bundled headless shell gets 400) — and it
// is the only browser whose identity is a normal Chrome's. Takes the caller's `chromium` so this module stays import-free.
async function launchChromeFirst(chromium, { visible = false, stealth = false } = {}) {
  const opts = { headless: !visible, channel: 'chrome', ...(stealth ? { args: [...STEALTH_LAUNCH.args], ignoreDefaultArgs: [...STEALTH_LAUNCH.ignoreDefaultArgs] } : {}) };
  try {
    const b = await chromium.launch(opts);
    b.stardustTier = visible ? 'chrome-window' : 'chrome';
    return b;
  } catch (e) {
    console.error(`[live-session] WARNING: real Chrome (channel: chrome) failed to launch (${String(e.message).split('\n')[0]}) — falling back to bundled Chromium (tier chromium-fallback); bot-managed origins may block this tier`);
    const { channel, ...rest } = opts;
    const b = await chromium.launch(rest);
    b.stardustTier = 'chromium-fallback';
    return b;
  }
}

/**
 * THE DEFAULT TIER of every live instrument: real Chrome, headless, presenting its user agent without the headless
 * token and matching client hints. Falls back to bundled Chromium with one stderr line when Chrome is not installed.
 * Tier tag (browserTier): 'chrome' | 'chromium-fallback'.
 */
export function launchLiveBrowser(chromium) {
  return launchChromeFirst(chromium);
}

/**
 * The --headed escalation tier: the same real Chrome, WINDOW-FREE by default (#125 — the window was never what
 * cleared a block, the binary was; visible windows blocked an operator's desktop under four parallel agents), plus
 * the challenge-solve window the callers enable with gotoLive `solveWindow`. A window is opt-in
 * (`STARDUST_HEADED_WINDOW=1`, for a challenge that genuinely needs a human). The existing launch flags stay on;
 * `STARDUST_STEALTH=0` disables them and the per-context navigator.webdriver spoof. Falls back like launchLiveBrowser.
 * Tier tag: 'chrome' | 'chrome-window' | 'chromium-fallback'.
 */
export function launchStealthHeaded(chromium) {
  const stealth = stealthEnabled();
  if (!stealth) reportStealthDisabled();
  return launchChromeFirst(chromium, { visible: process.env.STARDUST_HEADED_WINDOW === '1', stealth });
}
/** The tier a browser from launchLiveBrowser / launchStealthHeaded / chromium.launch actually runs: 'chrome' |
 * 'chrome-window' | 'chromium-fallback' (Chrome elected, not installed) | 'chromium' (elected). Every probe records
 * it in its evidence so a run that degraded is visible in the artifact, not only in a log line. */
export const browserTier = (b) => (b && b.stardustTier) || 'chromium';

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
  // the other common consent managers' accept-all controls, by vendor id/class:
  // CookieHub, Cookiebot (dialog v2, then v1), Didomi, Usercentrics, Osano,
  // Termly, TrustArc, Quantcast Choice, iubenda, Complianz, CookieYes
  '.ch2-allow-all-btn',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#didomi-notice-agree-button',
  '[data-testid="uc-accept-all-button"]',
  '.osano-cm-accept-all',
  '[data-tid="banner-accept"]',
  '#truste-consent-button',
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  '.iubenda-cs-accept-btn',
  '.cmplz-accept',
  '.cky-btn-accept',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  // an unlisted manager's "Allow all": the label must START the button text
  // (:has-text is a case-insensitive substring and would hit "Disallow all"),
  // and it sits before the bare "Accept", which also hits "Accept only necessary"
  'button:text-matches("^[^a-z]*allow all([^a-z]|$)", "i")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  '[data-testid*="accept"]',
];

/**
 * The consent pass every live instrument shares (dismissOverlays, crawl.mjs, dynamics settlePage).
 * Candidates in list order, each resolved to its first VISIBLE match (CMPs repeat the accept
 * class in a hidden preference panel); a click is credited only once that control is hidden or
 * detached, else the next candidate is tried (a second layer, a manager still initialising).
 * One union probe first, so a page with no consent control costs one round trip.
 * Returns the credited selector, or null.
 */
export async function acceptConsent(page, candidates = CONSENT_CANDIDATES) {
  if (!(await page.locator(candidates.join(', ')).locator('visible=true').count().catch(() => 0))) return null;
  for (const sel of candidates) {
    try {
      const loc = page.locator(sel).locator('visible=true').first();
      if (!(await loc.count())) continue;
      const btn = await loc.elementHandle({ timeout: 1000 });
      await btn.click({ timeout: 3000 });
      await btn.waitForElementState('hidden', { timeout: 3000 });
      await page.waitForTimeout(1500);
      return sel;
    } catch { /* candidate absent, or still showing after the click — try next */ }
  }
  return null;
}

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
 *   (a) cookie consent — clicked (never removed), acceptConsent above;
 *   (b) timed marketing/newsletter interstitials (CH-1) — every modal-like
 *       container with a VISIBLE close control gets it clicked, verified
 *       gone. Because these fire on a TIMER (recorded: a fashion retailer's panel
 *       appears ~5–9s after load), the sweep polls for late arrivals for up
 *       to `lateWindowMs` (default 6000) when nothing was dismissed yet.
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

  dismissed.consent = await acceptConsent(page);

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
