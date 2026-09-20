#!/usr/bin/env node
/**
 * skills/replica/scripts/review-image.mjs
 *
 * Review images for the stardust:replica gate and the extract capture check:
 * ONE small PNG per round instead of dozens of crop-and-look reads. pngjs
 * only (the gate's existing dependency); nothing here is a verdict.
 *
 * Why: hand-rolled contact sheets and band crops (PIL, sips, pngjs one-liners)
 * were written in seven-plus field projects; one session read 80 side-by-side
 * PNGs that were ALREADY display-sized and died at the request-size limit —
 * the failure mode is the COUNT of image reads, not their height. Another
 * spent 134 crop reads on one archetype. The strip folds a round's k worst
 * bands into one Read; the sheet folds 12 page captures into one Read.
 * Full-resolution `crop-compare --out` stays the escalation for ONE named
 * band, and extract Phase 2.5 stays authoritative (a `suspect` still opens
 * the page) — these images are a reading aid, never a threshold.
 *
 * Two modes:
 *   --bands <a.png> <b.png> --out <review.png> [--json <pixel-compare.json> |
 *           --y <px> --height <px>] [--diff <diff.png>] [--top 3] [--width 1000]
 *       For the k worst bands (by `bands[].pct` from pixel-compare's JSON,
 *       else the explicit band) one stacked row per band = [A band | B band]
 *       side by side downscaled to --width, a y-range caption in digits, and a
 *       24 px heat bar of the diff's column-wise red density beneath it (from
 *       --diff when given, else a raw per-column mismatch of A vs B). Height
 *       is capped at 1,500 px (k shrinks if needed). gate.sh writes it every
 *       round as review-<label>.png via `pixel-compare --review`.
 *   --sheet <dir-or-files…> --out <sheet-NN.png> [--per 12] [--cols 3]
 *           [--crop-top 1200] [--tail 600]
 *       A contact sheet of page captures: each tile is the top --crop-top rows plus
 *       the footer --tail rows of one screenshot (the whole page when shorter),
 *       digit-labelled 1..N, ≤ 2,000 px either side. More files than --per →
 *       sheet-01, sheet-02, … (NN in --out is replaced; else -NN is inserted).
 *       Every sheet gets a <sheet>.json legend {tiles:[{i, slug, file, width,
 *       height, cropTop, cropTail, scale}]} — verdicts are recorded per slug
 *       from the legend, not read off the image (pngjs draws no text; the
 *       3×5 digit font is the only glyph set).
 *
 * Exit codes: 0 written, 1 bad arguments / unreadable input. Never a verdict.
 * Requires: pngjs (loaded lazily — the layout helpers import without it).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';
// Dependencies through the resolution chain (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md
// § Resolution chain): plugin layout, then a project copy made as a set (harness-permissions.md § Two classes);
// a lone copy without the helper falls back to the bare import it resolved before. A miss at every link is one
// line naming preflight-runtime.mjs.
const CHAIN = await (async () => { for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return null; })();
const loadDep = (name) => (CHAIN ? CHAIN.resolveDep(name, { from: import.meta.url }) : import(name).then((m) => ('module.exports' in m ? m['module.exports'] : (m.default && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in m.default) ? m.default : m))));

const HELP = `review-image — one small PNG per round: stacked band strip or contact sheet (pngjs only, never a verdict)

Usage:
  node review-image.mjs --bands <a.png> <b.png> --out <review.png> [--json <pixel-compare.json> | --y <px> --height <px>] [--diff <diff.png>] [--top <k>] [--width 1000]
  node review-image.mjs --sheet <dir-or-files…> --out <sheet-NN.png> [--per 12] [--cols 3] [--crop-top <px>] [--tail 600]

  --bands   k worst bands (pixel-compare JSON bands[].pct) as rows of [A | B] + diff heat bar; ≤ 1500 px tall
  --sheet   tiles of top+tail crops of each capture, digit-labelled, ≤ 2000 px per side, + <sheet>.json legend
  --help    this text

Exit codes: 0 written, 1 bad arguments / unreadable input.`;

// ---------------------------------------------------------------- pure helpers
// 3×5 bitmap font — digits, '-', ':' and '.' — the only text pngjs can draw.
export const GLYPHS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], '-': ['000', '000', '111', '000', '000'], ':': ['000', '010', '000', '010', '000'],
  '.': ['000', '000', '000', '000', '010'], ' ': ['000', '000', '000', '000', '000'],
};

export const blank = (width, height, fill = [255, 255, 255, 255]) => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3]; }
  return { width, height, data };
};

export function fillRect(img, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) {
    const i = (yy * img.width + xx) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
}

/** Draw `text` (digits - : .) at (x,y), `scale` px per font pixel, on a white box. Returns the drawn width. */
export function drawDigits(img, x, y, text, scale = 3, color = [0, 0, 0]) {
  const s = String(text);
  const w = s.length * 4 * scale; const h = 5 * scale;
  fillRect(img, x - scale, y - scale, w + scale, h + 2 * scale, [255, 255, 255]);
  [...s].forEach((ch, k) => {
    const g = GLYPHS[ch] || GLYPHS[' '];
    g.forEach((row, ry) => [...row].forEach((bit, rx) => { if (bit === '1') fillRect(img, x + (k * 4 + rx) * scale, y + ry * scale, scale, scale, color); }));
  });
  return w;
}

/** Box-filter downscale of src rect (sx,sy,sw,sh) into dst rect (dx,dy,dw,dh). */
export function downscaleInto(src, sx, sy, sw, sh, dst, dx, dy, dw, dh) {
  for (let oy = 0; oy < dh; oy++) {
    const y0 = sy + Math.floor((oy * sh) / dh); const y1 = Math.max(y0 + 1, sy + Math.floor(((oy + 1) * sh) / dh));
    for (let ox = 0; ox < dw; ox++) {
      const x0 = sx + Math.floor((ox * sw) / dw); const x1 = Math.max(x0 + 1, sx + Math.floor(((ox + 1) * sw) / dw));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let y = y0; y < y1 && y < src.height; y++) for (let x = x0; x < x1 && x < src.width; x++) { const i = (y * src.width + x) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++; }
      const o = ((dy + oy) * dst.width + dx + ox) * 4;
      if (o < 0 || o + 3 >= dst.data.length || dx + ox >= dst.width) continue;
      dst.data[o] = n ? Math.round(r / n) : 255; dst.data[o + 1] = n ? Math.round(g / n) : 255; dst.data[o + 2] = n ? Math.round(b / n) : 255; dst.data[o + 3] = 255;
    }
  }
}

/** Column-wise diff density for rows y0..y1: from a pixelmatch diff (red pixels) or a raw A-vs-B mismatch. Returns dw values in 0..1. */
export function columnDensity({ diff, a, b }, y0, y1, dw) {
  const src = diff || a; const w = src.width; const out = new Float64Array(dw);
  for (let ox = 0; ox < dw; ox++) {
    const x0 = Math.floor((ox * w) / dw); const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / dw));
    let hit = 0; let n = 0;
    for (let y = y0; y < Math.min(y1, src.height); y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4; n++;
      if (diff) { if (diff.data[i] === 255 && diff.data[i + 1] < 100) hit++; }
      else if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 48) hit++;
    }
    out[ox] = n ? hit / n : 0;
  }
  return out;
}

/** The k worst bands by pct (ties by y0), from pixel-compare's bands[]. */
export function pickBands(bands, top = 3) {
  return [...(bands || [])].filter((x) => Number.isFinite(x.y0) && Number.isFinite(x.y1)).sort((p, q) => (q.pct - p.pct) || (p.y0 - q.y0)).slice(0, Math.max(1, top)).sort((p, q) => p.y0 - q.y0);
}

/** Row geometry for the strip: each row = [A | B] at width/2 each + caption + heat bar; k shrinks to fit maxH. */
export function bandsLayout({ srcW, bands, width = 1000, maxH = 1500, bar = 24, gap = 6 }) {
  const half = Math.floor((width - gap) / 2); const scale = half / srcW;
  let rows = bands.map((bd) => ({ ...bd, h: Math.max(8, Math.round((bd.y1 - bd.y0) * scale)) }));
  const total = (rs) => rs.reduce((acc, r) => acc + r.h + bar + gap * 2, 0);
  while (rows.length > 1 && total(rows) > maxH) rows = rows.slice(0, -1);
  return { half, scale, gap, bar, rows, height: total(rows) };
}

/** Sheet geometry: tiles ≤ 2000 px per side. */
export function sheetLayout({ n, cols = 3, per = 12, max = 2000, gap = 8 }) {
  const count = Math.min(n, per); const rows = Math.ceil(count / cols);
  const tileW = Math.floor((max - gap * (cols + 1)) / cols); const tileH = Math.floor((max - gap * (rows + 1)) / rows);
  return { count, cols, rows, tileW, tileH, gap, width: cols * tileW + gap * (cols + 1), height: rows * tileH + gap * (rows + 1) };
}

/** Render the stacked band strip from decoded images. Returns { img, rows }. */
export function renderBands({ a, b, diff = null, bands, width = 1000, top = 3 }) {
  const w = Math.min(a.width, b.width);
  const chosen = pickBands(bands, top).map((bd) => ({ ...bd, y1: Math.min(bd.y1, a.height, b.height) })).filter((bd) => bd.y1 > bd.y0);
  const lay = bandsLayout({ srcW: w, bands: chosen, width });
  const img = blank(width, Math.max(lay.height, 40), [236, 236, 236, 255]);
  let y = lay.gap;
  for (const r of lay.rows) {
    downscaleInto(a, 0, r.y0, w, r.y1 - r.y0, img, 0, y, lay.half, r.h);
    downscaleInto(b, 0, r.y0, w, r.y1 - r.y0, img, lay.half + lay.gap, y, lay.half, r.h);
    drawDigits(img, 6, y + 6, `${r.y0}-${r.y1}`, 2);
    const dens = columnDensity({ diff, a, b }, r.y0, r.y1, width);
    for (let x = 0; x < width; x++) { const v = dens[x]; const shade = Math.round(255 - Math.min(1, v * 4) * 255); fillRect(img, x, y + r.h + 2, 1, lay.bar - 4, v > 0 ? [255, shade, shade] : [255, 255, 255]); }
    y += r.h + lay.bar + lay.gap * 2;
  }
  return { img, rows: lay.rows, scale: lay.scale };
}

/** Render one contact sheet from decoded captures [{ slug, file, img }]. Returns { img, legend }. */
export function renderSheet(items, { cols = 3, per = 12, top = 1200, tail = 600 } = {}) {
  const lay = sheetLayout({ n: items.length, cols, per });
  const img = blank(lay.width, lay.height, [200, 200, 200, 255]);
  const legend = [];
  items.slice(0, lay.count).forEach((it, k) => {
    const c = k % lay.cols; const r = Math.floor(k / lay.cols);
    const x0 = lay.gap + c * (lay.tileW + lay.gap); const y0 = lay.gap + r * (lay.tileH + lay.gap);
    const whole = it.img.height <= top + tail;
    const cropTop = whole ? it.img.height : top; const cropTail = whole ? 0 : Math.min(tail, it.img.height - top);
    const cropH = cropTop + cropTail + (cropTail ? 4 : 0);
    const scale = Math.min(lay.tileW / it.img.width, lay.tileH / cropH);
    const dw = Math.max(1, Math.floor(it.img.width * scale)); const dhTop = Math.max(1, Math.floor(cropTop * scale)); const dhTail = Math.floor(cropTail * scale);
    fillRect(img, x0, y0, lay.tileW, lay.tileH, [255, 255, 255]);
    downscaleInto(it.img, 0, 0, it.img.width, cropTop, img, x0, y0, dw, dhTop);
    if (cropTail) { fillRect(img, x0, y0 + dhTop, dw, 4, [255, 0, 128]); downscaleInto(it.img, 0, it.img.height - cropTail, it.img.width, cropTail, img, x0, y0 + dhTop + 4, dw, dhTail); }
    drawDigits(img, x0 + 8, y0 + 8, String(k + 1), 4);
    legend.push({ i: k + 1, slug: it.slug, file: it.file, width: it.img.width, height: it.img.height, cropTop, cropTail, scale: Number(scale.toFixed(3)) });
  });
  return { img, legend };
}

// ---------------------------------------------------------------- pngjs I/O (lazy)
let PNGmod = null;
async function png() { if (!PNGmod) PNGmod = (await loadDep('pngjs')).PNG; return PNGmod; }
export async function readImage(path) { const PNG = await png(); return PNG.sync.read(readFileSync(path)); }
export async function writeImage(path, img) {
  const PNG = await png();
  const out = new PNG({ width: img.width, height: img.height }); img.data.copy(out.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(out));
  return path;
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const rest = argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(rest.length ? 0 : 1); }
  const o = { mode: null, inputs: [], out: null, json: null, y: null, height: null, diff: null, top: null, cropTop: null, width: 1000, per: 12, cols: 3, tail: 600 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--bands' || a === '--sheet') { o.mode = a.slice(2); }
    else if (a === '--out') o.out = rest[++i];
    else if (a === '--json') o.json = rest[++i];
    else if (a === '--diff') o.diff = rest[++i];
    else if (a === '--y') o.y = Number(rest[++i]);
    else if (a === '--height') o.height = Number(rest[++i]);
    else if (a === '--top') o.top = Number(rest[++i]);
    else if (a === '--crop-top') o.cropTop = Number(rest[++i]);
    else if (a === '--width') o.width = Number(rest[++i]);
    else if (a === '--per') o.per = Number(rest[++i]);
    else if (a === '--cols') o.cols = Number(rest[++i]);
    else if (a === '--tail') o.tail = Number(rest[++i]);
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else o.inputs.push(a);
  }
  if (!o.mode || !o.out) { console.error(`need --bands or --sheet, and --out\n\n${HELP}`); process.exit(1); }
  // One meaning per flag: --top <k> counts bands, --crop-top <px> crops sheet
  // tiles (the same token meant "k bands" in one mode and "crop px" in the other).
  if (o.mode === 'sheet' && o.top != null) { console.error(`--sheet: --top is the --bands band count; the tile crop height is --crop-top <px> (default 1200)\n\n${HELP}`); process.exit(1); }
  if (o.mode === 'bands' && o.cropTop != null) { console.error(`--bands: --crop-top is the --sheet tile crop; the band count is --top <k> (default 3)\n\n${HELP}`); process.exit(1); }
  return o;
}

const sheetName = (out, n, i) => {
  if (n === 1 && !/NN/.test(out)) return out;
  const nn = String(i + 1).padStart(2, '0');
  return /NN/.test(out) ? out.replace('NN', nn) : `${out.slice(0, out.length - extname(out).length)}-${nn}${extname(out)}`;
};

async function main() {
  const o = parseArgs(process.argv);
  if (o.mode === 'bands') {
    const [aPath, bPath] = o.inputs;
    if (!aPath || !bPath) { console.error(`--bands needs <a.png> <b.png>\n\n${HELP}`); process.exit(1); }
    const a = await readImage(aPath); const b = await readImage(bPath);
    const diff = o.diff && existsSync(o.diff) ? await readImage(o.diff) : null;
    let bands = null;
    if (o.json) bands = JSON.parse(readFileSync(o.json, 'utf8')).bands;
    else if (o.y != null && o.height) bands = [{ y0: o.y, y1: o.y + o.height, pct: 100 }];
    if (!bands || !bands.length) { console.error('--bands needs --json <pixel-compare.json> (with bands[]) or --y <px> --height <px>'); process.exit(1); }
    const { img, rows, scale } = renderBands({ a, b, diff, bands, width: o.width, top: o.top || 3 });
    await writeImage(o.out, img);
    console.log(`review strip: ${rows.length} band(s) [${rows.map((r) => `${r.y0}–${r.y1} ${Number(r.pct).toFixed(1)}%`).join(', ')}] at ${(scale * 100).toFixed(0)} % → ${o.out} (${img.width}x${img.height}; full resolution of ONE band: crop-compare --y <px> --height <px> --out <file>)`);
    return;
  }
  // sheet
  const files = [];
  for (const inp of o.inputs) {
    if (!existsSync(inp)) { console.error(`--sheet: ${inp} not found`); process.exit(1); }
    if (statSync(inp).isDirectory()) files.push(...readdirSync(inp).filter((f) => f.endsWith('.png')).sort().map((f) => join(inp, f)));
    else files.push(inp);
  }
  if (!files.length) { console.error('--sheet: no PNG inputs'); process.exit(1); }
  const nSheets = Math.ceil(files.length / o.per);
  for (let s = 0; s < nSheets; s++) {
    const chunk = files.slice(s * o.per, (s + 1) * o.per);
    const items = [];
    for (const f of chunk) items.push({ slug: basename(f, '.png'), file: f, img: await readImage(f) });
    const { img, legend } = renderSheet(items, { cols: o.cols, per: o.per, top: o.cropTop || 1200, tail: o.tail });
    const out = sheetName(o.out, nSheets, s);
    await writeImage(out, img);
    const legendPath = `${out.slice(0, out.length - extname(out).length)}.json`;
    writeFileSync(legendPath, `${JSON.stringify({ sheet: out, tiles: legend }, null, 2)}\n`);
    console.log(`sheet ${String(s + 1).padStart(2, '0')}: ${legend.length} tiles → ${out} (${img.width}x${img.height}; legend ${legendPath})`);
    for (const t of legend) console.log(`  ${String(t.i).padStart(2)} ${t.slug}  ${t.width}x${t.height}  top ${t.cropTop}${t.cropTail ? ` + tail ${t.cropTail}` : ' (whole page)'}  scale ${t.scale}`);
  }
}

// CLI only when invoked directly (compare real paths — a symlinked tmpdir
// makes argv[1] and import.meta.url differ); importable as a library otherwise.
const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) {
  main().catch((e) => { console.error(`review-image error: ${e.message}`); process.exit(1); });
}
