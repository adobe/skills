#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the stitch-shot contract: the pure `overflow:` root line
// gate.sh's horizontal-overflow assert reads (viewport = innerWidth, delta = scrollWidth − clientWidth clamped at 0),
// --help before any import or I/O (exit 0 in an empty cwd, writes nothing, also where playwright is not importable);
// then, where playwright is importable, end-to-end against an in-process node:http origin: a page 1700 px wide and a
// fitting page at --width 1440 (the overflow line beside a written PNG); verdict parity with measure.mjs's root line
// (the overflow read gate.sh used before) on the wide and fitting pages, a right-sliding scroll reveal below the fold
// (a pre-scroll read would count it: false overflow), an off-canvas fixed drawer and an absolute one (real overflow),
// a header a scroll handler pins position:fixed below the top whose 400 px nav row overflows 360 (a read at the
// bottom would miss it), plus a keyframe reveal the freeze starts paused off to the side (delta 0 at rest); and the
// EDS single sweep — no timed poll
// (lateWindowFor → 0) but one dismissOverlays pass after waitEdsDelayedPhase still clicks a consent banner that
// appears 3 s after `load` (the EDS delayed phase), which an immediate sweep misses. Prints a skip line otherwise.
// --inventory (gate-all --one-load): named in --help; an unreadable spec still writes the PNG, exit 0, one warning.
// The --timeout default: an explicit flag wins, else env STARDUST_NAV_TIMEOUT_MS, else the crawl figure, else 60000.
// The header morph: isHeaderMorph (pure) and, end to end, an in-flow header that shrinks 20 px after the first scroll
// — at 1810 px with the browser clamping (the old guard threw a scroll stall; also under --settle), at 2710 px with its
// scroll anchoring (the shortfall equals the shrink; the old guard stalled at the last chunk) and at 1800 px (the old
// guard let it through with 20 unwritten rows at the bottom): exit 0, the shrunk PNG height, headerMorph 20 in
// <stem>.capture.json, the morph named on the stitched line. An inner scroller still exits 1 with the scroll stall
// signature and leaves no sidecar; a normal page records headerMorph 0 and its stdout is unchanged.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isHeaderMorph, overflowLine, parseArgs } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const LINE_RE = /^overflow: scrollWidth=[0-9]+ viewport=[0-9]+ delta=[0-9]+$/;

await check('overflowLine: scrollWidth, viewport = innerWidth, delta = scrollWidth − clientWidth — the shape gate.sh parses', () => {
  assert.equal(overflowLine({ scrollWidth: 1700, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1700 viewport=1440 delta=260');
  assert.match(overflowLine({ scrollWidth: 1700, innerWidth: 1440, clientWidth: 1440 }), LINE_RE);
  assert.equal(overflowLine({ scrollWidth: 1440, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1440 viewport=1440 delta=0');
});
await check('overflowLine: delta clamps at 0; a scrollbar gutter (clientWidth < innerWidth) is measured against clientWidth, as measure.mjs does', () => {
  assert.equal(overflowLine({ scrollWidth: 1425, innerWidth: 1440, clientWidth: 1425 }), 'overflow: scrollWidth=1425 viewport=1440 delta=0');
  assert.equal(overflowLine({ scrollWidth: 1400, innerWidth: 1440, clientWidth: 1440 }), 'overflow: scrollWidth=1400 viewport=1440 delta=0');
  assert.equal(overflowLine({ scrollWidth: 1440, innerWidth: 1440, clientWidth: 1425 }), 'overflow: scrollWidth=1440 viewport=1440 delta=15');
});
await check('--timeout default: env STARDUST_NAV_TIMEOUT_MS, else 2 × the crawl\'s navMs p95 (clamped), else 60000 — an explicit --timeout always wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-nav-'));
  try {
    const crawlLog = join(dir, '_crawl-log.json');
    writeFileSync(crawlLog, JSON.stringify({ crawl: { failures: [], navMs: { n: 12, p50: 9000, p95: 42000, max: 47000 } } }));
    const timeout = (extra, nav) => parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png', ...extra], nav).opts.timeout;
    assert.equal(timeout([], { env: {}, crawlLog: null }), 60000, 'neither env nor crawl figure: the current default');
    assert.equal(timeout([], { env: {}, crawlLog: join(dir, 'missing.json') }), 60000, 'a missing crawl log is skipped');
    assert.equal(timeout([], { env: {}, crawlLog }), 84000, 'the crawl figure: p95 42000 × 2');
    assert.equal(timeout([], { env: { STARDUST_NAV_TIMEOUT_MS: '90000' }, crawlLog }), 90000, 'env beats the crawl figure');
    assert.equal(timeout(['--timeout', '5000'], { env: { STARDUST_NAV_TIMEOUT_MS: '90000' }, crawlLog }), 5000, 'the flag beats both');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('isHeaderMorph: a shortfall the document\'s shrink explains — equal to the shrink, or the target clamped to the shrunk height; a no-op scroll, a grown page or an unexplained shrink is not', () => {
  const vh = 900;
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 880, totalH: 2710, h2: 2690, vh }), true, 'mid-page: scroll anchoring moved scrollY up by the 20 px loss');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 890, totalH: 1810, h2: 1790, vh }), true, 'shortfall 10 ≠ shrink 20, but 890 is 900 clamped to the shrunk height');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 0, totalH: 3000, h2: 3000, vh }), false, 'height unchanged: a no-op scroll');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 0, totalH: 3000, h2: 2980, vh }), false, 'a 20 px shrink does not explain a 900 px shortfall');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 880, totalH: 2710, h2: 2730, vh }), false, 'a grown document');
  assert.equal(isHeaderMorph({ y: 900, target: 900, actualY: 897, totalH: 1810, h2: 1807, vh }), false, 'within the 4 px slack: scroll rounding');
});
await check('--help in an empty cwd: exit 0, usage + the overflow line and the EDS rule named, nothing written — no playwright needed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 15000);
    assert.match(r.stdout, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.match(r.stdout, /overflow: scrollWidth=<n> viewport=<n> delta=<n>/);
    assert.match(r.stdout, /EDS build\/preview hosts/);
    assert.match(r.stdout, /--timeout <ms> .*STARDUST_NAV_TIMEOUT_MS/, 'the env is named on the --timeout line');
    assert.match(r.stdout, /crawl\.navMs\.p95 from stardust\/current\/_crawl-log\.json/, 'the crawl figure is named');
    assert.match(r.stdout, /<stem>\.capture\.json/, 'the sidecar is named');
    assert.match(r.stdout, /headerMorph/);
    assert.match(r.stdout, /scroll stall/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
let chromium = null; let PNG = null;
try { ({ chromium } = await import('playwright')); ({ PNG } = await import('pngjs')); } catch { chromium = null; console.log('skip  end-to-end stitch-shot (playwright / pngjs not importable here; run this test in an environment that has them)'); }
if (chromium) {
  const page = (body, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}section{height:700px;background:#ddd}</style>${extraHead}</head><body>${body}</body></html>`;
  // A consent banner injected 3 s after `load` — the timing of a consent manager loaded from the EDS delayed phase.
  const lateConsent = `<script>addEventListener('load', () => setTimeout(() => {
    const d = document.createElement('div'); d.id = 'banner'; d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:120px;background:#123';
    const b = document.createElement('button'); b.id = 'onetrust-accept-btn-handler'; b.textContent = 'OK'; b.onclick = () => d.remove();
    d.appendChild(b); document.body.appendChild(d);
  }, 3000));</script>`;
  const pages = {
    '/wide': page('<section></section><div style="width:1700px;height:40px;background:#c33"></div><section></section>'),
    '/fit': page('<section></section><div style="width:100%;height:40px;background:#3c3"></div><section></section>'),
    '/consent-late': page('<section></section><section></section>', lateConsent),
  };
  // Overflow parity fixtures: a full-width block below the fold that slides in from the right when it scrolls into
  // view (transition / keyframe), an off-canvas drawer (fixed: no root overflow; absolute: 400 px of it), and a header
  // whose scroll handler pins it position:fixed once scrolled — its 400 px nav row overflows a 360 viewport at the top
  // only (fixed boxes add no root overflow), where measure.mjs reads.
  const S3 = '<section></section><section></section><section></section>';
  const reveal = (sel) => `<script>const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }));
    document.querySelectorAll('${sel}').forEach((el) => io.observe(el));</script>`;
  Object.assign(pages, {
    '/reveal': page(`${S3}<div class="rv">reveal</div>${reveal('.rv')}`, '<style>.rv{height:200px;background:#36c;transform:translateX(200px);transition:transform .3s}.rv.in{transform:none}</style>'),
    '/reveal-anim': page(`${S3}<div class="ra">reveal</div>${reveal('.ra')}`, '<style>.ra{height:200px;background:#c63}.ra.in{animation:slide 1s both}@keyframes slide{from{transform:translateX(300px)}to{transform:none}}</style>'),
    '/drawer': page(`${S3}<div style="position:fixed;top:0;right:-400px;width:400px;height:100%;background:#333"></div>`),
    '/drawer-abs': page(`${S3}<div style="position:absolute;top:0;right:-400px;width:400px;height:300px;background:#333"></div>`),
    '/fixed-header': page(`<header id="hd"><nav style="width:400px;height:60px;background:#c33">nav</nav></header>${S3}<script>addEventListener('scroll', () => document.getElementById('hd').classList.toggle('pin', window.scrollY > 80));</script>`,
      '<style>#hd{height:60px;background:#222}#hd.pin{position:fixed;top:0;left:0;right:0}</style>'),
  });
  // Header morph fixtures: an in-flow header 100 px tall at the top that shrinks to 80 px once the window scrolls and
  // grows back at the top (a shrink-on-scroll header), over a body that makes the document `total` px tall at rest.
  // `anchor: false` turns the browser's scroll anchoring off, so a scroll past the shrunk bottom is clamped instead.
  const morph = (total, anchor = true) => page(`<header id="hd"></header><main style="height:${total - 100}px"></main><script>addEventListener('scroll', () => document.getElementById('hd').classList.toggle('small', window.scrollY > 0));</script>`,
    `<style>#hd{height:100px;background:#222}#hd.small{height:80px}main{background:linear-gradient(#ddd,#36c)}${anchor ? '' : 'body{overflow-anchor:none}'}</style>`);
  Object.assign(pages, {
    '/morph-1810': morph(1810, false), '/morph-2710': morph(2710), '/morph-1800': morph(1800),
    // Inner scroller: html/body overflow:hidden at 100% height — the body reports 3000 px, window.scrollTo moves nothing.
    '/jacked': page('<section style="height:3000px;background:linear-gradient(#ddd,#36c)"></section>', '<style>html,body{height:100%;overflow:hidden}</style>'),
  });
  const server = createServer((req, res) => {
    const body = pages[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body || 'nope');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Asynchronous spawn: the origin lives in this process, so the event loop must keep running.
  const run = (args, cwd) => new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
  const work = mkdtempSync(join(tmpdir(), 'stitch-e2e-'));
  const capture = (name) => { try { return JSON.parse(readFileSync(join(work, `${name}.capture.json`), 'utf8')); } catch { return null; } };
  const pngOf = (name) => PNG.sync.read(readFileSync(join(work, `${name}.png`)));
  // Rows no chunk wrote stay zero-filled (alpha 0) — the black band a short scroll leaves at the bottom.
  const unwritten = (png) => { for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) return `row ${Math.floor((i - 3) / 4 / png.width)} of ${png.height} unwritten`; return null; };
  try {
    await check('e2e: a page 1700 px wide at --width 1440 prints its overflow line right before the stitched line; wide.capture.json records headerMorph 0 — no <stem>.json (gate.sh / gate-all own it)', async () => {
      const r = await run([`${base}/wide`, 'wide.png', '--width', '1440'], work);
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.at(-2), 'overflow: scrollWidth=1700 viewport=1440 delta=260', r.stdout);
      const [, h, n] = lines.at(-1).match(/^stitched wide\.png: 1440x(\d+) from (\d+) chunks$/) || [];
      assert.ok(h, lines.at(-1));
      assert.equal(lines.filter((l) => LINE_RE.test(l)).length, 1, 'one overflow line per capture');
      assert.equal(pngOf('wide').height, Number(h));
      const cap = capture('wide');
      assert.ok(cap && !Number.isNaN(Date.parse(cap.at)), `wide.capture.json: ${JSON.stringify(cap)}`);
      assert.deepEqual({ ...cap, at: 'iso' }, { writtenBy: 'skills/replica/scripts/stitch-shot.mjs', url: `${base}/wide`, width: 1440, vh: 900, height: Number(h), chunks: Number(n), headerMorph: 0, overflow: { scrollWidth: 1700, viewport: 1440, delta: 260 }, at: 'iso' });
      assert.equal(existsSync(join(work, 'wide.json')), false);
    });
    await check('e2e: a fitting page prints delta=0', async () => {
      const r = await run([`${base}/fit`, 'fit.png', '--width', '1440'], work);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^overflow: scrollWidth=1440 viewport=1440 delta=0$/m);
      assert.ok(existsSync(join(work, 'fit.png')));
    });
    // measure.mjs's root line is the overflow read gate.sh used before the build capture's own line: same verdict.
    const measureRoot = (url, width) => new Promise((done) => {
      const child = spawn(process.execPath, [join(HERE, '..', 'measure.mjs'), url, '--selectors', 'html', '--props', 'display', '--width', String(width), '--json'], { cwd: work });
      let out = ''; child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => { try { done(JSON.parse(out).root[url][width]); } catch { done(null); } });
    });
    const stitchRoot = async (path, width = 1440) => {
      const r = await run([`${base}${path}`, `${path.slice(1)}-${width}.png`, '--width', String(width)], work);
      const m = r.stdout.match(/^overflow: scrollWidth=(\d+) viewport=(\d+) delta=(\d+)$/m);
      return m ? { scrollWidth: Number(m[1]), viewport: Number(m[2]), delta: Number(m[3]) } : { error: r.stderr || r.stdout };
    };
    const parity = [['/wide', 1440, 260], ['/fit', 1440, 0], ['/reveal', 1440, 0], ['/reveal', 360, 0], ['/drawer', 1440, 0], ['/drawer-abs', 1440, 400], ['/fixed-header', 360, 40]];
    for (const [path, width, delta] of parity) {
      await check(`e2e: overflow parity with measure.mjs on ${path} at ${width} — delta ${delta}`, async () => {
        const [m, st] = await Promise.all([measureRoot(`${base}${path}`, width), stitchRoot(path, width)]);
        assert.ok(m, 'measure.mjs printed a root line');
        assert.deepEqual(st, { scrollWidth: m.scrollWidth, viewport: m.viewport, delta: m.overflowX }, `measure ${JSON.stringify(m)}`);
        assert.equal(st.delta, delta);
      });
    }
    await check('e2e: a keyframe reveal the freeze starts paused off to the side is read at rest — delta 0, no invented overflow', async () => {
      assert.deepEqual(await stitchRoot('/reveal-anim'), { scrollWidth: 1440, viewport: 1440, delta: 0 });
    });
    // Header morph: a shortfall the document's own shrink explains is not a scroll stall — the stitch continues from
    // where the window stopped, the PNG takes the shrunk height, <stem>.capture.json records headerMorph.
    const stitch = async (path, name, extra = []) => {
      const r = await run([`${base}${path}`, `${name}.png`, '--width', '1440', ...extra], work);
      return { ...r, lines: r.stdout.trim().split('\n'), cap: capture(name) };
    };
    await check('e2e: a header that shrinks 20 px after the first scroll (1810 px, the browser clamps) is a morph, not a scroll stall — exit 0, 1790 px, headerMorph 20', async () => {
      const r = await stitch('/morph-1810', 'morph');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.lines.at(-2), 'overflow: scrollWidth=1440 viewport=1440 delta=0', r.stdout);
      assert.equal(r.lines.at(-1), 'stitched morph.png: 1440x1790 from 2 chunks — header morph 20 px');
      assert.equal(r.stderr.split('\n').filter((l) => /header morph/.test(l)).length, 1, r.stderr);
      assert.deepEqual([r.cap?.headerMorph, r.cap?.height, r.cap?.chunks], [20, 1790, 2], JSON.stringify(r.cap));
      const png = pngOf('morph');
      assert.equal(png.height, 1790); assert.equal(unwritten(png), null);
      assert.equal(existsSync(join(work, 'morph.json')), false);
    });
    await check('e2e: the same header under --settle (its pass scrolls the page before the height is read) — exit 0, headerMorph 20', async () => {
      const r = await stitch('/morph-1810', 'morph-settle', ['--settle']);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual([r.cap?.headerMorph, pngOf('morph-settle').height], [20, 1790], JSON.stringify(r.cap));
    });
    await check('e2e: mid-page the browser\'s scroll anchoring moves scrollY up by the header\'s loss (2710 px) — the shortfall equals the shrink: morph, 2690 px, no stall at the last chunk', async () => {
      const r = await stitch('/morph-2710', 'morph-anchored');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.lines.at(-1), 'stitched morph-anchored.png: 1440x2690 from 4 chunks — header morph 20 px');
      assert.equal(r.cap?.headerMorph, 20, JSON.stringify(r.cap));
      const png = pngOf('morph-anchored');
      assert.equal(png.height, 2690); assert.equal(unwritten(png), null);
    });
    await check('e2e: the same header at 1800 px, an alignment the old guard let through short — 1780 px, no unwritten rows at the bottom, headerMorph 20', async () => {
      const r = await stitch('/morph-1800', 'morph-short');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.lines.at(-1), /^stitched morph-short\.png: 1440x1780 from \d+ chunks — header morph 20 px$/);
      assert.deepEqual([r.cap?.headerMorph, r.cap?.height], [20, 1780], JSON.stringify(r.cap));
      const png = pngOf('morph-short');
      assert.equal(png.height, 1780); assert.equal(unwritten(png), null);
    });
    await check('e2e: an inner scroller (window scroll a no-op, the height unchanged) still fails loud — exit 1, the scroll stall signature, no .capture.json left behind', async () => {
      writeFileSync(join(work, 'jacked.capture.json'), '{"stale":true}');
      const r = await run([`${base}/jacked`, 'jacked.png', '--width', '1440'], work);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /^stitch-shot error: scroll stall at chunk target 900px: window scroll is a no-op \(window\.scrollY stuck at 0px\) while the document reports 3000px/m);
      assert.equal(existsSync(join(work, 'jacked.capture.json')), false, 'a stale sidecar goes when the capture starts');
      assert.equal(existsSync(join(work, 'jacked.png')), false);
      assert.doesNotMatch(r.stdout + r.stderr, /header morph/);
    });
    await check('e2e: EDS single sweep — no timed poll, one sweep after waitEdsDelayedPhase dismisses a consent banner shown 3 s after load', async () => {
      const lib = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolve(HERE, '..', p)).find((p) => existsSync(p));
      const { dismissOverlays, lateWindowFor, waitEdsDelayedPhase } = await import(pathToFileURL(lib).href);
      assert.equal(lateWindowFor('https://main--site--org.aem.live/consent-late'), 0, 'no timed late-modal window on an EDS host');
      const browser = await chromium.launch();
      try {
        const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await p.goto(`${base}/consent-late`, { waitUntil: 'domcontentloaded' });
        const early = await dismissOverlays(p, { lateWindowMs: 0 });
        assert.equal(early.consent, null, 'a sweep before the delayed phase finds no banner — the wait is what reaches it');
        const waited = await waitEdsDelayedPhase(p);
        assert.ok(waited < 6000, `the wait ended on the delayed phase, not the cap (${waited} ms)`);
        const d = await dismissOverlays(p, { lateWindowMs: lateWindowFor('https://main--site--org.aem.live/consent-late') });
        assert.equal(d.consent, '#onetrust-accept-btn-handler');
        assert.equal(await p.locator('#banner').count(), 0, 'the banner is gone');
      } finally { await browser.close(); }
    });
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- --inventory (gate-all --one-load): named in --help; an inventory problem never fails the capture -------------
await check('--inventory: --help names it; with an unreadable spec the stitch still writes the PNG and exits 0 with one stderr warning', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-inventory-'));
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><body style="margin:0"><main><h1>Inventory</h1><section style="height:1200px;background:#ddd"></section></main></body></html>'); });
  try {
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(h.status, 0); assert.match(h.stdout, /--inventory <f> .*gate-all --one-load/);
    if (!chromium) { console.log('skip  e2e --inventory with an unreadable spec (playwright / pngjs not importable here)'); return; }
    await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
    const r = await new Promise((done) => {
      const child = spawn(process.execPath, [SCRIPT, `http://127.0.0.1:${srv.address().port}/`, 'inv.png', '--settle', '--inventory', join(cwd, 'missing-spec.json')], { cwd });
      let stdout = ''; let stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0, r.stderr); assert.ok(statSync(join(cwd, 'inv.png')).size > 0); assert.match(r.stdout, /^stitched inv\.png: 1440x\d+/m);
    const warnings = r.stderr.split('\n').filter((l) => /WARNING/.test(l));
    assert.equal(warnings.length, 1, r.stderr); assert.match(warnings[0], /missing-spec\.json/);
  } finally { srv.close(); rmSync(cwd, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} check(s) failing` : '\nstitch-shot: all checks passed');
process.exit(failed ? 1 : 0);
