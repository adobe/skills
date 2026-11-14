/**
 * qa/checks/perf.mjs — category I: performance guardrails (rendered layer).
 *
 * Runs on representative pages only (one per template + home, capped) — perf
 * regressions are template-shaped, not page-shaped.
 *
 * Per page (chromium + CDP Network domain):
 *   - transfer weight (encoded bytes over the wire) vs budget
 *   - JS transfer weight vs budget
 *   - LCP and CLS via buffered PerformanceObserver
 *   - player-host requests (any frame) that start before the first contentful
 *     paint (deploy SKILL.md #157) — never downgraded on a degraded network: a
 *     player mounted after first paint cannot request before it
 *
 * Network-degradation control: TTFB to a neutral host first — if the network
 * itself is slow, findings are downgraded to info (a degraded measurement
 * window must not read as a site regression).
 */
import { openBrowser, newContext, goto, finding, pageUrl, attachOriginAuth } from '../lib.mjs';

const BUDGET_TRANSFER_KB = 800;
const BUDGET_JS_KB = 250;
const LCP_GOOD_MS = 2500;
const CLS_GOOD = 0.1;
const NEUTRAL_HOST = 'https://www.google.com';
const DEGRADED_TTFB_MS = 1500;
const PLAYER_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'brightcove.net', 'wistia.com',
  'wistia.net', 'jwplayer.com', 'vidyard.com', 'dailymotion.com'];
// the player itself: its document, scripts and API calls — a click-to-load poster (image) is not one
const PLAYER_TYPES = ['document', 'script', 'xhr', 'fetch'];

/** Pure: player requests judged against the first contentful paint. `requests` is
 *  `[{ url, type, t, heard, after }]` (Playwright resource type; epoch ms): `t` the browser's start
 *  time or null, `heard` when this process received the event (always after the start), `after`
 *  the start of the request's frame document (no request precedes its frame) or null. Returns
 *  `{ early, unmeasured }`: `early` started before FCP (`t`, else `heard`, before it); `unmeasured`
 *  has no start time and neither bound decides — never assumed after the paint. A missing FCP
 *  judges nothing. Hosts match on the hostname or a dot-bounded suffix, never a URL substring. */
export function judgePlayerRequests(requests, fcp, hosts = PLAYER_HOSTS) {
  const out = { early: [], unmeasured: [] };
  if (!Number.isFinite(fcp) || fcp <= 0) return out;
  const isPlayer = (u) => {
    let h; try { h = new URL(u).hostname; } catch { return false; }
    return hosts.some((d) => h === d || h.endsWith(`.${d}`));
  };
  for (const r of requests) {
    if (!PLAYER_TYPES.includes(r.type) || !isPlayer(r.url)) continue;
    const known = Number.isFinite(r.t) && r.t > 0;
    if (known ? r.t < fcp : r.heard < fcp) {
      out.early.push({ url: r.url, type: r.type, msBeforeFcp: Math.round(fcp - (known ? r.t : r.heard)) });
    } else if (!known && !(r.after >= fcp)) out.unmeasured.push({ url: r.url, type: r.type });
  }
  return out;
}

/** Every request of `page`, any frame (out-of-process iframes included), dated by the browser:
 *  `timing().startTime` once a response arrived, else the `wallTime` the page's CDP session (`cdp`,
 *  Network enabled; main and in-process frames) saw for the URL. Never the time this process
 *  handled the event — a busy process hears of a pre-paint request after the paint; that time only
 *  rides along as `heard`, an upper bound. */
export function collectRequests(page, cdp) {
  const seen = []; const wall = new Map(); // url → earliest browser start, ms
  cdp?.on('Network.requestWillBeSent', (e) => {
    const t = e.wallTime * 1000;
    if (!(wall.get(e.request.url) <= t)) wall.set(e.request.url, t);
  });
  page.on('request', (r) => seen.push({ r, heard: Date.now() }));
  return () => {
    const start = (r) => { const t = r.timing().startTime; return t > 0 ? t : (wall.get(r.url()) ?? null); };
    const frameOf = (r) => { try { return r.frame(); } catch { return null; } }; // service workers have none
    const docStart = new Map();
    for (const { r } of seen) if (r.isNavigationRequest() && !docStart.has(frameOf(r))) docStart.set(frameOf(r), start(r));
    return seen.map(({ r, heard }) => ({
      url: r.url(), type: r.resourceType(), t: start(r), heard, after: docStart.get(frameOf(r)) ?? null,
    }));
  };
}

function representatives(inventory, cap) {
  const byTemplate = new Map();
  for (const p of inventory.pages) {
    const key = p.template || '(untyped)';
    if (!byTemplate.has(key)) byTemplate.set(key, p);
  }
  const reps = [...byTemplate.values()];
  if (!reps.some((p) => p.path === '/') && inventory.pages.some((p) => p.path === '/')) {
    reps.unshift(inventory.pages.find((p) => p.path === '/'));
  }
  return reps.slice(0, cap);
}

export async function run(ctx) {
  const { base, inventory, opts } = ctx;
  const findings = [];

  // neutral-host control
  let degraded = false;
  const t0 = Date.now();
  try {
    await fetch(NEUTRAL_HOST, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    const ttfb = Date.now() - t0;
    if (ttfb > DEGRADED_TTFB_MS) {
      degraded = true;
      findings.push(finding('perf', 'network-degraded', 'info', '',
        `neutral-host TTFB ${ttfb}ms > ${DEGRADED_TTFB_MS}ms — perf findings except player-before-paint downgraded to info this run`));
    }
  } catch {
    degraded = true;
    findings.push(finding('perf', 'network-degraded', 'info', '', 'neutral-host probe failed — perf findings except player-before-paint downgraded to info'));
  }
  const sev = (s) => (degraded ? 'info' : s);

  const browser = await openBrowser({ mode: 'plain' });
  const reps = representatives(inventory, opts.perfPages || 10);

  for (const p of reps) {
    const context = await newContext(browser, { viewport: { width: 1440, height: 900 } });
    await attachOriginAuth(context);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    let transfer = 0; let jsTransfer = 0;
    const types = new Map(); // requestId -> resourceType
    client.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
    client.on('Network.loadingFinished', (e) => {
      transfer += e.encodedDataLength;
      if (types.get(e.requestId) === 'Script') jsTransfer += e.encodedDataLength;
    });
    const requests = collectRequests(page, client);

    try {
      await goto(page, pageUrl(base, p.url || p.path), { waitUntil: 'load', timeout: 60000 });
    } catch {
      findings.push(finding('perf', 'load-timeout', sev('warn'), p.path, 'page did not fire load within 60s'));
      await context.close();
      continue;
    }
    await page.waitForTimeout(4000); // let LCP/CLS settle and late resources land

    const vitals = await page.evaluate(() => new Promise((resolve) => {
      let lcp = 0; let cls = 0;
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      const fcp = paint ? performance.timeOrigin + paint.startTime : 0;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* not supported */ }
      setTimeout(() => resolve({ lcp: Math.round(lcp), cls: +cls.toFixed(3), fcp }), 500);
    }));

    const kb = Math.round(transfer / 1024);
    const jsKb = Math.round(jsTransfer / 1024);
    const budget = opts.budgetTransferKb || BUDGET_TRANSFER_KB;
    if (kb > budget) {
      findings.push(finding('perf', 'transfer-over-budget', sev('warn'), p.path,
        `transfer weight ${kb}KB exceeds ${budget}KB budget (template: ${p.template || 'n/a'})`, { kb, jsKb }));
    }
    if (jsKb > (opts.budgetJsKb || BUDGET_JS_KB)) {
      findings.push(finding('perf', 'js-over-budget', sev('warn'), p.path,
        `JS transfer ${jsKb}KB exceeds ${opts.budgetJsKb || BUDGET_JS_KB}KB budget`, { kb, jsKb }));
    }
    if (vitals.lcp > LCP_GOOD_MS) {
      findings.push(finding('perf', 'lcp-poor', sev('warn'), p.path,
        `lab LCP ${vitals.lcp}ms > ${LCP_GOOD_MS}ms (template: ${p.template || 'n/a'})`, vitals));
    }
    if (vitals.cls > CLS_GOOD) {
      findings.push(finding('perf', 'cls-poor', sev('warn'), p.path,
        `lab CLS ${vitals.cls} > ${CLS_GOOD}`, vitals));
    }
    const { early, unmeasured } = judgePlayerRequests(requests(), vitals.fcp);
    if (early.length) {
      findings.push(finding('perf', 'player-before-paint', 'warn', p.path,
        `${early.length} player request(s) started before first contentful paint, first ${early[0].url} — mount the player after first paint (deploy #157)`,
        { requests: early.slice(0, 5) }));
    } else if (unmeasured.length) {
      findings.push(finding('perf', 'player-timing-unknown', 'warn', p.path,
        `${unmeasured.length} player request(s) had no browser start time, first ${unmeasured[0].url} — player-before-paint could not judge them`,
        { requests: unmeasured.slice(0, 5) }));
    }
    delete vitals.fcp;
    findings.push(finding('perf', 'measurement', 'info', p.path,
      `transfer ${kb}KB (js ${jsKb}KB), LCP ${vitals.lcp}ms, CLS ${vitals.cls}${degraded ? ' [degraded network]' : ''}`,
      { kb, jsKb, ...vitals, template: p.template }));

    await context.close();
  }

  await browser.close();
  return findings;
}
