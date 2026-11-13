#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — stitch-shot.mjs without a browser: importing the module starts
// no capture; --help answers in an empty cwd with nothing written (playwright and pngjs load lazily); the sidecar
// path; the exit code per error class (BotChallengeError → 3, anything else → 1); recheckDenial on stub pages
// through the real pageDenial / botChallengeError — a vendor signature or a tiny one-error-heading page throws the
// exit-3 error naming "HTTP <status> denial page — …", "origin blocked" and --headed, an ordinary page is 'ok', a
// page the probe cannot read is 'skipped: <reason>' with ONE stderr line. End to end, where playwright and pngjs are
// importable from the scripts dir: a local server's denial pages
// (the recorded shape — about 900 px of "can't process your request" + "Incident Number" served with 200 — the same
// rendered by script after load, and a tiny page under one error heading) exit 3 with no PNG and no capture.json;
// an ordinary page and a long article that mentions "press & hold" exit 0 and capture.json records denialCheck 'ok'.
// Also (0.34.3): parseArgs, overlayExtras, chunkTarget, scrollStalled, stitchRows, and end to end --consent closing a
// fixture consent box and --no-dismiss leaving it. And (0.34.5) the origin-baseline contract, no browser: the pure
// bookkeeping (baselineTargets, baselineProvenance, writeJsonAtomic, baselineExists / readBaselineProvenance,
// baselineStatus, compareBaseline, liveRecord), the two subcommands gate.sh calls (`baseline <dir>`, `record <live.json>`),
// the refusals that precede any capture and the default-OFF parse. And (0.36.1) the font check: fontFamilies, faceKey,
// deadFontFaces (a dead face = status error with no loaded twin of its family, weight and style), fontCheckOutcome,
// fontCheckLines; end to end a 404 face and an unresolved local() named in the capture record's fontsFailed, a clean
// page → [], document.fonts throwing → null + fontCheck, a failed capture removing an earlier record. And (0.34.12) fixed /
// sticky layers captured once: layerAction, isBackdrop, overlaySuspects, layerPassScript (the in-page pass) on a stub DOM,
// and end to end a fixed header, a scroll-triggered one and a fixed inset:0 backdrop. And the freeze as a constructed
// stylesheet (applyFreeze on stub pages: adopted → 'applied', the <style> fallback, both refused → 'failed: …' with no
// throw; freezeLines) and the height re-measured per chunk (heightCap, heightNow, nextChunkStart, heightChangeOf,
// planCapture over height sequences: a document that shrinks or grows is captured to its settled height, a
// scroll-jacked one still stalls); end to end a strict-CSP page with a running animation, a sticky and a fixed header
// that get 8 px shorter after the first scroll, a page that grows, and a scroll-jacked page.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_JSON, BASELINE_PNG, BASELINE_SCHEMA, BASELINE_WRITER, FREEZE_CSS, HELP, LIVE_RECORD_WRITER, UsageError,
  applyFreeze, freezeLines, heightCap, heightChangeOf, heightNow, nextChunkStart, planCapture,
  baselineExists, baselineProvenance, baselineStatus, baselineTargets, chunkTarget, compareBaseline, deadFontFaces, exitCodeFor, faceKey,
  fontCheckLines, fontCheckOutcome, fontFamilies, isBackdrop, layerAction, layerPassScript, liveRecord, overlayExtras, overlaySuspects,
  parseArgs, readBaselineProvenance, recheckDenial, recordCommand, scrollStalled, sidecarOf, stitchRows, writeJsonAtomic,
} from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
// the front door (browser.mjs) in either layout (plugin tree / project copy) — the pure part uses its live-session names
const BROWSER = ['../../../stardust/scripts/browser.mjs', '../../stardust/browser.mjs'].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const session = await import(BROWSER.href);
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
  assert.equal(opts.ua, null, 'no user agent of our own — the browser presents its own');
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

await check('heightCap / heightNow: growth is followed to twice the starting height (four more viewports for a short page); an unreadable or blank measure keeps the height known so far', () => {
  assert.equal(heightCap(5000, 900), 10000); assert.equal(heightCap(1000, 900), 4600);
  assert.equal(heightNow(1805, 1797, 1805, 900), 1797, 'shrank');
  assert.equal(heightNow(2360, 3038, 2360, 900), 3038, 'grew');
  assert.equal(heightNow(5000, 99999, 5000, 900), 10000, 'capped');
  assert.equal(heightNow(1805, null, 1805, 900), 1805); assert.equal(heightNow(1805, NaN, 1805, 900), 1805); assert.equal(heightNow(1805, 0, 1805, 900), 1805);
  assert.equal(heightNow(1805, 1796.6, 1805, 900), 1797, 'whole px');
});
await check('nextChunkStart: one viewport on — from where the window landed when that is short of the chunk start', () => {
  assert.equal(nextChunkStart(900, 900, 900), 1800, 'landed on the target');
  assert.equal(nextChunkStart(900, 892, 900), 1792, 'pulled back 8 px: the next chunk starts where this one ended');
  assert.equal(nextChunkStart(3600, 2788, 900), 3688, 'the clamped last chunk ends at the bottom');
  assert.equal(nextChunkStart(900, 892.5, 900), 1792, 'fractional scroll: whole px, never a gap');
});
await check('heightChangeOf: null when the height did not move; { initial, final } when it did; capped: true when growth passed the cap', () => {
  assert.equal(heightChangeOf(1805, 1805), null);
  assert.deepEqual(heightChangeOf(1805, 1797), { initial: 1805, final: 1797 });
  assert.deepEqual(heightChangeOf(1000, 4600, true), { initial: 1000, final: 4600, capped: true });
});
// a model window: scrollTo clamps to the document's bottom; `heights(chunkIndex, target)` says how tall the document is
// after that scroll, `shift` how far the window is pulled back (scroll anchoring)
const win = (vh, heights, shift = () => 0) => (target, i) => { const height = heights(i, target); return { actualY: Math.max(0, Math.min(target - shift(i), height - vh)), height }; };
await check('planCapture: a document that does not change — the chunks the script always took (steps of vh, the last clamped)', () => {
  const r = planCapture(3688, 900, win(900, () => 3688));
  assert.deepEqual(r.chunks.map((c) => c.actualY), [0, 900, 1800, 2700, 2788]); assert.equal(r.height, 3688); assert.equal(r.stalled, null);
  assert.deepEqual(planCapture(500, 900, win(900, () => 500)).chunks, [{ target: 0, actualY: 0 }], 'shorter than the viewport: one chunk');
});
await check('planCapture: the document gets 8 px shorter after the first scroll (1805 → 1797) — no stall, settled height, every row covered; the stale-height clamp is what stalled', () => {
  const heights = (i) => (i === 0 ? 1805 : 1797);
  // no scroll anchoring: the window is clamped at the new bottom
  const a = planCapture(1805, 900, win(900, heights));
  assert.equal(a.stalled, null); assert.equal(a.height, 1797); assert.deepEqual(a.chunks.map((c) => c.actualY), [0, 897]);
  // the same sequence against the height read once: chunk 2 lands on 897, chunk 3's stale target is 905 → a stall
  assert.equal(scrollStalled(897, 897, chunkTarget(1800, 1805, 900)), true, 'the defect');
  assert.equal(scrollStalled(897, 897, chunkTarget(1800, 1797, 900)), false, 'the current height');
  // scroll anchoring pulls the window back 8 px when the header shrinks: a third chunk covers the last rows
  const b = planCapture(1805, 900, win(900, heights, (i) => (i === 1 ? 8 : 0)));
  assert.equal(b.stalled, null); assert.equal(b.height, 1797); assert.deepEqual(b.chunks.map((c) => c.actualY), [0, 892, 897]);
  for (const r of [a, b]) assert.equal(r.chunks.at(-1).actualY + 900, r.height, 'the last chunk ends at the settled bottom');
});
await check('planCapture: a document that shrinks at the last chunk, or to less than one viewport, ends without a stall', () => {
  const a = planCapture(2400, 900, win(900, (i) => (i < 2 ? 2400 : 2300)));
  assert.equal(a.stalled, null); assert.equal(a.height, 2300); assert.deepEqual(a.chunks.map((c) => c.actualY), [0, 900, 1400]);
  const b = planCapture(1000, 900, win(900, (i) => (i === 0 ? 1000 : 880)));
  assert.equal(b.stalled, null); assert.equal(b.height, 880);
});
await check('planCapture: a document that grows moderately is followed to its settled height; an endless feed stops at the cap', () => {
  const a = planCapture(2360, 900, win(900, (i, target) => (target > 1000 ? 3038 : 2360)));
  assert.equal(a.stalled, null); assert.equal(a.height, 3038); assert.equal(a.chunks.at(-1).actualY, 3038 - 900);
  for (let i = 1; i < a.chunks.length; i += 1) assert.ok(a.chunks[i].actualY <= a.chunks[i - 1].actualY + 900, 'no gap between chunks');
  const feed = planCapture(2000, 900, win(900, (i) => 2000 + (i + 1) * 5000));
  assert.equal(feed.stalled, null); assert.equal(feed.height, heightCap(2000, 900)); assert.equal(feed.chunks.at(-1).actualY, heightCap(2000, 900) - 900);
});
await check('planCapture: a scroll-jacked page (the document stays tall, the window never moves) still stalls at chunk 2 — also when its height changes', () => {
  const jacked = (heights) => (target, i) => ({ actualY: 0, height: heights(i) });
  const a = planCapture(3688, 900, jacked(() => 3688));
  assert.deepEqual(a.stalled, { target: 900, actualY: 0, height: 3688 }); assert.equal(a.chunks.length, 1);
  const b = planCapture(3688, 900, jacked((i) => 3688 - 8 * i));
  assert.ok(b.stalled && b.chunks.length === 1, 'a shrinking jacked page');
  // a window that creeps a few px per scroll never converges: reported, not looped forever
  const creep = planCapture(3000, 900, (target, i) => ({ actualY: i * 5, height: 3000 }));
  assert.ok(creep.stalled, 'a creeping window');
});
await check('applyFreeze: the constructed stylesheet first (no <style>) → \'applied\'; refused → the <style> fallback; both refused → \'failed: …\' naming both, never a throw; freezeLines warns only then', async () => {
  assert.match(FREEZE_CSS, /animation-play-state:paused!important/); assert.match(FREEZE_CSS, /transition:none!important/);
  const calls = [];
  const page = (evaluate, addStyleTag) => ({ evaluate: async (fn, css) => { calls.push(['evaluate', css]); return evaluate(fn, css); }, addStyleTag: async (o) => { calls.push(['addStyleTag', o.content]); return addStyleTag(o); } });
  // the in-page function on a stub document: the sheet is adopted beside the page's own, the rules counted
  const run = (fn, css) => {
    class CSSStyleSheet { replaceSync(t) { this.cssRules = t.split('}').filter(Boolean); } }
    const document = { adoptedStyleSheets: [{ own: true }] };
    const n = runInNewContext(`(${fn})(css)`, { CSSStyleSheet, document, css });
    assert.equal(document.adoptedStyleSheets.length, 2, 'the page\'s own adopted sheet is kept'); assert.ok(document.adoptedStyleSheets[0].own);
    return n;
  };
  assert.equal(await applyFreeze(page(run, () => { throw new Error('not reached'); })), 'applied');
  assert.deepEqual(calls, [['evaluate', FREEZE_CSS]], 'no <style> is injected when the sheet is adopted');
  calls.length = 0;
  assert.equal(await applyFreeze(page(() => { throw new Error('CSSStyleSheet is not a constructor'); }, () => ({}))), 'applied', 'the <style> fallback');
  assert.deepEqual(calls.map((c) => c[0]), ['evaluate', 'addStyleTag']);
  assert.equal(await applyFreeze(page(() => 0, () => ({}))), 'applied', 'a sheet that was not adopted → the fallback');
  const failed = await applyFreeze(page(() => { throw new Error('CSSStyleSheet is not a constructor\n  at stack'); }, () => { throw new Error('page.addStyleTag: Applying inline style violates the following Content Security Policy directive\nmore'); }));
  assert.equal(failed, 'failed: constructed stylesheet: CSSStyleSheet is not a constructor; <style>: page.addStyleTag: Applying inline style violates the following Content Security Policy directive');
  assert.deepEqual(freezeLines('applied'), []);
  const lines = freezeLines(failed);
  assert.equal(lines.length, 1); assert.match(lines[0], /^stitch-shot WARNING: the animation \/ transition freeze was not applied \(constructed stylesheet: /);
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
await check('a copy without the master scripts stops with the copy instruction', () => {
  const copy = mkdtempSync(join(tmpdir(), 'stitch-nomaster-'));
  try {
    copyFileSync(SCRIPT, join(copy, 'stitch-shot.mjs'));
    const r = spawnSync(process.execPath, [join(copy, 'stitch-shot.mjs'), '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes('browser.mjs not found') && r.stderr.includes('stardust/scripts/stardust/'), r.stderr);
  } finally { rmSync(copy, { recursive: true, force: true }); }
});
await check('--help in an empty cwd: exit 0, usage, exit 3 named for an edge interstitial or a 2xx denial page with --headed, the capture.json record — nothing written, no playwright needed; importing this module started no capture', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.match(r.stdout, /3 bot challenge[^]*2xx denial page[^]*pageDenial[^]*no PNG, no capture\.json; escalate --headed/);
    for (const f of ['--consent <sel>', '--dismiss <sel,…>', '--no-dismiss', '--freeze-baseline', '--check-baseline', '--force', 'baseline <dir>', 'record <live.json>', '--gate-against-baseline', 'fontsFailed = [] (every declared face loaded)', 'null + fontCheck']) assert.ok(r.stdout.includes(f) && HELP.includes(f), f);
    assert.match(r.stdout, /<stem>\.capture\.json/);
    assert.match(r.stdout, /denialCheck = 'ok' \| 'skipped: <reason>'/);
    assert.match(r.stdout, /freeze =\n'applied' \| 'failed: <msg>'/); assert.match(r.stdout, /heightChange = \{ initial, final\[, capped\] \}/);
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(cwd), []);
    // no arguments: the usage error, exit 1, before any I/O (and before playwright is asked for)
    const bare = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /^need <url> and <out\.png>/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

const runIn = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const tmp = (tag) => mkdtempSync(join(tmpdir(), `stitch-${tag}-`));
const AT = '2026-10-19T08:00:00.000Z';
const URL_A = 'https://origin.example/';
const freeze = (dir, prov = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, BASELINE_PNG), 'frozen-png');
  writeFileSync(join(dir, BASELINE_JSON), `${JSON.stringify(baselineProvenance({ url: URL_A, width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, capturedAt: AT, fixedLayers: { capture: 'once', count: 1 }, ...prov }), null, 2)}\n`);
};

// ---- origin baseline: the parse, default OFF ------------------------------------------------------------------------
await check('parseArgs: the baseline flags are OFF by default and the other options are untouched; the flags switch on', () => {
  const opts = (extra) => parseArgs(['node', 'stitch-shot.mjs', URL_A, 'g/live.png', ...extra]).opts;
  const off = opts([]);
  assert.deepEqual([off.freezeBaseline, off.checkBaseline, off.force], [false, false, false], 'default OFF');
  assert.deepEqual([off.width, off.vh, off.settle, off.wait, off.timeout], [1440, 900, false, 1200, 60000], 'the rest as before');
  const on = opts(['--freeze-baseline', '--force', '--settle']);
  assert.deepEqual([on.freezeBaseline, on.force, on.checkBaseline, on.wait], [true, true, false, 3000]);
  assert.equal(opts(['--check-baseline']).checkBaseline, true);
});

// ---- the pure bookkeeping -------------------------------------------------------------------------------------
await check('baselineTargets: no flags → the given output and no gate dir; a freeze always lands in <dir>/baseline.png (a freeze aimed at live.png is redirected); a check keeps its output and refuses baseline.png', () => {
  assert.deepEqual(baselineTargets('g/live.png', {}), { out: 'g/live.png', baselineDir: null, redirected: false, refusal: null });
  assert.deepEqual(baselineTargets('g/live.png', { freezeBaseline: true }), { out: join('g', BASELINE_PNG), baselineDir: 'g', redirected: true, refusal: null });
  assert.deepEqual(baselineTargets(join('g', BASELINE_PNG), { freezeBaseline: true }), { out: join('g', BASELINE_PNG), baselineDir: 'g', redirected: false, refusal: null });
  assert.deepEqual(baselineTargets('g/live.png', { checkBaseline: true }), { out: 'g/live.png', baselineDir: 'g', redirected: false, refusal: null });
  const refused = baselineTargets(join('g', BASELINE_PNG), { checkBaseline: true });
  assert.deepEqual([refused.out, refused.baselineDir, refused.redirected], [join('g', BASELINE_PNG), 'g', false]);
  assert.match(refused.refusal, /--check-baseline captures a fresh shot to compare against baseline\.png and never writes it — name another output \(e\.g\. g\/live\.png\)/);
  assert.equal(baselineTargets(join('g', BASELINE_PNG), { freezeBaseline: true, checkBaseline: true }).refusal, null, 'freeze + check: the freeze owns baseline.png');
});
await check('baselineProvenance has the documented shape; numbers are numbers; a non-array fontsFailed becomes []', () => {
  const p = baselineProvenance({ url: URL_A, width: '1440', vh: 900, height: 2000, settle: true, chunks: 3, fontsFailed: ['Brand Sans'], capturedAt: AT });
  assert.deepEqual(Object.keys(p), ['writtenBy', 'schema', 'capturedAt', 'url', 'width', 'vh', 'height', 'settle', 'chunks', 'fontsFailed', 'fixedLayers']);
  assert.deepEqual(p, { writtenBy: BASELINE_WRITER, schema: BASELINE_SCHEMA, capturedAt: AT, url: URL_A, width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, fontsFailed: ['Brand Sans'], fixedLayers: null });
  assert.deepEqual(baselineProvenance({ url: URL_A, width: 360, height: 10, fontsFailed: null }).fontsFailed, []);
  assert.match(baselineProvenance({ url: URL_A, width: 360, height: 10 }).capturedAt, /^\d{4}-\d{2}-\d{2}T/, 'capturedAt defaults to now');
});
await check('writeJsonAtomic writes pretty JSON with a trailing newline through a sibling temp file and leaves none; baselineExists needs BOTH files; readBaselineProvenance round-trips and is null when unreadable', () => {
  const dir = tmp('atomic');
  try {
    const prov = baselineProvenance({ url: URL_A, width: 360, height: 5200, capturedAt: AT });
    assert.equal(baselineExists(dir), false, 'nothing yet');
    writeJsonAtomic(join(dir, BASELINE_JSON), prov);
    assert.equal(baselineExists(dir), false, 'baseline.json alone is not a baseline');
    writeFileSync(join(dir, BASELINE_PNG), 'png-bytes');
    assert.equal(baselineExists(dir), true, 'PNG + JSON');
    const text = readFileSync(join(dir, BASELINE_JSON), 'utf8');
    assert.ok(text.endsWith('}\n') && text.includes('\n  "schema"'), 'pretty + trailing newline');
    assert.deepEqual(readBaselineProvenance(dir), prov, 'round-trips');
    assert.equal(readdirSync(dir).some((n) => n.endsWith('.tmp')), false, 'no temp file left behind');
    writeFileSync(join(dir, BASELINE_JSON), '{ not json');
    assert.equal(readBaselineProvenance(dir), null, 'unreadable → null');
    writeFileSync(join(dir, BASELINE_JSON), '"a string"');
    assert.equal(readBaselineProvenance(dir), null, 'not an object → null');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('baselineStatus names, in one line, why a baseline is unusable — missing, a lone PNG, a lone JSON, unreadable, frozen for another URL, frozen at another width — and is ok for this page at this width (a trailing slash on the origin is the same URL)', () => {
  const dir = tmp('status');
  try {
    const g = join(dir, 'g');
    assert.deepEqual(baselineStatus(g), { ok: false, why: `no frozen baseline in ${g} (${BASELINE_PNG} + ${BASELINE_JSON})` });
    mkdirSync(g); writeFileSync(join(g, BASELINE_PNG), 'png');
    assert.match(baselineStatus(g).why, /baseline\.png has no baseline\.json beside it \(an interrupted freeze\) — re-freeze with --force$/);
    rmSync(join(g, BASELINE_PNG)); writeFileSync(join(g, BASELINE_JSON), '{}');
    assert.match(baselineStatus(g).why, /baseline\.json has no baseline\.png beside it — re-freeze with --force$/);
    writeFileSync(join(g, BASELINE_PNG), 'png'); writeFileSync(join(g, BASELINE_JSON), '{ nope');
    assert.match(baselineStatus(g).why, /baseline\.json is unreadable — re-freeze with --force$/);
    freeze(g, { fixedLayers: null });
    assert.match(baselineStatus(g).why, /^stale: .*baseline\.json was frozen before fixed\/sticky layers were captured once \(no fixedLayers\) — re-freeze with --force$/, 'frozen the old capture way');
    freeze(g);
    assert.equal(baselineStatus(g).ok, true, 'no url / width asked: present and readable is enough');
    assert.equal(baselineStatus(g, { url: 'https://origin.example', width: 1440 }).ok, true, 'same origin without the trailing slash');
    assert.equal(baselineStatus(g, { url: URL_A, width: '1440' }).ok, true, 'width as a string');
    assert.deepEqual(baselineStatus(g, { url: URL_A, width: 1440 }).provenance.capturedAt, AT);
    assert.match(baselineStatus(g, { url: 'https://origin.example/other' }).why, /^stale: .*baseline\.json was frozen for https:\/\/origin\.example\/, this round's live URL is https:\/\/origin\.example\/other — re-freeze with --force$/);
    assert.match(baselineStatus(g, { width: 360 }).why, /^stale: .*baseline\.json was frozen at 1440px, this round is 360px — re-freeze with --force$/);
    assert.match(baselineStatus(g, { url: URL_A, width: 360 }).why, /frozen at 1440px/, 'both given: the url matches, the width is what is stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('compareBaseline reports the height delta with no verdict; a missing height reads as null', () => {
  const base = baselineProvenance({ url: URL_A, width: 1440, height: 3093, capturedAt: AT });
  assert.deepEqual(compareBaseline(base, { height: 3093 }), { baselineHeight: 3093, freshHeight: 3093, dHeight: 0 });
  assert.deepEqual(compareBaseline(base, { height: 2661 }), { baselineHeight: 3093, freshHeight: 2661, dHeight: -432 });
  assert.deepEqual(compareBaseline({}, { height: 2904 }), { baselineHeight: null, freshHeight: 2904, dHeight: null });
});
await check('liveRecord: origin "baseline" carries at = the baseline\'s capturedAt and originBaseline { capturedAt, height }; origin "live" carries --at; each names its writer', () => {
  const base = baselineProvenance({ url: URL_A, width: 1440, height: 2000, capturedAt: AT });
  assert.deepEqual(liveRecord({ origin: 'baseline', url: URL_A, width: '1440', baseline: base }), { writtenBy: LIVE_RECORD_WRITER.baseline, origin: 'baseline', url: URL_A, width: 1440, at: AT, originBaseline: { capturedAt: AT, height: 2000 } });
  assert.deepEqual(liveRecord({ origin: 'baseline', url: URL_A, width: 1440, baseline: null }).originBaseline, { capturedAt: null, height: null }, 'an unreadable baseline.json → nulls, never a throw');
  assert.deepEqual(liveRecord({ origin: 'live', url: URL_A, width: 360, at: AT }), { writtenBy: LIVE_RECORD_WRITER.live, origin: 'live', url: URL_A, width: 360, at: AT });
});

// ---- the subcommands (what gate.sh calls) ---------------------------------------------------------------------
await check('baseline <dir>: exit 1 and the reason on stdout when there is none; exit 0 and the capturedAt when frozen; stale for another width or URL → exit 1 with the stale line; usage errors exit 1 on stderr', () => {
  const dir = tmp('cmd-baseline');
  try {
    const g = join(dir, 'g');
    let r = runIn(['baseline', g], dir);
    assert.equal(r.code, 1); assert.equal(r.out, `no frozen baseline in ${g} (${BASELINE_PNG} + ${BASELINE_JSON})\n`); assert.equal(r.err, '');
    freeze(g);
    r = runIn(['baseline', g], dir);
    assert.equal(r.code, 0); assert.equal(r.out, `${AT}\n`);
    r = runIn(['baseline', g, '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, `${AT}\n`);
    r = runIn(['baseline', g, '--url', URL_A, '--width', '360'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen at 1440px, this round is 360px — re-freeze with --force\n$/);
    r = runIn(['baseline', g, '--url', 'https://origin.example/other', '--width', '1440'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen for https:\/\/origin\.example\/, this round's live URL is https:\/\/origin\.example\/other/);
    r = runIn(['baseline'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot baseline: needs <dir>/);
    r = runIn(['baseline', g, '--width'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a value/);
    r = runIn(['baseline', g, '--width', 'wide'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a whole number of px/);
    r = runIn(['baseline', g, '--bogus', 'x'], dir); assert.equal(r.code, 1); assert.match(r.err, /unknown flag --bogus/);
    r = runIn(['baseline', '--help'], dir); assert.equal(r.code, 0); assert.match(r.out, /^stitch-shot — /, 'baseline --help is the help');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('record <live.json>: writes the round\'s live.json atomically — origin "baseline" from baseline.json (at = its capturedAt, originBaseline), origin "live" with --at; every usage error exits 1 and writes nothing', () => {
  const dir = tmp('cmd-record');
  try {
    const g = join(dir, 'g'); freeze(g);
    const live = join(g, 'live.json');
    let r = runIn(['record', live, '--origin', 'baseline', '--baseline', join(g, BASELINE_JSON), '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, ''); assert.equal(r.err, '');
    const text = readFileSync(live, 'utf8');
    assert.ok(text.endsWith('}\n'), 'pretty + trailing newline');
    assert.deepEqual(JSON.parse(text), { writtenBy: LIVE_RECORD_WRITER.baseline, origin: 'baseline', url: URL_A, width: 1440, at: AT, originBaseline: { capturedAt: AT, height: 2000 } });
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG, 'live.json'], 'no temp file left');
    r = runIn(['record', live, '--origin', 'live', '--url', URL_A, '--width', '360', '--at', AT], dir);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(live, 'utf8')), { writtenBy: LIVE_RECORD_WRITER.live, origin: 'live', url: URL_A, width: 360, at: AT });
    const fresh = join(g, 'other.json');
    const usage = (args, re) => { const u = runIn(['record', fresh, ...args], dir); assert.equal(u.code, 1, args.join(' ')); assert.match(u.err, re); assert.equal(existsSync(fresh), false, `nothing written for ${args.join(' ')}`); };
    usage(['--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'frozen', '--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'live', '--width', '1440'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'live', '--url', URL_A, '--width', 'wide'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440'], /--origin baseline needs --baseline <baseline\.json>/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440', '--baseline', join(g, 'missing.json')], /cannot read .*missing\.json/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--at'], /--at needs a value/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--bogus', 'x'], /unknown flag --bogus/);
    r = runIn(['record'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot record: needs <live\.json>/);
    assert.equal(recordCommand([fresh, '--origin', 'live', '--url', URL_A, '--width', '1440', '--at', AT]), 0, 'in-process: 0');
    assert.equal(JSON.parse(readFileSync(fresh, 'utf8')).origin, 'live');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the refusals that precede any capture (no browser needed: they come before the lazy playwright import) -----
await check('--check-baseline <url> <dir>/baseline.png is refused with exit 2 before any capture — the frozen baseline is untouched, nothing else written', () => {
  const dir = tmp('refuse-check');
  try {
    const g = join(dir, 'g'); freeze(g);
    const r = runIn(['http://127.0.0.1:9/', join('g', BASELINE_PNG), '--check-baseline'], dir);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /^stitch-shot: --check-baseline captures a fresh shot to compare against baseline\.png and never writes it — name another output \(e\.g\. g\/live\.png\)\n$/);
    assert.equal(readFileSync(join(g, BASELINE_PNG), 'utf8'), 'frozen-png', 'the baseline is untouched');
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG], 'nothing else written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('--freeze-baseline over an existing baseline is refused with exit 2 before any capture (the capture time named; --force is the way past); a freeze aimed at live.png says where it will land', () => {
  const dir = tmp('refuse-freeze');
  try {
    const g = join(dir, 'g'); freeze(g);
    const r = runIn(['http://127.0.0.1:9/', join('g', 'live.png'), '--freeze-baseline'], dir);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /^stitch-shot: --freeze-baseline writes the frozen origin baseline to g\/baseline\.png, not g\/live\.png \(live\.png is a round's live shot, never a freeze target\)\n/);
    assert.match(r.err, new RegExp(`stitch-shot: a frozen baseline already exists in g \\(captured ${AT}\\) — pass --force to re-freeze\\n$`));
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG], 'nothing written, live.png not created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the font check (header § FONT-LOAD): pure --------------------------------------------------------------
const face = (family, status, weight = 'normal', style = 'normal') => ({ family, weight, style, status });
await check('fontFamilies: surrounding quotes stripped, trimmed, empties dropped, unique, sorted — the record\'s fontsFailed', () => {
  assert.deepEqual(fontFamilies([' "Z" ', 'Brand Sans', '"Brand Sans"', "'Brand Sans'", '', null, undefined]), ['Brand Sans', 'Z']);
  assert.deepEqual(fontFamilies([]), []); assert.deepEqual(fontFamilies(undefined), []);
});
await check('faceKey: family (unquoted, case-folded) + weight + style — normal = 400, bold = 700, an absent descriptor is the default; a bare string is a family at the defaults', () => {
  assert.equal(faceKey({ family: '"Brand Sans"', weight: 'normal', style: 'normal' }), 'brand sans|400|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: 'bold' }), 'brand sans|700|normal');
  assert.equal(faceKey({ family: 'brand SANS', weight: '700', style: 'Normal' }), 'brand sans|700|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: '100  900', style: 'italic' }), 'brand sans|100 900|italic', 'a variable range is kept as written');
  assert.equal(faceKey('Brand Sans'), 'brand sans|400|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: '400' }), faceKey({ family: "'Brand Sans'", weight: 'normal' }), 'normal and 400 are one weight');
  assert.notEqual(faceKey({ family: 'Brand Sans', weight: '400' }), faceKey({ family: 'Brand Sans', weight: '700' }));
});
await check('deadFontFaces: keyed by family, weight and style — a 404 bold beside a loaded regular is dead; a failed declaration beside a loaded twin of the same key is not', () => {
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'error', '700')]), ['Brand Sans'], 'another weight loaded: the bold renders in fallback type — dead');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded', 'bold'), face('Brand Sans', 'error', '700')]), [], 'the same weight loaded (bold = 700): a duplicate declaration, not dead');
  assert.deepEqual(deadFontFaces([face('"Brand Sans"', 'loaded'), face('Brand Sans', 'error', 'normal')]), [], 'quotes do not split a key');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'error', 'normal', 'italic')]), ['Brand Sans'], 'another style loaded: the italic is dead');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'error'), face('Brand Sans', 'error', '700'), face('Other', 'error')]), ['Brand Sans', 'Other'], 'a family is named once, sorted');
});
await check('deadFontFaces: an unresolved local() source is dead like a failed fetch — status error, no URL anywhere; an unloaded face (never needed) is not; every face loaded → []; no faces → []', () => {
  // the recorded shape: metric fallback faces declared with local() platform fonts the gate's browser does not have
  const fallback = [face('Brand Sans', 'error'), face('Brand Sans Fallback', 'error'), face('Brand Serif Fallback', 'error', '400', 'normal')];
  assert.deepEqual(deadFontFaces(fallback), ['Brand Sans', 'Brand Sans Fallback', 'Brand Serif Fallback']);
  assert.deepEqual(deadFontFaces([face('Unused', 'unloaded'), face('Brand Sans', 'loaded')]), [], 'unloaded: never needed by any text');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'loaded', '700'), face('Brand Serif', 'loaded')]), []);
  assert.deepEqual(deadFontFaces([]), []); assert.deepEqual(deadFontFaces(null), []); assert.deepEqual(deadFontFaces([null, 'x']), []);
});
await check('fontCheckOutcome: a face list → { fontsFailed } (checked, no fontCheck key); an error or no list → { fontsFailed: null, fontCheck: "failed: <first line>" } — never []', () => {
  const ok = fontCheckOutcome([face('Brand Sans', 'error'), face('Other', 'loaded')], null);
  assert.deepEqual(ok, { fontsFailed: ['Brand Sans'] });
  assert.ok(!('fontCheck' in ok), 'fontCheck only when the check failed');
  assert.deepEqual(fontCheckOutcome([face('Other', 'loaded')], null), { fontsFailed: [] });
  const bad = fontCheckOutcome(null, new Error('page.evaluate: Execution context was destroyed\n    at main'));
  assert.deepEqual(bad, { fontsFailed: null, fontCheck: 'failed: page.evaluate: Execution context was destroyed' });
  assert.deepEqual(Object.keys(bad), ['fontsFailed', 'fontCheck'], 'fontCheck right after fontsFailed');
  assert.deepEqual(fontCheckOutcome(undefined, 'timeout'), { fontsFailed: null, fontCheck: 'failed: timeout' });
  assert.deepEqual(fontCheckOutcome({ not: 'a list' }, null), { fontsFailed: null, fontCheck: 'failed: no face list returned' });
});
await check('fontCheckLines: a check that could not run → ONE stderr line saying the record is fontsFailed: null (not checked); dead faces → one WARNING naming them and both causes; every face loaded → none', () => {
  const skipped = fontCheckLines({ fontsFailed: null, fontCheck: 'failed: fonts unavailable' });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0], 'stitch-shot WARNING: font-load check failed (fonts unavailable) — the record says fontsFailed: null (not checked): no face is known to have loaded');
  assert.deepEqual(fontCheckLines({ fontsFailed: [] }), []);
  const dead = fontCheckLines({ fontsFailed: ['Brand Sans', 'Brand Sans Fallback'] });
  assert.equal(dead.length, 1);
  assert.match(dead[0], /^stitch-shot WARNING: FONT LOAD FAILED for declared face\(s\) Brand Sans, Brand Sans Fallback — this capture renders fallback type for them/);
  assert.match(dead[0], /the file failed to fetch, or a local\(\) source names a font this browser does not have/);
  assert.match(fontCheckLines({})[0], /font-load check failed \(unknown\)/, 'no outcome at all reads as not checked');
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
await check('layerAction: chunk 1 shows every layer; later chunks hide a fixed layer always and a sticky one only while stuck (displaced from its own place); a backdrop and a layer back in the flow show', () => {
  assert.equal(layerAction({ kind: 'fixed', top0: 0 }, 0, 0), 'show');
  assert.equal(layerAction({ kind: 'fixed', top0: 0 }, 3, 2700), 'hide');
  assert.equal(layerAction({ kind: 'sticky', top0: 1500 }, 1, 1500), 'show', 'a sticky element still in its own place stays');
  assert.equal(layerAction({ kind: 'sticky', top0: 0 }, 2, 1800), 'hide', 'a stuck header is hidden');
  assert.equal(layerAction({ kind: 'sticky', top0: 3000 }, 1, 1440), 'hide', 'a bar stuck at the viewport bottom, above its own place');
  assert.equal(layerAction({ kind: 'fixed', top0: null, backdrop: true }, 2, null), 'show', 'a backdrop is never hidden');
  assert.equal(layerAction({ kind: 'sticky', top0: 0, backdrop: true }, 2, 1800), 'show');
  assert.equal(layerAction({ kind: 'static', top0: null }, 2, null), 'show', 'a scroll class took it back into the flow');
});
await check('isBackdrop: a negative z-index, or ≥ 90 % of the viewport covered (clipped to the viewport); never a header, a bar or a chat button', () => {
  const vw = 1000; const vh = 800;
  assert.equal(isBackdrop({ x: 0, y: 0, w: 1000, h: 800, z: -1 }, vw, vh), true, 'position:fixed; inset:0; z-index:-1');
  assert.equal(isBackdrop({ x: 0, y: 0, w: 1000, h: 800, z: NaN }, vw, vh), true, 'a full-viewport video, z-index auto');
  assert.equal(isBackdrop({ x: 0, y: -100, w: 1000, h: 3000, z: 0 }, vw, vh), true, 'taller than the viewport');
  assert.equal(isBackdrop({ x: 0, y: 0, w: 60, h: 60, z: -5 }, vw, vh), true, 'negative z-index: behind the content, whatever its size');
  assert.equal(isBackdrop({ x: 0, y: 0, w: 1000, h: 60, z: 100 }, vw, vh), false, 'the header');
  assert.equal(isBackdrop({ x: 0, y: 680, w: 1000, h: 120, z: NaN }, vw, vh), false, 'a cookie bar');
  assert.equal(isBackdrop({ x: 0, y: 200, w: 1000, h: 800, z: 0 }, vw, vh), false, '75 % on screen');
});
await check('overlaySuspects: a visible fixed layer below the top bar, ≥ 5 % of the viewport, reading like consent / sign-up copy; never the header or a quiet chat button; a full-viewport (backdrop) one too', () => {
  const vw = 1000; const vh = 800;
  const bar = { kind: 'fixed', visible: true, y: 680, w: 1000, h: 120, text: 'We use cookies to improve your experience. Manage preferences' };
  assert.deepEqual(overlaySuspects([bar], vw, vh), [bar]);
  assert.deepEqual(overlaySuspects([{ ...bar, y: 0, text: 'Pricing Login Sign up' }], vw, vh), [], 'the top bar');
  assert.deepEqual(overlaySuspects([{ ...bar, w: 60, h: 60, text: 'Chat' }], vw, vh), []);
  assert.deepEqual(overlaySuspects([{ ...bar, visible: false }], vw, vh), []);
  assert.deepEqual(overlaySuspects([{ ...bar, kind: 'sticky' }], vw, vh), []);
  const modal = { ...bar, y: 0, h: 800, backdrop: true, text: 'Subscribe to our newsletter' };
  assert.deepEqual(overlaySuspects([modal], vw, vh), [modal], 'a full-viewport sign-up modal, kept in every chunk');
  assert.deepEqual(overlaySuspects([{ ...modal, text: '' }], vw, vh), [], 'a background video');
});

// layerPassScript — the code page.evaluate runs — on a stub DOM in a vm: the rule in the page is layerAction /
// isBackdrop themselves (no copy to drift), tagging is idempotent, a layer that turns fixed later is tagged where it
// does, and the opacity restore keeps the page's own value AND its priority.
function stubPage() {
  const win = { innerWidth: 1000, innerHeight: 800, scrollY: 0 };
  const els = [];
  const mk = (id, { position = 'static', rect, inFlowTop = null, z = 'auto', parent = null, opacity = null }) => {
    const props = new Map(); const attrs = new Map();
    if (opacity) props.set('opacity', opacity);
    const el = {
      id, tagName: 'DIV', innerText: '', parentElement: parent, position,
      style: {
        getPropertyValue: (k) => (props.get(k) || [''])[0], getPropertyPriority: (k) => (props.get(k) || ['', ''])[1],
        setProperty: (k, v, pr = '') => { props.set(k, [v, pr]); }, removeProperty: (k) => { props.delete(k); },
      },
      props, attrs,
      hasAttribute: (k) => attrs.has(k), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => { attrs.set(k, String(v)); }, removeAttribute: (k) => { attrs.delete(k); },
      closest: (sel) => { for (let e = el; e; e = e.parentElement) if (sel === '[data-sd-layer]' && e.attrs.has('data-sd-layer')) return e; return null; },
      // a sticky element's box: where it is stuck (rect, in viewport coordinates) or, under position:static, its own place
      getBoundingClientRect: () => {
        const top = (props.get('position') || [])[0] === 'static' && inFlowTop != null ? inFlowTop - win.scrollY : rect.y;
        return { left: rect.x, top, width: rect.w, height: rect.h, bottom: top + rect.h };
      },
      z,
    };
    els.push(el); return el;
  };
  const context = {
    window: win,
    document: { querySelectorAll: (sel) => (sel === 'body *' ? els : els.filter((e) => e.attrs.has('data-sd-layer'))) },
    getComputedStyle: (el) => ({ position: (el.props.get('position') || [])[0] || el.position, zIndex: el.z, visibility: 'visible' }),
  };
  // (through JSON: the vm's arrays have another realm's prototype)
  return { win, mk, run: (i) => JSON.parse(JSON.stringify(runInNewContext(layerPassScript(i), context))) };
}
await check('layerPassScript: the in-page pass is layerAction + isBackdrop serialized (the tested rule is the rule that runs)', () => {
  const src = layerPassScript(2);
  assert.ok(src.includes(String(layerAction)) && src.includes(String(isBackdrop)), src.slice(0, 200));
  assert.match(src, /^\(function layerPass\(chunkIndex, action, backdropOf\)/);
});
await check('layerPassScript in a stub page: chunk 1 tags at scroll 0 and shows all; chunk 2 hides the header and the stuck sticky, keeps the backdrop, the sticky in its place and the in-flow block', () => {
  const { win, mk, run } = stubPage();
  const hd = mk('hd', { position: 'fixed', rect: { x: 0, y: 0, w: 1000, h: 60 }, opacity: ['0.9', 'important'] });
  mk('inner', { position: 'fixed', rect: { x: 0, y: 0, w: 100, h: 60 }, parent: hd });
  const bg = mk('bg', { position: 'fixed', rect: { x: 0, y: 0, w: 1000, h: 800 }, z: '-1' });
  const st = mk('st', { position: 'sticky', rect: { x: 0, y: 1500, w: 1000, h: 40 }, inFlowTop: 1500 });
  const late = mk('late', { position: 'static', rect: { x: 0, y: 0, w: 1000, h: 80 } });
  const t0 = run(0);
  assert.deepEqual(t0.map((l) => [l.name, l.kind, l.backdrop]), [['div#hd', 'fixed', false], ['div#bg', 'fixed', true], ['div#st', 'sticky', false]], 'the outermost layers only; the backdrop flagged');
  assert.equal(hd.getAttribute('data-sd-opacity'), null, 'chunk 1 hides nothing');
  win.scrollY = 900;
  st.getBoundingClientRect = () => ({ left: 0, top: 1500 - win.scrollY, width: 1000, height: 40, bottom: 1540 - win.scrollY }); // in its place
  assert.deepEqual(run(1), [], 'nothing new');
  assert.deepEqual([hd.style.getPropertyValue('opacity'), hd.style.getPropertyPriority('opacity')], ['0', 'important']);
  assert.equal(bg.getAttribute('data-sd-opacity'), null, 'the backdrop stays');
  assert.equal(st.getAttribute('data-sd-opacity'), null, 'the sticky in its own place stays');
  assert.equal(late.getAttribute('data-sd-layer'), null);
  // chunk 3: a scroll class made the in-flow header fixed; the sticky is stuck at the top (its own place is 1500)
  win.scrollY = 1800; late.position = 'fixed';
  const st2 = { ...st.getBoundingClientRect() };
  st.getBoundingClientRect = () => ((st.props.get('position') || [])[0] === 'static' ? { ...st2, top: 1500 - win.scrollY } : { left: 0, top: 0, width: 1000, height: 40, bottom: 40 });
  const t2 = run(2);
  assert.deepEqual(t2.map((l) => l.name), ['div#late'], 'the late layer, tagged where it appeared');
  assert.equal(late.style.getPropertyValue('opacity'), '0');
  assert.equal(st.style.getPropertyValue('opacity'), '0', 'the stuck sticky is hidden');
  assert.equal(st.style.getPropertyValue('position'), '', 'the in-flow measure leaves no inline position behind');
  assert.deepEqual(run(2), [], 'tagging is idempotent');
  // the restore keeps the page's own inline opacity and its !important
  run(0);
  assert.deepEqual([hd.style.getPropertyValue('opacity'), hd.style.getPropertyPriority('opacity')], ['0.9', 'important']);
  assert.equal(late.props.has('opacity'), false, 'no inline opacity before → none after');
  assert.equal(hd.getAttribute('data-sd-opacity-priority'), null);
});

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
    // the recorded shape: a face whose file 404s and a metric fallback face declared with a local() font this machine lacks;
    // a face no text uses stays unloaded
    '/fonts': html('Brand type', '<style>@font-face{font-family:"Brand Sans";src:url(/missing.woff2) format("woff2")}@font-face{font-family:"Brand Fallback";src:local("No Such Platform Font Zz");size-adjust:105%}@font-face{font-family:"Unused";src:local("No Such Unused Font Zz")}</style><section style="font-family:\'Brand Sans\',\'Brand Fallback\',sans-serif">Brand type</section>'),
    // a page whose document.fonts throws: the font-load check cannot run
    '/fonts-unreadable': html('Text', '<script>Object.defineProperty(document, \'fonts\', { configurable: true, get() { throw new Error(\'fonts unavailable\'); } });</script><section>Text</section>'),
    // a consent manager whose accept control reads "Allow all" (no Accept text): matched by its vendor class, no flag
    '/cmp-allow-all': html('Consent', '<style>body{height:2400px}h1,p{margin:0}.ch2-container{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div class="ch2-container"><button class="ch2-btn ch2-allow-all-btn" onclick="this.parentNode.remove()">Allow all</button></div>'),
    // a fixed 60 px header, a red marker right under the header's place at the top of chunk 2 (y 600–640), a sticky
    // label in its own place mid-page, and a cookie bar no candidate can close (no button)
    '/fixed': html('Fixed', '<style>body{height:2400px;position:relative}h1,p{margin:0}#hd{position:fixed;top:0;left:0;right:0;height:60px;background:#000}#mk{position:absolute;top:605px;left:0;width:800px;height:30px;background:#f00}#sp{height:1500px}#st{position:sticky;top:0;height:40px;background:#00f}#ck{position:fixed;left:0;right:0;bottom:0;height:90px;background:#eee}</style><div id="hd"></div><div id="mk"></div><div id="sp"></div><div id="st"></div><div id="ck">We use cookies on this site.</div>'),
    // a header a scroll class makes fixed (in the flow at scroll 0), the red marker under its chunk-2 place, and a
    // `position:fixed; inset:0; z-index:-1` green backdrop that must stay in every chunk
    '/late': html('Late', '<style>body{height:2400px;position:relative}h1,p{margin:0}#bg{position:fixed;inset:0;z-index:-1;background:#0f0}#hd{height:60px;background:#000}#hd.stuck{position:fixed;top:0;left:0;right:0}#mk{position:absolute;top:605px;left:0;width:800px;height:30px;background:#f00}</style><div id="bg"></div><div id="hd"></div><div id="mk"></div><script>addEventListener(\'scroll\', () => { document.getElementById(\'hd\').classList.toggle(\'stuck\', scrollY > 100); });</script>'),
    // the vendor class repeated in a hidden preference panel ahead of the banner: the visible copy is the one clicked
    '/cmp-hidden-first': html('Consent', '<style>body{height:2400px}h1,p{margin:0}.cky-consent-bar{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><div class="cky-preference-center" style="display:none"><button class="cky-btn-accept">Accept all</button></div><h1>Welcome</h1><p>Ordinary copy.</p><div class="cky-consent-bar"><button class="cky-btn-accept" onclick="this.parentNode.remove()">Accept all</button></div>'),
    // an unlisted manager: "Disallow all" and "Accept only necessary" come first in the DOM; only "Allow all" is the accept
    '/cmp-unlisted': html('Consent', '<style>body{height:2400px}h1,p{margin:0}#bar{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div id="bar"><button onclick="this.parentNode.remove()">Disallow all</button><button onclick="this.parentNode.remove()">Accept only necessary</button><button onclick="this.parentNode.remove()">Allow all</button></div>'),
    '/article': html('Voice notes', `<h1>Voice notes</h1>${'<p>Press &amp; hold the button to record a voice note, then release it to send. The note is kept for thirty days and can be replayed from the thread.</p>'.repeat(30)}<section></section><section></section>`),
  };
  // a strict Content-Security-Policy (nonce, no 'unsafe-inline') and a running animation on a bar 1000 px tall — it
  // crosses chunks 1 and 2, taken at least 450 ms apart: the same x in both only when the animation is frozen
  const CSP = "default-src 'self'; style-src 'self' 'nonce-abc123'; script-src 'self' 'nonce-abc123'";
  pages['/csp'] = '<!doctype html><html><head><meta charset="utf-8"><title>Strict policy</title><style nonce="abc123">html,body{margin:0}section{height:600px;background:#ddd}@keyframes slide{from{transform:translateX(0)}to{transform:translateX(600px)}}#mv{width:100px;height:1000px;background:#c00;animation:slide 1.7s linear infinite alternate}</style></head><body><h1>Strict policy</h1><div id="mv"></div><section></section><section></section><section></section></body></html>';
  // 1205 px at scroll 0 (two viewports + 5); a header 154 → 146 px after the first scroll event leaves 1197 px. Sticky:
  // scroll anchoring pulls the window back. Fixed + a padding-top that follows it: no anchoring, the window is clamped —
  // the shape the height read once reported as a scroll stall. A green 51 px tail ends the page.
  const shrinkBody = '<div id="hd">Header</div><main><section style="height:1000px"></section><div id="tail"></div></main><script>addEventListener(\'scroll\', () => { if (scrollY > 0) document.body.classList.add(\'small\'); }, { passive: true });</script>';
  pages['/shrink'] = html('Sticky', `<style>#hd{position:sticky;top:0;height:154px;background:#000;color:#fff}.small #hd{height:146px}#tail{height:51px;background:#0f0}</style>${shrinkBody}`);
  pages['/shrink-pad'] = html('Fixed', `<style>#hd{position:fixed;top:0;left:0;right:0;height:154px;background:#000;color:#fff}main{padding-top:154px}.small #hd{height:146px}.small main{padding-top:146px}#tail{height:51px;background:#0f0}</style>${shrinkBody}`);
  // 700 more px once scrolled past 500
  pages['/grow'] = html('Grow', '<style>h1{margin:0}#more{height:0;background:#00f}#more.on{height:700px}</style><section></section><section></section><section></section><div id="more"></div><script>addEventListener(\'scroll\', () => { if (scrollY > 500) document.getElementById(\'more\').classList.add(\'on\'); }, { passive: true });</script>');
  // the window cannot scroll: a real stall
  pages['/jacked'] = html('Jacked', '<style>html,body{height:100%;overflow:hidden}</style><section></section><section></section><section></section><section></section>');
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1/').pathname;
    const body = pages[path];
    if (!body) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(path === '/csp' ? { 'content-security-policy': CSP } : {}) });
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
    writeFileSync(join(work, 'failed.capture.json'), '{ "stale": true }\n');
    const [ok, article, consent, noDismiss, allowAll, fixed, late, hiddenFirst, unlisted, fonts, unread, failedCap, ...denied] = await Promise.all([stitch('/ok', 'ok'), stitch('/article', 'article'), stitch('/consent', 'consent', ['--consent', '#yes']), stitch('/consent', 'nodismiss', ['--no-dismiss']), stitch('/cmp-allow-all', 'allow-all'), stitch('/fixed', 'fixed'), stitch('/late', 'late'), stitch('/cmp-hidden-first', 'hidden-first'), stitch('/cmp-unlisted', 'unlisted'), stitch('/fonts', 'fonts'), stitch('/fonts-unreadable', 'unread'), stitch('/nope', 'failed'), stitch('/denied', 'denied'), stitch('/denied-late', 'denied-late'), stitch('/denied-heading', 'denied-heading')]);
    const warnings = (r) => r.stderr.split('\n').filter((l) => /WARNING/.test(l));
    const [csp, csp2, shrink, shrinkPad, grow, jacked] = await Promise.all([stitch('/csp', 'csp'), stitch('/csp', 'csp2'), stitch('/shrink', 'shrink'), stitch('/shrink-pad', 'shrink-pad'), stitch('/grow', 'grow'), stitch('/jacked', 'jacked')]);
    await check('e2e: a strict Content-Security-Policy (style-src nonce, no unsafe-inline) → exit 0, freeze \'applied\', no WARNING; the running animation is frozen (the moving bar has the same x in chunk 1 and in chunk 2)', async () => {
      assert.equal(csp.status, 0, csp.stderr); assert.equal(csp2.status, 0, csp2.stderr);
      assert.equal(csp.cap.freeze, 'applied'); assert.deepEqual(warnings(csp), []);
      assert.doesNotMatch(csp.stderr, /Content Security Policy/);
      const { PNG } = await import('pngjs');
      const span = (f, y) => { const png = PNG.sync.read(readFileSync(f)); let a = -1; let b = -1; for (let x = 0; x < png.width; x += 1) { const i = (y * png.width + x) * 4; if (png.data[i] > 150 && png.data[i + 1] < 50) { if (a < 0) a = x; b = x; } } return [a, b]; };
      for (const r of [csp, csp2]) {
        const [a, b] = span(r.out, 100); const [c, d] = span(r.out, 900);
        assert.ok(a >= 0 && b - a >= 97 && b - a <= 101, `the bar at y 100: x ${a}–${b}`);
        assert.deepEqual([c, d], [a, b], `the bar in chunk 2 (y 900) where it is in chunk 1 (y 100): x ${a}–${b} vs ${c}–${d}`);
      }
    });
    for (const [r, name, n] of [[shrink, 'a sticky header', 3], [shrinkPad, 'a fixed header with a padding-top that follows it', 2]]) {
      await check(`e2e: ${name} 8 px shorter after the first scroll (1205 → 1197 px) → exit 0, no stall, the PNG is the settled height with the page's last row in it; heightChange on the record, one WARNING`, async () => {
        assert.equal(r.status, 0, r.stderr + r.stdout);
        assert.doesNotMatch(r.stderr, /scroll stall/);
        assert.deepEqual(pngSize(r.out), { width: 800, height: 1197 });
        assert.equal(r.cap.height, 1197); assert.equal(r.cap.chunks, n); assert.deepEqual(r.cap.heightChange, { initial: 1205, final: 1197 });
        const keys = Object.keys(r.cap); assert.equal(keys[keys.indexOf('heightChange') + 1], 'at', keys.join(','));
        assert.equal(warnings(r).length, 1, r.stderr); assert.match(warnings(r)[0], /the document's height changed during the capture \(1205px → 1197px\)/);
        const { PNG } = await import('pngjs');
        const png = PNG.sync.read(readFileSync(r.out));
        const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]; };
        assert.deepEqual(at(400, 1196), [0, 255, 0, 255], 'the tail\'s last row is the PNG\'s last row');
        assert.deepEqual(at(400, 1197 - 51), [0, 255, 0, 255], 'the tail\'s first row'); assert.deepEqual(at(400, 1197 - 52), [221, 221, 221, 255], 'the section above it');
      });
    }
    await check('e2e: a page that grows 700 px during the capture is captured to its settled height (heightChange, one WARNING)', async () => {
      assert.equal(grow.status, 0, grow.stderr + grow.stdout);
      assert.deepEqual(grow.cap.heightChange, { initial: 1800, final: 2500 }); assert.deepEqual(pngSize(grow.out), { width: 800, height: 2500 });
      const { PNG } = await import('pngjs');
      const png = PNG.sync.read(readFileSync(grow.out));
      for (const y of [1801, 2499]) assert.deepEqual([...png.data.slice((y * 800 + 400) * 4, (y * 800 + 400) * 4 + 3)], [0, 0, 255], `the added block at y ${y}`);
    });
    await check('e2e: a scroll-jacked page (html/body overflow hidden) is still a scroll stall — exit 1, no PNG, no record', () => {
      assert.equal(jacked.status, 1, jacked.stdout);
      assert.match(jacked.stderr, /stitch-shot error: scroll stall at chunk target 600px: window scroll is a no-op \(window\.scrollY stuck at 0px\) while the document reports 2400px/);
      assert.deepEqual([existsSync(jacked.out), existsSync(jacked.sidecar)], [false, false]);
    });
    await check('e2e: an ordinary page → exit 0, the PNG and capture.json beside it — { writtenBy, url, width, vh, height, chunks, denialCheck: \'ok\', freeze: \'applied\', fontsFailed, fixedLayers, at } (no heightChange: the height did not move)', () => {
      assert.equal(ok.status, 0, ok.stderr);
      assert.ok(existsSync(ok.out), 'the PNG');
      assert.ok(ok.cap, 'the sidecar');
      assert.deepEqual(Object.keys(ok.cap), ['writtenBy', 'url', 'width', 'vh', 'height', 'chunks', 'denialCheck', 'freeze', 'fontsFailed', 'fixedLayers', 'at']);
      assert.equal(ok.cap.freeze, 'applied');
      assert.deepEqual(ok.cap.fontsFailed, [], 'a page with no @font-face: every declared face loaded');
      assert.deepEqual(ok.cap.fixedLayers, { capture: 'once', count: 0, late: 0 });
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
    await check('e2e: a consent manager in the built-in candidates is dismissed with no flag — its "Allow all" button by vendor class', () => {
      assert.equal(allowAll.status, 0, allowAll.stderr + allowAll.stdout);
      assert.match(allowAll.stdout, /consent dismissed via \.ch2-allow-all-btn/);
    });
    await check('e2e: fixed layers are captured once — the header shows at the top only, the marker under its chunk-2 place is in the PNG, the sticky label in its own place stays; the undismissable cookie bar is a WARNING', async () => {
      assert.equal(fixed.status, 0, fixed.stderr + fixed.stdout);
      assert.deepEqual(fixed.cap.fixedLayers, { capture: 'once', count: 3, late: 0 });
      assert.match(fixed.stderr, /stitch-shot WARNING: a fixed overlay is still showing after the dismissal sweeps \(800x90 at y 510: "We use cookies on this site\./);
      const { PNG } = await import('pngjs');
      const png = PNG.sync.read(readFileSync(fixed.out));
      const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
      assert.deepEqual(at(400, 10), [0, 0, 0], 'the header at the top of chunk 1');
      assert.deepEqual(at(400, 615), [255, 0, 0], 'the marker under the header\'s chunk-2 place');
      assert.deepEqual(at(400, 1520), [0, 0, 255], 'the sticky label in its own place');
    });
    await check('e2e: a header a scroll class makes fixed is tagged where it turns fixed (a WARNING) and captured once; a fixed inset:0 z-index:-1 backdrop stays in every chunk', async () => {
      assert.equal(late.status, 0, late.stderr + late.stdout);
      assert.deepEqual(late.cap.fixedLayers, { capture: 'once', count: 2, late: 1 });
      assert.match(late.stderr, /stitch-shot WARNING: fixed div#hd turned fixed \/ sticky after scroll 0 \(chunk 2, y 600:/);
      const { PNG } = await import('pngjs');
      const png = PNG.sync.read(readFileSync(late.out));
      const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
      assert.deepEqual(at(400, 10), [0, 0, 0], 'the header in the flow at the top of chunk 1');
      assert.deepEqual(at(400, 615), [255, 0, 0], 'the marker under the header\'s chunk-2 place');
      for (const y of [300, 1000, 1600, 2300]) assert.deepEqual(at(400, y), [0, 255, 0], `the backdrop at y ${y}`);
    });
    await check('e2e: a vendor class repeated in a hidden panel first — the visible copy is clicked, the vendor entry credited', () => {
      assert.equal(hiddenFirst.status, 0, hiddenFirst.stderr + hiddenFirst.stdout);
      assert.match(hiddenFirst.stdout, /consent dismissed via \.cky-btn-accept/);
    });
    await check('e2e: an unlisted manager — "Allow all" is clicked, never "Disallow all" or "Accept only necessary" ahead of it', () => {
      assert.equal(unlisted.status, 0, unlisted.stderr + unlisted.stdout);
      assert.match(unlisted.stdout, /consent dismissed via button:text-matches\("\^\[\^a-z\]\*allow all/);
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
    await check('e2e: a face whose file 404s and a fallback face whose local() names a font this machine lacks are both dead — the record\'s fontsFailed names them beside the one WARNING; the unused face is not; exit 0', () => {
      assert.equal(fonts.status, 0, fonts.stderr);
      assert.equal(warnings(fonts).length, 1, fonts.stderr);
      assert.match(warnings(fonts)[0], /FONT LOAD FAILED for declared face\(s\) Brand Fallback, Brand Sans — /);
      assert.deepEqual(fonts.cap && fonts.cap.fontsFailed, ['Brand Fallback', 'Brand Sans']);
      assert.ok(!('fontCheck' in fonts.cap), 'a check that ran carries no fontCheck');
    });
    await check('e2e: a font-load check that cannot run (document.fonts throws) → fontsFailed null + fontCheck right after it, ONE stderr WARNING, exit 0', () => {
      assert.equal(unread.status, 0, unread.stderr);
      assert.equal(warnings(unread).length, 1, unread.stderr);
      assert.match(warnings(unread)[0], /^stitch-shot WARNING: font-load check failed \(.*fonts unavailable.*\) — the record says fontsFailed: null \(not checked\)/);
      assert.equal(unread.cap.fontsFailed, null); assert.match(unread.cap.fontCheck, /^failed: .*fonts unavailable/);
      const keys = Object.keys(unread.cap); assert.equal(keys[keys.indexOf('fontsFailed') + 1], 'fontCheck', keys.join(','));
    });
    await check('e2e: a failed capture (a 404 page) writes no record and removes an earlier one at the same path', () => {
      assert.notEqual(failedCap.status, 0, 'the capture failed');
      assert.deepEqual([existsSync(failedCap.out), existsSync(failedCap.sidecar)], [false, false]);
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
