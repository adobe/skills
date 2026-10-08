#!/usr/bin/env node
// skills/dynamics/scripts/test/dynamics-check.test.mjs — compareSearchResults, the pure comparison the
// `search-query` check runs: what the migrated site returns for a probe term is compared with what the
// SOURCE showed for the same term — result COUNT (a mismatch fails), the top ≤ 3 titles as a set, no two
// results sharing title + text — not just the presence of one expected hit. Fixtures only: no browser, no
// network. Also judgeVideoPlayback, the pure verdict of `video-plays`: presence is never a pass — a
// native <video> must be PLAYING (currentTime advancing), a vendor iframe must request playback.
// Also martechChecks (martech contract → checks) and judgeMartechRequests (gate/accept verdicts).
// Also: --help prints the header and writes nothing.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSearchResults, judgeVideoPlayback, martechChecks, judgeMartechRequests } from '../dynamics-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'dynamics-check.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const row = (title, text = title, href = `/${title.toLowerCase().replace(/\s+/g, '-')}`) => ({ title, text, href });

// What the source showed for the probe term "bali": three title matches.
const SOURCE = { expectCount: 3, expectTitles: ['Bali Escape', 'Bali by Bike', 'Bali Food Trail'], expectIncludes: 'bali escape' };

check('the recorded defect: 10 entries with two home pages under one title against a source of 3 → FAIL on count, titles and duplicates', () => {
  const here = [row('Home', 'Home — welcome'), row('Home', 'Home — welcome', '/de'), row('Bali Escape'), row('Tours'), row('About us'), row('Bali by Bike'), row('Java Trek'), row('Contact'), row('Bali Food Trail'), row('Press')];
  const r = compareSearchResults(here, SOURCE);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.includes('count 10 vs source 3'), r.reasons.join(' · '));
  assert.ok(r.reasons.some((x) => x.startsWith('top-3 titles differ — source: bali escape | bali by bike | bali food trail · here: home | home | bali escape')), r.reasons.join(' · '));
  assert.ok(r.reasons.some((x) => x.startsWith('duplicates (title + text): "home"')), r.reasons.join(' · '));
  assert.match(r.detail, /^10 results \(source 3\) · first: home · count 10 vs source 3/);
});

check('the same three titles, any order → PASS with a "matches the source" detail', () => {
  const r = compareSearchResults([row('Bali Food Trail'), row('Bali Escape'), row('Bali by Bike')], SOURCE);
  assert.equal(r.pass, true, r.detail);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.detail, '3 results (source 3) · first: bali food trail · matches the source');
});

check('count is exact by default and countTolerance widens it', () => {
  const four = [row('Bali Escape'), row('Bali by Bike'), row('Bali Food Trail'), row('Bali FAQ')];
  assert.equal(compareSearchResults(four, { expectCount: 3, expectTitles: SOURCE.expectTitles }).pass, false);
  assert.ok(compareSearchResults(four, { expectCount: 3 }).reasons.includes('count 4 vs source 3'));
  assert.equal(compareSearchResults(four, { expectCount: 3, countTolerance: 1, expectTitles: SOURCE.expectTitles }).pass, true);
  assert.ok(compareSearchResults(four, { expectCount: 2, countTolerance: 1 }).reasons.includes('count 4 vs source 2 (±1)'));
});

check('only the top ≤ 3 titles are compared, as a set; a fourth expected title is ignored', () => {
  const here = [row('Bali by Bike'), row('Bali Escape'), row('Bali Food Trail'), row('Something else')];
  const r = compareSearchResults(here, { expectTitles: ['Bali Escape', 'Bali by Bike', 'Bali Food Trail', 'Ignored'], expectCount: 4 });
  assert.equal(r.pass, true, r.detail);
  const wrong = compareSearchResults([row('Java Trek'), row('Bali Escape'), row('Bali by Bike'), row('Bali Food Trail')], { expectTitles: SOURCE.expectTitles, expectCount: 4 });
  assert.equal(wrong.pass, false);
  assert.match(wrong.reasons[0], /^top-3 titles differ — source: bali escape \| bali by bike \| bali food trail · here: java trek \| bali escape \| bali by bike$/);
});

check('titles compare after whitespace and case normalization; text and href count for expectIncludes', () => {
  const here = [row('  BALI   Escape '), row('bali by bike'), row('Bali Food\nTrail')];
  assert.equal(compareSearchResults(here, SOURCE).pass, true);
  assert.equal(compareSearchResults(here, { expectIncludes: '/bali-by-bike' }).pass, true, 'href matches');
  assert.equal(compareSearchResults(here, { expectIncludes: 'nowhere' }).pass, false);
  assert.ok(compareSearchResults(here, { expectIncludes: 'nowhere' }).reasons.includes('expected "nowhere" MISSING'));
});

check('duplicates are title + text: the same title with a different description is two results', () => {
  const dup = compareSearchResults([row('Home', 'Home — welcome'), row('Home', 'Home — welcome')], { expectCount: 2 });
  assert.equal(dup.pass, false); assert.ok(dup.reasons.some((x) => x.startsWith('duplicates')));
  const distinct = compareSearchResults([row('Home', 'Home — welcome'), row('Home', 'Home — the other locale')], { expectCount: 2 });
  assert.equal(distinct.pass, true, distinct.detail);
});

check('at least one expectation is required; no results fails unless the source had none either', () => {
  const none = compareSearchResults([row('x')], {});
  assert.equal(none.pass, false); assert.ok(none.reasons.includes('no expectation recorded (expectIncludes | expectCount | expectTitles)'));
  const empty = compareSearchResults([], { expectIncludes: 'x' });
  assert.ok(empty.reasons.includes('no results'));
  assert.equal(compareSearchResults([], { expectCount: 0 }).pass, true, 'the source returned nothing for this term too');
  assert.equal(compareSearchResults([], { expectCount: '0' }).pass, true, 'a string count is accepted');
});

check('the legacy string-results shape is accepted', () => {
  const r = compareSearchResults(['Bali Escape /bali-escape', 'Bali by Bike /bali-by-bike', 'Bali Food Trail /bali-food-trail'], { expectCount: 3, expectIncludes: 'bali escape' });
  assert.equal(r.pass, true, r.detail);
});

// ---- judgeVideoPlayback ---------------------------------------------------------------------------
const vid = (o = {}) => ({ found: true, autoplay: true, src: '/media/hero.mp4', visible: 1, readyState: 4, paused: false, t0: 1.2, t1: 2.0, ...o });

check('the recorded defect: a present, controllable but paused <video> (poster + paused) FAILS', () => {
  const r = judgeVideoPlayback({ iframe: false, video: vid({ paused: true, t1: 1.2 }) }, { path: '/' });
  assert.equal(r.pass, false); assert.equal(r.playing, false);
  assert.ok(r.reasons.some((x) => x.startsWith('video not playing (paused true, Δt 0.00s, readyState 4')), r.reasons.join(' · '));
});
check('a never-buffered video (readyState 0, the content.da.live 401 class) FAILS even when not paused', () => {
  const r = judgeVideoPlayback({ video: vid({ readyState: 0, t0: 0, t1: 0 }) }, {});
  assert.equal(r.pass, false); assert.match(r.reasons[0], /Δt 0\.00s, readyState 0/);
});
check('an advancing, unpaused video PASSES without any vendor requirement', () => {
  const r = judgeVideoPlayback({ video: vid() }, {});
  assert.equal(r.pass, true, r.detail); assert.equal(r.playing, true); assert.equal(r.detail, 'iframe/video: false · video playing (Δt 0.80s)');
});
check('reducedMotionPauses: the video must be paused under prefers-reduced-motion', () => {
  assert.equal(judgeVideoPlayback({ video: vid(), reduced: vid({ paused: true, t1: 1.2 }) }, { reducedMotionPauses: true }).pass, true);
  const r = judgeVideoPlayback({ video: vid(), reduced: vid() }, { reducedMotionPauses: true });
  assert.equal(r.pass, false); assert.deepEqual(r.reasons, ['video plays under prefers-reduced-motion']);
});
check('vendor iframe: present but no playback request < 400 FAILS; one ok request PASSES; neither player found FAILS', () => {
  const none = judgeVideoPlayback({ iframe: true, vendorOk: false, vendorRequests: 2 }, { playbackHost: 'players.brightcove.net' });
  assert.equal(none.pass, false); assert.match(none.reasons[0], /no playback request to players\.brightcove\.net with status < 400 \(2 seen\)/);
  assert.equal(judgeVideoPlayback({ iframe: true, vendorOk: true, vendorRequests: 1 }, { playbackHost: 'players.brightcove.net' }).pass, true);
  const empty = judgeVideoPlayback({}, {});
  assert.equal(empty.pass, false); assert.deepEqual(empty.reasons, ['no player: neither a vendor iframe nor a <video> found']);
});

const CONTRACT = {
  productionHosts: ['www.example.test'],
  consent: { cmp: { vendor: 'OneTrust', src: 'https://cmp.example.test/otSDKStub.js', enabled: false } },
  routes: [
    { id: 'adobe-launch', src: 'https://assets.example.test/launch-1.min.js', category: null, enabled: false },
    { id: 'gtm', src: 'https://tags.example.test/gtm.js?id=GTM-1', category: null, enabled: false },
  ],
};
const enable = (over) => ({ ...CONTRACT, consent: { cmp: { ...CONTRACT.consent.cmp, enabled: true } }, routes: CONTRACT.routes.map((r, i) => ({ ...r, ...over[i] })) });

check('martechChecks: scaffolded off — only the gate on /, forbidding every route and the CMP', () => {
  const f = martechChecks(CONTRACT);
  assert.deepEqual([f.id, f.class, f.status], ['martech', 'T', 'scaffolded-off']);
  assert.deepEqual(f.checks.map((c) => `${c.mode} ${c.path}`), ['gate /']);
  assert.deepEqual(f.checks[0].forbiddenHosts, ['assets.example.test', 'cmp.example.test', 'tags.example.test']);
  assert.deepEqual(f.checks[0].productionHosts, ['www.example.test']);
});

check('martechChecks: enabled routes load on accept; a category-gated one waits for consent', () => {
  const f = martechChecks(enable([{ enabled: true }, { enabled: true, category: 'C0004' }]));
  assert.equal(f.status, 'owner-enabled');
  assert.deepEqual(f.checks.map((c) => `${c.mode} ${c.path}`), ['gate /', 'gate /?martech=on', 'accept /?martech=on&consent=accept']);
  assert.deepEqual(f.checks[1].forbiddenHosts, ['tags.example.test']);
  assert.deepEqual(f.checks[2].expect.map((e) => e.id), ['cmp', 'adobe-launch', 'gtm']);
});

check('judgeMartechRequests: gate fails on a leaked host or subdomain, passes otherwise', () => {
  const c = { mode: 'gate', forbiddenHosts: ['adobedc.net', 'px.vendor.test'] };
  const bad = judgeMartechRequests(['edge.adobedc.net', 'cmp.example.test'], c);
  assert.equal(bad.pass, false); assert.match(bad.detail, /edge\.adobedc\.net/);
  assert.equal(judgeMartechRequests(['cmp.example.test', 'notadobedc.net'], c).pass, true);
});

check('judgeMartechRequests: accept needs one host per expected route', () => {
  const c = { mode: 'accept', expect: [{ id: 'launch', hosts: ['example.test'] }, { id: 'gtm', hosts: ['googletagmanager.com'] }] };
  assert.equal(judgeMartechRequests(['assets.example.test', 'www.googletagmanager.com'], c).pass, true);
  const miss = judgeMartechRequests(['assets.example.test'], c);
  assert.equal(miss.pass, false); assert.match(miss.detail, /gtm \(googletagmanager\.com\)/);
  assert.equal(judgeMartechRequests([], { mode: 'accept', expect: [] }).pass, false);
});

check('--help prints the header (naming expectCount) and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dynamics-check-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /search-query/); assert.match(r.stdout, /expectCount/);
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

console.log(failed ? `\ndynamics-check: ${failed} check(s) failed` : '\ndynamics-check: all checks passed');
process.exit(failed ? 1 : 0);
