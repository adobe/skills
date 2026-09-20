#!/usr/bin/env node
/**
 * rollout/media-reconcile.mjs — per-image reconciliation for migrations (Phase C step 2, Gate 2).
 *
 * Imagery is the #1 fidelity risk at scale. For every authored image URL in one
 * document (--file) or a whole content tree (--content), classify origin, RESOLVE it on
 * the network ONCE (browser UA, per-URL cache), apply known repairs and emit a decision:
 *   optimize   — same-origin (Content Bus) asset; safe to run createOptimizedPicture
 *   da-hosted  — content.da.live / admin.da.live media: never fetched (401 to anonymous
 *                GETs is governance, not a missing asset — encode-contract § Images)
 *   keep       — external, resolves 200 and passes the shape checks; reference as-is
 *   rewrite    — repairable break (missing ?-delimiter, wrong host, `maxresdefault` poster
 *                404 → `hqdefault`) → suggested URL
 *   rehost     — 401/403 under the BROWSER UA: a bot wall / referer gate, not a missing
 *                asset — rehost-media.mjs (deploy) rehosts it; never auto-omitted
 *   omit       — a definitive 404/410; drop the <img> (render gracefully), never ship about:error
 *   unresolved — 0 (network/timeout) or 5xx: transient, left untouched, needs a human
 * Pre-PUT shape checks (a 409 at preview names no asset — these do, BEFORE the PUT):
 *   svg-oversize    — raw GET body > 40,000 bytes (the pipeline limit; HEAD content-length is
 *                     the gzipped size, so the SVG is always GET in full)           blocks
 *   svg-raster      — `<image` or `data:image` inside the SVG, any size (#99)      blocks
 *   svg-invalid     — 200 whose body is not `<?xml` / `<svg` (an HTML fallback)    blocks
 *   raster-oversize — raster > 10 MB (ranged GET: magic bytes + total size)        blocks
 *   raster-large    — raster > 1 MB: advisory with the CDN transform hint
 *   doc-images      — one document with > 150 <img> is P2 (advisory); > 200 is P1 (blocks)
 * Non-image media (<video src>, <source src>, poster, <iframe src>, .m3u8/.mpd) is probed
 * with a ranged GET: unplayable (P1, blocks) · needs-credential (401/403, an inventory row).
 *
 * Reference: skills/migrate/reference/media-reconciliation.md, skills/rollout/reference/
 * delivery-gates.md § Gate 2 and skills/deploy/reference/encode-contract.md § Images.
 *
 * Usage:
 *   node skills/rollout/scripts/media-reconcile.mjs (--file <html> | --content <dir>)
 *        [--deploy-host <host>] [--host-rewrite badhost=goodhost] [--token-env <NAME>]
 *        [--cache <file>] [--no-cache] [--concurrency 4] [--max-images <n>] [--allow-large-raster]
 *        [--keep <substring>] [--json] [--apply [--dry] [--rasterise [--extract-raster] --org <o> --repo <r>]
 *        [--override-map <json>]]
 *   --apply rewrites files in place (rewrite → suggested URL, omit → remove the <img>, svg-* →
 *   the PNG from the override map); --dry prints the plan and writes nothing (files or cache).
 *   --rasterise renders every blocking SVG through skills/deploy/scripts/rasterise-svg.mjs
 *   (Playwright, or --extract-raster — plugin layout only, run from the plugin checkout) and
 *   PUTs the PNG to DA media/svg/; the reviewable artefact is --override-map (default
 *   stardust/rollout/media-overrides.json).
 *   --cache (default stardust/rollout/media-probe.json under --content; none under --file) is the
 *   per-URL probe record: a re-run fetches nothing it already knows (5xx rows are re-probed after
 *   1 h; 0 and 401/403 answers are never cached — a token or a rehost changes them).
 *   --max-images <n> moves the P1 cap for this run (printed); --allow-large-raster reads a
 *   raster-oversize row as the advisory for THIS run only — the cache keeps the undowngraded
 *   class, so the next run without the flag blocks again; --keep <s> leaves matching URLs
 *   untouched (`kept`, still a gate fail when the class blocks). --token-env <NAME>: the site token of a LOCKED
 *   --deploy-host (sent only to that host, never printed).
 * Exit: 0 clean · 1 a blocking class remains (omit, rehost, unresolved, unplayable, svg-*,
 *       raster-oversize, doc-images P1) · 2 usage · 3 rasterise halted on a DA 401 (B13).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { siteAuthHeader } from './lib.mjs';

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const DA_HOSTS = new Set(['content.da.live', 'admin.da.live']);
export const isDaHosted = (u) => DA_HOSTS.has(hostOf(u));
/** Recognised CDN resize params — the hint printed with raster-large / oversize (shared with rehost-media). */
export const TRANSFORM_HINTS = [[/ctfassets\.net|contentful/i, '?fm=jpg&w=2000&q=80 (Contentful)'], [/cloudinary\.com/i, '/w_2000,q_auto/ (Cloudinary)'], [/scene7\.com|\/is\/image\//i, '?wid=2000 (Scene7)'], [/akamai|\/im\//i, '?im=Resize,width=2000 (Akamai IM)']];
export const transformHint = (u) => (TRANSFORM_HINTS.find(([re]) => re.test(u)) || [])[1] || 'a CDN resize param or a pre-shrunk source';
export const SVG_MAX = 40_000; const RASTER_MAX = 10 * 1024 * 1024; const RASTER_LARGE = 1024 * 1024; const DOC_P2 = 150; const DOC_P1 = 200;
const BLOCKING = new Set(['omit', 'rehost', 'unresolved', 'unplayable', 'svg-oversize', 'svg-raster', 'svg-invalid', 'raster-oversize']);
const MAGIC = [['89504e47', 'png'], ['ffd8ff', 'jpeg'], ['47494638', 'gif'], ['52494646', 'webp'], ['424d', 'bmp']];
export function hostOf(u) { try { return new URL(u).host; } catch { return null; } }

/* collect image URLs: <img src>, srcset, inline style url(), <style> url() */
export function collect(h) {
  const urls = new Set();
  for (const m of h.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/\bsrcset="([^"]+)"/gi)) m[1].split(',').forEach((part) => { const u = part.trim().split(/\s+/)[0]; if (u) urls.add(u); });
  for (const m of h.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi)) urls.add(m[2]);
  return [...urls].filter((u) => u && !u.startsWith('data:'));
}
/* non-image media: <video src>, <source src>, poster, <iframe src>, .m3u8/.mpd manifests */
export function collectMedia(h) {
  const urls = new Set();
  for (const m of h.matchAll(/<(?:video|source|iframe)\b[^>]*\ssrc="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/<video\b[^>]*\sposter="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/https?:\/\/[^\s"'<>)]+\.(?:m3u8|mpd)(?:\?[^\s"'<>)]*)?/gi)) urls.add(m[0]);
  const images = new Set(collect(h));
  return [...urls].filter((u) => /^https?:/.test(u) && !images.has(u));
}
export const collectPosters = (h) => [...h.matchAll(/<video\b[^>]*\sposter="([^"]+)"/gi)].map((m) => m[1]);
// boundary-anchored replace: only swap the URL where it ends at a real delimiter,
// so a URL that is a prefix of a longer one is never corrupted.
export function replaceUrl(h, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return h.replace(new RegExp(`${esc}(?=["'\\s,)>])`, 'g'), to);
}
// remove an image by URL: the enclosing <picture> if present (no dangling <source>), else the <img>, else a <source>; a poster attribute is stripped.
export function removeImageUrl(h, url) {
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = h.replace(new RegExp(`<picture>(?:(?!</picture>)[\\s\\S])*?${esc}[\\s\\S]*?</picture>`, 'gi'), '');
  out = out.replace(new RegExp(`<img\\b[^>]*\\ssrc="${esc}"[^>]*>`, 'gi'), '');
  out = out.replace(new RegExp(`<source\\b[^>]*${esc}[^>]*>`, 'gi'), '');
  return out.replace(new RegExp(`\\sposter="${esc}"`, 'gi'), '');
}
export function walkHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}
const isSvgUrl = (u) => /\.svg$/i.test((u.split(/[?#]/)[0]) || '');
/** Classify an SVG body (raw bytes). */
export function svgClass(buf) {
  const head = buf.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!/^(<\?xml|<svg|<!--|<!DOCTYPE svg)/i.test(head)) return 'svg-invalid';
  const s = buf.toString('utf8');
  if (/<image\b/i.test(s) || /data:image\//i.test(s)) return 'svg-raster';
  return buf.length > SVG_MAX ? 'svg-oversize' : 'keep';
}

async function main() {
  const argv = process.argv;
  function arg(name, fb) { const i = argv.indexOf(`--${name}`); if (i === -1) return fb; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`media-reconcile: --${name} needs a value`); process.exit(2); } return v; }
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '')); process.exit(0); }
  const FILE = arg('file', null); const CONTENT = arg('content', null);
  const DEPLOY_HOST = arg('deploy-host', null);
  const JSON_OUT = argv.includes('--json'); const APPLY = argv.includes('--apply'); const DRY = argv.includes('--dry');
  const RASTERISE = argv.includes('--rasterise'); const ALLOW_LARGE = argv.includes('--allow-large-raster');
  const CONC = Math.max(1, Number(arg('concurrency', '4')) || 4);
  const MAX_IMAGES = Number(arg('max-images', DOC_P1)) || DOC_P1;
  const KEEP = argv.filter((a, i) => argv[i - 1] === '--keep' && !a.startsWith('--'));
  const CACHE_FILE = argv.includes('--no-cache') ? null : arg('cache', CONTENT ? join('stardust', 'rollout', 'media-probe.json') : null); // --file mode caches only when asked
  const OVERRIDE_MAP = arg('override-map', join('stardust', 'rollout', 'media-overrides.json'));
  const rewrites = argv.filter((a, i) => argv[i - 1] === '--host-rewrite' && a.includes('=')).map((s) => s.split('='));
  if ((!FILE && !CONTENT) || (FILE && CONTENT)) { console.error('media-reconcile: need --file <html> or --content <dir>'); process.exit(2); }
  if (CONTENT && !(existsSync(CONTENT) && statSync(CONTENT).isDirectory())) { console.error(`media-reconcile: --content needs an existing directory (got ${CONTENT})`); process.exit(2); }
  if (RASTERISE && !(arg('org', null) && arg('repo', null))) { console.error('media-reconcile: --rasterise needs --org and --repo (the DA media target)'); process.exit(2); }
  const files = FILE ? [FILE] : walkHtml(CONTENT);
  const AUTH = await siteAuthHeader(arg('token-env', null), 'media-reconcile'); // T12.2: delivery-host probes only
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
  const cache = CACHE_FILE ? readJson(CACHE_FILE) : {};
  let overrides = readJson(OVERRIDE_MAP);
  const HOUR = 3600_000; const now = Date.now();
  const fresh = (c) => c && !((c.status === 0 || c.status >= 500) && now - Date.parse(c.at || 0) > HOUR);
  const cacheable = (st) => st !== 0 && st !== 401 && st !== 403; // auth-dependent answers are re-probed every run (a token or a rehost changes them)

  async function probe(u, { full = false } = {}) { // one network hit; ranged GET for rasters, full GET for SVGs
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    const auth = AUTH && DEPLOY_HOST && hostOf(u) === DEPLOY_HOST ? { authorization: AUTH } : {};
    try {
      const r = await fetch(u, { signal: ac.signal, headers: { 'user-agent': BROWSER_UA, accept: '*/*', ...(full ? {} : { range: 'bytes=0-1023' }), ...auth } });
      const buf = Buffer.from(await r.arrayBuffer());
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      const total = r.status === 206 ? Number((r.headers.get('content-range') || '').split('/')[1]) : Number(r.headers.get('content-length'));
      const bytes = full || !Number.isFinite(total) || r.headers.get('content-encoding') ? buf.length : total;
      const magic = (MAGIC.find(([hex]) => buf.subarray(0, 4).toString('hex').startsWith(hex)) || [])[1] || null;
      return { status: r.status, bytes, type, buf, magic };
    } catch { return { status: 0, bytes: 0, type: null, buf: Buffer.alloc(0), magic: null }; } finally { clearTimeout(t); }
  }
  function repairUrl(u) {
    if (!u.includes('?') && u.includes('&')) return u.replace('&', '?'); // missing query delimiter: …/<id>&wid=… → …/<id>?wid=…
    for (const [bad, good] of rewrites) { if (u.includes(bad)) return u.replace(bad, good); } // host rewrite
    return null;
  }
  const posters = new Set();
  // the cache holds flag-independent facts: raster-oversize is stored as such and downgraded on READ under
  // --allow-large-raster, so the escape lasts one run and never leaks into a later run through the cache
  const view = (c) => (ALLOW_LARGE && c.class === 'raster-oversize' ? { ...c, class: 'raster-large', allowed: true } : c);
  /** image decision for one URL — reads/writes the cache; returns { status, bytes, type, class, suggested, hint } */
  async function decideImage(u) {
    if (fresh(cache[u])) return view({ ...cache[u], cached: true });
    let r = await probe(u, { full: isSvgUrl(u) });
    if (!isSvgUrl(u) && /svg/i.test(r.type || '') && (r.status === 200 || r.status === 206)) r = await probe(u, { full: true });
    let decision = null; let suggested = null; let hint = null;
    if (r.status === 200 || r.status === 206) {
      if (isSvgUrl(u) || /svg/i.test(r.type || '')) decision = svgClass(r.buf);
      else if (r.bytes > RASTER_MAX) { decision = 'raster-oversize'; hint = transformHint(u); }
      else if (r.bytes > RASTER_LARGE) { decision = 'raster-large'; hint = transformHint(u); }
      else decision = 'keep';
    } else {
      if (posters.has(u) && /maxresdefault\.jpg/i.test(u) && r.status === 404) { // poster ladder: maxres → hq
        const hq = u.replace(/maxresdefault\.jpg/i, 'hqdefault.jpg'); const rr = await probe(hq);
        if (rr.status === 200 || rr.status === 206) { decision = 'rewrite'; suggested = hq; }
      }
      const fixed = decision ? null : repairUrl(u);
      if (fixed) { const fr = await probe(fixed, { full: isSvgUrl(fixed) }); if (fr.status === 200 || fr.status === 206) { decision = 'rewrite'; suggested = fixed; } }
      // only a definitive 404/410 is safe to auto-omit; 401/403 under the browser UA is a bot wall (the asset exists) →
      // 'rehost'; 0 (network/timeout) or 5xx is transient → 'unresolved' for a human, never a deletion on a blip.
      if (!decision) decision = (r.status === 401 || r.status === 403) ? 'rehost' : (r.status >= 400 && r.status < 500) ? 'omit' : 'unresolved';
    }
    const row = { status: r.status, bytes: r.bytes, type: r.type, class: decision, suggested, hint, at: new Date(now).toISOString() };
    if (cacheable(r.status)) cache[u] = row;
    return view(row);
  }
  async function pool(items, fn) { const out = new Map(); let i = 0; await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, async () => { while (i < items.length) { const u = items[i++]; out.set(u, await fn(u)); } })); return out; }

  // 1. collect across the tree, 2. probe each unique URL once, 3. per-file decisions + caps
  const docs = files.map((f) => { const html = readFileSync(f, 'utf8'); const ps = collectPosters(html).filter((p) => /^https?:/.test(p)); ps.forEach((p) => posters.add(p)); return { file: f, html, images: [...new Set([...collect(html), ...ps])], media: collectMedia(html).filter((u) => !ps.includes(u)), imgCount: (html.match(/<img\b/gi) || []).length }; }); // posters are images: the ladder + omit apply to them
  const kept = (u) => KEEP.some((k) => u.includes(k));
  const imageUrls = [...new Set(docs.flatMap((d) => d.images))].filter((u) => !isDaHosted(u) && !(DEPLOY_HOST && hostOf(u) === DEPLOY_HOST));
  const mediaUrls = [...new Set(docs.flatMap((d) => d.media))].filter((u) => !isDaHosted(u));
  const decided = await pool(imageUrls, decideImage);
  const probedMedia = await pool(mediaUrls, async (u) => { if (fresh(cache[u])) return { ...cache[u], cached: true }; const r = await probe(u); const row = { status: r.status, bytes: r.bytes, type: r.type, class: (r.status === 200 || r.status === 206) ? 'keep' : (r.status === 401 || r.status === 403) ? 'needs-credential' : 'unplayable', at: new Date(now).toISOString() }; if (cacheable(r.status)) cache[u] = row; return row; });
  const results = []; const perFile = [];
  for (const d of docs) {
    const rows = [];
    for (const u of d.images) {
      const host = hostOf(u);
      if (isDaHosted(u)) rows.push({ url: u, host, status: null, decision: 'da-hosted', suggested: null, kind: 'image' });
      else if (DEPLOY_HOST && host === DEPLOY_HOST) rows.push({ url: u, host, status: null, decision: 'optimize', suggested: null, kind: 'image' });
      else { const c = decided.get(u); rows.push({ url: u, host, status: c.status, bytes: c.bytes, decision: c.class, suggested: c.suggested, hint: c.hint || undefined, allowed: c.allowed || undefined, kept: kept(u) || undefined, kind: 'image' }); }
    }
    for (const u of d.media) { const c = probedMedia.get(u) || { class: 'da-hosted' }; rows.push({ url: u, host: hostOf(u), status: c.status ?? null, decision: c.class, suggested: null, kind: 'media' }); }
    const docSev = d.imgCount > MAX_IMAGES ? 'P1' : d.imgCount > DOC_P2 ? 'P2' : null;
    if (docSev) rows.push({ url: d.file, host: null, status: null, decision: 'doc-images', severity: docSev, count: d.imgCount, kind: 'document', suggested: null });
    perFile.push({ file: d.file, rows, imgCount: d.imgCount, docImages: docSev });
    results.push(...rows.map((r) => ({ ...r, file: d.file })));
  }
  // 4. --apply: rewrite / omit / rasterise (unresolved, rehost and kept rows are left untouched on purpose)
  const svgBlocked = [...new Set(results.filter((r) => /^svg-/.test(r.decision) && !r.kept).map((r) => r.url))];
  if (APPLY && RASTERISE && !DRY) {
    const script = new URL('../../deploy/scripts/rasterise-svg.mjs', import.meta.url).pathname; // plugin layout only: the rasteriser imports rehost-media + this file by that layout
    if (!existsSync(script)) { console.error('media-reconcile: skills/deploy/scripts/rasterise-svg.mjs not found — --rasterise runs from the plugin checkout, not a copied script'); process.exit(2); }
    for (const u of svgBlocked.filter((x) => !overrides[x])) {
      const r = spawnSync(process.execPath, [script, '--svg', u, '--org', arg('org'), '--repo', arg('repo'), '--override-map', OVERRIDE_MAP, ...(argv.includes('--extract-raster') ? ['--extract-raster'] : []), ...(arg('token-env', null) ? ['--token-env', arg('token-env')] : [])], { encoding: 'utf8' });
      if (r.status === 3) { process.stderr.write(r.stderr); process.exit(3); } // DA 401: halt, never a retry (B13)
      if (r.status !== 0) process.stderr.write(r.stderr || r.stdout);
    }
    overrides = readJson(OVERRIDE_MAP);
  }
  const applied = [];
  for (const d of perFile) {
    const orig = readFileSync(d.file, 'utf8'); let html = orig;
    for (const r of d.rows) {
      if (r.kept || r.kind === 'document') continue;
      if (r.decision === 'rewrite' && r.suggested) { html = replaceUrl(html, r.url, r.suggested); applied.push({ file: d.file, url: r.url, to: r.suggested }); }
      else if (r.decision === 'omit') { html = removeImageUrl(html, r.url); applied.push({ file: d.file, url: r.url, to: null }); }
      else if (/^svg-/.test(r.decision) && overrides[r.url] && overrides[r.url].png) { html = replaceUrl(html, r.url, overrides[r.url].png); r.decision = 'rewrite'; r.suggested = overrides[r.url].png; applied.push({ file: d.file, url: r.url, to: r.suggested }); }
    }
    html = html.replace(/<picture>\s*<\/picture>/gi, ''); // sweep any now-empty <picture>
    if (APPLY && !DRY && html !== orig) writeFileSync(d.file, html); // unchanged files are never rewritten (mtime stays)
  }
  for (const r of results) { const p = perFile.find((f) => f.file === r.file); const row = p && p.rows.find((x) => x.url === r.url && x.kind === r.kind); if (row) { r.decision = row.decision; r.suggested = row.suggested; } }
  if (CACHE_FILE && !DRY) { mkdirSync(dirname(CACHE_FILE), { recursive: true }); writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`); }

  const counts = results.reduce((a, r) => { const k = r.decision === 'doc-images' ? `doc-images-${r.severity}` : r.decision; a[k] = (a[k] || 0) + 1; return a; }, {});
  const failing = results.filter((r) => BLOCKING.has(r.decision) || (r.decision === 'doc-images' && r.severity === 'P1'));
  if (JSON_OUT) {
    console.log(JSON.stringify({ files: files.length, deployHost: DEPLOY_HOST, applied: APPLY && !DRY, dry: DRY, counts, results, changes: APPLY ? applied : undefined, cache: CACHE_FILE, overrideMap: OVERRIDE_MAP, maxImages: MAX_IMAGES }, null, 2));
  } else {
    console.log(`media-reconcile ${FILE || `${CONTENT} (${files.length} documents)`}${APPLY ? (DRY ? ' (DRY)' : ' (APPLIED)') : ''}`);
    console.log('='.repeat(60));
    const TAG = { optimize: '✓ optimize', 'da-hosted': '✓ da-host ', keep: '✓ keep    ', rewrite: '→ rewrite ', rehost: '↓ rehost  ', omit: '✗ omit    ', unresolved: '? manual  ', unplayable: '✗ unplay  ', 'needs-credential': '! cred    ', 'svg-oversize': '✗ svg>40K ', 'svg-raster': '✗ svg-rast', 'svg-invalid': '✗ svg-html', 'raster-oversize': '✗ >10MB   ', 'raster-large': '~ >1MB    ', 'doc-images': '# images  ' };
    for (const r of results) if (r.decision !== 'keep' && r.decision !== 'optimize' && r.decision !== 'da-hosted') console.log(`  ${TAG[r.decision] || r.decision} ${r.status ? `[${r.status}] ` : ''}${r.severity ? `${r.severity} ${r.count} <img> ` : ''}${r.url.slice(0, 70)}${r.kept ? ' (kept)' : ''}${r.suggested ? `\n              → ${r.suggested.slice(0, 70)}` : ''}${r.hint ? `\n              hint: ${r.hint}` : ''}`);
    if (MAX_IMAGES !== DOC_P1) console.log(`  doc-images P1 cap moved to ${MAX_IMAGES} for this run (--max-images)`);
    if (ALLOW_LARGE) console.log(`  raster-oversize read as the advisory for this run only (--allow-large-raster; ${results.filter((r) => r.allowed).length} row(s), the cache keeps raster-oversize)`);
    if (svgBlocked.length && !RASTERISE) console.log(`  ${svgBlocked.length} SVG(s) cannot preview — rerun with --apply --rasterise --org <o> --repo <r> (or --extract-raster)`);
    console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}${CACHE_FILE ? ` · cache ${CACHE_FILE}` : ''}`);
  }
  process.exit(failing.length ? 1 : 0);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`media-reconcile: ${e.message}`); process.exit(2); });
