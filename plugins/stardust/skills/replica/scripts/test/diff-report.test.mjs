#!/usr/bin/env node
// skills/replica/scripts/test/diff-report.test.mjs — diff-report.mjs: blockTable (red pixels per block, the rows
// outside every block), scaleTo, cropRows, pickDiff, parseArgs, --help with no browser; then end to end where playwright
// and pngjs are importable (a skip line otherwise): a gate dir with synthetic live / build / diff PNGs and a served
// build page with two blocks → the hot block named, report.html + overview + crops written. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockTable, cropRows, parseArgs, pickDiff, scaleTo } from '../diff-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'diff-report.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// a W×H RGBA image, white, with red (255,0,0) rows y0..y1
const image = (W, H, redRows = []) => {
  const data = Buffer.alloc(W * H * 4, 255);
  for (const [y0, y1] of redRows) for (let y = y0; y < y1; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 4; data[i + 1] = 0; data[i + 2] = 0; }
  return { width: W, height: H, data };
};

await check('blockTable: the red share per block (clipped to the image), and the rows no block covers as "outside blocks"', () => {
  const t = blockTable(image(10, 100, [[50, 60]]), [{ name: 'hero', x: 0, y: 0, w: 10, h: 40 }, { name: 'cards', x: 0, y: 40, w: 10, h: 40 }, { name: 'tail', x: 0, y: 95, w: 10, h: 50 }]);
  assert.deepEqual(t.blocks.map((r) => [r.name, r.y0, r.y1, Number(r.pct.toFixed(1))]), [['hero', 0, 40, 0], ['cards', 40, 80, 25], ['tail', 95, 100, 0]]);
  assert.equal(t.outside.px, 10 * 15); assert.equal(t.outside.differing, 0);
});
await check('blockTable: anti-aliased (yellow) pixels are not counted — pixel-compare\'s own rule', () => {
  const img = image(4, 4); for (let i = 0; i < img.data.length; i += 4) { img.data[i + 2] = 0; } // yellow everywhere
  assert.equal(blockTable(img, [{ name: 'b', x: 0, y: 0, w: 4, h: 4 }]).blocks[0].differing, 0);
});
await check('scaleTo / cropRows: nearest-neighbour width, clipped rows', () => {
  const s = scaleTo(image(100, 400), 25); assert.deepEqual([s.width, s.height, s.data.length], [25, 100, 25 * 100 * 4]);
  const c = cropRows(image(10, 50, [[10, 20]]), 5, 30); assert.deepEqual([c.width, c.height], [10, 25]); assert.equal(c.data[(5 * 10) * 4 + 1], 0, 'row 10 → crop row 5 is red');
  assert.equal(cropRows(image(10, 50), 40, 90).height, 10);
});
await check('pickDiff: diff-final.png first, else the newest diff-*.png; none → an error naming the dir', () => {
  const d = mkdtempSync(join(tmpdir(), 'dr-pick-'));
  writeFileSync(join(d, 'diff-iter1.png'), 'x'); writeFileSync(join(d, 'diff-iter2.png'), 'x');
  utimesSync(join(d, 'diff-iter1.png'), new Date(1e12), new Date(1e12));
  assert.equal(pickDiff(d), join(d, 'diff-iter2.png'));
  writeFileSync(join(d, 'diff-final.png'), 'x'); assert.equal(pickDiff(d), join(d, 'diff-final.png'));
  assert.equal(pickDiff(d, 'diff-iter1.png'), join(d, 'diff-iter1.png'));
  const e = mkdtempSync(join(tmpdir(), 'dr-none-')); assert.throws(() => pickDiff(e), /no diff-\*\.png in/);
  rmSync(d, { recursive: true }); rmSync(e, { recursive: true });
});
await check('parseArgs: two positionals, the flags; an unknown flag or a missing argument throws', () => {
  const { dir, build, opts } = parseArgs(['n', 's', 'gates/home-1440', 'http://x/', '--width', '1440', '--top', '2', '--json']);
  assert.deepEqual([dir, build, opts.width, opts.top, opts.json], ['gates/home-1440', 'http://x/', 1440, 2, true]);
  assert.throws(() => parseArgs(['n', 's', 'a']), /need <gateDir> and <buildURL>/);
  assert.throws(() => parseArgs(['n', 's', 'a', 'b', '--nope']), /unknown flag --nope/);
});
await check('--help answers with no browser and names the block rule', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /data-block-name/); assert.match(r.stdout, /report\.html/);
});

// ---- end to end (needs playwright + pngjs) ----------------------------------------------------------
const pw = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('playwright'); await import('pngjs');"], { cwd: dirname(SCRIPT), encoding: 'utf8' });
if (pw.status !== 0) console.log('skip  end-to-end diff-report (playwright / pngjs not importable here)');
else {
  const { PNG } = await import('pngjs');
  const dir = mkdtempSync(join(tmpdir(), 'dr-e2e-'));
  const png = (img) => { const p = new PNG({ width: img.width, height: img.height }); img.data.copy(p.data); return PNG.sync.write(p); };
  writeFileSync(join(dir, 'live.png'), png(image(800, 1000)));
  writeFileSync(join(dir, 'build.png'), png(image(800, 1000)));
  writeFileSync(join(dir, 'diff-iter1.png'), png(image(800, 1000, [[500, 600]])));
  const page = '<!doctype html><html><head><style>body{margin:0}main div{height:400px}</style></head><body><main><div class="hero block" data-block-name="hero"></div><div class="cards block" data-block-name="cards"></div></main><div style="height:200px"></div></body></html>';
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const r = await new Promise((done) => {
    const c = spawn(process.execPath, [SCRIPT, dir, url, '--width', '800']);
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => done({ status, stdout, stderr }));
  });
  await check('e2e: the block holding the red rows is named hot (25 %), the other 0 %; report.html, overview.png and the crop triplet written', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /#\s*1 hero\s+y\s+0–400\s+0\.00 %/, r.stdout);
    assert.match(r.stdout, /#\s*2 cards\s+y\s+400–800\s+25\.00 %\s+◄◄/, r.stdout);
    for (const f of ['report.html', 'overview.png', 'crop-1-live.png', 'crop-1-build.png', 'crop-1-diff.png']) assert.ok(existsSync(join(dir, 'report', f)), f);
  });
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failing` : '\ndiff-report: all checks passed');
process.exit(failed ? 1 : 0);
