#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent table (the vendor accept buttons in table order, no duplicates, the
// OneTrust id first; the frozen label sweep, accept-like labels first, "decline" last, covering crawl.mjs's
// text-match labels), isLiveHttpUrl, defaultWaitUntil, isEdsHost and lateWindowFor (no timed
// late-modal poll on EDS build/preview hosts), and waitEdsDelayedPhase never throwing (stub page). The hide helpers:
// parseHideList, presenceHide, readPresenceFile, hideEntries, formatHidden and hideRegions' empty / argument contract
// (stub page); where playwright is importable (a project copy), hideRegions end-to-end on fixture pages served from
// this process — an 88 px in-flow bar above the header, a bar inserted 400 ms after load (hidden by the style rule),
// an invalid selector, a second call, and a late bar under a CSP that blocks inline <style> (hidden by the adopted
// sheet) — and dismissOverlays' consent pass on fixture banners: each consent manager's own accept button, a plain
// label (by priority, never "Decline" first), a label two shadow roots deep, a consent form's submit and a "#" link
// in a fixed banner, and the controls left alone — an in-content "Accept" link, a sticky header's search submit "OK";
// a sweep click that navigates away is named in overlayLeft;
// then detectOverlayLeft (also a stub page: an evaluate error is a failed check, never clean) on what a capture would
// still carry — a banner-sized consent root (or its shadow content) shown, a full-viewport backdrop, blur or
// pointer-events:none tint painting over the page's content, an html / body scroll lock — and on the look-alikes that
// are none: a consent manager's persistent 48 px privacy trigger after an accept, a transparent wrapper with a toast,
// a layer below the page (z-index -1), a fixed background under positioned content, a sticky full-viewport hero at the
// top, a 120 px bar, roots hidden by display or an opacity-0 ancestor; dismissOverlays returns it.
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as session from '../live-session.mjs';

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('the exported surface the instruments import', () => {
  for (const name of ['REAL_CHROME_UA', 'CONSENT_CANDIDATES', 'isLiveHttpUrl', 'isEdsHost', 'lateWindowFor', 'waitEdsDelayedPhase', 'defaultWaitUntil', 'newLiveContext', 'gotoLive', 'dismissOverlays', 'launchStealthHeaded', 'browserTier']) assert.ok(name in session, `${name} exported`);
  assert.equal(typeof session.dismissOverlays, 'function');
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
  for (const name of ['parseHideList', 'presenceHide', 'readPresenceFile', 'hideEntries', 'hideRegions', 'formatHidden']) assert.equal(typeof session[name], 'function', `${name} exported`);
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
    const r = session.readPresenceFile(file, 'home');
    assert.deepEqual(r.variable, [{ live: '.promo', build: '.build-promo' }, { live: '.hero', build: '.hero' }, { live: '.news', build: '.build-news' }, { live: '.slot', build: '[data-slot="a"]' }]);
    assert.deepEqual([r.file, r.slug, r.found, r.hide], [file, 'home', true, ['.geo-bar', '.location-bar']]);
    assert.equal(r.note, `${file} → home: 4 variable region(s), 2 hide selector(s)`);
    const star = session.readPresenceFile(file, 'about');
    assert.deepEqual([star.found, star.variable, star.hide], [true, [], ['.geo-bar']], '"*".variable is not read');
    assert.equal(star.note, `${file} → about: 0 variable region(s), 1 hide selector(s)`);
    const old = join(dir, 'old.json');
    writeFileSync(old, JSON.stringify({ home: { variable: '.promo' } }));
    assert.equal(session.readPresenceFile(old, 'home').note, `${old} → home: 1 variable region(s)`, 'without hide the note keeps its old form');
    assert.equal(session.readPresenceFile(old, 'about').note, `${old} has no variable regions for about — nothing hidden`);
    const gone = join(dir, 'absent.json');
    assert.deepEqual(session.readPresenceFile(gone, 'home'), { file: gone, slug: 'home', found: false, variable: [], hide: [], note: `${gone} not found — nothing hidden` });
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"home": {');
    assert.throws(() => session.readPresenceFile(bad, 'home'), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`) && e.message.endsWith(')'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  } finally { await browser.close(); server.close(); }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
