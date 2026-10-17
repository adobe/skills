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
 *                        every match gets display:none !important, and a
 *                        <style data-stardust-hide> rule per selector hides a bar the
 *                        page re-renders later too (live-session's hideRegions); per
 *                        side and selector its match count and summed height are
 *                        recorded (×0 = a stale selector, an invalid one is an error entry)
 *     --slug <slug>      the page's key in presence.json: its "variable" regions and
 *                        "hide" list too, after "*"'s (without it only "*" is read)
 *     --presence <file>  the same from gate-all's presence.json (needs --slug)
 *                        (stardust/replica/gates/{all,prototypes}-<w>/):
 *                        { "*": { "hide": [<sel>, …] }, "<slug>": { "variable":
 *                        ["<sel>[=<buildSel>]", …], "hide": [<sel>, …] } } — "hide"
 *                        ("*" for every slug, then the slug's own) on both sides; a
 *                        "variable" entry hides <sel> live, <buildSel> or <sel> on the
 *                        build; "main" is ignored; a missing file or slug hides nothing
 *     --headed           headed stealth real Chrome (bot-managed live sites)
 *     --locale <tag>     pin Accept-Language + locale (e.g. en-GB)
 *     --json             machine-readable output
 *     --live-cache <f>   reuse the live side's measurement from <f> (JSON) when it
 *                        exists for the same URL, width, region selectors and live
 *                        hide list (keyed only when non-empty); probe
 *                        and write it otherwise. Same contract as gate.sh's live.png:
 *                        one live navigation per breakpoint per full gate run, delete
 *                        the file to re-probe. The file keeps the live hide records
 *                        (with their recount) and the in-flow blocks above the live
 *                        header; one written without the latter (an older
 *                        chrome-parity) is re-probed. Convention:
 *                        stardust/replica/gates/<slug>-<w>/chrome-live.json
 *
 * Site-wide presence file: stardust/replica/presence.json (cwd-relative = the project
 * root) is read by default, with no flag — its "*" entry, plus the --slug entry when
 * given (--slug no longer needs --presence); a --presence file is merged over it
 * (live-session's readPresenceFile / mergePresence: the gate dir's field wins per key).
 * Its selectors are attributed `site presence.json`, the gate dir's `presence.json`. A
 * malformed file (either) is an error naming it, exit 1 before any navigation.
 *
 * Hide misses (live side): right before measuring, the live page's hide matches are
 * recounted (live-session's recountHides); a selector that matched nothing — ×0 at the
 * hide pass AND at the measurement (a block injected after the hide pass is still
 * hidden by the style rule and counted then) — prints ONE line
 *   WARNING hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)
 * (live-session's hideMissLine) naming the in-flow blocks above the live header
 * (inFlowRegionsAboveHeader; `none found above the header` when there are none). A
 * warning — never silent, never a verdict or exit-code change.
 *
 * Offset hint: when every matched chrome text pair shows the same vertical offset on
 * one side (≥ 3 pairs, |Δy| > tolerance, all within tolerance of each other) — an
 * in-flow region above the header that only one side has — one line names the
 * candidate to hide:
 *   hint: an in-flow region above the header — presence.mjs add --hide <candidate selector>
 * the in-flow block above the header on the side whose content sits lower whose height
 * is closest to |Δy| (the first on a tie), read off that side's DOM;
 * ` (0px now — a block that grows later is still hidden by the persistent
 * display:none !important rule)` follows a 0-px one, and with no block found it reads
 * `… --hide <selector> (no in-flow block found above the header on the <side> side)`.
 *
 * Example:
 *   node stardust/scripts/replica/chrome-parity.mjs "https://<site>/" "http://localhost:8791/home-proposed.html" \
 *     --region header=header --region strip=".quick-links|.quicklinks" --region footer=footer
 *
 * Output: after the live/build lines, `hidden live:` / `hidden build:` lines
 * (`<sel> ×<n> (<h>px) [--hide|presence.json|site presence.json]`) when a hide list is set,
 * one `presence:` line (variable and hide counts, the file(s) read) with --presence or a
 * site file, and the `WARNING hide matched nothing on live — …` line on a live miss; the
 * `hint: …` line just before the closing ✗/✓ line. --json carries
 * `hidden: { live, build }` (entries { sel, source, n, h, error? }; a live entry adds
 * `nAtCapture`, its count right before measuring), `presence:
 * { file, slug, regions, hide?, note, site?, hideSources?, variableSource? } | null` (hide only when the file has
 * entries for the slug; site / hideSources / variableSource only when the site file was read — file is null without
 * --presence; null when neither file is in play), `hideMiss: { sels, candidates } | null` (candidates = the in-flow
 * blocks above the live header) and `hint: <the hint line> | null`; with --json the WARNING and hint lines go to
 * stderr (stdout stays one JSON document). Per region: the
 * region box delta, then one line per paired element
 * listing only the properties that differ, then MISSING (live-only) / EXTRA
 * (build-only) texts and the icon inventory. Exit 0 = parity within tolerance,
 * 2 = deltas printed (fix them, re-run), 1 = error, 3 = bot challenge on the
 * live side (fail loud — never measured).
 *
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both); both are imported
 * inside main(), so --help and the exported pure functions (parseArgs,
 * hideLists, cacheKey, compareRegion, pairOffsets, uniformOffset, offsetHint,
 * chromeHint, liveHideMiss) need neither (the async readPresence
 * loads live-session). Each run is one live
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
                     BOTH sides after the settle, before measuring (repeatable; count + height printed);
                     a style rule hides a bar the page re-renders later too
  --slug <slug>      the page's key in presence.json: its "variable" regions and "hide" list too
  --presence <file>  hide the slug's "variable" regions ("<sel>=<buildSel>" halves) and its "hide" list
                     ("*" applies to every slug) from gate-all's presence.json the same way
                     (stardust/replica/gates/{all,prototypes}-<w>/; needs --slug), merged over the site file
  --headed           headed stealth real Chrome (bot-managed live sites)
  --locale <tag>     pin Accept-Language + locale
  --json             machine-readable output (adds hideMiss and hint; WARNING / hint lines on stderr)
  --live-cache <f>   reuse/write the live side's measurement (JSON) — one live hit per breakpoint
  --help             this text

The site-wide stardust/replica/presence.json (cwd-relative) is read by default, no flag needed: its "*"
entry, plus the --slug entry when given; its selectors print as [site presence.json]. A malformed
presence.json (either file) is an error naming it, before any navigation.

On the live page the hide matches are recounted right before measuring; a selector that matched nothing
(×0 at the hide pass and at the measurement) prints one line naming the in-flow blocks above the header:
  WARNING hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)
a warning, never a verdict. When every paired chrome text is offset by the same Δy on one side (≥ 3 pairs,
|Δy| > tolerance, all within tolerance of each other), one line names the block to hide — the in-flow block
above the header on the lower side whose height is closest to |Δy|:
  hint: an in-flow region above the header — presence.mjs add --hide <candidate selector>

Exit codes: 0 parity within tolerance, 2 deltas printed, 1 error (also a malformed presence.json),
3 bot challenge (live side).`;

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
 * The presence record for one run, read by live-session's readPresenceFile → { file, slug, regions, hide?, note,
 * site?, hideSources?, variableSource? } | null: `regions` = the "variable" { live, build } halves, `hide` = "*".hide
 * then <slug>.hide (both sides; the key only when non-empty, so the JSON of a file without hide entries stays as it
 * was). The site-wide file (`site`, default live-session's SITE_PRESENCE, cwd-relative; null = gate file only) is
 * merged under `file` — `file` may be null (the site file alone: its "*", plus the slug's entry when a slug is given);
 * when it was read the record adds `site` (its path), `hideSources` ([{ sel, source }], source `presence.json` or
 * `site presence.json`; with hide) and `variableSource` (with regions). Neither file in play (`file` null and no site
 * file) → null. A missing `file` or slug hides nothing (the note says so); malformed JSON (either file) rejects with
 * `presence.json <file> unreadable (…)`.
 */
export async function readPresence(file, slug, { site } = {}) {
  const { readPresenceFile, SITE_PRESENCE } = await loadLiveSession();
  const siteFile = site === undefined ? SITE_PRESENCE : site;
  if (!file && !(siteFile && existsSync(siteFile))) return null;
  const p = readPresenceFile(file, slug, { site: siteFile });
  const merged = p.site ? { site: p.site, ...(p.hide.length ? { hideSources: p.hideSources } : {}), ...(p.variable.length ? { variableSource: p.variableSource } : {}) } : {};
  return { file: p.file, slug: p.slug, regions: p.variable, ...(p.hide.length ? { hide: p.hide } : {}), note: p.note, ...merged };
}

/** Per-side hide lists: --hide on both sides, then the presence "variable" regions (live / build half), then the
 * presence "hide" list (both sides); a repeated selector keeps its first source. A presence selector's source is the
 * file it came from — `presence.json` (a gate dir's) or `site presence.json` (hideSources / variableSource when the
 * site file was read). */
export function hideLists(hide, presence) {
  const p = presence || {};
  const hideFrom = p.hideSources || (p.hide || []).map((sel) => ({ sel, source: 'presence.json' }));
  const side = (k) => {
    const out = [];
    const add = (sel, source) => { if (sel && !out.some((x) => x.sel === sel)) out.push({ sel, source }); };
    hide.forEach((sel) => add(sel, '--hide'));
    (p.regions || []).forEach((r) => add(r[k], p.variableSource || 'presence.json'));
    hideFrom.forEach((x) => add(x.sel, x.source));
    return out;
  };
  return { live: side('live'), build: side('build') };
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

// ------------------------------------------- offset hint and live hide misses

/** Every matched chrome text pair's vertical offset (build − live, document px — diffRect's Δy sign) across the named
 * regions found on both sides, paired by text like compareRegion → [{ region, text, dy }]. */
export function pairOffsets(L, B, names) {
  const out = [];
  for (const name of names) {
    const l = L && L[name]; const b = B && B[name];
    if (!l || !b || !l.found || !b.found) continue;
    for (const [x, y] of pairAtoms(l.atoms || [], b.atoms || []).pairs) out.push({ region: name, text: x.text, dy: y.rect.y - x.rect.y });
  }
  return out;
}

/** The same vertical offset on every pair → { dy, side, pairs } | null: at least 3 pairs, every |dy| > tol and all
 * within tol of each other (so one sign). `dy` = the lower median (a measured value); `side` = the side whose content
 * sits lower — `live` for a negative dy (live y larger), `build` for a positive one. */
export function uniformOffset(offsets, tol) {
  const dys = (offsets || []).map((o) => o.dy);
  if (dys.length < 3 || dys.some((d) => !(Math.abs(d) > tol))) return null;
  const sorted = [...dys].sort((a, b) => a - b);
  if (sorted[sorted.length - 1] - sorted[0] > tol) return null;
  const dy = sorted[Math.floor((sorted.length - 1) / 2)];
  return { dy, side: dy < 0 ? 'live' : 'build', pairs: dys.length };
}

const HINT = 'hint: an in-flow region above the header — presence.mjs add --hide';
const ZERO_PX = ' (0px now — a block that grows later is still hidden by the persistent display:none !important rule)';

/** A uniform offset + that side's in-flow blocks above the header (live-session's inFlowRegionsAboveHeader, document
 * order) → the hint line | null (no offset): the entry whose height is closest to |dy| (the first on a tie — the first
 * entry when nothing else decides), ZERO_PX after a 0-px one; no entry with a selector → the `<selector>` placeholder
 * and `(no in-flow block found above the header on the <side> side)`. */
export function offsetHint(offset, candidates) {
  if (!offset) return null;
  const rows = (candidates || []).filter((c) => c && typeof c.selector === 'string' && c.selector);
  if (!rows.length) return `${HINT} <selector> (no in-flow block found above the header on the ${offset.side} side)`;
  const want = Math.abs(offset.dy);
  const gap = (c) => { const g = Math.abs(Number(c.height) - want); return Number.isFinite(g) ? g : Infinity; };
  const best = rows.reduce((a, c) => (gap(c) < gap(a) ? c : a), rows[0]);
  return `${HINT} ${best.selector}${Number(best.height) === 0 ? ZERO_PX : ''}`;
}

/** Both sides' measurements → the hint line | null: pairOffsets over the region names, uniformOffset at `tol`, then
 * offsetHint with `above[<side>]` (the in-flow blocks above the header on the side whose content sits lower). */
export function chromeHint(L, B, names, tol, above) {
  const offset = uniformOffset(pairOffsets(L, B, names), tol);
  return offset ? offsetHint(offset, (above || {})[offset.side]) : null;
}

/** The live side's hide records (recounted: nAtCapture) + the in-flow blocks above the live header → { hideMiss:
 * { sels, candidates } | null, warning: 'WARNING <hideMissLine>' | null }, with live-session's hideMisses and
 * hideMissLine passed in (a selector "matched nothing" when ×0 at the hide pass and at the measurement). */
export function liveHideMiss(records, candidates, { hideMisses, hideMissLine }) {
  const sels = hideMisses(records || []);
  if (!sels.length) return { hideMiss: null, warning: null };
  const list = Array.isArray(candidates) ? candidates : [];
  return { hideMiss: { sels, candidates: list }, warning: `WARNING ${hideMissLine(sels, list)}` };
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
  const { isLiveHttpUrl, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil, hideRegions, inFlowRegionsAboveHeader, recountHides } = session;
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed && isLive });
  await dismissOverlays(page, { extra: isLive ? [...(opts.consent ? [opts.consent] : []), ...opts.dismiss] : [], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await settleTop(page);
  let hidden = await hideRegions(page, hides);
  // the hint's and the warning's candidates, then (live) each hide selector's count right before measuring
  const above = await inFlowRegionsAboveHeader(page);
  if (isLive) hidden = await recountHides(page, hidden);
  const out = {};
  for (const reg of opts.regions) out[reg.name] = await page.evaluate(probeRegion, isLive ? reg.live : reg.build);
  await ctx.close();
  return { data: out, hidden, above };
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
    if (!Array.isArray(c.above)) { console.error(`chrome-parity: --live-cache ${file} has no record of the in-flow blocks above the live header (an older chrome-parity wrote it) — re-probing live`); return null; }
    return c;
  } catch (e) { console.error(`chrome-parity: --live-cache ${file} unreadable (${e.message}) — re-probing live`); return null; }
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const { live, build, opts } = parseArgs(args);
  const presence = await readPresence(opts.presence, opts.slug);
  const hides = hideLists(opts.hide, presence);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) { throw new Error(`playwright is not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`); }
  const session = await loadLiveSession();
  const browser = opts.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  let total = 0;
  try {
    const cached = readLiveCache(opts.liveCache, live, opts, hides.live);
    const liveSide = cached ? { data: cached.data, hidden: cached.hidden || [], above: cached.above } : await probeSide(browser, session, live, opts, true, hides.live);
    if (opts.liveCache && !cached) {
      mkdirSync(dirname(opts.liveCache), { recursive: true });
      writeFileSync(opts.liveCache, JSON.stringify({ key: cacheKey(live, opts, hides.live), probedAt: new Date().toISOString(), data: liveSide.data, hidden: liveSide.hidden, above: liveSide.above }, null, 2));
    }
    const liveNote = cached ? ` (live side from cache ${opts.liveCache}, probed ${cached.probedAt} — delete the file to re-probe)` : '';
    const buildSide = await probeSide(browser, session, build, opts, false, hides.build);
    const L = liveSide.data; const B = buildSide.data;
    const hidden = { live: liveSide.hidden, build: buildSide.hidden };
    const regions = opts.regions.map((reg) => compareRegion(reg.name, L[reg.name], B[reg.name], opts.tolerance));
    total = regions.reduce((n, r) => n + r.findings.length, 0);
    const { hideMiss, warning } = liveHideMiss(hidden.live, liveSide.above, session);
    const hint = chromeHint(L, B, opts.regions.map((r) => r.name), opts.tolerance, { live: liveSide.above, build: buildSide.above });
    if (opts.json) {
      // stdout stays one JSON document: the warning and the hint (also recorded below) go to stderr
      if (warning) console.error(warning);
      if (hint) console.error(hint);
      console.log(JSON.stringify({ live, build, width: opts.width, tolerance: opts.tolerance, liveCache: cached ? { file: opts.liveCache, probedAt: cached.probedAt } : null, hidden, presence, hideMiss, hint, regions, raw: { live: L, build: B } }, null, 2));
    } else {
      console.log(`chrome-parity @ ${opts.width}px, tolerance ${opts.tolerance}px\n  live:  ${live}${liveNote}\n  build: ${build}`);
      if (hidden.live.length || hidden.build.length) console.log(`  hidden live:  ${session.formatHidden(hidden.live)}\n  hidden build: ${session.formatHidden(hidden.build)}`);
      if (presence) console.log(`  presence: ${presence.note}`);
      if (warning) console.log(warning);
      for (const r of regions) {
        const inv = r.inventory ? ` — ${r.pairs} paired of ${r.inventory.live.atoms}/${r.inventory.build.atoms} texts, ${r.inventory.live.icons}/${r.inventory.build.icons} icons` : '';
        console.log(`\n■ ${r.name}: ${r.findings.length ? `${r.findings.length} delta(s)` : '✓ parity'}${inv}`);
        for (const f of r.findings) console.log(`  ${f.kind.padEnd(12)} ${f.text ? `"${f.text.slice(0, 40)}"  ` : ''}${f.msg}`);
      }
      if (hint) console.log(`\n${hint}`);
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
