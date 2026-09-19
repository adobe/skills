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
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureQualityOf, SHOT_WRAP_PX, OVERLAY_FLAG_PCT, challengeMarker, CHALLENGE_PHRASE, HostBudget, BUDGET_DEFAULT, parseRetryAfter, mergeLiveBudget, tuneBudget, LIVE_BUDGET_TTL_MS, sessionReusedOf, UNPACED_DISCOVERY, exitCodeOf, noteRateLimited, probeRateLimited, needsStateSave, ACCEPT_LABELS, DECLINE_LABELS, SETTINGS_LABELS } from '../../skills/extract/scripts/crawl.mjs';
import * as liveSession from '../../skills/diff/scripts/live-session.mjs';

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

// HostBudget — pacing per host with a fake clock (crawl.mjs header § Live budget: ≥ 3 s gap, ≤ 10/min, halve on a bare 429)
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


// tuneBudget — the ONE instance created before the probe is tightened in place, never loosened
const dir = mkdtempSync(join(tmpdir(), 'crawl-budget-')); const args = { out: join(dir, 'current') };
writeFileSync(join(dir, 'live-budget.json'), JSON.stringify({ 'www.example.test': { navPerMin: 4, minGapMs: 8000 }, 'loose.example.test': { navPerMin: 30, minGapMs: 500 } }));
const fresh = () => new HostBudget({ ...BUDGET_DEFAULT, source: 'default', now: () => clock, sleep: async () => {} });
assert.deepEqual(tuneBudget(fresh(), args, 'example.test', null).toJSON(), { navPerMin: 10, minGapMs: 3000, source: 'default' }, 'no learned entry → defaults');
assert.deepEqual(tuneBudget(fresh(), args, 'www.example.test', null).toJSON(), { navPerMin: 4, minGapMs: 8000, source: 'live-budget.json' }, 'apex→www adoption re-keys and picks up the www ceiling');
assert.deepEqual(tuneBudget(fresh(), args, 'loose.example.test', null).toJSON(), { navPerMin: 10, minGapMs: 3000, source: 'default' }, 'a looser learned entry never loosens the default');
assert.deepEqual(tuneBudget(fresh(), args, 'example.test', 12).toJSON(), { navPerMin: 10, minGapMs: 12000, source: 'robots Crawl-delay' }, 'Crawl-delay widens the gap after discovery');
const hit = fresh(); hit.rateLimited(null); tuneBudget(hit, args, 'www.example.test', 5);
assert.deepEqual(hit.toJSON(), { navPerMin: 4, minGapMs: 8000, source: 'rate-limited' }, 'a probe 429 already taken keeps its source; the stricter learned values still apply');
// learned ceilings expire (crawl.mjs header § Live budget: LIVE_BUDGET_TTL_MS after learnedAt) — one 429 must not slow every later run forever
assert.equal(LIVE_BUDGET_TTL_MS, 7 * 24 * 3600 * 1000, 'same constant as live-budget.mjs');
writeFileSync(join(dir, 'live-budget.json'), JSON.stringify({ 'old.example.test': { navPerMin: 1, minGapMs: 30000, learnedAt: new Date(Date.now() - LIVE_BUDGET_TTL_MS - 60000).toISOString() }, 'recent.example.test': { navPerMin: 1, minGapMs: 30000, learnedAt: new Date().toISOString() } }));
const quiet = console.error; console.error = () => {};
try {
  assert.deepEqual(tuneBudget(fresh(), args, 'old.example.test', null).toJSON(), { navPerMin: 10, minGapMs: 3000, source: 'default' }, 'an expired ceiling is ignored');
  assert.deepEqual(tuneBudget(fresh(), args, 'recent.example.test', null).toJSON(), { navPerMin: 1, minGapMs: 30000, source: 'live-budget.json' }, 'a recent one applies');
} finally { console.error = quiet; }
// sessionReusedOf — _provenance.storageState is a pin, not a constant (current-state-schema.md § Top-level shape)
assert.equal(sessionReusedOf({}), false, 'plain headless run, 0 cookies → false');
assert.equal(sessionReusedOf({ botBlock: 'challenge' }), true, 'a cleared challenge is an admitted session');
assert.equal(sessionReusedOf({ loadedState: '/x/_storage-state.json' }), true, 'a loaded reserved/explicit file is reuse');
assert.equal(sessionReusedOf({ cookies: 3 }), true, 'a probe clone that carries cookies is reuse');
assert.equal(sessionReusedOf({ botBlock: null, loadedState: null, cookies: 0 }), false);
// exit codes (crawl.mjs header): a held live lock is 1 (wait for the other tool), a challenge 3, anything else 2
assert.equal(exitCodeOf({ errorClass: 'LiveLockError' }), 1, 'LiveLockError exits 1, not 2');
assert.equal(exitCodeOf({ errorClass: 'BotChallengeError' }), 3); assert.equal(exitCodeOf({ errorClass: 'HTTPError', rateLimited: true }), 2); assert.equal(exitCodeOf(new Error('x')), 2); assert.equal(exitCodeOf(null), 2);
// a bare 429 in the pool drops the pool to ONE worker (header § Live budget) — not just a flag other workers read
const pool = noteRateLimited({ concurrency: 4 });
assert.equal(pool.throttled, true); assert.equal(pool.concurrency, 1, 'concurrency 4 → 1 after the first bare 429 (the log and the escalated pass inherit it)');
assert.equal(noteRateLimited({ concurrency: 1 }).concurrency, 1);
// the PROBE's bare 429 takes the same path as a worker's — ONE worker, halved
// ceiling persisted (ia-extraction.md § _crawl-log.json: concurrency 1 after a bare 429)
const probeDir = mkdtempSync(join(tmpdir(), 'crawl-probe-429-')); const probeOut = join(probeDir, 'current'); mkdirSync(probeOut);
const pa = { concurrency: 4, out: probeOut, budget: new HostBudget({ now: () => 0, sleep: async () => {} }) };
const perr = []; const origErr = console.error; console.error = (m) => perr.push(String(m));
let probeWait; try { probeWait = probeRateLimited(pa, 'www.example.test', { headers: () => ({ 'retry-after': '7' }) }); } finally { console.error = origErr; }
assert.equal(probeWait, 7000, 'Retry-After honoured before the ONE retry');
assert.equal(pa.concurrency, 1, 'a probe 429 drops the pool to ONE worker before it spawns — not just args.throttled');
assert.equal(pa.throttled, true);
const learnedProbe = JSON.parse(readFileSync(join(probeDir, 'live-budget.json'), 'utf8'))['www.example.test'];
assert.equal(learnedProbe.navPerMin, 5); assert.equal(learnedProbe.lastStatus, 429); assert.equal(learnedProbe.learnedBy, 'crawl.mjs');
assert.ok(perr.some((l) => /on the probe — pool → 1 worker/.test(l)), 'the probe line names the pool drop');
// every bare-429 site goes through noteRateLimited: the flag is set in exactly one place
const crawlSrc = readFileSync(new URL('../../skills/extract/scripts/crawl.mjs', import.meta.url), 'utf8');
assert.equal((crawlSrc.match(/args\.throttled = true/g) || []).length, 1, 'args.throttled is assigned only inside noteRateLimited — a bare 429 anywhere must also drop concurrency');
// the state file is (re)written after a capture-time escalation — the pre-pool save was the PRE-escalation state
assert.equal(needsStateSave({ botBlock: 'challenge', savedState: null }), true, 'cleared at the probe, not yet saved');
assert.equal(needsStateSave({ botBlock: 'challenge', savedState: '/x/_storage-state.json', escalatedAtCapture: false }), false, 'already saved, no escalation since');
assert.equal(needsStateSave({ botBlock: 'challenge', savedState: '/x/_storage-state.json', escalatedAtCapture: true }), true, 'a capture-time escalation re-saves: the admitted session is the worker\'s');
assert.equal(needsStateSave({ saveState: true, savedState: '/x/_storage-state.json', escalatedAtCapture: true }), true, '--save-state follows the same rule');
assert.equal(needsStateSave({ botBlock: null, saveState: false, escalatedAtCapture: true }), false, 'no cleared challenge and no --save-state → nothing to save');
assert.ok(UNPACED_DISCOVERY.has('/robots.txt') && UNPACED_DISCOVERY.has('/sitemap.aspx') && !UNPACED_DISCOVERY.has('/sitemaps/pages.xml'), 'only the ≤ 5 guessed probes skip the budget; declared children and BFS hops are paced');

// dismissConsent mirrors live-session.mjs dismissOverlays' consent pass (D3: the
// lift, the capture and the gate click the SAME control). Static contract on the
// source — the behaviours a browser run would exercise are pinned by shape:
assert.deepEqual(ACCEPT_LABELS, liveSession.ACCEPT_LABELS, 'ACCEPT_LABELS is a verbatim copy of live-session.mjs (crawl.mjs ships alone — cannot import)');
assert.deepEqual(DECLINE_LABELS, liveSession.DECLINE_LABELS, 'DECLINE_LABELS copy');
assert.deepEqual(SETTINGS_LABELS, liveSession.SETTINGS_LABELS, 'SETTINGS_LABELS copy');
assert.ok(ACCEPT_LABELS.includes('godta alle') && DECLINE_LABELS.includes('avvis alle'), 'multilingual set reaches nb (the recorded Norwegian banner)');
const dismissSrc = (crawlSrc.match(/async function dismissConsent\(page\) \{[\s\S]*?\n\}\n/) || [''])[0];
assert.ok(dismissSrc.length > 200, 'dismissConsent found');
assert.match(dismissSrc, /isVisible\(\)/, 'visible-match: every candidate iterates all matches and clicks the first visible one');
assert.doesNotMatch(dismissSrc, /page\.\$\(|\.first\(\)/, 'no page.$ / .first() — the hidden-twin trap');
assert.match(dismissSrc, /pageClickInShadow, \{ hostSel: '#usercentrics-root'/, 'known shadow-hosted CMP by host + testid');
assert.match(dismissSrc, /pageFindLabelled, \{ labels: ACCEPT_LABELS, marker: MARK, requireOverlay: true \}/, 'text fallback uses the shared accept table, overlay-scoped, light DOM + open shadow roots');
assert.match(dismissSrc, /for \(const frame of page\.frames\(\)\)[\s\S]*labels: \[\.\.\.CLOSE_LABELS, \.\.\.DECLINE_LABELS\]/, 'frames() pass closes iframe-hosted invites with close/decline labels');
assert.match(crawlSrc, /function pageFindLabelled\([\s\S]*?if \(el\.shadowRoot\) roots\.push\(el\.shadowRoot\)/, 'generic open-shadow-root walk in the label finder');
assert.match(crawlSrc, /waitForTimeout\(WAIT_MS\[args\.wait\] \|\| WAIT_MS\.medium\);[\s\S]{0,600}?const late = await dismissConsent\(page\);/, 'dismissConsent re-runs AFTER the wait (late-mounted banner)');
assert.equal((crawlSrc.match(/await dismissConsent\(page\)/g) || []).length, 2, 'exactly two consent passes per page: pre-wait and post-wait');
assert.match(crawlSrc, /SOURCE OF TRUTH: skills\/diff\/scripts\/live-session\.mjs/, 'the copy names its source of truth (launch-ladder.mjs enforces byte parity)');

console.log('crawl-signals test: ok');
