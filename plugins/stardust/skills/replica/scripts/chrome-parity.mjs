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
 *   node skills/replica/scripts/chrome-parity.mjs <liveURL> --live-only [--json <file>] [--live-cache <f>] [options]
 *     --region <name>=<sel>[|<buildSel>]  ADD a region to probe (repeatable; the build
 *                                         selector defaults to the live one). header and
 *                                         footer are always probed, each resolved by
 *                                         LANDMARK (below), unless a --region of that
 *                                         name gives the selectors or --no-defaults is passed
 *     --no-defaults      probe only the --region list (drop header/footer)
 *     --width <px>       viewport width                        (default 1440)
 *     --tolerance <px>   ignore rect/size deltas ≤ this        (default 1)
 *     --consent <sel>    extra consent-accept selector (live side)
 *     --dismiss <sel,…>  extra overlay-dismiss selectors (live side)
 *     --no-dismiss       dismiss no overlay at all (gate.sh --no-dismiss pass-through)
 *     --headed           real Chrome with the challenge-solve window (bot-managed live sites)
 *     --locale <tag>     pin Accept-Language + locale (e.g. en-GB)
 *     --json [<file>]    machine-readable output (to <file>.json when one is named, beside the text report)
 *     --live-cache <f>   reuse the live side's measurement from <f> (JSON) when it
 *                        exists for the same probe version, URL, width, region
 *                        selectors and overlay/locale settings; probe and write it
 *                        otherwise. Same contract as gate.sh's live.png: one live
 *                        navigation per breakpoint per full gate run, delete the file
 *                        to re-probe. The cache carries the resolved region selectors.
 *                        Convention: stardust/replica/gates/<slug>-<w>/chrome-live.json
 *     --live-only        no build: resolve the regions on the live page, take the
 *                        inventory (texts by channel, links, icons, background, box,
 *                        position, panel triggers), write --json <file> and the
 *                        --live-cache a later comparison reads, print a brief to
 *                        AUTHOR the header and footer from before any gate round
 *     --font-subst "<live family>=<build family>[,…]"  a DECLARED font substitution
 *                        (a licensed face replaced by its metric-matched substitute):
 *                        glyph-width deltas of a text in that face collapse into one
 *                        advisory line per region. No machine-readable record of the
 *                        substitution exists in a project — this flag is the only input
 *     --font-subst-tol <pct>   the bound of that collapse: Δw and Δx within <pct> % of the
 *                        live text width (min 2 px) and Δh within 2 px      (default 6)
 *     --strict-names     no text channels, no rest state: every text with a box counts as
 *                        visible text (the behaviour before the channels)
 *     --strict-region-offset   a region moved as a block (page Δy) fails instead of being advisory
 *
 * Example:
 *   node stardust/scripts/replica/chrome-parity.mjs "https://<site>/" "http://localhost:8791/home-proposed.html" \
 *     --region strip=".quick-links|.quicklinks" --font-subst "Brand Sans=Arimo"
 *
 * Region resolution (header, footer — once per side, the line under each region says which
 * element and why): [role=banner] / [role=contentinfo], else the OUTERMOST <header> / <footer>,
 * else the auto-detected bar — in every case an element that is rendered, at least 60 % of the
 * viewport wide, at the top (header: starts within 600 px) or the end (footer: ends within 800 px
 * or 15 % of the document end) and NOT nested in main / article / aside / section / li / dialog
 * (a card's <header> is never the page header; a main that wraps the whole page is a shell and
 * does not count; the auto-detected bar obeys the same rule). Several qualify → the header with a nav, then the most links. A region that
 * cannot be resolved on a side, or whose two sides are implausibly different (one under a third
 * of the viewport width, heights differing by more than ×4), is an INPUT error — exit 4, no
 * parity verdict: pass --region <name>=<liveSel>|<buildSel>.
 *
 * Output per region: the region box delta, then one line per paired element
 * listing only the properties that differ, then MISSING (live-only) / EXTRA
 * (build-only) texts and the icon inventory. Only real deltas print:
 *   - text in a `display: contents` element is measured by its text box;
 *   - the region background is the PAINTED one (the region's own, else a child
 *     covering it, else the nearest ancestor's);
 *   - icons pair by pixels too (../../diff/scripts/image-signature.mjs): a
 *     re-hosted file or an svg drawn as <img> is no delta;
 *   - pair geometry is relative to the region's own top-left corner.
 * Lines whose kind column reads `advisory` are relaxations — shown, counted on the summary
 * line as advisory groups, never in the exit code:
 *   - REGION OFFSET: the region sits at another page y (the body above is another height —
 *     the main content gate owns that); its internal geometry is compared regardless;
 *   - NAMES: accessible names carried by another channel (aria-label / title / alt on one
 *     side, visually-hidden text on the other). A name in NO channel of the other side stays
 *     MISSING / EXTRA;
 *   - REST STATE: texts inside a panel not shown at rest (opacity 0, off-canvas, aria-hidden,
 *     zero-size clip) left out on both sides — open states belong to the header contract;
 *   - GLYPH WIDTH: pairs within the bound under a declared --font-subst.
 * Exit 0 = parity within tolerance (advisory lines may be present),
 * 2 = deltas printed (fix them, re-run), 1 = error, 3 = bot challenge on the
 * live side (fail loud — never measured), 4 = input error (a region unresolved
 * or implausible — no verdict).
 *
 * Requires: playwright, and the master skill's scripts dir alongside
 * (browser.mjs — the replica Setup copies both). Each run is one live
 * navigation — budget it like any live probe; --json records both sides as
 * the round's evidence.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const BROWSER = ['../../stardust/scripts/browser.mjs', '../stardust/browser.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!BROWSER) {
  console.error('chrome-parity: browser.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).');
  process.exit(1);
}
const { isLiveHttpUrl, openBrowser, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = await import(BROWSER.href);
// image-signature.mjs lives in the diff skill's scripts dir, in either layout
const SIGNATURE = ['../../diff/scripts/image-signature.mjs', '../diff/image-signature.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!SIGNATURE) {
  console.error('chrome-parity: image-signature.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { sameImage, signElements } = await import(SIGNATURE.href);

const HELP = `chrome-parity — computed-style + rect diff of matched chrome elements (live vs build)

Usage: node chrome-parity.mjs <liveURL> <buildURL> [options]
       node chrome-parity.mjs <liveURL> --live-only [--json <file>] [--live-cache <f>] [options]
  --region <name>=<sel>[|<buildSel>]  add a region (repeatable); header + footer are always probed,
                     resolved by landmark unless a --region of that name gives the selectors
  --no-defaults      probe only the --region list (drop header/footer)
  --width <px>       viewport width (default 1440)
  --tolerance <px>   ignore rect/size deltas ≤ this (default 1)
  --consent <sel>    extra consent-accept selector (live side)
  --dismiss <sel,…>  extra overlay-dismiss selectors (live side)
  --no-dismiss       dismiss no overlay at all (gate.sh --no-dismiss pass-through)
  --headed           real Chrome with the challenge-solve window (bot-managed live sites)
  --locale <tag>     pin Accept-Language + locale
  --json [<file>]    machine-readable output (written to <file>.json when one is named, beside the text report)
  --live-cache <f>   reuse/write the live side's measurement (JSON) — one live hit per breakpoint; keyed on probe
                     version, url, width, regions, overlay + locale settings; carries the resolved region selectors
  --live-only        no build: resolve the regions on the live page, write the inventory (texts by channel, links,
                     icons, background, box, position, panel triggers) to --json <file> and to --live-cache, and
                     print a brief to author the header and footer from. Exit 0, 4 (region unresolved), 3
  --font-subst "<live family>=<build family>[,…]"
                     a declared font substitution: for a text in that face, Δw/Δx within the bound and Δh ≤ 2 px
                     collapse into ONE advisory GLYPH WIDTH line per region; beyond the bound, or another face,
                     fails as before. The flag is the only input (no project file records the substitution)
  --font-subst-tol <pct>  that bound, in % of the live text width, min 2 px (default 6)
  --strict-names     no channels, no rest state: every text with a box is visible text (sr-only text, closed
                     panels and aria-hidden subtrees pair as visible text; aria-label/title/alt are not read)
  --strict-region-offset  a region at another page y (REGION OFFSET) fails instead of being advisory
  --accepted <file>  accepted changes ({ accepted: [{ probe: "chrome-parity", kind, text?, root?: <region>, reason }] });
                     a matching delta prints as accepted and is not counted (default stardust/replica/accepted.json);
                     text matches inside the delta's own text, never its message; no text = EVERY delta of that kind
  --help             this text

Regions: header = [role=banner], else the outermost <header>, else the auto-detected top bar; footer =
[role=contentinfo], else the outermost <footer>, else the auto-detected end block — rendered, ≥ 60 % of the viewport
wide, at the top / the end of the document, never nested in main/article/aside/section/li/dialog. Each side prints
the element chosen and why.

Advisory lines (kind column "advisory": REGION OFFSET, NAMES, REST STATE, GLYPH WIDTH) are counted on the summary
line as advisory groups and never in the exit code.

Exit codes: 0 parity within tolerance (advisory lines may be present), 2 deltas printed, 1 error,
3 bot challenge (live side), 4 input error — a region could not be resolved on a side, or the two sides' regions
are implausibly different (one under a third of the viewport width, heights differing by more than ×4): no parity
verdict, pass --region <name>=<liveSel>|<buildSel>.`;

export const EXIT_INPUT = 4;

// Pure: "--font-subst" declarations → [{ live, build }] (families lower-cased, unquoted).
export function parseFontSubst(spec) {
  return String(spec || '').split(',').map((p) => p.split('=').map((f) => f.replace(/["']/g, '').trim().toLowerCase()))
    .filter((p) => p.length === 2 && p[0] && p[1]).map(([live, build]) => ({ live, build }));
}

export function parseArgs(argv, fail = (msg) => { console.error(`${msg}\n\n${HELP}`); process.exit(1); }) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { regions: [], noDefaults: false, width: 1440, tolerance: 1, consent: null, dismiss: [], noDismiss: false, headed: false, locale: null, json: false, jsonFile: null, liveCache: null, accepted: null, liveOnly: false, fontSubst: [], fontSubstTol: 6, strictNames: false, strictRegionOffset: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--region') {
      const spec = rest[i += 1] || '';
      const m = spec.match(/^([\w-]+)=([^|]+)(?:\|(.+))?$/);
      if (!m) return fail(`bad --region "${spec}" — expected name=<liveSel>[|<buildSel>]`);
      opts.regions.push({ name: m[1], live: m[2].trim(), build: (m[3] || m[2]).trim() });
    }
    else if (a === '--no-defaults') { opts.noDefaults = true; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--tolerance') { opts.tolerance = Number(rest[i += 1]); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--no-dismiss') { opts.noDismiss = true; }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; if (/\.json$/i.test(rest[i + 1] || '')) { opts.jsonFile = rest[i += 1]; } }
    else if (a === '--live-cache') { opts.liveCache = rest[i += 1]; }
    else if (a === '--accepted') { opts.accepted = rest[i += 1]; }
    else if (a === '--live-only') { opts.liveOnly = true; }
    else if (a === '--font-subst') {
      const spec = rest[i += 1] || ''; const decl = parseFontSubst(spec);
      if (!decl.length) return fail(`bad --font-subst "${spec}" — expected "<live family>=<build family>[,…]"`);
      opts.fontSubst.push(...decl);
    }
    else if (a === '--font-subst-tol') {
      opts.fontSubstTol = Number(String(rest[i += 1] || '').replace('%', ''));
      if (!(opts.fontSubstTol >= 0)) return fail('bad --font-subst-tol — expected a percentage, e.g. 6');
    }
    else if (a === '--strict-names') { opts.strictNames = true; }
    else if (a === '--strict-region-offset') { opts.strictRegionOffset = true; }
    else if (a.startsWith('--')) return fail(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (!opts.noDefaults) {
    // header and footer resolve by landmark (auto) unless a --region of that name gives the selectors
    const have = new Set(opts.regions.map((r) => r.name));
    const defaults = ['header', 'footer'].filter((n) => !have.has(n)).map((name) => ({ name, auto: true, live: '@landmark', build: '@landmark' }));
    opts.regions = [...defaults.filter((d) => d.name === 'header'), ...opts.regions, ...defaults.filter((d) => d.name === 'footer')];
  }
  if (!opts.regions.length) return fail('--no-defaults needs at least one --region');
  const [live, build] = pos;
  if (opts.liveOnly ? (!live || build) : (!live || !build)) return fail(opts.liveOnly ? '--live-only takes <liveURL> alone' : 'need <liveURL> and <buildURL>');
  return { live, build, opts };
}

// ---------------------------------------------------------------- in-page probe

/* eslint-disable no-undef */
// In the page: every element that could be the page's header / footer, as plain data for chooseRegion (pure). Each is
// tagged data-sd-cand="<name>-<i>". Candidates: the landmark role, the tag, and ONE auto-detected block (header: the
// outermost full-width bar anchored at the top ≤ 10 px, 30–400 px tall, with a link; footer: the outermost full-width
// block ending at the document end, with a link, holding no main/h1 and under 60 % of the document).
export function collectRegionCandidates(name) {
  const isFooter = name === 'footer';
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const sy = window.scrollY;
  const SKIP = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'TEMPLATE'];
  const flow = [...document.body.children].filter((e) => !SKIP.includes(e.tagName) && getComputedStyle(e).position !== 'fixed');
  const contentBottom = Math.round(Math.max(0, ...flow.map((e) => e.getBoundingClientRect().bottom + sy)) || document.body.getBoundingClientRect().bottom + sy);
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + sy), w: Math.round(r.width), h: Math.round(r.height) }; };
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const hint = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`;
  const unique = (el) => el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1;
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (unique(e)) { parts.unshift(`#${CSS.escape(e.id)}`); return parts.join(' > '); }
      const same = [...e.parentElement.children].filter((s) => s.tagName === e.tagName);
      parts.unshift(`${e.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''}`);
    }
    return `body > ${parts.join(' > ')}`;
  };
  // a sectioning ancestor that wraps the whole page is the page shell, not a content container
  const shell = (el) => { const b = box(el); return b.y <= 10 && b.y + b.h >= contentBottom - 10 && b.w >= 0.9 * vw; };
  const NEST = 'main, article, aside, section, li, dialog, [role="main"], [role="article"], [role="dialog"], [role="complementary"]';
  const nestedIn = (el) => {
    for (let a = el.parentElement && el.parentElement.closest(NEST); a; a = a.parentElement && a.parentElement.closest(NEST)) if (!shell(a)) return hint(a);
    return null;
  };
  const els = [...document.querySelectorAll(isFooter ? '[role="contentinfo"], footer' : '[role="banner"], header')];
  const all = [...document.querySelectorAll('body *')].filter((el) => !SKIP.includes(el.tagName));
  let bars;
  if (isFooter) {
    bars = all.filter((el) => {
      const r = el.getBoundingClientRect(); const bottom = r.bottom + sy;
      return Math.abs(bottom - contentBottom) <= 10 && r.width >= 0.9 * vw && r.height >= 30 && r.height <= 0.6 * contentBottom && el.querySelector('a[href]')
        && !el.querySelector('main, [role="main"], h1') && !el.matches('main, [role="main"]') && getComputedStyle(el).visibility !== 'hidden';
    });
  } else {
    bars = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.top <= 10 && r.width >= 0.9 * vw && r.height >= 30 && r.height <= 400 && el.querySelector('a[href]') && getComputedStyle(el).visibility !== 'hidden';
    });
  }
  const auto = bars.find((el) => !bars.some((o) => o !== el && o.contains(el)));
  if (auto && !els.includes(auto)) els.push(auto);
  const role = isFooter ? 'contentinfo' : 'banner';
  const cands = els.map((el, i) => {
    el.setAttribute('data-sd-cand', `${name}-${i}`);
    return {
      ref: `${name}-${i}`,
      order: i,
      source: el.getAttribute('role') === role ? 'role' : (el.tagName === (isFooter ? 'FOOTER' : 'HEADER') ? 'tag' : 'auto'),
      hint: hint(el),
      path: path(el),
      rect: box(el),
      visible: shown(el),
      position: getComputedStyle(el).position,
      links: el.querySelectorAll('a[href]').length,
      hasNav: Boolean(el.querySelector('nav, [role="navigation"]')),
      nestedIn: nestedIn(el),
      ancestors: els.map((o, j) => (o !== el && o.contains(el) ? `${name}-${j}` : null)).filter(Boolean),
    };
  });
  return { viewport: { width: vw, contentBottom }, cands };
}

export function probeRegion(args) {
  const [sel, regionName] = Array.isArray(args) ? args : [args, 'r'];
  const root = document.querySelector(sel);
  if (!root) return { found: false, sel };
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const box = (r) => ({ x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });
  // a display:contents element has no box of its own — its text does
  const textRect = (el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const rs = [...range.getClientRects()].filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)); const y = Math.min(...rs.map((r) => r.top));
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
  };
  // a text box spans the glyphs; a block spans its line height — widen the text box to the line height to compare alike
  const lineBox = (el, r) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return lh > r.height ? { x: r.x, y: r.y - (lh - r.height) / 2, width: r.width, height: lh } : r;
  };
  const rect = (el) => {
    if (el.getClientRects().length) return box(el.getBoundingClientRect());
    const t = textRect(el);
    return box(t ? lineBox(el, t) : el.getBoundingClientRect());
  };
  const visible = (el) => getComputedStyle(el).visibility !== 'hidden' && (el.getClientRects().length > 0 || (getComputedStyle(el).display === 'contents' && Boolean(textRect(el))));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'textDecorationLine'];
  const styles = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const k of STYLE) o[k] = k === 'fontFamily' ? (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase() : cs[k];
    return o;
  };
  // Rest state and channel, inherited down from the region root: `rest` = why the element is inside something not shown
  // at rest (a closed drawer / mega-menu panel); `hidden` = inside visually-hidden text meant for assistive tech.
  const CONTROLS = 'a[href], button, input, select, textarea';
  const memo = new Map([[root, { rest: null, hidden: false }]]);
  const own = (el, aria = true) => {
    const cs = getComputedStyle(el);
    if (el.hasAttribute('hidden') && cs.display === 'none') return { rest: '[hidden]' };
    if (cs.display === 'none') return { rest: 'display:none' };
    if (aria && el.getAttribute('aria-hidden') === 'true') return { rest: 'aria-hidden' };
    if (parseFloat(cs.opacity) === 0) return { rest: 'opacity:0' };
    if (cs.display === 'contents') return {};
    const r = el.getBoundingClientRect();
    const out = cs.position !== 'static';
    const clips = /hidden|clip/.test(`${cs.overflowX} ${cs.overflowY}`);
    const clipped = (out && /^rect\((?:[01](?:px)?[,\s]+){3}[01](?:px)?\)$/.test(cs.clip)) || /inset\((?:50|100)%/.test(cs.clipPath);
    if (clipped || (clips && r.width <= 1.5 && r.height <= 1.5)) return { hidden: true };
    if (clips && (r.width <= 1 || r.height <= 1) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) return { rest: 'zero-size clip' };
    const away = (out && r.width > 0 && r.height > 0 && (r.right <= 0 || r.left >= vw || r.bottom + window.scrollY <= 0)) || parseFloat(cs.textIndent) <= -500;
    if (away) return cs.transform !== 'none' || el.querySelectorAll(CONTROLS).length >= 2 ? { rest: 'off-canvas' } : { hidden: true };
    return {};
  };
  const stateIn = (m, aria) => function st(el) {
    if (m.has(el)) return m.get(el);
    const up = el.parentElement && root.contains(el.parentElement) ? st(el.parentElement) : { rest: null, hidden: false };
    const o = up.rest ? {} : own(el, aria);
    const s = { rest: up.rest || o.rest || null, hidden: up.hidden || Boolean(o.hidden) };
    m.set(el, s);
    return s;
  };
  const state = stateIn(memo, true);
  // An icon is drawn whatever aria-hidden says (it marks a decorative icon inside a labelled control): for icons the
  // attribute is not a rest state — on the icon or on any ancestor. Every other reason still applies.
  const drawn = stateIn(new Map([[root, { rest: null, hidden: false }]]), false);
  // atoms = elements carrying their OWN text (direct text nodes) that have a box; each with its channel (visible |
  // hidden-name) and, inside a panel not shown at rest, the reason (`rest`). Texts with no box at all are only counted.
  const atoms = []; const notShown = {};
  for (const el of root.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'TEMPLATE'].includes(el.tagName)) continue;
    const ownText = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (!ownText) continue;
    const st = state(el);
    if (!visible(el)) { const why = st.rest || (getComputedStyle(el).visibility === 'hidden' ? 'visibility:hidden' : 'no box'); notShown[why] = (notShown[why] || 0) + 1; continue; }
    const ctl = el.closest('a, button') || el;
    atoms.push({ key: ownText.toLowerCase(), text: ownText, tag: el.tagName.toLowerCase(), channel: st.hidden ? 'hidden-name' : 'visible', ...(st.rest ? { rest: st.rest } : {}), ...(el.getAttribute('role') || ctl.getAttribute('role') ? { role: el.getAttribute('role') || ctl.getAttribute('role') } : {}), ...(ctl.tagName === 'A' && ctl.hasAttribute('href') ? { href: ctl.getAttribute('href') } : {}), rect: rect(el), box: rect(ctl), boxTag: ctl.tagName.toLowerCase(), style: styles(el), boxStyle: ctl === el ? null : { backgroundColor: getComputedStyle(ctl).backgroundColor, borderRadius: getComputedStyle(ctl).borderRadius, paddingTop: getComputedStyle(ctl).paddingTop, paddingLeft: getComputedStyle(ctl).paddingLeft } });
  }
  // attr-names: aria-label / title / alt (or an svg <title>) of a control or image that shows no visible text
  const textEls = [...root.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent)) && visible(el) && !state(el).rest && !state(el).hidden);
  const names = [];
  for (const el of root.querySelectorAll('[aria-label], [title], img[alt], svg')) {
    if (el.closest('svg') && el.closest('svg') !== el) continue;
    const ctl = el.closest('a, button, summary, [role="button"], [role="link"]') || el;
    const st = state(el);
    if (st.rest || st.hidden || !visible(el) || textEls.some((t) => ctl.contains(t))) continue;
    const svgTitle = el.tagName.toLowerCase() === 'svg' ? el.querySelector(':scope > title') : null;
    const attr = ['aria-label', 'title', 'alt'].find((a) => norm(el.getAttribute(a))) || (svgTitle && norm(svgTitle.textContent) ? 'svg title' : null);
    if (!attr) continue;
    const text = attr === 'svg title' ? norm(svgTitle.textContent) : norm(el.getAttribute(attr));
    names.push({ key: text.toLowerCase(), text, channel: 'attr-name', attr, tag: ctl.tagName.toLowerCase(), ...(ctl.tagName === 'A' && ctl.hasAttribute('href') ? { href: ctl.getAttribute('href') } : {}) });
  }
  const icons = [...root.querySelectorAll('svg, img')].filter(visible).map((el, i) => (el.setAttribute('data-sd-icon', `${regionName}-${i}`), {
    ref: `${regionName}-${i}`,
    tag: el.tagName.toLowerCase(),
    kind: el.tagName.toLowerCase() === 'svg' ? 'inline svg' : 'img',
    ...(drawn(el).rest ? { rest: drawn(el).rest } : {}),
    rect: rect(el),
    sig: el.tagName.toLowerCase() === 'svg'
      ? `viewBox=${el.getAttribute('viewBox') || '-'} paths=${el.querySelectorAll('path,circle,rect,polygon,line').length}`
      : (el.currentSrc || el.getAttribute('src') || '').split('/').pop().split('?')[0].slice(0, 40),
    near: norm((el.closest('a, button, li, [aria-label]') || el).getAttribute?.('aria-label') || (el.closest('a, button, li') || {}).textContent || '').slice(0, 30),
  }));
  // icons drawn as a CSS background (inventory only — never paired): a small box with a background image and no text
  const file = (bg) => ((bg.match(/url\(["']?([^"')]+)/) || [])[1] || '').split('/').pop().split('?')[0].slice(0, 40);
  const bgIcons = [];
  for (const el of root.querySelectorAll('*')) {
    if (bgIcons.length >= 40) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || !bg.includes('url(') || !visible(el) || state(el).rest) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.width > 96 || r.height > 96) continue;
    bgIcons.push({ tag: el.tagName.toLowerCase(), kind: 'background', rect: rect(el), sig: file(bg), near: norm((el.closest('a, button, [aria-label]') || el).getAttribute?.('aria-label') || (el.closest('a, button') || el).textContent || '').slice(0, 30) });
  }
  // panel triggers: the controls that open something (their open states belong to the header contract)
  const triggers = [...root.querySelectorAll('[aria-expanded], [aria-haspopup], [aria-controls], summary')].filter((el) => visible(el) && !state(el).rest)
    .map((el) => ({ tag: el.tagName.toLowerCase(), name: norm(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title')).slice(0, 60), ...(el.hasAttribute('aria-expanded') ? { expanded: el.getAttribute('aria-expanded') } : {}) }));
  // the PAINTED background: the region's own, else a child covering ≥ 90 % of it, else the nearest ancestor's
  const clear = (c) => !c || c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
  const painted = () => {
    const ownBg = getComputedStyle(root).backgroundColor;
    if (!clear(ownBg)) return ownBg;
    const R = root.getBoundingClientRect(); const area = R.width * R.height;
    for (const c of root.querySelectorAll(':scope > *, :scope > * > *')) {
      const r = c.getBoundingClientRect(); const bg = getComputedStyle(c).backgroundColor;
      if (!clear(bg) && area && r.width * r.height >= 0.9 * area) return bg;
    }
    for (let a = root.parentElement; a; a = a.parentElement) { const bg = getComputedStyle(a).backgroundColor; if (!clear(bg)) return bg; }
    return ownBg;
  };
  const cs = getComputedStyle(root);
  return { found: true, sel, rect: rect(root), position: cs.position, backgroundColor: painted(), backgroundImage: cs.backgroundImage && cs.backgroundImage !== 'none' ? (file(cs.backgroundImage) || cs.backgroundImage.slice(0, 60)) : 'none', atoms, names, notShown, icons, bgIcons, triggers };
}
/* eslint-enable no-undef */

// ---------------------------------------------------------- region resolution

// The bounds of region resolution (documented in --help): a region is at least minWidthShare of the viewport wide; a
// header starts within headerTopMax px of the top; a footer ends within max(footerEndSlack px, footerEndShare of the
// document) of the content end. Two resolved sides are implausible when one is under implausibleWidthShare of the
// viewport width or their heights differ by more than heightFactor.
export const REGION_RULES = { minWidthShare: 0.6, headerTopMax: 600, footerEndSlack: 800, footerEndShare: 0.15, implausibleWidthShare: 1 / 3, heightFactor: 4 };

// Pure: the page's header / footer among collectRegionCandidates' plain records. Landmark role first, then the
// outermost tag, then the auto-detected block; never a candidate that is not rendered, nested in a content container,
// narrow, or away from the top (header) / the end (footer). → { chosen, how, rejected: [{ hint, why }], reason }.
export function chooseRegion(name, cands, viewport) {
  const isFooter = name === 'footer';
  const R = REGION_RULES;
  const why = (c) => {
    if (!c.visible) return 'not rendered';
    if (c.nestedIn) return `nested in ${c.nestedIn}`;
    if (c.rect.w < R.minWidthShare * viewport.width) return `${c.rect.w}px wide, under ${Math.round(R.minWidthShare * 100)}% of the ${viewport.width}px viewport`;
    if (!isFooter && c.rect.y > R.headerTopMax) return `starts at y ${c.rect.y}, not at the top`;
    const slack = Math.max(R.footerEndSlack, R.footerEndShare * viewport.contentBottom);
    if (isFooter && c.rect.y + c.rect.h < viewport.contentBottom - slack) return `ends ${viewport.contentBottom - c.rect.y - c.rect.h}px before the document end`;
    return null;
  };
  const judged = (cands || []).map((c) => ({ c, why: why(c) }));
  // "outermost" holds within a tier and against a stronger one: a landmark inside an auto-detected wrapper stays the
  // landmark (role → tag → auto is the documented order), a <header> inside the banner does not.
  const TIER = { role: 0, tag: 1, auto: 2 };
  const ok = new Map(judged.filter((j) => !j.why).map((j) => [j.c.ref, TIER[j.c.source] ?? 2]));
  for (const j of judged) if (!j.why && (j.c.ancestors || []).some((a) => ok.has(a) && ok.get(a) <= (TIER[j.c.source] ?? 2))) j.why = 'inside another candidate (not the outermost)';
  const rank = (a, b) => (isFooter
    ? (b.links - a.links) || (b.order - a.order)
    : (Number(b.hasNav) - Number(a.hasNav)) || (b.links - a.links) || (a.order - b.order));
  const HOW = { role: `[role=${isFooter ? 'contentinfo' : 'banner'}] landmark`, tag: `outermost <${isFooter ? 'footer' : 'header'}>`, auto: `auto-detected (no usable ${isFooter ? '<footer>' : '<header>'} landmark)` };
  const rejected = judged.filter((j) => j.why).map((j) => ({ hint: j.c.hint, why: j.why }));
  for (const source of ['role', 'tag', 'auto']) {
    const tier = judged.filter((j) => !j.why && j.c.source === source).map((j) => j.c).sort(rank);
    if (tier.length) return { chosen: tier[0], how: `${HOW[source]}${tier.length > 1 ? `, ${isFooter ? 'the most links' : 'the one with the nav / most links'} of ${tier.length}` : ''}`, rejected: [...rejected, ...tier.slice(1).map((c) => ({ hint: c.hint, why: 'another candidate ranks first' }))] };
  }
  return { chosen: null, how: null, rejected, reason: `no ${name} resolved${rejected.length ? ` (${rejected.length} candidate(s): ${rejected.slice(0, 4).map((r) => `${r.hint} ${r.why}`).join('; ')})` : ' (no landmark, no <' + name + '>, nothing auto-detected)'}` };
}

// Pure: why two resolved sides cannot be the same region (an input error, not a parity delta) — or null. Only regions
// resolved by landmark are judged; a --region selector is taken as given.
export function regionPlausibility(L, B, width) {
  if (!L || !B || !L.found || !B.found || !(L.resolved || B.resolved) || !width) return null;
  const R = REGION_RULES;
  for (const [side, P] of [['live', L], ['build', B]]) if (P.rect.w < R.implausibleWidthShare * width) return `${side} region is ${P.rect.w}px wide, under a third of the ${width}px viewport (${P.sel})`;
  const [lo, hi] = [Math.min(L.rect.h, B.rect.h), Math.max(L.rect.h, B.rect.h)];
  if (hi > R.heightFactor * Math.max(lo, 1)) return `region heights differ by more than ×${R.heightFactor} (live ${L.rect.h}px, build ${B.rect.h}px) — not the same element, or one side is in another state`;
  return null;
}

// ------------------------------------------------------------------- diffing

const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

function rectDeltas(a, b, tol) {
  const out = [];
  for (const k of ['x', 'y', 'w', 'h']) if (Math.abs(a[k] - b[k]) > tol) out.push({ k, d: b[k] - a[k], msg: `Δ${k} ${signed(b[k] - a[k])}px (${a[k]}→${b[k]})` });
  return out;
}
const diffRect = (a, b, tol) => rectDeltas(a, b, tol).map((d) => d.msg);

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

// Pure: the at-rest inventory of one probed side. Default: visible texts (channel visible, not inside a panel hidden at
// rest), names (hidden-name texts + attr-names), icons outside hidden panels, and how many boxed texts were left out and
// why. strict (--strict-names): every boxed text is visible text, no names, every boxed icon — the earlier behaviour.
export function restInventory(P, strict = false) {
  const atoms = P.atoms || []; const icons = P.icons || [];
  if (strict) return { visible: atoms, names: [], icons, excluded: 0, reasons: {} };
  const reasons = {};
  for (const a of atoms) if (a.rest) reasons[a.rest] = (reasons[a.rest] || 0) + 1;
  return {
    visible: atoms.filter((a) => !a.rest && (a.channel || 'visible') === 'visible'),
    names: [...atoms.filter((a) => !a.rest && a.channel === 'hidden-name'), ...(P.names || [])],
    icons: icons.filter((i) => !i.rest),
    excluded: atoms.filter((a) => a.rest).length,
    reasons,
  };
}

// Pure: accessible names (hidden-name + attr-name items) compared as SETS across channels. A name the other side
// carries in the same channel is quiet; in another channel (aria-label ↔ hidden text, or visible text) it is CARRIED
// (advisory, counted once per name); in no channel at all it is missing (live) / extra (build) — a real delta.
const CHANNEL = (n) => (n.channel === 'hidden-name' ? 'hidden text' : n.attr || 'attribute');
export function pairNames(liveNames, buildNames, liveVisibleKeys = [], buildVisibleKeys = []) {
  const index = (list) => { const m = new Map(); for (const n of list) { if (!m.has(n.key)) m.set(n.key, []); m.get(n.key).push(n); } return m; };
  const L = index(liveNames); const B = index(buildNames);
  const lv = new Set(liveVisibleKeys); const bv = new Set(buildVisibleKeys);
  const kinds = (items) => new Set(items.map((n) => (n.channel === 'hidden-name' ? 'hidden-name' : 'attr-name')));
  const carried = []; const missing = []; const extra = [];
  for (const [key, items] of L) {
    if (B.has(key)) {
      const lk = kinds(items); const bk = kinds(B.get(key));
      if (![...lk].some((k) => bk.has(k))) carried.push({ key, text: items[0].text, live: CHANNEL(items[0]), build: CHANNEL(B.get(key)[0]) });
    } else if (bv.has(key)) carried.push({ key, text: items[0].text, live: CHANNEL(items[0]), build: 'visible text' });
    else missing.push(items[0]);
  }
  for (const [key, items] of B) {
    if (L.has(key)) continue;
    if (lv.has(key)) carried.push({ key, text: items[0].text, live: 'visible text', build: CHANNEL(items[0]) });
    else extra.push(items[0]);
  }
  return { carried, missing, extra };
}

// Pure: the declared substitution a text pair falls under — the live face is a declared one and the build renders the
// same family name (the brand first in the stack, the substitute behind it) or the declared substitute — else null.
export function substitutionFor(a, b, decl) {
  const lf = a.style && a.style.fontFamily; const bf = b.style && b.style.fontFamily;
  return (decl || []).find((d) => d.live === lf && (bf === lf || bf === d.build)) || null;
}

// Pure: region-relative rect (the region's own top-left is the origin).
export const relRect = (rect, region) => ({ x: rect.x - region.x, y: rect.y - region.y, w: rect.w, h: rect.h });

export function compareRegion(name, L, B, tol, o = {}) {
  const r = { name, findings: [], pairs: 0 };
  if (L.found && !B.found) { // the source has the region, the build does not: a defect of the build, never an input error
    r.findings.push({ kind: 'MISSING', msg: `REGION ${name}: on the live page (${L.hint || L.sel || 'resolved'}), not on the build — ${B.unresolved || `no element matches "${B.sel}"`}` });
    return r;
  }
  if (!L.found || !B.found) {
    const side = (P, label) => (P.found ? '' : `${label}: ${P.unresolved || `no element matches "${P.sel}"`}`);
    r.inputError = [side(L, 'live'), side(B, 'build')].filter(Boolean).join('; ');
    r.findings.push({ kind: 'REGION', input: true, advisory: true, msg: `${r.inputError} — input error, no parity verdict: pass --region ${name}=<liveSel>|<buildSel>` });
    return r;
  }
  const implausible = regionPlausibility(L, B, o.width);
  if (implausible) {
    r.inputError = implausible;
    r.findings.push({ kind: 'REGION', input: true, advisory: true, msg: `${implausible} — input error, no parity verdict: pass --region ${name}=<liveSel>|<buildSel>` });
    return r;
  }
  // the region's page offset is ONE line (the body above is gated elsewhere); its own box and everything inside it is
  // compared relative to the region's top-left
  const rd = rectDeltas(L.rect, B.rect, tol);
  const boxMsg = rd.filter((d) => d.k !== 'y').map((d) => d.msg);
  if (boxMsg.length) r.findings.push({ kind: 'REGION BOX', msg: boxMsg.join(', ') });
  const dy = rd.find((d) => d.k === 'y');
  if (dy) r.findings.push({ kind: 'REGION OFFSET', advisory: !o.strictRegionOffset, msg: `page Δy ${signed(dy.d)}px (${L.rect.y}→${B.rect.y}) — the region sits at another page y as one block (the page above is another height)${o.strictRegionOffset ? '' : '; the main content gate owns that height (--strict-region-offset fails it here)'}` });
  if (L.backgroundColor !== B.backgroundColor) r.findings.push({ kind: 'REGION STYLE', msg: `backgroundColor ${L.backgroundColor} → ${B.backgroundColor}` });
  if (L.position !== B.position) r.findings.push({ kind: 'REGION STYLE', msg: `position ${L.position} → ${B.position} (fixed/sticky chrome must stay fixed/sticky — seam symmetry)` });

  const li = restInventory(L, o.strictNames); const bi = restInventory(B, o.strictNames);
  const { pairs, missing, extra } = pairAtoms(li.visible, bi.visible);
  r.pairs = pairs.length;
  const pct = o.fontSubstTol == null ? 6 : o.fontSubstTol;
  const glyph = new Map(); // "live→build" → pairs collapsed
  for (const [a, b] of pairs) {
    const subst = substitutionFor(a, b, o.fontSubst);
    const bound = subst ? Math.max(2, (pct / 100) * a.rect.w) : 0;
    const d = []; let real = 0; let soft = 0;
    const add = (msg, isGlyph) => { d.push(msg); if (isGlyph) soft += 1; else real += 1; };
    for (const s of diffStyle(a.style, b.style, tol)) add(s, Boolean(subst) && s === `fontFamily ${subst.live} → ${subst.build}`);
    for (const x of rectDeltas(relRect(a.rect, L.rect), relRect(b.rect, B.rect), tol)) add(x.msg, Boolean(subst) && ((/[xw]/.test(x.k) && Math.abs(x.d) <= bound) || (x.k === 'h' && Math.abs(x.d) <= 2)));
    if (a.boxTag !== 'span' && (a.box.w !== a.rect.w || a.box.h !== a.rect.h || b.box.w !== b.rect.w || b.box.h !== b.rect.h)) {
      const bd = rectDeltas(a.box, b.box, tol).filter((x) => /[wh]/.test(x.k));
      if (bd.length) add(`<${a.boxTag}> box ${a.box.w}×${a.box.h} → ${b.box.w}×${b.box.h}`, Boolean(subst) && bd.every((x) => (x.k === 'w' ? Math.abs(x.d) <= bound : Math.abs(x.d) <= 2)));
      if (a.boxStyle && b.boxStyle) for (const s of diffStyle(a.boxStyle, b.boxStyle, tol)) add(`<${a.boxTag}> ${s}`, false);
    }
    if (!d.length) continue;
    // every delta of the pair is glyph width under the declared substitution → the pair joins the advisory group; a pair
    // with any other delta keeps its whole line
    if (!real && soft) { const k = `${subst.live}→${subst.build}`; glyph.set(k, (glyph.get(k) || 0) + 1); continue; }
    // a tag change alone (same style, same box — a div title rebuilt as a heading) is invisible: context, not a delta
    if (a.tag !== b.tag) d.unshift(`tag <${a.tag}> → <${b.tag}>`);
    r.findings.push({ kind: 'PAIR', text: a.text, msg: d.join('; ') });
  }
  for (const [k, n] of glyph) r.findings.push({ kind: 'GLYPH WIDTH', advisory: true, msg: `${n} pair(s) within ${pct}% under the declared substitution ${k}` });
  for (const m of missing) r.findings.push({ kind: 'MISSING', text: m.text, msg: `live <${m.tag}> "${m.text.slice(0, 48)}" has no build element with the same text` });
  for (const e of extra) r.findings.push({ kind: 'EXTRA', text: e.text, msg: `build <${e.tag}> "${e.text.slice(0, 48)}" has no live source` });

  if (!o.strictNames) {
    const n = pairNames(li.names, bi.names, li.visible.map((a) => a.key), bi.visible.map((a) => a.key));
    if (n.carried.length) {
      const ways = [...new Set(n.carried.map((c) => `${c.live} ↔ ${c.build}`))];
      r.findings.push({ kind: 'NAMES', advisory: true, msg: `${n.carried.length} carried by another channel (${ways.slice(0, 3).join(', ')})` });
    }
    for (const m of n.missing) r.findings.push({ kind: 'MISSING', text: m.text, msg: `live ${CHANNEL(m)} "${m.text.slice(0, 48)}" on <${m.tag}> is in no channel of the build (visible text, hidden text, aria-label/title/alt) — an accessible name was lost` });
    for (const e of n.extra) r.findings.push({ kind: 'EXTRA', text: e.text, msg: `build ${CHANNEL(e)} "${e.text.slice(0, 48)}" on <${e.tag}> has no live source in any channel` });
    if (li.excluded || bi.excluded) {
      const why = (inv) => Object.entries(inv.reasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
      r.findings.push({ kind: 'REST STATE', advisory: true, msg: `${li.excluded} live / ${bi.excluded} build text(s) inside panels not shown at rest left out (live: ${why(li)}; build: ${why(bi)}) — --strict-names counts them` });
    }
    r.names = { carried: n.carried.length, live: li.names.length, build: bi.names.length };
  }

  if (li.icons.length !== bi.icons.length) r.findings.push({ kind: 'ICONS', msg: `${li.icons.length} live vs ${bi.icons.length} build (svg/img) — harvest the live vectors verbatim (recreation-procedure.md § Asset harvest), never approximate` });
  const n = Math.min(li.icons.length, bi.icons.length);
  for (let i = 0; i < n; i += 1) {
    const a = li.icons[i]; const b = bi.icons[i];
    const d = diffRect(a.rect, b.rect, tol).filter((s) => /Δ[wh]/.test(s));
    const pixelsSame = sameImage({ sig: a.px, size: `${a.rect.w}×${a.rect.h}` }, { sig: b.px, size: `${b.rect.w}×${b.rect.h}` });
    if (a.sig !== b.sig && !pixelsSame) d.push(`signature "${a.sig}" → "${b.sig}"`);
    if (d.length) r.findings.push({ kind: 'ICON', text: a.near, msg: `icon #${i}${a.near ? ` near "${a.near}"` : ''}: ${d.join('; ')}` });
  }
  r.inventory = { live: { atoms: li.visible.length, icons: li.icons.length }, build: { atoms: bi.visible.length, icons: bi.icons.length } };
  return r;
}

// Pure: an owner's accepted list ({ probe?, kind, text?, root?, reason }) marks a matching delta accepted — kind equal,
// text a case-insensitive substring of the finding's own text (the item it is about — never its message wording, so
// "link" does not accept every MISSING; a finding without text matches no text entry), root = the region name when
// given; an entry without text accepts EVERY delta of its kind. Accepted deltas print with their reason and never count.
export function markAccepted(region, list) {
  for (const f of region.findings) {
    const subject = String(f.text || '').toLowerCase();
    const hit = (list || []).find((a) => a && (!a.probe || a.probe === 'chrome-parity') && a.kind === f.kind && (!a.root || a.root === region.name) && (!a.text || (subject && subject.includes(String(a.text).toLowerCase()))));
    if (hit) { f.accepted = hit.reason || 'accepted'; f.advisory = true; }
  }
  return region;
}

// Pure: the counts of a compared run and its exit code — failing deltas, advisory groups (relaxations shown, not
// counted), accepted deltas, input errors (a region unresolved or implausible: EXIT_INPUT, no verdict).
export function tally(regions) {
  const all = regions.flatMap((r) => r.findings);
  const deltas = all.filter((f) => !f.advisory).length;
  const advisory = all.filter((f) => f.advisory && !f.accepted && !f.input).length;
  const accepted = all.filter((f) => f.accepted).length;
  const inputErrors = regions.filter((r) => r.inputError).map((r) => `${r.name} (${r.inputError})`);
  let exit = 0; if (deltas) exit = 2; if (inputErrors.length) exit = EXIT_INPUT;
  return { deltas, advisory, accepted, inputErrors, exit };
}

// Pure: the summary line (gate.sh reads the last line starting ✗ / ✓; an input error starts ⚠ and names the error).
export function summaryLine(t) {
  const tail = `${t.advisory ? `, ${t.advisory} advisory group(s)` : ''}${t.accepted ? `, ${t.accepted} accepted` : ''}`;
  if (t.inputErrors.length) return `⚠ input error (exit ${EXIT_INPUT}) — no parity verdict: ${t.inputErrors.join('; ')}${t.deltas ? ` — the other region(s): ${t.deltas} delta(s)${tail}` : tail}`;
  return t.deltas
    ? `✗ ${t.deltas} delta(s)${tail} — fix these before any pixel iteration on chrome; re-run until quiet, then crop-compare confirms.`
    : `✓ chrome parity within tolerance${tail} — run crop-compare (pass bar item 5) to confirm in pixels.`;
}

// Pure: one finding as a report line. Advisory findings carry `advisory` in the kind column; accepted ones the 🟢.
export function findingLine(f) {
  const subject = f.text ? `"${f.text.slice(0, 40)}"  ` : '';
  if (f.accepted) return `  🟢 ${f.kind.padEnd(12)} ${subject}${f.msg}  — accepted: ${f.accepted}`;
  if (f.advisory && !f.input) return `  ${'advisory'.padEnd(12)} ${f.kind}: ${subject}${f.msg}`;
  return `  ${f.kind.padEnd(12)} ${subject}${f.msg}`;
}

// Pure: "which element, and why" for one side of one region.
export function regionLine(side, P) {
  const b = P && P.rect ? `${P.rect.x},${P.rect.y} ${P.rect.w}×${P.rect.h}` : '';
  if (!P || !P.found) return `  region ${`${side}:`.padEnd(6)} unresolved — ${(P && P.unresolved) || `no element matches "${P && P.sel}"`}`;
  if (!P.resolved) return `  region ${`${side}:`.padEnd(6)} ${P.sel} — given by --region, box ${b}`;
  return `  region ${`${side}:`.padEnd(6)} ${P.resolved.hint} — ${P.resolved.how}, box ${b}; selector ${P.resolved.selector}`;
}

// Pure: the live-only brief of one region — what to author the header / footer from.
export function briefRegion(name, P) {
  if (!P || !P.found) return [`■ ${name}: UNRESOLVED — ${(P && P.unresolved) || 'no element'}`];
  const inv = restInventory(P);
  const hiddenNames = inv.names.filter((n) => n.channel === 'hidden-name'); const attrNames = inv.names.filter((n) => n.channel === 'attr-name');
  const out = [`■ ${name}: box ${P.rect.x},${P.rect.y} ${P.rect.w}×${P.rect.h}, position ${P.position}, background ${P.backgroundColor}${P.backgroundImage && P.backgroundImage !== 'none' ? ` + image ${P.backgroundImage}` : ''}`];
  out.push(regionLine('live', P));
  out.push(`  texts: ${inv.visible.length} visible, ${hiddenNames.length} hidden-name, ${attrNames.length} attr-name; ${inv.excluded} inside panels not shown at rest${Object.keys(P.notShown || {}).length ? `, ${Object.values(P.notShown).reduce((a, b) => a + b, 0)} with no box` : ''}; icons: ${inv.icons.length} (svg/img)${(P.bgIcons || []).length ? ` + ${P.bgIcons.length} background` : ''}; panel triggers: ${(P.triggers || []).length}`);
  out.push('  visible texts, in order (region-relative x,y w×h):');
  for (const a of inv.visible) { const q = relRect(a.rect, P.rect); out.push(`    <${a.tag}${a.role ? ` role=${a.role}` : ''}> "${a.text.slice(0, 60)}"${a.href != null ? ` → ${a.href}` : ''}  ${q.x},${q.y} ${q.w}×${q.h}  ${a.style.fontFamily} ${a.style.fontSize}/${a.style.lineHeight} ${a.style.fontWeight} ${a.style.color}`); }
  if (inv.icons.length || (P.bgIcons || []).length) out.push('  icons:');
  for (const i of [...inv.icons, ...(P.bgIcons || [])]) out.push(`    ${i.kind || i.tag} ${i.rect.w}×${i.rect.h} ${i.sig}${i.near ? ` near "${i.near}"` : ''}`);
  if (hiddenNames.length) out.push('  hidden-name (visually hidden text for assistive tech):');
  for (const n of hiddenNames) out.push(`    <${n.tag}> "${n.text.slice(0, 60)}"${n.href != null ? ` → ${n.href}` : ''}`);
  if (attrNames.length) out.push('  attr-name (the name of a control or image with no visible text):');
  for (const n of attrNames) out.push(`    <${n.tag}> ${n.attr}="${n.text.slice(0, 60)}"${n.href != null ? ` → ${n.href}` : ''}`);
  if ((P.triggers || []).length) out.push(`  panel triggers: ${P.triggers.map((t) => `<${t.tag}> "${t.name}"${t.expanded != null ? ` [aria-expanded=${t.expanded}]` : ''}`).join(', ')}`);
  return out;
}

// Pure: the live-only inventory record of one region (the --json file): the probe plus the derived links.
export function inventoryRegion(P) {
  if (!P || !P.found) return P;
  const inv = restInventory(P);
  const links = [...inv.visible, ...inv.names].filter((a) => a.href != null).map((a) => ({ name: a.text, href: a.href, channel: a.channel || 'visible' }));
  return { ...P, counts: { visible: inv.visible.length, hiddenName: inv.names.filter((n) => n.channel === 'hidden-name').length, attrName: inv.names.filter((n) => n.channel === 'attr-name').length, notAtRest: inv.excluded, icons: inv.icons.length }, links };
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
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 }, stateUrl: url });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed && isLive });
  if (!opts.noDismiss) await dismissOverlays(page, { extra: isLive ? [...(opts.consent ? [opts.consent] : []), ...opts.dismiss] : [], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await settleTop(page);
  const out = {};
  for (const reg of opts.regions) {
    if (reg.auto) {
      // header / footer by landmark, once per side: the candidates as plain data, the choice in chooseRegion (pure)
      const { viewport, cands } = await page.evaluate(collectRegionCandidates, reg.name);
      const pick = chooseRegion(reg.name, cands, viewport);
      if (!pick.chosen) { out[reg.name] = { found: false, sel: `${reg.name} landmark`, unresolved: pick.reason, rejected: pick.rejected }; continue; }
      out[reg.name] = await page.evaluate(probeRegion, [`[data-sd-cand="${pick.chosen.ref}"]`, reg.name]);
      out[reg.name].sel = pick.chosen.path;
      out[reg.name].resolved = { how: pick.how, hint: pick.chosen.hint, selector: pick.chosen.path, box: pick.chosen.rect, rejected: pick.rejected };
      if (pick.chosen.source === 'auto') out[reg.name].autoDetected = pick.chosen.hint;
    } else {
      out[reg.name] = await page.evaluate(probeRegion, [isLive ? reg.live : reg.build, reg.name]);
    }
  }
  const icons = Object.values(out).flatMap((r) => (r.found ? r.icons : []));
  const sigs = await signElements(page, icons.map((ic) => ({ ref: ic.ref, selector: `[data-sd-icon="${ic.ref}"]` })));
  icons.forEach((ic) => { if (sigs.has(ic.ref)) ic.px = sigs.get(ic.ref); });
  await ctx.close();
  return out;
}

// --live-cache: the live side's probe result keyed on probe version + URL +
// width + live selectors + the overlay/locale settings that decide the page's
// state. A key mismatch re-probes and overwrites (never measures a stale site,
// the wrong breakpoint or another overlay state silently, and never compares
// an older probe's live record against this probe's build). The record carries
// the resolved region selectors (data.<region>.resolved, and `regions` at the
// top) so later rounds reuse them. Bump PROBE_VERSION whenever probeRegion /
// collectRegionCandidates / chooseRegion / probeSide change what they record.
export const PROBE_VERSION = 3; // 3 = landmark region resolution, text channels + rest state, attr-names, overlay state in the key
export function cacheKey(live, opts) {
  const state = [opts.noDismiss ? 'no-dismiss' : '', opts.consent ? `consent=${opts.consent}` : '', (opts.dismiss || []).length ? `dismiss=${opts.dismiss.join(',')}` : '', opts.locale ? `locale=${opts.locale}` : ''].filter(Boolean).join(';');
  return { probe: PROBE_VERSION, url: live, width: opts.width, regions: opts.regions.map((r) => `${r.name}=${r.live}`), state };
}
export function readLiveCache(file, live, opts) {
  if (!file || !existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (!c.key || c.key.probe !== PROBE_VERSION) { console.error(`chrome-parity: --live-cache ${file} was written by another probe version (${c.key && c.key.probe ? c.key.probe : 'pre-0.34.13'}, now ${PROBE_VERSION}) — re-probing live`); return null; }
    if (JSON.stringify(c.key) !== JSON.stringify(cacheKey(live, opts))) { console.error(`chrome-parity: --live-cache ${file} was probed for a different url/width/regions/overlay state — re-probing live`); return null; }
    return c;
  } catch (e) { console.error(`chrome-parity: --live-cache ${file} unreadable (${e.message}) — re-probing live`); return null; }
}
export function writeLiveCache(file, live, opts, data, probedAt = new Date().toISOString()) {
  mkdirSync(dirname(file), { recursive: true });
  const regions = Object.fromEntries(Object.entries(data).map(([name, P]) => [name, P.found ? { selector: P.sel, how: P.resolved ? P.resolved.how : '--region', box: P.rect } : { unresolved: P.unresolved || `no element matches "${P.sel}"` }]));
  writeFileSync(file, JSON.stringify({ key: cacheKey(live, opts), probedAt, regions, data }, null, 2));
}

async function main() {
  const { live, build, opts } = parseArgs(process.argv);
  const browser = await openBrowser({ mode: opts.headed ? 'headed' : 'chrome' });
  let exit = 0;
  try {
    const cached = readLiveCache(opts.liveCache, live, opts);
    const L = cached ? cached.data : await probeSide(browser, live, opts, true);
    if (opts.liveCache && !cached) writeLiveCache(opts.liveCache, live, opts, L);
    const liveNote = cached ? ` (live side from cache ${opts.liveCache}, probed ${cached.probedAt} — delete the file to re-probe)` : '';
    if (opts.liveOnly) {
      const unresolved = opts.regions.filter((reg) => !L[reg.name].found).map((reg) => `${reg.name} (${L[reg.name].unresolved || `no element matches "${L[reg.name].sel}"`})`);
      const record = { live, width: opts.width, probe: PROBE_VERSION, liveCache: opts.liveCache || null, probedAt: cached ? cached.probedAt : new Date().toISOString(), regions: Object.fromEntries(opts.regions.map((reg) => [reg.name, inventoryRegion(L[reg.name])])) };
      if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile), { recursive: true }); writeFileSync(opts.jsonFile, JSON.stringify(record, null, 2)); }
      if (opts.json && !opts.jsonFile) console.log(JSON.stringify(record, null, 2));
      else {
        console.log(`chrome-parity --live-only @ ${opts.width}px — the live chrome inventory (no build compared)\n  live:  ${live}${liveNote}`);
        for (const reg of opts.regions) console.log(`\n${briefRegion(reg.name, L[reg.name]).join('\n')}`);
        console.log(`\n${opts.jsonFile ? `inventory: ${opts.jsonFile}` : 'inventory: pass --json <file> to keep it'}${opts.liveCache ? `; live cache: ${opts.liveCache} (a later comparison at this url, width and overlay settings reads it — no second live hit)` : '; pass --live-cache <f> so the comparison reuses this capture'}`);
        console.log(unresolved.length ? `⚠ input error (exit ${EXIT_INPUT}) — unresolved: ${unresolved.join('; ')} — pass --region <name>=<liveSel>` : '✓ live chrome inventory taken — author the header and footer from it, then compare.');
      }
      exit = unresolved.length ? EXIT_INPUT : 0;
      process.exitCode = exit; // the return below skips the process.exit after the finally
      return;
    }
    const B = await probeSide(browser, build, opts, false);
    const acceptedFile = opts.accepted || (existsSync('stardust/replica/accepted.json') ? 'stardust/replica/accepted.json' : null);
    const acceptedList = acceptedFile ? (JSON.parse(readFileSync(acceptedFile, 'utf8')).accepted || []) : [];
    const cmp = { width: opts.width, strictNames: opts.strictNames, strictRegionOffset: opts.strictRegionOffset, fontSubst: opts.fontSubst, fontSubstTol: opts.fontSubstTol };
    const regions = opts.regions.map((reg) => markAccepted(compareRegion(reg.name, L[reg.name], B[reg.name], opts.tolerance, cmp), acceptedList));
    const t = tally(regions);
    exit = t.exit;
    const record = { live, build, width: opts.width, tolerance: opts.tolerance, options: cmp, liveCache: cached ? { file: opts.liveCache, probedAt: cached.probedAt } : null, summary: t, regions, raw: { live: L, build: B } };
    if (opts.jsonFile) { mkdirSync(dirname(opts.jsonFile), { recursive: true }); writeFileSync(opts.jsonFile, JSON.stringify(record, null, 2)); }
    if (opts.json && !opts.jsonFile) {
      console.log(JSON.stringify(record, null, 2));
    } else {
      const flags = [opts.fontSubst.length ? `font substitution ${opts.fontSubst.map((d) => `${d.live}→${d.build}`).join(', ')} (±${opts.fontSubstTol}%)` : '', opts.strictNames ? '--strict-names' : '', opts.strictRegionOffset ? '--strict-region-offset' : ''].filter(Boolean);
      console.log(`chrome-parity @ ${opts.width}px, tolerance ${opts.tolerance}px${flags.length ? `, ${flags.join(', ')}` : ''}\n  live:  ${live}${liveNote}\n  build: ${build}`);
      for (const r of regions) {
        const inv = r.inventory ? ` — ${r.pairs} paired of ${r.inventory.live.atoms}/${r.inventory.build.atoms} texts, ${r.inventory.live.icons}/${r.inventory.build.icons} icons` : '';
        const n = r.findings.filter((f) => !f.advisory).length;
        let head = n ? `${n} delta(s)` : '✓ parity'; if (r.inputError) head = 'INPUT ERROR — no verdict';
        console.log(`\n■ ${r.name}: ${head}${inv}`);
        for (const [side, P] of [['live', L], ['build', B]]) console.log(regionLine(side, P[r.name]));
        for (const f of r.findings) console.log(findingLine(f));
      }
      console.log(`\n${summaryLine(t)}`);
    }
  } finally {
    await browser.close();
  }
  process.exit(exit);
}

// exit 3 = bot challenge on the live side (fail loud, never measured). Main only as the entry point — the test imports
// the pure parts.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`chrome-parity error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
