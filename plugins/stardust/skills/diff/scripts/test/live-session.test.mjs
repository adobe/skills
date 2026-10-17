#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent-accept candidate list (the cmp-prefixed candidates are present,
// no duplicates, the OneTrust id first), isLiveHttpUrl, defaultWaitUntil, isEdsHost and lateWindowFor (no timed
// late-modal poll on EDS build/preview hosts), waitEdsDelayedPhase never throwing (stub page), and the one
// navigation timeout (max(env, the crawl's p95 × 2) clamped 20–180 s, else the caller's default; gotoLive and visit take it per call), and the
// per-width deadline helpers (withDeadline, isContextDestroyed), and the 2xx denial page (the vendor signatures in
// order, normalizeDenialText, denialMarker per signature / the 2 KB rule / the one-error-heading rule, and gotoLive on
// stub pages: a denial throws BotChallengeError "origin blocked", a >= 400 is never probed, a failing probe is one
// "skipped" stderr line, a probe read a wedged page never answers races its deadline, the solve window clears on a
// clean reload, the header-marker message unchanged), and the
// dialog-pass constants (NATIVE_DIALOG, MODAL_DIALOGS, DIALOG_CLOSE_CANDIDATES — pinned, frozen), and the client hints
// (V4: uaMetadata per host, standardHeaders' sec-ch-ua as its brand list; hintScope — the default, the env, the option
// over the env, an invalid option / env; browserBuild, hintRecord; applyUaMetadata on stub contexts — every page once,
// native, a CDP failure; launchChromium and launchStealthHeaded on stub `chromium` objects; newLiveContext on a stub
// browser). Then, where playwright
// is importable (a skip line otherwise), a browser section against an in-process node:http origin: dismissOverlays'
// dialog pass on fixture pages — a native <dialog> close()d and the body lock released, a dialog CSS keeps displayed
// closed by its "Schließen" control, a non-native modal by its close control and an Escape-only panel (the html lock
// released), a surviving modal that keeps the lock (R1), a lock class with no modal that stays, the consent click
// unchanged, and the recorded `overflow: hidden` shorthand lock on html and body at height:100% released (the window
// scrolls; overflow-x clip), and a close that opens a next-step modal no snapshot held keeps the lock (the re-read
// names it) (stitch-shot.test.mjs runs the EDS single sweep against a late consent banner); and the client hints on a
// logging origin — the document, a same-origin script, a cross-origin (localhost) script and a CORS fetch all carry the
// UA's sec-ch-ua with no preflight; hints native keeps the browser's own and the same Accept-Language; launchChromium
// runs the full build with the UA metadata.
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
    'NAV_TIMEOUT_ENV', 'CRAWL_LOG', 'NAV_TIMEOUT_DEFAULT_MS', 'NAV_TIMEOUT_MIN_MS', 'NAV_TIMEOUT_MAX_MS', 'navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed',
    'DENIAL_TEXT_MAX_BYTES', 'DENIAL_SIGNATURES', 'DENIAL_ERROR_HEADING', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'pageDenial', 'botChallengeError',
    'NATIVE_DIALOG', 'MODAL_DIALOGS', 'DIALOG_CLOSE_CANDIDATES', 'describeElementInPage', 'overlayLikeInPage', 'scrollLockInPage', 'releaseScrollLockInPage', 'closeDialogs',
    'HINTS_ENV', 'HINT_SCOPES', 'hintScope', 'uaMetadata', 'applyUaMetadata', 'browserBuild', 'launchChromium', 'hintRecord']) assert.ok(name in session, `${name} exported`);
  assert.equal(typeof session.dismissOverlays, 'function');
  for (const name of ['navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'pageDenial', 'botChallengeError',
    'describeElementInPage', 'overlayLikeInPage', 'scrollLockInPage', 'releaseScrollLockInPage', 'closeDialogs', 'hintScope', 'uaMetadata', 'applyUaMetadata', 'browserBuild', 'launchChromium', 'hintRecord']) assert.equal(typeof session[name], 'function', name);
  assert.equal(session.DENIAL_TEXT_MAX_BYTES, 2048);
  assert.ok(session.DENIAL_ERROR_HEADING instanceof RegExp && session.DENIAL_ERROR_HEADING.flags.includes('i'), 'a case-insensitive RegExp');
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
check('dialog pass: NATIVE_DIALOG, MODAL_DIALOGS and DIALOG_CLOSE_CANDIDATES pinned in order, the lists frozen', () => {
  assert.equal(session.NATIVE_DIALOG, 'dialog[open]');
  assert.deepEqual(session.MODAL_DIALOGS, ['[role="dialog"][aria-modal="true"]', '.modal.show', '[class*="modal"][class*="open"]']);
  assert.deepEqual(session.DIALOG_CLOSE_CANDIDATES, ['[aria-label*="close" i]', '[aria-label*="schließen" i]', '[data-dismiss]', 'button.close', '.modal__close', '[class*="close"]']);
  for (const list of [session.MODAL_DIALOGS, session.DIALOG_CLOSE_CANDIDATES]) assert.ok(Object.isFrozen(list), 'frozen');
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
// what denialProbeInPage returns on an ordinary page — every stub page gotoLive probes after a < 400 gets it
const CLEAN_PROBE = Object.freeze({ title: 'Home', text: 'Welcome to the store. '.repeat(400), bytes: 8800, headings: Object.freeze(['Welcome', 'New arrivals']), frames: Object.freeze([]) });
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

check('navTimeout: the env is a floor — env above the crawl figure → env (trimmed, rounded); the detail names both inputs', () => withCrawlLog(({ file, write }) => {
  write({ crawl: { navMs: { p95: 12000 } } });
  assert.deepEqual(session.navTimeout({ env: { [NAV_ENV]: ' 30000.4 ' }, crawlLog: file }),
    { ms: 30000, source: 'env', detail: `max(${NAV_ENV}=30000.4, crawl.navMs.p95 12000 ms × 2 = 24000 in ${file}) = 30000 ms` });
  assert.equal(session.resolveNavTimeoutMs({ env: { [NAV_ENV]: '45000' }, crawlLog: file, fallback: 90000 }), 45000);
}));
check('navTimeout: the crawl figure above the env → crawl (the env never cuts a slow origin short)', () => withCrawlLog(({ file, write }) => {
  write({ crawl: { navMs: { p95: 30000 } } });
  assert.deepEqual(session.navTimeout({ env: { [NAV_ENV]: '1500' }, crawlLog: file }),
    { ms: 60000, source: 'crawl', detail: `max(${NAV_ENV}=1500, crawl.navMs.p95 30000 ms × 2 = 60000 in ${file}) = 60000 ms` });
  assert.equal(session.navTimeout({ env: { [NAV_ENV]: '59999' }, crawlLog: file }).source, 'crawl', 'one ms under');
}));
check('navTimeout: a tie → env; both inputs clamped together, the detail says so', () => withCrawlLog(({ file, write }) => {
  const nav = (v) => { const t = session.navTimeout({ env: { [NAV_ENV]: v }, crawlLog: file }); return [t.ms, t.source]; };
  write({ crawl: { navMs: { p95: 20000 } } });
  assert.deepEqual(nav('40000'), [40000, 'env'], 'env 40000 = p95 20000 × 2');
  write({ crawl: { navMs: { p95: 4000 } } });
  assert.deepEqual(nav('1500'), [20000, 'crawl'], '8000 > 1500, clamped up');
  assert.equal(session.navTimeout({ env: { [NAV_ENV]: '1500' }, crawlLog: file }).detail,
    `max(${NAV_ENV}=1500, crawl.navMs.p95 4000 ms × 2 = 8000 in ${file}) = 8000 ms, clamped to 20000–180000 ms → 20000 ms`);
  write({ crawl: { navMs: { p95: 100000 } } });
  assert.deepEqual(nav('250000'), [180000, 'env'], '250000 > 200000, clamped down');
}));
check('navTimeout: the env alone is clamped to 20000–180000 (source env); the detail says clamped and names the missing crawl figure', () => withCrawlLog(({ dir }) => {
  const absent = join(dir, 'absent.json');
  for (const [v, want, clamped] of [['1500', 20000, true], [' 1500.6 ', 20000, true], ['20000', 20000, false], ['45000', 45000, false], ['180000', 180000, false], ['250000', 180000, true]]) {
    const t = session.navTimeout({ env: { [NAV_ENV]: v }, crawlLog: absent, fallback: 90000 });
    assert.deepEqual([t.ms, t.source], [want, 'env'], v);
    assert.equal(t.detail, `${NAV_ENV}=${v.trim()}${clamped ? ', clamped to 20000–180000 ms' : ''} (no crawl.navMs.p95 in ${absent})`, v);
  }
  assert.equal(session.navTimeout({ env: { [NAV_ENV]: '1500' }, crawlLog: null }).detail, `${NAV_ENV}=1500, clamped to 20000–180000 ms (no crawl.navMs.p95 in (no crawl log))`);
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
    assert.deepEqual([session.navTimeout().ms, session.navTimeout().source], [60000, 'crawl'], 'a smaller env is only a floor');
    process.env[NAV_ENV] = '90000';
    assert.equal(session.resolveNavTimeoutMs(), 90000);
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
    // gotoLive's denial-page probe gets a clean page; visit's settle reads get their own shape
    evaluate: async (fn) => (fn === session.denialProbeInPage ? CLEAN_PROBE : { h: 100, empty: 0, pending: 0 }),
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
    assert.deepEqual(await withProcessEnv('45000', both), [45000, 45000], 'the env drives both');
    assert.deepEqual(await withProcessEnv('30000', both), [30000, 30000], 'evaluated per call, not at import');
    assert.deepEqual(await withProcessEnv('4321', both), [20000, 20000], 'the env alone is clamped to 20000');
    timeouts.length = 0;
    await withProcessEnv('45000', () => session.gotoLive(page, url, { settleMs: 0, timeoutMs: 1000 }));
    assert.deepEqual(timeouts, [1000], 'an explicit timeoutMs always wins');
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});

// The 2xx denial page (V2): a vendor wall answering 200 with its denial text is a bot challenge. Pure: denialMarker on
// hand-built probes, gotoLive on stub pages (denialProbeInPage itself runs in a page — stitch-shot / the probes).
const probe = (o = {}) => ({ title: '', text: '', bytes: 400, headings: [], frames: [], ...o });
// one small page per signature, natural case; no page carries an EARLIER signature's phrases (first match wins)
const SIGNATURE_PAGES = {
  'cant-process': probe({ text: 'We\'re sorry, we can’t process your request right now. Please try again later. Incident Number: 18.abc' }),
  'access-denied': probe({ title: 'Access Denied', text: 'Access Denied You don\'t have permission to access "http://www.example.com/" on this server. Reference #18.2f1c3b17.1700000000.4a5b6c' }),
  'just-a-moment': probe({ title: 'Just a moment…', text: 'Checking your browser before accessing www.example.com.' }),
  'press-and-hold': probe({ text: 'Press & Hold to confirm you are a human (and not a bot).' }),
  incapsula: probe({ text: 'Request unsuccessful. Incapsula incident ID: 1234' }),
  // the vendor's captcha iframe; protocol-relative because the site-names lint reads any http(s) host in code as a site
  datadome: probe({ text: 'Please enable JS and disable any ad blocker', frames: ['//geo.captcha-delivery.com/captcha/?initialCid=abc&cid=def'] }),
  'request-unsuccessful': probe({ text: 'Request unsuccessful. Your request could not be completed.' }),
  'system-down': probe({ title: 'System Down', text: 'System Down. Please try again later.' }),
};
const phrasesOccur = (page, sig) => {
  const hay = session.normalizeDenialText([page.title, page.text, ...page.frames].join(' '));
  return sig.all.every((el) => (Array.isArray(el) ? el : [el]).some((p) => hay.includes(p)));
};

check('DENIAL_SIGNATURES: the eight vendor signatures in order, frozen (array, entries, phrase lists), labels and normalised phrases', () => {
  const sigs = session.DENIAL_SIGNATURES;
  assert.deepEqual(sigs.map((s) => s.id), ['cant-process', 'access-denied', 'just-a-moment', 'press-and-hold', 'incapsula', 'datadome', 'request-unsuccessful', 'system-down']);
  assert.deepEqual(sigs.map((s) => s.label), ['"can\'t process your request" + "Incident Number"', '"Access Denied" + "Reference #"', '"Just a moment…"', '"Press & Hold"', '"Incapsula"', '"DataDome"', '"Request unsuccessful"', '"System Down"']);
  assert.deepEqual(sigs.map((s) => s.all), [["can't process your request", 'incident number'], ['access denied', 'reference #'], ['just a moment...'], ['press & hold'], ['incapsula'], [['datadome', 'captcha-delivery.com']], ['request unsuccessful'], ['system down']]);
  assert.ok(Object.isFrozen(sigs), 'the array is frozen');
  for (const s of sigs) {
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.all) && s.all.every((el) => !Array.isArray(el) || Object.isFrozen(el)), `${s.id} frozen`);
    for (const p of s.all.flat()) assert.equal(p, session.normalizeDenialText(p), `${s.id}: "${p}" is written normalised`);
  }
});
for (const [i, sig] of session.DENIAL_SIGNATURES.entries()) {
  check(`denialMarker: the ${sig.id} signature on a 400 B page in natural case → its label (no earlier signature on the page)`, () => {
    const page = SIGNATURE_PAGES[sig.id];
    assert.ok(phrasesOccur(page, sig), 'the fixture carries its own phrases');
    // first match wins: an earlier signature on the page would mask this one (a real vendor page may carry a LATER
    // one — the Incapsula page says "Request unsuccessful")
    assert.deepEqual(session.DENIAL_SIGNATURES.slice(0, i).filter((s) => phrasesOccur(page, s)).map((s) => s.id), [], 'no earlier signature occurs');
    assert.equal(session.denialMarker(page), `denial page — ${sig.label}`);
  });
}
check('denialMarker: a pair signature with one half only is no denial page; both halves match anywhere (title + text, any size)', () => {
  for (const text of ['Access Denied to the archive for guests.', 'Reference #18.2f1c3b17 for your order.', 'We can’t process your request right now.', 'Incident Number: 18.abc']) {
    assert.equal(session.denialMarker(probe({ text })), null, text);
  }
  assert.equal(session.denialMarker(probe({ title: 'Access Denied', text: 'Reference #18.2f1c3b17' })), 'denial page — "Access Denied" + "Reference #"', 'one half in the title, one in the text');
  assert.equal(session.denialMarker(probe({ bytes: 20000, text: `${'Our catalogue. '.repeat(50)} Access Denied … Reference #18.2f` })), 'denial page — "Access Denied" + "Reference #"', 'a pair on a 20000 B page');
});
check('denialMarker: a single phrase counts in the text / an iframe src only under 2048 B of text, in the title on any page', () => {
  const big = { bytes: 20000, headings: ['Welcome'] };
  assert.equal(session.denialMarker(probe({ ...big, title: 'Voice notes', text: 'Press & hold the button to record a voice note.' })), null, 'a 20000 B page that mentions it');
  assert.equal(session.denialMarker(probe({ ...big, title: 'Press & Hold', text: 'Our catalogue.' })), 'denial page — "Press & Hold"', 'the same phrase in the title');
  assert.equal(session.denialMarker(probe({ ...big, frames: ['//geo.captcha-delivery.com/captcha/?initialCid=abc'] })), null, 'an iframe src on a 20000 B page');
  assert.equal(session.denialMarker(probe({ bytes: 2047, text: 'System Down' })), 'denial page — "System Down"', '2047 B is small');
  assert.equal(session.denialMarker(probe({ bytes: 2048, text: 'System Down' })), null, '2048 B is not');
});
check('denialMarker: the generic rule — under 2048 B of text, exactly ONE heading, an error heading → bytes and the heading', () => {
  const blocked = { bytes: 300, text: 'Access is blocked. Your request was refused.', headings: ['Access is blocked'] };
  assert.equal(session.denialMarker(probe(blocked)), 'denial page — 300 B of text under one error heading "Access is blocked"');
  assert.equal(session.denialMarker(probe({ ...blocked, headings: ['Access is blocked', 'Contact us'] })), null, 'two headings');
  assert.equal(session.denialMarker(probe({ ...blocked, headings: ['Welcome'] })), null, 'one non-error heading');
  assert.equal(session.denialMarker(probe({ ...blocked, bytes: 5000 })), null, '5000 B of text');
  assert.equal(session.denialMarker(probe({ ...blocked, headings: [] })), null, 'no heading');
  for (const h of ['Something went wrong', 'Are you a human?', 'Verify you are human', 'Page Not Found', 'We can’t find that page', 'Error 403', 'Please complete the security check', 'hCaptcha']) {
    assert.equal(session.denialMarker(probe({ ...blocked, headings: [h] })), `denial page — 300 B of text under one error heading "${h}"`, h);
  }
  assert.equal(session.denialMarker(probe({ ...blocked, headings: ['Robotics lab'] })), null, 'word-bounded: robotics is not robot');
  const long = `Sorry, ${'x'.repeat(100)}`;
  assert.equal(session.denialMarker(probe({ ...blocked, headings: [long] })), `denial page — 300 B of text under one error heading "${long.slice(0, 80)}"`, 'the heading is cut at 80 chars');
});
check('denialMarker: null, {} and a probe with missing or mistyped fields → null', () => {
  for (const p of [null, undefined, {}, 'Just a moment…', 42, { title: 'Just a moment…' }, { title: 'Just a moment…', text: '', bytes: 10 }, probe({ title: 'Just a moment…', bytes: '10' }), probe({ title: 'Just a moment…', frames: null })]) {
    assert.equal(session.denialMarker(p), null, JSON.stringify(p));
  }
});
check('normalizeDenialText: lower-case, curly apostrophes → \', … → ..., every whitespace run → one space, trimmed', () => {
  assert.equal(session.normalizeDenialText('  We Can’t ‘Go’ ʼHere…\n\t\u00a0Now  '), "we can't 'go' 'here... now");
  assert.equal(session.normalizeDenialText('Just a moment…'), 'just a moment...');
  for (const [v, want] of [[null, ''], [undefined, ''], [42, '42']]) assert.equal(session.normalizeDenialText(v), want, String(v));
});

// gotoLive on stub pages: `probes` = what successive evaluate calls return (the last repeats); `evaluateError` is
// thrown from evaluate call `evaluateErrorFrom` on (1 = always); `reload` = the status/headers a reload answers with.
const LIVE_URL = 'https://www.example.com/';
const stubPage = ({ status = 200, headers = {}, probes = [CLEAN_PROBE], evaluateError = null, evaluateErrorFrom = 1, reload = { status: 200, headers: {} } } = {}) => {
  const calls = { goto: 0, reload: 0, evaluate: 0, waits: [] };
  const response = (s, h) => ({ status: () => s, headers: () => h, url: () => LIVE_URL });
  const page = {
    calls,
    last: null,
    goto: async () => { calls.goto += 1; page.last = response(status, headers); return page.last; },
    reload: async () => { calls.reload += 1; page.last = response(reload.status, reload.headers); return page.last; },
    waitForTimeout: async (t) => { calls.waits.push(t); },
    evaluate: async (fn) => {
      assert.equal(fn, session.denialProbeInPage, 'gotoLive only evaluates the denial probe');
      calls.evaluate += 1;
      if (evaluateError && calls.evaluate >= evaluateErrorFrom) throw evaluateError;
      return probes[Math.min(calls.evaluate, probes.length) - 1];
    },
  };
  return page;
};
const stderrOf = async (fn) => {
  const lines = []; const saved = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = saved; }
  return lines;
};
const HEADER_MESSAGE = (marker) => `bot challenge at ${LIVE_URL}: ${marker} — the live side served an edge interstitial, NOT the page; refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it headless.`;

await checkAsync('gotoLive: a 200 whose page is a denial page throws BotChallengeError — "HTTP 200 denial page — …", origin blocked, --headed; regardless of httpError', async () => {
  for (const [page, opts, marker] of [
    [stubPage({ probes: [SIGNATURE_PAGES['system-down']] }), {}, 'HTTP 200 denial page — "System Down"'],
    [stubPage({ probes: [SIGNATURE_PAGES['access-denied']] }), { httpError: 'measure' }, 'HTTP 200 denial page — "Access Denied" + "Reference #"'],
    [stubPage({ status: 203, probes: [probe({ bytes: 300, headings: ['Access is blocked'] })] }), {}, 'HTTP 203 denial page — 300 B of text under one error heading "Access is blocked"'],
  ]) {
    await assert.rejects(session.gotoLive(page, LIVE_URL, { settleMs: 0, ...opts }), (e) => {
      assert.equal(e.name, 'BotChallengeError');
      assert.ok(e instanceof Error);
      assert.equal(e.marker, marker);
      assert.ok(e.marker.startsWith(`HTTP ${marker.slice(5, 8)} denial page — `));
      assert.equal(e.url, LIVE_URL);
      assert.equal(e.message, `bot challenge at ${LIVE_URL}: ${marker} — origin blocked: the live side served a denial page, NOT the page; refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it headless.`);
      assert.ok(e.message.includes('origin blocked') && e.message.includes('--headed') && !e.message.includes('\n'), 'one line naming the block and the escalation');
      return true;
    });
    assert.deepEqual([page.calls.goto, page.calls.reload, page.calls.evaluate], [1, 0, 1], 'plain headless: one hit, no reload');
  }
});
await checkAsync('gotoLive: an entry status >= 400 is never probed — a 404 under httpError measure is returned (its warning only), a 404 under throw is a LiveHTTPError', async () => {
  const measured = stubPage({ status: 404, probes: [SIGNATURE_PAGES['access-denied']] });
  let resp;
  const lines = await stderrOf(async () => { resp = await session.gotoLive(measured, LIVE_URL, { settleMs: 0, httpError: 'measure' }); });
  assert.equal(resp.status(), 404);
  assert.equal(measured.calls.evaluate, 0, 'no denial probe on a >= 400');
  assert.deepEqual(lines, [`[live-session] WARNING: HTTP 404 at ${LIVE_URL} — measuring the error page; flags will reflect it`]);
  const thrown = stubPage({ status: 404, probes: [SIGNATURE_PAGES['access-denied']] });
  await assert.rejects(session.gotoLive(thrown, LIVE_URL, { settleMs: 0 }), { name: 'LiveHTTPError', status: 404 });
  assert.equal(thrown.calls.evaluate, 0);
});
await checkAsync('gotoLive: a probe that fails twice returns the response with ONE "denial-page check skipped" stderr line (retried once after 500 ms)', async () => {
  const page = stubPage({ evaluateError: new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation\n    at denialProbeInPage') });
  let resp;
  const lines = await stderrOf(async () => { resp = await session.gotoLive(page, LIVE_URL, { settleMs: 0 }); });
  assert.equal(resp.status(), 200);
  assert.equal(page.calls.evaluate, 2, 'one retry');
  assert.deepEqual(page.calls.waits, [500]);
  assert.deepEqual(lines, [`[live-session] denial-page check skipped at ${LIVE_URL}: page.evaluate: Execution context was destroyed, most likely because of a navigation`]);
  const flaky = stubPage({ probes: [SIGNATURE_PAGES['system-down']] });
  const evaluate = flaky.evaluate;
  let first = true;
  flaky.evaluate = async (fn) => { if (first) { first = false; throw new Error('Execution context was destroyed'); } return evaluate(fn); };
  assert.deepEqual(await session.pageDenial(flaky), { marker: 'denial page — "System Down"', skipped: null }, 'the retry reads the page');
});
await checkAsync('pageDenial: a read a wedged renderer never answers races probeMs — two deadlines (one retry) → skipped "denial-page probe: deadline 50 ms exceeded", never a hang', async () => {
  const page = stubPage();
  page.evaluate = (fn) => { assert.equal(fn, session.denialProbeInPage); page.calls.evaluate += 1; return new Promise(() => {}); };
  const d = await session.withDeadline(session.pageDenial(page, { probeMs: 50 }), 2000, 'pageDenial on a wedged page');
  assert.deepEqual(d, { marker: null, skipped: 'denial-page probe: deadline 50 ms exceeded' });
  assert.equal(page.calls.evaluate, 2, 'one retry');
  assert.deepEqual(page.calls.waits, [500]);
});
await checkAsync('gotoLive solveWindow: a denial page clean after the first (settled) reload returns the reloaded response; still denied after 3 reloads, reloads answered by an edge challenge, or reloads the probe cannot read, it throws', async () => {
  const cleared = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE] });
  const resp = await session.gotoLive(cleared, LIVE_URL, { settleMs: 700, solveWindow: true });
  assert.equal(resp, cleared.last, 'the reloaded response');
  assert.deepEqual([cleared.calls.reload, cleared.calls.evaluate], [1, 2], 'one reload, then clean');
  assert.deepEqual(cleared.calls.waits, [700, 4000, 700], 'the entry settle, the solve wait, the reload settled before the re-probe');
  const stuck = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment']] });
  await assert.rejects(session.gotoLive(stuck, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([stuck.calls.reload, stuck.calls.evaluate], [3, 4], 'the 3-attempt window');
  const edge = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE], reload: { status: 403, headers: { server: 'AkamaiGHost' } } });
  await assert.rejects(session.gotoLive(edge, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([edge.calls.reload, edge.calls.evaluate], [3, 1], 'an edge-challenged reload never re-reads the page as cleared');
  const unreadable = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment']], evaluateError: new Error('page.evaluate: Execution context was destroyed\n    at denialProbeInPage'), evaluateErrorFrom: 2 });
  const lines = await stderrOf(() => assert.rejects(session.gotoLive(unreadable, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' }));
  assert.deepEqual([unreadable.calls.reload, unreadable.calls.evaluate], [3, 7], 'every reload re-probed (and retried once), none replaces the confirmed denial');
  assert.deepEqual(lines, Array(3).fill(`[live-session] denial-page check skipped at ${LIVE_URL}: page.evaluate: Execution context was destroyed`), 'one skipped line per unreadable re-probe');
});
await checkAsync('gotoLive: the header-marker message is unchanged (botChallengeError builds it) and a header challenge is never probed', async () => {
  const page = stubPage({ status: 403, headers: { server: 'AkamaiGHost' } });
  await assert.rejects(session.gotoLive(page, LIVE_URL, { settleMs: 0 }), (e) => {
    assert.deepEqual([e.name, e.marker, e.url], ['BotChallengeError', 'HTTP 403 + Akamai edge signature', LIVE_URL]);
    assert.equal(e.message, HEADER_MESSAGE('HTTP 403 + Akamai edge signature'));
    return true;
  });
  assert.equal(page.calls.evaluate, 0);
  const built = session.botChallengeError(LIVE_URL, 'cf-mitigated: challenge');
  assert.deepEqual([built.name, built.marker, built.url, built.message], ['BotChallengeError', 'cf-mitigated: challenge', LIVE_URL, HEADER_MESSAGE('cf-mitigated: challenge')]);
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

// Client hints (V4): the hint value, the UA metadata, applyUaMetadata on stub contexts, the build tags, the two
// launchers on stub `chromium` objects and newLiveContext on a stub browser. Pure; stderr captured; process.env's
// STARDUST_LIVE_HINTS cleared wherever a default reads it (an operator's own value must not decide a check).
const HINTS = 'STARDUST_LIVE_HINTS';
const withHintsEnv = async (value, fn) => {
  const saved = process.env[HINTS];
  if (value === undefined) delete process.env[HINTS]; else process.env[HINTS] = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env[HINTS]; else process.env[HINTS] = saved; }
};
const BRANDS = [{ brand: 'Not/A)Brand', version: '8' }, { brand: 'Chromium', version: '143' }, { brand: 'Google Chrome', version: '143' }];
check('uaMetadata: brands (GREASE first) and fullVersionList from the UA\'s Chrome version; platform, version and architecture from the host', () => {
  assert.deepEqual(session.uaMetadata(session.REAL_CHROME_UA, { platform: 'darwin', release: '24.5.0', arch: 'arm64' }), {
    brands: BRANDS,
    fullVersionList: BRANDS.map((b) => ({ ...b, version: b.version === '8' ? '8.0.0.0' : '143.0.0.0' })),
    fullVersion: '143.0.0.0',
    platform: 'macOS',
    platformVersion: '15.5.0',
    architecture: 'arm',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
  });
  const linux = session.uaMetadata(session.REAL_CHROME_UA, { platform: 'linux', release: '6.8.0-45-generic', arch: 'x64' });
  assert.deepEqual([linux.platform, linux.platformVersion, linux.architecture, linux.bitness], ['Linux', '6.8.0', 'x86', '64']);
  assert.equal(session.uaMetadata(session.REAL_CHROME_UA, { platform: 'darwin', release: '25.0.0', arch: 'x64' }).platformVersion, '26.0.0', 'Darwin 25 → macOS 26');
  assert.equal(session.uaMetadata('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0'), null, 'no Chrome/ → null');
});
check('standardHeaders\' sec-ch-ua is uaMetadata\'s brand list, byte-identical to the field-proven value', () => {
  const header = session.standardHeaders()['sec-ch-ua'];
  assert.equal(header, session.uaMetadata().brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', '));
  assert.equal(header, '"Not/A)Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"');
});
await checkAsync('hintScope: ua-metadata by default; the env when the option is null (trimmed, blank = unset; process.env by default); the option beats the env', async () => {
  assert.deepEqual(session.HINT_SCOPES, ['ua-metadata', 'native']);
  assert.ok(Object.isFrozen(session.HINT_SCOPES), 'frozen');
  const quiet = captureStderr(() => {
    assert.equal(session.hintScope({ env: {} }), 'ua-metadata');
    assert.equal(session.hintScope({ env: { [HINTS]: ' native ' } }), 'native');
    assert.equal(session.hintScope({ hints: null, env: { [HINTS]: 'ua-metadata' } }), 'ua-metadata');
    for (const v of ['', '   ', undefined]) assert.equal(session.hintScope({ env: { [HINTS]: v } }), 'ua-metadata', JSON.stringify(v));
    assert.equal(session.hintScope({ hints: 'ua-metadata', env: { [HINTS]: 'native' } }), 'ua-metadata', 'option over env');
    assert.equal(session.hintScope({ hints: 'native', env: { [HINTS]: 'ua-metadata' } }), 'native', 'option over env');
  });
  assert.deepEqual(quiet, [], 'no warning for a valid or blank value');
  assert.equal(await withHintsEnv('native', () => session.hintScope()), 'native', 'process.env is the default');
  assert.equal(await withHintsEnv(undefined, () => session.hintScope()), 'ua-metadata', 'no option, no env');
});
check('hintScope: an invalid option throws naming the values; an invalid env is ua-metadata with ONE warning per process', () => {
  for (const bad of ['none', 'same-origin', 'document-only', 'Native']) {
    assert.throws(() => session.hintScope({ hints: bad, env: {} }), { message: `hints must be one of ua-metadata, native — got ${bad}` }, bad);
  }
  const warned = captureStderr(() => {
    assert.equal(session.hintScope({ env: { [HINTS]: ' off ' } }), 'ua-metadata');
    assert.equal(session.hintScope({ env: { [HINTS]: 'all' } }), 'ua-metadata');
  });
  assert.deepEqual(warned, [`[live-session] ${HINTS}=off is not one of ua-metadata, native — ignored`], 'one warning, naming the first bad value');
});
check('browserBuild and hintRecord: the launch tag, else unknown; the context\'s build and hints, else unknown / native', () => {
  assert.equal(session.browserBuild({ stardustBuild: 'chromium-headless-shell', stardustTier: 'chromium' }), 'chromium-headless-shell');
  for (const b of [{}, { stardustTier: 'chrome' }, null, undefined]) assert.equal(session.browserBuild(b), 'unknown', JSON.stringify(b));
  assert.deepEqual(session.hintRecord({ stardustBuild: 'chrome', stardustHints: 'ua-metadata' }), { browserBuild: 'chrome', hints: 'ua-metadata' });
  assert.deepEqual(session.hintRecord({}), { browserBuild: 'unknown', hints: 'native' });
});

// A stub browser context for applyUaMetadata: `pages` it already has; newPage() opens the next page and emits 'page'
// (as playwright does) before it resolves; popup() emits 'page' only; newCDPSession records each page and send.
const stubUaCtx = ({ pages = [], cdpError = null } = {}) => {
  const listeners = []; const cdp = []; let n = pages.length;
  const ctx = {
    cdp,
    pages: () => pages,
    on: (event, fn) => { if (event === 'page') listeners.push(fn); },
    newPage: async () => { const page = { id: (n += 1) }; pages.push(page); listeners.forEach((fn) => fn(page)); return page; },
    popup: () => { const page = { id: (n += 1) }; pages.push(page); listeners.forEach((fn) => fn(page)); return page; },
    newCDPSession: async (page) => {
      if (cdpError) throw new Error(cdpError);
      return { send: async (method, params) => { cdp.push({ page: page.id, method, params }); } };
    },
  };
  return ctx;
};
await checkAsync('applyUaMetadata (stub): every page — those it has, each newPage (before it returns), each popup — gets ONE override with the UA, the locale and uaMetadata', async () => {
  await withHintsEnv(undefined, async () => {
    const ctx = stubUaCtx({ pages: [{ id: 1 }] });
    await session.applyUaMetadata(ctx, { locale: 'de-CH' });
    assert.equal(ctx.stardustHints, 'ua-metadata');
    const opened = await ctx.newPage();
    assert.deepEqual(ctx.cdp.map((c) => c.page), [1, 2], 'the page newPage returned already carries it');
    ctx.popup();
    await new Promise((r) => { setTimeout(r, 0); });
    assert.deepEqual(ctx.cdp.map((c) => c.page), [1, 2, 3], 'a popup too; no page twice');
    for (const c of ctx.cdp) {
      assert.deepEqual(c, { page: c.page, method: 'Emulation.setUserAgentOverride', params: { userAgent: session.REAL_CHROME_UA, acceptLanguage: 'de-CH', userAgentMetadata: session.uaMetadata() } });
    }
    assert.equal(opened.id, 2);
  });
});
await checkAsync('applyUaMetadata (stub): native, or a UA with no Chrome version → no CDP call, hints native; an invalid option throws first', async () => {
  await withHintsEnv(undefined, async () => {
    for (const opts of [{ hints: 'native' }, { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0' }]) {
      const ctx = stubUaCtx({ pages: [{ id: 1 }] });
      await session.applyUaMetadata(ctx, opts);
      await ctx.newPage();
      assert.deepEqual([ctx.stardustHints, ctx.cdp.length], ['native', 0], JSON.stringify(opts));
    }
    const env = stubUaCtx({ pages: [{ id: 1 }] });
    await withHintsEnv('native', () => session.applyUaMetadata(env));
    assert.deepEqual([env.stardustHints, env.cdp.length], ['native', 0], 'STARDUST_LIVE_HINTS=native');
    const bad = stubUaCtx({ pages: [{ id: 1 }] });
    await assert.rejects(session.applyUaMetadata(bad, { hints: 'same-origin' }), { message: 'hints must be one of ua-metadata, native — got same-origin' });
    assert.equal(bad.stardustHints, undefined, 'no page work');
  });
});
await checkAsync('applyUaMetadata (stub): a CDP failure → hints native and ONE stderr line per process naming it; the page still opens', async () => {
  await withHintsEnv(undefined, async () => {
    const ctx = stubUaCtx({ pages: [{ id: 1 }], cdpError: 'browserContext.newCDPSession: CDP session is only available in Chromium\n  at …' });
    let page;
    const lines = await stderrOf(async () => {
      await session.applyUaMetadata(ctx);
      page = await ctx.newPage();
      await session.applyUaMetadata(stubUaCtx({ pages: [{ id: 1 }], cdpError: 'Target page, context or browser has been closed' }));
    });
    assert.equal(ctx.stardustHints, 'native');
    assert.equal(page.id, 2);
    assert.deepEqual(lines, ['[live-session] the UA client-hint metadata could not be set (browserContext.newCDPSession: CDP session is only available in Chromium) — the browser\'s own client hints ride this context (hints: native)']);
  });
});

// A stub playwright `chromium`: launch(opts) records opts and throws for a channel in `fail` ('none' = no channel).
const stubChromium = (fail = []) => {
  const calls = [];
  return {
    calls,
    launch: async (opts) => {
      calls.push(opts);
      const channel = opts.channel || 'none';
      if (fail.includes(channel)) throw new Error(`browserType.launch: Executable doesn't exist at /ms-playwright/${channel}\n╔═ npx playwright install ═╗`);
      return { launchedWith: opts };
    },
  };
};
await checkAsync('launchChromium: channel chromium launches → tier chromium, build chromium, no warning; the caller\'s options ride along', async () => {
  const c = stubChromium();
  let b;
  const lines = await stderrOf(async () => { b = await session.launchChromium(c, { headless: true, args: ['--x'] }); });
  assert.deepEqual(c.calls, [{ headless: true, args: ['--x'], channel: 'chromium' }]);
  assert.deepEqual([session.browserTier(b), session.browserBuild(b)], ['chromium', 'chromium']);
  assert.deepEqual(lines, []);
  const d = stubChromium();
  await session.launchChromium(d);
  assert.deepEqual(d.calls, [{ channel: 'chromium' }], 'no options → just the channel');
});
await checkAsync('launchChromium: channel chromium throws → the same options without a channel, the shell tag (chromium headed), ONE warning per process', async () => {
  const c = stubChromium(['chromium']);
  let shell; let headed;
  const lines = await stderrOf(async () => {
    shell = await session.launchChromium(c, { args: ['--x'] });
    headed = await session.launchChromium(c, { headless: false });
  });
  assert.deepEqual(c.calls, [{ args: ['--x'], channel: 'chromium' }, { args: ['--x'] }, { headless: false, channel: 'chromium' }, { headless: false }]);
  assert.ok(!('channel' in c.calls[1]) && !('channel' in c.calls[3]), 'the second launch has no channel');
  assert.deepEqual([session.browserTier(shell), session.browserBuild(shell)], ['chromium', 'chromium-headless-shell']);
  assert.deepEqual([session.browserTier(headed), session.browserBuild(headed)], ['chromium', 'chromium'], 'a headed bundled launch is the full build');
  assert.deepEqual(lines, ['[live-session] the full Chromium build is not installed (channel chromium: browserType.launch: Executable doesn\'t exist at /ms-playwright/chromium) — the headless shell runs; the UA client-hint metadata still applies (npx playwright install chromium)']);
});
await checkAsync('launchStealthHeaded: Chrome → build chrome; Chrome throws → channel chromium next (build chromium); both throw → no channel (the shell; chromium with a window) — the warning names the build', async () => {
  const STEALTH = { args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] };
  const warn = (ran) => `[live-session] WARNING: real Chrome (channel: chrome) failed to launch (browserType.launch: Executable doesn't exist at /ms-playwright/chrome) — falling back to ${ran} with the stealth args; bot-managed origins may still block this tier`;
  const saved = process.env.STARDUST_HEADED_WINDOW;
  try {
    delete process.env.STARDUST_HEADED_WINDOW;
    const ok = stubChromium();
    const chrome = await session.launchStealthHeaded(ok);
    assert.deepEqual(ok.calls, [{ headless: true, channel: 'chrome', ...STEALTH }]);
    assert.deepEqual([session.browserTier(chrome), session.browserBuild(chrome)], ['chrome', 'chrome']);
    const noChrome = stubChromium(['chrome']); const neither = stubChromium(['chrome', 'chromium']);
    let full; let shell;
    const lines = await stderrOf(async () => { full = await session.launchStealthHeaded(noChrome); shell = await session.launchStealthHeaded(neither); });
    assert.deepEqual(noChrome.calls, [{ headless: true, channel: 'chrome', ...STEALTH }, { headless: true, channel: 'chromium', ...STEALTH }], 'the chromium channel tried next');
    assert.deepEqual([session.browserTier(full), session.browserBuild(full)], ['chromium-fallback', 'chromium']);
    assert.deepEqual(neither.calls.map((o) => o.channel), ['chrome', 'chromium', undefined]);
    assert.deepEqual(neither.calls[2], { headless: true, ...STEALTH }, 'the stealth options, no channel');
    assert.deepEqual([session.browserTier(shell), session.browserBuild(shell)], ['chromium-fallback', 'chromium-headless-shell']);
    assert.deepEqual(lines, [warn('the full Chromium build'), warn('the Chromium headless shell')]);
    process.env.STARDUST_HEADED_WINDOW = '1';
    const windowed = stubChromium(['chrome', 'chromium']);
    let w;
    await stderrOf(async () => { w = await session.launchStealthHeaded(windowed); });
    assert.deepEqual([windowed.calls[2].headless, session.browserTier(w), session.browserBuild(w)], [false, 'chromium-fallback', 'chromium'], 'a visible bundled window is the full build');
    const chromeWindow = await session.launchStealthHeaded(stubChromium());
    assert.deepEqual([session.browserTier(chromeWindow), session.browserBuild(chromeWindow)], ['chrome-window', 'chrome']);
  } finally { if (saved === undefined) delete process.env.STARDUST_HEADED_WINDOW; else process.env.STARDUST_HEADED_WINDOW = saved; }
});

// newLiveContext on a stub browser: the document route it installs (driven with stub routes) and the UA metadata it
// applies (stubUaCtx records the CDP calls).
const stubLive = async (tags, opts) => {
  let handler = null; let contextOpts = null;
  const ctx = { ...stubUaCtx(), route: async (pattern, fn) => { handler = fn; }, addInitScript: async () => {} };
  const browser = { ...tags, newContext: async (o) => { contextOpts = o; return ctx; } };
  await session.newLiveContext(browser, opts);
  const send = (type) => {
    const args = [];
    const request = { resourceType: () => type, headers: () => ({ accept: '*/*' }) };
    handler({ request: () => request, continue: (...a) => { args.push(a); } });
    return args;
  };
  return { ctx, contextOpts, send };
};
await checkAsync('newLiveContext (stub): the document route unchanged; the UA metadata from the context\'s UA and locale; native by option or env; an invalid option throws before any context', async () => {
  await withHintsEnv(undefined, async () => {
    const { ctx, contextOpts, send } = await stubLive({ stardustBuild: 'chromium-headless-shell' }, { locale: 'en', reducedMotion: 'reduce' });
    assert.ok(!('hints' in contextOpts) && !('extraHTTPHeaders' in contextOpts) && contextOpts.reducedMotion === 'reduce', JSON.stringify(contextOpts));
    assert.deepEqual(send('document'), [[{ headers: { accept: '*/*', ...session.standardHeaders('en') } }]], 'the document: the full set');
    for (const type of ['script', 'fetch', 'font']) assert.deepEqual(send(type), [[]], `${type}: continue() untouched`);
    await ctx.newPage();
    assert.deepEqual(ctx.cdp.map((c) => [c.params.userAgent, c.params.acceptLanguage]), [[session.REAL_CHROME_UA, 'en-US']]);
    assert.deepEqual(session.hintRecord(ctx), { browserBuild: 'chromium-headless-shell', hints: 'ua-metadata' });
    const ua = session.REAL_CHROME_UA.replace('Chrome/143.0.0.0', 'Chrome/150.0.0.0');
    const custom = await stubLive({}, { ua });
    await custom.ctx.newPage();
    assert.deepEqual(custom.ctx.cdp.map((c) => [c.params.userAgent, c.params.acceptLanguage, c.params.userAgentMetadata.brands[2].version]), [[ua, undefined, '150']], '--ua, no locale');
    const native = await stubLive({}, { hints: 'native' });
    await native.ctx.newPage();
    assert.deepEqual([session.hintRecord(native.ctx), native.ctx.cdp.length], [{ browserBuild: 'unknown', hints: 'native' }, 0]);
    let opened = false;
    await assert.rejects(session.newLiveContext({ newContext: async () => { opened = true; } }, { hints: 'none' }), { message: 'hints must be one of ua-metadata, native — got none' });
    assert.equal(opened, false, 'no context opened');
  });
  const envOnly = await withHintsEnv('native', () => stubLive({}, {}));
  assert.equal(envOnly.ctx.stardustHints, 'native', 'STARDUST_LIVE_HINTS=native reaches a context the caller did not configure');
});

// ---- browser (needs playwright importable): pages from an in-process node:http origin on 127.0.0.1 ----------------
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; console.log('skip  browser checks (playwright not importable here; run this test in an environment that has it)'); }
// One origin for every browser check: `routes` maps a path (query stripped) to an HTML string, or to a handler
// (req, res) for a route that answers otherwise; any other path is a 404. close() resolves once the server is down.
const serveRoutes = async (routes) => {
  const server = createServer((req, res) => {
    const route = routes[req.url.split('?')[0]];
    if (typeof route === 'function') { route(req, res); return; }
    res.writeHead(route ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(route || 'not found');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); }) };
};
// A fixture page ≥ 3000 px tall with > 2 KB of ordinary copy under a plain heading (never read as a denial page);
// `extra` lands after <main>, `head` in <head>, `htmlClass` / `bodyClass` on html / body.
const COPY = '<p>Ordinary page copy: the spring range, store hours, delivery options and the size guide.</p>'.repeat(40);
const fixturePage = (extra, { head = '', htmlClass = '', bodyClass = '' } = {}) => `<!doctype html><html${htmlClass ? ` class="${htmlClass}"` : ''}><head><meta charset="utf-8">`
  + `<title>Spring range</title><style>html,body{margin:0}main{min-height:3200px}</style>${head}</head>`
  + `<body${bodyClass ? ` class="${bodyClass}"` : ''}><main><h1>Spring range</h1>${COPY}</main>${extra}</body></html>`;
const DIALOG_PAGES = {
  // (a) a native modal dialog whose opener also locked the body
  '/dialog-modal': fixturePage(`<dialog id="promo"><p>Free delivery this week.</p></dialog>
    <script>document.getElementById('promo').showModal(); document.body.style.overflow = 'hidden';</script>`),
  // (b) page CSS keeps a closed dialog displayed; only its "Schließen" button hides it
  '/dialog-styled': fixturePage(`<dialog id="notice" open><p>Neue Öffnungszeiten.</p>
    <button type="button" aria-label="Schließen" onclick="this.closest('dialog').style.display = 'none'">Schließen</button></dialog>`,
  { head: '<style>dialog{display:block}</style>' }),
  // (c) a non-native modal its close control hides — the html lock class stays — and a fixed panel only Escape hides.
  // The control is a non-button `.modal__close`: a `button.close` in a `.modal` is the marketing pass's
  // (`button[class*="close" i]`), so that modal would never reach the dialog pass.
  '/modals': fixturePage(`<div class="modal show" role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.5)">
    <p>Choose your region.</p><span class="modal__close" role="button" tabindex="0" onclick="this.closest('.modal').style.display = 'none'">×</span></div>
    <div class="promo-modal is-open" style="position:fixed;left:0;right:0;bottom:0;height:240px;background:#eee"><p>Spring offer.</p></div>
    <script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.promo-modal').style.display = 'none'; });</script>`,
  { htmlClass: 'locked', head: '<style>html.locked{overflow:hidden}</style>' }),
  // (d) a fixed modal no control and no Escape closes, over a body lock — beside a dialog close() does close
  '/modal-stuck': fixturePage(`<dialog id="note" open><p>Store hours changed.</p></dialog>
    <div id="blocker" role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.6)"><p>Please wait.</p></div>`,
  { head: '<style>body{overflow:hidden}</style>' }),
  // (e) a lock class with no modal open, and an in-content button whose class names a modal opener
  '/lock-class': fixturePage('<button type="button" class="modal-opener">Open the size guide</button>',
    { bodyClass: 'modal-open', head: '<style>body.modal-open{overflow:hidden}</style>' }),
  // (f) no dialog; a consent banner
  '/consent': fixturePage(`<div id="onetrust-banner-sdk" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#123">
    <button type="button" id="onetrust-accept-btn-handler" onclick="document.getElementById('onetrust-banner-sdk').remove()">Accept</button></div>`),
  // (g) the recorded lock: html/body height:100% and the opener's `overflow: hidden` shorthand on both — releasing
  // overflow-y alone leaves overflow-x hidden, so the visible overflow-y computes to auto and body scrolls inside itself
  '/dialog-shorthand-lock': fixturePage(`<dialog id="region"><p>Choose your delivery region.</p></dialog>
    <script>document.getElementById('region').showModal(); for (const el of [document.documentElement, document.body]) el.style.overflow = 'hidden';</script>`,
  { head: '<style>html,body{height:100%}</style>' }),
  // (h) a two-step modal: its close control removes it and opens the next step — after the pass's only snapshot of
  // the selector both match — and the next step has no control, over a body lock
  '/dialog-next-step': fixturePage(`<div id="first" role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.5)">
    <p>Step one of two.</p><span class="modal__close" role="button" tabindex="0" onclick="nextStep()">×</span></div>
    <script>function nextStep() { document.getElementById('first').remove(); const d = document.createElement('div');
      d.id = 'second'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
      d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6)'; d.textContent = 'Step two of two.'; document.body.append(d); }</script>`,
  { head: '<style>body{overflow:hidden}</style>' }),
};
if (chromium) {
  const origin = await serveRoutes(DIALOG_PAGES);
  let browser = null;
  try {
    browser = await chromium.launch();
    // one fresh page per fixture, a plain goto (these exercise dismissOverlays, not gotoLive), one sweep (no late
    // window), then `read(page)` → the fields merged into the result
    const sweep = async (path, read = async () => ({})) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await page.goto(`${origin.base}${path}`, { waitUntil: 'load' });
        const d = await session.dismissOverlays(page, { lateWindowMs: 0 });
        return { d, ...(await read(page)) };
      } finally { await page.close(); }
    };
    const readLock = async (page) => ({
      lock: await page.evaluate(session.scrollLockInPage),
      x: await page.evaluate(() => [getComputedStyle(document.documentElement).overflowX, getComputedStyle(document.body).overflowX]),
      y: await page.evaluate(() => { window.scrollTo(0, 1000); return window.scrollY; }),
    });
    const pass = (d) => [d.dialogs, d.dialogsLeft, d.scrollLockReleased];

    await checkAsync('dismissOverlays (a): an open native <dialog> is close()d and the body lock it set released — overflow-y visible, overflow-x clip; the window scrolls', async () => {
      const { d, lock, x, y } = await sweep('/dialog-modal', readLock);
      assert.deepEqual(Object.keys(d), ['extra', 'consent', 'marketing', 'dialogs', 'dialogsLeft', 'scrollLockReleased'], 'the return shape');
      assert.deepEqual(pass(d), [['dialog#promo (close())'], [], true]);
      assert.equal(lock.locked, false, JSON.stringify(lock));
      assert.equal(x[1], 'clip', 'the body\'s hidden overflow-x becomes clip — still hidden, no scroll container (R2-amend)');
      assert.ok(y >= 900, `window.scrollY ${y} after scrollTo(0, 1000)`);
    });
    await checkAsync('dismissOverlays (b): a dialog page CSS keeps displayed after close() is closed by its "Schließen" control', async () => {
      const { d } = await sweep('/dialog-styled');
      assert.deepEqual(pass(d), [['dialog#notice (close control [aria-label*="schließen" i])'], [], false], 'no lock to release');
    });
    await checkAsync('dismissOverlays (c): a non-native modal closed by its close control, a panel by Escape — the html lock released (overflow-y visible, overflow-x clip)', async () => {
      const { d, lock, x } = await sweep('/modals', readLock);
      assert.deepEqual(pass(d), [['div.modal.show (close control .modal__close)', 'div.promo-modal.is-open (Escape)'], [], true], JSON.stringify(d));
      assert.deepEqual(d.marketing, [], 'the marketing pass left both to the dialog pass');
      assert.equal(lock.locked, false, JSON.stringify(lock));
      assert.equal(x[0], 'clip', 'html\'s hidden overflow-x becomes clip — still hidden, no scroll container (R2-amend)');
    });
    await checkAsync('dismissOverlays (d): a modal that survives keeps the lock (R1) — dialogsLeft names it, though another dialog closed', async () => {
      const { d, lock } = await sweep('/modal-stuck', readLock);
      assert.deepEqual(pass(d), [['dialog#note (close())'], ['div#blocker'], false]);
      assert.deepEqual(lock, { html: 'visible', body: 'hidden', locked: true }, 'the lock is still in place');
    });
    await checkAsync('dismissOverlays (e): a lock class with no modal stays (R1) — body.modal-open and an in-content .modal-opener are no modal', async () => {
      const { d, lock } = await sweep('/lock-class', readLock);
      assert.deepEqual(pass(d), [[], [], false]);
      assert.equal(lock.locked, true, 'the page\'s own lock is not released');
    });
    await checkAsync('dismissOverlays (f): no dialog → empty dialog fields; the consent candidates still click the banner', async () => {
      const { d, banner } = await sweep('/consent', async (page) => ({ banner: await page.locator('#onetrust-banner-sdk').count() }));
      assert.equal(d.consent, '#onetrust-accept-btn-handler');
      assert.deepEqual(pass(d), [[], [], false]);
      assert.equal(banner, 0, 'the banner is gone');
    });
    await checkAsync('dismissOverlays (g): the recorded `overflow: hidden` shorthand lock on html and body at height:100% is released — the window scrolls, overflow-x clip on both', async () => {
      const { d, lock, x, y } = await sweep('/dialog-shorthand-lock', readLock);
      assert.deepEqual(pass(d), [['dialog#region (close())'], [], true]);
      assert.equal(lock.locked, false, JSON.stringify(lock));
      assert.deepEqual(x, ['clip', 'clip'], 'a hidden overflow-x becomes clip on html and body');
      assert.ok(y > 0, `window.scrollY ${y} after scrollTo(0, 1000) — not an inner scroller`);
    });
    await checkAsync('dismissOverlays (h): a close that opens the next step — a dialog no snapshot held — keeps the lock (R1): dialogsLeft names it from the re-read', async () => {
      const { d, lock } = await sweep('/dialog-next-step', readLock);
      assert.deepEqual(pass(d), [['div#first (close control .modal__close)'], ['div#second'], false], JSON.stringify(d));
      assert.equal(lock.locked, true, JSON.stringify(lock));
    });
  } finally {
    if (browser) await browser.close();
    await origin.close();
  }

  // Client hints (V4): an origin that logs each request's method, host, path and headers. `/` loads a same-origin
  // script, a script from http://localhost:<port> (the same server, another origin — it binds 127.0.0.1) and fetches
  // a CORS resource from there; the fetched body becomes the title. Cross-origin responses allow any origin.
  const DATA = 'hints-data';
  const requests = [];
  const logged = (type, body, cors = false) => (req, res) => {
    requests.push({ method: req.method, host: req.headers.host, path: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': type, ...(cors ? { 'access-control-allow-origin': '*' } : {}) }); res.end(typeof body === 'function' ? body(req) : body);
  };
  const hintsOrigin = await serveRoutes({
    '/': logged('text/html; charset=utf-8', (req) => `<script src="/same.js"></script><script src="http://localhost:${req.socket.localPort}/cross.js"></script>`
      + `<script>fetch('http://localhost:${req.socket.localPort}/data.json').then(r=>r.text()).then(t=>{document.title=t})</script>`),
    '/same.js': logged('text/javascript', 'window.sameLoaded = true;'),
    '/cross.js': logged('text/javascript', 'window.crossLoaded = true;', true),
    '/data.json': logged('application/json', DATA, true),
  });
  const port = new URL(hintsOrigin.base).port;
  const FORCED = session.standardHeaders()['sec-ch-ua'];
  // one fresh context on `b`, one visit to `/` (until the fetch set the title) → { ctx, at(host, path), all } (ctx closed)
  const visitHints = async (b, opts) => {
    requests.length = 0;
    const ctx = await session.newLiveContext(b, { locale: 'de-CH', ...opts });
    try {
      const page = await ctx.newPage();
      await page.goto(`${hintsOrigin.base}/`, { waitUntil: 'load' });
      await page.waitForFunction((t) => document.title === t, DATA, { timeout: 10000 });
      assert.deepEqual(await page.evaluate(() => [window.sameLoaded, window.crossLoaded]), [true, true], 'both scripts ran');
      const all = [...requests];
      const at = (host, path) => all.find((r) => r.host === `${host}:${port}` && r.path === path && r.method !== 'OPTIONS');
      return { ctx, at, all };
    } finally { await ctx.close(); }
  };
  const launched = [];
  const savedHints = process.env[HINTS];
  let acceptLanguage = null;
  try {
    delete process.env[HINTS];
    const plain = await chromium.launch();
    launched.push(plain);
    await checkAsync('client hints (1): the headless shell, newLiveContext defaults → the document, a same-origin script, a cross-origin script and a CORS fetch all carry the UA\'s sec-ch-ua; no preflight', async () => {
      const { ctx, at, all } = await visitHints(plain);
      assert.match(FORCED, /v="143"/, 'the UA\'s major');
      for (const [host, path] of [['127.0.0.1', '/'], ['127.0.0.1', '/same.js'], ['localhost', '/cross.js'], ['localhost', '/data.json']]) {
        const r = at(host, path);
        assert.ok(r, `${host}${path} recorded: ${all.map((x) => `${x.method} ${x.host}${x.path}`).join(', ')}`);
        assert.equal(r.headers['sec-ch-ua'], FORCED, `${host}${path}`);
        assert.equal(r.headers['sec-ch-ua-mobile'], '?0', `${host}${path}`);
      }
      assert.deepEqual(all.filter((r) => r.method === 'OPTIONS').map((r) => `${r.host}${r.path}`), [], 'no CORS preflight');
      assert.equal(session.hintRecord(ctx).hints, 'ua-metadata');
      acceptLanguage = at('127.0.0.1', '/same.js').headers['accept-language'];
    });
    await checkAsync('client hints (2): hints native → the browser\'s own sec-ch-ua (not the UA\'s); the same Accept-Language as (1)', async () => {
      const { ctx, at } = await visitHints(plain, { hints: 'native' });
      const same = at('127.0.0.1', '/same.js');
      assert.notEqual(same.headers['sec-ch-ua'], FORCED);
      assert.equal(session.hintRecord(ctx).hints, 'native');
      assert.ok(acceptLanguage && acceptLanguage.startsWith('de-CH'), `(1) recorded the locale: ${acceptLanguage}`);
      assert.equal(same.headers['accept-language'], acceptLanguage, 'the override left Accept-Language unchanged');
    });
    await checkAsync('client hints (3): launchChromium runs the full Chromium build here → hintRecord { browserBuild: chromium, hints: ua-metadata }; its same-origin script carries the UA\'s sec-ch-ua', async () => {
      const full = await session.launchChromium(chromium);
      launched.push(full);
      const { ctx, at } = await visitHints(full);
      assert.deepEqual(session.hintRecord(ctx), { browserBuild: 'chromium', hints: 'ua-metadata' });
      assert.equal(at('127.0.0.1', '/same.js').headers['sec-ch-ua'], FORCED);
    });
  } finally {
    if (savedHints === undefined) delete process.env[HINTS]; else process.env[HINTS] = savedHints;
    await Promise.all(launched.map((b) => b.close()));
    await hintsOrigin.close();
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
