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
 *   - SCREENSHOT: a full-page PNG per page under <out>/assets/screenshots/<slug>.png
 *     (viewport-only fallback on extremely tall pages; mode in _signals.screenshotMode,
 *     relative path in the page record's `screenshot` field) — feeds the extract
 *     SKILL.md Phase 2.5 vision gate.
 *
 * Usage:
 *   node crawl.mjs --url https://example.com [--pages a,b,c] [--max 25] \
 *     [--out stardust/current] [--wait medium] [--no-consent-dismiss] \
 *     [--concurrency 4]
 *
 * Needs playwright importable from the project (see extract/SKILL.md Setup —
 * `npm i -D playwright` or the Playwright MCP server; the `npx playwright`
 * availability probe alone does NOT make the ESM module importable).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const WAIT_MS = { fast: 1200, medium: 2500, slow: 5000 };

// One context config for probe, headed fallback, and workers — a tweak (locale,
// UA, colorScheme) must land everywhere or discovery renders under different
// conditions than capture. Viewport here also saves a per-page CDP round-trip.
const CRAWL_CONTEXT = { reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } };

function parseArgs(argv) {
  const a = { out: 'stardust/current', max: 25, wait: 'medium', consent: true, concurrency: 4 };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--url') a.url = argv[(i += 1)];
    else if (k === '--pages') a.pages = argv[(i += 1)].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = argv[(i += 1)];
    else if (k === '--max') a.max = Math.max(1, +argv[(i += 1)] || 25);
    else if (k === '--wait') a.wait = argv[(i += 1)];
    else if (k === '--no-consent-dismiss') a.consent = false;
    else if (k === '--concurrency') a.concurrency = Math.max(1, +argv[(i += 1)] || 4);
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.url) throw new Error('--url is required');
  a.origin = new URL(a.url).origin;
  return a;
}

const slugify = (u) => {
  const { pathname } = new URL(u);
  const s = pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return s || 'index';
};

// Slugs key the output FILES (pages/<slug>.json, screenshots/<slug>.png), but
// distinct pages can collide on one slug: dedupeKey keeps url.search (so
// /p?a=1 and /p?a=2 are two pages) while slugify reads pathname only, and
// /about-us vs /about/us flatten identically. Without disambiguation two
// concurrent workers write the same files (silent last-writer-wins) and the
// duplicate post-pass can mark a page duplicateOf itself. Assign slugs once,
// up front: first claimant keeps the clean slug, later distinct pages get a
// deterministic -<hash4> suffix.
function assignSlugs(urls) {
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

// ---- bot-management fallback: headless first, headed real Chrome on reject ----
async function launchWithFallback() {
  const headless = await chromium.launch({ headless: true });
  return { browser: headless, technique: 'headless' };
}
// Stealth-hardened headed real Chrome. Headed alone clears TLS/H2-fingerprint
// blocks, but Cloudflare's *managed challenge* also probes for automation
// signals — clearing it needs the automation flags stripped (sagora.com e2e
// finding). `--disable-blink-features=AutomationControlled` +
// dropping `--enable-automation` + the navigator.webdriver spoof (applied
// per-context in newContext) are what let the non-interactive challenge solve.
const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];
async function launchHeadedStealth() {
  return chromium.launch({
    headless: false,
    channel: 'chrome',
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  });
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
  // explicit --pages: NEVER drop a listed page. The entry URL is ADDED on top
  // (the effective cap grows by one when needed); if the total still exceeds
  // --max, warn instead of silently evicting a requested page.
  if (args.pages) {
    const seen = new Set();
    const listed = args.pages.map((p) => normalizeUrl(p, args.url))
      .filter((u) => { const k = dedupeKey(u); if (seen.has(k)) return false; seen.add(k); return true; });
    const entryKey = dedupeKey(entry);
    const urls = listed.some((u) => dedupeKey(u) === entryKey) ? listed : [entry, ...listed];
    if (urls.length > args.max) {
      console.error(`[crawl] WARN --pages lists ${listed.length} page(s); with the entry URL the total is ${urls.length}, exceeding --max ${args.max} — crawling all of them (explicitly listed pages are never dropped)`);
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
  // sitemap must fall through to BFS — finding from the paramount run).
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

async function dismissConsent(page) {
  const sels = ['#onetrust-accept-btn-handler', '.truste-button2', '[aria-label*="Accept" i]',
    'button[id*="accept" i]', 'button[class*="accept" i]'];
  for (const s of sels) {
    const el = await page.$(s);
    if (el) { await el.click().catch(() => {}); await page.waitForTimeout(300); break; }
  }
  // Usercentrics renders inside shadow DOM (#usercentrics-root) — regular
  // selectors can't reach it (festool e2e finding).
  await page.evaluate(() => {
    const root = document.querySelector('#usercentrics-root')?.shadowRoot;
    if (root) {
      const btn = root.querySelector('[data-testid="uc-deny-all-button"], [data-testid="uc-accept-all-button"]');
      if (btn) btn.click();
    }
  }).catch(() => {});
  await page.waitForTimeout(300);
  // assert: prune any consent container still present (don't leave it for capture).
  await page.evaluate(() => {
    document.querySelectorAll('#onetrust-banner-sdk, #truste-consent-track, #usercentrics-root, [class*="cookie" i][class*="banner" i], [id*="consent" i]')
      .forEach((n) => n.remove());
  });
}

// ---- the capture, run in-page; returns the per-page record + hardening signals ----
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
  }).map((h) => ({ tag: h.tagName.toLowerCase(), text: text(h) })).filter((h) => h.text);

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

  return {
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
  try {
  let resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // response validation
  if (!resp) throw Object.assign(new Error('no response'), { errorClass: 'TimeoutError' });
  // bot-management challenge (Cloudflare cf-mitigated: challenge, etc.): the
  // worker's fresh context is re-challenged even after the probe cleared it, so
  // give the interstitial its JS-solve window and reload before validating —
  // otherwise a solvable 403 is thrown as a fatal HTTPError.
  resp = await clearChallenge(page, resp);
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

  if (args.consent) await dismissConsent(page);
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
  };
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
  const outPages = path.join(args.out, 'pages');
  await mkdir(outPages, { recursive: true });

  let stealth = false;
  let { browser, technique } = await launchWithFallback();
  let context = await newContext(browser, stealth);
  let probe = await context.newPage();

  // bot-management probe on the entry URL; switch to headed real Chrome on reject.
  // Two distinct reject modes must both trigger the fallback:
  //   1. a network fingerprint block — the goto THROWS (isFingerprintBlock);
  //   2. a challenge / edge block — the goto SUCCEEDS but returns a 403/429/503
  //      interstitial (isChallengeResponse). This one previously slipped through
  //      the probe and only failed at capture-time (sagora.com Cloudflare finding).
  let botBlock = null; // 'fingerprint' | 'challenge'
  try {
    const probeResp = await probe.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (isChallengeResponse(probeResp)) botBlock = 'challenge';
  } catch (err) {
    if (isFingerprintBlock(err)) botBlock = 'fingerprint';
    else throw err;
  }
  if (botBlock) {
    await browser.close();
    console.error(`[crawl] bot-management block (${botBlock}) — switching to headed real Chrome (channel:chrome) with stealth hardening`);
    browser = await launchHeadedStealth();
    technique = 'headed-chrome-stealth';
    stealth = true;
    context = await newContext(browser, stealth);
    probe = await context.newPage();
    let probeResp = await probe.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    probeResp = await clearChallenge(probe, probeResp);
    // If headed + stealth + the challenge-solve window STILL can't clear it, do
    // not proceed to capture the interstitial as if it were content — surface a
    // clear, actionable failure (this is stop-condition (a) for the skill).
    if (isChallengeResponse(probeResp)) {
      await browser.close();
      throw Object.assign(
        new Error(`bot-management challenge not cleared after headed real-Chrome + stealth fallback (entry status ${probeResp ? probeResp.status() : 'n/a'}) — the site requires an interactive challenge solve; run against it in a headed session you can complete by hand`),
        { errorClass: 'BotChallengeError' },
      );
    }
  }

  // adopt the post-redirect origin (apex→www etc.): the same-origin filter and
  // sitemap fetch must use where the site actually lives, or discovery silently
  // collapses to 1 page (sliccy e2e finding).
  let originRedirect = null;
  try {
    const landed = new URL(probe.url());
    if (landed.origin !== args.origin) {
      originRedirect = { from: args.origin, to: landed.origin };
      console.error(`[crawl] origin redirect ${args.origin} -> ${landed.origin} — adopting post-redirect origin`);
      args.origin = landed.origin;
      args.url = landed.href;
    }
  } catch { /* keep declared origin */ }

  const urls = await discover(args, probe);
  await probe.close();
  console.error(`[crawl] technique=${technique} pages=${urls.length}`);

  const log = { discovery: { fetchTechnique: technique, count: urls.length, concurrency: args.concurrency, ...(botBlock ? { botBlock } : {}), ...(originRedirect ? { originRedirect } : {}) }, consent: { method: args.consent ? 'auto' : 'skipped' }, crawl: { failures: [] } };
  let ok = 0;
  await context.close();

  // worker pool: N parallel BrowserContexts drain the shared queue. Consent is
  // re-established per page (dismissConsent runs inside capturePage), so each
  // fresh context is covered without cross-context cookie sharing.
  // During capture we only RECORD content hashes (indexed by queue position);
  // duplicate attribution happens in a deterministic post-pass below.
  const results = new Array(urls.length).fill(null); // { slug, file, hash } per queue index
  const slugs = assignSlugs(urls);
  let nextIdx = 0;
  async function worker() {
    const ctx = await newContext(browser, stealth);
    while (nextIdx < urls.length) {
      const idx = nextIdx;
      nextIdx += 1;
      const url = urls[idx];
      const slug = slugs[idx];
      try {
        const rec = await capturePage(ctx, url, slug, args);
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
        const { _provenance, ...rest } = rec;
        // top-level renderedBy/fetchedAt are legacy-reader aliases of the same
        // _provenance fields — _provenance is the authoritative contract.
        await writeFile(file, JSON.stringify({ _provenance, slug, url: recordUrl, renderedBy: _provenance.renderedBy, fetchedAt: _provenance.fetchedAt, ...rest }, null, 2));
        results[idx] = { slug, file, hash };
        ok += 1;
        const s = rec._signals;
        const warn = [s.spaShellSuspect && 'SPA-SHELL?', s.trackingOnlyMedia && 'TRACKING-PIXEL-ONLY', s.filteredInterstitials && `filtered:${s.filteredInterstitials}`].filter(Boolean).join(' ');
        console.error(`[crawl] OK   ${slug}  ${warn}`);
      } catch (err) {
        log.crawl.failures.push({ url, slug, errorClass: err.errorClass || 'Error', message: String(err.message || err), at: new Date().toISOString() });
        console.error(`[crawl] FAIL ${slug}  ${err.errorClass || 'Error'}: ${err.message}`);
      }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, urls.length) }, worker));
  await browser.close();

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
  // merge into existing _crawl-log.json if present
  const logPath = path.join(args.out, '_crawl-log.json');
  const prev = existsSync(logPath) ? JSON.parse(await readFile(logPath, 'utf8')) : {};
  await writeFile(logPath, JSON.stringify({ ...prev, ...log }, null, 2));
  console.error(`[crawl] done. ${ok}/${urls.length} captured, ${log.crawl.failures.length} failed. log: ${logPath}`);
}

main().catch((e) => { console.error(`[crawl] fatal: ${e.message}`); process.exit(2); });
