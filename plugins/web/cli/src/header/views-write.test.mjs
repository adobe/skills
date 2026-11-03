import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { BOX, fits } from './views.mjs';
import { padTo, writeSheet, writeViews } from './views-write.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'views-write-'));
const solid = (w, h, [r, g, b]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4);
  return data;
};
const diffOf = (pa, pb, w, h) => {
  const d = Buffer.alloc(w * h * 4);
  pixelmatch(pa, pb, d, w, h, { threshold: 0.1 });
  return d;
};
const viewsJson = (dir) => JSON.parse(readFileSync(join(dir, 'views.json'), 'utf8'));

async function checkFiles(dir) {
  for (const v of viewsJson(dir).views) {
    const buf = readFileSync(join(dir, v.file));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], v.file);
    const { width, height } = await sharp(buf).metadata();
    assert.ok(fits({ w: width, h: height, b64Bytes: Math.ceil(buf.length / 3) * 4 }), v.file);
  }
}

test('identical images give an overview only', async () => {
  const pa = solid(300, 200, [20, 40, 60]);
  const dir = tmp();
  const r = await writeViews({ pa, pb: pa, d: diffOf(pa, pa, 300, 200), w: 300, h: 200 }, dir);
  assert.equal(r.mode, 'none');
  assert.deepEqual(viewsJson(dir).views.map((v) => v.role), ['overview']);
  await checkFiles(dir);
});

test('one small difference gives one full-size crop covering it', async () => {
  const [w, h] = [1440, 1200];
  const pa = solid(w, h, [240, 240, 240]);
  const pb = Buffer.from(pa);
  for (let y = 600; y < 630; y++) {
    for (let x = 700; x < 730; x++) pb.set([0, 0, 0, 255], (y * w + x) * 4);
  }
  const dir = tmp();
  const r = await writeViews({ pa, pb, d: diffOf(pa, pb, w, h), w, h }, dir);
  assert.equal(r.mode, 'crops');
  const crops = viewsJson(dir).views.filter((v) => v.role === 'crop');
  assert.equal(crops.length, 1);
  const [c] = crops;
  assert.ok(c.x <= 700 && c.y <= 600 && c.x + c.w >= 730 && c.y + c.h >= 630);
  assert.equal(c.scale, 1);
  await checkFiles(dir);
});

test('busy regions that differ everywhere are split until every PNG fits', async () => {
  const [w, h] = [1440, 2400];
  const pa = randomFillSync(Buffer.alloc(w * h * 4));
  for (let i = 3; i < pa.length; i += 4) pa[i] = 255;
  const pb = Buffer.concat([pa.subarray(4), Buffer.from([0, 0, 0, 255])]);
  const dir = tmp();
  const r = await writeViews({ pa, pb, d: diffOf(pa, pb, w, h), w, h }, dir);
  assert.equal(r.mode, 'bands');
  const views = viewsJson(dir).views;
  assert.ok(views.every((v) => v.b64Bytes <= BOX.maxB64));
  assert.equal(views.filter((v) => v.role === 'crop').reduce((s, v) => s + v.h, 0), h);
  await checkFiles(dir);
});

test('source and EDS of different heights are padded to one size', async () => {
  const a = { data: solid(200, 50, [10, 10, 10]), w: 200, h: 50 };
  const pa = padTo(a, 200, 60);
  assert.equal(pa.length, 200 * 60 * 4);
  assert.deepEqual([...pa.subarray(200 * 55 * 4, 200 * 55 * 4 + 4)], [255, 0, 255, 255]);
  const pb = solid(200, 60, [10, 10, 10]);
  const r = await writeViews({ pa, pb, d: diffOf(pa, pb, 200, 60), w: 200, h: 60 }, tmp());
  assert.equal(r.mode, 'crops');
});

test('writeSheet keeps today\'s side-by-side sheet, 1800 px wide at desktop', async () => {
  const pa = solid(1440, 100, [0, 0, 0]);
  const file = join(tmp(), 'side.png');
  await writeSheet({ pa, pb: pa, d: diffOf(pa, pa, 1440, 100), w: 1440, h: 100 }, file);
  assert.equal((await sharp(file).metadata()).width, 1800);
});
