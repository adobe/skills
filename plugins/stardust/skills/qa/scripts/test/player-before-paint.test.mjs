#!/usr/bin/env node
// skills/qa/scripts/test/player-before-paint.test.mjs — judgePlayerRequests, the pure verdict behind the
// rendered `player-before-paint` row (deploy SKILL.md #157): a player-host request that starts before
// the first contentful paint is a finding; one after it, a non-player host, or a poster image is not;
// one with no browser start time is bounded (heard before FCP, or its frame created after it) or
// reported unmeasured, never assumed after the paint.
// Fixtures only: no browser, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { judgePlayerRequests } from '../checks/perf.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const FCP = 1_000_000;
// a request whose browser start is known; `heard` lags it, as a busy process does
const r = (url, t, type = 'document') => ({ url, t, type, heard: t + 1500, after: null });
const early = (reqs) => judgePlayerRequests(reqs, FCP).early;

check('the recorded defect: the embed document and player script requested before FCP → both flagged', () => {
  const got = early([
    r('https://www.youtube.com/embed/abc', FCP - 300), r('https://www.youtube.com/s/player/x/base.js', FCP - 116, 'script'),
  ]);
  assert.deepEqual(got.map((x) => x.msBeforeFcp), [300, 116]);
});
check('a player mounted after first paint, and non-player hosts before it, are not findings', () => {
  assert.deepEqual(early([
    r('https://www.youtube.com/embed/abc', FCP + 50), r('https://player.vimeo.com/video/1', FCP + 1),
    r('https://img.example.com/poster.jpg', FCP - 400), r('https://main--site--org.aem.page/scripts/aem.js', FCP - 900),
  ]), []);
});
check('click-to-load posters served from player hosts are not findings; player API calls are', () => {
  assert.deepEqual(early([
    r('https://cdn.jwplayer.com/v2/media/abc/poster.jpg', FCP - 200, 'image'),
    r('https://embed-ssl.wistia.com/deliveries/abc.jpg', FCP - 200, 'image'),
  ]), []);
  assert.equal(early([r('https://player.vimeo.com/video/1/config', FCP - 5, 'fetch')]).length, 1);
});
check('hosts match on a dot boundary, never a substring', () => {
  assert.deepEqual(early([
    r('https://www.youtube.com.evil.example/x', FCP - 1), r('https://cdn.example.com/?u=youtube.com', FCP - 1), r('not a url', FCP - 1),
  ]), []);
  assert.equal(early([r('https://player.vimeo.com/video/1', FCP - 1)]).length, 1);
});
check('no browser start time: heard before FCP is early; a frame created after FCP is not; else unmeasured', () => {
  const api = (o) => ({ url: 'https://www.youtube.com/api/stats', type: 'fetch', t: null, after: null, ...o });
  const heardEarly = judgePlayerRequests([api({ heard: FCP - 40 })], FCP);
  assert.deepEqual(heardEarly, { early: [{ url: api({}).url, type: 'fetch', msBeforeFcp: 40 }], unmeasured: [] });
  assert.deepEqual(judgePlayerRequests([api({ heard: FCP + 900, after: FCP + 20 })], FCP), { early: [], unmeasured: [] });
  assert.deepEqual(judgePlayerRequests([api({ heard: FCP + 900, after: FCP - 300 })], FCP).unmeasured, [{ url: api({}).url, type: 'fetch' }]);
  assert.equal(judgePlayerRequests([api({ heard: FCP + 900 })], FCP).unmeasured.length, 1, 'never silently after the paint');
});
check('no FCP recorded judges nothing (a page that never painted is load-timeout / lcp-poor territory)', () => {
  const none = { early: [], unmeasured: [] };
  assert.deepEqual(judgePlayerRequests([r('https://www.youtube.com/embed/abc', 1)], 0), none);
  assert.deepEqual(judgePlayerRequests([r('https://www.youtube.com/embed/abc', 1)], undefined), none);
});

console.log(failed ? `\nplayer-before-paint: ${failed} check(s) failed` : '\nplayer-before-paint: all checks passed');
process.exit(failed ? 1 : 0);
