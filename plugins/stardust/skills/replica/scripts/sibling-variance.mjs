#!/usr/bin/env node
/**
 * skills/replica/scripts/sibling-variance.mjs
 *
 * Live-variance probe for sibling fan-out: BEFORE cloning a gated archetype
 * onto its "same-template" siblings, measure the template-defining computed
 * values on each sibling's LIVE page and diff them against the archetype's.
 * Vendor templates are not constant: eight siblings of one gated archetype
 * varied in ways the crawl JSON never showed — a compact hero (441 vs 528px,
 * wider card, smaller logo), an INVERTED hero scrim (0.6→0.1 vs 0.1→0.5), list
 * bullets split into two visual families (arrow-image `::before` vs plain
 * disc), terms sections in three shapes. Each delta found here is first-class
 * work to budget — a block VARIANT class emitted by the sibling generator —
 * not an edge case discovered at the pixel gate. The probe is read-only
 * evidence; it changes nothing in the clone.
 * Content is not variance: image and background url() FILENAMES are ignored
 * (a sibling's own photo is the source's choice — replicate it); only the
 * layer stack, geometry and computed styles are compared.
 *
 * The verdict is RECORDED, not only printed: a recorded hands-off run's probe
 * exited 2 on every template and the siblings were cloned anyway, because no
 * file the cloning step reads held the verdict. Every run that probed every
 * page (exit 0 or 2 — never 1 or 3) writes the variance sidecar
 * <variance-dir>/<template>.json (atomic):
 *   { template, archetype, at, siblings: [{ slug, url, verdict same|differs,
 *     variant: <name> (on differs — the variant class it takes on its template),
 *     missing: [<probe>…], extra: [<probe>…], deltas: [{ kind, probe?, msg }] }] }
 * siblings sorted by slug. A differing sibling is a variant class on its template, not a new
 * archetype (re-type is the exception). MISSING findings name `missing`, EXTRA `extra`;
 * every other finding (SECTIONS, SECTION HEIGHTS, COUNT, CLUSTERS, PROBE) is a
 * delta. An existing file for the same archetype URL is merged: an earlier row
 * is dropped when this run probed its slug or its URL (roster key — a row left
 * behind by a slug change), the others are kept, `at` = now; a different
 * archetype URL replaces it. When more than half of the file's siblings
 * differ, the run says so: the template is re-typed (sub-archetypes by locale
 * family or composition via state.mjs set --representative, then the new
 * template probed) — the re-typing recorded as a deviation, never cloned
 * mechanically (two or more differing). When a single sibling differs (the
 * template's only one included), or fewer than 20 % of them, the
 * advice is a variant class on the template with the exact migrate.mjs render
 * --accept-variance and variant commands — never a new archetype for a few
 * pages.
 *
 * Usage:
 *   node skills/replica/scripts/sibling-variance.mjs <archetypeURL> <siblingURL> [<siblingURL>…] [options]
 *     --probe <name>=<sel>   template-defining element to compare (repeatable). For
 *                            each: match count, first match's rect + the computed
 *                            group (background layers, colour, padding, font
 *                            size/weight/line-height, radius), its first heading,
 *                            its first image, list-style + `::before` mechanism,
 *                            and — when the selector matches several elements —
 *                            the number of distinct style clusters among them.
 *                            Default when none given: hero = first section of
 *                            --main; card = the most repeated element class in
 *                            the page; li = "main li".
 *     --main <sel>           content root (default main) — also probes the
 *                            section list ([label, height] per top-level section)
 *     --width <px>           viewport width                    (default 1440)
 *     --tolerance <px>       ignore numeric deltas ≤ this      (default 2)
 *     --consent <sel>        extra consent-accept selector
 *     --dismiss <sel,…>      extra overlay-dismiss selectors
 *     --headed               headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>         pin Accept-Language + locale
 *     --template <slug>      the archetype's slug — names the sidecar (default:
 *                            the archetype URL's slug in --state, else the
 *                            crawl slug rule on its path)
 *     --state <file>         page roster for URL → slug (default
 *                            stardust/state.json): origin + pathname without
 *                            trailing slash + search, `www.` folded; a URL not
 *                            in it → the crawl slug rule (path, runs of
 *                            non-alphanumerics → `-`, lowercased, `index`)
 *     --variance-dir <dir>   sidecar directory (default stardust/rollout/variance)
 *     --json                 machine-readable output (the variance lines then
 *                            go to stderr)
 *   A value flag followed by nothing or by another --flag is a usage error.
 *
 * Output: the report (or --json), then `variance → <file> (<s> same, <d> differ)`
 * and the advice: more than half (two or more) differ → re-type; a single sibling or fewer
 * than 20 % → `<d> of <t> sibling(s) of <template> differ (<slugs>): a variant
 * class on the template, not a new archetype — … then: node
 * stardust/scripts/migrate/migrate.mjs render <slugs> --accept-variance "…" &&
 * … variant <slug> <variant-class>` per slug; otherwise none.
 * Writes: <variance-dir>/<template>.json on exit 0 and 2 only.
 * Exit codes: 0 every sibling matches the archetype within tolerance, 2 variance
 * found (budget it), 1 error or usage, 3 bot challenge (fail loud — never measured).
 * Every URL is one live navigation: probe a template's siblings in ONE run and
 * keep the JSON as the fan-out brief's evidence.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const LIVE_SESSION_CANDIDATES = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'];
export const DEFAULT_STATE = 'stardust/state.json';
export const DEFAULT_VARIANCE_DIR = 'stardust/rollout/variance';

export class UsageError extends Error {}

async function loadLiveSession() {
  const found = LIVE_SESSION_CANDIDATES.map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new Error('live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

const HELP = `sibling-variance — diff template-defining computed values of live siblings against the archetype

Usage: node sibling-variance.mjs <archetypeURL> <siblingURL> [<siblingURL>…] [options]
  --probe <name>=<sel>  template-defining element (repeatable; defaults: hero, card, li)
  --main <sel>          content root (default main)
  --width <px>          viewport width (default 1440)
  --tolerance <px>      ignore numeric deltas ≤ this (default 2)
  --consent <sel>       extra consent-accept selector
  --dismiss <sel,…>     extra overlay-dismiss selectors
  --headed              headed stealth real Chrome
  --locale <tag>        pin Accept-Language + locale
  --template <slug>     the archetype's slug, names the sidecar (default: the archetype URL's
                        slug in --state, else the crawl slug rule on its path)
  --state <file>        roster for URL → slug (default ${DEFAULT_STATE}; origin + pathname
                        without trailing slash + search, www. folded; not in it → crawl slug rule)
  --variance-dir <dir>  sidecar directory (default ${DEFAULT_VARIANCE_DIR})
  --json                machine-readable output (the variance lines then go to stderr)
  --help                this text
  A value flag followed by nothing or by another --flag is a usage error.

Writes: <variance-dir>/<template>.json (atomic) once every page was probed (exit 0 or 2, never
  1 or 3): { template, archetype, at, siblings: [{ slug, url, verdict same|differs, variant (on
  differs — the variant class on the template), missing[], extra[], deltas[{ kind, probe?, msg }] }] },
  siblings sorted by slug. MISSING → missing, EXTRA →
  extra, every other finding → deltas. Same archetype URL as the existing file → merged (an earlier
  row whose slug or URL this run probed is dropped, others kept, at = now); a different archetype
  URL → replaced.
Prints after the report: variance → <file> (<s> same, <d> differ) — and the advice: more than half of
  the file's siblings (two or more) differ → re-type the template (never a mechanical clone); a single sibling or
  fewer than 20 % → a variant class on the template, with the exact migrate.mjs render
  --accept-variance and variant commands (never a new archetype for a few pages); otherwise none.

Exit codes: 0 no variance, 2 variance found, 1 error or usage, 3 bot challenge.`;

export function parseArgs(rest) {
  const pos = [];
  const opts = { probes: [], main: 'main', width: 1440, tolerance: 2, consent: null, dismiss: [], headed: false, locale: null, json: false, template: null, state: DEFAULT_STATE, stateGiven: false, varianceDir: DEFAULT_VARIANCE_DIR };
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new UsageError(`${flag} needs a value`); return rest[i + 1]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--probe') {
      const spec = need(i, a); i += 1;
      const m = spec.match(/^([\w-]+)=(.+)$/);
      if (!m) throw new UsageError(`bad --probe "${spec}" — expected name=<selector>`);
      opts.probes.push({ name: m[1], sel: m[2].trim() });
    }
    else if (a === '--main') { opts.main = need(i, a); i += 1; }
    else if (a === '--width') {
      opts.width = Number(need(i, a)); i += 1;
      if (!Number.isInteger(opts.width) || opts.width <= 0) throw new UsageError(`--width must be a positive integer, got ${rest[i]}`);
    }
    else if (a === '--tolerance') {
      opts.tolerance = Number(need(i, a)); i += 1;
      if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0) throw new UsageError(`--tolerance must be a number ≥ 0, got ${rest[i]}`);
    }
    else if (a === '--consent') { opts.consent = need(i, a); i += 1; }
    else if (a === '--dismiss') { opts.dismiss = need(i, a).split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = need(i, a); i += 1; }
    else if (a === '--template') { opts.template = need(i, a); i += 1; }
    else if (a === '--state') { opts.state = need(i, a); opts.stateGiven = true; i += 1; }
    else if (a === '--variance-dir') { opts.varianceDir = need(i, a); i += 1; }
    else if (a === '--json') { opts.json = true; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a}`); }
    else pos.push(a);
  }
  if (pos.length < 2) throw new UsageError('need <archetypeURL> and at least one <siblingURL>');
  if (opts.template !== null && !isFileSafeSlug(opts.template)) throw new UsageError(`--template "${opts.template}" is not a file-safe slug (letters, digits, . _ -; no leading dot)`);
  return { archetype: pos[0], siblings: pos.slice(1), opts };
}

// ---------------------------------------------------------------- in-page probe

/* eslint-disable no-undef */
function probePage({ probes, main }) {
  const root = document.querySelector(main) || document.body;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (el) => el.getClientRects().length > 0;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fam = (cs) => (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  // url() filenames are CONTENT (a sibling's own photo — replicate, don't
  // "fix"), never template: layers keep gradients verbatim and reduce every
  // url(...) to a bare `url(…)` marker so only the LAYER STACK is compared.
  const layers = (cs) => (cs.backgroundImage === 'none' ? [] : cs.backgroundImage.split(/,(?![^(]*\))/).map((l) => l.trim().replace(/url\([^)]*\)/g, 'url(…)')));

  // default probes
  const sections = [...root.querySelectorAll(':scope > section, :scope > .section')].filter(visible);
  const firstSection = sections[0] || root.firstElementChild;
  const classCounts = {};
  for (const el of root.querySelectorAll('[class]')) {
    if (!visible(el) || (el.children.length === 0 && !norm(el.textContent))) continue;
    if (['LI', 'A', 'SPAN', 'P', 'IMG', 'SVG', 'PATH', 'BUTTON'].includes(el.tagName)) continue; // atoms, not units
    const c = String(el.className).trim().split(/\s+/)[0];
    if (c) classCounts[c] = (classCounts[c] || 0) + 1;
  }
  const cardClass = Object.entries(classCounts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const list = probes.length ? probes : [
    { name: 'hero', el: firstSection, sel: '(first section)' },
    ...(cardClass ? [{ name: 'card', sel: `.${cardClass}` }] : []),
    { name: 'li', sel: `${main} li` },
  ];

  const signature = (el) => {
    const cs = getComputedStyle(el);
    const h = el.querySelector('h1, h2, h3, h4');
    const img = el.querySelector('img');
    const before = getComputedStyle(el, '::before');
    const hcs = h ? getComputedStyle(h) : null;
    return {
      rect: rect(el),
      backgroundLayers: layers(cs),
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      font: `${fam(cs)} ${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
      borderRadius: cs.borderRadius,
      heading: h ? `${h.tagName.toLowerCase()} ${fam(hcs)} ${hcs.fontSize}/${hcs.lineHeight} ${hcs.fontWeight} ${hcs.color}` : null,
      image: img ? rect(img) : null, // geometry only — the src is content
      listStyle: cs.listStyleType !== 'none' || el.tagName === 'LI' ? cs.listStyleType : null,
      before: (before.content && before.content !== 'none' && before.content !== 'normal') || before.backgroundImage !== 'none'
        ? `content:${before.content.replace(/url\([^)]*\)/g, 'url(…)')} bg:${layers(before).join('|') || 'none'} ${Math.round(parseFloat(before.width) || 0)}x${Math.round(parseFloat(before.height) || 0)}`
        : null,
    };
  };
  const clusterKey = (s) => JSON.stringify({ ...s, rect: undefined, heading: s.heading ? s.heading.replace(/^h\d /, '') : null });

  const out = {
    sections: sections.map((el, i) => ({ label: String(el.className || '').split(/\s+/).filter((c) => c && c !== 'section').slice(0, 2).join('.') || `${el.tagName.toLowerCase()}[${i}]`, h: rect(el).h })),
    probes: {},
  };
  for (const p of list) {
    const els = p.el ? [p.el] : [...document.querySelectorAll(p.sel)].filter(visible);
    if (!els.length) { out.probes[p.name] = { sel: p.sel, count: 0 }; continue; }
    const sigs = els.slice(0, 40).map(signature);
    const clusters = new Set(sigs.map(clusterKey)).size;
    out.probes[p.name] = { sel: p.sel, count: els.length, first: sigs[0], clusters, text: norm(els[0].textContent).slice(0, 60) };
  }
  return out;
}
/* eslint-enable no-undef */

// ------------------------------------------------------------------- diffing

const px = (v) => { const m = String(v).match(/^-?[\d.]+(?=px$)/); return m ? parseFloat(m[0]) : null; };

export function diffValue(k, a, b, tol) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && !Array.isArray(a)) {
    const d = Object.keys({ ...a, ...b }).map((kk) => diffValue(kk, a[kk], b[kk], tol)).filter(Boolean);
    return d.length ? `${k}{${d.join(', ')}}` : null;
  }
  const pa = px(a); const pb = px(b);
  if (pa !== null && pb !== null && Math.abs(pa - pb) <= tol) return null;
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol) return null;
  // padding / font strings: compare token-wise with tolerance
  if (typeof a === 'string' && typeof b === 'string' && a.split(' ').length === b.split(' ').length && a.split(' ').length > 1) {
    const ta = a.split(' '); const tb = b.split(' ');
    const diffTok = ta.some((t, i) => { const x = px(t); const y = px(tb[i]); return x !== null && y !== null ? Math.abs(x - y) > tol : t !== tb[i]; });
    if (!diffTok) return null;
  }
  const show = (v) => (Array.isArray(v) ? `[${v.join(' | ')}]` : String(v));
  return `${k} ${show(a)} → ${show(b)}`;
}

export function compare(arch, sib, tol) {
  const findings = [];
  const sa = arch.sections.map((s) => s.label).join(' > '); const sb = sib.sections.map((s) => s.label).join(' > ');
  if (arch.sections.length !== sib.sections.length) findings.push({ kind: 'SECTIONS', msg: `${arch.sections.length} vs ${sib.sections.length} top-level sections (archetype: ${sa || '-'}; sibling: ${sb || '-'}) — a different template family or an extra/missing section` });
  else {
    const hd = arch.sections.map((s, i) => (Math.abs(s.h - sib.sections[i].h) > tol ? `${s.label} ${s.h}→${sib.sections[i].h}` : null)).filter(Boolean);
    if (hd.length) findings.push({ kind: 'SECTION HEIGHTS', msg: hd.join(', ') });
  }
  for (const [name, A] of Object.entries(arch.probes)) {
    const B = sib.probes[name];
    if (!B || !B.count) { if (A.count) findings.push({ kind: 'MISSING', probe: name, msg: `"${A.sel}" matches ${A.count} on the archetype, 0 on the sibling` }); continue; }
    if (!A.count) { findings.push({ kind: 'EXTRA', probe: name, msg: `"${B.sel}" matches 0 on the archetype, ${B.count} on the sibling` }); continue; }
    if (A.count !== B.count) findings.push({ kind: 'COUNT', probe: name, msg: `${A.count} → ${B.count} matches` });
    if (A.clusters !== B.clusters) findings.push({ kind: 'CLUSTERS', probe: name, msg: `${A.clusters} → ${B.clusters} distinct style families among matches (a second visual family = a variant class)` });
    const d = Object.keys(A.first).map((k) => diffValue(k, A.first[k], B.first[k], tol)).filter(Boolean);
    if (d.length) findings.push({ kind: 'PROBE', probe: name, msg: d.join('; ') });
  }
  return findings;
}

// ------------------------------------------------------------ variance sidecar

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// The sidecar is named by the template slug: no path separator, no leading dot.
export function isFileSafeSlug(s) { return typeof s === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s); }

// The roster's URL key: origin (`www.` folded) + pathname without trailing slash + search.
export function urlKey(u) {
  let x;
  try { x = new URL(u); } catch { return null; }
  return `${x.protocol}//${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`;
}

// crawl.mjs's slug rule for a URL the roster does not hold.
export function crawlSlug(u) {
  let pathname;
  try { ({ pathname } = new URL(u)); } catch { [pathname] = String(u).split(/[?#]/); }
  const s = pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return s || 'index';
}

export function rosterSlug(url, pages = []) {
  const key = urlKey(url);
  if (key === null || !Array.isArray(pages)) return null;
  const hit = pages.find((p) => p && typeof p.slug === 'string' && p.slug && urlKey(p.url) === key);
  return hit ? hit.slug : null;
}

export const slugFor = (url, pages = []) => rosterSlug(url, pages) ?? crawlSlug(url);

export function readRoster(file, given = false) {
  if (!existsSync(file)) {
    if (given) throw new Error(`--state ${file} not found`);
    return { pages: [], note: `${file} not found — slugs by the crawl slug rule` };
  }
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON (${e.message})`); }
  if (!state || !Array.isArray(state.pages)) throw new Error(`${file} has no pages[] array`);
  return { pages: state.pages, note: null };
}

// The variant class a differing sibling takes on its template (re-type is the exception, not the response to
// "differs"): the differing probe names, sorted and joined with `-`, else `layout` for a structural-only delta
// (SECTIONS / SECTION HEIGHTS with no probe). The cluster brief reads it as "same template, variant CSS/JS".
export function variantName(findings = []) {
  const probes = [...new Set(findings.map((f) => f.probe).filter(Boolean))].sort();
  return probes.length ? probes.join('-') : 'layout';
}

// MISSING → missing[], EXTRA → extra[] (probe names), every other finding → deltas[]; a `differs` verdict also
// carries `variant: <name>` — the variant class the sibling takes on its template, not a new archetype.
export function verdictOf(findings = []) {
  const names = (kind) => [...new Set(findings.filter((f) => f.kind === kind).map((f) => f.probe).filter(Boolean))].sort();
  const differs = findings.length > 0;
  return {
    verdict: differs ? 'differs' : 'same',
    ...(differs ? { variant: variantName(findings) } : {}),
    missing: names('MISSING'),
    extra: names('EXTRA'),
    deltas: findings.filter((f) => f.kind !== 'MISSING' && f.kind !== 'EXTRA')
      .map((f) => (f.probe === undefined ? { kind: f.kind, msg: f.msg } : { kind: f.kind, probe: f.probe, msg: f.msg })),
  };
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortRows = (rows) => rows.slice().sort((a, b) => byCode(String(a.slug), String(b.slug)) || byCode(String(a.url), String(b.url)));

// rows: [{ slug, url, findings }] → the sidecar object, siblings sorted by slug.
export function sidecarOf({ template, archetype, at, rows }) {
  return { template, archetype, at, siblings: sortRows(rows.map(({ slug, url, findings }) => ({ slug, url, ...verdictOf(findings) }))) };
}

const sameUrl = (a, b) => { const ka = urlKey(a); return ka !== null ? ka === urlKey(b) : a === b; };

// Same archetype URL → the previous rows are kept unless the new run has their slug or their URL (urlKey — a row left behind by
// a slug change); anything else → next replaces prev.
export function mergeSidecar(prev, next) {
  if (!prev || typeof prev !== 'object' || !Array.isArray(prev.siblings) || !sameUrl(prev.archetype, next.archetype)) return next;
  const fresh = new Set(next.siblings.map((s) => s.slug));
  const freshUrls = new Set(next.siblings.map((s) => urlKey(s.url)).filter((k) => k !== null));
  const kept = prev.siblings.filter((s) => s && typeof s === 'object' && !fresh.has(s.slug) && !freshUrls.has(urlKey(s.url)));
  return { ...next, siblings: sortRows([...kept, ...next.siblings]) };
}

export function retypeAdvice(rows, template) {
  const total = rows.length;
  const differ = rows.filter((r) => r.verdict !== 'same').length;
  return differ > total / 2
    ? `more than half of ${template}'s siblings differ (${differ} of ${total}): re-type the template — sub-archetypes by locale family or composition (state.mjs set --representative, then probe the new template), the re-typing recorded as a deviation; never a mechanical clone`
    : null;
}

const MIGRATE = 'node stardust/scripts/migrate/migrate.mjs';
// The advice after the variance line: a majority (two or more) differing → re-type (retypeAdvice); a single differing sibling, or
// fewer than 20 % of them → a variant class on the template with the exact commands — never a new archetype for a few
// pages (one recorded run moved a single differing sibling to an archetype of its own and had to record it again);
// otherwise none.
export function varianceAdvice(rows, template) {
  const differ = rows.filter((r) => r.verdict !== 'same');
  // A single differing sibling is never a majority to re-type — the template's only clone included.
  const retype = differ.length > 1 ? retypeAdvice(rows, template) : null;
  if (retype) return retype;
  if (!differ.length || (differ.length > 1 && differ.length * 5 >= rows.length)) return null;
  const slugs = differ.map((r) => r.slug);
  return `${differ.length} of ${rows.length} sibling(s) of ${template} differ (${slugs.join(', ')}): a variant class on the template, not a new archetype — give the delta a variant class on the archetype's block, then: ${MIGRATE} render ${slugs.join(' ')} --accept-variance "<the delta and its variant class>" && ${slugs.map((x) => `${MIGRATE} variant ${x} <variant-class>`).join(' && ')}`;
}

// Reads <dir>/<template>.json (if any), merges or replaces, writes it atomically.
export function recordVariance({ dir, template, archetype, rows, at = nowIso() }) {
  const file = join(dir, `${template}.json`);
  const next = sidecarOf({ template, archetype, at, rows });
  let sidecar = next; let note = null;
  if (existsSync(file)) {
    let prev = null;
    try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { /* unreadable: replaced */ }
    sidecar = mergeSidecar(prev, next);
    if (sidecar === next) note = `${file} held ${prev && typeof prev.archetype === 'string' ? `archetype ${prev.archetype}` : 'no readable sidecar'} — replaced`;
  }
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sidecar, null, 2)}\n`);
  renameSync(tmp, file);
  const differ = sidecar.siblings.filter((s) => s.verdict !== 'same').length;
  return { file, sidecar, same: sidecar.siblings.length - differ, differ, advice: varianceAdvice(sidecar.siblings, template), note };
}

export const varianceLines = (rec) => [`variance → ${rec.file} (${rec.same} same, ${rec.differ} differ)`, ...(rec.advice ? [rec.advice] : [])];

// ---------------------------------------------------------------------- main

async function probeUrl(browser, url, opts, session) {
  const { isLiveHttpUrl, newLiveContext, gotoLive, dismissOverlays, defaultWaitUntil } = session;
  const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 } });
  const page = await ctx.newPage();
  await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: opts.headed });
  await dismissOverlays(page, { extra: [...(opts.consent ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(500);
  const out = await page.evaluate(probePage, { probes: opts.probes, main: opts.main });
  await ctx.close();
  return out;
}

async function main(argv) {
  const { archetype, siblings, opts } = parseArgs(argv);
  // Slugs resolve before any navigation: a bad roster or template fails before the browser starts.
  const roster = readRoster(opts.state, opts.stateGiven);
  if (roster.note) console.error(`sibling-variance: ${roster.note}`);
  const template = opts.template || slugFor(archetype, roster.pages);
  if (!isFileSafeSlug(template)) throw new Error(`the archetype's slug "${template}" is not a file-safe slug — pass --template <slug>`);
  const slugs = siblings.map((url) => slugFor(url, roster.pages));
  if (roster.pages.length) {
    const unlisted = [...(opts.template ? [] : [archetype]), ...siblings].filter((url) => rosterSlug(url, roster.pages) === null);
    if (unlisted.length) console.error(`sibling-variance: not in ${opts.state} — crawl slug rule: ${unlisted.map((url) => `${url} → ${crawlSlug(url)}`).join(', ')}`);
  }
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) { throw new Error(`playwright is not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`); }
  const session = await loadLiveSession();
  const browser = opts.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  let varying = 0;
  const results = [];
  try {
    const A = await probeUrl(browser, archetype, opts, session);
    for (const url of siblings) {
      const S = await probeUrl(browser, url, opts, session);
      const findings = compare(A, S, opts.tolerance);
      if (findings.length) varying += 1;
      results.push({ url, findings, raw: S });
    }
    const probesVarying = [...new Set(results.flatMap((r) => r.findings.map((f) => f.probe || f.kind)))];
    if (opts.json) {
      console.log(JSON.stringify({ archetype, width: opts.width, tolerance: opts.tolerance, probes: Object.fromEntries(Object.entries(A.probes).map(([k, v]) => [k, v.sel])), archetypeRaw: A, siblings: results.map(({ url, findings, raw }) => ({ url, findings, raw })), summary: { siblings: siblings.length, varying, probesVarying } }, null, 2));
    } else {
      console.log(`sibling-variance @ ${opts.width}px, tolerance ${opts.tolerance}px\n  archetype: ${archetype}\n  probes: ${Object.entries(A.probes).map(([k, v]) => `${k}=${v.sel} (${v.count})`).join(', ')}\n  sections: ${A.sections.map((s) => `${s.label}:${s.h}`).join(' > ') || '-'}`);
      for (const r of results) {
        console.log(`\n■ ${r.url}: ${r.findings.length ? `${r.findings.length} delta(s)` : '✓ matches the archetype'}`);
        for (const f of r.findings) console.log(`  ${f.kind.padEnd(16)}${f.probe ? `${f.probe}: ` : ''}${f.msg}`);
      }
      console.log(`\n${varying ? `✗ ${varying} of ${siblings.length} sibling(s) vary from the archetype in: ${probesVarying.join(', ')} — budget variant classes for these before cloning; do not assume template constancy.` : `✓ ${siblings.length} sibling(s) match the archetype within tolerance — clone.`}`);
    }
  } finally {
    await browser.close();
  }
  // Only a run that probed every page records a verdict (an error or a bot challenge threw above).
  const rec = recordVariance({ dir: opts.varianceDir, template, archetype, rows: results.map((r, i) => ({ slug: slugs[i], url: r.url, findings: r.findings })) });
  if (rec.note) console.error(`sibling-variance: ${rec.note}`);
  const say = opts.json ? console.error : console.log;
  for (const line of varianceLines(rec)) say(line);
  return varying ? 2 : 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); process.exit(0); }
  main(argv).then((code) => process.exit(code), (e) => {
    if (e instanceof UsageError) { console.error(`sibling-variance: ${e.message}\n\n${HELP}`); process.exit(1); }
    console.error(`sibling-variance error: ${e.message}`);
    process.exit(e.name === 'BotChallengeError' ? 3 : 1);
  });
}
