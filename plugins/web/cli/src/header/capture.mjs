import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadBundle } from '#src/bundles/index.mjs';
import { CliError } from '#src/errors.mjs';
import { buildBundle, loadPatterns } from '#src/page/overlay-db.mjs';
import { closeSession, openSession, runCode, runCodeAsync } from './browser.mjs';
import { sharp } from './imaging.mjs';
import { headerProbes } from './probes.mjs';
import { openMenus } from './open-menus.mjs';
import { SELECTOR_OF, VISIBLE_OVERLAYS } from './overlay-probe.mjs';
import { AB_TESTS, STEADY } from './steady.mjs';
import { stitchTiles, TILED_SHOT } from './tiles.mjs';

/**
 * `web header capture`: the source's header as the checks need it, in one folder.
 * - Each viewport (desktop 1440x900, tablet 820x1180, mobile 390x844) is a fresh load held still:
 *   A/B services blocked, Math.random seeded, slow intervals stopped (steady.mjs); overlays found by
 *   the overlay database (the rules matching one element only), the heuristic (dialogs, fixed layers
 *   over most of the viewport) and the consent probe are hidden; the page is scrolled for lazy
 *   content, its animations finished; then shot full-page (<vp>.png).
 * - The header: the elements named by `header` (selectors), else the first `header`-like element
 *   shown at the top with the bands stacked above it (a promo bar outside the <header>); one
 *   region each, top first (`header`, `header-2`, ...), with its box per viewport.
 * - Then the open menus (open-menus.mjs) and the header probes (probes.mjs).
 * Writes <dir>/{page.json, overlays.json, desktop.png, tablet.png, mobile.png,
 * regions/<id>[.<vp>].{png,styles.txt}, regions/<id>.{html,txt}, open/...}.
 */
export const VIEWPORTS = { desktop: [1440, 900], tablet: [820, 1180], mobile: [390, 844] };

const settleSource = (prepBundle) => `
  async function settle(page) {
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const report = await page.evaluate(src => (0, eval)(src), ${JSON.stringify(prepBundle)});
    const rep = typeof report === 'string' ? JSON.parse(report) : report;
    // page-prep's selector can be a bare tag or a shared class ("div"): a rule matching more than its
    // overlay hides the page, so only rules whose selector matches one element are applied
    const prepFound = rep.overlays || [];
    const counts = await page.evaluate((sels) => sels.map((s) => {
      try { return document.querySelectorAll(s).length; } catch { return 0; }
    }), prepFound.map((o) => o.selector));
    rep.skippedHide = prepFound.filter((o, i) => counts[i] !== 1).map((o) => o.selector);
    const hide = prepFound.filter((o, i) => counts[i] === 1).flatMap(o => o.hide || []).join('\\n')
      + (rep.scroll_fix ? '\\nhtml,body{overflow:auto!important;position:static!important}' : '');
    if (hide) await page.addStyleTag({ content: hide });
    // overlays page-prep didn't know (geo pickers, platform consent dialogs): visible dialogs, and
    // fixed layers over most of the viewport holding only a small part of the page's text (a
    // modal and its backdrop, not a fixed app shell), are hidden in every session alike
    const overlays = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; };
      const vw = innerWidth * innerHeight;
      const found = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]')]
        .filter(vis);
      for (const e of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(e);
        if (cs.position !== 'fixed' || !vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width * r.height >= 0.5 * vw && (parseInt(cs.zIndex, 10) || 0) >= 10
          && e.innerText.length < 0.3 * document.body.innerText.length) found.push(e);
      }
      found.forEach((e) => e.setAttribute('data-plg-overlay', ''));
      // as selectors too: the attribute exists only in this session, open-menus.mjs loads afresh
      return found.map(${SELECTOR_OF});
    });
    const heuristicCss = overlays.map((sel) => sel + ' { display:none!important }').join('\\n');
    if (overlays.length) {
      await page.addStyleTag({ content: '[data-plg-overlay] { display: none !important; } html, body { overflow: auto !important; }' });
    }
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    // each step waits (up to 2 s) until the images in view have loaded and stopped changing: lazy
    // loaders that cancel a download when the image leaves the viewport miss a fast scroll on a busy machine
    const inViewLoaded = () => new Promise((done) => {
      const t0 = performance.now();
      let last = t0;
      const mo = new MutationObserver(() => { last = performance.now(); });
      mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'class'] });
      const inView = (i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; };
      const check = () => {
        const now = performance.now();
        const quiet = now - t0 >= 100 && now - last >= 100 && [...document.images].filter(inView).every((i) => i.complete);
        if (quiet || now - t0 > 2000) { mo.disconnect(); done(); } else setTimeout(check, 50);
      };
      setTimeout(check, 50);
    });
    for (let y = 0; y < h; y += 500) { await page.evaluate(v => scrollTo(0, v), y); await page.evaluate(inViewLoaded); }
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    // freeze time (carousels, rotating banners, rAF loops, CSS/Web animations, videos): the
    // screenshot and the snapshot taken later in the same session must show the same state
    await page.evaluate(() => {
      const top = setTimeout(() => {}, 0);
      for (let i = 0; i <= top; i += 1) { clearTimeout(i); clearInterval(i); }
      window.requestAnimationFrame = () => 0;
      // page code must not react to the animations we finish (slideshows advance on animationend)
      for (const t of ['animationstart', 'animationend', 'animationiteration', 'animationcancel',
        'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) {
        window.addEventListener(t, (e) => e.stopImmediatePropagation(), true);
      }
      for (const a of document.getAnimations()) {
        // scroll- and view-driven animations show the scroll position, not time: finishing one
        // jumps to its end (a header's "scrolled" look at the top of the page)
        if (a.timeline && !(a.timeline instanceof DocumentTimeline)) continue;
        try {
          if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); else a.pause();
        } catch { /* animation without a finite end or already gone */ }
      }
      document.querySelectorAll('video').forEach((v) => v.pause());
    });
    await page.waitForTimeout(300);
    // consent layers neither page-prep nor the heuristic hid (a payments site's cookie card): hidden by
    // selector, so open-menus.mjs and the snapshot hide them too; then probed again for the pre-flight
    rep.probeHidden = await page.evaluate(${VISIBLE_OVERLAYS});
    const probeCss = rep.probeHidden.map((o) => o.selector + ' { display:none!important }').join('\\n');
    if (probeCss) await page.addStyleTag({ content: probeCss });
    await page.evaluate((sels) => sels.forEach((s) => document.querySelectorAll(s)
      .forEach((e) => e.setAttribute('data-plg-overlay', ''))), rep.probeHidden.map((o) => o.selector));
    // fresh sessions (open-menus.mjs) get selectors; the snapshot gets the attribute: serializing
    // drops hidden top-level elements, which would move a positional selector onto the page
    rep.hideCss = [hide, heuristicCss, probeCss].filter(Boolean).join('\\n');
    rep.snapshotHideCss = [hide, '[data-plg-overlay] { display:none!important }'].filter(Boolean).join('\\n');
    rep.plgOverlays = overlays;
    rep.visibleOverlays = await page.evaluate(${VISIBLE_OVERLAYS});
    return rep;
  }`;

const SEED_RANDOM = `(() => { let s = 0x2f6b9a1d; Math.random = () => { s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const extractor = loadBundle('header-extract.js');

/** The load of one viewport: held still, settled, shot to `shot`; `prep` is the overlay report. */
const load = (url, prepBundle, shot) => `
    ${settleSource(prepBundle)}
    await page.addInitScript(${JSON.stringify(SEED_RANDOM)});
    await page.route(${AB_TESTS}, (r) => r.abort());
    await page.addInitScript(${STEADY});
    await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const prep = await settle(page);
    await (${TILED_SHOT})(page, ${JSON.stringify(shot)});
    await page.addScriptTag({ content: ${JSON.stringify(extractor)} });`;

async function crop(file, rect, dest) {
  const m = await sharp(file).metadata();
  const top = Math.max(0, rect.y);
  const h = Math.min(rect.h, m.height - top);
  if (h > 0)
    await sharp(file).extract({ left: 0, top, width: m.width, height: h }).png().toFile(dest);
}

/**
 * The capture as a function: writes <dir> and returns { page, overlays, open, lines }.
 * `header`: selectors of the header's parts (default: found on the page). `patterns`: the overlay
 * database (default: loadPatterns(), cached for a week).
 * @param {string} url
 * @param {string} dirArg
 * @param {{ header?: string[], patterns?: object }} [opts]
 */
export async function captureHeader(url, dirArg, { header = [], patterns } = {}) {
  const dir = resolve(dirArg);
  mkdirSync(join(dir, 'regions'), { recursive: true });
  const prepBundle = buildBundle(
    patterns ?? (await loadPatterns()),
    loadBundle('overlay-detect.js'),
  );
  const lines = [];
  // desktop first: it decides the header's selectors, which tablet and mobile then measure
  openSession('hdr-src-desktop', { width: VIEWPORTS.desktop[0], height: VIEWPORTS.desktop[1] });
  let desktop;
  try {
    desktop = runCode(
      'hdr-src-desktop',
      `async page => {
      ${load(url, prepBundle, join(dir, 'desktop.png'))}
      const named = ${JSON.stringify(header)};
      const found = named.length ? named : await page.evaluate(() => window.__plgFindHeader());
      const page_ = JSON.parse(await page.evaluate(() => window.__plgExtract({ maxStyleNodes: 0 })));
      const regions = found.length ? JSON.parse(await page.evaluate((s) => window.__plgHeaderRegions(s), found)) : [];
      return JSON.stringify({ prep, found, regions, page: { ...page_, regions: undefined } });
    }`,
    );
  } finally {
    closeSession('hdr-src-desktop');
  }
  const missing = desktop.found.filter((_, i) => !desktop.regions[i]);
  if (!desktop.found.length) {
    throw new CliError('USAGE', `no header found on ${url}`, {
      hint: 'name it: --header <selector>',
    });
  }
  if (missing.length) {
    throw new CliError('USAGE', `--header ${missing.join(', ')}: not shown on ${url} at 1440x900`);
  }
  await stitchTiles(join(dir, 'desktop.png'));
  const selectors = desktop.regions.map((r) => r.selector);
  const others = await Promise.all(
    ['tablet', 'mobile'].map(async (vp) => {
      const name = `hdr-src-${vp}`;
      openSession(name, { width: VIEWPORTS[vp][0], height: VIEWPORTS[vp][1] });
      try {
        return await runCodeAsync(
          name,
          `async page => {
        ${load(url, prepBundle, join(dir, `${vp}.png`))}
        const regions = JSON.parse(await page.evaluate((s) => window.__plgRegionsBySelector(s), ${JSON.stringify(selectors)}));
        return JSON.stringify({ visibleOverlays: prep.visibleOverlays, regions });
      }`,
        );
      } finally {
        closeSession(name);
      }
    }),
  );
  const byVp = { tablet: others[0], mobile: others[1] };
  for (const vp of ['tablet', 'mobile']) await stitchTiles(join(dir, `${vp}.png`));

  const regions = [];
  for (const [i, r] of desktop.regions.entries()) {
    const { html, styles, fullText, ...rest } = r;
    await crop(join(dir, 'desktop.png'), r.rect, join(dir, 'regions', `${r.id}.png`));
    writeFileSync(join(dir, 'regions', `${r.id}.html`), html);
    writeFileSync(join(dir, 'regions', `${r.id}.styles.txt`), styles);
    writeFileSync(join(dir, 'regions', `${r.id}.txt`), fullText);
    const record = { ...rest };
    for (const vp of ['tablet', 'mobile']) {
      const m = byVp[vp].regions[i];
      record[`${vp}Rect`] = m ? m.rect : null;
      if (!m) continue;
      await crop(join(dir, `${vp}.png`), m.rect, join(dir, 'regions', `${r.id}.${vp}.png`));
      writeFileSync(join(dir, 'regions', `${r.id}.${vp}.styles.txt`), m.styles);
    }
    regions.push(record);
  }
  const page = { ...desktop.page, url, regions };
  const overlays = {
    ...desktop.prep,
    visibleOverlays: {
      desktop: desktop.prep.visibleOverlays,
      tablet: byVp.tablet.visibleOverlays,
      mobile: byVp.mobile.visibleOverlays,
    },
  };
  writeFileSync(join(dir, 'page.json'), JSON.stringify(page, null, 2));
  writeFileSync(join(dir, 'overlays.json'), JSON.stringify(overlays, null, 2));
  lines.push(
    `header: ${regions
      .map(
        (r) =>
          `${r.id} ${r.selector} @${r.rect.y}+${r.rect.h}` +
          ` (tablet ${r.tabletRect ? `+${r.tabletRect.h}` : 'not shown'}, mobile ${r.mobileRect ? `+${r.mobileRect.h}` : 'not shown'})`,
      )
      .join('; ')}`,
  );
  const hidden =
    (overlays.overlays || []).length +
    (overlays.probeHidden || []).length +
    (overlays.plgOverlays || []).length;
  lines.push(
    `overlays: ${hidden} hidden${overlays.visibleOverlays.desktop?.length ? `, still visible: ${overlays.visibleOverlays.desktop.map((o) => o.selector).join(', ')}` : ''}`,
  );
  // the header's own selectors reach menu discovery: a header that is a <div> (--header) has its
  // menus found there, not only in header and nav elements
  const roots = regions.map((r) => r.selector);
  const menus = openMenus(url, dir, roots);
  const probes = headerProbes(url, dir, roots);
  lines.push(menus.line, probes.line);
  // a menu found and not opened is a menu no check covers: the capture is incomplete
  if (menus.incomplete.length)
    lines.push(
      `incomplete: ${menus.incomplete.length} menu(s) not opened (${menus.incomplete.join('; ')}): ` +
        'capture again with the header named (--header), or check them by hand',
    );
  return { page, overlays, open: probes.open, incomplete: menus.incomplete, lines };
}
