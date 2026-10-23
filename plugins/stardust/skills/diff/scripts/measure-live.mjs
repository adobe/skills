#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, object-property-newline */
/**
 * skills/diff/scripts/measure-live.mjs — measure a live page the way the converging passes did (#125):
 * window-free real Chrome (live-session), optional home warm-up for bot-managed sites, a slow-scroll
 * settle repeated until the document height is stable, then rect + computed type per element,
 * shadow-DOM aware, cached per slug under stardust/current/measure/<slug>.json.
 *
 * Library for clip-probe, content-presence and unit-geometry (every gate probe settles both sides
 * with THIS routine — the instrument stays symmetric): openBrowser, openPage, visit, settle,
 * measureInPage, serializeInPage, cachePath / readCache / writeCache.
 *
 * Library only (no CLI): selectors are measured through the probes or `replica/measure.mjs`.
 * Requires playwright (a project devDependency).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_CHROME_UA, browserTier, defaultWaitUntil, dismissOverlays, gotoLive, isLiveHttpUrl, launchStealthHeaded, newLiveContext } from './live-session.mjs';

export { browserTier };

export const MEASURE_DIR = 'stardust/current/measure';
export const cachePath = (slug) => join(MEASURE_DIR, `${slug}.json`);
export function readCache(slug) { const p = cachePath(slug); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
export function writeCache(slug, data) { mkdirSync(MEASURE_DIR, { recursive: true }); writeFileSync(cachePath(slug), JSON.stringify(data)); return cachePath(slug); }

/** Launch the measurement browser. 'stealth' = the window-free real-Chrome tier (default on BOTH sides
 * of a compare so the instrument is symmetric); 'plain' = bundled Chromium. */
export async function openBrowser(chromium, { tier = 'stealth' } = {}) {
  if (tier === 'plain') { const b = await chromium.launch(); b.stardustTier = 'chromium'; return b; }
  return launchStealthHeaded(chromium); // the best available: Chrome, else Chromium (tagged 'chromium-fallback')
}

export async function openPage(browser, { width = 1440, height = 900, locale = 'en-US', ua = REAL_CHROME_UA } = {}) {
  const ctx = await newLiveContext(browser, { ua, locale, viewport: { width, height } });
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * Slow-scroll settle until the document height is stable (hydrate-dom.mjs semantics): scroll the whole
 * page in `step` px increments dwelling `dwell` ms each, wait `quietMs`, re-read the height; stop when
 * the height did not change AND no `emptySel` shells remain, or after `passes`. Ends scrolled to top.
 */
export async function settle(page, { passes = 4, step = 400, dwell = 250, emptySel = null, quietMs = 2000 } = {}) {
  let prevH = -1; let docH = 0; let pendingImgs = 0; let i = 0;
  for (; i < passes; i += 1) {
    await page.evaluate(async ({ s, d }) => {
      const max = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      for (let y = 0; y <= max(); y += s) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, d); }); }
    }, { s: step, d: dwell });
    await page.waitForTimeout(quietMs);
    const st = await page.evaluate((sel) => ({
      h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
      empty: sel ? document.querySelectorAll(sel).length : 0,
      pending: [...document.images].filter((im) => im.getBoundingClientRect().width > 10 && (!im.complete || im.naturalWidth === 0)).length,
    }), emptySel);
    docH = st.h; pendingImgs = st.pending;
    if (st.h === prevH && st.empty === 0) break;
    prevH = st.h;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  return { docH, passes: Math.min(i + 1, passes), pendingImgs };
}

/**
 * Navigate (fail-loud live-session contract: a challenge throws BotChallengeError, a 404 build is measured
 * with a warning), dismiss overlays, settle. `warmup` visits another URL first in the same context.
 */
export async function visit(page, url, { warmup = null, settle: settleOpts = {}, dismiss = true, solveWindow = true, timeoutMs = 90000, httpError = 'measure' } = {}) {
  if (warmup) {
    await gotoLive(page, warmup, { waitUntil: 'domcontentloaded', timeoutMs, settleMs: 0, solveWindow, httpError: 'measure' });
    await page.waitForTimeout(2500);
  }
  const resp = await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), timeoutMs, settleMs: 0, solveWindow, httpError });
  await page.waitForTimeout(2500);
  if (dismiss) { try { await dismissOverlays(page, { lateWindowMs: isLiveHttpUrl(url) ? 4000 : 0 }); } catch { /* none */ } }
  const s = await settle(page, settleOpts);
  if (dismiss) { try { await dismissOverlays(page, { lateWindowMs: 0 }); } catch { /* none */ } }
  return { status: resp ? resp.status() : null, ...s };
}

// ---- in-page functions (Playwright-serialised; ONE argument object) --------------------------------

/** page.evaluate(measureInPage, { sels, all }) → { docH, items: [{ sel, tag, cls, x, y, w, h, fs, lh, fw, ff, color, bg, ta, pad, mar, br, display, text }] } */
export function measureInPage({ sels, all }) {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const out = { docH: document.documentElement.scrollHeight, items: [] };
  sels.forEach((sel) => {
    let els; try { els = [...document.querySelectorAll(sel)]; } catch { out.items.push({ sel, error: 'bad selector' }); return; }
    els = all ? els.slice(0, 60) : els.slice(0, 1);
    if (!els.length) out.items.push({ sel, missing: true });
    els.forEach((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      out.items.push({
        sel, tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 60),
        x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
        fs: px(cs.fontSize), lh: px(cs.lineHeight), fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0].replace(/"/g, ''),
        color: cs.color, bg: cs.backgroundColor, ta: cs.textAlign,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px).join(' '),
        mar: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px).join(' '),
        br: cs.borderRadius, display: cs.display, text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      });
    });
  });
  return out;
}

/** page.evaluate(serializeInPage, { sel, budget }) → deep HTML of the first match: shadow roots expanded,
 * data-r="x,y,w,h" + data-t="fs/lh/fw/color[/bg]" on every element (pdp-measure.mjs's serialiser, lifted). */
export function serializeInPage({ sel, budget = 4000000 }) {
  const root = document.querySelector(sel);
  if (!root) return null;
  const px = (v) => Math.round(parseFloat(v) || 0);
  const rect = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.left + window.scrollX)},${Math.round(r.top + window.scrollY)},${Math.round(r.width)},${Math.round(r.height)}`; };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const KEEP = ['id', 'class', 'href', 'src', 'alt', 'aria-label', 'type', 'value', 'placeholder', 'name', 'for', 'title', 'aria-expanded', 'aria-hidden', 'style'];
  let left = budget;
  const ser = (node) => {
    if (left <= 0) return '';
    if (node.nodeType === 3) { const t = node.textContent; left -= t.length; return esc(t); }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'link', 'meta'].includes(tag)) return '';
    const attrs = KEEP.filter((k) => node.hasAttribute(k)).map((k) => ` ${k}="${esc(node.getAttribute(k).slice(0, k === 'style' ? 200 : 400))}"`).join('');
    const cs = getComputedStyle(node);
    const meta = ` data-r="${rect(node)}" data-t="${px(cs.fontSize)}/${px(cs.lineHeight)}/${cs.fontWeight}/${cs.color.replace(/\s/g, '')}${cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `/${cs.backgroundColor.replace(/\s/g, '')}` : ''}"`;
    if (tag === 'svg') return `<svg${attrs}${meta}></svg>`;
    if (['img', 'input', 'br', 'hr'].includes(tag)) return `<${tag}${attrs}${meta}>`;
    if (tag === 'iframe') return `<iframe${attrs}${meta}></iframe>`;
    let inner = '';
    if (node.shadowRoot) inner += [...node.shadowRoot.childNodes].map(ser).join('');
    inner += [...node.childNodes].map(ser).join('');
    left -= 20;
    return `<${tag}${attrs}${meta}>${inner}</${tag}>`;
  };
  return ser(root);
}
