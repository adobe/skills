#!/usr/bin/env node
/**
 * skills/replica/scripts/diff-report.mjs
 *
 * Where are the differences? pixel-compare's 500 px bands say WHERE on the page, never WHICH block; its diff image is
 * 8–15k px tall. This reads a gate round's evidence (live.png, build.png and a diff PNG in one gate dir), loads the
 * BUILD page once at the same width to read its block boxes, and reports the differing-pixel share per block —
 * the block a fix belongs to — plus a self-contained HTML report: the table, a live | build | diff overview with the
 * blocks outlined, and live / build / diff crops of the hottest blocks.
 *
 * Blocks: `[data-block-name]` elements when the build has them (an EDS page), else `main > .section`, else the
 * children of `main` (a prototype), else `--blocks <css>`. Rows outside every block are one "outside blocks" row
 * (chrome, gaps). The diff's red pixels are pixel-compare's own count (anti-aliased yellow excluded).
 *
 * Usage:
 *   node skills/replica/scripts/diff-report.mjs <gateDir> <buildURL> [options]
 *     --width <px>     viewport width of the round              (default: the PNG's width)
 *     --diff <file>    diff PNG in <gateDir>                     (default: diff-final.png, else the newest diff-*.png)
 *     --blocks <css>   block selector on the build              (default: auto, see above)
 *     --top <n>        crops for the n hottest blocks           (default 4)
 *     --out <dir>      report dir                               (default <gateDir>/report)
 *     --json           the table as JSON on stdout
 *
 * Writes <out>/report.html, <out>/overview.png and <out>/crop-<n>-{live,build,diff}.png. Exit: 0 written, 1 error.
 * Requires playwright and pngjs (project devDependencies; imported lazily, so --help and the pure test need neither).
 */
/* eslint-disable no-await-in-loop, max-len */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^\s*\* ?/gm, '').trim();

export function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { width: null, diff: null, blocks: null, top: 4, out: null, json: false };
  const pos = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') opts.width = Number(rest[i += 1]);
    else if (a === '--diff') opts.diff = rest[i += 1];
    else if (a === '--blocks') opts.blocks = rest[i += 1];
    else if (a === '--top') opts.top = Number(rest[i += 1]);
    else if (a === '--out') opts.out = rest[i += 1];
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else pos.push(a);
  }
  const [dir, build] = pos;
  if (!dir || !build) throw new Error('need <gateDir> and <buildURL>');
  return { dir, build, opts };
}

// The diff PNG a round left: diff-final.png, else the newest diff-*.png.
export function pickDiff(dir, explicit) {
  if (explicit) return join(dir, explicit);
  if (existsSync(join(dir, 'diff-final.png'))) return join(dir, 'diff-final.png');
  const all = readdirSync(dir).filter((f) => /^diff-.*\.png$/.test(f)).sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  if (!all.length) throw new Error(`no diff-*.png in ${dir} — run a gate round first`);
  return join(dir, all[0]);
}

const red = (d, i) => d[i] === 255 && d[i + 1] < 100;

// Pure: differing-pixel share per block ({ name, x, y, w, h } in page coordinates) over a diff image
// ({ width, height, data }), plus the rows outside every block. Blocks are clipped to the image; the outside row
// counts every pixel no block covers.
export function blockTable(diff, blocks) {
  const { width: W, height: H, data } = diff;
  const covered = new Uint8Array(W * H);
  const rows = blocks.map((b, k) => {
    const x0 = Math.max(0, Math.floor(b.x)); const x1 = Math.min(W, Math.ceil(b.x + b.w));
    const y0 = Math.max(0, Math.floor(b.y)); const y1 = Math.min(H, Math.ceil(b.y + b.h));
    let px = 0; let hit = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = y * W + x;
        covered[p] = 1; px += 1;
        if (red(data, p * 4)) hit += 1;
      }
    }
    return { k, name: b.name, y0, y1, px, differing: hit, pct: px ? (100 * hit) / px : 0 };
  });
  let px = 0; let hit = 0;
  for (let p = 0; p < W * H; p += 1) if (!covered[p]) { px += 1; if (red(data, p * 4)) hit += 1; }
  return { blocks: rows, outside: { name: 'outside blocks', px, differing: hit, pct: px ? (100 * hit) / px : 0 } };
}

// Pure: nearest-neighbour scale of an RGBA image to width w (the overview strip).
export function scaleTo(img, w) {
  const f = img.width / w; const h = Math.max(1, Math.round(img.height / f));
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y * f));
    for (let x = 0; x < w; x += 1) img.data.copy(data, (y * w + x) * 4, (sy * img.width + Math.min(img.width - 1, Math.floor(x * f))) * 4, (sy * img.width + Math.min(img.width - 1, Math.floor(x * f))) * 4 + 4);
  }
  return { width: w, height: h, data };
}

// Pure: rows y0..y1 of an RGBA image (clipped).
export function cropRows(img, y0, y1) {
  const a = Math.max(0, y0); const b = Math.min(img.height, y1);
  const h = Math.max(1, b - a);
  const data = Buffer.alloc(img.width * h * 4);
  if (b > a) img.data.copy(data, 0, a * img.width * 4, b * img.width * 4);
  return { width: img.width, height: h, data };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function reportHtml({ dir, build, width, diffFile, table, crops }) {
  const row = (r, i) => `<tr class="${r.pct >= 20 ? 'hot' : r.pct >= 10 ? 'warm' : ''}"><td>${i}</td><td>${esc(r.name)}</td><td>${r.y0}–${r.y1}</td><td>${r.pct.toFixed(2)} %</td><td>${r.differing}</td></tr>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>diff report — ${esc(basename(dir))}</title>
<style>body{font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif;margin:24px;color:#1c1c1c}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}tr.hot td{background:#ffe5e8}tr.warm td{background:#fff4d6}.crop{display:flex;gap:8px;margin:8px 0 24px}.crop img{width:32%;border:1px solid #ccc}img.ov{max-width:100%;border:1px solid #ccc}</style>
<h1>Where the differences are — ${esc(basename(dir))}</h1>
<p>build ${esc(build)} @ ${width}px · diff ${esc(basename(diffFile))}</p>
<table><tr><th>#</th><th>block</th><th>rows</th><th>differing</th><th>px</th></tr>${table.blocks.map((r) => row(r, r.k + 1)).join('')}<tr><td></td><td>${table.outside.name}</td><td></td><td>${table.outside.pct.toFixed(2)} %</td><td>${table.outside.differing}</td></tr></table>
<h2>Overview — live | build | diff</h2><img class="ov" src="overview.png" alt="live, build and diff side by side">
<h2>Hottest blocks</h2>${crops.map((c) => `<h3>#${c.k + 1} ${esc(c.name)} — ${c.pct.toFixed(2)} %</h3><div class="crop"><img src="${c.files[0]}" alt="live"><img src="${c.files[1]}" alt="build"><img src="${c.files[2]}" alt="diff"></div>`).join('')}
</html>`;
}

// In the build page: block boxes in page coordinates.
/* eslint-disable no-undef */
function readBlocks(sel) {
  const pick = sel ? [...document.querySelectorAll(sel)]
    : (document.querySelector('[data-block-name]') ? [...document.querySelectorAll('[data-block-name]')]
      : (document.querySelector('main > .section') ? [...document.querySelectorAll('main > .section')] : [...document.querySelectorAll('main > *')]));
  return pick.map((el) => {
    const r = el.getBoundingClientRect();
    const name = el.getAttribute('data-block-name') || [...el.classList].filter((c) => c !== 'block' && c !== 'section').slice(0, 2).join('.') || el.tagName.toLowerCase();
    return { name, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }).filter((b) => b.w > 0 && b.h > 0);
}
/* eslint-enable no-undef */

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); return; }
  const { dir, build, opts } = parseArgs(process.argv);
  let chromium; let PNG;
  try { ({ chromium } = await import('playwright')); ({ PNG } = await import('pngjs')); } catch (e) { throw new Error(`playwright / pngjs not importable (${e.code || e.message}) — copy the replica scripts dir into the project and run the copy`); }
  const diffFile = pickDiff(dir, opts.diff);
  const diff = PNG.sync.read(readFileSync(diffFile));
  const live = PNG.sync.read(readFileSync(join(dir, 'live.png')));
  const buildPng = PNG.sync.read(readFileSync(join(dir, 'build.png')));
  const width = opts.width || buildPng.width;
  const browser = await chromium.launch();
  let blocks;
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(build, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); } window.scrollTo(0, 0); });
    blocks = await page.evaluate(readBlocks, opts.blocks);
  } finally { await browser.close(); }
  if (!blocks.length) throw new Error(`no blocks on ${build} — pass --blocks <css>`);
  const table = blockTable(diff, blocks);
  const out = opts.out || join(dir, 'report');
  mkdirSync(out, { recursive: true });
  // overview: live | build | diff, each scaled to 300 px wide, side by side
  const parts = [live, buildPng, diff].map((img) => scaleTo(img, 300));
  const ovH = Math.max(...parts.map((p) => p.height));
  const ov = new PNG({ width: 920, height: ovH }); ov.data.fill(255);
  parts.forEach((p, i) => { for (let y = 0; y < p.height; y += 1) p.data.copy(ov.data, (y * 920 + i * 310) * 4, y * 300 * 4, (y + 1) * 300 * 4); });
  writeFileSync(join(out, 'overview.png'), PNG.sync.write(ov));
  const hottest = [...table.blocks].sort((a, b) => b.pct - a.pct).slice(0, opts.top).filter((r) => r.differing > 0);
  const crops = hottest.map((r, n) => {
    const files = ['live', 'build', 'diff'].map((side) => `crop-${n + 1}-${side}.png`);
    [live, buildPng, diff].forEach((img, i) => { const c = cropRows(img, r.y0, r.y1); const o = new PNG({ width: c.width, height: c.height }); c.data.copy(o.data); writeFileSync(join(out, files[i]), PNG.sync.write(o)); });
    return { ...r, files };
  });
  writeFileSync(join(out, 'report.html'), reportHtml({ dir, build, width, diffFile, table, crops }));
  if (opts.json) { console.log(JSON.stringify({ diff: diffFile, width, blocks: table.blocks, outside: table.outside, report: join(out, 'report.html') }, null, 2)); return; }
  console.log(`diff report @ ${width}px — ${basename(diffFile)}, ${table.blocks.length} blocks on ${build}`);
  for (const r of table.blocks) console.log(`  #${String(r.k + 1).padStart(2)} ${r.name.padEnd(24)} y ${String(r.y0).padStart(6)}–${String(r.y1).padEnd(6)} ${r.pct.toFixed(2).padStart(6)} %${r.pct >= 10 ? '  ◄◄' : ''}`);
  console.log(`     ${'outside blocks'.padEnd(24)} ${' '.repeat(16)} ${table.outside.pct.toFixed(2).padStart(6)} %`);
  console.log(`report: ${join(out, 'report.html')}`);
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`diff-report error: ${e.message}`); process.exitCode = 1; });
}
