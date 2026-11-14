import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadImaging, PNG, pixelmatch, sharp } from './imaging.mjs';

test('a missing library is UNSUPPORTED (exit 2) with the install hint, before anything runs', async () => {
  const load = async (name) => {
    if (name === 'pngjs') throw new Error("Cannot find package 'pngjs'");
    return { default: () => name };
  };
  await assert.rejects(loadImaging(load), (e) => {
    assert.equal(e.code, 'UNSUPPORTED');
    assert.match(e.message, /need pngjs: Cannot find package 'pngjs'/);
    assert.match(
      e.hint,
      /pnpm add --dir <dir> "github:adobe\/skills#<ref>&path:\/plugins\/web\/cli"/,
    );
    return true;
  });
});

test('the stand-ins forward to the loaded libraries: calls, PNG statics and new PNG()', async () => {
  await loadImaging();
  const img = new PNG({ width: 2, height: 1 });
  img.data.fill(255);
  const back = PNG.sync.read(PNG.sync.write(img));
  assert.equal(back.width, 2);
  const other = new PNG({ width: 2, height: 1 });
  other.data.fill(0);
  assert.equal(pixelmatch(img.data, other.data, null, 2, 1, { threshold: 0.1 }), 2);
  const meta = await sharp(PNG.sync.write(img)).metadata();
  assert.deepEqual([meta.width, meta.height], [2, 1]);
});
