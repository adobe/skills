/**
 * Source open states: each top-nav menu opened in turn (viewport shot + visible link count), so
 * the built menus can be compared with the source's. A fresh load per toggle, with the capture's
 * overlay hide rules (overlays.json hideCss). Part of `web header capture`, after the views.
 * Writes <sourceDir>/open/{<i>.png,<i>.styles.txt,open.json}; each state also lists the consent
 * layers still visible when it was shot (visibleOverlays, overlay-probe.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeSession, openSession, runCode } from './browser.mjs';
import { VISIBLE_OVERLAYS } from './overlay-probe.mjs';
import { AB_TESTS, STEADY } from './steady.mjs';
import { loadBundle } from '#src/bundles/index.mjs';

const freezeCss = loadBundle('header-freeze.css');
const togglesJs = loadBundle('header-toggles.js');
const extractor = loadBundle('header-extract.js');

/**
 * The capture step as a function (the web-header binary's `header capture`): writes
 * <sourceDir>/open/ and returns { open, line, incomplete } (open.json's content, the line the
 * command prints, the menus it found but could not open). `roots`: the header's selectors (its
 * regions), where the toggles are looked for besides header and nav.
 */
export function openMenus(url, outArg, roots = []) {
  const out = resolve(outArg);
  const hideCss = JSON.parse(readFileSync(join(out, 'overlays.json'), 'utf8')).hideCss || '';
  const t0 = Date.now();
  mkdirSync(join(out, 'open'), { recursive: true });
  openSession('plg-src-o', { width: 1440, height: 900 });
  let openStates;
  try {
    openStates = runCode(
      'plg-src-o',
      `async first => {
  await first.context().route(${AB_TESTS}, (r) => r.abort());
  await first.context().addInitScript(${STEADY});
  // a fresh page per state: the previous one may still navigate from JS after a toggle's click
  // (link tracking) and overtake the reload (a WordPress site); closing it stops that
  let page = first;
  let loaded = false;
  const load = async () => {
    if (loaded) {
      const old = page;
      page = await old.context().newPage();
      await old.close();
    }
    loaded = true;
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load').catch(() => {});
    if (${JSON.stringify(hideCss)}) await page.addStyleTag({ content: ${JSON.stringify(hideCss)} });
    await page.addStyleTag({ content: ${JSON.stringify(freezeCss)} });
    await page.addScriptTag({ content: ${JSON.stringify(togglesJs)} });
    await page.addScriptTag({ content: ${JSON.stringify(extractor)} });
    await page.waitForTimeout(1200);
  };
  const states = [];
  const dumps = [];
  await load();
  const roots = ${JSON.stringify(roots)};
  const toggles = await page.evaluate((r) => window.__plgToggles(r), roots);
  await page.evaluate(() => window.__plgMarkVisibleLinks());
  const closed = await page.evaluate(() => window.__plgVisibleLinks());
  const closedOverlays = await page.evaluate(${VISIBLE_OVERLAYS});
  for (const [i, t] of toggles.entries()) {
    if (i) { await load(); await page.evaluate(() => window.__plgMarkVisibleLinks()); }
    // the visible label: a closed panel can hold the same text (a column heading) before it
    const el = page.locator(['header', 'nav', ...roots].join(', ')).getByText(t.label, { exact: true }).filter({ visible: true }).first();
    // hover first: a menu that opens on hover is a hover menu, whatever a click would do
    let trigger = 'hover';
    try { await el.hover({ timeout: 3000 }); } catch { /* not hoverable */ }
    await page.waitForTimeout(700);
    let links = await page.evaluate(() => window.__plgVisibleLinks());
    if (links - closed <= 0) {
      trigger = 'click';
      try { await el.click({ timeout: 3000 }); } catch { states.push({ ...t, error: 'not clickable' }); continue; }
      await page.waitForTimeout(700);
      // a toggle that is a plain link leaves the page (a WordPress site): no open state, not a crash
      try { links = await page.evaluate(() => window.__plgVisibleLinks()); } catch (e) {
        states.push({ ...t, error: 'navigates: ' + e.message.split('\\n')[0].slice(0, 80) });
        continue;
      }
    }
    const file = ${JSON.stringify(join(out, 'open'))} + '/' + i + '.png';
    await page.screenshot({ path: file });
    const visibleOverlays = await page.evaluate(${VISIBLE_OVERLAYS});
    const panel = await page.evaluate(() => window.__plgOpenPanel());
    // the open panel's computed styles, in the same compact dump as the regions: the header
    // template fills its panel and tab values from it
    const dump = panel ? JSON.parse(await page.evaluate(() => window.__plgRegionsBySelector(['[data-plg-panel]'], 600)))[0] : null;
    if (dump) dumps.push({ file: i + '.styles.txt', styles: dump.styles });
    states.push({ ...t, file: i + '.png', links, newLinks: links - closed, trigger, panel, visibleOverlays });
    await page.mouse.move(720, 880);
  }
  return JSON.stringify({ closedLinks: closed, closedOverlays, states, dumps });
}`,
    );
  } finally {
    closeSession('plg-src-o');
  }
  for (const d of openStates.dumps || []) writeFileSync(join(out, 'open', d.file), d.styles);
  delete openStates.dumps;
  writeFileSync(join(out, 'open', 'open.json'), JSON.stringify(openStates, null, 2));
  // a toggle that is a plain link (it navigates) is not a menu; one that could not be opened is a
  // menu the checks would not cover: the capture says so
  const incomplete = notOpened(openStates);
  const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] open states: ${openStates.states
    .map((st) =>
      st.error
        ? `${st.label}(${/^navigates/.test(st.error) ? 'a link, not a menu' : `NOT OPENED: ${st.error}`})`
        : `${st.label}(+${st.newLinks}, ${st.trigger})`,
    )
    .join(' ')}`;
  return { open: openStates, line, incomplete };
}

/** The menus a capture found and could not open (open.json `states`): `<label>: <reason>`. */
export function notOpened(open) {
  return (open.states || [])
    .filter((st) => st.error && !/^navigates/.test(st.error))
    .map((st) => `${st.label}: ${st.error}`);
}
