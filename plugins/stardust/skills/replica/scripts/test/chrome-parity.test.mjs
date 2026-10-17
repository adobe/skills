#!/usr/bin/env node
// skills/replica/scripts/test/chrome-parity.test.mjs — the chrome-parity.mjs contract. Part (a), no browser:
// argument parsing (--hide comma lists, repeatable; --presence needs --slug, --slug alone is fine), gate-all's
// presence.json read (selO=selE halves, list entries joined, a missing slug / file hides nothing; `hide` with "*" on
// both sides), the site-wide stardust/replica/presence.json read by default and merged under --presence's file (its
// selectors attributed `site presence.json`; a malformed one exits 1 naming it), the --live-cache key (unchanged
// without hides), the region diff, and --help / usage errors from a copy with no playwright and no diff dir beside
// it. Part (b): end-to-end against fixture pages served from this process — a live page with an in-flow 88 px bar
// above <header>, one whose script re-renders a NEW bar two frames after the hide pass, one whose empty wrapper above
// the header a delayed lookup fills with an 88 px bar, a build page without any — runs only where playwright is
// importable, prints a skip line otherwise.
// Run: node <this file>.
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
const run = (script, args, cwd = root) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd }); return { code: r.status, out: r.stdout, err: r.stderr }; };
// A project dir whose stardust/replica/presence.json (the site-wide file, read from the cwd) holds `site`.
const project = (name, site) => { const d = join(root, name); mkdirSync(join(d, 'stardust', 'replica'), { recursive: true }); writeFileSync(join(d, 'stardust', 'replica', 'presence.json'), typeof site === 'string' ? site : JSON.stringify(site)); return d; };
// The e2e runs must not block the event loop — the fixture server answers from THIS process.
const runAsync = (args, cwd = root) => new Promise((done) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = '';
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

await check('parseArgs: --hide takes comma lists, repeats, trims and drops empty entries; --presence needs --slug, --slug alone is fine', () => {
  const { opts } = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--hide', '.geo-bar, .location-bar', '--hide', ' ,.promo-strip,', '--presence', 'p.json', '--slug', 'home']);
  assert.deepEqual(opts.hide, ['.geo-bar', '.location-bar', '.promo-strip']);
  assert.equal(opts.presence, 'p.json'); assert.equal(opts.slug, 'home');
  assert.deepEqual(parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html']).opts.hide, []);
  const slugOnly = parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--slug', 'home']).opts;
  assert.deepEqual([slugOnly.slug, slugOnly.presence], ['home', null], 'the site file\'s slug entry needs no --presence');
  assert.throws(() => parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--presence', 'p.json']), (e) => e instanceof UsageError && /--presence needs --slug/.test(e.message));
  assert.throws(() => parseArgs(['https://live.example/', 'http://127.0.0.1:1/b.html', '--hide']), (e) => e instanceof UsageError && /--hide needs a selector list/.test(e.message));
});

// gate-file-only reads pass site: null — hermetic in a project that has stardust/replica/presence.json
await check('readPresence: gate-all semantics — variable entries joined and split, selO=selE halves (build falls back to selO), main ignored', async () => {
  const f = join(root, 'presence.json');
  writeFileSync(f, JSON.stringify({ home: { main: 'main=main.eds', variable: ['.geo-bar=.location-bar', '.promo-a, .promo-b'] }, about: { main: 'main' } }));
  const p = await readPresence(f, 'home', { site: null });
  assert.deepEqual(p.regions, [{ live: '.geo-bar', build: '.location-bar' }, { live: '.promo-a', build: '.promo-a' }, { live: '.promo-b', build: '.promo-b' }]);
  assert.equal(p.file, f); assert.equal(p.slug, 'home'); assert.match(p.note, /→ home: 3 variable region\(s\)$/);
  assert.deepEqual(Object.keys(p), ['file', 'slug', 'regions', 'note'], 'no hide entries → the record (JSON presence) keeps its old shape');
  const none = await readPresence(f, 'about', { site: null });
  assert.deepEqual(none.regions, []); assert.match(none.note, /has no variable regions for about — nothing hidden$/);
  assert.deepEqual((await readPresence(f, 'press', { site: null })).regions, []);
  const missing = await readPresence(join(root, 'nope.json'), 'home', { site: null });
  assert.deepEqual(missing.regions, []); assert.match(missing.note, /nope\.json not found — nothing hidden$/);
  const bad = join(root, 'bad-presence.json'); writeFileSync(bad, '{ "home": ');
  await assert.rejects(readPresence(bad, 'home', { site: null }), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`));
  assert.equal(await readPresence(null, 'home', { site: null }), null, 'no --presence and no site file → no presence record');
  assert.equal(await readPresence(null, 'home', { site: join(root, 'no-site.json') }), null);
});

await check('readPresence + hideLists: presence `hide` ("*" then the slug) reaches BOTH sides as presence.json, deduped against --hide', async () => {
  const f = join(root, 'presence-hide.json');
  writeFileSync(f, JSON.stringify({ '*': { hide: ['.geo-bar', '.promo'], variable: ['.star-variable'] }, home: { variable: ['.geo-bar=.location-bar'], hide: ['.cookie-strip, .geo-bar'] } }));
  const p = await readPresence(f, 'home', { site: null });
  assert.deepEqual(p.hide, ['.geo-bar', '.promo', '.cookie-strip']);
  assert.match(p.note, /→ home: 1 variable region\(s\), 3 hide selector\(s\)$/);
  const pr = (sel) => ({ sel, source: 'presence.json' });
  assert.deepEqual(hideLists(['.promo'], p), {
    live: [{ sel: '.promo', source: '--hide' }, pr('.geo-bar'), pr('.cookie-strip')],
    build: [{ sel: '.promo', source: '--hide' }, pr('.location-bar'), pr('.geo-bar'), pr('.cookie-strip')],
  });
  const other = await readPresence(f, 'press', { site: null });
  assert.deepEqual(other.regions, [], '"*" lends only hide, never variable'); assert.deepEqual(other.hide, ['.geo-bar', '.promo']);
  assert.match(other.note, /→ press: 0 variable region\(s\), 2 hide selector\(s\)$/);
  assert.deepEqual(hideLists([], other), { live: [pr('.geo-bar'), pr('.promo')], build: [pr('.geo-bar'), pr('.promo')] });
});

await check('readPresence + hideLists: the site-wide file is read with no --presence ("*", plus the slug\'s entry), merged under a gate file; its selectors say site presence.json', async () => {
  const site = join(root, 'site-presence.json');
  writeFileSync(site, JSON.stringify({ '*': { hide: ['section.bar__wrapper'], reasons: { 'section.bar__wrapper': 'R-01' } }, home: { variable: ['.promo=.promo-eds'] } }));
  const sp = (sel) => ({ sel, source: 'site presence.json' }); const pr = (sel) => ({ sel, source: 'presence.json' });
  const star = await readPresence(null, null, { site });
  assert.deepEqual(star, { file: null, slug: null, regions: [], hide: ['section.bar__wrapper'], note: `${site} → "*": 0 variable region(s), 1 hide selector(s)`, site, hideSources: [sp('section.bar__wrapper')] });
  assert.deepEqual(hideLists([], star), { live: [sp('section.bar__wrapper')], build: [sp('section.bar__wrapper')] });
  const home = await readPresence(null, 'home', { site });
  assert.deepEqual([home.regions, home.variableSource], [[{ live: '.promo', build: '.promo-eds' }], 'site presence.json']);
  assert.deepEqual(hideLists(['.x'], home), { live: [{ sel: '.x', source: '--hide' }, sp('.promo'), sp('section.bar__wrapper')], build: [{ sel: '.x', source: '--hide' }, sp('.promo-eds'), sp('section.bar__wrapper')] });
  const gate = join(root, 'gate-presence.json'); writeFileSync(gate, JSON.stringify({ home: { hide: ['.geo-bar'] } }));
  const merged = await readPresence(gate, 'home', { site });
  assert.equal(merged.note, `${gate} over ${site} → home: 1 variable region(s), 2 hide selector(s)`);
  assert.deepEqual(hideLists([], merged).live, [sp('.promo'), sp('section.bar__wrapper'), pr('.geo-bar')]);
  const sameFile = await readPresence(site, 'about', { site });
  assert.deepEqual([sameFile.note, sameFile.hideSources], [`${site} → about: 0 variable region(s), 1 hide selector(s)`, [sp('section.bar__wrapper')]], '--presence naming the site file itself reads it once');
  const bad = join(root, 'bad-site.json'); writeFileSync(bad, '{ "*": ');
  await assert.rejects(readPresence(null, 'home', { site: bad }), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`));
  await assert.rejects(readPresence(gate, 'home', { site: bad }), (e) => e.message.startsWith(`presence.json ${bad} unreadable (`));
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
  assert.match(h.out, /stardust\/replica\/presence\.json \(cwd-relative\) is read by default/);
  const u = run(join(solo, 'chrome-parity.mjs'), ['https://live.example/']);
  assert.equal(u.code, 1); assert.match(u.err, /need <liveURL> and <buildURL>/); assert.match(u.err, /Usage:/);
  const p = run(join(solo, 'chrome-parity.mjs'), ['https://live.example/', 'http://127.0.0.1:1/b.html', '--presence', join(root, 'presence.json')]);
  assert.equal(p.code, 1); assert.match(p.err, /--presence needs --slug/);
});

await check('CLI: a malformed site-wide presence.json in the cwd is an error naming it (exit 1), before any browser — no flag needed', () => {
  const dir = project('bad-site', '{ "*": ');
  const r = run(SCRIPT, ['https://live.example/', 'http://127.0.0.1:1/b.html'], dir);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^chrome-parity error: presence\.json stardust\/replica\/presence\.json unreadable \(/m);
  assert.equal(r.out, '');
});

// ---- (b) end-to-end, where playwright resolves from the script's location ---------------------------
const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "import('playwright').then(() => process.exit(0), () => process.exit(1))"], { cwd: dirname(SCRIPT) });
if (pwProbe.status !== 0) {
  console.log('- e2e: playwright not importable from the scripts dir — skipped (run the copy inside a project with playwright installed)');
} else {
  const chrome = '<header><nav><a href="#">Home</a> <a href="#">Products</a> <a href="#">Contact</a></nav></header><main><h1>Title</h1><p>Body copy.</p></main><footer><p>Footer text</p></footer>';
  const page = (bar, tail = '') => `<!doctype html><html><head><style>body{margin:0;font:16px/1.4 sans-serif}header,footer{padding:20px}.geo-bar,.region-strip{height:88px;box-sizing:border-box;padding:20px;background:#eee}</style></head><body>${bar}${chrome}${tail}</body></html>`;
  const geoBar = '<div class="geo-bar">Visiting from another region? <a href="#">Switch</a></div>';
  // A geo script re-rendering after the hide pass: the moment its bar is hidden (style attribute), a NEW bar replaces
  // it two animation frames later (~30 ms) — the frame the hide's own two-frame settle ends in, before any measuring.
  const rerender = '<script>(() => { const bar = document.querySelector(".geo-bar"); const mo = new MutationObserver(() => { if (bar.style.display !== "none") return; mo.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => { const fresh = bar.cloneNode(true); fresh.removeAttribute("style"); bar.replaceWith(fresh); })); }); mo.observe(bar, { attributes: true, attributeFilter: ["style"] }); })();</script>';
  // The delayed bar (live side only): an empty wrapper above the header that a geo lookup fills 300 ms after load with
  // an 88 px strip — its own class, so a recorded `.geo-bar` matches nothing on this page.
  const wrapper = '<section class="bar__wrapper"></section>';
  const lookup = '<script>addEventListener("load", () => setTimeout(() => { document.querySelector(".bar__wrapper").innerHTML = \'<div class="region-strip">Use the site for your region?</div>\'; }, 300));</script>';
  const pages = { '/live': page(geoBar), '/live-late': page(geoBar, rerender), '/live-delayed': page(wrapper, lookup), '/build': page('') };
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
    await check('e2e late bar: a NEW bar the page re-renders after the hide pass is hidden by the style rule (exit 0, no vertical offset)', async () => {
      const r = await runAsync([`${base}/live-late`, `${base}/build`, '--hide', '.geo-bar']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.doesNotMatch(r.out, /REGION BOX/);
      assert.match(r.out, /^ {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[--hide\]$/m);
    });
    await check('e2e presence.json "*": its hide list reaches both sides for any slug (exit 0), the source says presence.json', async () => {
      const f = join(root, 'star-presence.json'); writeFileSync(f, JSON.stringify({ '*': { hide: ['.geo-bar'] } }));
      const r = await runAsync([`${base}/live`, `${base}/build`, '--presence', f, '--slug', 'any-page']);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^ {2}hidden live: {2}\.geo-bar ×1 \(88px\) \[presence\.json\]\n {2}hidden build: \.geo-bar ×0 \[presence\.json\]$/m);
      assert.match(r.out, /^ {2}presence: \S+star-presence\.json → any-page: 0 variable region\(s\), 1 hide selector\(s\)$/m);
      const j = JSON.parse((await runAsync([`${base}/live`, `${base}/build`, '--presence', f, '--slug', 'any-page', '--json'])).out);
      assert.deepEqual(j.hidden.live, [{ sel: '.geo-bar', source: 'presence.json', n: 1, h: 88 }]);
      assert.deepEqual([j.presence.regions, j.presence.hide], [[], ['.geo-bar']]);
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
    // the delayed bar, live side only: the site-wide presence.json by default (E9)
    await check('e2e site presence.json: read from the cwd with no flag ("*" only), its selector says site presence.json (exit 0)', async () => {
      const dir = project('site-project', { '*': { hide: ['section.bar__wrapper'] }, home: { hide: ['.geo-bar'] } });
      const r = await runAsync([`${base}/live-delayed`, `${base}/build`], dir);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /^ {2}hidden live: {2}section\.bar__wrapper ×1 \(88px\) \[site presence\.json\]\n {2}hidden build: section\.bar__wrapper ×0 \[site presence\.json\]\n {2}presence: stardust\/replica\/presence\.json → "\*": 0 variable region\(s\), 1 hide selector\(s\)$/m);
    });
    await check('e2e site presence.json + --slug alone: the slug\'s entry too (exit 0); --presence merges a gate file over it', async () => {
      const dir = join(root, 'site-project');
      const r = await runAsync([`${base}/live-delayed`, `${base}/build`, '--slug', 'home', '--json'], dir);
      assert.equal(r.code, 0, r.out + r.err);
      const j = JSON.parse(r.out);
      assert.deepEqual(j.hidden.live.map((x) => [x.sel, x.source, x.n]), [['section.bar__wrapper', 'site presence.json', 1], ['.geo-bar', 'site presence.json', 0]]);
      assert.deepEqual([j.presence.file, j.presence.site, j.presence.note], [null, 'stardust/replica/presence.json', 'stardust/replica/presence.json → home: 0 variable region(s), 2 hide selector(s)']);
      const gate = join(dir, 'gate-presence.json'); writeFileSync(gate, JSON.stringify({ home: { hide: ['.promo-strip'] } }));
      const m = await runAsync([`${base}/live-delayed`, `${base}/build`, '--presence', gate, '--slug', 'home'], dir);
      assert.equal(m.code, 0, m.out + m.err);
      assert.match(m.out, /^ {2}hidden live: {2}section\.bar__wrapper ×1 \(88px\) \[site presence\.json\]; \.promo-strip ×0 \[presence\.json\]$/m);
      assert.match(m.out, /^ {2}presence: \S+gate-presence\.json over stardust\/replica\/presence\.json → home: 0 variable region\(s\), 2 hide selector\(s\)$/m);
    });
  } finally {
    server.close();
  }
}

rmSync(root, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('chrome-parity.test: all checks passed');
