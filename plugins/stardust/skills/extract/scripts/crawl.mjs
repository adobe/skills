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
 *   - SCREENSHOT: a full-page PNG per page under <out>/assets/screenshots/<slug>.png.
 *     Chromium silently WRAPS a full-page raster above its 16,384 px texture
 *     limit (rows repeat, the tail is lost, nothing throws), so a page taller
 *     than SHOT_WRAP_PX is captured in clip BANDS (<slug>.png, <slug>.part2.png…;
 *     _signals.screenshotMode 'banded', screenshotBands, docHeight); a raster
 *     that throws falls back to the first viewport ('clipped' — the tail is
 *     missing by instrument, never a vision-gate `suspect`). Mode in
 *     _signals.screenshotMode, relative path in the record's `screenshot` field.
 *   - 360 SHOT (--mobile entry|all|none, default entry): the same page, no
 *     navigation (consent + solved bot state inherited), re-laid out at
 *     360×900 → <slug>-360.png (`screenshotMobile`, _signals.screenshotMobileMode).
 *     Replica's 360 pass starts from it instead of guessing the mobile layout.
 *   - CAPTURE QUALITY: _signals.emptyMain (a <main> exists but is blank with
 *     no real image — client-rendered page captured before hydration),
 *     brokenImages / subResourceBlock (images 403'd by the edge while the
 *     document loaded), overlayCoverPct (fixed-position overlay ∩ first
 *     viewport — a survey/feedback modal the consent pass did not know).
 *     captureQuality 'degraded' is recorded, never thrown: the DOM is still
 *     evidence; Phase 2.5 treats it as `suspect` until recaptured.
 *   - COMPAT MODE: _provenance.compatMode ('CSS1Compat' | 'BackCompat') — a
 *     legacy site rendering in quirks mode needs its doctype mirrored, or the
 *     replica lays out standards-mode boxes against quirks-mode ground truth.
 *
 * Usage:
 *   node crawl.mjs --url https://example.com [--pages /a,/b] [--cap 25 | --all | --single] \
 *     [--refresh slug,slug | --force] [--out stardust/current] [--wait medium] \
 *     [--no-consent-dismiss] [--concurrency 4] [--dynamics] [--headed[=window]] \
 *     [--mobile entry|all|none] [--dpr 1] [--depth 1] [--cookie name=value[;Path=/]]... \
 *     [--storage-state <file> | --fresh-state] [--save-state] [--solve-wait <ms>] \
 *     [--progress <file> | --no-progress]
 *   node crawl.mjs --help
 *
 * Completion contract (skills/stardust/scripts/progress.mjs): while the pool runs the
 *   crawler writes <out>/../.work/extract/crawl.progress.json (default; --progress
 *   overrides, --no-progress disables) — done/ok/failed per page, atomic — and its LAST
 *   stdout line is `SUMMARY crawl ok=<n> failed=<n> exit=<code> details=<_crawl-log.json> …`.
 *   Run it in the background and read the progress file (`progress.mjs read <file>`),
 *   never `sleep N; grep -c` the log. Exit codes unchanged: 0 (per-page failures are in
 *   the log), 2 fatal, 3 bot challenge. A project copy loads the helper from
 *   stardust/scripts/stardust/progress.mjs (copy it beside class-report.mjs); without it
 *   the SUMMARY line still prints and one WARN names the copy.
 *
 * Interactive solve (--solve-wait <ms>): PerimeterX "Press & Hold", Cloudflare
 *   Turnstile and hCaptcha never clear without a human. The flag starts at
 *   tier 3 with the window VISIBLE, skips the wait+reload loop on the probe
 *   (a reload destroys a Press & Hold in progress), polls the same page every
 *   2.5 s and resumes after two consecutive clean polls (no challenge DOM or
 *   phrase, ≥ 800 chars of text, taller than 1.5 viewports), then saves the
 *   storage state for the downstream instruments; unsolved at the deadline →
 *   BotChallengeError (exit 3). Probe only — workers inherit the solved state.
 *   Challenge markers (challengeMarker, mirrored in live-session.mjs): the
 *   Cloudflare/Akamai/F5/Imperva 403|429|503 signatures, HTTP 400 + AkamaiGHost
 *   (Akamai's escalation body), and on any 4xx/5xx a _pxhd|_px3|_pxvid|datadome
 *   set-cookie or DataDome header (a PerimeterX 403 via Varnish carries no other
 *   signature). A 200 is never a challenge here — PX/DataDome set their ids on
 *   admitted pages too; the DOM stage (--solve-wait) covers the 200-status walls.
 *
 * Admitted session (mirror of diff/scripts/live-session.mjs resolveStorageState —
 *   this file ships alone): the probe context's storageState (clearance,
 *   consent, A/B cookies) is CLONED into every worker context, so a probe that
 *   cleared a challenge no longer hands the workers a fresh, re-challenged
 *   context. <out>/_storage-state.json (= stardust/current/_storage-state.json,
 *   never tracked) is loaded into the probe when one of its cookie domains
 *   matches the host (--storage-state <file> names another, --fresh-state opts
 *   out) and written when a challenge was cleared or --save-state is given.
 *   Limits: fingerprint-bound clearances (PerimeterX/HUMAN) and Cloudflare's
 *   per-session escalation do not replay — a re-challenged state still fails
 *   loud. _provenance.storageState / discovery.storageState record the reuse.
 *
 * Discovery (ia-extraction.md § Discovery order — discoverInventory below):
 *   --pages > robots.txt `Sitemap:` directives (all of them) > /sitemap.xml,
 *   /sitemap_index.xml > /.sitemap.xml, /sitemap.aspx (only when the tiers
 *   above are empty and the origin is not bot-walled) > the probe page's nav
 *   links (always unioned) > BFS --depth N (≤ 3, in-page fetch hops, breadth
 *   max(200, cap); depth 1 under a bot block). A non-root --url path scopes
 *   the roster to that subtree (taken from the URL as TYPED, before any
 *   redirect); the census of everything declared is logged regardless.
 *   --cookie seeds every context (age gates, region pins); names only are logged.
 *
 * --dpr <n> sets deviceScaleFactor (default 1, recorded in _provenance.dpr): the
 *   gate captures at DPR 1, and a DPR-2 ground truth would never pixel-match it
 *   (decision D4 — keep 1, record it).
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
 * Live budget per host (HostBudget — the crawl-local copy of the planned
 *   diff/scripts/live-budget.mjs; this file ships alone): every navigation
 *   waits for a token (≤ 10/min) AND a minimum gap (≥ 3 s; robots.txt
 *   Crawl-delay widens it — decisions.md `crawl` row; a stricter ceiling
 *   learned earlier is read from stardust/live-budget.json and expires
 *   LIVE_BUDGET_TTL_MS = 7 days after `learnedAt`). The pool drops to
 *   ONE worker under a bot block (tier > 1 or a cleared challenge — concurrency
 *   4 drew 9 re-challenges even with the cloned session) and after the first
 *   BARE 429 (no edge signature = rate limit, not a challenge): the ceiling is
 *   halved and persisted (merge-by-host), Retry-After honoured (≤ 60 s), the
 *   page retried ONCE, then recorded as HTTPError { rateLimited: true } with
 *   the hint. The PROBE takes the same path (a 429 on the first hit is not
 *   "admitted"): retried once after the wait, then fatal HTTPError (exit 2)
 *   with the halved ceiling persisted before exit. The budget exists from the
 *   first navigation: discovery's sitemap children and BFS hops are paced too
 *   (the ≤ 5 guessed probes are not), and the gap widens once Crawl-delay is
 *   read. stardust/.work/live-<host>.lock (pid liveness; STARDUST_LIVE_FORCE=1
 *   overrides) keeps two live tools off one origin at once — the recorded
 *   "two launches within a minute, both challenged" class; the lock is
 *   re-keyed to the post-redirect host (apex→www) so it matches the budget's.
 * Exit codes (exitCodeOf): 0 done (per-page failures are in the log) ·
 *   1 LiveLockError (another live tool holds stardust/.work/live-<host>.lock —
 *   wait for it, or STARDUST_LIVE_FORCE=1) · 2 fatal · 3 BotChallengeError
 *   (tier 3 still challenged, or --solve-wait expired — never captured as content).
 * Exports (for evals/fixtures/*.test.mjs): slugify, assignSlugs, MOBILE_SHOT_SUFFIX,
 *   exitCodeOf, noteRateLimited, probeRateLimited, needsStateSave, mergeCrawlLog,
 *   RUN_LEVEL_DISCOVERY, TIERS, tierOf, captureQualityOf, SHOT_WRAP_PX,
 *   OVERLAY_FLAG_PCT, discoverInventory, parseRobots, parseCookieFlag,
 *   challengeMarker, CHALLENGE_PHRASE, HostBudget, BUDGET_DEFAULT,
 *   parseRetryAfter, mergeLiveBudget, tuneBudget, LIVE_BUDGET_TTL_MS, sessionReusedOf,
 *   UNPACED_DISCOVERY —
 *   importing this module runs nothing; main() runs only when the file is
 *   the entry script.
 *
 * Needs playwright importable from the project (see extract/SKILL.md Setup —
 * `npm i -D playwright` or the Playwright MCP server; the `npx playwright`
 * availability probe alone does NOT make the ESM module importable).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
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

// --help prints the header block above (the usage lives there once).
function printHelp() {
  const src = readFileSyncSafe(new URL(import.meta.url));
  const block = src.split('\n').slice(1).join('\n').split('*/')[0];
  console.log(block.split('\n').filter((l) => l !== '/**').map((l) => l.replace(/^ \* ?/, '')).join('\n').trim());
}
function readFileSyncSafe(u) { try { return readFileSync(u, 'utf8'); } catch { return ''; } }

/** Default progress file — the run-only write boundary beside the live lock: <out>/../.work/extract/crawl.progress.json. */
export function crawlProgressFile(args) { return path.resolve(args.out, '..', '.work', 'extract', 'crawl.progress.json'); }

// progress.mjs lives in skills/stardust/scripts/ (plugin tree) or stardust/scripts/stardust/
// (project copy). Missing → the SUMMARY line still prints (inline format), no progress file.
export async function loadProgressHelper() {
  for (const c of ['../../stardust/scripts/progress.mjs', './stardust/progress.mjs']) {
    try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  console.error('[crawl] WARN progress.mjs not found next to this script — no progress file this run; copy skills/stardust/scripts/progress.mjs to stardust/scripts/stardust/');
  const summaryLine = ({ driver, ok = 0, failed = 0, noverdict = 0, exit = 0, details = '-', extra = {} }) => [`SUMMARY ${driver}`, `ok=${ok}`, `failed=${failed}`, ...(noverdict ? [`noverdict=${noverdict}`] : []), `exit=${exit}`, `details=${details}`, ...Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`)].join(' ');
  const createProgress = ({ driver, total = 0 }) => {
    const state = { driver, total, done: 0, ok: 0, failed: 0, noverdict: 0, lastPath: null };
    return { state, set() {}, tick({ ok, path: p }) { state.done += 1; if (ok) state.ok += 1; else state.failed += 1; if (p) state.lastPath = p; }, summaryLine({ exit = 0, details = '-', extra = {} } = {}) { return summaryLine({ driver, ok: state.ok, failed: state.failed, exit, details, extra }); } };
  };
  return { createProgress, summaryLine };
}

const MOBILE_MODES = ['entry', 'all', 'none'];
export function parseArgs(argv) {
  const a = { out: 'stardust/current', max: 5, wait: 'medium', consent: true, concurrency: 4, dynamics: false, refresh: [], force: false, headed: 0, mobile: 'entry', dpr: 1, depth: 1, cookies: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') { a.help = true; return a; }
    if (k === '--url') a.url = argv[(i += 1)];
    else if (k === '--mobile') { a.mobile = argv[(i += 1)]; if (!MOBILE_MODES.includes(a.mobile)) throw new Error(`--mobile must be one of ${MOBILE_MODES.join('|')}`); }
    else if (k === '--dpr') { const n = +argv[(i += 1)]; if (!(n > 0 && n <= 4)) throw new Error('--dpr must be a number in (0, 4]'); a.dpr = n; }
    else if (k === '--depth') { const n = +argv[(i += 1)]; if (!(n >= 1 && n <= 3)) throw new Error('--depth must be 1, 2 or 3'); a.depth = n; }
    else if (k === '--cookie') a.cookies.push(parseCookieFlag(argv[(i += 1)]));
    else if (k === '--storage-state') a.storageState = argv[(i += 1)];
    else if (k === '--fresh-state') a.freshState = true;
    else if (k === '--save-state') a.saveState = true;
    else if (k === '--solve-wait') {
      const n = +argv[(i += 1)]; if (!(n >= 5000)) throw new Error('--solve-wait <ms> must be ≥ 5000');
      a.solveWait = n; a.headed = 3; // a human cannot solve in an off-screen window: tier 3, visible
      process.env.STARDUST_HEADED_WINDOW = '1'; // read by launchTier (byte-identical ladder copy; no parameter)
    }
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
    else if (k === '--progress') a.progress = argv[(i += 1)];
    else if (k === '--no-progress') a.progress = null;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.url) throw new Error('--url is required');
  if (a.progress === undefined) a.progress = crawlProgressFile(a);
  a.origin = new URL(a.url).origin;
  a.entryPath = new URL(a.url).pathname; // subtree scope comes from the URL as TYPED — origin adoption rewrites a.url later
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
// deterministic -<hash4> suffix. A claimed slug also reserves `<slug>-360` —
// the mobile shot's file base (screenshotMobile) — so a real page at /foo-360
// and /foo's 360 shot never share assets/screenshots/foo-360.png.
export const MOBILE_SHOT_SUFFIX = '-360';
export function assignSlugs(urls) {
  const bySlug = new Map(); // slug -> dedupeKey of first claimant
  const taken = (s) => bySlug.has(s) || bySlug.has(`${s}${MOBILE_SHOT_SUFFIX}`) || (s.endsWith(MOBILE_SHOT_SUFFIX) && bySlug.has(s.slice(0, -MOBILE_SHOT_SUFFIX.length)));
  return urls.map((u) => {
    const base = slugify(u);
    const key = dedupeKey(u);
    if (bySlug.get(base) === key) return base; // same page (shouldn't recur post-dedupe)
    if (!taken(base)) { bySlug.set(base, key); return base; }
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
// `extra` = per-run context options (deviceScaleFactor from --dpr, storageState)
// so probe and workers render under identical conditions.
async function newContext(browser, stealth, extra = {}, cookies = []) {
  const ctx = await browser.newContext({ ...CRAWL_CONTEXT, ...extra });
  if (cookies.length) await ctx.addCookies(cookies);
  if (stealth) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  return ctx;
}
// ---- per-host live budget (crawl-local copy of the planned diff/scripts/live-budget.mjs; crawl ships alone) ----
export const BUDGET_DEFAULT = { navPerMin: 10, minGapMs: 3000 };
/**
 * Token bucket + minimum gap, serialised across workers. `now`/`sleep` are
 * injectable (evals/fixtures/crawl-signals.test.mjs drives it with a fake clock).
 */
export class HostBudget {
  constructor({ navPerMin = BUDGET_DEFAULT.navPerMin, minGapMs = BUDGET_DEFAULT.minGapMs, source = 'default', now = Date.now, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = {}) {
    Object.assign(this, { navPerMin, minGapMs, source, now, sleep, tokens: navPerMin, lastRefill: now(), lastNav: -Infinity, rateLimits: 0, waitedMs: 0, queue: Promise.resolve() });
  }
  /** Resolve when the next navigation may start (one caller at a time). */
  take() {
    const run = async () => {
      for (;;) {
        const t = this.now();
        this.tokens = Math.min(this.navPerMin, this.tokens + ((t - this.lastRefill) * this.navPerMin) / 60000);
        this.lastRefill = t;
        const wait = Math.max(0, this.lastNav + this.minGapMs - t, this.tokens >= 1 ? 0 : ((1 - this.tokens) * 60000) / this.navPerMin);
        if (wait <= 0) { this.tokens -= 1; this.lastNav = t; return; }
        this.waitedMs += wait;
        await this.sleep(Math.ceil(wait));
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
  /** A bare 429: halve the rate, double the gap (≤ 60 s), drain tokens. Returns the ms to wait before the ONE retry. */
  rateLimited(retryAfterSec) {
    this.navPerMin = Math.max(1, Math.floor(this.navPerMin / 2));
    this.minGapMs = Math.min(60000, this.minGapMs * 2);
    this.tokens = 0; this.rateLimits += 1; this.source = 'rate-limited';
    return retryAfterSec ? Math.min(60, retryAfterSec) * 1000 : Math.min(60000, this.minGapMs * 4);
  }
  toJSON() { return { navPerMin: this.navPerMin, minGapMs: this.minGapMs, source: this.source }; }
}
/** Retry-After: seconds or an HTTP date → seconds (null when absent/unparseable). */
export function parseRetryAfter(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n >= 0 ? n : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : null;
}
/** stardust/live-budget.json — merge-by-host: { "<host>": { navPerMin, minGapMs, learnedAt, learnedBy, lastStatus } }. */
export function mergeLiveBudget(prev, host, entry) {
  const out = prev && typeof prev === 'object' ? { ...prev } : {};
  out[host] = { ...(out[host] || {}), ...entry };
  return out;
}
function liveBudgetPath(args) { return path.resolve(args.out, '..', 'live-budget.json'); }
// the ceiling for this run: stricter of default / learned (live-budget.json) / robots Crawl-delay.
// Created BEFORE the probe (the first navigation is paced and a probe 429 is
// handled); `tuneBudget` tightens the SAME instance in place once the adopted
// host and Crawl-delay are known — a 429 already taken is never loosened.
function makeBudget(args, host, crawlDelay) { return tuneBudget(new HostBudget({ ...BUDGET_DEFAULT, source: 'default' }), args, host, crawlDelay); }
export const LIVE_BUDGET_TTL_MS = 7 * 24 * 3600 * 1000; // a learned ceiling older than this is ignored (live-budget.mjs carries the same constant)
const expiredWarned = new Set(); // the expiry line prints once per host, not once per tune
export function tuneBudget(budget, args, host, crawlDelay) {
  try {
    let learned = existsSync(liveBudgetPath(args)) ? JSON.parse(readFileSync(liveBudgetPath(args), 'utf8'))[host] : null;
    if (learned && learned.learnedAt && Date.now() - Date.parse(learned.learnedAt) > LIVE_BUDGET_TTL_MS) {
      if (!expiredWarned.has(host)) { expiredWarned.add(host); console.error(`[crawl] learned ceiling for ${host} (learnedAt ${learned.learnedAt}) has expired — default pacing; a recurring 429 re-learns it`); }
      learned = null;
    }
    if (learned && ((learned.navPerMin || Infinity) < budget.navPerMin || (learned.minGapMs || 0) > budget.minGapMs)) {
      budget.navPerMin = Math.min(budget.navPerMin, learned.navPerMin || budget.navPerMin); budget.minGapMs = Math.max(budget.minGapMs, learned.minGapMs || 0);
      if (!budget.rateLimits) budget.source = 'live-budget.json';
    }
  } catch { /* unreadable — keep the current ceiling */ }
  if (crawlDelay && crawlDelay * 1000 > budget.minGapMs) { budget.minGapMs = crawlDelay * 1000; if (!budget.rateLimits) budget.source = 'robots Crawl-delay'; }
  budget.tokens = Math.min(budget.tokens, budget.navPerMin);
  return budget;
}
// the fatal path (main().catch) persists a halved ceiling before exit 2, so a probe 429 outlives the aborted run
let persistOnFatal = null;
let progress = null; // created once the queue is known; the fatal path summarises what was driven
function persistBudget(args, host, budget) {
  try {
    const file = liveBudgetPath(args);
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    writeFileSync(file, `${JSON.stringify(mergeLiveBudget(prev, host, { navPerMin: budget.navPerMin, minGapMs: budget.minGapMs, learnedAt: new Date().toISOString(), learnedBy: 'crawl.mjs', lastStatus: 429 }), null, 2)}\n`);
  } catch (e) { console.error(`[crawl] WARN could not persist live budget: ${e.message}`); }
}
// ---- per-host live lock (stardust/.work/live-<host>.lock — run-lock.mjs's shape and directory) ----
function acquireLiveLock(args, host) {
  const dir = path.resolve(args.out, '..', '.work');
  const file = path.join(dir, `live-${host}.lock`);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) {
    let held = null;
    try { held = JSON.parse(readFileSync(file, 'utf8')); } catch { held = null; }
    let alive = false;
    if (held && held.pid && held.pid !== process.pid) { try { process.kill(held.pid, 0); alive = true; } catch { alive = false; } }
    if (alive) {
      const msg = `${host} is being hit by ${held.tool || 'another live tool'} (pid ${held.pid}, since ${held.startedAt}) — one live tool per origin at a time; wait for it, or STARDUST_LIVE_FORCE=1 to override`;
      if (process.env.STARDUST_LIVE_FORCE === '1') console.error(`[crawl] WARN live lock overridden: ${msg}`);
      else throw Object.assign(new Error(msg), { errorClass: 'LiveLockError' });
    }
  }
  writeFileSync(file, JSON.stringify({ host, pid: process.pid, tool: 'crawl.mjs', startedAt: new Date().toISOString() }));
  const release = () => { try { unlinkSync(file); } catch { /* already gone */ } };
  process.on('exit', release);
  return { file, host, release };
}
// exit code for a fatal error (main().catch): a held live lock is "wait for the
// other tool" (1), a challenge is 3, anything else 2.
export function exitCodeOf(e) {
  if (e?.errorClass === 'BotChallengeError') return 3;
  if (e?.errorClass === 'LiveLockError') return 1;
  return 2;
}
// a BARE 429 in the pool: the ceiling is halved by the caller; the pool drops to
// ONE worker from here on (other workers finish their page and stop pulling),
// and the escalated pass / log inherit concurrency 1.
export function noteRateLimited(args) {
  args.throttled = true;
  if (args.concurrency > 1) args.concurrency = 1;
  return args;
}
// The PROBE's bare 429 takes the worker path — halve, ONE worker, persist —
// so the pool that follows spawns 1 context and the log records concurrency 1
// (ia-extraction.md § _crawl-log.json). Returns the ms to wait before the ONE retry.
export function probeRateLimited(args, host, resp) {
  const waitMs = args.budget.rateLimited(parseRetryAfter(resp.headers()['retry-after']));
  noteRateLimited(args); persistBudget(args, host, args.budget);
  console.error(`[crawl] HTTP 429 (rate limit, no edge signature) on the probe — pool → 1 worker, ceiling halved (${args.budget.navPerMin}/min, ≥ ${args.budget.minGapMs / 1000} s) and recorded; retrying once in ${Math.round(waitMs / 1000)} s`);
  return waitMs;
}
// when to (re)write <out>/_storage-state.json: on a cleared challenge or
// --save-state, and again after a capture-time escalation — the state saved
// before the pool is the PRE-escalation one; the admitted session lives in the
// worker context that cleared the challenge.
export function needsStateSave({ botBlock = null, saveState = false, savedState = null, escalatedAtCapture = false } = {}) {
  return !!((botBlock || saveState) && (!savedState || escalatedAtCapture));
}
// _provenance.storageState / discovery.storageState — true only when an ADMITTED
// session was reused: a cleared challenge, a loaded reserved/explicit file, or a
// probe clone that actually carries cookies (a 0-cookie clone reuses nothing).
export function sessionReusedOf({ botBlock = null, loadedState = null, cookies = 0 } = {}) { return !!(botBlock || loadedState || cookies > 0); }
// ---- admitted-session reuse (mirror of live-session.mjs resolveStorageState; crawl ships alone) ----
const STORAGE_STATE_FILE = '_storage-state.json'; // reserved under <out> — never tracked (artifact-map.md)
function storageStatePath(args) { return path.join(args.out, STORAGE_STATE_FILE); }
// explicit file → the reserved default when a cookie domain matches the host → null; --fresh-state → null
function resolveStorageStateFile(args) {
  if (args.freshState) return null;
  if (args.storageState) { if (!existsSync(args.storageState)) throw new Error(`--storage-state ${args.storageState}: file not found`); return args.storageState; }
  const file = storageStatePath(args);
  if (!existsSync(file)) return null;
  try {
    const host = new URL(args.url).hostname.toLowerCase();
    const cookies = JSON.parse(readFileSync(file, 'utf8')).cookies || [];
    return cookies.some((c) => { const d = String(c.domain || '').toLowerCase().replace(/^\./, ''); return d && (host === d || host.endsWith(`.${d}`)); }) ? file : null;
  } catch { return null; }
}
async function saveStorageStateFile(context, file) { return writeStorageStateFile(await context.storageState(), file); }
async function writeStorageStateFile(state, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  return (state.cookies || []).length;
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
// Pure (status, headers, url) → marker string | null; pinned by evals/fixtures.
const WALL_COOKIES = ['_pxhd', '_px3', '_pxvid', 'datadome'];
export function challengeMarker(status, headers = {}, url = '') {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = String(v ?? '');
  // Cloudflare stamps this header specifically on managed/JS-challenge responses.
  if ((h['cf-mitigated'] || '').toLowerCase() === 'challenge') return 'cf-mitigated: challenge';
  const server = (h.server || '').toLowerCase();
  if (status < 400) return null; // a served page is the page — PX/DataDome set their ids on admitted responses too
  // PerimeterX / DataDome walls: the 403 (often via Varnish) carries NO other
  // edge signature — the set-cookie names are what identify it.
  const cookieNames = (h['set-cookie'] || '').split(/\r?\n/).map((c) => c.trim().split('=')[0].toLowerCase()).filter(Boolean);
  const wall = cookieNames.find((n) => WALL_COOKIES.includes(n));
  if (wall) return `HTTP ${status} + set-cookie ${wall} (PerimeterX/DataDome wall)`;
  if (h['x-datadome'] || server.includes('datadome')) return `HTTP ${status} + DataDome edge signature`;
  // Akamai escalates to a 400 JSON body ({"result":"Bad Request"}, server: AkamaiGHost) — not a 403 interstitial
  if (status === 400 && (server.includes('akamaighost') || Object.keys(h).some((k) => k.startsWith('x-akamai')))) return 'HTTP 400 + AkamaiGHost (Akamai escalation body, not the page)';
  // A hard 403/429/503 that ALSO carries an edge/CDN signature is an edge
  // interstitial (Cloudflare / Akamai / F5 / Imperva) — headed real Chrome is the
  // correct response regardless of vendor. Requiring the edge signature (not the
  // bare status) is deliberate: isChallengeResponse gates clearChallenge() on
  // EVERY page, so a legitimate app-level 403 (e.g. an auth-gated deep page with
  // no CDN header) must fail fast, not eat the ~12s challenge-solve retry loop —
  // and a BARE 429 is a rate limit, handled as such (HostBudget), never a challenge.
  if (status === 403 || status === 429 || status === 503) {
    if (h['cf-ray'] || server.includes('cloudflare')) return `HTTP ${status} + Cloudflare edge signature`;
    if (h['x-akamai-transformed'] || server.includes('akamai') || server.includes('edgesuite') || /edgesuite\.net/.test(url)) return `HTTP ${status} + Akamai edge signature`;
    if (server.includes('big-ip') || server.includes('imperva') || h['x-iinfo']) return `HTTP ${status} + F5/Imperva edge signature`;
    // no edge signature — treat as a genuine app-level status, not a challenge.
  }
  return null;
}
function isChallengeResponse(resp) {
  if (!resp) return false;
  return challengeMarker(resp.status(), resp.headers(), resp.url()) !== null;
}
// The 200-status walls the header stage cannot see (PerimeterX px-captcha,
// Turnstile / hCaptcha / DataDome iframes) and the interstitial phrases — read
// from the page already loaded (no extra hit). Used by the --solve-wait poll.
const CHALLENGE_DOM = '#px-captcha, [id^="px-captcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="captcha-delivery.com"]';
export const CHALLENGE_PHRASE = /(press\s*&?\s*hold|before we continue|are you a human|verify you are human|access to this page has been denied|checking your browser|just a moment)/i;
async function challengeInDom(page) {
  const st = await page.evaluate((sel) => { const t = document.body ? document.body.innerText : ''; return { len: t.length, head: t.slice(0, 4000), dom: !!document.querySelector(sel), h: document.documentElement.scrollHeight, vh: window.innerHeight }; }, CHALLENGE_DOM).catch(() => null);
  // evaluate rejected = the page is navigating (a solve reloads it, a late
  // redirect is in flight): PENDING — neither clean nor a detected wall. Only a
  // read DOM may say `walled`, so a transient failure never opens the solve
  // window on a page that has no challenge.
  if (!st) return { walled: false, pending: true, st: null };
  const walled = st.dom || (st.len < 1500 && CHALLENGE_PHRASE.test(st.head));
  return { walled, pending: false, st };
}
// probe entry check: a pending read gets ONE settle-and-retry before it counts as clean
async function challengeInDomSettled(page) {
  let r = await challengeInDom(page);
  if (r.pending) { await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {}); r = await challengeInDom(page); }
  return r;
}
// --solve-wait: poll the SAME page (never reload — that destroys a Press & Hold
// in progress) until two consecutive clean polls, or the deadline.
async function solveWait(page, ms) {
  console.error(`[crawl] --solve-wait ${ms}: a visible Chrome window is open — complete the challenge by hand; capture resumes after two clean polls (every 2.5 s)`);
  const deadline = Date.now() + ms;
  let clean = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    const { walled, pending, st } = await challengeInDom(page);
    const ok = !pending && !walled && st.len >= 800 && st.h > 1.5 * st.vh;
    clean = ok ? clean + 1 : 0;
    if (clean >= 2) return true;
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

// ---- discovery: --pages > robots-declared sitemaps > standard paths > CMS conventions > nav union / BFS ----
// Precedence is by SOURCE, first non-empty tier wins; <lastmod> is recorded on
// every candidate but never decisive (dynamic sitemaps stamp "today"; a stale
// legacy map was 3.5× larger than the authoritative one). Every fetch runs
// in-page (browser UA, admitted cookies — hit minimisation on bot-walled
// origins) and every guessed URL counts as a probe: robots.txt (1), the two
// standard paths only when robots names nothing, the CMS conventions only when
// those are empty too and the origin is not bot-walled. Typical run: 2–3 probes.
export function parseRobots(text, origin) {
  const sitemaps = []; let crawlDelay = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'sitemap') { try { sitemaps.push(new URL(val, origin).href); } catch { /* malformed directive */ } }
    else if (key === 'crawl-delay') { const n = parseFloat(val); if (Number.isFinite(n) && n > 0) crawlDelay = Math.max(crawlDelay || 0, n); }
  }
  return { sitemaps: [...new Set(sitemaps)], crawlDelay };
}
const SITEMAP_MAX_DEPTH = 3; // ia-extraction.md § Recursive sitemap traversal
export const UNPACED_DISCOVERY = new Set(['/robots.txt', '/sitemap.xml', '/sitemap_index.xml', '/.sitemap.xml', '/sitemap.aspx']); // the guessed probes; everything else discovery fetches is paced
const SITEMAP_MAX_URLS = 10000;
const ASSET_RE = /\.(css|js|mjs|json|xml|pdf|png|jpe?g|gif|svg|webp|avif|ico|zip|gz|mp4|webm|mp3|woff2?|ttf|otf)(?:[?#]|$)/i;
// depth-first over <sitemapindex> children (visited set, depth ≤ 3); <urlset>
// leaves aggregate. Kind is read from the ROOT TAG, not the URL extension.
async function collectSitemap(url, io, st, depth) {
  if (st.visited.has(url)) return;
  if (depth > SITEMAP_MAX_DEPTH) { st.deepDropped += 1; return; }
  st.visited.add(url); st.fetches += 1;
  const xml = await io.fetchText(url);
  if (xml == null) { if (depth === 1) st.rootUnreachable = true; return; }
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].trim());
  for (const m of xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)) if (!st.maxLastmod || m[1] > st.maxLastmod) st.maxLastmod = m[1].trim();
  const isIndex = /<sitemapindex[\s>]/i.test(xml) || (locs.length > 0 && locs.every((u) => /\.xml(?:\.gz)?(?:[?#]|$)/i.test(u)));
  if (isIndex) { for (const child of locs) { try { await collectSitemap(new URL(child, url).href, io, st, depth + 1); } catch { st.malformed.push(child); } } return; }
  for (const loc of locs) {
    if (st.leaves.length >= SITEMAP_MAX_URLS) { st.truncated = true; break; }
    try { st.leaves.push(new URL(loc, url).href); } catch { st.malformed.push(loc); }
  }
}
/**
 * The roster decision, browser-free (evals/fixtures/crawl-discover.test.mjs
 * drives it over a local static server). `io.fetchText(url)` → body or null;
 * `navLinks` are the probe page's same-origin hrefs (0 extra hits).
 * Returns { urls, discovery } — `discovery` is the block written to
 * _crawl-log.json (ia-extraction.md § _crawl-log.json shape).
 */
export async function discoverInventory({ entry, origin, entryPath = null, max = Infinity, botBlock = null, depth = 1, navLinks = [] }, io) {
  const scopePath = entryPath && entryPath !== '/' ? entryPath.replace(/\/+$/, '') : null;
  const sameOrigin = (u) => u === origin || u.startsWith(`${origin}/`);
  const inScope = (u) => { if (!scopePath) return true; try { const p = new URL(u).pathname.replace(/\/+$/, ''); return p === scopePath || p.startsWith(`${scopePath}/`); } catch { return false; } };
  const pageLike = (u) => sameOrigin(u) && !ASSET_RE.test(new URL(u).pathname);
  const candidates = []; const malformed = []; let probes = 0; let fetches = 0;
  const abs = (p) => new URL(p, origin).href;
  const fetchTier = async (urls, tier, { all, guessed }) => {
    const leaves = [];
    for (const u of urls) {
      if (!all && leaves.length) { candidates.push({ url: u, tier, rejected: 'lower-precedence' }); continue; }
      if (guessed) probes += 1;
      const st = { visited: new Set(), leaves: [], malformed: [], maxLastmod: null, truncated: false, deepDropped: 0, fetches: 0 };
      await collectSitemap(u, io, st, 1);
      fetches += st.fetches; malformed.push(...st.malformed);
      const pages = [...new Set(st.leaves.filter(pageLike))];
      candidates.push({ url: u, tier, count: pages.length, ...(st.maxLastmod ? { maxLastmod: st.maxLastmod } : {}), ...(st.truncated ? { truncated: true } : {}), ...(st.deepDropped ? { deepDropped: st.deepDropped } : {}), ...(pages.length ? {} : { rejected: st.rootUnreachable ? 'unreachable' : 'empty' }) });
      leaves.push(...pages);
    }
    return leaves;
  };
  // tier 1 — robots.txt Sitemap: directives (all of them: they partition the site)
  probes += 1; fetches += 1;
  const robots = parseRobots(await io.fetchText(abs('/robots.txt')), origin);
  let leaves = []; let source = null; let sourceUrl = null;
  if (robots.sitemaps.length) {
    leaves = await fetchTier(robots.sitemaps, 'robots', { all: true, guessed: false });
    if (leaves.length) { source = 'robots.txt'; sourceUrl = robots.sitemaps.length === 1 ? robots.sitemaps[0] : robots.sitemaps; }
  }
  // tier 2 — the two standard paths, only when robots named nothing usable
  if (!leaves.length) {
    leaves = await fetchTier([abs('/sitemap.xml'), abs('/sitemap_index.xml')], 'standard', { all: false, guessed: true });
    if (leaves.length) { const w = candidates.find((c) => c.tier === 'standard' && c.count); source = new URL(w.url).pathname.slice(1); sourceUrl = w.url; }
  }
  // tier 3 — CMS conventions (AEM dot-prefixed map, ASP.NET handler), never on a bot-walled origin
  if (!leaves.length && !botBlock) {
    leaves = await fetchTier([abs('/.sitemap.xml'), abs('/sitemap.aspx')], 'convention', { all: false, guessed: true });
    if (leaves.length) { const w = candidates.find((c) => c.tier === 'convention' && c.count); source = new URL(w.url).pathname.slice(1); sourceUrl = w.url; }
  }
  // census over everything the sitemaps declared (pre-scope): the honest "how many pages" answer
  const seenAll = new Set(); const byPrefix = {};
  for (const u of leaves) {
    const k = dedupeKey(u); if (seenAll.has(k)) continue; seenAll.add(k);
    const seg = new URL(u).pathname.split('/').filter(Boolean)[0]; const key = seg ? `/${seg}` : '/';
    byPrefix[key] = (byPrefix[key] || 0) + 1;
  }
  const census = { total: seenAll.size, byPrefix: Object.fromEntries(Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).slice(0, 20)) };
  // scope + nav union (always: sitemap-blind sections live in the nav)
  const scoped = leaves.filter(inScope);
  const sitemapKeys = new Set(scoped.map(dedupeKey));
  const nav = [...new Set(navLinks.map((h) => { try { return normalizeUrl(h, origin); } catch { return null; } }).filter(Boolean).filter(pageLike).filter(inScope))];
  const navOnly = nav.filter((u) => !sitemapKeys.has(dedupeKey(u)));
  let union = [...scoped, ...navOnly];
  let bfs = null;
  if (!scoped.length) {
    // BFS fallback — hop 1 is the probe page (0 hits); hops 2..depth fetch HTML
    // in-page (never full navigations); breadth max(200, cap); depth 1 under botBlock
    const maxDepth = Math.max(1, Math.min(3, botBlock ? 1 : depth || 1));
    const breadth = Math.max(200, Number.isFinite(max) ? max : 0);
    const seen = new Map([[dedupeKey(entry), entry]]); const order = [];
    let frontier = [];
    for (const u of nav) { const k = dedupeKey(u); if (!seen.has(k)) { seen.set(k, u); order.push(u); frontier.push(u); } }
    let fetched = 0; let hop = 1;
    while (hop < maxDepth && frontier.length && seen.size < breadth) {
      hop += 1; const next = [];
      for (const u of frontier) {
        if (seen.size >= breadth) break;
        const html = await io.fetchText(u); fetched += 1; fetches += 1;
        if (!html) continue;
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
          if (/^(mailto:|tel:|javascript:)/i.test(m[1])) continue;
          let h; try { h = normalizeUrl(m[1], u); } catch { continue; }
          if (!pageLike(h) || !inScope(h)) continue;
          const k = dedupeKey(h);
          if (!seen.has(k)) { seen.set(k, h); order.push(h); next.push(h); if (seen.size >= breadth) break; }
        }
      }
      frontier = next;
    }
    union = order; bfs = { depth: hop, visited: seen.size, fetched };
    source = source ? `${source}+bfs` : 'bfs'; // a sitemap that had nothing under the scope still counts as consulted
  } else if (!source) source = 'nav';
  // entry first, slash-insensitive dedupe, cap → kept / cut
  const seen = new Set(); const all = [];
  for (const u of [entry, ...union]) { const k = dedupeKey(u); if (!seen.has(k)) { seen.add(k); all.push(u); } }
  const kept = all.slice(0, max); const cut = all.slice(kept.length).map((url) => ({ url, reason: 'cap' }));
  const discovery = {
    source, sourceUrl, subtree: scopePath, census, navOnly: navOnly.length, probes, fetches, candidates, malformed: malformed.slice(0, 50),
    kept, cut: cut.slice(0, 2000), ...(cut.length > 2000 ? { cutTruncated: cut.length } : {}), ...(bfs ? { bfs } : {}), ...(robots.crawlDelay ? { crawlDelay: robots.crawlDelay } : {}),
  };
  return { urls: kept, discovery };
}
// --cookie name=value[;Path=/] — repeatable; applied to every context via addCookies.
// Only the NAME is ever logged (runs[].args.cookie) — provenance without secrets (D3 spirit).
export function parseCookieFlag(spec) {
  const [pair, ...attrs] = String(spec || '').split(';').map((x) => x.trim()).filter(Boolean);
  const eq = pair ? pair.indexOf('=') : -1;
  if (eq <= 0) throw new Error(`--cookie expects name=value[;Path=/] (got ${JSON.stringify(spec)})`);
  const c = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1), path: '/' };
  for (const a of attrs) { const m = a.match(/^path\s*=\s*(.+)$/i); if (m) c.path = m[1].trim(); }
  return c;
}
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
    return { urls, discovery: { source: '--pages', subtree: null, kept: urls, cut: [] } };
  }
  // every discovery fetch rides the probe page: browser UA, admitted cookies, one
  // origin — and takes a budget token unless it is one of the ≤ 5 guessed probes
  // (sitemap-index children and BFS hops are the burst the budget exists to prevent)
  const io = { fetchText: async (u) => {
    if (args.budget && !UNPACED_DISCOVERY.has(new URL(u).pathname)) await args.budget.take();
    return page.evaluate(async (x) => { try { const r = await fetch(x, { credentials: 'include' }); return r.ok ? await r.text() : null; } catch { return null; } }, u);
  } };
  const navLinks = await page.evaluate((origin) => [...document.querySelectorAll('a[href]')]
    .map((a) => a.href).filter((h) => h.startsWith(origin)), args.origin);
  return discoverInventory({ entry, origin: args.origin, entryPath: args.entryPath, max: args.max, botBlock: args.botBlock, depth: args.depth, navLinks }, io);
}

// Consent containers whose presence after the dismissal pass means `failed`
// (banner detected, nothing hid it) rather than `none-detected`.
const CONSENT_CONTAINERS = '#onetrust-banner-sdk, #truste-consent-track, #usercentrics-root, #CybotCookiebotDialog, [id*="didomi"], [id*="osano"], [class*="cookie" i][class*="banner" i], [id*="consent" i]';
// Consent-method rank for _crawl-log.json#consent.method — the crawl keeps the
// most informative value seen across pages (a click beats a no-op).
const consentRank = (m) => (/^(dismissed|text):/.test(m) ? 3 : m === 'failed' ? 2 : m === 'none-detected' ? 1 : 0);

// ---- Shared consent-label tables and DOM helpers -------------------------
// SOURCE OF TRUTH: skills/diff/scripts/live-session.mjs (ACCEPT_LABELS,
// DECLINE_LABELS, SETTINGS_LABELS, CLOSE_LABELS, pageFindLabelled,
// pageClickInShadow). crawl.mjs is copied ALONE into projects (extract/SKILL.md
// § Setup) so it cannot import them; this is a byte-identical copy and
// evals/lint/launch-ladder.mjs fails when the two files drift — edit
// live-session.mjs first, then paste here. The lift, the capture and the gate
// must click the SAME control (D3), so one table serves all three.
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
export const SETTINGS_LABELS = ['cookie settings', 'manage cookies', 'manage preferences', 'settings', 'preferences', 'customize', 'customise', 'more options', 'einstellungen', 'cookie-einstellungen', 'paramétrer', 'personnaliser', 'preferenze', 'configurar', 'instellingen'];
const CLOSE_LABELS = ['close', 'no thanks', 'no, thanks', 'not now', 'maybe later', 'dismiss', 'skip', 'nein danke', 'non merci', 'no grazie', 'no, gracias', 'nee bedankt', 'nei takk', 'nej tak', 'nej tack', 'não, obrigado', 'nie, dziękuję', '×', '✕'];
// Accept selectors tried before the label tables (first VISIBLE match wins —
// all matches are inspected, never `.first()`: the hidden twin inside a
// collapsed settings view was clicked in one harvest while the visible one stayed).
const CONSENT_ACCEPT_SELS = ['#onetrust-accept-btn-handler', '.truste-button2', '#CybotCookiebotDialogBodyLevelButtonAccept',
  '[aria-label*="Accept" i]', 'button[id*="accept" i]', 'button[class*="accept" i]'];

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
 * Accept-mode consent dismissal (D3: lift, capture and gate click the SAME
 * control — replica's stitch-shot reads the value returned here as its default
 * `--consent`). Mirrors live-session.mjs dismissOverlays' consent pass:
 * visible-match selector iteration, the known shadow-hosted CMP, the exact-label
 * text fallback over light DOM + open shadow roots (ACCEPT_LABELS, overlay-scoped),
 * and a frames() pass for iframe-hosted invites (CLOSE_LABELS + DECLINE_LABELS).
 * capturePage runs it once after load and AGAIN after WAIT_MS — a banner whose
 * JS mounts it late was missed by the single pre-wait pass (recorded).
 * Returns the resolved method, one of
 *   dismissed:<sel>  a selector was clicked   text:<label>  the guarded text-match fallback clicked a label
 *   none-detected    no consent surface seen  failed        a consent container is present and nothing hid it
 * (playwright-recipe.md § Pre-flight: consent dismissal; values listed in extract/SKILL.md Phase 2 step 3).
 */
async function dismissConsent(page) {
  const MARK = 'data-stardust-hit';
  // Click the first VISIBLE match of a selector (all matches inspected).
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
  let matched = null;
  for (const s of CONSENT_ACCEPT_SELS) if (await clickVisible(s, 300)) { matched = s; break; }
  // Usercentrics renders inside shadow DOM (#usercentrics-root) — regular
  // selectors can't reach it (tools-retailer e2e finding). Accept first (D3).
  let ucMatched = null;
  if (!matched) {
    for (const sel of ['[data-testid="uc-accept-all-button"]', '[data-testid="uc-deny-all-button"]']) {
      if (await page.evaluate(pageClickInShadow, { hostSel: '#usercentrics-root', sel }).catch(() => false)) { ucMatched = sel; await page.waitForTimeout(300); break; }
    }
  }
  // Text-match fallback, only when the selector passes matched NOTHING (two
  // field harvests, 2026-08: a custom dialog and cookieconsent's a.cc-btn were
  // missed by the list above; one banner baked into the ground-truth screenshot
  // AND repeated at all 7 stitch seams → 32% false pixel diff). B28-narrow
  // guards keep it from ever hitting an in-content link: exact match on a short
  // consent label (≤25 chars), visible, inside a fixed/sticky or high-z overlay
  // container; light DOM + open shadow roots. Worst case = banner stays.
  let textHit = null;
  if (!matched && !ucMatched) {
    const hit = await page.evaluate(pageFindLabelled, { labels: ACCEPT_LABELS, marker: MARK, requireOverlay: true }).catch(() => null);
    if (hit) {
      await page.evaluate((m) => { for (const el of document.querySelectorAll(`[${m}]`)) { el.click(); el.removeAttribute(m); } }, MARK).catch(() => {});
      textHit = hit.label;
      console.error(`[crawl] consent dismissed via text-match fallback ("${hit.label}"${hit.host ? `, shadow ${hit.host}` : ''})`);
      await page.waitForTimeout(300);
    }
  }
  // Survey / feedback invites hosted in an iframe: close/decline label inside
  // every child frame (no navigation — the frame is already loaded).
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let hit = null;
    try { hit = await frame.evaluate(pageFindLabelled, { labels: [...CLOSE_LABELS, ...DECLINE_LABELS], marker: MARK, requireOverlay: false }); } catch { continue; }
    if (!hit) continue;
    await frame.evaluate((m) => { for (const el of document.querySelectorAll(`[${m}]`)) { el.click(); el.removeAttribute(m); } }, MARK).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);
  // resolved method BEFORE the prune — a container that survived every pass is `failed`
  const stillPresent = (matched || ucMatched || textHit) ? false : await page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .some((n) => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; }), CONSENT_CONTAINERS).catch(() => false);
  // assert: prune any consent container still present (don't leave it for capture).
  await page.evaluate((sel) => { document.querySelectorAll(sel).forEach((n) => n.remove()); }, CONSENT_CONTAINERS).catch(() => {});
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
export function newDynamicRollup() {
  return { endpoints: new Map(), thirdPartyScriptHosts: new Map(), frameworkHints: new Map(), globalState: new Map(), formTargets: new Map(), pages: 0, pagesWithSameSiteData: 0, pagesWithSearchForm: 0, pagesHydrated: 0, truncatedPages: 0, pagesWithTabs: 0, pagesWithPlayers: 0, pagesWithLooseControls: 0, pagesWithChat: 0, pagesWithFederated: 0, pagesWithQuiz: 0, searchShellPages: 0 };
}
function bump(map, key, slug, extra) {
  const row = map.get(key) || { ...extra, pages: 0, examples: [] };
  row.pages += 1;
  if (row.examples.length < 3) row.examples.push(slug);
  map.set(key, row);
}
export function rollupDynamic(acc, d, slug) {
  acc.pages += 1;
  if (d.truncated) acc.truncatedPages += 1;
  if (d.summary.sameSiteEndpoints) acc.pagesWithSameSiteData += 1;
  if (d.summary.searchForms) acc.pagesWithSearchForm += 1;
  if (d.summary.hydrated) acc.pagesHydrated += 1;
  if (d.summary.tabs) acc.pagesWithTabs += 1;
  if (d.summary.players) acc.pagesWithPlayers += 1;
  if (d.summary.controlGroups) acc.pagesWithLooseControls += 1;
  if (d.summary.chatLoaders) acc.pagesWithChat += 1;
  if (d.summary.federated) acc.pagesWithFederated += 1;
  if (d.summary.quiz) acc.pagesWithQuiz += 1;
  if (d.summary.searchShell) acc.searchShellPages += 1;
  for (const e of d.endpoints) bump(acc.endpoints, `${e.method} ${e.host}${e.path}`, slug, { method: e.method, host: e.host, path: e.path, query: e.query, resourceType: e.resourceType, contentType: e.contentType, sameSite: e.sameSite, example: e.example });
  for (const h of d.thirdPartyScriptHosts) bump(acc.thirdPartyScriptHosts, h.host, slug, { host: h.host });
  for (const f of d.frameworkHints) bump(acc.frameworkHints, f, slug, { hint: f });
  for (const g of d.globalState) bump(acc.globalState, g, slug, { name: g });
  for (const f of d.forms) bump(acc.formTargets, `${f.method} ${f.action || '(js-handled)'}`, slug, { action: f.action, method: f.method, sameOrigin: f.sameOrigin, search: f.search, fieldNames: f.fieldNames });
}
export function finalizeDynamic(acc) {
  const list = (m, cap) => [...m.values()].sort((a, b) => b.pages - a.pages).slice(0, cap);
  return {
    pages: acc.pages,
    pagesWithSameSiteData: acc.pagesWithSameSiteData,
    pagesWithSearchForm: acc.pagesWithSearchForm,
    pagesHydrated: acc.pagesHydrated,
    truncatedPages: acc.truncatedPages,
    pagesWithTabs: acc.pagesWithTabs,
    pagesWithPlayers: acc.pagesWithPlayers,
    pagesWithLooseControls: acc.pagesWithLooseControls,
    pagesWithChat: acc.pagesWithChat,
    pagesWithFederated: acc.pagesWithFederated,
    pagesWithQuiz: acc.pagesWithQuiz,
    searchShellPages: acc.searchShellPages,
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
  // capture-quality signals (recorded, never thrown — the DOM is still evidence):
  //   emptyMain — a landmark exists but is blank (header/footer headings kept
  //     the soft-404 check quiet while <main> was an unhydrated shell);
  //   brokenImages / subResourceBlock — images the edge 403'd while the
  //     document itself loaded (broken-image icons recorded as a success);
  //   overlayCoverPct — fixed-position overlay ∩ first viewport, in % of the
  //     viewport: a survey/feedback modal with a dimming scrim the consent pass
  //     did not know covers most of it; the dismissal already removed CMPs.
  const landmark = document.querySelector('main, [role="main"]');
  const emptyMain = !!landmark && text(landmark).length < 50 && realImgs.length === 0;
  const withSrc = [...document.querySelectorAll('img[src]')].filter((im) => im.getAttribute('src') && !/^data:/i.test(im.getAttribute('src')));
  const brokenImages = withSrc.filter((im) => im.complete && im.naturalWidth === 0).length;
  const subResourceBlock = brokenImages >= Math.max(3, Math.ceil(withSrc.length * 0.3));
  let overlayArea = 0;
  const vw = window.innerWidth; const vh = window.innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (el.closest('[aria-hidden="true"],[hidden]')) continue;
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0); const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (w > 0 && h > 0) overlayArea += w * h;
  }
  const overlayCoverPct = Math.min(100, Math.round((overlayArea / Math.max(1, vw * vh)) * 100));

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
      emptyMain,
      brokenImages,
      subResourceBlock,
      overlayCoverPct,
    },
    _compatMode: document.compatMode, // 'CSS1Compat' | 'BackCompat' (quirks) → _provenance.compatMode
    _contentHash: contentHash,
  };
}

// captureQuality from the in-page signals — 'degraded' when the record is real
// DOM but not the page as a visitor sees it (Phase 2.5 treats it as `suspect`
// until recaptured at a higher tier). Pure: pinned by evals/fixtures.
export function captureQualityOf(s) {
  return s && (s.emptyMain || s.subResourceBlock) ? 'degraded' : 'ok';
}
export const OVERLAY_FLAG_PCT = 30; // page line prints OVERLAY? above this

// Chromium wraps (does not throw) a full-page raster above its 16,384 px
// texture limit: rows repeat and the tail is lost. Above SHOT_WRAP_PX the page
// is captured in clip bands instead; the fixture pins the threshold.
export const SHOT_WRAP_PX = 16000;
const SHOT_BAND_PX = 8000;
/**
 * One page → PNG(s) under shotsDir. Returns { mode, files, docHeight, bands? }:
 *   fullPage  one raster (docHeight ≤ SHOT_WRAP_PX)
 *   banded    <base>.png + <base>.part2.png… (clip bands of ≤ SHOT_BAND_PX)
 *   clipped   first viewport only — the raster threw; the tail is missing by
 *             instrument (never a vision-gate `suspect` for that reason)
 *   failed    nothing written
 */
async function screenshotPage(page, base, shotsDir) {
  const docHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0)).catch(() => 0);
  const vp = page.viewportSize() || CRAWL_CONTEXT.viewport;
  const files = [];
  if (docHeight > SHOT_WRAP_PX) {
    try {
      for (let y = 0, i = 1; y < docHeight; y += SHOT_BAND_PX, i += 1) {
        const file = i === 1 ? `${base}.png` : `${base}.part${i}.png`;
        await page.screenshot({ path: path.join(shotsDir, file), fullPage: true, clip: { x: 0, y, width: vp.width, height: Math.min(SHOT_BAND_PX, docHeight - y) }, timeout: 30000 });
        files.push(file);
      }
      return { mode: 'banded', files, docHeight, bands: files.length };
    } catch { files.length = 0; }
  } else {
    try {
      await page.screenshot({ path: path.join(shotsDir, `${base}.png`), fullPage: true, timeout: 30000 });
      return { mode: 'fullPage', files: [`${base}.png`], docHeight };
    } catch { /* fall through to the viewport clip */ }
  }
  try {
    await page.screenshot({ path: path.join(shotsDir, `${base}.png`), fullPage: false, timeout: 30000 });
    return { mode: 'clipped', files: [`${base}.png`], docHeight };
  } catch { return { mode: 'failed', files: [], docHeight }; }
}
// the 4-step lazy-load scroll + return-to-top + settle used before every capture
async function lazyScroll(page) {
  for (let y = 0; y <= 1; y += 0.34) {
    await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), y);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
}
const MOBILE_VIEWPORT = { width: 360, height: 900 }; // 900 = stitch-shot's default --vh, for gate symmetry

async function capturePage(context, url, slug, args, isEntry = false) {
  const page = await context.newPage();
  const recorder = args.dynamics ? attachDynamicRecorder(page) : null; // opt-in; must precede goto — load-time fetches are the evidence
  try {
  if (args.budget) await args.budget.take(); // per-host pacing — every navigation, every worker
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
  // BARE 429 (edge-signed ones were classified above) = rate limit, not a
  // challenge: halve the host ceiling, drop the pool to one worker, honour
  // Retry-After (≤ 60 s), retry ONCE, then fail the page with the hint.
  if (status === 429) {
    const ra = parseRetryAfter(resp.headers()['retry-after']);
    const waitMs = args.budget ? args.budget.rateLimited(ra) : Math.min(60, ra || 30) * 1000;
    noteRateLimited(args);
    console.error(`[crawl] HTTP 429 (rate limit, no edge signature) on ${slug} — pool → 1 worker, ceiling halved${args.budget ? ` (${args.budget.navPerMin}/min, ≥ ${args.budget.minGapMs / 1000} s)` : ''}; retrying once in ${Math.round(waitMs / 1000)} s`);
    await page.waitForTimeout(waitMs);
    if (args.budget) await args.budget.take();
    const again = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    if (again) { resp = again; status = again.status(); }
    if (status === 429) throw Object.assign(new Error(`HTTP 429 — rate-limited by ${new URL(url).hostname}; ceiling recorded in stardust/live-budget.json — rerun alone, later`), { errorClass: 'HTTPError', rateLimited: true });
  }
  // 404 on a slash variant: retry ONCE with the trailing slash flipped before
  // recording a failure (stardust-style e2e finding — slash-required hosts).
  let resolvedUrl = url;
  if (status === 404) {
    const u = new URL(url);
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.endsWith('/') ? u.pathname.replace(/\/+$/, '') : `${u.pathname}/`;
      // guarded + short timeout: a hanging flipped-variant probe must not
      // replace the crisp HTTPError 404 with a raw TimeoutError.
      if (args.budget) await args.budget.take();
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

  let consentMethod = args.consent ? await dismissConsent(page) : 'skipped';
  await page.waitForTimeout(WAIT_MS[args.wait] || WAIT_MS.medium);
  // Second consent pass AFTER the wait: a banner mounted by late JS is missed
  // by the pre-wait pass (recorded — the project copy had to be patched by hand).
  if (args.consent && consentRank(consentMethod) < 3) {
    const late = await dismissConsent(page);
    if (consentRank(late) > consentRank(consentMethod)) consentMethod = late;
  }
  // 4-step scroll to trigger lazy content, return to top, then settle: entry
  // animations (hero reveals) must reach their final state before the
  // visibility filter reads computed opacity, or the animated h1 is silently
  // dropped. reducedMotion emulation neutralizes most of it; the settle covers
  // JS-driven reveals. Deliberately a FLAT wait: gating on
  // document.getAnimations() was tried and re-dropped the h1 — a JS-delayed
  // reveal has no running animation at check time, so the gate resolves before
  // the reveal even starts. The 800ms floor inside lazyScroll is load-bearing.
  await lazyScroll(page);

  const rec = await page.evaluate(capture);
  const compatMode = rec._compatMode || null;
  delete rec._compatMode;
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
        // reach-signal counts (T34.7): the site-level roll-up and dynamics-detect --reach read these first
        tabs: dom.tabs.tablists + dom.tabs.expanders,
        players: dom.players.length,
        controlGroups: dom.controlGroups.length,
        chatLoaders: dom.chatLoaders.length,
        federated: dom.federated.remoteEntries.length + dom.federated.registerCalls,
        quiz: dom.quiz.markers + dom.quiz.radioFieldsets,
        searchShell: dom.searchShell,
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
  // screenshots for the Phase 2.5 vision gate (screenshotPage: fullPage |
  // banded above SHOT_WRAP_PX | clipped | failed). The record above is the
  // 1440 DOM; the 360 pass below only re-lays out the same page for its PNG.
  const shotsDir = path.join(args.out, 'assets', 'screenshots');
  await mkdir(shotsDir, { recursive: true });
  const shot = await screenshotPage(page, slug, shotsDir);
  rec.screenshot = shot.files.length ? `assets/screenshots/${shot.files[0]}` : null;
  rec._signals.screenshotMode = shot.mode;
  rec._signals.docHeight = shot.docHeight;
  if (shot.bands) rec._signals.screenshotBands = shot.bands;
  // 360 shot — same page, no navigation (hit minimisation; consent and solved
  // bot state inherited). Mobile layouts are taller, so banding fires here first.
  if (args.mobile === 'all' || (args.mobile === 'entry' && isEntry)) {
    await page.setViewportSize(MOBILE_VIEWPORT).catch(() => {});
    await lazyScroll(page);
    const m = await screenshotPage(page, `${slug}${MOBILE_SHOT_SUFFIX}`, shotsDir);
    rec.screenshotMobile = m.files.length ? `assets/screenshots/${m.files[0]}` : null;
    rec._signals.screenshotMobileMode = m.mode;
    if (m.bands) rec._signals.screenshotMobileBands = m.bands;
  }
  rec._signals.captureQuality = captureQualityOf(rec._signals);
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
    storageState: !!args.sessionReused, // the worker ran on the probe's admitted session (clone / loaded file) — SKILL.md Setup step 3
    variants: await collectVariants(page, context),
    compatMode, // 'CSS1Compat' | 'BackCompat' — a quirks-mode source needs its doctype mirrored (recreation-procedure.md § CSS lifting)
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
  if (args.help) { printHelp(); return; }
  const { chromium } = await import('playwright');
  // per-run context options shared by probe and workers (--dpr; the admitted
  // session, once the probe has one, is added below)
  const ctxExtra = { deviceScaleFactor: args.dpr };
  const loadedState = resolveStorageStateFile(args);
  if (loadedState) { ctxExtra.storageState = loadedState; console.error(`[crawl] storage state: loading ${loadedState} into the probe (--fresh-state to opt out)`); }
  // --cookie → Playwright cookie records on the (possibly adopted) origin's host
  const cookiesFor = (a) => a.cookies.map((c) => ({ name: c.name, value: c.value, domain: new URL(a.origin).hostname, path: c.path }));
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
  let host = new URL(probeUrl).hostname;
  let liveLock = acquireLiveLock(args, host); // one live tool per origin; released on exit (re-keyed after an origin redirect)
  args.budget = makeBudget(args, host, null); // paced from the FIRST navigation; tuned after discovery (adopted host, Crawl-delay)
  persistOnFatal = () => { if (args.budget?.rateLimits) persistBudget(args, host, args.budget); };
  for (;;) {
    browser = await launchTier(chromium, tier);
    context = await newContext(browser, tier >= 2, ctxExtra, cookiesFor(args));
    probe = await context.newPage();
    let blocked = null;
    try {
      await args.budget.take();
      let probeResp = await probe.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: tier === 1 ? 30000 : 45000 });
      // a BARE 429 on the probe is a rate limit, not admission: same path as a
      // worker (halve, persist, Retry-After, ONE retry), then fatal — nothing
      // downstream may run discovery on a 429 body and call the site "1 page".
      if (probeResp && probeResp.status() === 429 && !isChallengeResponse(probeResp)) {
        const waitMs = probeRateLimited(args, host, probeResp);
        await probe.waitForTimeout(waitMs);
        await args.budget.take();
        probeResp = await probe.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (probeResp && probeResp.status() === 429) throw Object.assign(new Error(`HTTP 429 — rate-limited by ${host}; ceiling recorded in stardust/live-budget.json — rerun alone, later`), { errorClass: 'HTTPError', rateLimited: true });
      }
      if (tier === 3 && args.solveWait) {
        // interactive solve: header stage OR DOM stage says wall → wait for the human, no reload
        if (isChallengeResponse(probeResp) || (await challengeInDomSettled(probe)).walled) {
          const solved = await solveWait(probe, args.solveWait);
          if (!solved) throw Object.assign(new Error(`bot challenge not solved in ${args.solveWait} ms (--solve-wait) — nothing captured`), { errorClass: 'BotChallengeError', nextTier: null });
          botBlock = botBlock || 'challenge'; // a cleared challenge → the state is saved below
          escalations.push({ tier: TIERS[2], block: 'challenge', solved: 'interactive' });
          probeResp = null;
        }
      } else if (tier === 3) probeResp = await clearChallenge(probe, probeResp);
      if (probeResp && isChallengeResponse(probeResp)) blocked = { kind: 'challenge', status: probeResp.status() };
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
  // clone the admitted probe session into every worker context (clearance,
  // consent and A/B cookies ride along); persist it when a challenge was
  // cleared or asked for. A worker re-challenged despite the clone still
  // escalates — the clone never softens the fail-loud contract.
  ctxExtra.storageState = await context.storageState().catch(() => ctxExtra.storageState);
  let savedState = null;
  if (botBlock || args.saveState) {
    try {
      const n = await saveStorageStateFile(context, storageStatePath(args));
      savedState = storageStatePath(args);
      console.error(`[crawl] storage state: saved ${savedState} (${n} cookies; downstream live instruments reuse it by default). Fingerprint-bound clearances (PerimeterX/HUMAN) will not replay; Cloudflare's managed clearance does until it escalates.`);
    } catch (e) { console.error(`[crawl] WARN could not save storage state: ${e.message}`); }
  }
  args.sessionReused = sessionReusedOf({ botBlock, loadedState, cookies: ctxExtra.storageState?.cookies?.length || 0 });
  // one worker under a bot block: concurrency 4 drew 9 re-challenges even with
  // the cloned session; some origins score SESSIONS, not requests
  if ((tier > 1 || botBlock) && args.concurrency > 1) { console.error(`[crawl] concurrency ${args.concurrency} → 1 (bot-management tier ${tier}${botBlock ? `, ${botBlock} cleared` : ''}: one context, human pace)`); args.concurrency = 1; }
  let technique = TIERS[tier - 1];
  let stealth = tier >= 2;
  args.tier = tier;
  args.solveWindow = tier === 3;
  const offscreenNote = () => { if (args.tier === 3 && process.env.STARDUST_HEADED_WINDOW !== '1') console.error('[crawl] tier 3: Chrome window parked off-screen (STARDUST_HEADED_WINDOW=1 to show it)'); };
  offscreenNote();

  // adopt the post-redirect origin (apex→www etc.): the same-origin filter and
  // sitemap fetch must use where the site actually lives, or discovery silently
  // collapses to 1 page (agency-site e2e finding).
  let originRedirect = null; let entryRedirect = null;
  try {
    const landed = new URL(probe.url());
    if (landed.origin !== args.origin) {
      originRedirect = { from: args.origin, to: landed.origin };
      console.error(`[crawl] origin redirect ${args.origin} -> ${landed.origin} — adopting post-redirect origin`);
      args.url = new URL(new URL(args.url).pathname + new URL(args.url).search, landed.origin).href;
      args.origin = landed.origin;
    }
    // the subtree scope is the path the user TYPED: a root entry that
    // geo-redirects to /us/en must not silently scope the crawl to /us/en
    const typed = args.entryPath.replace(/\/+$/, '') || '/'; const got = landed.pathname.replace(/\/+$/, '') || '/';
    if (!args.pages && typed !== got) {
      entryRedirect = { from: typed, to: got, note: typed === '/' ? `entry redirected to ${got}; not scoped` : `entry redirected to ${got}; scoped to the typed ${typed}` };
      console.error(`[crawl] ${entryRedirect.note}`);
    }
  } catch { /* keep declared origin */ }
  if (new URL(args.origin).hostname !== host) { // lock key = budget key = where the site lives (outside the try: a LiveLockError here must surface)
    liveLock.release(); host = new URL(args.origin).hostname; liveLock = acquireLiveLock(args, host);
    tuneBudget(args.budget, args, host, null);
  }
  args.botBlock = botBlock;

  const { urls, discovery } = await discover(args, probe);
  tuneBudget(args.budget, args, host, discovery.crawlDelay); // Crawl-delay widens the gap now that robots.txt is read
  if (discovery.census) {
    const cut = discovery.cutTruncated || discovery.cut.length;
    console.error(`[crawl] discovered ${urls.length} page(s) via ${discovery.source}${discovery.subtree ? ` under ${discovery.subtree}` : ''} — census ${discovery.census.total} declared, ${discovery.navOnly} nav-only, ${discovery.probes} probe(s); kept ${discovery.kept.length}, cut ${cut}${cut ? ' (--all to lift)' : ''}`);
  }
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
  const entryKey = dedupeKey(normalizeUrl(args.url));
  const queue = urls.map((url, i) => ({ url, slug: allSlugs[i], entry: dedupeKey(url) === entryKey })).filter(({ url, slug }) => {
    if (args.force || args.refresh.includes(slug) || explicit.has(dedupeKey(url))) return true;
    const sp = statePages.get(slug);
    if (sp && EXTRACTED_OR_BEYOND.has(sp.status)) { skipped.push({ slug, url, status: sp.status }); return false; }
    return true;
  });
  if (skipped.length) console.error(`[crawl] skipping ${skipped.length} already-extracted page(s) (--force or --refresh <slug> to redo): ${skipped.map((x) => x.slug).join(', ')}`);
  console.error(`[crawl] technique=${technique} discovered=${urls.length} queued=${queue.length}`);
  const perNavMs = Math.max(60000 / args.budget.navPerMin, args.budget.minGapMs);
  if (queue.length) console.error(`[crawl] pacing ${host}: ≥ ${args.budget.minGapMs / 1000} s between navigations, ≤ ${args.budget.navPerMin}/min (${args.budget.source}) → ETA ~${Math.max(1, Math.ceil((queue.length * perNavMs) / 60000))} min for ${queue.length} page(s)`);

  const startedAt = new Date().toISOString();
  const { createProgress } = await loadProgressHelper();
  progress = createProgress({ file: args.progress, driver: 'crawl', total: queue.length, extra: { technique, discovered: urls.length, skipped: skipped.length, log: logPath } });
  const log = { discovery: { fetchTechnique: technique, count: urls.length, concurrency: args.concurrency, storageState: !!args.sessionReused, ...(loadedState || savedState ? { storageStateFile: savedState || loadedState } : {}), liveBudget: args.budget.toJSON(), ...discovery, ...(botBlock ? { botBlock, escalations } : {}), ...(originRedirect ? { originRedirect } : {}), ...(entryRedirect ? { entryRedirect } : {}), ...(skipped.length ? { skippedExtracted: skipped } : {}) }, consent: { method: args.consent ? 'none-detected' : 'skipped' }, favicon: favicon || null, crawl: { startedAt, finishedAt: null, successes: 0, failures: [] } };
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
  let admittedState = null; // storageState of a worker context that captured pages AFTER a capture-time escalation
  async function runPool() {
    const order = [...pending];
    let cursor = 0;
    escalate = 0;
    async function worker(wi) {
      const ctx = await newContext(browser, stealth, ctxExtra, cookiesFor(args));
      let captured = 0;
      while (cursor < order.length && !escalate && (wi === 0 || !args.throttled)) {
        const idx = order[cursor];
        cursor += 1;
        const { url, slug, entry: isEntry } = queue[idx];
        try {
          const rec = await capturePage(ctx, url, slug, args, isEntry);
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
          ok += 1; captured += 1;
          const s = rec._signals;
          const dy = rec.dynamic?.summary || {};
          const warn = [s.spaShellSuspect && 'SPA-SHELL?', s.trackingOnlyMedia && 'TRACKING-PIXEL-ONLY', s.filteredInterstitials && `filtered:${s.filteredInterstitials}`, s.captureQuality === 'degraded' && 'DEGRADED', s.overlayCoverPct > OVERLAY_FLAG_PCT && 'OVERLAY?', s.screenshotMode !== 'fullPage' && `shot:${s.screenshotMode}`, dy.sameSiteEndpoints && `data-endpoints:${dy.sameSiteEndpoints}`, dy.searchForms && 'SEARCH-FORM', dy.hydrated && 'HYDRATED'].filter(Boolean).join(' ');
          console.error(`[crawl] OK   ${slug}  ${warn}`);
          progress.tick({ ok: true, path: slug });
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
          progress.tick({ ok: false, path: slug });
        }
      }
      // the admitted session after a capture-time escalation lives HERE, not in the probe context saved before the pool
      if (captured && !escalate && escalations.some((e) => e.at === 'capture')) admittedState = await ctx.storageState().catch(() => admittedState);
      await ctx.close();
    }
    await Promise.all(Array.from({ length: Math.min(args.concurrency, order.length) }, (_, wi) => worker(wi)));
  }
  for (;;) {
    await runPool();
    await browser.close();
    if (!escalate) break;
    botBlock = botBlock || 'challenge';
    escalations.push({ tier: TIERS[args.tier - 1], block: 'challenge', at: 'capture' });
    if (args.concurrency > 1) { console.error('[crawl] concurrency → 1 for the escalated pass'); args.concurrency = 1; }
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
  log.discovery.concurrency = args.concurrency; // 1 after a bare 429 / escalation — what the pool actually ran at the end (liveBudget.rateLimits says why)
  if (admittedState && needsStateSave({ botBlock, saveState: args.saveState, savedState, escalatedAtCapture: true })) {
    try {
      const n = await writeStorageStateFile(admittedState, storageStatePath(args));
      savedState = storageStatePath(args); log.discovery.storageStateFile = savedState; log.discovery.storageState = true;
      console.error(`[crawl] storage state: saved ${savedState} after the capture-time escalation (${n} cookies; the pre-escalation state was not the admitted one)`);
    } catch (e) { console.error(`[crawl] WARN could not save storage state: ${e.message}`); }
  }
  log.discovery.liveBudget = { ...args.budget.toJSON(), ...(args.budget.rateLimits ? { rateLimits: args.budget.rateLimits } : {}), waitedMs: Math.round(args.budget.waitedMs) };
  if (args.budget.rateLimits) persistBudget(args, host, args.budget); // the learned ceiling outlives this run
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
    args: { url: args.url, pages: args.pages || null, cap: args.capLabel, wait: args.wait, concurrency: args.concurrency, dynamics: args.dynamics, refresh: args.refresh, force: args.force, headed: args.headed || null, solveWait: args.solveWait || null, depth: args.depth, cookie: args.cookies.map((c) => c.name), mobile: args.mobile, dpr: args.dpr, storageState: loadedState ? 'loaded' : args.freshState ? 'fresh' : 'clone', saveState: !!savedState },
    technique,
    discovered: urls.length,
    skipped: skipped.length,
    captured: ok,
    failed: [...failedNow],
  }, results.filter(Boolean).map((r) => r.slug));
  await writeFile(logPath, JSON.stringify(merged, null, 2));
  console.error(`[crawl] done. ${ok}/${queue.length} captured, ${failedNow.size} failed (${merged.crawl.failures.length} open across runs). log: ${logPath}`);
  progress.set({ technique });
  console.log(progress.summaryLine({ exit: 0, details: logPath, extra: { discovered: urls.length, skipped: skipped.length, technique, openFailures: merged.crawl.failures.length } }));
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
export const RUN_LEVEL_DISCOVERY = ['fetchTechnique', 'botBlock', 'escalations', 'concurrency', 'storageState', 'storageStateFile', 'liveBudget', 'skippedExtracted', 'originRedirect', 'entryRedirect'];
export function mergeCrawlLog(prev, log, run, okSlugs) {
  const failedNow = new Set(log.crawl.failures.map((x) => x.slug));
  const okNow = new Set(okSlugs);
  const carried = (prev.crawl?.failures || []).filter((x) => !okNow.has(x.slug) && !failedNow.has(x.slug));
  // _provenance is the first key of every stardust artifact (master skill § Provenance); the script owns this file.
  const { _provenance: prevProv, ...prevRest } = prev;
  const readArtifacts = [...new Set([...(prevProv && prevProv.readArtifacts) || [], log.discovery && log.discovery.sourceUrl].filter(Boolean))];
  const merged = { _provenance: { writtenBy: 'stardust:extract', writtenAt: new Date().toISOString(), script: 'crawl.mjs', readArtifacts }, ...prevRest, ...log, crawl: { ...log.crawl, failures: [...carried, ...log.crawl.failures] } };
  if (prev.discovery && (prev.discovery.count || 0) > (log.discovery.count || 0)) {
    // keep the richer roster block (kept/cut/census/candidates…) and refresh
    // only the RUN-LEVEL fields this invocation actually observed
    merged.discovery = { ...prev.discovery };
    for (const k of RUN_LEVEL_DISCOVERY) if (log.discovery[k] !== undefined) merged.discovery[k] = log.discovery[k];
  }
  merged.runs = [...(Array.isArray(prev.runs) ? prev.runs : []), run];
  return merged;
}

// run only as the entry script — importing the module (fixture tests) runs nothing
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  main().catch(async (e) => {
    console.error(`[crawl] fatal: ${e.errorClass || 'Error'}: ${e.message}`);
    try { if (persistOnFatal) persistOnFatal(); } catch { /* best effort */ }
    const exit = exitCodeOf(e); // 3 challenge · 1 live lock · 2 otherwise
    try {
      const line = progress ? progress.summaryLine({ exit, details: '-', extra: { error: String(e.message || e).slice(0, 80) } }) : (await loadProgressHelper()).summaryLine({ driver: 'crawl', exit, details: '-', extra: { error: String(e.message || e).slice(0, 80) } });
      console.log(line);
    } catch { /* the exit code is the contract; the line is best effort */ }
    process.exit(exit);
  });
}
