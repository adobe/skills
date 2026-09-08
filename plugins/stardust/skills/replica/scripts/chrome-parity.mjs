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
 *     --headed           headed stealth real Chrome (bot-managed live sites)
 *     --locale <tag>     pin Accept-Language + locale (e.g. en-GB)
 *     --json             machine-readable output
 *
 * Example:
 *   node scripts/replica/chrome-parity.mjs "https://<site>/" "http://localhost:8791/home-proposed.html" \
 *     --region header=header --region strip=".quick-links|.quicklinks" --region footer=footer
 *
 * Output per region: the region box delta, then one line per paired element
 * listing only the properties that differ, then MISSING (live-only) / EXTRA
 * (build-only) texts and the icon inventory. Exit 0 = parity within tolerance,
 * 2 = deltas printed (fix them, re-run), 1 = error, 3 = bot challenge on the
 * live side (fail loud — never measured).
 *
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both). Each run is one live
 * navigation — budget it like any live probe; --json records both sides as
 * the round's evidence.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('chrome-parity error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `chrome-parity — computed-style + rect diff of matched chrome elements (live vs build)

Usage: node chrome-parity.mjs <liveURL> <buildURL> [options]
  --region <name>=<sel>[|<buildSel>]  add a region (repeatable); header + footer are always probed
  --no-defaults      probe only the --region list (drop header/footer)
  --width <px>       viewport width (default 1440)
  --tolerance <px>   ignore rect/size deltas ≤ this (default 1)
  --consent <sel>    extra consent-accept selector (live side)
  --dismiss <sel,…>  extra overlay-dismiss selectors (live side)
  --headed           headed stealth real Chrome (bot-managed live sites)
  --locale <tag>     pin Accept-Language + locale
  --json             machine-readable output
  --help             this text

Exit codes: 0 parity within tolerance, 2 deltas printed, 1 error, 3 bot challenge (live side).`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { regions: [], noDefaults: false, width: 1440, tolerance: 1, consent: null, dismiss: [], headed: false, locale: null, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--region') {
      const spec = rest[i += 1] || '';
      const m = spec.match(/^([\w-]+)=([^|]+)(?:\|(.+))?$/);
      if (!m) { console.error(`bad --region "${spec}" — expected name=<liveSel>[|<buildSel>]\n\n${HELP}`); process.exit(1); }
      opts.regions.push({ name: m[1], live: m[2].trim(), build: (m[3] || m[2]).trim() });
    }
    else if (a === '--no-defaults') { opts.noDefaults = true; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--tolerance') { opts.tolerance = Number(rest[i += 1]); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  if (!opts.noDefaults) {
    const have = new Set(opts.regions.map((r) => r.name));
    const defaults = [{ name: 'header', live: 'header', build: 'header' }, { name: 'footer', live: 'footer', build: 'footer' }].filter((d) => !have.has(d.name));
    opts.regions = [defaults[0], ...opts.regions, ...defaults.slice(1)].filter(Boolean);
  }
  if (!opts.regions.length) { console.error(`--no-defaults needs at least one --region\n\n${HELP}`); process.exit(1); }
  const [live, build] = pos;
  if (!live || !build) { console.error(`need <liveURL> and <buildURL>\n\n${HELP}`); process.exit(1); }
  return { live, build, opts };
}

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

function compareRegion(name, L, B, tol) {
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

async function probeSide(browser, url, opts, isLive) {
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed && isLive });
  await dismissOverlays(page, { extra: isLive ? [...(opts.consent ? [opts.consent] : []), ...opts.dismiss] : [], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await settleTop(page);
  const out = {};
  for (const reg of opts.regions) out[reg.name] = await page.evaluate(probeRegion, isLive ? reg.live : reg.build);
  await ctx.close();
  return out;
}

async function main() {
  const { live, build, opts } = parseArgs(process.argv);
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let total = 0;
  try {
    const L = await probeSide(browser, live, opts, true);
    const B = await probeSide(browser, build, opts, false);
    const regions = opts.regions.map((reg) => compareRegion(reg.name, L[reg.name], B[reg.name], opts.tolerance));
    total = regions.reduce((n, r) => n + r.findings.length, 0);
    if (opts.json) {
      console.log(JSON.stringify({ live, build, width: opts.width, tolerance: opts.tolerance, regions, raw: { live: L, build: B } }, null, 2));
    } else {
      console.log(`chrome-parity @ ${opts.width}px, tolerance ${opts.tolerance}px\n  live:  ${live}\n  build: ${build}`);
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
  process.exit(total ? 2 : 0);
}

// exit 3 = bot challenge on the live side (fail loud, never measured).
main().catch((e) => { console.error(`chrome-parity error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
