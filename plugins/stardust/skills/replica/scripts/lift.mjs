#!/usr/bin/env node
/**
 * skills/replica/scripts/lift.mjs — per-breakpoint computed-style lift (Phase 3 evidence)
 *
 * ONE live navigation per archetype × width that records everything the
 * recreation authors from and the pixel gate cannot explain afterwards:
 * every rendered element under the roots to UNLIMITED depth (own text in
 * full — never truncated), its document rect AND its offsetParent-relative
 * offset (a positioned element authored from the viewport-measured `left`
 * rendered +80 px off and survived the full-page gate), the inline `style`
 * attribute (icon strips size each <img> inline — a representative lift
 * misses them), ~60 computed properties (non-default values only; includes
 * `font-variation-settings` / `font-optical-sizing` / `font-feature-settings`
 * — a missing `'opsz' 6` rendered a variable face ~12 % narrower), ::before /
 * ::after, the authored heading level, last-child margins, the unitless
 * `line-height` an element's matched rules declare (<sup>/<sub> parity), plus
 * the stylesheets themselves from the navigation's own `text/css` responses —
 * `@font-face` descriptors and the exact `@media` conditions (`768` ≠ `767`).
 *
 * Not a gate: nothing is blocked. The doc rule is procedural — run it at every
 * gate width BEFORE authoring (`../reference/recreation-procedure.md` § CSS
 * lifting, step 4) and feed the JSON to `impeccable-ignores.mjs --tokens`.
 *
 * Usage:
 *   node skills/replica/scripts/lift.mjs <url> [<out.json>] [options]
 *     --width <px>        viewport width (default 1440) — one width per run; loop in the command block
 *     --roots <sel,…>     roots to walk (default header,main,footer) — chrome and main from one hit
 *     --main <sel>        the content root for sections[] (default main)
 *     --max <n>           elements per root; 0 = unlimited (default 0)
 *     --save-css          also write the captured stylesheets to stardust/replica/capture/css/
 *     --refresh           re-probe even when <out> exists for the same url/width/roots
 *     --settle | --no-settle   slow-scroll settle before reading (default on)
 *     --wait <ms>         extra wait after the settle (default 0)
 *     --timeout <ms>      navigation timeout (default 60000)
 *     --consent <sel> | --dismiss <sel,…> | --consent-mode accept|deny | --block <substr,…>
 *     --headed[=window] | --locale <tag> | --storage-state <f> | --fresh-state | --solve-wait <ms>
 *                         live-session.mjs flags, same semantics as stitch-shot
 *     --json              print the record to stdout as well
 *     --help
 *
 * Default <out>: stardust/replica/capture/lift/<slug>-<width>.json (slug from
 * state.json.pages[] when the URL matches, else the path slug). When <out>
 * exists for the same url + width + roots the run prints `reusing` and exits 0
 * with NO live hit (`--refresh` re-probes) — the anchor/chrome-parity cache
 * convention.
 *
 * Output: { url, width, vh, dpr, consent, technique, tier, capturedAt, docHeight,
 *   roots[], stylesheets[{url, bytes, inline}], fontFaces[], mediaQueries[],
 *   elements[{ i, parent, depth, path, tag, id, cls, text, textLen, rect, offset,
 *              inline, s{…}, before, after, headingLevel, isLastChild, lineHeightUnitless }],
 *   sections[{ idx, sel, rect, text }] }
 *
 * Exit codes: 0 written (or reused) · 1 error · 3 bot challenge (fail loud, nothing
 * written) · 5 invalid capture on a live URL (short / near-empty — live-session's
 * capture floor; the build side is never judged).
 * Requires: playwright + the diff skill's scripts dir alongside (live-session.mjs).
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { dirname, resolve as resolvePath, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('lift error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, launchTier, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, sessionContextOptions, parseSolveWaitFlag, dismissOverlays, reportOverlayResidue, defaultWaitUntil, captureSanity } = await import(pathToFileURL(LIVE_SESSION).href);

export const SCHEMA = 1;
export const PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'float', 'boxSizing', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'textDecorationLine', 'textDecorationThickness', 'textUnderlineOffset', 'whiteSpace', 'textWrap', 'textOverflow', 'verticalAlign',
  'fontVariationSettings', 'fontOpticalSizing', 'fontFeatureSettings', 'fontKerning', 'fontSynthesis', 'fontVariantNumeric', 'textRendering', 'webkitFontSmoothing',
  'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'opacity', 'mixBlendMode',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'outlineWidth', 'boxShadow',
  'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'justifyContent', 'alignItems', 'alignSelf', 'gap', 'rowGap', 'columnGap', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridAutoFlow', 'order',
  'overflow', 'overflowX', 'overflowY', 'objectFit', 'objectPosition', 'aspectRatio', 'transform', 'transformOrigin', 'transition', 'animationName', 'cursor', 'pointerEvents', 'visibility', 'listStyleType', 'columnCount', 'clipPath', 'filter', 'backdropFilter', 'isolation', 'contain', 'contentVisibility'];

const HELP = `lift — per-breakpoint computed-style lift of the live page (Phase 3 evidence, not a gate)

Usage: node lift.mjs <url> [<out.json>] [options]
  --width <px>       viewport width (default 1440; one width per run)   --roots <sel,…>  default header,main,footer
  --main <sel>       content root for sections[] (default main)         --max <n>        elements per root, 0 = unlimited
  --save-css         write the captured stylesheets to stardust/replica/capture/css/
  --refresh          re-probe even when <out> exists for the same url/width/roots (else: reusing, exit 0, no live hit)
  --settle | --no-settle   slow-scroll settle (default on)   --wait <ms>  extra wait   --timeout <ms>  navigation (60000)
  --consent <sel> | --dismiss <sel,…> | --consent-mode accept|deny | --block <substr,…>
  --headed[=window] | --locale <tag> | --storage-state <f> | --fresh-state | --solve-wait <ms>
  --json             print the record to stdout too
  --help             this text

Exit codes: 0 written / reused, 1 error, 3 bot challenge (live), 5 invalid capture on a live URL (short / near-empty).`;

// ------------------------------------------------------------------ pure halves

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, roots: ['header', 'main', 'footer'], main: 'main', max: 0, saveCss: false, refresh: false, settle: true, wait: 0, timeout: 60000, consent: null, dismiss: [], consentMode: 'accept', block: [], headed: false, locale: null, json: false };
  const need = (flag, i) => { if (rest[i] === undefined || rest[i].startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return rest[i]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(need(a, ++i));
    else if (a === '--roots') opts.roots = need(a, ++i).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--main') opts.main = need(a, ++i);
    else if (a === '--max') opts.max = Number(need(a, ++i)) || 0;
    else if (a === '--save-css') opts.saveCss = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--settle') opts.settle = true;
    else if (a === '--no-settle') opts.settle = false;
    else if (a === '--wait') opts.wait = Number(need(a, ++i)) || 0;
    else if (a === '--timeout') opts.timeout = Number(need(a, ++i)) || 60000;
    else if (a === '--consent') opts.consent = need(a, ++i);
    else if (a === '--dismiss') opts.dismiss = need(a, ++i).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--block') opts.block = need(a, ++i).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--consent-mode') { opts.consentMode = need(a, ++i); if (!['accept', 'deny'].includes(opts.consentMode)) { console.error(`--consent-mode must be accept or deny\n\n${HELP}`); process.exit(1); } }
    else if (a === '--headed' || a.startsWith('--headed=')) opts.headed = parseHeadedFlag(a);
    else if (a === '--storage-state') opts.storageState = need(a, ++i);
    else if (a === '--fresh-state') opts.freshState = true;
    else if (a === '--solve-wait') { opts.solveWaitMs = parseSolveWaitFlag(need(a, ++i)); opts.headed = 3; }
    else if (a === '--locale') opts.locale = need(a, ++i);
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (!(opts.width > 0) || !opts.roots.length) { console.error(`--width needs px > 0 and --roots at least one selector\n\n${HELP}`); process.exit(1); }
  const [url, out = null] = pos;
  if (!url) { console.error(`need <url>\n\n${HELP}`); process.exit(1); }
  return { url, out: out || defaultOut(url, opts.width), opts };
}

export function slugOf(url, stateFile = 'stardust/state.json') {
  try {
    const st = JSON.parse(readFileSync(stateFile, 'utf8'));
    const hit = (st.pages || []).find((p) => p.url && p.url.replace(/\/+$/, '') === url.replace(/\/+$/, ''));
    if (hit && hit.slug) return hit.slug;
  } catch { /* no state — path slug */ }
  try { const p = new URL(url).pathname.replace(/\/+$/, ''); return p ? p.split('/').filter(Boolean).join('-').replace(/[^\w-]+/g, '-').toLowerCase() : 'home'; } catch { return 'home'; }
}
export const defaultOut = (url, width) => `stardust/replica/capture/lift/${slugOf(url)}-${width}.json`;

/**
 * @font-face descriptors and @media conditions from CSS text (no cross-origin
 * CSSOM — the text comes from the navigation's own responses).
 * Returns { fontFaces: [{ fontFamily, src, fontWeight, fontStyle, fontDisplay, unicodeRange }], mediaQueries: [string] }.
 */
export function parseCssMeta(cssText) {
  const css = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const fontFaces = []; const media = new Set();
  const camel = (k) => k.trim().toLowerCase().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const block = (from) => { let depth = 0; for (let i = from; i < css.length; i += 1) { if (css[i] === '{') depth += 1; else if (css[i] === '}') { depth -= 1; if (depth === 0) return i; } } return -1; };
  const ffRe = /@font-face\s*\{/g; let m;
  while ((m = ffRe.exec(css))) {
    const open = m.index + m[0].length - 1; const close = block(open); if (close < 0) break;
    const body = css.slice(open + 1, close); const d = {};
    for (const decl of body.split(';')) { const idx = decl.indexOf(':'); if (idx < 0) continue; const k = camel(decl.slice(0, idx)); const v = decl.slice(idx + 1).trim(); if (k && v) d[k] = v.replace(/^["']|["']$/g, ''); }
    if (d.fontFamily) fontFaces.push({ fontFamily: d.fontFamily, src: d.src || null, fontWeight: d.fontWeight || null, fontStyle: d.fontStyle || null, fontDisplay: d.fontDisplay || null, unicodeRange: d.unicodeRange || null });
    ffRe.lastIndex = close + 1;
  }
  const mqRe = /@media\s*([^{]+)\{/g;
  while ((m = mqRe.exec(css))) media.add(m[1].replace(/\s+/g, ' ').trim());
  return { fontFaces, mediaQueries: [...media] };
}

/** True when <out> already holds a record for the same url + width + roots. */
export function reusable(out, url, opts) {
  if (!existsSync(out)) return false;
  try { const j = JSON.parse(readFileSync(out, 'utf8')); return j.schema === SCHEMA && j.url === url && j.width === opts.width && JSON.stringify(j.roots) === JSON.stringify(opts.roots) && Array.isArray(j.elements); } catch { return false; }
}

// -------------------------------------------------------------- in-page walker
/* eslint-disable no-undef */
function pageLift({ roots, main, max, props, cssTexts }) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // Defaults dropped from s{}: a global set plus PER-PROPERTY defaults — '1' is
  // the default of opacity / flex-shrink but an authored value for flex-grow,
  // z-index, order, column-count (a global '1' dropped `flex-grow: 1`).
  const TRIVIAL = new Set(['none', 'normal', 'auto', '0px', '0', 'static', 'visible', 'start', 'rgba(0, 0, 0, 0)', 'transparent', 'nowrap', 'row', 'stretch', 'flex-start', 'initial', 'baseline', 'scroll', 'fill', 'wrap', 'disc', 'ease 0s', 'all 0s ease 0s', 'content-box', 'left', 'top', 'repeat', '50% 50%', 'ltr', 'break-word', 'clip']);
  const TRIVIAL_FOR = { opacity: new Set(['1']), flexShrink: new Set(['1']), fontOpticalSizing: new Set(['auto']), lineHeight: new Set(['normal']) };
  const trivial = (p, v) => TRIVIAL.has(v) || (TRIVIAL_FOR[p] && TRIVIAL_FOR[p].has(v));
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const pathOf = (el) => { const bits = []; for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) { const c = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.'); bits.unshift(`${n.tagName.toLowerCase()}${c ? `.${c}` : ''}`); } return bits.join(' > '); };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
  // unitless line-heights declared by the captured rules (+ inline <style>), matched per element (no cross-origin CSSOM)
  const inlineStyles = [...document.querySelectorAll('style')].map((st) => st.textContent || '').filter(Boolean);
  const unitless = [];
  for (const text of [...(cssTexts || []), ...inlineStyles]) {
    try {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(text);
      const walk = (rules) => { for (const r of rules) { if (r.style && r.selectorText) { const lh = r.style.getPropertyValue('line-height').trim(); if (lh && /^\d*\.?\d+$/.test(lh)) unitless.push({ sel: r.selectorText, value: lh }); } else if (r.cssRules) walk(r.cssRules); } };
      walk(sheet.cssRules);
    } catch { /* unparsable text — skipped */ }
  }
  const declaredUnitless = (el) => { let hit = null; for (const u of unitless) { try { if (el.matches(u.sel)) hit = u.value; } catch { /* pseudo / unsupported selector */ } } if (hit) return hit; for (let n = el.parentElement; n; n = n.parentElement) for (const u of unitless) { try { if (n.matches(u.sel)) return u.value; } catch { /* skip */ } } return null; };
  const pseudo = (el, which) => { const cs = getComputedStyle(el, which); if (!cs.content || cs.content === 'none' || cs.content === 'normal') return null; return { content: cs.content, backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : null, w: parseFloat(cs.width) || null, h: parseFloat(cs.height) || null, fontFamily: cs.fontFamily, color: cs.color, display: cs.display, position: cs.position }; };
  const elements = []; const index = new Map();
  const walkRoot = (root, rootSel) => {
    const queue = [{ el: root, depth: 0, parent: null }];
    let count = 0;
    while (queue.length) {
      const { el, depth, parent } = queue.shift();
      if (max && count >= max) break;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'template'].includes(tag) && el !== root) continue;
      const cs = getComputedStyle(el);
      const rect = rectOf(el);
      const rendered = cs.display !== 'none' && (rect.w > 0 || rect.h > 0);
      if (!rendered && el !== root) continue;
      const i = elements.length; index.set(el, i); count += 1;
      const s = {};
      for (const p of props) { const v = cs[p]; if (v === undefined || v === '' || trivial(p, v)) continue; s[p] = v; }
      const text = ownText(el);
      const op = el.offsetParent;
      elements.push({
        i, parent, depth, root: rootSel, path: pathOf(el), tag, id: el.id || null, cls: norm(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')) || null,
        text: text || null, textLen: text.length, rect,
        offset: { left: el.offsetLeft, top: el.offsetTop, offsetParent: op && index.has(op) ? index.get(op) : (op ? op.tagName.toLowerCase() : null) },
        inline: el.getAttribute('style') || null, s,
        before: pseudo(el, '::before'), after: pseudo(el, '::after'),
        headingLevel: /^h[1-6]$/.test(tag) ? Number(tag[1]) : null,
        isLastChild: !!(el.parentElement && el.parentElement.lastElementChild === el),
        lineHeightUnitless: declaredUnitless(el),
        src: tag === 'img' ? (el.currentSrc || el.getAttribute('src') || null) : null,
        natural: tag === 'img' ? { w: el.naturalWidth, h: el.naturalHeight } : null,
      });
      if (tag === 'svg') continue; // the <svg> itself is recorded (rect, fill, size); its shapes are not elements to author
      for (const c of el.children) queue.push({ el: c, depth: depth + 1, parent: i });
    }
  };
  const rootsFound = [];
  for (const sel of roots) { const root = document.querySelector(sel); if (!root) { rootsFound.push({ sel, found: false }); continue; } rootsFound.push({ sel, found: true, rect: rectOf(root) }); walkRoot(root, sel); }
  const mainEl = document.querySelector(main);
  const sections = mainEl ? [...mainEl.children].map((c, idx) => ({ idx, sel: pathOf(c), rect: rectOf(c), text: norm(c.textContent).slice(0, 200) })) : [];
  return { elements, roots: rootsFound, sections, inlineStyles, docHeight: document.documentElement.scrollHeight, textLen: norm(document.body.innerText || '').length, unitlessRules: unitless.length };
}
/* eslint-enable no-undef */

// -------------------------------------------------------------------- main

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  if (!opts.refresh && reusable(out, url, opts)) { console.log(`lift: reusing ${out} (same url, width ${opts.width}, roots ${opts.roots.join(',')} — no live hit; --refresh to re-probe)`); process.exit(0); }
  const { chromium } = await import('playwright');
  opts.tier = resolveStartTier(opts.headed);
  const browser = await launchTier(chromium, opts.tier);
  const vh = 900;
  const live = isLiveHttpUrl(url);
  try {
    const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: vh }, block: opts.block, deviceScaleFactor: 1, reducedMotion: 'reduce', ...sessionContextOptions(url, opts) });
    const page = await ctx.newPage();
    const sheets = []; const seen = new Set();
    page.on('response', (r) => {
      const ct = (r.headers()['content-type'] || '').toLowerCase(); const u = r.url();
      if (!(ct.includes('text/css') || (/\.css(\?|$)/.test(u) && !ct.includes('html')))) return;
      if (seen.has(u)) return; seen.add(u);
      sheets.push(r.text().then((text) => ({ url: u, bytes: Buffer.byteLength(text), inline: false, text })).catch(() => null));
    });
    await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), timeoutMs: opts.timeout, settleMs: live ? 2500 : 1200, tier: opts.tier, solveWaitMs: opts.solveWaitMs });
    const dOv = await dismissOverlays(page, { mode: opts.consentMode, reject: opts.consentMode === 'deny' && opts.consent ? [opts.consent] : [], extra: [...(opts.consent && opts.consentMode !== 'deny' ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: live ? 6000 : 0 });
    reportOverlayResidue('lift', dOv);
    if (opts.settle) {
      await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); } window.scrollTo(0, 0); await new Promise((r) => { setTimeout(r, 400); }); });
      await page.waitForTimeout(400);
    }
    if (opts.wait) await page.waitForTimeout(opts.wait);
    const captured = (await Promise.all(sheets)).filter(Boolean);
    const lifted = await page.evaluate(pageLift, { roots: opts.roots, main: opts.main, max: opts.max, props: PROPS, cssTexts: captured.map((s) => s.text) });
    const inline = lifted.inlineStyles.map((text, n) => ({ url: `inline:${n + 1}`, bytes: Buffer.byteLength(text), inline: true, text }));
    const all = [...captured, ...inline];
    const meta = all.reduce((acc, s) => { const m = parseCssMeta(s.text); acc.fontFaces.push(...m.fontFaces); for (const q of m.mediaQueries) if (!acc.mediaQueries.includes(q)) acc.mediaQueries.push(q); return acc; }, { fontFaces: [], mediaQueries: [] });
    if (live) {
      const sanity = captureSanity({ totalH: lifted.docHeight, vh, textLen: lifted.textLen });
      if (sanity.verdict !== 'ok') { console.error(`lift: INVALID CAPTURE — ${sanity.verdict}: ${sanity.reason}; nothing written (consent still up? pass --consent <sel>; bot wall? --headed)`); await browser.close(); process.exit(5); }
    }
    let cssDir = null;
    if (opts.saveCss) {
      cssDir = 'stardust/replica/capture/css'; mkdirSync(cssDir, { recursive: true });
      for (const s of all) { const name = s.inline ? `${slugOf(url)}-${s.url.replace(':', '-')}.css` : `${(() => { try { const u = new URL(s.url); return `${u.host}${u.pathname}`.replace(/[^\w.-]+/g, '_'); } catch { return 'sheet'; } })()}`; writeFileSync(join(cssDir, name.endsWith('.css') ? name : `${name}.css`), s.text); s.saved = join(cssDir, name.endsWith('.css') ? name : `${name}.css`); }
    }
    const record = {
      schema: SCHEMA, url, width: opts.width, vh, dpr: 1, consent: { mode: opts.consentMode, via: (dOv && (dOv.via || dOv.consentVia)) || 'none-detected' }, technique: opts.tier >= 3 ? 'chrome-headed-offscreen' : opts.tier === 2 ? 'chrome-headless' : 'headless', tier: opts.tier, capturedAt: new Date().toISOString(),
      docHeight: lifted.docHeight, roots: opts.roots, rootsFound: lifted.roots, main: opts.main,
      stylesheets: all.map(({ text, ...rest }) => rest), cssDir, fontFaces: meta.fontFaces, mediaQueries: meta.mediaQueries,
      elements: lifted.elements, sections: lifted.sections, counts: { elements: lifted.elements.length, sections: lifted.sections.length, unitlessRules: lifted.unitlessRules },
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(record, null, 1));
    if (opts.json) console.log(JSON.stringify(record));
    else console.log(`lift: ${out} — ${record.counts.elements} elements under ${opts.roots.join(',')} (${lifted.roots.filter((r) => !r.found).map((r) => `${r.sel} not found`).join(', ') || 'all roots found'}), ${record.sections.length} sections, ${all.length} stylesheet(s) (${meta.fontFaces.length} @font-face, ${meta.mediaQueries.length} @media), doc ${record.docHeight}px @ ${opts.width}px${cssDir ? `; css saved under ${cssDir}` : ''}`);
    await ctx.close();
  } finally { await browser.close(); }
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`lift error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
