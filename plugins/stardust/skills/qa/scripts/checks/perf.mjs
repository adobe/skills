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
 *
 * Network-degradation control: TTFB to a neutral host first — if the network
 * itself is slow, findings are downgraded to info (a degraded measurement
 * window must not read as a site regression).
 */
import { loadPlaywright, finding, pageUrl } from '../lib.mjs';

const BUDGET_TRANSFER_KB = 800;
const BUDGET_JS_KB = 250;
const LCP_GOOD_MS = 2500;
const CLS_GOOD = 0.1;
const NEUTRAL_HOST = 'https://www.google.com';
const DEGRADED_TTFB_MS = 1500;

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
        `neutral-host TTFB ${ttfb}ms > ${DEGRADED_TTFB_MS}ms — perf findings downgraded to info this run`));
    }
  } catch {
    degraded = true;
    findings.push(finding('perf', 'network-degraded', 'info', '', 'neutral-host probe failed — perf findings downgraded to info'));
  }
  const sev = (s) => (degraded ? 'info' : s);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const reps = representatives(inventory, opts.perfPages || 10);

  for (const p of reps) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

    try {
      await page.goto(pageUrl(base, p.path), { waitUntil: 'load', timeout: 60000 });
    } catch {
      findings.push(finding('perf', 'load-timeout', sev('warn'), p.path, 'page did not fire load within 60s'));
      await context.close();
      continue;
    }
    await page.waitForTimeout(4000); // let LCP/CLS settle and late resources land

    const vitals = await page.evaluate(() => new Promise((resolve) => {
      let lcp = 0; let cls = 0;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* not supported */ }
      setTimeout(() => resolve({ lcp: Math.round(lcp), cls: +cls.toFixed(3) }), 500);
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
    findings.push(finding('perf', 'measurement', 'info', p.path,
      `transfer ${kb}KB (js ${jsKb}KB), LCP ${vitals.lcp}ms, CLS ${vitals.cls}${degraded ? ' [degraded network]' : ''}`,
      { kb, jsKb, ...vitals, template: p.template }));

    await context.close();
  }

  await browser.close();
  return findings;
}
