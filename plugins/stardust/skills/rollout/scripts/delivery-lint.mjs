#!/usr/bin/env node
/**
 * rollout/delivery-lint.mjs — PRE-deploy static linter for the EDS/DA delivery
 * contract. Encodes the deterministic rendering rules the pipeline otherwise
 * re-learns by failing (one-CTA-per-<p>, wrapper, trailing-slash, path-safety,
 * cross-origin image optimization, metadata, whitespace-only spacers, widget links). Run BEFORE PUT; a P0 blocks deploy.
 *
 * This is the static half of the delivery gates (the dynamic half — does it
 * actually render — is verify.mjs § renderer-truth). Reference:
 * reference/delivery-lint.md and reference/delivery-gates.md.
 *
 * Usage:
 *   node skills/rollout/scripts/delivery-lint.mjs --file <html> [--path </da/path>]
 *        [--type page|fragment|index] [--content content] [--json] [--optimizing-blocks a,b,c]
 *        [--slug <s>] [--current stardust/current] [--coverage stardust/rollout/coverage/pages.json]
 * --content: the content tree (default ./content when present) — tells a folder index, served at /x/,
 * from a leaf served at /x, so a trailing slash is judged by its target. Its parent is the code tree:
 * when it holds widgets/, every /widgets/<path>/<name>.html link must resolve to a file there.
 * --slug: the page's source capture <current>/pages/<slug>.json (extract's crawl); without it, the
 * --coverage row whose path matches --path names the slug. A page with no <h1> whose capture records
 * headings without an h1 gets a `note` (a recorded source trait), never a failure — content is never
 * edited to satisfy a verifier. No capture consulted → the P0 stands.
 * Exit: 0 = clean (no P0/P1; P2 and notes never block), 1 = P0/P1 findings, 2 = bad invocation.
 * Writes: nothing — findings (text or --json) go to stdout; the text ends with `<n> P0 · <n> P1 · <n> P2`,
 * then `· <n> note(s)` on its own line when there are notes.
 *
 * Blocks known to run createOptimizedPicture over their images (cross-origin
 * breakage risk) — extend per project via --optimizing-blocks a,b,c
 * (default cards,columns,hero).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reservedStem } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

function arg(name, fb) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const FILE = arg('file', null);
const DAPATH = arg('path', null);
const TYPE = arg('type', null); // page | fragment | index — inferred if absent
const JSON_OUT = process.argv.includes('--json');
const OPTIMIZING = (arg('optimizing-blocks', 'cards,columns,hero')).split(',').map((s) => s.trim()).filter(Boolean);
if (!FILE) { console.error('delivery-lint: need --file <html>'); process.exit(2); }
// the content tree tells a folder index (x/index.html, served at /x/) from a leaf (x.html, served at /x)
const CONTENT = arg('content', existsSync('content') ? 'content' : null);
const SLUG = arg('slug', null);
const CURRENT = arg('current', 'stardust/current');
const COVERAGE = arg('coverage', 'stardust/rollout/coverage/pages.json');
const { pathKey } = await import(pathToFileURL([join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), join(HERE, '..', 'deploy', 'eds-path.mjs')].find((x) => existsSync(x)) || join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs')).href);
const targetKind = (key) => {
  if (!CONTENT) return null;
  if (existsSync(join(CONTENT, key === '/' ? 'index.html' : `${key.slice(1)}/index.html`))) return 'folder';
  return existsSync(join(CONTENT, `${key.slice(1)}.html`)) ? 'leaf' : null;
};
// the code tree (blocks/, widgets/) is the content tree's parent; widget links are checked only when widgets/ exists
const WIDGETS_DIR = CONTENT ? resolve(CONTENT, '..', 'widgets') : (existsSync('widgets') ? resolve('widgets') : null);
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

/* ---- h1 cardinality (typed). A page whose source has no h1 keeps that trait: a note, never a failure ---- */
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
// --slug, else the one coverage slug whose path matches --path (eds-path.mjs pathKey); ambiguous → none
function pageSlug() {
  if (SLUG) return SLUG;
  const rows = DAPATH ? (readJSON(COVERAGE) || {}).pages : null;
  if (!Array.isArray(rows)) return null;
  const slugs = [...new Set(rows.filter((r) => r && r.slug && r.path && pathKey(r.path) === pathKey(DAPATH)).map((r) => r.slug))];
  return slugs.length === 1 ? slugs[0] : null;
}
// 'none' when the capture parses with a headings array and no h1 in it; 'h1' when it has one; null = not consulted
function sourceH1(slug) {
  const cap = slug ? readJSON(join(CURRENT, 'pages', `${slug}.json`)) : null;
  if (!cap || !Array.isArray(cap.headings)) return null;
  return cap.headings.some((h) => h && String(h.tag).toLowerCase() === 'h1') ? 'h1' : 'none';
}
const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
if (type === 'page' && h1Count > 1) add('P1', 'h1', `expected exactly one <h1>, found ${h1Count}`);
if (type === 'page' && h1Count === 0) {
  const source = sourceH1(pageSlug());
  if (source === 'none') add('note', 'h1', 'source has no h1 (recorded source trait) — content is never edited to satisfy a verifier');
  else add('P0', 'h1', `expected exactly one <h1>, found 0${source ? '' : ' (no source capture consulted: pass --slug)'}`);
}
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

/* ---- spacer whitespace (#112): the content pipeline drops a <p>/<h1>–<h6> holding only whitespace,
   non-breaking spaces and <br>, and a <div> holding only <br> — the source's spacer height must be
   modelled as spacing CSS (deploy SKILL.md § The ENCODE contract). Advisory. ---- */
if (type !== 'index') {
  // \s covers a raw U+00A0; no two alternatives may match the same text, or a failed match backtracks exponentially;
  // a <br> never spans a `<`, or an unclosed `<br ` runs to the next tag from every start (quadratic)
  const SPACER = '(?:\\s|&nbsp;|&#160;|&#xa0;|<br\\b[^<>]*>)*';
  const spacers = new Map(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'].map((t) => [t, 0]));
  for (const m of html.matchAll(new RegExp(`<(p|h[1-6])\\b[^>]*>${SPACER}</\\1\\s*>`, 'gi'))) spacers.set(m[1].toLowerCase(), spacers.get(m[1].toLowerCase()) + 1);
  for (const m of html.matchAll(new RegExp(`<div\\b[^>]*>(${SPACER})</div\\s*>`, 'gi'))) if (/<br\b/i.test(m[1])) spacers.set('div', spacers.get('div') + 1);
  for (const [tag, n] of spacers) {
    if (n) add('P2', 'spacer-whitespace', `${n} whitespace-only <${tag}> — dropped by the content pipeline: model the height as spacing CSS (deploy SKILL.md § The ENCODE contract, #112)`);
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

/* ---- internal link hygiene: no .html — except the one widget mount, /widgets/<path>/<name>.html?<params>, which
   must name existing widget code with a block-safe stem; a trailing slash exactly on a folder index (eds-path.mjs) ---- */
for (const m of html.matchAll(/href="(\/[^"]*)"/gi)) {
  const href = m[1]; const bare = href.replace(/[?#].*/, '');
  if (bare === '/') continue;
  if (/^\/widgets\/.+\.html$/i.test(bare)) {
    const stem = bare.replace(/^.*\//, '').replace(/\.html$/i, '');
    if (reservedStem(stem)) add('P1', 'widget-name', `widget name "${stem}" collides with a reserved block class or a derived -wrapper/-container class: ${href}`);
    else if (WIDGETS_DIR && existsSync(WIDGETS_DIR) && !existsSync(join(WIDGETS_DIR, bare.slice('/widgets/'.length)))) add('P1', 'unknown-widget', `widget link names no file under widgets/ (${bare.slice(1)} missing): ${href}`);
    continue;
  }
  const kind = targetKind(pathKey(bare));
  if (bare.endsWith('/')) {
    if (kind === 'leaf') add('P1', 'trailing-slash', `internal link to a page has a trailing slash (404s on EDS): ${href}`);
    else if (!kind) add('P2', 'trailing-slash', `internal link has a trailing slash; right only for a folder index, and its target is not in ${CONTENT || 'the content tree (pass --content)'}: ${href}`);
  } else if (kind === 'folder' && !/\.html$/i.test(bare)) {
    add('P1', 'folder-index-slash', `internal link to a folder index without its trailing slash (404s on a plain EDS site): ${href} → ${bare}/`);
  }
  if (/\.html(\?|#|$)/i.test(href)) add('P1', 'html-extension', `internal link ends in .html (EDS serves extensionless): ${href}`);
}

/* ---- path-safety of the target DA path ---- */
if (DAPATH) {
  const norm = DAPATH.toLowerCase()
    .split('/').map((s) => s.replace(/_/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')).join('/')
    .replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  if (norm !== DAPATH) add('P0', 'path-safety', `path is not delivery-safe; normalize ${DAPATH} → ${norm} (record in redirects.tsv)`);
  if (/\/\//.test(DAPATH)) add('P0', 'path-safety', 'double slash in path makes the DA PUT 400 while preview/live still 200');
}

/* ---- metadata block present (rich indexes at import time) ---- */
if (type === 'page' && !/class="metadata"/i.test(html)) {
  add('P2', 'metadata', 'no metadata block — query-index rows will be thin (title/description/og:image)');
}

const p0 = findings.filter((f) => f.sev === 'P0');
const p1 = findings.filter((f) => f.sev === 'P1');
const notes = findings.filter((f) => f.sev === 'note').length;
if (JSON_OUT) {
  console.log(JSON.stringify({ file: FILE, type, findings, gate: p0.length || p1.length ? 'FAIL' : 'PASS' }, null, 2));
} else {
  console.log(`delivery-lint ${FILE} (type:${type})`);
  console.log('='.repeat(60));
  if (!findings.length) console.log('  clean — no contract violations');
  for (const f of findings) console.log(`  ${f.sev} ${f.rule.padEnd(22)} ${f.msg}`);
  // the count line stays exactly `<n> P0 · <n> P1 · <n> P2` (gate evidence parses it); notes follow on their own line
  console.log(`\n${p0.length} P0 · ${p1.length} P1 · ${findings.filter((f) => f.sev === 'P2').length} P2`);
  if (notes) console.log(`· ${notes} note(s)`);
}
process.exit(p0.length || p1.length ? 1 : 0);
