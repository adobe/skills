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
import { captureQualityOf, SHOT_WRAP_PX, OVERLAY_FLAG_PCT } from '../../skills/extract/scripts/crawl.mjs';

assert.equal(captureQualityOf({ emptyMain: false, subResourceBlock: false, overlayCoverPct: 95, spaShellSuspect: true }), 'ok', 'overlay / SPA-shell flags do not degrade by themselves');
assert.equal(captureQualityOf({ emptyMain: true, subResourceBlock: false }), 'degraded', 'blank <main> with no real image → degraded');
assert.equal(captureQualityOf({ emptyMain: false, subResourceBlock: true, brokenImages: 12 }), 'degraded', 'edge-blocked images → degraded');
assert.equal(captureQualityOf(undefined), 'ok', 'no signals → ok (never throws)');

assert.ok(SHOT_WRAP_PX < 16384 && SHOT_WRAP_PX >= 12000, `SHOT_WRAP_PX ${SHOT_WRAP_PX} must sit just under the 16,384 px texture limit`);
assert.equal(OVERLAY_FLAG_PCT, 30, 'OVERLAY? fires above 30 % of the first viewport (crawl-log-lint.mjs mirrors the value)');

console.log('crawl-signals test: ok');
