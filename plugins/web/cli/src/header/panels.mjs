/**
 * Are the page's open menus 1:1 with the source's? Pixels and hrefs only.
 * Desktop (1440 x 900): each menu the capture opened (`source/open/open.json`) is opened on the
 * page as the source opens it (hover or click on its visible label, a fresh load per menu, the
 * capture's freeze), then shot. Scored: the pixel mismatch inside the source's open panel box
 * (`panel.rect`) only, and the revealed links' hrefs against the capture's `panel.items`.
 * Mobile (390 x 844): the burger opened as `probes.mjs` opens it on the source, the viewport
 * shot against `source/open/mobile-menu.png` (skipped when the source has no such shot).
 * The capture's overlay hide rules are applied only when the page is the source itself (floors).
 * `web header check panels <page url> <sourceDir> <outDir>`: writes
 * <outDir>/{<i>.png,mobile-menu.png,panels.json}; one line per check.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeSession, openSession, runCode } from './browser.mjs';
import { AB_TESTS, STEADY } from './steady.mjs';
import { VISIBLE_OVERLAYS } from './overlay-probe.mjs';
import { PNG, pixelmatch } from './imaging.mjs';
import { loadBundle } from '#src/bundles/index.mjs';

// the 1:1 bar of the header runs these checks come from (adobe/skills#533), fixed before them
export const MAX_PANEL = 1.5;
export const MAX_MOBILE = 2.0;

/** RGBA pixels composited on white, opaque (a browser window shows a page on white). */
export function onWhite(data) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(out[i + c] * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Pixel mismatch % of two PNGs inside `rect` ({x, y, w, h}, clipped to both), or the whole
 * overlap, both on white: semi-transparent pixels in a source shot are not a difference. */
export function boxMismatch(a, b, rect = null) {
  const x = Math.max(0, rect?.x ?? 0);
  const y = Math.max(0, rect?.y ?? 0);
  const w = Math.min(rect?.w ?? Infinity, a.width - x, b.width - x);
  const h = Math.min(rect?.h ?? Infinity, a.height - y, b.height - y);
  if (w <= 0 || h <= 0) return null;
  const crop = (img) => {
    const o = new PNG({ width: w, height: h });
    PNG.bitblt(img, o, x, y, w, h, 0, 0);
    return onWhite(o.data);
  };
  return +((100 * pixelmatch(crop(a), crop(b), null, w, h, { threshold: 0.1 })) / (w * h)).toFixed(
    2,
  );
}

/**
 * The page's revealed hrefs against the source's, as multisets. A page link on the page's own
 * origin is read as the same path on the source's origin (a relative link to the source's path).
 */
export function hrefDiff(expected, got, pageOrigin, sourceOrigin) {
  const norm = (h) =>
    h.startsWith(`${pageOrigin}/`) ? sourceOrigin + h.slice(pageOrigin.length) : h;
  const left = [...expected];
  const extra = [];
  for (const h of got.map(norm)) {
    const i = left.indexOf(h);
    if (i === -1) extra.push(h);
    else left.splice(i, 1);
  }
  return { missing: left, extra };
}

/** Problems of one open menu: not opened, panel pixels over the bar, hrefs missing or extra. */
export function panelVerdict({ error, mismatch, missing = [], extra = [] }) {
  if (error) return [error];
  const problems = [];
  if (mismatch == null || mismatch > MAX_PANEL)
    problems.push(`panel mismatch ${mismatch ?? '-'} % > ${MAX_PANEL} %`);
  if (missing.length)
    problems.push(`${missing.length} href(s) missing: ${missing.slice(0, 3).join(' ')}`);
  if (extra.length)
    problems.push(`${extra.length} href(s) not in the capture: ${extra.slice(0, 3).join(' ')}`);
  return problems;
}

/** Problems of the mobile menu: no toggle, or the open viewport over the bar. */
export function mobileVerdict({ error, mismatch }) {
  if (error) return [error];
  return mismatch == null || mismatch > MAX_MOBILE
    ? [`mobile menu mismatch ${mismatch ?? '-'} % > ${MAX_MOBILE} %`]
    : [];
}

const FREEZE = loadBundle('header-freeze.css');
const TOGGLES = loadBundle('header-toggles.js');

// a fresh page per load (open-menus.mjs: a JS navigation from the previous one can overtake it)
const LOAD = (url, hideCss, freeze) => `let page = first;
  let loaded = false;
  const load = async () => {
    if (loaded) { const old = page; page = await old.context().newPage(); await old.close(); }
    loaded = true;
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('load').catch(() => {});
    if (${JSON.stringify(hideCss)}) await page.addStyleTag({ content: ${JSON.stringify(hideCss)} });
    if (${freeze}) await page.addStyleTag({ content: ${JSON.stringify(FREEZE)} });
    await page.addScriptTag({ content: ${JSON.stringify(TOGGLES)} });
    // an EDS header is decorated after load: wait for its block, then the capture's 1200 ms (later,
    // the source itself changes: a WordPress site's panels moved 1 px, 0.7-1.2 % at 2.5 s)
    await page.waitForFunction(() => !window.hlx
      || document.querySelector('body > header .header[data-block-status="loaded"]'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };`;

function shootPanels(session, url, states, out, hideCss) {
  openSession(session, { width: 1440, height: 900 });
  try {
    return runCode(
      session,
      `async first => {
  await first.context().route(${AB_TESTS}, (r) => r.abort());
  await first.context().addInitScript(${STEADY});
  ${LOAD(url, hideCss, true)}
  const res = [];
  for (const st of ${JSON.stringify(states)}) {
    await load();
    await page.evaluate(() => window.__plgMarkVisibleLinks());
    // the visible label: a closed panel can hold the same text (a column heading) before it
    const el = page.locator('header, nav').getByText(st.label, { exact: true }).filter({ visible: true }).first();
    try {
      if (st.trigger === 'click') await el.click({ timeout: 3000 }); else await el.hover({ timeout: 3000 });
    } catch { res.push({ label: st.label, error: 'could not be opened (label not found or covered)' }); continue; }
    await page.waitForTimeout(700);
    await page.screenshot({ path: ${JSON.stringify(out)} + '/' + st.file });
    const panel = await page.evaluate(() => window.__plgOpenPanel());
    res.push({ label: st.label, file: st.file, hrefs: (panel?.items || []).map((i) => i.href) });
  }
  return JSON.stringify(res);
}`,
    );
  } finally {
    closeSession(session);
  }
}

function shootMobile(session, url, out, hideCss, isSource) {
  openSession(session, { width: 390, height: 844 });
  try {
    return runCode(
      session,
      `async first => {
  await first.context().route(${AB_TESTS}, (r) => r.abort());
  await first.context().addInitScript(${STEADY});
  ${LOAD(url, hideCss, false)}
  await load();
  const toggle = await page.evaluateHandle(() => window.__plgMobileToggle());
  if (!(await toggle.asElement())) return JSON.stringify({ error: 'no mobile menu toggle found' });
  const before = await page.evaluate(() => window.__plgVisibleLinks());
  await toggle.asElement().click();
  await page.evaluate((n) => window.__plgWaitReveal(n), before);
  await page.waitForTimeout(700);
  // on the source, a consent layer the click's JS showed is hidden as header-probes.mjs hides it
  if (${isSource}) {
    const late = (await page.evaluate(${VISIBLE_OVERLAYS})).map((o) => o.selector);
    if (late.length) await page.addStyleTag({ content: late.join(', ') + ' { display: none !important; }' });
  }
  await page.screenshot({ path: ${JSON.stringify(join(out, 'mobile-menu.png'))} });
  return JSON.stringify({});
}`,
    );
  } finally {
    closeSession(session);
  }
}

const readPng = (f) => PNG.sync.read(readFileSync(f));

/**
 * The check as a function (the web-header binary's `header check panels`): { ok, panels, mobile,
 * lines }, as panels.json plus the lines the command prints. Writes <outDir> (cleared first).
 */
export function checkPanels(url, srcArg, outArg, session = 'open-panels') {
  const lines = [];
  const src = resolve(srcArg);
  const out = resolve(outArg);
  const open = JSON.parse(readFileSync(join(src, 'open', 'open.json'), 'utf8'));
  const sourceUrl = JSON.parse(readFileSync(join(src, 'page.json'), 'utf8')).url;
  const isSource = new URL(url).origin === new URL(sourceUrl).origin;
  const hideCss = isSource
    ? JSON.parse(readFileSync(join(src, 'overlays.json'), 'utf8')).hideCss || ''
    : '';
  // shots of an earlier run must not be scored
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const states = open.states.filter((st) => st.file && st.panel?.rect);
  const shots = shootPanels(`${session}-d`, url, states, out, hideCss);
  const rows = shots.map((s) => {
    const st = states.find((x) => x.label === s.label);
    if (s.error) return { label: s.label, error: s.error };
    const mismatch = boxMismatch(
      readPng(join(src, 'open', st.file)),
      readPng(join(out, s.file)),
      st.panel.rect,
    );
    const diff = hrefDiff(
      st.panel.items.map((i) => i.href),
      s.hrefs,
      new URL(url).origin,
      new URL(sourceUrl).origin,
    );
    return {
      label: s.label,
      trigger: st.trigger,
      mismatch,
      links: s.hrefs.length,
      expected: st.panel.items.length,
      ...diff,
    };
  });
  const srcMobile = join(src, 'open', 'mobile-menu.png');
  let mobile = null;
  if (existsSync(srcMobile)) {
    const m = shootMobile(`${session}-m`, url, out, hideCss, isSource);
    mobile = m.error
      ? m
      : { mismatch: boxMismatch(readPng(srcMobile), readPng(join(out, 'mobile-menu.png'))) };
  }

  let failed = 0;
  for (const r of rows) {
    r.problems = panelVerdict(r);
    if (r.problems.length) failed += 1;
    lines.push(
      `${r.problems.length ? 'FAIL' : 'OK  '} ${r.label} (${r.trigger ?? '-'}): panel ${r.mismatch ?? '-'} %, ` +
        `${r.links ?? '-'} of ${r.expected ?? '-'} hrefs${r.problems.length ? ` - ${r.problems.join('; ')}` : ''}`,
    );
  }
  if (mobile) {
    mobile.problems = mobileVerdict(mobile);
    if (mobile.problems.length) failed += 1;
    lines.push(
      `${mobile.problems.length ? 'FAIL' : 'OK  '} mobile menu: ${mobile.mismatch ?? '-'} %` +
        `${mobile.problems.length ? ` - ${mobile.problems.join('; ')}` : ''}`,
    );
  } else lines.push('n/a  mobile menu: no source shot');
  const total = rows.length + (mobile ? 1 : 0);
  writeFileSync(join(out, 'panels.json'), JSON.stringify({ url, panels: rows, mobile }, null, 1));
  lines.push(failed ? `open panels: ${failed} of ${total} fail` : `open panels: ${total} ok`);
  return { ok: failed === 0, panels: rows, mobile, lines };
}
