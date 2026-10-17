#!/usr/bin/env node
/**
 * skills/extract/scripts/media-harvest.mjs — download every media file the
 * captured pages reference, once, into one folder named by content, and write
 * the source-URL → local-file map later phases rewrite references with.
 *
 * Why: the crawl records page media as URLs and downloads none of it (the
 * favicon aside). Agents in recorded hands-off runs hand-wrote their own media
 * harvesters because nothing shipped did the job — each one a different subset
 * of the srcset / lazy-load / CSS-background cases, none of them safe to re-run.
 * This reads the crawl's settled rendered DOM offline; it never opens a browser.
 *
 * Usage:
 *   node media-harvest.mjs [--pages stardust/current/pages] [--out stardust/current/assets/media]
 *                          [--map stardust/current/assets/media-map.json] [--concurrency 4]
 *                          [--max-bytes <n>] [--timeout <s>]
 *     --pages <dir>       the crawl's page folder: every <slug>.html there is read; the sibling
 *                         <slug>.json record supplies the page URL     (default stardust/current/pages)
 *     --out <dir>         where the media files go, created when the first one is written
 *                                                             (default stardust/current/assets/media)
 *     --map <file>        the media map, created or extended (default stardust/current/assets/media-map.json)
 *     --concurrency <n>   parallel downloads                                              (default 4)
 *     --max-bytes <n>     per-file cap, video included: a declared content-length over it, or a body
 *                         that streams past it, is recorded `too-large` and nothing is written
 *                         (default: no cap, except video — 52428800 bytes = 50 MiB; video is a video/*
 *                         answer or a .mp4/.webm/.mov/.m4v/.ogv URL)
 *     --timeout <s>       per-request timeout in seconds, body included; decimals allowed (default 30)
 *     --help, -h          this header
 *
 * Collected per page — base URL: the page's <base href> when present, else the record's
 * finalUrl, else its url; a page with none of them has its relative references skipped and
 * counted (named on stderr, totalled on the summary line):
 *   <img src>, <img srcset> (every candidate), <source srcset>, <source src>, <video src>,
 *   <video poster>, <audio src>, every attribute whose name starts with data-src (one whose
 *   name contains srcset is read as a srcset), and CSS url() in style attributes and in <style>
 *   blocks (@import rules and @font-face blocks excluded: stylesheets and fonts are not media).
 *   Comments and <script> bodies are not read. data:, blob:, javascript:, about:, #fragment and
 *   empty references are dropped, as is anything that is not http(s) once resolved. URLs are
 *   deduplicated across all pages by absolute URL, fragment removed, query kept.
 *
 * Download: each URL once, in a pool of --concurrency, through fetch (redirects followed; a
 * desktop-browser User-Agent, an any-type Accept header so a CDN serves the original format
 * rather than a negotiated one, Referer = the media URL's origin). A non-2xx answer is
 * `http-<code>`; a 2xx answer whose content-type is present and is not image/*, video/*,
 * audio/*, application/octet-stream or binary/octet-stream (the type before `;`, any case — an
 * HTML page behind an <iframe data-src>, say) is `not-media`: its contentType recorded, no
 * file written (a missing content-type downloads as any media); a network failure, a timeout
 * or an empty body is `error` with an `error` message; an overrun of --max-bytes (or, without it,
 * of the video default) is `too-large`. Failures are recorded in the map and never fatal.
 *
 * File name: <base>-<hash8>.<ext>
 *   base   the URL path's basename, percent-decoded, extension removed, lowercased, runs of
 *          [^a-z0-9_-] → "-", edge dashes trimmed, cut to 60 chars; empty → media
 *   hash8  the first 8 hex of the sha256 of the BYTES — identical bytes under one base name
 *          share one file
 *   ext    the URL's own extension when it is a known media extension, else from the
 *          content-type (image/jpeg → jpg, image/svg+xml → svg, image/x-icon → ico, video/mp4 →
 *          mp4 …), else bin
 *   An identical file already at that path is left untouched; writes are tmp + rename.
 *
 * Writes (nothing else):
 *   <out>/<base>-<hash8>.<ext>   one file per distinct name
 *   <map>   { "<sourceUrl>": { "local": "<out>/<file>" | null, "bytes": <n> | null,
 *                              "contentType": "<type>" | null,
 *                              "status": "ok" | "http-<code>" | "not-media" | "too-large" | "error",
 *                              "error"?: "<message>" } }
 *           keyed by absolute source URL, keys sorted, 2-space JSON + newline; `local` is <out>
 *           joined with the file name, posix separators, as given (project-relative by default);
 *           `contentType` is set on ok and not-media entries, null on the other failures.
 *           Entries for URLs this run did not see are kept. Written after every finished download
 *           (tmp + rename), and only when its content changes — a killed run keeps every entry it
 *           finished, and a run that changes nothing leaves it byte-identical. An existing
 *           map that is not a JSON object is refused (exit 2), never overwritten.
 *
 * Re-runs: a URL whose map entry is `ok` and whose `local` file exists at the recorded `bytes`
 * is reused with no request; every failed entry (not-media included) is retried.
 *
 * Output (stdout):
 *   media-harvest: <u> url(s) from <p> page(s) · downloaded <d> · reused <r> · failed <f> (<status> ×<n>, …) → <map>
 *   then up to 10 `fail <status> <url>` lines, sorted. When a page had no base URL the summary
 *   gains `· unresolved <k> relative ref(s) on <n> page(s) without a base URL` before the arrow.
 * Exit codes: 0 done (failures are recorded in the map) · 1 an unexpected I/O failure (the map
 *   could not be written) · 2 usage error (unknown argument, a bad number, a value flag followed
 *   by nothing or by another --flag — named), --pages not a directory, or a --map that is not a
 *   JSON object.
 *
 * Needs Node 18+ (global fetch); no packages. --help needs nothing and writes nothing.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op — and
// a test that imports the pure helpers below must not start a harvest.
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

// Current stable desktop Chrome on macOS — the same value style-census.mjs sends.
export const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
export const DEFAULTS = Object.freeze({
  pages: 'stardust/current/pages', out: 'stardust/current/assets/media', map: 'stardust/current/assets/media-map.json',
  concurrency: 4, maxBytes: null, timeout: 30,
});
export const MAX_FAIL_LINES = 10;
// The cap a video is held to when --max-bytes is absent. The body is held in memory to hash it, and a
// page's hero loop or teaser runs a few MB — past 50 MiB it is a long-form film to link, not to re-host.
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const SYNOPSIS = 'usage: node media-harvest.mjs [--pages <dir>] [--out <dir>] [--map <file>] [--concurrency 4] [--max-bytes <n>] [--timeout 30]  (--help for the full header)';

// A URL extension in this set names the file as is (lowercased); anything else falls back to the content-type.
export const KNOWN_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'jxl',
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'm4a', 'ogg', 'oga', 'wav', 'pdf']);
export const TYPE_EXT = Object.freeze({
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/apng': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/heic': 'heic', 'image/jxl': 'jxl',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/ogg': 'ogv',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'application/pdf': 'pdf',
});

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }

// ---- arguments ---------------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { ...DEFAULTS };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag.
  const need = (i, k) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${k} needs a value`); return argv[i + 1]; };
  const int = (v, k) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new UsageError(`${k} needs an integer ≥ 1, got "${v}"`); return n; };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--pages') { o.pages = need(i, k); i += 1; }
    else if (k === '--out') { o.out = need(i, k); i += 1; }
    else if (k === '--map') { o.map = need(i, k); i += 1; }
    else if (k === '--concurrency') { o.concurrency = int(need(i, k), k); i += 1; }
    else if (k === '--max-bytes') { o.maxBytes = int(need(i, k), k); i += 1; }
    else if (k === '--timeout') {
      const v = need(i, k); const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${k} needs a number of seconds > 0, got "${v}"`);
      o.timeout = n; i += 1;
    } else throw new UsageError(`unknown argument ${k}`);
  }
  return o;
}

// ---- extraction (pure) -------------------------------------------------------------------------

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// The HTML srcset grammar: a candidate's URL is the next run of non-whitespace (commas inside it
// belong to it — CDN transform paths carry them); trailing commas end a descriptor-less candidate;
// otherwise descriptors run to the next comma outside parentheses.
export function parseSrcset(value) {
  const s = String(value ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length) break;
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j += 1;
    let url = s.slice(i, j);
    i = j;
    if (/,$/.test(url)) url = url.replace(/,+$/, '');
    else {
      let depth = 0;
      while (i < s.length) {
        const c = s[i];
        i += 1;
        if (c === '(') depth += 1;
        else if (c === ')') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) break;
      }
    }
    if (url) out.push(url);
  }
  return out;
}

const unescapeCss = (s) => s
  .replace(/\\([0-9a-f]{1,6})\s?/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/\\(.)/g, '$1');
const CSS_URL = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\s"'\\]|\\.)*))\s*\)/gi;

// Every url() in a CSS text (comments, @import rules and @font-face blocks removed first).
export function cssUrls(css) {
  const clean = String(css ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '');
  return [...clean.matchAll(CSS_URL)].map((m) => unescapeCss(m[1] ?? m[2] ?? m[3] ?? '').trim()).filter(Boolean);
}

const COMMENT = /<!--[\s\S]*?-->/g;
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttrs(s) {
  return [...String(s ?? '').matchAll(ATTR)].map((m) => [m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')]);
}

// The raw (entity-decoded, trimmed) media references of one HTML document, in document order, and
// its first <base href>. Nothing is resolved here.
export function extractRefs(html) {
  const css = [];
  const body = String(html ?? '').replace(COMMENT, '').replace(SCRIPT, '').replace(STYLE, (m, c) => { css.push(c); return ''; });
  const refs = [];
  let base = null;
  for (const m of body.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const get = (n) => { const a = attrs.find(([k]) => k === n); return a ? a[1] : null; };
    if (tag === 'base' && base === null && get('href') !== null) base = get('href').trim();
    if (['img', 'source', 'video', 'audio'].includes(tag) && get('src') !== null) refs.push(get('src'));
    if ((tag === 'img' || tag === 'source') && get('srcset') !== null) refs.push(...parseSrcset(get('srcset')));
    if (tag === 'video' && get('poster') !== null) refs.push(get('poster'));
    for (const [k, v] of attrs) {
      if (k.startsWith('data-src')) refs.push(...(k.includes('srcset') ? parseSrcset(v) : [v]));
      else if (k === 'style') refs.push(...cssUrls(v));
    }
  }
  for (const c of css) refs.push(...cssUrls(c));
  return { base, refs: refs.map((r) => r.trim()) };
}

const DROP_SCHEME = /^(data|blob|javascript|about):/i;
// One reference → { url } (absolute http(s), fragment removed) | { relative: true } (needs a base the
// page lacks) | { drop: true } (a skipped scheme, a fragment, empty, a JSON-ish data-src value, or
// not http(s) once resolved).
export function resolveRef(raw, base) {
  const r = String(raw ?? '').trim();
  if (!r || r.startsWith('#') || DROP_SCHEME.test(r) || /^[[{<]/.test(r)) return { drop: true };
  let u;
  try { u = base ? new URL(r, base) : new URL(r); } catch { return base ? { drop: true } : { relative: true }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { drop: true };
  u.hash = '';
  return { url: u.href };
}

// One page: its base URL (<base href> resolved against the record URL, else the record URL), the
// sorted unique absolute media URLs, and how many distinct relative references had no base.
export function pageMedia(html, pageUrl = null) {
  const { base: baseHref, refs } = extractRefs(html);
  let base = null;
  if (baseHref) { try { base = (pageUrl ? new URL(baseHref, pageUrl) : new URL(baseHref)).href; } catch { /* fall back */ } }
  if (!base && pageUrl) { try { base = new URL(pageUrl).href; } catch { /* no base */ } }
  const urls = new Set();
  const relative = new Set();
  for (const r of refs) {
    const x = resolveRef(r, base);
    if (x.url) urls.add(x.url);
    else if (x.relative) relative.add(r);
  }
  return { base, urls: [...urls].sort(), unresolved: relative.size };
}

// ---- naming (pure) -----------------------------------------------------------------------------

export function mediaType(header) { const t = String(header ?? '').split(';')[0].trim().toLowerCase(); return t || null; }
// A declared content-type that names media (or opaque bytes); null (none declared) is not judged here.
export function isMediaType(type) { return /^(image|video|audio)\//.test(type) || type === 'application/octet-stream' || type === 'binary/octet-stream'; }
function pathBasename(url) {
  let seg = '';
  try { seg = posix.basename(new URL(url).pathname); } catch { /* not a URL */ }
  try { seg = decodeURIComponent(seg); } catch { /* keep as is */ }
  return seg;
}
export function baseName(url) {
  const seg = pathBasename(url);
  const ext = posix.extname(seg);
  const stem = (ext ? seg.slice(0, -ext.length) : seg).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return stem || 'media';
}
export function urlExt(url) { const e = posix.extname(pathBasename(url)).slice(1).toLowerCase(); return KNOWN_EXT.has(e) ? e : null; }
export function extFor(url, contentType) { return urlExt(url) || TYPE_EXT[mediaType(contentType)] || 'bin'; }
export const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
// Video = a video/* answer, or a video extension on the URL (an octet-stream or untyped clip counts).
export function isVideo(url, type) { return /^video\//.test(type ?? '') || VIDEO_EXT.has(urlExt(url)); }
// The byte cap one answer is held to, with the name its too-large error gives it: --max-bytes for every
// file when given; without it VIDEO_MAX_BYTES for video and no cap for the rest.
export function byteCap(url, type, maxBytes, videoMaxBytes = VIDEO_MAX_BYTES) {
  if (maxBytes) return { bytes: maxBytes, label: `--max-bytes ${maxBytes}` };
  if (videoMaxBytes && isVideo(url, type)) return { bytes: videoMaxBytes, label: `video cap ${videoMaxBytes} (the default without --max-bytes)` };
  return null;
}
export const hash8 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 8);
export function mediaFileName(url, bytes, contentType) { return `${baseName(url)}-${hash8(bytes)}.${extFor(url, contentType)}`; }
export const localPath = (out, name) => posix.join(String(out).split(sep).join('/'), name);

// ---- map + summary (pure) ----------------------------------------------------------------------

export function mergeMap(prev, results) {
  const next = { ...prev, ...results };
  return Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
}
export const serializeMap = (map) => `${JSON.stringify(map, null, 2)}\n`;

export function summarize({ urls, pages, downloaded, reused, failures, map, unresolved = 0, unresolvedPages = 0 }) {
  const byStatus = new Map();
  for (const f of failures) byStatus.set(f.status, (byStatus.get(f.status) || 0) + 1);
  const breakdown = [...byStatus.keys()].sort().map((s) => `${s} ×${byStatus.get(s)}`).join(', ');
  let line = `media-harvest: ${urls} url(s) from ${pages} page(s) · downloaded ${downloaded} · reused ${reused} · failed ${failures.length}`;
  if (failures.length) line += ` (${breakdown})`;
  if (unresolved) line += ` · unresolved ${unresolved} relative ref(s) on ${unresolvedPages} page(s) without a base URL`;
  line += ` → ${map}`;
  return [line, ...failures.map((f) => `fail ${f.status} ${f.url}`).sort().slice(0, MAX_FAIL_LINES)];
}

// ---- I/O ---------------------------------------------------------------------------------------

export function isReusable(entry) {
  if (!entry || entry.status !== 'ok' || typeof entry.local !== 'string' || !Number.isInteger(entry.bytes)) return false;
  try { const st = statSync(entry.local); return st.isFile() && st.size === entry.bytes; } catch { return false; }
}

function errMessage(e, timeout) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `timeout after ${timeout}s`;
  const c = e?.cause;
  if (c) return `${e.message}: ${c.code || c.message || c}`;
  return String(e?.message || e);
}

// One GET: { status: 'ok', bytes, contentType } | { status: 'not-media', contentType } | { status: 'http-<code>' | 'too-large' | 'error', error? }.
export async function download(url, { timeout = DEFAULTS.timeout, maxBytes = null, videoMaxBytes = VIDEO_MAX_BYTES, ua = DEFAULT_UA } = {}) {
  let res;
  let referer = '';
  try { referer = `${new URL(url).origin}/`; } catch { /* resolveRef only yields valid URLs */ }
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': ua, accept: '*/*', referer }, signal: AbortSignal.timeout(timeout * 1000) });
  } catch (e) { return { status: 'error', error: errMessage(e, timeout) }; }
  const drop = async () => { try { await res.body?.cancel(); } catch { /* already closed */ } };
  if (!res.ok) { await drop(); return { status: `http-${res.status}` }; }
  const type = mediaType(res.headers.get('content-type'));
  if (type !== null && !isMediaType(type)) { await drop(); return { status: 'not-media', contentType: type }; }
  const cap = byteCap(url, type, maxBytes, videoMaxBytes);
  const declared = res.headers.get('content-length');
  if (cap && declared !== null && Number(declared) > cap.bytes) {
    await drop();
    return { status: 'too-large', error: `content-length ${Number(declared)} > ${cap.label}` };
  }
  const chunks = [];
  let n = 0;
  try {
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (cap && n > cap.bytes) {
          try { await reader.cancel(); } catch { /* closed */ }
          return { status: 'too-large', error: `body passed ${cap.label} while streaming` };
        }
        chunks.push(value);
      }
    }
  } catch (e) { return { status: 'error', error: errMessage(e, timeout) }; }
  if (!n) return { status: 'error', error: 'empty response body' };
  return { status: 'ok', bytes: Buffer.concat(chunks), contentType: mediaType(res.headers.get('content-type')) };
}

let tmpSeq = 0;
function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  tmpSeq += 1;
  const tmp = `${file}.${process.pid}.${tmpSeq}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
// Skips the write when an identical file is already there; returns whether it wrote.
function writeMedia(file, bytes) {
  try { if (statSync(file).size === bytes.length && readFileSync(file).equals(bytes)) return false; } catch { /* absent */ }
  writeAtomic(file, bytes);
  return true;
}

async function harvestOne(url, o) {
  const r = await download(url, o);
  if (r.status !== 'ok') return { local: null, bytes: null, contentType: r.contentType ?? null, status: r.status, ...(r.error ? { error: r.error } : {}) };
  const local = localPath(o.out, mediaFileName(url, r.bytes, r.contentType));
  try { writeMedia(local, r.bytes); } catch (e) {
    return { local: null, bytes: null, contentType: null, status: 'error', error: `write failed: ${e.code || e.message}` };
  }
  return { local, bytes: r.bytes.length, contentType: r.contentType, status: 'ok' };
}

async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const k = next; next += 1; await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

function recordUrl(dir, slug) {
  try { const r = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')); return r.finalUrl || r.url || null; } catch { return null; }
}

async function main(argv) {
  const o = parseArgs(argv);
  let st = null;
  try { st = statSync(o.pages); } catch { /* missing */ }
  if (!st || !st.isDirectory()) throw new UsageError(`--pages ${o.pages} is not a directory (run the crawl first)`);

  let prevText = null;
  let prev = {};
  if (existsSync(o.map)) {
    prevText = readFileSync(o.map, 'utf8');
    try { prev = JSON.parse(prevText); } catch (e) { throw new UsageError(`--map ${o.map} is not valid JSON (${e.message}) — fix or move it; it is never overwritten blind`); }
    if (!prev || typeof prev !== 'object' || Array.isArray(prev)) throw new UsageError(`--map ${o.map} is not a JSON object — fix or move it; it is never overwritten blind`);
  }

  const files = readdirSync(o.pages, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.html')).map((d) => d.name).sort();
  const all = new Set();
  let pages = 0;
  let unresolved = 0;
  let unresolvedPages = 0;
  for (const name of files) {
    const slug = name.slice(0, -'.html'.length);
    let html;
    try { html = readFileSync(join(o.pages, name), 'utf8'); } catch (e) { console.error(`media-harvest: ${name}: ${e.code || e.message} — skipped`); continue; }
    pages += 1;
    const r = pageMedia(html, recordUrl(o.pages, slug));
    for (const u of r.urls) all.add(u);
    if (r.unresolved) {
      unresolved += r.unresolved;
      unresolvedPages += 1;
      console.error(`media-harvest: ${name}: no <base href> and no finalUrl/url in ${slug}.json — ${r.unresolved} relative ref(s) skipped`);
    }
  }

  const urls = [...all].sort();
  const results = {};
  let reused = 0;
  const todo = [];
  for (const u of urls) {
    if (Object.hasOwn(prev, u) && isReusable(prev[u])) { results[u] = prev[u]; reused += 1; } else todo.push(u);
  }
  // The map is saved after every finished download, so a killed run keeps every entry it finished. Each
  // save runs to completion before another worker resumes, so saves never interleave.
  let saved = prevText;
  const saveMap = () => {
    const text = serializeMap(mergeMap(prev, results));
    if (text !== saved) { writeAtomic(o.map, text); saved = text; }
  };
  await pool(todo, o.concurrency, async (u) => { results[u] = await harvestOne(u, o); saveMap(); });
  saveMap();

  const failures = todo.filter((u) => results[u].status !== 'ok').map((u) => ({ url: u, status: results[u].status }));
  const lines = summarize({ urls: urls.length, pages, downloaded: todo.length - failures.length, reused, failures, map: o.map, unresolved, unresolvedPages });
  console.log(lines.join('\n'));
  return 0;
}

if (IS_MAIN) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`media-harvest: ${e.message}`);
    if (e instanceof UsageError) console.error(SYNOPSIS);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
