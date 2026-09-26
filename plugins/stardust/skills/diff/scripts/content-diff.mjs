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
 *     and no unpaired build icon of the same identity anywhere in the root
 *   - ICON DIFF      same anchor, same kind, different glyph / file / svg
 *   - ICON KIND      same anchor, different technique (glyph vs svg vs image) — 🟡,
 *     the pixel probe judges equivalence
 *   - ICON MOVED     the same icon (glyph code point / file name / svg signature)
 *     at another anchor — after the anchor passes, leftover icons pair by identity
 *     in document order, first within the same nearest block (keyed by its first
 *     heading), then within the root — 🟡, confirm. Measured on a delivered
 *     36-page replica: an FAQ page kept all seven accordion glyphs, but the build
 *     hosts them in text-less <button>s (anchored button#1…#7) while the source
 *     anchors each glyph to its question text — anchor-only pairing read
 *     7 × MISSING 🔴 + 7 × EXTRA 🟡 on a page whose icons were right.
 *   - EXTRA ICON     a build icon with no source icon at that anchor and no
 *     unpaired source icon of the same identity (🟡)
 *
 * Severity, attribute + icon layer (🔴 fails a gate round like a missing CTA;
 * 🟡 is a confirm). "Interactive" = an input, a button, a link (a[href], summary,
 * role=button|link|tab|menuitem) or an element inside one.
 *   finding                            interactive   elsewhere
 *   MISSING PLACEHOLDER / ARIA-LABEL   🔴            🟡
 *   MISSING TITLE                      🟡            🟡   a title tooltip is not read by most
 *                                                        assistive tech and is commonly dropped by design
 *   MISSING ICON, ICON DIFF            🔴            🟡
 *   ICON MOVED, ICON KIND              🟡            🟡
 *   EXTRA <ATTR>, EXTRA ICON           🟡            🟡
 *
 * Roots. `--main` takes one selector or a comma-separated list; every root is
 * inventoried (text, editable set, attributes + icons) and diffed on its own; the
 * report prints one block per root and every finding carries its root (`[header]`
 * on the line, `root` in the JSON). `--chrome` (default on) adds the `header`
 * and `footer` roots beside the main root(s), resolved as the first <header> /
 * [role="banner"] (resp. <footer> / [role="contentinfo"]) OUTSIDE the main root(s)
 * so an article header never doubles as chrome; `--no-chrome` disables. The first
 * `--main` root keeps the legacy fallback (→ <main> → <body>, said on its root
 * line); any other root a side lacks is measured as EMPTY on that side and the
 * root line says which — a build that dropped its footer reads MISSING there, a
 * source whose chrome is not a landmark element reads EXTRA (🟡) for the build's
 * chrome; a root absent on both sides is listed, not compared. Measured: the
 * default root `main` excluded the header, so the two chrome cases this layer was
 * written for (the search input's localized placeholder, a locale root's flag)
 * were invisible unless the caller passed `--main header`.
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
 *     --main <sel[,sel…]>   content root(s), comma-separated  (default from the profile: "main")
 *     --chrome | --no-chrome  also compare the header and footer roots (default on)
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
 * Output: `Content diff @ <w>px (profile "<p>", roots: main, header, footer)`, then per
 * root a `root "<name>"` line (absent / fell-back notes) with the side summaries, the
 * editable count and the attribute + icon counts; then `Findings: none — content +
 * roles match` | `Findings: N (S structural 🔴)` and one `  <sev> <KIND> [<root>]: <msg>`
 * line per finding (gate.sh and gate-evidence read the Findings line only); with
 * --json, `Inventories JSON:` followed by { primaryRoot, [source]: inv, [build]: inv
 * (the first root), roots: { <other root>: { [source]: inv, [build]: inv } },
 * findings: [{ sev, kind, root, msg }] }.
 *
 * attributeInventory (in-page) and diffAttributes, parseRoots, diffRoot, formatFinding
 * (pure) are exported; playwright is imported lazily in main, so the contract test runs
 * the differ without a browser.
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
  --main <sel[,sel…]>    content root(s), comma-separated (default from profile: main)
  --chrome | --no-chrome also compare the header and footer roots beside the main root(s)
                         (default on; header = first <header>/[role=banner] outside the main
                         root(s), footer likewise with [role=contentinfo]; a side lacking one
                         is measured as empty there and the root line says so)
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
            MISSING ICON, ICON DIFF, ICON KIND, EXTRA ICON, ICON MOVED (same icon at another
            anchor, paired by identity + document order). 🔴 = MISSING PLACEHOLDER|ARIA-LABEL,
            MISSING ICON, ICON DIFF on an interactive element (input, button, link or inside
            one); MISSING TITLE, ICON MOVED, ICON KIND and every EXTRA are 🟡; else 🟡.
            Each finding line carries its root — "<sev> <KIND> [<root>]: <msg>"; the
            Findings: line is unchanged.
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
//   block  the nearest block-ish ancestor (section, article, nav, aside, form, header, footer, .block, .section,
//          [data-block-name]) keyed by its first heading's text, '' when none — the scope the ICON MOVED pass pairs within first.
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
  const BLOCK = 'section, article, nav, aside, form, header, footer, [class~="block"], [class~="section"], [data-block-name]';
  const blockOf = (el) => {
    const b = el.parentElement && el.parentElement.closest(BLOCK);
    if (!b || b === root || !root.contains(b)) return '';
    const h = b.querySelector('h1, h2, h3, h4, h5, h6');
    return h ? norm(h.textContent).slice(0, 60) : '';
  };
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
      if (w > 0 && h > 0 && w <= 64 && h <= 64) icons.push({ kind: 'img', value: fileOf(el.currentSrc || el.src), size: `${Math.round(w)}×${Math.round(h)}`, interactive, anchor: anchorOf(el), block: blockOf(el) });
      return;
    }
    if (tag === 'svg') {
      const use = el.querySelector('use');
      const ref = (use && (use.getAttribute('href') || use.getAttribute('xlink:href'))) || '';
      const title = el.querySelector('title');
      const value = (ref.includes('#') ? ref.slice(ref.lastIndexOf('#')) : '') || clean(el.getAttribute('aria-label')) || (title && clean(title.textContent)) || `${el.getAttribute('viewBox') || 'no viewBox'} / ${el.querySelectorAll('path, circle, rect, polygon, line, polyline, ellipse').length} shape(s)`;
      icons.push({ kind: 'svg', value, size: size(el), interactive, anchor: anchorOf(el), block: blockOf(el) });
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
      icons.push({ kind: 'glyph', value: `${before}${after}`, family, size: size(el), interactive, anchor: anchorOf(el), block: blockOf(el) });
      return;
    }
    if (!iconClass) return; // an empty inline element with no generated content is nothing
    const mask = urlFile(cs.maskImage || cs.webkitMaskImage); const bg = urlFile(cs.backgroundImage);
    if (mask || bg) { icons.push({ kind: 'css', value: mask ? `mask:${mask}` : `bg:${bg}`, size: size(el), interactive, anchor: anchorOf(el), block: blockOf(el) }); return; }
    icons.push({ kind: 'glyph', value: '', family: '', size: size(el), interactive, anchor: anchorOf(el), block: blockOf(el) }); // the empty icon box
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
  ICON_MOVED: 'Same icon, different anchor — usually a text-less host (a <button> with no label anchors as button#n) or moved anchor text; confirm it sits on the right element, and give an unlabeled interactive host an aria-label.',
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
// kind + value, then same kind, then any kind at that anchor), then leftovers by IDENTITY + document order (ICON MOVED).
// 🔴 when the element is interactive, 🟡 otherwise; MISSING TITLE, ICON MOVED, ICON KIND and every EXTRA are 🟡 (severity
// table in the header).
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
    flags.push({ sev: a.attr === 'title' ? '🟡' : sev(a.interactive), kind: `MISSING ${a.attr.toUpperCase()}`, msg: `${S} <${a.tag}> ${a.attr}=${q(a.value)} has no ${T} <${a.tag}> with that ${a.attr}${others.length ? ` (${T} <${a.tag}> ${a.attr}s: ${others.join(', ')})` : ''}. ${H.MISSING_ATTRIBUTE}` });
  });
  ta.forEach((b, j) => { if (!usedA[j]) flags.push({ sev: '🟡', kind: `EXTRA ${b.attr.toUpperCase()}`, msg: `${T} <${b.tag}> ${b.attr}=${q(b.value)} has no ${S} source. ${H.EXTRA_ATTRIBUTE}` }); });

  const si = (src && src.icons) || []; const ti = (tgt && tgt.icons) || [];
  const usedI = new Array(ti.length).fill(false);
  // Three ordered passes over ALL source icons — exact (anchor + kind + value), then same kind at the anchor, then any
  // kind there — so an exact match is never stolen by an earlier source icon's fallback.
  const pairs = new Array(si.length).fill(-1); const moved = new Array(si.length).fill(false);
  const passes = [(a, b) => b.anchor === a.anchor && b.kind === a.kind && b.value === a.value, (a, b) => b.anchor === a.anchor && b.kind === a.kind, (a, b) => b.anchor === a.anchor];
  for (const pred of passes) {
    si.forEach((a, k) => {
      if (pairs[k] >= 0) return;
      const i = ti.findIndex((b, j) => !usedI[j] && pred(a, b));
      if (i >= 0) { usedI[i] = true; pairs[k] = i; }
    });
  }
  // Pass 4 — identity + order: a source icon still unpaired takes the first unpaired build icon of the SAME identity (kind +
  // value: glyph code point, file name, svg signature) in document order — first within the same nearest block (equal block
  // keys), then anywhere in the root. Such a pair is ICON MOVED 🟡: the icon is present, anchored differently (a text-less
  // <button> host anchors as button#n where the source anchored to its item text) — never MISSING + EXTRA. Empty icon boxes
  // have no identity to pair by.
  const ident = (ic) => `${ic.kind}\u0000${ic.value}`;
  for (const scope of [(a, b) => Boolean(a.block) && a.block === b.block, () => true]) {
    si.forEach((a, k) => {
      if (pairs[k] >= 0 || !a.value) return;
      const i = ti.findIndex((b, j) => !usedI[j] && ident(b) === ident(a) && scope(a, b));
      if (i >= 0) { usedI[i] = true; pairs[k] = i; moved[k] = true; }
    });
  }
  si.forEach((a, k) => {
    const i = pairs[k];
    if (i < 0) { flags.push({ sev: sev(a.interactive), kind: 'MISSING ICON', msg: `${S} ${describeIcon(a)} at ${q(a.anchor || '(no anchor)', 40)} has no ${T} icon there. ${H.MISSING_ICON}` }); return; }
    const b = ti[i];
    if (moved[k]) flags.push({ sev: '🟡', kind: 'ICON MOVED', msg: `${S} ${describeIcon(a)} at ${q(a.anchor || '(no anchor)', 40)} is at ${q(b.anchor || '(no anchor)', 40)} in the ${T} — same icon, paired by order${a.block && a.block === b.block ? ` within ${q(a.block, 40)}` : ''}. ${H.ICON_MOVED}` });
    else if (b.kind !== a.kind) flags.push({ sev: '🟡', kind: 'ICON KIND', msg: `${S} ${describeIcon(a)} vs ${T} ${describeIcon(b)} at ${q(a.anchor, 40)}. ${H.ICON_KIND}` });
    else if (b.value !== a.value) flags.push({ sev: sev(a.interactive || b.interactive), kind: 'ICON DIFF', msg: `${S} ${describeIcon(a)} vs ${T} ${describeIcon(b)} at ${q(a.anchor, 40)}. ${H.ICON_DIFF}` });
  });
  ti.forEach((b, j) => { if (!usedI[j]) flags.push({ sev: '🟡', kind: 'EXTRA ICON', msg: `${T} ${describeIcon(b)} at ${q(b.anchor || '(no anchor)', 40)} has no ${S} source. ${H.EXTRA_ICON}` }); });
  return flags;
}

// ---- roots ---------------------------------------------------------------------------------------
export const EMPTY_INVENTORY = () => ({ items: [], imgCount: 0, editable: { count: 0, items: [] }, attrs: { attrs: [], icons: [] } });
// The chrome roots --chrome adds: the first landmark of each kind OUTSIDE the main root(s), so a <header> inside an article
// or a <footer> inside the content root never doubles as chrome.
export const CHROME_ROOTS = [{ name: 'header', tag: 'header', role: 'banner' }, { name: 'footer', tag: 'footer', role: 'contentinfo' }];
export function chromeSelector(tag, role, mains) {
  const outside = (x) => mains.map((m) => `:not(${m} ${x})`).join('');
  return `${tag}${outside(tag)}, [role="${role}"]${outside(`[role="${role}"]`)}`;
}
// Pure: the roots one run compares — `--main` split on commas (the first is PRIMARY: it keeps the in-page fallback), then the
// chrome roots unless --no-chrome (or the profile says chromeDefault: false), skipping one the caller listed under --main.
export function parseRoots(main, chrome, prof) {
  const dflt = (prof && prof.mainDefault) || 'main';
  const mains = [...new Set(String(main || dflt).split(',').map((x) => x.trim()).filter(Boolean))];
  if (!mains.length) mains.push(dflt);
  const roots = mains.map((sel, i) => ({ name: sel, sel, primary: i === 0, chrome: false, describe: `"${sel}"` }));
  const on = chrome === null || chrome === undefined ? !(prof && prof.chromeDefault === false) : Boolean(chrome);
  if (on) CHROME_ROOTS.forEach((c) => { if (!mains.includes(c.tag)) roots.push({ name: c.name, sel: chromeSelector(c.tag, c.role, mains), primary: false, chrome: true, describe: `no <${c.tag}> / [role="${c.role}"] outside the main root(s)` }); });
  return roots;
}
// Pure: diff one root's two inventories → { flags (each tagged with the root), lines (the root's report block) }. Both layers
// run here — text/roles (diffInventories), the editable count and the attribute + icon layer — so a chrome root is measured
// exactly like main. A side that lacks the root arrives as { absent: true } (empty), the primary root's fallback as fellBack.
export function diffRoot(root, srcInv, tgtInv, prof) {
  const S = prof.source; const T = prof.target;
  const s = srcInv || { ...EMPTY_INVENTORY(), absent: true }; const t = tgtInv || { ...EMPTY_INVENTORY(), absent: true };
  const lines = [];
  if (s.absent && t.absent) { lines.push(`root "${root.name}": absent on both sides (${root.describe}) — not compared`); return { flags: [], lines }; }
  const note = (inv, side) => (inv.absent ? `${side}: absent (${root.describe}) — measured as empty` : inv.fellBack ? `${side}: ${root.describe} absent, fell back to <${inv.fellBack}>` : '');
  const notes = [note(s, S), note(t, T)].filter(Boolean);
  lines.push(`root "${root.name}"${notes.length ? ` — ${notes.join('; ')}` : ''}`);
  lines.push(`  ${S}: ${summarise(s)}`);
  lines.push(`  ${T}: ${summarise(t)}`);
  const { flags } = diffInventories(s.items || [], t.items || [], prof);
  // Experience Workspace editability advisory (deploy SKILL.md § Experience Workspace editability contract): the canvas can
  // only attach an editor to an OUTERMOST h1-h6/p/ul/ol element that survives decorate(); fewer on the build than on the
  // source means authored elements were rebuilt/merged into wrappers or text.
  const srcEd = s.editable ? s.editable.count : 0; const tgtEd = t.editable ? t.editable.count : 0;
  lines.push(`  editable texts (outermost h*/p/ul/ol): ${S} ${srcEd} / ${T} ${tgtEd}`);
  if (tgtEd < srcEd) flags.push({ sev: '🟡', kind: 'EDITABLE COUNT', msg: `${T} has ${tgtEd} outermost editable element(s) vs ${srcEd} in the ${S} — fewer outermost editable elements after decoration usually means authored elements were rebuilt/merged — see deploy SKILL.md § Experience Workspace editability contract (run ew-editability-probe.mjs on the build URL for the per-block verdict).` });
  const sA = s.attrs || { attrs: [], icons: [] }; const tA = t.attrs || { attrs: [], icons: [] };
  lines.push(`  attributes (placeholder/aria-label/title): ${S} ${sA.attrs.length} / ${T} ${tA.attrs.length}; icons: ${S} ${sA.icons.length} / ${T} ${tA.icons.length}`);
  flags.push(...diffAttributes(sA, tA, prof));
  return { flags: flags.map((f) => ({ ...f, root: root.name })), lines };
}
export const formatFinding = (f) => `  ${f.sev} ${f.kind}${f.root ? ` [${f.root}]` : ''}: ${f.msg}`;

function parseArgs(argv) {
  const [, , proto, eds, ...rest] = argv;
  if (rest.includes('--help') || proto === '--help' || proto === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { main: null, chrome: null, width: 1280, json: false, profile: 'eds', ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--chrome') { opts.chrome = true; }
    else if (a === '--no-chrome') { opts.chrome = false; }
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

async function grab(browser, url, opts, prof, roots) {
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
  // One inventory set per root. Presence first: a non-primary root the page lacks is measured as EMPTY ({ absent: true })
  // and its root line says so; the primary root keeps the in-page fallback (→ <main> → <body>) and reports it (fellBack).
  const invs = {};
  for (const root of roots) {
    const found = await page.evaluate((sel) => (document.querySelector(sel) ? 'yes' : document.querySelector('main') ? 'main' : 'body'), root.sel);
    if (found !== 'yes' && !root.primary) { invs[root.name] = { ...EMPTY_INVENTORY(), absent: true }; continue; }
    const inv = await page.evaluate(inventory, [root.sel, prof.eyebrow]);
    inv.editable = await page.evaluate(editableInventory, [root.sel]);
    inv.attrs = await page.evaluate(attributeInventory, [root.sel]);
    if (found !== 'yes') inv.fellBack = found;
    invs[root.name] = inv;
  }
  await ctx.close();
  return invs;
}

async function main() {
  const { proto, eds, opts } = parseArgs(process.argv);
  if (!proto || !eds) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  const roots = parseRoots(opts.main, opts.chrome, prof);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new Error(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} (${e.code || e.message}) — copy the diff skill's scripts dir into the project and run the copy`);
  }
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let srcInvs; let tgtInvs;
  try {
    srcInvs = await grab(browser, proto, opts, prof, roots);
    tgtInvs = await grab(browser, eds, opts, prof, roots);
  } finally {
    await browser.close();
  }

  process.stdout.write(`\nContent diff @ ${opts.width}px (profile "${prof.name}", roots: ${roots.map((r) => r.name).join(', ')})\n`);
  const flags = [];
  for (const root of roots) {
    const { flags: rf, lines } = diffRoot(root, srcInvs[root.name], tgtInvs[root.name], prof);
    lines.forEach((l) => process.stdout.write(`${l}\n`));
    flags.push(...rf);
  }

  const primary = roots[0].name;
  if ((srcInvs[primary].items.length < 3 || tgtInvs[primary].items.length < 3)) {
    process.stdout.write('\n⚠ one side has almost no content — a blank/failed render; fix that before trusting the diff.\n');
  }

  const order = { '🔴': 0, '🟠': 1, '🟡': 2 };
  flags.sort((a, b) => order[a.sev] - order[b.sev]);
  const strong = flags.filter((f) => f.sev === '🔴').length;
  process.stdout.write(`\nFindings: ${flags.length ? `${flags.length} (${strong} structural 🔴)` : 'none — content + roles match'}\n`);
  flags.forEach((f) => process.stdout.write(`${formatFinding(f)}\n`));

  if (opts.json) {
    const others = {};
    roots.slice(1).forEach((r) => { others[r.name] = { [prof.source]: srcInvs[r.name], [prof.target]: tgtInvs[r.name] }; });
    process.stdout.write('\nInventories JSON:\n');
    process.stdout.write(`${JSON.stringify({ primaryRoot: primary, [prof.source]: srcInvs[primary], [prof.target]: tgtInvs[primary], roots: others, findings: flags }, null, 1)}\n`);
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
