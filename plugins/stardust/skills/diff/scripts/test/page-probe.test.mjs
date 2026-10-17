#!/usr/bin/env node
// skills/diff/scripts/test/page-probe.test.mjs — the page-probe.mjs contract (the one ad-hoc browser probe).
// Part (a), no browser: parseArgs (every flag, --sbs's three values, the usage errors), selector-list splitting, the
// summary / console / eval line formatting and their caps, the fallback hide CSS and the hideRegions feature
// detection, the PNG header reader and the compose page, --help and a usage error from an empty cwd (nothing
// written). Part (b), where playwright is importable: a fixture page served from this process with a consent banner
// (accept = #onetrust-accept-btn-handler), a console.error and a .bar to hide — the probe names the consent, hides
// one element, evaluates after the dismissal, writes the PNG and lists the console error; --click runs before
// --eval; a click selector matching nothing and a throwing eval exit 1; an edge-signed 403 exits 3; --sbs composes
// two PNGs with no <url>. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HELP, UsageError, consoleLine, countHidden, distinctMatchesInPage, evalText, exitCodeFor, formatReport, hideCss, hideRegionsFallback,
  parseArgs, pickHide, pngSize, sbsHtml, sbsOutPath, sbsWidth, splitSelectors, summaryLine,
} from '../page-probe.mjs';
import * as liveSession from '../live-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'page-probe.mjs');
let failed = 0; let checks = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const runAsync = (args, cwd) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });
const usage = (args, re) => assert.throws(() => parseArgs(args), (e) => e instanceof UsageError && re.test(e.message), `${args.join(' ')} → usage error ${re}`);

// ---- (a) pure -----------------------------------------------------------------------------------------

await check('parseArgs: defaults for a bare <url>', () => {
  const o = parseArgs(['https://www.example.com/']);
  assert.deepEqual(o, { url: 'https://www.example.com/', width: 1440, hide: [], click: null, eval: null, maxChars: 4000, shot: null, full: false, sbs: null, dismiss: [], headed: false, locale: null, navTimeout: 60000, help: false });
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
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h', '--full']).help, true);
});
await check('parseArgs usage errors: no <url> without --sbs, --full without --shot, bad --width, a value flag followed by a flag or nothing', () => {
  usage([], /need <url>/);
  usage(['--width', '390'], /need <url>/);
  usage(['https://www.example.com/', '--full'], /--full needs --shot/);
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
  usage(['--sbs', 'a.png', 'b.png', 'c.jpg'], /must end in \.png/);
  usage(['https://www.example.com/', '--shot', 'shot.jpg'], /--shot writes a PNG/);
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
  const lines = formatReport({ url: 'http://127.0.0.1:1/', width: 1440, status: 200, consent: null, hidden: 1, consoleErrors: errors, click: '#t', evalJson: '"v"', shot: 's.png', sbs: 'o.png' });
  assert.deepEqual(lines.slice(0, 5), ['page-probe http://127.0.0.1:1/ @1440px: HTTP 200 · consent none · hidden 1 · console errors 25', 'click: #t', 'eval: "v"', 'shot: s.png', 'sbs: o.png']);
  assert.equal(lines.length, 5 + 20); assert.equal(lines[5], 'console error: err 0'); assert.equal(lines.at(-1), 'console error: err 19');
  assert.deepEqual(formatReport({ url: 'http://127.0.0.1:1/', width: 1440, status: null, consoleErrors: ['x'], hidden: 0 }), [], 'navigation failed: no summary, no console lines');
  assert.deepEqual(formatReport({ url: null, consoleErrors: [], sbs: 'o.png' }), ['sbs: o.png'], 'compose only');
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
await check('pngSize reads the IHDR; anything else is null. sbsWidth and the compose page (captions escaped, natural sizes)', () => {
  const ihdr = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(ihdr); ihdr.write('IHDR', 12, 'latin1'); ihdr.writeUInt32BE(1440, 16); ihdr.writeUInt32BE(900, 20);
  assert.deepEqual(pngSize(ihdr), { w: 1440, h: 900 });
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null); assert.equal(pngSize(ihdr.subarray(0, 20)), null); assert.equal(pngSize('x'), null);
  assert.equal(sbsWidth({ w: 1440 }, { w: 390 }), 16 + 1440 + 16 + 390 + 16);
  const html = sbsHtml([{ caption: 'live/<home>.png', src: 'data:image/png;base64,AA', w: 10, h: 20 }, { caption: 'a&b.png', src: 'data:image/png;base64,BB', w: 30, h: 40 }]);
  assert.ok(html.includes('live/&lt;home&gt;.png') && html.includes('a&amp;b.png'), 'captions escaped');
  assert.ok(html.includes('width="10" height="20"') && html.includes('width="30" height="40"'), 'images at their natural size');
  assert.ok(html.indexOf('live/&lt;home&gt;.png') < html.indexOf('a&amp;b.png'), 'a left of b');
});
await check('HELP: usage, every flag, the output lines, exit codes, and that gate numbers come from the gate instruments', () => {
  for (const f of ['--width', '--shot', '--full', '--eval', '--click', '--hide', '--sbs', '--dismiss', '--headed', '--locale', '--nav-timeout', '--max-chars', '--help']) assert.ok(HELP.includes(f), f);
  for (const s of ['Usage: node page-probe.mjs', 'console errors <n>', 'Exit codes', '3 bot challenge', 'gate instruments', '<name>-sbs.png']) assert.ok(HELP.includes(s), s);
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
        'shot: out/shot.png',
        'console error: fixture console error',
      ]);
      assert.deepEqual(pngSize(readFileSync(join(cwd, 'out', 'shot.png'))), { w: 1440, h: 900 });
      assert.deepEqual(readdirSync(join(cwd, 'out')), ['shot.png'], 'no tmp file left behind');
      assert.equal(r.err.split('\n').filter((l) => l.startsWith('page-probe: hide via')).join('\n'), hidePath.note, 'one line names the hide path');
    });
    await check('e2e: overlapping --hide selectors count the element once', async () => {
      const r = await runAsync([`${base}/`, '--hide', '.bar, div.bar, body > .bar'], cwd);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out.split('\n')[0], / · hidden 1 · console errors 1$/);
    });
    await check('e2e: --click runs before --eval; the hide is inline + one data-stardust-hide rule; --full shoots the page', async () => {
      const ev = "[document.querySelector('.menu').hidden, getComputedStyle(document.querySelector('.bar')).display, document.querySelector('.bar').style.getPropertyPriority('display'), document.querySelectorAll('style[data-stardust-hide]').length]";
      const r = await runAsync([`${base}/`, '--width', '800', '--hide', '.bar', '--click', '#toggle', '--eval', ev, '--shot', 'out/full.png', '--full'], cwd);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trim().split('\n');
      assert.match(lines[0], / @800px: HTTP 200 · consent #onetrust-accept-btn-handler · hidden 1 · console errors 1$/);
      assert.deepEqual(lines.slice(1), [...hiddenLines('.bar ×1 (120px) [--hide]'), 'click: #toggle', 'eval: [false,"none","important",1]', 'shot: out/full.png', 'console error: fixture console error']);
      assert.equal(pngSize(readFileSync(join(cwd, 'out', 'full.png'))).w, 800);
    });
    await check('e2e: a --click selector matching nothing exits 1 naming it; the summary still prints', async () => {
      const r = await runAsync([`${base}/plain`, '--click', '.nope', '--shot', 'out/never.png'], cwd);
      assert.equal(r.code, 1); assert.match(r.err, /click: \.nope matched nothing/);
      assert.match(r.out, /^page-probe .*\/plain @1440px: HTTP 200 · consent none · hidden 0 · console errors 0\n$/);
      assert.equal(existsSync(join(cwd, 'out', 'never.png')), false, 'no shot after a failed step');
    });
    await check('e2e: a throwing --eval exits 1 with its message', async () => {
      const r = await runAsync([`${base}/plain`, '--eval', "(() => { throw new Error('probe boom'); })()"], cwd);
      assert.equal(r.code, 1); assert.match(r.err, /eval: .*probe boom/); assert.doesNotMatch(r.out, /^eval:/m);
    });
    await check('e2e: an edge-signed 403 is a bot challenge — exit 3, nothing measured', async () => {
      const r = await runAsync([`${base}/blocked`, '--shot', 'out/blocked.png'], cwd);
      assert.equal(r.code, 3, r.err); assert.match(r.err, /bot challenge/); assert.equal(r.out, '');
      assert.equal(existsSync(join(cwd, 'out', 'blocked.png')), false);
    });
    await check('e2e: --shot and --sbs naming one file — the shot stays, the side by side goes beside it and its line names it', async () => {
      const r = await runAsync([`${base}/plain`, '--shot', 'out/same.png', '--sbs', 'out/shot.png', 'out/same.png', 'out/same.png'], cwd);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.trim().split('\n').slice(1), ['shot: out/same.png', 'sbs: out/same-sbs.png']);
      assert.match(r.err, /page-probe: --sbs out\/same\.png is --shot's file — the side by side goes beside it: out\/same-sbs\.png/);
      assert.deepEqual(pngSize(readFileSync(join(cwd, 'out', 'same.png'))), { w: 1440, h: 900 }, 'the shot, not the composition');
      assert.equal(pngSize(readFileSync(join(cwd, 'out', 'same-sbs.png'))).w, sbsWidth({ w: 1440 }, { w: 1440 }));
    });
    await check('e2e: --sbs with no <url> composes the two PNGs side by side and prints only the sbs line', async () => {
      const r = await runAsync(['--sbs', 'out/shot.png', 'out/full.png', 'out/sbs.png'], cwd);
      assert.equal(r.code, 0, r.err); assert.equal(r.out, 'sbs: out/sbs.png\n');
      const a = pngSize(readFileSync(join(cwd, 'out', 'shot.png'))); const b = pngSize(readFileSync(join(cwd, 'out', 'full.png')));
      const c = pngSize(readFileSync(join(cwd, 'out', 'sbs.png')));
      assert.equal(c.w, sbsWidth(a, b)); assert.ok(c.h > Math.max(a.h, b.h), `${c.h} px tall (captions above the images)`);
    });
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\npage-probe: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
