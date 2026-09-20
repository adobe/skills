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
 * copy exists under --captured) and one DA PUT; the ledger is `stardust/da-media.json`
 * `{ [src]: { da, url, sha1, bytes, type, width, height, status, at } }`, re-read and merged:
 *   rehosted   bytes PUT to admin.da.live/source/<org>/<repo>/media/<scope>/<file>; every
 *              occurrence (plain and &amp; form) rewritten to the content.da.live URL
 *   kept       plain-UA 200 image under policy rehost-blocked | keep — the ingester fetches it
 *   blocked    401/403 to the plain UA AND the browser UA (+Referer) — stays a media-reconcile
 *              gate fail; `--technique headed-chrome` is the recorded in-page path (see below)
 *   dead       definitive 404/410 — recorded, the <img> is left to media-reconcile --apply (omit)
 *   not-image  200 whose content-type or magic bytes are not an image (an HTML fallback, #118)
 *   signed     `token= | expires= | signature= | X-Amz-*` query — a capture-state row (extract
 *              provenance), never fetched at deploy time
 *   oversize   raster > 1 MB with no recognised CDN transform (Contentful / Cloudinary / Scene7 /
 *              Akamai IM are fetched pre-shrunk and rehosted) — warned, not rehosted
 * A changed asset is uploaded under a NEW `-<sha8>` stem: the pipeline media cache keys by
 * source URL and never refreshes a same-path re-upload, so `?rev=` is never needed.
 *
 * Policy (`stardust/reference/decisions.md` row `media`): --policy, else state.json
 * `media.policy`, else `rehost-blocked`. `rehost-all` rehosts every 2xx image; `keep`
 * still rehosts the blocked-to-plain-UA class (a 403'd hotlink is never shippable).
 *
 * Usage:
 *   node skills/deploy/scripts/rehost-media.mjs --org <org> --repo <repo> --scope <site> --content <dir>
 *        [--from <media-reconcile.json>] [--policy rehost-blocked|rehost-all|keep] [--state <state.json>]
 *        [--ledger <file>] [--captured <dir>] [--technique headed-chrome] [--concurrency 2]
 *        [--only <class,…>] [--token-env <NAME>] [--dry] [--json]
 *   --from restricts the pass to the URLs media-reconcile classed `rehost` (plus every other
 *   external under rehost-all); --only limits the acted classes; --dry fetches, classifies and
 *   prints, PUTs nothing and rewrites nothing. --technique headed-chrome records the technique
 *   in the ledger row; the in-page fetch itself is a follow-up — until it lands the row stays
 *   `blocked` (hands-off never downgrades it to kept).
 * Exit: 0 clean · 1 blocked | dead | not-image rows remain · 2 usage · 3 DA 401 on a media PUT
 *       (HaltError — nothing else is retried, B13).
 * Test hook: DEPLOY_BATCH_DA_SRC overrides the DA Source host (mock-da.mjs).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveToken } from './lib.mjs';
import { HaltError } from './deploy-batch.mjs';
import { BROWSER_UA, collectPosters, hostOf, isDaHosted, replaceUrl, walkHtml, TRANSFORM_HINTS } from '../../rollout/scripts/media-reconcile.mjs';

const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';
const PLAIN_UA = 'stardust-rehost-media';
const ONE_MB = 1024 * 1024;
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

async function main() {
  const argv = process.argv;
  const arg = (name, fb) => { const i = argv.indexOf(`--${name}`); if (i === -1) return fb; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`rehost-media: --${name} needs a value`); process.exit(2); } return v; };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '')); process.exit(0); }
  const ORG = arg('org', null); const REPO = arg('repo', null); const SCOPE = arg('scope', null); const CONTENT = arg('content', null);
  const DRY = argv.includes('--dry'); const JSON_OUT = argv.includes('--json'); const CONC = Math.max(1, Number(arg('concurrency', '2')) || 2);
  const LEDGER = arg('ledger', join('stardust', 'da-media.json')); const CAPTURED = arg('captured', join('stardust', 'current', 'assets', 'media'));
  const TECHNIQUE = arg('technique', null); const ONLY = arg('only', null) ? new Set(arg('only').split(',')) : null;
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const state = readJson(arg('state', join('stardust', 'state.json'))) || {};
  const POLICY = arg('policy', state.media && state.media.policy) || 'rehost-blocked';
  if (!ORG || !REPO || !SCOPE || !CONTENT) { console.error('rehost-media: need --org --repo --scope --content'); process.exit(2); }
  if (!['rehost-blocked', 'rehost-all', 'keep'].includes(POLICY)) { console.error(`rehost-media: --policy must be rehost-blocked | rehost-all | keep (got ${POLICY})`); process.exit(2); }
  if (TECHNIQUE && TECHNIQUE !== 'headed-chrome') { console.error(`rehost-media: --technique headed-chrome is the only technique (got ${TECHNIQUE})`); process.exit(2); }
  const from = arg('from', null) ? readJson(arg('from')) : null;
  const fromClass = new Map((from && from.results || []).map((r) => [r.url, r.decision]));
  const files = walkHtml(CONTENT).map((f) => ({ file: f, html: readFileSync(f, 'utf8') }));
  const urls = [...new Set(files.flatMap((f) => collectAuthored(f.html)))].filter((u) => !from || fromClass.has(u));
  const ledger = readJson(LEDGER) || {};
  let token = null;
  const needToken = () => { if (token || DRY) return token; const t = resolveToken(arg('token-env', 'DA_TOKEN')); if (!t) { console.error(`rehost-media: ${arg('token-env', 'DA_TOKEN')} not found (shell, ./.env, ~/.claude/.env, ~/.env) — nothing was PUT`); process.exit(2); } token = t.value; return token; };

  async function get(u, ua) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    try {
      let r = await fetch(u, { signal: ac.signal, headers: { 'user-agent': ua, accept: 'image/*,*/*;q=0.8', referer: `${new URL(u).origin}/` } });
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, Number(process.env.REHOST_MEDIA_BACKOFF_MS) || 60000)); r = await fetch(u, { signal: ac.signal, headers: { 'user-agent': ua, referer: `${new URL(u).origin}/` } }); }
      return { status: r.status, type: (r.headers.get('content-type') || '').split(';')[0].trim(), buf: Buffer.from(await r.arrayBuffer()) };
    } catch { return { status: 0, type: '', buf: Buffer.alloc(0) }; } finally { clearTimeout(t); }
  }
  const acted = ONLY ? (c) => ONLY.has(c) : () => true;
  /** classify + (maybe) rehost one URL → the ledger row */
  async function handle(u) {
    const prev = ledger[u];
    if (prev && (prev.status === 'rehosted' || (prev.status === 'blocked' && !TECHNIQUE) || ['dead', 'not-image', 'signed', 'kept', 'oversize'].includes(prev.status))) return { ...prev, cached: true };
    const at = new Date().toISOString();
    if (isSigned(u)) return { status: 'signed', at, note: 'signed/expiring URL — a capture-state row (extract provenance), not fetched at deploy time' };
    const captured = join(CAPTURED, basename(u.split(/[?#]/)[0]));
    let src = 'plain'; let r;
    if (existsSync(captured)) { r = { status: 200, type: '', buf: readFileSync(captured) }; src = 'captured'; }
    else {
      r = await get(u, PLAIN_UA);
      if (r.status === 401 || r.status === 403) { r = await get(u, BROWSER_UA); src = 'browser'; }
    }
    if (r.status === 401 || r.status === 403) return { status: 'blocked', http: r.status, at, ...(TECHNIQUE ? { technique: TECHNIQUE, note: 'in-page fetch follow-up — stays blocked' } : {}) };
    if (r.status === 404 || r.status === 410) return { status: 'dead', http: r.status, at };
    if (r.status < 200 || r.status >= 300) return { status: 'blocked', http: r.status, at, note: r.status === 0 ? 'network/timeout — re-run' : `HTTP ${r.status}` };
    let img = sniffImage(r.buf, r.type);
    if (!img || (r.type && !/^image\//i.test(r.type) && src !== 'captured')) return { status: 'not-image', http: r.status, type: r.type || null, at };
    const wanted = POLICY === 'rehost-all' || fromClass.get(u) === 'rehost' || src === 'browser';
    if (!wanted) return { status: 'kept', http: r.status, type: img.type, bytes: r.buf.length, at };
    if (r.buf.length > ONE_MB && img.ext !== 'svg') {
      const tf = TRANSFORM_URL.find(([re]) => re.test(u));
      if (!tf) return { status: 'oversize', bytes: r.buf.length, type: img.type, at, note: `> 1 MB and no recognised CDN transform (${TRANSFORM_HINTS.map((h) => h[1].replace(/^.*\(|\)$/g, '')).join(', ')}) — pre-shrink the source` };
      const rr = await get(tf[1](u), src === 'browser' ? BROWSER_UA : PLAIN_UA); const im2 = rr.status === 200 ? sniffImage(rr.buf, rr.type) : null;
      if (im2 && rr.buf.length < r.buf.length) { r = rr; img = im2; }
    }
    if (!acted('rehost')) return { status: 'kept', http: r.status, type: img.type, bytes: r.buf.length, at, note: '--only excludes rehost' };
    const file = mediaStem(u, img.ext); const dim = dimensions(r.buf, img.type);
    if (DRY) return { status: 'rehosted', dry: true, da: `${DA_SRC}/${ORG}/${REPO}/media/${SCOPE}/${file}`, url: `https://content.da.live/${ORG}/${REPO}/media/${SCOPE}/${file}`, sha1: sha1(r.buf), bytes: r.buf.length, type: img.type, ...dim, at };
    const put = await putDaMedia({ org: ORG, repo: REPO, scope: SCOPE, file, buf: r.buf, type: img.type, token: needToken() });
    if (put.status >= 400) return { status: 'blocked', http: put.status, at, note: `DA PUT ${put.status}` };
    return { status: 'rehosted', da: put.da, url: put.url, sha1: sha1(r.buf), bytes: r.buf.length, type: img.type, ...dim, source: src, at };
  }
  const rows = new Map(); let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, urls.length) }, async () => { while (i < urls.length) { const u = urls[i++]; rows.set(u, await handle(u)); } }));
  // rewrite every occurrence (plain and &amp; form) of a rehosted src, merge + write the ledger
  let rewritten = 0;
  if (!DRY) {
    for (const f of files) {
      let html = f.html;
      for (const [u, row] of rows) if (row.status === 'rehosted' && row.url) { html = replaceUrl(replaceUrl(html, u, row.url), u.replace(/&/g, '&amp;'), row.url); }
      if (html !== f.html) { writeFileSync(f.file, html); rewritten += 1; }
    }
    for (const [u, row] of rows) { const { cached, ...rest } = row; ledger[u] = rest; }
    mkdirSync(dirname(LEDGER), { recursive: true }); writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  }
  const counts = {}; for (const row of rows.values()) counts[row.status] = (counts[row.status] || 0) + 1;
  const failing = [...rows.values()].filter((r) => ['blocked', 'dead', 'not-image'].includes(r.status)).length;
  if (JSON_OUT) console.log(JSON.stringify({ policy: POLICY, files: files.length, urls: urls.length, counts, rewritten, dry: DRY, ledger: LEDGER, rows: Object.fromEntries(rows) }, null, 2));
  else {
    console.log(`rehost-media ${CONTENT} → ${ORG}/${REPO}/media/${SCOPE} (policy ${POLICY}${DRY ? ', DRY' : ''})`);
    for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(10)} ${v}${k === 'rehosted' || k === 'kept' ? '' : `  ${[...rows].filter(([, r]) => r.status === k).slice(0, 3).map(([u]) => u.slice(0, 60)).join(' · ')}`}`);
    console.log(`${rewritten} file(s) rewritten · ledger ${LEDGER}${failing ? ` · ${failing} row(s) blocked|dead|not-image → media-reconcile stays a gate fail` : ''}`);
  }
  process.exit(failing ? 1 : 0);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { if (e instanceof HaltError) { console.error(`rehost-media: HALT — ${e.remedy}`); process.exit(3); } console.error(`rehost-media: ${e.message}`); process.exit(2); });
