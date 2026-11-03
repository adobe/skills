#!/usr/bin/env node
/**
 * Source header probes, for the header template (clef/header.mjs): scroll behaviour and the
 * desktop/mobile breakpoint (desktop session), and the mobile menu opened, then its first
 * expandable item (mobile session). Run after open-menus.mjs (it probes the first menu's label).
 * Usage: node header-probes.mjs <url> <sourceDir>
 * Adds `header` and `mobileMenu` to <sourceDir>/open/open.json; writes open/mobile-menu.png and
 * open/mobile-item.png.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSession, openSession, runCode } from './lib/browser.mjs';
import { isMain } from './lib/is-main.mjs';
import { AB_TESTS, STEADY } from './lib/ab-tests.mjs';
import { VISIBLE_OVERLAYS } from './lib/overlay-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const togglesJs = join(here, 'lib/toggles.js');

/**
 * The probes as a function (the web-header binary's `header capture`): adds `header` and
 * `mobileMenu` to <sourceDir>/open/open.json and returns { open, line } (its content, the line the
 * command prints).
 */
export function headerProbes(url, outArg) {
  const out = resolve(outArg);
  const hideCss = JSON.parse(readFileSync(join(out, 'overlays.json'), 'utf8')).hideCss || '';
  const openFile = join(out, 'open', 'open.json');
  const openStates = JSON.parse(readFileSync(openFile, 'utf8'));
  const t0 = Date.now();

  openSession('plg-src-h', { width: 1440, height: 900 });
  try {
    openStates.header = runCode('plg-src-h', `async page => {
    await page.context().route(${AB_TESTS}, (r) => r.abort());
    await page.context().addInitScript(${STEADY});
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load').catch(() => {});
    if (${JSON.stringify(hideCss)}) await page.addStyleTag({ content: ${JSON.stringify(hideCss)} });
    await page.addScriptTag({ path: ${JSON.stringify(togglesJs)} });
    await page.waitForTimeout(1200);
    const label = ${JSON.stringify(openStates.states[0]?.label || null)};
    const scroll = await page.evaluate(async (lbl) => window.__plgScrollProbe(lbl), label);
    // breakpoint: the smallest probed width that still shows the desktop nav (the real one lies
    // between it and the next probed width)
    // a label not found at 1440 gives no breakpoint, not a bogus one (stripe-v3-clef-01 got 1440)
    if (!(await page.evaluate((lbl) => window.__plgLabelVisible(lbl), label))) {
      return JSON.stringify({ scroll, breakpoint: null });
    }
    let shownAt = 1440;
    let hiddenAt = null;
    for (const w of [1366, 1280, 1200, 1140, 1100, 1024, 992, 960, 900, 850, 800, 768]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(250);
      if (!(await page.evaluate((lbl) => window.__plgLabelVisible(lbl), label))) { hiddenAt = w; break; }
      shownAt = w;
    }
    return JSON.stringify({ scroll, breakpoint: { shownAt, hiddenAt } });
  }`);
  } finally {
    closeSession('plg-src-h');
  }
  openSession('plg-src-mm', { width: 390, height: 844 });
  try {
    openStates.mobileMenu = runCode('plg-src-mm', `async page => {
    await page.context().route(${AB_TESTS}, (r) => r.abort());
    await page.context().addInitScript(${STEADY});
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load').catch(() => {});
    if (${JSON.stringify(hideCss)}) await page.addStyleTag({ content: ${JSON.stringify(hideCss)} });
    await page.addScriptTag({ path: ${JSON.stringify(togglesJs)} });
    await page.waitForTimeout(1200);
    const toggle = await page.evaluateHandle(() => window.__plgMobileToggle());
    if (!(await toggle.asElement())) return JSON.stringify({ toggle: false });
    const before = await page.evaluate(() => window.__plgVisibleLinks());
    await toggle.asElement().click();
    const revealed = await page.evaluate((n) => window.__plgWaitReveal(n), before);
    await page.waitForTimeout(700);
    // a consent layer shown by JS that the click loaded (wpbeginner) is hidden like the capture's
    const lateOverlays = (await page.evaluate(${VISIBLE_OVERLAYS})).map((o) => o.selector);
    if (lateOverlays.length) await page.addStyleTag({ content: lateOverlays.join(', ') + ' { display: none !important; }' });
    await page.screenshot({ path: ${JSON.stringify(join(out, 'open', 'mobile-menu.png'))} });
    const label = ${JSON.stringify(openStates.states[0]?.label || null)};
    let item = false;
    if (label) {
      const el = page.getByText(label, { exact: true }).filter({ visible: true }).first();
      try { await el.click({ timeout: 3000 }); item = true; } catch { /* no expandable item */ }
      await page.waitForTimeout(700);
      if (item) await page.screenshot({ path: ${JSON.stringify(join(out, 'open', 'mobile-item.png'))} });
    }
    return JSON.stringify({ toggle: true, revealed, lateOverlays, item });
  }`);
  } finally {
    closeSession('plg-src-mm');
  }
  writeFileSync(openFile, JSON.stringify(openStates, null, 2));
  const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] header ${JSON.stringify(openStates.header)}; `
    + `mobile menu ${JSON.stringify(openStates.mobileMenu)}`;
  return { open: openStates, line };
}

if (isMain(import.meta.url)) {
  const [url, outArg] = process.argv.slice(2);
  if (!url || !outArg) {
    console.error('usage: node header-probes.mjs <url> <sourceDir>');
    process.exit(2);
  }
  console.log(headerProbes(url, outArg).line);
}
