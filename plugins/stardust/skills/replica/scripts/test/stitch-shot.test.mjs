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
// --hide (in-flow per-visitor regions): parseArgs takes comma lists, repeatable, de-duplicated; named in --help; a
// missing value is a usage error; e2e an 88 px in-flow .geo-bar above the content — hidden, the stitch is 88 px
// shorter and stdout says `hidden: .geo-bar ×1 (88px) [--hide]` (also under --no-dismiss); a selector matching nothing
// is ×0 and changes nothing; under --settle the --inventory already sees the hidden page.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { overflowLine, parseArgs } from '../stitch-shot.mjs';

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
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('parseArgs --hide: comma lists, repeatable, trimmed, empties dropped, de-duplicated in order; absent → []', () => {
  const argv = (...a) => ['node', 'stitch-shot.mjs', 'http://127.0.0.1/', 'out.png', ...a];
  assert.deepEqual(parseArgs(argv('--hide', ' .geo-bar , #promo,', '--hide', '#promo,.location-bar', '--hide', '')).opts.hide, ['.geo-bar', '#promo', '.location-bar']);
  const plain = parseArgs(argv('--width', '360', '--dismiss', '.x'));
  assert.deepEqual(plain.opts.hide, []);
  assert.deepEqual([plain.url, plain.out, plain.opts.width, plain.opts.dismiss], ['http://127.0.0.1/', 'out.png', 360, ['.x']]);
});
await check('--hide: --help names it; a missing value (end of argv or a flag next) is a usage error, exit 1, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-hide-'));
  try {
    const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /--hide <sel,…> +remove in-flow per-visitor regions/);
    assert.match(h.stdout, /hidden: <sel> ×<n> \(<h>px\) \[--hide\]/);
    for (const tail of [['--hide'], ['--hide', '--settle']]) {
      const r = spawnSync(process.execPath, [SCRIPT, 'http://127.0.0.1:9/', 'x.png', ...tail], { cwd, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 1, `${tail.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /^--hide needs a selector list/);
    }
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
let chromium = null;
try { ({ chromium } = await import('playwright')); await import('pngjs'); } catch { chromium = null; console.log('skip  end-to-end stitch-shot (playwright / pngjs not importable here; run this test in an environment that has them)'); }
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
    // --hide: an 88 px per-visitor bar (a location suggestion) in flow above the header — not an overlay.
    '/geo': page('<div class="geo-bar" style="height:88px;background:#f90"><a href="/loc">Switch location</a></div><header style="height:60px;background:#222"></header><main><h1 style="margin:0;height:60px">Heading</h1><section></section><section></section></main>'),
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
  try {
    await check('e2e: a page 1700 px wide at --width 1440 prints its overflow line right before the stitched line', async () => {
      const r = await run([`${base}/wide`, 'wide.png', '--width', '1440'], work);
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split('\n');
      assert.equal(lines.at(-2), 'overflow: scrollWidth=1700 viewport=1440 delta=260', r.stdout);
      assert.match(lines.at(-1), /^stitched wide\.png: 1440x\d+ from \d+ chunks$/);
      assert.equal(lines.filter((l) => LINE_RE.test(l)).length, 1, 'one overflow line per capture');
      assert.ok(statSync(join(work, 'wide.png')).size > 0);
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
    // --hide: the same command shape with and without the flag; the PNG's IHDR height is the stitched height.
    const pngHeight = (f) => readFileSync(join(work, f)).readUInt32BE(20);
    const lastTwo = (r) => r.stdout.trim().split('\n').slice(-2);
    const spec = join(work, 'geo-inv.spec.json');
    writeFileSync(spec, JSON.stringify({ out: join(work, 'geo-inv.json'), side: 'live', presence: { rootSel: null, variableSels: [] } }));
    const settled = run([`${base}/geo`, 'geo-settle.png', '--settle', '--hide', '.geo-bar', '--inventory', spec], work);
    await check('e2e --hide: an 88 px in-flow .geo-bar — the stitch is 88 px shorter with `hidden: .geo-bar ×1 (88px) [--hide]` (also under --no-dismiss); ×0 changes nothing; no flag → no line', async () => {
      const [plain, hid, noDismiss, none] = await Promise.all([
        run([`${base}/geo`, 'geo-plain.png'], work),
        run([`${base}/geo`, 'geo-hide.png', '--hide', '.geo-bar'], work),
        run([`${base}/geo`, 'geo-nodismiss.png', '--no-dismiss', '--hide', '.geo-bar'], work),
        run([`${base}/geo`, 'geo-none.png', '--hide', '.no-such-bar'], work),
      ]);
      for (const r of [plain, hid, noDismiss, none]) assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(plain.stdout, /^hidden:/m, 'no --hide → no hidden line');
      for (const r of [hid, noDismiss]) {
        assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('hidden:')).join('|'), 'hidden: .geo-bar ×1 (88px) [--hide]', r.stdout);
        assert.match(lastTwo(r)[0], LINE_RE, 'the overflow line still sits right before the stitched line');
      }
      assert.match(noDismiss.stdout, /^overlays left as the page shows them \(--no-dismiss\)$/m);
      assert.match(none.stdout, /^hidden: \.no-such-bar ×0 \[--hide\]$/m);
      const h = { plain: pngHeight('geo-plain.png'), hid: pngHeight('geo-hide.png'), noDismiss: pngHeight('geo-nodismiss.png'), none: pngHeight('geo-none.png') };
      assert.equal(h.hid, h.plain - 88, JSON.stringify(h));
      assert.equal(h.noDismiss, h.hid, JSON.stringify(h));
      assert.equal(h.none, h.plain, JSON.stringify(h));
      assert.equal(lastTwo(hid)[1], `stitched geo-hide.png: 1440x${h.hid} from 2 chunks`);
    });
    await check('e2e --hide under --settle: applied after the settle sweep and before --inventory — the inventory sees the hidden page', async () => {
      const r = await settled;
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^hidden: \.geo-bar ×1 \(88px\) \[--hide\]$/m);
      const inv = JSON.parse(readFileSync(join(work, 'geo-inv.json'), 'utf8'));
      assert.equal(inv.error, undefined, inv.error);
      assert.equal(inv.docH, pngHeight('geo-settle.png'), 'inventory and stitch measure the same page');
      assert.equal(inv.docH, pngHeight('geo-hide.png'));
      assert.equal(inv.items.find((x) => x.kind === 'heading').y, 60, 'the heading sits right below the 60 px header (148 with the bar)');
      assert.ok(!inv.items.some((x) => x.href === '/loc'), 'the bar\'s link is not inventoried');
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
