#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the stitch-shot contract: the pure `overflow:` root line
// gate.sh's horizontal-overflow assert reads (viewport = innerWidth, delta = scrollWidth − clientWidth clamped at 0),
// --help before any import or I/O (exit 0 in an empty cwd, writes nothing, also where playwright is not importable);
// then, where playwright is importable, end-to-end against an in-process node:http origin: a page 1700 px wide and a
// fitting page at --width 1440 (the overflow line beside a written PNG); verdict parity with measure.mjs's root line
// (the overflow read gate.sh used before) on the wide and fitting pages, a right-sliding scroll reveal below the fold
// (a pre-scroll read would count it: false overflow), an off-canvas fixed drawer and an absolute one (real overflow),
// a header a scroll handler pins position:fixed below the top whose 400 px nav row overflows 360 (a read at the
// bottom would miss it), plus a keyframe reveal the freeze starts paused off to the side (delta 0 at rest); and the
// EDS single sweep — no timed poll
// (lateWindowFor → 0) but one dismissOverlays pass after waitEdsDelayedPhase still clicks a consent banner that
// appears 3 s after `load` (the EDS delayed phase), which an immediate sweep misses. Prints a skip line otherwise.
// --inventory (gate-all --one-load): named in --help; an unreadable spec still writes the PNG, exit 0, one warning.
// --hide (in-flow per-visitor regions): parseArgs takes comma lists, repeatable, de-duplicated; named in --help; a
// missing value is a usage error; e2e an 88 px in-flow .geo-bar above the content — hidden, the stitch is 88 px
// shorter and stdout says `hidden: .geo-bar ×1 (88px) [--hide]` (also under --no-dismiss); a selector matching nothing
// is ×0 and changes nothing; under --settle the --inventory already sees the hidden page.
// overlay-left + --json (the capture record gate.sh / gate-all read): fontFamilies strips quotes, de-duplicates and
// sorts; --help names both; --json without a value is a usage error. e2e a fixed full-viewport backdrop with no close
// control → one `overlay-left: div.backdrop (fixed, 100 % of the viewport)` line before the overflow line, exit 0, the
// record's overlayLeft (also under --no-dismiss, where dismissed is null); hidden with --hide → no line, null; a clean
// page's record exactly (key order — dialogLeft null after overlayLeft —, height = the PNG's); a declared face whose file
// answers 500 → fontsFailed ['Other Sans'] beside the WARNING, one whose every src 404s → fontsDead ['Brand Sans'] and the
// info line, not counted (deadFontFaces table: a dead duplicate beside a loading twin, the only face, mixed statuses, an
// unread sheet, an unrequested src); a font check that cannot run (fontCheckOutcome; e2e document.fonts throws) → fontsFailed null +
// fontCheck "failed: <msg>" and its own WARNING — skipped, never []; dismissed across the --settle sweeps (consent =
// last non-null, marketing = union); a consent-sweep click that leaves the page → overlayLeft `(consent sweep
// navigated to <url>)`; a failed capture (HTTP 404) writes no record.
// hide misses (the record's nAtCapture + hideMiss; stitch-shot prints no line for a miss — the caller knows the side):
// hideMissOutcome's shape (null / { sels, candidates } / candidates null + candidatesCheck); --help names the fields.
// e2e the delayed bar — an empty section.bar__wrapper above the header, filled 300 ms later: the right selector hides
// it in the PNG, nAtCapture 1, hideMiss null; a wrong one → ×0 at both counts, hideMiss with the wrapper as the
// candidate; a block injected after the hide pass (×0 at the pass) is counted at the capture — no hideMiss.
// The --timeout default: an explicit flag wins, else max(env STARDUST_NAV_TIMEOUT_MS, the crawl figure) clamped to
// 20000–180000 — the env a floor, both orders and the clamp — else 60000;
// a live-session.mjs older than navTimeout keeps 60000 and says so once (sessionNavTimeout, a stub session).
// The header morph: isHeaderMorph (pure) and, end to end, an in-flow header that shrinks 20 px after the first scroll
// — at 1810 px with the browser clamping (the old guard threw a scroll stall; also under --settle), at 2710 px with its
// scroll anchoring (the shortfall equals the shrink; the old guard stalled at the last chunk) and at 1800 px (the old
// guard let it through with 20 unwritten rows at the bottom): exit 0, the shrunk PNG height, headerMorph 20 in
// <stem>.capture.json, the morph named on the stitched line. An inner scroller still exits 1 with the scroll stall
// signature and leaves no sidecar; a normal page records headerMorph 0 and its stdout is unchanged.
// Dialogs, denial pages, the browser (S22): --hints takes ua-metadata | native (anything else: the exit-1 usage error,
// before any I/O); mergeDismissed (pure) folds the sweeps into capture.json's `dismissed`; stale live-session copies
// (stub modules) — no launchChromium → chromium.launch(), no hintRecord → 'unknown', no pageDenial → the re-check is
// one "skipped" line; recheckDenial on stub pages through the real pageDenial / botChallengeError, and the denialCheck
// it returns ('ok' | 'skipped: <reason>'). End to end: the
// recorded dialog stall re-checked on a fixture — a 3914 px page whose script showModal()s a dialog and locks html and
// body at height:100% (--no-dismiss: the scroll stall; default: exit 0, full height, the dialog closed and the lock
// released), a non-native modal closed by its control (lock released), an unclosable aria-modal over the lock (still
// the stall, no sidecar — R1); every vendor denial signature, the one-error-heading page, the recorded "can't process"
// page and the same page rendered 800 ms after load (the post-sweep re-check) → exit 3, "origin blocked", --headed, no
// PNG and no sidecar; the late page with --hide over its text and --json → still exit 3 (the re-check reads the page
// before the --hide pass), no --json record; a 3000 px article that mentions "press & hold the button" → exit 0 (R3);
// capture.json's
// browserBuild ('chromium' here) and hints ('ua-metadata'; 'native' under --hints native), denialCheck 'ok', dismissed
// null under --no-dismiss.
// Capture settings: --pin / --allow-dialog / --slug / --presence parsing, withPresence (the flags, then presence.json's),
// dialogOutcome (pure); e2e a consent dialog no sweep closes → `dialog-left:` + dialogLeft, still with its container
// hidden by --hide alone, none with the container hidden AND --allow-dialog (dialogsAllowed); --slug reads the site
// presence.json (hide, allow, pin state); --pin clicks a rotator control on the frozen page (the hero pinned), a
// selector matching nothing is named.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureHintRecord, deadFontFaces, dialogOutcome, fontCheckOutcome, fontFamilies, hideMissOutcome, isHeaderMorph, launchCaptureBrowser, mergeDismissed, overflowLine, parseArgs, recheckDenial, sessionNavTimeout, withPresence } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
// live-session.mjs in either layout (plugin tree / project copy) — imports nothing, so the pure part can use it
const LIB = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolve(HERE, '..', p)).find((p) => existsSync(p));
const session = await import(pathToFileURL(LIB).href);
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const LINE_RE = /^overflow: scrollWidth=[0-9]+ viewport=[0-9]+ delta=[0-9]+$/;

await check('overflowLine: scrollWidth, viewport = innerWidth, delta = scrollWidth − clientWidth — the shape gate.sh parses', () => {
  assert.equal(overflowLine({ scrollWidth: 1700, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1700 viewport=1440 delta=260');
  assert.match(overflowLine({ scrollWidth: 1700, innerWidth: 1440, clientWidth: 1440 }), LINE_RE);
  assert.equal(overflowLine({ scrollWidth: 1440, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1440 viewport=1440 delta=0');
});
await check('overflowLine: delta clamps at 0; a scrollbar gutter (clientWidth < innerWidth) is measured against clientWidth, as measure.mjs does', () => {
  assert.equal(overflowLine({ scrollWidth: 1425, innerWidth: 1440, clientWidth: 1425 }), 'overflow: scrollWidth=1425 viewport=1440 delta=0');
  assert.equal(overflowLine({ scrollWidth: 1400, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1400 viewport=1440 delta=0');
  assert.equal(overflowLine({ scrollWidth: 1440, innerWidth: 1440, clientWidth: 1425 }), 'overflow: scrollWidth=1440 viewport=1440 delta=15');
});
await check('--timeout default: max(env STARDUST_NAV_TIMEOUT_MS, 2 × the crawl\'s navMs p95) clamped to 20000–180000, else 60000 — the env a floor in both orders; an explicit --timeout always wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-nav-'));
  try {
    const crawlLog = join(dir, '_crawl-log.json');
    writeFileSync(crawlLog, JSON.stringify({ crawl: { failures: [], navMs: { n: 12, p50: 9000, p95: 42000, max: 47000 } } }));
    const timeout = (extra, nav) => parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png', ...extra], nav).opts.timeout;
    assert.equal(timeout([], { env: {}, crawlLog: null }), 60000, 'neither env nor crawl figure: the current default');
    assert.equal(timeout([], { env: {}, crawlLog: join(dir, 'missing.json') }), 60000, 'a missing crawl log is skipped');
    assert.equal(timeout([], { env: {}, crawlLog }), 84000, 'the crawl figure: p95 42000 × 2');
    assert.equal(timeout([], { env: { STARDUST_NAV_TIMEOUT_MS: '90000' }, crawlLog }), 90000, 'env above 2 × the crawl figure → the env');
    assert.equal(timeout([], { env: { STARDUST_NAV_TIMEOUT_MS: '30000' }, crawlLog }), 84000, 'env below 2 × the crawl figure → the crawl figure (the env is a floor)');
    assert.deepEqual([timeout([], { env: { STARDUST_NAV_TIMEOUT_MS: '1500' }, crawlLog: null }), timeout([], { env: { STARDUST_NAV_TIMEOUT_MS: '250000' }, crawlLog })], [20000, 180000], 'the env is clamped to 20000–180000 too');
    assert.equal(timeout(['--timeout', '5000'], { env: { STARDUST_NAV_TIMEOUT_MS: '90000' }, crawlLog }), 5000, 'the flag beats both');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', timeout: 15000 }).stdout.replace(/\s+/g, ' ');
  assert.ok(help.includes('default: max(env STARDUST_NAV_TIMEOUT_MS, 2 × crawl.navMs.p95 from stardust/current/_crawl-log.json) clamped to 20000–180000, else 60000; the flag always wins'), 'the --help sentence');
});
await check('sessionNavTimeout: a current live-session answers through its navTimeout (fallback 60000, the test seam passed on); one without navTimeout (an older project copy) — no throw, the old default 60000, ONE stderr line per process', () => {
  const asked = [];
  const current = sessionNavTimeout({ navTimeout: (opts) => { asked.push(opts); return { ms: 84000, source: 'crawl', detail: 'p95 × 2' }; } }, { env: {}, crawlLog: null });
  assert.deepEqual([current, asked], [{ ms: 84000, source: 'crawl', detail: 'p95 × 2' }, [{ env: {}, crawlLog: null, fallback: 60000 }]]);
  const lines = []; const { error } = console;
  console.error = (...a) => { lines.push(a.join(' ')); };
  let stale;
  try { stale = [sessionNavTimeout({ gotoLive() {} }), sessionNavTimeout({})]; } finally { console.error = error; }
  const detail = 'live-session.mjs predates navTimeout — 60000 ms (copy the diff skill\'s live-session.mjs alongside)';
  assert.deepEqual(stale, [{ ms: 60000, source: 'default', detail }, { ms: 60000, source: 'default', detail }]);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^stitch-shot: live-session\.mjs predates navTimeout — goto timeout 60000 ms; STARDUST_NAV_TIMEOUT_MS and the crawl figure are not read/);
});
await check('isHeaderMorph: a shortfall the document\'s shrink explains — equal to the shrink, or the target clamped to the shrunk height; a no-op scroll, a grown page or an unexplained shrink is not', () => {
  const vh = 900;
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 880, totalH: 2710, h2: 2690, vh }), true, 'mid-page: scroll anchoring moved scrollY up by the 20 px loss');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 890, totalH: 1810, h2: 1790, vh }), true, 'shortfall 10 ≠ shrink 20, but 890 is 900 clamped to the shrunk height');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 0, totalH: 3000, h2: 3000, vh }), false, 'height unchanged: a no-op scroll');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 0, totalH: 3000, h2: 2980, vh }), false, 'a 20 px shrink does not explain a 900 px shortfall');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 880, totalH: 2710, h2: 2730, vh }), false, 'a grown document');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 897, totalH: 1810, h2: 1807, vh }), false, 'within the 4 px slack: scroll rounding');
});
await check('--hints: ua-metadata and native are taken, no flag passes null through (live-session then reads env STARDUST_LIVE_HINTS)', () => {
  const hints = (extra) => parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png', ...extra], { env: {}, crawlLog: null }).opts.hints;
  assert.deepEqual([hints([]), hints(['--hints', 'ua-metadata']), hints(['--hints', 'native'])], [null, 'ua-metadata', 'native']);
});
await check('--hints bogus: exit 1 with the usage error before any I/O — nothing written, no browser', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-hints-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'https://x.test/', 'o.png', '--hints', 'bogus'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^hints must be one of ua-metadata, native — got bogus$/m);
    assert.match(r.stderr, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('mergeDismissed: arrays concatenated and de-duplicated in order, the first consent, released when any sweep released, dialogsLeft from the LAST sweep; a sweep from an older live-session (no dialog fields) adds nothing', () => {
  const first = { extra: ['#promo-x'], consent: null, marketing: ['[data-dismiss]'], dialogs: ['dialog#a (close())'], dialogsLeft: ['div#b'], scrollLockReleased: true };
  const second = { extra: ['#promo-x'], consent: '#onetrust-accept-btn-handler', marketing: [], dialogs: ['dialog#a (close())', 'div#b (Escape)'], dialogsLeft: [], scrollLockReleased: false };
  assert.deepEqual(mergeDismissed([first, second]), { extra: ['#promo-x'], consent: '#onetrust-accept-btn-handler', marketing: ['[data-dismiss]'], dialogs: ['dialog#a (close())', 'div#b (Escape)'], dialogsLeft: [], scrollLockReleased: true });
  assert.deepEqual(mergeDismissed([second, first]).dialogsLeft, ['div#b'], 'the last sweep\'s survivors');
  assert.deepEqual(mergeDismissed([{ extra: [], consent: null, marketing: [] }]), { extra: [], consent: null, marketing: [], dialogs: [], dialogsLeft: [], scrollLockReleased: false });
});
// stderr lines console.error printed while fn ran
const stderrOf = async (fn) => {
  const lines = []; const { error } = console;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = error; }
  return lines;
};
await check('a stale live-session copy never throws: no launchChromium → chromium.launch() (untagged: build unknown), no hintRecord → both unknown, no pageDenial / botChallengeError → the re-check skipped with ONE stderr line naming the stale copy (denialCheck "skipped: live-session.mjs predates pageDenial")', async () => {
  const launched = [];
  const chromium = { launch: async (...a) => { launched.push(a); return {}; } };
  const old = { launchStealthHeaded: async () => ({ headed: true }) };
  assert.deepEqual(await launchCaptureBrowser(old, chromium, { headed: false }), {});
  assert.deepEqual(launched, [[]], 'chromium.launch() with no options');
  assert.deepEqual(await launchCaptureBrowser(old, chromium, { headed: true }), { headed: true }, '--headed keeps launchStealthHeaded');
  assert.deepEqual(captureHintRecord({}, { stardustBuild: 'chromium' }), { browserBuild: 'unknown', hints: 'unknown' });
  for (const stale of [{}, { pageDenial: session.pageDenial }, { botChallengeError: session.botChallengeError }]) {
    let result;
    const lines = await stderrOf(async () => { result = await recheckDenial(stale, { evaluate: async () => { throw new Error('never read'); } }, 'https://x.test/', 200); });
    assert.deepEqual(lines, ['stitch-shot: denial-page check skipped (live-session.mjs predates pageDenial — copy the diff skill\'s live-session.mjs alongside)'], Object.keys(stale).join() || 'neither');
    assert.equal(result, 'skipped: live-session.mjs predates pageDenial', 'capture.json\'s denialCheck');
  }
});
await check('a current live-session: launchChromium (not chromium.launch), hintRecord read from the context', async () => {
  const calls = [];
  const current = { launchChromium: async (c) => { calls.push(c); return { stardustBuild: 'chromium' }; }, launchStealthHeaded: async () => null, hintRecord: session.hintRecord };
  const chromium = { launch: async () => { throw new Error('chromium.launch must not run'); } };
  assert.deepEqual(await launchCaptureBrowser(current, chromium, {}), { stardustBuild: 'chromium' });
  assert.deepEqual(calls, [chromium]);
  assert.deepEqual(captureHintRecord(current, { stardustBuild: 'chromium', stardustHints: 'ua-metadata' }), { browserBuild: 'chromium', hints: 'ua-metadata' });
});
await check('recheckDenial (stub pages, the real pageDenial): a denial page → BotChallengeError naming HTTP <status>, the signature, "origin blocked", --headed; a page the probe cannot read → ONE "skipped" line, no throw, denialCheck "skipped: <reason>"; an ordinary page → no line, denialCheck "ok"', async () => {
  const pageOf = (probe) => ({ evaluate: async () => probe, waitForTimeout: async () => {} });
  const denied = { title: 'Notice', text: 'System Down Please try again later.', bytes: 35, headings: [], frames: [] };
  const err = await recheckDenial(session, pageOf(denied), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(err?.name, 'BotChallengeError');
  assert.equal(err.marker, 'HTTP 200 denial page — "System Down"');
  assert.match(err.message, /origin blocked/); assert.match(err.message, /--headed/);
  const unreadable = { evaluate: async () => { throw new Error('Execution context was destroyed, most likely because of a navigation\n  at …'); }, waitForTimeout: async () => {} };
  let result;
  assert.deepEqual(await stderrOf(async () => { result = await recheckDenial(session, unreadable, 'https://x.test/', 200); }), ['stitch-shot: denial-page check skipped (Execution context was destroyed, most likely because of a navigation)']);
  assert.equal(result, 'skipped: Execution context was destroyed, most likely because of a navigation', 'capture.json\'s denialCheck');
  const ordinary = { title: 'Spring range', text: 'Ordinary page copy. '.repeat(200), bytes: 4000, headings: ['Spring range'], frames: [] };
  assert.deepEqual(await stderrOf(async () => { result = await recheckDenial(session, pageOf(ordinary), 'https://x.test/', 200); }), []);
  assert.equal(result, 'ok', 'read, no marker');
});
await check('--help names --hints and STARDUST_LIVE_HINTS, the dialog pass and its scroll-lock release, the 2xx denial page (exit 3, --headed), the browser build and the new capture.json keys', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--hints <v> +client hints: ua-metadata [^]*?\| native/);
  assert.match(r.stdout, /STARDUST_LIVE_HINTS/);
  assert.match(r.stdout, /dialog closed: …/); assert.match(r.stdout, /scroll lock is released\s\(overflow-y visible, a hidden overflow-x clipped\) only when/);
  assert.match(r.stdout, /3 bot challenge[^]*2xx denial[^]*page[^]*Escalate with --headed/);
  assert.match(r.stdout, /full Chromium build when installed, else the\nheadless shell/);
  assert.match(r.stdout, /browserBuild, hints, denialCheck, dismissed, at } — denialCheck = 'ok' \| 'skipped: <reason>'/);
});
await check('--help in an empty cwd: exit 0, usage + the overflow line and the EDS rule named, nothing written — no playwright needed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 15000);
    assert.match(r.stdout, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.match(r.stdout, /overflow: scrollWidth=<n> viewport=<n> delta=<n>/);
    assert.match(r.stdout, /EDS build\/preview hosts/);
    assert.match(r.stdout, /--timeout <ms> .*STARDUST_NAV_TIMEOUT_MS/, 'the env is named on the --timeout line');
    assert.match(r.stdout, /crawl\.navMs\.p95 from stardust\/current\/_crawl-log\.json/, 'the crawl figure is named');
    assert.match(r.stdout, /<stem>\.capture\.json/, 'the sidecar is named');
    assert.match(r.stdout, /headerMorph/);
    assert.match(r.stdout, /scroll stall/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('parseArgs --hide: comma lists, repeatable, trimmed, empties dropped, de-duplicated in order; absent → []', () => {
  const argv = (...a) => ['node', 'stitch-shot.mjs', 'http://127.0.0.1/', 'out.png', ...a];
  assert.deepEqual(parseArgs(argv('--hide', ' .geo-bar , #promo,', '--hide', '#promo,.location-bar', '--hide', '')).opts.hide, ['.geo-bar', '#promo', '.location-bar']);
  const plain = parseArgs(argv('--width', '360', '--dismiss', '.x'));
  assert.deepEqual(plain.opts.hide, []);
  assert.deepEqual([plain.url, plain.out, plain.opts.width, plain.opts.dismiss], ['http://127.0.0.1/', 'out.png', 360, ['.x']]);
});
await check('--hide: --help names it; a missing value (end of argv or a flag next) is a usage error, exit 1, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-hide-'));
  try {
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /--hide <sel,…> +remove in-flow per-visitor regions/);
    assert.match(h.stdout, /hidden: <sel> ×<n> \(<h>px\) \[--hide\]/);
    for (const tail of [['--hide'], ['--hide', '--settle']]) {
      const r = spawnSync(process.execPath, [SCRIPT, 'http://127.0.0.1:9/', 'x.png', ...tail], { cwd, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 1, `${tail.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /^--hide needs a selector list/);
    }
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('capture settings: --pin / --allow-dialog take comma lists (repeatable, de-duplicated), --slug / --presence a value; none → [] / null', () => {
  const o = parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png', '--pin', ' .dot-2 , .tab-1', '--pin', '.dot-2', '--allow-dialog', '#cmp-root', '--slug', 'home', '--presence', 'g/presence.json'], { env: {}, crawlLog: null }).opts;
  assert.deepEqual([o.pin, o.allowDialog, o.slug, o.presence], [['.dot-2', '.tab-1'], ['#cmp-root'], 'home', 'g/presence.json']);
  const d = parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png'], { env: {}, crawlLog: null }).opts;
  assert.deepEqual([d.pin, d.allowDialog, d.slug, d.presence], [[], [], null, null]);
});

await check('withPresence: the presence settings after the flags — hide / dismiss / allowDialog de-duplicated in order, a pin keeps the flag\'s position and takes the file\'s state (a flag alone: state null)', () => {
  const opts = { hide: ['.geo'], dismiss: ['.x'], pin: ['.dot-2', '.tab'], allowDialog: [] };
  const got = withPresence(opts, { hide: ['.geo', '#cmp-root'], dismiss: ['.y'], pin: [{ sel: '.dot-2', state: 'slide 2' }, { sel: '.z', state: 'first' }], allowDialog: ['#cmp-root'] });
  assert.deepEqual(got, { hide: ['.geo', '#cmp-root'], dismiss: ['.x', '.y'], pins: [{ sel: '.dot-2', state: 'slide 2' }, { sel: '.tab', state: null }, { sel: '.z', state: 'first' }], allowDialog: ['#cmp-root'] });
  assert.deepEqual(withPresence(opts, null).pins, [{ sel: '.dot-2', state: null }, { sel: '.tab', state: null }]);
});

await check('dialogOutcome: a dialog left open is dialogLeft — hidden or not — unless its hiding container is an allowed per-visitor dialog (then dialogsAllowed); none left → null', () => {
  const hiders = new Map([['div#cmp-dialog', '#cmp-root'], ['dialog.region', null]]);
  assert.deepEqual(dialogOutcome([], hiders, ['#cmp-root']), { dialogLeft: null, allowed: [] });
  assert.deepEqual(dialogOutcome(['dialog.region'], hiders, ['#cmp-root']), { dialogLeft: ['dialog.region'], allowed: [] }, 'not hidden');
  assert.deepEqual(dialogOutcome(['div#cmp-dialog'], hiders, []), { dialogLeft: ['div#cmp-dialog'], allowed: [] }, 'a hide alone no longer silences it');
  assert.deepEqual(dialogOutcome(['div#cmp-dialog', 'dialog.region'], hiders, ['#cmp-root']), { dialogLeft: ['dialog.region'], allowed: [{ name: 'div#cmp-dialog', hiddenBy: '#cmp-root' }] });
  assert.deepEqual(dialogOutcome(['div#gone'], new Map(), ['#cmp-root']), { dialogLeft: ['div#gone'], allowed: [] }, 'not found at the check: still left');
});

await check('deadFontFaces: a family with a face that loaded, whose every failed face is an @font-face whose every requested src returned 404, is dead (not counted); any other failure counts', () => {
  const B = 'https://o.test/fonts/'; const st = { [`${B}a.woff2`]: 404, [`${B}a.woff`]: 404, [`${B}ok.woff2`]: 200, [`${B}c.woff2`]: 500, [`${B}d.woff2`]: 404, [`${B}d.woff`]: 200 };
  const rules = [
    { family: '"Brand Sans"', srcs: [`${B}ok.woff2`] }, { family: '"Brand Sans"', srcs: [`${B}a.woff2`, `${B}a.woff`, `${B}a.eot`] }, // a loading twin + a dead duplicate (the .eot never requested)
    { family: 'Solo', srcs: [`${B}a.woff2`] }, // the only face, 404: the site's real visitors get the same fallback
    { family: 'Five', srcs: [`${B}c.woff2`] }, { family: 'Mixed', srcs: [`${B}d.woff2`, `${B}d.woff`] }, { family: 'Never', srcs: [`${B}n.woff2`] },
  ];
  const loaded = ['"Brand Sans"', 'Solo Bold'];
  assert.deepEqual(deadFontFaces({ errored: ['Brand Sans', '"Solo"', 'Five', 'Mixed', 'Hidden Sheet', 'Never'], loaded, rules, statuses: st }), { failed: ['Five', 'Hidden Sheet', 'Mixed', 'Never', 'Solo'], dead: ['Brand Sans'] }, 'a family whose only face 404s renders fallback type: it counts');
  assert.deepEqual(deadFontFaces({ errored: ['Brand Sans', 'Brand Sans'], loaded, rules, statuses: st }), { failed: ['Brand Sans'], dead: [] }, 'two failed faces, one dead declaration: one failure is unexplained');
  assert.deepEqual(deadFontFaces({ errored: ['Brand Sans'], loaded: [], rules, statuses: st }), { failed: ['Brand Sans'], dead: [] }, 'no face of the family loaded: a fallback, counted');
  assert.deepEqual(deadFontFaces({ errored: [], loaded, rules, statuses: st }), { failed: [], dead: [] });
});

await check('fontFamilies: surrounding quotes stripped, trimmed, empties dropped, unique, sorted — the record\'s fontsFailed', () => {
  assert.deepEqual(fontFamilies(['"A B"', "'C'", 'A B', '']), ['A B', 'C']);
  assert.deepEqual(fontFamilies([' "Z" ', 'Brand Sans', '"Brand Sans"']), ['Brand Sans', 'Z']);
  assert.deepEqual(fontFamilies([]), []);
});
await check('fontCheckOutcome: a family list → { fontsFailed } (checked); an evaluate error → { fontsFailed: null, fontCheck: "failed: <first line>" } — never []', () => {
  const ok = fontCheckOutcome(['"Brand Sans"', 'Brand Sans'], null);
  assert.deepEqual(ok, { fontsFailed: ['Brand Sans'] });
  assert.ok(!('fontCheck' in ok), 'fontCheck only when the check failed');
  assert.deepEqual(fontCheckOutcome([], null), { fontsFailed: [] });
  const bad = fontCheckOutcome(null, new Error('page.evaluate: Execution context was destroyed\n    at main'));
  assert.deepEqual(bad, { fontsFailed: null, fontCheck: 'failed: page.evaluate: Execution context was destroyed' });
  assert.deepEqual(Object.keys(bad), ['fontsFailed', 'fontCheck'], 'fontCheck right after fontsFailed');
  assert.deepEqual(fontCheckOutcome(undefined, 'timeout'), { fontsFailed: null, fontCheck: 'failed: timeout' });
  assert.deepEqual(fontCheckOutcome({ not: 'a list' }, null), { fontsFailed: null, fontCheck: 'failed: no family list returned' });
});
await check('hideMissOutcome: no missed selector → null; a miss + the candidate list → { sels, candidates }; a derivation that threw or returned no list → candidates null + candidatesCheck — never []', () => {
  const wrapper = { tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, height: 72, selector: 'section.bar__wrapper' };
  assert.equal(hideMissOutcome([], [wrapper], null), null);
  assert.equal(hideMissOutcome(undefined, null, new Error('x')), null, 'no miss → null, whatever the derivation did');
  assert.deepEqual(hideMissOutcome(['.location-bar'], [wrapper], null), { sels: ['.location-bar'], candidates: [wrapper] });
  assert.deepEqual(hideMissOutcome(['.a', '.b'], [], null), { sels: ['.a', '.b'], candidates: [] }, 'none found is a list, not a failure');
  const bad = hideMissOutcome(['.location-bar'], null, new Error('page.evaluate: Execution context was destroyed\n    at main'));
  assert.deepEqual(bad, { sels: ['.location-bar'], candidates: null, candidatesCheck: 'failed: page.evaluate: Execution context was destroyed' });
  assert.deepEqual(hideMissOutcome(['.x'], { not: 'a list' }, null), { sels: ['.x'], candidates: null, candidatesCheck: 'failed: no candidate list returned' });
});
await check('--json: --help names it, the overlay-left line, nAtCapture and hideMiss; a missing value (end of argv or a flag next) is a usage error, exit 1, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-json-'));
  try {
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /--json <file> +after the PNG, write the capture record/);
    assert.match(h.stdout, /overlay-left: <sel>/);
    assert.match(h.stdout, /fontsFailed \(\[\] or the families .*; null = the check could not run/);
    assert.match(h.stdout, /nAtCapture = the match count right before the capture/);
    assert.match(h.stdout, /hideMiss \(\{ sels, candidates \}[^)]*\n[^)]*null when none\)/);
    assert.match(h.stdout, /×0 = nothing matched at the hide pass/);
    assert.match(h.stdout, /stitch-shot prints no line for a miss/);
    for (const tail of [['--json'], ['--json', '--settle']]) {
      const r = spawnSync(process.execPath, [SCRIPT, 'http://127.0.0.1:9/', 'x.png', ...tail], { cwd, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 1, `${tail.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /^--json needs a file path/);
    }
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
let chromium = null;
let PNG = null;
try { ({ chromium } = await import('playwright')); ({ PNG } = await import('pngjs')); } catch { chromium = null; console.log('skip  end-to-end stitch-shot (playwright / pngjs not importable here; run this test in an environment that has them)'); }
if (chromium) {
  const page = (body, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}section{height:700px;background:#ddd}</style>${extraHead}</head><body>${body}</body></html>`;
  // A consent banner injected 3 s after `load` — the timing of a consent manager loaded from the EDS delayed phase.
  const lateConsent = `<script>addEventListener('load', () => setTimeout(() => {
    const d = document.createElement('div'); d.id = 'banner'; d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#123';
    const b = document.createElement('button'); b.id = 'onetrust-accept-btn-handler'; b.textContent = 'OK'; b.onclick = () => d.remove();
    d.appendChild(b); document.body.appendChild(d);
  }, 3000));</script>`;
  const pages = {
    '/wide': page('<section></section><div style="width:1700px;height:40px;background:#c33"></div><section></section>'),
    '/fit': page('<section></section><div style="width:100%;height:40px;background:#3c3"></div><section></section>'),
    '/consent-late': page('<section></section><section></section>', lateConsent),
  };
  // Overflow parity fixtures: a full-width block below the fold that slides in from the right when it scrolls into
  // view (transition / keyframe), an off-canvas drawer (fixed: no root overflow; absolute: 400 px of it), and a header
  // whose scroll handler pins it position:fixed once scrolled — its 400 px nav row overflows a 360 viewport at the top
  // only (fixed boxes add no root overflow), where measure.mjs reads.
  const S3 = '<section></section><section></section><section></section>';
  const reveal = (sel) => `<script>const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }));
    document.querySelectorAll('${sel}').forEach((el) => io.observe(el));</script>`;
  Object.assign(pages, {
    '/reveal': page(`${S3}<div class="rv">reveal</div>${reveal('.rv')}`, '<style>.rv{height:200px;background:#36c;transform:translateX(200px);transition:transform .3s}.rv.in{transform:none}</style>'),
    '/reveal-anim': page(`${S3}<div class="ra">reveal</div>${reveal('.ra')}`, '<style>.ra{height:200px;background:#c63}.ra.in{animation:slide 1s both}@keyframes slide{from{transform:translateX(300px)}to{transform:none}}</style>'),
    '/drawer': page(`${S3}<div style="position:fixed;top:0;right:-400px;width:400px;height:100%;background:#333"></div>`),
    '/drawer-abs': page(`${S3}<div style="position:absolute;top:0;right:-400px;width:400px;height:300px;background:#333"></div>`),
    '/fixed-header': page(`<header id="hd"><nav style="width:400px;height:60px;background:#c33">nav</nav></header>${S3}<script>addEventListener('scroll', () => document.getElementById('hd').classList.toggle('pin', window.scrollY > 80));</script>`,
      '<style>#hd{height:60px;background:#222}#hd.pin{position:fixed;top:0;left:0;right:0}</style>'),
    // --hide: an 88 px per-visitor bar (a location suggestion) in flow above the header — not an overlay.
    '/geo': page('<div class="geo-bar" style="height:88px;background:#f90"><a href="/loc">Switch location</a></div><header style="height:60px;background:#222"></header><main><h1 style="margin:0;height:60px">Heading</h1><section></section><section></section></main>'),
  });
  // hide misses — the delayed bar: an empty section.bar__wrapper in flow above the header, filled 300 ms later with a
  // 72 px #f90 bar (a geo lookup's location suggestion; the hide pass runs ≥ 1.2 s in). /bar-late fills it only once the
  // hide rule lands — a block injected after the hide pass (hidden by the persistent rule, counted at the capture).
  const BAR = '<div class="bar__content" style="height:72px;background:#f90">Visiting from elsewhere? Switch location</div>';
  const barPage = (fill) => page(`<section class="bar__wrapper"></section><header style="height:60px;background:#222"></header><main><section></section><section></section></main><script>${fill}</script>`, '<style>section.bar__wrapper{height:auto;background:none}</style>');
  Object.assign(pages, {
    '/bar': barPage(`setTimeout(() => { document.querySelector('.bar__wrapper').innerHTML = '${BAR}'; }, 300);`),
    '/bar-late': barPage(`new MutationObserver((ms, mo) => { if (document.querySelector('style[data-stardust-hide]')) { mo.disconnect(); document.querySelector('.bar__wrapper').innerHTML = '${BAR}'; } }).observe(document.head, { childList: true });`),
  });
  // overlay-left + --json: a fixed full-viewport backdrop with no close control (no sweep removes it) over page content
  // (a line of text at the viewport centre); a declared face whose file 404s; a consent banner shown at load beside a
  // newsletter popup opening 6.5 s after load — during --settle's pass, so the settle sweep closes it after the first
  // sweep took the banner.
  const popupLate = `<script>addEventListener('load', () => setTimeout(() => {
    const p = document.createElement('div'); p.id = 'newsletter-popup'; p.style.cssText = 'position:fixed;top:100px;left:100px;width:400px;height:300px;background:#fff';
    const x = document.createElement('button'); x.setAttribute('aria-label', 'Close'); x.textContent = '×'; x.onclick = () => p.remove();
    p.appendChild(x); document.body.appendChild(p);
  }, 6500));</script>`;
  Object.assign(pages, {
    '/backdrop': page('<section><p style="margin:0;padding-top:430px;font:40px/40px sans-serif;text-align:center">Page content beneath the backdrop</p></section><section></section><div class="backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>'),
    // a face whose only src 404s (a dead declaration: not counted) and one whose src answers 500 (counted)
    '/font-fail': page('<section style="font-family:\'Brand Sans\',sans-serif">Brand type <b>bold</b></section><section style="font-family:\'Other Sans\',sans-serif">Other type</section><section style="font-family:\'Solo Sans\',sans-serif">Solo type</section>', '<style>@font-face{font-family:"Brand Sans";font-weight:400;src:url(/brand.ttf) format("truetype")}@font-face{font-family:"Brand Sans";font-weight:700;src:url(/missing.woff2) format("woff2")}@font-face{font-family:"Other Sans";src:url(/broken.woff2) format("woff2")}@font-face{font-family:"Solo Sans";src:url(/gone.woff2) format("woff2")}</style>'),
    // a page whose document.fonts throws: the font-load check cannot run
    '/fonts-unreadable': page('<section>Text</section><section></section>', '<script>Object.defineProperty(document, \'fonts\', { configurable: true, get() { throw new Error(\'fonts unavailable\'); } });</script>'),
    '/consent-popup': page('<div id="banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#123"><button id="onetrust-accept-btn-handler" onclick="this.parentNode.remove()">OK</button></div><section></section><section></section>', popupLate),
    // a consent banner whose "Accept" is a link to another path: the label sweep's click leaves the page
    '/consent-link': page('<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#123"><a href="/fit">Accept</a></div><section></section><section></section>'),
  });
  // Header morph fixtures: an in-flow header 100 px tall at the top that shrinks to 80 px once the window scrolls and
  // grows back at the top (a shrink-on-scroll header), over a body that makes the document `total` px tall at rest.
  // `anchor: false` turns the browser's scroll anchoring off, so a scroll past the shrunk bottom is clamped instead.
  const morph = (total, anchor = true) => page(`<header id="hd"></header><main style="height:${total - 100}px"></main><script>addEventListener('scroll', () => document.getElementById('hd').classList.toggle('small', window.scrollY > 0));</script>`,
    `<style>#hd{height:100px;background:#222}#hd.small{height:80px}main{background:linear-gradient(#ddd,#36c)}${anchor ? '' : 'body{overflow-anchor:none}'}</style>`);
  Object.assign(pages, {
    '/morph-1810': morph(1810, false), '/morph-2710': morph(2710), '/morph-1800': morph(1800),
    // Inner scroller: html/body overflow:hidden at 100% height — the body reports 3000 px, window.scrollTo moves nothing.
    '/jacked': page('<section style="height:3000px;background:linear-gradient(#ddd,#36c)"></section>', '<style>html,body{height:100%;overflow:hidden}</style>'),
  });
  // S22 dialog fixtures: 3914 px of page under html/body height:100%. A lock on BOTH html and body then makes the
  // window scroll a no-op (the recorded "window.scrollY stuck at 0" stall); a plain body{overflow:hidden} alone does
  // not — Chromium still scrolls the window under it. The opener locks with the recorded `overflow: hidden` shorthand
  // (both axes): the release sets overflow-y visible and clips the hidden overflow-x — a kept overflow-x: hidden would
  // make the visible overflow-y compute to auto and turn body into an inner scroller (the stall again).
  const LOCK = "for (const el of [document.documentElement, document.body]) el.style.overflow = 'hidden';";
  const tall = (body, head = '') => page(`<main style="height:3914px;background:linear-gradient(#ddd,#36c)"></main>${body}`, `<style>html,body{height:100%}</style>${head}`);
  Object.assign(pages, {
    // (a) the recorded shape: a native modal dialog whose opener locked scrolling
    '/dialog-lock': tall(`<dialog class="x-modal js-modal"><p>Choose your delivery region.</p></dialog>
      <script>document.querySelector('.js-modal').showModal(); ${LOCK}</script>`),
    // (b) a non-native modal its close control hides; the html lock class stays. The control is a `.modal__close`
    // span: a `[data-dismiss]` or `button.close` inside a `.modal` is the marketing pass's (MODAL_CLOSE_CANDIDATES),
    // which runs first — that modal would land in `marketing`, and R1 releases only after the dialog pass's own close.
    '/modal-lock': tall(`<div class="modal show" role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.5)">
      <p>Choose your region.</p><span class="modal__close" role="button" tabindex="0" onclick="this.closest('.modal').style.display = 'none'">×</span></div>
      <script>document.documentElement.classList.add('is-locked');</script>`, '<style>html.is-locked{overflow:hidden}</style>'),
    // (c) a fixed aria-modal no control and no Escape closes, over the lock
    '/modal-stuck-lock': tall(`<div id="blocker" role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.6)"><p>Please wait.</p></div>
      <script>${LOCK}</script>`),
    // R3: a long article that only mentions the phrase is no denial page
    '/article-press-hold': page(`<article style="min-height:3000px"><h1>Pairing the remote</h1><p>To pair it, press &amp; hold the button for three seconds.</p>${'<p>Ordinary article copy: the remote pairs once, keeps its pairing through battery changes and works across the room.</p>'.repeat(30)}</article>`),
  });
  // Denial pages (each answers 200): the recorded shape — ~900 px of "can't process your request" + "Incident Number" —
  // static (gotoLive's entry read) and rendered by a script 800 ms after DOMContentLoaded (after the entry read, before
  // the post-sweep re-check); each vendor signature on a small page; a small page under one error heading.
  const denial = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0">${body}</body></html>`;
  const RECORDED = '<div style="min-height:900px;padding:40px"><p>We\'re sorry, we can\'t process your request right now. Please try again later.</p><p>Incident Number: 18.4f2a7c31.1760000000.1b2c3d4</p></div>';
  const DENIALS = {
    'recorded': ['cant-process', denial('Notice', RECORDED)],
    'recorded-late': ['cant-process', denial('Notice', `<p>Loading the page.</p><script>document.addEventListener('DOMContentLoaded', () => setTimeout(() => { document.body.innerHTML = ${JSON.stringify(RECORDED)}; }, 800));</script>`)],
    'cant-process': ['cant-process', denial('Notice', '<p>We can\'t process your request.</p><p>Incident Number: 18.4f2a</p>')],
    'access-denied': ['access-denied', denial('Access Denied', '<h1>Access Denied</h1><p>You don\'t have permission to access this server.</p><p>Reference #18.4f2a7c31</p>')],
    'just-a-moment': ['just-a-moment', denial('Just a moment…', '<p>Checking your browser before accessing the site.</p>')],
    'press-and-hold': ['press-and-hold', denial('Verification', '<p>Press &amp; Hold to confirm you are a human (and not a bot).</p>')],
    'incapsula': ['incapsula', denial('Notice', '<p>Incapsula incident ID: 0-1234567</p>')],
    'datadome': ['datadome', denial('Notice', '<p>Protected by DataDome</p>')],
    'request-unsuccessful': ['request-unsuccessful', denial('Notice', '<p>Request unsuccessful.</p>')],
    'system-down': ['system-down', denial('Notice', '<p>System Down</p><p>Please try again later.</p>')],
    'error-heading': [null, denial('Error', '<h1>Something went wrong</h1><p>Please try again in a few minutes.</p>')],
  };
  for (const [name, [, html]] of Object.entries(DENIALS)) pages[`/denied-${name}`] = html;
  // capture settings: a consent dialog no sweep closes (no control, Escape ignored) in a container, and a hero whose
  // rotator a timer advances (red / blue) with a control that pins it green
  Object.assign(pages, {
    '/cmp-stuck': page('<div id="cmp-root"><div id="cmp-dialog" role="dialog" aria-modal="true" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#123;color:#fff">Choose your privacy settings</div></div><section></section><section></section>'),
    '/rotator': page('<div id="hero" style="height:400px;background:#c33"></div><button class="dot-2" onclick="document.getElementById(\'hero\').style.background=\'#3c3\'">2</button><section></section><script>let k = 0; setInterval(() => { k += 1; document.getElementById(\'hero\').style.background = k % 2 ? \'#33c\' : \'#c33\'; }, 300);</script>'),
  });
  // a valid TrueType file for the face that loads: the one playwright-core ships (its trace viewer's icon font), when found
  const BRAND_TTF = (() => { try { const dir = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'lib'); const f = readdirSync(dir, { recursive: true }).map(String).find((x) => x.endsWith('.ttf')); return f ? readFileSync(join(dir, f)) : null; } catch { return null; } })();
  const server = createServer((req, res) => {
    if (req.url === '/broken.woff2') { res.writeHead(500); res.end('down'); return; }
    if (req.url === '/brand.ttf' && BRAND_TTF) { res.writeHead(200, { 'content-type': 'font/ttf' }); res.end(BRAND_TTF); return; }
    const body = pages[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body || 'nope');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Asynchronous spawn: the origin lives in this process, so the event loop must keep running. The client-hint env is
  // left out, so the default (ua-metadata) is what a run without --hints records.
  const run = (args, cwd) => new Promise((done) => {
    const env = { ...process.env }; delete env.STARDUST_LIVE_HINTS;
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
  const work = mkdtempSync(join(tmpdir(), 'stitch-e2e-'));
  const capture = (name) => { try { return JSON.parse(readFileSync(join(work, `${name}.capture.json`), 'utf8')); } catch { return null; } };
  const pngOf = (name) => PNG.sync.read(readFileSync(join(work, `${name}.png`)));
  // Rows no chunk wrote stay zero-filled (alpha 0) — the black band a short scroll leaves at the bottom.
  const unwritten = (png) => { for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) return `row ${Math.floor((i - 3) / 4 / png.width)} of ${png.height} unwritten`; return null; };
  try {
    await check('e2e: a page 1700 px wide at --width 1440 prints its overflow line right before the stitched line; wide.capture.json records headerMorph 0 — no <stem>.json (gate.sh / gate-all own it)', async () => {
      const r = await run([`${base}/wide`, 'wide.png', '--width', '1440'], work);
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.at(-2), 'overflow: scrollWidth=1700 viewport=1440 delta=260', r.stdout);
      const [, h, n] = lines.at(-1).match(/^stitched wide\.png: 1440x(\d+) from (\d+) chunks$/) || [];
      assert.ok(h, lines.at(-1));
      assert.equal(lines.filter((l) => LINE_RE.test(l)).length, 1, 'one overflow line per capture');
      assert.equal(pngOf('wide').height, Number(h));
      const cap = capture('wide');
      assert.ok(cap && !Number.isNaN(Date.parse(cap.at)), `wide.capture.json: ${JSON.stringify(cap)}`);
      // the full Chromium build is installed here; elsewhere launchChromium says so on stderr and the shell runs
      const build = /full Chromium build is not installed/.test(r.stderr) ? 'chromium-headless-shell' : 'chromium';
      assert.ok(lines.includes(`browser: ${build}, client hints: ua-metadata`), r.stdout);
      const dismissed = { extra: [], consent: null, marketing: [], dialogs: [], dialogsLeft: [], scrollLockReleased: false };
      assert.deepEqual({ ...cap, at: 'iso' }, { writtenBy: 'skills/replica/scripts/stitch-shot.mjs', url: `${base}/wide`, width: 1440, vh: 900, height: Number(h), chunks: Number(n), headerMorph: 0, overflow: { scrollWidth: 1700, viewport: 1440, delta: 260 }, browserBuild: build, hints: 'ua-metadata', denialCheck: 'ok', dismissed, at: 'iso' });
      assert.equal(existsSync(join(work, 'wide.json')), false);
    });
    await check('e2e: a fitting page prints delta=0', async () => {
      const r = await run([`${base}/fit`, 'fit.png', '--width', '1440'], work);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^overflow: scrollWidth=1440 viewport=1440 delta=0$/m);
      assert.ok(existsSync(join(work, 'fit.png')));
    });
    // measure.mjs's root line is the overflow read gate.sh used before the build capture's own line: same verdict.
    const measureRoot = (url, width) => new Promise((done) => {
      const child = spawn(process.execPath, [join(HERE, '..', 'measure.mjs'), url, '--selectors', 'html', '--props', 'display', '--width', String(width), '--json'], { cwd: work });
      let out = ''; child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => { try { done(JSON.parse(out).root[url][width]); } catch { done(null); } });
    });
    const stitchRoot = async (path, width = 1440) => {
      const r = await run([`${base}${path}`, `${path.slice(1)}-${width}.png`, '--width', String(width)], work);
      const m = r.stdout.match(/^overflow: scrollWidth=(\d+) viewport=(\d+) delta=(\d+)$/m);
      return m ? { scrollWidth: Number(m[1]), viewport: Number(m[2]), delta: Number(m[3]) } : { error: r.stderr || r.stdout };
    };
    const parity = [['/wide', 1440, 260], ['/fit', 1440, 0], ['/reveal', 1440, 0], ['/reveal', 360, 0], ['/drawer', 1440, 0], ['/drawer-abs', 1440, 400], ['/fixed-header', 360, 40]];
    for (const [path, width, delta] of parity) {
      await check(`e2e: overflow parity with measure.mjs on ${path} at ${width} — delta ${delta}`, async () => {
        const [m, st] = await Promise.all([measureRoot(`${base}${path}`, width), stitchRoot(path, width)]);
        assert.ok(m, 'measure.mjs printed a root line');
        assert.deepEqual(st, { scrollWidth: m.scrollWidth, viewport: m.viewport, delta: m.overflowX }, `measure ${JSON.stringify(m)}`);
        assert.equal(st.delta, delta);
      });
    }
    await check('e2e: a keyframe reveal the freeze starts paused off to the side is read at rest — delta 0, no invented overflow', async () => {
      assert.deepEqual(await stitchRoot('/reveal-anim'), { scrollWidth: 1440, viewport: 1440, delta: 0 });
    });
    // Header morph: a shortfall the document's own shrink explains is not a scroll stall — the stitch continues from
    // where the window stopped, the PNG takes the shrunk height, <stem>.capture.json records headerMorph.
    const stitch = async (path, name, extra = []) => {
      const r = await run([`${base}${path}`, `${name}.png`, '--width', '1440', ...extra], work);
      return { ...r, lines: r.stdout.trim().split('\n'), cap: capture(name) };
    };
    await check('e2e: a header that shrinks 20 px after the first scroll (1810 px, the browser clamps) is a morph, not a scroll stall — exit 0, 1790 px, headerMorph 20', async () => {
      const r = await stitch('/morph-1810', 'morph');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.lines.at(-2), 'overflow: scrollWidth=1440 viewport=1440 delta=0', r.stdout);
      assert.equal(r.lines.at(-1), 'stitched morph.png: 1440x1790 from 2 chunks — header morph 20 px');
      assert.equal(r.stderr.split('\n').filter((l) => /header morph/.test(l)).length, 1, r.stderr);
      assert.deepEqual([r.cap?.headerMorph, r.cap?.height, r.cap?.chunks], [20, 1790, 2], JSON.stringify(r.cap));
      const png = pngOf('morph');
      assert.equal(png.height, 1790); assert.equal(unwritten(png), null);
      assert.equal(existsSync(join(work, 'morph.json')), false);
    });
    await check('e2e: the same header under --settle (its pass scrolls the page before the height is read) — exit 0, headerMorph 20', async () => {
      const r = await stitch('/morph-1810', 'morph-settle', ['--settle']);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual([r.cap?.headerMorph, pngOf('morph-settle').height], [20, 1790], JSON.stringify(r.cap));
    });
    await check('e2e: mid-page the browser\'s scroll anchoring moves scrollY up by the header\'s loss (2710 px) — the shortfall equals the shrink: morph, 2690 px, no stall at the last chunk', async () => {
      const r = await stitch('/morph-2710', 'morph-anchored');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.lines.at(-1), 'stitched morph-anchored.png: 1440x2690 from 4 chunks — header morph 20 px');
      assert.equal(r.cap?.headerMorph, 20, JSON.stringify(r.cap));
      const png = pngOf('morph-anchored');
      assert.equal(png.height, 2690); assert.equal(unwritten(png), null);
    });
    await check('e2e: the same header at 1800 px, an alignment the old guard let through short — 1780 px, no unwritten rows at the bottom, headerMorph 20', async () => {
      const r = await stitch('/morph-1800', 'morph-short');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.lines.at(-1), /^stitched morph-short\.png: 1440x1780 from \d+ chunks — header morph 20 px$/);
      assert.deepEqual([r.cap?.headerMorph, r.cap?.height], [20, 1780], JSON.stringify(r.cap));
      const png = pngOf('morph-short');
      assert.equal(png.height, 1780); assert.equal(unwritten(png), null);
    });
    await check('e2e: an inner scroller (window scroll a no-op, the height unchanged) still fails loud — exit 1, the scroll stall signature, no .capture.json left behind', async () => {
      writeFileSync(join(work, 'jacked.capture.json'), '{"stale":true}');
      const r = await run([`${base}/jacked`, 'jacked.png', '--width', '1440'], work);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /^stitch-shot error: scroll stall at chunk target 900px: window scroll is a no-op \(window\.scrollY stuck at 0px\) while the document reports 3000px/m);
      assert.equal(existsSync(join(work, 'jacked.capture.json')), false, 'a stale sidecar goes when the capture starts');
      assert.equal(existsSync(join(work, 'jacked.png')), false);
      assert.doesNotMatch(r.stdout + r.stderr, /header morph/);
    });
    // ---- S22: dialogs and their scroll lock, denial pages, the browser record ----
    const noOutput = (name) => [existsSync(join(work, `${name}.png`)), existsSync(join(work, `${name}.capture.json`))];
    const STALL_3914 = /^stitch-shot error: scroll stall at chunk target 900px: window scroll is a no-op \(window\.scrollY stuck at 0px\) while the document reports 3914px/m;
    await check('e2e (a): the recorded dialog stall reproduces — the dialog left open (--no-dismiss), html/body locked at height:100%: exit 1, the scroll stall signature, no sidecar', async () => {
      const r = await stitch('/dialog-lock', 'dialog-nodismiss', ['--no-dismiss']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, STALL_3914);
      assert.deepEqual(noOutput('dialog-nodismiss'), [false, false]);
    });
    await check('e2e (a): default flags close the dialog (close()) and release the lock it left — exit 0, 3914 px, dismissed records the dialog, no survivor, the release; denialCheck ok', async () => {
      const r = await stitch('/dialog-lock', 'dialog');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(pngOf('dialog').height >= 3900, `PNG height ${pngOf('dialog').height}`);
      assert.match(r.lines.at(-1), /^stitched dialog\.png: 1440x3914 from \d+ chunks$/, r.stdout);
      assert.equal(r.cap?.dismissed?.dialogs?.length, 1, JSON.stringify(r.cap));
      assert.match(r.cap.dismissed.dialogs[0], /^dialog.* \(close\(\)\)$/);
      assert.deepEqual([r.cap.dismissed.dialogsLeft, r.cap.dismissed.scrollLockReleased], [[], true]);
      assert.equal(r.cap.denialCheck, 'ok', 'the post-sweep denial-page read, on the record');
      assert.match(r.stdout, /^dialog closed: dialog\.x-modal\.js-modal \(close\(\)\)$/m);
      assert.match(r.stdout, /^scroll lock released for the capture \(overflow-y visible, a hidden overflow-x clipped\)$/m);
    });
    await check('e2e (b): a non-native .modal.show[role=dialog][aria-modal=true] its close control hides, html.is-locked left behind — exit 0, full height, the close-control entry, the lock released', async () => {
      const r = await stitch('/modal-lock', 'modal');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(pngOf('modal').height, 3914);
      assert.deepEqual([r.cap?.dismissed?.dialogs, r.cap?.dismissed?.dialogsLeft, r.cap?.dismissed?.scrollLockReleased], [['div.modal.show (close control .modal__close)'], [], true], JSON.stringify(r.cap));
      assert.match(r.stdout, /^dialog closed: div\.modal\.show \(close control \.modal__close\)$/m);
    });
    await check('e2e (c): an unclosable aria-modal over the lock keeps the lock (R1) — exit 1, the scroll stall signature, the survivor named, no sidecar', async () => {
      const r = await stitch('/modal-stuck-lock', 'stuck');
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, STALL_3914);
      assert.match(r.stdout, /^dialog still open: div#blocker$/m);
      assert.doesNotMatch(r.stdout, /scroll lock released/);
      assert.deepEqual(noOutput('stuck'), [false, false]);
    });
    // (d) every denial route at once — each run exits at the entry or right after the sweep
    const denied = await Promise.all(Object.keys(DENIALS).map((name) => stitch(`/denied-${name}`, `denied-${name}`)));
    for (const [i, [name, [id]]] of Object.entries(DENIALS).entries()) {
      const label = id ? session.DENIAL_SIGNATURES.find((s) => s.id === id).label : 'under one error heading';
      await check(`e2e (d): denial page /denied-${name} → exit 3, stderr names ${label}, "origin blocked" and --headed; no PNG, no capture.json`, () => {
        const r = denied[i];
        assert.equal(r.status, 3, r.stdout + r.stderr);
        assert.ok(r.stderr.includes(`HTTP 200 denial page — ${id ? label : ''}`), r.stderr);
        assert.ok(r.stderr.includes(label), r.stderr);
        assert.match(r.stderr, /origin blocked/); assert.match(r.stderr, /--headed/);
        assert.deepEqual(noOutput(`denied-${name}`), [false, false]);
      });
    }
    await check('e2e (d) with --hide over its text and --json: the late denial page is read before the --hide pass — exit 3, no hidden line, no PNG, no capture.json, no --json record', async () => {
      const r = await stitch('/denied-recorded-late', 'denied-late-hide', ['--hide', 'body > div', '--json', 'denied-late-hide.json']);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /origin blocked/);
      assert.doesNotMatch(r.stdout, /^hidden:/m, 'the denial read comes before the hide pass');
      assert.deepEqual(noOutput('denied-late-hide'), [false, false]);
      assert.equal(existsSync(join(work, 'denied-late-hide.json')), false, 'no --json record');
    });
    await check('e2e (d, R3): a 3000 px article whose text says "press & hold the button" is no denial page — exit 0', async () => {
      const r = await stitch('/article-press-hold', 'article');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(pngOf('article').height >= 3000);
      assert.doesNotMatch(r.stderr, /denial/);
    });
    await check('e2e (e): --hints native is recorded (stdout and capture.json hints \'native\'); dismissed is null under --no-dismiss', async () => {
      const r = await stitch('/fit', 'fit-native', ['--hints', 'native', '--no-dismiss']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^browser: chromium(-headless-shell)?, client hints: native$/m);
      assert.deepEqual([r.cap?.hints, r.cap?.dismissed], ['native', null], JSON.stringify(r.cap));
      assert.equal(r.cap.browserBuild, /full Chromium build is not installed/.test(r.stderr) ? 'chromium-headless-shell' : 'chromium');
    });
    await check('e2e: EDS single sweep — no timed poll, one sweep after waitEdsDelayedPhase dismisses a consent banner shown 3 s after load', async () => {
      const lib = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolve(HERE, '..', p)).find((p) => existsSync(p));
      const { dismissOverlays, lateWindowFor, waitEdsDelayedPhase } = await import(pathToFileURL(lib).href);
      assert.equal(lateWindowFor('https://main--site--org.aem.live/consent-late'), 0, 'no timed late-modal window on an EDS host');
      const browser = await chromium.launch();
      try {
        const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await p.goto(`${base}/consent-late`, { waitUntil: 'domcontentloaded' });
        const early = await dismissOverlays(p, { lateWindowMs: 0 });
        assert.equal(early.consent, null, 'a sweep before the delayed phase finds no banner — the wait is what reaches it');
        const waited = await waitEdsDelayedPhase(p);
        assert.ok(waited < 6000, `the wait ended on the delayed phase, not the cap (${waited} ms)`);
        const d = await dismissOverlays(p, { lateWindowMs: lateWindowFor('https://main--site--org.aem.live/consent-late') });
        assert.equal(d.consent, '#onetrust-accept-btn-handler');
        assert.equal(await p.locator('#banner').count(), 0, 'the banner is gone');
      } finally { await browser.close(); }
    });
    // --hide: the same command shape with and without the flag; the PNG's IHDR height is the stitched height.
    const pngHeight = (f) => readFileSync(join(work, f)).readUInt32BE(20);
    const lastTwo = (r) => r.stdout.trim().split('\n').slice(-2);
    const spec = join(work, 'geo-inv.spec.json');
    writeFileSync(spec, JSON.stringify({ out: join(work, 'geo-inv.json'), side: 'live', presence: { rootSel: null, variableSels: [] } }));
    const settled = run([`${base}/geo`, 'geo-settle.png', '--settle', '--hide', '.geo-bar', '--inventory', spec], work);
    await check('e2e --hide: an 88 px in-flow .geo-bar — the stitch is 88 px shorter with `hidden: .geo-bar ×1 (88px) [--hide]` (also under --no-dismiss); ×0 changes nothing; no flag → no line', async () => {
      const [plain, hid, noDismiss, none] = await Promise.all([
        run([`${base}/geo`, 'geo-plain.png'], work),
        run([`${base}/geo`, 'geo-hide.png', '--hide', '.geo-bar'], work),
        run([`${base}/geo`, 'geo-nodismiss.png', '--no-dismiss', '--hide', '.geo-bar'], work),
        run([`${base}/geo`, 'geo-none.png', '--hide', '.no-such-bar'], work),
      ]);
      for (const r of [plain, hid, noDismiss, none]) assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(plain.stdout, /^hidden:/m, 'no --hide → no hidden line');
      for (const r of [hid, noDismiss]) {
        assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('hidden:')).join('|'), 'hidden: .geo-bar ×1 (88px) [--hide]', r.stdout);
        assert.match(lastTwo(r)[0], LINE_RE, 'the overflow line still sits right before the stitched line');
      }
      assert.match(noDismiss.stdout, /^overlays left as the page shows them \(--no-dismiss\)$/m);
      assert.match(none.stdout, /^hidden: \.no-such-bar ×0 \[--hide\]$/m);
      const h = { plain: pngHeight('geo-plain.png'), hid: pngHeight('geo-hide.png'), noDismiss: pngHeight('geo-nodismiss.png'), none: pngHeight('geo-none.png') };
      assert.equal(h.hid, h.plain - 88, JSON.stringify(h));
      assert.equal(h.noDismiss, h.hid, JSON.stringify(h));
      assert.equal(h.none, h.plain, JSON.stringify(h));
      assert.equal(lastTwo(hid)[1], `stitched geo-hide.png: 1440x${h.hid} from 2 chunks`);
    });
    await check('e2e --hide under --settle: applied after the settle sweep and before --inventory — the inventory sees the hidden page', async () => {
      const r = await settled;
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^hidden: \.geo-bar ×1 \(88px\) \[--hide\]$/m);
      const inv = JSON.parse(readFileSync(join(work, 'geo-inv.json'), 'utf8'));
      assert.equal(inv.error, undefined, inv.error);
      assert.equal(inv.docH, pngHeight('geo-settle.png'), 'inventory and stitch measure the same page');
      assert.equal(inv.docH, pngHeight('geo-hide.png'));
      assert.equal(inv.items.find((x) => x.kind === 'heading').y, 60, 'the heading sits right below the 60 px header (148 with the bar)');
      assert.ok(!inv.items.some((x) => x.href === '/loc'), 'the bar\'s link is not inventoried');
    });
    // overlay-left + the --json capture record (gate.sh greps the line, gate-all / gate.sh read the record)
    const OVL = 'div.backdrop (fixed, 100 % of the viewport)';
    const ovlLines = (r) => r.stdout.split('\n').filter((l) => l.startsWith('overlay-left:'));
    const record = (f) => JSON.parse(readFileSync(join(work, f), 'utf8'));
    const shots = {
      backdrop: run([`${base}/backdrop`, 'backdrop.png', '--json', 'backdrop.json'], work),
      noDismiss: run([`${base}/backdrop`, 'backdrop-nod.png', '--no-dismiss', '--json', 'rec/backdrop-nod.json'], work),
      hidden: run([`${base}/backdrop`, 'backdrop-hide.png', '--hide', '.backdrop', '--json', 'backdrop-hide.json'], work),
      fit: run([`${base}/fit`, 'fit-rec.png', '--json', 'fit-rec.json'], work),
      font: run([`${base}/font-fail`, 'font.png', '--json', 'font.json'], work),
      fontUnread: run([`${base}/fonts-unreadable`, 'font-unread.png', '--json', 'font-unread.json'], work),
      sweeps: run([`${base}/consent-popup`, 'sweeps.png', '--settle', '--json', 'sweeps.json'], work),
      navigated: run([`${base}/consent-link`, 'nav.png', '--json', 'nav.json'], work),
      failed: run([`${base}/no-such-page`, 'failed.png', '--json', 'failed.json'], work),
      // hide misses: the right selector is the candidate the wrong run names
      barRight: run([`${base}/bar`, 'bar-right.png', '--hide', 'section.bar__wrapper', '--json', 'bar-right.json'], work),
      barWrong: run([`${base}/bar`, 'bar-wrong.png', '--hide', '.location-bar', '--json', 'bar-wrong.json'], work),
      barLate: run([`${base}/bar-late`, 'bar-late.png', '--hide', '.bar__content', '--json', 'bar-late.json'], work),
    };
    await check('e2e overlay-left: a fixed full-viewport backdrop no sweep removes → one `overlay-left:` line before the overflow line, exit 0; --json records it', async () => {
      const r = await shots.backdrop;
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(ovlLines(r), [`overlay-left: ${OVL}`], r.stdout);
      const lines = r.stdout.trim().split('\n');
      assert.ok(lines.indexOf(`overlay-left: ${OVL}`) < lines.findIndex((l) => LINE_RE.test(l)), r.stdout);
      assert.match(lines.at(-2), LINE_RE, 'the overflow line still sits right before the stitched line');
      const j = record('backdrop.json');
      assert.equal(j.overlayLeft, OVL);
      assert.deepEqual(j.fontsFailed, []);
      assert.deepEqual(j.dismissed, { consent: null, extra: [], marketing: [] });
    });
    await check('e2e overlay-left under --no-dismiss: the check still runs (the line, overlayLeft) and dismissed is null; --json creates its directory', async () => {
      const r = await shots.noDismiss;
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(ovlLines(r), [`overlay-left: ${OVL}`], r.stdout);
      const j = record('rec/backdrop-nod.json');
      assert.equal(j.dismissed, null);
      assert.equal(j.overlayLeft, OVL);
    });
    await check('e2e overlay-left after --hide: a backdrop --hide removes is not reported — no line, overlayLeft null, the hide records kept', async () => {
      const r = await shots.hidden;
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(ovlLines(r), [], r.stdout);
      assert.match(r.stdout, /^hidden: \.backdrop ×1 \(900px\) \[--hide\]$/m);
      const j = record('backdrop-hide.json');
      assert.equal(j.overlayLeft, null);
      assert.deepEqual(j.hidden, [{ sel: '.backdrop', source: '--hide', n: 1, h: 900, nAtCapture: 1 }]);
      assert.equal(j.hideMiss, null);
    });
    await check('e2e --json on a clean page: the record exactly — key order, 2-space JSON + newline, height = the PNG\'s, overflow = the line\'s numbers', async () => {
      const r = await shots.fit;
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(ovlLines(r), [], r.stdout);
      assert.equal(lastTwo(r)[0], 'overflow: scrollWidth=1440 viewport=1440 delta=0');
      const want = { url: `${base}/fit`, out: 'fit-rec.png', width: 1440, vh: 900, settle: false, dismissed: { consent: null, extra: [], marketing: [] },
        overlayLeft: null, dialogLeft: null, fontsFailed: [], hidden: [], hideMiss: null, height: pngHeight('fit-rec.png'), overflow: { scrollWidth: 1440, viewport: 1440, delta: 0 } };
      assert.equal(readFileSync(join(work, 'fit-rec.json'), 'utf8'), `${JSON.stringify(want, null, 2)}\n`);
    });
    await check('e2e --json fontsFailed: a face whose file answers 500 and a family whose only face 404s count (the one FONT LOAD FAILED warning); a 404 duplicate beside a face of its family that loaded is a dead declaration — fontsDead, one info line, not counted', async () => {
      const r = await shots.font;
      assert.equal(r.status, 0, r.stderr);
      const warnings = r.stderr.split('\n').filter((l) => /WARNING/.test(l));
      assert.equal(warnings.length, 1, r.stderr);
      assert.match(warnings[0], /FONT LOAD FAILED for declared face\(s\) "?Other Sans"?, "?Solo Sans"? — /, 'a 500, and a 404 that leaves its family without a loaded face, count');
      const j = record('font.json');
      if (!BRAND_TTF) { console.log('skip  e2e dead declaration beside a loaded face (no .ttf found in playwright-core)'); return; }
      assert.doesNotMatch(warnings[0], /Brand Sans/);
      assert.match(r.stdout, /^fonts: not counted — @font-face whose every src returned 404 beside a face of its family that loaded \(a dead declaration, the same for every visitor\): Brand Sans$/m);
      assert.deepEqual([j.fontsFailed, j.fontsDead], [['Other Sans', 'Solo Sans'], ['Brand Sans']]);
      assert.ok(!('fontCheck' in j), 'a check that ran carries no fontCheck');
    });
    await check('e2e --json: a font-load check that cannot run (document.fonts throws) → fontsFailed null + fontCheck right after it, one stderr WARNING, exit 0', async () => {
      const r = await shots.fontUnread;
      assert.equal(r.status, 0, r.stderr);
      const warnings = r.stderr.split('\n').filter((l) => /WARNING/.test(l));
      assert.equal(warnings.length, 1, r.stderr);
      assert.match(warnings[0], /^stitch-shot WARNING: font-load check failed \(.*fonts unavailable.*\) — the record says fontsFailed: null \(not checked\)$/);
      const j = record('font-unread.json');
      assert.equal(j.fontsFailed, null);
      assert.match(j.fontCheck, /^failed: .*fonts unavailable/);
      assert.doesNotMatch(j.fontCheck, /\n/);
      const keys = Object.keys(j);
      assert.equal(keys[keys.indexOf('fontsFailed') + 1], 'fontCheck', keys.join(','));
    });
    await check('e2e --json dismissed across the --settle sweeps: consent kept from the first (the settle sweep finds none), the popup the settle sweep closed', async () => {
      const r = await shots.sweeps;
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^consent dismissed via #onetrust-accept-btn-handler$/m);
      assert.match(r.stdout, /^marketing modal dismissed via \[aria-label\*="close" i\]$/m);
      const j = record('sweeps.json');
      assert.deepEqual(j.dismissed, { consent: '#onetrust-accept-btn-handler', extra: [], marketing: ['[aria-label*="close" i]'] });
      assert.equal(j.settle, true);
      assert.equal(j.overlayLeft, null);
    });
    await check('e2e overlay-left: a consent-sweep click that left the page is named — never the new page\'s own (clean) check', async () => {
      const r = await shots.navigated;
      assert.equal(r.status, 0, r.stderr);
      const want = `(consent sweep navigated to ${base}/fit)`;
      assert.deepEqual(ovlLines(r), [`overlay-left: ${want}`], r.stdout);
      const j = record('nav.json');
      assert.equal(j.overlayLeft, want);
      assert.equal(j.dismissed.consent, 'label "Accept"');
    });
    await check('e2e --json: a failed capture (HTTP 404) exits 1 and writes no record', async () => {
      const r = await shots.failed;
      assert.equal(r.status, 1, r.stderr);
      assert.ok(!existsSync(join(work, 'failed.json')), 'no record');
      assert.ok(!existsSync(join(work, 'failed.png')), 'no PNG');
    });
    // the bar's #f90 pixels in a stitched PNG; no line about a miss on either stream — the side is the caller's to name
    const barPixels = (f) => {
      const { data } = PNG.sync.read(readFileSync(join(work, f)));
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 255) <= 2 && Math.abs(data[i + 1] - 153) <= 2 && data[i + 2] <= 2) n += 1;
      return n;
    };
    const noMissLine = (r) => assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /hide matched nothing|WARNING/, `${r.stdout}\n${r.stderr}`);
    await check('e2e hide miss — the delayed bar, right selector: hidden in the PNG (no bar pixel, 72 px shorter), nAtCapture 1, hideMiss null', async () => {
      const [r, wrong] = [await shots.barRight, await shots.barWrong];
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^hidden: section\.bar__wrapper ×1 \(72px\) \[--hide\]$/m);
      noMissLine(r);
      const j = record('bar-right.json');
      assert.deepEqual(j.hidden, [{ sel: 'section.bar__wrapper', source: '--hide', n: 1, h: 72, nAtCapture: 1 }]);
      assert.equal(j.hideMiss, null);
      assert.equal(barPixels('bar-right.png'), 0, 'no bar pixel in the capture');
      assert.equal(wrong.status, 0, wrong.stderr);
      assert.equal(pngHeight('bar-right.png'), pngHeight('bar-wrong.png') - 72);
      assert.equal(j.height, pngHeight('bar-right.png'));
    });
    await check('e2e hide miss — a wrong selector: ×0 at the hide pass and at the capture → hideMiss names it with the wrapper as the candidate; the bar stays in the PNG; no line printed', async () => {
      const r = await shots.barWrong;
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^hidden: \.location-bar ×0 \[--hide\]$/m);
      noMissLine(r);
      const j = record('bar-wrong.json');
      assert.deepEqual(j.hidden, [{ sel: '.location-bar', source: '--hide', n: 0, h: 0, nAtCapture: 0 }]);
      assert.deepEqual(j.hideMiss, { sels: ['.location-bar'], candidates: [{ tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, height: 72, selector: 'section.bar__wrapper' }] });
      assert.deepEqual(Object.keys(j).slice(-4), ['hidden', 'hideMiss', 'height', 'overflow']);
      assert.ok(barPixels('bar-wrong.png') > 50000, 'the bar is in the capture');
    });
    await check('e2e hide miss — a block injected after the hide pass: ×0 at the pass, nAtCapture 1 — hidden by the persistent rule, no hideMiss', async () => {
      const r = await shots.barLate;
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^hidden: \.bar__content ×0 \[--hide\]$/m, 'the hidden line reports the hide pass');
      noMissLine(r);
      const j = record('bar-late.json');
      assert.deepEqual(j.hidden, [{ sel: '.bar__content', source: '--hide', n: 0, h: 0, nAtCapture: 1 }]);
      assert.equal(j.hideMiss, null);
      assert.equal(barPixels('bar-late.png'), 0);
      assert.equal(pngHeight('bar-late.png'), pngHeight('bar-right.png'));
    });
    // capture settings: dialogs left open, pins, presence.json read with --slug
    const proj = join(work, 'proj'); mkdirSync(join(proj, 'stardust/replica'), { recursive: true });
    writeFileSync(join(proj, 'stardust/replica/presence.json'), JSON.stringify({ '*': { pin: [{ sel: '.dot-2', state: 'slide 2' }] }, de: { hide: ['#cmp-root'], allow: [{ kind: 'per-visitor-dialog', selector: '#cmp-root', reason: 'R-06' }] } }));
    const settings = {
      left: run([`${base}/cmp-stuck`, 'cmp-left.png', '--json', 'cmp-left.json'], work),
      hiddenOnly: run([`${base}/cmp-stuck`, 'cmp-hidden.png', '--hide', '#cmp-root', '--json', 'cmp-hidden.json'], work),
      allowed: run([`${base}/cmp-stuck`, 'cmp-allowed.png', '--hide', '#cmp-root', '--allow-dialog', '#cmp-root', '--json', 'cmp-allowed.json'], work),
      viaSlug: run([`${base}/cmp-stuck`, join(work, 'cmp-slug.png'), '--slug', 'de', '--json', join(work, 'cmp-slug.json')], proj),
      otherSlug: run([`${base}/cmp-stuck`, join(work, 'cmp-other.png'), '--slug', 'fr', '--json', join(work, 'cmp-other.json')], proj),
      pinned: run([`${base}/rotator`, 'rot-pin.png', '--pin', '.dot-2,.no-such-dot', '--json', 'rot-pin.json'], work),
      pinSlug: run([`${base}/rotator`, join(work, 'rot-slug.png'), '--slug', 'home', '--json', join(work, 'rot-slug.json')], proj),
      unpinned: run([`${base}/rotator`, 'rot-none.png', '--json', 'rot-none.json'], work),
    };
    const dlgLines = (r) => r.stdout.split('\n').filter((l) => l.startsWith('dialog-left:'));
    await check('e2e dialog left open: a consent dialog no sweep closes → one `dialog-left:` line and dialogLeft [name]; hidden by --hide alone it still is (a hide no longer silences it); hidden by an --allow-dialog container → no line, dialogLeft null, dialogsAllowed', async () => {
      const [left, hid, ok] = [await settings.left, await settings.hiddenOnly, await settings.allowed];
      for (const r of [left, hid, ok]) assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(dlgLines(left), ['dialog-left: div#cmp-dialog'], left.stdout); assert.deepEqual(record('cmp-left.json').dialogLeft, ['div#cmp-dialog']);
      assert.deepEqual(dlgLines(hid), ['dialog-left: div#cmp-dialog (hidden by #cmp-root — not an allowed per-visitor dialog)'], hid.stdout);
      assert.deepEqual(record('cmp-hidden.json').dialogLeft, ['div#cmp-dialog']); assert.equal(record('cmp-hidden.json').overlayLeft, null, 'the hide took the layer out of the capture');
      assert.deepEqual(dlgLines(ok), [], ok.stdout); assert.match(ok.stdout, /^dialog left open, hidden as a per-visitor dialog: div#cmp-dialog \(#cmp-root\)$/m);
      const j = record('cmp-allowed.json');
      assert.deepEqual([j.dialogLeft, j.dialogsAllowed], [null, [{ name: 'div#cmp-dialog', hiddenBy: '#cmp-root' }]]);
    });
    await check('e2e --slug: presence.json (the site file, cwd-relative) adds the page\'s hide / allow / pin — the allowed page carries no dialog-left, another slug does', async () => {
      const [de, fr] = [await settings.viaSlug, await settings.otherSlug];
      assert.equal(de.status, 0, de.stderr); assert.equal(fr.status, 0, fr.stderr);
      assert.match(de.stdout, /^hidden: #cmp-root ×1 \(0px\) \[presence\.json\]$/m, de.stdout);
      assert.deepEqual(dlgLines(de), []); assert.deepEqual(JSON.parse(readFileSync(join(work, 'cmp-slug.json'), 'utf8')).dialogsAllowed, [{ name: 'div#cmp-dialog', hiddenBy: '#cmp-root' }]);
      assert.deepEqual(dlgLines(fr), ['dialog-left: div#cmp-dialog'], fr.stdout);
    });
    const heroGreen = (f) => { const png = PNG.sync.read(readFileSync(f)); const i = (200 * png.width + 700) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]].join(','); };
    await check('e2e --pin: the control clicked after the freeze on the frozen page (the hero pinned green), one line per pin, a selector matching nothing named; --slug reads the pin\'s state from presence.json', async () => {
      const [pin, slug, none] = [await settings.pinned, await settings.pinSlug, await settings.unpinned];
      for (const r of [pin, slug, none]) assert.equal(r.status, 0, r.stderr);
      assert.match(pin.stdout, /^pinned: \.dot-2 \(clicked\)$/m); assert.match(pin.stdout, /^pin not applied: \.no-such-dot \(no visible match\)$/m);
      assert.deepEqual(record('rot-pin.json').pinned, [{ sel: '.dot-2', state: null, clicked: true }, { sel: '.no-such-dot', state: null, clicked: false }]);
      assert.equal(heroGreen(join(work, 'rot-pin.png')), '51,204,51');
      assert.notEqual(heroGreen(join(work, 'rot-none.png')), '51,204,51'); assert.ok(!('pinned' in record('rot-none.json')), 'no pin, no field');
      assert.deepEqual(JSON.parse(readFileSync(join(work, 'rot-slug.json'), 'utf8')).pinned, [{ sel: '.dot-2', state: 'slide 2', clicked: true }]);
      assert.equal(heroGreen(join(work, 'rot-slug.png')), '51,204,51');
    });
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- --inventory (gate-all --one-load): named in --help; an inventory problem never fails the capture -------------
await check('--inventory: --help names it; with an unreadable spec the stitch still writes the PNG and exits 0 with one stderr warning', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-inventory-'));
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><body style="margin:0"><main><h1>Inventory</h1><section style="height:1200px;background:#ddd"></section></main></body></html>'); });
  try {
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(h.status, 0); assert.match(h.stdout, /--inventory <f> .*gate-all --one-load/);
    if (!chromium) { console.log('skip  e2e --inventory with an unreadable spec (playwright / pngjs not importable here)'); return; }
    await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
    const r = await new Promise((done) => {
      const child = spawn(process.execPath, [SCRIPT, `http://127.0.0.1:${srv.address().port}/`, 'inv.png', '--settle', '--inventory', join(cwd, 'missing-spec.json')], { cwd });
      let stdout = ''; let stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0, r.stderr); assert.ok(statSync(join(cwd, 'inv.png')).size > 0); assert.match(r.stdout, /^stitched inv\.png: 1440x\d+/m);
    const warnings = r.stderr.split('\n').filter((l) => /WARNING/.test(l));
    assert.equal(warnings.length, 1, r.stderr); assert.match(warnings[0], /missing-spec\.json/);
  } finally { srv.close(); rmSync(cwd, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} check(s) failing` : '\nstitch-shot: all checks passed');
process.exit(failed ? 1 : 0);
