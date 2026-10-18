#!/usr/bin/env node
/**
 * rollout/media-manifest.mjs — the delivered media of every page: per delivered document, each media reference with
 * the source URL(s) it was harvested from and the delivered path it lives at.
 *
 * Why: three recorded hands-off runs hand-wrote this helper to answer "which source image became which delivered
 * file, on which page" — from the deploy media ledger and the delivered documents, which already hold every fact.
 * It reads; it never fetches, uploads or rewrites.
 *
 * Usage:
 *   node media-manifest.mjs [--content content] [--ledger stardust/deploy/media-ledger.json] [--json [<file.json>]]
 *     --content <dir>   the delivered documents: every *.html under it, recursively     (default content)
 *     --ledger <file>   the deploy media ledger da-media-upload.mjs writes
 *                       (default stardust/deploy/media-ledger.json; absent → one NOTE on stderr, nothing rehosted)
 *     --json [<file.json>]  the JSON below on stdout instead of the text; given a .json path, the text still prints,
 *                       the JSON goes to the file (directories created) and a last line `json: <file>` names it
 *     --help, -h        this header
 *
 * Read per document: <img src>, <img srcset> and <source srcset> (every candidate), <source src>, <video src>,
 * <video poster>, <audio src> — in document order, each reference once; comments and <script> bodies are not read;
 * data:, empty and #fragment references are dropped. Each reference is:
 *   rehosted  an `uploaded` ledger entry delivers it: its contentUrl (query and fragment ignored), or a path ending
 *             in the entry's key (media/<scope>/<file>, e.g. ./media/<scope>/<file>) — source URL(s) = the entry's
 *             `sources`, delivered path = the key, local = its `file`
 *   unmapped  a media path the ledger does not deliver: a content-relative media/… path, or an absolute URL on a
 *             content host (the hosts of the ledger's contentUrls, and content.da.live) under /media/
 *   external  any other absolute http(s) URL, referenced as is
 *   code      a path on the code origin (/icons/…, /assets/…)
 *   broken    anything else (about:error, javascript:, an unparseable reference)
 * The page path: the document path under --content, `.html` dropped, `index` → its folder (/, /de/).
 *
 * Output (stdout, deterministic):
 *   media-manifest: <p> page(s) · <n> reference(s) — rehosted <a> · unmapped <b> · external <c> · code <d> · broken <e>
 *   <page path>  (<content>/<doc>) <k>                                   pages sorted by path
 *     rehosted  <first source> [(+<more>)] → <media/<scope>/<file>>  [<delivered reference>]
 *     rehosted  (source unknown) → …                                    an entry without sources
 *     unmapped|external|code|broken  <delivered reference>
 * JSON = { tool: "media-manifest", content, ledger, totals: { rehosted, unmapped, external, code, broken },
 *          pages: [{ path, file (<content>/<doc>), media: [{ status, delivered, daPath?, sources?, local? }] }] }
 *
 * Exit codes: 0 listed (an unmapped or broken reference is listed, never a failure — media-reconcile.mjs is the
 * gate) · 1 an unexpected I/O failure · 2 usage: an unknown argument, a value flag without its value, --content not
 * a directory, a ledger that is not a JSON object.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
const IS_MAIN = Boolean(process.argv[1]) && SELF === safeRealpath(process.argv[1]);

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (IS_MAIN && (process.argv.includes('--help') || process.argv.includes('-h'))) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

export const STATUSES = Object.freeze(['rehosted', 'unmapped', 'external', 'code', 'broken']);
// The content host da-media-upload.mjs authors by default (its --content-url).
const DEFAULT_CONTENT_HOST = 'content.da.live';

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }

export function parseArgs(argv) {
  const o = { content: 'content', ledger: 'stardust/deploy/media-ledger.json', json: false, jsonFile: null };
  const need = (i, k) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${k} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--content') { o.content = need(i, k); i += 1; }
    else if (k === '--ledger') { o.ledger = need(i, k); i += 1; }
    else if (k === '--json') {
      o.json = true;
      if (i + 1 < argv.length && /\.json$/i.test(argv[i + 1]) && !argv[i + 1].startsWith('--')) { o.jsonFile = argv[i + 1]; i += 1; }
    } else throw new UsageError(`unknown argument ${k}`);
  }
  return o;
}

// ---- references (pure) -------------------------------------------------------------------------

const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// srcset candidates: a URL runs to whitespace; descriptors run to the next comma.
const srcsetUrls = (v) => String(v).split(/,\s+|,(?=\S+\s)/).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);

export function docRefs(html) {
  const body = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const out = [];
  const seen = new Set();
  const add = (r) => { const v = decode(r).trim(); if (!v || v.startsWith('#') || /^data:/i.test(v) || seen.has(v)) return; seen.add(v); out.push(v); };
  for (const m of body.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    if (!['img', 'source', 'video', 'audio'].includes(tag)) continue;
    const attrs = new Map([...m[2].matchAll(ATTR)].map((a) => [a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '']));
    if (attrs.has('srcset') && (tag === 'img' || tag === 'source')) for (const u of srcsetUrls(attrs.get('srcset'))) add(u);
    if (attrs.has('src')) add(attrs.get('src'));
    if (tag === 'video' && attrs.has('poster')) add(attrs.get('poster'));
  }
  return out;
}

const bare = (u) => String(u).split('#')[0].split('?')[0];
const indexes = new WeakMap();
function ledgerIndex(ledger) {
  if (indexes.has(ledger)) return indexes.get(ledger);
  const byUrl = new Map();
  const keys = [];
  const hosts = new Set([DEFAULT_CONTENT_HOST]);
  for (const [key, e] of Object.entries(ledger || {})) {
    if (e && typeof e.contentUrl === 'string') { try { hosts.add(new URL(e.contentUrl).host); } catch { /* not a URL */ } }
    if (!e || e.status !== 'uploaded') continue;
    keys.push(key);
    if (typeof e.contentUrl === 'string') byUrl.set(bare(e.contentUrl), key);
  }
  const idx = { byUrl, keys: keys.sort((a, b) => b.length - a.length), hosts };
  indexes.set(ledger, idx);
  return idx;
}

export function classify(ref, ledger) {
  const idx = ledgerIndex(ledger || {});
  const b = bare(ref);
  const rehosted = (key) => {
    const e = ledger[key];
    return { status: 'rehosted', delivered: ref, daPath: key, sources: Array.isArray(e.sources) ? [...e.sources] : [], local: e.file ?? null };
  };
  if (idx.byUrl.has(b)) return rehosted(idx.byUrl.get(b));
  let abs = null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) { try { abs = new URL(ref); } catch { return { status: 'broken', delivered: ref }; } }
  const path = abs ? abs.pathname : b;
  if (!abs || abs.protocol === 'http:' || abs.protocol === 'https:') {
    const key = idx.keys.find((k) => path === k || path.endsWith(`/${k}`));
    if (key) return rehosted(key);
  }
  if (abs) {
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return { status: 'broken', delivered: ref };
    if (idx.hosts.has(abs.host) && /\/media\//.test(abs.pathname)) return { status: 'unmapped', delivered: ref };
    return { status: 'external', delivered: ref };
  }
  if (/^(?:\.\/)?media\//.test(b)) return { status: 'unmapped', delivered: ref };
  return { status: 'code', delivered: ref };
}

export function pagePath(rel) {
  const p = String(rel).split(sep).join('/').replace(/\.html$/i, '');
  if (p === 'index') return '/';
  if (p.endsWith('/index')) return `/${p.slice(0, -'index'.length)}`;
  return `/${p}`;
}

export function summaryLine({ pages, totals }) {
  const n = STATUSES.reduce((s, k) => s + (totals[k] || 0), 0);
  return `media-manifest: ${pages} page(s) · ${n} reference(s) — ${STATUSES.map((k) => `${k} ${totals[k] || 0}`).join(' · ')}`;
}

export function pageLines(page) {
  const lines = [`${page.path}  (${page.file}) ${page.media.length}`];
  for (const m of page.media) {
    if (m.status === 'rehosted') {
      const src = m.sources.length ? `${m.sources[0]}${m.sources.length > 1 ? ` (+${m.sources.length - 1})` : ''}` : '(source unknown)';
      lines.push(`  rehosted  ${src} → ${m.daPath}  [${m.delivered}]`);
    } else lines.push(`  ${m.status.padEnd(8)}  ${m.delivered}`);
  }
  return lines;
}

// ---- I/O ---------------------------------------------------------------------------------------

function htmlFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile() && /\.html$/i.test(e.name)) out.push(relative(dir, p));
    }
  })(dir);
  return out;
}

function readLedger(file) {
  if (!existsSync(file)) { console.error(`media-manifest: NOTE no media ledger at ${file} — nothing is rehosted (da-media-upload.mjs writes it; --ledger <file>)`); return {}; }
  let l;
  try { l = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new UsageError(`--ledger ${file} is not valid JSON (${e.message})`); }
  if (!l || typeof l !== 'object' || Array.isArray(l)) throw new UsageError(`--ledger ${file} is not a JSON object`);
  return l;
}

function main(argv) {
  const o = parseArgs(argv);
  let st = null;
  try { st = statSync(o.content); } catch { /* missing */ }
  if (!st || !st.isDirectory()) throw new UsageError(`--content ${o.content} is not a directory`);
  const ledger = readLedger(o.ledger);
  const totals = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  const pages = htmlFiles(o.content).map((rel) => {
    const media = docRefs(readFileSync(join(o.content, rel), 'utf8')).map((r) => classify(r, ledger));
    for (const m of media) totals[m.status] += 1;
    return { path: pagePath(rel), file: posix.join(o.content.split(sep).join('/'), rel.split(sep).join('/')), media };
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const json = { tool: 'media-manifest', content: o.content, ledger: o.ledger, totals, pages };
  const text = [summaryLine({ pages: pages.length, totals }), ...pages.flatMap((p) => pageLines(p))];
  if (o.json && !o.jsonFile) { console.log(JSON.stringify(json, null, 2)); return 0; }
  if (o.jsonFile) {
    mkdirSync(dirname(o.jsonFile), { recursive: true });
    writeFileSync(o.jsonFile, `${JSON.stringify(json, null, 2)}\n`);
    text.push(`json: ${o.jsonFile}`);
  }
  console.log(text.join('\n'));
  return 0;
}

if (IS_MAIN) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    console.error(`media-manifest: ${e.message}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
