#!/usr/bin/env node
/**
 * deploy/rehost-media.mjs — rehost authored external images to DA media with a ledger.
 *
 * The preview ingester already hashes every FETCHABLE external <img> into Media Bus
 * (da-deploy-protocol.md § 2b); this pass is the ingest-reliability instrument for the
 * classes it cannot ingest, plus the owner-chosen `rehost-all` policy. Scope: `<img src>`,
 * `<source srcset>`, `<video poster>` — never video/audio/PDF (#103: content.da.live is
 * auth-gated for visitors) and never CSS url() (not an authored shape).
 *
 * Per unique external URL, ONE source GET (0 on a re-run — ledger-keyed; 0 when a captured
 * copy exists under --captured) and one DA PUT; the ledger is `stardust/da-media.json` (checkpointed after every URL)
 * `{ [src]: { da, url, sha1, bytes, type, width, height, status, at } }`, re-read and merged:
 *   rehosted   bytes PUT to admin.da.live/source/<org>/<repo>/media/<scope>/<file>; every
 *              occurrence (plain and &amp; form) rewritten to the content.da.live URL
 *   kept       plain-UA 200 image the policy leaves as a hotlink — the ingester fetches it; the
 *              row records the policy (and --only) it was kept under and is re-evaluated when
 *              either differs or --from now classes the URL `rehost`
 *   blocked    401/403 to the plain UA AND the browser UA (+Referer) — stays a media-reconcile
 *              gate fail; `--technique headed-chrome` re-tries it with the in-page fetch (below)
 *   dead       definitive 404/410 — recorded, the <img> is left to media-reconcile --apply (omit)
 *   not-image  200 whose content-type or magic bytes are not an image (an HTML fallback, #118)
 *   signed     `token= | expires= | signature= | X-Amz-*` query — a capture-state row (extract
 *              provenance), never fetched at deploy time
 *   oversize   raster > 1 MB (the ingester truncates it) that no recognised CDN transform
 *              (Contentful / Cloudinary / Scene7 / Akamai IM) and no --resize brought under the
 *              cap — warned, not rehosted; --resize re-tries it
 * A changed asset is uploaded under a NEW `-<sha8>` stem: the pipeline media cache keys by
 * source URL and never refreshes a same-path re-upload, so `?rev=` is never needed.
 *
 * What is acted on (rehosted), by reason — `--only <reason,…>` narrows to these tokens:
 *   blocked    401/403 to the plain UA, fetched by the browser UA or in-page — EVERY policy
 *   oversize   raster > 1 MB, fetched pre-shrunk through the CDN transform or --resize — EVERY policy
 *   rehost     a URL media-reconcile --from classed `rehost`                        — EVERY policy
 *   all        every other 2xx image                                                 — rehost-all only
 * Policy (`stardust/reference/decisions.md` row `media`): --policy, else state.json
 * `media.policy`, else `rehost-blocked`. `keep` and `rehost-blocked` differ only in the
 * lint row: both leave fetchable, ingestible hotlinks alone.
 *
 * --technique headed-chrome (F1): a URL blocked to the plain UA is fetched IN-PAGE — one
 * browser context per origin (live-session newLiveContext + the admitted session state:
 * --storage-state <file> | --fresh-state | --solve-wait <ms>, § Admitted-session reuse), its
 * home document opened once through gotoLive (paced by live-budget; the fingerprint, cookies
 * and Referer the asset fetch inherits — encode-contract § bot-managed origins), then
 * `page.evaluate(fetch)`; the browser tier is the one the crawl recorded
 * (`_crawl-log.json#discovery.fetchTechnique`, headless when absent; --solve-wait implies a
 * visible tier-3 window). A challenge, lock or HTTP error at the home document leaves the row
 * `blocked` with the error named — never a downgrade. --resize (F2): a > 1 MB
 * raster with no CDN transform is re-encoded in the page (canvas, longest edge ≤ 2000 px,
 * JPEG) and rehosted when smaller. Both resolve Playwright through the runtime chain
 * (stardust/node_modules); when it is absent the row stays `blocked` / `oversize` with the
 * preflight line in its note — hands-off never downgrades a row.
 *
 * Usage:
 *   node skills/deploy/scripts/rehost-media.mjs --org <org> --repo <repo> --scope <site> --content <dir>
 *        [--from <media-reconcile.json>] [--policy rehost-blocked|rehost-all|keep] [--state <state.json>]
 *        [--ledger <file>] [--captured <dir>] [--technique headed-chrome] [--resize] [--concurrency 2]
 *        [--storage-state <file> | --fresh-state] [--solve-wait <ms>]
 *        [--only blocked,oversize,rehost,all] [--token-env <NAME>] [--dry] [--json]
 *   --from restricts the pass to the URLs media-reconcile classed `rehost` (plus every other
 *   external under rehost-all); --only limits the acted reasons (a URL whose every reason is
 *   excluded is `kept` with the note); --dry fetches, classifies and prints, PUTs nothing and
 *   rewrites nothing.
 * Exit: 0 clean · 1 blocked | dead | not-image rows remain · 2 usage · 3 DA 401 on a media PUT
 *       (HaltError — nothing else is retried, B13).
 * Test hooks: DEPLOY_BATCH_DA_SRC overrides the DA Source host (mock-da.mjs); REHOST_MEDIA_TIMEOUT_MS
 * (15000) caps each source GET; REHOST_MEDIA_BACKOFF_MS (60000) is the one 429 back-off — the retry
 * gets its own timer; STARDUST_PW_ROOT resolves Playwright from the eval runner.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveToken } from './lib.mjs';
import { HaltError } from './deploy-batch.mjs';
import { BROWSER_UA, collectPosters, hostOf, isDaHosted, replaceUrl, walkHtml, TRANSFORM_HINTS } from '../../rollout/scripts/media-reconcile.mjs';
import { resolveDep, siblingScript, PREFLIGHT_HINT } from '../../stardust/scripts/lib/resolve.mjs';

const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';
const PLAIN_UA = 'stardust-rehost-media';
const ONE_MB = 1024 * 1024;
const TIMEOUT_MS = Number(process.env.REHOST_MEDIA_TIMEOUT_MS) || 15000;
const BACKOFF_MS = Number(process.env.REHOST_MEDIA_BACKOFF_MS) || 60000;
const RESIZE_MAX = 2000;
export const REASONS = ['blocked', 'oversize', 'rehost', 'all'];
const MAGIC = [['89504e47', 'image/png', 'png'], ['ffd8ff', 'image/jpeg', 'jpg'], ['47494638', 'image/gif', 'gif'], ['52494646', 'image/webp', 'webp']];
const TRANSFORM_URL = [[/ctfassets\.net/i, (u) => `${u}${u.includes('?') ? '&' : '?'}fm=jpg&w=2000&q=80`], [/cloudinary\.com\/[^/]+\/image\/upload\//i, (u) => u.replace(/\/upload\//, '/upload/w_2000,q_auto/')], [/scene7\.com|\/is\/image\//i, (u) => `${u}${u.includes('?') ? '&' : '?'}wid=2000`], [/\/im\//i, (u) => `${u}${u.includes('?') ? '&' : '?'}im=Resize,width=2000`]];
export const sha1 = (b) => createHash('sha1').update(b).digest('hex');
export const isSigned = (u) => /[?&](token|expires?|signature|sig|x-amz-[a-z-]+)=/i.test(u);

/** PNG / JPEG / GIF / SVG sniff → { type, ext } or null (content-type and bytes must agree — #118). */
export function sniffImage(buf, contentType = '') {
  const hex = buf.subarray(0, 4).toString('hex');
  const hit = MAGIC.find(([m]) => hex.startsWith(m));
  if (hit) return { type: hit[1], ext: hit[2] };
  if (buf.subarray(4, 12).toString('latin1') === 'ftypavif') return { type: 'image/avif', ext: 'avif' };
  if (/^\s*(<\?xml|<svg)/i.test(buf.subarray(0, 256).toString('utf8')) && /svg|xml/i.test(contentType)) return { type: 'image/svg+xml', ext: 'svg' };
  return null;
}
/** Intrinsic width/height for PNG, GIF and baseline/progressive JPEG; nulls otherwise. */
export function dimensions(buf, type) {
  if (type === 'image/png' && buf.length > 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (type === 'image/gif' && buf.length > 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (type === 'image/jpeg') { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i += 1; continue; } const marker = buf[i + 1]; if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }; i += 2 + buf.readUInt16BE(i + 2); } }
  return { width: null, height: null };
}
/** `Foo (1)%40x2.jpg` → `foo-1-40x2-<sha8>.jpg`: lowercase, `[^a-z0-9._-]` → `-`, ≤ 60 chars, sha8 of the URL keeps two same-named assets apart. */
export function mediaStem(url, ext) {
  let leaf = basename((url.split(/[?#]/)[0] || '').replace(/\/+$/, '')) || 'asset';
  try { leaf = decodeURI(leaf); } catch { /* keep the raw leaf */ } // %20 → space; reserved escapes (%40) stay literal, as recorded
  const dot = leaf.lastIndexOf('.');
  const base = (dot > 0 ? leaf.slice(0, dot) : leaf).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48) || 'asset';
  return `${base}-${sha1(url).slice(0, 8)}.${ext}`;
}
/** PUT one binary to DA media (multipart field `data`); 401 → HaltError (exit 3 upstream). Returns { status, da, url }. */
export async function putDaMedia({ org, repo, scope, file, buf, type, token }) {
  const fd = new FormData(); fd.append('data', new Blob([buf], { type }), file);
  const da = `${DA_SRC}/${org}/${repo}/media/${scope}/${file}`;
  const r = await fetch(da, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: fd });
  if (r.status === 401) throw new HaltError('da-401', `DA answered 401 on ${da} — token expired or rejected; refresh it and re-run (nothing else was written)`);
  return { status: r.status, da, url: `https://content.da.live/${org}/${repo}/media/${scope}/${file}` };
}
export function collectAuthored(h) { // <img src>, <source srcset>, <video poster> — the shapes the ingester rehosts (#103)
  const urls = new Set();
  for (const m of h.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/\bsrcset="([^"]+)"/gi)) m[1].split(',').forEach((p) => { const u = p.trim().split(/\s+/)[0]; if (u) urls.add(u); });
  collectPosters(h).forEach((u) => urls.add(u));
  return [...urls].map((u) => u.replace(/&amp;/g, '&')).filter((u) => /^https?:\/\//i.test(u) && !isDaHosted(u)); // attribute-decoded: the fetch and the ledger key use the real URL, the rewrite covers both forms
}
/** One source GET with its own timer; a 429 backs off ONCE and the retry gets a fresh timer + the same headers. */
export async function getWithBackoff(u, ua, { timeoutMs = TIMEOUT_MS, backoffMs = BACKOFF_MS } = {}) {
  const headers = { 'user-agent': ua, accept: 'image/*,*/*;q=0.8', referer: `${new URL(u).origin}/` };
  const once = async () => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try { const r = await fetch(u, { signal: ac.signal, headers }); return { status: r.status, type: (r.headers.get('content-type') || '').split(';')[0].trim(), buf: Buffer.from(await r.arrayBuffer()) }; } finally { clearTimeout(t); }
  };
  try { let r = await once(); if (r.status === 429) { await new Promise((ok) => setTimeout(ok, backoffMs)); r = await once(); } return r; } catch { return { status: 0, type: '', buf: Buffer.alloc(0) }; }
}

/** live-session.mjs (diff) through the sibling chain — null when absent; the browser paths need it, a plain run does not. */
export async function loadLiveSession() {
  try { return await import(pathToFileURL(siblingScript('diff', 'live-session.mjs', { from: import.meta.url })).href); } catch { return null; }
}
/** The browser paths (--technique headed-chrome, --resize): Playwright via the runtime chain, one launch, one context per origin. */
function browserPaths(live, opts) {
  let browser = null; let opening = null; let unavailable = live ? null : 'live-session.mjs (diff) not found — run from the plugin checkout'; const pages = new Map(); // promises: concurrent URLs share one launch and one page per origin
  const { launchTier, resolveStartTier, newLiveContext, sessionContextOptions, gotoLive, defaultWaitUntil } = live || {};
  const tier = live ? resolveStartTier(opts.headed) : 1;
  const open = () => { opening = opening || launch(); return opening; };
  async function launch() {
    if (browser || unavailable) return browser;
    let pw = null;
    if (process.env.STARDUST_PW_ROOT) { try { pw = await import(pathToFileURL(createRequire(join(process.env.STARDUST_PW_ROOT, 'package.json')).resolve('playwright')).href); } catch { pw = null; } } // test hook: the eval runner's node_modules
    if (!pw) { try { pw = await resolveDep('playwright', { from: import.meta.url }); } catch { unavailable = `playwright not found — ${PREFLIGHT_HINT}`; return null; } }
    if (pw.default && pw.default.chromium) pw = pw.default;
    try { browser = await launchTier(pw.chromium, tier); }
    catch (e) { unavailable = e.code === 124 ? 'no browser slot (exit-124 class, no verdict)' : `browser launch failed (${String(e.message).split('\n')[0].slice(0, 160)})`; return null; }
    return browser;
  }
  function pageFor(origin) { // the home document is opened once per origin (gotoLive: paced, challenge-classified): the asset fetch inherits its cookies, fingerprint and Referer
    if (!pages.has(origin)) pages.set(origin, (async () => {
      const url = `${origin}/`;
      const ctx = await newLiveContext(browser, { ...sessionContextOptions(url, opts) }); const page = await ctx.newPage();
      if (origin !== 'about:blank') await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), timeoutMs: TIMEOUT_MS, settleMs: 0, httpError: 'measure', tier, solveWaitMs: opts.solveWaitMs });
      return page;
    })());
    return pages.get(origin);
  }
  return {
    reason: () => unavailable,
    async fetchInPage(u) {
      if (!(await open())) return null;
      const page = await pageFor(new URL(u).origin);
      const r = await page.evaluate(async (url) => { const res = await fetch(url, { credentials: 'include' }); const b = new Uint8Array(await res.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return { status: res.status, type: res.headers.get('content-type') || '', b64: btoa(s) }; }, u);
      return { status: r.status, type: r.type.split(';')[0].trim(), buf: Buffer.from(r.b64, 'base64') };
    },
    async resize(buf, type) { // canvas re-encode: longest edge ≤ RESIZE_MAX, JPEG — the caller keeps it only when smaller
      if (!(await open())) return null;
      const page = await pageFor('about:blank');
      const r = await page.evaluate(async ({ b64, mime, max }) => { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([arr], { type: mime })); const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.82).split(',')[1]; }, { b64: buf.toString('base64'), mime: type, max: RESIZE_MAX });
      return Buffer.from(r, 'base64');
    },
    async close() { if (browser) await browser.close(); },
  };
}

async function main() {
  const argv = process.argv;
  const arg = (name, fb) => { const i = argv.indexOf(`--${name}`); if (i === -1) return fb; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`rehost-media: --${name} needs a value`); process.exit(2); } return v; };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '')); process.exit(0); }
  const ORG = arg('org', null); const REPO = arg('repo', null); const SCOPE = arg('scope', null); const CONTENT = arg('content', null);
  const DRY = argv.includes('--dry'); const JSON_OUT = argv.includes('--json'); const CONC = Math.max(1, Number(arg('concurrency', '2')) || 2);
  const LEDGER = arg('ledger', join('stardust', 'da-media.json')); const CAPTURED = arg('captured', join('stardust', 'current', 'assets', 'media'));
  const TECHNIQUE = arg('technique', null); const RESIZE = argv.includes('--resize');
  const live = await loadLiveSession(); // admitted-session flags parse before any fetch (live-session § Admitted-session reuse)
  const opts = { headed: 0, solveWaitMs: 0, storageState: arg('storage-state', null), freshState: argv.includes('--fresh-state') };
  if (arg('solve-wait', null) !== null) { if (!live) { console.error('rehost-media: --solve-wait needs diff/scripts/live-session.mjs alongside (plugin layout)'); process.exit(2); } try { opts.solveWaitMs = live.parseSolveWaitFlag(arg('solve-wait')); } catch (e) { console.error(`rehost-media: ${e.message}`); process.exit(2); } opts.headed = 3; }
  const ONLY = arg('only', null) ? new Set(arg('only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const ONLY_KEY = ONLY ? [...ONLY].sort().join(',') : null;
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const state = readJson(arg('state', join('stardust', 'state.json'))) || {};
  const POLICY = arg('policy', state.media && state.media.policy) || 'rehost-blocked';
  if (!ORG || !REPO || !SCOPE || !CONTENT) { console.error('rehost-media: need --org --repo --scope --content'); process.exit(2); }
  if (!['rehost-blocked', 'rehost-all', 'keep'].includes(POLICY)) { console.error(`rehost-media: --policy must be rehost-blocked | rehost-all | keep (got ${POLICY})`); process.exit(2); }
  if (TECHNIQUE && TECHNIQUE !== 'headed-chrome') { console.error(`rehost-media: --technique headed-chrome is the only technique (got ${TECHNIQUE})`); process.exit(2); }
  if (ONLY && [...ONLY].some((t) => !REASONS.includes(t))) { console.error(`rehost-media: --only takes ${REASONS.join(' | ')} (got ${[...ONLY].join(',')})`); process.exit(2); }
  const from = arg('from', null) ? readJson(arg('from')) : null;
  const fromClass = new Map((from && from.results || []).map((r) => [r.url, r.decision]));
  const files = walkHtml(CONTENT).map((f) => ({ file: f, html: readFileSync(f, 'utf8') }));
  const urls = [...new Set(files.flatMap((f) => collectAuthored(f.html)))].filter((u) => !from || fromClass.has(u));
  const ledger = readJson(LEDGER) || {};
  const pw = browserPaths(live, opts);
  let token = null;
  const needToken = () => { if (token || DRY) return token; const t = resolveToken(arg('token-env', 'DA_TOKEN')); if (!t) { console.error(`rehost-media: ${arg('token-env', 'DA_TOKEN')} not found (shell, ./.env, ~/.claude/.env, ~/.env) — nothing was PUT`); process.exit(2); } token = t.value; return token; };
  const acted = ONLY ? (reason) => ONLY.has(reason) : () => true;
  const keptRow = (r, img, note) => ({ status: 'kept', http: r.status, type: img.type, bytes: r.buf.length, policy: POLICY, ...(ONLY_KEY ? { only: ONLY_KEY } : {}), ...(note ? { note } : {}), at: new Date().toISOString() });
  /** a ledger row is final unless the run carries what could change it (policy / --only for kept, --technique for blocked, --resize for oversize, --from now `rehost`) */
  const isFinal = (prev) => prev && (prev.status === 'rehosted' || ['dead', 'not-image', 'signed'].includes(prev.status)
    || (prev.status === 'blocked' && !TECHNIQUE) || (prev.status === 'oversize' && !RESIZE)
    || (prev.status === 'kept' && prev.policy === POLICY && (prev.only || null) === ONLY_KEY));
  /** classify + (maybe) rehost one URL → the ledger row */
  async function handle(u) {
    const prev = ledger[u];
    if (isFinal(prev) && !(prev.status === 'kept' && fromClass.get(u) === 'rehost')) return { ...prev, cached: true };
    const at = new Date().toISOString();
    if (isSigned(u)) return { status: 'signed', at, note: 'signed/expiring URL — a capture-state row (extract provenance), not fetched at deploy time' };
    const captured = join(CAPTURED, basename(u.split(/[?#]/)[0]));
    let src = 'plain'; let r;
    if (existsSync(captured)) { r = { status: 200, type: '', buf: readFileSync(captured) }; src = 'captured'; }
    else {
      r = await getWithBackoff(u, PLAIN_UA);
      if (r.status === 401 || r.status === 403) {
        if (TECHNIQUE) { // F1: the recorded technique says UA alone is not enough — go straight to the in-page fetch
          const rr = await pw.fetchInPage(u).catch((e) => ({ status: 0, type: '', buf: Buffer.alloc(0), error: `${e.name || 'Error'}: ${String(e.message).split('\n')[0].slice(0, 160)}` }));
          if (!rr) return { status: 'blocked', http: r.status, at, technique: TECHNIQUE, note: `${pw.reason()} — stays blocked` };
          if (rr.status < 200 || rr.status >= 300) return { status: 'blocked', http: r.status, at, technique: TECHNIQUE, note: `in-page fetch ${rr.status}${rr.error ? ` (${rr.error})` : ''} — stays blocked` };
          r = rr; src = 'in-page';
        } else { r = await getWithBackoff(u, BROWSER_UA); src = 'browser'; }
      }
    }
    if (r.status === 401 || r.status === 403) return { status: 'blocked', http: r.status, at, ...(TECHNIQUE ? { technique: TECHNIQUE } : {}) };
    if (r.status === 404 || r.status === 410) return { status: 'dead', http: r.status, at };
    if (r.status < 200 || r.status >= 300) return { status: 'blocked', http: r.status, at, note: r.status === 0 ? 'network/timeout — re-run' : `HTTP ${r.status}` };
    let img = sniffImage(r.buf, r.type);
    if (!img || (r.type && !/^image\//i.test(r.type) && src !== 'captured')) return { status: 'not-image', http: r.status, type: r.type || null, at };
    // reasons BEFORE the policy gate: what the ingester cannot ingest is acted on under every policy
    const large = r.buf.length > ONE_MB && img.ext !== 'svg';
    const reasons = [...(src === 'browser' || src === 'in-page' ? ['blocked'] : []), ...(large ? ['oversize'] : []), ...(fromClass.get(u) === 'rehost' ? ['rehost'] : []), ...(POLICY === 'rehost-all' ? ['all'] : [])];
    if (!reasons.length) return keptRow(r, img);
    if (!reasons.some(acted)) return keptRow(r, img, `--only excludes ${reasons.join(',')}`);
    let via = null;
    if (large) { // pre-shrink: the CDN transform, else --resize (canvas), else `oversize` — never an unshrunk > 1 MB PUT
      const tf = TRANSFORM_URL.find(([re]) => re.test(u));
      if (tf) { const rr = await getWithBackoff(tf[1](u), src === 'browser' ? BROWSER_UA : PLAIN_UA); const im2 = rr.status === 200 ? sniffImage(rr.buf, rr.type) : null; if (im2 && rr.buf.length < r.buf.length) { r = rr; img = im2; via = 'cdn-transform'; } }
      if (r.buf.length > ONE_MB && RESIZE) { const small = await pw.resize(r.buf, img.type).catch(() => null); if (small && small.length < r.buf.length) { r = { ...r, buf: small }; img = { type: 'image/jpeg', ext: 'jpg' }; via = 'resize'; } }
      if (r.buf.length > ONE_MB) return { status: 'oversize', http: r.status, bytes: r.buf.length, type: img.type, source: src, at, note: `> 1 MB after ${tf ? 'the CDN transform' : `no recognised CDN transform (${TRANSFORM_HINTS.map((h) => h[1].replace(/^.*\(|\)$/g, '')).join(', ')})`}${RESIZE ? (pw.reason() ? `; --resize: ${pw.reason()}` : '; --resize did not shrink it') : ' — re-run with --resize'} — pre-shrink the source` };
    }
    const file = mediaStem(u, img.ext); const dim = dimensions(r.buf, img.type);
    const row = { sha1: sha1(r.buf), bytes: r.buf.length, type: img.type, ...dim, source: src, reasons, ...(via ? { via } : {}), ...(TECHNIQUE && src === 'in-page' ? { technique: TECHNIQUE } : {}), at };
    if (DRY) return { status: 'rehosted', dry: true, da: `${DA_SRC}/${ORG}/${REPO}/media/${SCOPE}/${file}`, url: `https://content.da.live/${ORG}/${REPO}/media/${SCOPE}/${file}`, ...row };
    const put = await putDaMedia({ org: ORG, repo: REPO, scope: SCOPE, file, buf: r.buf, type: img.type, token: needToken() });
    if (put.status >= 400) return { status: 'blocked', http: put.status, at, note: `DA PUT ${put.status}` };
    return { status: 'rehosted', da: put.da, url: put.url, ...row };
  }
  const rows = new Map(); let i = 0;
  // ledger checkpoint after EVERY URL (progress.mjs pattern: tmp + rename) — a killed run keeps its finished rows and the
  // re-run makes 0 source hits for them (defect: the ledger was written once, at run end)
  const checkpoint = () => {
    if (DRY) return;
    for (const [u, row] of rows) { const { cached, ...rest } = row; ledger[u] = rest; }
    mkdirSync(dirname(LEDGER), { recursive: true }); writeFileSync(`${LEDGER}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`); renameSync(`${LEDGER}.tmp`, LEDGER);
  };
  try { await Promise.all(Array.from({ length: Math.min(CONC, urls.length) }, async () => { while (i < urls.length) { const u = urls[i++]; rows.set(u, await handle(u)); checkpoint(); } })); } finally { await pw.close(); }
  // rewrite every occurrence (plain and &amp; form) of a rehosted src, merge + write the ledger
  let rewritten = 0;
  if (!DRY) {
    for (const f of files) {
      let html = f.html;
      for (const [u, row] of rows) if (row.status === 'rehosted' && row.url) { html = replaceUrl(replaceUrl(html, u, row.url), u.replace(/&/g, '&amp;'), row.url); }
      if (html !== f.html) { writeFileSync(f.file, html); rewritten += 1; }
    }
    checkpoint();
  }
  const counts = {}; for (const row of rows.values()) counts[row.status] = (counts[row.status] || 0) + 1;
  const failing = [...rows.values()].filter((r) => ['blocked', 'dead', 'not-image'].includes(r.status)).length;
  if (JSON_OUT) console.log(JSON.stringify({ policy: POLICY, only: ONLY_KEY, technique: TECHNIQUE, files: files.length, urls: urls.length, counts, rewritten, dry: DRY, ledger: LEDGER, rows: Object.fromEntries(rows) }, null, 2));
  else {
    console.log(`rehost-media ${CONTENT} → ${ORG}/${REPO}/media/${SCOPE} (policy ${POLICY}${ONLY_KEY ? `, --only ${ONLY_KEY}` : ''}${TECHNIQUE ? `, ${TECHNIQUE}` : ''}${DRY ? ', DRY' : ''})`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(10)} ${v}${k === 'rehosted' || k === 'kept' ? '' : `  ${[...rows].filter(([, r]) => r.status === k).slice(0, 3).map(([u]) => u.slice(0, 60)).join(' · ')}`}`);
    if (counts.oversize) console.log(`  oversize rows are warned, not rehosted — ${[...rows.values()].find((r) => r.status === 'oversize').note}`);
    console.log(`${rewritten} file(s) rewritten · ledger ${LEDGER}${failing ? ` · ${failing} row(s) blocked|dead|not-image → media-reconcile stays a gate fail` : ''}`);
  }
  process.exit(failing ? 1 : 0);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { if (e instanceof HaltError) { console.error(`rehost-media: HALT — ${e.remedy}`); process.exit(3); } console.error(`rehost-media: ${e.message}`); process.exit(2); });
