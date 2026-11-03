/**
 * The layout shift of a page load at given widths, the page held still as the checks hold it:
 * the bar's compare measures it at 1440, 820 and 390 only, and a source that changes between
 * them (the retailer zooms its page at 992–1439 px) can shift where none of those look.
 * Usage: node cls-at.mjs <url> <width,width,...>  → { "<width>": cls }
 */
import { closeSession, openSession, runCode } from './browser.mjs';
import { STEADY } from './steady.mjs';

/** CLS at one width (the sum of the layout shifts without input, 4 s after load). */
export function clsAt(url, width, session = `cls-at-${width}`) {
  openSession(session, { width, height: 900 });
  try {
    return Number(
      runCode(
        session,
        `async page => {
      await page.addInitScript(${STEADY});
      await page.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(${JSON.stringify(url)}, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(4000);
      return String(await page.evaluate(() => Math.round(window.__cls * 1000) / 1000));
    }`,
      ),
    );
  } finally {
    closeSession(session);
  }
}
