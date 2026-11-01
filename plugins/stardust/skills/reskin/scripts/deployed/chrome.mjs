// skills/reskin/scripts/deployed/chrome.mjs — A6 of the deployed leg, `chrome`: the header and footer every page of the
// site inherits, asserted on the preview. Hard, like sanity: no delta file and no residual accepts a failure (the ledger
// refuses an `accepted` deployed.chrome residual). The gates before it read `main` only, so a header or footer that
// renders raw, drops a link or covers the page passed every one of them; this step is where chrome is held to a bar.
// The contract is the mapped chrome: reskin/mapping.json `chrome` ({ model, header: [slots], footer: [slots] }) and that
// model's content-model.json. Expected, per region, from its slots: the links (ctas and iconLinks; `#…`-only and
// javascript: links are page controls, not destinations), the images (a logo when there is one) and, for the footer, its
// headings, paragraphs and list items. A mapping with no `chrome` record measures what needs no contract and says
// "n/a: no chrome in the mapping" for the rest.
// One Chromium launch, each width (1440 and 360) in a fresh page, navigated to the preview and settled on its EDS
// decoration (edsSettle), menu closed:
//   header          a <header> with a box, its block decorated (no data-block-status but loaded)
//   header logo     a loaded image (or an svg) of at least 16px in the header, when the mapped header has an image
//   header height   the header's rendered height ≤ 240px with the menu closed (a nav that wraps or stacks inline fails)
//   header/main     the header's content ends where main starts: it covers main by ≤ 4px and leaves a band ≤ 48px
//   header links    every mapped header link rendered and visible (at 360 with the menu closed or opened)
//   menu toggle     at 360, when some mapped header link is hidden with the menu closed: a visible control in the header
//                   (button, [role=button], [aria-controls] or [aria-expanded]) whose click shows them, its
//                   aria-expanded (when it has one) "true" after
//   icon text       no icon-font ligature word (keyboard_arrow_right, expand_more, chevron_left …) visible as text in
//                   the header or footer outside an icon font
//   footer          a <footer> with a box, its block decorated
//   footer logo     as header logo, for the footer
//   footer links    every mapped footer link rendered and visible
//   footer text     every mapped footer heading, paragraph and list item in the footer's text (case and spacing aside)
// Links compare by destination: on the source origin (and the preview origin, less a shared repo's /<ns> prefix) by path
// (a trailing /, .html and /index aside), elsewhere by host (less www.) and path, mailto: and tel: by address.
//   runChrome({ dir, slug, preview, widths, env, edsTimeoutMs })  writes chrome.json ({ verdict, hard: true, rows })
//        and returns { verdict, exit, hard, rows }: rows as sanity's, { check, width, value, bar, status, artifact, detail }.
//   chromeExpect({ mapping, model })   the contract: { mapped, header: { links, images }, footer: { links, images, texts } }
//   evaluateChrome(facts, expect, { width, narrow, sourceOrigin, previewOrigin, namespace })  the rows of one width. Pure.
//   linkKey(href, base, localOrigins, namespace)   a link's destination key. Pure.
//   chromeLines(result)  the lines the CLI prints
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { loadChromium, loadMeasureLive } from '../figma-gate/target.mjs';
import { coded, firstLine } from './child.mjs';
import { edsSettle, loadLiveSession } from './eds.mjs';
import { deployedDir } from './io.mjs';
import { EXIT, listed, stepLines, verdictOf } from './rows.mjs';

const NARROW = 360;
const VIEWPORT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 30000;
const EDS_TIMEOUT_MS = 20000;
const TOGGLE_SETTLE_MS = 600;
export const MAX_HEADER_PX = 240;
export const MAX_COVER_PX = 4;
export const MAX_BAND_PX = 48;
export const MIN_LOGO_PX = 16;
// Material Symbols / Material Icons ligature words an icon font draws as a glyph; as text they are a chrome that rendered raw.
export const LIGATURE = /\b(?:keyboard_(?:double_)?arrow_(?:right|left|up|down)|expand_(?:more|less|circle_down)|chevron_(?:right|left)|arrow_(?:forward|back|drop_down|drop_up|right|left|upward|downward|outward)(?:_ios(?:_new)?)?|navigate_(?:next|before)|open_in_new|north_east|unfold_(?:more|less)|arrow_right_alt)\b/g;

const BAR = {
  header: 'present, decorated',
  'header logo': `a loaded image ≥ ${MIN_LOGO_PX}px`,
  'header height': `≤ ${MAX_HEADER_PX}px, menu closed`,
  'header/main': `covers ≤ ${MAX_COVER_PX}px, band ≤ ${MAX_BAND_PX}px`,
  'header links': 'all mapped, visible',
  'menu toggle': 'opens the hidden links',
  'icon text': '0',
  footer: 'present, decorated',
  'footer logo': `a loaded image ≥ ${MIN_LOGO_PX}px`,
  'footer links': 'all mapped, visible',
  'footer text': 'all mapped',
};
const BROWSER_CHECKS = Object.keys(BAR);
const NO_CONTRACT = 'n/a: no chrome in the mapping';

const row = (check, width, status, value, detail = null) => ({ check, width, value, bar: BAR[check], status, artifact: null, detail });
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fold = (s) => norm(s).toLowerCase();

// ---- the contract --------------------------------------------------------------------------------------------------

const isControl = (href) => !href || /^\s*(#|javascript:)/i.test(href);

// The model's sections for a list of slot ids, in model order.
const slotsOf = (model, ids) => (model?.sections ?? []).filter((s) => (ids ?? []).includes(s.slot));

function regionOf(sections, { texts = false } = {}) {
  const links = [];
  for (const s of sections) {
    for (const a of [...(s.ctas ?? []), ...(s.iconLinks ?? [])]) {
      if (isControl(a.href)) continue;
      links.push({ label: norm(a.text || a.label || a.href).replace(LIGATURE, '').trim() || a.href, href: a.absHref || a.href });
    }
  }
  const out = { links, images: sections.reduce((n, s) => n + (s.images?.length ?? 0), 0) };
  if (texts) {
    const seen = new Set();
    out.texts = sections.flatMap((s) => [...(s.headings ?? []).map((h) => h.text), ...(s.paragraphs ?? []), ...(s.listItems ?? [])])
      .map((t) => norm(String(t).replace(LIGATURE, ''))).filter((t) => t && !seen.has(fold(t)) && seen.add(fold(t)));
  }
  return out;
}

export function chromeExpect({ mapping, model }) {
  const ch = mapping?.chrome;
  if (!ch || !model) return { mapped: false, header: { links: [], images: 0 }, footer: { links: [], images: 0, texts: [] }, sourceUrl: null };
  return {
    mapped: true,
    sourceUrl: model._provenance?.url ?? null,
    header: regionOf(slotsOf(model, ch.header)),
    footer: regionOf(slotsOf(model, ch.footer), { texts: true }),
  };
}

// The chrome model the mapping names: its `model` directory is relative to the project root (the parent of --dir), or
// to the working directory as stream-render reads it.
export function readChromeContract(dir) {
  const mappingFile = join(dir, 'reskin', 'mapping.json');
  if (!existsSync(mappingFile)) return chromeExpect({});
  let mapping;
  try { mapping = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch { throw new UsageError(`${mappingFile} is not valid JSON`); }
  if (!mapping.chrome) return chromeExpect({ mapping });
  const rel = mapping.chrome.model || join(dir, 'reskin', 'content-model', '_chrome');
  const file = [resolve(dirname(resolve(dir)), rel, 'content-model.json'), resolve(rel, 'content-model.json')].find((f) => existsSync(f));
  if (!file) throw new UsageError(`mapping.json maps chrome but its model ${rel}/content-model.json is missing: capture the chrome (capture-content --scope "header!,footer!") before the deployed leg`);
  let model;
  try { model = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new UsageError(`${file} is not valid JSON`); }
  // A slot captured before the chrome rendered holds nothing, and a contract of nothing passes anything.
  const has = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '');
  for (const region of ['header', 'footer']) {
    for (const id of mapping.chrome[region] ?? []) {
      const slot = slotsOf(model, [id])[0];
      if (!slot) throw new UsageError(`mapping.json maps ${region} slot ${id} but ${file} has no such slot: capture the chrome again`);
      if (!['visibleText', 'headings', 'paragraphs', 'listItems', 'ctas', 'iconLinks', 'images'].some((k) => has(slot[k]))) {
        throw new UsageError(`${region} slot ${id} in ${file} is empty: it was captured before it rendered — capture the chrome again (capture-content --wait-until load)`);
      }
    }
  }
  return chromeExpect({ mapping, model });
}

// ---- links ---------------------------------------------------------------------------------------------------------

const normPath = (p) => {
  let s = p;
  try { s = decodeURI(p); } catch { /* keep it encoded */ }
  s = s.replace(/\/index(\.html)?$/i, '/').replace(/\.html$/i, '');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
};

export function linkKey(href, base, localOrigins = [], namespace = null) {
  let u;
  try { u = new URL(href, base); } catch { return `raw:${norm(href)}`; }
  if (u.protocol === 'mailto:') return `mailto:${decodeURIComponent(u.pathname).toLowerCase()}`;
  if (u.protocol === 'tel:') return `tel:${u.pathname.replace(/[^\d+]/g, '')}`;
  if (localOrigins.includes(u.origin)) {
    let path = normPath(u.pathname);
    if (namespace && (path === `/${namespace}` || path.startsWith(`/${namespace}/`))) path = path.slice(namespace.length + 1) || '/';
    return `path:${path}${u.search}`;
  }
  return `ext:${u.host.replace(/^www\./i, '').toLowerCase()}${normPath(u.pathname)}${u.search}`;
}

// ---- rows of one width: pure ----------------------------------------------------------------------------------------

// facts: what measureWidth read (see factsIn). Returns the rows of that width.
export function evaluateChrome(facts, expect, { width, narrow = width < 1024, sourceOrigin = null, previewOrigin = null, namespace = null } = {}) {
  const rows = [];
  const { header: h, footer: f } = facts;
  const local = [previewOrigin, sourceOrigin].filter(Boolean);
  const expectedKey = (l) => linkKey(l.href, sourceOrigin || previewOrigin || 'http://invalid/', [sourceOrigin].filter(Boolean));
  const actualKeys = (links, pick) => new Set(links.filter(pick).map((a) => linkKey(a.href, previewOrigin || 'http://invalid/', local, namespace)));
  const missingOf = (want, have) => want.filter((l) => !have.has(expectedKey(l)));
  const linkRow = (check, want, rendered, visible) => {
    if (!expect.mapped) return row(check, width, 'n/a', NO_CONTRACT);
    if (!want.length) return row(check, width, 'PASS', '0/0');
    const absent = missingOf(want, rendered);
    const hidden = missingOf(want, visible).filter((l) => !absent.includes(l));
    const lost = [...absent.map((l) => `MISSING ${l.label} → ${l.href}`), ...hidden.map((l) => `HIDDEN ${l.label} → ${l.href}`)];
    return row(check, width, lost.length ? 'FAIL' : 'PASS', `${want.length - absent.length - hidden.length}/${want.length}`, listed(lost));
  };
  const logoRow = (check, region, wanted) => {
    if (!region.present) return row(check, width, 'FAIL', 'no region');
    if (!expect.mapped) return row(check, width, 'n/a', NO_CONTRACT);
    if (!wanted) return row(check, width, 'n/a', 'n/a: the mapped region has no image');
    return row(check, width, region.logos > 0 ? 'PASS' : 'FAIL', String(region.logos), region.logos ? null : listed(region.brokenImages ?? []));
  };
  const presentRow = (check, region, tag) => {
    if (!region.present) return row(check, width, 'FAIL', `no <${tag}>`);
    if (!(region.height > 0)) return row(check, width, 'FAIL', `<${tag}> has no box`);
    if (region.undecorated?.length) return row(check, width, 'FAIL', 'not decorated', listed(region.undecorated));
    return row(check, width, 'PASS', `${Math.round(region.height)}px`);
  };

  rows.push(presentRow('header', h, 'header'));
  rows.push(logoRow('header logo', h, expect.header.images));
  rows.push(h.present ? row('header height', width, h.height > MAX_HEADER_PX ? 'FAIL' : 'PASS', `${Math.round(h.height)}px`) : row('header height', width, 'FAIL', 'no <header>'));
  if (!h.present || facts.mainTop == null) rows.push(row('header/main', width, 'FAIL', h.present ? 'no <main>' : 'no <header>'));
  else {
    const cover = Math.round(h.contentBottom - facts.mainTop);
    const band = Math.round(facts.mainTop - h.contentBottom);
    const bad = cover > MAX_COVER_PX ? `covers main by ${cover}px` : band > MAX_BAND_PX ? `${band}px band above main` : null;
    rows.push(row('header/main', width, bad ? 'FAIL' : 'PASS', bad ?? `${Math.max(cover, band, 0)}px`, bad ? `header content ends at ${Math.round(h.contentBottom)}px, main starts at ${Math.round(facts.mainTop)}px` : null));
  }
  const headerVisible = actualKeys([...h.links, ...(facts.toggle?.links ?? [])], (a) => a.visible);
  rows.push(linkRow('header links', expect.header.links, actualKeys(h.links, () => true), headerVisible));
  if (narrow) {
    const closedVisible = actualKeys(h.links, (a) => a.visible);
    const hiddenClosed = expect.mapped ? missingOf(expect.header.links, closedVisible) : [];
    const t = facts.toggle;
    if (!h.present) rows.push(row('menu toggle', width, 'FAIL', 'no <header>'));
    else if (!expect.mapped) rows.push(row('menu toggle', width, 'n/a', NO_CONTRACT));
    else if (!hiddenClosed.length) rows.push(row('menu toggle', width, 'PASS', 'n/a: every mapped link shows closed'));
    else if (!t?.found) rows.push(row('menu toggle', width, 'FAIL', 'no toggle', `${hiddenClosed.length} mapped link(s) hidden with no control to show them`));
    else {
      const opened = actualKeys(t.links ?? [], (a) => a.visible);
      const still = missingOf(hiddenClosed, opened);
      const aria = t.expandedBefore != null && t.expandedAfter !== 'true' ? `aria-expanded "${t.expandedAfter}" after the click` : null;
      const bad = [still.length ? `${still.length} link(s) still hidden after the click` : null, aria].filter(Boolean);
      rows.push(row('menu toggle', width, bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : `${t.label || 'toggle'}: ${hiddenClosed.length} shown`, still.length ? listed(still.map((l) => `HIDDEN ${l.label} → ${l.href}`)) : null));
    }
  }
  const leaks = [...(h.leaks ?? []), ...(f.leaks ?? [])];
  rows.push(row('icon text', width, leaks.length ? 'FAIL' : 'PASS', String(leaks.length), listed(leaks)));
  rows.push(presentRow('footer', f, 'footer'));
  rows.push(logoRow('footer logo', f, expect.footer.images));
  rows.push(linkRow('footer links', expect.footer.links, actualKeys(f.links, () => true), actualKeys(f.links, (a) => a.visible)));
  if (!expect.mapped) rows.push(row('footer text', width, 'n/a', NO_CONTRACT));
  else {
    const text = fold(f.text);
    const lost = expect.footer.texts.filter((t) => !text.includes(fold(t)));
    rows.push(row('footer text', width, lost.length ? 'FAIL' : 'PASS', `${expect.footer.texts.length - lost.length}/${expect.footer.texts.length}`, listed(lost.map((t) => `MISSING "${t.slice(0, 80)}"`))));
  }
  return rows;
}

// ---- in the page ---------------------------------------------------------------------------------------------------

// The facts of the header, footer and main, menu closed. Serialized into the page: no closure over this module.
const factsIn = ({ ligature, minLogo }) => {
  const LIG = new RegExp(ligature, 'g');
  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.left >= window.innerWidth) return false;
    return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : getComputedStyle(el).visibility !== 'hidden';
  };
  const abs = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, height: r.height }; };
  const region = (tag) => {
    const el = document.querySelector(tag);
    if (!el) return { present: false, links: [], leaks: [] };
    const box = abs(el);
    const undecorated = [...el.querySelectorAll('[data-block-status]')].filter((b) => b.dataset.blockStatus !== 'loaded').map((b) => `${b.className || b.tagName.toLowerCase()}: ${b.dataset.blockStatus}`);
    let contentBottom = box.top;
    for (const d of el.querySelectorAll('*')) {
      if (!shown(d)) continue;
      const s = getComputedStyle(d);
      if (s.position === 'fixed' && d.getBoundingClientRect().height > window.innerHeight * 0.5) continue;
      contentBottom = Math.max(contentBottom, abs(d).bottom);
    }
    const images = [...el.querySelectorAll('img, svg')];
    const logos = images.filter((im) => shown(im) && Math.max(im.getBoundingClientRect().width, im.getBoundingClientRect().height) >= minLogo && (im.tagName !== 'IMG' || (im.complete && im.naturalWidth > 0))).length;
    const brokenImages = images.filter((im) => im.tagName === 'IMG' && im.complete && im.naturalWidth === 0).map((im) => (im.currentSrc || im.src || '(no src)').slice(0, 200));
    const leaks = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || !shown(p) || /icon|symbol/i.test(getComputedStyle(p).fontFamily)) continue;
      for (const m of n.textContent.matchAll(LIG)) leaks.push(`${tag}: "${m[0]}" in <${p.tagName.toLowerCase()}${p.className ? ` class="${String(p.className).slice(0, 60)}"` : ''}>`);
    }
    return {
      present: true,
      height: box.height,
      top: box.top,
      bottom: box.bottom,
      contentBottom: Math.max(box.bottom, contentBottom),
      undecorated,
      logos,
      brokenImages,
      leaks,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      links: [...el.querySelectorAll('a[href]')].map((a) => ({ href: a.href, visible: shown(a) })),
    };
  };
  const main = document.querySelector('main');
  const header = region('header');
  // A fixed or sticky header's content box is the header's own: the page reserves its height in flow.
  return { header, footer: region('footer'), mainTop: main ? abs(main).top : null };
};

// The menu control: the visible header control that says it opens something, the first one otherwise.
const toggleIn = () => {
  const header = document.querySelector('header');
  if (!header) return null;
  const shown = (el) => el.getClientRects().length && el.getBoundingClientRect().width >= 1 && getComputedStyle(el).visibility !== 'hidden';
  const cands = [...header.querySelectorAll('button, [role="button"], [aria-controls], [aria-expanded]')].filter((el) => shown(el) && el.tagName !== 'NAV');
  const score = (el) => (el.hasAttribute('aria-expanded') ? 2 : 0) + (el.hasAttribute('aria-controls') ? 1 : 0) + (/menu|nav|hamburger|toggle/i.test(`${el.getAttribute('aria-label') || ''} ${el.className} ${el.textContent}`) ? 2 : 0);
  const best = cands.sort((a, b) => score(b) - score(a))[0];
  if (!best) return null;
  best.setAttribute('data-chrome-gate-toggle', '');
  return { label: (best.getAttribute('aria-label') || best.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), expanded: best.getAttribute('aria-expanded') };
};

const openedIn = () => {
  const t = document.querySelector('[data-chrome-gate-toggle]');
  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.left >= window.innerWidth) return false;
    return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  return { expandedAfter: t ? t.getAttribute('aria-expanded') : null, links: [...document.querySelectorAll('header a[href]')].map((a) => ({ href: a.href, visible: shown(a) })) };
};

async function measureWidth({ browser, openPage, gotoLive, width, url, edsTimeoutMs, expect, origins, namespace }) {
  const { ctx, page } = await openPage(browser, { width, height: VIEWPORT_HEIGHT });
  try {
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: NAV_TIMEOUT_MS, settleMs: 0 });
    await edsSettle(page, { timeoutMs: edsTimeoutMs });
    await page.evaluate(() => document.fonts?.ready);
    // The footer loads with the lazy phase: bring it into view, then back to the top for the header.
    await page.evaluate(() => { document.querySelector('footer')?.scrollIntoView(); });
    await page.waitForFunction(() => { const f = document.querySelector('footer'); return !f || f.children.length > 0; }, null, { timeout: 5000, polling: 100 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    const facts = await page.evaluate(factsIn, { ligature: LIGATURE.source, minLogo: MIN_LOGO_PX });
    const narrow = width < 1024;
    if (narrow && facts.header.present) {
      const t = await page.evaluate(toggleIn);
      if (t) {
        await page.locator('[data-chrome-gate-toggle]').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(TOGGLE_SETTLE_MS);
        const after = await page.evaluate(openedIn);
        facts.toggle = { found: true, label: t.label, expandedBefore: t.expanded, expandedAfter: after.expandedAfter, links: after.links };
      } else facts.toggle = { found: false };
    }
    return evaluateChrome(facts, expect, { width, narrow, ...origins, namespace });
  } catch (e) {
    if (e?.name === 'BotChallengeError') throw coded(3, e.message);
    const why = e?.name === 'LiveHTTPError' ? `HTTP ${e.status} at ${url}` : firstLine(String(e?.message ?? e)) || 'the page could not be read';
    return BROWSER_CHECKS.filter((c) => c !== 'menu toggle' || width < 1024).map((check) => row(check, width, 'ERROR', `ERROR (exit ${EXIT.ERROR})`, why));
  } finally { await ctx.close(); }
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

export async function runChrome({ dir, slug, preview, widths = [1440, NARROW], edsTimeoutMs = EDS_TIMEOUT_MS }) {
  const deployed = deployedDir(dir, slug);
  const record = join(deployed, 'chrome.json');
  rmSync(record, { force: true });
  if (typeof preview.url !== 'string' || !preview.url) throw new UsageError(`${join(deployed, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  const expect = readChromeContract(dir);
  const origins = { sourceOrigin: originOf(expect.sourceUrl), previewOrigin: originOf(preview.url) };

  const chromium = await loadChromium();
  const { openBrowser, openPage } = await loadMeasureLive();
  const { gotoLive } = await loadLiveSession();
  const browser = await openBrowser(chromium, { tier: 'plain' });
  const rows = [];
  try {
    for (const width of widths) rows.push(...await measureWidth({ browser, openPage, gotoLive, width, url: preview.url, edsTimeoutMs, expect, origins, namespace: preview.sandbox ? null : preview.namespace ?? null }));
  } finally { await browser.close(); }
  const verdict = verdictOf(rows);
  writeJson(record, { verdict, hard: true, mapped: expect.mapped, rows });
  return { verdict, exit: EXIT[verdict], hard: true, rows };
}

const failure = (r) => `${r.check} @${r.width}: ${r.value} (bar ${r.bar})`;
export const chromeLines = (result) => stepLines('chrome', result, { failHeading: 'FAIL chrome (hard)', failure });
