// Test driver (copied next to the instruments at test time): run
// dismissOverlays on <url> with the JSON options in argv[3], print JSON.
import { chromium } from 'playwright';
import { dismissOverlays } from '../diff/live-session.mjs';
const [url, optsJson] = process.argv.slice(2);
const opts = JSON.parse(optsJson || '{}');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(opts.preWait || 300);
const d = await dismissOverlays(page, opts);
const state = await page.evaluate(() => ({
  consent: document.body.dataset.consent || null,
  floatingVisibility: (() => { const el = document.getElementById('ot-sdk-btn-floating'); return el ? getComputedStyle(el).visibility : null; })(),
  hiddenCount: document.querySelectorAll('[data-stardust-hidden]').length,
}));
let frameClosed = null;
for (const f of page.frames()) if (f !== page.mainFrame()) frameClosed = await f.evaluate(() => document.body.dataset.closed || null).catch(() => null);
console.log(JSON.stringify({ d, state, frameClosed }));
await browser.close();
