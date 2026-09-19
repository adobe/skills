#!/usr/bin/env node
/**
 * Fixture test for the browser checks' 429/503 path beyond browse's document retry
 * (checks/browse.mjs decoration vs throttle, checks/perf.mjs, checks/ai-readability.mjs).
 * Run: node skills/qa/scripts/test/browser-unmeasured.test.mjs
 *
 * Against a local server (no origin is hit):
 *   browse   a page whose stylesheet is throttled AND whose sections never decorate reports ONE
 *            rendered row per viewport — `unmeasured` — and no `decoration-stalled` (a throttled
 *            page once read as two findings per viewport)
 *   perf     a representative whose document is always 429 → perf/unmeasured (info) and
 *            report.infra counts it (noteThrottled), the clean representative is still measured
 *   ai-readability  a page whose served fetch is always 429 → ai-readability/unmeasured (info),
 *            counted in report.infra, retried `throttleAttempts` times through the limiter; a page
 *            answering 429 once then 200 is scored (no unmeasured row); infra.retries counts the
 *            paced browser retries (perf's gotoPaced, ai-readability's scorePaced), not only fetchUrl's
 * SKIPped with exit 0 when playwright is not resolvable from the cwd (run from the EDS project).
 * Exit: 0 all assertions pass (or skipped) · 1 an assertion failed.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlaywright, configureFetch, infraCounters, resetInfraCounters, setFetchLimiter, createHostLimiter } from '../lib.mjs';

let pw = null;
try { pw = await loadPlaywright(); } catch { /* not installed */ }
if (!pw) { console.log('SKIP browser-unmeasured: playwright is not resolvable from the cwd — run from the EDS project'); process.exit(0); }

const { run: browse } = await import('../checks/browse.mjs');
const { run: perf } = await import('../checks/perf.mjs');
const { run: aiReadability } = await import('../checks/ai-readability.mjs');

let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

configureFetch({ backoffMs: 10 });
const hits = {};
const page = (title, { css = false, stalled = false } = {}) => `<!doctype html><html><head><title>${title}</title>${css ? '<link rel="stylesheet" href="/throttled.css">' : ''}</head><body><main><div${stalled ? ' data-section-status="initialized"' : ''}><h1>${title}</h1><p>${'text '.repeat(60)}</p></div></main></body></html>`;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  hits[path] = (hits[path] || 0) + 1;
  if (path === '/throttled.css') { res.writeHead(429, { 'retry-after': '0' }); res.end(''); return; }
  if (path === '/stalled-throttled') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('stalled', { css: true, stalled: true })); return; }
  if (path === '/perf-429' || path === '/ai-429') { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
  if (path === '/ai-flaky' && hits[path] === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
  if (path === '/ok' || path === '/ai-flaky') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(path)); return; }
  if (path === '/neutral') { res.writeHead(200); res.end(''); return; }
  res.writeHead(404); res.end('');
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const origin = `http://127.0.0.1:${server.address().port}`;
const outDir = mkdtempSync(join(tmpdir(), 'browser-unmeasured-'));
const of = (findings, path, id) => findings.filter((f) => f.path === path && f.id === id);

// browse: throttled css + stalled decoration → one row per viewport
resetInfraCounters(); setFetchLimiter(createHostLimiter({ maxInFlight: 2 }));
const bf = await browse({ base: origin, inventory: { pages: [{ path: '/stalled-throttled' }] }, opts: { outDir, baselineDir: join(outDir, 'baselines'), skipA11y: true, browserConcurrency: 1, decorationTimeoutMs: 300 } });
eq('browse: rendered/unmeasured once per viewport', of(bf, '/stalled-throttled', 'unmeasured').map((f) => f.check), ['rendered', 'rendered']);
eq('browse: no decoration-stalled on a throttled page', of(bf, '/stalled-throttled', 'decoration-stalled').length, 0);
eq('browse: nothing else reported for the throttled page', bf.filter((f) => f.path === '/stalled-throttled' && f.id !== 'unmeasured').map((f) => f.id), []);
eq('browse: infra counted both viewport passes', infraCounters().throttled, 2);

// perf: a 429 representative is counted in report.infra; the clean one is measured
resetInfraCounters();
const pf = await perf({ base: origin, inventory: { pages: [{ path: '/perf-429', template: 'a' }, { path: '/ok', template: 'b' }] }, opts: { perfPages: 10, neutralHost: `${origin}/neutral` } });
eq('perf: throttled representative → perf/unmeasured (info)', of(pf, '/perf-429', 'unmeasured').map((f) => [f.check, f.severity]), [['perf', 'info']]);
eq('perf: document retried three times', hits['/perf-429'], 3);
eq('perf: no measurement row for the throttled page', of(pf, '/perf-429', 'measurement').length, 0);
eq('perf: clean representative measured', of(pf, '/ok', 'measurement').length, 1);
eq('perf: report.infra counts the throttled page', infraCounters().throttled, 1);
eq('perf: the two paced retries are counted in infra.retries', infraCounters().retries, 2);

// ai-readability: through the limiter, paced retry, unmeasured never a score
resetInfraCounters();
const shared = {};
const af = await aiReadability({ base: origin, inventory: { pages: [{ path: '/ai-429' }, { path: '/ai-flaky' }] }, opts: {}, shared });
eq('ai-readability: always-429 → ai-readability/unmeasured (info)', of(af, '/ai-429', 'unmeasured').map((f) => [f.check, f.severity, f.evidence.status]), [['ai-readability', 'info', 429]]);
eq('ai-readability: served fetch retried three times', hits['/ai-429'], 3);
eq('ai-readability: no score / legacy unmeasured row for the throttled page', af.filter((f) => f.path === '/ai-429' && f.id !== 'unmeasured').length, 0);
eq('ai-readability: 429-once page is scored (served retry, then render)', [of(af, '/ai-flaky', 'unmeasured').length, shared.aiReadability.map((s) => s.path)], [0, ['/ai-flaky']]);
eq('ai-readability: report.infra counts the throttled page', infraCounters().throttled, 1);
eq('ai-readability: paced retries counted (two for the 429 wall, one for the flaky page)', infraCounters().retries, 3);

server.close();
setFetchLimiter(null);
rmSync(outDir, { recursive: true, force: true });
if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('browser unmeasured paths (browse decoration, perf, ai-readability): all assertions pass');
