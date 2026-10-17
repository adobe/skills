#!/usr/bin/env node
/**
 * skills/replica/scripts/measure.mjs
 *
 * Box-by-box measurement for the stardust:replica RECREATE phase: for a
 * caller-supplied selector list, at one or more viewport widths, the rect
 * (x, y, w, h — page-absolute, rounded), visibility, a text snippet and a
 * computed-style group of each match — on one page, or on two pages with a
 * delta line per selector (the live page against its served prototype).
 * Every width also gets ONE root line per side — `document.documentElement`'s
 * scrollWidth beside its scrollHeight and the viewport width — so horizontal
 * overflow is a number on the table, never a residual (a recorded hands-off
 * run delivered two pages 373 and 400 px wide at a 360 viewport and passed
 * them; this root line is for ad-hoc reads — gate.sh's hard assert reads
 * stitch-shot's `overflow:` line: the same three quantities, read on the
 * stitched page after its chunk loop, back at the top and at rest). An
 * `<img>` (or `<picture>`) match additionally reports the rendition the browser selected —
 * naturalWidth × naturalHeight and the current source file — so a
 * per-breakpoint rendition mismatch (live 400 px at 360, build 1600) is named
 * instead of read as a sub-pixel layout bug.
 *
 * Why: comparing a section of the live page with its prototype needs exactly
 * this — rects + computed values for a few selectors at one width — and no
 * shipped script did it (anchor.mjs prints section y/height only,
 * sibling-variance.mjs diffs siblings, chrome-parity.mjs is header/footer
 * specific). Recorded: one run authored the same probe twice in two sessions.
 * This is the shipped one; the selectors are yours, the script embeds none.
 *
 * Usage:
 *   node skills/replica/scripts/measure.mjs <url> --selectors "<css>[,<css>…]" [options]
 *     --selectors <list>   comma-separated CSS selectors (required). A selector that
 *                          itself needs a comma (`:is(a, b)`) cannot be passed — write
 *                          it without the comma or as two selectors
 *     --width <px[,px…]>   viewport width(s); repeatable or comma-separated (default 1440)
 *     --props <list>       computed properties to read, camelCase, comma-separated —
 *                          REPLACES the default list (display, position, boxSizing, width,
 *                          height, maxWidth, margin, padding, gap, backgroundColor, backgroundImage,
 *                          color, fontFamily, fontSize, fontWeight, lineHeight,
 *                          letterSpacing, textTransform, textAlign, borderRadius, border,
 *                          boxShadow, opacity, objectFit). backgroundImage is measured
 *                          because a recorded recreate step transcribed a nav's rules and
 *                          dropped every `background-image: url(…)` (flag icons) — the
 *                          --against diff could not name what it had not measured. boxSizing is
 *                          measured because the box model is a lifted value: a recorded run's
 *                          replica inherited a universal border-box reset over content-box source
 *                          grids (chrome −9 px, a row −106 px at 360) with every prototype gated
 *                          ≤ 0.1 % — the --against diff names the fork per box
 *     --against <url2>     measure the same selectors on <url2> too and print, per
 *                          selector per width, `Δx Δy Δw Δh` in px (against − url) and
 *                          every property whose value differs (`prop: url → against`).
 *                          A selector missing on one side is reported, never skipped
 *     --all-matches        measure every match of each selector (capped at 12) instead
 *                          of the first; with --against matches are paired by index
 *     --json               the full structure on stdout instead of the table
 *     --out <file>         also write that JSON to <file> (directories created)
 *     --timeout-ms <ms>    per-page navigation timeout AND per-width deadline (default:
 *                          STARDUST_NAV_TIMEOUT_MS, else stardust/current/_crawl-log.json
 *                          crawl.navMs.p95 × 2 clamped to 20–180 s, else 20000)
 *     --ua <string>        user agent (default: the real-Chrome desktop UA)
 *     --consent <sel>      extra consent-accept selector (live side; clicked, never removed)
 *     --dismiss <sel,…>    extra overlay-dismiss selectors (live side; marketing modals etc.)
 *     --headed             headed stealth real Chrome (escalation for bot-managed live sites)
 *     --locale <tag>       pin Accept-Language + context locale (e.g. en-GB) on the live side
 *
 * Per page: the LIVE side (any http(s) origin that is not localhost) opens
 * through the shared live-session helper — real-Chrome UA plus the standard
 * request headers, navigator.webdriver spoof, challenge detection, then both
 * overlay classes dismissed (cookie consent clicked, timed marketing modals
 * closed) — exactly as stitch-shot and chrome-parity open it, so a bot-managed
 * origin is measured as the page and never as an "Access Denied" interstitial.
 * The prototype/build side (localhost / 127.0.0.1 / file) is a plain page from
 * the same browser (networkidle). Both then get reduced motion, a slow-scroll
 * settle from top to bottom and back so lazy and entrance-animated content is
 * at rest, and the read at each width.
 *
 * Per width: the read (resize + settle + measure) races --timeout-ms. A read
 * the page navigated under (execution context destroyed — a site that
 * navigates after a resize or a consent click) is re-read ONCE on a fresh page
 * in the same browser context (cookies and consent kept, opened at that
 * width) — a stderr warning names it; a deadline is never retried (a second
 * one would double the wait). A width that still fails is recorded as not
 * measured — `_provenance.failed` gets { url, width, error }, `partial` turns
 * true — and the next width starts on a fresh page. Why: in a recorded
 * hands-off run measure reused one page across widths with no deadline on the
 * reads and hung 8× at 900 s on a site that navigates after a resize or a
 * consent click.
 *
 * Output (table): when any width failed the FIRST line is a status line —
 * `measure: PARTIAL — <k> of <n> width read(s) failed: <url> @<w> (<error>); …`
 * or `measure: NO VERDICT — every width read failed (exit 124): …` (under
 * --json the same line goes to stderr; without a failed width the output is
 * unchanged). Then one block per width, opening with the root line per side
 * (`root  scrollWidth <n>  viewport <n>  scrollHeight <n>`, plus
 * `◄◄ OVERFLOW +<n>px` when scrollWidth exceeds the root's clientWidth — the
 * viewport, headless has no scrollbar gutter), then one line per match
 * (`sel[i]  x y w h vis "text"`, an image match adds `img <nw>×<nh> …/<file>`)
 * followed by its properties, then — with --against — the delta line
 * (`img.naturalWidth: a → b` / `img.file: a → b` when the rendition differs).
 * A failed width prints `✗ <url> @<w> not measured — <error>` (in the header
 * list and in its width block); with --against that width prints each measured
 * side on its own under `Δ not computed at <w> — a side was not measured`.
 * In the table a backgroundImage `url("https://host/long/path/flag-de.svg")`
 * prints as `url(…/flag-de.svg)` so a row stays one line (the JSON keeps the
 * full value). --json: { _provenance: { writtenBy, writtenAt, urls[], widths[],
 * selectors[], props[], allMatches, navTimeout: { ms, source: flag | env | crawl |
 * default }, partial, failed: [ { url, width?, error } ] (no width: the page
 * failed to load), warnings[] }, widths[],
 * selectors[], root: { [url]: { [width]: { viewport, clientWidth, scrollWidth,
 * scrollHeight, overflowX } } }, pages: { [url]: { [width]: { [selector]: [ {
 * index, of, rect: { x, y, w, h }, visible, text, props, img?: { naturalWidth,
 * naturalHeight, currentSrc } } ] } } } (a failed width has no key), deltas?: {
 * [width]: null (a side not measured there) | { [selector]: {
 * status, countA, countB, pairs: [ { index, rect: { dx, dy, dw, dh }, props: {
 * [prop]: [a, b] }, img?: { naturalWidth|naturalHeight|file: [a, b] } } ] } } },
 * rootDeltas?: { [width]: { scrollWidth, scrollHeight } } } (B − A).
 *
 * Writes: nothing — unless --out <file>, which receives the JSON above.
 *
 * Exit codes: 0 measured — possibly partial (`_provenance.partial`, the status
 * line), 1 a page failed to load (named on stderr; what was measured is still
 * printed), 2 usage error, playwright not importable or live-session.mjs not
 * found, 3 bot challenge — the live side served an edge interstitial (fail
 * loud; nothing is printed as measured; escalate --headed), 124 every width
 * read failed — no verdict (the run-capped "deadline, no verdict" convention).
 * Precedence 3 > 1 > 124 > 0.
 * A delta or an overflow never changes the exit code — this is a measurement,
 * not a gate; gate.sh's overflow verdict comes from stitch-shot's `overflow:` line.
 *
 * Requires playwright importable from the script's location and the diff
 * skill's live-session.mjs in one of two layouts — the plugin tree
 * (../../diff/scripts/live-session.mjs) or the project copy
 * (../diff/live-session.mjs; replica SKILL.md § Setup copies both scripts
 * dirs into the project and you run the copy). The delta, table, exit-code and
 * status-line functions and the width-read orchestration (readWidths) are
 * exported and browser-free — the contract test runs them without a browser.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

// Current stable desktop Chrome on macOS — the platform token and minor version are frozen by
// Chrome's UA reduction, so only the major matters.
export const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
export const DEFAULT_PROPS = ['display', 'position', 'boxSizing', 'width', 'height', 'maxWidth', 'margin', 'padding', 'gap', 'backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'borderRadius', 'border', 'boxShadow', 'opacity', 'objectFit'];
export const MATCH_CAP = 12;
export const TEXT_MAX = 40;
// The navigation timeout when neither --timeout-ms, STARDUST_NAV_TIMEOUT_MS nor a crawl latency figure gives one.
export const DEFAULT_TIMEOUT_MS = 20000;
const VIEWPORT_H = 900;
// Closing an abandoned page is bounded: a page wedged by a busy loop can stall its close.
const CLOSE_DEADLINE_MS = 5000;
// Each fresh-page step around the navigation — the new page, its resize, the overlay sweep (late window 6 s, dismissal
// clicks ≤ 3 s each) — is raced against this. The navigation itself is not: goto / gotoLive carry --timeout-ms (and
// under --headed the challenge-solve window), and a BotChallengeError from them must always reach exit 3.
const FRESH_PAGE_STEP_MS = 30000;

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }

const HERE = dirname(fileURLToPath(import.meta.url));
// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist: the plugin tree
// (skills/replica/scripts ↔ skills/diff/scripts) and the documented project copy (scripts/replica ↔
// scripts/diff) — resolve either, so a project re-copy can't silently sever the shared hardening.
// Resolved lazily (in main) so the pure exports stay importable without it.
const LIVE_SESSION_CANDIDATES = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'];
async function loadLiveSession() {
  const found = LIVE_SESSION_CANDIDATES.map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new UsageError('live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function parseArgs(argv) {
  const o = { url: null, against: null, selectors: [], widths: [], props: DEFAULT_PROPS, allMatches: false, json: false, out: null, timeoutMs: null, ua: DEFAULT_UA, consent: null, dismiss: [], headed: false, locale: null };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag.
  const need = (i, flag) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${flag} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--selectors') { o.selectors.push(...splitList(need(i, a))); i += 1; }
    else if (a === '--width') { o.widths.push(...splitList(need(i, a)).map(Number)); i += 1; }
    else if (a === '--props') { o.props = splitList(need(i, a)); i += 1; }
    else if (a === '--against') { o.against = need(i, a); i += 1; }
    else if (a === '--all-matches') { o.allMatches = true; }
    else if (a === '--json') { o.json = true; }
    else if (a === '--out') { o.out = need(i, a); i += 1; }
    else if (a === '--timeout-ms') { o.timeoutMs = Number(need(i, a)); i += 1; }
    else if (a === '--ua') { o.ua = need(i, a); i += 1; }
    else if (a === '--consent') { o.consent = need(i, a); i += 1; }
    else if (a === '--dismiss') { o.dismiss.push(...splitList(need(i, a))); i += 1; }
    else if (a === '--headed') { o.headed = true; }
    else if (a === '--locale') { o.locale = need(i, a); i += 1; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a} (see --help)`); }
    else if (o.url) { throw new UsageError(`unexpected argument "${a}" — one <url>; the second page goes in --against`); }
    else { o.url = a; }
  }
  if (!o.url) throw new UsageError('need <url> (see --help)');
  if (!o.selectors.length) throw new UsageError('need --selectors "<css>[,<css>…]"');
  if (!o.widths.length) o.widths = [1440];
  if (o.widths.some((w) => !Number.isInteger(w) || w <= 0)) throw new UsageError(`--width must be positive integers, got ${o.widths.join(',')}`);
  if (!o.props.length) throw new UsageError('--props must name at least one property');
  // null = not given: main resolves the shared navigation timeout (live-session) — the flag always wins.
  if (o.timeoutMs !== null && (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0)) throw new UsageError('--timeout-ms must be a positive number');
  o.widths = [...new Set(o.widths)];
  return o;
}

// ---- browser + in-page measurement ---------------------------------------------------------------

// A live origin gets domcontentloaded + a longer settle; localhost / file are networkidle.
export function isLiveHttpUrl(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(u.hostname); } catch { return false; }
}

// Runs inside the page (serialised by playwright — no outer-scope references).
/* eslint-disable no-undef */
function measureInPage({ selectors, props, allMatches, cap, textMax }) {
  const out = {};
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  for (const sel of selectors) {
    let nodes;
    try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { out[sel] = { total: 0, error: e.message, matches: [] }; continue; }
    const picked = allMatches ? nodes.slice(0, cap) : nodes.slice(0, 1);
    out[sel] = {
      total: nodes.length,
      matches: picked.map((el, index) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const text = norm(el.innerText !== undefined ? el.innerText : el.textContent);
        const p = {};
        for (const k of props) p[k] = cs[k] === undefined ? null : String(cs[k]);
        // The rendition the browser selected: an <img> itself, or the <img> a <picture> resolved to.
        const im = el.tagName === 'IMG' ? el : (el.tagName === 'PICTURE' ? el.querySelector('img') : null);
        return {
          index,
          of: nodes.length,
          rect: { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
          visible: el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
          text: text.length > textMax ? `${text.slice(0, textMax - 1)}…` : text,
          props: p,
          ...(im ? { img: { naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight, currentSrc: im.currentSrc || im.src || '' } } : {}),
        };
      }),
    };
  }
  // The root line: scrollWidth against the root's clientWidth (the viewport; headless has no scrollbar
  // gutter, headed subtracts one — so clientWidth, never innerWidth, is the honest comparand).
  const de = document.documentElement;
  const root = { viewport: window.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight };
  root.overflowX = Math.max(0, root.scrollWidth - root.clientWidth);
  return { root, selectors: out };
}
/* eslint-enable no-undef */

// Slow-scroll settle before measuring — pre-settle boxes are wrong on lazy-loading and
// entrance-animated pages; the read is taken at rest from the top.
async function settle(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(300);
}

// The live side opens through live-session (stitch-shot / chrome-parity shape): UA + standard
// headers + webdriver spoof on the context, gotoLive (BotChallengeError on an edge interstitial —
// never measured as the source; solveWindow only under --headed), then both overlay classes
// dismissed. The local prototype side is a plain page from the same browser.
//
// Then one read per width (resize + settle + measureInPage) through readWidths: each races
// --timeout-ms, a read the page navigated under is re-read once on a fresh page in the same
// context (cookies and consent kept; opened at that width, so no resize can re-trigger it), and a
// width that still fails is returned as failed, never as measured.
async function measurePage(browser, url, o, session) {
  const live = isLiveHttpUrl(url);
  const viewport = { width: o.widths[0], height: VIEWPORT_H };
  const common = { reducedMotion: 'reduce', colorScheme: 'light', ignoreHTTPSErrors: true };
  const context = live
    ? await session.newLiveContext(browser, { ua: o.ua, locale: o.locale, viewport, ...common })
    : await browser.newContext({ userAgent: o.ua, viewport, locale: 'en-US', ...common });
  // Errors ignored: the page is abandoned either way, and browser.close() kills what is left.
  const closeBounded = (p) => session.withDeadline(p.close(), CLOSE_DEADLINE_MS, `${url} page close`).catch(() => {});
  // The open path in two parts: the navigation (bounded by its own timeouts; never raced — a late BotChallengeError
  // would be swallowed), then what follows it (the overlay sweep live, a short rest local).
  const navigate = async (p) => {
    if (live) await session.gotoLive(p, url, { waitUntil: session.defaultWaitUntil(url), timeoutMs: o.timeoutMs, settleMs: 1500, solveWindow: o.headed });
    else {
      const resp = await p.goto(url, { waitUntil: 'networkidle', timeout: o.timeoutMs });
      if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    }
  };
  const afterNavigate = async (p) => {
    if (live) {
      const d = await session.dismissOverlays(p, { extra: [...(o.consent ? [o.consent] : []), ...o.dismiss], lateWindowMs: 6000 });
      if (d.consent) console.error(`measure: consent dismissed via ${d.consent}`);
      for (const sel of d.extra) console.error(`measure: overlay dismissed via extra selector ${sel}`);
      for (const sel of d.marketing) console.error(`measure: marketing modal dismissed via ${sel}`);
    } else await p.waitForTimeout(300);
  };
  let page = await context.newPage();
  try {
    // The first open failing is "a page failed to load" (the caller's { url, error }, exit 1).
    await navigate(page);
    await afterNavigate(page);
    return await readWidths(o.widths, {
      read: async (width) => {
        // The page this read started on: a late step of an abandoned read never touches a newer page.
        const p = page;
        await p.setViewportSize({ width, height: VIEWPORT_H });
        await settle(p);
        return p.evaluate(measureInPage, { selectors: o.selectors, props: o.props, allMatches: o.allMatches, cap: MATCH_CAP, textMax: TEXT_MAX });
      },
      // `bound` races a step against FRESH_PAGE_STEP_MS. A new page that arrives after its deadline is never assigned
      // (the context close takes it), so no later read can use a page whose open was abandoned.
      reopen: async (width, bound) => {
        const old = page; page = null;
        if (old) await closeBounded(old);
        const p = await bound(context.newPage());
        page = p;
        await bound(p.setViewportSize({ width, height: VIEWPORT_H }));
        await navigate(p);
        await bound(afterNavigate(p));
      },
      deadlineMs: o.timeoutMs,
      reopenDeadlineMs: FRESH_PAGE_STEP_MS,
      withDeadline: session.withDeadline,
      isContextDestroyed: session.isContextDestroyed,
      label: (width) => `${url} @${width}`,
    });
  } finally {
    await session.withDeadline(context.close(), CLOSE_DEADLINE_MS, `${url} context close`).catch(() => {});
  }
}

/**
 * One page's width reads, browser-free (read / reopen carry the page) → { byWidth, failed: [{ width, error }], retried: [width] }.
 *   - each read(width) races `deadlineMs` (label `label(width)`);
 *   - a destroyed execution context (the page navigated under the read — after a resize or a consent click) is
 *     re-read ONCE: reopen(width, bound) opens a fresh page, then read(width). reopen itself is NOT raced — its
 *     navigation carries its own timeouts, and a BotChallengeError it throws, however late, must propagate — it
 *     passes every other step through bound(promise), raced against `reopenDeadlineMs` (label `<label> fresh page`);
 *   - a deadline is never retried (a second one would double the wait) — recorded at once, like a second failure
 *     or any other error (first line of its message);
 *   - after any failed width the next width starts on a fresh page (the old one navigated away or is wedged);
 *   - a BotChallengeError (a fresh page's open met an edge interstitial) is rethrown, never recorded.
 */
export async function readWidths(widths, { read, reopen, deadlineMs, reopenDeadlineMs = deadlineMs, withDeadline, isContextDestroyed, label = (width) => `@${width}` }) {
  const byWidth = {}; const failed = []; const retried = [];
  const attempt = async (width, fresh) => {
    if (fresh) await reopen(width, (step) => withDeadline(step, reopenDeadlineMs, `${label(width)} fresh page`));
    return withDeadline(read(width), deadlineMs, label(width));
  };
  const rethrowChallenge = (e) => { if (e && e.name === 'BotChallengeError') throw e; };
  let fresh = false;
  for (const width of widths) {
    try {
      byWidth[width] = await attempt(width, fresh);
      fresh = false;
    } catch (e) {
      rethrowChallenge(e);
      let err = e;
      if (isContextDestroyed(e)) {
        try {
          byWidth[width] = await attempt(width, true);
          retried.push(width);
          fresh = false;
          continue;
        } catch (e2) { rethrowChallenge(e2); err = e2; }
      }
      failed.push({ width, error: String((err && err.message) || err).split('\n')[0] });
      fresh = true;
    }
  }
  return { byWidth, failed, retried };
}

async function main(argv) {
  const o = parseArgs(argv);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new UsageError(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`);
  }
  const urls = o.against ? [o.url, o.against] : [o.url];
  const session = await loadLiveSession();
  // One navigation timeout across the instruments: the flag, else env, else the crawl's p95 × 2, else 20000.
  const nav = o.timeoutMs === null ? session.navTimeout({ fallback: DEFAULT_TIMEOUT_MS }) : { ms: o.timeoutMs, source: 'flag' };
  o.timeoutMs ??= nav.ms;
  const result = { _provenance: { writtenBy: 'skills/replica/scripts/measure.mjs', writtenAt: new Date().toISOString(), urls, widths: o.widths, selectors: o.selectors, props: o.props, allMatches: o.allMatches, navTimeout: { ms: nav.ms, source: nav.source }, partial: false, failed: [], warnings: [] }, widths: o.widths, selectors: o.selectors, root: {}, pages: {} };
  // --headed: the stealth real-Chrome escalation tier from live-session; otherwise plain headless.
  const browser = o.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch({ headless: true });
  try {
    for (const url of urls) {
      try {
        const reads = await measurePage(browser, url, o, session);
        result.pages[url] = reads.byWidth;
        // A width that could not be read is recorded with its width — never measured, never a delta.
        for (const f of reads.failed) {
          result._provenance.failed.push({ url, width: f.width, error: f.error });
          console.error(`measure: ${url} @${f.width} not measured — ${f.error}`);
        }
        for (const width of reads.retried) result._provenance.warnings.push(`${url} @${width}: execution context destroyed (the page navigated) — re-read on a fresh page`);
      } catch (e) {
        // A bot challenge is never a per-page "failed to load": fail loud (exit 3), measure nothing.
        if (e.name === 'BotChallengeError') { e.code = 3; throw e; }
        const msg = String(e.message || e).split('\n')[0];
        result._provenance.failed.push({ url, error: msg });
        console.error(`measure: ${url} failed to load — ${msg}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  // Monotonic caution: partial whenever a width failed, also when every width did.
  result._provenance.partial = result._provenance.failed.some((f) => f.width != null);
  // Per selector the JSON carries the match array; an invalid selector becomes a warning. The root
  // line moves to result.root[url][width]; an overflow is warned on stderr as well as printed.
  for (const [url, byWidth] of Object.entries(result.pages)) {
    result.root[url] = {};
    for (const [width, measured] of Object.entries(byWidth)) {
      result.root[url][width] = measured.root;
      if (measured.root.overflowX > 0) result._provenance.warnings.push(`${url} @${width}: horizontal overflow +${measured.root.overflowX}px (scrollWidth ${measured.root.scrollWidth} > viewport ${measured.root.clientWidth})`);
      const bySel = measured.selectors;
      for (const sel of o.selectors) {
        if (bySel[sel].error) result._provenance.warnings.push(`${url} @${width}: selector "${sel}" — ${bySel[sel].error}`);
        bySel[sel] = bySel[sel].matches;
      }
      byWidth[width] = bySel;
    }
  }
  if (o.against) { result.deltas = buildDeltas(result, o.url, o.against); result.rootDeltas = buildRootDeltas(result, o.url, o.against); }
  for (const w of result._provenance.warnings) console.error(`measure: ${w}`);
  if (o.out) { mkdirSync(dirname(o.out), { recursive: true }); writeFileSync(o.out, JSON.stringify(result, null, 2)); }
  // The status line opens the table; --json keeps stdout pure JSON, so there it goes to stderr.
  const status = statusLine(result);
  if (o.json && status) console.error(status);
  console.log(o.json ? JSON.stringify(result, null, 2) : formatTable(result));
  return exitCodeFor(result);
}

// ---- exit code + status line (pure) --------------------------------------------------------------

// Width reads that failed vs width reads that were measured, over the pages that loaded.
function widthTally(result) {
  const failedWidths = (result._provenance.failed || []).filter((f) => f.width != null);
  const measured = Object.values(result.pages || {}).reduce((n, byWidth) => n + Object.keys(byWidth || {}).length, 0);
  return { failedWidths, measured };
}

// Precedence: 3 a bot challenge (thrown before any result exists) > 1 a page failed to load > 124 every attempted
// width read failed (the run-capped "deadline, no verdict" convention) > 0 measured, complete or partial.
export function exitCodeFor(result) {
  if ((result._provenance.failed || []).some((f) => f.width == null)) return 1;
  const { failedWidths, measured } = widthTally(result);
  return failedWidths.length && !measured ? 124 : 0;
}

// The first line of the table (stderr under --json) when any width failed; null otherwise — the output is unchanged.
export function statusLine(result) {
  const { failedWidths, measured } = widthTally(result);
  if (!failedWidths.length) return null;
  const list = failedWidths.map((f) => `${f.url} @${f.width} (${f.error})`).join('; ');
  if (!measured) return `measure: NO VERDICT — every width read failed (exit ${exitCodeFor(result)}): ${list}`;
  return `measure: PARTIAL — ${failedWidths.length} of ${failedWidths.length + measured} width read(s) failed: ${list}`;
}

// ---- deltas + table (pure) -----------------------------------------------------------------------

// The file name of an image source (query and fragment dropped, host dropped — live and build never share a
// host, the rendition they picked is what the delta names); a data: URI keeps its MIME type.
export function fileOf(src) {
  const s = String(src || '');
  if (!s) return '';
  if (/^data:/i.test(s)) return `${s.split(/[;,]/)[0]}…`;
  const path = s.split(/[?#]/)[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
}

// Two match arrays for one selector → status, counts and per-index pairs (B − A for the rect,
// [a, b] for every property whose value differs, and — when either side is an image — [a, b] for
// naturalWidth / naturalHeight / file when the selected rendition differs). A side with no match is a
// status, not a skip.
export function computeDeltas(a, b) {
  const A = a || []; const B = b || [];
  let status = 'ok';
  if (!A.length && !B.length) status = 'missing-both';
  else if (!A.length) status = 'missing-a';
  else if (!B.length) status = 'missing-b';
  const pairs = [];
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const ra = A[i].rect; const rb = B[i].rect;
    const props = {};
    for (const k of new Set([...Object.keys(A[i].props || {}), ...Object.keys(B[i].props || {})])) {
      const va = A[i].props ? A[i].props[k] : undefined; const vb = B[i].props ? B[i].props[k] : undefined;
      if (va !== vb) props[k] = [va === undefined ? null : va, vb === undefined ? null : vb];
    }
    const pair = { index: i, rect: { dx: rb.x - ra.x, dy: rb.y - ra.y, dw: rb.w - ra.w, dh: rb.h - ra.h }, props };
    if (A[i].img || B[i].img) {
      const ia = A[i].img || {}; const ib = B[i].img || {};
      const img = {};
      for (const k of ['naturalWidth', 'naturalHeight']) { const va = ia[k] === undefined ? null : ia[k]; const vb = ib[k] === undefined ? null : ib[k]; if (va !== vb) img[k] = [va, vb]; }
      const fa = fileOf(ia.currentSrc); const fb = fileOf(ib.currentSrc);
      if (fa !== fb) img.file = [fa || null, fb || null];
      if (Object.keys(img).length) pair.img = img;
    }
    pairs.push(pair);
  }
  return { status, countA: A.length, countB: B.length, pairs };
}

// deltas[width][selector]; null when either page failed to load (no half-comparison). deltas[width] is null when
// either side has no read at that width — a failed width is never a "MISSING" delta.
export function buildDeltas(result, urlA, urlB) {
  const PA = result.pages[urlA]; const PB = result.pages[urlB];
  if (!PA || !PB) return null;
  const out = {};
  for (const width of result.widths) {
    if (!PA[width] || !PB[width]) { out[width] = null; continue; }
    out[width] = {};
    for (const sel of result.selectors) out[width][sel] = computeDeltas(PA[width][sel], PB[width][sel]);
  }
  return out;
}
// rootDeltas[width] = { scrollWidth, scrollHeight } (B − A); null when either side has no root line.
export function buildRootDeltas(result, urlA, urlB) {
  const RA = (result.root || {})[urlA]; const RB = (result.root || {})[urlB];
  if (!RA || !RB) return null;
  const out = {};
  for (const width of result.widths) {
    const a = RA[width]; const b = RB[width];
    out[width] = a && b ? { scrollWidth: b.scrollWidth - a.scrollWidth, scrollHeight: b.scrollHeight - a.scrollHeight } : null;
  }
  return out;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const pad = (v, n) => String(v).padStart(n);

// The table prints computed values raw. A backgroundImage reads `url("https://host/long/path/flag-de.svg")`,
// one per layer, comma-separated — so the table keeps the file name per url(); a data: URL keeps its MIME type;
// gradients, `none` and every other property print as they are. The JSON carries the full value.
export function shortValue(prop, value) {
  if (prop !== 'backgroundImage' || typeof value !== 'string') return value;
  return value.replace(/url\((["']?)([^"')]*)\1\)/g, (whole, q, ref) => {
    if (/^data:/i.test(ref)) return `url(${ref.split(/[;,]/)[0]}…)`;
    const path = ref.split(/[?#]/)[0].replace(/\/+$/, '');
    const name = path.slice(path.lastIndexOf('/') + 1);
    return path.includes('/') && name ? `url(…/${name})` : whole;
  });
}

export function formatDelta(pair) {
  const r = pair.rect;
  const rect = `Δx ${signed(r.dx)} Δy ${signed(r.dy)} Δw ${signed(r.dw)} Δh ${signed(r.dh)}`;
  const props = Object.entries(pair.props).map(([k, [a, b]]) => `${k}: ${shortValue(k, a)} → ${shortValue(k, b)}`);
  const img = Object.entries(pair.img || {}).map(([k, [a, b]]) => `img.${k}: ${a} → ${b}`);
  const parts = [...props, ...img];
  return `${rect}  ${parts.length ? parts.join('; ') : 'props equal'}`;
}

function matchLine(tag, m) {
  const img = m.img ? `  img ${m.img.naturalWidth}×${m.img.naturalHeight} …/${fileOf(m.img.currentSrc)}` : '';
  return `${tag}  x ${pad(m.rect.x, 5)}  y ${pad(m.rect.y, 6)}  w ${pad(m.rect.w, 5)}  h ${pad(m.rect.h, 5)}  ${m.visible ? 'vis' : 'hid'}  "${m.text}"${img}`;
}

// The root line: `scrollWidth <n>  viewport <n>  scrollHeight <n>`, then `◄◄ OVERFLOW +<n>px` when the document is wider
// than its viewport — for ad-hoc reads; gate.sh's horizontal-overflow assert reads stitch-shot's `overflow:` line (the
// same quantities, read on the stitched page after its chunk loop, back at the top and at rest; source-fidelity-gate.md
// § Iteration discipline).
export function formatRoot(root) {
  const vp = root.clientWidth === root.viewport ? String(root.viewport) : `${root.viewport} (client ${root.clientWidth})`;
  return `scrollWidth ${pad(root.scrollWidth, 5)}  viewport ${vp}  scrollHeight ${pad(root.scrollHeight, 6)}${root.overflowX > 0 ? `  ◄◄ OVERFLOW +${root.overflowX}px` : ''}`;
}

export function formatTable(result) {
  const { urls, failed } = result._provenance;
  const [urlA, urlB] = urls;
  const lines = [];
  const status = statusLine(result);
  if (status) lines.push(status);
  lines.push(urlB ? `measure  A = ${urlA}\n         B = ${urlB}` : `measure  ${urlA}`);
  lines.push(`  widths ${result.widths.join(', ')} · ${result.selectors.length} selector(s) · ${result._provenance.props.length} props${result._provenance.allMatches ? ` · all matches (≤ ${MATCH_CAP})` : ' · first match'}`);
  const notMeasured = (f) => `  ✗ ${f.url} @${f.width} not measured — ${f.error}`;
  for (const f of failed) lines.push(f.width == null ? `  ✗ ${f.url} failed to load — ${f.error}` : notMeasured(f));
  for (const width of result.widths) {
    lines.push(`\n@ ${width}px`);
    for (const f of failed) if (f.width != null && Number(f.width) === Number(width)) lines.push(notMeasured(f));
    // Root line(s) first: one side prints `root  …`; two sides print A / B and the Δ.
    const rootOf = (url) => ((result.root || {})[url] || {})[width];
    if (!urlB) { const ra = rootOf(urlA); if (ra) lines.push(`  root  ${formatRoot(ra)}`); } else {
      const ra = rootOf(urlA); const rb = rootOf(urlB);
      if (ra || rb) {
        lines.push('  root');
        if (ra) lines.push(`    A  ${formatRoot(ra)}`);
        if (rb) lines.push(`    B  ${formatRoot(rb)}`);
        if (ra && rb) lines.push(`    Δ  scrollWidth ${signed(rb.scrollWidth - ra.scrollWidth)}  scrollHeight ${signed(rb.scrollHeight - ra.scrollHeight)}`);
      }
    }
    // Two loaded sides, one of them not measured at this width: each measured side prints on its own, no Δ.
    const deltasAt = result.deltas ? result.deltas[width] : null;
    if (urlB && result.deltas && !deltasAt) lines.push(`  Δ not computed at ${width} — a side was not measured`);
    for (const sel of result.selectors) {
      const A = ((result.pages[urlA] || {})[width] || {})[sel];
      // One page, or two with a side that failed (to load, or at this width): print each measured side on its own.
      if (!urlB || !deltasAt) {
        for (const [tag, url] of (urlB ? [['A', urlA], ['B', urlB]] : [[' ', urlA]])) {
          const M = ((result.pages[url] || {})[width] || {})[sel];
          if (!M) continue;
          if (!M.length) { lines.push(`  ${sel}   no match${urlB ? ` on ${tag}` : ''}`); continue; }
          for (const m of M) {
            lines.push(`  ${m.of > 1 ? `${sel} [${m.index + 1} of ${m.of}]` : sel}`);
            lines.push(`    ${matchLine(tag, m)}`);
            lines.push(`      ${Object.entries(m.props).map(([k, v]) => `${k}: ${shortValue(k, v)}`).join('; ')}`);
          }
        }
        continue;
      }
      const d = deltasAt[sel];
      const B = ((result.pages[urlB] || {})[width] || {})[sel] || [];
      if (d.status !== 'ok') {
        const side = d.status === 'missing-both' ? 'A and B' : (d.status === 'missing-a' ? `A (${d.countB} on B)` : `B (${d.countA} on A)`);
        lines.push(`  ${sel}   MISSING on ${side}`);
        continue;
      }
      lines.push(`  ${sel}${d.countA !== d.countB ? `   matches ${d.countA} vs ${d.countB} — paired ${d.pairs.length}` : (d.countA > 1 ? `   ${d.countA} matches` : '')}`);
      for (const p of d.pairs) {
        if (d.pairs.length > 1) lines.push(`    [${p.index + 1}]`);
        lines.push(`    ${matchLine('A', A[p.index])}`);
        lines.push(`    ${matchLine('B', B[p.index])}`);
        lines.push(`    Δ  ${formatDelta(p)}`);
      }
    }
  }
  if (urlB && !result.deltas) lines.push('\n  deltas not computed — a side failed to load');
  return lines.join('\n');
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`measure: ${e.message}`);
    process.exitCode = e.code || 1;
  });
}
