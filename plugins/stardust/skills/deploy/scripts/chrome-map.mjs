#!/usr/bin/env node
/**
 * skills/deploy/scripts/chrome-map.mjs — the chrome map: which nav and footer documents each delivered page uses.
 *
 * Run from deploy Step 6, right after the nav/footer documents are written. The sibling encoder reads the map to
 * fill each page's nav/footer metadata rows (contract: skills/deploy/schemas/deploy-chrome-map.schema.json).
 *
 * Inputs (local files only; no network):
 *   chrome documents under --content: `nav.html` + `footer.html` at the root (the site-wide pair),
 *     `<prefix>/nav.html` + `<prefix>/footer.html` (a locale folder, served at /fr/nav) and `nav-<id>.html` +
 *     `footer-<id>.html` at the root (a flat per-locale pair, /nav-ca-en, matched on the delivered path's
 *     segments joined by `-`). Anything else — a mega-menu fragment under content/nav/, a page — is not chrome.
 *   captured pages: stardust/current/pages/<slug>.json (`url`) and its <slug>.html sidecar (`<html lang>`).
 * Rule: each page's delivered path (eds-path deliveredUrl) takes the nav and the footer of its LONGEST matching
 *   prefix, each on its own (a folder document beats a flat one at the same depth). Pages sharing the deeper of
 *   the two prefixes form one group, keyed by that prefix (`/`, `/ca/en`); the group's `lang` is the most common
 *   captured lang of its pages (a tie → the first in code-point order; none → null).
 * Output: stardust/rollout/chrome-map.json —
 *   {_provenance, groups: {<prefix>: {nav, footer, lang, pages[], navFile?, footerFile?}}}; sorted keys, no
 *   timestamp, trailing newline, tmp + rename, written only when its bytes change. NOTE lines name a group whose
 *   pages disagree on lang, a group whose nav and footer come from different prefixes, and a chrome document no
 *   captured page resolves to (a per-page variant such as /nav-minimal is set in that page's own metadata).
 *
 * Usage: node skills/deploy/scripts/chrome-map.mjs [--root <projectDir>] [--content <dir>] [--dry-run]
 * Exit codes: 0 written, unchanged or nothing to map (no captured pages); 1 no nav or footer document under
 *   --content; 2 usage error.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveredUrl } from './eds-path.mjs';

const HELP = `chrome-map — which nav/footer documents each delivered page uses (stardust/rollout/chrome-map.json)

Usage: node chrome-map.mjs [--root <projectDir>] [--content <dir>] [--dry-run]
  --root <dir>      the project root, i.e. the EDS code repository (default: the current directory)
  --content <dir>   the authored content tree, relative to --root (default content)
  --dry-run         print the groups and the verdict, write nothing
  --help            this text

Reads the nav/footer documents under --content (nav.html + footer.html; <prefix>/nav.html + <prefix>/footer.html;
nav-<id>.html + footer-<id>.html at the root) and the captured pages (stardust/current/pages/<slug>.json url,
<slug>.html <html lang>). Each page takes the nav and the footer of its longest matching delivered-path prefix;
pages sharing that prefix form one group, with the group's most common lang.
Writes stardust/rollout/chrome-map.json under --root: sorted keys, no timestamp, only when its bytes change.
Exit 0 = written, unchanged or nothing to map; 1 = no nav or footer document under --content; 2 = usage.`;

const USAGE_EXIT = 2;
const OUT = 'stardust/rollout/chrome-map.json';
const PAGES = 'stardust/current/pages';
const FLAT = /^(nav|footer)-([a-z0-9][a-z0-9-]*)\.html$/;
const LANG = /<html\b[^>]*?\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
export const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function usage(msg) { console.error(`chrome-map error: ${msg}\n\n${HELP}`); process.exit(USAGE_EXIT); }

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { root: '.', content: 'content', dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const next = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) usage(`${a} needs a value${v === undefined ? '' : ` (got ${v})`}`); return rest[i += 1]; };
    if (a === '--root') o.root = next();
    else if (a === '--content') o.content = next();
    else if (a === '--dry-run') o.dryRun = true;
    else usage(`unknown argument ${a}`);
  }
  return o;
}

/** The nav/footer documents under contentDir: {kind, file (relative, posix), daPath, folder|null, flat|null}. */
export function findChromeDocs(contentDir) {
  const docs = [];
  const walk = (dir, segs) => {
    for (const name of readdirSync(dir).sort(byCodePoint)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full, [...segs, name]); continue; }
      const file = [...segs, name].join('/');
      const folder = /^(nav|footer)\.html$/.exec(name);
      const flat = !segs.length && FLAT.exec(name);
      if (folder) docs.push({ kind: folder[1], file, daPath: `/${file.slice(0, -5)}`, folder: segs.join('/'), flat: null });
      else if (flat) docs.push({ kind: flat[1], file, daPath: `/${file.slice(0, -5)}`, folder: null, flat: flat[2] });
    }
  };
  if (existsSync(contentDir) && statSync(contentDir).isDirectory()) walk(contentDir, []);
  return docs;
}

// The <html lang> of a capture: the tag sits at the top of the file, so the first 64 KiB are enough.
function captureLang(file) {
  if (!existsSync(file)) return null;
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const m = LANG.exec(buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8'));
    const v = m ? (m[1] ?? m[2] ?? m[3]).trim() : '';
    return v || null;
  } finally { closeSync(fd); }
}

/** Captured pages: {slug, path (delivered URL path), lang|null}; records without an http(s) `url` are skipped. */
export function readCaptures(pagesDir) {
  if (!existsSync(pagesDir) || !statSync(pagesDir).isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(pagesDir).filter((f) => f.endsWith('.json')).sort(byCodePoint)) {
    let u;
    try { u = new URL(JSON.parse(readFileSync(join(pagesDir, name), 'utf8')).url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const slug = name.slice(0, -5);
    out.push({ slug, path: deliveredUrl(u.pathname), lang: captureLang(join(pagesDir, `${slug}.html`)) });
  }
  return out;
}

/** Pure: the map and its NOTE lines from the chrome documents and the captured pages (input order is irrelevant). */
export function buildChromeMap({ docs, pages, contentRel = 'content' }) {
  const index = { nav: { folder: new Map(), flat: new Map() }, footer: { folder: new Map(), flat: new Map() } };
  for (const d of docs) {
    if (d.flat != null) index[d.kind].flat.set(d.flat, d);
    else index[d.kind].folder.set(d.folder, d);
  }
  const match = (kind, segs) => {
    for (let k = segs.length; k >= 0; k -= 1) {
      const folder = index[kind].folder.get(segs.slice(0, k).join('/'));
      if (folder) return { k, doc: folder };
      const flat = k > 0 && index[kind].flat.get(segs.slice(0, k).join('-'));
      if (flat) return { k, doc: flat };
    }
    return { k: 0, doc: null };
  };
  const groups = new Map();
  const used = new Set();
  for (const p of pages) {
    const segs = p.path.split('/').filter(Boolean);
    const nav = match('nav', segs);
    const footer = match('footer', segs);
    const id = `/${segs.slice(0, Math.max(nav.k, footer.k)).join('/')}`;
    if (!groups.has(id)) groups.set(id, { nav, footer, pages: new Set(), langs: new Map() });
    const g = groups.get(id);
    g.pages.add(p.path);
    if (p.lang) g.langs.set(p.lang, (g.langs.get(p.lang) || 0) + 1);
    for (const m of [nav, footer]) if (m.doc) used.add(m.doc.file);
  }
  const notes = [];
  const out = {};
  for (const id of [...groups.keys()].sort(byCodePoint)) {
    const g = groups.get(id);
    const langs = [...g.langs].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]));
    const row = { nav: g.nav.doc ? g.nav.doc.daPath : '/nav', footer: g.footer.doc ? g.footer.doc.daPath : '/footer', lang: langs.length ? langs[0][0] : null, pages: [...g.pages].sort(byCodePoint) };
    if (g.nav.doc) row.navFile = `${contentRel}/${g.nav.doc.file}`;
    if (g.footer.doc) row.footerFile = `${contentRel}/${g.footer.doc.file}`;
    out[id] = row;
    if (langs.length > 1) notes.push(`NOTE ${id}: lang ${langs.map(([l, c], i) => (i ? `${l} on ${c}` : `${l} on ${c} page(s)`)).join(', ')} — the most common is recorded`);
    if (g.nav.k !== g.footer.k) notes.push(`NOTE ${id}: nav ${row.nav} and footer ${row.footer} resolve from different prefixes — author the missing document if this prefix has chrome of its own`);
    for (const kind of ['nav', 'footer']) if (!g[kind].doc) notes.push(`NOTE ${id}: no ${kind} document matches — /${kind} is recorded, with no file`);
  }
  for (const d of [...docs].sort((a, b) => byCodePoint(a.daPath, b.daPath))) {
    if (!used.has(d.file)) notes.push(`NOTE ${d.daPath}: no captured page resolves to it (a per-page variant is set in that page's own metadata)`);
  }
  return { map: { _provenance: { writtenBy: 'stardust:deploy chrome-map.mjs', readArtifacts: [`${contentRel}/`, `${PAGES}/`] }, groups: out }, notes };
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort(byCodePoint).map((k) => [k, sortKeys(v[k])])) : v);
/** Deterministic JSON text: keys sorted at every level, two-space indent, trailing newline. */
export const stableJSON = (obj) => `${JSON.stringify(sortKeys(obj), null, 2)}\n`;

/** Write `data` (string or bytes) via a sibling tmp file + rename, only when the file's bytes differ; true = written. */
export function writeIfChanged(path, data) {
  const bytes = Buffer.from(data);
  if (existsSync(path) && readFileSync(path).equals(bytes)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
  return true;
}

function main() {
  const o = parseArgs(process.argv);
  const root = resolve(o.root);
  const contentDir = resolve(root, o.content);
  const contentRel = relative(root, contentDir).split(sep).join('/') || '.';
  const docs = findChromeDocs(contentDir);
  if (!docs.length) {
    console.error(`chrome-map: no nav or footer document under ${contentRel}/ — run it after deploy Step 6 writes them`);
    process.exit(1);
  }
  const pages = readCaptures(join(root, PAGES));
  if (!pages.length) {
    console.log(`chrome-map: no captured pages under ${PAGES} — nothing to map (the encoder falls back to /nav and /footer)`);
    return;
  }
  const { map, notes } = buildChromeMap({ docs, pages, contentRel });
  const text = stableJSON(map);
  const out = join(root, OUT);
  let verdict;
  if (o.dryRun) verdict = existsSync(out) && readFileSync(out, 'utf8') === text ? 'dry-run: unchanged' : 'dry-run: would write';
  else verdict = writeIfChanged(out, text) ? 'written' : 'unchanged';
  const groups = Object.entries(map.groups);
  for (const [id, g] of groups) console.log(`  ${id}  nav ${g.nav}  footer ${g.footer}  lang ${g.lang ?? '-'}  ${g.pages.length} page(s)`);
  for (const line of notes) console.log(line);
  console.log(`chrome-map: ${groups.length} group(s), ${groups.reduce((n, [, g]) => n + g.pages.length, 0)} page(s) → ${OUT} (${verdict})`);
}

// Compare by real path (a symlinked checkout would otherwise turn the CLI into a silent no-op).
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) main();
