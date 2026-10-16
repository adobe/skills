#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — the chrome-parity.mjs contract. Part (a), no browser:
// argument parsing, the --live-cache key, the region diff, and --help / usage errors from a copy with no
// playwright and no diff dir beside it. Part (b): end-to-end against fixture pages served from this process —
// runs only where playwright is importable, prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, cacheKey, compareRegion, UsageError } from '../chrome-parity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'chrome-parity.mjs');
const root = mkdtempSync(join(tmpdir(), 'chrome-parity-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: root }); return { code: r.status, out: r.stdout, err: r.stderr }; };
// The e2e runs must not block the event loop — the fixture server answers from THIS process.
const runAsync = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: root }); let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => done({ code, out, err }));
});

// ---- (a) pure ----------------------------------------------------------------------------------------
await check('parseArgs: header + footer by default, --region in between, a missing URL is a usage error (code 1)', () => {
  const { live, build, opts } = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--region', 'strip=.quick-links|.quicklinks']);
  assert.equal(live, 'https://live.example/'); assert.equal(build, 'http://127.0.0.1:1/b.html');
  assert.deepEqual(opts.regions.map((r) => `${r.name}=${r.live}|${r.build}`), ['header=header|header', 'strip=.quick-links|.quicklinks', 'footer=footer|footer']);
  assert.throws(() => parseArgs(['https://live.example/']), (e) => e instanceof UsageError && e.code === 1 && /need <liveURL> and <buildURL>/.test(e.message));
});

await check('cacheKey: url, width and the live region selectors', () => {
  const { live, opts } = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--width', '360']);
  assert.deepEqual(cacheKey(live, opts), { url: 'https://live.example/', width: 360, regions: ['header=header', 'footer=footer'] });
});

await check('compareRegion: a region pushed down on the live side reads as a vertical offset', () => {
  const side = (y, found = true) => ({ found, sel: 'header', rect: { x: 0, y, w: 1440, h: 80 }, position: 'static', backgroundColor: 'rgb(255, 255, 255)', atoms: [{ key: 'home', text: 'Home', tag: 'a', rect: { x: 20, y: y + 30, w: 40, h: 20 }, box: { x: 20, y: y + 30, w: 40, h: 20 }, boxTag: 'a', style: { color: 'red' }, boxStyle: null }], icons: [] });
  const r = compareRegion('header', side(88), side(0), 1);
  assert.deepEqual(r.findings.map((f) => f.kind), ['REGION BOX', 'PAIR']);
  assert.match(r.findings[0].msg, /^Δy -88px \(88→0\)$/);
});

await check('CLI: --help answers and a usage error exits 1, from a copy with no playwright and no diff dir', () => {
  const solo = join(root, 'solo'); mkdirSync(solo); cpSync(SCRIPT, join(solo, 'chrome-parity.mjs'));
  const h = run(join(solo, 'chrome-parity.mjs'), ['--help']);
  assert.equal(h.code, 0, h.err); assert.match(h.out, /Usage:/); assert.match(h.out, /--live-cache/);
  const u = run(join(solo, 'chrome-parity.mjs'), ['https://live.example/']);
  assert.equal(u.code, 1); assert.match(u.err, /need <liveURL> and <buildURL>/); assert.match(u.err, /Usage:/);
});

// ---- (b) end-to-end, where playwright resolves from the script's location ---------------------------
const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "import('playwright').then(() => process.exit(0), () => process.exit(1))"], { cwd: dirname(SCRIPT) });
if (pwProbe.status !== 0) {
  console.log('- e2e: playwright not importable from the scripts dir — skipped (run the copy inside a project with playwright installed)');
} else {
  const chrome = '<header><nav><a href="#">Home</a> <a href="#">Products</a> <a href="#">Contact</a></nav></header><main><h1>Title</h1><p>Body copy.</p></main><footer><p>Footer text</p></footer>';
  const page = (bar) => `<!doctype html><html><head><style>body{margin:0;font:16px/1.4 sans-serif}header,footer{padding:20px}.geo-bar{height:88px;box-sizing:border-box;padding:20px;background:#eee}</style></head><body>${bar}${chrome}</body></html>`;
  const pages = { '/live': page('<div class="geo-bar">Visiting from another region? <a href="#">Switch</a></div>'), '/build': page('') };
  const server = createServer((req, res) => { const body = pages[req.url.split('?')[0]]; if (!body) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await check('e2e: an in-flow bar above the live header reads as a vertical offset (exit 2)', async () => {
      const r = await runAsync([`${base}/live`, `${base}/build`]);
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.out, /REGION BOX +Δy -88px \(88→0\)/);
    });
  } finally {
    server.close();
  }
}

rmSync(root, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('chrome-parity.test: all checks passed');
