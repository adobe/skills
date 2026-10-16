#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — the chrome-parity.mjs contract. Part (a), no browser:
// argument parsing (--hide comma lists, repeatable; --presence needs --slug), gate-all's presence.json read
// (selO=selE halves, list entries joined, a missing slug / file hides nothing), the --live-cache key (unchanged
// without hides), the region diff, and --help / usage errors from a copy with no playwright and no diff dir
// beside it. Part (b): end-to-end against fixture pages served from this process — a live page with an in-flow
// 88 px bar above <header>, a build page without it — runs only where playwright is importable, prints a skip
// line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, cacheKey, compareRegion, readPresence, hideLists, UsageError } from '../chrome-parity.mjs';

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

await check('parseArgs: --hide takes comma lists, repeats, trims and drops empty entries; --presence needs --slug', () => {
  const { opts } = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--hide', '.geo-bar, .location-bar', '--hide', ' ,.promo-strip,', '--presence', 'p.json', '--slug', 'home']);
  assert.deepEqual(opts.hide, ['.geo-bar', '.location-bar', '.promo-strip']);
  assert.equal(opts.presence, 'p.json'); assert.equal(opts.slug, 'home');
  assert.deepEqual(parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html']).opts.hide, []);
  assert.throws(() => parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--presence', 'p.json']), (e) => e instanceof UsageError && /--presence needs --slug/.test(e.message));
  assert.throws(() => parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--hide']), (e) => e instanceof UsageError && /--hide needs a selector list/.test(e.message));
});

await check('readPresence: gate-all semantics — variable entries joined and split, selO=selE halves (build falls back to selO), main ignored', () => {
  const f = join(root, 'presence.json');
  writeFileSync(f, JSON.stringify({ home: { main: 'main=main.eds', variable: ['.geo-bar=.location-bar', '.promo-a, .promo-b'] }, about: { main: 'main' } }));
  const p = readPresence(f, 'home');
  assert.deepEqual(p.regions, [{ live: '.geo-bar', build: '.location-bar' }, { live: '.promo-a', build: '.promo-a' }, { live: '.promo-b', build: '.promo-b' }]);
  assert.equal(p.file, f); assert.equal(p.slug, 'home'); assert.match(p.note, /→ home: 3 variable region\(s\)$/);
  const none = readPresence(f, 'about');
  assert.deepEqual(none.regions, []); assert.match(none.note, /has no variable regions for about — nothing hidden$/);
  assert.deepEqual(readPresence(f, 'press').regions, []);
  const missing = readPresence(join(root, 'nope.json'), 'home');
  assert.deepEqual(missing.regions, []); assert.match(missing.note, /nope\.json not found — nothing hidden$/);
});

await check('hideLists: --hide on both sides, presence regions per side, sources kept, duplicates dropped', () => {
  const presence = { regions: [{ live: '.geo-bar', build: '.location-bar' }, { live: '.promo', build: '.promo' }] };
  assert.deepEqual(hideLists(['.promo', '.cookie-strip'], presence), {
    live: [{ sel: '.promo', source: '--hide' }, { sel: '.cookie-strip', source: '--hide' }, { sel: '.geo-bar', source: 'presence.json' }],
    build: [{ sel: '.promo', source: '--hide' }, { sel: '.cookie-strip', source: '--hide' }, { sel: '.location-bar', source: 'presence.json' }],
  });
  assert.deepEqual(hideLists([], null), { live: [], build: [] });
});

await check('cacheKey: url, width and the live region selectors; the live hide list only when non-empty', () => {
  const { live, opts } = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--width', '360']);
  assert.deepEqual(cacheKey(live, opts), { url: 'https://live.example/', width: 360, regions: ['header=header', 'footer=footer'] });
  assert.deepEqual(cacheKey(live, opts, []), cacheKey(live, opts));
  assert.deepEqual(cacheKey(live, opts, [{ sel: '.geo-bar', source: 'presence.json' }]), { url: 'https://live.example/', width: 360, regions: ['header=header', 'footer=footer'], hide: [{ sel: '.geo-bar', source: 'presence.json' }] });
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
  assert.match(h.out, /--hide <sel,…>/); assert.match(h.out, /--presence <file>/); assert.match(h.out, /--slug <slug>/);
  const u = run(join(solo, 'chrome-parity.mjs'), ['https://live.example/']);
  assert.equal(u.code, 1); assert.match(u.err, /need <liveURL> and <buildURL>/); assert.match(u.err, /Usage:/);
  const p = run(join(solo, 'chrome-parity.mjs'), ['https://live.example/', 'http://127.0.0.1:1/b.html', '--presence', join(root, 'presence.json')]);
  assert.equal(p.code, 1); assert.match(p.err, /--presence needs --slug/);
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
      assert.doesNotMatch(r.out, /hidden live:/);
    });
    await check('e2e --hide: the bar is hidden on both sides before measuring (exit 0), the hidden lines record it', async () => {
      const r = await runAsync([`${base}/live`, `${base}/build`, '--hide', '.geo-bar']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^ {2}build: \S+\n {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[--hide\]\n {2}hidden build: \.geo-bar ×0 \[--hide\]$/m);
    });
    await check('e2e presence.json: the slug\'s variable region is hidden like --hide, the source says presence.json', async () => {
      const f = join(root, 'gates-presence.json'); writeFileSync(f, JSON.stringify({ home: { variable: ['.geo-bar'] } }));
      const r = await runAsync([`${base}/live`, `${base}/build`, '--presence', f, '--slug', 'home']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^ {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[presence\.json\]$/m); assert.match(r.out, /^ {2}hidden build: \.geo-bar ×0 \[presence\.json\]$/m);
      assert.match(r.out, /^ {2}presence: \S+gates-presence\.json → home: 1 variable region\(s\)$/m);
      const none = await runAsync([`${base}/live`, `${base}/build`, '--presence', f, '--slug', 'about']);
      assert.equal(none.code, 2, none.out + none.err); assert.equal(none.out.match(/nothing hidden/g).length, 1); assert.doesNotMatch(none.out, /hidden live:/);
    });
    await check('e2e --json: hidden { live, build } and presence; an invalid selector is recorded, never a crash', async () => {
      const r = await runAsync([`${base}/live`, `${base}/build`, '--hide', '.geo-bar,[[', '--json']);
      assert.equal(r.code, 0, r.out + r.err);
      const j = JSON.parse(r.out);
      assert.deepEqual(j.hidden.live[0], { sel: '.geo-bar', source: '--hide', n: 1, h: 88 });
      assert.deepEqual(j.hidden.build[0], { sel: '.geo-bar', source: '--hide', n: 0, h: 0 });
      assert.equal(j.hidden.live[1].sel, '[['); assert.equal(j.hidden.live[1].n, 0); assert.match(j.hidden.live[1].error, /not a valid selector/);
      assert.equal(j.presence, null);
    });
    await check('e2e --live-cache: a hide list keys the cache, a hit still prints the live hidden record', async () => {
      const c = join(root, 'chrome-live.json');
      const plain = await runAsync([`${base}/live`, `${base}/build`, '--live-cache', c]);
      assert.equal(plain.code, 2, plain.out + plain.err);
      const first = await runAsync([`${base}/live`, `${base}/build`, '--live-cache', c, '--hide', '.geo-bar']);
      assert.equal(first.code, 0, first.out + first.err); assert.match(first.err, /probed for a different url\/width\/regions\/hides — re-probing live/);
      const hit = await runAsync([`${base}/live`, `${base}/build`, '--live-cache', c, '--hide', '.geo-bar']);
      assert.equal(hit.code, 0, hit.out + hit.err); assert.match(hit.out, /live side from cache/); assert.match(hit.out, /^ {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[--hide\]$/m);
    });
  } finally {
    server.close();
  }
}

rmSync(root, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('chrome-parity.test: all checks passed');
