#!/usr/bin/env node
/**
 * deploy/rasterise-svg.mjs — turn a 409-certain SVG into a PNG on DA media (the one shippable path).
 *
 * An authored SVG over 40,000 raw bytes, or one embedding raster data (`<image`, `data:image`),
 * fails the preview of EVERY page that references it with `409 error from content-bus` and no
 * per-asset error (encode-contract.md § Images #99). media-reconcile.mjs classes them pre-PUT
 * (svg-oversize | svg-raster | svg-invalid); this script resolves the first two:
 *   1. GET the SVG verbatim (browser UA; a file path is read) and validate it — an HTML body at
 *      a `.svg` URL (a wrong DAM path answering 200) exits 1: never rasterise a fallback page;
 *   2. PNG bytes from, in order: --from-png <file> (pre-rendered, reviewed) · --extract-raster
 *      (the embedded base64 PNG/JPEG, lossless — preferred for a wrapped raster) · a Playwright
 *      render of the intrinsic size × --scale (2, at most 4, longest edge ≤ --max 2000 px);
 *   3. PUT to admin.da.live/source/<org>/<repo>/media/<scope>/<stem>-<sha8>.png (scope `svg`),
 *      merge --override-map `{ [svgUrl]: { png, bytes, w, h, at } }` (the reviewable artefact),
 *      and with --content rewrite every reference in the tree (boundary-anchored).
 * Playwright resolves through the runtime chain (stardust/node_modules); when it is absent
 * and neither --from-png nor --extract-raster applies, the script prints the preflight line
 * and exits 4 — the SVG stays a media-reconcile gate fail, nothing is guessed.
 *
 * Usage:
 *   node skills/deploy/scripts/rasterise-svg.mjs --svg <url|file> --org <org> --repo <repo>
 *        [--scope svg] [--from-png <file>] [--extract-raster] [--scale 2] [--max 2000]
 *        [--override-map <json>] [--content <dir>] [--out <png>] [--token-env DA_TOKEN] [--dry]
 *   --dry renders (or extracts) and writes --out / the map entry with `dry: true`, PUTs nothing.
 * Exit: 0 PNG on DA and map merged · 1 SVG unreachable / not an SVG / render failed · 2 usage
 *       · 3 DA 401 on the PUT (HaltError, B13 — never a retry) · 4 playwright unavailable.
 * Test hook: DEPLOY_BATCH_DA_SRC overrides the DA Source host (mock-da.mjs).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HaltError } from './deploy-batch.mjs';
import { resolveToken } from './lib.mjs';
import { mediaStem, putDaMedia, dimensions } from './rehost-media.mjs';
import { BROWSER_UA, svgClass, walkHtml, replaceUrl } from '../../rollout/scripts/media-reconcile.mjs';
import { resolveDep, PREFLIGHT_HINT } from '../../stardust/scripts/lib/resolve.mjs';

const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';

/** The first embedded raster (`data:image/png|jpeg;base64,…`) → { buf, ext } or null. */
export function extractRaster(svg) {
  const m = svg.match(/data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)/i);
  return m ? { buf: Buffer.from(m[2].replace(/\s+/g, ''), 'base64'), ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' } : null;
}
/** Intrinsic size from width/height attributes, else the viewBox; null when neither parses. */
export function intrinsicSize(svg) {
  const open = (svg.match(/<svg\b[^>]*>/i) || [''])[0];
  const num = (n) => { const m = open.match(new RegExp(`\\s${n}="([\\d.]+)(px)?"`, 'i')); return m ? Number(m[1]) : null; };
  let w = num('width'); let h = num('height');
  if (!w || !h) { const vb = open.match(/viewBox="[\s,]*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i); if (vb) { w = Number(vb[1]); h = Number(vb[2]); } }
  return w && h ? { w, h } : null;
}
export const renderScale = (size, scale, max) => Math.max(1, Math.min(4, scale, max / Math.max(size.w, size.h)));

async function render(svg, { scale, max }) {
  let pw = null;
  if (process.env.STARDUST_PW_ROOT) { try { pw = await import(pathToFileURL(createRequire(join(process.env.STARDUST_PW_ROOT, 'package.json')).resolve('playwright')).href); } catch { pw = null; } } // test hook: the eval runner's node_modules
  if (!pw) { try { pw = await resolveDep('playwright', { from: import.meta.url }); } catch { console.error(`rasterise-svg: playwright not found — ${PREFLIGHT_HINT}`); process.exit(4); } }
  if (pw.default && pw.default.chromium) pw = pw.default;
  const size = intrinsicSize(svg) || { w: 1200, h: 800 };
  const k = renderScale(size, scale, max);
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(size.w), height: Math.ceil(size.h) }, deviceScaleFactor: k });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const el = await page.$('svg'); if (!el) throw new Error('no <svg> element rendered');
    await el.evaluate((e, s) => { e.setAttribute('width', s.w); e.setAttribute('height', s.h); }, size);
    const buf = await el.screenshot({ type: 'png', omitBackground: true });
    return { buf, w: Math.round(size.w * k), h: Math.round(size.h * k) };
  } finally { await browser.close(); }
}

async function main() {
  const argv = process.argv;
  const arg = (name, fb) => { const i = argv.indexOf(`--${name}`); if (i === -1) return fb; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`rasterise-svg: --${name} needs a value`); process.exit(2); } return v; };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '')); process.exit(0); }
  const SVG = arg('svg', null); const ORG = arg('org', null); const REPO = arg('repo', null); const SCOPE = arg('scope', 'svg');
  const DRY = argv.includes('--dry'); const EXTRACT = argv.includes('--extract-raster');
  const MAP = arg('override-map', join('stardust', 'rollout', 'media-overrides.json')); const CONTENT = arg('content', null); const OUT = arg('out', null);
  const scale = Number(arg('scale', '2')) || 2; const max = Number(arg('max', '2000')) || 2000;
  if (!SVG || !ORG || !REPO) { console.error('rasterise-svg: need --svg <url|file> --org <org> --repo <repo>'); process.exit(2); }
  // 1. the SVG bytes, verbatim (#118: the recorded string, never a reconstructed URL)
  let svgBuf;
  if (/^https?:\/\//i.test(SVG)) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    try { const r = await fetch(SVG, { signal: ac.signal, headers: { 'user-agent': BROWSER_UA, accept: 'image/svg+xml,*/*' } }); if (r.status !== 200) { console.error(`rasterise-svg: GET ${SVG} → ${r.status}`); process.exit(1); } svgBuf = Buffer.from(await r.arrayBuffer()); }
    catch (e) { console.error(`rasterise-svg: GET ${SVG} failed (${e.name})`); process.exit(1); } finally { clearTimeout(t); }
  } else if (existsSync(SVG)) svgBuf = readFileSync(SVG);
  else { console.error(`rasterise-svg: ${SVG} is neither a URL nor a file`); process.exit(2); }
  const cls = svgClass(svgBuf);
  if (cls === 'svg-invalid') { console.error(`rasterise-svg: ${SVG} is not an SVG (an HTML fallback for a wrong path answers 200) — fix the URL, nothing rendered`); process.exit(1); }
  const svg = svgBuf.toString('utf8');
  // 2. PNG bytes: --from-png · --extract-raster · Playwright
  let png; let ext = 'png'; let dim;
  if (arg('from-png', null)) { png = readFileSync(arg('from-png')); dim = dimensions(png, 'image/png'); }
  else if (EXTRACT && extractRaster(svg)) { const x = extractRaster(svg); png = x.buf; ext = x.ext; dim = dimensions(png, ext === 'png' ? 'image/png' : 'image/jpeg'); }
  else { const r = await render(svg, { scale, max }); png = r.buf; dim = { width: r.w, height: r.h }; }
  if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, png); }
  // 3. PUT + map (+ tree rewrite)
  const file = mediaStem(SVG, ext);
  let url = `https://content.da.live/${ORG}/${REPO}/media/${SCOPE}/${file}`;
  if (!DRY) {
    const t = resolveToken(arg('token-env', 'DA_TOKEN'));
    if (!t) { console.error(`rasterise-svg: ${arg('token-env', 'DA_TOKEN')} not found (shell, ./.env, ~/.claude/.env, ~/.env) — nothing was PUT`); process.exit(2); }
    const put = await putDaMedia({ org: ORG, repo: REPO, scope: SCOPE, file, buf: png, type: ext === 'png' ? 'image/png' : 'image/jpeg', token: t.value });
    if (put.status >= 400) { console.error(`rasterise-svg: DA PUT ${put.status} on ${put.da}`); process.exit(1); }
    url = put.url;
  }
  const map = (() => { try { return JSON.parse(readFileSync(MAP, 'utf8')); } catch { return {}; } })();
  map[SVG] = { png: url, bytes: png.length, w: dim.width, h: dim.height, from: cls, via: arg('from-png', null) ? 'from-png' : EXTRACT && extractRaster(svg) ? 'extract-raster' : 'render', at: new Date().toISOString(), ...(DRY ? { dry: true } : {}) };
  mkdirSync(dirname(MAP), { recursive: true }); writeFileSync(MAP, `${JSON.stringify(map, null, 2)}\n`);
  let rewritten = 0;
  if (CONTENT && !DRY) for (const f of walkHtml(CONTENT)) { const h = readFileSync(f, 'utf8'); const n = replaceUrl(h, SVG, url); if (n !== h) { writeFileSync(f, n); rewritten += 1; } }
  console.log(`rasterise-svg ${cls} ${SVG.slice(0, 70)} → ${url} (${png.length} B, ${dim.width}×${dim.height}, ${map[SVG].via}${DRY ? ', DRY' : ''})${CONTENT ? ` · ${rewritten} file(s) rewritten` : ''} · map ${MAP}`);
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { if (e instanceof HaltError) { console.error(`rasterise-svg: HALT — ${e.remedy}`); process.exit(3); } console.error(`rasterise-svg: ${e.message}`); process.exit(1); });
