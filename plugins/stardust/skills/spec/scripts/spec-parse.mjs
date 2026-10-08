#!/usr/bin/env node
/**
 * spec-parse.mjs — S3 parse: per fetched page, the ordered component tree of the main region (the neutral
 * contract every later stage reads), chrome flags, page signals (scripts, iframes, forms, metadata, hreflang,
 * JSON-LD) and links. No browser: server HTML only.
 *
 *   node spec-parse.mjs [--config spec.config.json] [--fetch <jsonl>] [--html <dir>] [--out <dir>]
 *
 * Parser profiles (config.parser.profile, reference/config.md):
 *   aem-classic — component roots are `c-*` classes (not `*-content`) or `colctrl`; columns from colctrl rows.
 *   aem-core    — component roots are grid members (`aem-GridColumn`); the first non-`aem-` class names the component;
 *                 consecutive members narrower than the grid form a `row` node with one column each.
 *   generic     — any other site: structural sections named from component hints (lib.mjs genericRules);
 *                 config.parser.nameAttrs adds attributes that carry a component name; stripPrefix a hash prefix.
 * config.parser.main: selector of the main region (comma = first match wins; default: main, [role=main], #main,
 * #content, #main-content, article, else body without header/footer/nav); chrome.{header,footer} selectors.
 * Node: { c, p (path id), mods, chars, imgs, videos, forms, links, h[], slides?, ncols?, cols?[[node]], kids?[node] }.
 * Writes <out>/components.jsonl, links.jsonl, signals.jsonl (defaults under <dir>/parse/).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  arg, classes, componentLayout, groupRows, helpAndExit, isInside, loadConfig, log, parseHTML, profileRules, query, queryAll, readJSONL, templateOf, textLen, walk, writeText,
} from './lib.mjs';

helpAndExit(import.meta.url);

const MOD_RE = /^(bg-.*|.*-bg|.*background.*|theme-.*|.*-theme|inverse|dark|light|.*gradient.*|text-(center|left|right)|.*-border|.*--.*|.*_.*|full-width|full-bleed)$/;
const SPACING_RE = /^(aem-.*|col-.*|padding-.*|margin-.*|.*-padding-.*|phe-.*|parbase|section|container|responsivegrid|row|clearfix|hidden-.*|full-width.*|lazyload)$/;

/* ------------------------------------------------------------ profiles --- */
const MEDIA = new Set(['img', 'picture', 'video', 'iframe', 'form', 'input', 'select', 'textarea', 'canvas', 'object', 'embed']);
/** The node adapter for profileRules over spec-parse's HTML tree (generic weights memoised: roots() asks level by level). */
function nodeAdapter() {
  const w = new WeakMap();
  const weight = (el) => { if (w.has(el)) return w.get(el); let m = 0; for (const n of walk(el)) if (MEDIA.has(n.tag)) m += 1; const v = textLen(el) + m; w.set(el, v); return v; };
  return { tag: (el) => el.tag, cls: classes, attr: (el, a) => el.attrs?.[a], kids: (el) => (el.children || []).filter((c) => c.tag), parent: (el) => (el.parent?.tag ? el.parent : null), weight };
}
const rulesFor = (profile, opts) => { const A = nodeAdapter(); return { ...profileRules(profile, A, opts), A }; };
export const PROFILES = { 'aem-classic': rulesFor('aem-classic'), 'aem-core': rulesFor('aem-core'), generic: rulesFor('generic') };
export const genericProfile = (opts = {}) => rulesFor('generic', opts);
export const profileFor = (cfg) => rulesFor(cfg.parser?.profile, { nameAttrs: cfg.parser?.nameAttrs, stripPrefix: cfg.parser?.stripPrefix });
export { groupRows };
export const MAIN_FALLBACK = ['main', '[role=main]', '#main', '#content', '#main-content', 'article'];
/** The main region and whether it is the whole body (then header/footer/nav children are chrome, not content). */
export function findMain(doc, sel) {
  const list = sel ? sel.split(',').map((x) => x.trim()) : MAIN_FALLBACK;
  for (const s of list) { const m = query(doc, s); if (m) return { main: m, isBody: false }; }
  const body = sel ? null : query(doc, 'body');
  return body ? { main: body, isBody: true } : { main: null, isBody: false };
}

/* --------------------------------------------------------------- tree ---- */
function stats(el) {
  const els = [...walk(el)];
  const d = {
    chars: textLen(el),
    // lazy images ship a placeholder (data-cmp-src, data-src, a picture with sources) instead of <img src>
    imgs: els.filter((e) => e.tag === 'img' || (e.tag === 'picture' && !e.children.some((c) => c.tag === 'img')) || ('data-cmp-src' in e.attrs) || (e.tag !== 'img' && 'data-src' in e.attrs && /\.(jpe?g|png|webp|gif|svg)|\/image|\/dam\//i.test(e.attrs['data-src']))).length,
    videos: els.filter((e) => e.tag === 'video' || e.tag === 'iframe' || /video/i.test(e.attrs.class || '')).length,
    forms: els.filter((e) => e.tag === 'form').length,
    links: els.filter((e) => e.tag === 'a' && e.attrs.href).length,
  };
  const h = els.filter((e) => /^h[1-4]$/.test(e.tag)).slice(0, 3).map((e) => textOfShort(e));
  if (h.length) d.h = h;
  return d;
}
const textOfShort = (e) => { const t = []; for (const n of walk(e)) if (n.children) n.children.forEach((c) => { if (c.text) t.push(c.text); }); const own = e.children.filter((c) => c.text).map((c) => c.text); return [...own, ...t].join(' ').replace(/\s+/g, ' ').trim().slice(0, 80); };

function mods(el) {
  const toks = [...classes(el), ...classes(el.parent || {})];
  for (const ch of el.children) if (ch.tag) toks.push(...classes(ch).filter((c) => c.includes('--')));
  return [...new Set(toks.filter((t) => MOD_RE.test(t) && !SPACING_RE.test(t)))].sort();
}

/** One layout node (lib.mjs componentLayout) as the parse contract's node: name, mods, sizes, then cols or kids. */
export function describe(n, R) {
  if (n.row) return { c: 'row', p: n.p, mods: [], chars: 0, imgs: 0, videos: 0, forms: 0, links: 0, ncols: n.members.length, widths: n.widths, cols: n.members.map((m) => [describe(m, R)]) };
  const name = R.name(n.el);
  const d = { c: name, p: n.p, mods: mods(n.el), ...stats(n.el) };
  if (name === 'c-autocarousel' || /carousel/.test(name)) d.slides = queryAll(n.el, '.carouselslide, .cmp-carousel__item').length || undefined;
  if (n.cols) { d.ncols = n.cols.length; d.cols = n.cols.map((col) => col.map((k) => describe(k, R))); }
  if (n.kids) d.kids = n.kids.map((k) => describe(k, R));
  return d;
}

export function topLevel(main, R, isBody = false) {
  return componentLayout(main, R, R.A, isBody).map((n) => describe(n, R));
}

/* ------------------------------------------------------------ signals ---- */
const host = (u) => { try { return new URL(u).hostname; } catch { return null; } };
export function pageSignals(doc, html, origin) {
  const body = query(doc, 'body') || doc;
  const meta = {};
  for (const m of queryAll(doc, 'meta')) { const k = m.attrs.name || m.attrs.property; if (k) meta[k] = (m.attrs.content || '').slice(0, 300); }
  const bodyData = Object.fromEntries(Object.entries(body.attrs || {}).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k, v.slice(0, 300)]));
  const scripts = queryAll(doc, 'script').map((s) => s.attrs.src).filter(Boolean).map((s) => s.replace(/\?.*$/, ''));
  const iframes = queryAll(doc, 'iframe').map((f) => f.attrs.src || f.attrs['data-src']).filter(Boolean);
  const forms = queryAll(doc, 'form').map((f) => (f.attrs.action || '').replace(/\?.*$/, ''));
  const hreflang = queryAll(doc, 'link').filter((l) => l.attrs.rel === 'alternate' && l.attrs.hreflang && l.attrs.hreflang !== 'x-default').map((l) => l.attrs.hreflang);
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => (m[1].match(/"@type"\s*:\s*"([^"]+)"/) || [])[1]).filter(Boolean);
  const inline = ['adobeDataLayer', 'digitalData', 'dataLayer', '_satellite', 'OneTrust', 'Munchkin', 'mktoForm', 'gtag(', 'fbq('].filter((k) => html.includes(k));
  const otDomainScripts = [...new Set(queryAll(doc, 'script').map((x) => x.attrs['data-domain-script']).filter(Boolean))];
  const html5 = query(doc, 'html');
  return {
    lang: html5?.attrs.lang || null, canonical: queryAll(doc, 'link').find((l) => l.attrs.rel === 'canonical')?.attrs.href || null,
    meta, bodyData, scripts: [...new Set(scripts)], scriptHosts: [...new Set(scripts.map((s) => host(new URL(s, origin).href)).filter(Boolean))],
    iframeHosts: [...new Set(iframes.map((s) => host(new URL(s, origin).href)).filter(Boolean))], forms: [...new Set(forms)], hreflang, jsonld, inline, otDomainScripts,
  };
}

function links(doc, main, origin, finalUrl) {
  const out = {};
  for (const a of queryAll(doc, 'a')) {
    const href = (a.attrs.href || '').trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let u; try { u = new URL(href, finalUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    const zone = main && isInside(a, main) ? 'main' : 'chrome';
    if (!out[u.href] || zone === 'main') out[u.href] = zone;
  }
  for (const el of queryAll(doc, 'img, source')) {
    const src = el.attrs.src || (el.attrs.srcset || '').split(/[\s,]+/)[0];
    if (!src) continue;
    try { const u = new URL(src, finalUrl); if (u.origin === origin && /\/content\/dam\//.test(u.pathname)) out[u.href] = out[u.href] || 'main'; } catch { /* skip */ }
  }
  return out;
}

/* --------------------------------------------------------------- main ---- */
async function main() {
  const cfg = loadConfig();
  if (!PROFILES[cfg.parser?.profile]) throw new Error(`config.parser.profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  const prof = profileFor(cfg);
  const fetchFile = arg('fetch', cfg.p('fetch', 'fetch.jsonl'));
  const htmlDir = arg('html', cfg.p('fetch', 'html'));
  const outDir = arg('out', cfg.p('parse'));
  const comps = []; const lnks = []; const sigs = [];
  const rows = readJSONL(fetchFile).filter((r) => r.html_key);
  rows.forEach((r, i) => {
    const html = gunzipSync(readFileSync(join(htmlDir, `${r.html_key}.html.gz`))).toString('utf8');
    const doc = parseHTML(html);
    const { main, isBody } = findMain(doc, cfg.parser.main);
    const chrome = Object.fromEntries(Object.entries(cfg.parser.chrome || {}).map(([k, sel]) => [k, !!query(doc, sel)]));
    const tree = main ? topLevel(main, prof, isBody) : [];
    comps.push(JSON.stringify({ url: r.url, final_url: r.final_url, template: templateOf(r, cfg), title: r.title, chrome, comps: tree, main_chars: main ? textLen(main) : 0, has_main: !!main }));
    lnks.push(JSON.stringify({ url: r.url, links: links(doc, main, cfg.origin, r.final_url) }));
    sigs.push(JSON.stringify({ url: r.url, ...pageSignals(doc, html, cfg.origin) }));
    if ((i + 1) % 500 === 0) log(`${i + 1}/${rows.length}`);
  });
  writeText(join(outDir, 'components.jsonl'), comps.join('\n'));
  writeText(join(outDir, 'links.jsonl'), lnks.join('\n'));
  writeText(join(outDir, 'signals.jsonl'), sigs.join('\n'));
  log(`${rows.length} pages parsed (${cfg.parser.profile}) → ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
