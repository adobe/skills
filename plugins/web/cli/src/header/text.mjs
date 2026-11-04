/**
 * Font and text-position differences between the source and the page, for the last pixels of a
 * header that already has the right layout: every visible text, matched by its text, with the
 * computed properties that change how glyphs render and the text node's own box; every icon-only
 * control (a close X, a search glass, a logo), paired by position, by its graphic's centre; and
 * where the page below the header starts. Closed: the source above its main content, the page's
 * `body > header`. With --open <label> (a menu opened as the source opens it) or --mobile-menu
 * (the burger, as panels.mjs opens it): the whole viewport on both sides.
 * `web header check text <source url> <page url>` (its --help lists the options).
 * --baseline: the page before the work: differences it already has against the source,
 *   with the same value on the page (texts, positions, pixels), are not counted.
 * --source-cache: the source's states are loaded once and reused from <dir> (one file per state).
 * --scroll: after the load, wheel to each y in turn (1 s each) and compare there: every header text
 * shown or hidden alike, positions of the shown ones, the whole viewport's pixels at 2x.
 * A size without a height is 900 px tall; each size is a fresh load. --shots writes the viewport of
 * each side, <prefix>-<size>-source.png / -page.png, and counts their differing pixels (on white; closed:
 * the header rows only). Exit 1 when any text differs, is on one side only, or a pixel differs.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { closeSession, openSession, runCodeAsync } from './browser.mjs';
import { AB_TESTS, STEADY } from './steady.mjs';
import { VISIBLE_OVERLAYS } from './overlay-probe.mjs';
import { onWhite } from './panels.mjs';
import { PNG, pixelmatch } from './imaging.mjs';
import { loadBundle } from '#src/bundles/index.mjs';

const TOGGLES = loadBundle('header-toggles.js');

export const PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'fontOpticalSizing',
  'fontSynthesis',
  'textRendering',
  'webkitFontSmoothing',
  'color',
  'textDecorationLine',
  'textShadow',
];

/** Differences between two text lists ({ text, rect, styles }), matched by text in order. */
export function diffTexts(srcAll, pageAll, tolerance = 0.5) {
  const isIcon = (x) => x.kind === 'icon';
  const src = srcAll.filter((x) => !isIcon(x));
  const left = pageAll.filter((x) => !isIcon(x));
  const rows = [];
  const onlySource = [];
  // icons are paired by position (nearest first, within 40 px): a build may name or draw them
  // otherwise; what must hold is where they sit
  const icons = pairIcons(srcAll.filter(isIcon), pageAll.filter(isIcon));
  for (const [s, p] of icons.pairs) {
    const diffs = ['x', 'y']
      .filter((k) => Math.abs(s.rect[k] - p.rect[k]) > tolerance)
      .map((k) => [k, s.rect[k], p.rect[k]]);
    if (diffs.length) rows.push({ text: s.text, diffs });
  }
  // an icon on one side only is reported, not judged: a build may draw it with CSS where the source
  // has an svg (no element to pair); the 2x pixels judge it. A paired icon out of place fails
  const iconsOneSide = [
    ...icons.onlySource.map((x) => `source: ${x.text} at ${x.rect.x},${x.rect.y}`),
    ...icons.onlyPage.map((x) => `page: ${x.text} at ${x.rect.x},${x.rect.y}`),
  ];
  for (const s of src) {
    const i = left.findIndex((p) => p.text === s.text);
    if (i === -1) {
      onlySource.push(s.text);
      continue;
    }
    const [p] = left.splice(i, 1);
    // the family that renders is the first one (both sides load the source's fonts); names match
    // case-insensitively (a linter lowercases them)
    const first = (f) =>
      f
        .split(',')[0]
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase();
    const same = (k) =>
      k === 'fontFamily' ? first(s.styles[k]) === first(p.styles[k]) : s.styles[k] === p.styles[k];
    const diffs = PROPS.filter((k) => !same(k)).map((k) => [k, s.styles[k], p.styles[k]]);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (Math.abs(s.rect[k] - p.rect[k]) > tolerance) diffs.push([k, s.rect[k], p.rect[k]]);
    }
    if (diffs.length) rows.push({ text: s.text, diffs });
  }
  return { rows, onlySource, onlyPage: left.map((p) => p.text), iconsOneSide };
}

/** Icons paired nearest first, within `max` px of each other; the rest are on one side only. */
export function pairIcons(src, page, max = 40) {
  const d = (a, b) => Math.hypot(a.rect.x - b.rect.x, a.rect.y - b.rect.y);
  const cands = src
    .flatMap((s) => page.map((p) => [d(s, p), s, p]))
    .filter(([dist]) => dist <= max)
    .sort((a, b) => a[0] - b[0]);
  const used = new Set();
  const pairs = [];
  for (const [, s, p] of cands) {
    if (used.has(s) || used.has(p)) continue;
    used.add(s);
    used.add(p);
    pairs.push([s, p]);
  }
  return {
    pairs,
    onlySource: src.filter((s) => !used.has(s)),
    onlyPage: page.filter((p) => !used.has(p)),
  };
}

const COLLECT = `(args) => {
  const [scope, bandArg, props] = args;
  // the band: above the page's main content (the header), or the whole viewport
  const mainTop = document.querySelector('main')?.getBoundingClientRect().top ?? null;
  const band = bandArg === 'main' ? (mainTop ?? innerHeight) : bandArg === 'viewport' ? innerHeight : bandArg;
  // the page's own header (EDS: body > header); a page without one (the source itself) by the band
  const root = (scope && document.querySelector(scope)) || document.body;
  const texts = [];
  // open shadow roots too: a page can render parts of the source's markup in one (a migration in
  // progress), so their texts match the source's instead of showing as "only on the source"
  const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => (e.shadowRoot ? [e, ...deep(e.shadowRoot)] : [e]));
  for (const el of deep(root)) {
    const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!nodes.length) continue;
    const own = nodes.map((n) => n.textContent).join('').trim().replace(/\\s+/g, ' ');
    // the text's own box (a Range over its text nodes), not the element's: a button and a span
    // holding the same glyphs at the same place have different boxes
    const range = document.createRange();
    range.setStartBefore(nodes[0]);
    range.setEndAfter(nodes.at(-1));
    const r = range.getBoundingClientRect();
    // seen: more than a screen-reader pixel, in the band and the viewport, not covered (a text
    // under an open sheet or an off-canvas panel is not on screen)
    if (r.width < 2 || r.height < 2 || r.top >= band || r.bottom <= 0 || r.right <= 0 || r.left >= innerWidth) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const er = el.getBoundingClientRect();
    if (er.width < 2 || er.height < 2) continue;
    const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    // hit-tested in the element's own tree: from the document, a shadow text hits its host
    const tree = el.getRootNode();
    const hit = (tree.elementFromPoint ? tree : document).elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el)) continue;
    const cs = getComputedStyle(el);
    const round = (v) => Math.round(v * 10) / 10;
    texts.push({ text: own, rect: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) },
      styles: Object.fromEntries(props.map((k) => [k, cs[k]])) });
  }
  // icons: every graphic of its own (an svg or img not part of a text: a close X, a search glass, a
  // logo; a chevron beside a label is the label's) and every icon-only control drawn by CSS, by its
  // centre, paired by position: a build's close X sat up to 25 px off between the sampled widths, unseen
  // by the texts. Labelled by its control's accessible name, for the report only
  const seen = (e) => { const r = e.getBoundingClientRect(); return r.width >= 2 && r.height >= 2
    && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }); };
  const hasSeenText = (e) => [e, ...deep(e)].some((d) => [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && seen(d));
  const all = deep(root);
  const isControl = (e) => e.matches('a[href], button, [role="button"]');
  // a graphic of its own (not part of a control or element with text: a chevron is the text's)...
  const graphics = all.filter((e) => (e.matches('img') || (e.matches('svg') && !e.parentElement?.closest('svg'))) && seen(e)
    && !hasSeenText(e.closest('a[href], button, [role="button"], li, p') || e));
  // ...or an icon-only control drawn by CSS (no svg or img: its own box)
  for (const c of all.filter((e) => isControl(e) && seen(e) && !hasSeenText(e) && !e.querySelector('svg, img'))) graphics.push(c);
  for (const g of graphics) {
    const control = g.closest('a[href], button, [role="button"]') || g;
    const r = g.getBoundingClientRect();
    if (r.top >= band || r.bottom <= 0 || r.right <= 0 || r.left >= innerWidth) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const tree = g.getRootNode();
    const hit = (tree.elementFromPoint ? tree : document).elementFromPoint(Math.min(innerWidth - 1, Math.max(0, cx)), Math.min(innerHeight - 1, Math.max(0, cy)));
    if (hit && !control.contains(hit) && !hit.contains(control) && !g.contains(hit)) continue;
    const img = control.querySelector('img[alt]');
    const name = (control.getAttribute('aria-label') || control.getAttribute('title') || (img && img.alt)
      || control.textContent || '').trim().replace(/\\s+/g, ' ');
    const round = (v) => Math.round(v * 10) / 10;
    texts.push({ text: 'icon' + (name ? ' "' + name + '"' : ''), kind: 'icon', rect: { x: round(cx), y: round(cy), w: 0, h: 0 }, styles: {} });
  }
  // where the header ends at this step: the bottom of what it paints in the viewport (a text, an
  // image, a background, a border), not its box (a bar that slid away under a promo bar paints
  // nothing below it), and not its shadow (the body shows through it: on a page whose body is not
  // the source's, those rows differ by design). The header: the page's own (EDS: body > header),
  // the bars pinned at the top (fixed or sticky, at least half the viewport wide, starting within
  // the header as loaded: not a chat button), and a header still in the flow above main. Measured
  // on both sides: the lower of the two splits a scroll step's 2x pixels from the body's
  const painted = (root) => {
    let bottom = 0;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const r = e.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const paints = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        || /^(img|svg|picture|video|canvas|input|button)$/i.test(e.tagName)
        || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none'
        || parseFloat(cs.borderBottomWidth) > 0;
      if (paints) bottom = Math.max(bottom, Math.min(r.bottom, innerHeight));
    }
    return bottom;
  };
  // the header's height as loaded (the first state): a pinned bar starts within it
  window.__plgTop0 ??= Math.max(mainTop ?? 0, 0);
  const headers = [document.querySelector('body > header'), ...[...document.body.querySelectorAll('*')].filter((e) => {
    const pos = getComputedStyle(e).position;
    if (pos !== 'fixed' && pos !== 'sticky') return false;
    const r = e.getBoundingClientRect();
    return r.bottom > 0 && r.top <= window.__plgTop0 + 1 && r.width >= innerWidth / 2;
  })].filter(Boolean);
  const headerBottom = Math.round(Math.max(mainTop > 0 ? Math.min(mainTop, innerHeight) : 0, ...headers.map(painted)) * 10) / 10;
  return { texts, mainTop: mainTop == null ? null : Math.round(mainTop * 10) / 10, headerBottom };
}`;

// opens the state to compare: a menu by its visible label, or the mobile menu's burger as
// open-panels.mjs opens it (waiting for its links: a site may replay the click late)
// `optional`: the baseline (the page before the work) may have no such menu, or no burger: it is
// then used as loaded, for what its body already differed by (a failed open fails the source and
// the page, not the baseline)
const OPEN = (open, trigger, mobileMenu, optional = false) => `
  if (${JSON.stringify(Boolean(mobileMenu))}) {
    const before = await page.evaluate(() => window.__plgVisibleLinks());
    const toggle = await page.evaluateHandle(() => window.__plgMobileToggle());
    if (await toggle.asElement()) {
      try {
        await toggle.asElement().click();
        await page.evaluate((n) => window.__plgWaitReveal(n), before);
      } catch (e) {
        if (!${JSON.stringify(Boolean(optional))}) throw e;
      }
    }
    await page.waitForTimeout(700);
  } else if (${JSON.stringify(open || '')}) {
    await page.evaluate(() => window.__plgMarkVisibleLinks());
    const el = page.locator('header, nav').getByText(${JSON.stringify(open || '')}, { exact: true }).filter({ visible: true }).first();
    try {
      if (${JSON.stringify(trigger)} === 'click') await el.click({ timeout: 3000 }); else await el.hover({ timeout: 3000 });
      await page.waitForTimeout(700);
      // the open panel's bottom: its 2x pixels are told apart from the page's below it
      panelBottom = await page.evaluate(() => { const p = window.__plgOpenPanel(); return p ? p.rect.y + p.rect.h : null; });
    } catch (e) {
      if (!${JSON.stringify(Boolean(optional))}) throw e;
    }
  }`;

// a scroll step: the wheel (scroll listeners see a user's scroll), then time for the header's
// transition; step 0 is the page as loaded
const SCROLL_TO = (y) => `
    await page.mouse.move(innerW / 2, 300);
    await page.mouse.wheel(0, ${y} - (await page.evaluate(() => scrollY)));
    await page.waitForTimeout(1000);`;

/** The page's texts at each step ([0] without --scroll), each with its shot when asked. */
async function collect(
  session,
  url,
  {
    scope,
    band,
    width,
    height,
    scale,
    hideCss,
    open,
    trigger,
    mobileMenu,
    shot,
    steps,
    hideLate = false,
    optionalOpen = false,
  },
) {
  openSession(session, { width, height, scale });
  try {
    // on the source, a consent layer that an interaction's JS shows (a WordPress site: the click or the
    // wheel loads it) is hidden before each state, as header-probes.mjs hides it for its shot
    const late = hideLate
      ? `
  {
    const sel = (await page.evaluate(${VISIBLE_OVERLAYS})).map((o) => o.selector);
    if (sel.length) await page.addStyleTag({ content: sel.join(', ') + ' { display: none !important; }' });
  }`
      : '';
    const states = steps
      .map(
        (y, i) => `
  ${i ? SCROLL_TO(y) : ''}
  ${late}
  if (${JSON.stringify(Boolean(shot))}) await page.screenshot({ path: ${JSON.stringify(shot ? shot(i) : '')} });
  out.push({ y: ${y}, panelBottom, ...(await page.evaluate(${COLLECT}, [${JSON.stringify(scope)}, ${JSON.stringify(band)}, ${JSON.stringify(PROPS)}])) });`,
      )
      .join('\n');
    // bounded: a stuck call fails this size (reported, not clean) instead of holding the sweep
    return await runCodeAsync(
      session,
      `async page => {
  const innerW = ${width};
  await page.context().route(${AB_TESTS}, (r) => r.abort());
  await page.context().addInitScript(${STEADY});
  // as the capture loads it: a slow third-party script must not fail the load (an SEO blog timed out)
  await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  if (${JSON.stringify(hideCss)}) await page.addStyleTag({ content: ${JSON.stringify(hideCss)} });
  await page.addScriptTag({ content: ${JSON.stringify(TOGGLES)} });
  await page.waitForFunction(() => !window.hlx
    || document.querySelector('body > header .header[data-block-status="loaded"]'), null, { timeout: 10000 }).catch(() => {});
  // web fonts loaded before anything is measured: a late font (WP tutorials' Typekit, 8 browsers at
  // once) moved texts 1 px and read as a difference
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(1200);
  let panelBottom = null;
  ${OPEN(open, trigger, mobileMenu, optionalOpen)}
  const out = [];
  ${states}
  return JSON.stringify(out);
}`,
      { timeout: 180000 },
    );
  } finally {
    closeSession(session);
  }
}

/**
 * Scroll steps: the header's texts (the source's above its main content, as loaded) must be shown
 * or hidden on both sides alike; a text shown on both is compared as usual.
 */
export function diffShown(headerTexts, srcAll, pageAll, tolerance) {
  const isIcon = (x) => x.kind === 'icon';
  const src = srcAll.filter((x) => !isIcon(x));
  const page = pageAll.filter((x) => !isIcon(x));
  // icons: by position, as in diffTexts (a name may differ, where it sits must not)
  const icons = diffTexts(srcAll.filter(isIcon), pageAll.filter(isIcon), tolerance);
  const iconRows = icons.rows;
  const onScreen = (list, t) => list.some((x) => x.text === t);
  const rows = headerTexts
    .filter((t) => onScreen(src, t) !== onScreen(page, t))
    .map((t) => ({ text: t, diffs: [['shown', onScreen(src, t), onScreen(page, t)]] }));
  const keep = (list) => list.filter((x) => headerTexts.includes(x.text));
  return [...rows, ...diffTexts(keep(src), keep(page), tolerance).rows, ...iconRows];
}

const BELOW = '(the page below the header)';

/** One size: per state, the differences, the texts on one side only, the header's bottom, the pixels. */
async function compareAt(srcUrl, pageUrl, size, o, hideCss) {
  const whole = o.open || o['mobile-menu'] || o.scroll;
  const band = o.band === 'auto' ? (whole ? 'viewport' : 'main') : +o.band;
  const tag = `${size.width}x${size.height}`;
  const steps = o.scroll ? [0, ...o.scroll.split(',').map(Number)] : [0];
  const name = (side) =>
    o.shots ? (i) => `${o.shots}-${tag}${o.scroll ? `-${i}y${steps[i]}` : ''}-${side}.png` : null;
  const opts = {
    ...size,
    band,
    open: o.open,
    trigger: o.trigger,
    mobileMenu: o['mobile-menu'],
    scale: +o.scale,
    steps,
  };
  // the capture's hide rules on the page too only when it is the source itself (a floor)
  const pageHide = new URL(pageUrl).origin === new URL(srcUrl).origin ? hideCss : '';
  const pageScope = whole ? null : 'body > header';
  const [src, page, base] = await Promise.all([
    sourceStates(srcUrl, { ...opts, hideCss, shot: name('source'), hideLate: true }, o, tag),
    // the page's header by its element, not by a band: a fixed header over a main at 0 (the
    // retailer) left no band, and every header text counted as missing
    collect(`${o.session}-${tag}-p`, pageUrl, {
      ...opts,
      band: whole ? band : 'viewport',
      scope: pageScope,
      hideCss: pageHide,
      shot: name('page'),
      hideLate: Boolean(pageHide),
    }),
    // the baseline: the same page before the work: what it already differs by (its body, a band
    // it places in main) is not the work's
    o.baseline
      ? sourceStates(
          o.baseline,
          {
            ...opts,
            scope: pageScope,
            hideCss: '',
            shot: name('baseline'),
            hideLate: false,
            optionalOpen: true,
          },
          o,
          `${tag}-b`,
        )
      : null,
  ]);
  const headerTexts = src[0].texts
    .filter((t) => t.kind !== 'icon' && (src[0].mainTop == null || t.rect.y < src[0].mainTop))
    .map((t) => t.text);
  const judge = (s, p0, i) => {
    // closed: the page's header texts in the source's header band (a floating button the
    // retailer's header holds sits below its band on the source, in its body)
    const p =
      whole || i || s.mainTop == null
        ? p0
        : { ...p0, texts: p0.texts.filter((t) => t.rect.y < s.mainTop) };
    const r =
      o.scroll && i
        ? {
            rows: diffShown(headerTexts, s.texts, p.texts, +o.tolerance),
            onlySource: [],
            onlyPage: [],
          }
        : diffTexts(s.texts, p.texts, +o.tolerance);
    if (
      !(o.open || o['mobile-menu']) &&
      !i &&
      s.mainTop != null &&
      Math.abs(s.mainTop - p.mainTop) > +o.tolerance
    ) {
      r.rows.push({ text: BELOW, diffs: [['y', s.mainTop, p.mainTop]] });
    }
    return r;
  };
  return src.map((s, i) => {
    const at = o.scroll ? `${tag} y${s.y}` : tag;
    let r = judge(s, page[i], i);
    let inherited = 0;
    if (base) ({ r, inherited } = minusBaseline(r, judge(s, base[i], i), headerTexts));
    const rows = whole || i ? null : Math.ceil(s.mainTop * +o.scale);
    const px = o.shots
      ? differingPixels(name('source')(i), name('page')(i), rows, base ? name('baseline')(i) : null)
      : null;
    // an open menu: how many of them are in the header and its panel (above the source panel's
    // bottom); the rest is the page under it (a body that is not the source's)
    const panelRows = o.open && s.panelBottom != null ? Math.ceil(s.panelBottom * +o.scale) : null;
    const pxPanel =
      px && panelRows
        ? differingPixels(
            name('source')(i),
            name('page')(i),
            panelRows,
            base ? name('baseline')(i) : null,
          )
        : null;
    // a scroll step: how many of them are in the header (down to the lower of what the source's
    // and the page's headers paint there); the rest is the page below it (a body that is not the
    // source's, moved by a new header height)
    const headerRows = o.scroll
      ? Math.ceil(Math.max(s.headerBottom ?? 0, page[i].headerBottom ?? 0) * +o.scale)
      : null;
    const pxHeader =
      px && headerRows != null
        ? headerRows
          ? differingPixels(
              name('source')(i),
              name('page')(i),
              headerRows,
              base ? name('baseline')(i) : null,
            )
          : 0
        : null;
    return {
      tag: at,
      matched: s.texts.length - r.onlySource.length,
      px,
      pxPanel,
      pxHeader,
      inherited,
      shots: o.shots && name('*')(i),
      ...r,
    };
  });
}

/**
 * The source's states: from --source-cache when this state was collected before (the source is
 * the capture's reference and does not change during a run), else loaded and stored there. The
 * key is everything that shapes the result; the shots are copied to the asked names.
 */
async function sourceStates(srcUrl, opts, o, tag) {
  const dir = o['source-cache'];
  const load = (shot) =>
    collect(`${o.session}-${tag}-s`, srcUrl, { ...opts, scope: opts.scope ?? null, shot });
  if (!dir) return load(opts.shot);
  const { shot, ...shape } = opts;
  // the collector's code is part of the key: a changed collector must not reuse old states
  const key = cacheKey({
    srcUrl,
    shape,
    shots: Boolean(shot),
    collector: cacheKey({
      COLLECT,
      OPEN: OPEN(shape.open, shape.trigger, shape.mobileMenu, shape.optionalOpen),
      PROPS,
    }),
  });
  const file = join(dir, `${key}.json`);
  const cached = (i) => join(dir, `${key}-${i}.png`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const states = await load(shot ? cached : null);
    writeFileSync(file, JSON.stringify(states));
  }
  const states = JSON.parse(readFileSync(file, 'utf8'));
  // the asked shot names may be in a folder nothing created yet (Playwright's writer creates it, a copy does not)
  if (shot)
    states.forEach((_, i) => {
      mkdirSync(dirname(shot(i)), { recursive: true });
      copyFileSync(cached(i), shot(i));
    });
  return states;
}

/** A stable key for a source state: the same inputs give the same key, whatever the key order. */
export function cacheKey(value) {
  const sorted = (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
  return createHash('sha1')
    .update(JSON.stringify(sorted(value)))
    .digest('hex')
    .slice(0, 16);
}

/** Runs async fns with at most n in flight, results in order. */
async function pool(fns, n) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, fns.length) }, async () => {
      while (next < fns.length) {
        const i = next;
        next += 1;
        out[i] = await fns[i]();
      }
    }),
  );
  return out;
}

/**
 * Pixels that differ between two shots (on white), down to row `rows` (the header) or all. With a
 * baseline shot (the page before the work), a pixel where the page still equals the baseline and
 * the baseline already differed from the source is the baseline's, not counted.
 */
export function differingPixels(a, b, rows = null, base = null) {
  const imgs = [a, b, ...(base ? [base] : [])].map((f) => PNG.sync.read(readFileSync(f)));
  const w = Math.min(...imgs.map((i) => i.width));
  const h = Math.min(rows ?? Infinity, ...imgs.map((i) => i.height));
  const [A, B, C] = imgs.map((img) => {
    const o = new PNG({ width: w, height: h });
    PNG.bitblt(img, o, 0, 0, w, h, 0, 0);
    return onWhite(o.data);
  });
  if (!C) return pixelmatch(A, B, null, w, h, { threshold: 0.1 });
  const mask = (x, y) => {
    const d = new PNG({ width: w, height: h });
    pixelmatch(x, y, d.data, w, h, { threshold: 0.1, diffMask: true });
    return d.data;
  };
  const [ab, ac, bc] = [mask(A, B), mask(A, C), mask(B, C)];
  // diffMask: a differing pixel is opaque (alpha 255), an equal one transparent
  let n = 0;
  for (let i = 3; i < ab.length; i += 4) if (ab[i] && !(ac[i] && !bc[i])) n += 1;
  return n;
}

/**
 * Differences the baseline (the page before the work) already has against the source, with the
 * same page value, are not the work's: they are dropped and counted as inherited. The header is
 * always the work's: its texts (`own`) and where the page below it starts are never inherited (a
 * baseline with a collapsed header would count every header text as "already missing").
 */
export function minusBaseline(r, b, own = []) {
  let inherited = 0;
  const key = (text, [k, src, val]) => JSON.stringify([text, k, src, val]);
  const mine = new Set([...own, BELOW]);
  const known = new Set(
    b.rows
      .filter((row) => !mine.has(row.text))
      .flatMap((row) => row.diffs.map((d) => key(row.text, d))),
  );
  const rows = r.rows
    .map((row) => ({
      ...row,
      diffs: row.diffs.filter((d) => {
        const old = known.has(key(row.text, d));
        inherited += old ? 1 : 0;
        return !old;
      }),
    }))
    .filter((row) => row.diffs.length);
  const drop = (list, base) =>
    list.filter((t) => {
      const old = !mine.has(t) && base.includes(t);
      inherited += old ? 1 : 0;
      return !old;
    });
  return {
    r: {
      ...r,
      rows,
      onlySource: drop(r.onlySource, b.onlySource),
      onlyPage: drop(r.onlyPage, b.onlyPage),
    },
    inherited,
  };
}

/**
 * The capture's hide rules (overlays.json) plus the late layers its mobile probe recorded
 * (open/open.json): hidden from the load on, not when a step sees them (WP tutorials' consent
 * banner slides in after the wheel and was in the y600 shots).
 */
export function captureHideCss(overlaysPath) {
  const css = JSON.parse(readFileSync(overlaysPath, 'utf8')).hideCss || '';
  const open = join(dirname(overlaysPath), 'open', 'open.json');
  const late = existsSync(open)
    ? JSON.parse(readFileSync(open, 'utf8')).mobileMenu?.lateOverlays || []
    : [];
  return [css, late.length ? `${late.join(', ')} { display: none !important; }` : '']
    .filter(Boolean)
    .join('\n');
}

export const parseSizes = (s) =>
  s.split(',').map((x) => {
    const [w, h = '900'] = x.split('x');
    if (!(+w > 0 && +h > 0)) throw new Error(`bad size "${x}": use WIDTH or WIDTHxHEIGHT`);
    return { width: +w, height: +h };
  });

/** The command's options (node:util parseArgs), with their defaults. */
export const OPTIONS = {
  sizes: { type: 'string', default: '1440x900' },
  band: { type: 'string', default: 'auto' },
  'hide-css': { type: 'string' },
  open: { type: 'string' },
  trigger: { type: 'string', default: 'hover' },
  'mobile-menu': { type: 'boolean', default: false },
  scroll: { type: 'string' },
  scale: { type: 'string', default: '1' },
  tolerance: { type: 'string', default: '0.05' },
  shots: { type: 'string' },
  'source-cache': { type: 'string' },
  baseline: { type: 'string' },
  parallel: { type: 'string', default: '4' },
  session: { type: 'string', default: 'text-styles' },
};

/**
 * The check as a function (the web-header binary's `header check text`): { ok, sizes, notCleanAt,
 * failedAt, lines }, `sizes` one result per size (and scroll step), `failedAt` the sizes that could
 * not be compared (also in notCleanAt), `lines` what the command prints. Throws on a bad option.
 * `opts`: OPTIONS by name; missing ones take their defaults.
 */
export async function checkText(srcUrl, pageUrl, opts = {}) {
  const defaults = Object.fromEntries(
    Object.entries(OPTIONS)
      .filter(([, v]) => 'default' in v)
      .map(([k, v]) => [k, v.default]),
  );
  const o = {
    ...defaults,
    ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
  };
  // a pool of 0 workers (--parallel 0, a fraction, a word) ran nothing and read as clean
  const parallel = Number(o.parallel);
  if (!Number.isInteger(parallel) || parallel < 1)
    throw new Error(`--parallel must be a positive integer, not "${o.parallel}"`);
  const sizes = parseSizes(o.sizes);
  const hideCss = o['hide-css'] ? captureHideCss(o['hide-css']) : '';
  // each size is two browsers (source, page): --parallel sizes at a time
  // a size that cannot be loaded is reported (not clean, `failed`), the others still run
  const run = (size) =>
    compareAt(srcUrl, pageUrl, size, o, hideCss).catch((e) => [
      {
        tag: `${size.width}x${size.height}`,
        matched: 0,
        px: null,
        onlySource: [],
        onlyPage: [],
        failed: true,
        rows: [
          {
            text: '(could not be compared)',
            diffs: [
              [
                'error',
                e.message.split('\n').find((l) => /Error/.test(l)) || e.message.slice(0, 120),
                '',
              ],
            ],
          },
        ],
      },
    ]);
  const results = (
    await pool(
      sizes.map((size) => () => run(size)),
      parallel,
    )
  ).flat();
  if (results.length < sizes.length)
    throw new Error(`${sizes.length} sizes asked, ${results.length} compared`);
  const lines = [];
  let differ = 0;
  const failed = [];
  for (const r of results) {
    for (const row of r.rows)
      lines.push(
        `${r.tag} "${row.text}": ${row.diffs.map(([k, a, b]) => `${k} ${a} -> ${b}`).join('; ')}`,
      );
    if (r.onlySource.length)
      lines.push(`${r.tag} only on the source: ${r.onlySource.map((t) => `"${t}"`).join(', ')}`);
    if (r.onlyPage.length)
      lines.push(`${r.tag} only on the page: ${r.onlyPage.map((t) => `"${t}"`).join(', ')}`);
    if (r.iconsOneSide?.length)
      lines.push(
        `${r.tag} icons on one side only (not judged here; the 2x pixels are): ${r.iconsOneSide.join(', ')}`,
      );
    const unmatched = r.onlySource.length + r.onlyPage.length;
    lines.push(
      `${r.tag} text styles: ${r.rows.length} differ of ${r.matched} matched texts` +
        `${unmatched ? `, ${unmatched} on one side only` : ''}${r.inherited ? ` (${r.inherited} inherited from the baseline, not counted)` : ''}` +
        `${r.px == null ? '' : `; ${r.px} differing pixels at ${o.scale}x${r.pxPanel == null ? '' : ` (${r.pxPanel} in the header and open panel, ${r.px - r.pxPanel} below them)`}${r.pxHeader == null ? '' : ` (${r.pxHeader} in the header, ${r.px - r.pxHeader} below it)`} (${r.shots})`}`,
    );
    // a text on one side only is a difference too: a changed or missing label
    if (r.rows.length || r.onlySource.length || r.onlyPage.length || r.px) {
      differ += 1;
      failed.push(r.tag.split(' ')[0]);
    }
  }
  const notCleanAt = [...new Set(failed)];
  if (notCleanAt.length)
    lines.push(`not clean at: ${notCleanAt.join(',')} (re-run those with --sizes while fixing)`);
  // the sizes whose comparison did not run to its end: a failed measurement, not a difference
  const failedAt = [...new Set(results.filter((r) => r.failed).map((r) => r.tag.split(' ')[0]))];
  return { ok: differ === 0, sizes: results, notCleanAt, failedAt, lines };
}
