#!/usr/bin/env node
// skills/diff/scripts/test/page-probe.test.mjs — the page-probe.mjs contract (the one ad-hoc browser probe).
// Part (a), no browser: parseArgs (every flag, --sbs's three values, the usage errors), selector-list splitting, the
// summary / console / eval / image line formatting and their caps, the fallback hide CSS, the hide-path pick (stub
// modules shaped like a live-session with and without the helper) and the distinct-element count, the --sbs path
// beside --shot, the cap math (fit within 1400 × 1000, the halving steps, the .jpg path), the PNG / JPEG header
// readers and the compose page, --help and usage errors from an empty cwd (nothing written). Part (b), where
// playwright is importable: a fixture page served from this process with a consent banner (accept =
// #onetrust-accept-btn-handler), a console.error and a .bar to hide — the probe names the consent, hides one element
// (once, however many selectors match it), evaluates after the dismissal, writes the capped JPEG and lists the
// console error; --full-res keeps the PNG; --click runs before --eval; a click selector matching nothing and a
// throwing eval exit 1; an edge-signed 403 exits 3; --shot and --sbs naming one file both survive; --sbs composes a
// PNG and a JPEG with no <url>. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAP, CAP_QUALITY, HELP, UsageError, cappedPath, consoleLine, countHidden, distinctMatchesInPage, downscaleSteps, evalText, exitCodeFor,
  fitWithin, formatReport, hideCss, hideRegionsFallback, imageLine, imageSize, isShotInput, jpegSize, parseArgs, pickHide, pngSize, sbsHtml,
  sbsOutPath, sbsWidth, splitSelectors, summaryLine,
} from '../page-probe.mjs';
import * as liveSession from '../live-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'page-probe.mjs');
let failed = 0; let checks = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const runAsync = (args, cwd) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });
// Minimal headers: a PNG IHDR and a JPEG with an APP0 segment before its SOF (baseline C0, progressive C2).
const pngHead = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpegHead = (w, h, sof = 0xc0) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, sof, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const usage = (args, re) => assert.throws(() => parseArgs(args), (e) => e instanceof UsageError && re.test(e.message), `${args.join(' ')} → usage error ${re}`);

// ---- (a) pure -----------------------------------------------------------------------------------------

await check('parseArgs: defaults for a bare <url>', () => {
  const o = parseArgs(['https://www.example.com/']);
  assert.deepEqual(o, { url: 'https://www.example.com/', width: 1440, hide: [], click: null, eval: null, maxChars: 4000, shot: null, full: false, fullRes: false, sbs: null, dismiss: [], headed: false, locale: null, navTimeout: 60000, help: false });
});
await check('parseArgs: every flag, --sbs takes three values, --hide / --dismiss repeat and split, duplicates dropped', () => {
  const o = parseArgs(['https://www.example.com/x', '--width', '390', '--shot', 'out/a.png', '--full', '--eval', 'document.title', '--click', '#menu > button',
    '--hide', '.bar, .promo', '--hide', '.bar', '--sbs', 'a.png', 'b.png', 'out/ab.png', '--dismiss', '#close', '--headed', '--locale', 'de-CH',
    '--nav-timeout', '90000', '--max-chars', '120']);
  assert.equal(o.url, 'https://www.example.com/x'); assert.equal(o.width, 390); assert.equal(o.shot, 'out/a.png'); assert.equal(o.full, true);
  assert.equal(o.eval, 'document.title'); assert.equal(o.click, '#menu > button'); assert.deepEqual(o.hide, ['.bar', '.promo']);
  assert.deepEqual(o.sbs, { a: 'a.png', b: 'b.png', out: 'out/ab.png' }); assert.deepEqual(o.dismiss, ['#close']); assert.equal(o.headed, true);
  assert.equal(o.locale, 'de-CH'); assert.equal(o.navTimeout, 90000); assert.equal(o.maxChars, 120); assert.equal(o.help, false);
});
await check('parseArgs: --sbs alone composes without a <url>; --help / -h set help without validating the rest', () => {
  assert.deepEqual(parseArgs(['--sbs', 'a.png', 'b.png', 'c.png']).sbs, { a: 'a.png', b: 'b.png', out: 'c.png' });
  assert.equal(parseArgs(['--sbs', 'a.jpg', 'b.png', 'c.png', '--full-res']).fullRes, true, '--full-res needs no <url>: it keeps the composition\'s PNG');
  assert.equal(parseArgs(['https://www.example.com/', '--shot', 'a.png', '--full-res']).fullRes, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h', '--full']).help, true);
});
await check('parseArgs usage errors: no <url> without --sbs, --full without --shot, bad --width, a value flag followed by a flag or nothing', () => {
  usage([], /need <url>/);
  usage(['--width', '390'], /need <url>/);
  usage(['https://www.example.com/', '--full'], /--full needs --shot/);
  usage(['https://www.example.com/', '--full-res'], /--full-res needs --shot or --sbs/);
  for (const w of ['abc', '0', '-5', '12.5', '20000']) usage(['https://www.example.com/', '--width', w], /--width must be a whole number/);
  usage(['https://www.example.com/', '--shot', '--full'], /--shot needs a value \(got --full, which is a flag\)/);
  usage(['https://www.example.com/', '--eval'], /--eval needs a value$/);
  usage(['https://www.example.com/', '--click', '--eval', 'x'], /--click needs a value/);
  usage(['https://www.example.com/', '--hide', '--width', '390'], /--hide needs a value/);
});
await check('parseArgs usage errors: --sbs short of three values, page flags with --sbs alone, bad url / numbers / paths, repeats, unknowns', () => {
  usage(['--sbs', 'a.png', 'b.png'], /--sbs needs three values .* \(got 2\)/);
  usage(['--sbs', 'a.png', '--full', 'x.png', 'y.png'], /--sbs needs three values .* \(got 1, then the flag --full\)/);
  usage(['--sbs', 'a.png', 'b.png', 'c.png', '--click', '#x', '--width', '390'], /--width, --click act on a page and need a <url>/);
  usage(['--sbs', 'a.png', 'b.png', 'a.png'], /must differ from its inputs/);
  usage(['--sbs', 'a.jpg', 'b.png', 'a.png'], /must differ from its inputs \(got a\.png, whose capped a\.jpg is an input\)/);
  usage(['--sbs', 'a.png', 'b.png', 'c.jpg'], /--sbs <out\.png> takes a \.png path .*c\.jpg/);
  usage(['https://www.example.com/', '--shot', 'shot.jpg'], /--shot takes a \.png path \(the capped JPEG is written beside it as <name>\.jpg; --full-res also keeps the PNG\), got "shot\.jpg"/);
  usage(['www.example.com/page'], /absolute http\(s\) or file: URL/);
  usage(['javascript:alert(1)'], /absolute http\(s\) or file: URL/);
  usage(['https://www.example.com/', 'https://www.example.com/other'], /unexpected argument/);
  usage(['https://www.example.com/', '--click', 'a', '--click', 'b'], /--click given more than once/);
  usage(['https://www.example.com/', '--nav-timeout', 'soon'], /--nav-timeout must be a whole number/);
  usage(['https://www.example.com/', '--max-chars', '0'], /--max-chars must be a whole number/);
  usage(['https://www.example.com/', '--hide', ' , '], /--hide needs at least one selector/);
  usage(['https://www.example.com/', '--wait'], /unknown option --wait/);
});
await check('sbsOutPath / parseArgs: an --sbs <out> that is --shot\'s file goes beside it as <name>-sbs.png; any other path is kept', () => {
  assert.equal(sbsOutPath('out/x.png', 'out/x.png'), 'out/x-sbs.png');
  assert.equal(sbsOutPath('out/x.png', './out/../out/x.png'), './out/../out/x-sbs.png', 'same file by resolved path');
  assert.equal(sbsOutPath('out/X.PNG', 'out/X.PNG'), 'out/X-sbs.PNG', 'the extension kept as given');
  assert.equal(sbsOutPath('out/x.PNG', 'out/x.png'), 'out/x-sbs.png', 'both would write out/x.jpg');
  assert.equal(sbsOutPath('out/x.png', 'out/y.png'), 'out/y.png');
  assert.equal(sbsOutPath(null, 'out/x.png'), 'out/x.png', 'no --shot');
  const o = parseArgs(['https://www.example.com/', '--shot', 'out/x.png', '--sbs', 'a.png', 'b.png', 'out/x.png']);
  assert.deepEqual(o.sbs, { a: 'a.png', b: 'b.png', out: 'out/x-sbs.png', askedOut: 'out/x.png' });
  assert.equal(o.shot, 'out/x.png');
  assert.deepEqual(parseArgs(['https://www.example.com/', '--shot', 'out/x.png', '--sbs', 'out/x.png', 'ref.png', 'out/x.png']).sbs,
    { a: 'out/x.png', b: 'ref.png', out: 'out/x-sbs.png', askedOut: 'out/x.png' }, 'this run\'s shot beside a reference, composed next to the shot');
  assert.deepEqual(parseArgs(['https://www.example.com/', '--shot', 'out/x.png', '--sbs', 'a.png', 'b.png', 'out/y.png']).sbs, { a: 'a.png', b: 'b.png', out: 'out/y.png' });
  usage(['https://www.example.com/', '--shot', 'x.png', '--sbs', 'x-sbs.png', 'b.png', 'x.png'], /must differ from its inputs \(got x-sbs\.png, moved beside --shot x\.png\)/);
});
await check('cap math: fit within 1400 × 1000 (aspect kept, whole px ≥ 1, never upscaled), halving steps down to it, the .jpg beside the .png', () => {
  assert.deepEqual(CAP, { width: 1400, height: 1000 }); assert.equal(CAP_QUALITY, 80);
  assert.deepEqual(fitWithin(1440, 900), { width: 1400, height: 875 });
  assert.deepEqual(fitWithin(1440, 12000), { width: 120, height: 1000 }, 'a full-page shot: the height binds');
  assert.deepEqual(fitWithin(2888, 960), { width: 1400, height: 465 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 }, 'never upscaled');
  assert.deepEqual(fitWithin(1400, 1000), { width: 1400, height: 1000 });
  assert.deepEqual(fitWithin(3, 50000), { width: 1, height: 1000 }, 'at least 1 px');
  for (const [w, h] of [[1441, 901], [390, 8000], [5000, 1001]]) { const f = fitWithin(w, h); assert.ok(f.width <= 1400 && f.height <= 1000, `${w}×${h} → ${f.width}×${f.height}`); }
  assert.deepEqual(downscaleSteps({ w: 1440, h: 12000 }, { width: 120, height: 1000 }), [{ w: 720, h: 6000 }, { w: 360, h: 3000 }, { w: 180, h: 1500 }, { w: 120, h: 1000 }], 'halve while more than 2× the target, then one last draw');
  assert.deepEqual(downscaleSteps({ w: 1440, h: 900 }, { width: 1400, height: 875 }), [{ w: 1400, h: 875 }]);
  assert.deepEqual(downscaleSteps({ w: 800, h: 600 }, { width: 800, height: 600 }), [{ w: 800, h: 600 }], 'no scaling: one draw, then the JPEG');
  assert.deepEqual(downscaleSteps({ w: 5000, h: 1100 }, fitWithin(5000, 1100)), [{ w: 2500, h: 550 }, { w: 1400, h: 308 }], 'one axis halves, the other stays at its target');
  assert.equal(cappedPath('out/x.png'), 'out/x.jpg'); assert.equal(cappedPath('X.PNG'), 'X.jpg'); assert.equal(cappedPath('out/x'), 'out/x.jpg');
  assert.ok(isShotInput('out/x.png', 'out/x.png') && isShotInput('./out/x.jpg', 'out/x.png'), 'this run\'s shot by its .png or its capped .jpg');
  assert.ok(!isShotInput('out/y.png', 'out/x.png') && !isShotInput('out/x.png', null));
});
await check('splitSelectors: top-level commas only — (), [] and quoted commas stay in their selector', () => {
  assert.deepEqual(splitSelectors('.a, .b ,,#c'), ['.a', '.b', '#c']);
  assert.deepEqual(splitSelectors(':is(.a, .b) > p, [data-x="1,2"], a[title=\'x, y\']'), [':is(.a, .b) > p', '[data-x="1,2"]', "a[title='x, y']"]);
  assert.deepEqual(splitSelectors('[aria-label="a \\" , b"],.c'), ['[aria-label="a \\" , b"]', '.c']);
});
await check('summaryLine: the fixed field order, consent none and an unknown status spelled out', () => {
  assert.equal(summaryLine({ url: 'https://www.example.com/', width: 1440, status: 200, consent: '#onetrust-accept-btn-handler', hidden: 3, consoleErrors: 2 }),
    'page-probe https://www.example.com/ @1440px: HTTP 200 · consent #onetrust-accept-btn-handler · hidden 3 · console errors 2');
  assert.equal(summaryLine({ url: 'u', width: 390, status: null, consent: null, hidden: 0, consoleErrors: 0 }), 'page-probe u @390px: HTTP - · consent none · hidden 0 · console errors 0');
});
await check('consoleLine: one line, whitespace collapsed, cut at 200 chars', () => {
  assert.equal(consoleLine('  Uncaught\n  at x.js:1  '), 'console error: Uncaught at x.js:1');
  const long = consoleLine('e'.repeat(500));
  assert.equal(long.length, 'console error: '.length + 200); assert.ok(long.endsWith('e…'));
  assert.equal(consoleLine('f'.repeat(200)), `console error: ${'f'.repeat(200)}`, 'exactly 200 chars is not cut');
});
await check('evalText: compact JSON, undefined spelled out, unserialisable values stringified, cut at --max-chars with the full length named', () => {
  assert.equal(evalText({ a: [1, 'x'] }), '{"a":[1,"x"]}');
  assert.equal(evalText('fixture'), '"fixture"');
  assert.equal(evalText(undefined), 'undefined');
  assert.equal(evalText(null), 'null');
  assert.equal(evalText(10n), '10');
  assert.equal(evalText('x'.repeat(50), 10), `"xxxxxxxxx… [52 chars, cut at --max-chars 10]`);
  assert.equal(evalText('xxxxxxxx', 10), '"xxxxxxxx"', 'exactly max chars is not cut');
});
await check('formatReport: summary, click, eval, shot, sbs, then the first 20 console lines; nothing page-side after a failed navigation', () => {
  const errors = Array.from({ length: 25 }, (_, i) => `err ${i}`);
  const shot = { file: 's.jpg', w: 1400, h: 875, fullRes: null }; const sbs = { file: 'o.jpg', w: 1400, h: 465, fullRes: { file: 'o.png', w: 2888, h: 960 } };
  const lines = formatReport({ url: 'http://127.0.0.1:1/', width: 1440, status: 200, consent: null, hidden: 1, consoleErrors: errors, click: '#t', evalJson: '"v"', shot, sbs });
  assert.deepEqual(lines.slice(0, 5), ['page-probe http://127.0.0.1:1/ @1440px: HTTP 200 · consent none · hidden 1 · console errors 25', 'click: #t', 'eval: "v"', 'shot: s.jpg 1400×875 q80', 'sbs: o.jpg 1400×465 q80 · full-res o.png 2888×960']);
  assert.equal(lines.length, 5 + 20); assert.equal(lines[5], 'console error: err 0'); assert.equal(lines.at(-1), 'console error: err 19');
  assert.deepEqual(formatReport({ url: 'http://127.0.0.1:1/', width: 1440, status: null, consoleErrors: ['x'], hidden: 0 }), [], 'navigation failed: no summary, no console lines');
  assert.deepEqual(formatReport({ url: null, consoleErrors: [], sbs }), ['sbs: o.jpg 1400×465 q80 · full-res o.png 2888×960'], 'compose only');
  assert.equal(imageLine('shot', { file: 'a b.jpg', w: 120, h: 1000, fullRes: { file: 'a b.png', w: 1440, h: 12000 } }), 'shot: a b.jpg 120×1000 q80 · full-res a b.png 1440×12000', 'every file written is named');
  assert.deepEqual(formatReport({ url: 'u', width: 1, status: 200, consent: null, hidden: 0, consoleErrors: [], evalJson: 'undefined' }).slice(1), ['eval: undefined']);
  assert.deepEqual(formatReport({ url: 'u', width: 1, status: 200, consent: null, hidden: 2, hiddenText: '.bar ×1 (120px) [--hide]; .promo ×1 (40px) [--hide]', consoleErrors: [], click: '#t' }).slice(1),
    ['hidden: .bar ×1 (120px) [--hide]; .promo ×1 (40px) [--hide]', 'click: #t'], 'live-session\'s formatHidden text right under the summary');
});
await check('exitCodeFor: usage 2, bot challenge 3, anything else 1', () => {
  assert.equal(exitCodeFor(new UsageError('x')), 2);
  const bot = new Error('bot challenge'); bot.name = 'BotChallengeError';
  assert.equal(exitCodeFor(bot), 3);
  const http = new Error('HTTP 404'); http.name = 'LiveHTTPError';
  assert.equal(exitCodeFor(http), 1); assert.equal(exitCodeFor(new Error('click: .x matched nothing')), 1);
});
await check('fallback hide: one display:none !important rule per selector, passed with each entry; live-session\'s hideRegions wins when exported', async () => {
  assert.equal(hideCss('.bar'), '.bar { display: none !important; }');
  assert.equal(hideCss(':is(.a, .b) > p'), ':is(.a, .b) > p { display: none !important; }');
  const calls = [];
  const page = { evaluate: async (fn, arg) => { calls.push({ fn, arg }); return arg.map(({ sel, source }) => ({ sel, source, n: 1, h: 120 })); } };
  const res = await hideRegionsFallback(page, [{ sel: '.bar', source: '--hide' }, { sel: '#promo', source: '--hide' }]);
  assert.deepEqual(calls[0].arg, [{ sel: '.bar', source: '--hide', css: '.bar { display: none !important; }' }, { sel: '#promo', source: '--hide', css: '#promo { display: none !important; }' }]);
  assert.equal(typeof calls[0].fn, 'function'); assert.deepEqual(res.map((x) => x.sel), ['.bar', '#promo']);
});
// A stub shaped like the live-session that carries the helper: hideEntries reads a plain string as a comma list split at
// EVERY comma (its parseHideList) and keeps a { sel, source } object whole; hideRegions measures and hides; formatHidden.
const helperModule = (calls) => ({
  hideEntries: (...args) => {
    calls.push(['hideEntries', ...args]);
    const [list, source = '--hide'] = args; const out = [];
    for (const x of [].concat(list)) {
      if (x && typeof x === 'object') out.push({ sel: x.sel.trim(), source: x.source || source });
      else String(x).split(',').map((v) => v.trim()).filter(Boolean).forEach((sel) => out.push({ sel, source }));
    }
    return out;
  },
  hideRegions: async (...args) => { calls.push(['hideRegions', ...args]); return args[1].map(({ sel, source }) => ({ sel, source, n: 1, h: 10 })); },
  formatHidden: (records) => records.map((x) => `${x.sel} ×${x.n} [${x.source}]`).join('; '),
});
await check('pickHide: live-session\'s hideEntries + hideRegions when both are exported — the gate tools\' two-argument call, selectors kept whole, its formatHidden', async () => {
  const calls = []; const mod = helperModule(calls); const page = { id: 'page' };
  const h = pickHide(mod);
  assert.equal(h.via, 'live-session'); assert.equal(h.note, 'page-probe: hide via live-session'); assert.equal(h.format, mod.formatHidden);
  const recs = await h.run(page, [':is(.a, .b) > p', '.bar']);
  const entries = [{ sel: ':is(.a, .b) > p', source: '--hide' }, { sel: '.bar', source: '--hide' }];
  assert.deepEqual(calls[0], ['hideEntries', entries, '--hide'], 'entries built with hideEntries(…, \'--hide\')');
  assert.deepEqual(calls[1], ['hideRegions', page, entries], 'hideRegions(page, entries) — no options, as the gate tools call it');
  assert.deepEqual(recs.map((x) => x.sel), [':is(.a, .b) > p', '.bar'], 'a comma inside :is() is not split');
  assert.equal(h.format(recs), ':is(.a, .b) > p ×1 [--hide]; .bar ×1 [--hide]');
  assert.equal(pickHide({ ...mod, formatHidden: undefined }).format, null, 'no formatHidden export: no per-selector line');
});
await check('pickHide: the local fallback when live-session lacks hideRegions or hideEntries (this base), the note names the missing export', async () => {
  for (const [mod, missing] of [[{}, 'hideRegions'], [{ hideEntries: () => [] }, 'hideRegions'], [{ hideRegions: async () => [] }, 'hideEntries']]) {
    const h = pickHide(mod);
    assert.equal(h.via, 'fallback'); assert.equal(h.format, null);
    assert.equal(h.note, `page-probe: hide via the local fallback (live-session has no ${missing})`);
  }
  const calls = []; const page = { evaluate: async (fn, arg) => { calls.push(arg); return arg.map(({ sel, source }) => ({ sel, source, n: 1, h: 1 })); } };
  await pickHide({}).run(page, [':is(.a, .b)']);
  assert.deepEqual(calls[0], [{ sel: ':is(.a, .b)', source: '--hide', css: ':is(.a, .b) { display: none !important; }' }]);
  const both = typeof liveSession.hideEntries === 'function' && typeof liveSession.hideRegions === 'function';
  assert.equal(pickHide(liveSession).via, both ? 'live-session' : 'fallback', 'the real live-session module: its exports decide');
});
await check('countHidden: distinct elements — an element two overlapping selectors match counts once; error and zero-match records add nothing', async () => {
  const [bar, promo, para] = [{ id: 'bar' }, { id: 'promo' }, { id: 'para' }];
  const dom = { '.bar': [bar], 'div.bar': [bar], '.promo': [promo, para], 'main p': [para], '.gone': [] };
  globalThis.document = { querySelectorAll: (sel) => { if (!(sel in dom)) throw new SyntaxError(`'${sel}' is not a valid selector`); return dom[sel]; } };
  try {
    const evals = []; const page = { evaluate: async (fn, arg) => { evals.push(arg); return fn(arg); } };
    const recs = [{ sel: '.bar', n: 1 }, { sel: 'div.bar', n: 1 }, { sel: '.promo', n: 2 }, { sel: 'main p', n: 1 }, { sel: '.gone', n: 0 }, { sel: 'a[', n: 0, error: 'not a valid selector' }];
    assert.equal(recs.reduce((s, x) => s + x.n, 0), 5, 'the per-selector sum counts bar and para twice');
    assert.equal(await countHidden(page, recs), 3);
    assert.deepEqual(evals, [['.bar', 'div.bar', '.promo', 'main p']], 'one page call over the selectors that matched');
    assert.equal(await countHidden(page, [{ sel: '.gone', n: 0 }, { sel: 'a[', n: 0, error: 'x' }]), 0);
    assert.equal(evals.length, 1, 'nothing matched: no page call');
    assert.equal(distinctMatchesInPage(['.bar', 'nope[', 'div.bar']), 1, 'a selector the query refuses adds nothing');
  } finally { delete globalThis.document; }
});
await check('pngSize reads the IHDR, jpegSize the SOF, imageSize either with its type; anything else is null. sbsWidth and the compose page', () => {
  const ihdr = pngHead(1440, 900);
  assert.deepEqual(pngSize(ihdr), { w: 1440, h: 900 });
  assert.deepEqual(jpegSize(jpegHead(1400, 875)), { w: 1400, h: 875 }); assert.deepEqual(jpegSize(jpegHead(300, 7000, 0xc2)), { w: 300, h: 7000 }, 'progressive');
  assert.equal(jpegSize(jpegHead(10, 10).subarray(0, 24)), null, 'cut before the SOF'); assert.equal(jpegSize(ihdr), null); assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.deepEqual(imageSize(ihdr), { w: 1440, h: 900, mime: 'image/png' }); assert.deepEqual(imageSize(jpegHead(1400, 875)), { w: 1400, h: 875, mime: 'image/jpeg' });
  assert.equal(imageSize(Buffer.from('GIF89a, not ours')), null);
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null); assert.equal(pngSize(ihdr.subarray(0, 20)), null); assert.equal(pngSize('x'), null);
  assert.equal(sbsWidth({ w: 1440 }, { w: 390 }), 16 + 1440 + 16 + 390 + 16);
  const html = sbsHtml([{ caption: 'live/<home>.png', src: 'data:image/png;base64,AA', w: 10, h: 20 }, { caption: 'a&b.png', src: 'data:image/png;base64,BB', w: 30, h: 40 }]);
  assert.ok(html.includes('live/&lt;home&gt;.png') && html.includes('a&amp;b.png'), 'captions escaped');
  assert.ok(html.includes('width="10" height="20"') && html.includes('width="30" height="40"'), 'images at their natural size');
  assert.ok(html.indexOf('live/&lt;home&gt;.png') < html.indexOf('a&amp;b.png'), 'a left of b');
});
await check('HELP: usage, every flag, the output lines, exit codes, and that gate numbers come from the gate instruments', () => {
  for (const f of ['--width', '--shot', '--full', '--full-res', '--eval', '--click', '--hide', '--sbs', '--dismiss', '--headed', '--locale', '--nav-timeout', '--max-chars', '--help']) assert.ok(HELP.includes(f), f);
  for (const s of ['Usage: node page-probe.mjs', 'console errors <n>', 'Exit codes', '3 bot challenge', 'gate instruments', '<name>-sbs.png', '1400 × 1000', 'JPEG quality 80', 'PNG or JPEG']) assert.ok(HELP.includes(s), s);
});
await check('--help exits 0 with the usage from an empty cwd and writes nothing; a usage error exits 2 naming the flag, writing nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'page-probe-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node page-probe\.mjs/); assert.deepEqual(readdirSync(cwd), []);
    const u = spawnSync(process.execPath, [SCRIPT, 'https://www.example.com/', '--width', 'wide', '--shot', 'x.png'], { cwd, encoding: 'utf8' });
    assert.equal(u.status, 2); assert.match(u.stderr, /--width must be a whole number/); assert.equal(u.stdout, ''); assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('--sbs inputs are checked before any browser: a missing .png whose capped .jpg exists names the .jpg; a non-image input exits 2', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'page-probe-sbs-'));
  try {
    writeFileSync(join(cwd, 'live.jpg'), jpegHead(1400, 875)); writeFileSync(join(cwd, 'ref.png'), pngHead(1440, 900)); writeFileSync(join(cwd, 'notes.png'), 'text');
    const r = spawnSync(process.execPath, [SCRIPT, '--sbs', 'live.png', 'ref.png', 'out.png'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /--sbs input live\.png is not readable \(ENOENT; page-probe wrote its capped shot as live\.jpg — pass that, or shoot with --full-res\)/);
    const t = spawnSync(process.execPath, [SCRIPT, '--sbs', 'live.jpg', 'notes.png', 'out.png'], { cwd, encoding: 'utf8' });
    assert.equal(t.status, 2); assert.match(t.stderr, /--sbs input notes\.png is not a PNG or JPEG/);
    assert.deepEqual(readdirSync(cwd).sort(), ['live.jpg', 'notes.png', 'ref.png'], 'nothing written');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- (b) end to end -----------------------------------------------------------------------------------

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) { console.log('skip  end-to-end (playwright not importable here)'); }
else {
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>fixture</title><link rel="icon" href="data:,"><style>
    body{margin:0;font:16px/22px Arial} .bar{height:120px;background:#c00;color:#fff} main{padding:24px}
    .menu[hidden]{display:none} #onetrust-banner-sdk{position:fixed;left:0;right:0;bottom:0;height:100px;background:#222}
  </style></head><body>
    <div class="bar">promo bar</div>
    <main><h1>Fixture</h1><button id="toggle" onclick="document.querySelector('.menu').hidden = false">Menu</button><nav class="menu" hidden><a href="#">Item</a></nav></main>
    <div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler" onclick="document.getElementById('onetrust-banner-sdk').remove(); document.title = 'fixture accepted'">Accept</button></div>
    <script>console.error('fixture console error');</script>
  </body></html>`;
  const PLAIN = '<!doctype html><html><head><meta charset="utf-8"><title>plain</title><link rel="icon" href="data:,"></head><body><main><h1>Plain</h1></main></body></html>';
  const server = createServer((req, res) => {
    if (req.url === '/blocked') { res.writeHead(403, { 'content-type': 'text/html', server: 'AkamaiGHost' }); res.end('<h1>Access Denied</h1>'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(req.url === '/plain' ? PLAIN : PAGE);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'page-probe-e2e-'));
  const hidePath = pickHide(liveSession);
  // live-session's formatHidden line under the summary (helper path only); the fallback prints none.
  const hiddenLines = (text) => (hidePath.format ? [`hidden: ${text}`] : []);
  try {
    await check('e2e: consent named, .bar hidden, eval after the dismissal, PNG written, console error listed', async () => {
      const r = await runAsync([`${base}/`, '--hide', '.bar', '--eval', 'document.title', '--shot', 'out/shot.png'], cwd);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trim().split('\n');
      assert.deepEqual(lines, [
        `page-probe ${base}/ @1440px: HTTP 200 · consent #onetrust-accept-btn-handler · hidden 1 · console errors 1`,
        ...hiddenLines('.bar ×1 (120px) [--hide]'),
        'eval: "fixture accepted"',
        'shot: out/shot.jpg 1400×875 q80',
        'console error: fixture console error',
      ]);
      assert.deepEqual(jpegSize(readFileSync(join(cwd, 'out', 'shot.jpg'))), { w: 1400, h: 875 }, '1440 × 900 fitted into 1400 × 1000');
      assert.deepEqual(readdirSync(join(cwd, 'out')), ['shot.jpg'], 'the capped JPEG only: no PNG without --full-res, no tmp file left behind');
      assert.equal(r.err.split('\n').filter((l) => l.startsWith('page-probe: hide via')).join('\n'), hidePath.note, 'one line names the hide path');
    });
    await check('e2e: overlapping --hide selectors count the element once', async () => {
      const r = await runAsync([`${base}/`, '--hide', '.bar, div.bar, body > .bar'], cwd);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out.split('\n')[0], / · hidden 1 · console errors 1$/);
    });
    await check('e2e: --click runs before --eval; the hide is inline + one data-stardust-hide rule; --full shoots the page; --full-res keeps the PNG', async () => {
      const ev = "[document.querySelector('.menu').hidden, getComputedStyle(document.querySelector('.bar')).display, document.querySelector('.bar').style.getPropertyPriority('display'), document.querySelectorAll('style[data-stardust-hide]').length]";
      const r = await runAsync([`${base}/`, '--width', '800', '--hide', '.bar', '--click', '#toggle', '--eval', ev, '--shot', 'out/full.png', '--full', '--full-res'], cwd);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trim().split('\n');
      assert.match(lines[0], / @800px: HTTP 200 · consent #onetrust-accept-btn-handler · hidden 1 · console errors 1$/);
      const png = pngSize(readFileSync(join(cwd, 'out', 'full.png'))); const fit = fitWithin(png.w, png.h);
      assert.equal(png.w, 800);
      assert.deepEqual(lines.slice(1), [...hiddenLines('.bar ×1 (120px) [--hide]'), 'click: #toggle', 'eval: [false,"none","important",1]',
        `shot: out/full.jpg ${fit.width}×${fit.height} q80 · full-res out/full.png ${png.w}×${png.h}`, 'console error: fixture console error']);
      assert.deepEqual(jpegSize(readFileSync(join(cwd, 'out', 'full.jpg'))), { w: fit.width, h: fit.height });
    });
    await check('e2e: a --click selector matching nothing exits 1 naming it; the summary still prints', async () => {
      const r = await runAsync([`${base}/plain`, '--click', '.nope', '--shot', 'out/never.png'], cwd);
      assert.equal(r.code, 1); assert.match(r.err, /click: \.nope matched nothing/);
      assert.match(r.out, /^page-probe .*\/plain @1440px: HTTP 200 · consent none · hidden 0 · console errors 0\n$/);
      assert.ok(!existsSync(join(cwd, 'out', 'never.png')) && !existsSync(join(cwd, 'out', 'never.jpg')), 'no shot after a failed step');
    });
    await check('e2e: a throwing --eval exits 1 with its message', async () => {
      const r = await runAsync([`${base}/plain`, '--eval', "(() => { throw new Error('probe boom'); })()"], cwd);
      assert.equal(r.code, 1); assert.match(r.err, /eval: .*probe boom/); assert.doesNotMatch(r.out, /^eval:/m);
    });
    await check('e2e: an edge-signed 403 is a bot challenge — exit 3, nothing measured', async () => {
      const r = await runAsync([`${base}/blocked`, '--shot', 'out/blocked.png'], cwd);
      assert.equal(r.code, 3, r.err); assert.match(r.err, /bot challenge/); assert.equal(r.out, '');
      assert.ok(!existsSync(join(cwd, 'out', 'blocked.png')) && !existsSync(join(cwd, 'out', 'blocked.jpg')));
    });
    await check('e2e: --shot and --sbs naming one file — the shot stays, the side by side goes beside it (this run\'s shot at full resolution) and its line names it', async () => {
      const r = await runAsync([`${base}/plain`, '--shot', 'out/same.png', '--sbs', 'out/shot.jpg', 'out/same.png', 'out/same.png', '--full-res'], cwd);
      assert.equal(r.code, 0, r.err);
      const sbsPng = pngSize(readFileSync(join(cwd, 'out', 'same-sbs.png'))); const fit = fitWithin(sbsPng.w, sbsPng.h);
      assert.deepEqual(r.out.trim().split('\n').slice(1), ['shot: out/same.jpg 1400×875 q80 · full-res out/same.png 1440×900',
        `sbs: out/same-sbs.jpg ${fit.width}×${fit.height} q80 · full-res out/same-sbs.png ${sbsPng.w}×${sbsPng.h}`]);
      assert.match(r.err, /page-probe: --sbs out\/same\.png is --shot's file — the side by side goes beside it: out\/same-sbs\.png/);
      assert.deepEqual(pngSize(readFileSync(join(cwd, 'out', 'same.png'))), { w: 1440, h: 900 }, 'the shot, not the composition');
      assert.deepEqual(jpegSize(readFileSync(join(cwd, 'out', 'same.jpg'))), { w: 1400, h: 875 });
      assert.equal(sbsPng.w, sbsWidth({ w: 1400 }, { w: 1440 }), 'the capped JPEG input beside this run\'s full-resolution shot');
      assert.deepEqual(jpegSize(readFileSync(join(cwd, 'out', 'same-sbs.jpg'))), { w: fit.width, h: fit.height });
    });
    await check('e2e: --sbs with no <url> composes a PNG and a JPEG side by side, capped, and prints only the sbs line', async () => {
      const r = await runAsync(['--sbs', 'out/full.png', 'out/shot.jpg', 'out/sbs.png'], cwd);
      assert.equal(r.code, 0, r.err);
      const a = pngSize(readFileSync(join(cwd, 'out', 'full.png'))); const b = jpegSize(readFileSync(join(cwd, 'out', 'shot.jpg')));
      const c = jpegSize(readFileSync(join(cwd, 'out', 'sbs.jpg')));
      assert.equal(r.out, `sbs: out/sbs.jpg ${c.w}×${c.h} q80\n`);
      assert.equal(existsSync(join(cwd, 'out', 'sbs.png')), false, 'no PNG without --full-res');
      const full = { w: sbsWidth(a, b) }; assert.equal(c.w, Math.min(1400, full.w)); assert.ok(c.h <= 1000 && c.w <= 1400);
      assert.ok(c.h / c.w > Math.max(a.h, b.h) / full.w, `${c.w}×${c.h}: taller than the images alone (captions above them), aspect kept`);
    });
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\npage-probe: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
