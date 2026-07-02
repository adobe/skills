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

// ---- bot-management fallback: headless first, headed real Chrome on H2 reject ----
async function launchWithFallback() {
  const headless = await chromium.launch({ headless: true });
  return { browser: headless, technique: 'headless' };
}
function isFingerprintBlock(err) {
  const m = String(err && err.message || err);
  return /ERR_HTTP2_PROTOCOL_ERROR|ERR_QUIC_PROTOCOL_ERROR|ERR_CONNECTION_RESET|net::ERR/.test(m);
}

// ---- URL normalization: one canonical form for entry, --pages, sitemap, BFS ----
// resolve against base, strip hash, keep query, normalize trailing slash
// (non-root paths lose it) so `/about`, `/about/` and `/about#team` dedupe.
function normalizeUrl(u, base) {
  const url = new URL(u, base);
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.href;
}

// ---- discovery: explicit pages > sitemap (validated) > BFS from nav ----
async function discover(args, page) {
  const entry = normalizeUrl(args.url);
  // explicit --pages: NEVER drop a listed page. The entry URL is ADDED on top
  // (the effective cap grows by one when needed); if the total still exceeds
  // --max, warn instead of silently evicting a requested page.
  if (args.pages) {
    const listed = [...new Set(args.pages.map((p) => normalizeUrl(p, args.url)))];
    const urls = listed.includes(entry) ? listed : [entry, ...listed];
    if (urls.length > args.max) {
      console.error(`[crawl] WARN --pages lists ${listed.length} page(s); with the entry URL the total is ${urls.length}, exceeding --max ${args.max} — crawling all of them (explicitly listed pages are never dropped)`);
    }
    return urls;
  }
  // discovered lists (sitemap/BFS): entry always included, normalized dedupe, capped at --max.
  const withEntry = (list) => [...new Set([entry, ...list.map((u) => normalizeUrl(u, args.origin))])].slice(0, args.max);
  // sitemap.xml — but only trust it if it has >=1 <loc> (a 200-but-empty Drupal
  // sitemap must fall through to BFS — finding from the paramount run).
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const xml = await page.evaluate(async (u) => {
        const r = await fetch(u); return r.ok ? r.text() : '';
      }, new URL(sm, args.origin).href);
      const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
      if (locs.length >= 1) return withEntry(locs.filter((u) => u.startsWith(args.origin)));
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

  return {
    finalUrl: location.href,
    title: document.title || null,
    description: meta('description'),
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image'), type: meta('og:type') },
    headings,
    body,
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
  await page.setViewportSize({ width: 1440, height: 900 });
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // response validation
  if (!resp) throw Object.assign(new Error('no response'), { errorClass: 'TimeoutError' });
  const status = resp.status();
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

  const rec = await page.evaluate(capture);
  // soft-404: empty page (no text, no headings, no media, no forms)
  if (!rec.headings.length && rec._signals.mainTextLen === 0 && rec._signals.realImageCount === 0) {
    await page.close();
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
  rec._provenance = {
    renderedBy: 'playwright',
    fetchedAt: new Date().toISOString(),
    waitMode: args.wait || 'medium',
    waitMs: WAIT_MS[args.wait] || WAIT_MS.medium,
    httpStatus: status,
  };
  await page.close();
  return rec;
}

async function main() {
  const args = parseArgs(process.argv);
  const outPages = path.join(args.out, 'pages');
  await mkdir(outPages, { recursive: true });

  let { browser, technique } = await launchWithFallback();
  let context = await browser.newContext();
  let probe = await context.newPage();

  // bot-management probe on the entry URL; switch to headed real Chrome on reject.
  try {
    await probe.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    if (isFingerprintBlock(err)) {
      await browser.close();
      console.error('[crawl] fingerprint block — switching to headed real Chrome (channel:chrome)');
      browser = await chromium.launch({ headless: false, channel: 'chrome' });
      technique = 'headed-chrome';
      context = await browser.newContext();
      probe = await context.newPage();
      await probe.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } else throw err;
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

  const log = { discovery: { fetchTechnique: technique, count: urls.length, concurrency: args.concurrency, ...(originRedirect ? { originRedirect } : {}) }, consent: { method: args.consent ? 'auto' : 'skipped' }, crawl: { failures: [] } };
  let ok = 0;
  await context.close();

  // worker pool: N parallel BrowserContexts drain the shared queue. Consent is
  // re-established per page (dismissConsent runs inside capturePage), so each
  // fresh context is covered without cross-context cookie sharing.
  // During capture we only RECORD content hashes (indexed by queue position);
  // duplicate attribution happens in a deterministic post-pass below.
  const results = new Array(urls.length).fill(null); // { slug, file, hash } per queue index
  let nextIdx = 0;
  async function worker() {
    const ctx = await browser.newContext();
    while (nextIdx < urls.length) {
      const idx = nextIdx;
      nextIdx += 1;
      const url = urls[idx];
      const slug = slugify(url);
      try {
        const rec = await capturePage(ctx, url, slug, args);
        const hash = crypto.createHash('sha1').update(rec._contentHash).digest('hex');
        delete rec._contentHash;
        const file = path.join(outPages, `${slug}.json`);
        const { _provenance, ...rest } = rec;
        await writeFile(file, JSON.stringify({ _provenance, slug, url, renderedBy: _provenance.renderedBy, fetchedAt: _provenance.fetchedAt, ...rest }, null, 2));
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
