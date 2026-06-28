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
 *
 * Usage:
 *   node crawl.mjs --url https://example.com [--pages a,b,c] [--max 25] \
 *     [--out stardust/current] [--wait medium] [--no-consent-dismiss]
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
  const a = { out: 'stardust/current', max: 25, wait: 'medium', consent: true };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--url') a.url = argv[(i += 1)];
    else if (k === '--pages') a.pages = argv[(i += 1)].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = argv[(i += 1)];
    else if (k === '--max') a.max = Math.max(1, +argv[(i += 1)] || 25);
    else if (k === '--wait') a.wait = argv[(i += 1)];
    else if (k === '--no-consent-dismiss') a.consent = false;
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

// ---- discovery: explicit pages > sitemap (validated) > BFS from nav ----
async function discover(args, page) {
  if (args.pages) return args.pages.map((p) => new URL(p, args.url).href).slice(0, args.max);
  // sitemap.xml — but only trust it if it has >=1 <loc> (a 200-but-empty Drupal
  // sitemap must fall through to BFS — finding from the paramount run).
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const xml = await page.evaluate(async (u) => {
        const r = await fetch(u); return r.ok ? r.text() : '';
      }, new URL(sm, args.origin).href);
      const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
      if (locs.length >= 1) return [...new Set(locs)].filter((u) => u.startsWith(args.origin)).slice(0, args.max);
    } catch { /* fall through */ }
  }
  // BFS depth-1 from the entry page's same-origin nav links.
  const links = await page.evaluate((origin) => [...document.querySelectorAll('a[href]')]
    .map((a) => a.href).filter((h) => h.startsWith(origin)), args.origin);
  return [...new Set([args.url, ...links])].slice(0, args.max);
}

async function dismissConsent(page) {
  const sels = ['#onetrust-accept-btn-handler', '.truste-button2', '[aria-label*="Accept" i]',
    'button[id*="accept" i]', 'button[class*="accept" i]'];
  for (const s of sels) {
    const el = await page.$(s);
    if (el) { await el.click().catch(() => {}); await page.waitForTimeout(300); break; }
  }
  // assert: prune any consent container still present (don't leave it for capture).
  await page.evaluate(() => {
    document.querySelectorAll('#onetrust-banner-sdk, #truste-consent-track, [class*="cookie" i][class*="banner" i], [id*="consent" i]')
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
  const customProps = Object.fromEntries(Array.from(document.documentElement.style)
    .filter((p) => p.startsWith('--')).map((p) => [p, getComputedStyle(document.documentElement).getPropertyValue(p).trim()]));

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
    media: { imgs: realImgs, allImgCount: imgs.length, cssBackgrounds: [...new Set(cssBgs)], modals },
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

async function capturePage(context, url, args) {
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

  const urls = await discover(args, probe);
  await probe.close();
  console.error(`[crawl] technique=${technique} pages=${urls.length}`);

  const log = { discovery: { fetchTechnique: technique, count: urls.length }, consent: { method: args.consent ? 'auto' : 'skipped' }, crawl: { failures: [] } };
  const byHash = new Map();
  let ok = 0;
  for (const url of urls) {
    const slug = slugify(url);
    try {
      const rec = await capturePage(context, url, args);
      // cross-page duplicate (detail == listing) detection
      const h = crypto.createHash('sha1').update(rec._contentHash).digest('hex');
      if (byHash.has(h)) rec._signals.duplicateOf = byHash.get(h);
      else byHash.set(h, slug);
      delete rec._contentHash;
      await writeFile(path.join(outPages, `${slug}.json`), JSON.stringify({ slug, url, renderedBy: 'playwright', fetchedAt: new Date().toISOString(), ...rec }, null, 2));
      ok += 1;
      const s = rec._signals;
      const warn = [s.spaShellSuspect && 'SPA-SHELL?', s.duplicateOf && `DUP-OF:${s.duplicateOf}`, s.trackingOnlyMedia && 'TRACKING-PIXEL-ONLY', s.filteredInterstitials && `filtered:${s.filteredInterstitials}`].filter(Boolean).join(' ');
      console.error(`[crawl] OK   ${slug}  ${warn}`);
    } catch (err) {
      log.crawl.failures.push({ url, slug, errorClass: err.errorClass || 'Error', message: String(err.message || err), at: new Date().toISOString() });
      console.error(`[crawl] FAIL ${slug}  ${err.errorClass || 'Error'}: ${err.message}`);
    }
  }
  await browser.close();
  // merge into existing _crawl-log.json if present
  const logPath = path.join(args.out, '_crawl-log.json');
  const prev = existsSync(logPath) ? JSON.parse(await readFile(logPath, 'utf8')) : {};
  await writeFile(logPath, JSON.stringify({ ...prev, ...log }, null, 2));
  console.error(`[crawl] done. ${ok}/${urls.length} captured, ${log.crawl.failures.length} failed. log: ${logPath}`);
}

main().catch((e) => { console.error(`[crawl] fatal: ${e.message}`); process.exit(2); });
