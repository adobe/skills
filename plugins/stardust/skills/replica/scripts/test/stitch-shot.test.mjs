#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — stitch-shot.mjs without a browser: importing the module starts
// no capture; --help answers in an empty cwd with nothing written (playwright and pngjs load lazily); the sidecar
// path; the exit code per error class (BotChallengeError → 3, anything else → 1); recheckDenial on stub pages
// through the real pageDenial / botChallengeError — a vendor signature or a tiny one-error-heading page throws the
// exit-3 error naming "HTTP <status> denial page — …", "origin blocked" and --headed, an ordinary page is 'ok', a
// page the probe cannot read or a live-session copy that predates pageDenial is 'skipped: <reason>' with ONE stderr
// line. End to end, where playwright and pngjs are importable from the scripts dir: a local server's denial pages
// (the recorded shape — about 900 px of "can't process your request" + "Incident Number" served with 200 — the same
// rendered by script after load, and a tiny page under one error heading) exit 3 with no PNG and no capture.json;
// an ordinary page and a long article that mentions "press & hold" exit 0 and capture.json records denialCheck 'ok'.
// Also (0.34.3): parseArgs, overlayExtras, chunkTarget, scrollStalled, stitchRows, and end to end --consent closing a
// fixture consent box and --no-dismiss leaving it.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HELP, UsageError, chunkTarget, exitCodeFor, overlayExtras, parseArgs, recheckDenial, scrollStalled, sidecarOf, stitchRows } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
// live-session.mjs in either layout (plugin tree / project copy) — imports nothing, so the pure part can use it
const LIB = ['../../../diff/scripts/live-session.mjs', '../../diff/live-session.mjs'].map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const session = await import(pathToFileURL(LIB).href);
let checks = 0; let failed = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// stderr lines console.error printed while fn ran
const stderrOf = async (fn) => {
  const lines = []; const { error } = console;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = error; }
  return lines;
};

const argv = (...a) => ['node', SCRIPT, ...a];
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

await check('sidecarOf: <out>.png → <out>.capture.json beside it (live.png → live.capture.json), any case of the extension', () => {
  assert.equal(sidecarOf('stardust/replica/gates/home-1440/live.png'), 'stardust/replica/gates/home-1440/live.capture.json');
  assert.equal(sidecarOf('/tmp/x/build.PNG'), '/tmp/x/build.capture.json');
  assert.equal(sidecarOf('shot'), 'shot.capture.json');
});
await check('exitCodeFor: a BotChallengeError is 3 (blocked — escalate --headed), every other error 1 (capture broke)', () => {
  assert.equal(exitCodeFor(session.botChallengeError('https://x.test/', 'HTTP 200 denial page — "System Down"', { denial: true })), 3);
  assert.equal(exitCodeFor(session.botChallengeError('https://x.test/', 'cf-mitigated: challenge')), 3);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { name: 'LiveHTTPError' })), 1);
  assert.equal(exitCodeFor(new Error('scroll stall at chunk target 900px')), 1);
  assert.equal(exitCodeFor(null), 1);
});
const pageOf = (probe) => ({ evaluate: async () => probe, waitForTimeout: async () => {} });
await check('recheckDenial (stub pages, the real pageDenial): a vendor signature → BotChallengeError naming HTTP <status>, the signature, "origin blocked", --headed — exit code 3', async () => {
  const denied = { title: 'Notice', text: 'System Down Please try again later.', bytes: 35, headings: [], frames: [] };
  const err = await recheckDenial(session, pageOf(denied), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(err && err.name, 'BotChallengeError');
  assert.equal(err.marker, 'HTTP 200 denial page — "System Down"');
  assert.equal(err.url, 'https://x.test/');
  assert.match(err.message, /^bot challenge at https:\/\/x\.test\/: HTTP 200 denial page — "System Down" — origin blocked/);
  assert.match(err.message, /--headed/);
  assert.equal(exitCodeFor(err), 3);
  const recorded = { title: 'Notice', text: 'We can\'t process your request We\'re sorry, we can\'t process your request right now. Please try again later. Incident Number: 18.4f2a7c31.1700000000.1a2b3c', bytes: 170, headings: ['We can\'t process your request'], frames: [] };
  const late = await recheckDenial(session, pageOf(recorded), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(late && late.marker, 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"', 'the recorded shape, rendered after the entry read');
});
await check('recheckDenial: the generic rule — a page under 2 KB of text under one error heading → the same error naming the bytes and the heading', async () => {
  const tiny = { title: 'Error', text: 'Something went wrong Please try again in a few minutes.', bytes: 56, headings: ['Something went wrong'], frames: [] };
  const err = await recheckDenial(session, pageOf(tiny), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(err && err.marker, 'HTTP 200 denial page — 56 B of text under one error heading "Something went wrong"');
  assert.equal(exitCodeFor(err), 3);
});
await check('recheckDenial: an ordinary page → \'ok\', nothing on stderr; a page the probe cannot read → \'skipped: <reason>\' with ONE stderr line, no throw', async () => {
  const ordinary = { title: 'Spring range', text: 'Ordinary page copy. '.repeat(200), bytes: 4000, headings: ['Spring range', 'New arrivals'], frames: [] };
  let out;
  assert.deepEqual(await stderrOf(async () => { out = await recheckDenial(session, pageOf(ordinary), 'https://x.test/', 200); }), []);
  assert.equal(out, 'ok');
  const small = { title: 'Coming soon', text: 'Coming soon. Our new site launches in May.', bytes: 42, headings: ['Coming soon'], frames: [] };
  assert.equal(await recheckDenial(session, pageOf(small), 'https://x.test/', 200), 'ok', 'a small page under one plain heading');
  const unreadable = { evaluate: async () => { throw new Error('Execution context was destroyed, most likely because of a navigation\n  at …'); }, waitForTimeout: async () => {} };
  let skipped;
  assert.deepEqual(await stderrOf(async () => { skipped = await recheckDenial(session, unreadable, 'https://x.test/', 200); }), ['stitch-shot: denial-page check skipped (Execution context was destroyed, most likely because of a navigation)']);
  assert.equal(skipped, 'skipped: Execution context was destroyed, most likely because of a navigation');
});
await check('recheckDenial: a live-session copy that predates pageDenial / botChallengeError never throws — \'skipped: live-session.mjs predates pageDenial\' and ONE stderr line naming the stale copy', async () => {
  for (const stale of [{}, { pageDenial: session.pageDenial }, { botChallengeError: session.botChallengeError }]) {
    let out;
    const lines = await stderrOf(async () => { out = await recheckDenial(stale, { evaluate: async () => { throw new Error('never read'); } }, 'https://x.test/', 200); });
    assert.deepEqual(lines, ['stitch-shot: denial-page check skipped (live-session.mjs predates pageDenial — copy the diff skill\'s live-session.mjs alongside)'], Object.keys(stale).join() || 'neither');
    assert.equal(out, 'skipped: live-session.mjs predates pageDenial');
  }
});
await check('--help in an empty cwd: exit 0, usage, exit 3 named for an edge interstitial or a 2xx denial page with --headed, the capture.json record — nothing written, no playwright needed; importing this module started no capture', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.match(r.stdout, /3 bot challenge[^]*2xx denial page[^]*pageDenial[^]*no PNG, no capture\.json; escalate --headed/);
    for (const f of ['--consent <sel>', '--dismiss <sel,…>', '--no-dismiss']) assert.ok(r.stdout.includes(f) && HELP.includes(f), f);
    assert.match(r.stdout, /<stem>\.capture\.json/);
    assert.match(r.stdout, /denialCheck = 'ok' \|\n'skipped: <reason>'/);
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(cwd), []);
    // no arguments: the usage error, exit 1, before any I/O (and before playwright is asked for)
    const bare = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /^need <url> and <out\.png>/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('playwright'); await import('pngjs');"], { cwd: dirname(SCRIPT), encoding: 'utf8' });
if (pwProbe.status !== 0) {
  console.log('skip  end-to-end stitch-shot (playwright / pngjs not importable from the scripts dir; run this test in an environment that has them)');
} else {
  const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0}section{height:600px;background:#ddd}</style></head><body>${body}</body></html>`;
  // the recorded shape: about 900 px, "can't process your request" + "Incident Number", status 200, one heading
  const RECORDED = '<div style="height:900px;padding:40px;font:16px sans-serif"><h1>We can\'t process your request</h1><p>We\'re sorry, we can\'t process your request right now. Please try again later.</p><p>Incident Number: 18.4f2a7c31.1700000000.1a2b3c</p></div>';
  const pages = {
    '/ok': html('Spring range', '<h1>Spring range</h1><section></section><h2>New arrivals</h2><section></section><p>Three lines of ordinary copy.</p>'),
    '/denied': html('Notice', RECORDED),
    '/denied-late': html('Notice', `<p>Loading the page.</p><script>document.addEventListener('DOMContentLoaded', () => setTimeout(() => { document.body.innerHTML = ${JSON.stringify(RECORDED)}; }, 500));</script>`),
    '/denied-heading': html('Error', '<h1>Something went wrong</h1><p>Please try again in a few minutes.</p>'),
    '/consent': html('Consent', '<style>body{height:2400px}h1,p{margin:0}#cmp{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div id="cmp"><button id="yes" onclick="document.getElementById(\'cmp\').remove()">Yes</button></div>'),
    '/article': html('Voice notes', `<h1>Voice notes</h1>${'<p>Press &amp; hold the button to record a voice note, then release it to send. The note is kept for thirty days and can be replayed from the thread.</p>'.repeat(30)}<section></section><section></section>`),
  };
  const server = createServer((req, res) => {
    const body = pages[new URL(req.url, 'http://127.0.0.1/').pathname];
    if (!body) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'stitch-e2e-'));
  const stitch = (path, name, extra = []) => new Promise((resolveRun) => {
    const out = join(work, `${name}.png`);
    const child = spawn(process.execPath, [SCRIPT, `${base}${path}`, out, '--width', '800', '--vh', '600', '--wait', '900', '--timeout', '30000', ...extra], { cwd: work });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr, out, sidecar: sidecarOf(out), cap: existsSync(sidecarOf(out)) ? JSON.parse(readFileSync(sidecarOf(out), 'utf8')) : null }));
  });
  try {
    const pngSize = (f) => { const b = readFileSync(f); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
    const [ok, article, consent, noDismiss, ...denied] = await Promise.all([stitch('/ok', 'ok'), stitch('/article', 'article'), stitch('/consent', 'consent', ['--consent', '#yes']), stitch('/consent', 'nodismiss', ['--no-dismiss']), stitch('/denied', 'denied'), stitch('/denied-late', 'denied-late'), stitch('/denied-heading', 'denied-heading')]);
    await check('e2e: an ordinary page → exit 0, the PNG and capture.json beside it — { writtenBy, url, width, vh, height, chunks, denialCheck: \'ok\', at }', () => {
      assert.equal(ok.status, 0, ok.stderr);
      assert.ok(existsSync(ok.out), 'the PNG');
      assert.ok(ok.cap, 'the sidecar');
      assert.deepEqual(Object.keys(ok.cap), ['writtenBy', 'url', 'width', 'vh', 'height', 'chunks', 'denialCheck', 'at']);
      assert.deepEqual([ok.cap.writtenBy, ok.cap.url, ok.cap.width, ok.cap.vh, ok.cap.denialCheck], ['skills/replica/scripts/stitch-shot.mjs', `${base}/ok`, 800, 600, 'ok']);
      assert.ok(ok.cap.height >= 1200 && ok.cap.chunks >= 2 && !Number.isNaN(Date.parse(ok.cap.at)), JSON.stringify(ok.cap));
      assert.match(ok.stdout, /stitched .*ok\.png: 800x\d+ from \d+ chunks/);
      assert.doesNotMatch(ok.stderr, /denial/);
    });
    await check('e2e: a long article whose text says "press & hold the button" is no denial page — exit 0, denialCheck \'ok\'', () => {
      assert.equal(article.status, 0, article.stderr);
      assert.equal(article.cap && article.cap.denialCheck, 'ok');
      assert.doesNotMatch(article.stderr, /denial/);
    });
    await check('e2e: --consent <sel> closes the fixture consent box; the capture is width × document height from vh-sized chunks', () => {
      assert.equal(consent.status, 0, consent.stderr + consent.stdout);
      assert.match(consent.stdout, /overlay dismissed via extra selector #yes/); assert.match(consent.stdout, /stitched .*: 800x2400 from 4 chunks/);
      assert.deepEqual(pngSize(consent.out), { width: 800, height: 2400 }); assert.equal(consent.cap && consent.cap.denialCheck, 'ok');
    });
    await check('e2e: --no-dismiss leaves overlays alone and says so', () => {
      assert.equal(noDismiss.status, 0, noDismiss.stderr + noDismiss.stdout);
      assert.match(noDismiss.stdout, /overlays left as the page shows them \(--no-dismiss\)/); assert.doesNotMatch(noDismiss.stdout, /dismissed via/);
      assert.deepEqual(pngSize(noDismiss.out), { width: 800, height: 2400 });
    });
    const expected = [
      ['/denied', 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"'],
      ['/denied-late', 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"'],
      ['/denied-heading', 'HTTP 200 denial page — '],
    ];
    for (const [i, [path, marker]] of expected.entries()) {
      const r = denied[i];
      await check(`e2e: ${path} → exit 3, one reason line naming ${marker.trim()}…, "origin blocked" and --headed; no PNG, no capture.json`, () => {
        assert.equal(r.status, 3, r.stderr || r.stdout);
        assert.ok(r.stderr.includes(`stitch-shot error: bot challenge at ${base}${path}: ${marker}`), r.stderr);
        assert.ok(r.stderr.includes('origin blocked') && r.stderr.includes('--headed'), r.stderr);
        if (path === '/denied-heading') assert.match(r.stderr, /B of text under one error heading "Something went wrong"/);
        assert.equal(r.stderr.trim().split('\n').filter((l) => l.startsWith('stitch-shot error:')).length, 1, 'one reason line');
        assert.deepEqual([existsSync(r.out), existsSync(r.sidecar)], [false, false]);
      });
    }
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nstitch-shot: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
