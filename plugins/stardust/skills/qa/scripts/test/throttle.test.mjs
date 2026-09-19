#!/usr/bin/env node
/**
 * Fixture test for the 429/503-as-infrastructure path (local http server, no browser).
 * Run: node skills/qa/scripts/test/throttle.test.mjs
 *
 * Models the field failure: three projects each discarded two sweeps because a
 * rate-limit wall on the published origin read as hundreds of page defects —
 * the fetch path ran 8-wide with no back-off, and the page cache re-served
 * every 429 to every later check. Asserts, against a server that answers 429
 * twice then 200 (and one path that is always 429):
 *   fetchUrl retries through Retry-After / back-off and returns the 200; counters move
 *   a response still 429 after the retries carries throttled:true (isThrottled)
 *   createPageCache never re-serves a throttled response (the server is hit again)
 *   routing / metadata emit <check>/unmeasured (info) and no page-not-200 / og-image-broken
 *   createHostLimiter halves the host cap on throttle (min 1) and restores +1 after a clean window
 *   infraSummary flags the report incomplete above --throttle-max and exit 2 wins in qa.mjs's order
 * Exit: 0 all assertions pass · 1 an assertion failed.
 */
import { createServer } from 'node:http';
import {
  fetchUrl, createPageCache, isThrottled, createHostLimiter, setFetchLimiter, configureFetch, infraCounters, resetInfraCounters, infraSummary, retryAfterMs,
} from '../lib.mjs';
import { run as routing } from '../checks/routing.mjs';
import { run as metadata } from '../checks/metadata.mjs';

let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

configureFetch({ backoffMs: 10 }); // 2/4/8 s in production; milliseconds here
const hits = {}; // path -> count
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  hits[path] = (hits[path] || 0) + 1;
  const page = (title) => `<!doctype html><html><head><title>${title}</title><meta name="description" content="d"><link rel="canonical" href="http://127.0.0.1:${server.address().port}${path === '/index.plain.html' ? '/' : path}"><meta property="og:title" content="t"><meta property="og:type" content="website"><meta property="og:image" content="/og.png"><meta property="og:image:alt" content="a"></head><body><main><h1>${title}</h1><p>content body</p></main></body></html>`;
  if (path === '/flaky' && hits[path] <= 2) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
  if (path === '/always' || path === '/always.plain.html') { res.writeHead(429); res.end('slow down'); return; }
  if (path === '/og.png') { if ((hits[path] || 0) <= 2) { res.writeHead(503, { 'retry-after': '0' }); res.end(); return; } res.writeHead(200, { 'content-type': 'image/png' }); res.end(''); return; }
  if (path === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/</loc></url><url><loc>http://127.0.0.1:${server.address().port}/always</loc></url></urlset>`); return; }
  if (path === '/stardust-qa-definitely-not-a-page') { res.writeHead(404); res.end('<h1>not found</h1>'.padEnd(300, ' ')); return; }
  if (path === '/redirects.json' || path === '/favicon.ico') { res.writeHead(404); res.end(''); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(path));
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const base = `http://127.0.0.1:${server.address().port}`;

// 1. retry through the throttle: 429, 429, 200
resetInfraCounters();
const flaky = await fetchUrl(`${base}/flaky`);
eq('flaky → 200 after two 429s', [flaky.status, hits['/flaky']], [200, 3]);
eq('retries counted', infraCounters().retries, 2);
eq('no throttled result yet', infraCounters().throttled, 0);
eq('a 200 is not throttled', isThrottled(flaky), false);

// 2. still 429 after the retries → throttled, not a defect
const always = await fetchUrl(`${base}/always`);
eq('always-429 → status kept, throttled flag set', [always.status, always.throttled], [429, true]);
eq('isThrottled', isThrottled(always), true);
eq('throttled counter', infraCounters().throttled, 1);
eq('three attempts were made', hits['/always'], 3);

// 3. the cache never re-serves a throttled response
const cache = createPageCache();
await cache(`${base}/always`); const after1 = hits['/always'];
await cache(`${base}/always`); const after2 = hits['/always'];
eq('throttled response evicted → server hit again', after2 > after1, true);
await cache(`${base}/ok`); await cache(`${base}/ok`);
eq('a 200 is cached (one hit)', hits['/ok'], 1);

// 4. checks: unmeasured (info), never page-not-200 / og-image-broken
resetInfraCounters();
const ctx = { base, inventory: { pages: [{ path: '/', sources: ['sitemap'] }, { path: '/always', sources: ['sitemap'] }], fragments: [], sitemapPaths: ['/', '/always'] }, opts: {}, shared: {}, fetchPage: createPageCache() };
const rf = await routing(ctx);
eq('routing: /always → routing/unmeasured info', rf.filter((f) => f.id === 'unmeasured').map((f) => [f.path, f.severity]), [['/always', 'info']]);
eq('routing: no page-not-200 for the throttled page', rf.filter((f) => f.id === 'page-not-200').length, 0);
eq('routing: the clean page has no unmeasured', rf.some((f) => f.id === 'unmeasured' && f.path === '/'), false);
const mf = await metadata(ctx);
eq('metadata: og:image 503+Retry-After twice then 200 → no og-image-broken', mf.filter((f) => f.id === 'og-image-broken').length, 0);
eq('metadata: throttled page → metadata/unmeasured', mf.some((f) => f.id === 'unmeasured' && f.path === '/always'), true);
eq('metadata: no missing-title for the throttled page', mf.some((f) => f.id === 'missing-title' && f.path === '/always'), false);

// 5. limiter: AIMD per host
let t = 1000; const limiter = createHostLimiter({ maxInFlight: 4, restoreMs: 100, now: () => t });
const u = 'https://example.test/a';
eq('limiter starts at maxInFlight', limiter.capFor(u), 4);
eq('throttle halves the cap', limiter.onThrottle(u), 2);
eq('second throttle → 1', limiter.onThrottle(u), 1);
eq('never below 1', limiter.onThrottle(u), 1);
await limiter.take(u); t += 50; limiter.release(u);
eq('no restore inside the clean window', limiter.capFor(u), 1);
await limiter.take(u); t += 100; limiter.release(u);
eq('+1 after a clean window', limiter.capFor(u), 2);
eq('other hosts are independent', limiter.capFor('https://other.test/'), 4);
// take() queues when the cap is reached; release lets the next one through
const l2 = createHostLimiter({ maxInFlight: 1 });
await l2.take(u); let second = false; const p2 = l2.take(u).then(() => { second = true; });
await new Promise((r) => { setTimeout(r, 5); });
eq('second take waits at cap 1', second, false);
l2.release(u); await p2;
eq('release admits the waiter', second, true);

// 6. fetchUrl goes through the process limiter (slot released after each pass, throttled or not)
setFetchLimiter(createHostLimiter({ maxInFlight: 1 }));
const [a, b] = await Promise.all([fetchUrl(`${base}/always`), fetchUrl(`${base}/ok2`)]);
eq('two fetches through a cap-1 limiter both complete', [a.status, b.status], [429, 200]);
setFetchLimiter(null);

// 7. infraSummary: completeness threshold and exit ordering
const findings = [{ check: 'routing', id: 'unmeasured', path: '/a' }, { check: 'metadata', id: 'unmeasured', path: '/a' }, { check: 'rendered', id: 'unmeasured', path: '/b' }, { check: 'routing', id: 'page-not-200', path: '/c' }];
const s1 = infraSummary(findings, 100, { throttleMaxPct: 5, counters: { throttled: 3, retries: 4, serverErrors: 0 } });
eq('2 unique unmeasured pages of 100 = 2% → complete', [s1.unmeasuredPages, s1.unmeasuredPct, s1.incomplete], [2, 2, false]);
const s2 = infraSummary(findings, 20, { throttleMaxPct: 5, counters: { throttled: 3, retries: 4, serverErrors: 0 } });
eq('2 of 20 = 10% > 5 → incomplete (exit 2 wins over the page-not-200 error)', [s2.unmeasuredPct, s2.incomplete], [10, true]);
eq('Retry-After seconds', retryAfterMs('3'), 3000);
eq('Retry-After capped', retryAfterMs('600', { capMs: 60000 }), 60000);
eq('Retry-After absent → null', retryAfterMs(undefined), null);
eq('Retry-After date → ms until then', retryAfterMs(new Date(5000).toUTCString(), { now: () => 2000 }), 3000);

server.close();
if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('throttle path: all assertions pass');
