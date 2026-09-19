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
 *     at TIER 3 only (gotoLive `tier`/`solveWindow`): headless clearance
 *     never lands, and the loop's extra hits would spend the ~3–4-request
 *     Akamai block budget before the next tier gets its one hit;
 *   - real-Chrome stealth on tiers 2–3 (`--disable-blink-features=
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
 *     dismissOverlays inspects EVERY match of a selector and clicks the first
 *     visible one (the hidden-twin trap), falls back to an exact multilingual
 *     label (ACCEPT_LABELS / DECLINE_LABELS, light DOM + open shadow roots),
 *     sweeps child frames for survey invites, re-runs every pass inside ONE
 *     late-mount window, hides the persistent widgets no click removes
 *     (HIDE_DEFAULTS, `removeText`) with visibility:hidden on BOTH sides, and
 *     returns `consentPresent` when a consent container is still up — the
 *     capture instruments fail loud on it (stitch-shot exit 5) instead of
 *     baking the banner into every chunk (recorded: ~7 chunks, 11 projects).
 *   - `--locale` determinism: geo-redirecting sites (a car brand → /ch-de/,
 *     a fashion brand → /ww/) capture a different locale per run unless
 *     Accept-Language + context locale are pinned.
 *
 * Escalation ladder — the rule is extract/reference/playwright-recipe.md
 * § Bot-management fallback; this module and crawl.mjs enforce it, no script
 * launches a window on its own (`fetchTechnique` value in brackets):
 *   tier 1 [headless]                 bundled Chromium, headless — default
 *   tier 2 [chrome-headless]          real Chrome (channel 'chrome'), headless, stealth args
 *   tier 3 [chrome-headed-offscreen]  real Chrome headed, window parked off-screen;
 *                                     visible only under STARDUST_HEADED_WINDOW=1
 * Tiers 1–2 are 1-hit fail-loud (BotChallengeError.nextTier names the next
 * tier); only tier 3 runs the solve window. `--headed` = start at tier 2,
 * `--headed=window` = tier 3; the default start tier is the one recorded in
 * stardust/current/_crawl-log.json#discovery.fetchTechnique (resolveStartTier).
 * A tier-3 challenge means the gate must FAIL, not degrade.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev-tool library: sequential page ops use awaited loops by design */
import { existsSync, readFileSync } from 'node:fs';

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
  return null;
}

/** crawl.mjs semantics: is this response a bot-management challenge/block? */
export function isChallengeResponse(response) {
  return challengeMarker(response) !== null;
}

/**
 * Navigate + settle, with the full fail-loud contract:
 *   - challenge/blocked interstitial → per `tier` (the ladder tier the browser
 *     came from; `solveWindow` overrides the derived default `tier === 3`):
 *       tiers 1–2 (default): THROW BotChallengeError after the FIRST
 *         challenge-classified response, 1 hit total, `err.nextTier` = the
 *         tier to escalate to. Clearance only lands under a headed session
 *         (module docstring), so a headless solve loop just burns the
 *         documented ~3–4-request Akamai IP-block budget
 *         (source-fidelity-gate.md § Hit minimization).
 *       tier 3: run the challenge-solve window first (wait + reload, 3
 *         attempts — Cloudflare's non-interactive challenge sets its
 *         clearance cookie in that window under a headed session), THEN
 *         throw if still challenged (`err.nextTier === null`: interactive
 *         solve or allowlist territory).
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
export async function gotoLive(page, url, { waitUntil = 'domcontentloaded', timeoutMs = 60000, settleMs = 1200, httpError = 'throw', tier = 1, solveWindow = tier === 3 } = {}) {
  let resp = await page.goto(url, { waitUntil, timeout: timeoutMs });
  if (!resp) {
    const err = new Error(`no response navigating to ${url} — network-level failure or non-HTTP navigation`);
    err.name = 'LiveNavigationError';
    throw err;
  }
  // challenge-solve window (crawl.mjs clearChallenge semantics) — tier 3
  // only (solveWindow). Headless the clearance never lands, so the loop's
  // up-to-3 extra hits are pure spent block budget: fail loud on the first
  // challenge-classified response instead (1 hit) and name the next tier.
  if (solveWindow) {
    for (let attempt = 0; attempt < 3 && isChallengeResponse(resp); attempt += 1) {
      await page.waitForTimeout(4000);
      const reloaded = await page.reload({ waitUntil, timeout: timeoutMs }).catch(() => null);
      if (reloaded) resp = reloaded;
    }
  }
  const marker = challengeMarker(resp);
  if (marker) {
    const nextTier = tier < TIERS.length ? tier + 1 : null;
    const hint = nextTier
      ? `escalate to tier ${nextTier} (${TIERS[nextTier - 1]}${nextTier === 2 ? ': --headed' : ': --headed=window'})`
      : 'tier 3 is still challenged — the origin needs an interactive solve (STARDUST_HEADED_WINDOW=1) or an allowlist; the gate must fail, not degrade';
    const err = new Error(
      `bot challenge at ${url}: ${marker} — the live side served an edge interstitial, NOT the page; `
      + `refusing to measure it as the source (tier ${tier}, ${TIERS[tier - 1]}). ${hint}.`,
    );
    err.name = 'BotChallengeError';
    err.marker = marker;
    err.url = url;
    err.tier = tier;
    err.nextTier = nextTier;
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

// ---- bot-management escalation ladder (shared contract with extract/scripts/crawl.mjs) ----
// crawl.mjs carries a byte-identical copy of TIERS / STEALTH_ARGS / OFFSCREEN_ARGS /
// launchTier (it is copied alone into projects and cannot import this module);
// evals/lint/launch-ladder.mjs fails when the two drift.
//   1 headless                 bundled Chromium, headless (default)
//   2 chrome-headless          real Chrome (channel:'chrome'), headless, stealth args —
//                              clears TLS/H2/JA3 fingerprint blocks without any window
//   3 chrome-headed-offscreen  real Chrome headed, window parked off-screen — the only
//                              tier where a JS managed challenge can solve
// Tiers 1–2 are 1-hit fail-loud: a challenge escalates at once, no wait+reload
// solve window (it never clears headless and only burns the block budget). The
// tier-3 window is visible only under STARDUST_HEADED_WINDOW=1: a window popping
// over the operator's desk is the interrupt class this ladder exists to remove.
export const TIERS = ['headless', 'chrome-headless', 'chrome-headed-offscreen'];
export const LEGACY_TIER = { 'headed-chrome-stealth': 3 }; // pre-ladder fetchTechnique value
// Stealth: Cloudflare's managed challenge probes for automation signals —
// `--disable-blink-features=AutomationControlled` + dropping `--enable-automation`
// + the navigator.webdriver spoof (per context, newLiveContext) let it solve.
export const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];
// An off-screen window must stay `visible` to the renderer: occlusion
// backgrounding flips document.visibilityState to 'hidden', and some edges
// challenge hidden tabs they admit on-screen. These flags keep it visible.
export const OFFSCREEN_ARGS = ['--window-position=-32000,-32000', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
export function tierOf(technique) { return LEGACY_TIER[technique] || (TIERS.indexOf(technique) + 1) || 0; }
/** Launch the browser for one ladder tier. Takes the caller's `chromium` so this module stays import-free. */
export async function launchTier(chromium, tier) {
  if (tier <= 1) return chromium.launch({ headless: true });
  const stealth = { channel: 'chrome', args: STEALTH_ARGS, ignoreDefaultArgs: ['--enable-automation'] };
  if (tier === 2) return chromium.launch({ ...stealth, headless: true });
  const visible = process.env.STARDUST_HEADED_WINDOW === '1';
  return chromium.launch({ ...stealth, headless: false, args: visible ? STEALTH_ARGS : [...STEALTH_ARGS, ...OFFSCREEN_ARGS] });
}
/** `--headed` → tier 2, `--headed=window` / `--headed=offscreen` → tier 3, anything else → 0 (not a headed flag). */
export function parseHeadedFlag(arg) {
  if (arg === '--headed') return 2;
  if (arg === '--headed=window' || arg === '--headed=offscreen') return 3;
  if (typeof arg === 'string' && arg.startsWith('--headed=')) throw new Error(`unknown ${arg} — use --headed (tier 2, real Chrome headless) or --headed=window (tier 3, off-screen window)`);
  return 0;
}
/**
 * The tier an instrument starts at: max(flag tier, the tier extract recorded in
 * `_crawl-log.json#discovery.fetchTechnique`, 1). Every downstream live
 * instrument starts where the crawl cleared, so a site that needed real Chrome
 * is never re-probed headless (one spent hit per instrument per breakpoint).
 */
export function resolveStartTier(flagTier = 0, { logPath = process.env.STARDUST_CRAWL_LOG || 'stardust/current/_crawl-log.json' } = {}) {
  let recorded = 0;
  try { recorded = tierOf(JSON.parse(readFileSync(logPath, 'utf8')).discovery?.fetchTechnique); } catch { /* no crawl log — start at the flag tier */ }
  return Math.max(1, flagTier || 0, recorded);
}
/**
 * Run `probe(browser, tier)` climbing the ladder: a BotChallengeError at tiers
 * 1–2 closes the browser and relaunches one tier up (one hit per tier); any
 * other error, or a tier-3 challenge (`err.nextTier === null`), propagates.
 * Resolves { tier, technique, browser, result } with the browser still open —
 * the caller closes it. Single-launch instruments wrap their whole capture in
 * the probe (a challenge fires at navigation, before any output is written).
 */
export async function launchLadder(chromium, startTier, probe) {
  let tier = Math.max(1, startTier || 1);
  for (;;) {
    const browser = await launchTier(chromium, tier);
    if (tier === 3 && process.env.STARDUST_HEADED_WINDOW !== '1') console.error(`[live-session] tier 3 (${TIERS[2]}): Chrome window parked off-screen (STARDUST_HEADED_WINDOW=1 to show it)`);
    try {
      const result = await probe(browser, tier);
      return { tier, technique: TIERS[tier - 1], browser, result };
    } catch (err) {
      await browser.close().catch(() => {});
      if (err.name !== 'BotChallengeError' || !err.nextTier) throw err;
      console.error(`[live-session] ${err.marker || 'bot challenge'} at tier ${tier} (${TIERS[tier - 1]}) — escalating to tier ${err.nextTier} (${TIERS[err.nextTier - 1]})`);
      tier = err.nextTier;
    }
  }
}
/** Transitional alias: tier 3. Prefer launchTier(chromium, resolveStartTier(parseHeadedFlag(arg))). */
export async function launchStealthHeaded(chromium) { return launchTier(chromium, 3); }

// ---- overlay dismissal (consent + timed interstitials) ------------------------
// Consent-accept candidates (clicked, never DOM-removed, so consent-gated
// layout settles the way a real visit does) — stitch-shot's proven list.
// Every candidate iterates ALL its matches and clicks the first VISIBLE one:
// `.first()` grabbed a hidden twin inside a collapsed settings view and the
// visible button behind it was never clicked (recorded, two rounds at 87 %).
const CONSENT_CANDIDATES = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#didomi-notice-agree-button',
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  '[data-testid*="accept"]',
];
// Consent-REJECT candidates for `mode: 'deny'` (OneTrust / Usercentrics ids +
// the exact short labels; narrow matcher, overlay controls only). In deny mode
// the accept list above is NEVER tried — a deny-state capture that silently
// accepted (the dialog said "Accept", not "Accept all") certified a
// non-comparable reference in the field; callers fail loud on it instead.
const REJECT_CANDIDATES = [
  '#onetrust-reject-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#didomi-notice-disagree-button',
  '[data-testid="uc-deny-all-button"]',
  'button:has-text("Reject all")',
  'button:has-text("Reject All")',
  'button:has-text("Decline all")',
];

// Exact-label tables for the TEXT FALLBACK (B28-narrow: exact label ≤ 25
// chars after normalisation, `button | a | [role=button] | input[type=button|
// submit]`, inside a fixed/sticky/z ≥ 100 container, tried only after the
// selector lists matched nothing). One accept set and one decline set —
// D3 keeps `accept` the default reference state; `deny` uses the other set.
// en / de / fr / it / es / nl / nb / da / sv / pt / pl.
export const ACCEPT_LABELS = [
  'accept all', 'accept all cookies', 'allow all', 'allow all cookies', 'accept', 'i accept', 'accept cookies', 'agree', 'i agree', 'ok', 'got it', 'allow cookies', 'yes, i agree',
  'alle akzeptieren', 'akzeptieren', 'alle cookies akzeptieren', 'zustimmen', 'einverstanden', 'alles akzeptieren',
  'tout accepter', 'accepter tout', 'accepter', "j'accepte", 'accepter et fermer',
  'accetta tutto', 'accetta tutti', 'accetta', 'accetto',
  'aceptar todo', 'aceptar todas', 'aceptar', 'acepto',
  'alles accepteren', 'accepteren', 'akkoord', 'alle cookies accepteren',
  'godta alle', 'godta', 'aksepter alle', 'aksepter', 'tillat alle',
  'tillad alle', 'accepter alle', 'acceptér alle', 'accepter',
  'godkänn alla', 'acceptera alla', 'acceptera', 'godkänn', 'tillåt alla',
  'aceitar todos', 'aceitar tudo', 'aceitar',
  'zaakceptuj wszystkie', 'akceptuj wszystko', 'akceptuję', 'zgadzam się',
];
export const DECLINE_LABELS = [
  'reject all', 'decline all', 'reject', 'decline', 'refuse all', 'only necessary', 'necessary only', 'only essential', 'essential only', 'reject all cookies', 'continue without accepting', 'no thanks', 'no, thanks',
  'alle ablehnen', 'ablehnen', 'nur notwendige', 'nur erforderliche', 'nur notwendige cookies',
  'tout refuser', 'refuser', 'refuser tout', 'continuer sans accepter',
  'rifiuta tutto', 'rifiuta', 'rifiuta tutti', 'solo necessari',
  'rechazar todo', 'rechazar', 'rechazar todas', 'solo necesarias',
  'alles weigeren', 'weigeren', 'alleen noodzakelijk', 'alles afwijzen',
  'avvis alle', 'avvis', 'kun nødvendige',
  'afvis alle', 'afvis', 'kun nødvendige cookies',
  'neka alla', 'avböj alla', 'endast nödvändiga',
  'rejeitar todos', 'rejeitar', 'apenas necessários',
  'odrzuć wszystkie', 'odrzuć', 'tylko niezbędne',
];
// Close labels for timed interstitials and survey invites (also tried inside
// frames — a feedback-survey iframe with a dimming scrim was recorded).
const CLOSE_LABELS = ['close', 'no thanks', 'no, thanks', 'not now', 'maybe later', 'dismiss', 'skip', 'nein danke', 'non merci', 'no grazie', 'no, gracias', 'nee bedankt', 'nei takk', 'nej tak', 'nej tack', 'não, obrigado', 'nie, dziękuję', '×', '✕'];

// Persistent widgets that CANNOT be dismissed and paint a fixed control the
// build never has (CMP re-open launcher, accessibility trigger, feedback tab).
// Hidden with visibility:hidden !important AFTER the click passes, on BOTH
// sides (layout-neutral: a sticky in-flow bar removed from live only would
// manufacture a false diff — recorded). `hideDefaults: false` disables.
export const HIDE_DEFAULTS = [
  '#ot-sdk-btn-floating',
  '[id^="onetrust-"][class*="floating"]',
  '.acsb-trigger',
  '[class*="medallia" i]',
  '[id*="nuance" i]',
  '[aria-label*="feedback" i]',
];
// Consent containers for the fail-loud check (`consentPresent`): visible
// after the poll window means the page is NOT in the reference consent state.
const CONSENT_CONTAINERS = [
  '#onetrust-banner-sdk', '#onetrust-consent-sdk .otFlat', '#truste-consent-track', '#CybotCookiebotDialog', '#didomi-host .didomi-popup-container', '.qc-cmp2-container', '#usercentrics-root', '.cc-window',
  '[id*="consent" i][role="dialog"]', '[class*="consent" i][role="dialog"]', '[class*="cookie" i][class*="banner" i]', '[id*="cookie" i][id*="banner" i]', '[class*="cookie" i][class*="notice" i]', '[id*="cookie" i][role="dialog"]',
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

/** Label normalisation shared by the text fallback and its tests. */
export function normLabel(s) {
  return String(s || '').toLowerCase().replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!…»›→]+$/g, '').trim();
}

// In-page: find the first VISIBLE control whose exact label is in `labels`,
// scoped to an overlay container (fixed/sticky ancestor or z-index ≥ 100),
// searching light DOM + open shadow roots. Marks it with `data-stardust-hit`
// and returns { label, host } or null. Serialised into evaluate — self-contained.
function pageFindLabelled({ labels, marker, requireOverlay }) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!…»›→]+$/g, '').trim();
  const set = new Set(labels);
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; };
  const overlayScoped = (el) => {
    for (let n = el, d = 0; n && n !== document.body && d < 10; n = n.parentElement || (n.getRootNode() && n.getRootNode().host) || null, d += 1) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
      const z = Number(cs.zIndex); if (z >= 100) return true;
    }
    return false;
  };
  const controls = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
  const roots = [document];
  let n = 0;
  for (const el of document.querySelectorAll('*')) { if (el.shadowRoot) roots.push(el.shadowRoot); if ((n += 1) > 8000) break; }
  for (const root of roots) {
    for (const el of root.querySelectorAll(controls)) {
      const label = norm(el.tagName === 'INPUT' ? el.value : (el.getAttribute('aria-label') && !el.textContent.trim() ? el.getAttribute('aria-label') : el.textContent));
      if (!label || label.length > 25 || !set.has(label)) continue;
      if (!visible(el)) continue;
      if (requireOverlay && !overlayScoped(el)) continue;
      el.setAttribute(marker, '1');
      return { label, host: root === document ? null : (root.host.id ? `#${root.host.id}` : root.host.tagName.toLowerCase()) };
    }
  }
  return null;
}

// In-page: click an element inside an open shadow root by selector (Playwright
// locators pierce open shadow roots too; this is the fallback when the host is
// known — Usercentrics `#usercentrics-root`). Returns true when clicked.
function pageClickInShadow({ hostSel, sel }) {
  const host = document.querySelector(hostSel);
  const root = host && host.shadowRoot;
  const el = root && root.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  el.click();
  return true;
}

/**
 * MutationObserver hook for the capture loop: records NEW fixed / dialog
 * nodes mounted after the dismissal passes (a consent banner or survey that
 * mounts late gets baked into every chunk below its arrival — recorded
 * "baked into ~7 scroll chunks"). installOverlayWatch once after
 * dismissOverlays; readOverlayWatch per chunk returns and clears the list.
 */
export async function installOverlayWatch(page) {
  await page.evaluate(() => {
    if (window.__stardustOverlayWatch) return;
    const hits = [];
    window.__stardustOverlayWatch = hits;
    const isOverlay = (el) => { if (!(el instanceof Element)) return false; const cs = getComputedStyle(el); return cs.position === 'fixed' || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true'; };
    const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (isOverlay(n)) hits.push(desc(n));
        else for (const c of n.querySelectorAll('*')) if (isOverlay(c)) { hits.push(desc(c)); break; }
        if (hits.length > 50) return;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }).catch(() => {});
}
export async function readOverlayWatch(page) {
  return page.evaluate(() => { const h = window.__stardustOverlayWatch || []; const out = h.filter((d) => !/^(img|picture|source|svg|path|span|br|script|style|link|meta)/.test(d)); h.length = 0; return [...new Set(out)]; }).catch(() => []);
}

/**
 * Dismiss the two overlay classes that corrupt live measurement:
 *   (a) cookie consent — CLICKED (never removed): every candidate selector
 *       iterates ALL its matches and clicks the first VISIBLE one; when no
 *       selector matched, the exact-label text fallback runs (ACCEPT_LABELS /
 *       DECLINE_LABELS, light DOM + open shadow roots, overlay-scoped).
 *       `mode` selects WHICH control: 'accept' (default) clicks the accept
 *       list; 'deny' clicks `reject` (caller's selectors, first) then the
 *       built-in reject-all list and never touches the accept list. In deny
 *       mode `consentPresent && !rejected` means a dialog is up that could
 *       not be denied — the page is NOT in deny state; this function warns,
 *       the capture instruments refuse the capture (stitch-shot exit 5).
 *   (b) timed marketing/newsletter interstitials (CH-1) — every modal-like
 *       container with a VISIBLE close control gets it clicked, verified
 *       gone; survey invites inside FRAMES get their close/decline label
 *       clicked. Because these fire on a TIMER (recorded: ~5–9 s after load)
 *       — and consent banners mount late too (recorded: dismissal ran before
 *       the banner's JS) — the consent + extra + frames + modal passes all
 *       run INSIDE one poll window of `lateWindowMs` (default 6000): same
 *       wall-clock as before, one window for every overlay class.
 *   (c) persistent widgets that cannot be dismissed (HIDE_DEFAULTS, plus
 *       `removeText` phrases → the nearest fixed/sticky ancestor) are hidden
 *       with visibility:hidden !important AFTER the clicks — run on BOTH
 *       sides; `hideDefaults: false` disables the list, never the clicks.
 * `extra` selectors are site-specific dismissers, clicked first (each once).
 * Parks the mouse afterwards (bottom-left — dead space on virtually every
 * layout) so no :hover-styled element under the cursor captures hovered.
 * Returns { extra: [...], consent: <sel|null> (accept mode; 'text:<label>'
 * when the fallback clicked), rejected: <sel|null> (deny mode),
 * consentPresent: bool (a consent container is STILL visible after the
 * window), consentContainer: <desc|null>, marketing: [...], frames: [...],
 * hidden: [{ kind, sel, count }] }.
 */
export async function dismissOverlays(page, { extra = [], lateWindowMs = 6000, mode = 'accept', reject = [], hideDefaults = true, removeText = [] } = {}) {
  if (!['accept', 'deny'].includes(mode)) throw new Error(`dismissOverlays: mode must be accept or deny (got ${JSON.stringify(mode)})`);
  const dismissed = { extra: [], consent: null, rejected: null, consentPresent: false, consentContainer: null, marketing: [], frames: [], hidden: [] };
  const MARK = 'data-stardust-hit';

  // Click the first VISIBLE match of a selector — all matches are inspected,
  // not `.first()` (the hidden-twin trap). Returns true when a click landed.
  const clickVisible = async (sel, settleMs) => {
    try {
      const loc = page.locator(sel);
      const n = Math.min(await loc.count(), 12);
      for (let i = 0; i < n; i += 1) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(settleMs);
          return true;
        }
      }
    } catch { /* candidate absent / detached — try next */ }
    return false;
  };
  const clickFirstVisible = async (selectors, settleMs) => {
    for (const sel of selectors) if (await clickVisible(sel, settleMs)) return sel;
    return null;
  };
  // Exact-label fallback (B28-narrow), light DOM + open shadow roots.
  const clickLabelled = async (labels, settleMs) => {
    let hit = null;
    try { hit = await page.evaluate(pageFindLabelled, { labels, marker: MARK, requireOverlay: true }); } catch { return null; }
    if (!hit) return null;
    try {
      const loc = page.locator(`[${MARK}]`).first();
      if (await loc.count()) await loc.click({ timeout: 3000 });
      else await page.evaluate((m) => { const el = document.querySelector(`[${m}]`); if (el) el.click(); }, MARK);
    } catch {
      await page.evaluate((m) => { for (const el of document.querySelectorAll(`[${m}]`)) el.click(); }, MARK).catch(() => {});
    }
    await page.evaluate((m) => { for (const el of document.querySelectorAll(`[${m}]`)) el.removeAttribute(m); }, MARK).catch(() => {});
    await page.waitForTimeout(settleMs);
    return `text:${hit.label}${hit.host ? ` (shadow ${hit.host})` : ''}`;
  };
  // Known shadow-hosted CMP (Usercentrics): host + testid, before the generic walk.
  const clickShadowCmp = async (sel) => {
    try { if (await page.evaluate(pageClickInShadow, { hostSel: '#usercentrics-root', sel })) { await page.waitForTimeout(1500); return `#usercentrics-root >>> ${sel}`; } } catch { /* no host */ }
    return null;
  };

  const consentPass = async () => {
    if (mode === 'deny') {
      if (dismissed.rejected) return false;
      dismissed.rejected = await clickFirstVisible([...reject, ...REJECT_CANDIDATES], 1500)
        || await clickShadowCmp('[data-testid="uc-deny-all-button"]')
        || await clickLabelled(DECLINE_LABELS, 1500);
      return dismissed.rejected !== null;
    }
    if (dismissed.consent) return false;
    dismissed.consent = await clickFirstVisible(CONSENT_CANDIDATES, 1500)
      || await clickShadowCmp('[data-testid="uc-accept-all-button"]')
      || await clickLabelled(ACCEPT_LABELS, 1500);
    return dismissed.consent !== null;
  };
  const extraPass = async () => {
    let acted = false;
    for (const sel of extra) {
      if (dismissed.extra.includes(sel)) continue;
      if (await clickVisible(sel, 1000)) { dismissed.extra.push(sel); acted = true; }
    }
    return acted;
  };
  // Survey / feedback invites hosted in an iframe: click a close/decline label
  // inside every child frame (no navigation — the frame is already loaded).
  const framesPass = async () => {
    let acted = false;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      let hit = null;
      try { hit = await frame.evaluate(pageFindLabelled, { labels: [...CLOSE_LABELS, ...DECLINE_LABELS], marker: MARK, requireOverlay: false }); } catch { continue; }
      if (!hit) continue;
      try {
        await frame.evaluate((m) => { for (const el of document.querySelectorAll(`[${m}]`)) { el.click(); el.removeAttribute(m); } }, MARK);
        dismissed.frames.push(`frame:${(() => { try { return new URL(frame.url()).host || 'about:srcdoc'; } catch { return 'frame'; } })()} text:${hit.label}`);
        acted = true;
        await page.waitForTimeout(600);
      } catch { /* frame detached */ }
    }
    return acted;
  };

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

  // One window for every overlay class: the consent, extra, frames and modal
  // passes all run per iteration, so a banner that mounts at 3 s and a modal
  // that fires at 5–9 s are both caught inside the SAME lateWindowMs. The
  // loop ends when a modal was closed or the window closes — a page with no
  // interstitial burns the window once, the price of not baking a modal into
  // the capture (unchanged wall-clock from the single-class loop).
  const deadline = Date.now() + lateWindowMs;
  let acted = 0;
  for (;;) {
    await extraPass();
    await consentPass();
    await framesPass();
    acted = await closeVisibleDialogs();
    if (acted || Date.now() >= deadline) break;
    await page.waitForTimeout(1500);
  }

  // Persistent widgets: hide (visibility, layout kept) — both sides.
  const hideList = [...(hideDefaults ? HIDE_DEFAULTS : [])];
  if (hideList.length || removeText.length) {
    const hidden = await page.evaluate(({ sels, phrases }) => {
      const out = [];
      const hide = (el) => { el.style.setProperty('visibility', 'hidden', 'important'); el.setAttribute('data-stardust-hidden', '1'); };
      for (const sel of sels) {
        let n = 0;
        try {
          for (const el of document.querySelectorAll(sel)) {
            if (el.hasAttribute('data-stardust-hidden')) continue;
            const cs = getComputedStyle(el);
            if (sel.includes('feedback') && cs.position !== 'fixed') continue; // generic aria-label: fixed widgets only
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            hide(el); n += 1;
          }
        } catch { n = -1; }
        if (n) out.push({ kind: 'hide-default', sel, count: n });
      }
      for (const phrase of phrases) {
        const needle = String(phrase).toLowerCase();
        let n = 0;
        for (const el of document.querySelectorAll('body *')) {
          if (el.children.length > 3 || !(el.textContent || '').toLowerCase().includes(needle)) continue;
          let target = el;
          for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed' || cs.position === 'sticky') { target = a; break; } }
          if (target.hasAttribute('data-stardust-hidden')) continue;
          hide(target); n += 1;
          if (n >= 5) break;
        }
        out.push({ kind: 'remove-text', sel: `text:${phrase}`, count: n });
      }
      return out;
    }, { sels: hideList, phrases: removeText }).catch(() => []);
    dismissed.hidden = hidden;
  }

  // Fail-loud signal: a consent container STILL visible after the window.
  const present = await page.evaluate((sels) => {
    const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 24 && r.bottom > 0 && r.top < innerHeight; };
    const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    for (const sel of sels) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (el.shadowRoot) { const inner = [...el.shadowRoot.querySelectorAll('div, section, dialog')].find((x) => vis(x) && /cookie|consent|privacy/i.test(x.textContent || '')); if (inner) return `${desc(el)} (shadow)`; continue; }
          if (vis(el)) return desc(el);
        }
      } catch { /* bad selector */ }
    }
    // generic: a fixed/sticky visible element that talks about cookies and carries a consent control
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (!vis(el)) continue;
      const t = (el.textContent || '').toLowerCase();
      if (t.length > 2500 || !/cookie|consent|privacy|datenschutz|confidentialit|privacidad|personvern/.test(t)) continue;
      if (el.querySelector('button, a[role=button], [role=button], input[type=button]')) return desc(el);
    }
    return null;
  }, CONSENT_CONTAINERS).catch(() => null);
  dismissed.consentContainer = present;
  dismissed.consentPresent = present !== null;
  if (mode === 'deny' && dismissed.consentPresent && !dismissed.rejected) {
    console.error(`[live-session] consent mode deny: a consent dialog is present (${present}) but none of ${reject.length + REJECT_CANDIDATES.length} reject-all selectors or ${DECLINE_LABELS.length} decline labels matched — the page is NOT in deny state (pass a reject selector, or run accept mode on BOTH sides)`);
  } else if (dismissed.consentPresent) {
    console.error(`[live-session] consent present, not dismissed: ${present} — pass --consent <sel> (or "text:<label>"); a capture with the banner up is not the reference state`);
  }

  // park the mouse (rule 10): a dismissal click leaves the virtual cursor at
  // the button's coordinates; anything :hover-styled under it captures hovered.
  const vp = page.viewportSize();
  await page.mouse.move(0, (vp ? vp.height : 900) - 1).catch(() => {});

  return dismissed;
}

/**
 * One-line residue report for the probe instruments (anchor, chrome-parity,
 * sibling-variance, motion-observe): they measure structure, not pixels, so a
 * consent container still up is a WARN on stderr and the run continues; the
 * hidden persistent widgets are listed so both sides' lists can be compared.
 * stitch-shot has its own fail-loud path (exit 5).
 */
export function reportOverlayResidue(tool, d) {
  if (!d) return;
  if (d.consentPresent) console.error(`${tool} WARN consent present, not dismissed: ${d.consentContainer} — pass --consent <sel> (or "text:<label>"); numbers below include the banner state`);
  for (const h of d.hidden || []) if (h.count > 0) console.error(`${tool}: hidden ${h.count} persistent widget(s) via ${h.sel} (${h.kind}; visibility, layout kept)`);
}
