#!/usr/bin/env node
/**
 * skills/replica/scripts/chrome-parity.mjs
 *
 * Computed-style parity probe for CHROME (header, footer, sticky strips):
 * the same regions on the live page and on the build/prototype, each region's
 * text-bearing elements paired by their text, and for every pair the rect +
 * the computed style group that decides how chrome reads (family, size,
 * weight, style, line-height, letter-spacing, transform, colour, background,
 * padding, radius) plus the clickable box of links/buttons. Icons (svg / img)
 * are inventoried per region and paired by order.
 *
 * Why: pixels confirm, styles diagnose. On a field run this probe found in
 * ONE pass what pixel-band reading needed many rounds for — an italic-vs-
 * normal note, a regular-vs-bold link, a wrong nav link colour, 12px row
 * offsets, a 97×40 vs 71×32 button, missing icons. Run it BEFORE any pixel
 * iteration on chrome (source-fidelity-gate.md § Pass bar, item 5): fix
 * every delta it prints, re-run until it is quiet, then let crop-compare
 * confirm. It is a diagnostic — the ≥98% crop gate stays the pass bar.
 *
 * Usage:
 *   node skills/replica/scripts/chrome-parity.mjs <liveURL> <buildURL> [options]
 *     --region <name>=<sel>[|<buildSel>]  ADD a region to probe (repeatable; the build
 *                                         selector defaults to the live one).
 *                                         header=header and footer=footer are always
 *                                         probed unless --no-defaults is passed
 *     --no-defaults      probe only the --region list (drop header/footer)
 *     --width <px>       viewport width                        (default 1440)
 *     --tolerance <px>   ignore rect/size deltas ≤ this        (default 1)
 *     --consent <sel>    extra consent-accept selector (live side)
 *     --dismiss <sel,…>  extra overlay-dismiss selectors (live side)
 *     --hide <sel,…>     in-flow per-visitor regions to remove on BOTH sides before
 *                        measuring (repeatable) — e.g. a geo-IP location-suggestion
 *                        bar in flow above the header, which shifts every live chrome
 *                        rect; --dismiss stays for overlays (it cannot remove an
 *                        in-flow bar). After the overlay dismissal and the settle,
 *                        every match gets display:none !important; per side and
 *                        selector its match count and summed height are recorded
 *                        (×0 = a stale selector, an invalid one is an error entry)
 *     --presence <file> --slug <slug>
 *                        the same for the slug's "variable" regions in gate-all's
 *                        presence.json (stardust/replica/gates/{all,prototypes}-<w>/):
 *                        { "<slug>": { "variable": ["<sel>[=<buildSel>]", …] } } — the
 *                        live side hides <sel>, the build side <buildSel> or <sel>;
 *                        "main" is ignored; a missing file or slug hides nothing
 *     --headed           headed stealth real Chrome (bot-managed live sites)
 *     --locale <tag>     pin Accept-Language + locale (e.g. en-GB)
 *     --json             machine-readable output
 *     --live-cache <f>   reuse the live side's measurement from <f> (JSON) when it
 *                        exists for the same URL, width, region selectors and live
 *                        hide list (keyed only when non-empty); probe
 *                        and write it otherwise. Same contract as gate.sh's live.png:
 *                        one live navigation per breakpoint per full gate run, delete
 *                        the file to re-probe. Convention:
 *                        stardust/replica/gates/<slug>-<w>/chrome-live.json
 *
 * Example:
 *   node stardust/scripts/replica/chrome-parity.mjs "https://<site>/" "http://localhost:8791/home-proposed.html" \
 *     --region header=header --region strip=".quick-links|.quicklinks" --region footer=footer
 *
 * Output: after the live/build lines, `hidden live:` / `hidden build:` lines
 * (`<sel> ×<n> (<h>px) [--hide|presence.json]`) when a hide list is set, and
 * one `presence:` line with --presence; --json carries `hidden: { live, build }`
 * (entries { sel, source, n, h, error? }) and `presence: { file, slug, regions,
 * note } | null`. Per region: the region box delta, then one line per paired element
 * listing only the properties that differ, then MISSING (live-only) / EXTRA
 * (build-only) texts and the icon inventory. Exit 0 = parity within tolerance,
 * 2 = deltas printed (fix them, re-run), 1 = error, 3 = bot challenge on the
 * live side (fail loud — never measured).
 *
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both); both are imported
 * inside main(), so --help and the exported pure functions (parseArgs,
 * readPresence, hideLists, cacheKey, compareRegion) need neither. Each run is one live
 * navigation — budget it like any live probe; --json records both sides as
 * the round's evidence.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
async function loadLiveSession() {
  const found = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new Error('live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

/** A usage error: the CLI prints the message and the usage text, exit 1. */
export class UsageError extends Error { constructor(msg) { super(msg); this.code = 1; } }

const HELP = `chrome-parity — computed-style + rect diff of matched chrome elements (live vs build)

Usage: node chrome-parity.mjs <liveURL> <buildURL> [options]
  --region <name>=<sel>[|<buildSel>]  add a region (repeatable); header + footer are always probed
  --no-defaults      probe only the --region list (drop header/footer)
  --width <px>       viewport width (default 1440)
  --tolerance <px>   ignore rect/size deltas ≤ this (default 1)
  --consent <sel>    extra consent-accept selector (live side)
  --dismiss <sel,…>  extra overlay-dismiss selectors (live side) — overlays only
  --hide <sel,…>     hide in-flow per-visitor regions (a location-suggestion bar above the header) on
                     BOTH sides after the settle, before measuring (repeatable; count + height printed)
  --presence <file> --slug <slug>
                     hide the slug's "variable" regions from gate-all's presence.json the same way
                     (stardust/replica/gates/{all,prototypes}-<w>/; "<sel>=<buildSel>" halves)
  --headed           headed stealth real Chrome (bot-managed live sites)
  --locale <tag>     pin Accept-Language + locale
  --json             machine-readable output
  --live-cache <f>   reuse/write the live side's measurement (JSON) — one live hit per breakpoint
  --help             this text

Exit codes: 0 parity within tolerance, 2 deltas printed, 1 error, 3 bot challenge (live side).`;

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const need = (v, msg) => { if (!v || v.startsWith('--')) throw new UsageError(msg); return v; };

/** argv after the script path → { live, build, opts }; throws UsageError. --help is answered by main() before this. */
export function parseArgs(rest) {
  const pos = [];
  const opts = { regions: [], noDefaults: false, width: 1440, tolerance: 1, consent: null, dismiss: [], hide: [], presence: null, slug: null, headed: false, locale: null, json: false, liveCache: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--region') {
      const spec = rest[i += 1] || '';
      const m = spec.match(/^([\w-]+)=([^|]+)(?:\|(.+))?$/);
      if (!m) throw new UsageError(`bad --region "${spec}" — expected name=<liveSel>[|<buildSel>]`);
      opts.regions.push({ name: m[1], live: m[2].trim(), build: (m[3] || m[2]).trim() });
    }
    else if (a === '--no-defaults') { opts.noDefaults = true; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--tolerance') { opts.tolerance = Number(rest[i += 1]); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--hide') { opts.hide.push(...splitList(need(rest[i += 1], '--hide needs a selector list'))); }
    else if (a === '--presence') { opts.presence = need(rest[i += 1], '--presence needs a file'); }
    else if (a === '--slug') { opts.slug = need(rest[i += 1], '--slug needs a value'); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--live-cache') { opts.liveCache = rest[i += 1]; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a}`); }
    else pos.push(a);
  }
  if (!opts.noDefaults) {
    const have = new Set(opts.regions.map((r) => r.name));
    const defaults = [{ name: 'header', live: 'header', build: 'header' }, { name: 'footer', live: 'footer', build: 'footer' }].filter((d) => !have.has(d.name));
    opts.regions = [defaults[0], ...opts.regions, ...defaults.slice(1)].filter(Boolean);
  }
  if (!opts.regions.length) throw new UsageError('--no-defaults needs at least one --region');
  if (opts.presence && !opts.slug) throw new UsageError('--presence needs --slug <slug> (the page\'s key in presence.json)');
  const [live, build] = pos;
  if (!live || !build) throw new UsageError('need <liveURL> and <buildURL>');
  return { live, build, opts };
}

// ------------------------------------------------- in-flow per-visitor regions

/**
 * gate-all's presence.json — { "<slug>": { "main": …, "variable": ["<sel>[=<buildSel>]", …] } } — read as
 * gate-all's specFor reads it: the variable entries joined on ',' and split again, each half pair split on '=',
 * live = <sel>, build = <buildSel> || <sel>; "main" is ignored. A missing file or slug hides nothing (the note says so).
 */
export function readPresence(file, slug) {
  if (!existsSync(file)) return { file, slug, regions: [], note: `${file} not found — nothing hidden` };
  let all;
  try { all = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`--presence ${file} unreadable (${e.message})`); }
  const variable = [].concat((all && all[slug] && all[slug].variable) || []);
  const regions = splitList(variable.join(',')).map((s) => { const [o, e = ''] = s.split('='); return { live: o.trim(), build: e.trim() || o.trim() }; });
  return { file, slug, regions, note: regions.length ? `${file} → ${slug}: ${regions.length} variable region(s)` : `${file} has no variable regions for ${slug} — nothing hidden` };
}

/** Per-side hide lists: --hide on both sides, then the presence regions (live / build half); a repeated selector keeps its first source. */
export function hideLists(hide, presence) {
  const side = (k) => {
    const out = [];
    const add = (sel, source) => { if (sel && !out.some((x) => x.sel === sel)) out.push({ sel, source }); };
    hide.forEach((sel) => add(sel, '--hide'));
    ((presence && presence.regions) || []).forEach((r) => add(r[k], 'presence.json'));
    return out;
  };
  return { live: side('live'), build: side('build') };
}

const hiddenText = (rows) => rows.map((x) => `${x.sel} ${x.error ? `error: ${x.error}` : `×${x.n}${x.n ? ` (${x.h}px)` : ''}`} [${x.source}]`).join('; ');

// ---------------------------------------------------------------- in-page probe

/* eslint-disable no-undef */
function probeRegion(sel) {
  const root = document.querySelector(sel);
  if (!root) return { found: false, sel };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'textDecorationLine'];
  const styles = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const k of STYLE) o[k] = k === 'fontFamily' ? (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase() : cs[k];
    return o;
  };
  // atoms = elements carrying their OWN text (direct text nodes), visible
  const atoms = [];
  for (const el of root.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(el.tagName)) continue;
    const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (!own || !visible(el)) continue;
    const box = el.closest('a, button') || el;
    atoms.push({ key: own.toLowerCase(), text: own, tag: el.tagName.toLowerCase(), rect: rect(el), box: rect(box), boxTag: box.tagName.toLowerCase(), style: styles(el), boxStyle: box === el ? null : { backgroundColor: getComputedStyle(box).backgroundColor, borderRadius: getComputedStyle(box).borderRadius, paddingTop: getComputedStyle(box).paddingTop, paddingLeft: getComputedStyle(box).paddingLeft } });
  }
  const icons = [...root.querySelectorAll('svg, img')].filter(visible).map((el) => ({
    tag: el.tagName.toLowerCase(),
    rect: rect(el),
    sig: el.tagName.toLowerCase() === 'svg'
      ? `viewBox=${el.getAttribute('viewBox') || '-'} paths=${el.querySelectorAll('path,circle,rect,polygon,line').length}`
      : (el.currentSrc || el.getAttribute('src') || '').split('/').pop().split('?')[0].slice(0, 40),
    near: norm((el.closest('a, button, li, [aria-label]') || el).getAttribute?.('aria-label') || (el.closest('a, button, li') || {}).textContent || '').slice(0, 30),
  }));
  const cs = getComputedStyle(root);
  return { found: true, sel, rect: rect(root), position: cs.position, backgroundColor: cs.backgroundColor, atoms, icons };
}

// Every selector's matches are measured before any is hidden (nested selectors read their rendered size), then
// hidden inline; an invalid selector is an error entry. Two frames (or 250 ms when frames are throttled) let layout settle.
async function hideInPage(list) {
  const rows = list.map(({ sel, source }) => {
    try {
      const els = [...document.querySelectorAll(sel)];
      return { row: { sel, source, n: els.length, h: Math.round(els.reduce((s, el) => s + el.getBoundingClientRect().height, 0)) }, els };
    } catch (e) { return { row: { sel, source, n: 0, h: 0, error: String(e.message || e).split('\n')[0] }, els: [] }; }
  });
  for (const { els } of rows) for (const el of els) el.style.setProperty('display', 'none', 'important');
  await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 250); });
  return rows.map((x) => x.row);
}
/* eslint-enable no-undef */

// ------------------------------------------------------------------- diffing

const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function diffRect(a, b, tol) {
  const out = [];
  for (const k of ['x', 'y', 'w', 'h']) if (Math.abs(a[k] - b[k]) > tol) out.push(`Δ${k} ${b[k] - a[k] > 0 ? '+' : ''}${b[k] - a[k]}px (${a[k]}→${b[k]})`);
  return out;
}

function diffStyle(a, b, tol) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (a[k] === b[k]) continue;
    const pa = px(a[k]); const pb = px(b[k]);
    if (pa !== null && pb !== null && /px$/.test(a[k]) && /px$/.test(b[k]) && Math.abs(pa - pb) <= tol) continue;
    out.push(`${k} ${a[k]} → ${b[k]}`);
  }
  return out;
}

function pairAtoms(live, build) {
  const used = new Set();
  const pairs = []; const missing = [];
  for (const a of live) {
    const j = build.findIndex((b, i) => !used.has(i) && b.key === a.key);
    if (j < 0) { missing.push(a); continue; }
    used.add(j); pairs.push([a, build[j]]);
  }
  const extra = build.filter((_, i) => !used.has(i));
  return { pairs, missing, extra };
}

export function compareRegion(name, L, B, tol) {
  const r = { name, findings: [], pairs: 0 };
  if (!L.found || !B.found) {
    r.findings.push({ kind: 'REGION', msg: `${!L.found ? `live: no element matches "${L.sel}"` : ''}${!L.found && !B.found ? '; ' : ''}${!B.found ? `build: no element matches "${B.sel}"` : ''} — pass --region ${name}=<liveSel>|<buildSel>` });
    return r;
  }
  const rd = diffRect(L.rect, B.rect, tol);
  if (rd.length) r.findings.push({ kind: 'REGION BOX', msg: rd.join(', ') });
  if (L.backgroundColor !== B.backgroundColor) r.findings.push({ kind: 'REGION STYLE', msg: `backgroundColor ${L.backgroundColor} → ${B.backgroundColor}` });
  if (L.position !== B.position) r.findings.push({ kind: 'REGION STYLE', msg: `position ${L.position} → ${B.position} (fixed/sticky chrome must stay fixed/sticky — seam symmetry)` });

  const { pairs, missing, extra } = pairAtoms(L.atoms, B.atoms);
  r.pairs = pairs.length;
  for (const [a, b] of pairs) {
    const d = [...diffStyle(a.style, b.style, tol), ...diffRect(a.rect, b.rect, tol)];
    if (a.boxTag !== 'span' && (a.box.w !== a.rect.w || a.box.h !== a.rect.h || b.box.w !== b.rect.w || b.box.h !== b.rect.h)) {
      const bd = diffRect(a.box, b.box, tol).filter((s) => /Δ[wh]/.test(s));
      if (bd.length) d.push(`<${a.boxTag}> box ${a.box.w}×${a.box.h} → ${b.box.w}×${b.box.h}`);
      if (a.boxStyle && b.boxStyle) d.push(...diffStyle(a.boxStyle, b.boxStyle, tol).map((s) => `<${a.boxTag}> ${s}`));
    }
    if (a.tag !== b.tag) d.unshift(`tag <${a.tag}> → <${b.tag}>`);
    if (d.length) r.findings.push({ kind: 'PAIR', text: a.text, msg: d.join('; ') });
  }
  for (const m of missing) r.findings.push({ kind: 'MISSING', text: m.text, msg: `live <${m.tag}> "${m.text.slice(0, 48)}" has no build element with the same text` });
  for (const e of extra) r.findings.push({ kind: 'EXTRA', text: e.text, msg: `build <${e.tag}> "${e.text.slice(0, 48)}" has no live source` });

  if (L.icons.length !== B.icons.length) r.findings.push({ kind: 'ICONS', msg: `${L.icons.length} live vs ${B.icons.length} build (svg/img) — harvest the live vectors verbatim (recreation-procedure.md § Asset harvest), never approximate` });
  const n = Math.min(L.icons.length, B.icons.length);
  for (let i = 0; i < n; i += 1) {
    const a = L.icons[i]; const b = B.icons[i];
    const d = diffRect(a.rect, b.rect, tol).filter((s) => /Δ[wh]/.test(s));
    if (a.sig !== b.sig) d.push(`signature "${a.sig}" → "${b.sig}"`);
    if (d.length) r.findings.push({ kind: 'ICON', text: a.near, msg: `icon #${i}${a.near ? ` near "${a.near}"` : ''}: ${d.join('; ')}` });
  }
  r.inventory = { live: { atoms: L.atoms.length, icons: L.icons.length }, build: { atoms: B.atoms.length, icons: B.icons.length } };
  return r;
}

// ---------------------------------------------------------------------- main

async function settleTop(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(500);
}

async function probeSide(browser, session, url, opts, isLive, hides) {
  const { isLiveHttpUrl, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = session;
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed && isLive });
  await dismissOverlays(page, { extra: isLive ? [...(opts.consent ? [opts.consent] : []), ...opts.dismiss] : [], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await settleTop(page);
  const hidden = hides.length ? await page.evaluate(hideInPage, hides) : [];
  const out = {};
  for (const reg of opts.regions) out[reg.name] = await page.evaluate(probeRegion, isLive ? reg.live : reg.build);
  await ctx.close();
  return { data: out, hidden };
}

// --live-cache: the live side's probe result keyed on URL + width + live
// selectors (+ the live hide list, only when non-empty — a cache written
// without hides stays valid for a run without them). A key mismatch re-probes
// and overwrites (never measures a stale site or the wrong breakpoint silently).
export function cacheKey(live, opts, hideLive = []) {
  const key = { url: live, width: opts.width, regions: opts.regions.map((r) => `${r.name}=${r.live}`) };
  if (hideLive.length) key.hide = hideLive.map(({ sel, source }) => ({ sel, source }));
  return key;
}
function readLiveCache(file, live, opts, hideLive) {
  if (!file || !existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (JSON.stringify(c.key) !== JSON.stringify(cacheKey(live, opts, hideLive))) { console.error(`chrome-parity: --live-cache ${file} was probed for a different url/width/regions/hides — re-probing live`); return null; }
    return c;
  } catch (e) { console.error(`chrome-parity: --live-cache ${file} unreadable (${e.message}) — re-probing live`); return null; }
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const { live, build, opts } = parseArgs(args);
  const presence = opts.presence ? readPresence(opts.presence, opts.slug) : null;
  const hides = hideLists(opts.hide, presence);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) { throw new Error(`playwright is not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`); }
  const session = await loadLiveSession();
  const browser = opts.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  let total = 0;
  try {
    const cached = readLiveCache(opts.liveCache, live, opts, hides.live);
    const liveSide = cached ? { data: cached.data, hidden: cached.hidden || [] } : await probeSide(browser, session, live, opts, true, hides.live);
    if (opts.liveCache && !cached) {
      mkdirSync(dirname(opts.liveCache), { recursive: true });
      writeFileSync(opts.liveCache, JSON.stringify({ key: cacheKey(live, opts, hides.live), probedAt: new Date().toISOString(), data: liveSide.data, hidden: liveSide.hidden }, null, 2));
    }
    const liveNote = cached ? ` (live side from cache ${opts.liveCache}, probed ${cached.probedAt} — delete the file to re-probe)` : '';
    const buildSide = await probeSide(browser, session, build, opts, false, hides.build);
    const L = liveSide.data; const B = buildSide.data;
    const hidden = { live: liveSide.hidden, build: buildSide.hidden };
    const regions = opts.regions.map((reg) => compareRegion(reg.name, L[reg.name], B[reg.name], opts.tolerance));
    total = regions.reduce((n, r) => n + r.findings.length, 0);
    if (opts.json) {
      console.log(JSON.stringify({ live, build, width: opts.width, tolerance: opts.tolerance, liveCache: cached ? { file: opts.liveCache, probedAt: cached.probedAt } : null, hidden, presence, regions, raw: { live: L, build: B } }, null, 2));
    } else {
      console.log(`chrome-parity @ ${opts.width}px, tolerance ${opts.tolerance}px\n  live:  ${live}${liveNote}\n  build: ${build}`);
      if (hidden.live.length || hidden.build.length) console.log(`  hidden live:  ${hiddenText(hidden.live)}\n  hidden build: ${hiddenText(hidden.build)}`);
      if (presence) console.log(`  presence: ${presence.note}`);
      for (const r of regions) {
        const inv = r.inventory ? ` — ${r.pairs} paired of ${r.inventory.live.atoms}/${r.inventory.build.atoms} texts, ${r.inventory.live.icons}/${r.inventory.build.icons} icons` : '';
        console.log(`\n■ ${r.name}: ${r.findings.length ? `${r.findings.length} delta(s)` : '✓ parity'}${inv}`);
        for (const f of r.findings) console.log(`  ${f.kind.padEnd(12)} ${f.text ? `"${f.text.slice(0, 40)}"  ` : ''}${f.msg}`);
      }
      console.log(`\n${total ? `✗ ${total} delta(s) — fix these before any pixel iteration on chrome; re-run until quiet, then crop-compare confirms.` : '✓ chrome parity within tolerance — run crop-compare (pass bar item 5) to confirm in pixels.'}`);
    }
  } finally {
    await browser.close();
  }
  return total ? 2 : 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
// exit 3 = bot challenge on the live side (fail loud, never measured).
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof UsageError) { console.error(`${e.message}\n\n${HELP}`); process.exit(e.code); }
    console.error(`chrome-parity error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1);
  });
}
