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
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import * as session from '../live-session.mjs';

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
  for (const name of ['REAL_CHROME_UA', 'CONSENT_CANDIDATES', 'isLiveHttpUrl', 'defaultWaitUntil', 'standardHeaders', 'contextOptions', 'newLiveContext', 'resolveSiteAuth', 'attachOriginAuth', 'isChallengeResponse', 'gotoLive', 'launchStealthHeaded', 'browserTier', 'dismissOverlays',
    'DENIAL_TEXT_MAX_BYTES', 'DENIAL_PROBE_MS', 'DENIAL_SIGNATURES', 'DENIAL_ERROR_HEADING', 'normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'withDeadline', 'pageDenial', 'botChallengeError']) assert.ok(name in session, `${name} exported`);
  for (const name of ['normalizeDenialText', 'denialProbeInPage', 'denialMarker', 'withDeadline', 'pageDenial', 'botChallengeError']) assert.equal(typeof session[name], 'function', name);
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
const HEADER_MESSAGE = (marker) => `bot challenge at ${LIVE_URL}: ${marker} — the live side served an edge interstitial, NOT the page; refusing to measure it as the source. Escalate with --headed (stealth real Chrome); if that is still blocked, the site needs crawl.mjs-class capture (extract's bot-management ladder) and the gate cannot run against it headless.`;

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

await checkAsync('gotoLive: a localhost or loopback URL is never probed for a denial page — no vendor wall serves there, so a tiny build page under an error heading is returned as the page', async () => {
  for (const url of ['http://localhost:8791/404.html', 'http://127.0.0.1:3000/', 'http://[::1]/x']) {
    const page = stubPage({ probes: [SIGNATURE_PAGES['system-down']] });
    let resp;
    const lines = await stderrOf(async () => { resp = await session.gotoLive(page, url, { settleMs: 0 }); });
    assert.equal(resp, page.last, url);
    assert.deepEqual([page.calls.goto, page.calls.evaluate, lines], [1, 0, []], `${url}: one hit, no probe, nothing on stderr`);
  }
});

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
