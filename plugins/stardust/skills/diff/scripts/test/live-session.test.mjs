#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent-accept candidate list (the cmp-prefixed candidates are present,
// no duplicates, the OneTrust id first), isLiveHttpUrl, defaultWaitUntil, isEdsHost and lateWindowFor (no timed
// late-modal poll on EDS build/preview hosts), waitEdsDelayedPhase never throwing (stub page), and the one
// navigation timeout (env → the crawl's p95 × 2 → the caller's default; gotoLive and visit take it per call), and the
// per-width deadline helpers (withDeadline, isContextDestroyed), and the 2xx denial page (the vendor signatures in
// order, normalizeDenialText, denialMarker per signature / the 2 KB rule / the one-error-heading rule, and gotoLive on
// stub pages: a denial throws BotChallengeError "origin blocked", a >= 400 is never probed, a failing probe is one
// "skipped" stderr line, the solve window clears on a clean reload, the header-marker message unchanged). No browser:
// dismissOverlays itself runs inside stitch-shot / the diff probes against a page (stitch-shot.test.mjs runs the
// EDS single sweep against a late consent banner).
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as session from '../live-session.mjs';
import { visit } from '../measure-live.mjs';

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('the exported surface the instruments import', () => {
  for (const name of ['REAL_CHROME_UA', 'CONSENT_CANDIDATES', 'isLiveHttpUrl', 'isEdsHost', 'lateWindowFor', 'waitEdsDelayedPhase', 'defaultWaitUntil', 'newLiveContext', 'gotoLive', 'dismissOverlays', 'launchStealthHeaded', 'browserTier',
    'NAV_TIMEOUT_ENV', 'CRAWL_LOG', 'NAV_TIMEOUT_DEFAULT_MS', 'NAV_TIMEOUT_MIN_MS', 'NAV_TIMEOUT_MAX_MS', 'navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed',
    'DENIAL_TEXT_MAX_BYTES', 'DENIAL_SIGNATURES', 'DENIAL_ERROR_HEADING', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'pageDenial', 'botChallengeError']) assert.ok(name in session, `${name} exported`);
  assert.equal(typeof session.dismissOverlays, 'function');
  for (const name of ['navTimeout', 'resolveNavTimeoutMs', 'withDeadline', 'isContextDestroyed', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'pageDenial', 'botChallengeError']) assert.equal(typeof session[name], 'function', name);
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
    assert.deepEqual(await withProcessEnv('4321', both), [4321, 4321], 'the env drives both');
    assert.deepEqual(await withProcessEnv('9876', both), [9876, 9876], 'evaluated per call, not at import');
    timeouts.length = 0;
    await withProcessEnv('4321', () => session.gotoLive(page, url, { settleMs: 0, timeoutMs: 1000 }));
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

// gotoLive on stub pages: `probes` = what successive evaluate calls return (the last repeats); `reload` = the
// status/headers a reload answers with.
const LIVE_URL = 'https://www.example.com/';
const stubPage = ({ status = 200, headers = {}, probes = [CLEAN_PROBE], evaluateError = null, reload = { status: 200, headers: {} } } = {}) => {
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
      if (evaluateError) throw evaluateError;
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
await checkAsync('gotoLive solveWindow: a denial page clean after the first reload returns the reloaded response; still denied after 3 reloads, or reloads answered by an edge challenge, it throws', async () => {
  const cleared = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE] });
  const resp = await session.gotoLive(cleared, LIVE_URL, { settleMs: 0, solveWindow: true });
  assert.equal(resp, cleared.last, 'the reloaded response');
  assert.deepEqual([cleared.calls.reload, cleared.calls.evaluate], [1, 2], 'one reload, then clean');
  assert.deepEqual(cleared.calls.waits, [4000]);
  const stuck = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment']] });
  await assert.rejects(session.gotoLive(stuck, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([stuck.calls.reload, stuck.calls.evaluate], [3, 4], 'the 3-attempt window');
  const edge = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE], reload: { status: 403, headers: { server: 'AkamaiGHost' } } });
  await assert.rejects(session.gotoLive(edge, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([edge.calls.reload, edge.calls.evaluate], [3, 1], 'an edge-challenged reload never re-reads the page as cleared');
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

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
