#!/usr/bin/env node
/**
 * skills/replica/scripts/variant-census.mjs — variant census before styling
 * a block: which modifier / descendant classes each component carries across
 * the corpus, on how many pages, and whether the canon or the renderer
 * references them. Read-only evidence, not a gate.
 *
 * Why: the first page examined always looks like "the" design. A tabs block
 * lifted from the vertical variant (39 pages) while the horizontal one sat
 * on 293; a renderer dropped a `__item--icon` leaf because nobody enumerated
 * the component's child classes and the pixel gate barely noticed; utility
 * classes in the captured DOM (`.text-uppercase`, `.g-col-xl-3`) resolved to
 * no canon rule so the prototype rendered the source's plain fallback; the
 * same class skinned three ways under three themes. One census over the
 * settled DOM of every page of the type — counts authored DOM, not a fidelity
 * verdict (D12) — puts the majority variant first and every minority
 * variant ≥ --min-pages into the budget before the CSS lift.
 *
 * Offline over the crawler sidecar `stardust/current/pages/<slug>.html`
 * (Playwright `file://`, every request aborted — zero source hits; a slug
 * without a sidecar is listed `no-sidecar`, never fetched). No computed
 * style: variants are class tokens and DOM facts (`li:icon` = an <li> holding
 * svg|img|i|[class*=icon] or an empty classed leaf; `columns` = the uniform
 * count of the outermost same-class sibling group, ≤ 6). The repeat-unit
 * grouping is section-schema.mjs `mapSections`' (≥ 2 same tag+class
 * content-bearing siblings, outermost only) — inlined here until deploy
 * exports it.
 *
 * Coverage pass (the cigna:F15 / experian:F8 mechanism): every census class
 * is `referenced` when it appears as a selector token in a --css file or as
 * a string in a --code file; otherwise `unreferenced`. --allow lists classes
 * intentionally unstyled, one per line with a reason. Rendered comparison
 * stays with the pixel gate and style-fingerprint.mjs.
 *
 * Usage:
 *   node skills/replica/scripts/variant-census.mjs [--root stardust] [--type <t> | --slugs <file> | --from-clusters <json> [--cluster <id>]]
 *        [--marker <attr,…>] [--css <glob>]… [--code <glob>]… [--allow <file>] [--min-pages 2] [--sample N]
 *        [--out stardust/replica/variant-census.json] [--json]
 *     --root <dir>        stardust dir (state.json, current/pages/*.html)          (default stardust)
 *     --type <t>          pages of that type (state.json.pages[].type)
 *     --slugs <file>      newline list of slugs
 *     --from-clusters <json> [--cluster <id>]
 *                         pages of layout-cluster.mjs's clusters (one cluster, or all;
 *                         --type narrows to that type's clusters). --slugs is exclusive.
 *     --marker <attr,…>   component markers (default data-component,data-component-id,data-cmp
 *                         plus [class^="cmp-"]); none on a page → top-level sections and the
 *                         outermost repeat units are the components
 *     --css <glob>        stylesheet(s) whose selectors count as references   (repeatable)
 *     --code <glob>       importer/renderer/block code whose strings count     (repeatable)
 *     --allow <file>      `class  # reason` per line — intentionally unstyled
 *     --min-pages <n>     a minority variant with ≥ n pages must be budgeted   (default 2, printed)
 *     --sample <n>        census every k-th page so ≤ n pages are parsed (header says "sampled")
 *     --out <file>        JSON census (default stardust/replica/variant-census.json; .md beside it)
 *     --json              print the census JSON on stdout instead of the table
 *     --help
 *
 * Output: stdout ≤ 60 lines (majority/minority per component, then the ranked
 * unreferenced-class table via stardust/scripts/class-report.mjs); the full
 * census in --out, the per-page rows in the .md beside it, class-report's
 * summary.{json,md} under <out dir>/variant-census/:
 *   { generatedAt, scope, minPages, pages, noSidecar[], components: [ { class, pages, examples[≤3],
 *     modifiers: [{ class, pages, examples, referenced, allowed }], descendants: [same],
 *     facts: { li:icon|hasImg|hasSvg: pages where true, headings|ctas|columns: modal value }, themes: { <token|(none)>: { pages, modifiers } } | null } ],
 *     unreferenced: [{ class, kind, component, pages, examples }], budget: [the unreferenced ≥ minPages, not allowed] }
 *
 * Exit codes: 0 census written (or coverage not checked: no --css/--code) ·
 * 2 at least one unreferenced variant / descendant with ≥ --min-pages pages
 * and no --allow entry — budget it (a variant class inside the vocabulary
 * budget, or an allow line with a reason) · 1 read error / bad arguments.
 * Nothing refuses, parks or blocks; exit 124 is not used (no live wait).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, globSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MARKERS = ['data-component', 'data-component-id', 'data-cmp'];
export const DEFAULT_MIN_PAGES = 2;

const HELP = `variant-census — modifier / descendant classes per component across a page type, with canon/renderer coverage

Usage: node variant-census.mjs [--root stardust] [--type <t> | --slugs <file> | --from-clusters <json> [--cluster <id>]]
                               [--marker <attr,…>] [--css <glob>]… [--code <glob>]… [--allow <file>]
                               [--min-pages ${DEFAULT_MIN_PAGES}] [--sample <n>] [--out <file>] [--json]
  --root <dir>          stardust dir (state.json, current/pages/*.html)
  --type <t>            pages of that type          --slugs <file>   newline slug list
  --from-clusters <json> [--cluster <id>]           pages of layout-cluster.mjs clusters
  --marker <attr,…>     component markers (default ${DEFAULT_MARKERS.join(',')} + [class^="cmp-"])
  --css <glob>          stylesheets whose selectors count as references (repeatable)
  --code <glob>         code whose string literals count as references (repeatable)
  --allow <file>        intentionally unstyled classes, "class  # reason" per line
  --min-pages <n>       minority variants with ≥ n pages must be budgeted (default ${DEFAULT_MIN_PAGES})
  --sample <n>          parse ≤ n pages (every k-th)   --out <file>   census JSON (+ .md beside it)
  --json                census JSON on stdout           --help         this text

Offline over the crawler sidecar (file://, every request aborted — zero source hits). Read-only evidence, not a gate.
Exit: 0 written · 2 unreferenced variant(s) ≥ min-pages without an allow entry (budget it) · 1 error.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const opts = { root: 'stardust', type: null, slugs: null, fromClusters: null, cluster: null, markers: DEFAULT_MARKERS, css: [], code: [], allow: null, minPages: DEFAULT_MIN_PAGES, sample: null, out: null, json: false };
  const fail = (m) => { console.error(`variant-census: ${m}\n\n${HELP}`); process.exit(1); };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--root') opts.root = rest[++i];
    else if (a === '--type') opts.type = rest[++i];
    else if (a === '--slugs') opts.slugs = rest[++i];
    else if (a === '--from-clusters') opts.fromClusters = rest[++i];
    else if (a === '--cluster') opts.cluster = rest[++i];
    else if (a === '--marker') opts.markers = String(rest[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--css') opts.css.push(rest[++i]);
    else if (a === '--code') opts.code.push(rest[++i]);
    else if (a === '--allow') opts.allow = rest[++i];
    else if (a === '--min-pages') { opts.minPages = Number(rest[++i]); if (!Number.isInteger(opts.minPages) || opts.minPages < 1) fail('--min-pages needs an integer ≥ 1'); }
    else if (a === '--sample') { opts.sample = Number(rest[++i]); if (!Number.isInteger(opts.sample) || opts.sample < 1) fail('--sample needs an integer ≥ 1'); }
    else if (a === '--out') opts.out = rest[++i];
    else if (a === '--json') opts.json = true;
    else fail(`unknown flag ${a}`);
  }
  if (opts.slugs && (opts.type || opts.fromClusters)) fail('--slugs is exclusive with --type and --from-clusters (--type may scope --from-clusters)');
  if (opts.cluster && !opts.fromClusters) fail('--cluster needs --from-clusters');
  return opts;
}

// ------------------------------------------------------------ pure functions

/** `class  # reason` lines → Map<class, reason>; blank / comment lines skipped; a class without a reason is an error. */
export function parseAllow(text) {
  const out = new Map(); const errors = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_-][\w-]*)\s*(?:#\s*|\s+)(.+)$/);
    if (!m) { errors.push(line); continue; }
    out.set(m[1], m[2].trim());
  }
  return { allow: out, errors };
}

/** Class tokens a stylesheet selects (`.foo` outside comments and strings). */
export function tokensFromCss(text) {
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ');
  const out = new Set();
  for (const m of src.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1].replace(/\\/g, ''));
  return out;
}

/** Class tokens a code file names inside string / template literals (any token, split on non-class chars). */
export function tokensFromCode(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) for (const t of m[2].split(/[^\w-]+/)) if (t && /^[A-Za-z_-]/.test(t)) out.add(t);
  return out;
}

/** Sample every k-th slug so at most n remain (order kept). */
export function sampleSlugs(slugs, n) {
  if (!n || slugs.length <= n) return slugs;
  const k = slugs.length / n;
  return Array.from({ length: n }, (_, i) => slugs[Math.floor(i * k)]);
}

/**
 * aggregate(pagesFacts, { minPages, referenced, allow, coverage }) → census.
 * pagesFacts: [{ slug, theme: string[], components: [{ class, modifiers: string[], descendants: string[], facts: {…} }] } | { slug, noSidecar: true }]
 * referenced: Set<string> | null (null = coverage not checked); allow: Map<class, reason>.
 */
export function aggregate(pagesFacts, { minPages = DEFAULT_MIN_PAGES, referenced = null, allow = new Map() } = {}) {
  const comps = new Map(); const noSidecar = [];
  const bucket = (map, key) => { if (!map.has(key)) map.set(key, new Set()); return map.get(key); };
  for (const p of pagesFacts) {
    if (p.noSidecar || !Array.isArray(p.components)) { noSidecar.push(p.slug); continue; }
    const seen = new Set();
    for (const c of p.components) {
      if (!c?.class) continue;
      if (!comps.has(c.class)) comps.set(c.class, { class: c.class, pages: new Set(), modifiers: new Map(), descendants: new Map(), facts: new Map(), nums: new Map(), themes: new Map() });
      const C = comps.get(c.class); C.pages.add(p.slug); seen.add(c.class);
      for (const m of c.modifiers || []) bucket(C.modifiers, m).add(p.slug);
      for (const d of c.descendants || []) bucket(C.descendants, d).add(p.slug);
      // boolean facts → pages where true; numeric facts → the modal value across pages
      for (const [k, v] of Object.entries(c.facts || {})) { if (v === true) bucket(C.facts, k).add(p.slug); else if (typeof v === 'number') { if (!C.nums.has(k)) C.nums.set(k, []); C.nums.get(k).push(v); } }
      // theme facet: pages without a theme token count under "(none)" so a split shows whenever > 1 value exists
      for (const t of (p.theme?.length ? p.theme : ['(none)'])) { const tm = bucket(C.themes, t); for (const m of c.modifiers || []) tm.add(`${m}@@${p.slug}`); tm.add(`@@${p.slug}`); }
    }
  }
  const covered = (cls) => (referenced ? referenced.has(cls) : null);
  const rows = (map) => [...map.entries()].map(([cls, pages]) => ({ class: cls, pages: pages.size, examples: [...pages].slice(0, 3), referenced: covered(cls), allowed: allow.has(cls) ? allow.get(cls) : null })).sort((a, b) => b.pages - a.pages || a.class.localeCompare(b.class));
  const components = [...comps.values()].map((C) => {
    const themes = {};
    for (const [t, set] of C.themes) {
      const pages = new Set(); const perMod = {};
      for (const x of set) { const [m, slug] = x.split('@@'); pages.add(slug); if (m) (perMod[m] ||= new Set()).add(slug); }
      themes[t] = { pages: pages.size, modifiers: Object.fromEntries(Object.entries(perMod).map(([m, s]) => [m, s.size])) };
    }
    const modifiers = rows(C.modifiers);
    const mode = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; };
    const facts = Object.fromEntries([...[...C.facts.entries()].map(([k, s]) => [k, s.size]), ...[...C.nums.entries()].map(([k, xs]) => [k, mode(xs)])]);
    return { class: C.class, pages: C.pages.size, examples: [...C.pages].slice(0, 3), referenced: covered(C.class), allowed: allow.has(C.class) ? allow.get(C.class) : null, majority: modifiers[0]?.class || null, modifiers, descendants: rows(C.descendants), facts, themes: Object.keys(themes).length > 1 ? themes : null };
  }).sort((a, b) => b.pages - a.pages || a.class.localeCompare(b.class));
  const unreferenced = [];
  if (referenced) {
    for (const c of components) {
      if (c.referenced === false && !c.allowed) unreferenced.push({ class: c.class, kind: 'component', component: c.class, pages: c.pages, examples: c.examples });
      for (const m of c.modifiers) if (m.referenced === false && !m.allowed) unreferenced.push({ class: m.class, kind: 'modifier', component: c.class, pages: m.pages, examples: m.examples });
      for (const d of c.descendants) if (d.referenced === false && !d.allowed) unreferenced.push({ class: d.class, kind: 'descendant', component: c.class, pages: d.pages, examples: d.examples });
    }
  }
  unreferenced.sort((a, b) => b.pages - a.pages || a.class.localeCompare(b.class));
  const budget = unreferenced.filter((u) => u.pages >= minPages);
  return { minPages, pages: pagesFacts.length - noSidecar.length, noSidecar, coverageChecked: !!referenced, components, unreferenced, budget, exitCode: budget.length ? 2 : 0 };
}

/** Findings for class-report.mjs (one per unreferenced class × example page). */
export function findingsOf(census) {
  return census.unreferenced.flatMap((u) => u.examples.map((slug) => ({ class: u.class, page: slug, message: `${u.kind} of ${u.component} — ${u.pages} page(s)${u.pages >= census.minPages ? ' — budget it' : ''}`, severity: u.pages >= census.minPages ? 'error' : 'info', file: `${u.component}` })));
}

/** The ≤ 60-line stdout report (component lines + the ranked table rendered by class-report when present). */
export function renderCensus(census, { scope, table = null, maxLines = 60 } = {}) {
  const lines = [`variant-census ${scope}: ${census.pages} page(s) parsed${census.noSidecar.length ? `, ${census.noSidecar.length} no-sidecar (re-capture with extract --refresh)` : ''}; ${census.components.length} component(s); min-pages ${census.minPages}${census.coverageChecked ? '' : ' — coverage NOT checked (pass --css / --code)'}`];
  const compBudget = Math.max(8, maxLines - 8 - (table ? table.length : 0));
  for (const c of census.components.slice(0, compBudget)) {
    const mods = c.modifiers.slice(0, 4).map((m, i) => `${i === 0 ? 'majority ' : ''}${m.class} (${m.pages}${m.referenced === false ? (m.allowed ? ', allowed' : ', UNREFERENCED') : ''})`).join(' · ');
    const facts = Object.entries(c.facts).map(([k, v]) => `${k}:${v}`).join(' ');
    const themes = c.themes ? ` · themes ${Object.entries(c.themes).map(([t, v]) => `${t}(${v.pages})`).join(' ')}` : '';
    lines.push(`  ${c.class} (${c.pages}${c.referenced === false ? (c.allowed ? ', allowed' : ', UNREFERENCED') : ''}): ${mods || 'no modifiers'}${c.descendants.length ? ` · ${c.descendants.length} descendant class(es), ${c.descendants.filter((d) => d.referenced === false && !d.allowed).length} unreferenced` : ''}${facts ? ` · ${facts}` : ''}${themes}`);
  }
  if (census.components.length > compBudget) lines.push(`  … ${census.components.length - compBudget} more component(s) in the census file`);
  if (table) lines.push(...table);
  if (census.coverageChecked) lines.push(census.budget.length ? `✗ ${census.budget.length} unreferenced class(es) on ≥ ${census.minPages} page(s): ${census.budget.slice(0, 6).map((u) => `${u.class} (${u.pages})`).join(', ')}${census.budget.length > 6 ? ', …' : ''} — budget each as a block VARIANT class inside the vocabulary budget, or list it in --allow with a reason.` : `✓ every variant / descendant class on ≥ ${census.minPages} page(s) is referenced or allowed.`);
  return lines.slice(0, maxLines);
}

/** Per-page rows (the .md beside the census; never printed). */
export function renderMarkdown(census, pagesFacts, { scope }) {
  const out = [`# Variant census — ${scope}`, '', `${census.pages} page(s), min-pages ${census.minPages}, coverage ${census.coverageChecked ? 'checked' : 'not checked'}.`, ''];
  out.push('## Components', '', '| component | pages | majority | minority (pages) | unreferenced |', '|---|---|---|---|---|');
  for (const c of census.components) out.push(`| \`${c.class}\` | ${c.pages} | ${c.majority ? `\`${c.majority}\` (${c.modifiers[0].pages})` : '—'} | ${c.modifiers.slice(1).map((m) => `\`${m.class}\` (${m.pages})`).join(', ') || '—'} | ${[...c.modifiers, ...c.descendants].filter((x) => x.referenced === false && !x.allowed).map((x) => `\`${x.class}\``).join(', ') || '—'} |`);
  out.push('', '## Pages', '');
  for (const p of pagesFacts) out.push(p.noSidecar ? `- \`${p.slug}\` — no sidecar` : `- \`${p.slug}\`${p.theme?.length ? ` (theme: ${p.theme.join(' ')})` : ''}: ${p.components.map((c) => `${c.class}${c.modifiers.length ? `.${c.modifiers.join('.')}` : ''}`).join(', ')}`);
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------ in-page collector

/* eslint-disable no-undef */
/** Runs IN the page. markers: attribute names. Returns { theme: string[], components: [...] }. */
export function collectPage({ markers }) {
  const SKIP = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'SVG', 'PATH'];
  const tokens = (el) => String(el.className && typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '').trim().split(/\s+/).filter(Boolean);
  const theme = [...new Set([...tokens(document.documentElement), ...tokens(document.body), document.documentElement.getAttribute('data-theme'), document.body.getAttribute('data-theme')].filter(Boolean))];
  const compose = (el) => ({
    headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    ctas: [...el.querySelectorAll('a')].filter((a) => (a.textContent || '').trim() && !a.querySelector('img,picture')).length,
    imgs: el.querySelectorAll('img,picture').length,
    textRuns: [...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length,
  });
  // Repeat-unit grouping as section-schema.mjs mapSections (outermost same tag+class siblings with content).
  const repeatUnits = (root) => {
    const reported = []; const units = [];
    for (const c of [root, ...root.querySelectorAll('*')]) {
      if (SKIP.includes(c.tagName) || reported.some((r) => r !== c && r.contains(c))) continue;
      const byKey = {};
      [...c.children].forEach((k) => { const key = `${k.tagName}.${tokens(k)[0] || ''}`; (byKey[key] ||= []).push(k); });
      for (const members of Object.values(byKey)) {
        if (members.length < 2) continue;
        const us = members.map(compose);
        if (!us.some((u) => u.headings || u.ctas || u.imgs || u.textRuns)) continue;
        units.push({ members, count: members.length, depth: (() => { let d = 0; let e = c; while (e && e !== root) { d++; e = e.parentElement; } return d; })() });
        reported.push(...members);
      }
    }
    return units;
  };
  const main = document.querySelector('main') || document.body;
  let marked = markers.flatMap((a) => [...document.querySelectorAll(`[${a}]`)].map((el) => ({ el, cls: el.getAttribute(a) || tokens(el)[0] || el.tagName.toLowerCase(), marker: a })));
  marked = marked.concat([...document.querySelectorAll('[class^="cmp-"], [class*=" cmp-"]')].filter((el) => !marked.some((m) => m.el === el)).map((el) => ({ el, cls: tokens(el).find((t) => t.startsWith('cmp-')), marker: 'class' })));
  if (!marked.length) {
    const sections = [...main.children].filter((el) => !SKIP.includes(el.tagName) && !['HEADER', 'FOOTER', 'NAV'].includes(el.tagName));
    for (const sec of sections) {
      marked.push({ el: sec, cls: tokens(sec).filter((t) => t !== 'section')[0] || sec.tagName.toLowerCase(), marker: 'section' });
      for (const u of repeatUnits(sec)) { const first = u.members[0]; const cls = tokens(first)[0]; if (cls) marked.push({ el: first.parentElement, cls, marker: 'repeat-unit', unitMembers: u.members }); }
    }
  }
  const liIcon = (root) => [...root.querySelectorAll('li')].some((li) => li.querySelector('svg, img, i, [class*="icon"]') || [...li.querySelectorAll('[class]')].some((e) => !e.children.length && !(e.textContent || '').trim() && !['IMG', 'INPUT', 'BR', 'HR'].includes(e.tagName)));
  const columns = (root) => { const u = repeatUnits(root).filter((x) => x.depth <= 2 && x.count >= 2 && x.count <= 6 && !['LI', 'DETAILS', 'TR', 'DT', 'DD', 'OPTION'].includes(x.members[0].tagName)).sort((a, b) => a.depth - b.depth)[0]; return u ? u.count : 1; };
  const components = [];
  for (const { el, cls, marker, unitMembers } of marked) {
    if (!cls) continue;
    const own = tokens(el).filter((t) => t !== cls && t !== 'section');
    const scope = unitMembers || [el];
    const desc = new Set();
    for (const root of scope) {
      const walk = (node, depth) => { if (depth > 3) return; for (const k of node.children) { if (SKIP.includes(k.tagName)) continue; for (const t of tokens(k)) if (t !== cls) desc.add(t); walk(k, depth + 1); } };
      walk(root, 1);
    }
    const cmp = compose(el);
    components.push({ class: cls, marker, modifiers: unitMembers ? [...new Set(unitMembers.flatMap((m) => tokens(m).filter((t) => t !== cls)))] : own, descendants: [...desc], facts: { 'li:icon': liIcon(el), hasImg: cmp.imgs > 0, hasSvg: !!el.querySelector('svg'), headings: cmp.headings, ctas: cmp.ctas, columns: columns(el) } });
  }
  return { theme, components };
}
/* eslint-enable no-undef */

// -------------------------------------------------------------------- driver

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
const expand = (globs) => globs.flatMap((g) => (existsSync(g) ? [g] : globSync(g)));

export function slugsFor(opts, root) {
  const statePath = join(root, 'state.json');
  if (opts.slugs) return readFileSync(opts.slugs, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (opts.fromClusters) {
    const file = readJson(opts.fromClusters);
    const types = (file.types || []).filter((t) => !opts.type || t.type === opts.type);
    const clusters = types.flatMap((t) => [...t.clusters, ...(opts.cluster ? [] : t.tail)]).filter((c) => !opts.cluster || c.id === opts.cluster);
    return [...new Set(clusters.flatMap((c) => c.pages))];
  }
  if (!existsSync(statePath)) throw new Error(`${statePath} not found — run extract first, or pass --slugs`);
  const state = readJson(statePath);
  const pages = Array.isArray(state.pages) ? state.pages : Object.entries(state.pages || {}).map(([slug, p]) => ({ slug, ...p }));
  return pages.filter((p) => p.slug && (!opts.type || p.type === opts.type)).map((p) => p.slug);
}

async function collect(slugs, pagesDir, markers) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const out = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    await ctx.route('**/*', (route) => { const req = route.request(); if (req.url().startsWith('file://') && req.resourceType() === 'document') route.continue(); else route.abort(); });
    const page = await ctx.newPage();
    let n = 0;
    for (const slug of slugs) {
      const file = join(pagesDir, `${slug}.html`);
      if (!existsSync(file)) { out.push({ slug, noSidecar: true }); continue; }
      await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      out.push({ slug, ...(await page.evaluate(collectPage, { markers })) });
      if (++n % 100 === 0) console.error(`variant-census: ${n}/${slugs.length} pages`);
    }
  } finally { await browser.close(); }
  return out;
}

async function classReportTable(census, outDir) {
  const candidates = ['../../stardust/scripts/class-report.mjs', '../stardust/class-report.mjs'].map((p) => resolve(HERE, p)).filter((p) => existsSync(p));
  const findings = findingsOf(census);
  if (!findings.length) return { table: [], via: 'none' };
  if (!candidates.length) return { table: ['  (class-report.mjs not found beside this scripts dir — ranked table omitted; unreferenced[] is in the census file)'], via: 'fallback' };
  const { classReport, renderTable, writeSummary } = await import(pathToFileURL(candidates[0]).href);
  const report = classReport(findings, { classKey: ['class'], pageKey: ['page'], messageKey: ['message'], pointerKey: ['file'] });
  writeSummary(join(outDir, 'variant-census'), report, { title: 'Unreferenced variant classes' });
  return { table: renderTable(report, { title: 'Unreferenced variant classes (class → pages → worst example → component)', maxLines: 30 }).map((l) => `  ${l}`), via: candidates[0] };
}

async function main() {
  const opts = parseArgs(process.argv);
  const root = resolve(opts.root);
  const out = resolve(opts.out || join(root, 'replica', 'variant-census.json'));
  let slugs;
  try { slugs = slugsFor(opts, root); } catch (e) { console.error(`variant-census: ${e.message}`); process.exit(1); }
  if (!slugs.length) { console.error(`variant-census: no pages in scope${opts.type ? ` for type ${opts.type}` : ''}`); process.exit(1); }
  const all = slugs.length; slugs = sampleSlugs(slugs, opts.sample);
  const scope = `${opts.fromClusters ? `clusters ${opts.cluster || 'all'}${opts.type ? ` of type ${opts.type}` : ''}` : opts.type ? `type ${opts.type}` : opts.slugs ? `slugs ${opts.slugs}` : 'all pages'}${slugs.length < all ? ` (sampled ${slugs.length} of ${all})` : ''}`;
  let referenced = null;
  if (opts.css.length || opts.code.length) {
    referenced = new Set();
    for (const f of expand(opts.css)) for (const t of tokensFromCss(readFileSync(f, 'utf8'))) referenced.add(t);
    for (const f of expand(opts.code)) for (const t of tokensFromCode(readFileSync(f, 'utf8'))) referenced.add(t);
  }
  let allow = new Map();
  if (opts.allow) {
    const { allow: a, errors } = parseAllow(readFileSync(opts.allow, 'utf8'));
    if (errors.length) { console.error(`variant-census: --allow lines without a reason: ${errors.join(' | ')} — every allowed class carries why`); process.exit(1); }
    allow = a;
  }
  const pagesFacts = await collect(slugs, join(root, 'current', 'pages'), opts.markers);
  const census = aggregate(pagesFacts, { minPages: opts.minPages, referenced, allow });
  const record = { generatedAt: new Date().toISOString(), scope, markers: opts.markers, css: opts.css, code: opts.code, allow: opts.allow, ...census };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(out.replace(/\.json$/, '') + '.md', renderMarkdown(census, pagesFacts, { scope }));
  if (opts.json) console.log(JSON.stringify(record, null, 2));
  else {
    const { table } = await classReportTable(census, dirname(out));
    console.log(renderCensus(census, { scope, table }).join('\n'));
    console.log(`→ ${out} (+ .md)`);
  }
  process.exit(census.exitCode);
}

const invokedDirectly = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedDirectly) main().catch((e) => { console.error(`variant-census error: ${e.message}`); process.exit(1); });
