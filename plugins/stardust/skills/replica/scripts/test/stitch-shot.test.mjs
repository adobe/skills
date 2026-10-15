#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the stitch-shot contract: the pure `overflow:` root line
// gate.sh's horizontal-overflow assert reads (viewport = innerWidth, delta = scrollWidth − clientWidth clamped at 0),
// --help before any import or I/O (exit 0 in an empty cwd, writes nothing, also where playwright is not importable);
// then, where playwright is importable, end-to-end against an in-process node:http origin: a page 1700 px wide and a
// fitting page at --width 1440 (the overflow line beside a written PNG), and the EDS single sweep — no timed poll
// (lateWindowFor → 0) but one dismissOverlays pass after waitEdsDelayedPhase still clicks a consent banner that
// appears 3 s after `load` (the EDS delayed phase), which an immediate sweep misses. Prints a skip line otherwise.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { overflowLine } from '../stitch-shot.mjs';

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

console.log(failed ? `\n${failed} check(s) failing` : '\nstitch-shot: all checks passed');
process.exit(failed ? 1 : 0);
