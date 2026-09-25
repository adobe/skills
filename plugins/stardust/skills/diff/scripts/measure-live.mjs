#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, object-property-newline */
/**
 * skills/diff/scripts/measure-live.mjs
 *
 * Measure a LIVE page (or a served build) the way the passes that converged did (#125):
 * real Chrome, window-free (live-session launchStealthHeaded), an optional home warm-up for
 * bot-managed sites (the Akamai sensor cookies must exist before a deep URL is hit — a
 * recorded PDP probe 403'd without it), a SLOW-SCROLL SETTLE repeated until the document
 * height is stable (lazy rails, gliders, ratings widgets hydrate on viewport entry — a
 * settled live page ran 1.6–2k px taller than any single capture), then rect + computed
 * type per element, shadow-DOM aware. Results are cached per slug under
 * `stardust/current/measure/<slug>.json` — the egress that reaches a blocked section may
 * vanish, so a measurement is evidence worth keeping.
 *
 * Library (imported by clip-probe.mjs, content-presence.mjs, unit-geometry.mjs — every probe
 * of the published-origin gate settles both sides with THIS routine, so the instrument stays
 * symmetric):
 *   openBrowser(chromium, { tier })            'stealth' (default, window-free real Chrome) | 'plain'
 *   openPage(browser, { width, height, locale })
 *   visit(page, url, { warmup, settle, dismiss, solveWindow })  → { status, docH, passes }
 *   settle(page, { passes, step, dwell, emptySel, quietMs })    → { docH, passes, pendingImgs }
 *   measureInPage / serializeInPage                            in-page functions (page.evaluate)
 *   cachePath(slug), readCache(slug), writeCache(slug, data)
 *
 * CLI:
 *   node skills/diff/scripts/measure-live.mjs <url> [<selector> …] [options]
 *     --width <px>        viewport width (default 1440)
 *     --all               every match per selector (capped at 60), default first match
 *     --serialize <sel>   also dump the element deep-serialised (shadow roots expanded,
 *                         data-r="x,y,w,h" data-t="fs/lh/fw/color[/bg]" per element)
 *     --warmup <url>      visit this URL first in the same context (home warm-up)
 *     --plain             bundled Chromium instead of the stealth real-Chrome tier
 *     --locale <tag>      Accept-Language + context locale (default en-US)
 *     --slug <s>          cache the result at stardust/current/measure/<s>.json (--force to redo)
 *     --json <out>        also write the result to this file
 *
 * Requires: playwright (project devDependency — the setup step writes it into package.json,
 * never `npm i --no-save`, feedback A3). Exit 0 measured, 1 error, 3 bot challenge.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_CHROME_UA, defaultWaitUntil, dismissOverlays, gotoLive, isLiveHttpUrl, launchStealthHeaded, newLiveContext } from './live-session.mjs';

const HELP = `measure-live — settle a live page (window-free real Chrome) and print rect + computed type per selector

Usage: node measure-live.mjs <url> [<selector> …] [options]
  --width <px>       viewport width (default 1440)
  --all              every match per selector (capped at 60)
  --serialize <sel>  deep-serialise this element (shadow roots expanded, data-r/data-t per element)
  --warmup <url>     visit this URL first (home warm-up for bot-managed sites)
  --plain            bundled Chromium instead of the stealth real-Chrome tier
  --locale <tag>     Accept-Language + context locale (default en-US)
  --slug <s>         cache at stardust/current/measure/<s>.json (--force to re-measure)
  --json <out>       also write the result here
  --help             this text
Exit: 0 measured, 1 error, 3 bot challenge (escalation already applied — record the block).`;

export const MEASURE_DIR = 'stardust/current/measure';
export const cachePath = (slug) => join(MEASURE_DIR, `${slug}.json`);
export function readCache(slug) { const p = cachePath(slug); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
export function writeCache(slug, data) { mkdirSync(MEASURE_DIR, { recursive: true }); writeFileSync(cachePath(slug), JSON.stringify(data)); return cachePath(slug); }

/** Launch the measurement browser. 'stealth' = the window-free real-Chrome tier (default on BOTH sides
 * of a compare so the instrument is symmetric); 'plain' = bundled Chromium. */
export async function openBrowser(chromium, { tier = 'stealth' } = {}) {
  if (tier === 'plain') return chromium.launch();
  return launchStealthHeaded(chromium);
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

// ---- CLI ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { width: 1440, all: false, serialize: null, warmup: null, plain: false, locale: 'en-US', slug: null, force: false, json: null, url: null, sels: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(rest[++i]);
    else if (a === '--all') opts.all = true;
    else if (a === '--serialize') opts.serialize = rest[++i];
    else if (a === '--warmup') opts.warmup = rest[++i];
    else if (a === '--plain') opts.plain = true;
    else if (a === '--locale') opts.locale = rest[++i];
    else if (a === '--slug') opts.slug = rest[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--json') opts.json = rest[++i];
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else if (!opts.url) opts.url = a;
    else opts.sels.push(a);
  }
  if (!opts.url) { console.error(`need <url>\n\n${HELP}`); process.exit(1); }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.slug && !opts.force) {
    const cached = readCache(opts.slug);
    if (cached) { console.log(`cached ${cachePath(opts.slug)} (docH ${cached.docH}, ${cached.items?.length ?? 0} items) — --force to re-measure`); return; }
  }
  const { chromium } = await import('playwright');
  const browser = await openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' });
  try {
    const { ctx, page } = await openPage(browser, { width: opts.width, locale: opts.locale });
    const v = await visit(page, opts.url, { warmup: opts.warmup });
    const data = await page.evaluate(measureInPage, { sels: opts.sels, all: opts.all });
    const out = { url: opts.url, at: new Date().toISOString(), width: opts.width, status: v.status, docH: data.docH, settlePasses: v.passes, pendingImgs: v.pendingImgs, tier: opts.plain ? 'plain' : 'stealth', items: data.items };
    if (opts.serialize) out.html = await page.evaluate(serializeInPage, { sel: opts.serialize });
    console.log(`docH ${data.docH} (settled in ${v.passes} pass${v.passes > 1 ? 'es' : ''}, HTTP ${v.status})`);
    for (const it of data.items) {
      if (it.missing) { console.log(`MISSING ${it.sel}`); continue; }
      if (it.error) { console.log(`ERROR ${it.sel}: ${it.error}`); continue; }
      console.log(`${it.sel}  <${it.tag}${it.cls ? `.${it.cls.split(/\s+/).join('.')}` : ''}>  y=${it.y} h=${it.h} x=${it.x} w=${it.w}  fs=${it.fs}/${it.lh} fw=${it.fw} ${it.ff}  color=${it.color} bg=${it.bg} pad=${it.pad} mar=${it.mar}${it.br !== '0px' ? ` br=${it.br}` : ''} "${it.text}"`);
    }
    if (opts.serialize) console.log(`serialised ${opts.serialize}: ${out.html ? `${out.html.length} chars` : 'no match'}`);
    if (opts.slug) console.log(`cached → ${writeCache(opts.slug, out)}`);
    if (opts.json) { mkdirSync(dirname(opts.json) || '.', { recursive: true }); writeFileSync(opts.json, JSON.stringify(out, null, 1)); console.log(`wrote ${opts.json}`); }
    await ctx.close();
  } finally { await browser.close(); }
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`measure-live error: ${e.message.split('\n')[0]}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
