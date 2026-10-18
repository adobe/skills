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
 * The media path reads the crawl's settled rendered DOM offline; it never opens a browser.
 * Stylesheets, fonts and SVG take the browser path (--assets, below): in a recorded hands-off run a
 * CDN wall answered every direct fetch of a stylesheet with a denial page while the browser was never
 * blocked, and the agent hand-wrote a browser-side CSS/font harvester.
 *
 * Usage:
 *   node media-harvest.mjs [--pages stardust/current/pages] [--out stardust/current/assets/media]
 *                          [--map stardust/current/assets/media-map.json] [--concurrency 4]
 *                          [--max-bytes <n>] [--timeout <s>]
 *                          [--assets media|sheets,fonts,svg] [--assets-dir stardust/current/assets]
 *                          [--harvest-map stardust/current/assets/harvest-map.json] [--max-total-bytes <n>]
 *     --pages <dir>       the crawl's page folder: every <slug>.html there is read; the sibling
 *                         <slug>.json record supplies the page URL     (default stardust/current/pages)
 *     --out <dir>         where the media files go, created when the first one is written
 *                                                             (default stardust/current/assets/media)
 *     --map <file>        the media map, created or extended (default stardust/current/assets/media-map.json)
 *     --concurrency <n>   parallel downloads                                              (default 4)
 *     --max-bytes <n>     per-file cap, video included: a declared content-length over it, or a body
 *                         that streams past it, is recorded `too-large` and nothing is written
 *                         (default: no cap, except video — 52428800 bytes = 50 MiB; video is a video/*
 *                         answer or a .mp4/.webm/.mov/.m4v/.ogv URL; on the browser path the default is
 *                         5242880 bytes = 5 MiB per file)
 *     --timeout <s>       per-request timeout in seconds, body included; decimals allowed (default 30); on the
 *                         browser path it bounds each body read and each forced in-page load
 *     --assets <kinds>    comma-separated, any of media, sheets, fonts, svg (default media). media = the
 *                         Node path below (images, video, audio); sheets, fonts, svg = the browser path
 *     --assets-dir <dir>  the browser path writes <dir>/<kind>/ (default stardust/current/assets)
 *     --harvest-map <file> the browser path's map (default stardust/current/assets/harvest-map.json)
 *     --max-total-bytes <n> the browser path's run total: an answer that would pass it is recorded
 *                         `too-large` and nothing is written (default 104857600 bytes = 100 MiB)
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
 *   With --assets sheets, fonts or svg (the browser path, below), also:
 *   <assets-dir>/<kind>/<base>-<hash8>.<ext>   one file per distinct name and kind
 *   <harvest-map>   the map above plus "kind", under the same rules
 *
 * Re-runs: a URL whose map entry is `ok` and whose `local` file exists at the recorded `bytes`
 * is reused with no request; every failed entry (not-media included) is retried.
 *
 * Browser path (--assets sheets,fonts,svg): every page of --pages (its <slug>.json finalUrl, else url; a
 * page without one is named on stderr and skipped) is opened in ONE real-browser context through the diff
 * skill's live-session.mjs — launchStealthHeaded, newLiveContext, gotoLive (a bot challenge or a denial
 * page fails that page loud), dismissOverlays — and the asset responses the browser receives are kept:
 * a stylesheet request (an @import included) → sheets; a font request, or a .woff2/.woff/.ttf/.otf/.eot/
 * .ttc URL, or a font content-type → fonts; an .svg URL or an image/svg+xml answer → svg. What the page
 * never asked for is asked for in the page: every @font-face of the loaded sheets is loaded
 * (document.fonts), and every .svg url() of a loaded sheet is loaded as an image — so a font no text
 * uses and an icon no element shows are harvested too. Each asset URL (the first URL of a redirect chain,
 * fragment removed) is recorded once per run. A non-2xx answer is `http-<code>`; an answer whose
 * content-type is not the kind's (text/css; font/*, application/(x-)font-*, the embedded-type font or
 * octet-stream; image/svg+xml or octet-stream — none declared passes) is `not-media` (a denial page served
 * to the browser itself); a body the browser cannot hand over within --timeout is `error`, and so is a request
 * no page that asked for it saw answered in full while it was open (recorded at the end of the run); past the
 * per-file cap or the run total, `too-large`. Each forced load waits at most --timeout too and never fails its
 * page. Files: <assets-dir>/<kind>/<base>-<hash8>.<ext>, named like the media path (ext: the
 * URL's own of the kind, else the content-type's, else css / bin / svg). Map: <harvest-map>, the media
 * map's format plus `kind` ("sheets" | "fonts" | "svg") after `status`, written after every page under the
 * same rules (sorted, tmp + rename, only on change; a map that is not a JSON object is refused, exit 2).
 * The network is the browser's, so a re-run asks again; an unchanged answer leaves the entry as it was
 * (reused), and a failure never replaces an `ok` entry whose file is on disk (a wall that later denies
 * the browser too keeps the harvest). Needs playwright importable from the script's location (the
 * project copy) and live-session.mjs beside it (../../diff/scripts/, ../diff/, ./diff/ or ./).
 *
 * Output (stdout):
 *   media-harvest: <u> url(s) from <p> page(s) · downloaded <d> · reused <r> · failed <f> (<status> ×<n>, …) → <map>
 *   then up to 10 `fail <status> <url>` lines, sorted. When a page had no base URL the summary
 *   gains `· unresolved <k> relative ref(s) on <n> page(s) without a base URL` before the arrow.
 *   The browser path prints its own line (after the media path's when both run):
 *   media-harvest (browser): <a> asset(s) from <p> page(s) — sheets <n> · fonts <n> · svg <n> · downloaded <d>
 *     · reused <r> · failed <f> (…) [· <k> page(s) not opened] → <harvest-map>, then up to 10 fail lines.
 * Exit codes: 0 done (failures are recorded in the map) · 1 an unexpected I/O failure (the map
 *   could not be written), or the browser path opened none of its pages · 2 usage error (unknown
 *   argument, a bad number, a value flag followed by nothing or by another --flag — named, an unknown
 *   --assets kind), --pages not a directory, a map that is not a JSON object, or the browser path
 *   without playwright or live-session.mjs · 3 the browser path opened none of its pages, each
 *   refused by a bot challenge or a denial page.
 *
 * The media path needs Node 18+ (global fetch) and no packages. --help needs nothing and writes nothing.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  assets: ['media'], assetsDir: 'stardust/current/assets', harvestMap: 'stardust/current/assets/harvest-map.json', maxTotalBytes: 100 * 1024 * 1024,
});
export const ASSET_TOTAL_MAX_BYTES = DEFAULTS.maxTotalBytes;
// The browser path's per-file cap without --max-bytes: a stylesheet or a font runs to a few hundred KB.
export const ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const ASSET_KINDS = Object.freeze(['media', 'sheets', 'fonts', 'svg']);
export const MAX_FAIL_LINES = 10;
// The cap a video is held to when --max-bytes is absent. The body is held in memory to hash it, and a
// page's hero loop or teaser runs a few MB — past 50 MiB it is a long-form film to link, not to re-host.
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const SYNOPSIS = 'usage: node media-harvest.mjs [--pages <dir>] [--out <dir>] [--map <file>] [--concurrency 4] [--max-bytes <n>] [--timeout 30] [--assets media|sheets,fonts,svg] [--assets-dir <dir>] [--harvest-map <file>] [--max-total-bytes <n>]  (--help for the full header)';

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
  const o = { ...DEFAULTS, assets: [...DEFAULTS.assets] };
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
    else if (k === '--assets') { o.assets = parseAssets(need(i, k)); i += 1; }
    else if (k === '--assets-dir') { o.assetsDir = need(i, k); i += 1; }
    else if (k === '--harvest-map') { o.harvestMap = need(i, k); i += 1; }
    else if (k === '--max-total-bytes') { o.maxTotalBytes = int(need(i, k), k); i += 1; }
    else if (k === '--timeout') {
      const v = need(i, k); const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${k} needs a number of seconds > 0, got "${v}"`);
      o.timeout = n; i += 1;
    } else throw new UsageError(`unknown argument ${k}`);
  }
  return o;
}

// --assets: the kinds in canonical order (media, sheets, fonts, svg), each once.
export function parseAssets(value) {
  const asked = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!asked.length) throw new UsageError('--assets names no kind (media, sheets, fonts, svg)');
  for (const k of asked) if (!ASSET_KINDS.includes(k)) throw new UsageError(`--assets: unknown kind "${k}" (${ASSET_KINDS.join(', ')})`);
  return ASSET_KINDS.filter((k) => asked.includes(k));
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

// ---- the browser path (pure) -------------------------------------------------------------------

const KIND_EXT = Object.freeze({ sheets: new Set(['css']), fonts: new Set(['woff2', 'woff', 'ttf', 'otf', 'eot', 'ttc']), svg: new Set(['svg']) });
const KIND_DEFAULT_EXT = Object.freeze({ sheets: 'css', fonts: 'bin', svg: 'svg' });
export const ASSET_TYPE_EXT = Object.freeze({
  'text/css': 'css', 'image/svg+xml': 'svg',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'font/sfnt': 'ttf', 'font/collection': 'ttc',
  'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'application/x-font-woff': 'woff', 'application/font-sfnt': 'ttf',
  'application/x-font-ttf': 'ttf', 'application/x-font-truetype': 'ttf', 'application/x-font-otf': 'otf', 'application/x-font-opentype': 'otf',
  'application/vnd.ms-fontobject': 'eot',
});
const rawExt = (url) => posix.extname(pathBasename(url)).slice(1).toLowerCase();
const isFontType = (t) => /^font\//.test(t ?? '') || /^application\/(x-)?font-/.test(t ?? '') || t === 'application/vnd.ms-fontobject';
const isOctet = (t) => t === 'application/octet-stream' || t === 'binary/octet-stream';

// The kind of one browser response, or null: the request's resource type first, then the URL's extension, then the
// content-type. A stylesheet request answered by an HTML denial page is still a sheet — assetTypeOk then refuses it.
export function assetKind({ resourceType, url, contentType }) {
  if (resourceType === 'document') return null;
  if (resourceType === 'stylesheet') return 'sheets';
  if (resourceType === 'font') return 'fonts';
  const ext = rawExt(url);
  for (const k of ['sheets', 'fonts', 'svg']) if (KIND_EXT[k].has(ext)) return k;
  const t = mediaType(contentType);
  if (t === 'text/css') return 'sheets';
  if (isFontType(t)) return 'fonts';
  if (t === 'image/svg+xml') return 'svg';
  return null;
}

// Whether a declared content-type is one the kind can be (none declared passes, as on the media path).
export function assetTypeOk(kind, contentType) {
  const t = mediaType(contentType);
  if (t === null) return true;
  if (kind === 'sheets') return t === 'text/css';
  if (kind === 'fonts') return isFontType(t) || isOctet(t);
  if (kind === 'svg') return t === 'image/svg+xml' || isOctet(t);
  return false;
}

export function assetExt(kind, url, contentType) {
  const ext = rawExt(url);
  if (KIND_EXT[kind]?.has(ext)) return ext;
  return ASSET_TYPE_EXT[mediaType(contentType)] || KIND_DEFAULT_EXT[kind] || 'bin';
}
export const assetLocal = (dir, kind, url, bytes, contentType) => localPath(posix.join(String(dir).split(sep).join('/'), kind), `${baseName(url)}-${hash8(bytes)}.${assetExt(kind, url, contentType)}`);

const CSS_IMPORT = /@import\s+(?:url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\s"'\\]|\\.)*))\s*\)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gi;
// The assets one stylesheet names, absolute against the sheet's URL: @import targets (sheets), the url()s inside
// @font-face blocks (fonts) and every other url() that ends .svg (svg). Each list sorted and unique.
export function cssAssetRefs(css, sheetUrl) {
  const out = { sheets: new Set(), fonts: new Set(), svg: new Set() };
  const add = (set, raw, onlySvg = false) => {
    const x = resolveRef(unescapeCss(raw ?? '').trim(), sheetUrl);
    if (x.url && (!onlySvg || rawExt(x.url) === 'svg')) set.add(x.url);
  };
  const clean = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(CSS_IMPORT)) add(out.sheets, m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
  const rest = clean.replace(/@import\b[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, (block) => {
    for (const m of block.matchAll(CSS_URL)) add(out.fonts, m[1] ?? m[2] ?? m[3]);
    return '';
  });
  for (const m of rest.matchAll(CSS_URL)) add(out.svg, m[1] ?? m[2] ?? m[3], true);
  return { sheets: [...out.sheets].sort(), fonts: [...out.fonts].sort(), svg: [...out.svg].sort() };
}

// The URL the page or the sheet referenced: the first request of a redirect chain, fragment removed.
export function originalUrl(request) {
  let r = request;
  while (r.redirectedFrom()) r = r.redirectedFrom();
  const u = new URL(r.url());
  u.hash = '';
  return u.href;
}

// One harvest-map entry: the media map's shape plus `kind`; contentType on ok and not-media answers only.
export function assetEntry(kind, r) {
  const ok = r.status === 'ok';
  return {
    local: ok ? r.local : null, bytes: ok ? r.bytes : null,
    contentType: ok || r.status === 'not-media' ? (r.contentType ?? null) : null,
    status: r.status, kind, ...(r.error ? { error: r.error } : {}),
  };
}
// A failed answer never replaces an ok entry whose file is still on disk at its recorded size.
export const keepPrior = (prior, result) => result.status !== 'ok' && isReusable(prior);

export function summarizeAssets({ pages, kinds, byKind, downloaded, reused, failures, pageErrors = 0, map }) {
  const byStatus = new Map();
  for (const f of failures) byStatus.set(f.status, (byStatus.get(f.status) || 0) + 1);
  const total = kinds.reduce((s, k) => s + (byKind[k] || 0), 0);
  let line = `media-harvest (browser): ${total} asset(s) from ${pages} page(s) — ${kinds.map((k) => `${k} ${byKind[k] || 0}`).join(' · ')} · downloaded ${downloaded} · reused ${reused} · failed ${failures.length}`;
  if (failures.length) line += ` (${[...byStatus.keys()].sort().map((s) => `${s} ×${byStatus.get(s)}`).join(', ')})`;
  if (pageErrors) line += ` · ${pageErrors} page(s) not opened`;
  line += ` → ${map}`;
  return [line, ...failures.map((f) => `fail ${f.status} ${f.url}`).sort().slice(0, MAX_FAIL_LINES)];
}

// Runs in the page (serialised by playwright — no outer-scope references): loads every declared @font-face and
// each given URL as an image, so the browser fetches what no element asked for; each load waits at most
// timeoutMs. Returns how many loads it started.
export async function forceLoadInPage({ fonts, urls, timeoutMs }) {
  const jobs = [];
  const bounded = (p) => Promise.race([p.catch(() => null), new Promise((done) => { setTimeout(done, timeoutMs); })]);
  if (fonts && document.fonts) document.fonts.forEach((f) => { if (f.status === 'unloaded') jobs.push(bounded(f.load())); });
  for (const u of urls) {
    jobs.push(new Promise((done) => {
      const img = new Image();
      const t = setTimeout(done, timeoutMs);
      img.onload = () => { clearTimeout(t); done(); };
      img.onerror = img.onload;
      img.src = u;
    }));
  }
  await Promise.all(jobs);
  return jobs.length;
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

// An existing map is read and must be a JSON object; it is never overwritten blind.
function readMapFile(file, flag) {
  if (!existsSync(file)) return { text: null, map: {} };
  const text = readFileSync(file, 'utf8');
  let map;
  try { map = JSON.parse(text); } catch (e) { throw new UsageError(`${flag} ${file} is not valid JSON (${e.message}) — fix or move it; it is never overwritten blind`); }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new UsageError(`${flag} ${file} is not a JSON object — fix or move it; it is never overwritten blind`);
  return { text, map };
}
const htmlPages = (dir) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.html')).map((d) => d.name).sort();

async function harvestMedia(o, prevText, prev) {
  const files = htmlPages(o.pages);
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
  return summarize({ urls: urls.length, pages, downloaded: todo.length - failures.length, reused, failures, map: o.map, unresolved, unresolvedPages });
}

// live-session.mjs (the diff skill) in the plugin tree, the project copy (scripts/extract ↔ scripts/diff), an extract
// script in scripts/ beside a scripts/diff copy, or a flat sibling copy — crawl.mjs looks in the same places.
const LIVE_SESSION_CANDIDATES = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs', './diff/live-session.mjs', './live-session.mjs'];
async function browserTools() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new UsageError(`playwright is not importable from ${dirname(SELF)} (${e.code || e.message}) — the browser path (--assets sheets,fonts,svg) runs from the project copy (extract/SKILL.md § Setup)`);
  }
  const looked = LIVE_SESSION_CANDIDATES.map((p) => resolve(dirname(SELF), p));
  const found = looked.find((p) => existsSync(p));
  if (!found) throw new UsageError(`live-session.mjs not found (looked in ${looked.join(', ')}) — copy the diff skill's live-session.mjs beside the extract scripts (extract/SKILL.md § Setup)`);
  return { chromium, session: await import(pathToFileURL(found).href) };
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
// A body the browser never finishes must not hold the run: each read races --timeout. The losing read is caught
// here, so a page closed under it later is no unhandled rejection.
function within(promise, ms, label) {
  promise.catch(() => {});
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label)), ms); })]).finally(() => clearTimeout(t));
}

async function harvestBrowser(o, prevText, prev, { chromium, session }) {
  const kinds = o.assets.filter((k) => k !== 'media');
  const want = new Set(kinds);
  const pages = [];
  for (const name of htmlPages(o.pages)) {
    const slug = name.slice(0, -'.html'.length);
    const url = recordUrl(o.pages, slug);
    if (url) pages.push({ slug, url }); else console.error(`media-harvest: ${slug}: no finalUrl/url in ${slug}.json — page skipped by the browser path`);
  }
  const cap = o.maxBytes ? { bytes: o.maxBytes, label: `--max-bytes ${o.maxBytes}` } : { bytes: ASSET_MAX_BYTES, label: `asset cap ${ASSET_MAX_BYTES} (the default without --max-bytes)` };
  const results = {};
  const seen = new Set();
  const sheetSvg = new Set();
  const byKind = {};
  const failures = [];
  let downloaded = 0;
  let reused = 0;
  let total = 0;

  const record = (src, kind, r) => {
    byKind[kind] = (byKind[kind] || 0) + 1;
    const prior = Object.hasOwn(prev, src) ? prev[src] : undefined;
    if (keepPrior(prior, r)) { results[src] = prior; reused += 1; return; }
    const entry = assetEntry(kind, r);
    if (r.status !== 'ok') failures.push({ url: src, status: r.status });
    else if (JSON.stringify(prior) === JSON.stringify(entry)) reused += 1;
    else downloaded += 1;
    results[src] = entry;
  };
  const timeoutMs = o.timeout * 1000;
  const timedOut = `timeout after ${o.timeout}s`;
  const answer = async (resp, kind, type, src) => {
    if (!resp.ok()) return { status: `http-${resp.status()}` };
    if (!assetTypeOk(kind, type)) return { status: 'not-media', contentType: type };
    const declared = resp.headers()['content-length'];
    if (declared !== undefined && Number(declared) > cap.bytes) return { status: 'too-large', error: `content-length ${Number(declared)} > ${cap.label}` };
    let body;
    try { body = await within(resp.body(), timeoutMs, timedOut); } catch (e) { return { status: 'error', error: `body unavailable: ${firstLine(e)}` }; }
    if (!body.length) return { status: 'error', error: 'empty response body' };
    if (body.length > cap.bytes) return { status: 'too-large', error: `body ${body.length} > ${cap.label}` };
    if (total + body.length > o.maxTotalBytes) return { status: 'too-large', error: `the run total would pass --max-total-bytes ${o.maxTotalBytes}` };
    total += body.length;
    const local = assetLocal(o.assetsDir, kind, src, body, type);
    try { writeMedia(local, body); } catch (e) { return { status: 'error', error: `write failed: ${e.code || e.message}` }; }
    return { status: 'ok', local, bytes: body.length, contentType: type };
  };
  const isHttp = (u) => /^https?:/i.test(u);
  // Asset requests sent and not yet answered, per page: one the browser never answers in full (a body stalled before
  // the browser reports the response) is recorded as a timeout when the page ends, not lost.
  const inflight = new Map();
  const unanswered = new Map();
  const onRequest = (req) => {
    let src;
    try { src = originalUrl(req); } catch { return; }
    const kind = isHttp(src) && assetKind({ resourceType: req.resourceType(), url: src, contentType: null });
    if (kind && want.has(kind) && !seen.has(src)) inflight.set(src, kind);
  };
  const onResponse = async (resp) => {
    const status = resp.status();
    if (status >= 300 && status < 400) return; // the redirected request answers for it
    const req = resp.request();
    let src;
    try { src = originalUrl(req); } catch { return; }
    inflight.delete(src);
    if (!isHttp(src)) return;
    const type = mediaType(resp.headers()['content-type']);
    const kind = assetKind({ resourceType: req.resourceType(), url: src, contentType: type });
    if (!kind) return;
    if (kind === 'sheets' && want.has('svg') && resp.ok() && assetTypeOk('sheets', type)) {
      const css = await within(resp.body(), timeoutMs, timedOut).catch(() => null);
      if (css) for (const u of cssAssetRefs(css.toString('utf8'), resp.url()).svg) sheetSvg.add(u);
    }
    if (!want.has(kind) || seen.has(src)) return;
    seen.add(src);
    record(src, kind, await answer(resp, kind, type, src));
  };
  const onFailed = (req) => {
    let src;
    try { src = originalUrl(req); } catch { return; }
    inflight.delete(src);
    if (!isHttp(src)) return;
    const kind = assetKind({ resourceType: req.resourceType(), url: src, contentType: null });
    if (!kind || !want.has(kind) || seen.has(src)) return;
    seen.add(src);
    record(src, kind, { status: 'error', error: req.failure()?.errorText || 'request failed' });
  };

  let saved = prevText;
  const saveMap = () => {
    const text = serializeMap(mergeMap(prev, results));
    if (text !== saved) { writeAtomic(o.harvestMap, text); saved = text; }
  };
  let opened = 0;
  let challenged = 0;
  const browser = await session.launchStealthHeaded(chromium);
  try {
    const ctx = await session.newLiveContext(browser, { viewport: { width: 1440, height: 900 } });
    for (const { slug, url } of pages) {
      const page = await ctx.newPage();
      // One queue per page: responses are handled one at a time in arrival order, so the run total never overshoots
      // --max-total-bytes; which asset reaches the cap first follows the browser's arrival order.
      let queue = Promise.resolve();
      const onResp = (resp) => { queue = queue.then(() => onResponse(resp)).catch((e) => console.error(`media-harvest: ${slug}: ${firstLine(e)}`)); };
      const onFail = (req) => { queue = queue.then(() => onFailed(req)); };
      inflight.clear();
      page.on('request', onRequest);
      page.on('response', onResp);
      page.on('requestfailed', onFail);
      let pageOpened = false;
      try {
        await session.gotoLive(page, url, { waitUntil: session.defaultWaitUntil(url), settleMs: session.isLiveHttpUrl(url) ? 2500 : 1200 });
        await session.dismissOverlays(page, { lateWindowMs: session.lateWindowFor(url) });
        await queue;
        opened += 1;
        pageOpened = true;
        const svgUrls = [...sheetSvg].filter((u) => !seen.has(u)).sort();
        if (want.has('fonts') || svgUrls.length) {
          // A load the page cannot finish is recorded by its response (or not at all); it never un-opens the page.
          try {
            await session.withDeadline(page.evaluate(forceLoadInPage, { fonts: want.has('fonts'), urls: svgUrls, timeoutMs }), timeoutMs + 5000, 'force-load');
            await page.waitForTimeout(300);
          } catch (e) { console.error(`media-harvest: ${slug}: force-load: ${firstLine(e)}`); }
        }
        await queue;
      } catch (e) {
        if (e?.name === 'BotChallengeError') challenged += 1;
        console.error(`media-harvest: ${slug}: ${e?.name || 'Error'}: ${firstLine(e)} — page not opened`);
      } finally {
        page.off('request', onRequest);
        page.off('response', onResp);
        page.off('requestfailed', onFail);
        await queue;
        if (pageOpened) for (const [src, kind] of inflight) if (!seen.has(src)) unanswered.set(src, kind);
        await page.close().catch(() => {});
      }
      saveMap();
    }
  } finally { await browser.close().catch(() => {}); }
  // Unanswered on every page that asked for it: a later page's answer wins, so this is recorded only at the end.
  for (const [src, kind] of [...unanswered].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (seen.has(src)) continue;
    seen.add(src);
    record(src, kind, { status: 'error', error: `no complete answer while its page was open (bodies and forced loads wait --timeout ${o.timeout}s)` });
  }
  saveMap();
  const pageErrors = pages.length - opened;
  const lines = summarizeAssets({ pages: pages.length, kinds, byKind, downloaded, reused, failures, pageErrors, map: o.harvestMap });
  let code = 0;
  if (pages.length && !opened) code = challenged === pages.length ? 3 : 1;
  return { lines, code };
}

async function main(argv) {
  const o = parseArgs(argv);
  let st = null;
  try { st = statSync(o.pages); } catch { /* missing */ }
  if (!st || !st.isDirectory()) throw new UsageError(`--pages ${o.pages} is not a directory (run the crawl first)`);
  const media = o.assets.includes('media');
  const browserKinds = o.assets.some((k) => k !== 'media');
  // Every refusal (a bad map, no playwright, no live-session) comes before anything is written.
  const m = media ? readMapFile(o.map, '--map') : null;
  const h = browserKinds ? readMapFile(o.harvestMap, '--harvest-map') : null;
  const tools = browserKinds ? await browserTools() : null;

  let code = 0;
  if (media) console.log((await harvestMedia(o, m.text, m.map)).join('\n'));
  if (browserKinds) {
    const r = await harvestBrowser(o, h.text, h.map, tools);
    console.log(r.lines.join('\n'));
    code = r.code;
  }
  return code;
}

if (IS_MAIN) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`media-harvest: ${e.message}`);
    if (e instanceof UsageError) console.error(SYNOPSIS);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
