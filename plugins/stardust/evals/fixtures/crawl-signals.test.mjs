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
import { captureQualityOf, SHOT_WRAP_PX, OVERLAY_FLAG_PCT, challengeMarker, CHALLENGE_PHRASE } from '../../skills/extract/scripts/crawl.mjs';

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

console.log('crawl-signals test: ok');
