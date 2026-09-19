#!/usr/bin/env node
// Fixture test: crawl.mjs capture-quality contract (extract/reference/
// current-state-schema.md § _signals describes these):
//   captureQualityOf → 'degraded' on emptyMain or subResourceBlock, else 'ok'
//   (overlayCoverPct and spaShellSuspect are flags, never degrade on their own);
//   SHOT_WRAP_PX sits under Chromium's 16,384 px texture limit (banding fires
//   before the raster silently wraps); OVERLAY_FLAG_PCT is the page-line threshold.
// Runs without playwright: crawl.mjs imports it lazily inside main().
// Usage: node plugins/stardust/evals/fixtures/crawl-signals.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { captureQualityOf, SHOT_WRAP_PX, OVERLAY_FLAG_PCT, challengeMarker, CHALLENGE_PHRASE, HostBudget, BUDGET_DEFAULT, parseRetryAfter, mergeLiveBudget } from '../../skills/extract/scripts/crawl.mjs';

assert.equal(captureQualityOf({ emptyMain: false, subResourceBlock: false, overlayCoverPct: 95, spaShellSuspect: true }), 'ok', 'overlay / SPA-shell flags do not degrade by themselves');
assert.equal(captureQualityOf({ emptyMain: true, subResourceBlock: false }), 'degraded', 'blank <main> with no real image → degraded');
assert.equal(captureQualityOf({ emptyMain: false, subResourceBlock: true, brokenImages: 12 }), 'degraded', 'edge-blocked images → degraded');
assert.equal(captureQualityOf(undefined), 'ok', 'no signals → ok (never throws)');

assert.ok(SHOT_WRAP_PX < 16384 && SHOT_WRAP_PX >= 12000, `SHOT_WRAP_PX ${SHOT_WRAP_PX} must sit just under the 16,384 px texture limit`);
assert.equal(OVERLAY_FLAG_PCT, 30, 'OVERLAY? fires above 30 % of the first viewport (crawl-log-lint.mjs mirrors the value)');

// challengeMarker — the header/status/set-cookie stage (playwright-recipe.md § Bot-management fallback)
assert.ok(challengeMarker(200, { 'cf-mitigated': 'challenge' }), 'cf-mitigated: challenge at any status');
assert.ok(challengeMarker(403, { 'cf-ray': 'abc', server: 'cloudflare' }), 'Cloudflare 403');
assert.ok(challengeMarker(503, { server: 'AkamaiGHost' }), 'Akamai 503');
assert.ok(challengeMarker(403, {}, 'https://errors.edgesuite.net/12345'), 'edgesuite interstitial by URL');
assert.equal(challengeMarker(403, {}), null, 'bare 403 = app-level status, not a challenge');
assert.equal(challengeMarker(429, {}), null, 'bare 429 = rate limit (HostBudget), never a challenge');
assert.equal(challengeMarker(400, {}), null, 'bare 400 stays an HTTP error');
assert.match(challengeMarker(400, { server: 'AkamaiGHost', 'content-type': 'application/json' }), /AkamaiGHost/, 'Akamai escalation body: HTTP 400 + AkamaiGHost');
assert.match(challengeMarker(400, { 'x-akamai-request-id': 'x' }), /AkamaiGHost/, 'any x-akamai-* header on a 400');
assert.match(challengeMarker(403, { server: 'Varnish', 'set-cookie': '_pxhd=abc; Path=/; Secure\n_px3=def; Path=/' }), /set-cookie _pxhd \(PerimeterX/, 'PerimeterX 403 via Varnish: only the cookie names identify it');
assert.match(challengeMarker(403, { 'set-cookie': 'datadome=xyz; Path=/' }), /datadome/, 'DataDome cookie on a 403');
assert.match(challengeMarker(403, { 'x-datadome': 'protected' }), /DataDome/, 'DataDome header on a 403');
assert.equal(challengeMarker(200, { 'set-cookie': '_pxvid=v; Path=/' }), null, 'a served 200 with PX ids is the page, not a wall');
assert.equal(challengeMarker(200, { 'x-datadome': 'protected' }), null, 'DataDome header on an admitted 200 is normal');
assert.equal(challengeMarker(404, { 'set-cookie': 'session=1' }), null, 'unrelated cookies never classify');
assert.ok(CHALLENGE_PHRASE.test('Press & Hold to confirm you are a human') && CHALLENGE_PHRASE.test('Access to this page has been denied.') && !CHALLENGE_PHRASE.test('Hold on to your hats — new arrivals'), 'phrase table');

// HostBudget — pacing per host with a fake clock (SKILL.md § Concurrency: ≥ 3 s gap, ≤ 10/min, halve on a bare 429)
assert.deepEqual(BUDGET_DEFAULT, { navPerMin: 10, minGapMs: 3000 });
let clock = 1_000_000; const slept = [];
const budget = new HostBudget({ now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
await budget.take();
assert.deepEqual(slept, [], 'first navigation is immediate');
await budget.take();
assert.deepEqual(slept, [3000], 'second navigation waits the minimum gap');
for (let i = 2; i < 20; i += 1) await budget.take(); // 20 navigations at the 3 s gap = 57 s; tokens refill at 1 per 6 s → dry now
const before = slept.length; await budget.take();
assert.ok(slept.slice(before).reduce((a, b) => a + b, 0) > 3000, 'once the bucket is dry a navigation waits for a token (≈ 6 s), not just the 3 s gap');
const t0 = clock; const w = budget.rateLimited(null);
assert.equal(budget.navPerMin, 5, 'bare 429 halves the rate'); assert.equal(budget.minGapMs, 6000, 'and doubles the gap');
assert.equal(w, 24000, 'no Retry-After → wait 4 gaps before the one retry');
assert.equal(new HostBudget({ now: () => clock, sleep: async () => {} }).rateLimited(120), 60000, 'Retry-After is honoured but capped at 60 s');
const tiny = new HostBudget({ navPerMin: 1, now: () => clock, sleep: async () => {} }); tiny.rateLimited(); tiny.rateLimited();
assert.equal(tiny.navPerMin, 1, 'rate never drops below 1/min'); assert.equal(tiny.minGapMs, 12000);
assert.equal(budget.source, 'rate-limited'); assert.equal(budget.rateLimits, 1);
assert.deepEqual(budget.toJSON(), { navPerMin: 5, minGapMs: 6000, source: 'rate-limited' }, 'the block written to discovery.liveBudget');
assert.ok(clock === t0, 'rateLimited never sleeps by itself');
const seq = []; const b2 = new HostBudget({ minGapMs: 1000, now: () => clock, sleep: async (ms) => { clock += ms; } });
await Promise.all([b2.take().then(() => seq.push('a')), b2.take().then(() => seq.push('b')), b2.take().then(() => seq.push('c'))]);
assert.deepEqual(seq, ['a', 'b', 'c'], 'concurrent workers are serialised in order');
assert.equal(parseRetryAfter('30'), 30); assert.equal(parseRetryAfter(undefined), null); assert.equal(parseRetryAfter('soon'), null);
assert.ok(parseRetryAfter(new Date(Date.now() + 45000).toUTCString()) >= 44, 'HTTP-date form → seconds from now');
assert.deepEqual(mergeLiveBudget({ 'a.example': { navPerMin: 3 } }, 'b.example', { navPerMin: 5, minGapMs: 6000 }), { 'a.example': { navPerMin: 3 }, 'b.example': { navPerMin: 5, minGapMs: 6000 } }, 'merge-by-host keeps other hosts');
assert.deepEqual(mergeLiveBudget(null, 'a.example', { navPerMin: 1 }), { 'a.example': { navPerMin: 1 } });

console.log('crawl-signals test: ok');
