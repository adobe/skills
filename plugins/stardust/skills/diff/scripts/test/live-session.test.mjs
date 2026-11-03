#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — live-session.mjs's pure surface, no browser: the exported names
// the instruments import; the 2xx denial page — the vendor signatures in order, normalizeDenialText, denialMarker per
// signature, the pair rule, the 2 KB rule, the one-error-heading rule, an ordinary page (large, or small with a plain
// heading) never classified; withDeadline; pageDenial on stub pages (one retry, the skipped result, the probe
// deadline); gotoLive on stub pages — a denial page throws BotChallengeError "origin blocked" and names --headed, an
// ordinary page returns its response, a >= 400 is never probed, a probe that fails twice is ONE "skipped" stderr line
// and never a pass, the solve window clears only on a clean readable reload, the header-marker message is unchanged.
// dismissOverlays and denialProbeInPage run inside a page — the instruments' own end-to-end tests cover them.
// Also: the consent-accept candidate list (cmp-prefixed candidates present, OneTrust first, no duplicates), isLiveHttpUrl,
// defaultWaitUntil, and the live-URL guard — a localhost / loopback URL is never probed for a denial page.
// The honest identity (stub chromium / browser, no launch): launchLiveBrowser tries real Chrome headless with no stealth
// flags and falls back to bundled Chromium with one stderr line and the tier tag; launchStealthHeaded is window-free and
// keeps the existing automation-signal handling unless STARDUST_STEALTH=0; every context gets the browser's UA without
// the headless token, or the caller's override; the sec-ch-ua* trio is derived from the browser's version and the OS
// (or the caller's UA) on the Chrome tiers and left to the browser on the bundled tier; the webdriver spoof reaches
// every context by default. The edge header signature.
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import * as session from '../live-session.mjs';

// the stub pages below navigate one host back-to-back; the per-host pacing has its own tests (they set the pace themselves)
process.env.STARDUST_LIVE_PACE_MS = '0';

let checks = 0; let failed = 0;
const report = (name, e) => { checks += 1; if (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } else console.log(`✓ ${name}`); };
const check = (name, fn) => { try { fn(); report(name); } catch (e) { report(name, e); } };
const checkAsync = async (name, fn) => { try { await fn(); report(name); } catch (e) { report(name, e); } };
// stderr lines console.error printed while fn ran
const stderrOf = async (fn) => {
  const lines = []; const saved = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = saved; }
  return lines;
};

check('the exported surface the instruments import, the denial-page names included', () => {
  for (const name of ['CONSENT_CANDIDATES', 'isLiveHttpUrl', 'defaultWaitUntil', 'standardHeaders', 'contextOptions', 'newLiveContext', 'resolveSiteAuth', 'attachOriginAuth', 'challengeMarker', 'isChallengeResponse', 'gotoLive', 'launchLiveBrowser', 'launchStealthHeaded', 'browserTier', 'acceptConsent', 'dismissOverlays',
    'stealthEnabled', 'platformLabel', 'chromeMajor', 'browserIdentity', 'LIVE_PACE_MS_DEFAULT', 'livePaceMs', 'paceSlot', 'paceLiveNavigation', 'resetLivePacing',
    'browserUserAgent', 'DENIAL_TEXT_MAX_BYTES', 'DENIAL_PROBE_MS', 'DENIAL_SIGNATURES', 'DENIAL_ERROR_HEADING', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'withDeadline', 'pageDenial', 'botChallengeError']) assert.ok(name in session, `${name} exported`);
  for (const name of ['normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'withDeadline', 'pageDenial', 'botChallengeError', 'launchLiveBrowser', 'launchStealthHeaded', 'browserIdentity', 'browserUserAgent', 'challengeMarker']) assert.equal(typeof session[name], 'function', name);
  assert.ok(!('REAL_CHROME_UA' in session), 'no hard-coded user agent is exported any more — the browser presents its own');
  assert.equal(session.DENIAL_TEXT_MAX_BYTES, 2048);
  assert.equal(session.DENIAL_PROBE_MS, 10000);
  assert.ok(session.DENIAL_ERROR_HEADING instanceof RegExp && session.DENIAL_ERROR_HEADING.flags.includes('i'), 'a case-insensitive RegExp');
});

// ---- the 2xx denial page: denialMarker on hand-built probes (what denialProbeInPage returns) ----------------
const probe = (o = {}) => ({ title: '', text: '', bytes: 400, headings: [], frames: [], ...o });
// what denialProbeInPage returns on an ordinary page — every stub page gotoLive probes after a < 400 gets it
const CLEAN_PROBE = Object.freeze(probe({ title: 'Home', text: 'Welcome to the store. '.repeat(400), bytes: 8800, headings: Object.freeze(['Welcome', 'New arrivals']), frames: Object.freeze([]) }));
// one small page per signature, natural case; no page carries an EARLIER signature's phrases (first match wins)
const SIGNATURE_PAGES = {
  'cant-process': probe({ text: 'We\'re sorry, we can’t process your request right now. Please try again later. Incident Number: 18.abc' }),
  'access-denied': probe({ title: 'Access Denied', text: 'Access Denied You don\'t have permission to access "http://www.example.com/" on this server. Reference #18.2f1c3b17.1700000000.4a5b6c' }),
  // CloudFront's generated 403 body for an AWS WAF block (recorded on a CloudFront-fronted site after a burst of requests)
  'cloudfront-blocked': probe({ title: 'ERROR: The request could not be satisfied', text: '403 ERROR The request could not be satisfied. Request blocked. We can\'t connect to the server for this app or website at this time. Generated by cloudfront (CloudFront) Request ID: abc123' }),
  'just-a-moment': probe({ title: 'Just a moment…', text: 'Checking your browser before accessing www.example.com.' }),
  // the openresty-style verification interstitial, served 200 and reloading itself (it may carry the LATER phrase too)
  'one-moment': probe({ title: 'One moment, please...', text: 'Please wait while your request is being verified...' }),
  'request-verified': probe({ title: 'Verifying your request', text: 'Please wait while your request is being verified. This may take a few seconds.' }),
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

check('DENIAL_SIGNATURES: the eleven vendor signatures in order, frozen (array, entries, phrase lists), labels and normalised phrases', () => {
  const sigs = session.DENIAL_SIGNATURES;
  assert.deepEqual(sigs.map((s) => s.id), ['cant-process', 'access-denied', 'cloudfront-blocked', 'just-a-moment', 'one-moment', 'request-verified', 'press-and-hold', 'incapsula', 'datadome', 'request-unsuccessful', 'system-down']);
  assert.deepEqual(sigs.map((s) => s.label), ['"can\'t process your request" + "Incident Number"', '"Access Denied" + "Reference #"', '"The request could not be satisfied" + "Request blocked"', '"Just a moment…"', '"One moment, please…"', '"Please wait while your request is being verified"', '"Press & Hold"', '"Incapsula"', '"DataDome"', '"Request unsuccessful"', '"System Down"']);
  assert.deepEqual(sigs.map((s) => s.all), [["can't process your request", 'incident number'], ['access denied', 'reference #'], ['the request could not be satisfied', 'request blocked'], ['just a moment...'], ['one moment, please'], ['please wait while your request is being verified'], ['press & hold'], ['incapsula'], [['datadome', 'captcha-delivery.com']], ['request unsuccessful'], ['system down']]);
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
  // the recorded shape: about 900 px of "can't process your request" + "Incident Number" under one heading, status 200
  assert.equal(session.denialMarker(probe({ title: 'Notice', bytes: 180, headings: ['We can\'t process your request'], text: 'We can\'t process your request We\'re sorry, we can\'t process your request right now. Please try again later. Incident Number: 18.4f2a7c31.1700000000.1a2b3c' })), 'denial page — "can\'t process your request" + "Incident Number"', 'the signature wins over the generic rule');
});
check('denialMarker: a single phrase counts only under 2048 B of text — in the title, the text or an iframe src; a title alone on a full page is no denial page', () => {
  const big = { bytes: 20000, headings: ['Welcome'] };
  assert.equal(session.denialMarker(probe({ ...big, title: 'Voice notes', text: 'Press & hold the button to record a voice note.' })), null, 'a 20000 B page that mentions it');
  assert.equal(session.denialMarker(probe({ ...big, title: 'Press & Hold', text: 'Our catalogue.' })), null, 'the same phrase as a full page\'s title');
  assert.equal(session.denialMarker(probe({ ...big, title: 'System Down: what happened and what we changed', text: 'Last Tuesday our checkout…' })), null, 'an article titled with a phrase');
  assert.equal(session.denialMarker(probe({ bytes: 300, title: 'Press & Hold', text: 'Our catalogue.' })), 'denial page — "Press & Hold"', 'the same title on a small page');
  assert.equal(session.denialMarker(probe({ ...big, frames: ['//geo.captcha-delivery.com/captcha/?initialCid=abc'] })), null, 'an iframe src on a 20000 B page');
  assert.equal(session.denialMarker(probe({ ...big, text: 'Just a moment, the gallery is loading. System down for maintenance on Sunday.' })), null, 'single phrases in a long page\'s text');
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
check('denialMarker: an ordinary page is never a denial page — large with several headings, small with a plain heading, a tiny teaser, a small page with two headings one of which reads like an error', () => {
  assert.equal(session.denialMarker(CLEAN_PROBE), null, 'a full page');
  assert.equal(session.denialMarker(probe({ title: 'Coming soon', bytes: 120, headings: ['Coming soon'], text: 'Coming soon. Our new site launches in May. Follow us for updates.' })), null, 'a small page under one plain heading');
  assert.equal(session.denialMarker(probe({ title: 'Contact us', bytes: 500, headings: ['Contact'], text: 'Contact. Call us or write to the address below. Opening hours Monday to Friday.' })), null, 'a contact page');
  assert.equal(session.denialMarker(probe({ title: 'Teaser', bytes: 40, headings: [], text: 'Spring collection 2026 — see it first.' })), null, 'a tiny page without a heading');
  assert.equal(session.denialMarker(probe({ title: 'Search', bytes: 600, headings: ['Sorry, no results', 'Popular products'], text: 'Sorry, no results for your query. Popular products: boots, bags.' })), null, 'two headings');
});
check('denialMarker: null, {} and a probe with missing or mistyped fields → null', () => {
  for (const p of [null, undefined, {}, 'Just a moment…', 42, { title: 'Just a moment…' }, { title: 'Just a moment…', text: '', bytes: 10 }, probe({ title: 'Just a moment…', bytes: '10' }), probe({ title: 'Just a moment…', frames: null })]) {
    assert.equal(session.denialMarker(p), null, JSON.stringify(p));
  }
});
check('normalizeDenialText: lower-case, curly apostrophes → \', … → ..., every whitespace run → one space, trimmed', () => {
  assert.equal(session.normalizeDenialText('  We Can’t ‘Go’ ʼHere…\n\t Now  '), "we can't 'go' 'here... now");
  assert.equal(session.normalizeDenialText('Just a moment…'), 'just a moment...');
  for (const [v, want] of [[null, ''], [undefined, ''], [42, '42']]) assert.equal(session.normalizeDenialText(v), want, String(v));
});
check('botChallengeError: name, marker, url; the denial message says "origin blocked" and names --headed, the header message is the instruments\' known one', () => {
  const denial = session.botChallengeError('https://www.example.com/', 'HTTP 200 denial page — "System Down"', { denial: true });
  assert.ok(denial instanceof Error);
  assert.deepEqual([denial.name, denial.marker, denial.url], ['BotChallengeError', 'HTTP 200 denial page — "System Down"', 'https://www.example.com/']);
  assert.ok(denial.message.startsWith('bot challenge at https://www.example.com/: HTTP 200 denial page — "System Down" — origin blocked: the live side served a denial page, NOT the page;'), denial.message);
  assert.ok(denial.message.includes('--headed') && !denial.message.includes('\n'), 'one line naming the escalation');
  const header = session.botChallengeError('https://www.example.com/', 'cf-mitigated: challenge');
  assert.ok(header.message.includes('served an edge interstitial, NOT the page') && !header.message.includes('origin blocked'));
});

// ---- withDeadline and pageDenial ----------------------------------------------------------------------------------
const later = (ms, fn) => new Promise((resolve) => { setTimeout(() => resolve(fn()), ms); });
const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
await checkAsync('withDeadline: the value or the rejection of a promise that settles in time, a DeadlineError past it, the same promise when ms is not a positive finite number; no timer left behind', async () => {
  const before = timers();
  assert.equal(await session.withDeadline(later(5, () => 'done'), 1000, 'read'), 'done');
  await assert.rejects(session.withDeadline(Promise.reject(new Error('boom')), 1000, 'read'), { message: 'boom' });
  await assert.rejects(session.withDeadline(new Promise(() => {}), 20, 'denial-page probe'), { name: 'DeadlineError', message: 'denial-page probe: deadline 20 ms exceeded' });
  const p = Promise.resolve(1);
  for (const ms of [0, -1, NaN, Infinity, 2 ** 31]) assert.equal(session.withDeadline(p, ms), p, String(ms));
  await later(5, () => {});
  assert.equal(timers(), before, 'the deadline timers are cleared');
});
const pageWith = (evaluate) => { const calls = { evaluate: 0, waits: [] }; return { calls, evaluate: async (fn) => { assert.equal(fn, session.denialProbeInPage); calls.evaluate += 1; return evaluate(calls.evaluate); }, waitForTimeout: async (t) => { calls.waits.push(t); } }; };
await checkAsync('pageDenial: a readable page → its marker (or null); a read that fails once is retried after 500 ms; two failed reads → skipped with the error\'s first line, never a marker', async () => {
  const denied = pageWith(() => SIGNATURE_PAGES['system-down']);
  assert.deepEqual(await session.pageDenial(denied), { marker: 'denial page — "System Down"', skipped: null });
  assert.deepEqual([denied.calls.evaluate, denied.calls.waits], [1, []]);
  const clean = pageWith(() => CLEAN_PROBE);
  assert.deepEqual(await session.pageDenial(clean), { marker: null, skipped: null });
  const flaky = pageWith((n) => { if (n === 1) throw new Error('Execution context was destroyed, most likely because of a navigation\n    at denialProbeInPage'); return SIGNATURE_PAGES['system-down']; });
  assert.deepEqual(await session.pageDenial(flaky), { marker: 'denial page — "System Down"', skipped: null }, 'the retry reads the page');
  assert.deepEqual([flaky.calls.evaluate, flaky.calls.waits], [2, [500]]);
  const broken = pageWith(() => { throw new Error('Execution context was destroyed, most likely because of a navigation\n    at denialProbeInPage'); });
  assert.deepEqual(await session.pageDenial(broken), { marker: null, skipped: 'Execution context was destroyed, most likely because of a navigation' });
  assert.deepEqual([broken.calls.evaluate, broken.calls.waits], [2, [500]]);
});
await checkAsync('pageDenial: a read past the probe deadline is a failed read — a page whose evaluate never settles → skipped "denial-page probe: deadline 50 ms exceeded" after two reads', async () => {
  const wedged = pageWith(() => new Promise(() => {}));
  const t0 = Date.now();
  assert.deepEqual(await session.pageDenial(wedged, { probeMs: 50 }), { marker: null, skipped: 'denial-page probe: deadline 50 ms exceeded' });
  assert.deepEqual([wedged.calls.evaluate, wedged.calls.waits], [2, [500]]);
  assert.ok(Date.now() - t0 < 2000, 'bounded by the deadline, not by the page');
});

// ---- gotoLive on stub pages ---------------------------------------------------------------------------------------
// `probes` = what successive evaluate calls return (the last repeats; an Error entry throws); `reload` = the
// status/headers a reload answers with.
const LIVE_URL = 'https://www.example.com/';
const stubPage = ({ status = 200, headers = {}, probes = [CLEAN_PROBE], reload = { status: 200, headers: {} } } = {}) => {
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
      const p = probes[Math.min(calls.evaluate, probes.length) - 1];
      if (p instanceof Error) throw p;
      return p;
    },
  };
  return page;
};
const EVAL_ERROR = new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation\n    at denialProbeInPage');
const HEADER_MESSAGE = (marker) => `bot challenge at ${LIVE_URL}: ${marker} — the live side served an edge interstitial, NOT the page; refusing to measure it as the source. Escalate with --headed (real Chrome with the challenge-solve window); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it unattended.`;

await checkAsync('gotoLive: an ordinary 200 page returns its response after one probe read — no throw, no stderr', async () => {
  const page = stubPage();
  let resp;
  const lines = await stderrOf(async () => { resp = await session.gotoLive(page, LIVE_URL, { settleMs: 0 }); });
  assert.equal(resp, page.last);
  assert.deepEqual([page.calls.goto, page.calls.reload, page.calls.evaluate, lines], [1, 0, 1, []]);
  const settled = stubPage();
  await session.gotoLive(settled, LIVE_URL, { settleMs: 300 });
  assert.deepEqual(settled.calls.waits, [300], 'the probe reads the page after the settle');
});
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
      assert.equal(e.url, LIVE_URL);
      assert.equal(e.message, `bot challenge at ${LIVE_URL}: ${marker} — origin blocked: the live side served a denial page, NOT the page; refusing to measure it as the source. Escalate with --headed (real Chrome with the challenge-solve window); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it unattended.`);
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
await checkAsync('gotoLive: a probe that fails twice returns the response with ONE "denial-page check skipped" stderr line (retried once after 500 ms) — never a silent pass, never a false denial', async () => {
  const page = stubPage({ probes: [EVAL_ERROR] });
  let resp;
  const lines = await stderrOf(async () => { resp = await session.gotoLive(page, LIVE_URL, { settleMs: 0 }); });
  assert.equal(resp.status(), 200);
  assert.equal(page.calls.evaluate, 2, 'one retry');
  assert.deepEqual(page.calls.waits, [500]);
  assert.deepEqual(lines, [`[live-session] denial-page check skipped at ${LIVE_URL}: page.evaluate: Execution context was destroyed, most likely because of a navigation`]);
});
await checkAsync('gotoLive solveWindow: a denial page clean after the first reload returns the reloaded response; still denied after 3 reloads, or reloads answered by an edge challenge, it throws; a reload the probe cannot read keeps the denial', async () => {
  const cleared = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE] });
  const resp = await session.gotoLive(cleared, LIVE_URL, { settleMs: 0, solveWindow: true });
  assert.equal(resp, cleared.last, 'the reloaded response');
  assert.deepEqual([cleared.calls.reload, cleared.calls.evaluate], [1, 2], 'one reload, then clean');
  assert.deepEqual(cleared.calls.waits, [4000]);
  const settled = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE] });
  await session.gotoLive(settled, LIVE_URL, { settleMs: 250, solveWindow: true });
  assert.deepEqual(settled.calls.waits, [250, 4000, 250], 'each reload is settled like the entry before the re-probe');
  const stuck = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment']] });
  await assert.rejects(session.gotoLive(stuck, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([stuck.calls.reload, stuck.calls.evaluate], [3, 4], 'the 3-attempt window');
  const edge = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], CLEAN_PROBE], reload: { status: 403, headers: { server: 'AkamaiGHost' } } });
  await assert.rejects(session.gotoLive(edge, LIVE_URL, { settleMs: 0, solveWindow: true }), { name: 'BotChallengeError', marker: 'HTTP 200 denial page — "Just a moment…"' });
  assert.deepEqual([edge.calls.reload, edge.calls.evaluate], [3, 1], 'an edge-challenged reload never re-reads the page as cleared');
  const unreadable = stubPage({ probes: [SIGNATURE_PAGES['just-a-moment'], EVAL_ERROR, EVAL_ERROR, CLEAN_PROBE] });
  let out;
  const lines = await stderrOf(async () => { out = await session.gotoLive(unreadable, LIVE_URL, { settleMs: 0, solveWindow: true }); });
  assert.equal(out, unreadable.last);
  assert.deepEqual([unreadable.calls.reload, unreadable.calls.evaluate], [2, 4], 'the unreadable reload keeps the denial (fail closed); the next clean read clears it');
  assert.deepEqual(lines, [`[live-session] denial-page check skipped at ${LIVE_URL}: page.evaluate: Execution context was destroyed, most likely because of a navigation`]);
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

// ---- the consent candidates, isLiveHttpUrl, defaultWaitUntil -------------------------------------------------------
check('consent candidates: OneTrust first, the cmp-prefixed and other common consent managers present, text fallbacks last, no duplicates', () => {
  const c = session.CONSENT_CANDIDATES;
  assert.ok(Array.isArray(c) && c.length >= 9, `${c.length} candidates`);
  assert.equal(c[0], '#onetrust-accept-btn-handler');
  for (const sel of ['#cmpwelcomebtnyes', '.cmpboxbtnyes', '#cmpbntyestxt']) assert.ok(c.includes(sel), `${sel} is a candidate`);
  for (const sel of ['.ch2-allow-all-btn', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#didomi-notice-agree-button', '[data-testid="uc-accept-all-button"]', '.osano-cm-accept-all', '#truste-consent-button', '.cky-btn-accept']) assert.ok(c.includes(sel), `${sel} is a candidate`);
  const isText = (sel) => /^button:(has-text|text-matches)\(/.test(sel) || sel.startsWith('[data-testid*=');
  const firstText = c.findIndex(isText);
  assert.ok(firstText > 0 && c.slice(firstText).every(isText), 'vendor id/class selectors all before the text fallbacks');
  const allowAll = c.findIndex((sel) => sel.startsWith('button:text-matches(') && /allow all/.test(sel));
  assert.ok(allowAll > 0, 'the "Allow all" label some managers use is a text fallback');
  assert.ok(!c.includes('button:has-text("Allow all")'), '"Allow all" is never a :has-text substring (it would match "Disallow all")');
  assert.ok(allowAll < c.indexOf('button:has-text("Accept")'), '"Allow all" before the bare "Accept" substring ("Accept only necessary")');
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

await checkAsync('gotoLive: a localhost or loopback URL is never probed for a denial page — no vendor wall serves there, so a tiny build page under an error heading is returned as the page', async () => {
  for (const url of ['http://localhost:8791/404.html', 'http://127.0.0.1:3000/', 'http://[::1]/x']) {
    const page = stubPage({ probes: [SIGNATURE_PAGES['system-down']] });
    let resp;
    const lines = await stderrOf(async () => { resp = await session.gotoLive(page, url, { settleMs: 0 }); });
    assert.equal(resp, page.last, url);
    assert.deepEqual([page.calls.goto, page.calls.evaluate, lines], [1, 0, []], `${url}: one hit, no probe, nothing on stderr`);
  }
});

// ---- per-host pacing of live navigations -----------------------------------------------------------------------------
check('livePaceMs: STARDUST_LIVE_PACE_MS as a non-negative integer — unset, empty, negative or unparsable → 2000; 0 disables; fractions floored', () => {
  assert.equal(session.LIVE_PACE_MS_DEFAULT, 2000);
  for (const [v, want] of [[undefined, 2000], ['', 2000], ['  ', 2000], ['0', 0], ['13000', 13000], ['2500.7', 2500], ['abc', 2000], ['-5', 2000], ['Infinity', 2000]]) {
    assert.equal(session.livePaceMs(v === undefined ? {} : { STARDUST_LIVE_PACE_MS: v }), want, String(v));
  }
  assert.equal(session.livePaceMs(), 0, 'this test file disabled it through the environment');
});
check('paceSlot (pure): a free host → no wait, the next free time one pace later; a busy host → wait until it is free; a pace of 0 or garbage never waits', () => {
  assert.deepEqual(session.paceSlot(undefined, 1000, 2000), { wait: 0, nextFree: 3000 }, 'never navigated');
  assert.deepEqual(session.paceSlot(3000, 1000, 2000), { wait: 2000, nextFree: 5000 }, 'busy until 3000');
  assert.deepEqual(session.paceSlot(3000, 2500, 2000), { wait: 500, nextFree: 5000 });
  assert.deepEqual(session.paceSlot(3000, 4000, 2000), { wait: 0, nextFree: 6000 }, 'free again');
  assert.deepEqual(session.paceSlot(3000, 1000, 0), { wait: 0, nextFree: 1000 }, '0 disables');
  for (const pace of [-1, NaN, undefined, null, 'x']) assert.deepEqual(session.paceSlot(3000, 1000, pace), { wait: 0, nextFree: 1000 }, String(pace));
  assert.deepEqual(session.paceSlot(NaN, 1000, 2000), { wait: 0, nextFree: 3000 }, 'a garbage nextFree is a free host');
});
await checkAsync('paceLiveNavigation: slots per host under an injected clock — the first navigation is free, the next waits one pace, concurrent callers queue up (0, pace, 2×pace), another host is independent, localhost is never paced, 0 disables; ONE stderr line per host on its first wait', async () => {
  session.resetLivePacing();
  const pageLog = () => { const waits = []; return { waits, waitForTimeout: async (ms) => { waits.push(ms); } }; };
  let t = 1000; const now = () => t;
  const A = 'https://a.example.com/'; const B = 'https://b.example.com/x';
  const p = pageLog();
  let lines = await stderrOf(async () => { assert.equal(await session.paceLiveNavigation(p, A, { paceMs: 2000, now }), 0, 'a free host'); });
  assert.deepEqual([p.waits, lines], [[], []]);
  lines = await stderrOf(async () => { assert.equal(await session.paceLiveNavigation(p, A, { paceMs: 2000, now }), 2000, 'the second navigation waits one pace'); });
  assert.deepEqual(p.waits, [2000]);
  assert.deepEqual(lines, ['[live-session] pacing live navigations to a.example.com 2000 ms apart (STARDUST_LIVE_PACE_MS; 0 disables) — first wait 2000 ms']);
  lines = await stderrOf(async () => { assert.equal(await session.paceLiveNavigation(p, `${A}deeper`, { paceMs: 2000, now }), 4000, 'the third queues behind the second'); });
  assert.deepEqual(lines, [], 'logged once per host');
  t = 7000; // the host is free again
  assert.equal(await session.paceLiveNavigation(p, A, { paceMs: 2000, now }), 0);
  assert.equal(await session.paceLiveNavigation(p, B, { paceMs: 2000, now }), 0, 'another host is independent');
  lines = await stderrOf(async () => { assert.equal(await session.paceLiveNavigation(p, B, { paceMs: 2000, now }), 2000); });
  assert.equal(lines.length, 1, 'the other host logs its own first wait');
  for (const local of ['http://localhost:8791/x.html', 'http://127.0.0.1:3000/', 'file:///tmp/x.html']) {
    assert.equal(await session.paceLiveNavigation(p, local, { paceMs: 2000, now }), 0, local);
    assert.equal(await session.paceLiveNavigation(p, local, { paceMs: 2000, now }), 0, `${local} again — never paced`);
  }
  assert.equal(await session.paceLiveNavigation(p, B, { paceMs: 0, now }), 0, '0 disables');
  // concurrent callers in one process: each reserves its own slot before any of them awaits
  session.resetLivePacing();
  const q = pageLog();
  const waited = await stderrOf(async () => { assert.deepEqual(await Promise.all([1, 2, 3].map(() => session.paceLiveNavigation(q, A, { paceMs: 1500, now }))), [0, 1500, 3000]); });
  assert.equal(waited.length, 1, 'one line for the host');
  session.resetLivePacing();
});
await checkAsync('gotoLive paces through the environment: STARDUST_LIVE_PACE_MS=5000 → the second navigation to the host waits (through the page, before goto) and the pacing line is printed once; back at 0 nothing waits', async () => {
  session.resetLivePacing();
  process.env.STARDUST_LIVE_PACE_MS = '5000';
  try {
    const first = stubPage(); const second = stubPage(); const third = stubPage();
    const lines = await stderrOf(async () => {
      await session.gotoLive(first, LIVE_URL, { settleMs: 0 });
      await session.gotoLive(second, LIVE_URL, { settleMs: 0 });
      await session.gotoLive(third, LIVE_URL, { settleMs: 0 });
    });
    assert.deepEqual(first.calls.waits, [], 'the first navigation is free');
    assert.equal(second.calls.waits.length, 1);
    assert.ok(second.calls.waits[0] > 4000 && second.calls.waits[0] <= 5000, `the second waits about one pace (${second.calls.waits[0]} ms)`);
    assert.ok(third.calls.waits[0] > 9000 && third.calls.waits[0] <= 10000, `the third queues behind it (${third.calls.waits[0]} ms)`);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[live-session\] pacing live navigations to www\.example\.com 5000 ms apart \(STARDUST_LIVE_PACE_MS; 0 disables\) — first wait \d+ ms$/);
  } finally { process.env.STARDUST_LIVE_PACE_MS = '0'; session.resetLivePacing(); }
  const again = stubPage(); const andAgain = stubPage();
  await session.gotoLive(again, LIVE_URL, { settleMs: 0 });
  await session.gotoLive(andAgain, LIVE_URL, { settleMs: 0 });
  assert.deepEqual(andAgain.calls.waits, [], '0 disables');
});

// ---- the honest identity: launchers on a stub chromium, header derivation, the context -----------------------------
// a stub playwright `chromium`: records every launch's options; Chrome (channel: 'chrome') can be made to fail like a
// runner without the binary; the browser it returns reports a version like the real one does
const stubChromium = ({ chromeFails = false, version = '156.0.8078.74' } = {}) => {
  const calls = [];
  return {
    calls,
    launch: async (opts) => {
      calls.push(opts);
      if (chromeFails && opts.channel === 'chrome') throw new Error("browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome\nRun \"npx playwright install chrome\"");
      return { version: () => version, close: async () => {} };
    },
  };
};
// run fn with the given env vars set (others deleted), restoring afterwards
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of ['STARDUST_STEALTH', 'STARDUST_HEADED_WINDOW']) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

await checkAsync('launchLiveBrowser: real Chrome headless first with exactly { headless: true, channel: "chrome" } — no stealth args, no ignoreDefaultArgs, even under STARDUST_STEALTH=1 — tier "chrome", nothing on stderr', async () => {
  for (const env of [{}, { STARDUST_STEALTH: '1' }]) {
    await withEnv(env, async () => {
      const chromium = stubChromium();
      let b;
      const lines = await stderrOf(async () => { b = await session.launchLiveBrowser(chromium); });
      assert.deepEqual(chromium.calls, [{ headless: true, channel: 'chrome' }], JSON.stringify(env));
      assert.equal(session.browserTier(b), 'chrome');
      assert.deepEqual(lines, []);
    });
  }
});
await checkAsync('launchLiveBrowser: Chrome not installed → bundled Chromium with exactly { headless: true }, tier "chromium-fallback", ONE stderr line naming the fallback and the tier', async () => {
  await withEnv({}, async () => {
    const chromium = stubChromium({ chromeFails: true });
    let b;
    const lines = await stderrOf(async () => { b = await session.launchLiveBrowser(chromium); });
    assert.deepEqual(chromium.calls, [{ headless: true, channel: 'chrome' }, { headless: true }]);
    assert.equal(session.browserTier(b), 'chromium-fallback');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /real Chrome \(channel: chrome\) failed to launch \(browserType\.launch: Chromium distribution 'chrome' is not found[^)]*\) — falling back to bundled Chromium \(tier chromium-fallback\)/);
    assert.ok(!lines[0].includes('\n'), 'one line');
  });
});
await checkAsync('launchStealthHeaded: window-free real Chrome keeps both launch options by default; any STARDUST_STEALTH value except 0 keeps them; 0 removes them with one stderr line; STARDUST_HEADED_WINDOW=1 opens a window; fallback keeps the selected options', async () => {
  await withEnv({}, async () => {
    const chromium = stubChromium();
    let b;
    const lines = await stderrOf(async () => { b = await session.launchStealthHeaded(chromium); });
    assert.deepEqual(chromium.calls, [{ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] }]);
    assert.deepEqual([session.browserTier(b), lines], ['chrome', []]);
    assert.equal(session.stealthEnabled(), true);
  });
  await withEnv({ STARDUST_STEALTH: 'anything' }, async () => {
    assert.equal(session.stealthEnabled(), true);
    const chromium = stubChromium();
    const lines = await stderrOf(async () => { await session.launchStealthHeaded(chromium); });
    assert.deepEqual(chromium.calls, [{ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] }]);
    assert.deepEqual(lines, []);
    const fallback = stubChromium({ chromeFails: true });
    await stderrOf(async () => { await session.launchStealthHeaded(fallback); });
    assert.deepEqual(fallback.calls[1], { headless: true, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] });
  });
  await withEnv({ STARDUST_STEALTH: '0' }, async () => {
    assert.equal(session.stealthEnabled(), false);
    const chromium = stubChromium();
    let initScripts = 0;
    const browser = {
      stardustTier: 'chrome',
      version: () => '156.0.8078.74',
      newContext: async () => ({ route: async () => {}, addInitScript: async () => { initScripts += 1; } }),
    };
    const lines = await stderrOf(async () => {
      await session.launchStealthHeaded(chromium);
      await session.newLiveContext(browser);
      await session.newLiveContext(browser);
    });
    assert.deepEqual(chromium.calls, [{ headless: true, channel: 'chrome' }]);
    assert.equal(initScripts, 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /STARDUST_STEALTH=0: automation-signal handling is OFF for this process/);
  });
  await withEnv({ STARDUST_HEADED_WINDOW: '1' }, async () => {
    const chromium = stubChromium();
    const b = await session.launchStealthHeaded(chromium);
    assert.deepEqual(chromium.calls, [{ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'] }]);
    assert.equal(session.browserTier(b), 'chrome-window');
  });
});
check('platformLabel and chromeMajor: darwin → macOS, win32 → Windows, everything else → Linux; the major of a version string or of a UA, null when absent', () => {
  assert.deepEqual(['darwin', 'win32', 'linux', 'freebsd', 'openbsd', 'aix', ''].map((p) => session.platformLabel(p)), ['macOS', 'Windows', 'Linux', 'Linux', 'Linux', 'Linux', 'Linux']);
  assert.equal(session.platformLabel(), session.platformLabel(process.platform));
  assert.equal(session.chromeMajor('156.0.8078.74'), '156');
  assert.equal(session.chromeMajor('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'), '143');
  assert.equal(session.chromeMajor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36'), '153');
  for (const v of ['', null, undefined, 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'abc']) assert.equal(session.chromeMajor(v), null, String(v));
});
await checkAsync('browserUserAgent: removes the headless token from Browser.getVersion and caches the result on the browser', async () => {
  let sends = 0; let detaches = 0;
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async (command) => { assert.equal(command, 'Browser.getVersion'); sends += 1; return { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36' }; },
      detach: async () => { detaches += 1; },
    }),
  };
  const expected = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
  assert.equal(await session.browserUserAgent(browser), expected);
  assert.equal(await session.browserUserAgent(browser), expected);
  assert.deepEqual([sends, detaches], [1, 1], 'the cached call does not talk to the browser again');
});
await checkAsync('browserUserAgent: concurrent first calls share one browser read', async () => {
  let release; let sends = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async () => { sends += 1; await gate; return { userAgent: 'HeadlessChrome/156.0.0.0' }; },
      detach: async () => {},
    }),
  };
  const reads = [session.browserUserAgent(browser), session.browserUserAgent(browser)];
  await new Promise(setImmediate);
  release();
  assert.deepEqual(await Promise.all(reads), ['Chrome/156.0.0.0', 'Chrome/156.0.0.0']);
  assert.equal(sends, 1);
});
await checkAsync('browserUserAgent: a failed CDP read falls back to browser.version() and the running desktop platform; no readable major returns null', async () => {
  let detaches = 0;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  try {
    const browser = {
      newBrowserCDPSession: async () => ({ send: async () => { throw new Error('CDP unavailable'); }, detach: async () => { detaches += 1; } }),
      version: () => '156.0.8078.74',
    };
    assert.equal(await session.browserUserAgent(browser), 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
    assert.equal(detaches, 1, 'a failed read still detaches its CDP session');
    assert.equal(await session.browserUserAgent({}), null);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
check('browserIdentity: the Chrome tiers state the browser\'s own major and the running OS; the bundled tiers state nothing (null — their own hints ride); a caller UA states its own major, platform and brand; a non-Chrome UA states nothing', () => {
  const chrome = { stardustTier: 'chrome', version: () => '156.0.8078.74' };
  assert.deepEqual(session.browserIdentity(chrome), { major: '156', platform: session.platformLabel(process.platform), chrome: true });
  assert.deepEqual(session.browserIdentity(chrome, { platform: 'linux' }), { major: '156', platform: 'Linux', chrome: true });
  assert.deepEqual(session.browserIdentity({ stardustTier: 'chrome-window', version: () => '157.0.1.2' }, { platform: 'win32' }), { major: '157', platform: 'Windows', chrome: true });
  assert.equal(session.browserIdentity({ stardustTier: 'chromium-fallback', version: () => '153.0.8010.12' }), null, 'the bundled fallback is not Chrome');
  assert.equal(session.browserIdentity({ version: () => '153.0.8010.12' }), null, 'an elected bundled Chromium');
  assert.equal(session.browserIdentity({ stardustTier: 'chrome', version: () => 'unknown' }), null, 'no major to state');
  assert.equal(session.browserIdentity({ stardustTier: 'chrome' }), null, 'no version() at all');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  assert.deepEqual(session.browserIdentity(chrome, { ua }), { major: '120', platform: 'Windows', chrome: true }, 'the caller\'s UA wins over the browser');
  assert.deepEqual(session.browserIdentity({ version: () => '153.0.0.0' }, { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' }), { major: '143', platform: 'Linux', chrome: true }, 'a caller UA on the bundled tier');
  assert.deepEqual(session.browserIdentity(chrome, { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36' }), { major: '153', platform: 'macOS', chrome: false }, 'a HeadlessChrome UA is not the Google Chrome brand');
  assert.equal(session.browserIdentity(chrome, { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0' }), null, 'nothing honest to derive from a non-Chrome UA');
});
check('standardHeaders: Accept, Accept-Language, Upgrade-Insecure-Requests always; the sec-ch-ua* trio only from an identity — Chromium + GREASE (+ Google Chrome when the identity is Chrome), the platform label, mobile ?0', () => {
  const plain = session.standardHeaders('en');
  assert.deepEqual(Object.keys(plain).sort(), ['Accept', 'Accept-Language', 'Upgrade-Insecure-Requests'], 'no identity → no client hints of ours');
  assert.equal(plain['Accept-Language'], 'en-US,en;q=0.9');
  assert.equal(session.standardHeaders('de-DE')['Accept-Language'], 'de-DE,de;q=0.9');
  assert.equal(session.standardHeaders('fr')['Accept-Language'], 'fr');
  const chrome = session.standardHeaders('en', { major: '156', platform: 'Linux', chrome: true });
  assert.equal(chrome['sec-ch-ua'], '"Chromium";v="156", "Not:A-Brand";v="8", "Google Chrome";v="156"');
  assert.equal(chrome['sec-ch-ua-mobile'], '?0');
  assert.equal(chrome['sec-ch-ua-platform'], '"Linux"');
  const chromium = session.standardHeaders('en', { major: '153', platform: 'macOS', chrome: false });
  assert.equal(chromium['sec-ch-ua'], '"Chromium";v="153", "Not:A-Brand";v="8"', 'no Google Chrome brand on a non-Chrome identity');
  assert.equal(chromium['sec-ch-ua-platform'], '"macOS"');
  assert.deepEqual(Object.keys(session.standardHeaders('en', { major: null })).sort(), ['Accept', 'Accept-Language', 'Upgrade-Insecure-Requests'], 'an identity without a major states nothing');
  assert.ok(!JSON.stringify(session.standardHeaders('en', { major: '156', platform: 'Linux', chrome: true })).includes('143'), 'no frozen version anywhere');
});
check('contextOptions: no userAgent unless the caller passed one; locale pins the context locale (en → en-US); the viewport passes through; the identity shapes the headers', () => {
  const none = session.contextOptions({});
  assert.ok(!('userAgent' in none), 'the browser presents its own UA');
  assert.deepEqual(Object.keys(none), ['extraHTTPHeaders']);
  assert.deepEqual(session.contextOptions({ ua: 'MyAgent/1.0', locale: 'en', viewport: { width: 1, height: 2 } }), { extraHTTPHeaders: session.standardHeaders('en'), userAgent: 'MyAgent/1.0', locale: 'en-US', viewport: { width: 1, height: 2 } });
  assert.equal(session.contextOptions({ locale: 'de-CH' }).locale, 'de-CH');
  assert.equal(session.contextOptions({ identity: { major: '156', platform: 'Linux', chrome: true } }).extraHTTPHeaders['sec-ch-ua-platform'], '"Linux"');
});
// a stub browser: records newContext's options; the context records its routes and init scripts and lets the test
// drive the route handler with a stub document / subresource request
const stubBrowser = ({ tier, version = '156.0.8078.74', browserUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36' } = {}) => {
  const ctx = { routes: [], initScripts: 0, route: async (glob, handler) => { ctx.routes.push({ glob, handler }); }, addInitScript: async () => { ctx.initScripts += 1; } };
  const b = {
    contexts: [],
    newBrowserCDPSession: async () => ({ send: async () => ({ userAgent: browserUA }), detach: async () => {} }),
    newContext: async (o) => { b.contexts.push(o); return ctx; },
    version: () => version,
    ctx,
  };
  if (tier) b.stardustTier = tier;
  return b;
};
const drive = async (ctx, { type = 'document', headers = { 'user-agent': 'OwnUA/1', 'sec-ch-ua': '"Own";v="1"', 'sec-ch-ua-platform': '"Own"' } } = {}) => {
  let continued = 'not called';
  await ctx.routes[0].handler({ request: () => ({ resourceType: () => type, headers: () => headers }), continue: (o) => { continued = o === undefined ? 'bare' : o; } });
  return continued;
};
await checkAsync('newLiveContext: the browser-derived or caller UA reaches the context; standard headers ride document requests only; Chrome hints match the UA major while bundled hints ride; the webdriver spoof reaches every context unless STARDUST_STEALTH=0', async () => {
  await withEnv({}, async () => {
    const chrome = stubBrowser({ tier: 'chrome' });
    const ctx = await session.newLiveContext(chrome, { locale: 'en', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    assert.deepEqual(chrome.contexts, [{ reducedMotion: 'reduce', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', locale: 'en-US', viewport: { width: 1440, height: 900 } }], 'the derived UA and extras pass through without extraHTTPHeaders');
    assert.deepEqual([ctx.routes.length, ctx.routes[0].glob, ctx.initScripts], [1, '**/*', 1]);
    const doc = await drive(ctx);
    assert.equal(doc.headers['user-agent'], 'OwnUA/1', 'the request\'s own UA is kept');
    assert.equal(doc.headers.Accept, session.standardHeaders('en').Accept);
    assert.equal(doc.headers['Accept-Language'], 'en-US,en;q=0.9');
    assert.equal(doc.headers['Upgrade-Insecure-Requests'], '1');
    assert.equal(doc.headers['sec-ch-ua'], `"Chromium";v="156", "Not:A-Brand";v="8", "Google Chrome";v="156"`);
    assert.equal(doc.headers['sec-ch-ua'].match(/Google Chrome";v="(\d+)/)[1], chrome.contexts[0].userAgent.match(/Chrome\/(\d+)/)[1], 'the Chrome hint and UA majors agree');
    assert.equal(doc.headers['sec-ch-ua-platform'], `"${session.platformLabel(process.platform)}"`);
    assert.equal(await drive(ctx, { type: 'font' }), 'bare', 'a subresource is continued untouched (F-B2)');
    const bundled = stubBrowser({ tier: 'chromium-fallback', version: '153.0.8010.12', browserUA: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36' });
    const bctx = await session.newLiveContext(bundled, { locale: 'en' });
    assert.equal(bctx.initScripts, 1, 'the spoof reaches a bundled-browser context too');
    assert.equal(bundled.contexts[0].userAgent, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', 'the bundled context gets the browser-derived UA');
    const bdoc = await drive(bctx);
    assert.equal(bdoc.headers['sec-ch-ua'], '"Own";v="1"', 'the bundled browser\'s own hints ride');
    assert.equal(bdoc.headers['sec-ch-ua-platform'], '"Own"');
    assert.equal(bdoc.headers['Accept-Language'], 'en-US,en;q=0.9', 'the standard headers still ride');
    const withUa = stubBrowser({ tier: 'chrome' });
    const uctx = await session.newLiveContext(withUa, { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' });
    assert.equal(uctx.initScripts, 1, 'the spoof reaches a context with a caller-provided UA too');
    assert.equal(withUa.contexts[0].userAgent, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36', 'the caller\'s UA is set');
    const udoc = await drive(uctx);
    assert.equal(udoc.headers['sec-ch-ua'], '"Chromium";v="143", "Not:A-Brand";v="8", "Google Chrome";v="143"', 'the hints follow the caller\'s UA');
    assert.equal(udoc.headers['sec-ch-ua-platform'], '"Linux"');
  });
  await withEnv({ STARDUST_STEALTH: '0' }, async () => {
    const chrome = stubBrowser({ tier: 'chrome' });
    const ctx = await session.newLiveContext(chrome, {});
    assert.equal(ctx.initScripts, 0, 'the explicit opt-out removes the webdriver spoof');
  });
});

// ---- the CloudFront / AWS WAF header signature ---------------------------------------------------------------------
const respLike = (status, headers, url = LIVE_URL) => ({ status: () => status, headers: () => headers, url: () => url });
check('challengeMarker: a 403 with server CloudFront or x-cache "Error from cloudfront" is the CloudFront/AWS WAF edge signature; any x-amzn-waf-action header is, whatever the status; a bare 403, a CloudFront 404 or 200 are not; the other vendors are unchanged', () => {
  assert.equal(session.challengeMarker(respLike(403, { server: 'CloudFront', 'x-cache': 'Error from cloudfront' })), 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)');
  assert.equal(session.challengeMarker(respLike(403, { 'x-cache': 'Error from cloudfront' })), 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)');
  assert.equal(session.challengeMarker(respLike(403, { server: 'cloudfront' })), 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)');
  assert.equal(session.challengeMarker(respLike(202, { 'x-amzn-waf-action': 'challenge' })), 'HTTP 202 + CloudFront/AWS WAF edge signature (x-amzn-waf-action: challenge)');
  assert.equal(session.challengeMarker(respLike(405, { 'x-amzn-waf-action': 'captcha', server: 'CloudFront' })), 'HTTP 405 + CloudFront/AWS WAF edge signature (x-amzn-waf-action: captcha)');
  assert.equal(session.challengeMarker(respLike(403, {})), null, 'a bare 403 is an app-level status');
  assert.equal(session.challengeMarker(respLike(404, { server: 'CloudFront', 'x-cache': 'Error from cloudfront' })), null, 'a CloudFront 404 is a missing page, not a block');
  assert.equal(session.challengeMarker(respLike(200, { server: 'CloudFront', 'x-cache': 'Miss from cloudfront' })), null);
  assert.equal(session.challengeMarker(respLike(503, { server: 'CloudFront' })), null, 'only a 403 carries the WAF block by header alone');
  assert.equal(session.challengeMarker(respLike(403, { 'cf-ray': 'abc' })), 'HTTP 403 + Cloudflare edge signature (cf-ray/server)');
  assert.equal(session.challengeMarker(respLike(200, { 'cf-mitigated': 'challenge' })), 'cf-mitigated: challenge');
  assert.equal(session.challengeMarker(respLike(403, { server: 'AkamaiGHost' })), 'HTTP 403 + Akamai edge signature');
  assert.equal(session.challengeMarker(respLike(400, { server: 'AkamaiGHost' })), 'HTTP 400 + Akamai edge signature (bot-management escalation)');
  assert.equal(session.challengeMarker(respLike(429, { server: 'BigIP' })), 'HTTP 429 + F5/Imperva edge signature', 'the header F5 actually sends');
  assert.equal(session.challengeMarker(respLike(503, { server: 'BIG-IP' })), 'HTTP 503 + F5/Imperva edge signature');
  assert.equal(session.challengeMarker(null), null);
  assert.equal(session.isChallengeResponse(respLike(403, { server: 'CloudFront' })), true);
  assert.equal(session.isChallengeResponse(respLike(403, {})), false);
});
await checkAsync('gotoLive: a CloudFront 403 throws BotChallengeError with the CloudFront/AWS WAF marker — the page is never probed; a bare 403 stays a LiveHTTPError', async () => {
  const blocked = stubPage({ status: 403, headers: { server: 'CloudFront', 'x-cache': 'Error from cloudfront' } });
  await assert.rejects(session.gotoLive(blocked, LIVE_URL, { settleMs: 0 }), { name: 'BotChallengeError', marker: 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)' });
  assert.equal(blocked.calls.evaluate, 0);
  const waf = stubPage({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' } });
  await assert.rejects(session.gotoLive(waf, LIVE_URL, { settleMs: 0 }), { name: 'BotChallengeError', marker: 'HTTP 202 + CloudFront/AWS WAF edge signature (x-amzn-waf-action: challenge)' });
  const bare = stubPage({ status: 403, headers: {} });
  await assert.rejects(session.gotoLive(bare, LIVE_URL, { settleMs: 0 }), { name: 'LiveHTTPError', status: 403 });
});

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
