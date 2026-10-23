#!/usr/bin/env node
/**
 * skills/extract/scripts/style-census.mjs — the computed-style census behind
 * extract Phase 3 (brand-surface extraction): every captured page, measured in
 * a real browser with GENERIC selectors only, and one deterministic aggregate
 * (palette clusters with roles and sources, type families/sizes/weights, the
 * radius/shadow/gradient motifs, hover deltas, the logo chain, icon-font
 * evidence). The agent reads `aggregate` and cites `sources[]`; it writes no
 * probe of its own.
 *
 * Why: the skill requires computed-style evidence across ALL extracted pages
 * but shipped no instrument for it, so every run authored a one-off probe.
 * Recorded: one probe covered 5 of 26 pages, hard-coded that site's class
 * names, and cost several turns before the first palette value existed.
 *
 * The census is a FULL LIVE PASS: every captured page is fetched again from the
 * live origin, through the shared live-session hardening. Run it ONCE, in the
 * background, after the crawl (`node … style-census.mjs … &` and read <out>
 * when the summary line lands) — never per question, never in parallel with
 * another live instrument: each pass spends the origin's bot-management
 * request budget, and a second concurrent pass is what turns a cleared site
 * into a blocked one.
 *
 * Usage:
 *   node style-census.mjs [--pages <dir> | --urls a,b,c] [--out <file>] [--width <px>]…
 *                         [--concurrency <n>] [--max-pages <n>] [--timeout-ms <ms>] [--ua <string>]
 *                         [--dismiss <sel,…>] [--headed] [--locale <tag>]
 *     --pages <dir>        page records (default stardust/current/pages): every *.json there,
 *                          each record's finalUrl (or url) is measured
 *     --urls a,b,c         measure exactly these URLs instead of a pages dir
 *     --out <file>         output (default stardust/current/_computed-styles.json)
 *     --width <px>         viewport width; repeatable or comma-separated (default 1440)
 *     --concurrency <n>    parallel browser contexts (default 1 — one live page at a time; raise
 *                          it only on an origin known to have no bot management)
 *     --max-pages <n>      cap the page list (default: every page — the census is site-wide)
 *     --timeout-ms <ms>    per-page navigation timeout (default 20000)
 *     --ua <string>        user agent (default: the real-Chrome desktop UA the recipe's browser
 *                          configuration calls for — the same value the live-session helper uses)
 *     --dismiss <sel,…>    extra overlay-dismiss selectors (live side; clicked once each)
 *     --headed             headed stealth real Chrome (escalation for bot-managed sites)
 *     --locale <tag>       pin Accept-Language + context locale (e.g. en-GB) for geo determinism
 *
 * Per page and width: a LIVE origin opens through the shared live-session helper exactly as
 * stitch-shot / chrome-parity open it — real-Chrome UA plus the standard request headers,
 * navigator.webdriver spoof, bot-challenge detection (an edge interstitial is never censused as
 * the site), then both overlay classes dismissed (cookie consent clicked, timed marketing
 * modals closed). A localhost URL is a plain page from the same browser. Then a bounded settle
 * (≤ 2.5 s, shorter once fonts are ready and the network is quiet), this script's generic
 * consent dismissal as a second pass (accept/agree/allow/got-it buttons inside dialog / cookie /
 * consent containers, open shadow roots included — multilingual labels the shared list lacks),
 * then the census. Any fixed/sticky element still covering > 40 % of the viewport is excluded
 * with its descendants, so an undismissed overlay never enters the palette. Hover states are
 * read after a real pointer hover (first 4 buttons, first 3 links) with transitions zeroed.
 *
 * Writes (nothing else):
 *   <out>   { _provenance: { writtenBy, writtenAt, readArtifacts[], widths[], synthesizedInputs: [],
 *                            failed[] },
 *             pages: { [url]: { [width]: { headings[], text[], buttons[], links[], surfaces[],
 *                                          radii[], shadows[], gradients[], bgColors[], textColors[],
 *                                          borderColors[], customProps, fonts[], logoCandidates[],
 *                                          iconFont, occluders[], consent } } },
 *             aggregate: { colors[], type, motifs, hover[], logo, iconFont, counts } }
 *           `aggregate` is null when no page could be measured.
 *
 * Output: one progress line per page on stderr; the summary on stdout
 * (`style-census: N pages × W widths → <out>`, plus the failure count when any).
 * Exit codes: 0 done (partial evidence is evidence — failures are listed under
 * _provenance.failed[]), 1 every page failed, 2 usage error, playwright not importable or
 * live-session.mjs not found, 3 bot challenge — the live origin served an edge interstitial:
 * the pass stops scheduling pages, what was measured is still written, and the run fails loud
 * (escalate with --headed; if still blocked the site needs crawl.mjs-class capture).
 *
 * Needs playwright importable from the script's location and the diff skill's
 * live-session.mjs in one of the known layouts — the plugin tree (../../diff/scripts/
 * live-session.mjs), the project copy (../diff/live-session.mjs) or a sibling copy
 * (./live-session.mjs) — extract/SKILL.md § Setup: copy the script (and live-session.mjs) into
 * the project's stardust/scripts/ and run the copy. `aggregate` is exported and pure — the
 * contract test runs it without a browser.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

// Current stable desktop Chrome on macOS — the platform token and minor version are frozen by
// Chrome's UA reduction, so only the major matters.
export const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
export const DEFAULTS = { pages: 'stardust/current/pages', out: 'stardust/current/_computed-styles.json', widths: [1440], concurrency: 1, maxPages: Infinity, timeoutMs: 20000, ua: DEFAULT_UA, dismiss: [], headed: false, locale: null };
const SETTLE_MS = 2500;
const VIEWPORT_H = 900;
const OCCLUDER_COVERAGE = 0.4;

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }

const HERE = dirname(fileURLToPath(import.meta.url));
// live-session.mjs lives in the diff skill's scripts dir. Layouts: the plugin tree
// (skills/extract/scripts ↔ skills/diff/scripts), the project copy (scripts/extract ↔ scripts/diff)
// and a flat project copy (a sibling) — resolve any, so a re-copy can't silently sever the hardening.
// Resolved lazily (in main) so the pure exports stay importable without it.
const LIVE_SESSION_CANDIDATES = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs', './live-session.mjs'];
async function loadLiveSession() {
  const found = LIVE_SESSION_CANDIDATES.map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new UsageError('live-session.mjs not found (looked in ../../diff/scripts/, ../diff/ and ./). Copy the diff skill\'s live-session.mjs alongside this script (extract/SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, widths: [], dismiss: [], urls: null, pagesGiven: false };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag.
  const need = (i, k) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${k} needs a value`); return argv[i + 1]; };
  const int = (v, k, min = 1) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new UsageError(`${k} needs an integer ≥ ${min}, got "${v}"`); return n; };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--pages') { o.pages = need(i, k); o.pagesGiven = true; i += 1; }
    else if (k === '--urls') { o.urls = need(i, k).split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (k === '--out') { o.out = need(i, k); i += 1; }
    else if (k === '--width') { for (const w of need(i, k).split(',')) o.widths.push(int(w.trim(), k, 240)); i += 1; }
    else if (k === '--concurrency') { o.concurrency = int(need(i, k), k); i += 1; }
    else if (k === '--max-pages') { o.maxPages = int(need(i, k), k); i += 1; }
    else if (k === '--timeout-ms') { o.timeoutMs = int(need(i, k), k, 1000); i += 1; }
    else if (k === '--ua') { o.ua = need(i, k); i += 1; }
    else if (k === '--dismiss') { o.dismiss.push(...need(i, k).split(',').map((s) => s.trim()).filter(Boolean)); i += 1; }
    else if (k === '--headed') { o.headed = true; }
    else if (k === '--locale') { o.locale = need(i, k); i += 1; }
    else throw new UsageError(`unknown argument ${k}`);
  }
  if (!o.widths.length) o.widths = [...DEFAULTS.widths];
  o.widths = [...new Set(o.widths)];
  if (o.urls && o.pagesGiven) throw new UsageError('pass --pages or --urls, not both');
  if (o.urls && !o.urls.length) throw new UsageError('--urls lists no URL');
  return o;
}

// The page list: --urls verbatim, or every *.json record under --pages (finalUrl, else url),
// deduplicated in file-name order so a re-run measures the same list in the same order.
export function listUrls(o) {
  let urls;
  if (o.urls) urls = o.urls;
  else {
    if (!existsSync(o.pages) || !statSync(o.pages).isDirectory()) throw new UsageError(`--pages ${o.pages} is not a directory (run the crawl first, or pass --urls)`);
    urls = [];
    for (const f of readdirSync(o.pages).filter((n) => n.endsWith('.json')).sort()) {
      try { const rec = JSON.parse(readFileSync(join(o.pages, f), 'utf8')); const u = rec.finalUrl || rec.url; if (typeof u === 'string' && /^https?:/.test(u)) urls.push(u); } catch { /* not a page record */ }
    }
    if (!urls.length) throw new UsageError(`no page record with a url under ${o.pages}`);
  }
  for (const u of urls) { try { new URL(u); } catch { throw new UsageError(`not a URL: ${u}`); } }
  return [...new Set(urls)].slice(0, o.maxPages);
}

// ---- browser side ------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bounded settle after domcontentloaded: done when fonts are ready AND the network went quiet,
// or at the deadline — whichever is first. A live page's analytics beacons may never go idle.
async function settle(page, maxMs) {
  const fonts = page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => true);
  const quiet = page.waitForLoadState('networkidle', { timeout: maxMs }).catch(() => true);
  await Promise.race([Promise.all([fonts, quiet]), sleep(maxMs)]);
}

// Generic consent dismissal: a short accept-like label on a button inside a dialog / cookie /
// consent container (open shadow roots included), or inside any fixed/sticky container. Clicked
// once; the label is recorded. Never removes DOM — the page settles as a real visit does.
function dismissConsentInPage() {
  const LABEL = /^(accept( all)?( cookies)?|accept and close|i accept|agree|i agree|allow( all)?( cookies)?|got it|ok(ay)?|understood|alle akzeptieren|akzeptieren|zustimmen|accepter|tout accepter|aceptar( todo)?|accetta( tutto)?)$/i;
  const CONTAINER = /cookie|consent|gdpr|privacy|banner/i;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const roots = [document];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  const inContainer = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null)) {
      if (n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true') return true;
      if (CONTAINER.test(`${n.id} ${n.className && n.className.baseVal === undefined ? n.className : ''}`)) return true;
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    }
    return false;
  };
  for (const root of roots) {
    for (const el of root.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')) {
      const t = norm(el.tagName === 'INPUT' ? el.value : el.textContent || el.getAttribute('aria-label'));
      if (!t || t.length > 32 || !LABEL.test(t)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      if (!inContainer(el)) continue;
      el.click();
      return t;
    }
  }
  return null;
}

// ---- the census, run in-page (generic selectors only — never a site's class names) -------------
function census({ coverage }) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const alpha = (c) => { const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/.exec(c || '') || /\/\s*([\d.%]+)\s*\)/.exec(c || ''); if (!m) return c && c !== 'transparent' ? 1 : 0; if (m[1] === undefined) return 1; return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]); };
  const painted = (c) => alpha(c) > 0;
  // Occluders: fixed/sticky elements still covering > coverage of the viewport (an undismissed
  // overlay, its backdrop) — excluded with every descendant from every census below.
  const excluded = new Set();
  const occluders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (excluded.has(el) || el === document.body) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)); const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const share = (ix * iy) / (vw * vh);
    if (share <= coverage) continue;
    occluders.push({ tag: el.tagName.toLowerCase(), id: el.id || null, class: cut(norm(typeof el.className === 'string' ? el.className : ''), 80), coverage: +share.toFixed(2), backgroundColor: cs.backgroundColor });
    excluded.add(el);
    for (const d of el.querySelectorAll('*')) excluded.add(d);
  }
  const vis = (el) => {
    if (!el || el.nodeType !== 1 || excluded.has(el)) return false;
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && r.bottom > -2000 && r.right > -2000;
  };
  // A short CSS path anchored at the nearest landmark or clean id: `main > section:nth-of-type(2) > h2`.
  const LANDMARK = new Set(['main', 'header', 'footer', 'nav', 'body']);
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 8; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n.id && /^[A-Za-z][\w-]{0,40}$/.test(n.id) && !/\d{3,}/.test(n.id)) { parts.unshift(`#${n.id}`); break; }
      let part = tag;
      const p = n.parentElement;
      if (p && !LANDMARK.has(tag)) { const sibs = [...p.children].filter((c) => c.tagName === n.tagName); if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(n) + 1})`; }
      parts.unshift(part);
      if (LANDMARK.has(tag)) break;
    }
    return parts.join(' > ');
  };
  const TYPE = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'color'];
  const typeOf = (cs) => { const o = {}; for (const k of TYPE) o[k] = cs[k]; return o; };
  const text = (el) => norm(el.tagName === 'INPUT' ? el.value : el.textContent);

  // headings (visible, capped — a long document page still yields every level)
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).slice(0, 80)
    .map((h) => ({ tag: h.tagName.toLowerCase(), text: cut(text(h), 40), selector: cssPath(h), ...typeOf(getComputedStyle(h)) })).filter((h) => h.text);
  // body text: main p/li, else body p
  const main = document.querySelector('main');
  let textEls = main ? [...main.querySelectorAll('p, li')] : [];
  if (!textEls.length) textEls = [...document.body.querySelectorAll('p')];
  const textRows = textEls.filter((p) => vis(p) && text(p).length > 20).slice(0, 12)
    .map((p) => ({ tag: p.tagName.toLowerCase(), text: cut(text(p), 40), selector: cssPath(p), ...typeOf(getComputedStyle(p)) }));
  // buttons: things that LOOK like buttons — painted background or a border, horizontal padding ≥ 8, short text
  const hasBorder = (cs) => ['Top', 'Right', 'Bottom', 'Left'].some((s) => cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) > 0 && painted(cs[`border${s}Color`]));
  const buttonEls = new Set();
  const buttons = [];
  const seenButton = new Map();
  let hoverN = 0;
  for (const el of document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')) {
    if (!vis(el)) continue;
    const t = text(el) || norm(el.getAttribute('aria-label'));
    if (!t || t.length > 40) continue;
    const cs = getComputedStyle(el);
    if (!painted(cs.backgroundColor) && !hasBorder(cs)) continue;
    if (Math.min(parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)) < 8) continue;
    buttonEls.add(el);
    const sig = [cs.backgroundColor, cs.color, cs.borderRadius, cs.border, cs.fontSize, cs.fontWeight].join('|');
    if (seenButton.has(sig)) { seenButton.get(sig).count += 1; continue; }
    if (buttons.length >= 12) continue;
    const row = { text: t, selector: cssPath(el), count: 1, backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, padding: cs.padding, border: cs.border, borderColor: cs.borderColor, boxShadow: cs.boxShadow, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, hover: null };
    if (hoverN < 4) { hoverN += 1; row.hoverId = `b${hoverN}`; el.setAttribute('data-sc-hover', row.hoverId); }
    seenButton.set(sig, row);
    buttons.push(row);
  }
  // links: in-copy anchors that are not buttons
  const links = [];
  const seenLink = new Map();
  let linkHoverN = 0;
  for (const a of (main || document.body).querySelectorAll('a[href]')) {
    if (buttonEls.has(a) || !vis(a)) continue;
    const t = text(a);
    if (!t) continue;
    const cs = getComputedStyle(a);
    const sig = [cs.color, cs.textDecorationLine, cs.fontWeight].join('|');
    if (seenLink.has(sig)) { seenLink.get(sig).count += 1; continue; }
    if (links.length >= 8) continue;
    const row = { text: cut(t, 40), selector: cssPath(a), count: 1, color: cs.color, textDecoration: cs.textDecorationLine, fontWeight: cs.fontWeight, hover: null };
    if (linkHoverN < 3) { linkHoverN += 1; row.hoverId = `l${linkHoverN}`; a.setAttribute('data-sc-hover', row.hoverId); }
    seenLink.set(sig, row);
    links.push(row);
  }
  // surfaces: the landmarks and main's direct children
  const surfaces = [];
  const surfaceSeen = new Set();
  for (const sel of ['header', 'nav', 'main', 'footer', '[role="banner"]', '[role="contentinfo"]', 'main > *']) {
    let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      if (n >= 4) break;
      if (surfaceSeen.has(el) || !vis(el)) continue;
      surfaceSeen.add(el); n += 1;
      const cs = getComputedStyle(el);
      surfaces.push({ matched: sel, selector: cssPath(el), rect: rectOf(el), backgroundColor: cs.backgroundColor, color: cs.color, padding: cs.padding, maxWidth: cs.maxWidth, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, position: cs.position, fontFamily: cs.fontFamily, fontSize: cs.fontSize });
    }
  }
  // histograms over every visible element: value → count (+ summed area for radii and backgrounds), 3 sample selectors each
  const hist = () => new Map();
  const bump = (map, value, el, area) => {
    if (!value) return;
    const row = map.get(value) || { value, count: 0, area: 0, sources: [] };
    row.count += 1; row.area += area || 0;
    if (row.sources.length < 3) row.sources.push(cssPath(el));
    map.set(value, row);
  };
  const radii = hist(); const shadows = hist(); const gradients = hist(); const bgColors = hist(); const textColors = hist(); const borderColors = hist();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'G', 'USE', 'DEFS', 'CLIPPATH', 'LINEARGRADIENT', 'STOP', 'BR']);
  let visibleCount = 0;
  const all = [document.documentElement, document.body, ...document.body.querySelectorAll('*')]; // querySelectorAll('*') excludes body itself — the page's own background
  for (const el of all) {
    if (SKIP.has(el.tagName.toUpperCase()) || !vis(el)) continue;
    visibleCount += 1;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect(); const area = Math.round(r.width * r.height);
    if (cs.borderRadius && cs.borderRadius !== '0px') bump(radii, cs.borderRadius, el, area);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadows, cut(cs.boxShadow, 200), el);
    if (cs.backgroundImage && cs.backgroundImage.includes('gradient(')) bump(gradients, cut(cs.backgroundImage, 240), el, area);
    if (painted(cs.backgroundColor)) bump(bgColors, cs.backgroundColor, el, area);
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) bump(textColors, cs.color, el);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) > 0 && painted(cs[`border${s}Color`])) { bump(borderColors, cs[`border${s}Color`], el); break; }
  }
  const top = (map, n) => [...map.values()].sort((a, b) => b.count - a.count || b.area - a.area || (a.value < b.value ? -1 : 1)).slice(0, n).map((row) => ({ ...row, area: row.area || undefined }));
  // custom properties: names declared on :root/html rules (cross-origin sheets skipped), values as computed on <html>
  const propNames = new Map();
  const walk = (rules) => { for (const rule of rules || []) { try { if (rule.styleSheet) walk(rule.styleSheet.cssRules); else if (rule.style && rule.selectorText && rule.selectorText.split(',').some((s) => /^\s*(:root|html)\s*$/.test(s))) { for (const p of rule.style) if (p.startsWith('--')) propNames.set(p, rule.style.getPropertyValue(p).trim()); } if (rule.cssRules && !rule.styleSheet) walk(rule.cssRules); } catch { /* cross-origin */ } } };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ } }
  for (const p of document.documentElement.style) if (p.startsWith('--')) propNames.set(p, document.documentElement.style.getPropertyValue(p).trim());
  const rootStyle = getComputedStyle(document.documentElement);
  const customProps = {};
  for (const [name, declared] of [...propNames.entries()].slice(0, 300)) customProps[name] = { declared, computed: rootStyle.getPropertyValue(name).trim() };
  // loaded fonts
  const fontSeen = new Set(); const fonts = [];
  for (const f of document.fonts ? [...document.fonts] : []) { const row = { family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, status: f.status }; const k = JSON.stringify(row); if (!fontSeen.has(k)) { fontSeen.add(k); fonts.push(row); } }
  // logo candidates in the header band: images, inline svg, and whatever sits inside a home link
  const logoCandidates = []; const logoSeen = new Set();
  const homeLinks = [...document.querySelectorAll('a[href="/"], a[href$="index.html"], a[aria-label*="home" i]')];
  const inHome = (el) => homeLinks.some((a) => a.contains(el));
  for (const scope of document.querySelectorAll('header, [role="banner"], nav')) {
    for (const el of scope.querySelectorAll('img, svg')) {
      if (logoSeen.has(el) || logoCandidates.length >= 12 || !vis(el) || el.closest('svg') !== (el.tagName.toLowerCase() === 'svg' ? el : null)) continue;
      logoSeen.add(el);
      const tag = el.tagName.toLowerCase();
      const link = el.closest('a');
      logoCandidates.push({ tag, selector: cssPath(el), src: tag === 'img' ? (el.currentSrc || el.src || null) : null, inlineSvg: tag === 'svg', hasText: tag === 'svg' ? !!el.querySelector('text') : undefined, viewBox: tag === 'svg' ? el.getAttribute('viewBox') : undefined, alt: tag === 'img' ? el.alt || '' : undefined, ariaLabel: el.getAttribute('aria-label') || (link && link.getAttribute('aria-label')) || null, class: cut(norm(typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''), 80), id: el.id || null, href: link ? link.getAttribute('href') : null, inHomeLink: inHome(el), rect: rectOf(el) });
    }
  }
  // icon font: icon-like loaded families + private-use-area pseudo-element glyphs with their class
  const iconFamilies = fonts.map((f) => f.family).filter((f, i, a) => /icon|glyph|symbol|awesome|icomoon|fontello/i.test(f) && a.indexOf(f) === i);
  const glyphs = []; const glyphSeen = new Set();
  for (const el of document.body.querySelectorAll('[class], [data-icon]')) {
    if (glyphs.length >= 20) break;
    if (excluded.has(el)) continue;
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      const m = /^"(.)"$/.exec(ps.content || '');
      if (!m) continue;
      const cp = m[1].codePointAt(0);
      if (cp < 0xE000 || cp > 0xF8FF) continue;
      const cls = cut(norm(typeof el.className === 'string' ? el.className : ''), 80);
      const key = `${cls}|${cp}`;
      if (glyphSeen.has(key)) continue;
      glyphSeen.add(key);
      glyphs.push({ class: cls, pseudo, codepoint: `U+${cp.toString(16).toUpperCase()}`, fontFamily: ps.fontFamily });
    }
  }
  const iconFont = iconFamilies.length || glyphs.length ? { families: iconFamilies, glyphs } : null;
  return {
    title: document.title || null, viewport: { width: vw, height: vh }, elements: { total: all.length, visible: visibleCount }, occluders,
    headings, text: textRows, buttons, links, surfaces,
    radii: top(radii, 40), shadows: top(shadows, 40), gradients: top(gradients, 40), bgColors: top(bgColors, 60), textColors: top(textColors, 60), borderColors: top(borderColors, 40),
    customProps, fonts, logoCandidates, iconFont,
  };
}

// Hover pass: the census tagged its hover targets with data-sc-hover; hover each with a real
// pointer (transitions zeroed first) and read the four properties a hover style changes.
async function hoverPass(page, rec) {
  const targets = [...rec.buttons.filter((b) => b.hoverId), ...rec.links.filter((l) => l.hoverId)];
  if (!targets.length) return;
  await page.addStyleTag({ content: '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important;animation-delay:0s!important}' }).catch(() => {});
  for (const t of targets) {
    t.hover = null;
    try {
      const loc = page.locator(`[data-sc-hover="${t.hoverId}"]`).first();
      await loc.hover({ timeout: 1500 });
      await sleep(60);
      t.hover = await loc.evaluate((el) => { const cs = getComputedStyle(el); return { backgroundColor: cs.backgroundColor, color: cs.color, borderColor: cs.borderColor, boxShadow: cs.boxShadow }; });
      if (t.hover && t.hover.backgroundColor === t.backgroundColor && t.hover.color === t.color && t.hover.borderColor === (t.borderColor || t.hover.borderColor) && t.hover.boxShadow === (t.boxShadow || t.hover.boxShadow)) t.hover.changed = false;
      else if (t.hover) t.hover.changed = true;
    } catch { t.hover = null; }
    delete t.hoverId;
  }
  await page.mouse.move(0, VIEWPORT_H - 1).catch(() => {});
}

// One page at one width. `contexts` holds the worker's two contexts: `live` (live-session:
// UA + standard headers + webdriver spoof) for any live origin, `local` (plain) for localhost.
// A live page navigates through gotoLive — a bot challenge throws BotChallengeError (never
// censused as the site; solveWindow only under --headed) — then dismissOverlays closes consent
// and timed marketing modals before this script's own multilingual consent pass.
async function measure(contexts, url, width, o, session) {
  const live = session.isLiveHttpUrl(url);
  const page = await (live ? contexts.live : contexts.local).newPage();
  try {
    await page.setViewportSize({ width, height: VIEWPORT_H });
    let resp;
    if (live) {
      resp = await session.gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: o.timeoutMs, settleMs: 0, solveWindow: o.headed });
    } else {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: o.timeoutMs });
      if (!resp) throw new Error('no response');
      if (resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    }
    const ct = resp.headers()['content-type'] || '';
    if (ct && !/text\/html|application\/xhtml/.test(ct)) throw new Error(`content-type ${ct}`);
    await settle(page, SETTLE_MS);
    let overlays = null;
    if (live) overlays = await session.dismissOverlays(page, { extra: o.dismiss, lateWindowMs: 6000 }).catch(() => null);
    const consent = await page.evaluate(dismissConsentInPage).catch(() => null) || (overlays && overlays.consent) || null;
    if (consent) await sleep(400);
    // a quick scroll pass so lazily revealed sections reach their final styles before the census
    for (const f of [0.25, 0.5, 0.75, 1]) { await page.evaluate((y) => window.scrollTo(0, document.documentElement.scrollHeight * y), f); await sleep(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    const rec = await page.evaluate(census, { coverage: OCCLUDER_COVERAGE });
    await hoverPass(page, rec);
    rec.consent = { dismissed: consent };
    rec.finalUrl = page.url();
    return rec;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(argv) {
  const o = parseArgs(argv);
  const urls = listUrls(o);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new UsageError(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} (${e.code || e.message}) — extract/SKILL.md § Setup: copy this script into the project's stardust/scripts/ and run the copy`);
  }
  const session = await loadLiveSession();
  const jobs = [];
  for (const url of urls) for (const width of o.widths) jobs.push({ url, width });
  const pages = {};
  const failed = [];
  // --headed: the stealth real-Chrome escalation tier from live-session; otherwise plain headless.
  const browser = o.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch({ headless: true });
  let next = 0;
  let challenge = null;
  async function worker() {
    const viewport = { width: o.widths[0], height: VIEWPORT_H };
    const common = { reducedMotion: 'reduce', colorScheme: 'light', ignoreHTTPSErrors: true };
    const contexts = {
      live: await session.newLiveContext(browser, { ua: o.ua, locale: o.locale, viewport, ...common }),
      local: await browser.newContext({ userAgent: o.ua, viewport, locale: 'en-US', ...common }),
    };
    while (next < jobs.length) {
      const { url, width } = jobs[next];
      next += 1;
      const t0 = Date.now();
      try {
        const rec = await measure(contexts, url, width, o, session);
        pages[url] = pages[url] || {};
        pages[url][width] = rec;
        console.error(`[style-census] OK   ${url} @${width}  headings=${rec.headings.length} text=${rec.text.length} buttons=${rec.buttons.length} bg=${rec.bgColors.length} radii=${rec.radii.length}${rec.occluders.length ? ` occluders=${rec.occluders.length}` : ''}${rec.consent.dismissed ? ` consent="${rec.consent.dismissed}"` : ''}  ${Date.now() - t0}ms`);
      } catch (e) {
        failed.push({ url, width, error: String(e.message || e).split('\n')[0].slice(0, 200) });
        console.error(`[style-census] FAIL ${url} @${width}  ${failed.at(-1).error}`);
        // A bot challenge stops the pass: every further hit spends the origin's block budget, and
        // an interstitial must never be censused as the site. Partial evidence is still written.
        if (e.name === 'BotChallengeError' && !challenge) { challenge = e; next = jobs.length; }
      }
    }
    await contexts.live.close().catch(() => {});
    await contexts.local.close().catch(() => {});
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency, jobs.length) }, worker));
  await browser.close();

  const measured = Object.values(pages).reduce((n, byWidth) => n + Object.keys(byWidth).length, 0);
  const out = {
    _provenance: { writtenBy: 'stardust:extract', writtenAt: new Date().toISOString(), script: 'style-census.mjs', readArtifacts: urls, widths: o.widths, userAgent: o.ua, synthesizedInputs: [], failed },
    pages,
    aggregate: measured ? aggregate(pages) : null,
  };
  mkdirSync(dirname(o.out) || '.', { recursive: true });
  writeFileSync(o.out, JSON.stringify(out, null, 2));
  console.log(`style-census: ${Object.keys(pages).length} pages × ${o.widths.length} widths → ${o.out}${failed.length ? ` (${failed.length} of ${jobs.length} measurements failed — see _provenance.failed)` : ''}`);
  if (challenge) {
    console.error(`style-census: ${challenge.message}`);
    return 3;
  }
  return measured ? 0 : 1;
}

// ---- aggregate: pure and deterministic (exported for the contract test) ---------------------------
export const CLUSTER_DISTANCE = 12;

// rgb()/rgba() (Chrome's computed form) and color(srgb …); alpha 0 → null (not a colour).
export function parseColor(s) {
  if (!s || typeof s !== 'string') return null;
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s.trim());
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return a > 0 ? { r: +m[1], g: +m[2], b: +m[3], a } : null; }
  m = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(s.trim());
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return a > 0 ? { r: +m[1], g: +m[2], b: +m[3], a } : null; }
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(s.trim());
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return a > 0 ? { r: Math.round(+m[1] * 255), g: Math.round(+m[2] * 255), b: Math.round(+m[3] * 255), a } : null; }
  return null;
}
export function toHex({ r, g, b, a = 1 }) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}
const colorDistance = (p, q) => Math.max(Math.abs(p.r - q.r), Math.abs(p.g - q.g), Math.abs(p.b - q.b), Math.abs(p.a - q.a) * 255);

// Greedy clustering: samples sorted heaviest-first join the first cluster within CLUSTER_DISTANCE
// of its representative (the heaviest member), else open one. Sorting makes the result independent
// of input order. sample = { value, weight, prop, area, url, selector }.
export function clusterColors(samples) {
  const parsed = samples.map((s) => ({ ...s, rgb: parseColor(s.value) })).filter((s) => s.rgb);
  const cmp = (x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0);
  parsed.sort((a, b) => b.weight - a.weight || (b.area || 0) - (a.area || 0) || cmp(a.value, b.value) || cmp(a.prop, b.prop) || cmp(a.url, b.url) || cmp(a.selector, b.selector));
  const clusters = [];
  for (const s of parsed) {
    let c = clusters.find((k) => colorDistance(k.rgb, s.rgb) <= CLUSTER_DISTANCE);
    if (!c) { c = { hex: toHex(s.rgb), rgb: s.rgb, values: [], weight: 0, bgArea: 0, by: {}, roles: [], sources: [] }; clusters.push(c); }
    if (!c.values.includes(s.value)) c.values.push(s.value);
    c.weight += s.weight;
    c.by[s.prop] = (c.by[s.prop] || 0) + s.weight;
    if (s.prop === 'background') c.bgArea += s.area || 0;
    if (c.sources.length < 5 && s.url && !c.sources.some((x) => x.url === s.url && x.selector === s.selector && x.prop === s.prop)) c.sources.push({ url: s.url, selector: s.selector, prop: s.prop });
  }
  return clusters;
}

const family = (stack) => (stack || '').split(',')[0].replace(/["']/g, '').trim();
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const byCount = (a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
const sortedKeys = (o) => Object.keys(o || {}).sort();
// every (url, width, record) triple, urls and widths sorted so the aggregate never depends on capture order
function* records(pages) {
  for (const url of sortedKeys(pages)) for (const width of sortedKeys(pages[url]).map(Number).sort((a, b) => a - b)) if (pages[url][width]) yield { url, width, rec: pages[url][width] };
}

function aggregateColors(pages) {
  const samples = [];
  for (const { url, rec } of records(pages)) {
    const add = (rows, prop, weightOf) => { for (const row of rows || []) samples.push({ value: row.value, weight: weightOf(row), area: row.area || 0, prop, url, selector: (row.sources || [])[0] || null }); };
    add(rec.bgColors, 'background', (r) => r.count);
    add(rec.textColors, 'text', (r) => r.count);
    add(rec.borderColors, 'border', (r) => r.count);
    for (const b of rec.buttons || []) {
      samples.push({ value: b.backgroundColor, weight: b.count || 1, prop: 'button-background', url, selector: b.selector });
      samples.push({ value: b.color, weight: b.count || 1, prop: 'button-text', url, selector: b.selector });
      if (b.borderColor && b.border && !/none|0px/.test(b.border.split(' ')[1] || '') ) samples.push({ value: b.borderColor, weight: b.count || 1, prop: 'button-border', url, selector: b.selector });
    }
    for (const l of rec.links || []) samples.push({ value: l.color, weight: l.count || 1, prop: 'link', url, selector: l.selector });
    for (const h of rec.headings || []) samples.push({ value: h.color, weight: 1, prop: 'heading', url, selector: h.selector });
  }
  const clusters = clusterColors(samples);
  const pick = (score, exclude = []) => { const c = clusters.filter((k) => score(k) > 0 && !exclude.includes(k)).sort((a, b) => score(b) - score(a) || b.weight - a.weight || (a.hex < b.hex ? -1 : 1))[0]; return c || null; };
  const role = (c, r) => { if (c && !c.roles.includes(r)) c.roles.push(r); return c; };
  const background = role(pick((c) => c.bgArea), 'background');
  const surface = role(pick((c) => c.bgArea, [background]), 'surface');
  const text = role(pick((c) => c.by.text || 0), 'text');
  const primary = role(pick((c) => c.by['button-background'] || 0, [background]), 'primary');
  const secondary = role(pick((c) => c.by['button-background'] || 0, [background, primary]), 'secondary');
  const accent = role(pick((c) => (c.by.link || 0) + (c.by['button-border'] || 0), [background, surface, text, primary, secondary]), 'accent');
  role(pick((c) => c.by.border || 0), 'border');
  role(pick((c) => c.by.heading || 0), 'heading');
  void accent;
  return clusters.sort((a, b) => (b.roles.length ? 1 : 0) - (a.roles.length ? 1 : 0) || b.weight - a.weight || (a.hex < b.hex ? -1 : 1))
    .map(({ rgb, ...c }) => ({ ...c, bgArea: c.bgArea || undefined }));
}

function aggregateType(pages) {
  const fam = new Map(); const sizes = new Map(); const weights = new Map(); const levels = {};
  const tally = (map, key, where, n = 1) => { if (key === null || key === undefined || key === '') return; const row = map.get(key) || { value: key, count: 0, headings: 0, text: 0, buttons: 0 }; row.count += n; row[where] += n; map.set(key, row); };
  for (const { rec } of records(pages)) {
    for (const h of rec.headings || []) {
      tally(fam, family(h.fontFamily), 'headings'); tally(sizes, px(h.fontSize), 'headings'); tally(weights, String(h.fontWeight), 'headings');
      const k = `${px(h.fontSize)}|${h.fontWeight}`; const lv = levels[h.tag] = levels[h.tag] || new Map();
      const row = lv.get(k) || { fontSize: px(h.fontSize), fontWeight: String(h.fontWeight), count: 0 }; row.count += 1; lv.set(k, row);
    }
    for (const t of rec.text || []) { tally(fam, family(t.fontFamily), 'text'); tally(sizes, px(t.fontSize), 'text'); tally(weights, String(t.fontWeight), 'text'); }
    for (const b of rec.buttons || []) { tally(fam, family(b.fontFamily), 'buttons', b.count || 1); tally(sizes, px(b.fontSize), 'buttons', b.count || 1); tally(weights, String(b.fontWeight), 'buttons', b.count || 1); }
  }
  const families = [...fam.values()].map(({ value, ...r }) => ({ family: value, ...r })).sort((a, b) => b.count - a.count || (a.family < b.family ? -1 : 1));
  const headingFamily = [...families].sort((a, b) => b.headings - a.headings || b.count - a.count)[0];
  const bodyFamily = [...families].sort((a, b) => b.text - a.text || b.count - a.count)[0];
  // per level: the brand-surface weighted score pixelSize × (weight/400) × √count picks the visually dominant variant
  const perLevel = {};
  for (const tag of Object.keys(levels).sort()) {
    const best = [...levels[tag].values()].map((r) => ({ ...r, score: Math.round(r.fontSize * (parseInt(r.fontWeight, 10) / 400 || 1) * Math.sqrt(r.count) * 100) / 100 })).sort((a, b) => b.score - a.score || b.fontSize - a.fontSize)[0];
    perLevel[tag] = best;
  }
  return {
    families, headingFamily: headingFamily ? headingFamily.family : null, bodyFamily: bodyFamily ? bodyFamily.family : headingFamily ? headingFamily.family : null,
    sizes: [...sizes.values()].map(({ value, ...r }) => ({ px: value, ...r })).sort((a, b) => b.px - a.px),
    weights: [...weights.values()].map(({ value, ...r }) => ({ weight: value, ...r })).sort((a, b) => b.count - a.count || (a.weight < b.weight ? -1 : 1)),
    levels: perLevel,
  };
}

// value histograms merged across pages: count, area, up to 5 { url, selector } sources
function mergeHistograms(pages, key, cap) {
  const map = new Map();
  for (const { url, rec } of records(pages)) {
    for (const row of rec[key] || []) {
      const m = map.get(row.value) || { value: row.value, count: 0, area: 0, sources: [] };
      m.count += row.count || 0; m.area += row.area || 0;
      for (const sel of row.sources || []) if (m.sources.length < 5 && !m.sources.some((s) => s.url === url && s.selector === sel)) m.sources.push({ url, selector: sel });
      map.set(row.value, m);
    }
  }
  return [...map.values()].sort(byCount).slice(0, cap).map((m) => ({ ...m, area: m.area || undefined }));
}

function aggregateMotifs(pages) {
  const radii = mergeHistograms(pages, 'radii', 40);
  const byArea = [...radii].sort((a, b) => (b.area || 0) - (a.area || 0) || byCount(a, b));
  const isPill = (v) => /(^|\s)(9999px|999px|100px|50%)/.test(v) || parseFloat(v) >= 999;
  const mode = radii.find((r) => !isPill(r.value)) || radii[0] || null;
  const areaMode = byArea.find((r) => !isPill(r.value)) || byArea[0] || null;
  return {
    radius: {
      mode: mode ? mode.value : null,
      areaMode: areaMode ? areaMode.value : null,
      pill: (radii.find((r) => isPill(r.value)) || {}).value || null,
      values: radii,
    },
    shadows: mergeHistograms(pages, 'shadows', 40).slice(0, 3),
    gradients: mergeHistograms(pages, 'gradients', 40),
  };
}

// distinct hover deltas of buttons and links: which of the four properties changed, from → to
function aggregateHover(pages) {
  const map = new Map();
  for (const { url, rec } of records(pages)) {
    for (const [kind, rows] of [['button', rec.buttons], ['link', rec.links]]) {
      for (const row of rows || []) {
        if (!row.hover || row.hover.changed === false) continue;
        const from = {}; const to = {};
        for (const p of ['backgroundColor', 'color', 'borderColor', 'boxShadow']) { const base = row[p]; if (base !== undefined && row.hover[p] !== undefined && row.hover[p] !== base) { from[p] = base; to[p] = row.hover[p]; } }
        if (!Object.keys(to).length) continue;
        const key = `${kind}|${JSON.stringify(from)}|${JSON.stringify(to)}`;
        const m = map.get(key) || { kind, from, to, count: 0, sources: [] };
        m.count += 1;
        if (m.sources.length < 5) m.sources.push({ url, selector: row.selector });
        map.set(key, m);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (JSON.stringify(a.to) < JSON.stringify(b.to) ? -1 : 1));
}

// the v1 chain on the collected candidates: inline SVG (not an icon) → logo-ish <img> → none;
// pages ordered home-first (shortest path), widest viewport first, so ties resolve to the landing
// page's desktop record
function aggregateLogo(pages) {
  const LOGOISH = /logo|brand/i;
  const aspectOk = (r) => r.h >= 32 && r.w >= 40 && r.y <= 200 && r.w / r.h >= 0.5 && r.w / r.h <= 3;
  const rank = (c) => Math.abs(c.rect.w / Math.max(1, c.rect.h) - 1.5);
  const ordered = [...records(pages)].sort((a, b) => new URL(a.url).pathname.length - new URL(b.url).pathname.length || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) || b.width - a.width);
  let svg = null; let img = null;
  for (const { url, width, rec } of ordered) {
    for (const c of rec.logoCandidates || []) {
      const hit = { ...c, url, width };
      if (c.inlineSvg && c.rect.w >= 60 && (c.hasText || c.ariaLabel || c.inHomeLink || LOGOISH.test(`${c.class} ${c.id || ''}`))) {
        if (!svg || (c.inHomeLink && !svg.inHomeLink) || (c.inHomeLink === svg.inHomeLink && rank(c) < rank(svg))) svg = hit;
      } else if (c.tag === 'img' && aspectOk(c.rect) && (LOGOISH.test(`${c.alt} ${c.class} ${c.id || ''} ${c.src || ''}`) || c.inHomeLink)) {
        const strong = LOGOISH.test(`${c.alt} ${c.class} ${c.id || ''} ${c.src || ''}`);
        if (!img || (strong && !img.strong) || (strong === !!img.strong && rank(c) < rank(img))) img = { ...hit, strong };
      }
    }
  }
  if (svg) return { source: 'inline-svg', url: svg.url, width: svg.width, selector: svg.selector, rect: svg.rect, ariaLabel: svg.ariaLabel, inHomeLink: svg.inHomeLink };
  if (img) return { source: 'img', url: img.url, width: img.width, selector: img.selector, src: img.src, alt: img.alt, rect: img.rect, inHomeLink: img.inHomeLink };
  return { source: 'none', url: null, selector: null };
}

function aggregateIconFont(pages) {
  const families = new Set(); const glyphs = new Map();
  for (const { url, rec } of records(pages)) {
    if (!rec.iconFont) continue;
    for (const f of rec.iconFont.families || []) families.add(f);
    for (const g of rec.iconFont.glyphs || []) { const k = `${g.class}|${g.codepoint}`; const m = glyphs.get(k) || { ...g, count: 0, sources: [] }; m.count += 1; if (m.sources.length < 3) m.sources.push(url); glyphs.set(k, m); }
  }
  if (!families.size && !glyphs.size) return null;
  return { families: [...families].sort(), glyphs: [...glyphs.values()].sort((a, b) => b.count - a.count || (a.class < b.class ? -1 : 1)).slice(0, 40) };
}

export function aggregate(pages) {
  const all = [...records(pages)];
  return {
    counts: { pages: sortedKeys(pages).length, widths: [...new Set(all.map((r) => r.width))].sort((a, b) => a - b), measurements: all.length },
    colors: aggregateColors(pages),
    type: aggregateType(pages),
    motifs: aggregateMotifs(pages),
    hover: aggregateHover(pages),
    logo: aggregateLogo(pages),
    iconFont: aggregateIconFont(pages),
  };
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`style-census: ${e.message}`);
    process.exitCode = e.code || 1;
  });
}
