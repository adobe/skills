#!/usr/bin/env node
// Fixture test: live-session.mjs gotoLive's live-side contract with a duck-typed
// page (module docstring § Live budget + live lock, § Challenge classification):
//   - the live lock is taken once per host and the budget awaited before EVERY
//     navigation (the same live-budget.mjs bucket the test pre-seeds with a fake clock);
//   - a BARE 429 → recordRateLimit (halved + persisted, learnedBy = tool),
//     Retry-After wait, ONE paced retry, then LiveHTTPError { status: 429,
//     rateLimited: true } even under httpError: 'measure'; a 200 on the retry is returned;
//   - an edge-signed 429/403 is a BotChallengeError (1 hit, nextTier named), never a rate limit;
//   - another live tool holding the host → LiveLockError (exit 1 in every importer);
//   - --solve-wait at tier 3: no reload during the poll, two clean polls resume,
//     expiry → BotChallengeError with nextTier null; a hidden window is WARNed;
//   - challengeMarker is the SAME function in live-session.mjs and crawl.mjs (vector table);
//   - captureSanity (stitch-shot's post-capture rule): short AND challenge/near-empty →
//     suspect (exit 3, nothing written); short alone → WARN; a full page → ok.
// Usage: node plugins/stardust/evals/fixtures/live-session-goto.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'stardust-goto-'));
process.env.STARDUST_LIVE_BUDGET = join(dir, 'live-budget.json');
process.env.STARDUST_LIVE_LOCK_DIR = join(dir, '.work');
delete process.env.STARDUST_LIVE_FORCE;
const lb = await import('../../skills/diff/scripts/live-budget.mjs');
const ls = await import('../../skills/diff/scripts/live-session.mjs');
const crawl = await import('../../skills/extract/scripts/crawl.mjs');
const { gotoLive, challengeMarker, CHALLENGE_PHRASE, captureSanity, CAPTURE_FLOOR } = ls;

let clock = 5_000_000; const slept = [];
const seed = (host) => lb.budgetFor(host, { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
const resp = (status, headers = {}, url = 'https://www.example.test/') => ({ status: () => status, headers: () => headers, url: () => url });
// duck page: `responses` are served in order by goto/reload; `dom` drives challengeInDom; `vis` the visibility read
function fakePage({ responses, dom = null, vis = 'visible' }) {
  const p = { gotos: [], reloads: 0, waits: [], polls: 0 };
  p.goto = async (url) => { p.gotos.push(url); return responses.shift(); };
  p.reload = async () => { p.reloads += 1; return responses.shift() || null; };
  p.waitForTimeout = async (ms) => { p.waits.push(ms); };
  p.evaluate = async (fn) => { if (String(fn).includes('visibilityState')) return vis; p.polls += 1; return typeof dom === 'function' ? dom(p.polls) : dom; };
  return p;
}
const errs = []; const origErr = console.error; console.error = (m) => errs.push(String(m));
try {
  // ---- bare 429 twice → halve + persist + one retry + LiveHTTPError ----
  seed('www.example.test');
  const p1 = fakePage({ responses: [resp(429, { 'retry-after': '9' }), resp(429, {})] });
  await assert.rejects(gotoLive(p1, 'https://www.example.test/pricing', { httpError: 'measure' }), (e) => e.name === 'LiveHTTPError' && e.status === 429 && e.rateLimited === true && /rerun alone, later/.test(e.message), 'bare 429 twice → LiveHTTPError rateLimited even under httpError: measure');
  assert.equal(p1.gotos.length, 2, 'exactly ONE retry');
  assert.deepEqual(p1.waits, [9000], 'Retry-After honoured before the retry');
  assert.ok(existsSync(join(dir, '.work', 'live-www.example.test.lock')), 'live lock taken on the first live navigation');
  const saved = JSON.parse(readFileSync(process.env.STARDUST_LIVE_BUDGET, 'utf8'))['www.example.test'];
  assert.equal(saved.navPerMin, 5); assert.equal(saved.lastStatus, 429); assert.equal(saved.learnedBy, 'live-session-goto.test.mjs', 'learnedBy = the calling tool');
  assert.ok(errs.some((l) => /HTTP 429 \(rate limit, no edge signature\)/.test(l) && /retrying once/.test(l)));
  // ---- bare 429 then 200 → the page ----
  const p2 = fakePage({ responses: [resp(429, {}), resp(200, {})] });
  const ok = await gotoLive(p2, 'https://www.example.test/about', { settleMs: 0 });
  assert.equal(ok.status(), 200); assert.equal(p2.gotos.length, 2);
  assert.ok(slept.length > 0, 'the budget paced the navigations (fake clock advanced)');
  assert.equal(lb.budgetFor('www.example.test').navPerMin, 2, 'each bare 429 halves the host ceiling again (5 → 2)');

  // ---- edge-signed 429 = challenge, not a rate limit ----
  seed('cf.example.test');
  const before = JSON.parse(readFileSync(process.env.STARDUST_LIVE_BUDGET, 'utf8'));
  const p3 = fakePage({ responses: [resp(429, { 'cf-ray': 'abc', server: 'cloudflare' })] });
  await assert.rejects(gotoLive(p3, 'https://cf.example.test/', { tier: 1 }), (e) => e.name === 'BotChallengeError' && e.nextTier === 2 && /Cloudflare edge signature/.test(e.marker), 'edge-signed 429 → BotChallengeError, nextTier 2');
  assert.equal(p3.gotos.length, 1, '1 hit at tier 1');
  assert.deepEqual(JSON.parse(readFileSync(process.env.STARDUST_LIVE_BUDGET, 'utf8')), before, 'a challenge never touches the rate ceiling');

  // ---- local URL: no lock, no budget, no module side effects ----
  const p4 = fakePage({ responses: [resp(200, {}, 'http://localhost:3000/')] });
  await gotoLive(p4, 'http://localhost:3000/', { settleMs: 0 });
  assert.ok(!existsSync(join(dir, '.work', 'live-localhost.lock')), 'a local prototype takes no live lock');

  // ---- another live tool holds the host → LiveLockError ----
  writeFileSync(join(dir, '.work', 'live-busy.example.test.lock'), JSON.stringify({ host: 'busy.example.test', pid: process.ppid, tool: 'crawl.mjs', startedAt: '2026-01-01T00:00:00Z' }));
  const p5 = fakePage({ responses: [resp(200, {})] });
  await assert.rejects(gotoLive(p5, 'https://busy.example.test/'), (e) => e.name === 'LiveLockError' && /crawl\.mjs/.test(e.message));
  assert.equal(p5.gotos.length, 0, 'refused BEFORE the first hit');

  // ---- --solve-wait at tier 3 ----
  seed('px.example.test');
  const walled = { len: 120, head: 'Press & Hold to confirm you are a human', dom: true, h: 900, vh: 900 };
  const clean = { len: 4200, head: 'Welcome to our products', dom: false, h: 5400, vh: 900 };
  // solved after the reload window: poll 1 walled, polls 2–3 clean → resumes (two clean polls), never reloads during the poll
  const p6 = fakePage({ responses: [resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' })], dom: (k) => (k <= 2 ? walled : clean) });
  const solved = await gotoLive(p6, 'https://px.example.test/', { tier: 3, solveWaitMs: 60000, settleMs: 0 });
  assert.equal(solved.status(), 403, 'the pre-solve response object is returned; callers read the DOM');
  assert.equal(p6.reloads, 3, 'the tier-3 reload window ran (3 attempts) BEFORE the hand-solve poll');
  assert.equal(p6.gotos.length, 1, 'no navigation during the poll — a reload destroys a Press & Hold in progress');
  assert.ok(p6.waits.filter((w) => w === 2500).length >= 2, 'polls every 2.5 s, two clean polls resume');
  assert.ok(errs.some((l) => /--solve-wait 60000: a visible Chrome window is open/.test(l)), 'operator banner once');
  // hidden window → WARN; expiry → BotChallengeError nextTier null (Date.now stubbed so the poll deadline passes without real waiting)
  const realNow = Date.now; let t = realNow(); Date.now = () => t;
  try {
    const p7 = fakePage({ responses: [resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' })], dom: walled, vis: 'hidden' });
    p7.waitForTimeout = async (ms) => { p7.waits.push(ms); t += ms; };
    await assert.rejects(gotoLive(p7, 'https://px.example.test/', { tier: 3, solveWaitMs: 5000 }), (e) => e.name === 'BotChallengeError' && e.nextTier === null && /not solved in 5000 ms/.test(e.message), 'expiry → BotChallengeError, nextTier null (exit 3, no verdict)');
    assert.ok(errs.some((l) => /WARN --solve-wait: the window is hidden/.test(l)), 'a hidden renderer is WARNed before the poll');
  } finally { Date.now = realNow; }
  // below the floor → the flag is ignored (plain tier-3 challenge path)
  const p8 = fakePage({ responses: [resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' }), resp(403, { 'cf-ray': 'x' })], dom: walled });
  await assert.rejects(gotoLive(p8, 'https://px.example.test/', { tier: 3, solveWaitMs: 1000 }), (e) => e.name === 'BotChallengeError' && e.nextTier === null);
  assert.equal(p8.polls, 0, 'solveWaitMs < 5000 never polls');

  // ---- challengeMarker: live-session.mjs === crawl.mjs on the vector table ----
  const vectors = [
    [200, { 'set-cookie': '_pxhd=abc; Path=/' }], [200, { 'cf-mitigated': 'challenge' }], [403, {}], [429, {}], [503, {}],
    [403, { 'set-cookie': '_px3=1\ndatadome=2' }], [401, { 'x-datadome': 'protected' }], [400, { server: 'AkamaiGHost' }], [400, { 'x-akamai-request-id': 'r' }], [400, {}],
    [403, { 'cf-ray': 'r', server: 'cloudflare' }], [503, { server: 'AkamaiGHost' }], [429, { 'x-iinfo': 'i' }], [403, { server: 'BigIP' }], [403, { server: 'nginx' }],
    [403, {}, 'https://x.edgesuite.net/'], [500, { 'set-cookie': 'datadome=x' }],
  ];
  for (const [status, headers, url = 'https://www.example.test/'] of vectors) assert.equal(challengeMarker(status, headers, url), crawl.challengeMarker(status, headers, url), `challengeMarker mirror drifted for ${status} ${JSON.stringify(headers)}`);
  assert.equal(challengeMarker(429, {}), null, 'bare 429 is a rate limit, not a challenge (both copies)');
  assert.equal(challengeMarker(403, { 'set-cookie': '_pxhd=abc' }), 'HTTP 403 + set-cookie _pxhd (PerimeterX/DataDome wall)');
  assert.equal(challengeMarker(400, { server: 'AkamaiGHost' }), 'HTTP 400 + AkamaiGHost (Akamai escalation body, not the page)');
  assert.equal(String(CHALLENGE_PHRASE), String(crawl.CHALLENGE_PHRASE), 'CHALLENGE_PHRASE mirror drifted');
} finally { console.error = origErr; }

// ---- captureSanity: stitch-shot's post-capture rule (T14.3 (c)) ----
assert.deepEqual(CAPTURE_FLOOR, { vhRatio: 1.5, textLen: 800, emptyLen: 400 }, 'the sanity floors are the solve poll\'s (1.5 viewports, 800 chars) plus the near-empty floor');
const vh = 900;
assert.equal(captureSanity({ totalH: 5400, vh, textLen: 4200 }).verdict, 'ok', 'a full page passes');
assert.equal(captureSanity({ totalH: 5400, vh, textLen: 4200, walled: true }).verdict, 'ok', 'a tall page with an inline captcha widget is not short — never refused by this rule');
assert.equal(captureSanity({ totalH: 900, vh, textLen: 120, walled: true }).verdict, 'suspect', 'the recorded trap: 1 viewport, challenge DOM/phrase → suspect (exit 3)');
assert.equal(captureSanity({ totalH: 900, vh, textLen: 120 }).verdict, 'suspect', 'short AND near-empty (no phrase matched) → suspect');
assert.equal(captureSanity({ totalH: 4000, vh, textLen: 300 }).verdict, 'suspect', 'tall but near-empty text (a blank shell) → suspect');
const legal = captureSanity({ totalH: 1200, vh, textLen: 600 });
assert.equal(legal.verdict, 'short', 'a genuinely short contact/legal page (≤ 1.5 viewports, real text) is a WARN, not a refusal');
assert.match(legal.reason, /1200px tall \(1\.33 viewports\), 600 chars/);
assert.match(captureSanity({ totalH: 900, vh, textLen: 120, walled: true }).reason, /challenge DOM\/phrase present/);
assert.match(captureSanity({ totalH: 900, vh, textLen: 120 }).reason, /near-empty/);
assert.equal(captureSanity({ totalH: 1350, vh, textLen: 800 }).verdict, 'ok', 'exactly at the floors is not short');
console.log('live-session-goto test: ok (lock + budget on live hosts, bare-429 path, edge-signed challenge, --solve-wait poll, challengeMarker mirror, captureSanity)');
