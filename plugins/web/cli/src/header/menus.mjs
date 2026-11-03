/**
 * Do the page's top-nav menus work like the source's? For each menu the capture opened
 * (`source/open/open.json`), on the EDS page at 1440 px: open it the way the source does (hover
 * or click its label in the page's header: `body > header`, else the first `header`), count the
 * links that appear in the viewport (anywhere: a panel can live outside the header; counted by
 * `lib/toggles.js`, as the capture counts them) against the capture's, then close it the way the
 * source does (pointer away for hover, the label clicked again for click) and check it closes.
 * Usage: node menus.mjs <page url> <open.json> [session]
 * Prints one line per menu; exit 1 when one fails.
 */
import { readFileSync } from 'node:fs';
import { closeSession, openSession, runCode } from './browser.mjs';
import { STEADY } from './steady.mjs';
import { loadBundle } from '#src/bundles/index.mjs';

/**
 * Problems of one menu: too few links (under 80 % of the capture's), not closing, not opening.
 * `left` is null when the close step itself failed (the open panel covers its label).
 */
export function verdict({ expected, opened, left }) {
  if (opened == null) {
    return { ok: false, problems: ['could not be opened (label not found or covered)'] };
  }
  const problems = [];
  if (opened < Math.ceil(expected * 0.8)) problems.push(`opens ${opened} of ${expected} links`);
  if (left == null) problems.push('could not be closed (label covered or not clickable once open)');
  else if (left > 0) problems.push('stays open when the pointer leaves');
  return { ok: !problems.length, problems };
}

const TOGGLES = loadBundle('header-toggles.js');

const PROBE = `async (page, url, menus) => {
  await page.context().addInitScript(${STEADY});
  await page.goto(url, { waitUntil: 'load' });
  await page.addScriptTag({ content: ${JSON.stringify(TOGGLES)} });
  await page.waitForTimeout(2500);
  // the page's own header: body > header on EDS (a block may hold a <header>), else the first
  const scope = (await page.$('body > header')) ? 'body > header' : 'header';
  // visible links in the viewport, counted as the capture counts them (toggles.js: ancestor
  // opacity, so a closed dropdown is not shown); the difference with every menu closed is what a
  // menu shows
  const shown = () => page.evaluate(() => window.__plgVisibleLinks());
  const away = async () => {
    const vh = await page.evaluate(() => innerHeight);
    await page.mouse.move(5, vh - 5);
    await page.waitForTimeout(800);
  };
  const out = [];
  for (const m of menus) {
    await away();
    await page.keyboard.press('Escape');
    const closed = await shown();
    // the visible label: a closed panel can hold the same text (a column heading) before it
    const label = page.locator(scope).getByText(m.label, { exact: true }).filter({ visible: true }).first();
    let opened = null;
    let left = null;
    try {
      if (m.trigger === 'click') await label.click({ timeout: 4000 });
      else await label.hover({ timeout: 4000 });
      await page.waitForTimeout(700);
      opened = (await shown()) - closed;
      // a click menu closes as on the source: its label clicked again (backlinko's panel fills
      // the viewport, so an outside click lands in it)
      if (m.trigger === 'click') await label.click({ timeout: 4000 }); else await away();
      await page.waitForTimeout(500);
      left = (await shown()) - closed;
    } catch { /* opening failed: opened stays null; closing failed: left stays null */ }
    out.push({ label: m.label, trigger: m.trigger, expected: m.newLinks, opened, left });
  }
  return JSON.stringify(out);
}`;

/**
 * The check as a function (the web-header binary's `header check menus`): { ok, menus, lines },
 * `menus` one row per menu with its verdict, `lines` what the command prints.
 */
export function checkMenus(url, openFile, session = 'staged-menus') {
  const menus = JSON.parse(readFileSync(openFile, 'utf8'))
    .states.filter((s) => s.newLinks > 0)
    .map((s) => ({ label: s.label, trigger: s.trigger, newLinks: s.newLinks }));
  openSession(session, { width: 1440, height: 900 });
  let rows;
  try {
    const args = `${JSON.stringify(url)}, ${JSON.stringify(menus)}`;
    rows = runCode(session, `async page => (${PROBE})(page, ${args})`);
  } finally {
    closeSession(session);
  }
  const lines = [];
  const checked = rows.map((r) => ({ ...r, ...verdict(r) }));
  for (const r of checked) {
    const counts = `${r.opened ?? '-'} of ${r.expected} links`;
    lines.push(
      `${r.ok ? 'OK  ' : 'FAIL'} ${r.label} (${r.trigger}): ${counts}` +
        `${r.problems.length ? ` - ${r.problems.join('; ')}` : ''}`,
    );
  }
  const failed = checked.filter((r) => !r.ok).length;
  lines.push(failed ? `menus: ${failed} of ${rows.length} fail` : `menus: ${rows.length} ok`);
  return { ok: failed === 0, menus: checked, lines };
}
