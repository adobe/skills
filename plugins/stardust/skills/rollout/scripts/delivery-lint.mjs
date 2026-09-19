#!/usr/bin/env node
/**
 * rollout/delivery-lint.mjs — PRE-deploy static linter for the EDS/DA delivery
 * contract. Encodes the deterministic rendering rules the pipeline otherwise
 * re-learns by failing (one-CTA-per-<p>, wrapper, trailing-slash, path-safety,
 * cross-origin image optimization, metadata). Run BEFORE PUT; a P0 blocks deploy.
 *
 * This is the static half of the delivery gates (the dynamic half — does it
 * actually render — is verify.mjs § renderer-truth). Reference:
 * reference/delivery-lint.md and reference/delivery-gates.md.
 *
 * Usage:
 *   node skills/rollout/scripts/delivery-lint.mjs --file <html> [--path </da/path>]
 *        [--type page|fragment|index] [--icons-dir <dir>] [--allow-empty <name,…>]
 *        [--chrome-docs <nav.html>,<footer.html>,… [--content <dir>]] [--json]
 * Exit: 0 = clean (no P0/P1), 1 = P0/P1 findings, 2 = bad invocation.
 *
 * Pre-PUT mirrors of the deploy lint (davids-model-lint D1-EMPTY) and href hygiene:
 *   empty-block P1      a block table with 0 rows inside <main> — silent content loss;
 *                       --allow-empty <name,…> exempts declared runtime-widget placeholders
 *   href-scheme P1      `javascript:` or a bare `#` / `#!` href — a dead CTA after decoration
 *   href-whitespace P1  leading/trailing whitespace inside the href value (404s at delivery)
 *
 * --chrome-docs <files> reads the authored chrome documents (kind = nav | footer from the
 * file name), dedupes each kind by content hash and, on a MULTI-variant site, requires an
 * explicit `nav:` / `footer:` metadata row on every page (P1 chrome-variant); > 3 variants
 * of one kind is P2 chrome-variant-count. Pages checked: --file, plus every page under
 * --content <dir> when given (chrome docs and fragments excluded). Single-variant sites
 * are silent — exit semantics unchanged (deploy/reference/chrome.md § Chrome states and variants).
 *
 * --icons-dir <dir> enables the icon-token checks (silent without it): every
 * `:name:` token / `<span class="icon icon-name">` must resolve to <dir>/name.svg|png
 * (P0 icon-missing); an authored `:icon-x:` while <dir>/x.svg exists doubles the
 * prefix the runtime adds and renders a broken-image box (P0 icon-prefix). Same
 * scan as deploy/scripts/davids-model-lint.mjs ICON-MISSING / ICON-PREFIX.
 *
 * Blocks known to run createOptimizedPicture over their images (cross-origin
 * breakage risk) — extend per project via --optimizing-blocks a,b,c.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';

function arg(name, fb) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const FILE = arg('file', null);
const DAPATH = arg('path', null);
const TYPE = arg('type', null); // page | fragment | index — inferred if absent
const JSON_OUT = process.argv.includes('--json');
const OPTIMIZING = (arg('optimizing-blocks', 'cards,columns,hero')).split(',').map((s) => s.trim()).filter(Boolean);
const ICONS_DIR = arg('icons-dir', null);
const ALLOW_EMPTY = new Set((arg('allow-empty', '')).split(',').map((s) => s.trim()).filter(Boolean));
const CHROME_DOCS = (arg('chrome-docs', '')).split(',').map((s) => s.trim()).filter(Boolean);
const CONTENT_DIR = arg('content', null);
if (!FILE) { console.error('delivery-lint: need --file <html>'); process.exit(2); }
for (const f of CHROME_DOCS) if (!existsSync(f)) { console.error(`delivery-lint: --chrome-docs file not found: ${f}`); process.exit(2); }
if (CONTENT_DIR && !(existsSync(CONTENT_DIR) && statSync(CONTENT_DIR).isDirectory())) { console.error(`delivery-lint: --content needs an existing directory (got ${CONTENT_DIR})`); process.exit(2); }
if (process.argv.includes('--icons-dir') && !(ICONS_DIR && existsSync(ICONS_DIR) && statSync(ICONS_DIR).isDirectory())) {
  console.error(`delivery-lint: --icons-dir needs an existing directory (got ${ICONS_DIR ?? 'nothing'})`); process.exit(2);
}
const html = readFileSync(FILE, 'utf8');

function inferType(p) {
  if (!p) return 'page';
  const s = p.toLowerCase();
  // anchor fragment detection: only top-level /nav,/footer or a /fragments/ path —
  // a content page like /about/nav must NOT be downgraded out of the P0 gates.
  if (/^\/(nav|footer)$/.test(s) || /\/fragments?\//.test(s)) return 'fragment';
  if (/query-index(\.json)?$/.test(s) || /\.json$/.test(s)) return 'index';
  return 'page';
}
const type = TYPE || inferType(DAPATH);
const findings = [];
const add = (sev, rule, msg) => findings.push({ sev, rule, msg });

/* ---- structural wrapper (DA silently discards content without it) ---- */
if (type !== 'index') {
  const hasBody = /<body[\s>]/i.test(html);
  const hasMain = /<main[\s>]/i.test(html);
  if (!hasBody || !hasMain) add('P0', 'wrapper', 'missing <body>…<main>…</main>…</body> wrapper — DA discards content without it');
  if (!/<header>\s*<\/header>|<header[\s>]/i.test(html)) add('P1', 'wrapper', 'missing <header> tag (DA expects <header></header>)');
  if (!/<footer>\s*<\/footer>|<footer[\s>]/i.test(html)) add('P1', 'wrapper', 'missing <footer> tag (DA expects <footer></footer>)');
}

/* ---- h1 cardinality (typed) ---- */
const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
if (type === 'page' && h1Count !== 1) add(h1Count === 0 ? 'P0' : 'P1', 'h1', `expected exactly one <h1>, found ${h1Count}`);
if (type === 'fragment' && h1Count > 0) add('P1', 'h1', `fragment should not contain an <h1> (found ${h1Count})`);

/* ---- one CTA per <p> (decorateButtons only buttonizes a link that is the
   sole content of its <p>; two links in one <p> ship as unstyled text) ---- */
for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
  const inner = m[1];
  const links = (inner.match(/<a\b[^>]*>/gi) || []).length;
  const emphasized = /<(strong|em)\b/i.test(inner);
  // a buttonizable paragraph wraps its link(s) in strong/em; >1 link there breaks buttonization
  if (links > 1 && emphasized) {
    add('P1', 'one-cta-per-p', 'paragraph contains >1 emphasized link — split each CTA into its own <p> or they ship unstyled');
  }
}

/* ---- image hygiene ---- */
const imgs = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
if (/about:error/i.test(html)) add('P0', 'about-error', 'about:error present — a broken image rendition shipped');
for (const src of imgs) {
  if (/^\/img\//i.test(src)) add('P0', 'img-path', `/img/ src will 404 at delivery: ${src.slice(0, 60)}`);
}
/* cross-origin <img> inside an optimizing block → createOptimizedPicture breaks it */
for (const blk of OPTIMIZING) {
  const re = new RegExp(`class="${blk}(\\s[^"]*)?"([\\s\\S]*?)(?=<div class="(?!${blk})|</main>)`, 'i');
  const seg = html.match(re);
  if (!seg) continue;
  for (const m of seg[2].matchAll(/<img\b[^>]*\ssrc="(https?:\/\/[^"]+)"/gi)) {
    add('P2', 'cross-origin-optimize', `external <img> inside .${blk} (optimizing block) — run media-reconcile (skip-optimize or rehost) to confirm it renders: ${m[1].slice(0, 50)}…`);
  }
}

/* ---- internal link hygiene: no trailing slash, no .html ---- */
for (const m of html.matchAll(/href="(\/[^"]*)"/gi)) {
  const href = m[1];
  if (href === '/') continue;
  if (/\/(#|$)/.test(href.replace(/[?#].*/, '')) && href.replace(/[?#].*/, '').endsWith('/')) {
    add('P1', 'trailing-slash', `internal link has a trailing slash (404s on EDS): ${href}`);
  }
  if (/\.html(\?|#|$)/i.test(href)) add('P1', 'html-extension', `internal link ends in .html (EDS serves extensionless): ${href}`);
}

/* ---- href hygiene: scheme + whitespace (a `javascript:`/bare-`#` CTA is dead after
   decorateButtons; whitespace inside the value is a 404 the browser hides locally) ---- */
for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)) {
  const href = m[1];
  if (/^\s*javascript:/i.test(href) || /^\s*#!?\s*$/.test(href)) add('P1', 'href-scheme', `dead href (javascript: or bare #): ${href.slice(0, 60) || '#'}`);
  if (href !== href.trim()) add('P1', 'href-whitespace', `whitespace inside the href value: "${href.slice(0, 60)}"`);
}

/* ---- empty block table inside <main> (pre-PUT mirror of deploy lint D1-EMPTY):
   0 rows = the encoder's selector missed the source items — silent content loss ---- */
if (type !== 'index') {
  const mainOnly = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [, html])[1];
  for (const m of mainOnly.matchAll(/<div class="([^"]+)">\s*<\/div>/g)) {
    const name = m[1].split(/\s+/)[0];
    if (!ALLOW_EMPTY.has(name)) add('P1', 'empty-block', `${name}: block table with 0 rows — silent content loss; fix the encoder or declare a runtime-widget placeholder with --allow-empty ${name}`);
  }
}

/* ---- path-safety of the target DA path ---- */
if (DAPATH) {
  const norm = DAPATH.toLowerCase()
    .split('/').map((s) => s.replace(/_/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')).join('/')
    .replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  if (norm !== DAPATH) add('P0', 'path-safety', `path is not delivery-safe; normalize ${DAPATH} → ${norm} (record in redirects.tsv)`);
  if (/\/\//.test(DAPATH)) add('P0', 'path-safety', 'double slash in path makes the DA PUT 400 while preview/live still 200');
}

/* ---- icon tokens resolve to an asset (--icons-dir only). The runtime turns
   `:x:` into <span class="icon icon-x"> and fetches /icons/x.svg — a token with
   no SVG ships a broken-image box; an authored `:icon-x:` fetches icon-x.svg. ---- */
if (ICONS_DIR) {
  const ICON_TOKEN = /(?<![\w:]):([a-z][a-z0-9_-]*):(?![\w:])/g;
  const mainHtml = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [, html])[1];
  const iconExists = (n) => ['svg', 'png'].some((ext) => existsSync(join(ICONS_DIR, `${n}.${ext}`)));
  const tokens = new Set();
  for (const m of mainHtml.replace(/<[^>]+>/g, ' ').matchAll(ICON_TOKEN)) tokens.add(m[1]);
  for (const m of mainHtml.matchAll(/<span\b[^>]*\bclass="([^"]*)"/gi)) {
    const cls = m[1].split(/\s+/);
    if (cls.includes('icon')) for (const c of cls) if (c.startsWith('icon-') && c.length > 5) tokens.add(c.slice(5));
  }
  for (const t of [...tokens].sort()) {
    if (iconExists(t)) continue;
    if (t.startsWith('icon-') && iconExists(t.slice(5))) add('P0', 'icon-prefix', `:${t}: doubles the icon- prefix the runtime adds (${ICONS_DIR}/${t.slice(5)}.svg exists, ${t}.svg does not) — author :${t.slice(5)}:`);
    else add('P0', 'icon-missing', `:${t}: has no ${ICONS_DIR}/${t}.svg|png — the asset must exist in the branch before the PUT`);
  }
}

/* ---- chrome variants (--chrome-docs): on a multi-variant site every page names its
   nav:/footer: document; > 3 variants of one kind is a vocabulary smell ---- */
if (CHROME_DOCS.length) {
  const kindOf = (f) => (basename(f).match(/^(nav|footer)/i) || [])[1]?.toLowerCase() ?? null;
  const variants = { nav: new Set(), footer: new Set() };
  for (const f of CHROME_DOCS) { const k = kindOf(f); if (k) variants[k].add(createHash('sha1').update(readFileSync(f, 'utf8').replace(/\s+/g, ' ')).digest('hex')); }
  const multi = Object.keys(variants).filter((k) => variants[k].size > 1);
  for (const k of multi) if (variants[k].size > 3) add('P2', 'chrome-variant-count', `${variants[k].size} distinct ${k} documents — more than three per kind is a vocabulary smell (chrome.md § Chrome states and variants)`);
  if (multi.length) {
    const chromeSet = new Set(CHROME_DOCS.map((f) => relative(process.cwd(), f)));
    const pages = [{ file: FILE, html }];
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (!/^fragments?$/.test(e.name)) walk(p); } else if (/\.html$/.test(e.name) && !kindOf(p) && !chromeSet.has(relative(process.cwd(), p)) && p !== FILE) pages.push({ file: p, html: readFileSync(p, 'utf8') }); } };
    if (CONTENT_DIR) walk(CONTENT_DIR);
    for (const pg of pages) {
      const meta = (pg.html.match(/<div class="metadata">([\s\S]*?)(?=<div class="|<\/main>)/i) || [])[1] || '';
      const rows = new Set([...meta.matchAll(/<div>\s*<div>\s*(?:<p>)?\s*([a-z][a-z-]*)\s*(?:<\/p>)?\s*<\/div>/gi)].map((m) => m[1].toLowerCase()));
      for (const k of multi) if (!rows.has(k)) add('P1', 'chrome-variant', `${pg.file}: no \`${k}:\` metadata row on a site with ${variants[k].size} ${k} variants — name the document (chrome.md § Per-page chrome variants)`);
    }
  }
}

/* ---- metadata block present (rich indexes at import time) ---- */
if (type === 'page' && !/class="metadata"/i.test(html)) {
  add('P2', 'metadata', 'no metadata block — query-index rows will be thin (title/description/og:image)');
}

const p0 = findings.filter((f) => f.sev === 'P0');
const p1 = findings.filter((f) => f.sev === 'P1');
if (JSON_OUT) {
  console.log(JSON.stringify({ file: FILE, type, findings, gate: p0.length || p1.length ? 'FAIL' : 'PASS' }, null, 2));
} else {
  console.log(`delivery-lint ${FILE} (type:${type})`);
  console.log('='.repeat(60));
  if (!findings.length) console.log('  clean — no contract violations');
  for (const f of findings) console.log(`  ${f.sev} ${f.rule.padEnd(22)} ${f.msg}`);
  console.log(`\n${p0.length} P0 · ${p1.length} P1 · ${findings.filter((f) => f.sev === 'P2').length} P2`);
}
process.exit(p0.length || p1.length ? 1 : 0);
