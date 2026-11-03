#!/usr/bin/env node
// The --hide capture contract, alongside stitch-shot.test.mjs's baseline and hardening coverage.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const STITCH = join(HERE, '..', 'stitch-shot.mjs');
const PIXEL = join(HERE, '..', 'pixel-compare.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'stitch-shot-hide-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

let playwrightOk = false;
try { await import('playwright'); await import('pngjs'); playwrightOk = true; } catch { console.log('skip  stitch-shot --hide checks (playwright or pngjs not importable here; run this test in an environment that has them)'); }

if (playwrightOk) {
  const { PNG } = await import('pngjs');
  const HEADER = 64;
  const FOOTER = 120;
  const stripes = Array.from({ length: 8 }, (_, i) => `<section style="height:420px;background:hsl(${i * 40} 60% 70%)"><h2>Section ${i}</h2></section>`).join('');
  const base = 'body{margin:0;font:16px/24px sans-serif}';
  const chrome = `header{height:${HEADER}px}header nav{position:fixed;top:0;left:0;width:100%;height:${HEADER}px;background:#123;color:#fff;z-index:2}footer{height:${FOOTER}px;background:#345;color:#fff}`;
  const shell = (content) => `<!doctype html><meta charset="utf-8"><style>${base}${chrome}.sticky{position:sticky;top:64px;height:40px;background:#aaf}</style><body><header><nav>Head</nav></header><main>${content}${stripes}</main><footer>Foot</footer></body>`;
  const pages = {
    '/bare': `<!doctype html><meta charset="utf-8"><style>${base}</style><body><main>${stripes}</main></body>`,
    '/chrome': shell(''),
    '/sticky': shell('<aside class="sticky">Hidden sticky</aside><script>addEventListener("scroll",()=>{if(getComputedStyle(document.querySelector(".sticky")).display!=="none")document.body.style.borderTop="30px solid red";});</script>'),
    '/late-denial': '<!doctype html><header id="wall"></header><main>Loading the page</main><script>setTimeout(()=>{document.querySelector("#wall").textContent="Can\'t process your request. Incident Number 42";},50);</script>',
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
    await check(`@${width}: --hide removes chrome, --dismiss only clicks, and an unmatched selector changes nothing`, async () => {
      const [bare, plain, hidden, dismissed, nothing] = await Promise.all([
        shoot('/bare', width),
        shoot('/chrome', width),
        shoot('/chrome', width, ['--hide', 'header,footer']),
        shoot('/chrome', width, ['--dismiss', 'header,footer']),
        shoot('/chrome', width, ['--hide', '.no-such-element']),
      ]);
      const main = heightOf(bare);
      assert.equal(heightOf(plain), main + HEADER + FOOTER);
      assert.equal(heightOf(hidden), main);
      assert.equal(await pixelPct(bare, hidden), 0);
      assert.ok(await pixelPct(bare, plain) > 10);
      assert.equal(heightOf(dismissed), main + HEADER + FOOTER);
      assert.equal(heightOf(nothing), main + HEADER + FOOTER);
      assert.equal(await pixelPct(plain, nothing), 0);
    });
  }

  await check('--hide precedes settle for a sticky element while a separate fixed header is captured once', async () => {
    const [reference, hidden] = await Promise.all([
      shoot('/chrome', 360, ['--settle', '--no-dismiss']),
      shoot('/sticky', 360, ['--hide', '.sticky', '--settle', '--no-dismiss']),
    ]);
    assert.equal(heightOf(hidden), heightOf(reference));
    assert.equal(await pixelPct(reference, hidden), 0);
    const capture = JSON.parse(readFileSync(hidden.replace(/\.png$/, '.capture.json'), 'utf8'));
    assert.equal(capture.fixedLayers.capture, 'once');
    assert.ok(capture.fixedLayers.count >= 1);
  });

  await check('--hide cannot conceal a late denial page from the post-dismissal check', async () => {
    const out = join(scratch, 'late-denial.png');
    const r = await node(STITCH, [`${origin}/late-denial`, out, '--hide', '#wall']);
    assert.equal(r.status, 3, r.stderr || r.stdout);
    assert.match(r.stderr, /denial page/);
    assert.equal(existsSync(out), false);
    assert.equal(existsSync(out.replace(/\.png$/, '.capture.json')), false);
  });

  server.closeAllConnections();
  server.close();
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
