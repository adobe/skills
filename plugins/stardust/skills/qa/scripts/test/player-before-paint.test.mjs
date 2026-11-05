#!/usr/bin/env node
// skills/qa/scripts/test/player-before-paint.test.mjs — judgePlayerRequests, the pure verdict behind the
// rendered `player-before-paint` row (deploy SKILL.md #157): a player-host request that starts before
// the first contentful paint is a finding; one after it, or a non-player host, is not.
// Fixtures only: no browser, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { judgePlayerRequests } from '../checks/perf.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const FCP = 1_000_000;
const r = (url, t) => ({ url, t });

check('the recorded defect: the embed document and player script requested before FCP → both flagged', () => {
  const got = judgePlayerRequests([
    r('https://www.youtube.com/embed/abc', FCP - 300), r('https://www.youtube.com/s/player/x/base.js', FCP - 116),
  ], FCP);
  assert.deepEqual(got.map((x) => x.msBeforeFcp), [300, 116]);
});
check('a player mounted after first paint, and non-player hosts before it, are not findings', () => {
  assert.deepEqual(judgePlayerRequests([
    r('https://www.youtube.com/embed/abc', FCP + 50), r('https://player.vimeo.com/video/1', FCP + 1),
    r('https://img.example.com/poster.jpg', FCP - 400), r('https://main--site--org.aem.page/scripts/aem.js', FCP - 900),
  ], FCP), []);
});
check('hosts match on a dot boundary, never a substring', () => {
  assert.deepEqual(judgePlayerRequests([
    r('https://www.youtube.com.evil.example/x', FCP - 1), r('https://cdn.example.com/?u=youtube.com', FCP - 1), r('not a url', FCP - 1),
  ], FCP), []);
  assert.equal(judgePlayerRequests([r('https://player.vimeo.com/video/1', FCP - 1)], FCP).length, 1);
});
check('no FCP recorded judges nothing (a page that never painted is load-timeout / lcp-poor territory)', () => {
  assert.deepEqual(judgePlayerRequests([r('https://www.youtube.com/embed/abc', 1)], 0), []);
  assert.deepEqual(judgePlayerRequests([r('https://www.youtube.com/embed/abc', 1)], undefined), []);
});

console.log(failed ? `\nplayer-before-paint: ${failed} check(s) failed` : '\nplayer-before-paint: all checks passed');
process.exit(failed ? 1 : 0);
