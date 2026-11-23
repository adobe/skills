import { readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { sharp } from './imaging.mjs';

/**
 * In-page source of `async (page, path) => {}`: a full-page screenshot. Chromium leaves full-page
 * shots blank below about 16384 px on some pages, so taller pages are shot in 8000 px tiles
 * (path.tile-<n>.png) that stitchTiles() joins on the Node side.
 */
export const TILED_SHOT = `async (page, path) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h <= 16000) return page.screenshot({ path, fullPage: true });
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (let y = 0, n = 0; y < h; y += 8000, n += 1) {
    await page.screenshot({ path: path + '.tile-' + n + '.png', fullPage: true,
      clip: { x: 0, y, width, height: Math.min(8000, h - y) } });
  }
}`;

/** Joins path.tile-<n>.png (TILED_SHOT) top to bottom into path and removes them; no tiles: no-op. */
export async function stitchTiles(path) {
  const prefix = `${basename(path)}.tile-`;
  const tiles = readdirSync(dirname(path))
    .filter((f) => f.startsWith(prefix))
    .sort((a, b) => parseInt(a.slice(prefix.length), 10) - parseInt(b.slice(prefix.length), 10))
    .map((f) => join(dirname(path), f));
  if (!tiles.length) return;
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  let top = 0;
  const parts = tiles.map((input, i) => {
    const p = { input, left: 0, top };
    top += metas[i].height;
    return p;
  });
  await sharp({ create: { width: metas[0].width, height: top, channels: 4, background: '#fff' } })
    .composite(parts)
    .png()
    .toFile(path);
  tiles.forEach((t) => rmSync(t));
}
