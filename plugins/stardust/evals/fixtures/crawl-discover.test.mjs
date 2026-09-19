#!/usr/bin/env node
// Fixture test: crawl.mjs discovery (ia-extraction.md § Discovery order is the
// rule; discoverInventory implements it). A local static server plays a site:
//   robots.txt names /sitemaps/index.xml → two leaf maps (5 + 3 pages);
//   a STALE /sitemap.xml root lists 20 legacy URLs (bigger, lower precedence);
//   /.sitemap.xml and /sitemap.aspx exist too (must never be probed when robots wins);
//   the probe page's nav links add /employers/… pages no sitemap declares;
//   /employers/* pages link each other (BFS hops via in-page fetch).
// Asserts: source precedence by tier (never by size or lastmod), index
// recursion, subtree scope from the TYPED path, nav union + navOnly,
// cut[].reason 'cap', probes ≤ 3 when robots names a sitemap, conventions only
// when tiers 1–2 are empty and never under botBlock, BFS fallback depth/breadth,
// --cookie parse (names-only logging is the caller's contract), robots
// Crawl-delay, and the field-wise "discovery never shrinks" merge.
// Runs without playwright: crawl.mjs imports it lazily inside main().
// Usage: node plugins/stardust/evals/fixtures/crawl-discover.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { discoverInventory, parseRobots, parseCookieFlag, mergeCrawlLog } from '../../skills/extract/scripts/crawl.mjs';

const urlset = (paths) => `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${p}</loc><lastmod>2026-01-0${1 + (p.length % 9)}</lastmod></url>`).join('')}</urlset>`;
const hrefs = (paths) => `<html><body>${paths.map((p) => `<a href="${p}">x</a>`).join('')}</body></html>`;
let origin;
const routes = () => ({
  '/robots.txt': `User-agent: *\nCrawl-delay: 7\nSitemap: ${origin}/sitemaps/index.xml\n`,
  '/sitemaps/index.xml': `<sitemapindex><sitemap><loc>${origin}/sitemaps/a.xml</loc></sitemap><sitemap><loc>${origin}/sitemaps/b.xml</loc></sitemap><sitemap><loc>${origin}/sitemaps/index.xml</loc></sitemap></sitemapindex>`,
  '/sitemaps/a.xml': urlset(['/', '/about', '/pricing', '/products', '/contact'].map((p) => origin + p)),
  '/sitemaps/b.xml': urlset(['/blog/one', '/blog/two', '/blog/three', '/assets/site.css'].map((p) => origin + p)),
  '/sitemap.xml': urlset(Array.from({ length: 20 }, (_, i) => `${origin}/legacy/page-${i}`)),
  '/.sitemap.xml': urlset([`${origin}/aem-only`]),
  '/sitemap.aspx': urlset([`${origin}/aspx-only`]),
  '/employers/': hrefs(['/employers/plans', '/employers/why-us', '/about']),
  '/employers/plans': hrefs(['/employers/plans/small', '/employers/plans/large', 'mailto:x@y.z', '/employers/brochure.pdf']),
  '/employers/why-us': hrefs(['/employers/plans']),
  '/employers/plans/small': hrefs(['/employers/plans/small/faq']),
});
const hits = [];
const server = createServer((req, res) => {
  hits.push(req.url);
  const body = routes()[req.url];
  if (body == null) { res.statusCode = 404; res.end('nope'); return; }
  res.setHeader('content-type', req.url.endsWith('.xml') || req.url === '/sitemap.aspx' ? 'application/xml' : 'text/plain');
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;
const io = { fetchText: async (u) => { const r = await fetch(u); return r.ok ? r.text() : null; } };
const nav = ['/', '/about', '/employers/', '/employers/plans', '/assets/logo.svg', 'https://other.example/x'].map((p) => (p.startsWith('http') ? p : origin + p));

try {
  // 1 — robots-declared index wins over the bigger stale root; recursion; nav union; cap
  hits.length = 0;
  const r1 = await discoverInventory({ entry: `${origin}/`, origin, entryPath: '/', max: 5, navLinks: nav }, io);
  const d1 = r1.discovery;
  assert.equal(d1.source, 'robots.txt', 'tier 1 wins by source');
  assert.equal(d1.sourceUrl, `${origin}/sitemaps/index.xml`);
  assert.equal(d1.probes, 1, 'robots named a sitemap → the two standard paths and the conventions are never guessed');
  assert.ok(!hits.includes('/sitemap.xml') && !hits.includes('/.sitemap.xml') && !hits.includes('/sitemap.aspx'), `no convention probe: ${hits}`);
  assert.equal(d1.census.total, 8, 'index recursed into both leaves; the .css loc is not a page');
  assert.deepEqual(d1.census.byPrefix, { '/': 1, '/blog': 3, '/about': 1, '/pricing': 1, '/products': 1, '/contact': 1 });
  assert.equal(d1.navOnly, 2, '/employers/ and /employers/plans are in the nav, in no sitemap');
  assert.equal(d1.subtree, null, 'root entry → no scope');
  assert.equal(r1.urls.length, 5, 'cap applied');
  assert.equal(r1.urls[0], `${origin}/`, 'entry first');
  assert.equal(d1.kept.length, 5);
  assert.equal(d1.cut.length, 10 - 5, 'sitemap 8 + nav-only 2 → 5 cut');
  assert.ok(d1.cut.every((c) => c.reason === 'cap'));
  assert.equal(d1.crawlDelay, 7, 'robots Crawl-delay recorded for the pacing rule');
  const idx = d1.candidates.find((c) => c.url.endsWith('/sitemaps/index.xml'));
  assert.equal(idx.count, 8); assert.equal(idx.tier, 'robots'); assert.match(idx.maxLastmod, /^2026-01-0\d$/);
  assert.equal(d1.candidates.length, 1, 'lower tiers were not consulted, so they are not listed as rejected either');

  // 2 — subtree scope from the TYPED path, sitemap-blind section → BFS fallback with in-page hops
  hits.length = 0;
  const r2 = await discoverInventory({ entry: `${origin}/employers/`, origin, entryPath: '/employers/', max: 25, depth: 3, navLinks: nav }, io);
  const d2 = r2.discovery;
  assert.equal(d2.subtree, '/employers');
  assert.equal(d2.source, 'robots.txt+bfs', 'sitemap consulted, nothing under the scope → BFS');
  assert.equal(d2.census.total, 8, 'the census still reports everything declared');
  assert.ok(r2.urls.every((u) => new URL(u).pathname.startsWith('/employers')), `scope filters sitemap and BFS alike: ${r2.urls}`);
  assert.ok(r2.urls.includes(`${origin}/employers/plans/small/faq`), 'hop 3 reached via fetched HTML');
  assert.ok(!r2.urls.some((u) => /brochure\.pdf|mailto/.test(u)), 'assets and mailto never enter the roster');
  assert.equal(d2.bfs.depth, 3);
  assert.ok(d2.bfs.fetched >= 3, 'hops 2..3 fetched the frontier pages');
  assert.ok(!hits.includes('/sitemap.xml'), 'a scoped miss does not re-probe the standard paths');

  // 3 — botBlock caps BFS at depth 1 (nav only) and skips the conventions
  const r3 = await discoverInventory({ entry: `${origin}/employers/`, origin, entryPath: '/employers/', max: 25, depth: 3, botBlock: 'challenge', navLinks: nav }, io);
  assert.equal(r3.discovery.bfs.depth, 1, 'bot-walled origin: no in-page hops');
  assert.deepEqual(r3.urls.sort(), [`${origin}/employers/`, `${origin}/employers/plans`].sort());

  // 4 — no robots sitemaps: standard path wins over the conventions; conventions probed only when tiers 1–2 are empty
  const io4 = { fetchText: (u) => (u.endsWith('/robots.txt') ? Promise.resolve('User-agent: *\n') : io.fetchText(u)) };
  hits.length = 0;
  const r4 = await discoverInventory({ entry: `${origin}/`, origin, entryPath: '/', max: 100, navLinks: [] }, io4);
  assert.equal(r4.discovery.source, 'sitemap.xml');
  assert.equal(r4.discovery.probes, 2, 'robots + /sitemap.xml; /sitemap_index.xml recorded as lower-precedence without a fetch');
  assert.ok(r4.discovery.candidates.some((c) => c.rejected === 'lower-precedence' && c.url.endsWith('/sitemap_index.xml')));
  assert.equal(r4.urls.length, 21, 'entry + 20 legacy pages');
  const io5 = { fetchText: (u) => (/robots\.txt$|\/sitemap\.xml$|\/sitemap_index\.xml$/.test(u) ? Promise.resolve(null) : io.fetchText(u)) };
  const r5 = await discoverInventory({ entry: `${origin}/`, origin, entryPath: '/', max: 100, navLinks: [] }, io5);
  assert.equal(r5.discovery.source, '.sitemap.xml', 'AEM convention reached only after robots + both standard paths came up empty');
  assert.equal(r5.discovery.probes, 4, 'worst case: robots + 2 standard + 1 convention');
  assert.ok(r5.discovery.candidates.filter((c) => c.rejected === 'unreachable').length === 2);
  const r6 = await discoverInventory({ entry: `${origin}/`, origin, entryPath: '/', max: 100, botBlock: 'fingerprint', navLinks: [`${origin}/about`] }, io5);
  assert.equal(r6.discovery.source, 'bfs', 'under a bot block the conventions are skipped; nav is what we have');
  assert.equal(r6.discovery.probes, 3);

  // 5 — robots parse + cookie flag
  const rb = parseRobots('# c\nUser-agent: *\nDisallow: /x\nSitemap: /rel.xml\nsitemap: https://cdn.example/s.xml\nCrawl-delay: 2.5\n', 'https://a.example');
  assert.deepEqual(rb.sitemaps, ['https://a.example/rel.xml', 'https://cdn.example/s.xml'], 'relative directives resolve, case-insensitive key');
  assert.equal(rb.crawlDelay, 2.5);
  assert.deepEqual(parseRobots(null, origin), { sitemaps: [], crawlDelay: null });
  assert.deepEqual(parseCookieFlag('agegate_confirmed=true;Path=/'), { name: 'agegate_confirmed', value: 'true', path: '/' });
  assert.deepEqual(parseCookieFlag('region=us-en;path=/us'), { name: 'region', value: 'us-en', path: '/us' });
  assert.deepEqual(parseCookieFlag('k=a=b'), { name: 'k', value: 'a=b', path: '/' }, 'first = splits');
  assert.throws(() => parseCookieFlag('novalue'), /name=value/);

  // 6 — field-wise merge: a narrower re-run keeps the richer roster block but refreshes run-level fields
  const full = { discovery: { fetchTechnique: 'headless', count: 8, concurrency: 4, ...d1 }, consent: { method: 'none-detected' }, favicon: null, crawl: { startedAt: 't', finishedAt: 't', successes: 5, failures: [] } };
  const m1 = mergeCrawlLog({}, full, { at: 't', args: {}, technique: 'headless', discovered: 8, skipped: 0, captured: 5, failed: [] }, ['index']);
  const narrow = { discovery: { fetchTechnique: 'chrome-headless', count: 1, concurrency: 1, source: '--pages', kept: [`${origin}/about`], cut: [], storageState: true, liveBudget: { navPerMin: 5 } }, consent: { method: 'none-detected' }, favicon: null, crawl: { startedAt: 't', finishedAt: 't', successes: 1, failures: [] } };
  const m2 = mergeCrawlLog(m1, narrow, { at: 't', args: { pages: ['/about'] }, technique: 'chrome-headless', discovered: 1, skipped: 0, captured: 1, failed: [] }, ['about']);
  assert.equal(m2.discovery.count, 8, 'never shrinks');
  assert.equal(m2.discovery.census.total, 8, 'roster block kept');
  assert.equal(m2.discovery.kept.length, 5, 'kept[] is the richer run\'s');
  assert.equal(m2.discovery.fetchTechnique, 'chrome-headless', 'ladder field refreshed');
  assert.equal(m2.discovery.concurrency, 1, 'run-level field refreshed');
  assert.equal(m2.discovery.storageState, true);
  assert.deepEqual(m2.discovery.liveBudget, { navPerMin: 5 });
  assert.equal(m2.discovery.source, 'robots.txt', 'source stays with the richer block');

  console.log('crawl-discover test: ok');
} finally {
  server.close();
}
