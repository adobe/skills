#!/usr/bin/env node
/**
 * Fixture test for the browser-side 429/503 path in checks/browse.mjs.
 * Run: node skills/qa/scripts/test/browse-throttle.test.mjs
 *
 * Two halves:
 *   static (always)     sortResponse(): a document 429/503 is 'skip' (gotoPaced owns that verdict —
 *                       a retried document must not leave `HTTP 429 /path` in badRequests), a same-origin
 *                       sub-resource 429/503 is 'throttled' (→ rendered/unmeasured), same-origin ≥ 400 is
 *                       'bad' (→ request-failed), off-origin is ignored. gotoPaced() on a fake page:
 *                       429/503 retried to the 200, a wall returns the last response, and every retry is
 *                       counted in infra.retries (the browser path once left it at fetchUrl's count only).
 *                       Static contracts on the sibling checks that navigate outside gotoPaced: editability's
 *                       paced retry loop counts noteRetry(); links' anchor re-verification goes through
 *                       gotoPaced (limiter slot) and reports a throttled target as links/unmeasured, never
 *                       broken-anchor (the residual false-positive path of the rate-limit-wall class).
 *   browser (playwright) run() against a local server: a document that answers 429 once then 200 renders
 *                       cleanly (no request-failed, no unmeasured, baseline created); a page whose
 *                       stylesheet is throttled gets rendered/unmeasured (info), no request-failed, and
 *                       report.infra counts it. SKIPped with exit 0 when playwright is not resolvable
 *                       from the cwd (run from the EDS project, where the qa scripts resolve it).
 * Exit: 0 all assertions pass (or browser half skipped) · 1 an assertion failed.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sortResponse, gotoPaced, run } from '../checks/browse.mjs';
import { loadPlaywright, configureFetch, infraCounters, resetInfraCounters, setFetchLimiter, createHostLimiter } from '../lib.mjs';

let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };
const base = 'https://site.test';

// static half
eq('document 429 → skip', sortResponse({ url: `${base}/p`, status: 429, resourceType: 'document' }, base), 'skip');
eq('document 503 → skip', sortResponse({ url: `${base}/p`, status: 503, resourceType: 'document' }, base), 'skip');
eq('stylesheet 429 → throttled', sortResponse({ url: `${base}/styles.css`, status: 429, resourceType: 'stylesheet' }, base), 'throttled');
eq('script 503 → throttled', sortResponse({ url: `${base}/scripts.js`, status: 503, resourceType: 'script' }, base), 'throttled');
eq('image 404 → bad', sortResponse({ url: `${base}/i.png`, status: 404, resourceType: 'image' }, base), 'bad');
eq('document 500 → bad', sortResponse({ url: `${base}/p`, status: 500, resourceType: 'document' }, base), 'bad');
eq('200 → null', sortResponse({ url: `${base}/p`, status: 200, resourceType: 'document' }, base), null);
eq('off-origin 429 → null', sortResponse({ url: 'https://cdn.other/x.js', status: 429, resourceType: 'script' }, base), null);

// gotoPaced on a fake page (no browser): the paced retries are counted in report.infra
configureFetch({ backoffMs: 1 });
const fakePage = (statuses) => { let i = 0; return { goto: async () => { const s = statuses[Math.min(i, statuses.length - 1)]; i += 1; return { status: () => s, headers: () => ({}) }; }, waitForTimeout: async () => {}, hits: () => i }; };
resetInfraCounters();
let pg = fakePage([429, 503, 200]);
let nav = await gotoPaced(pg, `${base}/p`, {});
eq('gotoPaced: 429, 503, then 200 → the 200 after three attempts', [nav.status(), pg.hits()], [200, 3]);
eq('gotoPaced: both paced retries counted in infra.retries', infraCounters().retries, 2);
resetInfraCounters();
pg = fakePage([429]);
nav = await gotoPaced(pg, `${base}/p`, {});
eq('gotoPaced: a 429 wall → the last response after three attempts', [nav.status(), pg.hits()], [429, 3]);
eq('gotoPaced: two retries counted; the throttled verdict stays with the caller (noteThrottled)', [infraCounters().retries, infraCounters().throttled], [2, 0]);
resetInfraCounters();

// static contracts on editability.mjs / links.mjs (no browser)
const code = (f) => readFileSync(new URL(`../checks/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const edit = code('editability.mjs');
eq('editability: the paced 429/503 retry counts noteRetry() next to onThrottle', /onThrottle\(url\);\s*noteRetry\(\);/.test(edit) && /\bnoteRetry\b[^\n]*from '\.\.\/lib\.mjs'|noteRetry,\n\} from '\.\.\/lib\.mjs'/.test(edit), true);
const links = code('links.mjs');
eq('links: anchor re-verification navigates through gotoPaced (limiter slot + paced retries), never a bare page.goto', [/import \{ gotoPaced \} from '\.\/browse\.mjs'/.test(links), /await gotoPaced\(page, pageUrl\(base, target\)/.test(links), /page\.goto\(/.test(links)], [true, true, false]);
eq('links: a throttled anchor target is links/unmeasured (info) + noteThrottled, and its suspects skip broken-anchor', [/finding\('links', 'unmeasured', 'info', target/.test(links), /noteThrottled\(\);/.test(links), /if \(ids === 'throttled'\) continue;/.test(links)], [true, true, true]);

// browser half
let pw = null;
try { pw = await loadPlaywright(); } catch { /* not installed */ }
if (!pw) {
  console.log('SKIP browse-throttle browser half: playwright is not resolvable from the cwd — run from the EDS project');
} else {
  configureFetch({ backoffMs: 10 });
  resetInfraCounters();
  setFetchLimiter(createHostLimiter({ maxInFlight: 2 }));
  const hits = {};
  const html = (title, css) => `<!doctype html><html><head><title>${title}</title>${css ? '<link rel="stylesheet" href="/throttled.css">' : ''}</head><body><main><div><h1>${title}</h1><p>${'text '.repeat(40)}</p></div></main></body></html>`;
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits[path] = (hits[path] || 0) + 1;
    if (path === '/flaky-doc' && hits[path] % 2 === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; } // 429 on the first hit of each viewport pass
    if (path === '/throttled.css') { res.writeHead(429, { 'retry-after': '0' }); res.end(''); return; }
    if (path === '/throttled-css') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html('css throttled', true)); return; }
    if (path === '/flaky-doc') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html('flaky doc')); return; }
    res.writeHead(404); res.end('');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const outDir = mkdtempSync(join(tmpdir(), 'browse-throttle-'));
  const ctx = { base: origin, inventory: { pages: [{ path: '/flaky-doc' }, { path: '/throttled-css' }] }, opts: { outDir, baselineDir: join(outDir, 'baselines'), skipA11y: true, browserConcurrency: 1 } };
  const findings = await run(ctx);
  const of = (path, id) => findings.filter((f) => f.path === path && f.id === id);
  eq('flaky document was retried to 200 (4 hits: 429,200 × 2 viewports)', hits['/flaky-doc'], 4);
  eq('flaky-doc: no request-failed from the retried 429', of('/flaky-doc', 'request-failed').length, 0);
  eq('flaky-doc: no unmeasured', of('/flaky-doc', 'unmeasured').length, 0);
  eq('flaky-doc: baseline created for both viewports', [of('/flaky-doc', 'baseline-created').length, of('/flaky-doc', 'baseline-skipped').length], [2, 0]);
  eq('throttled-css: rendered/unmeasured (info) per viewport', of('/throttled-css', 'unmeasured').map((f) => [f.check, f.severity]), [['rendered', 'info'], ['rendered', 'info']]);
  eq('throttled-css: no request-failed / main-collapsed / baseline', ['request-failed', 'main-collapsed', 'baseline-created', 'baseline-skipped'].map((id) => of('/throttled-css', id).length), [0, 0, 0, 0]);
  eq('report.infra counts the throttled page passes', infraCounters().throttled, 2);
  server.close();
  setFetchLimiter(null);
  rmSync(outDir, { recursive: true, force: true });
}

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('browse throttle path: all assertions pass');
