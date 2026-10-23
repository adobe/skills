#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the stitch-shot.mjs contract. Part (a), no browser: argument
// parsing (defaults, --settle's wait, the overlay flags --consent / --dismiss / --no-dismiss, --ua / --wait / --timeout,
// usage errors), the extra-selector order handed to dismissOverlays, chunk targets, the scroll-stall guard, row
// stitching (rows past the document and columns past the viewport dropped), --help and a usage error through the
// CLI. Part (b): end-to-end against a fixture page served from this process (a consent box the --consent selector
// closes; --no-dismiss leaves it) — runs only where playwright is importable, prints a skip line otherwise.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP, UsageError, chunkTarget, overlayExtras, parseArgs, scrollStalled, stitchRows } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
const root = mkdtempSync(join(tmpdir(), 'stitch-shot-test-'));
let failed = 0; let checks = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: root }); return { code: r.status, out: r.stdout, err: r.stderr }; };
// The fixture server lives in this process: end-to-end runs must not block the event loop, so they spawn asynchronously.
const runAsync = (args) => new Promise((res) => { const c = spawn(process.execPath, [SCRIPT, ...args], { cwd: root }); let out = ''; let err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => res({ code, out, err })); });
const argv = (...a) => ['node', SCRIPT, ...a];

// ---- (a) pure ------------------------------------------------------------------------------------
await check('parseArgs: positional url + out, defaults (1440×900, no settle, wait 1200, timeout 60000, dismissal on)', () => {
  const { url, out, opts } = parseArgs(argv('https://a/', 'o.png'));
  assert.equal(url, 'https://a/'); assert.equal(out, 'o.png');
  assert.equal(opts.width, 1440); assert.equal(opts.vh, 900); assert.equal(opts.settle, false); assert.equal(opts.wait, 1200); assert.equal(opts.timeout, 60000);
  assert.equal(opts.consent, null); assert.deepEqual(opts.dismiss, []); assert.equal(opts.noDismiss, false); assert.equal(opts.headed, false); assert.equal(opts.locale, null);
  assert.match(opts.ua, /Chrome\//);
});
await check('parseArgs: --settle raises the default wait to 3000; an explicit --wait wins; --width/--vh/--timeout/--ua/--locale/--headed', () => {
  assert.equal(parseArgs(argv('u', 'o', '--settle')).opts.wait, 3000);
  const { opts } = parseArgs(argv('u', 'o', '--settle', '--wait', '500', '--width', '360', '--vh', '640', '--timeout', '9000', '--ua', 'UA/1', '--locale', 'en-GB', '--headed'));
  assert.equal(opts.wait, 500); assert.equal(opts.width, 360); assert.equal(opts.vh, 640); assert.equal(opts.timeout, 9000); assert.equal(opts.ua, 'UA/1'); assert.equal(opts.locale, 'en-GB'); assert.equal(opts.headed, true);
});
await check('parseArgs: --consent keeps one selector, --dismiss splits on commas and trims, --no-dismiss is a flag', () => {
  const { opts } = parseArgs(argv('u', 'o', '--consent', '#yes', '--dismiss', ' .close , #later,, '));
  assert.equal(opts.consent, '#yes'); assert.deepEqual(opts.dismiss, ['.close', '#later']); assert.equal(opts.noDismiss, false);
  assert.equal(parseArgs(argv('u', 'o', '--no-dismiss')).opts.noDismiss, true);
});
await check('parseArgs: a missing positional or an unknown flag is a UsageError (the CLI prints HELP and exits 1)', () => {
  assert.throws(() => parseArgs(argv('u')), (e) => e instanceof UsageError && /need <url> and <out\.png>/.test(e.message));
  assert.throws(() => parseArgs(argv('u', 'o', '--bogus')), (e) => e instanceof UsageError && /unknown flag --bogus/.test(e.message));
});
await check('overlayExtras: the consent selector first, then the dismiss list; nothing when neither is set', () => {
  assert.deepEqual(overlayExtras({ consent: '#yes', dismiss: ['.a', '.b'] }), ['#yes', '.a', '.b']);
  assert.deepEqual(overlayExtras({ consent: null, dismiss: ['.a'] }), ['.a']);
  assert.deepEqual(overlayExtras({ consent: null, dismiss: [] }), []);
});
await check('chunkTarget: steps of vh, the last chunk clamped to totalH - vh, never negative', () => {
  assert.equal(chunkTarget(0, 2400, 900), 0); assert.equal(chunkTarget(900, 2400, 900), 900); assert.equal(chunkTarget(1800, 2400, 900), 1500);
  assert.equal(chunkTarget(0, 500, 900), 0);
});
await check('scrollStalled: fires only when the window did not advance AND the target is more than 4 px away', () => {
  assert.equal(scrollStalled(null, 0, 0), false, 'first chunk never stalls');
  assert.equal(scrollStalled(0, 900, 900), false, 'advanced');
  assert.equal(scrollStalled(900, 900, 1500), true, 'stuck with 600 px to go');
  assert.equal(scrollStalled(1497, 1497, 1500), false, 'fractional-scroll slack (3 px)');
  assert.equal(scrollStalled(900, 400, 1500), true, 'went backwards');
});
await check('stitchRows: chunks land at their y, rows past totalH and columns past width are dropped', () => {
  const px = (w, h, v) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, v) });
  const out = stitchRows([{ y: 0, img: px(2, 2, 1) }, { y: 2, img: px(3, 2, 2) }], 2, 3);
  assert.equal(out.length, 2 * 3 * 4);
  assert.deepEqual([...out.subarray(0, 16)], Array(16).fill(1), 'rows 0–1 from chunk 1');
  assert.deepEqual([...out.subarray(16, 24)], Array(8).fill(2), 'row 2 from chunk 2, its third column dropped');
  const short = stitchRows([{ y: 0, img: px(2, 1, 7) }], 2, 3);
  assert.deepEqual([...short.subarray(8)], Array(16).fill(0), 'rows no chunk covers stay zero');
});
await check('--help prints the usage (exit 0) with the overlay flags, with no browser needed', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0, r.err); assert.ok(r.out.includes('Usage: node stitch-shot.mjs <url> <out.png>'), r.out);
  for (const f of ['--consent <sel>', '--dismiss <sel,…>', '--no-dismiss']) assert.ok(r.out.includes(f) && HELP.includes(f), f);
});
await check('a usage error through the CLI prints the message and the usage, exit 1', () => {
  const r = run(['https://a/']);
  assert.equal(r.code, 1); assert.match(r.err, /need <url> and <out\.png>/); assert.match(r.err, /Usage: node stitch-shot\.mjs/);
});

// ---- (b) end-to-end against a fixture page (needs playwright) -----------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end capture (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const page = `<!doctype html><html><head><style>html,body{margin:0}body{height:2400px;background:linear-gradient(#036,#9cf)}
    #cmp{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style></head>
    <body><div id="cmp"><button id="yes" onclick="document.getElementById('cmp').remove()">Yes</button></div></body></html>`;
  const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(page); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const pngSize = (f) => { const b = readFileSync(f); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
  await check('end-to-end: --consent <sel> closes the fixture consent box, the capture is width × document height from vh-sized chunks', async () => {
    const out = join(root, 'a.png');
    const r = await runAsync([url, out, '--width', '800', '--vh', '600', '--consent', '#yes']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /overlay dismissed via extra selector #yes/); assert.match(r.out, /stitched .*: 800x2400 from 4 chunks/);
    assert.ok(existsSync(out)); assert.deepEqual(pngSize(out), { width: 800, height: 2400 });
  });
  await check('end-to-end: --no-dismiss leaves overlays alone and says so', async () => {
    const out = join(root, 'b.png');
    const r = await runAsync([url, out, '--width', '800', '--vh', '600', '--no-dismiss']);
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /overlays left as the page shows them \(--no-dismiss\)/); assert.doesNotMatch(r.out, /dismissed via/);
    assert.deepEqual(pngSize(out), { width: 800, height: 2400 });
  });
  server.close();
}

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nstitch-shot: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
