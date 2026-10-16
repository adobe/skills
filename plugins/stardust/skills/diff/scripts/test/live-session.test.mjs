#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent-accept candidate list (the cmp-prefixed candidates are present,
// no duplicates, the OneTrust id first), isLiveHttpUrl, defaultWaitUntil, isEdsHost and lateWindowFor (no timed
// late-modal poll on EDS build/preview hosts), and waitEdsDelayedPhase never throwing (stub page). No browser:
// dismissOverlays itself runs inside stitch-shot / the diff probes against a page (stitch-shot.test.mjs runs the
// EDS single sweep against a late consent banner). The hide helpers: parseHideList, presenceHide, readPresenceFile,
// hideEntries, formatHidden and hideRegions' empty / argument contract (stub page); where playwright is importable
// (a project copy), hideRegions end-to-end on fixture pages served from this process — an 88 px in-flow bar above
// the header, a bar inserted 400 ms after load (hidden by the style rule), an invalid selector, a second call, and a
// late bar under a CSP that blocks inline <style> (hidden by the adopted sheet).
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
  } finally { await browser.close(); server.close(); }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
