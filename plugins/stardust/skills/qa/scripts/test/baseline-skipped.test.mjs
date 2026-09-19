#!/usr/bin/env node
/**
 * Fixture test for the visual-baseline gate (no network, no browser).
 * Run: node skills/qa/scripts/test/baseline-skipped.test.mjs
 *
 * Models the field failure this gate exists for: a first sweep on a host that
 * answers 429 froze the throttled render as the baseline, so the next honest
 * sweep reported dozens of visual-diff regressions that were the intended
 * fixes; two hand re-baselines later the same happened under a 503. The gate
 * refuses to write a baseline unless the page rendered cleanly.
 */
import { baselineSkipReason } from '../checks/browse.mjs';

let failed = 0;
const eq = (name, got, want) => { const ok = got === want; if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

eq('clean render → baseline allowed', baselineSkipReason({ mainCollapsed: false, badRequests: [] }), null);
eq('defaults → baseline allowed', baselineSkipReason(), null);
eq('collapsed main → skipped', baselineSkipReason({ mainCollapsed: true, badRequests: [] }), 'main collapsed');
eq('same-origin 429 → skipped', baselineSkipReason({ badRequests: ['HTTP 429 /styles/styles.css'] }), '1 same-origin response(s) ≥ 400 or failed (HTTP 429)');
eq('same-origin 503 twice → skipped, count carried', baselineSkipReason({ badRequests: ['HTTP 503 /scripts/aem.js', 'HTTP 503 /nav.plain.html'] }), '2 same-origin response(s) ≥ 400 or failed (HTTP 503)');
eq('network failure → skipped', baselineSkipReason({ badRequests: ['net::ERR_CONNECTION_RESET /index.plain.html'] }), '1 same-origin response(s) ≥ 400 or failed (net::ERR_CONNECTION_RESET /index.plain.html)');
eq('collapsed main wins over requests', baselineSkipReason({ mainCollapsed: true, badRequests: ['HTTP 429 /x'] }), 'main collapsed');

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('baseline gate: all assertions pass');
