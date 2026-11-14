#!/usr/bin/env node
// skills/qa/scripts/test/video-not-playing.test.mjs — judgeVideos, the pure verdict behind the
// rendered `video-not-playing` row: an autoplay <video> at least a quarter visible must be playing
// (not paused, currentTime advancing, buffered to readyState ≥ 2). Presence is not playback — the
// recorded defect shipped "poster + paused video" across a site while every parity row was green.
// Fixtures only: no browser, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { judgeVideos } from '../checks/browse.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const v = (o = {}) => ({ src: '/media/hero.mp4', autoplay: true, visible: 1, readyState: 4, error: null, paused: false, dt: 0.8, ...o });

check('the recorded defect: autoplay video present, controllable, paused at frame 0 → one finding', () => {
  const r = judgeVideos([v({ paused: true, dt: 0 })]);
  assert.equal(r.length, 1); assert.equal(r[0].why, 'is paused (Δt 0.00s) while ≥ ¼ visible');
});
check('unpaused but not advancing (stalled) and never buffered (readyState 0, content.da.live 401) are findings', () => {
  assert.equal(judgeVideos([v({ dt: 0 })])[0].why, 'is not advancing (Δt 0.00s) while ≥ ¼ visible');
  assert.match(judgeVideos([v({ readyState: 0, dt: 0 })])[0].why, /^never buffered \(readyState 0\) — poster only/);
  assert.match(judgeVideos([v({ readyState: 1, error: 4, dt: 0 })])[0].why, /readyState 1, MediaError 4/);
});
check('a playing autoplay video, a click-to-play video, and an autoplay video under a quarter visible are not findings', () => {
  assert.deepEqual(judgeVideos([v(), v({ autoplay: false, paused: true, dt: 0 }), v({ visible: 0.2, paused: true, dt: 0 })]), []);
});
check('the finding carries the evidence the report needs: src, readyState, paused, dt', () => {
  const [f] = judgeVideos([v({ paused: true, dt: 0, src: 'https://content.da.live/org/site/hero.mp4' })]);
  assert.equal(f.src, 'https://content.da.live/org/site/hero.mp4'); assert.equal(f.readyState, 4); assert.equal(f.paused, true); assert.equal(f.dt, 0);
});

console.log(failed ? `\nvideo-not-playing: ${failed} check(s) failed` : '\nvideo-not-playing: all checks passed');
process.exit(failed ? 1 : 0);
