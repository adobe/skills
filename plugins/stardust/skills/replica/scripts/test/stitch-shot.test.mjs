#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — stitch-shot's --hide (the rest of the instrument is exercised by
// the gate runs): --help answers and names it; against a pair of in-process pages — the same `main` bare, and wrapped
// in a header (its bar fixed, its space reserved in flow) and a footer — a capture with --hide on the chrome is the
// bare page's capture to the pixel at 1440 and 360 (a fixed bar not repeated in any chunk), a capture without --hide is
// taller and well above the pixel bar, a selector that matches nothing changes nothing, and --dismiss, which clicks,
// leaves the chrome in the capture. Needs playwright and pngjs (it prints a skip line without them). Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const STITCH = join(HERE, '..', 'stitch-shot.mjs');
const PIXEL = join(HERE, '..', 'pixel-compare.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'stitch-shot-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

let playwrightOk = false;
try { await import('playwright'); await import('pngjs'); playwrightOk = true; } catch { console.log('skip  stitch-shot checks (playwright or pngjs not importable here; run this test in an environment that has them)'); }

if (playwrightOk) {
  const { PNG } = await import('pngjs');
  const HEADER = 64;
  const FOOTER = 120;
  const stripes = Array.from({ length: 8 }, (_, i) => `<section style="height:420px;background:hsl(${i * 40} 60% 70%)"><h2>Section ${i}</h2></section>`).join('');
  const base = 'body{margin:0;font:16px/24px sans-serif}';
  const pages = {
    '/bare': `<!doctype html><meta charset="utf-8"><style>${base}</style><body><main>${stripes}</main></body>`,
    '/chrome': `<!doctype html><meta charset="utf-8"><style>${base}header{height:${HEADER}px}header nav{position:fixed;top:0;left:0;width:100%;height:${HEADER}px;background:#123;color:#fff;z-index:2}footer{height:${FOOTER}px;background:#345;color:#fff}</style><body><header><nav>Head</nav></header><main>${stripes}</main><footer>Foot</footer></body>`,
  };
  const server = createServer((req, res) => { res.writeHead(pages[req.url] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(pages[req.url] ?? ''); });
  await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const node = (script, args) => exec(process.execPath, [script, ...args]).then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));
  let shots = 0;
  const shoot = async (path, width, extra = []) => {
    shots += 1;
    const file = join(scratch, `shot-${shots}.png`);
    const r = await node(STITCH, [`${origin}${path}`, file, '--width', String(width), ...extra]);
    assert.equal(r.status, 0, `${path} ${extra.join(' ')}: ${r.stderr}`);
    return file;
  };
  const heightOf = (file) => PNG.sync.read(readFileSync(file)).height;
  const pixelPct = async (a, b) => {
    const r = await node(PIXEL, [a, b, '--json', '--out', join(scratch, 'diff.png')]);
    assert.ok([0, 2].includes(r.status), r.stderr);
    return JSON.parse(r.stdout).pct;
  };

  await check('--help answers before any capture and names --hide, beside --dismiss', async () => {
    const r = await node(STITCH, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--hide <sel,…>\s+remove the matched elements from the capture/);
    assert.match(r.stdout, /--dismiss <sel,…>/);
  });

  for (const width of [1440, 360]) {
    await check(`@${width}: --hide on the chrome captures the bare page; without it the capture is taller and over the pixel bar; --dismiss only clicks; a selector that matches nothing changes nothing`, async () => {
      const [bare, plain, hidden, dismissed, nothing] = await Promise.all([
        shoot('/bare', width),
        shoot('/chrome', width),
        shoot('/chrome', width, ['--hide', 'header,footer']),
        shoot('/chrome', width, ['--dismiss', 'header,footer']),
        shoot('/chrome', width, ['--hide', '.no-such-element']),
      ]);
      const main = heightOf(bare);
      assert.equal(heightOf(plain), main + HEADER + FOOTER, 'default: the chrome and the space it reserves are captured');
      assert.equal(heightOf(hidden), main, 'the header, its reserved space and the footer are gone');
      assert.equal(await pixelPct(bare, hidden), 0, 'to the pixel: the fixed bar is in no chunk');
      assert.ok(await pixelPct(bare, plain) > 10, 'unhidden, the shifted page and the repeated bar are far over the bar');
      assert.equal(heightOf(dismissed), main + HEADER + FOOTER, '--dismiss clicks, it does not remove');
      assert.equal(heightOf(nothing), main + HEADER + FOOTER);
      assert.equal(await pixelPct(plain, nothing), 0);
    });
  }

  server.closeAllConnections();
  server.close();
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
