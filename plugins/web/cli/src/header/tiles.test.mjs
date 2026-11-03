import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { stitchTiles } from './pw.mjs';

const png = (h, v) => sharp({ create: { width: 4, height: h, channels: 3, background: { r: v, g: v, b: v } } }).png();

test('stitchTiles stacks tiles in numeric order into the shot and removes them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plg-tiles-'));
  const shot = join(dir, 'mobile.png');
  // 11 tiles: tile-10 must come after tile-9, not after tile-1
  for (let i = 0; i <= 10; i += 1) await png(i === 10 ? 3 : 2, i * 20).toFile(`${shot}.tile-${i}.png`);
  await stitchTiles(shot);
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.height, 23);
  const px = (y) => data[y * 4 * info.channels];
  assert.equal(px(22), 200);
  assert.equal(px(2), 20);
  assert.equal(px(19), 180);
  assert.equal(existsSync(`${shot}.tile-0.png`), false);
});

test('stitchTiles leaves a single screenshot alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plg-tiles-'));
  const shot = join(dir, 'desktop.png');
  await png(5, 9).toFile(shot);
  await stitchTiles(shot);
  assert.equal((await sharp(shot).metadata()).height, 5);
});
