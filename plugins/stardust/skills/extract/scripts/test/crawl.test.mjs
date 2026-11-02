#!/usr/bin/env node
// skills/extract/scripts/test/crawl.test.mjs — the crawl.mjs pure helpers, on fixture HTML and without a
// browser or network: locale-root detection by path shape, the first-level capture-gap listing per root
// (same-origin links on the root page under its own path, minus what the crawl captured; query, hash and
// trailing slash folded; assets, mailto:/tel: and other hosts dropped; www. folded), the ready ledger
// detail string, both link-list shapes — and that importing the module or asking --help starts no crawl
// and writes nothing. The bot walls, on stub pages (no browser): the header classifier (Cloudflare / Akamai /
// F5 / CloudFront-AWS WAF signatures, a bare 403 is not a challenge), the fingerprint-reject test, the inline
// 2xx-interstitial rule and its title regex, --page-timeout parsing; probeEntry — the page, a challenge, a
// fingerprint block, a 2xx interstitial, the escalated probe's solve window; capturePage — a clean page is a
// record, a 2xx interstitial / an uncleared 403 challenge / a CloudFront 403 on an inner page are BotChallenge
// failures naming the wall (a bare 403 stays HTTPError), a navigation that never settles is a TimeoutError under
// the per-page deadline and the tab is closed. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureGaps, localeRootPath, maxPages, pageTimeoutMs, PAGE_TIMEOUT_MS_DEFAULT, challengeMarker, isChallengeResponse, isFingerprintBlock, WALL_TITLE, WALL_TEXT_MAX_BYTES, wallProbeInPage, inlineWallMarker, probeEntry, capturePage } from '../crawl.mjs';

// the stub pages below navigate one host back-to-back; live-session's per-host pacing has its own tests
process.env.STARDUST_LIVE_PACE_MS = '0';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'crawl.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// stderr lines console.error printed while fn ran
const stderrOf = async (fn) => {
  const lines = []; const saved = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = saved; }
  return lines;
};

// The fixture's links the way the browser hands them to capture(): every a[href], resolved against the page.
const hrefs = (html, base) => [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1], base).href; } catch { return null; } }).filter(Boolean);

const ROOT_HTML = `<!doctype html><html lang="en-CA"><body>
<nav>
  <a href="/ca/en/">Home</a>
  <a href="/ca/en/about">About us</a>
  <a href="https://www.example.com/ca/en/products/">Products</a>
  <a href="/ca/en/products/widget?ref=nav">Widget</a>
  <a href="/ca/en/news#latest">News</a>
  <a href="/ca/en/news/">News (again)</a>
  <a href="/ca/fr/">Français</a>
  <a href="/">Global</a>
  <a href="/ca/en/brochure.pdf">Brochure</a>
  <a href="/ca/en/hero.jpg">Image</a>
  <a href="mailto:hello@example.com">Mail</a>
  <a href="tel:+15550100">Call</a>
  <a href="https://other.example.org/ca/en/x">Partner</a>
  <a href="#top">Top</a>
</nav></body></html>`;

check('localeRootPath: one or two segments of locale codes are roots (trailing slash, query, hash ignored; case kept); anything else is not', () => {
  for (const [u, want] of [
    ['https://x.example/en', '/en'], ['https://x.example/en/', '/en'], ['https://x.example/fr-ca', '/fr-ca'], ['https://x.example/de_DE/', '/de_DE'],
    ['https://x.example/ca/en', '/ca/en'], ['https://x.example/ca/en/?q=1#x', '/ca/en'], ['https://x.example/zh-hant', '/zh-hant'], ['https://x.example/it', '/it'],
    ['https://x.example/', null], ['https://x.example/about', null], ['https://x.example/ca/en/about', null], ['https://x.example/en/products', null],
    ['https://x.example/pricing', null], ['https://x.example/en-us-west', null], ['not a url', null], [undefined, null],
  ]) assert.equal(localeRootPath(u), want, String(u));
});
check('captureGaps: first-level targets under a captured locale root minus the captured ones — query/hash/slash and www. folded; assets, mailto:, tel:, other hosts, other subtrees and the root itself dropped; a root whose targets are all captured lists 0; the ledger detail is ready', () => {
  const records = [
    { slug: 'index', url: 'https://example.com/', finalUrl: 'https://example.com/', links: ['https://example.com/ca/en/', 'https://example.com/about'] },
    { slug: 'ca-en', url: 'https://example.com/ca/en', finalUrl: 'https://example.com/ca/en/', links: hrefs(ROOT_HTML, 'https://example.com/ca/en/') },
    { slug: 'ca-en-about', url: 'https://example.com/ca/en/about', finalUrl: 'https://example.com/ca/en/about', links: [] },
    { slug: 'fr-fr', url: 'https://example.com/fr/fr/', finalUrl: 'https://example.com/fr/fr/', links: { internal: ['/fr/fr/a-propos', 'https://example.com/fr/fr/produits/'], external: ['https://other.example.org/'] } },
    { slug: 'fr-fr-a-propos', url: 'https://example.com/fr/fr/a-propos/', finalUrl: 'https://example.com/fr/fr/a-propos/', links: [] },
    { slug: 'fr-fr-produits', url: 'https://example.com/fr/fr/produits', finalUrl: 'https://www.example.com/fr/fr/produits/', links: [] },
  ];
  const { roots, detail } = captureGaps(records);
  assert.deepEqual(roots, [
    { root: '/ca/en', slug: 'ca-en', linked: 4, uncaptured: ['/ca/en/news', '/ca/en/products', '/ca/en/products/widget'] },
    { root: '/fr/fr', slug: 'fr-fr', linked: 2, uncaptured: [] },
  ]);
  assert.equal(detail, 'uncaptured first-level targets: ca/en 3, fr/fr 0');
});
check('captureGaps: no locale root captured → no roots and a detail that says so; a root page without links lists 0 of 0; records without links or with an unparsable url survive', () => {
  assert.deepEqual(captureGaps([{ slug: 'index', url: 'https://example.com/', links: ['https://example.com/en/x'] }, { slug: 'about', url: 'https://example.com/about' }]), { roots: [], detail: 'uncaptured first-level targets: none (no locale root captured)' });
  assert.deepEqual(captureGaps([{ slug: 'en', url: 'https://example.com/en' }, { slug: 'junk', url: 'nope' }]).roots, [{ root: '/en', slug: 'en', linked: 0, uncaptured: [] }]);
  assert.deepEqual(captureGaps([]).roots, []);
});
check('--help prints the usage header (naming captureGaps, --page-timeout, the browser tiers and the wall classification) and exits 0 without playwright, writing nothing; importing this module started no crawl', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'crawl-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^crawl\.mjs — reference Playwright crawler/); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /_crawl-log\.json#captureGaps/); assert.equal(r.stderr, '');
  assert.match(r.stdout, /--page-timeout <s>\s+per-page deadline \(default 60; 0 = none\)/);
  assert.match(r.stdout, /technique chrome \|\s+chromium-fallback/); assert.match(r.stdout, /chrome-escalated/); assert.match(r.stdout, /errorClass BotChallenge/); assert.match(r.stdout, /CloudFront \/ AWS WAF/); assert.match(r.stdout, /STARDUST_LIVE_PACE_MS/);
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
  // this file imported ../crawl.mjs above: a module that ran main() on import would have exited 2 on the missing browser
});

check('maxPages: 0 is no cap (--all / --prep); missing or bad values fall back to 25; others are floored and at least 1', () => {
  assert.equal(maxPages('0'), Infinity); assert.equal(maxPages(undefined), 25); assert.equal(maxPages('abc'), 25); assert.equal(maxPages('40'), 40); assert.equal(maxPages('2.7'), 2);
});
check('pageTimeoutMs: seconds → ms; 0 is no deadline; missing, empty, negative or unparsable → the 60 s default; fractions kept to the ms', () => {
  assert.equal(PAGE_TIMEOUT_MS_DEFAULT, 60000);
  for (const [v, want] of [[undefined, 60000], [null, 60000], ['', 60000], ['0', 0], ['90', 90000], ['2.5', 2500], ['abc', 60000], ['-1', 60000], ['Infinity', 60000]]) assert.equal(pageTimeoutMs(v), want, String(v));
});

// ---- the bot walls ----------------------------------------------------------------------------------------------
const URL_ = 'https://www.example.com/';
const respLike = (status, headers = {}, url = URL_) => ({ status: () => status, headers: () => headers, url: () => url });
check('challengeMarker / isChallengeResponse: cf-mitated on any status; a 403/429/503 with a Cloudflare, Akamai, F5 (BigIP and BIG-IP), Imperva or CloudFront / AWS WAF signature; any x-amzn-waf-action header; Akamai\'s 400 escalation; a bare 403, a CloudFront 404, a 200 and null are not challenges', () => {
  assert.equal(challengeMarker(respLike(200, { 'cf-mitigated': 'challenge' })), 'cf-mitigated: challenge');
  assert.equal(challengeMarker(respLike(403, { 'cf-ray': 'abc', server: 'cloudflare' })), 'HTTP 403 + Cloudflare edge signature (cf-ray/server)');
  assert.equal(challengeMarker(respLike(429, { server: 'AkamaiGHost' })), 'HTTP 429 + Akamai edge signature');
  assert.equal(challengeMarker(respLike(503, { 'x-akamai-transformed': '9 - 0 pmb=mRUM,1' })), 'HTTP 503 + Akamai edge signature');
  assert.equal(challengeMarker(respLike(403, { server: 'BigIP' })), 'HTTP 403 + F5/Imperva edge signature');
  assert.equal(challengeMarker(respLike(403, { server: 'BIG-IP' })), 'HTTP 403 + F5/Imperva edge signature');
  assert.equal(challengeMarker(respLike(403, { 'x-iinfo': '1-2' })), 'HTTP 403 + F5/Imperva edge signature');
  assert.equal(challengeMarker(respLike(403, { server: 'CloudFront', 'x-cache': 'Error from cloudfront' })), 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)');
  assert.equal(challengeMarker(respLike(403, { 'x-cache': 'Error from cloudfront', via: '1.1 abc.cloudfront.net (CloudFront)' })), 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)');
  assert.equal(challengeMarker(respLike(202, { 'x-amzn-waf-action': 'challenge' })), 'HTTP 202 + CloudFront/AWS WAF edge signature (x-amzn-waf-action: challenge)');
  assert.equal(challengeMarker(respLike(405, { 'x-amzn-waf-action': 'captcha' })), 'HTTP 405 + CloudFront/AWS WAF edge signature (x-amzn-waf-action: captcha)');
  assert.equal(challengeMarker(respLike(400, { server: 'AkamaiGHost' })), 'HTTP 400 + Akamai edge signature (bot-management escalation)');
  for (const r of [respLike(403, {}), respLike(403, { server: 'nginx' }), respLike(404, { server: 'CloudFront', 'x-cache': 'Error from cloudfront' }), respLike(503, { server: 'CloudFront' }), respLike(200, { server: 'CloudFront', 'x-cache': 'Hit from cloudfront' }), respLike(400, { server: 'nginx' }), null]) {
    assert.equal(challengeMarker(r), null, r ? `${r.status()} ${JSON.stringify(r.headers())}` : 'null');
  }
  assert.equal(isChallengeResponse(respLike(403, { server: 'CloudFront' })), true);
  assert.equal(isChallengeResponse(respLike(403, {})), false);
  assert.equal(isChallengeResponse(null), false);
});
check('isFingerprintBlock: a network-level reject (ERR_HTTP2_PROTOCOL_ERROR, ERR_QUIC_PROTOCOL_ERROR, ERR_CONNECTION_RESET, any net::ERR) — a timeout or an app error is not', () => {
  for (const m of ['page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://www.example.com/', 'net::ERR_QUIC_PROTOCOL_ERROR', 'ERR_CONNECTION_RESET', 'page.goto: net::ERR_FAILED']) assert.equal(isFingerprintBlock(new Error(m)), true, m);
  for (const m of ['page.goto: Timeout 30000ms exceeded.', 'HTTP 403', '']) assert.equal(isFingerprintBlock(new Error(m)), false, m);
  assert.equal(isFingerprintBlock('ERR_CONNECTION_RESET'), true, 'a bare string');
});
check('inlineWallMarker (the fallback rule): a wall title or h1 on a page under 2 KB of visible text, or on a self-reloading page of any size; a full page under such a title, a plain title, garbage → null', () => {
  assert.equal(WALL_TEXT_MAX_BYTES, 2048);
  for (const t of ['One moment, please...', 'Just a moment…', 'Verifying your request', 'Verification required', 'Access Denied', 'Request blocked', 'Attention Required! | Cloudflare', 'Please verify you are human']) assert.ok(WALL_TITLE.test(t), t);
  for (const t of ['Home', 'Our moments together', 'Verifiable credentials explained', 'Contact us']) assert.ok(!WALL_TITLE.test(t), `${t} is no wall title`);
  assert.equal(inlineWallMarker({ title: 'One moment, please...', h1: '', bytes: 300, selfReload: false }), 'interstitial page — "One moment, please..."');
  assert.equal(inlineWallMarker({ title: 'One moment, please...', h1: '', bytes: 300, selfReload: true }), 'interstitial page — "One moment, please..." (self-reloading)');
  assert.equal(inlineWallMarker({ title: 'One moment, please...', h1: '', bytes: 9000, selfReload: true }), 'interstitial page — "One moment, please..." (self-reloading)', 'a self-reloading page of any size');
  assert.equal(inlineWallMarker({ title: 'One moment, please...', h1: '', bytes: 9000, selfReload: false }), null, 'a full page under such a title is the page');
  assert.equal(inlineWallMarker({ title: 'Site', h1: 'Access Denied', bytes: 120, selfReload: false }), 'interstitial page — "Access Denied"', 'the h1 counts too');
  assert.equal(inlineWallMarker({ title: `Verifying ${'x'.repeat(100)}`, h1: '', bytes: 120, selfReload: false }), `interstitial page — "${`Verifying ${'x'.repeat(100)}`.slice(0, 80)}"`, 'cut at 80 chars');
  assert.equal(inlineWallMarker({ title: 'Welcome', h1: 'Welcome', bytes: 120, selfReload: true }), null, 'a plain title on a self-reloading page');
  for (const p of [null, undefined, {}, 'One moment', { title: 'One moment, please...', bytes: 'x', selfReload: false }]) assert.equal(inlineWallMarker(p), null, JSON.stringify(p));
  assert.equal(typeof wallProbeInPage, 'function', 'the in-page probe is exported for the browser tests');
});

// ---- probeEntry and capturePage on stub pages -------------------------------------------------------------------
// what live-session's denialProbeInPage returns on an ordinary page / on the recorded "One moment, please…" interstitial;
// the stub derives the crawler's own wallProbeInPage shape from the same probe
const CLEAN_PROBE = { title: 'Home', text: 'Welcome to the store. '.repeat(400), bytes: 8800, headings: ['Welcome', 'New arrivals'], frames: [] };
const WALL_PROBE = { title: 'One moment, please...', text: 'Please wait while your request is being verified...', bytes: 96, headings: [], frames: [] };
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const record = (url) => ({ finalUrl: url, title: 'Home', headings: [{ tag: 'h1', text: 'Welcome' }], body: ['Hello'], links: [], media: { imgs: [] }, _signals: { mainTextLen: 500, realImageCount: 0 }, _contentHash: 'h', dynamicDom: {} });
/**
 * A stub playwright page + context: `responses` = the statuses/headers successive gotos answer (the last repeats),
 * `gotoError` = the goto throws it, `hang` = the goto never settles, `probes` = what successive wall reads
 * return (the last repeats), `reload` = what a reload answers. evaluate dispatches on the function's name.
 */
const stubPage = ({ responses = [{ status: 200, headers: HTML }], gotoError = null, hang = false, probes = [CLEAN_PROBE], reload = null } = {}) => {
  const calls = { goto: [], reload: 0, evaluate: [], waits: [], closed: 0, screenshots: 0, reads: 0 };
  const resp = (r) => ({ status: () => r.status, headers: () => r.headers || {}, url: () => URL_ });
  const page = {
    calls,
    goto: async (u) => { calls.goto.push(u); if (gotoError) throw gotoError; if (hang) return new Promise(() => {}); return resp(responses[Math.min(calls.goto.length, responses.length) - 1]); },
    reload: async () => { calls.reload += 1; return resp(reload || responses[responses.length - 1]); },
    waitForTimeout: async (ms) => { calls.waits.push(ms); },
    evaluate: async (fn) => {
      const name = typeof fn === 'function' ? fn.name : '';
      calls.evaluate.push(name);
      // one wall read = the crawler's title probe, then (no title hit) live-session's denial probe — both see the same page
      if (name === 'wallProbeInPage' || name === 'denialProbeInPage') {
        if (name === 'wallProbeInPage') calls.reads += 1;
        const p = probes[Math.min(Math.max(calls.reads, 1), probes.length) - 1];
        if (p instanceof Error) throw p;
        return name === 'wallProbeInPage' ? { title: p.title, h1: p.headings[0] || '', bytes: p.bytes, selfReload: !!p.selfReload } : p;
      }
      if (name === 'capture') return record(URL_);
      return undefined;
    },
    content: async () => '<!doctype html><title>Home</title><h1>Welcome</h1>',
    screenshot: async () => { calls.screenshots += 1; },
    close: async () => { calls.closed += 1; },
    on: () => {},
    $: async () => null,
  };
  return { page, context: { newPage: async () => page } };
};
const CF_403 = { status: 403, headers: { 'cf-ray': 'abc-FRA', server: 'cloudflare' } };
const CLOUDFRONT_403 = { status: 403, headers: { server: 'CloudFront', 'x-cache': 'Error from cloudfront' } };

await checkAsync('probeEntry: the page → null after one settled read (no reload); a 403 with an edge signature → challenge naming it (the page is never read); a 404 → null (an app-level status, not a wall); a network reject → fingerprint with the error\'s first line; any other goto error is thrown', async () => {
  const ok = stubPage();
  assert.equal(await probeEntry(ok.page, URL_), null);
  assert.deepEqual([ok.page.calls.goto, ok.page.calls.reload, ok.page.calls.evaluate, ok.page.calls.waits], [[URL_], 0, ['wallProbeInPage', 'denialProbeInPage'], [1200]], 'one settled read: the title rule, then the shared reader');
  const cf = stubPage({ responses: [CF_403] });
  assert.deepEqual(await probeEntry(cf.page, URL_), { kind: 'challenge', marker: 'HTTP 403 + Cloudflare edge signature (cf-ray/server)' });
  assert.deepEqual([cf.page.calls.reload, cf.page.calls.evaluate], [0, []], 'no solve window and no page read on the first probe');
  assert.deepEqual(await probeEntry(stubPage({ responses: [CLOUDFRONT_403] }).page, URL_), { kind: 'challenge', marker: 'HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)' });
  const notFound = stubPage({ responses: [{ status: 404, headers: HTML }], probes: [WALL_PROBE] });
  assert.equal(await probeEntry(notFound.page, URL_), null);
  assert.deepEqual(notFound.page.calls.evaluate, [], 'a >= 400 is not read as a wall');
  const reject = stubPage({ gotoError: new Error('page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://www.example.com/\n    at probe') });
  assert.deepEqual(await probeEntry(reject.page, URL_), { kind: 'fingerprint', marker: 'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://www.example.com/' });
  await assert.rejects(probeEntry(stubPage({ gotoError: new Error('page.goto: Timeout 30000ms exceeded.') }).page, URL_), { message: 'page.goto: Timeout 30000ms exceeded.' });
});
await checkAsync('probeEntry: a 200 whose page is the "One moment, please…" interstitial → interstitial naming it (the crawler\'s own title rule, whatever live-session copy is beside it); with `solve` the wall gets up to three settled reloads — cleared after one → null, still there after three → interstitial, a reload answered by an edge challenge keeps it; a challenge under `solve` runs the wait+reload window first', async () => {
  const wall = stubPage({ probes: [WALL_PROBE] });
  assert.deepEqual(await probeEntry(wall.page, URL_), { kind: 'interstitial', marker: 'interstitial page — "One moment, please..."' });
  assert.deepEqual([wall.page.calls.reload, wall.page.calls.waits], [0, [1200]], 'the first probe never reloads');
  const cleared = stubPage({ probes: [WALL_PROBE, CLEAN_PROBE] });
  assert.equal(await probeEntry(cleared.page, URL_, { solve: true }), null);
  assert.deepEqual([cleared.page.calls.reload, cleared.page.calls.waits], [1, [1200, 4000, 1200]], 'one reload, settled like the entry, then clean');
  const stuck = stubPage({ probes: [WALL_PROBE] });
  assert.deepEqual(await probeEntry(stuck.page, URL_, { solve: true }), { kind: 'interstitial', marker: 'interstitial page — "One moment, please..."' });
  assert.equal(stuck.page.calls.reload, 3, 'the three-reload window');
  const edged = stubPage({ probes: [WALL_PROBE, CLEAN_PROBE], reload: CF_403 });
  assert.deepEqual(await probeEntry(edged.page, URL_, { solve: true }), { kind: 'interstitial', marker: 'interstitial page — "One moment, please..."' });
  assert.deepEqual([edged.page.calls.reload, edged.page.calls.evaluate.length], [1, 1], 'an edge-challenged reload is not a clearance and the page is not re-read');
  const challenged = stubPage({ responses: [CF_403] });
  assert.deepEqual(await probeEntry(challenged.page, URL_, { solve: true }), { kind: 'challenge', marker: 'HTTP 403 + Cloudflare edge signature (cf-ray/server)' });
  assert.deepEqual([challenged.page.calls.reload, challenged.page.calls.waits], [3, [4000, 4000, 4000]], 'clearChallenge\'s window, then the verdict');
  const solved = stubPage({ responses: [CF_403], reload: { status: 200, headers: HTML } });
  assert.equal(await probeEntry(solved.page, URL_, { solve: true }), null, 'a challenge that clears on reload is the page');
  assert.equal(solved.page.calls.reload, 1);
});
const argsFor = (out, extra = {}) => ({ out, wait: 'fast', consent: false, dynamics: false, pageTimeoutMs: 60000, ...extra });
await checkAsync('capturePage: a clean page → the record with the rendered DOM, the screenshot path and the provenance; the tab is closed', async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-'));
  try {
    const { page, context } = stubPage();
    const rec = await capturePage(context, URL_, 'index', argsFor(out));
    assert.equal(rec.title, 'Home');
    assert.equal(rec._renderedHtml, '<!doctype html><title>Home</title><h1>Welcome</h1>');
    assert.equal(rec.screenshot, 'assets/screenshots/index.png');
    assert.deepEqual([rec._provenance.renderedBy, rec._provenance.httpStatus, rec._provenance.waitMs], ['playwright', 200, 1200]);
    assert.ok(!('dynamicDom' in rec), 'the opt-in dynamics section is dropped');
    assert.deepEqual([page.calls.goto, page.calls.reload, page.calls.closed, page.calls.screenshots], [[URL_], 0, 1, 1]);
    assert.deepEqual(page.calls.evaluate.filter((n) => n === 'wallProbeInPage' || n === 'denialProbeInPage'), ['wallProbeInPage', 'denialProbeInPage'], 'the wall is read once, after the settle: the title rule, then the shared reader');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
await checkAsync('capturePage: a 2xx "One moment, please…" interstitial on an inner page → BotChallenge naming the wall and the status, nothing captured, no screenshot, the tab closed', async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-'));
  try {
    const { page, context } = stubPage({ probes: [WALL_PROBE] });
    await assert.rejects(capturePage(context, URL_, 'about', argsFor(out)), (e) => {
      assert.equal(e.errorClass, 'BotChallenge');
      assert.equal(e.message, 'bot-management interstitial served as HTTP 200: interstitial page — "One moment, please..."');
      return true;
    });
    assert.deepEqual([page.calls.screenshots, page.calls.closed], [0, 1]);
    assert.ok(!page.calls.evaluate.includes('capture'), 'the content is never captured');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
await checkAsync('capturePage: a 403 challenge on an inner page gets the solve window (3 × wait 4 s + reload), then BotChallenge naming the signature — Cloudflare and CloudFront alike; a challenge that clears on reload is captured; a bare 403 stays HTTPError', async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-'));
  try {
    const cf = stubPage({ responses: [CF_403] });
    await assert.rejects(capturePage(cf.context, URL_, 'p', argsFor(out)), { errorClass: 'BotChallenge', message: 'bot-management challenge not cleared: HTTP 403 + Cloudflare edge signature (cf-ray/server)' });
    assert.deepEqual([cf.page.calls.reload, cf.page.calls.waits, cf.page.calls.closed], [3, [4000, 4000, 4000], 1]);
    const cloudfront = stubPage({ responses: [CLOUDFRONT_403] });
    await assert.rejects(capturePage(cloudfront.context, URL_, 'p', argsFor(out)), { errorClass: 'BotChallenge', message: 'bot-management challenge not cleared: HTTP 403 + CloudFront/AWS WAF edge signature (server/x-cache)' });
    const solved = stubPage({ responses: [CF_403], reload: { status: 200, headers: HTML } });
    const rec = await capturePage(solved.context, URL_, 'p', argsFor(out));
    assert.deepEqual([rec.title, solved.page.calls.reload], ['Home', 1]);
    const bare = stubPage({ responses: [{ status: 403, headers: HTML }] });
    await assert.rejects(capturePage(bare.context, URL_, 'p', argsFor(out)), { errorClass: 'HTTPError', message: 'HTTP 403' });
    assert.equal(bare.page.calls.reload, 0, 'no solve window on an app-level 403');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
await checkAsync('capturePage: a navigation that never settles is a TimeoutError under the per-page deadline ("page deadline <s> s exceeded (--page-timeout)") and the tab is closed; 0 disables the deadline', async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-'));
  try {
    const hung = stubPage({ hang: true });
    const t0 = Date.now();
    await assert.rejects(capturePage(hung.context, URL_, 'slow', argsFor(out, { pageTimeoutMs: 60 })), { errorClass: 'TimeoutError', message: 'page deadline 0.06 s exceeded (--page-timeout)' });
    assert.ok(Date.now() - t0 < 2000, 'bounded by the deadline');
    assert.equal(hung.page.calls.closed, 1, 'the deadline closes the tab');
    const quick = stubPage();
    assert.equal((await capturePage(quick.context, URL_, 'quick', argsFor(out, { pageTimeoutMs: 0 }))).title, 'Home');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
await checkAsync('capturePage: a wall read the probe cannot make is ONE "wall check skipped" stderr line and the capture proceeds — never a silent pass, never a false wall', async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-'));
  try {
    const broken = stubPage({ probes: [new Error('Execution context was destroyed, most likely because of a navigation\n    at probe')] });
    let rec;
    const lines = await stderrOf(async () => { rec = await capturePage(broken.context, URL_, 'p', argsFor(out)); });
    assert.equal(rec.title, 'Home');
    assert.deepEqual(lines, ['[crawl] wall check skipped on p: Execution context was destroyed, most likely because of a navigation']);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} failing` : '\ncrawl: all checks passed');
process.exit(failed ? 1 : 0);
