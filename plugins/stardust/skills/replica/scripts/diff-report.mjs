#!/usr/bin/env node
/**
 * skills/replica/scripts/diff-report.mjs
 *
 * Where are the differences? pixel-compare's 500 px bands say WHERE on the page, never WHICH block; its diff image is
 * 8–15k px tall. This reads a gate round's evidence (live.png, build.png and a diff PNG in one gate dir), loads the
 * BUILD page once at the same width to read its block boxes, and reports the differing-pixel share per block —
 * the block a fix belongs to — plus a self-contained HTML report: the table, a live | build | diff overview (the three
 * captures scaled side by side) and live / build / diff crops of the hottest blocks.
 *
 * Blocks: `[data-block-name]` elements plus each `.default-content-wrapper` ("default content (section N)") when the
 * build has them (an EDS page), else `main > .section`, else the children of `main` (a prototype), or `--blocks <css>`.
 * A block inside another picked block is folded into the outermost one (named "<outer> (+N nested)"), so no pixel
 * counts twice. Rows outside every block are one "outside blocks" row (chrome, gaps). The diff's red pixels are
 * pixel-compare's own count (anti-aliased yellow excluded). pixel-compare diffs only the shorter capture's height:
 * when live and build heights differ a warning is printed, a block below the compared height is "not compared" and
 * one straddling it is "partial" (its share is over the compared rows only).
 *
 * Usage:
 *   node skills/replica/scripts/diff-report.mjs <gateDir> <buildURL> [options]
 *     --width <px>     viewport width of the round              (default: the PNG's width)
 *     --diff <file>    diff PNG, relative to <gateDir> or absolute (default: the newest diff-*.png; gate.sh writes
 *                      diff-<label>.png, label default iter)
 *     --blocks <css>   block selector on the build              (default: auto, see above)
 *     --top <n>        crops for the n hottest blocks           (default 4)
 *     --out <dir>      report dir                               (default <gateDir>/report)
 *     --json           the table as JSON on stdout
 *
 * Writes <out>/report.html, <out>/overview.png and <out>/crop-<n>-{live,build,diff}.png. Exit: 0 written, 1 error.
 * Requires playwright and pngjs (project devDependencies; imported lazily, so --help and the pure test need neither).
 */
/* eslint-disable no-await-in-loop, max-len */
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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

// The diff PNG a round left: --diff (relative to the gate dir, or absolute), else the newest diff-*.png
// (gate.sh writes diff-<label>.png, label default iter).
export function pickDiff(dir, explicit) {
  if (explicit) return resolve(dir, explicit);
  const all = readdirSync(dir).filter((f) => /^diff-.*\.png$/.test(f)).sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  if (!all.length) throw new Error(`no diff-*.png in ${dir} — run a gate round first`);
  return join(dir, all[0]);
}

const red = (d, i) => d[i] === 255 && d[i + 1] < 100;

// Pure: differing-pixel share per block ({ name, x, y, w, h } in page coordinates) over a diff image
// ({ width, height, data }), plus the rows outside every block. The diff covers only the shorter capture's height, so
// a block is clipped to the image: `compared` is 'full', 'partial' (y0..y1 is the compared part of top..bottom) or
// 'none' (wholly below the diff — pct null, never a false 0 %). The outside row counts every pixel no block covers.
export function blockTable(diff, blocks) {
  const { width: W, height: H, data } = diff;
  const covered = new Uint8Array(W * H);
  const rows = blocks.map((b, k) => {
    const top = Math.max(0, Math.floor(b.y)); const bottom = Math.ceil(b.y + b.h);
    const x0 = Math.max(0, Math.floor(b.x)); const x1 = Math.min(W, Math.ceil(b.x + b.w));
    const y0 = Math.min(top, H); const y1 = Math.min(H, bottom);
    const compared = y1 <= y0 ? 'none' : (bottom > H ? 'partial' : 'full');
    let px = 0; let hit = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = y * W + x;
        covered[p] = 1; px += 1;
        if (red(data, p * 4)) hit += 1;
      }
    }
    return { k, name: b.name, top, bottom, y0, y1, compared, px, differing: hit, pct: compared === 'none' ? null : (px ? (100 * hit) / px : 0) };
  });
  let px = 0; let hit = 0;
  for (let p = 0; p < W * H; p += 1) if (!covered[p]) { px += 1; if (red(data, p * 4)) hit += 1; }
  return { blocks: rows, outside: { name: 'outside blocks', px, differing: hit, pct: px ? (100 * hit) / px : 0 } };
}

// Pure: fold nested blocks into the outermost picked ancestor so no pixel counts twice. Each box carries
// `parent` — the index (in the same list) of its nearest picked ancestor, or -1 (readBlocks sets it).
export function foldNested(boxes) {
  const root = (i) => { let j = i; while (boxes[j].parent >= 0 && boxes[j].parent !== j) j = boxes[j].parent; return j; };
  const nested = boxes.map(() => 0);
  boxes.forEach((b, i) => { if (b.parent >= 0) nested[root(i)] += 1; });
  return boxes.flatMap((b, i) => (b.parent >= 0 ? [] : [{ name: nested[i] ? `${b.name} (+${nested[i]} nested)` : b.name, x: b.x, y: b.y, w: b.w, h: b.h }]));
}

// Pure: one table row as text — "not compared" / "(partial, compared y a–b)" instead of a false share.
export function rowText(r) {
  const head = `  #${String(r.k + 1).padStart(2)} ${r.name.padEnd(24)} y ${String(r.top).padStart(6)}–${String(r.bottom).padEnd(6)}`;
  if (r.compared === 'none') return `${head}    not compared (below the compared height)`;
  return `${head} ${r.pct.toFixed(2).padStart(6)} %${r.compared === 'partial' ? ` (partial, compared y ${r.y0}–${r.y1})` : ''}${r.pct >= 10 ? '  ◄◄' : ''}`;
}

// Pure: the warning when the two captures differ in height (pixel-compare diffs the shorter height only), else ''.
export function heightWarning(liveH, buildH, diffH) {
  if (liveH === buildH) return '';
  return `warning: live is ${liveH}px tall, build ${buildH}px — only y 0–${diffH} was compared; blocks below it are "not compared"`;
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
export function reportHtml({ dir, build, width, diffFile, table, crops, warning = '' }) {
  const share = (r) => (r.compared === 'none' ? 'not compared' : `${r.pct.toFixed(2)} %${r.compared === 'partial' ? ` (partial, y ${r.y0}–${r.y1})` : ''}`);
  const row = (r, i) => `<tr class="${r.pct >= 20 ? 'hot' : r.pct >= 10 ? 'warm' : ''}"><td>${i}</td><td>${esc(r.name)}</td><td>${r.top}–${r.bottom}</td><td>${share(r)}</td><td>${r.compared === 'none' ? '' : r.differing}</td></tr>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>diff report — ${esc(basename(dir))}</title>
<style>body{font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif;margin:24px;color:#1c1c1c}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}tr.hot td{background:#ffe5e8}tr.warm td{background:#fff4d6}.crop{display:flex;gap:8px;margin:8px 0 24px}.crop img{width:32%;border:1px solid #ccc}img.ov{max-width:100%;border:1px solid #ccc}</style>
<h1>Where the differences are — ${esc(basename(dir))}</h1>
<p>build ${esc(build)} @ ${width}px · diff ${esc(basename(diffFile))}</p>${warning ? `<p><strong>${esc(warning)}</strong></p>` : ''}
<table><tr><th>#</th><th>block</th><th>rows</th><th>differing</th><th>px</th></tr>${table.blocks.map((r) => row(r, r.k + 1)).join('')}<tr><td></td><td>${table.outside.name}</td><td></td><td>${table.outside.pct.toFixed(2)} %</td><td>${table.outside.differing}</td></tr></table>
<h2>Overview — live | build | diff</h2><img class="ov" src="overview.png" alt="live, build and diff side by side">
<h2>Hottest blocks</h2>${crops.map((c) => `<h3>#${c.k + 1} ${esc(c.name)} — ${c.pct.toFixed(2)} %</h3><div class="crop"><img src="${c.files[0]}" alt="live"><img src="${c.files[1]}" alt="build"><img src="${c.files[2]}" alt="diff"></div>`).join('')}
</html>`;
}

// In the build page: block boxes in page coordinates (EDS default content as one unit per wrapper), each with
// `parent` = the index of its nearest picked ancestor (-1 if none) for foldNested.
/* eslint-disable no-undef */
function readBlocks(sel) {
  const eds = !sel && document.querySelector('[data-block-name]');
  const pick = sel ? [...document.querySelectorAll(sel)]
    : (eds ? [...document.querySelectorAll('[data-block-name], .default-content-wrapper')]
      : (document.querySelector('main > .section') ? [...document.querySelectorAll('main > .section')] : [...document.querySelectorAll('main > *')]));
  const sections = [...document.querySelectorAll('main > div')];
  const boxes = pick.map((el) => {
    const r = el.getBoundingClientRect();
    const sec = el.closest('main > div');
    const name = (eds && el.matches('.default-content-wrapper:not([data-block-name])'))
      ? `default content (section ${sections.indexOf(sec) + 1})`
      : (el.getAttribute('data-block-name') || [...el.classList].filter((c) => c !== 'block' && c !== 'section').slice(0, 2).join('.') || el.tagName.toLowerCase());
    let up = el.parentElement; while (up && !pick.includes(up)) up = up.parentElement;
    return { name, x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, parent: up ? pick.indexOf(up) : -1 };
  });
  // drop zero-size boxes; a parent index then points at the nearest kept ancestor
  const keep = boxes.map((b) => b.w > 0 && b.h > 0);
  const lift = (i) => { let j = i; while (j >= 0 && !keep[j]) j = boxes[j].parent; return j; };
  const idx = []; let n = 0; keep.forEach((k, i) => { if (k) { idx[i] = n; n += 1; } });
  return boxes.flatMap((b, i) => { if (!keep[i]) return []; const p = lift(b.parent); return [{ ...b, parent: p >= 0 ? idx[p] : -1 }]; });
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
    // late (lazy) images loaded by the scroll pass can still shift boxes: settle before reading them
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    blocks = foldNested(await page.evaluate(readBlocks, opts.blocks));
  } finally { await browser.close(); }
  if (!blocks.length) throw new Error(`no blocks on ${build} — pass --blocks <css>`);
  const table = blockTable(diff, blocks);
  const warning = heightWarning(live.height, buildPng.height, diff.height);
  const out = opts.out || join(dir, 'report');
  mkdirSync(out, { recursive: true });
  // overview: live | build | diff, each scaled to 300 px wide, side by side
  const parts = [live, buildPng, diff].map((img) => scaleTo(img, 300));
  const ovH = Math.max(...parts.map((p) => p.height));
  const ov = new PNG({ width: 920, height: ovH }); ov.data.fill(255);
  parts.forEach((p, i) => { for (let y = 0; y < p.height; y += 1) p.data.copy(ov.data, (y * 920 + i * 310) * 4, y * 300 * 4, (y + 1) * 300 * 4); });
  writeFileSync(join(out, 'overview.png'), PNG.sync.write(ov));
  const hottest = table.blocks.filter((r) => r.compared !== 'none' && r.differing > 0).sort((a, b) => b.pct - a.pct).slice(0, opts.top);
  const crops = hottest.map((r, n) => {
    const files = ['live', 'build', 'diff'].map((side) => `crop-${n + 1}-${side}.png`);
    [live, buildPng, diff].forEach((img, i) => { const c = cropRows(img, r.y0, r.y1); const o = new PNG({ width: c.width, height: c.height }); c.data.copy(o.data); writeFileSync(join(out, files[i]), PNG.sync.write(o)); });
    return { ...r, files };
  });
  writeFileSync(join(out, 'report.html'), reportHtml({ dir, build, width, diffFile, table, crops, warning }));
  if (opts.json) { console.log(JSON.stringify({ diff: diffFile, width, warning: warning || null, liveHeight: live.height, buildHeight: buildPng.height, comparedHeight: diff.height, blocks: table.blocks, outside: table.outside, report: join(out, 'report.html') }, null, 2)); return; }
  console.log(`diff report @ ${width}px — ${basename(diffFile)}, ${table.blocks.length} blocks on ${build}`);
  if (warning) console.log(warning);
  for (const r of table.blocks) console.log(rowText(r));
  console.log(`     ${'outside blocks'.padEnd(24)} ${' '.repeat(16)} ${table.outside.pct.toFixed(2).padStart(6)} %`);
  console.log(`report: ${join(out, 'report.html')}`);
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`diff-report error: ${e.message}`); process.exitCode = 1; });
}
