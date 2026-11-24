/**
 * Writes the images an agent judges a region on: today's side-by-side sheet (for humans), and
 * views that fit the box of `views.mjs`: a scaled overview to orient, and full-resolution crops
 * (SOURCE, EDS, DIFF stacked) around the differences. PNG only; a crop too heavy is split.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOX,
  clusters,
  cropPlan,
  diffMask,
  fits,
  GAP,
  LABEL_H,
  overviewScale,
  PANELS,
} from './views.mjs';
import { sharp } from './imaging.mjs';

const GREY = { r: 136, g: 136, b: 136, alpha: 1 };
const b64Bytes = (bytes) => Math.ceil(bytes / 3) * 4;
const raw = (w, h) => ({ width: w, height: h, channels: 4 });

/** Pads an image to w x h with magenta, so source and EDS of different sizes line up. */
export function padTo(img, w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) buf.writeUInt32BE(0xff00ffff, i * 4);
  for (let y = 0; y < img.h; y += 1) {
    img.data.copy(buf, y * w * 4, y * img.w * 4, y * img.w * 4 + Math.min(img.w, w) * 4);
  }
  return buf;
}

async function sheetPng({ pa, pb, d, w, h }) {
  const png = (buf) =>
    sharp(buf, { raw: raw(w, h) })
      .png()
      .toBuffer();
  return sharp({ create: { width: w * 3 + 40, height: h, channels: 4, background: GREY } })
    .composite([
      { input: await png(pa), left: 0, top: 0 },
      { input: await png(pb), left: w + 20, top: 0 },
      { input: await png(d), left: 2 * w + 40, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Today's `side.png`: source | EDS | diff, shrunk to at most 1800 px wide (for humans). */
export async function writeSheet(region, file) {
  const sheet = await sheetPng(region);
  await sharp(sheet)
    .resize({ width: Math.min(1800, region.w * 3 + 40) })
    .png()
    .toFile(file);
}

function label(text, width) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_H}">` +
    `<rect width="100%" height="100%" fill="#333"/><text x="6" y="14" fill="#fff" ` +
    `font-family="monospace" font-size="12">${text}</text></svg>`;
  return Buffer.from(svg);
}

function extract(buf, { w: fullW }, p) {
  const out = Buffer.alloc(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) {
    const from = ((p.y + y) * fullW + p.x) * 4;
    buf.copy(out, y * p.w * 4, from, from + p.w * 4);
  }
  return out;
}

async function cropPng(region, p) {
  const panelH = LABEL_H + p.h;
  const names = [`SOURCE x=${p.x} y=${p.y} ${p.w}x${p.h}`, 'EDS', 'DIFF (red = differs)'];
  const layers = [region.pa, region.pb, region.d].flatMap((buf, i) => [
    { input: label(names[i], p.w), left: 0, top: i * (panelH + GAP) },
    {
      input: extract(buf, region, p),
      raw: raw(p.w, p.h),
      left: 0,
      top: i * (panelH + GAP) + LABEL_H,
    },
  ]);
  const h = PANELS * panelH + (PANELS - 1) * GAP;
  return sharp({ create: { width: p.w, height: h, channels: 4, background: GREY } })
    .composite(layers)
    .png()
    .toBuffer();
}

async function overviewPng(region) {
  const sheet = await sheetPng(region);
  const [sw, sh] = [region.w * 3 + 40, region.h];
  let s = overviewScale(sw, sh + LABEL_H);
  for (;;) {
    const [w, h] = [Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s))];
    const body = await sharp(sheet).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer();
    const text =
      `OVERVIEW scaled to ${Math.round(s * 100)} %: not for pixel judgment ` +
      '(SOURCE | EDS | DIFF)';
    const png = await sharp({
      create: { width: w, height: h + LABEL_H, channels: 4, background: GREY },
    })
      .composite([
        { input: label(text, w), left: 0, top: 0 },
        { input: body, left: 0, top: LABEL_H },
      ])
      .png()
      .toBuffer();
    if (fits({ w, h: h + LABEL_H, b64Bytes: b64Bytes(png.length) })) return { png, s, w, h };
    s *= 0.9;
  }
}

const countIn = (mask, fullW, p) => {
  let n = 0;
  for (let y = p.y; y < p.y + p.h; y++) {
    for (let x = p.x; x < p.x + p.w; x++) n += mask[y * fullW + x];
  }
  return n;
};

/**
 * Writes overview.png, crop-<n>.png and views.json into `dir`.
 *
 * Args:
 *   region: { pa, pb, d, w, h }: source, EDS and pixelmatch diff as RGBA buffers of one size.
 * Returns: { mode: 'none'|'crops'|'bands', views }.
 */
export async function writeViews(region, dir, { box = BOX } = {}) {
  mkdirSync(dir, { recursive: true });
  const { w, h } = region;
  const mask = diffMask(region.d, w, h);
  const plan = cropPlan(clusters(mask, w, h), { w, h }, { box });
  const o = await overviewPng(region);
  writeFileSync(join(dir, 'overview.png'), o.png);
  const views = [
    {
      file: 'overview.png',
      role: 'overview',
      x: 0,
      y: 0,
      w,
      h,
      scale: o.s,
      imgW: o.w,
      imgH: o.h + LABEL_H,
      b64Bytes: b64Bytes(o.png.length),
      diffPixels: countIn(mask, w, { x: 0, y: 0, w, h }),
    },
  ];
  const queue = [...plan.pieces];
  while (queue.length) {
    const p = queue.shift();
    const png = await cropPng(region, p);
    if (b64Bytes(png.length) > box.maxB64 && p.h > 1) {
      const top = Math.ceil(p.h / 2);
      queue.unshift({ ...p, h: top }, { ...p, y: p.y + top, h: p.h - top });
      continue;
    }
    const file = `crop-${views.length}.png`;
    writeFileSync(join(dir, file), png);
    const { width, height } = await sharp(png).metadata();
    views.push({
      file,
      role: 'crop',
      ...p,
      scale: 1,
      imgW: width,
      imgH: height,
      b64Bytes: b64Bytes(png.length),
      diffPixels: countIn(mask, w, p),
    });
  }
  writeFileSync(
    join(dir, 'views.json'),
    `${JSON.stringify({ box, mode: plan.mode, views }, null, 2)}\n`,
  );
  return { mode: plan.mode, views };
}
