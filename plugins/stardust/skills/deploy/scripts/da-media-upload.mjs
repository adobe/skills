#!/usr/bin/env node
/**
 * skills/deploy/scripts/da-media-upload.mjs
 *
 * Media rehosting for the stardust:deploy ENCODE contract (deploy SKILL.md
 * "The ENCODE contract → Images" and "Distinguish 403-bot-wall from
 * 404-missing"): upload captured editorial images to the DA media folder and
 * print the branch-independent URL to author for each one.
 *
 * Protocol implemented, per file:
 *   PUT https://admin.da.live/source/{org}/{repo}/media/<scope>/<file>
 *       multipart form data, field name `data`, the image's own Content-Type
 *   author https://content.da.live/{org}/{repo}/media/<scope>/<file>
 *       (that URL answers 401 to an anonymous request and still ingests fine —
 *       verify post-preview, never with a bare GET)
 *   images only: jpg/jpeg/png/webp/gif/avif and small pure-vector svg. Video,
 *       audio and PDF never ride content.da.live (they would deliver 401 to
 *       every visitor) — they are listed as SKIP not-an-image and left to the
 *       code origin. An svg that embeds raster data or exceeds 40 KB fails
 *       every page preview that references it (409 from the content bus, no
 *       per-asset error) and is refused here as FAIL svg-unsafe.
 *   source fetch (manifest entries whose local file is absent but name a
 *       `source` URL): 2xx image bytes are saved to the local path and then
 *       uploaded; 401/403 is a hot-link bot wall — the asset EXISTS, capture it
 *       in-page and re-run (never omit); 404 is genuinely missing — omit, after
 *       the rendition/delimiter repairs the skill describes, never substitute.
 *
 * Ledger (default stardust/deploy/media-ledger.json, --ledger to move it):
 *   keyed by the DA path `media/<scope>/<file>`; a file already recorded as
 *   uploaded with the same local path and byte size is skipped on re-run, so
 *   the command is safe to repeat after a token refresh or a partial failure.
 *   Transient responses (429, 5xx, network errors) are retried with capped
 *   exponential backoff, and so is a 401 from the admin API (a valid token can
 *   be answered 401 under a concurrent burst — recorded: a whole first burst at
 *   concurrency 4, while a lone sequential PUT went through). The ledger is
 *   written atomically (tmp + rename, trailing newline) from one place.
 *
 * 401 policy (two recorded facts: one 401 must not halt; a persistent 401 must
 * halt fast — an expired token once left an 894-row batch failing file by file
 * for 5.5 hours):
 *   preflight — if DA_TOKEN is a JWT whose `exp` has passed, exit 3 before any
 *       request, naming the expiry (a non-JWT token, or one without exp, is
 *       simply tried).
 *   first upload — runs alone to prove the token, with the bounded 401 retries.
 *   any 401 — retried with the same short backoff as a 429. A 401 that persists
 *       through its retries on ANY file (first or later) HALTS the batch: exit 3,
 *       ledger persisted, in-flight uploads allowed to finish, remaining files
 *       left `not attempted`, one stderr line naming DA_TOKEN and the exact
 *       re-run command (the same command resumes from the ledger). A file is
 *       never marked `failed` because of a 401 — it prints HALT, not FAIL.
 *
 * Token: read from the DA_TOKEN environment variable only; it is never
 * printed and never written to the ledger or anywhere else.
 *
 * Usage:
 *   DA_TOKEN=… node skills/deploy/scripts/da-media-upload.mjs --org <org> --repo <repo> --scope <scope> \
 *     (--dir <local dir> | --manifest <json>) [options]
 *     --scope <name>       the folder under media/; relative — never media/<name> (the DA
 *                          path would double to media/media/<name>; refused as a usage error)
 *     --dir <path>         upload every image under this directory; the path
 *                          relative to it becomes <file> (sub-folders kept)
 *     --manifest <json>    upload the entries listed in a JSON manifest (below)
 *     --concurrency <n>    parallel uploads                       (default 4)
 *     --ledger <path>      ledger file   (default stardust/deploy/media-ledger.json)
 *     --retries <n>        attempts after the first for 401/429/5xx (default 4)
 *     --backoff-ms <n>     base delay of the capped backoff        (default 500)
 *     --dry-run            list what would be uploaded; no network, no ledger write
 *     --admin-url <base>   override https://admin.da.live   (local test double)
 *     --content-url <base> override https://content.da.live (local test double)
 *
 * Manifest shapes (any one file):
 *   [ { "file": "stardust/current/assets/media/hero-a3f9.jpg",
 *       "source": "https://origin.example/img/hero.jpg",     optional: fetched when `file` is absent
 *       "name": "hero-a3f9.jpg" } ]                          optional: <file> under media/<scope>/ (default: basename)
 *   { "<file>": "<source>" } or { "<file>": { "source": …, "name": … } }
 *   { "images": [ { "localPath": …, "src": … } ] }            the extract current-state § Media list
 *
 * Output, one line per file, then a summary:
 *   OK <file> -> https://content.da.live/{org}/{repo}/media/<scope>/<name>
 *   SKIP <file> already uploaded (ledger) | not-an-image
 *   FAIL <file> <status|reason> …
 *   HALT <file> 401 …                                          (the token halt; not a FAIL)
 *   DRY <file> -> <content url>                               (--dry-run)
 * Exit codes: 0 no failures, 1 any FAIL, 2 usage error (a value flag followed by
 *   nothing or by another --flag included), 3 token halt (expired JWT before any
 *   request, or a 401 that persisted through its retries — refresh DA_TOKEN and
 *   re-run the same command; the ledger skips what already landed).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-await-in-loop */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mergeLedger } from './file-lock.mjs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `da-media-upload — rehost captured images to the DA media folder

Usage: DA_TOKEN=… node da-media-upload.mjs --org <org> --repo <repo> --scope <scope> (--dir <dir> | --manifest <json>) [options]
  --scope <name>        the folder under media/ (relative — never media/<name>: the path would double to media/media/<name>)
  --dir <path>          upload every image under the directory (relative path = <file>)
  --manifest <json>     upload the listed entries: [{file, source?, name?}], {file: source}, or {images:[{localPath, src}]}
  --concurrency <n>     parallel uploads (default 4)
  --ledger <path>       ledger file (default stardust/deploy/media-ledger.json)
  --retries <n>         attempts after the first for 401/429/5xx/network (default 4)
  --backoff-ms <n>      base delay of the capped backoff (default 500)
  --dry-run             list what would be uploaded; no network, no ledger write
  --admin-url <base>    override https://admin.da.live (local test double)
  --content-url <base>  override https://content.da.live (local test double)
  --help                this text

Writes: the ledger at --ledger (not with --dry-run) and, for a manifest entry whose local
file is absent but names a source, the fetched image bytes saved to that entry's file path.
Prints one line per file (OK / SKIP / FAIL / HALT / DRY) and a summary. Exit 0 = no failures, 1 = any FAIL,
2 = usage (a value flag followed by nothing or another --flag included), 3 = token halt.
Token halt: an expired JWT in DA_TOKEN exits 3 before any request; the first upload runs alone to prove the
token; a 401 retries like a 429, and a 401 that still persists through its retries on any file halts the batch
(ledger saved, in-flight uploads finish, the rest not attempted, never marked failed) — refresh DA_TOKEN and
re-run the same command; the ledger skips what already landed.`;

const USAGE_EXIT = 2;
const TOKEN_EXIT = 3;
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const SVG_MAX_BYTES = 40 * 1024;
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
// The admin PUT also retries a 401: a valid token can be answered 401 under a concurrent burst (recorded —
// the whole first burst of a batch, on a token with hours of validity left, while a lone sequential PUT
// went straight through). The source fetch keeps RETRYABLE as is: there a 401/403 is the bot wall.
const ADMIN_RETRYABLE = new Set([...RETRYABLE, 401]);
// A browser-shaped request for the source fetch: bot-managed origins answer a bare client with 403
// even for assets that exist. A UA and Referer are the closest a script gets; the capture itself
// fetched in-page, which is why a 403 here means "rehost the captured copy", never "missing".
const SOURCE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function usage(msg) { console.error(`da-media-upload error: ${msg}\n\n${HELP}`); process.exit(USAGE_EXIT); }

export function parseArgs(argv, env = process.env) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { concurrency: 4, ledger: join('stardust', 'deploy', 'media-ledger.json'), retries: 4, backoffMs: 500, dryRun: false, adminUrl: 'https://admin.da.live', contentUrl: 'https://content.da.live' };
  const num = (flag, v, min) => { const n = Number(v); if (!Number.isFinite(n) || n < min) usage(`${flag} needs a number ≥ ${min}`); return n; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    // A value flag swallows nothing: followed by the end of the line or by another --flag it is a usage error
    // (recorded: `--ledger --dry-run` silently took "--dry-run" as the ledger path and then uploaded for real).
    const next = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) usage(`${a} needs a value${v === undefined ? '' : ` (got ${v})`}`); return rest[i += 1]; };
    if (a === '--org') o.org = next();
    else if (a === '--repo') o.repo = next();
    else if (a === '--scope') o.scope = next();
    else if (a === '--dir') o.dir = next();
    else if (a === '--manifest') o.manifest = next();
    else if (a === '--concurrency') o.concurrency = num(a, next(), 1);
    else if (a === '--ledger') o.ledger = next();
    else if (a === '--retries') o.retries = num(a, next(), 0);
    else if (a === '--backoff-ms') o.backoffMs = num(a, next(), 0);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--admin-url') o.adminUrl = next().replace(/\/+$/, '');
    else if (a === '--content-url') o.contentUrl = next().replace(/\/+$/, '');
    else usage(`unknown argument ${a}`);
  }
  for (const k of ['org', 'repo', 'scope']) if (!o[k]) usage(`--${k} is required`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(o.scope)) usage('--scope must be a path segment (letters, digits, - _ .), optionally nested with /');
  // --scope is the folder UNDER media/: the DA path is media/<scope>/<file>. A recorded run passed
  // `--scope media/<name>` and uploaded 242 files to media/media/<name>, then deleted them all.
  if (/^media\//.test(o.scope)) usage(`--scope is relative to media/ — pass the folder name under it (--scope ${o.scope.slice(6)}), never media/<name>: the upload path would double to media/${o.scope}/<file>`);
  if (!!o.dir === !!o.manifest) usage('give exactly one of --dir or --manifest');
  o.token = env.DA_TOKEN;
  if (!o.dryRun && !o.token) usage('DA_TOKEN is not set in the environment (the token is read from there only)');
  return o;
}

// ---- inputs ------------------------------------------------------------------------------------

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push({ file: full, name: relative(base, full).split(sep).join('/') });
  }
  return out;
}

export function readManifest(path) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { usage(`cannot read manifest ${path}: ${e.message}`); }
  const entries = [];
  const push = (file, source, name) => { if (typeof file === 'string' && file) entries.push({ file, source: typeof source === 'string' && source ? source : null, name: typeof name === 'string' && name ? name : basename(file) }); };
  if (Array.isArray(doc)) for (const e of doc) { if (e && typeof e === 'object') push(e.file || e.localPath, e.source || e.src, e.name); }
  else if (doc && typeof doc === 'object' && Array.isArray(doc.images)) for (const e of doc.images) { if (e && typeof e === 'object') push(e.localPath || e.file, e.src || e.source, e.name); }
  else if (doc && typeof doc === 'object') for (const [file, v] of Object.entries(doc)) { if (typeof v === 'string') push(file, v); else if (v && typeof v === 'object') push(file, v.source || v.src, v.name); }
  else usage(`manifest ${path} is neither an array, a map, nor an {images:[…]} object`);
  if (!entries.length) usage(`manifest ${path} lists no entries with a file path`);
  return entries;
}

// ---- classification --------------------------------------------------------------------------------

export function classify(name, bytes) {
  const type = IMAGE_TYPES[extname(name).toLowerCase()];
  if (!type) return { ok: false, skip: 'not-an-image', why: 'only jpg/jpeg/png/webp/gif/avif/svg are rehosted; video, audio and PDF ship from the code origin' };
  if (type === 'image/svg+xml' && bytes) {
    const text = bytes.toString('utf8');
    if (/<image[\s>]|data:image\//i.test(text)) return { ok: false, fail: 'svg-unsafe', why: 'embeds raster data — extract it to a png and author that (every referencing page would fail preview with 409)' };
    if (bytes.length > SVG_MAX_BYTES) return { ok: false, fail: 'svg-unsafe', why: `${bytes.length} bytes exceeds the ~40KB pipeline limit — rasterize to png` };
  }
  return { ok: true, type };
}

// ---- token preflight ----------------------------------------------------------------------------------

// The `exp` claim (seconds since the epoch) of a JWT-shaped token, or null when the token is not a JWT or
// carries no numeric exp. Decodes the middle segment only; nothing about the token is ever printed.
export function jwtExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((x) => /^[A-Za-z0-9_-]+$/.test(x))) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch { return null; }
}

// The exact command to re-run once DA_TOKEN is fresh: same script, same arguments (the token itself is
// never on the command line — it is read from the environment only).
const shellQuote = (a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
const rerunCommand = () => `DA_TOKEN=<fresh token> node ${process.argv.slice(1).map(shellQuote).join(' ')}`;

// ---- http --------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
// Every response body is consumed or cancelled: an undrained body keeps its connection open, and a
// batch of a hundred files at concurrency 4 would run out of sockets long before it ran out of files.
const drain = async (res) => { if (res) await res.arrayBuffer().catch(() => {}); };

async function withRetries(doFetch, { retries, backoffMs, retryStatuses = RETRYABLE }) {
  for (let attempt = 0; ; attempt += 1) {
    let res = null; let status = 0; let err = '';
    try { res = await doFetch(); status = res.status; } catch (e) { status = 0; err = String(e.message || e); }
    if (!retryStatuses.has(status) || attempt >= retries) return { res, status, err, attempts: attempt + 1 };
    const retryAfter = res && Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(15000, retryAfter * 1000) : Math.min(15000, backoffMs * 2 ** attempt) + attempt * 37;
    await drain(res);
    await sleep(wait);
  }
}

async function fetchSource(url, opts) {
  let referer = '';
  try { referer = new URL(url).origin + '/'; } catch { return { kind: 'bad-url' }; }
  const { res, status, err } = await withRetries(() => fetch(url, { headers: { 'user-agent': SOURCE_UA, referer, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }, redirect: 'follow' }), opts);
  if (status === 0) return { kind: 'network', why: err };
  if (status === 401 || status === 403) { await drain(res); return { kind: 'bot-wall', status }; }
  if (status === 404 || status === 410) { await drain(res); return { kind: 'missing', status }; }
  if (status < 200 || status >= 300) { await drain(res); return { kind: 'http', status }; }
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!ct.startsWith('image/')) { await drain(res); return { kind: 'not-image-response', status, contentType: ct || 'none' }; }
  return { kind: 'ok', status, bytes: Buffer.from(await res.arrayBuffer()), contentType: ct };
}

async function putMedia(bytes, type, name, daPath, opts) {
  const url = `${opts.adminUrl}/source/${encodeURIComponent(opts.org)}/${encodeURIComponent(opts.repo)}/${encodePath(daPath)}`;
  return withRetries(() => {
    const fd = new FormData();
    fd.append('data', new Blob([bytes], { type }), basename(name));
    return fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${opts.token}` }, body: fd });
  }, { ...opts, retryStatuses: ADMIN_RETRYABLE });
}

// ---- main ------------------------------------------------------------------------------------------

async function pool(items, n, worker) {
  const q = [...items];
  const run = async () => { while (q.length) await worker(q.shift()); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

function loadLedger(path) {
  if (!existsSync(path)) return {};
  try { const l = JSON.parse(readFileSync(path, 'utf8')); return l && typeof l === 'object' && !Array.isArray(l) ? l : {}; } catch (e) { usage(`ledger ${path} is not readable JSON: ${e.message} (move it aside to start a fresh ledger)`); }
  return {};
}

async function main() {
  const opts = parseArgs(process.argv);
  const entries = opts.dir
    ? (existsSync(opts.dir) && statSync(opts.dir).isDirectory() ? walk(opts.dir).map((e) => ({ ...e, source: null })) : usage(`--dir ${opts.dir} is not a directory`))
    : readManifest(opts.manifest);
  // Preflight: an expired JWT never reaches the network (recorded: an expired token left an 894-row batch
  // failing file by file for 5.5 hours). Anything that is not a JWT with an exp is simply tried.
  if (!opts.dryRun) {
    const exp = jwtExpiry(opts.token);
    if (exp !== null && exp * 1000 <= Date.now()) {
      const ago = Math.max(1, Math.round((Date.now() - exp * 1000) / 60000));
      console.error(`da-media-upload: DA_TOKEN is expired — its exp claim is ${new Date(exp * 1000).toISOString()} (${ago} min ago); nothing was sent. Refresh it and re-run: ${rerunCommand()}`);
      process.exit(TOKEN_EXIT);
    }
  }
  const ledger = loadLedger(opts.ledger);
  // The ledger is shared by every uploader on the site (cluster subagents upload at once during a
  // fan-out): persist takes the cross-process lock, re-reads the file on disk, lays this run's entries
  // over it (ours win — they are the newest facts about the files we touched) and writes tmp + rename.
  // Synchronous on purpose — concurrent workers in this process cannot cut in between read and rename.
  const persist = () => {
    if (opts.dryRun) return;
    try {
      mergeLedger(opts.ledger, ledger, { onBad: (e) => console.error(`da-media-upload: ledger ${opts.ledger} on disk is not readable JSON (${e.message}) — this run's entries are written over it`) });
    } catch (e) { console.error(`da-media-upload: ${e.message}`); }
  };
  const counts = { uploaded: 0, skipped: 0, notImage: 0, failed: 0, dry: 0 };
  let halted = null;
  // Set by the first 2xx from the admin API. Until then entries run one at a time (the single-flight loop
  // below), so nothing else is in flight while the token is being proved.
  let tokenAccepted = false;
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  const daPathOf = (e) => `media/${opts.scope}/${e.name}`;
  const contentUrlOf = (daPath) => `${opts.contentUrl}/${encodeURIComponent(opts.org)}/${encodeURIComponent(opts.repo)}/${encodePath(daPath)}`;
  const recordFailure = (e, what, why, extra = {}) => {
    const daPath = daPathOf(e);
    counts.failed += 1;
    ledger[daPath] = { ...(ledger[daPath] || {}), status: 'failed', file: e.file, source: e.source, contentUrl: contentUrlOf(daPath), error: `${what} ${why}`.trim(), ts: new Date().toISOString(), ...extra };
    say(`FAIL ${e.file} ${what}${why ? ` (${why})` : ''}`);
  };

  const worker = async (e) => {
    if (halted) return;
    const daPath = daPathOf(e);
    const contentUrl = contentUrlOf(daPath);
    const rec = ledger[daPath] || {};
    const pre = classify(e.name, null);
    if (pre.skip) { counts.skipped += 1; counts.notImage += 1; say(`SKIP ${e.file} ${pre.skip} (${pre.why})`); return; }

    let bytes = null;
    if (existsSync(e.file) && statSync(e.file).isFile()) bytes = readFileSync(e.file);
    if (bytes && rec.status === 'uploaded' && rec.file === e.file && rec.size === bytes.length) { counts.skipped += 1; say(`SKIP ${e.file} already uploaded (ledger) -> ${rec.contentUrl || contentUrl}`); return; }

    if (opts.dryRun) {
      counts.dry += 1;
      say(`DRY ${e.file} -> ${contentUrl}${bytes ? ` (${bytes.length} bytes)` : e.source ? ' (fetch from source first)' : ' (LOCAL FILE MISSING and no source)'}`);
      return;
    }

    const fail = (what, why, extra = {}) => recordFailure(e, what, why, extra);

    if (!bytes) {
      if (!e.source) { fail('missing-local', 'no such file and the manifest names no source'); return; }
      const got = await fetchSource(e.source, opts);
      if (got.kind === 'bot-wall') { fail(`source ${got.status}`, 'bot wall: blocked when hot-linked, NOT missing — capture it in-page (extract keeps a local copy) and re-run; never omit'); return; }
      if (got.kind === 'missing') { fail(`source ${got.status}`, 'missing at origin — try the rendition/delimiter repairs first, then omit; never substitute a placeholder'); return; }
      if (got.kind === 'not-image-response') { fail(`source ${got.status}`, `answered ${got.contentType}, not image bytes`); return; }
      if (got.kind !== 'ok') { fail(`source ${got.status || got.kind}`, got.why || 'fetch failed'); return; }
      bytes = got.bytes;
      mkdirSync(dirname(resolve(e.file)), { recursive: true });
      writeFileSync(e.file, bytes);
    }

    const c = classify(e.name, bytes);
    if (c.fail) { fail(c.fail, c.why); return; }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { res, status, err, attempts } = await putMedia(bytes, c.type, e.name, daPath, opts);
    if (status >= 200 && status < 300) {
      await drain(res);
      tokenAccepted = true;
      counts.uploaded += 1;
      ledger[daPath] = { status: 'uploaded', file: e.file, size: bytes.length, sha256, contentType: c.type, source: e.source, contentUrl, httpStatus: status, attempts, ts: new Date().toISOString() };
      say(`OK ${e.file} -> ${contentUrl}${attempts > 1 ? ` (after ${attempts} attempts)` : ''}`);
      return;
    }
    if (status === 401) {
      // A 401 that survived every retry is the token, not this file: the batch halts (exit 3) and the file
      // is left not attempted — never `failed` — so the same command resumes exactly here. Workers already
      // in flight finish their own upload; nothing new starts.
      await drain(res);
      say(`HALT ${e.file} 401 (unauthorized through ${attempts} attempt${attempts === 1 ? '' : 's'} — DA_TOKEN rejected; not recorded as failed, the re-run resumes here)`);
      if (!halted) {
        halted = `DA_TOKEN rejected (401 through ${attempts} attempt${attempts === 1 ? '' : 's'} on ${e.file}${tokenAccepted ? ', after the token had been accepted earlier in this batch' : ', the lone first upload'}): refresh DA_TOKEN in the environment and re-run the same command — the ledger skips what already uploaded: ${rerunCommand()}`;
        persist();
      }
      return;
    }
    const body = res ? (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ') : '';
    const why = status === 0 ? `network: ${err}` : status === 403 ? 'forbidden — the token has no write access to this org/repo (a source-CDN 403 is a different thing; see source fetch)' : status === 404 ? 'org/repo path not found on DA — check --org/--repo' : status === 413 ? 'payload too large' : body;
    fail(String(status || 'network'), `${why}${attempts > 1 ? `; ${attempts} attempts` : ''}`, { httpStatus: status, attempts });
  };

  let sinceSave = 0;
  const guarded = async (e) => {
    // One file's exception (an unreadable local file, an unexpected fetch error) is that file's FAIL line
    // and ledger entry — never the end of the batch with the ledger unsaved.
    try { await worker(e); } catch (err) { if (!halted) recordFailure(e, 'error', String(err && err.message ? err.message : err)); }
    if ((sinceSave += 1) % 5 === 0) persist();
  };
  // Single flight: entries run one at a time until the admin API has accepted the token (the first 2xx) or
  // the batch halted on it. Only then does the pool open, so nothing else is in flight while the token is
  // being proved. A dry run or a fully ledger-skipped batch never reaches the admin API and simply runs
  // through this loop, with the same lines and counts as before.
  let next = 0;
  while (next < entries.length && !tokenAccepted && !halted) { await guarded(entries[next]); next += 1; }
  await pool(entries.slice(next), opts.concurrency, guarded);
  persist();

  const notRun = halted ? entries.length - (counts.uploaded + counts.skipped + counts.failed) : 0;
  console.log(`da-media-upload: ${entries.length} file(s) — ${counts.uploaded} uploaded, ${counts.skipped} skipped (${counts.notImage} not an image), ${counts.failed} failed${counts.dry ? `, ${counts.dry} dry-run` : ''}${notRun ? `, ${notRun} not attempted` : ''}${opts.dryRun ? '' : ` · ledger ${opts.ledger}`}`);
  if (halted) console.error(`da-media-upload: ${halted}`);
  process.exitCode = halted ? TOKEN_EXIT : counts.failed ? 1 : 0;
}

// Compare by real path: node resolves the entry's symlinks for import.meta.url but not for argv[1], so a
// symlinked checkout or temp dir would otherwise turn the CLI into a silent no-op (exit 0, no OK lines —
// which reads as "uploaded" and ships about:error images).
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  main().catch((e) => { console.error(`da-media-upload error: ${e.message}`); process.exit(USAGE_EXIT); });
}
