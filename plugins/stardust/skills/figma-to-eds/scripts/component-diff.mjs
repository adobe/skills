#!/usr/bin/env node
// Component diff — gate 2 of figma-to-eds (reference/gates.md).
// Renders a block test page at the Figma gate frame's design width,
// screenshots the target element, downscales it in-browser to the Figma
// export's exact pixel size (Figma desktop MCP caps exports at 1024px
// per axis), and pixelmatch-diffs the pair.
//
// Usage: node component-diff.mjs --figma <frame.png> --page <file.html|url>
//        --width <frame design width> --out <dir>
//        [--selector <css>] [--threshold <pct>] [--pm <0..1>]
//        [--crop top,right,bottom,left]  crop applied to the FIGMA image,
//        in DESIGN px (scaled internally) — e.g. cut chrome baked into a
//        kit component: --crop 118,0,0,0
// Env: NODE_MODULES_DIR — node_modules containing playwright, pixelmatch, pngjs.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const figmaPath = arg('--figma'); const pagePath = arg('--page');
const designWidth = parseInt(arg('--width'), 10); const outDir = arg('--out');
const selector = arg('--selector', 'main');
const thresholdPct = parseFloat(arg('--threshold', '5'));
const pmThreshold = parseFloat(arg('--pm', '0.1'));
if (!figmaPath || !pagePath || !designWidth || !outDir) {
  console.error('usage: --figma <png> --page <html> --width <px> --out <dir> [--selector main] [--threshold 5]');
  process.exit(2);
}

const req = createRequire(process.env.NODE_MODULES_DIR
  ? join(resolve(process.env.NODE_MODULES_DIR), 'diff-resolver.cjs') : import.meta.url);
const { chromium } = req('playwright');
const pixelmatchMod = req('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod; // ESM-built package under CJS require
const { PNG } = req('pngjs');

mkdirSync(outDir, { recursive: true });
let figma = PNG.sync.read(readFileSync(figmaPath));
let scale = figma.width / designWidth; // <1 when Figma downscaled the export
const crop = (arg('--crop', '0,0,0,0')).split(',').map(Number);
if (crop.some((v) => v > 0)) {
  const [t, r, b, l] = crop.map((v) => Math.round(v * scale));
  const cw = figma.width - l - r; const ch = figma.height - t - b;
  const c = new PNG({ width: cw, height: ch });
  PNG.bitblt(figma, c, l, t, cw, ch, 0, 0);
  figma = c;
  scale = figma.width / (designWidth - crop[1] - crop[3]);
}

const effectiveWidth = designWidth - (crop[1] || 0) - (crop[3] || 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: effectiveWidth, height: 1200 }, deviceScaleFactor: 1 });
const url = /^(https?|file):/.test(pagePath) ? pagePath : 'file://' + resolve(pagePath);
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(150); // settle animations/layout

const el = page.locator(selector).first();
const native = await el.screenshot();
writeFileSync(join(outDir, 'eds.png'), native);

// in-browser downscale to the Figma export's exact width (no extra deps)
const scaled = await page.evaluate(async ({ b64, w }) => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const h = Math.round(img.height * (w / img.width));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
  return btoa(s);
}, { b64: native.toString('base64'), w: figma.width });
await browser.close();

const eds = PNG.sync.read(Buffer.from(scaled, 'base64'));
writeFileSync(join(outDir, 'eds-scaled.png'), PNG.sync.write(eds));
copyFileSync(figmaPath, join(outDir, 'figma.png'));

// pad both to common canvas (white) so height drift shows as diff, not crash
const W = Math.max(eds.width, figma.width);
const H = Math.max(eds.height, figma.height);
const pad = (src) => {
  const p = new PNG({ width: W, height: H, fill: true });
  p.data.fill(255);
  PNG.bitblt(src, p, 0, 0, src.width, src.height, 0, 0);
  return p;
};
const a = pad(eds); const b = pad(figma);
const diff = new PNG({ width: W, height: H });
const diffPixels = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: pmThreshold });
writeFileSync(join(outDir, 'diff.png'), PNG.sync.write(diff));

const pct = (100 * diffPixels) / (W * H);
const heightDrift = eds.height - figma.height;
const verdict = {
  figma: figmaPath, page: pagePath, selector, designWidth,
  crop: crop.join(','), pmThreshold,
  figmaSize: { w: figma.width, h: figma.height },
  edsScaledSize: { w: eds.width, h: eds.height },
  scale: Number(scale.toFixed(4)), heightDriftPx: heightDrift,
  diffPixels, diffPct: Number(pct.toFixed(2)), thresholdPct,
  pass: pct <= thresholdPct,
};
writeFileSync(join(outDir, 'verdict.json'), JSON.stringify(verdict, null, 1));
console.log(`${verdict.pass ? 'PASS' : 'FAIL'} ${pct.toFixed(2)}% diff (threshold ${thresholdPct}%), height drift ${heightDrift}px -> ${outDir}`);
process.exit(verdict.pass ? 0 : 1);
