const UNPIN =
  "[...document.body.querySelectorAll('*')].forEach(el => { " +
  'const s = getComputedStyle(el); ' +
  "if (s.position === 'fixed' || s.position === 'sticky') el.style.position = 'relative'; })";

/** Scroll to the bottom and back so lazy content loads. */
export function scrollForLazyContent(driver, session, { settleMs = 2000 } = {}) {
  driver.run(session, {
    code:
      'async page => { ' +
      'await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); ' +
      `await page.waitForTimeout(${Number(settleMs)}); ` +
      'await page.evaluate(() => window.scrollTo(0, 0)); }',
  });
}

/** Turn fixed/sticky elements into relative ones. */
export function unpinFixedElements(driver, session) {
  driver.evaluate(session, UNPIN);
}

/** Scroll for lazy content, then optionally unpin fixed elements. */
export function preparePage(driver, session, { unpin = false, settleMs } = {}) {
  scrollForLazyContent(driver, session, settleMs === undefined ? {} : { settleMs });
  if (unpin) unpinFixedElements(driver, session);
}
