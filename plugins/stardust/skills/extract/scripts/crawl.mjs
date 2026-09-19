#!/usr/bin/env node
/**
 * crawl.mjs — reference Playwright crawler for stardust:extract.
 *
 * Solves two stardust multitest findings:
 *   #4  extract ships no runnable crawler — every migration re-implements the
 *       Playwright recipe by hand (expensive, inconsistent). This is the bundled
 *       `extract/scripts/crawl.mjs` the recipe always implied.
 *   #7  capture hardening — the hand-rolled crawls captured hidden / transient /
 *       modal DOM as real content (consent banners and "temporarily unavailable"
 *       overlays became headings; AJAX-modal detail pages captured byte-identical
 *       to their listing; SPA shells captured a tracking pixel + global h1 as a
 *       "page"). This crawler filters those at capture time.
 *
 * It implements the CORE of reference/playwright-recipe.md (browser config +
 * bot-management fallback, consent dismissal, wait+scroll, the capture list,
 * response validation) plus the finding-#7 hardening below. The recipe remains
 * the authoritative field spec; extend the in-page capture() to match it fully.
 *
 * Hardening (#7), all applied inside the page context:
 *   - VISIBILITY FILTER: headings/body/CTAs skip nodes that are display:none,
 *     visibility:hidden, aria-hidden, [hidden], or off-screen / zero-area.
 *   - INTERSTITIAL/ERROR heuristic: nodes matching known consent / language-gate
 *     / "temporarily unavailable" patterns are dropped from content and counted
 *     in `_filtered`.
 *   - MODAL/AJAX capture: [role=dialog] / .modal / [aria-modal] containers are
 *     read via textContent even when display:none (XHR-populated detail), so a
 *     URL-addressable modal route is not captured as its listing page.
 *   - TRACKING-PIXEL = zero media: a lone off-origin <=2px img doesn't count as
 *     "has media" (so the low-media flag fires on an SPA shell).
 *   - SUBSTANCE check: a page with <2 distinct in-main headings AND tiny main
 *     innerText AND no real media is flagged `spaShellSuspect`.
 *   - DUPLICATE check (cross-page, after the crawl): a page whose main-content
 *     hash equals another page's is flagged `duplicateOf` (catches detail==listing).
 *     Attribution is deterministic by discovery order: the earliest-queued page
 *     per hash is canonical, regardless of pool completion order.
 *   - RENDERED DOM: the settled page's `page.content()` is saved verbatim as
 *     <out>/pages/<slug>.html next to the JSON (path in the record's
 *     `renderedHtml` field). Capture once, parse offline: importers and sibling
 *     generators iterate their extraction against this artifact (free,
 *     reproducible, and provenance) instead of re-running live probes per
 *     selector guess. Live probes stay for what the static DOM cannot answer
 *     (geometry, computed styles).
 *   - SCREENSHOT: a full-page PNG per page under <out>/assets/screenshots/<slug>.png
 *     (viewport-only fallback on extremely tall pages; mode in _signals.screenshotMode,
 *     relative path in the page record's `screenshot` field) — feeds the extract
 *     SKILL.md Phase 2.5 vision gate.
 *
 * Usage:
 *   node crawl.mjs --url https://example.com [--pages /a,/b] [--cap 25 | --all | --single] \
 *     [--refresh slug,slug | --force] [--out stardust/current] [--wait medium] \
 *     [--no-consent-dismiss] [--concurrency 4] [--dynamics] [--headed[=window]]
 *
 * Scope: ia-extraction.md § Incremental re-runs is the rule (--pages exact
 *   paths, --refresh / --force vs the default skip of slugs already extracted
 *   in ../state.json — read-only here; a missing file means no skip).
 * Log (ia-extraction.md § _crawl-log.json shape): one runs[] entry per
 *   invocation; crawl.failures is the union across runs minus slugs that later
 *   succeeded; discovery never shrinks on a narrower re-run.
 *
 * Bot-management ladder (playwright-recipe.md § Bot-management fallback):
 *   tier 1 headless → tier 2 chrome-headless → tier 3 chrome-headed-offscreen.
 *   A challenge at tiers 1–2 escalates after ONE hit — at the probe AND at
 *   capture time (a worker context re-challenged after the probe cleared
 *   drains the pool, relaunches one tier up and requeues the unfinished
 *   pages); only tier 3 runs the wait+reload solve window. --headed starts at
 *   tier 2, --headed=window at tier 3; a re-run starts at the tier recorded in
 *   _crawl-log.json#discovery.fetchTechnique, which is the tier that actually
 *   captured. The tier-3 window is parked off-screen unless STARDUST_HEADED_WINDOW=1.
 * Exit codes: 0 done (per-page failures are in the log) · 2 fatal ·
 *   3 BotChallengeError (tier 3 still challenged — never captured as content).
 * Exports (for evals/fixtures/*.test.mjs): slugify, assignSlugs, mergeCrawlLog,
 *   TIERS, tierOf — importing this module runs nothing; main() runs only when
 *   the file is the entry script.
 *
 * Needs playwright importable from the project (see extract/SKILL.md Setup —
 * `npm i -D playwright` or the Playwright MCP server; the `npx playwright`
 * availability probe alone does NOT make the ESM module importable).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// playwright is imported lazily in main(): the module must stay importable
// without it (fixture tests import slugify / mergeCrawlLog from the plugin tree,
// which ships no node_modules — extract/SKILL.md § Setup).

const WAIT_MS = { fast: 1200, medium: 2500, slow: 5000 };

// One context config for probe, headed fallback, and workers — a tweak (locale,
// UA, colorScheme) must land everywhere or discovery renders under different
// conditions than capture. Viewport here also saves a per-page CDP round-trip.
const CRAWL_CONTEXT = { reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } };

function parseArgs(argv) {
  const a = { out: 'stardust/current', max: 5, wait: 'medium', consent: true, concurrency: 4, dynamics: false, refresh: [], force: false, headed: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--url') a.url = argv[(i += 1)];
    else if (k === '--pages') a.pages = (argv[(i += 1)] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = argv[(i += 1)];
    else if (k === '--max' || k === '--cap') { const n = +argv[(i += 1)]; a.max = Number.isFinite(n) && n >= 0 ? n : 5; } // 0 = no cap; default 5 (the extract contract's small sample)
    else if (k === '--all') a.max = 0;
    else if (k === '--single') a.max = 1;
    else if (k === '--refresh') a.refresh = (argv[(i += 1)] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--force') a.force = true;
    else if (k === '--wait') a.wait = argv[(i += 1)];
    else if (k === '--no-consent-dismiss') a.consent = false;
    else if (k === '--concurrency') a.concurrency = Math.max(1, +argv[(i += 1)] || 4);
    else if (k === '--dynamics') a.dynamics = true; // migration-bound: set by prepare-migration / replica / migrate, never by default
    else if (k === '--headed') a.headed = 2; // start the ladder at tier 2 (real Chrome, still headless)
    else if (k === '--headed=window' || k === '--headed=offscreen') a.headed = 3; // start at tier 3 (off-screen window)
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.url) throw new Error('--url is required');
  a.origin = new URL(a.url).origin;
  a.capLabel = a.max === 0 ? 'all' : a.max;
  if (a.max === 0) a.max = Infinity;
  return a;
}

// Slug algorithm — ia-extraction.md § Slug derivation DESCRIBES this function;
// downstream scripts key on state.json.pages[].slug, never re-implement it.
// Cap: a 200+-char path (deep vendor docs) overflows the 255-byte file-name
// limit once .json/.png is appended (ENAMETOOLONG) — keep a stable 180-char
// prefix + sha1:8 of the full slug.
const SLUG_MAX = 200;
export const slugify = (u) => {
  const { pathname } = new URL(u);
  const s = pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  if (s.length > SLUG_MAX) return `${s.slice(0, 180).replace(/-+$/, '')}-${crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)}`;
  return s || 'index';
};

// state.json is READ-ONLY for the crawler (the skill's Phase 6 writes it):
// pages already extracted or beyond are skipped on a re-run so nothing is
// re-hit or clobbered by accident. Missing / unreadable file → no skip.
const EXTRACTED_OR_BEYOND = new Set(['extracted', 'directed', 'prototyped', 'approved', 'migrated']);
async function readStatePages(args) {
  const p = path.resolve(args.out, '..', 'state.json');
  try {
    const st = existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null;
    return new Map((st?.pages || []).filter((pg) => pg && pg.slug).map((pg) => [pg.slug, pg]));
  } catch { return new Map(); }
}

// Slugs key the output FILES (pages/<slug>.json, screenshots/<slug>.png), but
// distinct pages can collide on one slug: dedupeKey keeps url.search (so
// /p?a=1 and /p?a=2 are two pages) while slugify reads pathname only, and
// /about-us vs /about/us flatten identically. Without disambiguation two
// concurrent workers write the same files (silent last-writer-wins) and the
// duplicate post-pass can mark a page duplicateOf itself. Assign slugs once,
// up front: first claimant keeps the clean slug, later distinct pages get a
// deterministic -<hash4> suffix.
export function assignSlugs(urls) {
  const bySlug = new Map(); // slug -> dedupeKey of first claimant
  return urls.map((u) => {
    const base = slugify(u);
    const key = dedupeKey(u);
    if (!bySlug.has(base)) { bySlug.set(base, key); return base; }
    if (bySlug.get(base) === key) return base; // same page (shouldn't recur post-dedupe)
    const suffix = crypto.createHash('sha1').update(key).digest('hex').slice(0, 4);
    const alt = `${base}-${suffix}`;
    if (!bySlug.has(alt)) bySlug.set(alt, key);
    return alt;
  });
}

// ---- bot-management escalation ladder (shared contract with diff/scripts/live-session.mjs) ----
// Byte-identical copy of live-session.mjs's TIERS / STEALTH_ARGS / OFFSCREEN_ARGS /
// launchTier: this file is copied alone into projects (stardust/scripts/crawl.mjs)
// and cannot import that module; evals/lint/launch-ladder.mjs fails when they drift.
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
// A context factory so the stealth init script lands on EVERY context (probe +
// workers) once the run is in stealth mode — the challenge re-fires per context
// (no cross-context cookie sharing), so a worker that skipped the spoof would be
// re-challenged even after the probe cleared it.
async function newContext(browser, stealth) {
  const ctx = await browser.newContext(CRAWL_CONTEXT);
  if (stealth) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  return ctx;
}
// Network-level fingerprint reject: navigation THROWS before any JS runs.
function isFingerprintBlock(err) {
  const m = String(err && err.message || err);
  return /ERR_HTTP2_PROTOCOL_ERROR|ERR_QUIC_PROTOCOL_ERROR|ERR_CONNECTION_RESET|net::ERR/.test(m);
}
// Bot-management CHALLENGE / block: navigation SUCCEEDS (domcontentloaded fires,
// no throw) but the response is a 403/429/503 interstitial, not the page. The
// original fallback only caught isFingerprintBlock() throws, so a Cloudflare
// managed challenge (cf-mitigated: challenge, HTTP 403) sailed past the probe
// and only blew up at capture-time as a fatal HTTPError. Validate the RESPONSE,
// not just DOM-ready.
function isChallengeResponse(resp) {
  if (!resp) return false;
  const status = resp.status();
  const h = resp.headers();
  // Cloudflare stamps this header specifically on managed/JS-challenge responses.
  if ((h['cf-mitigated'] || '').toLowerCase() === 'challenge') return true;
  // A hard 403/429/503 that ALSO carries an edge/CDN signature is an edge
  // interstitial (Cloudflare / Akamai / F5 / Imperva) — headed real Chrome is the
  // correct response regardless of vendor. Requiring the edge signature (not the
  // bare status) is deliberate: isChallengeResponse gates clearChallenge() on
  // EVERY page, so a legitimate app-level 403 (e.g. an auth-gated deep page with
  // no CDN header) must fail fast, not eat the ~12s challenge-solve retry loop.
  if (status === 403 || status === 429 || status === 503) {
    const server = (h['server'] || '').toLowerCase();
    if (h['cf-ray'] || server.includes('cloudflare')) return true;
    if (h['x-akamai-transformed'] || server.includes('akamai')) return true;
    if (server.includes('big-ip') || server.includes('imperva') || h['x-iinfo']) return true;
    // no edge signature — treat as a genuine app-level status, not a challenge.
  }
  return false;
}
// Cloudflare's non-interactive managed challenge serves the 403/503 interstitial,
// runs its JS, sets a clearance cookie, then the real page becomes reachable.
// Wait for that window and reload to pick up the cookie before treating the
// status as a hard failure. No-op for a normal 200 (isChallengeResponse false),
// so zero overhead on the common path.
async function clearChallenge(page, resp) {
  for (let attempt = 0; attempt < 3 && isChallengeResponse(resp); attempt += 1) {
    await page.waitForTimeout(4000);
    const reloaded = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch(() => null);
    if (reloaded) resp = reloaded;
  }
  return resp;
}

// ---- URL normalization: one canonical form for entry, --pages, sitemap, BFS ----
// resolve against base, strip hash, keep query, normalize trailing slash
// (non-root paths lose it) so `/about`, `/about/` and `/about#team` dedupe.
function normalizeUrl(u, base) {
  const url = new URL(u, base);
  url.hash = '';
  // Keep the source's trailing-slash form VERBATIM (stardust-style e2e finding):
  // static hosts commonly serve /docs/ as 200 and /docs as 404 with NO redirect
  // between the variants, so rewriting the fetched URL turns sitemap-declared
  // pages into 404s. Dedupe happens by slash-stripped KEY (dedupeKey below),
  // never by rewriting the URL we fetch.
  return url.href;
}
// slash-insensitive identity for dedupe: /about, /about/ and /about#x are one page.
function dedupeKey(href) {
  const url = new URL(href);
  return url.origin + url.pathname.replace(/\/+$/, '') + url.search;
}

// ---- discovery: explicit pages > sitemap (validated) > BFS from nav ----
async function discover(args, page) {
  const entry = normalizeUrl(args.url);
  // explicit --pages: crawl EXACTLY the listed pages, never drop one. The entry
  // URL is included only when listed (or when the list is empty) — a
  // single-page recapture must not re-hit the home page every time. If the
  // list exceeds --cap, warn instead of silently evicting a requested page.
  if (args.pages) {
    const seen = new Set();
    const listed = args.pages.map((p) => normalizeUrl(p, args.url))
      .filter((u) => { const k = dedupeKey(u); if (seen.has(k)) return false; seen.add(k); return true; });
    const urls = listed.length ? listed : [entry];
    if (urls.length > args.max) {
      console.error(`[crawl] WARN --pages lists ${urls.length} page(s), exceeding --cap ${args.capLabel} — crawling all of them (explicitly listed pages are never dropped)`);
    }
    return urls;
  }
  // discovered lists (sitemap/BFS): entry always included, normalized dedupe, capped at --max.
  const withEntry = (list) => {
    const seen = new Set(); const out = [];
    for (const u of [entry, ...list.map((x) => normalizeUrl(x, args.origin))]) {
      const k = dedupeKey(u);
      if (!seen.has(k)) { seen.add(k); out.push(u); }
    }
    return out.slice(0, args.max);
  };
  // sitemap.xml — but only trust it if it has >=1 <loc> (a 200-but-empty Drupal
  // sitemap must fall through to BFS — finding from a media-site run).
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const xml = await page.evaluate(async (u) => {
        const r = await fetch(u); return r.ok ? r.text() : '';
      }, new URL(sm, args.origin).href);
      const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1])
        .filter((u) => u.startsWith(args.origin));
      // a sitemap INDEX's <loc>s are child-sitemap .xml URLs, not pages —
      // recurse one level (capped) instead of queueing them as pages, where
      // every capture would throw ContentTypeError and discovery would
      // silently collapse to the entry page.
      const isXml = (u) => /\.xml(?:[?#]|$)/i.test(u);
      let pageLocs = locs.filter((u) => !isXml(u));
      const childMaps = locs.filter(isXml).slice(0, 8);
      if (!pageLocs.length && childMaps.length) {
        for (const child of childMaps) {
          try {
            const cx = await page.evaluate(async (u) => {
              const r = await fetch(u); return r.ok ? r.text() : '';
            }, child);
            pageLocs = pageLocs.concat([...cx.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
              .map((m) => m[1]).filter((u) => u.startsWith(args.origin) && !isXml(u)));
          } catch { /* skip unreadable child sitemap */ }
        }
      }
      if (pageLocs.length >= 1) return withEntry(pageLocs);
    } catch { /* fall through */ }
  }
  // BFS depth-1 from the entry page's same-origin nav links.
  const links = await page.evaluate((origin) => [...document.querySelectorAll('a[href]')]
    .map((a) => a.href).filter((h) => h.startsWith(origin)), args.origin);
  return withEntry(links);
}

// Consent containers whose presence after the dismissal pass means `failed`
// (banner detected, nothing hid it) rather than `none-detected`.
const CONSENT_CONTAINERS = '#onetrust-banner-sdk, #truste-consent-track, #usercentrics-root, #CybotCookiebotDialog, [id*="didomi"], [id*="osano"], [class*="cookie" i][class*="banner" i], [id*="consent" i]';
// Consent-method rank for _crawl-log.json#consent.method — the crawl keeps the
// most informative value seen across pages (a click beats a no-op).
const consentRank = (m) => (/^(dismissed|text):/.test(m) ? 3 : m === 'failed' ? 2 : m === 'none-detected' ? 1 : 0);

/**
 * Accept-mode consent dismissal (D3: lift, capture and gate click the SAME
 * control — replica's stitch-shot reads the value returned here as its default
 * `--consent`). Returns the resolved method, one of
 *   dismissed:<sel>  a selector was clicked   text:<label>  the guarded text-match fallback clicked a label
 *   none-detected    no consent surface seen  failed        a consent container is present and nothing hid it
 * (playwright-recipe.md § Pre-flight: consent dismissal; values listed in extract/SKILL.md Phase 2 step 3).
 */
async function dismissConsent(page) {
  const sels = ['#onetrust-accept-btn-handler', '.truste-button2', '#CybotCookiebotDialogBodyLevelButtonAccept',
    '[aria-label*="Accept" i]', 'button[id*="accept" i]', 'button[class*="accept" i]'];
  let matched = null;
  for (const s of sels) {
    const el = await page.$(s);
    if (el) { await el.click().catch(() => {}); matched = s; await page.waitForTimeout(300); break; }
  }
  // Usercentrics renders inside shadow DOM (#usercentrics-root) — regular
  // selectors can't reach it (tools-retailer e2e finding). Accept first (D3).
  const ucMatched = await page.evaluate(() => {
    const root = document.querySelector('#usercentrics-root')?.shadowRoot;
    if (root) {
      const btn = root.querySelector('[data-testid="uc-accept-all-button"], [data-testid="uc-deny-all-button"]');
      if (btn) { btn.click(); return `[data-testid="${btn.dataset.testid}"]`; }
    }
    return null;
  }).catch(() => null);
  // Text-match fallback, only when the selector pass matched NOTHING (two field
  // harvests, 2026-08: two different consent widgets — a custom
  // dialog, cookieconsent's a.cc-btn — were missed by the list above; on
  // one of them the banner baked into the ground-truth screenshot AND repeated at
  // all 7 stitch seams → 32% false pixel diff). Guards keep it from ever
  // hitting an in-content link: exact match on a short consent label (≤25
  // chars after whitespace collapse), visible, and inside a fixed/sticky or
  // high-z overlay container. Worst case = today's behavior (banner stays).
  let textHit = null;
  if (!matched && !ucMatched) {
    const hit = await page.evaluate(() => {
      const LABELS = new Set(['accept', 'accept all', 'allow all', 'agree', 'ok', 'decline',
        'alle akzeptieren', 'accepter']);
      const inOverlay = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.position === 'fixed' || cs.position === 'sticky') return true;
          if (cs.position !== 'static' && +cs.zIndex >= 100) return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 25 || !LABELS.has(t.toLowerCase())) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
        if (!inOverlay(el)) continue;
        el.click();
        return t;
      }
      return null;
    }).catch(() => null);
    if (hit) { textHit = hit; console.error(`[crawl] consent dismissed via text-match fallback ("${hit}")`); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(300);
  // resolved method BEFORE the prune — a container that survived every pass is `failed`
  const stillPresent = (matched || ucMatched || textHit) ? false : await page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .some((n) => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; }), CONSENT_CONTAINERS).catch(() => false);
  // assert: prune any consent container still present (don't leave it for capture).
  await page.evaluate((sel) => { document.querySelectorAll(sel).forEach((n) => n.remove()); }, CONSENT_CONTAINERS);
  if (matched) return `dismissed:${matched}`;
  if (ucMatched) return `dismissed:${ucMatched}`;
  if (textHit) return `text:${textHit}`;
  return stillPresent ? 'failed' : 'none-detected';
}

// Experiment / personalisation markers recorded per page in _provenance.variants[]
// (field names shared with replica's capture sidecar, capture-sidecar.mjs): a
// capture taken inside an A/B bucket is not the site's default rendering.
const EXPERIMENT_COOKIES = ['optimizelyEndUserId', 'mbox', '_vwo_uuid'];
async function collectVariants(page, context) {
  const out = [];
  try {
    for (const c of await context.cookies()) if (EXPERIMENT_COOKIES.includes(c.name)) out.push({ kind: 'cookie', name: c.name, value: c.value });
  } catch { /* context already closed */ }
  const inPage = await page.evaluate(() => {
    const v = [];
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) if (a.name.startsWith('data-experiment')) { v.push({ kind: 'attribute', name: a.name, value: a.value }); if (v.length >= 20) break; }
      if (v.length >= 20) break;
    }
    if (window.optimizely) v.push({ kind: 'global', name: 'window.optimizely' });
    if (window.adobe?.target) v.push({ kind: 'global', name: 'adobe.target' });
    if (window._vwo_code) v.push({ kind: 'global', name: '_vwo_code' });
    return v;
  }).catch(() => []);
  const seen = new Set();
  return [...out, ...inPage].filter((x) => { const k = `${x.kind}|${x.name}|${x.value ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 24);
}

// Favicon — captured on the ENTRY page in ALL modes (healthcare-site harvest, 2026-08:
// bounded --pages extracts skip Phase 3 (brand surface) where favicon capture
// otherwise lives, and deploy's favicon step then skips SILENTLY — the deployed
// site shipped the default icon). One cheap request. The fetch runs in-page so
// it inherits the context's fingerprint + cookies — bot-walled origins usually
// serve assets even when pages are challenged.
async function captureFavicon(page, args) {
  try {
    const fetchIcon = (u) => page.evaluate(async (iconUrl) => {
      try {
        const r = await fetch(iconUrl);
        if (!r.ok) return null;
        return { type: r.headers.get('content-type') || '', bytes: [...new Uint8Array(await r.arrayBuffer())] };
      } catch { return null; }
    }, u);
    const href = await page.evaluate(() => document.querySelector('link[rel~="icon" i]')?.href || null);
    const fallback = new URL('/favicon.ico', args.origin).href;
    let url = href || fallback;
    let res = await fetchIcon(url);
    // a cross-origin <link> icon (CDN-hosted) dies on the CORS-bound in-page
    // fetch even when the asset is fine — retry the same-origin /favicon.ico
    // before giving up.
    if ((!res || !res.bytes.length) && url !== fallback) { url = fallback; res = await fetchIcon(url); }
    if (!res || !res.bytes.length) return null;
    // content-type is authoritative for <ext> (a /favicon.ico path routinely
    // serves PNG); the URL path is the fallback, .ico the default.
    const extFromType = /svg/.test(res.type) ? 'svg' : /png/.test(res.type) ? 'png'
      : /jpe?g/.test(res.type) ? 'jpg' : /gif/.test(res.type) ? 'gif'
        : /webp/.test(res.type) ? 'webp' : /icon/.test(res.type) ? 'ico' : '';
    const extFromPath = (path.extname(new URL(url).pathname).slice(1) || '').toLowerCase();
    const ext = extFromType || extFromPath || 'ico';
    await mkdir(path.join(args.out, 'assets'), { recursive: true });
    const file = `assets/favicon.${ext}`;
    await writeFile(path.join(args.out, file), Buffer.from(res.bytes));
    return { url, file };
  } catch { return null; }
}

// ---- the capture, run in-page; returns the per-page record + hardening signals ----
// ---- dynamic-surface evidence (network side) — OPT-IN (`--dynamics`) --------
// Records WHAT the page fetched while rendering — never what it means. Cheap
// per-page REACH signals for the dynamics sub-skill: `dynamics-detect.mjs`
// probes archetypes in depth and folds these per-page sections (`--reach`) into
// each finding's reach. Migration-bound: prepare-migration, replica and migrate
// pass `--dynamics`; a bare extract, uplift and audit never do (dynamics is a
// migration concern, not a redesign one).
const DYNAMIC_MAX_ENDPOINTS = 150;
const DYNAMIC_MAX_HOSTS = 60;
const JSON_CT = /application\/(json|[a-z0-9.+-]*\+json)|text\/json|application\/graphql/i;

// collapse ids so /api/products/1234 and /api/products/5678 read as one endpoint
function pathPattern(u) {
  return u.pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/{hash}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}');
}
function queryKeys(u) { return [...new Set([...u.searchParams.keys()])].sort(); }
// loose eTLD+1: enough to tell cdn.brand.com from analytics.vendor.com
function registrable(host) { return host.split('.').slice(-2).join('.'); }

function attachDynamicRecorder(page) {
  const endpoints = new Map(); // "METHOD host/path-pattern" → row
  const scriptHosts = new Map(); // host → count
  let truncated = false;
  page.on('response', (resp) => {
    try {
      const req = resp.request();
      const type = req.resourceType();
      const ct = (resp.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      const u = new URL(resp.url());
      if (!/^https?:$/.test(u.protocol)) return;
      if (type === 'script') { scriptHosts.set(u.host, (scriptHosts.get(u.host) || 0) + 1); return; }
      if (type === 'document') return; // the page itself (and iframes' documents)
      const dataLike = type === 'xhr' || type === 'fetch' || type === 'eventsource' || JSON_CT.test(ct);
      if (!dataLike) return;
      const method = req.method();
      const key = `${method} ${u.host}${pathPattern(u)}`;
      const len = Number(resp.headers()['content-length']) || null;
      const row = endpoints.get(key);
      if (row) { row.hits += 1; if (len) row.bytes = Math.max(row.bytes || 0, len); return; }
      if (endpoints.size >= DYNAMIC_MAX_ENDPOINTS) { truncated = true; return; }
      endpoints.set(key, {
        method, host: u.host, path: pathPattern(u), query: queryKeys(u), resourceType: type,
        contentType: ct || null, status: resp.status(), bytes: len, hits: 1, example: `${u.origin}${u.pathname}`,
      });
    } catch { /* evidence only — never fail a capture on it */ }
  });
  return {
    finish(finalUrl) {
      const site = registrable(new URL(finalUrl).host);
      return {
        endpoints: [...endpoints.values()].map((r) => ({ ...r, sameSite: registrable(r.host) === site })),
        thirdPartyScriptHosts: [...scriptHosts.entries()]
          .filter(([h]) => registrable(h) !== site)
          .sort((a, b) => b[1] - a[1]).slice(0, DYNAMIC_MAX_HOSTS)
          .map(([host, count]) => ({ host, count })),
        truncated,
      };
    },
  };
}

// site-level roll-up (written to _crawl-log.json#dynamicSurface): which
// endpoints / hosts / frameworks / form targets recur across pages, with up to
// three example slugs each — the view Phase 4.5 reads first.
function newDynamicRollup() {
  return { endpoints: new Map(), thirdPartyScriptHosts: new Map(), frameworkHints: new Map(), globalState: new Map(), formTargets: new Map(), pages: 0, pagesWithSameSiteData: 0, pagesWithSearchForm: 0, pagesHydrated: 0, truncatedPages: 0 };
}
function bump(map, key, slug, extra) {
  const row = map.get(key) || { ...extra, pages: 0, examples: [] };
  row.pages += 1;
  if (row.examples.length < 3) row.examples.push(slug);
  map.set(key, row);
}
function rollupDynamic(acc, d, slug) {
  acc.pages += 1;
  if (d.truncated) acc.truncatedPages += 1;
  if (d.summary.sameSiteEndpoints) acc.pagesWithSameSiteData += 1;
  if (d.summary.searchForms) acc.pagesWithSearchForm += 1;
  if (d.summary.hydrated) acc.pagesHydrated += 1;
  for (const e of d.endpoints) bump(acc.endpoints, `${e.method} ${e.host}${e.path}`, slug, { method: e.method, host: e.host, path: e.path, query: e.query, resourceType: e.resourceType, contentType: e.contentType, sameSite: e.sameSite, example: e.example });
  for (const h of d.thirdPartyScriptHosts) bump(acc.thirdPartyScriptHosts, h.host, slug, { host: h.host });
  for (const f of d.frameworkHints) bump(acc.frameworkHints, f, slug, { hint: f });
  for (const g of d.globalState) bump(acc.globalState, g, slug, { name: g });
  for (const f of d.forms) bump(acc.formTargets, `${f.method} ${f.action || '(js-handled)'}`, slug, { action: f.action, method: f.method, sameOrigin: f.sameOrigin, search: f.search, fieldNames: f.fieldNames });
}
function finalizeDynamic(acc) {
  const list = (m, cap) => [...m.values()].sort((a, b) => b.pages - a.pages).slice(0, cap);
  return {
    pages: acc.pages,
    pagesWithSameSiteData: acc.pagesWithSameSiteData,
    pagesWithSearchForm: acc.pagesWithSearchForm,
    pagesHydrated: acc.pagesHydrated,
    truncatedPages: acc.truncatedPages,
    endpoints: list(acc.endpoints, 300),
    thirdPartyScriptHosts: list(acc.thirdPartyScriptHosts, DYNAMIC_MAX_HOSTS),
    frameworkHints: list(acc.frameworkHints, 20),
    globalState: list(acc.globalState, 20),
    formTargets: list(acc.formTargets, 50),
  };
}

function capture() {
  const vis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false; // zero-area
    if (r.bottom < -2000 || r.right < -2000) return false; // far off-screen
    return true;
  };
  const INTERSTITIAL = /(temporarily unavailable|page unavailable|continuing to a page|go back to spanish|continue in english|this site uses cookies|accept all cookies|change cookie settings|privacy notice)/i;
  const isInterstitial = (t) => t && INTERSTITIAL.test(t.trim());

  let filtered = 0;
  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content
    || document.querySelector(`meta[property="${n}"]`)?.content || null;

  // headings: visible only, drop interstitial copy
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => {
    if (!vis(h)) return false;
    if (isInterstitial(text(h))) { filtered += 1; return false; }
    return true;
  }).map((h) => ({ tag: h.tagName.toLowerCase(), level: +h.tagName[1], text: text(h) })).filter((h) => h.text);

  const main = document.querySelector('main') || document.body;
  // body paragraphs: visible, non-interstitial
  const body = [...main.querySelectorAll('p,blockquote,li')].filter((p) => {
    if (!vis(p)) return false;
    const t = text(p);
    if (!t || t.length < 2) return false;
    if (isInterstitial(t)) { filtered += 1; return false; }
    return true;
  }).map(text);

  // CTAs (visible button-like)
  const ctas = [...document.querySelectorAll('a[href],button,[role="button"]')].filter(vis)
    .map((a) => ({ label: text(a), href: a.getAttribute('href') || null }))
    .filter((c) => c.label && !isInterstitial(c.label)).slice(0, 100);

  // links
  const links = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href))];

  // media — tracking pixels (lone off-origin <=2px) do NOT count as media
  const imgs = [...document.querySelectorAll('img')].map((im) => ({
    src: im.currentSrc || im.src, alt: im.alt || '', w: im.naturalWidth, h: im.naturalHeight,
  }));
  const realImgs = imgs.filter((im) => im.src && im.w > 2 && im.h > 2
    && !/(^data:|1x1|pixel|track|beacon|\/p\?|\/b\?)/i.test(im.src));
  const cssBgs = [];
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && /url\(/.test(bg)) {
      const r = el.getBoundingClientRect();
      const m = bg.match(/url\(["']?([^"')]+)/);
      if (r.width >= 100 && r.height >= 80 && m) cssBgs.push(m[1]);
    }
  }

  // MODAL / AJAX detail: read textContent of dialog/modal containers EVEN IF hidden
  // (XHR-populated detail sits in a display:none .modal until opened).
  const modals = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.modal-content')]
    .map((m) => text(m)).filter((t) => t && t.length > 40).slice(0, 10);

  const mainText = text(main);
  // custom props — discovery-vs-value split:
  //   * the stylesheet walk DISCOVERS property NAMES declared on :root/html-ish
  //     selectors, recursing into @media/@supports groups AND @import'ed sheets
  //     (a CSSImportRule exposes .styleSheet, not .cssRules — WordPress/legacy
  //     CMS token sheets commonly arrive via @import);
  //   * the recorded VALUE is always the LIVE one from
  //     getComputedStyle(documentElement). A declared value is accepted as
  //     fallback ONLY from unconditional rules (not inside any grouping rule
  //     with a condition, nor a conditional @import/link media) whose selector
  //     list contains exactly ':root' or 'html'. Names that only appear in
  //     conditional/themed rules (e.g. `:root.dark`, `@media (…)`) and compute
  //     empty are skipped — the rendered page never used them.
  const propNames = new Set();
  const declaredFallback = {};
  const isConditionalMedia = (media) => !!(media && media.mediaText && !/^(all)?$/i.test(media.mediaText.trim()));
  const walkRules = (rules, conditional) => {
    for (const rule of rules || []) {
      if (rule.type === 3 /* CSSRule.IMPORT_RULE */ || (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule)) {
        try {
          if (rule.styleSheet) walkRules(rule.styleSheet.cssRules, conditional || isConditionalMedia(rule.media));
        } catch { /* cross-origin imported sheet */ }
        continue;
      }
      if (rule.style && rule.selectorText) {
        const selectors = rule.selectorText.split(',').map((s) => s.trim());
        if (selectors.some((s) => /^(:root|html)\b/.test(s))) {
          const unconditionalRoot = !conditional && selectors.some((s) => s === ':root' || s === 'html');
          for (const p of rule.style) {
            if (!p.startsWith('--')) continue;
            propNames.add(p);
            // last unconditional exact-:root/html declaration wins (cascade order)
            if (unconditionalRoot) declaredFallback[p] = rule.style.getPropertyValue(p).trim();
          }
        }
      }
      if (rule.cssRules && rule.cssRules.length) {
        // grouping rule: @media/@supports carry a condition; @layer etc. do not
        const groupConditional = conditional || typeof rule.conditionText === 'string';
        try { walkRules(rule.cssRules, groupConditional); } catch { /* skip */ }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walkRules(sheet.cssRules, isConditionalMedia(sheet.media)); } catch { /* cross-origin sheet */ }
  }
  for (const p of document.documentElement.style) {
    if (p.startsWith('--')) {
      propNames.add(p);
      declaredFallback[p] = document.documentElement.style.getPropertyValue(p).trim();
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const customProps = {};
  for (const name of propNames) {
    const live = rootStyle.getPropertyValue(name).trim();
    if (live) customProps[name] = live;
    else if (declaredFallback[name]) customProps[name] = declaredFallback[name];
    // else: conditional/themed-only name with empty computed value — skip
  }

  // substance / SPA-shell signal
  const distinctHeadings = new Set(headings.map((h) => h.text)).size;
  const spaShellSuspect = distinctHeadings < 2 && mainText.length < 200 && realImgs.length === 0;

  // content hash for cross-page duplicate detection (detail == listing)
  const contentHash = `${headings.map((h) => h.text).join('|')}::${mainText.slice(0, 4000)}`;

  // code blocks: pre/code contents verbatim (stardust-style e2e finding — on a
  // developer-tool site the install commands are the most load-bearing content
  // and innerText body capture skips them). Visible pres only; innerText keeps
  // line structure.
  const codeBlocks = [...document.querySelectorAll('pre')].filter(vis)
    .map((el) => (el.innerText || '').trim()).filter(Boolean);

  // dynamic-surface evidence (DOM side): data blobs, hydration hints, forms.
  // Evidence only — prepare-migration Phase 4.5 classifies; merged with the
  // network-side recorder into `dynamic` by capturePage.
  const inlineData = [...document.querySelectorAll('script[type^="application/"][type*="json"],script#__NEXT_DATA__')]
    .filter((s) => !/ld\+json/i.test(s.type || ''))
    .slice(0, 20)
    .map((s) => {
      let keys = null;
      try { const j = JSON.parse(s.textContent); keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 12) : null; } catch { /* not parseable */ }
      return { id: s.id || null, type: s.type || null, bytes: (s.textContent || '').length, topLevelKeys: keys };
    });
  const globalState = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__remixContext', '__SVELTEKIT__', 'drupalSettings', 'wpApiSettings', 'Shopify', 'dataLayer']
    .filter((k) => { try { return k in window; } catch { return false; } });
  const q = (sel) => { try { return !!document.querySelector(sel); } catch { return false; } };
  const frameworkHints = [
    q('#__next') && 'next',
    q('#___gatsby') && 'gatsby',
    q('#__nuxt,#__layout') && 'nuxt',
    q('[data-reactroot],[data-reactid]') && 'react',
    q('[ng-version]') && 'angular',
    q('[data-v-app],[data-server-rendered]') && 'vue',
    q('[data-sveltekit-preload-data],[data-sveltekit-hydrate]') && 'sveltekit',
    q('astro-island') && 'astro',
    q('[data-turbo],[data-turbolinks]') && 'turbo',
    q('[data-wf-page],[data-wf-site]') && 'webflow',
    q('link[href*="/wp-content/"],script[src*="/wp-content/"]') && 'wordpress',
    q('script[src*="cdn.shopify.com"]') && 'shopify',
    q('.hs-form,[data-hs-forms-root],script[src*="hsforms"]') && 'hubspot-forms',
    q('script[src*="marketo"],form[id^="mktoForm"]') && 'marketo-forms',
    q('.aem-Grid,[data-cmp-is]') && 'aem-sites',
  ].filter(Boolean);
  const forms = [...document.querySelectorAll('form')].filter(vis).slice(0, 20).map((f) => {
    const inputs = [...f.querySelectorAll('input,select,textarea')].filter((i) => !['hidden', 'submit', 'button', 'reset'].includes((i.type || '').toLowerCase()));
    const names = inputs.map((i) => i.name || i.id || '').filter(Boolean);
    const rawAction = f.getAttribute('action');
    let action = null;
    try { action = new URL(rawAction || location.href, location.href); } catch { /* keep null */ }
    const search = f.getAttribute('role') === 'search'
      || inputs.some((i) => (i.type || '').toLowerCase() === 'search')
      || names.some((n) => /^(q|s|query|search|keyword|keywords|term)$/i.test(n))
      || (!!action && /search/i.test(action.pathname));
    return {
      action: action ? `${action.origin}${action.pathname}` : null,
      hasAction: !!rawAction, // no action attribute → almost always JS-submitted
      method: (f.getAttribute('method') || 'get').toLowerCase(),
      sameOrigin: action ? action.origin === location.origin : true,
      fieldCount: inputs.length,
      fieldNames: [...new Set(names)].slice(0, 12),
      search,
    };
  });
  const ariaLiveRegions = document.querySelectorAll('[aria-live]:not([aria-live="off"])').length;
  // reach signals for dynamics-detect --reach: modal-trigger markers and player ids per page
  const triggers = [...document.querySelectorAll('a, button')].map((el) => {
    const cls = el.getAttribute('class') || ''; const attrs = [...el.attributes].map((a) => a.name);
    const marker = (cls.match(/[\w-]*(modal|dialog|lightbox|popup)[\w-]*/i) || [])[0] || attrs.find((n) => /modal|dialog|lightbox|popup/i.test(n)) || (el.getAttribute('aria-haspopup') === 'dialog' ? 'aria-haspopup=dialog' : null);
    return marker && !/close|dismiss/i.test(cls) ? { marker, href: el.getAttribute('href') || null } : null;
  }).filter(Boolean).slice(0, 40);
  const mediaIds = [...document.querySelectorAll('video-js, [data-video-id], [data-videoid], iframe[src*="player" i]')].map((el) => el.getAttribute('data-video-id') || el.getAttribute('data-videoid') || el.getAttribute('src')).filter(Boolean).slice(0, 20);
  // wider reach signals (dynamics-detect --reach mints `reach-only` rows from these when no archetype finding
  // matches): tabs / expanders, open shadow roots, empty data-* config containers, form-less control groups,
  // search shells, player ids, chat loaders, federated modules, quizzes. Same evaluate — zero extra hits.
  const chrome = (el) => !!el.closest('header, nav, footer, [role=navigation], [role=banner], [role=contentinfo], [class*="header" i], [class*="footer" i], [class*="cookie" i], [id*="onetrust" i]');
  const firstCls = (el) => (el.getAttribute('class') || '').split(/\s+/)[0] || '';
  const tabs = {
    tablists: document.querySelectorAll('[role=tablist]').length,
    expanders: [...document.querySelectorAll('[aria-expanded]')].filter((el) => !chrome(el)).length,
  };
  const shadowHosts = [...document.querySelectorAll('*')].filter((el) => el.shadowRoot && (el.shadowRoot.textContent || '').trim().length > 40 && !chrome(el))
    .slice(0, 10).map((el) => ({ tag: el.tagName.toLowerCase(), cls: firstCls(el) }));
  const CONFIG_SKIP = /^(script|style|meta|link|img|input|br|hr|source|track|iframe|video|audio|canvas|svg|picture|template|noscript)$/;
  const emptyConfigContainers = [...document.querySelectorAll('[data-component],[data-endpoint],[data-api],[data-url],[data-src-url],[data-config],[data-props],[data-module],[data-widget],[data-app],[data-mount],[data-partner-id],[data-uiconf-id]')]
    .filter((el) => !CONFIG_SKIP.test(el.tagName.toLowerCase()) && !el.children.length && !(el.textContent || '').trim() && !chrome(el))
    .slice(0, 10).map((el) => ({ tag: el.tagName.toLowerCase(), attrs: [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 6) }));
  const looseControls = new Map();
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.closest('form') || chrome(el) || ['hidden', 'submit', 'button', 'password'].includes((el.type || '').toLowerCase()) || !vis(el)) continue;
    const root = el.closest('section, article, [class*="form" i], [data-component], main > div, main') || document.body;
    const key = root === document.body ? 'body' : `${root.tagName.toLowerCase()}.${firstCls(root)}`;
    looseControls.set(key, (looseControls.get(key) || 0) + 1);
  }
  const controlGroups = [...looseControls].filter(([, n]) => n >= 2).map(([container, controls]) => ({ container, controls })).slice(0, 10);
  const searchShell = (/(\/(search|suchen|sok|recherche|buscar|zoeken|ricerca)(\/|$)|[?&](q|query|s|search|keyword)=)/i.test(location.pathname + location.search) || !!document.querySelector('input[type=search]'))
    && mainText.length < 200;
  const players = [
    ...[...document.querySelectorAll('[id^="kaltura_player" i], [data-partner-id], [data-uiconf-id], .kWidgetIframeContainer')].map((el) => ({ vendor: 'kaltura', id: el.getAttribute('data-uiconf-id') || el.getAttribute('data-partner-id') || el.id })),
    ...[...document.querySelectorAll('video-js[data-account], [data-account][data-player]')].map((el) => ({ vendor: 'brightcove', id: `${el.getAttribute('data-account')}/${el.getAttribute('data-player') || 'default'}` })),
    ...[...document.querySelectorAll('.wistia_embed, [class*="wistia_async_"]')].map((el) => ({ vendor: 'wistia', id: ((el.getAttribute('class') || '').match(/wistia_async_([\w-]+)/) || [])[1] || null })),
  ].slice(0, 20);
  // chat markers mirror the `chat: live chat widget` row of dynamics/scripts/vendors.json (DOM side; the network side is thirdPartyScriptHosts)
  const CHAT_RE = /intercom|drift\.com|zendesk|zdassets|liveperson|salesforceliveagent|genesys|freshchat|tidio|livechatinc|olark|crisp\.chat/i;
  const chatLoaders = [...new Set([
    ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).filter((src) => CHAT_RE.test(src)).map((src) => { try { return new URL(src, location.href).host; } catch { return src.slice(0, 60); } }),
    ...[...document.querySelectorAll('#intercom-container, #drift-widget, [id*="livechat" i], [class*="chat-widget" i], [class*="live-chat" i], [id*="chat-launcher" i]')].map((el) => `${el.tagName.toLowerCase()}#${el.id || firstCls(el)}`),
  ])].slice(0, 6);
  const federated = {
    remoteEntries: [...document.querySelectorAll('script[src*="remoteEntry.js" i]')].map((s) => (s.getAttribute('src') || '').slice(0, 120)).slice(0, 6),
    registerCalls: [...document.querySelectorAll('script:not([src])')].filter((s) => /registerFederatedComponent\(/.test(s.textContent || '')).length,
  };
  const quiz = {
    markers: [...document.querySelectorAll('[class*="quiz" i], [class*="questionnaire" i], [data-quiz]')].filter((el) => !chrome(el)).length,
    radioFieldsets: [...document.querySelectorAll('fieldset')].filter((f) => f.querySelectorAll('input[type=radio]').length >= 3).length,
  };

  return {
    dynamicDom: { inlineData, globalState, frameworkHints, forms, ariaLiveRegions, triggers, mediaIds, tabs, shadowHosts, emptyConfigContainers, controlGroups, searchShell, players, chatLoaders, federated, quiz },
    finalUrl: location.href,
    title: document.title || null,
    description: meta('description'),
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image'), type: meta('og:type') },
    headings,
    body,
    codeBlocks,
    ctas,
    links,
    media: {
      imgs: realImgs,
      allImgCount: imgs.length,
      cssBackgrounds: [...new Set(cssBgs)],
      modals,
      videos: [...document.querySelectorAll('video')].filter(vis).map((v) => ({
        src: v.currentSrc || v.src || v.querySelector('source')?.src || null,
        poster: v.poster || null,
        autoplay: v.autoplay,
        loop: v.loop,
        muted: v.muted,
      })),
      iframes: [...document.querySelectorAll('iframe')].filter(vis).map((f) => ({
        src: f.src || null,
        title: f.title || null,
      })),
    },
    customProps,
    _signals: {
      filteredInterstitials: filtered,
      distinctHeadings,
      mainTextLen: mainText.length,
      realImageCount: realImgs.length,
      trackingOnlyMedia: imgs.length > 0 && realImgs.length === 0,
      spaShellSuspect,
    },
    _contentHash: contentHash,
  };
}

async function capturePage(context, url, slug, args) {
  const page = await context.newPage();
  const recorder = args.dynamics ? attachDynamicRecorder(page) : null; // opt-in; must precede goto — load-time fetches are the evidence
  try {
  let resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // response validation
  if (!resp) throw Object.assign(new Error('no response'), { errorClass: 'TimeoutError' });
  // bot-management challenge (Cloudflare cf-mitigated: challenge, etc.): the
  // worker's fresh context is re-challenged even after the probe cleared it.
  // Tier 3 only: give the interstitial its JS-solve window and reload before
  // validating. Tiers 1–2: one hit, fail loud — the page is recorded as a
  // BotChallengeError, never captured as content and never retried headless.
  if (args.solveWindow) resp = await clearChallenge(page, resp);
  if (isChallengeResponse(resp)) throw Object.assign(new Error(`bot challenge (HTTP ${resp.status()}) at tier ${args.tier} — not the page`), { errorClass: 'BotChallengeError' });
  let status = resp.status();
  // 404 on a slash variant: retry ONCE with the trailing slash flipped before
  // recording a failure (stardust-style e2e finding — slash-required hosts).
  let resolvedUrl = url;
  if (status === 404) {
    const u = new URL(url);
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.endsWith('/') ? u.pathname.replace(/\/+$/, '') : `${u.pathname}/`;
      // guarded + short timeout: a hanging flipped-variant probe must not
      // replace the crisp HTTPError 404 with a raw TimeoutError.
      const retry = await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => null);
      if (retry && retry.status() < 400) {
        console.error(`[crawl] slash-retry OK ${url} -> ${u.href}`);
        resp = retry; status = retry.status(); resolvedUrl = u.href;
      }
    }
  }
  if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { errorClass: 'HTTPError' });
  const ct = resp.headers()['content-type'] || '';
  if (!/text\/html|application\/xhtml/.test(ct)) throw Object.assign(new Error(`content-type ${ct}`), { errorClass: 'ContentTypeError' });

  const consentMethod = args.consent ? await dismissConsent(page) : 'skipped';
  await page.waitForTimeout(WAIT_MS[args.wait] || WAIT_MS.medium);
  // 4-step scroll to trigger lazy content
  for (let y = 0; y <= 1; y += 0.34) {
    await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), y);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  // settle after return-to-top: entry animations (hero reveals) must reach
  // their final state before the visibility filter reads computed opacity, or
  // the animated h1 is silently dropped. reducedMotion emulation neutralizes
  // most of it; the settle covers JS-driven reveals. Deliberately a FLAT wait:
  // gating on document.getAnimations() was tried and re-dropped the h1 — a
  // JS-delayed reveal has no running animation at check time, so the gate
  // resolves before the reveal even starts. The 800ms floor is load-bearing.
  await page.waitForTimeout(800);

  const rec = await page.evaluate(capture);
  // dynamic surface (opt-in): network recorder + DOM-side evidence → one `dynamic` section
  if (!recorder) delete rec.dynamicDom;
  else {
    const net = recorder.finish(rec.finalUrl || resolvedUrl);
    const dom = rec.dynamicDom;
    delete rec.dynamicDom;
    rec.dynamic = {
      ...net,
      ...dom,
      summary: {
        sameSiteEndpoints: net.endpoints.filter((e) => e.sameSite).length,
        thirdPartyEndpoints: net.endpoints.filter((e) => !e.sameSite).length,
        thirdPartyScriptHosts: net.thirdPartyScriptHosts.length,
        inlineDataBlobs: dom.inlineData.length,
        forms: dom.forms.length,
        searchForms: dom.forms.filter((f) => f.search).length,
        hydrated: dom.frameworkHints.length > 0 || dom.globalState.some((g) => g !== 'dataLayer'),
      },
    };
  }
  // rendered DOM sidecar — the settled document as the instrument saw it
  // (written by the caller as pages/<slug>.html; parse offline, never re-scrape).
  rec._renderedHtml = await page.content();
  // soft-404: empty page (no text, no headings, no media, no forms)
  if (!rec.headings.length && rec._signals.mainTextLen === 0 && rec._signals.realImageCount === 0) {
    throw Object.assign(new Error('empty page — possibly soft-404'), { errorClass: 'EmptyPageError' });
  }
  // full-page screenshot for the Phase 2.5 vision gate. Extremely tall pages
  // can exceed Playwright's raster limit — catch and retry viewport-only,
  // recording which mode was used in _signals.
  const shotsDir = path.join(args.out, 'assets', 'screenshots');
  await mkdir(shotsDir, { recursive: true });
  const shotPath = path.join(shotsDir, `${slug}.png`);
  let screenshotMode = 'fullPage';
  try {
    await page.screenshot({ path: shotPath, fullPage: true, timeout: 30000 });
  } catch {
    screenshotMode = 'viewport';
    try {
      await page.screenshot({ path: shotPath, fullPage: false, timeout: 30000 });
    } catch {
      screenshotMode = 'failed';
    }
  }
  rec.screenshot = screenshotMode === 'failed' ? null : `assets/screenshots/${slug}.png`;
  rec._signals.screenshotMode = screenshotMode;
  // live-render evidence per SKILL.md § Phase 2 / current-state-schema.md —
  // validateProvenance() downstream refuses pages without these five fields.
  if (resolvedUrl !== url) rec._resolvedUrl = resolvedUrl;
  rec._provenance = {
    renderedBy: 'playwright',
    fetchedAt: new Date().toISOString(),
    waitMode: args.wait || 'medium',
    waitMs: WAIT_MS[args.wait] || WAIT_MS.medium,
    httpStatus: status,
    // capture conditions — field names identical to replica's capture sidecar
    // (capture-sidecar.mjs) so the two records compare 1:1 (current-state-schema.md § Top-level shape)
    width: CRAWL_CONTEXT.viewport.width,
    dpr: await page.evaluate(() => window.devicePixelRatio || 1).catch(() => 1),
    technique: TIERS[(args.tier || 1) - 1],
    storageState: false, // every worker context is fresh — no admitted session is reused (SKILL.md Phase 2 step 3)
    variants: await collectVariants(page, context),
  };
  rec._consentMethod = consentMethod; // hoisted into _crawl-log.json#consent.method by the writer, not persisted per page
  return rec;
  } finally {
    // every exit path — success, validation throw, goto error — releases the
    // page, or failure-heavy crawls accumulate open tabs in the long-lived
    // worker context.
    await page.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = await import('playwright');
  const outPages = path.join(args.out, 'pages');
  await mkdir(outPages, { recursive: true });

  // previous run's log: re-runs start at the tier that worked last time
  // instead of rediscovering the block (merged back at the end).
  const logPath = path.join(args.out, '_crawl-log.json');
  const prev = existsSync(logPath) ? JSON.parse(await readFile(logPath, 'utf8')) : {};

  // bot-management probe on the entry URL, climbing the ladder on reject. Two
  // distinct reject modes both escalate:
  //   1. a network fingerprint block — the goto THROWS (isFingerprintBlock);
  //   2. a challenge / edge block — the goto SUCCEEDS but returns a 403/429/503
  //      interstitial (isChallengeResponse). This one previously slipped through
  //      the probe and only failed at capture-time (Cloudflare-fronted site finding).
  // Each tier gets ONE probe hit; the solve window runs at tier 3 only.
  let tier = Math.max(1, args.headed || 0, tierOf(prev.discovery?.fetchTechnique));
  let browser; let context; let probe;
  // with --pages the probe rides the first listed page — the entry URL is not
  // hit unless it is part of the ask.
  const probeUrl = args.pages?.length ? normalizeUrl(args.pages[0], args.url) : args.url;
  let botBlock = null; // 'fingerprint' | 'challenge'
  const escalations = []; // { tier, block } per rejected tier
  for (;;) {
    browser = await launchTier(chromium, tier);
    context = await newContext(browser, tier >= 2);
    probe = await context.newPage();
    let blocked = null;
    try {
      let probeResp = await probe.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: tier === 1 ? 30000 : 45000 });
      if (tier === 3) probeResp = await clearChallenge(probe, probeResp);
      if (isChallengeResponse(probeResp)) blocked = { kind: 'challenge', status: probeResp.status() };
    } catch (err) {
      if (isFingerprintBlock(err)) blocked = { kind: 'fingerprint' };
      else throw err;
    }
    if (!blocked) break;
    botBlock = blocked.kind;
    escalations.push({ tier: TIERS[tier - 1], block: blocked.kind });
    await browser.close();
    // Tier 3 + stealth + the solve window STILL challenged: do not capture the
    // interstitial as content — fail loud (exit 3). Only now may the run report
    // that the origin needs an interactive solve or a WAF allowlist.
    if (tier >= TIERS.length) {
      throw Object.assign(
        new Error(`bot-management challenge not cleared at tier 3 (${TIERS[2]}, entry status ${blocked.status ?? 'n/a'}) — the site requires an interactive challenge solve: re-run with STARDUST_HEADED_WINDOW=1 and complete it by hand`),
        { errorClass: 'BotChallengeError', nextTier: null },
      );
    }
    console.error(`[crawl] bot-management block (${blocked.kind}) at tier ${tier} (${TIERS[tier - 1]}) — escalating to tier ${tier + 1} (${TIERS[tier]})`);
    tier += 1;
  }
  let technique = TIERS[tier - 1];
  let stealth = tier >= 2;
  args.tier = tier;
  args.solveWindow = tier === 3;
  const offscreenNote = () => { if (args.tier === 3 && process.env.STARDUST_HEADED_WINDOW !== '1') console.error('[crawl] tier 3: Chrome window parked off-screen (STARDUST_HEADED_WINDOW=1 to show it)'); };
  offscreenNote();

  // adopt the post-redirect origin (apex→www etc.): the same-origin filter and
  // sitemap fetch must use where the site actually lives, or discovery silently
  // collapses to 1 page (agency-site e2e finding).
  let originRedirect = null;
  try {
    const landed = new URL(probe.url());
    if (landed.origin !== args.origin) {
      originRedirect = { from: args.origin, to: landed.origin };
      console.error(`[crawl] origin redirect ${args.origin} -> ${landed.origin} — adopting post-redirect origin`);
      args.url = new URL(new URL(args.url).pathname + new URL(args.url).search, landed.origin).href;
      args.origin = landed.origin;
    }
  } catch { /* keep declared origin */ }

  const urls = await discover(args, probe);
  const statePages = await readStatePages(args);
  // --refresh <slug,…>: a named slug outside this run's list is appended from
  // its state.json URL, so a capped-out page can be re-extracted by name.
  for (const slug of args.refresh) {
    const sp = statePages.get(slug);
    if (!sp) { console.error(`[crawl] WARN --refresh ${slug}: not in state.json — nothing to refresh by that name`); continue; }
    if (sp.url && !urls.some((u) => dedupeKey(u) === dedupeKey(normalizeUrl(sp.url)))) urls.push(normalizeUrl(sp.url));
  }
  // favicon rides the probe page (already on the entry URL) — runs in every
  // mode, so bounded extracts can't silently drop it (CEN-4).
  const favicon = await captureFavicon(probe, args);
  if (favicon) console.error(`[crawl] favicon captured: ${favicon.file} (${favicon.url})`);
  else console.error('[crawl] WARN no favicon captured — no link[rel~=icon] and /favicon.ico unreachable; deploy will ship the default icon unless one is provided');
  await probe.close();

  // scope: skip slugs already extracted (or beyond) unless --force, named by
  // --refresh, or explicitly listed with --pages (an explicit ask is never skipped).
  const allSlugs = assignSlugs(urls);
  const explicit = new Set((args.pages || []).map((p) => dedupeKey(normalizeUrl(p, args.url))));
  const skipped = [];
  const queue = urls.map((url, i) => ({ url, slug: allSlugs[i] })).filter(({ url, slug }) => {
    if (args.force || args.refresh.includes(slug) || explicit.has(dedupeKey(url))) return true;
    const sp = statePages.get(slug);
    if (sp && EXTRACTED_OR_BEYOND.has(sp.status)) { skipped.push({ slug, url, status: sp.status }); return false; }
    return true;
  });
  if (skipped.length) console.error(`[crawl] skipping ${skipped.length} already-extracted page(s) (--force or --refresh <slug> to redo): ${skipped.map((x) => x.slug).join(', ')}`);
  console.error(`[crawl] technique=${technique} discovered=${urls.length} queued=${queue.length}`);

  const startedAt = new Date().toISOString();
  const log = { discovery: { fetchTechnique: technique, count: urls.length, concurrency: args.concurrency, ...(botBlock ? { botBlock, escalations } : {}), ...(originRedirect ? { originRedirect } : {}), ...(skipped.length ? { skippedExtracted: skipped } : {}) }, consent: { method: args.consent ? 'none-detected' : 'skipped' }, favicon: favicon || null, crawl: { startedAt, finishedAt: null, successes: 0, failures: [] } };
  let ok = 0;
  await context.close();

  // worker pool: N parallel BrowserContexts drain the shared queue. Consent is
  // re-established per page (dismissConsent runs inside capturePage), so each
  // fresh context is covered without cross-context cookie sharing.
  // During capture we only RECORD content hashes (indexed by queue position);
  // duplicate attribution happens in a deterministic post-pass below.
  // Per-page escalation: the challenge re-fires per context, so a worker can be
  // challenged after the probe cleared (tiers 1–2). The first such error stops
  // the pool pulling new pages, the browser relaunches one tier up and every
  // unfinished page is requeued — one extra pass, one hit per challenged page
  // per tier. At tier 3 a challenge is a terminal per-page failure.
  const results = new Array(queue.length).fill(null); // { slug, file, hash } per queue index
  const dynamicRollup = newDynamicRollup();
  const pending = new Set(queue.map((_, i) => i)); // neither captured nor terminally failed
  let escalate = 0; // next tier to relaunch at, set by the first challenged worker
  async function runPool() {
    const order = [...pending];
    let cursor = 0;
    escalate = 0;
    async function worker() {
      const ctx = await newContext(browser, stealth);
      while (cursor < order.length && !escalate) {
        const idx = order[cursor];
        cursor += 1;
        const { url, slug } = queue[idx];
        try {
          const rec = await capturePage(ctx, url, slug, args);
          if (consentRank(rec._consentMethod) > consentRank(log.consent.method)) log.consent.method = rec._consentMethod;
          delete rec._consentMethod;
          if (rec.dynamic) rollupDynamic(dynamicRollup, rec.dynamic, slug);
          const hash = crypto.createHash('sha1').update(rec._contentHash).digest('hex');
          delete rec._contentHash;
          // slash-retry rescue: record the URL that actually served the page and
          // an audit-trail entry — downstream consumers of `url` must not re-hit
          // the 404 variant the crawler already learned to avoid.
          const recordUrl = rec._resolvedUrl || url;
          if (rec._resolvedUrl) {
            log.crawl.slashRetries = log.crawl.slashRetries || [];
            log.crawl.slashRetries.push({ requested: url, resolved: rec._resolvedUrl, slug });
            delete rec._resolvedUrl;
          }
          const file = path.join(outPages, `${slug}.json`);
          const htmlFile = path.join(outPages, `${slug}.html`);
          await writeFile(htmlFile, rec._renderedHtml);
          delete rec._renderedHtml;
          rec.renderedHtml = `pages/${slug}.html`;
          const { _provenance, ...rest } = rec;
          // top-level renderedBy/fetchedAt are legacy-reader aliases of the same
          // _provenance fields — _provenance is the authoritative contract.
          await writeFile(file, JSON.stringify({ _provenance, slug, url: recordUrl, renderedBy: _provenance.renderedBy, fetchedAt: _provenance.fetchedAt, ...rest }, null, 2));
          results[idx] = { slug, file, hash };
          pending.delete(idx);
          ok += 1;
          const s = rec._signals;
          const dy = rec.dynamic?.summary || {};
          const warn = [s.spaShellSuspect && 'SPA-SHELL?', s.trackingOnlyMedia && 'TRACKING-PIXEL-ONLY', s.filteredInterstitials && `filtered:${s.filteredInterstitials}`, dy.sameSiteEndpoints && `data-endpoints:${dy.sameSiteEndpoints}`, dy.searchForms && 'SEARCH-FORM', dy.hydrated && 'HYDRATED'].filter(Boolean).join(' ');
          console.error(`[crawl] OK   ${slug}  ${warn}`);
        } catch (err) {
          if (err.errorClass === 'BotChallengeError' && args.tier < TIERS.length) {
            if (!escalate) console.error(`[crawl] bot challenge at tier ${args.tier} (${TIERS[args.tier - 1]}) on ${slug} — draining the pool, escalating to tier ${args.tier + 1} (${TIERS[args.tier]}) and requeuing the unfinished pages`);
            escalate = args.tier + 1; // idx stays pending → retried one tier up
            continue;
          }
          pending.delete(idx);
          const hint = err.errorClass === 'BotChallengeError' ? ' — tier 3 still challenged: interactive solve needed (STARDUST_HEADED_WINDOW=1) or an allowlist' : '';
          log.crawl.failures.push({ url, slug, errorClass: err.errorClass || 'Error', message: `${String(err.message || err)}${hint}`, at: new Date().toISOString() });
          console.error(`[crawl] FAIL ${slug}  ${err.errorClass || 'Error'}: ${err.message}${hint}`);
        }
      }
      await ctx.close();
    }
    await Promise.all(Array.from({ length: Math.min(args.concurrency, order.length) }, worker));
  }
  for (;;) {
    await runPool();
    await browser.close();
    if (!escalate) break;
    botBlock = botBlock || 'challenge';
    escalations.push({ tier: TIERS[args.tier - 1], block: 'challenge', at: 'capture' });
    args.tier = escalate;
    args.solveWindow = escalate === 3;
    stealth = true;
    technique = TIERS[escalate - 1];
    browser = await launchTier(chromium, escalate);
    offscreenNote();
  }
  // the tier that actually captured is the one re-runs and downstream
  // instruments start at (ia-extraction.md § _crawl-log.json shape)
  log.discovery.fetchTechnique = technique;
  if (botBlock) Object.assign(log.discovery, { botBlock, escalations });

  // cross-page duplicate (detail == listing) detection — deterministic post-pass
  // in original queue order: canonical = earliest-QUEUED page per content hash
  // (not whichever finished first under the pool); later ones marked duplicateOf.
  const canonicalByHash = new Map();
  for (const r of results) {
    if (!r) continue;
    if (!canonicalByHash.has(r.hash)) { canonicalByHash.set(r.hash, r.slug); continue; }
    const canonical = canonicalByHash.get(r.hash);
    const rec = JSON.parse(await readFile(r.file, 'utf8'));
    rec._signals = rec._signals || {};
    rec._signals.duplicateOf = canonical;
    await writeFile(r.file, JSON.stringify(rec, null, 2));
    console.error(`[crawl] DUP  ${r.slug}  DUP-OF:${canonical}`);
  }
  if (args.dynamics) {
    log.dynamicSurface = finalizeDynamic(dynamicRollup);
    console.error(`[crawl] dynamic surface (reach): ${log.dynamicSurface.endpoints.filter((e) => e.sameSite).length} same-site data endpoints, ${log.dynamicSurface.pagesWithSearchForm} pages with a search form, ${log.dynamicSurface.pagesHydrated} hydrated — depth + classification: stardust:dynamics`);
  }
  // merge into the existing _crawl-log.json (mergeCrawlLog — append-only across runs)
  const failedNow = new Set(log.crawl.failures.map((x) => x.slug));
  log.crawl.successes = ok;
  log.crawl.finishedAt = new Date().toISOString();
  const merged = mergeCrawlLog(prev, log, {
    at: startedAt,
    args: { url: args.url, pages: args.pages || null, cap: args.capLabel, wait: args.wait, concurrency: args.concurrency, dynamics: args.dynamics, refresh: args.refresh, force: args.force, headed: args.headed || null },
    technique,
    discovered: urls.length,
    skipped: skipped.length,
    captured: ok,
    failed: [...failedNow],
  }, results.filter(Boolean).map((r) => r.slug));
  await writeFile(logPath, JSON.stringify(merged, null, 2));
  console.error(`[crawl] done. ${ok}/${queue.length} captured, ${failedNow.size} failed (${merged.crawl.failures.length} open across runs). log: ${logPath}`);
}

/**
 * Merge one invocation's log into the previous _crawl-log.json — append-only
 * across runs (ia-extraction.md § _crawl-log.json shape is the rule):
 *   * crawl.failures = union of earlier failures and this run's, minus slugs
 *     that succeeded now (a failed page keeps its previous record on disk —
 *     nothing here deletes files);
 *   * discovery never shrinks: a --pages / narrower re-run keeps the earlier
 *     block and refreshes only the ladder fields;
 *   * runs[] gets one entry per invocation (args, counts, failed slugs).
 * `okSlugs` = the slugs captured in this run.
 */
export function mergeCrawlLog(prev, log, run, okSlugs) {
  const failedNow = new Set(log.crawl.failures.map((x) => x.slug));
  const okNow = new Set(okSlugs);
  const carried = (prev.crawl?.failures || []).filter((x) => !okNow.has(x.slug) && !failedNow.has(x.slug));
  // _provenance is the first key of every stardust artifact (master skill § Provenance); the script owns this file.
  const { _provenance: prevProv, ...prevRest } = prev;
  const readArtifacts = [...new Set([...(prevProv && prevProv.readArtifacts) || [], log.discovery && log.discovery.sourceUrl].filter(Boolean))];
  const merged = { _provenance: { writtenBy: 'stardust:extract', writtenAt: new Date().toISOString(), script: 'crawl.mjs', readArtifacts }, ...prevRest, ...log, crawl: { ...log.crawl, failures: [...carried, ...log.crawl.failures] } };
  if (prev.discovery && (prev.discovery.count || 0) > (log.discovery.count || 0)) {
    const { botBlock, escalations } = log.discovery;
    merged.discovery = { ...prev.discovery, fetchTechnique: log.discovery.fetchTechnique, ...(botBlock ? { botBlock, escalations } : {}) };
  }
  merged.runs = [...(Array.isArray(prev.runs) ? prev.runs : []), run];
  return merged;
}

// run only as the entry script — importing the module (fixture tests) runs nothing
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  main().catch((e) => { console.error(`[crawl] fatal: ${e.errorClass || 'Error'}: ${e.message}`); process.exit(e.errorClass === 'BotChallengeError' ? 3 : 2); });
}
