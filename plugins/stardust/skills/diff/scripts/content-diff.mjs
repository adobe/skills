#!/usr/bin/env node
/**
 * skills/diff/scripts/content-diff.mjs
 *
 * Prototype ↔ EDS STRUCTURAL content + typography reconcile for the
 * stardust:deploy skill (Step 10, run alongside visual-diff.mjs).
 *
 * visual-diff.mjs reasons about PIXELS via heuristics (stretch / flush / blank /
 * colour) — it is structurally blind to "the right text is in the wrong slot" or
 * "one CTA is gone": the pixels are full, the colours plausible, nothing looks
 * blank, so no flag fires. Those are the failures it kept missing (the-people
 * eyebrow↔body swap #76, the dropped the-place CTA, the typography fork #77).
 *
 * This tool adds the missing layer: it extracts an ORDERED, role-classified
 * inventory of every text-bearing node ({role, text, href, alt}) from each page's
 * <main>, classifying by COMPUTED STYLE + tag (symmetric across the prototype's
 * .ds-* DOM and the EDS block DOM), then DIFFS the two inventories:
 *   - MISSING   a proto heading / CTA / eyebrow with no EDS match   (🔴 structural)
 *   - ROLE SWAP same text present but under a different role         (🔴 the #76 class)
 *   - MISSING BODY / EXTRA  body copy dropped / invented             (🟡 advisory)
 *   - FONT DIFF a matched line whose rendered FACE differs           (🟠 width probe, #77)
 *
 * Text nodes are not the whole content. A second inventory (attributeInventory,
 * same root) carries what text nodes cannot: every `placeholder`, `aria-label`
 * and `title` attribute, and every ICON — a small `<img>` (rendered at most
 * 64 px: flags, badges; keyed by its source FILE NAME, never the host), an inline
 * `<svg>` (its `<use>` fragment / label / shape count), an element carrying an
 * icon-font class or an empty inline element whose `::before`/`::after` computes
 * a `content` (the glyph itself), or an icon-class element drawn by mask/
 * background image. A recorded hands-off run shipped every page with a search
 * input missing its localized placeholder, a locale root with the wrong flag
 * image and empty social-icon boxes where the source rendered icon-font glyphs
 * — and this probe reported 0 🔴 because it paired text only. diffAttributes:
 *   - MISSING PLACEHOLDER / ARIA-LABEL / TITLE  a source attribute value with no
 *     build element carrying it (same attribute, case-insensitive) — the build's
 *     values of that attribute on the same tag are listed so a translation or
 *     typo is visible; EXTRA <ATTR> the other way round (🟡)
 *   - MISSING ICON   a source icon with no build icon at the same anchor (the
 *     closest interactive ancestor's label / href path, else the nearest text)
 *   - ICON DIFF      same anchor, same kind, different glyph / file / svg
 *   - ICON KIND      same anchor, different technique (glyph vs svg vs image) — 🟡,
 *     the pixel probe judges equivalence
 *   - EXTRA ICON     a build icon with no source icon at that anchor (🟡)
 *   Every mismatch is 🟡 at least and 🔴 when the element is interactive (an
 *   input, a button, a link, or inside one) — so a dropped placeholder, a wrong
 *   flag inside a locale link and an empty social link are structural 🔴 and
 *   fail the round like a missing CTA.
 *
 * Font detection uses a WIDTH PROBE, never document.fonts.check (which returns
 * true for any family name the page references, installed or not — #77): the same
 * normalised string at a fixed size under each element's computed family+weight;
 * a materially different width across pages ⇒ a different actual face.
 *
 * The classifier + differ live in content-inventory.mjs (SHARED with the deploy
 * skill's pre-code section-schema #93 and in-loop block-roundtrip #94 gates, so
 * every fidelity gate measures with the same instrument).
 *
 * Usage:
 *   node skills/diff/scripts/content-diff.mjs <prototypeURL> <edsURL> [options]
 *     --main <selector>     content root to compare        (default "main")
 *     --width <px>          viewport width                 (default 1280)
 *     --json                also print the two raw inventories (text items, editable
 *                           set, attrs[], icons[]) and the findings array
 *     --ua <string>         user agent                     (default: real-Chrome desktop UA)
 *     --wait-until <state>  goto wait state override. Default rule (three tiers,
 *                           decided per URL side by live-session's defaultWaitUntil):
 *                           localhost/127.0.0.1 → 'networkidle'; EDS build/preview
 *                           origins (*.aem.page, *.aem.live, *.hlx.page, *.hlx.live)
 *                           → 'networkidle' (they decorate async — measuring at
 *                           domcontentloaded reads the pre-decoration DOM); all
 *                           other live http(s) → 'domcontentloaded' (analytics
 *                           beacons never reach networkidle).
 *     --dismiss [sel,...]   dismiss overlays on both sides via live-session
 *                           (consent + timed marketing modals), plus these extra
 *                           site-specific selectors (optional)
 *     --headed              escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>        pin Accept-Language + context locale (geo-redirect determinism)
 *
 * Every context gets the real-Chrome UA + the standard request headers via
 * live-session.mjs (UA alone still 403s on Akamai — F-R1). A bot-management
 * challenge on either navigation FAILS LOUD (exit 3) — a challenge page must
 * never be measured as the source. A plain HTTP error (e.g. a 404 build side
 * before preview propagation) is NOT fatal: it is measured with a loud
 * warning and the flags reflect it — the advisory contract Step 10 relies on.
 *
 * Exit codes: 0 ran (flags are advisory, they do NOT fail the run — an
 * HTTP-error side is measured + flagged, not fatal), 1 error (playwright not
 * importable included), 3 bot challenge/blocked live side (BotChallengeError —
 * escalate with --headed).
 *
 * Output: `Findings: none — content + roles match` | `Findings: N (S structural 🔴)`
 * then one `  <sev> <KIND>: <msg>` line per finding (gate.sh and gate-evidence read
 * the Findings line); with --json, `Inventories JSON:` followed by
 * { [source]: inv, [build]: inv, findings: [{ sev, kind, msg }] }.
 *
 * attributeInventory (in-page) and diffAttributes (pure) are exported; playwright is
 * imported lazily in main, so the contract test runs the differ without a browser.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, newline-per-chained-call, no-continue, no-multi-spaces */
/* standalone dev tool: playwright is a devDependency (imported lazily in main); sequential page ops use awaited loops by design */
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOTE: deploy's gates (#93/#94) now use their OWN synced copies in skills/deploy/scripts/
// (so A6/A2 are independent of this skill). This probe keeps its local copies; the two
// copies of content-inventory.mjs/diff-profiles.mjs must stay in sync until the diff-skill
// abrasion PR consolidates them. Keep edits (e.g. the classifier's norm()) applied to both.
import { resolveProfile } from './diff-profiles.mjs';
// editableInventory = the Experience Workspace outermost-editable classifier, shared
// with the deploy gates (section-schema editableTexts, block-roundtrip --ew).
import { inventory, diffInventories, summarise, editableInventory } from './content-inventory.mjs';
import { REAL_CHROME_UA, isLiveHttpUrl, defaultWaitUntil, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } from './live-session.mjs';

const USAGE = `usage: node skills/diff/scripts/content-diff.mjs <sourceURL> <buildURL> [options]
  --profile eds|generic  stack profile (default eds)
  --main <sel>           content root (default from profile)
  --width <px>           viewport width (default 1280)
  --json                 also print the two raw inventories (text, editable, attrs, icons)
                         and the findings array
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state. Default (per URL side, three tiers):
                         networkidle for localhost/127.0.0.1; networkidle for EDS
                         build/preview origins (*.aem.page, *.aem.live, *.hlx.page,
                         *.hlx.live — they decorate async); domcontentloaded for all
                         other live http(s) (never reach networkidle).
  --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on both
                         sides; optional comma-separated extra selectors
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB) for geo determinism
exit codes: 0 ran (flags advisory; an HTTP-error side, e.g. a 404 build pre-propagation,
            is measured + flagged with a warning, not fatal), 1 error,
            3 bot challenge (live side blocked — fail loud)
findings:   text/role layer — MISSING CTA|HEADING|EYEBROW|BODY, ROLE SWAP, EXTRA, FONT FORK,
            EDITABLE COUNT; attribute layer — MISSING|EXTRA PLACEHOLDER|ARIA-LABEL|TITLE,
            MISSING ICON, ICON DIFF, ICON KIND, EXTRA ICON (🔴 when the element is
            interactive: input, button, link or inside one; else 🟡)
`;

// ---- attribute + icon layer ----------------------------------------------------------------------
// Runs IN the page (Playwright-serialized, ONE arg): page.evaluate(attributeInventory, [rootSel]).
// Returns { attrs: [{ tag, attr, value, interactive }], icons: [{ kind, value, family?, size, interactive, anchor }] }.
//   attrs  every non-empty placeholder / aria-label / title under the root (whitespace-collapsed)
//   icons  kind 'img'   an <img> rendered at most 64×64 (a hidden one by its natural / attribute size) — value = file name
//          kind 'svg'   an inline <svg> — value = its <use> fragment, aria-label, <title>, else viewBox + shape count
//          kind 'glyph' an icon-class element, or an EMPTY inline element, whose ::before/::after computes a content —
//                       value = that content (the glyph); an icon-class element with no generated content and no
//                       mask/background image is an EMPTY ICON BOX (value '') — recorded, so a dropped glyph pairs as a diff
//          kind 'css'   an icon-class element drawn by mask-image / background-image — value = mask:<file> | bg:<file>
//   anchor the pairing key: the closest interactive ancestor's aria-label / title / text, else its href path, else an
//          ordinal per unlabeled host; outside any interactive element the nearest ancestor text. interactive = the
//          element is, or sits inside, an input / button / link (a[href], summary, role=button|link|tab|menuitem).
/* eslint-disable no-undef */
export function attributeInventory(args) {
  const [rootSel] = args;
  const root = document.querySelector(rootSel) || document.querySelector('main') || document.body;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase();
  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
  const ICON_CLASS = /^(?:fa[srlbdt]?|fa-[\w-]+|icon|icons?-[\w-]+|[\w-]+-icons?(?:-[\w-]+)?|[\w-]+__icon(?:-[\w-]+)?|glyphicon(?:-[\w-]+)?|material-(?:icons|symbols)(?:-[\w-]+)?|mdi(?:-[\w-]+)?|bi(?:-[\w-]+)?|dashicons(?:-[\w-]+)?|lnr(?:-[\w-]+)?|pe-7s-[\w-]+|ion(?:icon)?(?:-[\w-]+)?|ti-[\w-]+|ri-[\w-]+|la[srb]?(?:-[\w-]+)?|flag(?:-[\w-]+)?)$/i;
  const fileOf = (src) => { const s = src || ''; if (!s) return ''; if (/^data:/i.test(s)) return `${s.split(/[;,]/)[0]}…`; const path = s.split(/[?#]/)[0].replace(/\/+$/, ''); return path.slice(path.lastIndexOf('/') + 1); };
  const urlFile = (v) => { const m = /url\((["']?)([^"')]*)\1\)/.exec(v || ''); return m ? fileOf(m[2]) : ''; };
  const pseudo = (el, which) => { const c = getComputedStyle(el, which).content; return !c || c === 'none' || c === 'normal' || c === '""' || c === "''" ? '' : c; };
  const size = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; };
  const hostIds = new Map();
  const anchorOf = (el) => {
    const host = el.matches(INTERACTIVE) ? el : el.closest(INTERACTIVE);
    if (host && root.contains(host)) {
      const label = norm(host.getAttribute('aria-label') || host.getAttribute('title') || host.textContent);
      if (label) return label.slice(0, 60);
      const href = host.getAttribute('href');
      if (href) { try { return new URL(href, location.href).pathname.toLowerCase() || '/'; } catch { return href.toLowerCase(); } }
      if (!hostIds.has(host)) hostIds.set(host, hostIds.size + 1);
      return `${host.tagName.toLowerCase()}#${hostIds.get(host)}`;
    }
    let p = el.parentElement;
    while (p && p !== root && !clean(p.textContent)) p = p.parentElement;
    return p ? norm(p.textContent).slice(0, 60) : '';
  };
  const attrs = []; const icons = [];
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'template', 'noscript'].includes(tag) || el.closest('script, style, template, noscript')) return;
    if (el.ownerSVGElement) return; // svg internals — the <svg> itself is the icon
    const interactive = Boolean(el.closest(INTERACTIVE)); // closest() includes the element itself
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const v = clean(el.getAttribute(attr));
      if (v) attrs.push({ tag, attr, value: v, interactive });
    }
    if (tag === 'img') {
      const r = el.getBoundingClientRect();
      const w = r.width || el.naturalWidth || Number(el.getAttribute('width')) || 0;
      const h = r.height || el.naturalHeight || Number(el.getAttribute('height')) || 0;
      if (w > 0 && h > 0 && w <= 64 && h <= 64) icons.push({ kind: 'img', value: fileOf(el.currentSrc || el.src), size: `${Math.round(w)}×${Math.round(h)}`, interactive, anchor: anchorOf(el) });
      return;
    }
    if (tag === 'svg') {
      const use = el.querySelector('use');
      const ref = (use && (use.getAttribute('href') || use.getAttribute('xlink:href'))) || '';
      const title = el.querySelector('title');
      const value = (ref.includes('#') ? ref.slice(ref.lastIndexOf('#')) : '') || clean(el.getAttribute('aria-label')) || (title && clean(title.textContent)) || `${el.getAttribute('viewBox') || 'no viewBox'} / ${el.querySelectorAll('path, circle, rect, polygon, line, polyline, ellipse').length} shape(s)`;
      icons.push({ kind: 'svg', value, size: size(el), interactive, anchor: anchorOf(el) });
      return;
    }
    const iconClass = [...el.classList].some((c) => ICON_CLASS.test(c));
    const empty = !el.children.length && !clean(el.textContent);
    if (!iconClass && !empty) return;
    const cs = getComputedStyle(el);
    if (!iconClass && !/^inline/.test(cs.display)) return; // an empty block is layout, not an icon
    if (iconClass && el.querySelector('img, svg')) return; // a wrapper — its child is the icon
    if (iconClass && !empty) return; // an icon-class element that is really a text label (ligature fonts) — the text inventory has it
    const before = pseudo(el, '::before'); const after = pseudo(el, '::after');
    if (before || after) {
      const family = getComputedStyle(el, before ? '::before' : '::after').fontFamily.split(',')[0].replace(/["']/g, '').trim();
      icons.push({ kind: 'glyph', value: `${before}${after}`, family, size: size(el), interactive, anchor: anchorOf(el) });
      return;
    }
    if (!iconClass) return; // an empty inline element with no generated content is nothing
    const mask = urlFile(cs.maskImage || cs.webkitMaskImage); const bg = urlFile(cs.backgroundImage);
    if (mask || bg) { icons.push({ kind: 'css', value: mask ? `mask:${mask}` : `bg:${bg}`, size: size(el), interactive, anchor: anchorOf(el) }); return; }
    icons.push({ kind: 'glyph', value: '', family: '', size: size(el), interactive, anchor: anchorOf(el) }); // the empty icon box
  });
  return { attrs, icons };
}
/* eslint-enable no-undef */

// Remediation hints for the attribute layer (a profile may override any key under prof.hints).
export const ATTRIBUTE_HINTS = {
  MISSING_ATTRIBUTE: 'Authored text a user or assistive tech reads, dropped by the build — carry it over verbatim.',
  EXTRA_ATTRIBUTE: 'Build-only attribute — confirm it is intended (an unregistered change is a fidelity bug).',
  MISSING_ICON: 'A source icon with no build icon at the same anchor — an empty icon box or a dropped glyph; lift the same glyph, file or svg.',
  ICON_DIFF: 'Same anchor, different icon — lift the source\'s glyph, file or svg (or register the change).',
  ICON_KIND: 'Same anchor, different technique (icon-font glyph vs inline svg vs image) — the pixel probe judges equivalence; confirm, never assume.',
  EXTRA_ICON: 'Build-only icon — confirm it is intended.',
};

// Human label for a glyph content string: quotes stripped, non-ASCII code points as U+XXXX, '' → no glyph.
export function glyphLabel(value) {
  const v = String(value || '').replace(/^["']|["']$/g, '');
  if (!v) return 'no glyph';
  return [...v].map((ch) => { const c = ch.codePointAt(0); return c < 0x20 || c > 0x7e ? `U+${c.toString(16).toUpperCase().padStart(4, '0')}` : ch; }).join('');
}
const describeIcon = (ic) => {
  if (ic.kind === 'img') return `image ${ic.value || '(no src)'} (${ic.size})`;
  if (ic.kind === 'svg') return `inline svg ${ic.value} (${ic.size})`;
  if (ic.kind === 'css') return `css icon ${ic.value} (${ic.size})`;
  return ic.value ? `icon-font glyph ${glyphLabel(ic.value)}${ic.family ? ` (${ic.family}, ${ic.size})` : ` (${ic.size})`}` : `empty icon box (${ic.size})`;
};

// Pure: diff two attributeInventory results → flags [{ sev, kind, msg }]. Attributes pair by (attribute, value) — case-
// insensitive, first unused target — like the text differ pairs by key; icons pair by anchor in three ordered passes (same
// kind + value, then same kind, then any kind at that anchor). 🔴 when the element is interactive, 🟡 otherwise; EXTRA and
// ICON KIND are 🟡.
export function diffAttributes(src, tgt, prof) {
  const flags = [];
  const S = prof.source; const T = prof.target; const H = { ...ATTRIBUTE_HINTS, ...(prof.hints || {}) };
  const sev = (interactive) => (interactive ? '🔴' : '🟡');
  const q = (s, n = 48) => `"${String(s === undefined || s === null ? '' : s).slice(0, n)}"`;
  const sa = (src && src.attrs) || []; const ta = (tgt && tgt.attrs) || [];
  const key = (a) => `${a.attr}\u0000${String(a.value).toLowerCase()}`;
  const usedA = new Array(ta.length).fill(false);
  sa.forEach((a) => {
    const i = ta.findIndex((b, j) => !usedA[j] && key(b) === key(a));
    if (i >= 0) { usedA[i] = true; return; }
    const others = ta.filter((b) => b.attr === a.attr && b.tag === a.tag).map((b) => q(b.value, 40)).slice(0, 3);
    flags.push({ sev: sev(a.interactive), kind: `MISSING ${a.attr.toUpperCase()}`, msg: `${S} <${a.tag}> ${a.attr}=${q(a.value)} has no ${T} <${a.tag}> with that ${a.attr}${others.length ? ` (${T} <${a.tag}> ${a.attr}s: ${others.join(', ')})` : ''}. ${H.MISSING_ATTRIBUTE}` });
  });
  ta.forEach((b, j) => { if (!usedA[j]) flags.push({ sev: '🟡', kind: `EXTRA ${b.attr.toUpperCase()}`, msg: `${T} <${b.tag}> ${b.attr}=${q(b.value)} has no ${S} source. ${H.EXTRA_ATTRIBUTE}` }); });

  const si = (src && src.icons) || []; const ti = (tgt && tgt.icons) || [];
  const usedI = new Array(ti.length).fill(false);
  // Three ordered passes over ALL source icons — exact (anchor + kind + value), then same kind at the anchor, then any
  // kind there — so an exact match is never stolen by an earlier source icon's fallback.
  const pairs = new Array(si.length).fill(-1);
  const passes = [(a, b) => b.anchor === a.anchor && b.kind === a.kind && b.value === a.value, (a, b) => b.anchor === a.anchor && b.kind === a.kind, (a, b) => b.anchor === a.anchor];
  for (const pred of passes) {
    si.forEach((a, k) => {
      if (pairs[k] >= 0) return;
      const i = ti.findIndex((b, j) => !usedI[j] && pred(a, b));
      if (i >= 0) { usedI[i] = true; pairs[k] = i; }
    });
  }
  si.forEach((a, k) => {
    const i = pairs[k];
    if (i < 0) { flags.push({ sev: sev(a.interactive), kind: 'MISSING ICON', msg: `${S} ${describeIcon(a)} at ${q(a.anchor || '(no anchor)', 40)} has no ${T} icon there. ${H.MISSING_ICON}` }); return; }
    const b = ti[i];
    if (b.kind !== a.kind) flags.push({ sev: '🟡', kind: 'ICON KIND', msg: `${S} ${describeIcon(a)} vs ${T} ${describeIcon(b)} at ${q(a.anchor, 40)}. ${H.ICON_KIND}` });
    else if (b.value !== a.value) flags.push({ sev: sev(a.interactive || b.interactive), kind: 'ICON DIFF', msg: `${S} ${describeIcon(a)} vs ${T} ${describeIcon(b)} at ${q(a.anchor, 40)}. ${H.ICON_DIFF}` });
  });
  ti.forEach((b, j) => { if (!usedI[j]) flags.push({ sev: '🟡', kind: 'EXTRA ICON', msg: `${T} ${describeIcon(b)} at ${q(b.anchor || '(no anchor)', 40)} has no ${S} source. ${H.EXTRA_ICON}` }); });
  return flags;
}

function parseArgs(argv) {
  const [, , proto, eds, ...rest] = argv;
  if (rest.includes('--help') || proto === '--help' || proto === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { main: null, width: 1280, json: false, profile: 'eds', ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait-until') { opts.waitUntil = rest[i += 1]; }
    else if (a === '--dismiss') {
      // optional value: bare --dismiss enables overlay dismissal with no extras
      const next = rest[i + 1];
      opts.dismiss = (next && !next.startsWith('--')) ? rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
  }
  return { proto, eds, opts };
}

async function grab(browser, url, opts, prof) {
  // UA + standard headers on EVERY context (live-session; F-R1 — UA alone
  // still 403s on Akamai), webdriver spoof included for the --headed tier.
  const ctx = await newLiveContext(browser, {
    ua: opts.ua, locale: opts.locale,
    viewport: { width: opts.width, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // challenge detection on every navigation — a blocked live side throws
  // BotChallengeError (exit 3), it is never measured as the source. A plain
  // HTTP error side is MEASURED (advisory contract): a 404 build is normal on
  // aem.page before preview propagation — the flags carry the signal, exit 0.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 0, httpError: 'measure', solveWindow: opts.headed });
  await page.waitForTimeout(1500);
  // late-modal poll window only on live targets — local prototypes' overlays
  // are not timed third-party scripts, they render immediately.
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  // scroll through to trigger reveal-on-scroll / lazy nodes, then return to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const inv = await page.evaluate(inventory, [opts.main || prof.mainDefault, prof.eyebrow]);
  inv.editable = await page.evaluate(editableInventory, [opts.main || prof.mainDefault]);
  inv.attrs = await page.evaluate(attributeInventory, [opts.main || prof.mainDefault]);
  await ctx.close();
  return inv;
}

async function main() {
  const { proto, eds, opts } = parseArgs(process.argv);
  if (!proto || !eds) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new Error(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} (${e.code || e.message}) — copy the diff skill's scripts dir into the project and run the copy`);
  }
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let srcInv; let tgtInv;
  try {
    srcInv = await grab(browser, proto, opts, prof);
    tgtInv = await grab(browser, eds, opts, prof);
  } finally {
    await browser.close();
  }

  const { flags } = diffInventories(srcInv.items, tgtInv.items, prof);
  process.stdout.write(`\nContent diff @ ${opts.width}px (profile "${prof.name}", root "${opts.main || prof.mainDefault}")\n`);
  process.stdout.write(`  ${prof.source}: ${summarise(srcInv)}\n`);
  process.stdout.write(`  ${prof.target}: ${summarise(tgtInv)}\n`);
  // Experience Workspace editability advisory (deploy SKILL.md § Experience Workspace
  // editability contract): the canvas can only attach an editor to an OUTERMOST
  // h1-h6/p/ul/ol element that survives decorate(); fewer on the build than on the
  // source means authored elements were rebuilt/merged into wrappers or text.
  const srcEd = srcInv.editable ? srcInv.editable.count : 0;
  const tgtEd = tgtInv.editable ? tgtInv.editable.count : 0;
  process.stdout.write(`  editable texts (outermost h*/p/ul/ol): ${prof.source} ${srcEd} / ${prof.target} ${tgtEd}\n`);
  if (tgtEd < srcEd) flags.push({ sev: '🟡', kind: 'EDITABLE COUNT', msg: `${prof.target} has ${tgtEd} outermost editable element(s) vs ${srcEd} in the ${prof.source} — fewer outermost editable elements after decoration usually means authored elements were rebuilt/merged — see deploy SKILL.md § Experience Workspace editability contract (run ew-editability-probe.mjs on the build URL for the per-block verdict).` });
  // The attribute + icon layer (header): placeholder / aria-label / title values and icons, paired and flagged.
  const sA = srcInv.attrs || { attrs: [], icons: [] }; const tA = tgtInv.attrs || { attrs: [], icons: [] };
  process.stdout.write(`  attributes (placeholder/aria-label/title): ${prof.source} ${sA.attrs.length} / ${prof.target} ${tA.attrs.length}; icons: ${prof.source} ${sA.icons.length} / ${prof.target} ${tA.icons.length}\n`);
  flags.push(...diffAttributes(sA, tA, prof));

  if ((srcInv.items.length < 3 || tgtInv.items.length < 3)) {
    process.stdout.write('\n⚠ one side has almost no content — a blank/failed render; fix that before trusting the diff.\n');
  }

  const order = { '🔴': 0, '🟠': 1, '🟡': 2 };
  flags.sort((a, b) => order[a.sev] - order[b.sev]);
  const strong = flags.filter((f) => f.sev === '🔴').length;
  process.stdout.write(`\nFindings: ${flags.length ? `${flags.length} (${strong} structural 🔴)` : 'none — content + roles match'}\n`);
  flags.forEach((f) => process.stdout.write(`  ${f.sev} ${f.kind}: ${f.msg}\n`));

  if (opts.json) {
    process.stdout.write('\nInventories JSON:\n');
    process.stdout.write(`${JSON.stringify({ [prof.source]: srcInv, [prof.target]: tgtInv, findings: flags }, null, 1)}\n`);
  }
}

// exit 3 = bot challenge on a live side (distinct from generic errors, so a
// gate runner can tell "blocked — escalate with --headed" from "probe broke").
// Main-module guard by real path (a symlinked checkout or temp dir must not turn the CLI into a no-op), so the
// contract test can import the pure exports without running a probe.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { process.stderr.write(`content-diff error: ${e.message}\n`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
}
