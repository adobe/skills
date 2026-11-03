#!/usr/bin/env node
// skills/extract/scripts/test/crawl.test.mjs — the crawl.mjs pure helpers, on fixture HTML and without a
// browser or network: locale-root detection by path shape, the first-level capture-gap listing per root
// (same-origin links on the root page under its own path, minus what the crawl captured; query, hash and
// trailing slash folded; assets, mailto:/tel: and other hosts dropped; www. folded), the ready ledger
// detail string, both link-list shapes — and that importing the module or asking --help starts no crawl
// and writes nothing. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as crawl from '../crawl.mjs';

const {
  captureGaps, clearChallenge, crawlerLiveBindings, isChallengeResponse, localeRootPath, maxPages,
} = crawl;

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'crawl.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

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
check('--help prints the usage header (naming captureGaps) and exits 0 without playwright, writing nothing; importing this module started no crawl', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'crawl-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^crawl\.mjs — reference Playwright crawler/); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /_crawl-log\.json#captureGaps/); assert.equal(r.stderr, '');
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
  // this file imported ../crawl.mjs above: a module that ran main() on import would have exited 2 on the missing browser
});

check('maxPages: 0 is no cap (--all / --prep); missing or bad values fall back to 25; others are floored and at least 1', () => {
  assert.equal(maxPages('0'), Infinity); assert.equal(maxPages(undefined), 25); assert.equal(maxPages('abc'), 25); assert.equal(maxPages('40'), 40); assert.equal(maxPages('2.7'), 2);
});
check('isChallengeResponse: the crawler keeps its own edge rule and a bare 403 stays an application error', () => {
  const response = (status, headers = {}, url = 'https://www.example.com/') => ({ status: () => status, headers: () => headers, url: () => url });
  assert.equal(isChallengeResponse(response(403, { 'cf-ray': 'abc' })), true);
  assert.equal(isChallengeResponse(response(429, { server: 'AkamaiGHost' })), true);
  assert.equal(isChallengeResponse(response(403, {})), false);
});

await (async () => {
  try {
    const calls = [];
    const browser = { newContext: async (opts) => { calls.push(['context', opts]); return { kind: 'fallback' }; } };
    const fallback = crawlerLiveBindings();
    assert.deepEqual(await fallback.newLiveContext(browser, { reducedMotion: 'reduce' }), { kind: 'fallback' });
    assert.equal(await fallback.runLiveNavigation({}, 'https://www.example.com/', async () => { calls.push(['navigate']); return 7; }), 7);
    assert.equal(await fallback.persistLiveStorageState({}, 'https://www.example.com/'), false);
    assert.equal(await fallback.recordLiveBotSignal('https://www.example.com/'), false);
    assert.equal(await fallback.recordLiveNavigationSuccess('https://www.example.com/'), false);
    assert.deepEqual(calls, [['context', { reducedMotion: 'reduce' }], ['navigate']]);

    const shared = crawlerLiveBindings({
      newLiveContext: async () => 'shared-context',
      runLiveNavigation: async (_page, _url, navigate) => `shared-${await navigate()}`,
      persistLiveStorageState: async () => true,
      recordLiveBotSignal: async (url) => `signal-${url}`,
      recordLiveNavigationSuccess: async (url) => `success-${url}`,
    });
    assert.equal(await shared.newLiveContext(browser, {}), 'shared-context');
    assert.equal(await shared.runLiveNavigation({}, 'https://www.example.com/', async () => 'navigation'), 'shared-navigation');
    assert.equal(await shared.persistLiveStorageState({}, 'https://www.example.com/'), true);
    assert.equal(await shared.recordLiveBotSignal('https://www.example.com/'), 'signal-https://www.example.com/');
    assert.equal(await shared.recordLiveNavigationSuccess('https://www.example.com/'), 'success-https://www.example.com/');
    console.log('✓ crawlerLiveBindings: shared helpers are used when present; inline context, navigation, and persistence fallbacks are no-ops when absent');
  } catch (e) {
    failed += 1;
    console.log(`✗ crawlerLiveBindings: shared helpers are used when present; inline context, navigation, and persistence fallbacks are no-ops when absent\n  ${e.message.split('\n').join('\n  ')}`);
  }
})();

await (async () => {
  try {
    const calls = [];
    const clean = { status: () => 200, headers: () => ({}), url: () => 'https://www.example.com/path/' };
    const blocked = { status: () => 403, headers: () => ({ 'cf-ray': 'abc' }), url: () => 'https://www.example.com/path/' };
    const page = {
      url: () => 'https://www.example.com/path/',
      waitForTimeout: async (ms) => { calls.push(['wait', ms]); },
      reload: async () => { calls.push(['reload']); return clean; },
    };
    const response = await clearChallenge(page, blocked, {
      recordBotSignal: async (url) => { calls.push(['signal', url]); },
      navigate: async (_page, url, operation) => { calls.push(['navigate', url]); return operation(); },
    });
    assert.equal(response, clean);
    assert.deepEqual(calls, [
      ['signal', 'https://www.example.com/path/'],
      ['wait', 4000],
      ['navigate', 'https://www.example.com/path/'],
      ['reload'],
    ]);
    calls.length = 0;
    assert.equal(await clearChallenge(page, blocked, {
      recordBotSignal: async () => { throw new Error('signal unavailable'); },
      navigate: async (_page, url, operation) => { calls.push(['navigate', url]); return operation(); },
    }), clean);
    assert.deepEqual(calls, [
      ['wait', 4000],
      ['navigate', 'https://www.example.com/path/'],
      ['reload'],
    ]);
    console.log('✓ clearChallenge: an alternate-path edge response records the signal and reloads under shared navigation');
  } catch (e) {
    failed += 1;
    console.log(`✗ clearChallenge: an alternate-path edge response records the signal and reloads under shared navigation\n  ${e.message.split('\n').join('\n  ')}`);
  }
})();

await (async () => {
  const out = mkdtempSync(join(tmpdir(), 'crawl-capture-bindings-'));
  try {
    assert.equal(typeof crawl.capturePage, 'function', 'capturePage is exported for its binding-level test');
    const url = 'https://www.example.com/page';
    const response = { status: () => 200, headers: () => ({ 'content-type': 'text/html' }) };
    const record = {
      finalUrl: url,
      headings: ['Captured'],
      links: [],
      _contentHash: 'content',
      _signals: { mainTextLen: 8, realImageCount: 0 },
    };
    const page = {
      goto: async () => response,
      url: () => url,
      waitForTimeout: async () => {},
      evaluate: async (fn) => (fn.name === 'capture' ? record : undefined),
      content: async () => '<main>Captured</main>',
      screenshot: async () => {},
      close: async () => {},
    };
    const context = { newPage: async () => page };
    const captured = await crawl.capturePage(context, url, 'page', {
      consent: false, dynamics: false, wait: 'fast', out,
    }, {
      runLiveNavigation: async (_page, _url, navigate) => navigate(),
      recordLiveNavigationSuccess: async () => { throw new Error('success unavailable'); },
      persistLiveStorageState: async () => { throw new Error('state unavailable'); },
    });
    assert.equal(captured.headings[0], 'Captured');
    console.log('✓ capturePage: rejecting shared success and storage hooks do not fail a completed capture');
  } catch (e) {
    failed += 1;
    console.log(`✗ capturePage: rejecting shared success and storage hooks do not fail a completed capture\n  ${e.message.split('\n').join('\n  ')}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
})();

console.log(failed ? `\n${failed} failing` : '\ncrawl: all checks passed');
process.exit(failed ? 1 : 0);
