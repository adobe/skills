#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent table (the vendor accept buttons in table order, no duplicates, the
// OneTrust id first; the frozen label sweep, accept-like labels first, "decline" last, covering crawl.mjs's
// text-match labels), isLiveHttpUrl, defaultWaitUntil, isEdsHost and lateWindowFor (no timed
// late-modal poll on EDS build/preview hosts), waitEdsDelayedPhase never throwing (stub page), the one
// navigation timeout (env → the crawl's p95 × 2 → the caller's default; gotoLive and visit take it per call), and the
// per-width deadline helpers (withDeadline, isContextDestroyed). The hide helpers:
// parseHideList, presenceHide, mergePresence, readPresenceFile (with and without the site-wide presence.json merged
// under the gate file), hideEntries, formatHidden and hideRegions' empty / argument contract
// (stub page); the hide misses: formatCandidates, hideMisses (n 0 at the hide pass AND nAtCapture 0), hideMissLine
// (one line) and recountHides' contract (stub page); where playwright is importable (a project copy), hideRegions end-to-end on fixture pages served from
// this process — an 88 px in-flow bar above the header, a bar inserted 400 ms after load (hidden by the style rule),
// an invalid selector, a second call, and a late bar under a CSP that blocks inline <style> (hidden by the adopted
// sheet) — inFlowRegionsAboveHeader (an empty wrapper before the header at 0px, then 88px once a lookup fills it, a
// fixed banner and a script not listed; a header inside an app root; #id / fewest classes / :nth-of-type selectors;
// no header) and recountHides counting a bar injected after the hide pass — and dismissOverlays' consent pass on fixture banners: each consent manager's own accept button, a plain
// label (by priority, never "Decline" first), a label two shadow roots deep, a consent form's submit and a "#" link
// in a fixed banner, and the controls left alone — an in-content "Accept" link, a sticky header's search submit "OK";
// a sweep click that navigates away is named in overlayLeft;
// then detectOverlayLeft (also a stub page: an evaluate error is a failed check, never clean) on what a capture would
// still carry — a banner-sized consent root (or its shadow content) shown, a full-viewport backdrop, blur or
// pointer-events:none tint painting over the page's content, an html / body scroll lock — and on the look-alikes that
// are none: a consent manager's persistent 48 px privacy trigger after an accept, a transparent wrapper with a toast,
// a layer below the page (z-index -1), a fixed background under positioned content, a sticky full-viewport hero at the
// top, a 120 px bar, roots hidden by display or an opacity-0 ancestor; dismissOverlays returns it. A showModal() <dialog>
// left open (document, open shadow root) is named "(modal open)", one with a "Close" button is closed by the marketing
// pass, a non-modal <dialog open> in the content is none.
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as session from '../live-session.mjs';
import { visit } from '../measure-live.mjs';

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('the exported surface the instruments import', () => {
  for (const name of ['REAL_CHROME_UA', 'CONSENT_CANDIDATES', 'isLiveHttpUrl', 'isEdsHost', 'lateWindowFor', 'waitEdsDelayedPhase', 'defaultWaitUntil', 'newLiveContext', 'gotoLive', 'dismissOverlays', 'launchStealthHeaded', 'browserTier',
    'NAV_TIMEOUT_ENV', 'CRAWL_LOG', 'NAV_TIMEOUT_DEFAULT_MS', 'NAV_TIMEOUT_MIN_MS', 'NAV_TIMEOUT_MAX_MS', 'navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed']) assert.ok(name in session, `${name} exported`);
  assert.equal(typeof session.dismissOverlays, 'function');
  for (const name of ['navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed']) assert.equal(typeof session[name], 'function', name);
  assert.equal(typeof session.waitEdsDelayedPhase, 'function');
});
check('consent candidates: OneTrust first, the cmp-prefixed consent-manager buttons present, text fallbacks last, no duplicates', () => {
  const c = session.CONSENT_CANDIDATES;
  assert.ok(Array.isArray(c) && c.length >= 9, `${c.length} candidates`);
  assert.equal(c[0], '#onetrust-accept-btn-handler');
  for (const sel of ['#cmpwelcomebtnyes', '.cmpboxbtnyes', '#cmpbntyestxt']) assert.ok(c.includes(sel), `${sel} is a candidate`);
  assert.ok(c.indexOf('#cmpwelcomebtnyes') < c.indexOf('button:has-text("Accept all")'), 'id selectors before the text fallbacks');
  assert.equal(new Set(c).size, c.length, 'no duplicate candidate');
  assert.ok(c.every((sel) => typeof sel === 'string' && sel.trim() === sel && sel.length), 'every candidate is a trimmed selector string');
});
check('consent candidates: the consent managers\' accept buttons in table order, every vendor id before the first text fallback', () => {
  const c = session.CONSENT_CANDIDATES;
  const vendors = ['#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
    '#usercentrics-root [data-testid="uc-accept-all-button"]', '.truste-button2', '#didomi-notice-agree-button', '#cmpwelcomebtnyes', '.cmpboxbtnyes', '#cmpbntyestxt'];
  assert.deepEqual(c.filter((sel) => vendors.includes(sel)), vendors, 'every vendor candidate, in order');
  const firstText = c.findIndex((sel) => sel.startsWith('button:has-text('));
  assert.ok(firstText > 0 && vendors.every((sel) => c.indexOf(sel) < firstText), 'vendor ids before the text fallbacks');
  assert.ok(c.includes('button:has-text("Allow all")'), 'the allow-all text fallback');
});
check('consent label sweep: one frozen table — unique trimmed lower-case labels, accept-like first, "decline" last', () => {
  const t = session.CONSENT_LABEL_SWEEP;
  assert.ok(Object.isFrozen(t) && Object.isFrozen(t.labels), 'the table and its labels are frozen');
  assert.equal(typeof session.consentLabelSweepInPage, 'function');
  const { labels } = t;
  assert.equal(new Set(labels).size, labels.length, 'no duplicate label');
  for (const l of labels) assert.ok(l && l === l.trim().toLowerCase() && !/\s{2}/.test(l) && l.length <= t.maxLength, `"${l}" is a trimmed lower-case label within maxLength`);
  assert.equal(labels.at(-1), 'decline', 'decline is the last resort');
  assert.ok(labels.indexOf('accept all') < labels.indexOf('accept') && labels.indexOf('allow all') < labels.indexOf('allow'), 'the accept-all labels win over their shorter forms');
});
check('consent label sweep covers every label of crawl.mjs\'s text-match fallback (drift guard until crawl imports the table)', () => {
  const crawl = new URL('../../../extract/scripts/crawl.mjs', import.meta.url);
  const m = /const LABELS = new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync(crawl, 'utf8'));
  assert.ok(m, 'crawl.mjs no longer declares its own `const LABELS = new Set([...])` — if it imports CONSENT_LABEL_SWEEP now, drop this guard');
  const crawlLabels = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  assert.ok(crawlLabels.length >= 5, `parsed ${crawlLabels.length} labels from crawl.mjs`);
  const missing = crawlLabels.filter((l) => !session.CONSENT_LABEL_SWEEP.labels.includes(l.toLowerCase()));
  assert.deepEqual(missing, [], 'crawl.mjs labels missing from CONSENT_LABEL_SWEEP.labels');
});
check('overlay-left: the exported surface', () => {
  for (const name of ['detectOverlayLeftInPage', 'detectOverlayLeft']) assert.equal(typeof session[name], 'function', `${name} exported`);
  assert.ok(Array.isArray(session.CONSENT_ROOTS) && session.CONSENT_ROOTS.length, 'CONSENT_ROOTS');
  assert.equal(typeof session.OVERLAY_COVERAGE, 'number');
});
check('isLiveHttpUrl: live http(s) only — never localhost, loopback, file: or garbage', () => {
  assert.equal(session.isLiveHttpUrl('https://www.example.com/page'), true);
  assert.equal(session.isLiveHttpUrl('http://example.org'), true);
  for (const u of ['http://localhost:8791/x.html', 'http://127.0.0.1:8791/', 'http://[::1]/', 'http://0.0.0.0/', 'file:///tmp/x.html', 'not a url', '']) assert.equal(session.isLiveHttpUrl(u), false, u);
});
check('defaultWaitUntil: networkidle for local and EDS origins, domcontentloaded for other live sites', () => {
  assert.equal(session.defaultWaitUntil('http://localhost:8791/x.html'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://main--site--org.aem.page/'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://main--site--org.hlx.live/'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://www.example.com/'), 'domcontentloaded');
});
check('isEdsHost: aem/hlx × page/live build and preview hosts (any port, any case) — nothing else', () => {
  for (const u of ['https://main--site--org.aem.page/', 'https://main--site--org.aem.live/x', 'https://main--site--org.hlx.page/', 'https://main--site--org.hlx.live/',
    'http://main--site--org.aem.live:47812/wide', 'HTTPS://MAIN--SITE--ORG.AEM.LIVE/']) assert.equal(session.isEdsHost(u), true, u);
  for (const u of ['https://www.example.com/', 'https://aem.page.example.com/', 'http://localhost:8791/x.html', 'file://main--site--org.aem.live/x.html', 'not a url', '']) assert.equal(session.isEdsHost(u), false, u);
});
check('lateWindowFor: the caller\'s window on live source sites, 0 on EDS build/preview hosts, localhost and file:', () => {
  assert.equal(session.lateWindowFor('https://www.example.com/'), 6000);
  assert.equal(session.lateWindowFor('https://www.example.com/', 4000), 4000);
  assert.equal(session.lateWindowFor('https://main--site--org.aem.live/'), 0);
  assert.equal(session.lateWindowFor('https://main--site--org.hlx.page/', 4000), 0);
  assert.equal(session.lateWindowFor('http://localhost:8791/x.html'), 0);
  assert.equal(session.lateWindowFor('file:///tmp/x.html'), 0);
});

const checkAsync = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
await checkAsync('waitEdsDelayedPhase: polls loadEventEnd + afterLoadMs under the timeout and never throws (timeout or closed page)', async () => {
  const calls = [];
  const page = (fail) => ({ waitForFunction: async (fn, arg, opts) => { calls.push({ fn, arg, opts }); if (fail) throw new Error('Timeout 6000ms exceeded.'); } });
  const ms = await session.waitEdsDelayedPhase(page(true));
  assert.equal(typeof ms, 'number');
  assert.deepEqual([calls[0].arg, calls[0].opts.timeout], [3200, 6000], 'defaults: 3200 ms after load, 6000 ms cap');
  await session.waitEdsDelayedPhase(page(false), { afterLoadMs: 100, timeoutMs: 500 });
  assert.deepEqual([calls[1].arg, calls[1].opts.timeout], [100, 500]);
  assert.match(String(calls[0].fn), /loadEventEnd/);
});

// Navigation timeout (D2): one value for every live navigation. Pure apart from the temp crawl logs (and one chdir
// so the default CRAWL_LOG path resolves against a temp project root).
const NAV_ENV = 'STARDUST_NAV_TIMEOUT_MS';
const withCrawlLog = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-nav-'));
  const file = join(dir, '_crawl-log.json');
  const write = (body) => writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  try { return fn({ dir, file, write }); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const captureStderr = (fn) => {
  const lines = []; const saved = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { fn(); } finally { console.error = saved; }
  return lines;
};
const withProcessEnv = async (value, fn) => {
  const saved = process.env[NAV_ENV];
  if (value === undefined) delete process.env[NAV_ENV]; else process.env[NAV_ENV] = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env[NAV_ENV]; else process.env[NAV_ENV] = saved; }
};

check('navTimeout: env wins — trimmed, rounded, used as given (no clamp), over a crawl figure', () => withCrawlLog(({ file, write }) => {
  write({ crawl: { navMs: { p95: 30000 } } });
  assert.deepEqual(session.navTimeout({ env: { [NAV_ENV]: ' 1500.6 ' }, crawlLog: file }), { ms: 1501, source: 'env', detail: `${NAV_ENV}=1500.6` });
  assert.equal(session.navTimeout({ env: { [NAV_ENV]: '250000' }, crawlLog: file }).ms, 250000, 'above the crawl clamp');
  assert.equal(session.navTimeout({ env: { [NAV_ENV]: '5000' }, crawlLog: file }).ms, 5000, 'below the crawl clamp');
  assert.equal(session.resolveNavTimeoutMs({ env: { [NAV_ENV]: '7000' }, crawlLog: file, fallback: 90000 }), 7000);
}));
check('navTimeout: an empty env is unset (no warning); an invalid one falls through with ONE warning per process', () => withCrawlLog(({ dir, file, write }) => {
  write({ crawl: { navMs: { p95: 30000 } } });
  const quiet = captureStderr(() => {
    for (const v of ['', '   ', undefined]) assert.equal(session.navTimeout({ env: { [NAV_ENV]: v }, crawlLog: file }).source, 'crawl', JSON.stringify(v));
  });
  assert.deepEqual(quiet, [], 'no warning for an empty value');
  const warned = captureStderr(() => {
    assert.equal(session.navTimeout({ env: { [NAV_ENV]: 'abc' }, crawlLog: file }).ms, 60000, 'falls through to the crawl figure');
    for (const v of ['0', '-5', '0.3', 'Infinity', 'NaN', '12s']) {
      const t = session.navTimeout({ env: { [NAV_ENV]: v }, crawlLog: null, fallback: 45000 });
      assert.deepEqual([t.ms, t.source, t.detail], [45000, 'default', `no valid ${NAV_ENV} (${v} ignored) and no crawl.navMs.p95 in (no crawl log)`], v);
    }
    assert.equal(session.navTimeout({ env: { [NAV_ENV]: ' abc ' }, crawlLog: join(dir, 'absent.json') }).detail,
      `no valid ${NAV_ENV} (abc ignored) and no crawl.navMs.p95 in ${join(dir, 'absent.json')}`, 'the default detail says the env was set but invalid');
  });
  assert.deepEqual(warned, [`[live-session] ${NAV_ENV}=abc is not a positive number of ms — ignored`], 'one warning, naming the first bad value');
}));
check('navTimeout: the crawl figure is p95 × 2, rounded, clamped to 20000–180000; the detail names the p95 and the file', () => withCrawlLog(({ file, write }) => {
  for (const [p95, want] of [[4000, 20000], [10000, 20000], [12345.4, 24691], [30000, 60000], [90000, 180000], [120000, 180000]]) {
    write({ crawl: { navMs: { p50: 1, p95 } }, other: true });
    const t = session.navTimeout({ env: {}, crawlLog: file });
    assert.deepEqual([t.ms, t.source], [want, 'crawl'], `p95 ${p95}`);
    assert.ok(t.detail.includes(`p95 ${p95} ms`) && t.detail.includes(file), t.detail);
  }
}));
check('navTimeout: a missing / malformed crawl log or field falls back silently; the fallback option is honoured', () => withCrawlLog(({ dir, file, write }) => {
  const quiet = captureStderr(() => {
    const t = session.navTimeout({ env: {}, crawlLog: join(dir, 'absent.json') });
    assert.deepEqual([t.ms, t.source], [60000, 'default'], 'absent file → 60000');
    assert.match(t.detail, /^no STARDUST_NAV_TIMEOUT_MS and no crawl\.navMs\.p95 in .*absent\.json$/);
    for (const body of ['{"crawl": {', 'null', '[]', '{}', '{"crawl": {}}', '{"crawl": {"navMs": null}}', '{"crawl": {"navMs": {"p95": "4000"}}}', '{"crawl": {"navMs": {"p95": 0}}}', '{"crawl": {"navMs": {"p95": -1}}}']) {
      write(body);
      const d = session.navTimeout({ env: {}, crawlLog: file, fallback: 90000 });
      assert.deepEqual([d.ms, d.source], [90000, 'default'], body);
    }
    assert.equal(session.resolveNavTimeoutMs({ env: {}, crawlLog: file, fallback: 45000 }), 45000);
    assert.equal(session.navTimeout({ env: {}, crawlLog: null }).ms, 60000, 'no crawl log at all');
  });
  assert.deepEqual(quiet, [], 'a missing or malformed crawl log is skipped without a warning');
}));
check('navTimeout: the defaults read process.env and CRAWL_LOG relative to the cwd (the project root)', () => withCrawlLog(({ dir }) => {
  const cwd = process.cwd();
  const savedEnv = process.env[NAV_ENV];
  try {
    process.chdir(dir);
    delete process.env[NAV_ENV];
    assert.equal(session.navTimeout().source, 'default', 'no crawl log under the cwd yet');
    mkdirSync(join(dir, 'stardust', 'current'), { recursive: true });
    writeFileSync(join(dir, session.CRAWL_LOG), JSON.stringify({ crawl: { navMs: { p95: 30000 } } }));
    assert.deepEqual([session.navTimeout().ms, session.navTimeout().source], [60000, 'crawl']);
    assert.ok(session.navTimeout().detail.includes('stardust/current/_crawl-log.json'));
    process.env[NAV_ENV] = '4321';
    assert.equal(session.resolveNavTimeoutMs(), 4321);
  } finally {
    process.chdir(cwd);
    if (savedEnv === undefined) delete process.env[NAV_ENV]; else process.env[NAV_ENV] = savedEnv;
  }
}));
await checkAsync('gotoLive and measure-live visit take the navigation timeout per call (60000 / 90000 fallbacks); an explicit timeoutMs wins', async () => {
  const timeouts = [];
  const resp = { status: () => 200, headers: () => ({}), url: () => 'https://www.example.com/' };
  const page = {
    goto: async (u, o) => { timeouts.push(o.timeout); return resp; },
    waitForTimeout: async () => {},
    evaluate: async () => ({ h: 100, empty: 0, pending: 0 }),
  };
  const url = 'https://www.example.com/';
  const both = async () => {
    timeouts.length = 0;
    await session.gotoLive(page, url, { settleMs: 0 });
    await visit(page, url, { dismiss: false, settle: { passes: 1, quietMs: 0 } });
    return [...timeouts];
  };
  const dir = mkdtempSync(join(tmpdir(), 'live-session-goto-'));
  const cwd = process.cwd();
  try {
    process.chdir(dir); // no crawl log under this cwd
    assert.deepEqual(await withProcessEnv(undefined, both), [60000, 90000], 'each keeps its own default');
    assert.deepEqual(await withProcessEnv('4321', both), [4321, 4321], 'the env drives both');
    assert.deepEqual(await withProcessEnv('9876', both), [9876, 9876], 'evaluated per call, not at import');
    timeouts.length = 0;
    await withProcessEnv('4321', () => session.gotoLive(page, url, { settleMs: 0, timeoutMs: 1000 }));
    assert.deepEqual(timeouts, [1000], 'an explicit timeoutMs always wins');
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});

// Per-width deadlines (D1): withDeadline bounds a whole width read; isContextDestroyed picks the one retryable failure.
const later = (ms, fn) => new Promise((resolve) => { setTimeout(() => resolve(fn()), ms); });
const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

await checkAsync('withDeadline: a fast promise resolves (or rejects) as itself and its timer is cleared', async () => {
  const before = timers();
  assert.equal(await session.withDeadline(later(10, () => 7), 60000, 'measure @390'), 7);
  assert.equal(timers(), before, 'no deadline timer left running after the promise settled');
  await assert.rejects(session.withDeadline(Promise.reject(new Error('boom')), 60000), (e) => e.message === 'boom' && e.name === 'Error');
  assert.equal(timers(), before, 'cleared on a rejection too');
});
await checkAsync('withDeadline: a slow promise rejects with a DeadlineError naming the label and the ms', async () => {
  await assert.rejects(session.withDeadline(later(300, () => 'late'), 20, 'measure https://www.example.com/ @390'), (e) => {
    assert.equal(e.name, 'DeadlineError');
    assert.equal(e.message, 'measure https://www.example.com/ @390: deadline 20 ms exceeded');
    assert.ok(e instanceof Error);
    return true;
  });
  await assert.rejects(session.withDeadline(new Promise(() => {}), 5), { name: 'DeadlineError', message: 'step: deadline 5 ms exceeded' }, 'default label; a never-settling promise');
});
await checkAsync('withDeadline: the abandoned promise rejecting after the deadline is not an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const abandoned = new Promise((_, reject) => { setTimeout(() => reject(new Error('Execution context was destroyed')), 40); });
    await assert.rejects(session.withDeadline(abandoned, 5, 'read'), { name: 'DeadlineError' });
    await later(80, () => null);
    assert.deepEqual(unhandled.map((e) => e.message), []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});
await checkAsync('withDeadline: ms not a finite number > 0, or above setTimeout\'s 2^31 − 1 ms ceiling, returns the promise unchanged', async () => {
  const p = later(5, () => 1);
  for (const ms of [0, undefined, null, -5, NaN, Infinity, '5000', 2 ** 31, 3e9]) assert.equal(session.withDeadline(p, ms, 'x'), p, String(ms));
  const atCeiling = session.withDeadline(p, 2 ** 31 - 1, 'x');
  assert.notEqual(atCeiling, p, '2^31 − 1 ms is still a real deadline');
  assert.equal(await atCeiling, 1, 'a fast promise beats it, and its timer is cleared');
});
check('isContextDestroyed: the three playwright navigation-teardown messages — not a timeout, an HTTP error, a deadline or a bot challenge', () => {
  for (const msg of ['page.evaluate: Execution context was destroyed, most likely because of a navigation',
    'Protocol error (Runtime.callFunctionOn): Cannot find context with specified id',
    'frame.evaluate: Frame was detached', 'locator.boundingBox: Navigating frame was detached', 'elementHandle.evaluate: frame got detached']) {
    assert.equal(session.isContextDestroyed(new Error(msg)), true, msg);
  }
  const named = (name, message) => Object.assign(new Error(message), { name });
  for (const err of [named('TimeoutError', 'page.goto: Timeout 60000ms exceeded.'), named('LiveHTTPError', 'HTTP 503 at https://www.example.com/ — not a challenge marker, but not the page either; refusing to measure it'),
    named('BotChallengeError', 'bot challenge at https://www.example.com/: cf-mitigated: challenge — the live side served an edge interstitial, NOT the page'),
    named('BotChallengeError', 'bot challenge after the frame was detached'), named('DeadlineError', 'read Execution context was destroyed: deadline 5 ms exceeded'),
    new Error('net::ERR_CONNECTION_RESET'), null, undefined]) {
    assert.equal(session.isContextDestroyed(err), false, err ? `${err.name}: ${err.message}` : String(err));
  }
});

// Evidence freshness (D5): the run anchor from the ledger, the same-run default, the opt-in max age and the
// canonical side cache every source-side reuse goes through. Pure except the temp-dir cache files.
const T0 = '2026-10-15T10:00:00.000Z'; // the run anchor used below
const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString();
const H = 3600e3;
const line = (skill, phase, event, ts) => JSON.stringify({ ts, skill, phase, event });
const OPT_IN = 'no run anchor in stardust/status.jsonl (cross-run reuse is opt-in: --origin-max-age / STARDUST_ORIGIN_MAX_AGE_H)';

check('freshness: the exported surface (run anchor, policy, side cache)', () => {
  for (const name of ['RUN_OPENERS', 'LEDGER', 'runStartAt', 'maxAgeHours', 'freshness', 'isFreshCapture', 'reuseRecord', 'readSideCache', 'writeSideCache']) assert.ok(name in session, `${name} exported`);
  assert.deepEqual(session.RUN_OPENERS, [['stardust:rollout', 'A-inventory'], ['stardust:replica', 'extract']]);
  assert.equal(session.LEDGER, 'stardust/status.jsonl');
});
check('runStartAt: the LAST opener start wins; end lines, other phases and malformed lines are ignored; a bad-ts opener drops the anchor', () => {
  const a = '2026-10-15T08:00:00.000Z'; const b = '2026-10-15T09:00:00.000Z'; const c = '2026-10-15T11:00:00.000Z';
  const base = [line('stardust:replica', 'extract', 'start', a), line('stardust:rollout', 'A-inventory', 'start', b)];
  assert.equal(session.runStartAt({ text: base.join('\n') }), b, 'rollout A-inventory after replica extract');
  const ignored = [...base, '{not json', line('stardust:rollout', 'A-inventory', 'end', c), line('stardust:rollout', 'C-deliver', 'start', c), line('stardust:replica', 'verify', 'start', c), JSON.stringify({ skill: 'stardust:replica', phase: 'verify', event: 'start', ts: 'not a time' })];
  assert.equal(session.runStartAt({ text: ignored.join('\n') }), b, 'end / other phases / malformed ignored');
  const later = [...ignored, JSON.stringify({ skill: 'stardust:replica', phase: 'extract', event: 'start', ts: 'not a time' })];
  assert.equal(session.runStartAt({ text: later.join('\n') }), null, 'an opener with an unparseable ts drops the anchor — never the previous run\'s');
  assert.equal(session.runStartAt({ text: [...base, JSON.stringify({ skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' })].join('\n') }), null, 'an opener without a ts drops the anchor too');
  assert.equal(session.runStartAt({ text: [...later, line('replica', 'extract', 'start', c)].join('\n') }), c, 'a later extract wins (skill without the stardust: prefix)');
  assert.equal(session.runStartAt({ text: line('stardust:rollout', 'a-inventory', 'start', c) }), null, 'phase compared exactly');
  assert.equal(session.runStartAt({ text: '' }), null);
});
check('runStartAt: reads the ledger file; an absent file is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-ledger-'));
  try {
    assert.equal(session.runStartAt({ ledger: join(dir, 'status.jsonl') }), null);
    writeFileSync(join(dir, 'status.jsonl'), `${line('stardust:replica', 'extract', 'start', T0)}\n`);
    assert.equal(session.runStartAt({ ledger: join(dir, 'status.jsonl') }), T0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
check('maxAgeHours: a finite number > 0, else null', () => {
  for (const [v, want] of [['6', 6], [6, 6], ['1.5', 1.5], ['0', null], [0, null], ['', null], [null, null], ['-2', null], ['abc', null], ['NaN', null], ['Infinity', null]]) assert.equal(session.maxAgeHours(v), want, JSON.stringify(v));
  const saved = process.env.STARDUST_ORIGIN_MAX_AGE_H;
  try {
    process.env.STARDUST_ORIGIN_MAX_AGE_H = '3';
    assert.equal(session.maxAgeHours(), 3, 'the env is the default');
    delete process.env.STARDUST_ORIGIN_MAX_AGE_H;
    assert.equal(session.maxAgeHours(), null, 'no env → off');
  } finally { if (saved === undefined) delete process.env.STARDUST_ORIGIN_MAX_AGE_H; else process.env.STARDUST_ORIGIN_MAX_AGE_H = saved; }
});
check('freshness: same run by default, cross-run only with a max age, never a future or missing time', () => {
  const now = ms(T0) + 3 * H;
  const f = (at, o = {}) => session.freshness(at === undefined ? {} : { at }, { runStart: T0, maxAgeH: null, now, ...o });
  assert.deepEqual(f(T0), { fresh: true, policy: 'same-run', reason: null, runStart: T0 }, 'at === runStart');
  const before = f(iso(ms(T0) - 1000));
  assert.equal(before.fresh, false);
  assert.equal(before.reason, `captured before this run (${T0})`);
  assert.deepEqual(f(iso(now - 2 * H), { runStart: null }), { fresh: false, policy: null, reason: OPT_IN, runStart: null }, 'no anchor, no max age');
  assert.deepEqual(f(iso(now - 2 * H), { runStart: null, maxAgeH: 6 }), { fresh: true, policy: 'max-age 6h', reason: null, runStart: null }, 'no anchor + max age 6, 2 h old');
  const old = f(iso(now - 7 * H), { runStart: null, maxAgeH: 6 });
  assert.equal(old.fresh, false, '7 h old');
  assert.ok(old.reason.startsWith(OPT_IN) && old.reason.endsWith('older than max-age 6h'), old.reason);
  assert.equal(f(iso(now - 7 * H), { maxAgeH: 6 }).reason, `captured before this run (${T0}); older than max-age 6h`);
  assert.equal(f(iso(now + 10 * 60e3)).reason, 'capture time in the future');
  assert.equal(f(iso(now + 60e3)).fresh, true, 'a minute of clock skew is tolerated');
  assert.equal(f(undefined).reason, 'no capture time');
  assert.equal(f('garbage').reason, 'no capture time');
  assert.equal(session.freshness(null, { runStart: T0, maxAgeH: null, now }).reason, 'no capture time');
  assert.equal(f(iso(ms(T0) + H), { maxAgeH: 6 }).policy, 'same-run', 'same-run wins over max-age');
});
check('freshness: undefined runStart / maxAgeH read the ledger / the env; isFreshCapture and reuseRecord', () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-fresh-'));
  const saved = process.env.STARDUST_ORIGIN_MAX_AGE_H;
  try {
    const ledger = join(dir, 'status.jsonl');
    writeFileSync(ledger, `${line('stardust:rollout', 'A-inventory', 'start', T0)}\n`);
    delete process.env.STARDUST_ORIGIN_MAX_AGE_H;
    const now = ms(T0) + H;
    const v = session.freshness({ at: iso(ms(T0) + 60e3) }, { ledger, now });
    assert.deepEqual([v.fresh, v.policy, v.runStart], [true, 'same-run', T0]);
    assert.equal(session.isFreshCapture({ at: iso(ms(T0) - 60e3) }, { ledger, now }), false);
    process.env.STARDUST_ORIGIN_MAX_AGE_H = '2';
    assert.equal(session.freshness({ at: iso(ms(T0) - 60e3) }, { ledger, now }).policy, 'max-age 2h', 'env opt-in');
    assert.deepEqual(session.reuseRecord('gates/home-1440/live.png', { at: T0, url: 'x' }, v), { reused: true, from: 'gates/home-1440/live.png', at: T0, policy: 'same-run' });
  } finally {
    if (saved === undefined) delete process.env.STARDUST_ORIGIN_MAX_AGE_H; else process.env.STARDUST_ORIGIN_MAX_AGE_H = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
check('side cache: write → hit; one key field changed → miss naming it; key order-insensitive; stale; corrupt; absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-cache-'));
  try {
    const file = join(dir, 'gates', 'home-1440', 'content-live.json');
    const key = { url: 'https://www.example.com/', width: 1440, main: 'main', dismiss: ['#a', '#b'] };
    const data = { items: [{ text: 'Hello', y: 10 }] };
    const at = iso(ms(T0) + 60e3);
    const opts = { runStart: T0, maxAgeH: null, now: ms(T0) + H };
    assert.deepEqual(session.readSideCache(file, key, opts), { hit: false, reason: 'absent' });
    assert.equal(session.writeSideCache(file, key, data, { at, writtenBy: 'content-diff' }), file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { key, at, writtenBy: 'content-diff', data });
    assert.deepEqual(readdirSync(join(dir, 'gates', 'home-1440')), ['content-live.json'], 'no tmp file left behind');
    assert.deepEqual(session.readSideCache(file, key, opts), { hit: true, data, at, policy: 'same-run', file });
    assert.deepEqual(session.readSideCache(file, { ...key, width: 390 }, opts), { hit: false, reason: 'key mismatch (width)' });
    assert.deepEqual(session.readSideCache(file, { ...key, dismiss: ['#b', '#a'] }, opts), { hit: false, reason: 'key mismatch (dismiss)' }, 'arrays keep their order');
    assert.equal(session.readSideCache(file, { ...key, profile: 'p' }, opts).reason, 'key mismatch (profile)');
    assert.equal(session.readSideCache(file, { dismiss: ['#a', '#b'], main: 'main', width: 1440, url: 'https://www.example.com/' }, opts).hit, true, 'insertion order does not matter');
    assert.deepEqual(session.readSideCache(file, key, { ...opts, runStart: iso(ms(T0) + 2 * 60e3) }), { hit: false, reason: `captured before this run (${iso(ms(T0) + 2 * 60e3)})` });
    writeFileSync(file, '{"key": {');
    const bad = session.readSideCache(file, key, opts);
    assert.equal(bad.hit, false);
    assert.match(bad.reason, /^unreadable \(.+\)$/);
    assert.ok(existsSync(file));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the hide vocabulary: --hide lists, presence.json `hide` ("*" then the slug), records and their text ----------
check('hide: the exported surface', () => {
  for (const name of ['parseHideList', 'presenceHide', 'mergePresence', 'readPresenceFile', 'hideEntries', 'hideRegions', 'formatHidden']) assert.equal(typeof session[name], 'function', `${name} exported`);
});
check('parseHideList: comma lists and arrays, repeatable, trimmed, empties dropped, de-duplicated in order', () => {
  assert.deepEqual(session.parseHideList('.geo-bar, .location-bar', ' .promo ,, ', ['.news', '.geo-bar, .x'], '.location-bar'), ['.geo-bar', '.location-bar', '.promo', '.news', '.x']);
  assert.deepEqual(session.parseHideList([['.a'], ['.b, .a']]), ['.a', '.b'], 'nested arrays');
  assert.deepEqual(session.parseHideList(), []);
  assert.deepEqual(session.parseHideList(undefined, null, '', ' , ', [], 5, {}), [], 'empty and non-string values hide nothing');
});
check('presenceHide: "*" then the slug, comma-list entries, de-duplicated; main / variable and "*".variable ignored', () => {
  const json = {
    '*': { hide: ['.geo-bar'], main: 'main', variable: ['.star-var'] },
    home: { main: 'main', variable: ['.promo=.build-promo'], hide: ['.cookie-strip, .geo-bar', '.location-bar'] },
    plain: { main: 'main', variable: ['.promo'] },
  };
  assert.deepEqual(session.presenceHide(json, 'home'), ['.geo-bar', '.cookie-strip', '.location-bar']);
  assert.deepEqual(session.presenceHide(json, 'plain'), ['.geo-bar'], 'a slug without hide gets "*" only');
  assert.deepEqual(session.presenceHide(json, 'absent'), ['.geo-bar'], 'a slug absent from the file gets "*" only');
  assert.deepEqual(session.presenceHide({ home: { hide: ['.a', '.b,.a'] } }, 'home'), ['.a', '.b'], 'no "*"');
  assert.deepEqual(session.presenceHide({ home: { hide: '.a, .b' } }, 'home'), ['.a', '.b'], 'a string entry is a comma list');
  assert.deepEqual(session.presenceHide({ '*': { main: 'main', variable: ['.v'] }, home: { main: 'main', variable: ['.v'] } }, 'home'), [], 'main / variable are no hide lists');
  for (const j of [null, undefined, {}, [], 'x']) assert.deepEqual(session.presenceHide(j, 'home'), [], JSON.stringify(j));
});
check('readPresenceFile: variable halves (joined entries, first "="), hide with "*", notes; missing file; malformed throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-presence-'));
  try {
    const file = join(dir, 'presence.json');
    writeFileSync(file, JSON.stringify({
      '*': { hide: ['.geo-bar'], variable: ['.star-var'] },
      home: { main: 'main=#main', variable: ['.promo=.build-promo, .hero', ' .news = .build-news ', '.slot=[data-slot="a"]'], hide: ['.location-bar, .geo-bar'] },
    }));
    // site: null — the gate file alone, whatever presence.json the cwd's project carries
    const r = session.readPresenceFile(file, 'home', { site: null });
    assert.deepEqual(r.variable, [{ live: '.promo', build: '.build-promo' }, { live: '.hero', build: '.hero' }, { live: '.news', build: '.build-news' }, { live: '.slot', build: '[data-slot="a"]' }]);
    assert.deepEqual([r.file, r.slug, r.found, r.hide], [file, 'home', true, ['.geo-bar', '.location-bar']]);
    assert.equal(r.note, `${file} → home: 4 variable region(s), 2 hide selector(s)`);
    const star = session.readPresenceFile(file, 'about', { site: null });
    assert.deepEqual([star.found, star.variable, star.hide], [true, [], ['.geo-bar']], '"*".variable is not read');
    assert.equal(star.note, `${file} → about: 0 variable region(s), 1 hide selector(s)`);
    const old = join(dir, 'old.json');
    writeFileSync(old, JSON.stringify({ home: { variable: '.promo' } }));
    assert.equal(session.readPresenceFile(old, 'home', { site: null }).note, `${old} → home: 1 variable region(s)`, 'without hide the note keeps its old form');
    assert.equal(session.readPresenceFile(old, 'about', { site: null }).note, `${old} has no variable regions for about — nothing hidden`);
    const gone = join(dir, 'absent.json');
    assert.deepEqual(session.readPresenceFile(gone, 'home', { site: null }), { file: gone, slug: 'home', found: false, variable: [], hide: [], note: `${gone} not found — nothing hidden` });
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"home": {');
    assert.throws(() => session.readPresenceFile(bad, 'home', { site: null }), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`) && e.message.endsWith(')'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
check('mergePresence: per key and field the gate dir wins; keys and fields only one file has are kept; missing = {}', () => {
  assert.equal(session.SITE_PRESENCE, 'stardust/replica/presence.json');
  const site = { '*': { hide: ['.geo-bar'], reasons: { '.geo-bar': 'R-01' } }, home: { main: 'main', variable: ['.site-var'] }, about: { hide: ['.about-bar'] } };
  const gate = { '*': { hide: ['.promo'] }, home: { hide: ['.cookie'], main: '#main' }, contact: { main: '#c' } };
  const before = JSON.stringify([site, gate]);
  const merged = session.mergePresence(site, gate);
  assert.deepEqual(merged, {
    '*': { hide: ['.promo'], reasons: { '.geo-bar': 'R-01' } },
    home: { main: '#main', variable: ['.site-var'], hide: ['.cookie'] },
    about: { hide: ['.about-bar'] },
    contact: { main: '#c' },
  });
  assert.deepEqual(Object.keys(merged), ['*', 'home', 'about', 'contact'], 'site keys first, then the gate-only ones');
  assert.equal(JSON.stringify([site, gate]), before, 'the inputs are untouched');
  assert.deepEqual(session.mergePresence(site, null), site); assert.deepEqual(session.mergePresence(undefined, gate), gate);
  for (const [s, g] of [[null, undefined], [{}, {}], ['x', 5]]) assert.deepEqual(session.mergePresence(s, g), {});
  assert.deepEqual(session.presenceHide(merged, 'home'), ['.promo', '.cookie'], 'presenceHide reads the merged object');
});
check('readPresenceFile + the site file: merged under the gate file, found when either exists, sources named; none → as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-session-site-'));
  const cwd = process.cwd();
  try {
    const site = join(dir, 'site.json'); const file = join(dir, 'presence.json'); const gone = join(dir, 'absent.json');
    writeFileSync(site, JSON.stringify({ '*': { hide: ['.geo-bar'] }, home: { variable: ['.site-promo'], hide: ['.site-strip'] } }));
    writeFileSync(file, JSON.stringify({ home: { main: 'main', hide: ['.cookie-strip', '.geo-bar'] } }));
    const r = session.readPresenceFile(file, 'home', { site });
    assert.deepEqual([r.file, r.slug, r.found, r.site, r.hide], [file, 'home', true, site, ['.geo-bar', '.cookie-strip']]);
    assert.deepEqual(r.hideSources, [{ sel: '.geo-bar', source: 'site presence.json' }, { sel: '.cookie-strip', source: 'presence.json' }], 'the gate\'s home.hide replaced the site\'s; "*" came from the site');
    assert.deepEqual([r.variable, r.variableSource], [[{ live: '.site-promo', build: '.site-promo' }], 'site presence.json'], 'a site-only field is kept');
    assert.equal(r.note, `${file} over ${site} → home: 1 variable region(s), 2 hide selector(s)`);
    const alone = session.readPresenceFile(gone, 'about', { site });
    assert.deepEqual([alone.file, alone.found, alone.hide, alone.hideSources, alone.variableSource], [gone, true, ['.geo-bar'], [{ sel: '.geo-bar', source: 'site presence.json' }], null]);
    assert.equal(alone.note, `${site} (${gone} not found) → about: 0 variable region(s), 1 hide selector(s)`);
    const star = session.readPresenceFile(null, null, { site });
    assert.deepEqual([star.found, star.hide, star.variable], [true, ['.geo-bar'], []], 'no slug: "*" only');
    assert.equal(star.note, `${site} → "*": 0 variable region(s), 1 hide selector(s)`);
    const same = session.readPresenceFile(site, 'home', { site });
    assert.deepEqual(same.hideSources, [{ sel: '.geo-bar', source: 'site presence.json' }, { sel: '.site-strip', source: 'site presence.json' }], 'the site file passed as the gate file is read once, as the site file');
    assert.equal(same.note, `${site} → home: 1 variable region(s), 2 hide selector(s)`);
    const plain = { file, slug: 'home', found: true, variable: [], hide: ['.cookie-strip', '.geo-bar'], note: `${file} → home: 0 variable region(s), 2 hide selector(s)` };
    assert.deepEqual(session.readPresenceFile(file, 'home', { site: null }), plain, 'site: null — no merge');
    assert.deepEqual(session.readPresenceFile(file, 'home', { site: join(dir, 'no-site.json') }), plain, 'no site file — the gate file alone');
    assert.deepEqual(session.readPresenceFile(gone, 'home', { site: join(dir, 'no-site.json') }), { file: gone, slug: 'home', found: false, variable: [], hide: [], note: `${gone} not found — nothing hidden` });
    const bad = join(dir, 'bad-site.json');
    writeFileSync(bad, '{"*": {');
    for (const f of [file, null]) assert.throws(() => session.readPresenceFile(f, 'home', { site: bad }), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`) && e.message.endsWith(')'));
    // the default site path is cwd-relative: picked up when the project has one, the old result when it has none
    process.chdir(dir);
    assert.deepEqual(session.readPresenceFile(file, 'home'), plain, 'no stardust/replica/presence.json in the project');
    mkdirSync(join(dir, 'stardust', 'replica'), { recursive: true });
    writeFileSync(join(dir, session.SITE_PRESENCE), JSON.stringify({ '*': { hide: ['.location-bar'] } }));
    const d = session.readPresenceFile(file, 'home');
    assert.deepEqual([d.site, d.hide, d.hideSources[0]], [session.SITE_PRESENCE, ['.location-bar', '.cookie-strip', '.geo-bar'], { sel: '.location-bar', source: 'site presence.json' }]);
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});
check('hideEntries: strings are comma lists tagged with the source, objects keep theirs, the first entry of a selector wins', () => {
  assert.deepEqual(session.hideEntries(['.a, .b', '.a'], 'presence.json'), [{ sel: '.a', source: 'presence.json' }, { sel: '.b', source: 'presence.json' }]);
  assert.deepEqual(session.hideEntries([{ sel: '.geo-bar', source: 'presence.json' }, '.geo-bar, .x', { sel: ' .y ' }, { sel: '' }]), [{ sel: '.geo-bar', source: 'presence.json' }, { sel: '.x', source: '--hide' }, { sel: '.y', source: '--hide' }]);
  assert.deepEqual(session.hideEntries('.a', '--hide'), [{ sel: '.a', source: '--hide' }], 'a bare string');
  for (const v of [[], null, undefined, '']) assert.deepEqual(session.hideEntries(v, '--hide'), []);
});
check('formatHidden: ×n (hpx), ×0, error, joined with "; ", empty → ""', () => {
  assert.equal(session.formatHidden([{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }]), '.geo-bar ×1 (88px) [--hide]');
  assert.equal(session.formatHidden([{ sel: '.late', source: 'presence.json', n: 0, h: 0 }]), '.late ×0 [presence.json]');
  assert.equal(session.formatHidden([{ sel: 'div[[', source: '--hide', n: 0, h: 0, error: 'not a valid selector' }]), 'div[[ error: not a valid selector [--hide]');
  assert.equal(session.formatHidden([{ sel: '.a', source: '--hide', n: 2, h: 120 }, { sel: '.b', source: 'presence.json', n: 0, h: 0 }]), '.a ×2 (120px) [--hide]; .b ×0 [presence.json]');
  for (const v of [[], null, undefined]) assert.equal(session.formatHidden(v), '');
});
check('formatCandidates: <selector> (<tag>, <h>px) joined "; ", a 0-px block reads "0px now — …", none → "none found above the header"', () => {
  const bar = { tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, height: 88, selector: 'section.bar__wrapper' };
  assert.equal(session.formatCandidates([bar]), 'section.bar__wrapper (section, 88px)');
  assert.equal(session.formatCandidates([{ ...bar, height: 0 }, { tag: 'div', id: 'promo', classes: [], top: 0, height: 40, selector: '#promo' }]),
    'section.bar__wrapper (section, 0px now — a block that grows later is still hidden by the persistent display:none !important rule); #promo (div, 40px)');
  for (const v of [[], null, undefined]) assert.equal(session.formatCandidates(v), 'none found above the header');
});
check('hideMisses: n 0 at the hide pass AND nAtCapture 0 — a block counted at the capture, one matched at the hide pass, an error, a record not recounted are no miss', () => {
  const recs = [
    { sel: '.geo-bar', source: 'presence.json', n: 0, h: 0, nAtCapture: 0 },
    { sel: '.late-bar', source: '--hide', n: 0, h: 0, nAtCapture: 1 },
    { sel: '.promo', source: '--hide', n: 1, h: 40, nAtCapture: 0 },
    { sel: 'div[[', source: '--hide', n: 0, h: 0, error: 'not a valid selector', nAtCapture: 0 },
    { sel: '.not-recounted', source: '--hide', n: 0, h: 0 },
    { sel: '.strip', source: 'site presence.json', n: 0, h: 0, nAtCapture: 0 },
  ];
  assert.deepEqual(session.hideMisses(recs), ['.geo-bar', '.strip']);
  for (const v of [[], null, undefined]) assert.deepEqual(session.hideMisses(v), []);
});
check('hideMissLine: ONE line — the candidates, then the missed selectors; no miss → ""', () => {
  const list = [{ tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, height: 88, selector: 'section.bar__wrapper' }];
  assert.equal(session.hideMissLine(['.geo-bar', '.strip'], list), 'hide matched nothing on live — candidates: section.bar__wrapper (section, 88px) (.geo-bar, .strip)');
  assert.equal(session.hideMissLine(['.geo-bar'], []), 'hide matched nothing on live — candidates: none found above the header (.geo-bar)');
  assert.equal(session.hideMissLine(['.geo-bar\n'], list).split('\n').length, 1, 'never more than one line');
  for (const v of [[], null, undefined]) assert.equal(session.hideMissLine(v, list), '');
});
await checkAsync('recountHides without a browser: [] → [] with no page work; one evaluate with the selectors → the records with nAtCapture, inputs untouched', async () => {
  const untouched = new Proxy({}, { get: (_, k) => { throw new Error(`page.${String(k)} touched`); } });
  for (const v of [[], null, undefined]) assert.deepEqual(await session.recountHides(untouched, v), []);
  const calls = [];
  const page = { evaluate: async (fn, arg) => { calls.push(arg); return [1, 0]; } };
  const recs = [{ sel: '.late', source: 'presence.json', n: 0, h: 0 }, { sel: 'div[[', source: '--hide', n: 0, h: 0, error: 'not a valid selector' }];
  assert.deepEqual(await session.recountHides(page, recs), [{ ...recs[0], nAtCapture: 1 }, { ...recs[1], nAtCapture: 0 }]);
  assert.deepEqual(calls, [['.late', 'div[[']]);
  assert.equal(recs[0].nAtCapture, undefined, 'the input records are untouched');
});
await checkAsync('hideRegions without a browser: [] → [] with no page work; one evaluate with the normalised list and settleMs', async () => {
  const untouched = new Proxy({}, { get: (_, k) => { throw new Error(`page.${String(k)} touched`); } });
  for (const v of [[], null, undefined, ['', ' , ']]) assert.deepEqual(await session.hideRegions(untouched, v), []);
  const calls = [];
  const page = { evaluate: async (fn, arg) => { calls.push({ fn, arg }); return ['records']; } };
  assert.deepEqual(await session.hideRegions(page, ['.a, .b', { sel: '.c', source: 'presence.json' }]), ['records']);
  assert.deepEqual(calls[0].arg, { list: [{ sel: '.a', source: '--hide' }, { sel: '.b', source: '--hide' }, { sel: '.c', source: 'presence.json' }], settleMs: 250 });
  assert.match(String(calls[0].fn), /data-stardust-hide/);
  await session.hideRegions(page, '.a', { settleMs: 40 });
  assert.equal(calls[1].arg.settleMs, 40);
});
await checkAsync('detectOverlayLeft without a browser: one evaluate with the consent roots and the coverage; an evaluate error is never a clean capture', async () => {
  const calls = [];
  assert.equal(await session.detectOverlayLeft({ evaluate: async (fn, arg) => { calls.push({ fn, arg }); return null; } }), null);
  assert.deepEqual(calls.map((c) => [c.fn, c.arg]), [[session.detectOverlayLeftInPage, { roots: session.CONSENT_ROOTS, coverage: session.OVERLAY_COVERAGE }]]);
  const failedCheck = await session.detectOverlayLeft({ evaluate: async () => { throw new Error('Execution context was destroyed\n    at a navigation'); } });
  assert.equal(failedCheck, '(overlay check failed: Execution context was destroyed)');
});

// ---- hideRegions end-to-end (only where playwright is importable — a project copy) --------------------------------
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; }
if (!chromium) { console.log('skip  end-to-end (playwright not importable here)'); }
else {
  const css = 'body{margin:0;font:16px/20px sans-serif} .geo-bar{height:88px;background:#eee} header{height:60px;background:#333;color:#fff}';
  const head = `<!doctype html><html><head><style>${css}</style>`;
  // a geo script re-rendering its bar after the hide pass: inserted 400 ms after load, display set inline
  const lateBar = '<script>addEventListener(\'load\', () => setTimeout(() => { const d = document.createElement(\'div\'); d.className = \'geo-bar\'; d.style.display = \'block\'; d.textContent = \'Use the site for your region?\'; document.body.prepend(d); }, 400));</script>';
  const NONCE = 'fixture-nonce';
  const PAGES = {
    '/bar': `${head}</head><body><div class="geo-bar">Use the site for your region?</div><header>Header</header><main><p>Content</p></main></body></html>`,
    '/late': `${head}${lateBar}</head><body><header>Header</header><main><p>Content</p></main></body></html>`,
    // served with a CSP that blocks inline <style> without the nonce — the page's own styles carry it, the injected tag cannot
    '/csp': `<!doctype html><html><head><style nonce="${NONCE}">${css}</style>${lateBar}</head><body><header>Header</header><main><p>Content</p></main></body></html>`,
  };
  // consent fixtures: each vendor's banner with its own accept button, a plain-labelled banner with "Decline" before
  // the accept label, a label two shadow roots deep under a fixed host, and an in-content "Accept" link (no overlay)
  const doc = (body) => `<!doctype html><html><head><style>body{margin:0;font:16px/20px sans-serif}</style></head><body><header>Header</header>${body}</body></html>`;
  const BANNER = 'position:fixed;left:0;right:0;bottom:0;padding:16px;background:#fff;z-index:1000';
  // page content under the viewport centre, as on a real page (an overlay paints over it)
  const MAIN = '<main style="min-height:1800px"><p>Content</p></main>';
  // the privacy trigger a consent manager keeps in its shadow root after consent: 48×48, fixed, not a banner
  const UC_TRIGGER = '<button data-testid="uc-privacy-button" style="position:fixed;left:16px;top:120px;width:48px;height:48px;z-index:1001">⚙</button>';
  Object.assign(PAGES, {
    '/consent/cookiebot': doc(`${MAIN}<div id="CybotCookiebotDialog" style="${BANNER}"><p>This site uses cookies.</p><button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Allow all</button></div>
      <script>document.getElementById('CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').onclick = () => { document.getElementById('CybotCookiebotDialog').style.display = 'none'; };</script>`),
    '/consent/usercentrics': doc(`${MAIN}<div id="usercentrics-root"></div>
      <script>const r = document.getElementById('usercentrics-root').attachShadow({ mode: 'open' }); r.innerHTML = '<div id="uc-banner" style="${BANNER}"><p>We use cookies.</p><button data-testid="uc-accept-all-button">Accept All</button></div>${UC_TRIGGER}'; r.querySelector('button').onclick = () => r.getElementById('uc-banner').remove();</script>`),
    '/consent/trustarc': doc(`${MAIN}<div id="truste-consent-track" style="${BANNER}"><button class="truste-button2">Agree and proceed</button></div>
      <script>document.querySelector('.truste-button2').onclick = () => document.getElementById('truste-consent-track').remove();</script>`),
    '/consent/didomi': doc(`${MAIN}<div id="didomi-notice" style="${BANNER}"><button id="didomi-notice-agree-button">Agree and close</button></div>
      <script>document.getElementById('didomi-notice-agree-button').onclick = () => document.getElementById('didomi-notice').remove();</script>`),
    '/consent/label': doc(`${MAIN}<div class="hinweis" style="${BANNER}"><p>Wir verwenden Cookies.</p><button id="no">Decline</button> <button id="yes">Alle akzeptieren</button></div>
      <script>document.getElementById('no').onclick = () => { window.declined = true; }; document.getElementById('yes').onclick = () => { document.querySelector('.hinweis').style.display = 'none'; };</script>`),
    '/consent/shadow-label': doc(`${MAIN}<consent-shell style="${BANNER};display:block"></consent-shell>
      <script>const outer = document.querySelector('consent-shell').attachShadow({ mode: 'open' }); outer.innerHTML = '<consent-panel></consent-panel>'; const inner = outer.querySelector('consent-panel').attachShadow({ mode: 'open' }); inner.innerHTML = '<span role="button" tabindex="0">Zustimmen</span>'; inner.querySelector('span').onclick = () => { document.querySelector('consent-shell').style.display = 'none'; };</script>`),
    '/consent/in-content': doc(`<main><p>Read the terms, then <a href="#" id="terms">Accept</a> them.</p></main>
      <script>document.getElementById('terms').onclick = (e) => { e.preventDefault(); window.termsClicked = true; };</script>`),
    // a sweep click must not leave the page: a sticky header's search submit is skipped; a consent form's submit in
    // a fixed banner still counts, so does a "#" link (a fragment is no navigation); a link that does navigate is named
    '/consent/sticky-search': doc(`<div class="site-header" style="position:sticky;top:0;background:#fff;z-index:10"><form action="/consent/results"><input name="q" value="shoes"> <button>OK</button></form></div>${MAIN}`),
    '/consent/form-accept': doc(`${MAIN}<div class="notice" style="${BANNER}"><form action="/consent/accepted" onsubmit="event.preventDefault(); this.closest('.notice').remove();"><p>We use cookies.</p><input type="submit" value="Accept"></form></div>`),
    '/consent/hash-link': doc(`${MAIN}<div class="notice" style="${BANNER}"><a href="#" id="ok">Accept</a></div>
      <script>document.getElementById('ok').onclick = () => { document.querySelector('.notice').style.display = 'none'; };</script>`),
    '/consent/nav-link': doc(`${MAIN}<div class="notice" style="${BANNER}"><a href="/consent/accepted">Accept</a></div>`),
    '/consent/accepted': doc(MAIN),
  });
  // overlay-left fixtures: what a capture would still show after the sweeps — and the look-alikes that are no overlay
  Object.assign(PAGES, {
    '/overlay/clean': doc(MAIN),
    '/overlay/onetrust': doc(`${MAIN}<div id="onetrust-banner-sdk" style="${BANNER}"><p>We use cookies.</p><button id="onetrust-pc-btn-handler">Cookie settings</button></div>`),
    '/overlay/usercentrics': doc(`${MAIN}<div id="usercentrics-root"></div>
      <script>document.getElementById('usercentrics-root').attachShadow({ mode: 'open' }).innerHTML = '<div style="${BANNER}"><p>Privacy settings</p><button data-testid="uc-more-button">More</button></div>${UC_TRIGGER}';</script>`),
    '/overlay/backdrop': doc(`${MAIN}<div class="backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500"></div>`),
    '/overlay/blur': doc(`${MAIN}<div id="scrim" style="position:fixed;inset:0;backdrop-filter:blur(4px);z-index:500"></div>`),
    '/overlay/body-lock': doc(`${MAIN}<style>body{overflow:hidden}</style>`),
    '/overlay/html-lock': doc(`${MAIN}<style>html{overflow:hidden}</style>`),
    '/overlay/toast': doc(`${MAIN}<div style="position:fixed;inset:0;pointer-events:none;z-index:900"><div style="position:absolute;right:16px;bottom:16px;width:240px;padding:12px;background:#333;color:#fff">Saved</div></div>`),
    '/overlay/below': doc(`${MAIN}<div class="page-bg" style="position:fixed;inset:0;z-index:-1;background:#def"></div>`),
    '/overlay/bar': doc(`${MAIN}<div class="promo-bar" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#222;color:#fff">Free shipping</div>`),
    // fixed / sticky full-viewport layers that paint over no content of the page: a sticky hero at the top (the next
    // sections start below it) and a fixed background under positioned content — and a pointer-events:none tint that does
    '/overlay/sticky-hero': doc('<section class="hero" style="position:sticky;top:0;height:100vh;background:#345;color:#fff"><h1>Hero</h1></section><section style="position:relative;height:900px;background:#fff">Next</section><section style="height:900px">More</section>'),
    '/overlay/fixed-bg': doc('<div class="bg" style="position:fixed;inset:0;background:#def;z-index:0"></div><main style="position:relative;z-index:1;min-height:1800px"><p>Content</p></main>'),
    '/overlay/tint': doc(`${MAIN}<div class="tint" style="position:fixed;inset:0;background:rgba(255,0,0,.2);pointer-events:none;z-index:50"></div>`),
    '/overlay/hidden-roots': doc(`${MAIN}<div id="onetrust-banner-sdk" style="${BANNER};display:none"><p>We use cookies.</p></div>
      <div style="opacity:0"><div id="didomi-popup" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"><p>Consent</p></div></div>`),
    // native <dialog>s: a showModal() country picker left open (its dark ::backdrop is a pseudo-element, the page beneath
    // inert, no scroll lock) — in the document and in an open shadow root; one with a "Close" button the marketing pass
    // closes; a small non-modal <dialog open> in the content
    '/overlay/modal-picker': doc(`<style>dialog::backdrop{background:rgba(0,0,0,.6)}</style>${MAIN}<dialog id="country-picker"><p>Choose your country</p><ul><li>Deutschland</li><li>France</li></ul></dialog>
      <script>document.getElementById('country-picker').showModal();</script>`),
    '/overlay/modal-shadow': doc(`${MAIN}<picker-host></picker-host>
      <script>const r = document.querySelector('picker-host').attachShadow({ mode: 'open' }); r.innerHTML = '<style>dialog::backdrop{background:rgba(0,0,0,.6)}</style><dialog class="region-picker sheet wide"><p>Choose your region</p></dialog>'; r.querySelector('dialog').showModal();</script>`),
    '/overlay/modal-close': doc(`${MAIN}<dialog class="signup"><p>Sign up, stay updated!</p><button id="close">Close</button></dialog>
      <script>const d = document.querySelector('dialog.signup'); d.showModal(); document.getElementById('close').onclick = () => d.close();</script>`),
    '/overlay/inline-dialog': doc(`<main style="min-height:1800px"><p>Content</p><dialog open class="note" style="position:static;margin:8px;width:240px">A note in the content</dialog></main>`),
  });
  // derived candidates: an empty (0 px) location-bar wrapper before the header that a geo lookup fills 600 ms after
  // load, a fixed banner and a script before it too; a header inside an app root; the three selector forms; no header
  const BAR_CSS = '<style>.bar{height:88px;background:#eee}</style>';
  const FILL = '<script>addEventListener(\'load\', () => setTimeout(() => { document.querySelector(\'.bar__wrapper\').innerHTML = \'<div class="bar">Use the site for your region?</div>\'; }, 600));</script>';
  Object.assign(PAGES, {
    '/derive/wrapper': `${head}${BAR_CSS}</head><body><div class="promo-banner" style="position:fixed;top:0;left:0;right:0;height:40px;background:#fc0;z-index:10">Sale</div>${FILL}<section class="bar__wrapper"></section><header>Header</header><main><p>Content</p></main></body></html>`,
    '/derive/root': `${head}${BAR_CSS}</head><body><div id="root"><div class="bar">Use the site for your region?</div><header>Header</header><main><p>Content</p></main></div></body></html>`,
    '/derive/forms': `${head}</head><body><div id="geo" style="height:20px"></div><div id="dup" class="strip one" style="height:10px"></div><div id="app"><div class="strip" style="height:10px"></div><div style="height:10px"></div><header>Header</header></div><main><p id="dup">Content</p></main></body></html>`,
    '/derive/none': `${head}${BAR_CSS}</head><body><div class="bar">Use the site for your region?</div><main><p>Content</p></main></body></html>`,
  });
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/csp') res.setHeader('content-security-policy', `style-src 'self' 'nonce-${NONCE}'`);
    res.end(PAGES[req.url] || PAGES['/bar']);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const open = async (path) => { const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await page.goto(`${base}${path}`, { waitUntil: 'load' }); return page; };
  const state = (page) => page.evaluate(() => {
    const bar = document.querySelector('.geo-bar'); const tags = document.querySelectorAll('style[data-stardust-hide]');
    return { headerTop: document.querySelector('header').getBoundingClientRect().top, bar: bar ? getComputedStyle(bar).display : null, tags: tags.length, rules: tags.length ? [...tags[0].sheet.cssRules].map((r) => r.cssText) : [] };
  });
  try {
    await checkAsync('e2e: an 88 px in-flow bar above <header> → ×1 (88px), the header moves to 0, one style tag with its rule', async () => {
      const page = await open('/bar');
      assert.equal((await state(page)).headerTop, 88, 'the bar pushes the header down before the hide');
      const rec = await session.hideRegions(page, ['.geo-bar']);
      assert.deepEqual(rec, [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }]);
      assert.deepEqual(await state(page), { headerTop: 0, bar: 'none', tags: 1, rules: ['.geo-bar { display: none !important; }'] });
      assert.equal(session.formatHidden(rec), '.geo-bar ×1 (88px) [--hide]');
      await page.close();
    });
    await checkAsync('e2e: a bar inserted 400 ms after the hide pass is hidden by the style rule (record ×0, header stays at 0)', async () => {
      const page = await open('/late');
      const rec = await session.hideRegions(page, [{ sel: '.geo-bar', source: 'presence.json' }]);
      assert.deepEqual(rec, [{ sel: '.geo-bar', source: 'presence.json', n: 0, h: 0 }], 'nothing to hide yet');
      await page.waitForTimeout(800);
      const s = await state(page);
      assert.equal(s.bar, 'none', 'the late bar is in the DOM and computes display: none over its inline display: block');
      assert.equal(s.headerTop, 0);
      await page.close();
    });
    await checkAsync('e2e: an invalid selector beside a valid one is an error record, the valid one still hides, no throw', async () => {
      const page = await open('/bar');
      const rec = await session.hideRegions(page, ['div[[', '.geo-bar /*', '.geo-bar']);
      assert.equal(rec[0].sel, 'div[['); assert.equal(rec[0].n, 0); assert.ok(rec[0].error, 'error recorded');
      assert.deepEqual([rec[1].n, /valid style rule/.test(rec[1].error)], [0, true], 'the query accepts an unterminated comment, a style sheet would not: an error, never a broken sheet');
      assert.deepEqual(rec[2], { sel: '.geo-bar', source: '--hide', n: 1, h: 88 });
      assert.deepEqual(await state(page), { headerTop: 0, bar: 'none', tags: 1, rules: ['.geo-bar { display: none !important; }'] });
      assert.match(session.formatHidden(rec), /^div\[\[ error: .+ \[--hide\]; \.geo-bar \/\* error: .+ \[--hide\]; \.geo-bar ×1 \(88px\) \[--hide\]$/);
      await page.close();
    });
    await checkAsync('e2e: hideRegions twice → still one style[data-stardust-hide], its rules the union', async () => {
      const page = await open('/bar');
      await session.hideRegions(page, ['.geo-bar']);
      const again = await session.hideRegions(page, ['.geo-bar', 'main p']);
      assert.deepEqual(again.map((x) => [x.sel, x.n]), [['.geo-bar', 1], ['main p', 1]]);
      const s = await state(page);
      assert.equal(s.tags, 1);
      assert.deepEqual(s.rules, ['.geo-bar { display: none !important; }', 'main p { display: none !important; }']);
      assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0, 'without a CSP the tag carries the rules alone');
      await page.close();
    });
    await checkAsync('e2e: a CSP blocking inline <style> → the rules ride ONE adopted sheet; a bar inserted 400 ms later is still hidden', async () => {
      const page = await open('/csp');
      assert.equal((await state(page)).headerTop, 0, 'the nonce-carrying page styles load (no bar yet)');
      const rec = await session.hideRegions(page, ['.geo-bar']);
      assert.deepEqual(rec, [{ sel: '.geo-bar', source: '--hide', n: 0, h: 0 }]);
      await session.hideRegions(page, ['.geo-bar', 'main p']);
      await page.waitForTimeout(800);
      const s = await page.evaluate(() => {
        const bar = document.querySelector('.geo-bar'); const tag = document.querySelector('style[data-stardust-hide]');
        const adopted = document.adoptedStyleSheets.filter((x) => [...x.cssRules].some((r) => /display: none !important/.test(r.cssText)));
        return { bar: bar ? getComputedStyle(bar).display : null, headerTop: document.querySelector('header').getBoundingClientRect().top, tagSheet: Boolean(tag && tag.sheet), adopted: adopted.map((x) => [...x.cssRules].map((r) => r.cssText)) };
      });
      assert.equal(s.tagSheet, false, 'the CSP left the injected tag without a sheet');
      assert.equal(s.bar, 'none', 'the late bar computes display: none');
      assert.equal(s.headerTop, 0);
      assert.deepEqual(s.adopted, [['.geo-bar { display: none !important; }', 'main p { display: none !important; }']], 'one adopted sheet, its rules the union');
      await page.close();
    });
    // derived candidates and the recount at the capture
    await checkAsync('e2e derive: an empty wrapper before the header is listed at 0px, at 88px once a lookup fills it; a fixed banner and a script are not', async () => {
      const page = await open('/derive/wrapper');
      const wrapper = { tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, selector: 'section.bar__wrapper' };
      const before = await session.inFlowRegionsAboveHeader(page);
      assert.deepEqual(before, [{ ...wrapper, height: 0 }]);
      assert.equal(session.formatCandidates(before), 'section.bar__wrapper (section, 0px now — a block that grows later is still hidden by the persistent display:none !important rule)');
      await page.waitForTimeout(1000);
      const after = await session.inFlowRegionsAboveHeader(page);
      assert.deepEqual(after, [{ ...wrapper, height: 88 }]);
      assert.equal(session.formatCandidates(after), 'section.bar__wrapper (section, 88px)');
      await page.close();
    });
    await checkAsync('e2e derive: the 0-px candidate hidden before the lookup fills it keeps the header at 0; the wrong selector is the miss the line names', async () => {
      const page = await open('/derive/wrapper');
      const rec = await session.hideRegions(page, ['.geo-bar', 'section.bar__wrapper']);
      assert.deepEqual(rec.map((x) => [x.sel, x.n, x.h]), [['.geo-bar', 0, 0], ['section.bar__wrapper', 1, 0]]);
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => document.querySelector('header').getBoundingClientRect().top), 0, 'the filled wrapper stays hidden');
      const at = await session.recountHides(page, rec);
      assert.deepEqual(at.map((x) => x.nAtCapture), [0, 1]);
      const misses = session.hideMisses(at);
      assert.deepEqual(misses, ['.geo-bar']);
      assert.equal(session.hideMissLine(misses, await session.inFlowRegionsAboveHeader(page)), 'hide matched nothing on live — candidates: none found above the header (.geo-bar)', 'a hidden block is no candidate');
      await page.close();
    });
    await checkAsync('e2e derive: body > div#root > [div.bar, header] → div.bar (88px)', async () => {
      const page = await open('/derive/root');
      assert.deepEqual(await session.inFlowRegionsAboveHeader(page), [{ tag: 'div', id: null, classes: ['bar'], top: 0, height: 88, selector: 'div.bar' }]);
      await page.close();
    });
    await checkAsync('e2e derive: selectors — #id when unique, the fewest classes matching one element, an :nth-of-type path from a unique id; in document order; no header → []', async () => {
      const page = await open('/derive/forms');
      const got = await session.inFlowRegionsAboveHeader(page);
      assert.deepEqual(got.map((x) => [x.selector, x.top, x.height]), [['#geo', 0, 20], ['div.one', 20, 10], ['#app > div:nth-of-type(1)', 30, 10], ['#app > div:nth-of-type(2)', 40, 10]]);
      assert.deepEqual(got[1], { tag: 'div', id: 'dup', classes: ['strip', 'one'], top: 20, height: 10, selector: 'div.one' });
      assert.deepEqual(await page.evaluate((sels) => sels.map((s) => document.querySelectorAll(s).length), got.map((x) => x.selector)), [1, 1, 1, 1]);
      await page.close();
      const none = await open('/derive/none');
      assert.deepEqual(await session.inFlowRegionsAboveHeader(none), []);
      await none.close();
    });
    await checkAsync('e2e recount: a bar injected after hideRegions is counted at the capture (and computes display: none); a selector matching nothing is the miss', async () => {
      const page = await open('/late');
      const rec = await session.hideRegions(page, ['.geo-bar', '.location-bar']);
      assert.deepEqual(rec.map((x) => x.n), [0, 0], 'nothing to hide yet');
      await page.waitForTimeout(800);
      const at = await session.recountHides(page, rec);
      assert.deepEqual(at, [{ sel: '.geo-bar', source: '--hide', n: 0, h: 0, nAtCapture: 1 }, { sel: '.location-bar', source: '--hide', n: 0, h: 0, nAtCapture: 0 }]);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.geo-bar')).display), 'none');
      assert.deepEqual(session.hideMisses(at), ['.location-bar']);
      await page.close();
    });
    // consent: dismissOverlays → the vendor's own accept button, else the label sweep (by label priority, guarded to
    // overlay containers, open shadow roots included); `gone` runs in the page after the sweep
    const CONSENT = [
      ['/consent/cookiebot', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', () => getComputedStyle(document.getElementById('CybotCookiebotDialog')).display === 'none'],
      ['/consent/usercentrics', '#usercentrics-root [data-testid="uc-accept-all-button"]', () => !document.getElementById('usercentrics-root').shadowRoot.getElementById('uc-banner')],
      ['/consent/trustarc', '.truste-button2', () => !document.getElementById('truste-consent-track')],
      ['/consent/didomi', '#didomi-notice-agree-button', () => !document.getElementById('didomi-notice')],
      ['/consent/label', 'label "Alle akzeptieren"', () => getComputedStyle(document.querySelector('.hinweis')).display === 'none' && !window.declined],
      ['/consent/shadow-label', 'label "Zustimmen"', () => getComputedStyle(document.querySelector('consent-shell')).display === 'none'],
      ['/consent/form-accept', 'label "Accept"', () => !document.querySelector('.notice') && location.pathname === '/consent/form-accept'],
      ['/consent/hash-link', 'label "Accept"', () => getComputedStyle(document.querySelector('.notice')).display === 'none' && location.href.endsWith('/consent/hash-link#')],
      ['/consent/in-content', null, () => !window.termsClicked, 'an in-content "Accept" link is no consent control'],
      ['/consent/sticky-search', null, () => location.pathname === '/consent/sticky-search', 'a sticky header\'s search submit "OK" is no consent control'],
    ];
    for (const [path, want, gone, why] of CONSENT) {
      await checkAsync(`e2e consent: ${path} → ${want === null ? `nothing clicked (${why})` : want}`, async () => {
        const page = await open(path);
        const d = await session.dismissOverlays(page, { lateWindowMs: 0 });
        assert.equal(d.consent, want);
        assert.equal(await page.evaluate(gone), true, want === null ? 'a control outside any consent overlay was clicked' : 'the banner is still up (or the decline control was clicked)');
        assert.equal(d.overlayLeft, null, 'nothing left behind');
        await page.close();
      });
    }
    await checkAsync('e2e consent: a label-sweep click that navigates away → overlayLeft names the navigation (never clean)', async () => {
      const page = await open('/consent/nav-link');
      const d = await session.dismissOverlays(page, { lateWindowMs: 0 });
      assert.equal(d.consent, 'label "Accept"');
      assert.equal(d.overlayLeft, `(consent sweep navigated to ${base}/consent/accepted)`);
      await page.close();
    });
    const OVERLAY = [
      ['/overlay/clean', null],
      ['/overlay/onetrust', '#onetrust-banner-sdk (consent root visible)'],
      ['/overlay/usercentrics', '#usercentrics-root (consent root visible)'],
      ['/overlay/backdrop', 'div.backdrop (fixed, 100 % of the viewport)'],
      ['/overlay/blur', 'div#scrim (fixed, 100 % of the viewport)'],
      ['/overlay/body-lock', 'body (overflow:hidden)'],
      ['/overlay/html-lock', 'html (overflow:hidden)'],
      ['/overlay/toast', null],
      ['/overlay/below', null],
      ['/overlay/bar', null],
      ['/overlay/hidden-roots', null],
      ['/overlay/sticky-hero', null],
      ['/overlay/fixed-bg', null],
      ['/overlay/tint', 'div.tint (fixed, 100 % of the viewport)'],
      ['/overlay/modal-picker', 'dialog#country-picker (modal open)'],
      ['/overlay/modal-shadow', 'dialog.region-picker.sheet (modal open)'],
      ['/overlay/inline-dialog', null],
    ];
    for (const [path, want] of OVERLAY) {
      await checkAsync(`e2e overlay-left: ${path} → ${want}`, async () => {
        const page = await open(path);
        assert.equal(await session.detectOverlayLeft(page), want);
        await page.close();
      });
    }
    await checkAsync('e2e overlay-left: dismissOverlays reports the backdrop it could not dismiss; a closed page is a failed check, never clean', async () => {
      const page = await open('/overlay/backdrop');
      assert.deepEqual(await session.dismissOverlays(page, { lateWindowMs: 0 }), { extra: [], consent: null, marketing: [], overlayLeft: 'div.backdrop (fixed, 100 % of the viewport)' });
      await page.close();
      assert.match(await session.detectOverlayLeft(page), /^\(overlay check failed: /);
    });
    await checkAsync('e2e overlay-left: a showModal() dialog — with a visible "Close" the marketing pass closes it (overlayLeft null); without one dismissOverlays names it (modal open)', async () => {
      const closed = await open('/overlay/modal-close');
      const d = await session.dismissOverlays(closed, { lateWindowMs: 0 });
      assert.deepEqual([d.consent, d.marketing, d.overlayLeft], [null, ['button:has-text("Close")'], null]);
      assert.equal(await closed.evaluate(() => document.querySelector('dialog.signup').open), false, 'the dialog is closed');
      await closed.close();
      const left = await open('/overlay/modal-picker');
      assert.deepEqual(await session.dismissOverlays(left, { lateWindowMs: 0 }), { extra: [], consent: null, marketing: [], overlayLeft: 'dialog#country-picker (modal open)' });
      await left.close();
    });
  } finally { await browser.close(); server.close(); }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
