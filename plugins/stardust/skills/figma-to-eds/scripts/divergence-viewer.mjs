#!/usr/bin/env node
// Divergence viewer — stakeholder-facing companion to the divergence
// register (reference/gates.md § 3). Captures ONE page from the live
// site and the reskin, pixel-diffs them, clusters the differences into
// regions, joins each region with an authored attribution (the Figma
// mandate or classification), and emits a self-contained interactive
// HTML viewer: side-by-side screenshots with numbered region overlays,
// hover/click annotation cards, and a class-colored summary.
//
// The tool finds regions mechanically; the ATTRIBUTIONS are authored
// (annotations.json) — regions without an attribution render as
// "unreviewed" so gaps are visible, never hidden.
//
// Usage:
//   node divergence-viewer.mjs --live <url> --new <url> --out <dir>
//     [--width 1440] [--max-height 6000] [--annotations <file>]
//     [--cell 12] [--min-area 900] [--hide <css selector to hide>]
// Output: <dir>/{live.png,new.png,regions.json,viewer.html}
// Env: NODE_MODULES_DIR — node_modules with playwright, pixelmatch, pngjs.
//
// annotations.json — one entry per register row, matched to a region when
// the region's centre falls inside `box` (page px at --width):
//   [ { "box": [x, y, w, h], "class": "mandated", "title": "<delta>",
//       "detail": "<why>", "figma": { "file": "<fileKey>", "node": "12:345",
//       "label": "<kit name>" } } ]
// class: the register vocabulary (gates.md § 3) — mandated, unmandated,
// out-of-kit, conflict, pre-existing. Exit 1 while any region is
// unreviewed or unmandated (the register's pass condition), else 0.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const liveUrl = arg('--live'); const newUrl = arg('--new'); const outDir = arg('--out');
const width = parseInt(arg('--width', '1440'), 10);
const maxHeight = parseInt(arg('--max-height', '6000'), 10);
const cell = parseInt(arg('--cell', '12'), 10);
const minArea = parseInt(arg('--min-area', '900'), 10);
const hideSel = arg('--hide', '.consent-banner');
const annPath = arg('--annotations');
if (!liveUrl || !newUrl || !outDir) { console.error('usage: --live <url> --new <url> --out <dir>'); process.exit(2); }

const req = createRequire(process.env.NODE_MODULES_DIR
  ? join(resolve(process.env.NODE_MODULES_DIR), 'dv-resolver.cjs') : import.meta.url);
const { chromium } = req('playwright');
const pixelmatchMod = req('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;
const { PNG } = req('pngjs');

mkdirSync(outDir, { recursive: true });

// ---- capture ----
const browser = await chromium.launch();
async function capture(url, file) {
  const page = await browser.newPage({ viewport: { width, height: 1400 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  if (hideSel) await page.addStyleTag({ content: `${hideSel}{display:none!important}` });
  await page.waitForTimeout(500);
  const h = Math.min(await page.evaluate(() => document.body.scrollHeight), maxHeight);
  await page.setViewportSize({ width, height: h });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, file) });
  await page.close();
  return h;
}
const hLive = await capture(liveUrl, 'live.png');
const hNew = await capture(newUrl, 'new.png');
await browser.close();

// ---- diff on a common canvas ----
const a = PNG.sync.read(readFileSync(join(outDir, 'live.png')));
const b = PNG.sync.read(readFileSync(join(outDir, 'new.png')));
const W = Math.max(a.width, b.width); const H = Math.max(a.height, b.height);
const pad = (src) => { const p = new PNG({ width: W, height: H }); p.data.fill(255); PNG.bitblt(src, p, 0, 0, src.width, src.height, 0, 0); return p; };
const pa = pad(a); const pb = pad(b);
const diff = new PNG({ width: W, height: H });
const diffPixels = pixelmatch(pa.data, pb.data, diff.data, W, H, { threshold: 0.12 });

// ---- cluster diff pixels into regions (grid + flood fill) ----
const gw = Math.ceil(W / cell); const gh = Math.ceil(H / cell);
const grid = new Uint32Array(gw * gh);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    if (diff.data[i] === 255 && diff.data[i + 1] === 0) grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] += 1;
  }
}
const seen = new Uint8Array(gw * gh);
const regions = [];
for (let gy = 0; gy < gh; gy += 1) {
  for (let gx = 0; gx < gw; gx += 1) {
    const idx = gy * gw + gx;
    if (seen[idx] || grid[idx] < 3) continue;
    // flood fill (8-connected, with a 1-cell bridge to merge near regions)
    let minx = gx; let maxx = gx; let miny = gy; let maxy = gy; let count = 0;
    const stack = [idx]; seen[idx] = 1;
    while (stack.length) {
      const c = stack.pop(); const cy = Math.floor(c / gw); const cx = c % gw;
      count += grid[c];
      if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
      if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = cx + dx; const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (!seen[n] && grid[n] >= 3) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    const box = { x: minx * cell, y: miny * cell, w: (maxx - minx + 1) * cell, h: (maxy - miny + 1) * cell, px: count };
    if (box.w * box.h >= minArea) regions.push(box);
  }
}
// merge overlapping boxes
let merged = true;
while (merged) {
  merged = false;
  for (let i = 0; i < regions.length && !merged; i += 1) {
    for (let j = i + 1; j < regions.length && !merged; j += 1) {
      const r = regions[i]; const s = regions[j];
      if (r.x < s.x + s.w + cell && s.x < r.x + r.w + cell && r.y < s.y + s.h + cell && s.y < r.y + r.h + cell) {
        const nx = Math.min(r.x, s.x); const ny = Math.min(r.y, s.y);
        regions[i] = { x: nx, y: ny, w: Math.max(r.x + r.w, s.x + s.w) - nx, h: Math.max(r.y + r.h, s.y + s.h) - ny, px: r.px + s.px };
        regions.splice(j, 1); merged = true;
      }
    }
  }
}
regions.sort((r, s) => r.y - s.y || r.x - s.x);
regions.forEach((r, i) => { r.id = i + 1; });

// ---- join annotations ----
const CLASSES = { mandated: '#01863a', conflict: '#c56c00', 'out-of-kit': '#832ab9', 'pre-existing': '#737373', unmandated: '#b91c1c', unreviewed: '#b91c1c' };
let annotations = [];
if (annPath && existsSync(annPath)) annotations = JSON.parse(readFileSync(annPath, 'utf8'));
const joined = regions.map((r) => {
  const ann = annotations.find((an) => {
    const cx = r.x + r.w / 2; const cy = r.y + r.h / 2;
    return cx >= an.box[0] && cx <= an.box[0] + an.box[2] && cy >= an.box[1] && cy <= an.box[1] + an.box[3];
  });
  return { ...r, class: ann?.class || 'unreviewed', title: ann?.title || 'UNREVIEWED region', detail: ann?.detail || 'No attribution authored for this region yet.', figma: ann?.figma || null };
});
writeFileSync(join(outDir, 'regions.json'), JSON.stringify({ liveUrl, newUrl, width, diffPixels, regions: joined }, null, 1));

// ---- viewer ----
const counts = {};
joined.forEach((r) => { counts[r.class] = (counts[r.class] || 0) + 1; });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const regionDivs = (side) => joined.map((r) => `
  <div class="region c-${r.class}" data-id="${r.id}" style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%"
    onmouseenter="hl(${r.id},true)" onmouseleave="hl(${r.id},false)" onclick="sel(${r.id})">
    ${side === 'new' ? `<span class="tag">${r.id}</span>` : ''}
  </div>`).join('');
const cards = joined.map((r) => `
  <div class="card c-${r.class}" id="card-${r.id}" onmouseenter="hl(${r.id},true)" onmouseleave="hl(${r.id},false)">
    <div class="card-head"><span class="num">${r.id}</span><span class="chip" style="background:${CLASSES[r.class]}">${r.class}</span></div>
    <div class="card-title">${esc(r.title)}</div>
    <div class="card-detail">${esc(r.detail)}</div>
    ${r.figma ? `<a class="card-link" target="_blank" href="https://www.figma.com/design/${r.figma.file}/?node-id=${r.figma.node.replace(':', '-')}">Figma mandate: ${esc(r.figma.label || r.figma.node)}</a>` : ''}
  </div>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Divergence viewer</title>
<style>
 body { margin:0; font: 14px/1.5 -apple-system, sans-serif; color:#111; background:#f4f5f7; }
 header { padding: 14px 20px; background:#fff; border-bottom:1px solid #ddd; position:sticky; top:0; z-index:5; }
 header h1 { font-size:16px; margin:0 0 4px; }
 .legend span { display:inline-block; margin-right:14px; font-size:12px; }
 .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; }
 .wrap { display:grid; grid-template-columns: 1fr 1fr 340px; gap:12px; padding:12px; align-items:start; }
 .pane { position:relative; background:#fff; border:1px solid #ddd; }
 .pane img { display:block; width:100%; }
 .pane .label { position:sticky; top:64px; z-index:4; display:inline-block; margin:6px; padding:2px 8px; background:#111; color:#fff; font-size:11px; border-radius:3px; }
 .region { position:absolute; border:2px solid; border-radius:3px; opacity:.55; cursor:pointer; transition:opacity .12s; }
 .region.hi { opacity:1; box-shadow:0 0 0 3px rgba(0,0,0,.15); }
 .region .tag { position:absolute; top:-10px; left:-10px; background:inherit; border:inherit; background-color:#fff; font-size:11px; font-weight:700; padding:0 5px; border-radius:8px; }
 ${Object.entries(CLASSES).map(([k, v]) => `.c-${k} { border-color:${v}; } .c-${k} .tag { color:${v}; }`).join('\n ')}
 aside { position:sticky; top:64px; max-height:calc(100vh - 90px); overflow:auto; }
 .card { background:#fff; border:1px solid #ddd; border-left:4px solid; border-radius:4px; padding:10px 12px; margin-bottom:8px; }
 ${Object.entries(CLASSES).map(([k, v]) => `.card.c-${k} { border-left-color:${v}; }`).join('\n ')}
 .card.hi { box-shadow:0 2px 10px rgba(0,0,0,.18); }
 .card-head { display:flex; gap:8px; align-items:center; margin-bottom:4px; }
 .num { font-weight:700; }
 .chip { color:#fff; font-size:10px; padding:1px 7px; border-radius:8px; text-transform:uppercase; }
 .card-title { font-weight:600; margin-bottom:2px; }
 .card-detail { font-size:12.5px; color:#444; }
 .card-link { font-size:12px; }
</style></head><body>
<header>
 <h1>Live site vs Figma-aligned migration — ${esc(newUrl.replace(/^https?:\/\/[^/]+/, '') || '/')}</h1>
 <div class="legend">
  ${Object.entries(CLASSES).filter(([k]) => counts[k]).map(([k, v]) => `<span><i style="background:${v}"></i>${k} (${counts[k]})</span>`).join('')}
  <span style="color:#666">${joined.length} difference regions — every region carries its attribution; differences classed “mandated” are required by the Figma design system, not migration drift.</span>
 </div>
</header>
<div class="wrap">
 <div class="pane"><span class="label">LIVE (production)</span><img src="live.png">${regionDivs('live')}</div>
 <div class="pane"><span class="label">MIGRATED + FIGMA-ALIGNED</span><img src="new.png">${regionDivs('new')}</div>
 <aside>${cards}</aside>
</div>
<script>
function hl(id, on) {
  document.querySelectorAll('.region[data-id="' + id + '"]').forEach(function (el) { el.classList.toggle('hi', on); });
  var c = document.getElementById('card-' + id); if (c) c.classList.toggle('hi', on);
}
function sel(id) { var c = document.getElementById('card-' + id); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); hl(id, true); }
</script>
</body></html>`;
writeFileSync(join(outDir, 'viewer.html'), html);
const unreviewed = joined.filter((r) => r.class === 'unreviewed').length;
const unmandated = joined.filter((r) => r.class === 'unmandated').length;
console.log(`${joined.length} regions (${diffPixels} diff px), ${unreviewed} unreviewed, ${unmandated} unmandated -> ${join(outDir, 'viewer.html')}`);
process.exit(unreviewed || unmandated ? 1 : 0);
