#!/usr/bin/env node
// skills/replica/scripts/test/source-spec.test.mjs — the source-spec.mjs contract.
// Pure: argument parsing and usage errors (exit 125), pairing (exact / prefix / order, duplicates, images by file
// name then order), the section table (first cause, displaced, gap, missing / extra section), node tolerance and
// the displaced-below rule, missing / extra nodes, the verdict and pass, style clustering, the container, the
// brief, view queries (table + TSV), the one-node-per-line file, --help in an empty cwd.
// End-to-end (where playwright is importable; a skip line otherwise) against LOCAL fixture pages served in-process:
// a responsive "live" page and three builds — (a) identical, (b) hero heading 2 px smaller + one paragraph wrapping
// to an extra line at 360, (c) a card missing + an extra link — capture at 1440 and 360, compare, view.
// Run: node <this file>.   Fixture server only: node <this file> --serve [port] [host]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, HELP, TEXT_CAP, TOTAL_OFFSET_MAX, UsageError, buildSpec, clusterStyles, compareSpecs, containerOf, formatBrief, formatCompare, formatNodes, extraOf, nodeDelta, normText, parseFontSubstFile, sameLengths, scrollShapeDelta, pairList, pairNodes, pairSections, parseArgs, queryNodes, sectionTable, serialiseSpec, tokensOf } from '../source-spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'source-spec.mjs');

// ---- fixture pages ----------------------------------------------------------------------------------------------
const IMG = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="${c}"/></svg>`)}`;
const LOREM = 'Every measurement on this page is read before a single rule is written, so the first build starts from numbers and not from a guess about how the page was put together by its authors.';
function fixturePage(variant = 'live') {
  const b = variant === 'b'; const c = variant === 'c'; const d = variant === 'd'; // d: the same boxes at rest, but nothing sticky and another image radius
  const css = `*{box-sizing:border-box}html,body{margin:0}body{font:16px/24px Arial,sans-serif;color:#222}
header.top{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;background:#fff;border-bottom:1px solid #ddd}
.brand{font-weight:700;font-size:20px}nav a{margin-left:24px;color:#036;text-decoration:none;font-size:15px}
.hero{background:#0b2545;color:#fff;padding:96px 120px}.hero h1{font:700 ${b ? 54 : 56}px/1.1 Georgia,serif;margin:0 0 24px}
.hero p{font-size:20px;line-height:30px;max-width:640px;margin:0 0 32px}.btn{display:inline-block;background:#f6c343;color:#111;padding:14px 28px;font-weight:700;text-decoration:none;text-transform:uppercase;font-size:14px;letter-spacing:1px}
.cards{padding:80px 120px;background:#f4f4f4}.cards h2,.story h2{font:700 32px/40px Georgia,serif;margin:0 0 32px}
.grid{display:flex;gap:32px}.card{flex:0 0 calc((100% - 64px) / 3);background:#fff}.card img{display:block;width:100%;height:200px;object-fit:cover;border-radius:${d ? 8 : 24}px}.card h3{font-size:20px;line-height:28px;margin:16px 16px 8px}.card p{margin:0 16px 20px;color:#555}
.story{padding:80px 120px}.story p{max-width:720px;margin:0 0 16px}${d ? '' : '.story h2{position:sticky;top:20px}'}
footer{background:#111;color:#bbb;padding:40px 120px;font-size:14px}footer a{color:#fff;margin-right:16px}
@media (max-width:600px){header.top{padding:0 16px;height:56px}nav{display:none}.hero{padding:48px 16px}.hero h1{font-size:${b ? 30 : 32}px}.hero p{font-size:16px;line-height:24px}
.cards,.story{padding:40px 16px}.cards h2,.story h2{font-size:24px;line-height:32px;margin-bottom:20px}.grid{flex-direction:column;gap:20px}.card{flex:none}footer{padding:24px 16px}${b ? '.story p.lede{padding-right:90px}' : ''}}`;
  const card = (n, colour) => `<article class="card"><img src="${IMG(colour)}" alt="Card ${n} picture"><h3>Card title number ${n}</h3><p>Short supporting copy for card ${n}.</p></article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture</title><style>${css}</style></head><body>
<header class="top"><span class="brand">Fixture Brand</span><nav><a href="/products">Products</a><a href="/about">About us</a><a href="/contact">Contact</a></nav></header>
<main>
<section class="hero"><h1>Measure the source first</h1><p>The page is measured before it is written, at every width the gate will check.</p><a class="btn" href="/start">Get started</a></section>
<section class="cards"><h2>Three things to know</h2><div class="grid">${card(1, '#c33')}${card(2, '#3a3')}${c ? '' : card(3, '#33c')}</div></section>
<section class="story"><h2>Why the order matters</h2><p class="lede">${LOREM}</p><p>A second paragraph closes the section.</p>${c ? '<a href="/more">Read the whole story</a>' : ''}</section>
</main>
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© Fixture Brand</span></footer>
</body></html>`;
}
function startFixtures(port = 0, host = null) {
  const h = host || Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1';
  const server = createServer((req, res) => {
    const m = new URL(req.url, 'http://x/').pathname.match(/^\/(live|build-([abcd]))$/);
    if (!m) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fixturePage(m[1] === 'live' || m[2] === 'a' ? 'live' : m[2]));
  });
  return new Promise((resolve) => { server.listen(port, h, () => resolve({ server, base: `http://${h}:${server.address().port}` })); });
}
if (process.argv.includes('--serve')) {
  const i = process.argv.indexOf('--serve');
  const { base } = await startFixtures(Number(process.argv[i + 1]) || 8767, process.argv[i + 2] || null);
  console.log(`source-spec fixtures on ${base}  (/live /build-a /build-b /build-c /build-d)`);
  await new Promise(() => {});
}

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// ---- builders ---------------------------------------------------------------------------------------------------
const T = (section, text, x, y, w, h, extra = {}) => ({ section, region: 'main', kind: 'text', tag: 'p', role: null, text, x, y, w, h, fontFamily: 'Arial', fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0, textTransform: 'none', textAlign: 'start', color: 'rgb(34, 34, 34)', lines: Math.round(h / 24), ...extra });
const I = (section, src, x, y, w, h, extra = {}) => ({ section, region: 'main', kind: 'image', tag: 'img', role: null, text: '', x, y, w, h, fit: 'cover', natural: [400, 240], src, ...extra });
const S = (i, y, h, firstText, extra = {}) => ({ i, region: 'main', y, h, background: 'none', paddingTop: 40, paddingBottom: 40, selectorHint: 'section', firstText, ...extra });
const spec = (sections, nodes, docHeight) => ({ page: { url: 'http://x/', width: 360, viewport: 360, docHeight: docHeight ?? (sections.length ? sections[sections.length - 1].y + sections[sections.length - 1].h : 0), scrollWidth: 360, root: 'main', rootFallback: false, rootWrapsChrome: false }, sections, nodes });
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- arguments --------------------------------------------------------------------------------------------------
await check('parseArgs capture: slug, widths (default 1440,360; deduped), overlay flags, locale, out default', () => {
  const o = parseArgs(['capture', 'https://example.test/p', '--slug', 'home']);
  assert.deepEqual(o.widths, [1440, 360]); assert.equal(o.out, DEFAULT_OUT); assert.equal(o.noDismiss, false);
  const p = parseArgs(['capture', 'https://example.test/p', '--slug', 'home', '--widths', '1440,360,1920,360', '--main', 'main > div', '--consent', '#ok', '--dismiss', '.a, .b', '--no-dismiss', '--locale', 'en-GB', '--out', 'o', '--headed']);
  assert.deepEqual(p.widths, [1440, 360, 1920]); assert.equal(p.main, 'main > div'); assert.equal(p.consent, '#ok'); assert.deepEqual(p.dismiss, ['.a', '.b']);
  assert.equal(p.noDismiss, true); assert.equal(p.locale, 'en-GB'); assert.equal(p.out, 'o'); assert.equal(p.headed, true);
});
await check('parseArgs compare / view: positionals, --tol, --json, --section, --kind, --grep, --tsv', () => {
  const c = parseArgs(['compare', 's.json', 'http://localhost:8791/p.html', '--tol', '4', '--json', 'out.json', '--main', '.root']);
  assert.deepEqual(c.pos, ['s.json', 'http://localhost:8791/p.html']); assert.equal(c.tol, 4); assert.equal(c.json, 'out.json'); assert.equal(c.main, '.root');
  assert.equal(parseArgs(['compare', 's.json', 'http://localhost/p']).tol, 2);
  const v = parseArgs(['view', 's.json', '--section', '2', '--kind', 'image', '--grep', 'card', '--tsv']);
  assert.equal(v.section, 2); assert.equal(v.kind, 'image'); assert.equal(v.grep, 'card'); assert.equal(v.tsv, true);
});
await check('parseArgs: usage errors carry code 125 and name the problem', () => {
  const usage = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e instanceof UsageError && e.code === 125 && re.test(e.message), argv.join(' '));
  usage([], /subcommand/); usage(['measure', 'x'], /unknown subcommand/);
  usage(['capture', 'https://a.test/'], /--slug/); usage(['capture', '--slug', 's'], /takes <live-url>/);
  usage(['capture', 'https://a.test/', '--slug', '../x'], /file stem/); usage(['capture', 'https://a.test/', '--slug', 's', '--widths', '0'], /--widths/);
  usage(['capture', 'https://a.test/', '--slug', 's', '--widths', 'wide'], /--widths/); usage(['capture', 'a.test', '--slug', 's'], /http\(s\) URL/);
  usage(['capture', 'https://a.test/', '--slug'], /--slug needs a value/); usage(['capture', 'https://a.test/', '--slug', '--widths'], /--slug needs a value/);
  usage(['capture', 'https://a.test/', '--slug', 's', '--tol', '3'], /unknown flag --tol for capture/);
  usage(['compare', 's.json'], /takes <spec.json> <build-url>/); usage(['compare', 's.json', 'build.html'], /build URL/); usage(['compare', 's.json', 'http://l/', '--tol', '-1'], /--tol/);
  usage(['view'], /takes <spec.json>/); usage(['view', 's.json', '--kind', 'video'], /--kind/); usage(['view', 's.json', '--grep', '('], /--grep/); usage(['view', 's.json', '--section', 'x'], /--section/);
});
await check('--help: exit 0, usage on stdout, before any I/O (empty cwd stays empty), also with other arguments', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'source-spec-help-'));
  try {
    for (const args of [['--help'], ['-h'], ['capture', 'https://a.test/', '--slug', 's', '--help']]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
      assert.equal(r.status, 0); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /Exit codes: 0 .* 2 .* 3 bot challenge .* 1 error; 125 usage/s);
    }
    assert.deepEqual(readdirSync(cwd), []);
    assert.equal(HELP.includes(String(TEXT_CAP)), true, 'the cap is documented');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('CLI: a usage error exits 125; an unreadable or foreign spec exits 1 — neither opens a browser', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'source-spec-cli-'));
  try {
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: 'utf8' });
    let r = run('capture', 'https://a.test/'); assert.equal(r.status, 125); assert.match(r.stderr, /source-spec: capture needs --slug/);
    r = run(); assert.equal(r.status, 125);
    r = run('view', 'nope.json'); assert.equal(r.status, 1); assert.match(r.stderr, /cannot read spec/);
    r = run('compare', 'nope.json', 'http://localhost:1/x'); assert.equal(r.status, 1); assert.match(r.stderr, /cannot read spec/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---- pairing ----------------------------------------------------------------------------------------------------
const opts = { keyOf: (n) => normText(n.text), classOf: (n) => n.tag };
const tx = (text, tag = 'p') => ({ text, tag });
await check('pairList: exact text first (case and whitespace insensitive), wherever it sits', () => {
  const r = pairList([tx('Hello  World'), tx('Second line')], [tx('second line'), tx('hello world')], opts);
  assert.deepEqual(r.pairs, [{ a: 0, b: 1, how: 'exact' }, { a: 1, b: 0, how: 'exact' }]); assert.deepEqual(r.missing, []); assert.deepEqual(r.extra, []);
});
await check('pairList: duplicates pair in order, k-th with k-th; the surplus is missing / extra', () => {
  const r = pairList([tx('Read more'), tx('Read more'), tx('Read more')], [tx('Read more'), tx('Read more')], opts);
  assert.deepEqual(r.pairs.map((p) => [p.a, p.b]), [[0, 0], [1, 1]]); assert.deepEqual(r.missing, [2]);
  const e = pairList([tx('Read more')], [tx('Read more'), tx('Read more')], opts); assert.deepEqual(e.extra, [1]);
});
await check('pairList: prefix — a truncated or tail-edited text still pairs; short texts do not prefix-pair', () => {
  const r = pairList([tx('The page is measured before it is written…'), tx('Our annual report for the year 2025')], [tx('Our annual report for the year 2026'), tx('The page is measured before it is written, at every width')], opts);
  assert.deepEqual(r.pairs, [{ a: 0, b: 1, how: 'prefix' }, { a: 1, b: 0, how: 'prefix' }]);
  const s = pairList([tx('Go', 'a')], [tx('Gone fishing', 'p')], opts); assert.equal(s.pairs.length, 0);
});
await check('pairList: order — changed text pairs with the same-class node between its paired neighbours, never across them', () => {
  const A = [tx('Title', 'h2'), tx('12 March', 'p'), tx('Closing words here', 'p')];
  const B = [tx('Title', 'h2'), tx('3 April', 'p'), tx('Closing words here', 'p'), tx('Stray', 'p')];
  const r = pairList(A, B, opts);
  assert.deepEqual(r.pairs, [{ a: 0, b: 0, how: 'exact' }, { a: 1, b: 1, how: 'order' }, { a: 2, b: 2, how: 'exact' }]); assert.deepEqual(r.extra, [3]);
  const other = pairList([tx('Title', 'h2'), tx('Gone heading', 'h3'), tx('End of it all', 'p')], [tx('Title', 'h2'), tx('A new link', 'a'), tx('End of it all', 'p')], opts);
  assert.deepEqual(other.missing, [1]); assert.deepEqual(other.extra, [1], 'a different class never pairs by order');
});
await check('pairNodes: images by file name, then by order; text and images never cross', () => {
  const live = [T(0, 'Heading here', 0, 0, 100, 24), I(0, 'https://cdn.test/a/hero.jpg?w=800', 0, 30, 400, 200), I(0, 'https://cdn.test/a/second.jpg', 0, 240, 400, 200), I(0, 'https://cdn.test/a/third.jpg', 0, 450, 400, 200)];
  const build = [I(0, '/media/renamed-1.jpg', 0, 30, 400, 200), I(0, '/media/hero.jpg', 0, 240, 400, 200), I(0, '/media/renamed-3.jpg', 0, 450, 400, 200), T(0, 'Heading here', 0, 0, 100, 24)];
  const r = pairNodes(live, build);
  const im = r.pairs.filter((p) => p.live.kind === 'image').map((p) => [p.live.src.split('/').pop(), p.build.src.split('/').pop(), p.how]);
  assert.deepEqual(im, [['hero.jpg?w=800', 'hero.jpg', 'exact'], ['second.jpg', 'renamed-3.jpg', 'order']]);
  assert.deepEqual(r.missing.map((n) => n.src), ['https://cdn.test/a/third.jpg']); assert.deepEqual(r.extra.map((n) => n.src), ['/media/renamed-1.jpg']);
  const allRenamed = pairNodes([I(0, 'a.jpg', 0, 0, 9, 9), I(0, 'b.jpg', 0, 0, 9, 9)], [I(0, 'x.jpg', 0, 0, 9, 9), I(0, 'y.jpg', 0, 0, 9, 9)]);
  assert.deepEqual(allRenamed.pairs.map((p) => [p.live.src, p.build.src, p.how]), [['a.jpg', 'x.jpg', 'order'], ['b.jpg', 'y.jpg', 'order']]);
});
await check('pairSections: by region + first text; a reworded first text pairs by order within its region', () => {
  const live = [S(0, 0, 60, 'Brand', { region: 'header' }), S(1, 60, 400, 'Hero title'), S(2, 460, 300, 'Cards'), S(3, 760, 100, 'Privacy', { region: 'footer' })];
  const build = [S(0, 0, 60, 'Brand', { region: 'header' }), S(1, 60, 400, 'Hero headline reworded'), S(2, 460, 300, 'Cards'), S(3, 760, 100, 'Privacy', { region: 'footer' })];
  assert.deepEqual(pairSections(live, build).pairs.map((p) => p.how), ['exact', 'order', 'exact', 'exact']);
});

// ---- the offset chain -------------------------------------------------------------------------------------------
await check('sectionTable: the first section whose own height differs is the FIRST CAUSE; the ones below are displaced', () => {
  const live = [S(0, 0, 400, 'Hero'), S(1, 400, 300, 'Cards'), S(2, 700, 200, 'Story'), S(3, 900, 100, 'End')];
  const build = [S(0, 0, 400, 'Hero'), S(1, 400, 324, 'Cards'), S(2, 724, 200, 'Story'), S(3, 924, 100, 'End')];
  const rows = sectionTable(live, build, pairSections(live, build), 2);
  assert.deepEqual(rows.map((r) => r.status), ['ok', 'cause', 'displaced', 'displaced']);
  assert.deepEqual(rows.map((r) => !!r.first), [false, true, false, false]);
  assert.deepEqual(rows.map((r) => [r.dy, r.dh, r.cum, r.step]), [[0, 0, 0, 0], [0, 24, 24, 24], [24, 0, 24, 0], [24, 0, 24, 0]]);
  assert.deepEqual(rows[1].notes, ['own height']);
});
await check('sectionTable: steps each within the tolerance are no cause while their sum stays within the gate\'s prototype offset bound (8 px); past it the first row that adds anything is the FIRST CAUSE', () => {
  const page = (n, grow) => [Array.from({ length: n }, (_, i) => S(i, i * 100, 100, `Band ${i}`)), Array.from({ length: n }, (_, i) => S(i, i * (100 + grow), 100 + grow, `Band ${i}`))];
  const [l5, b5] = page(5, 1);
  assert.equal(sectionTable(l5, b5, pairSections(l5, b5), 2).some((r) => r.first), false, 'five sections each 1 px taller: 5 px in total, within the bound');
  const [l9, b9] = page(9, 1);
  const rows = sectionTable(l9, b9, pairSections(l9, b9), 2);
  assert.equal(rows.filter((r) => r.first).length, 1); assert.equal(rows[0].first, true); assert.equal(rows[0].status, 'cause');
  assert.match(rows[0].notes.join(' '), /accumulated: steps within the 2px tolerance add up to 9px \(bound 8px\)/);
  assert.equal(TOTAL_OFFSET_MAX, 8);
});
await check('scroll and shape: a node that holds its place while the page scrolls, and an image cut to a shape, are deltas — only against a spec that recorded them', () => {
  const t0 = (o) => ({ kind: 'text', tag: 'p', text: 'Seasonal', x: 0, y: 0, w: 200, h: 24, fontFamily: 'Arial', fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0, color: 'rgb(0, 0, 0)', lines: 1, ...o });
  const REC = ['scroll', 'shape'];
  assert.deepEqual(nodeDelta(t0({ scroll: 'sticky 20' }), t0({}), null, null, 2, [], REC).font.scroll, ['sticky 20', 'static'], 'the recorded case: a sticky column authored static passed the comparison and failed the pixels');
  assert.equal(nodeDelta(t0({ scroll: 'sticky 20' }), t0({}), null, null, 2, [], REC).off, true);
  assert.equal(nodeDelta(t0({ scroll: 'sticky 20' }), t0({ scroll: 'sticky 21' }), null, null, 2, [], REC).off, false, 'the top within the tolerance');
  assert.deepEqual(nodeDelta(t0({ scroll: 'sticky 20' }), t0({ scroll: 'sticky 112' }), null, null, 2, [], REC).font.scroll, ['sticky 20', 'sticky 112']);
  assert.deepEqual(nodeDelta(t0({ scroll: 'sticky 20' }), t0({ scroll: 'fixed 20' }), null, null, 2, [], REC).font.scroll, ['sticky 20', 'fixed 20']);
  assert.equal(nodeDelta(t0({}), t0({}), null, null, 2, [], REC).off, false);
  assert.equal(nodeDelta(t0({ scroll: 'sticky 20' }), t0({}), null, null, 2, [], []).off, false, 'a spec from before the field: not compared');
  const im = (shape) => ({ kind: 'image', tag: 'img', text: '', x: 0, y: 0, w: 320, h: 264, fit: 'cover', shape });
  const live = im({ pos: '50% 100%', r: '160px', by: [320, 264] });
  assert.equal(scrollShapeDelta(live, im({ pos: '50% 100%', r: '160.4px', by: [321, 264] }), REC).radius, undefined, 'within 1 px');
  assert.deepEqual(scrollShapeDelta(live, im({ pos: '50% 50%', r: '138.1px', by: [320, 264] }), REC), { 'object-position': ['50% 100%', '50% 50%'], radius: ['160px', '138.1px'] });
  assert.deepEqual(scrollShapeDelta(live, im({ pos: '50% 100%' }), REC).radius, ['160px', 'none']);
  assert.deepEqual(scrollShapeDelta(im({ pos: '50% 50%', clip: 'circle(50%)' }), im({ pos: '50% 50%', mask: true }), REC), { clip: ['circle(50%)', 'none'], mask: ['no', 'yes'] });
  assert.deepEqual(scrollShapeDelta(live, im({ pos: '50% 50%' }), []), {}, 'not recorded: not compared');
  assert.equal(sameLengths('50% 100%', '50% 100%'), true); assert.equal(sameLengths('8px', '8%'), false); assert.equal(sameLengths('8px 4px', '8px'), false);
  assert.equal(extraOf(t0({ scroll: 'sticky 20' })), '  [sticky 20]'); assert.equal(extraOf(t0({})), '');
  assert.equal(extraOf(live), '  [r 160px; cut by 320×264; pos 50% 100%]');
});
await check('parseFontSubstFile + nodeDelta: a declared substitution is not a family delta and its glyph-width difference is bounded at 6 % (min 2 px); undeclared, both are off', () => {
  assert.deepEqual(parseFontSubstFile('# brand faces\n"Brand Sans" = Arimo\n\nbad line\n'), [{ live: 'brand sans', build: 'arimo' }]);
  const t = (o) => ({ kind: 'text', tag: 'p', text: 'Hello world', x: 0, y: 0, w: 200, h: 24, fontFamily: 'Brand Sans', fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0, color: 'rgb(0, 0, 0)', lines: 1, ...o });
  const b = t({ fontFamily: 'Arimo', w: 208 });
  const plain = nodeDelta(t({}), b, null, null, 2);
  assert.equal(plain.off, true); assert.deepEqual(plain.font.family, ['Brand Sans', 'Arimo']);
  const declared = nodeDelta(t({}), b, null, null, 2, [{ live: 'brand sans', build: 'arimo' }]);
  assert.deepEqual([declared.off, declared.font.family, declared.subst], [false, undefined, true]);
  assert.equal(nodeDelta(t({}), t({ fontFamily: 'Arimo', w: 230 }), null, null, 2, [{ live: 'brand sans', build: 'arimo' }]).off, true, '15 % wider is past the bound');
});
await check('sectionTable: a second cause further down is a cause, not the first; a changed gap above a section is a cause too', () => {
  const live = [S(0, 0, 400, 'Hero'), S(1, 400, 300, 'Cards'), S(2, 700, 200, 'Story')];
  const build = [S(0, 0, 395, 'Hero'), S(1, 395, 300, 'Cards'), S(2, 715, 224, 'Story')];
  const rows = sectionTable(live, build, pairSections(live, build), 2);
  assert.deepEqual(rows.map((r) => [r.status, !!r.first, r.cum]), [['cause', true, -5], ['displaced', false, -5], ['cause', false, 39]]);
  assert.deepEqual(rows[2].notes, ['own height', 'gap above +20']); assert.equal(rows[2].step, 44);
});
await check('sectionTable: a missing / extra section is a cause with its height as the step; what follows is displaced, not a gap', () => {
  const live = [S(0, 0, 400, 'Hero'), S(1, 400, 300, 'Cards'), S(2, 700, 200, 'Story')];
  const build = [S(0, 0, 400, 'Hero'), S(1, 400, 200, 'Story'), S(2, 600, 150, 'Promo', { region: 'footer' })];
  const rows = sectionTable(live, build, pairSections(live, build), 2);
  assert.deepEqual(rows.map((r) => [r.status, r.step]), [['ok', 0], ['missing', -300], ['displaced', 0], ['extra', 150]]);
  assert.equal(rows[1].first, true);
});
await check('sectionTable: a section overlaid on the one before it (fixed chrome) is not pushed by that one\'s height', () => {
  const live = [S(0, 0, 80, 'Brand', { region: 'header' }), S(1, 0, 600, 'Hero')];
  const build = [S(0, 0, 90, 'Brand', { region: 'header' }), S(1, 0, 600, 'Hero')];
  assert.deepEqual(sectionTable(live, build, pairSections(live, build), 2).map((r) => r.status), ['cause', 'ok']);
});
await check('sectionTable: padding and background changes are named on the row', () => {
  const live = [S(0, 0, 400, 'Hero', { background: 'rgb(0, 0, 0)' })]; const build = [S(0, 0, 380, 'Hero', { paddingTop: 20, background: 'rgb(1, 1, 1)' })];
  assert.deepEqual(sectionTable(live, build, pairSections(live, build), 2)[0].notes, ['own height', 'padding-top 40→20', 'bg rgb(0, 0, 0)→rgb(1, 1, 1)']);
});

// ---- node deltas, tolerance, verdict ----------------------------------------------------------------------------
await check('nodeDelta: Δy is relative to each side\'s section top; within tolerance is not off; one px over is', () => {
  const ls = S(1, 400, 300, 'x'); const bs = S(1, 424, 300, 'x');
  const d = nodeDelta(T(1, 'Same', 16, 440, 328, 48), T(1, 'Same', 18, 466, 326, 48), ls, bs, 2);
  assert.deepEqual([d.dx, d.dy, d.dw, d.dh, d.off], [2, 2, -2, 0, false]);
  assert.equal(nodeDelta(T(1, 'Same', 16, 440, 328, 48), T(1, 'Same', 19, 464, 328, 48), ls, bs, 2).off, true);
  const dy = nodeDelta(T(1, 'Same', 16, 440, 328, 48), T(1, 'Same', 16, 474, 328, 48), ls, bs, 2);
  assert.deepEqual([dy.dy, dy.onlyDy, dy.off], [10, true, true]);
  assert.equal(nodeDelta(T(1, 'Same', 16, 440, 328, 48), T(1, 'Same', 16, 474, 328, 48), ls, bs, 12).off, false, '--tol widens it');
});
await check('nodeDelta: font size / line-height / weight / family (case-insensitive) / colour / transform / lines are deltas', () => {
  const l = T(0, 'Heading', 0, 0, 300, 62, { fontSize: 56, lineHeight: 61.6, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'uppercase', lines: 1 });
  const d = nodeDelta(l, { ...l, fontSize: 54, lineHeight: 59.4, fontWeight: '600', fontFamily: 'Arial', color: 'rgb(0, 0, 0)', textTransform: 'none', lines: 2 }, null, null, 2);
  assert.deepEqual(d.font, { size: [56, 54], 'line-height': [61.6, 59.4], weight: ['700', '600'], family: ['Georgia', 'Arial'], colour: ['rgb(34, 34, 34)', 'rgb(0, 0, 0)'], transform: ['uppercase', 'none'] });
  assert.deepEqual(d.lines, [1, 2]); assert.equal(d.off, true); assert.equal(d.onlyDy, false);
  assert.equal(nodeDelta(l, { ...l, fontFamily: 'georgia', fontSize: 56.3 }, null, null, 2).off, false, 'family case and a sub-0.5 px size are not deltas');
  assert.deepEqual(nodeDelta(I(0, 'a.jpg', 0, 0, 9, 9), I(0, 'a.jpg', 0, 0, 9, 9, { fit: 'contain' }), null, null, 2).font, { fit: ['cover', 'contain'] });
});
const liveSpec = () => spec(
  [S(0, 0, 400, 'Hero title'), S(1, 400, 300, 'Card one title'), S(2, 700, 200, 'Story heading')],
  [T(0, 'Hero title', 16, 40, 328, 70, { tag: 'h1', role: 'h1', fontSize: 32, lineHeight: 35.2, lines: 2 }), T(0, 'Hero paragraph of text', 16, 134, 328, 48), T(0, 'Get started', 16, 214, 140, 44, { kind: 'control', tag: 'a', role: 'link', href: '/start' }),
    I(1, 'one.jpg', 16, 440, 328, 200), T(1, 'Card one title', 32, 656, 296, 28, { tag: 'h3', role: 'h3' }),
    T(2, 'Story heading', 16, 740, 328, 32, { tag: 'h2', role: 'h2' }), T(2, 'A long paragraph that wraps over lines', 16, 792, 328, 48), T(2, 'Closing paragraph', 16, 856, 328, 24)],
);
await check('compareSpecs: identical sides pass — 0 sections, 0 offset, 0 off, nothing missing or extra', () => {
  const r = compareSpecs(liveSpec(), clone(liveSpec()));
  assert.equal(r.pass, true); assert.equal(r.verdict, 'source-spec: 0 section(s) with a height delta, total offset 0px, 0 node(s) off, 0 missing, 0 extra');
  assert.deepEqual(r.counts, { sections: 0, totalOffset: 0, off: 0, displaced: 0, missing: 0, extra: 0, paired: 8 });
});
await check('compareSpecs: a paragraph with an extra line is the one node off; nodes below it are displaced, sections below it too', () => {
  const b = clone(liveSpec());
  b.nodes[6].h = 72; b.nodes[6].lines = 3; b.nodes[7].y += 24; b.sections[2].h = 224; b.page.docHeight += 24;
  const r = compareSpecs(liveSpec(), b);
  assert.equal(r.pass, false);
  assert.equal(r.verdict, 'source-spec: 1 section(s) with a height delta, total offset 24px, 1 node(s) off, 0 missing, 0 extra');
  assert.deepEqual(r.nodes.filter((d) => d.status !== 'ok').map((d) => [d.live.text, d.status]), [['A long paragraph that wraps over lines', 'off'], ['Closing paragraph', 'displaced']]);
  const text = formatCompare(r, { specPath: 's.json', buildUrl: 'http://b/' });
  assert.match(text, /^ {2}2 main\s+700\s+200 \|\s+700\s+224 \|\s+0\s+\+24\s+\+24 {2}◄ FIRST CAUSE: own height/m);
  assert.match(text, /section 2 — 1 node\(s\) off, 1 below displaced by them \(Δy only\)/);
  assert.match(text, /"A long paragraph that wraps over lines"\s+\| Δx 0 Δy 0 Δw 0 Δh \+24 \| lines 2→3 ◄ wrap/);
  assert.match(text, /the line count changed — the usual cause of a height delta/);
  assert.equal(text.includes('Closing paragraph'), false, 'a displaced node is counted, not listed');
  assert.equal(text.trimEnd().split('\n').pop(), r.verdict, 'the verdict is the last line');
});
await check('compareSpecs: a Δy-only node with nothing off above it is itself off (a margin), and the ones below it are displaced', () => {
  const b = clone(liveSpec()); b.nodes[1].y += 10; b.nodes[2].y += 10;
  const r = compareSpecs(liveSpec(), b);
  assert.deepEqual(r.nodes.filter((d) => d.status !== 'ok').map((d) => [d.live.text, d.status, d.dy]), [['Hero paragraph of text', 'off', 10], ['Get started', 'displaced', 10]]);
});
await check('compareSpecs: missing and extra nodes are listed by section; missing fails, and so does an extra alone', () => {
  const b = clone(liveSpec());
  b.nodes.splice(3, 2); b.nodes.push(T(2, 'Read the whole story', 16, 890, 160, 24, { kind: 'control', tag: 'a', role: 'link', href: '/more' }));
  const r = compareSpecs(liveSpec(), b);
  assert.deepEqual(r.missing.map((n) => n.text || n.src), ['Card one title', 'one.jpg']); assert.deepEqual(r.extra.map((n) => n.text), ['Read the whole story']);
  assert.equal(r.pass, false); assert.match(r.verdict, /0 node\(s\) off, 2 missing, 1 extra$/);
  const text = formatCompare(r);
  assert.match(text, /MISSING on the build — in the spec, by live section \(2\)\n {2}section 1 main {3}h3 {5}"Card one title" {2}@ x 32 y 256 \(in section\) 296×28/);
  assert.match(text, /EXTRA on the build — not in the spec, by build section \(1\)\n {2}section 2 main {3}link {3}"Read the whole story"/);
  const onlyExtra = clone(liveSpec()); onlyExtra.nodes.push(T(2, 'Read the whole story', 16, 884, 160, 12, { kind: 'control', tag: 'a', role: 'link' }));
  const e = compareSpecs(liveSpec(), onlyExtra); assert.equal(e.pass, false); assert.match(e.verdict, /0 missing, 1 extra$/);
});
await check('compareSpecs: sub-tolerance steps whose sum stays within the gate\'s prototype offset bound pass — the total is still reported', () => {
  const b = clone(liveSpec()); b.sections[0].h += 2; b.sections[1].y += 2; b.sections[1].h += 2; b.sections[2].y += 4;
  for (const n of b.nodes) n.y += [0, 2, 4][n.section];
  const r = compareSpecs(liveSpec(), b);
  assert.equal(r.counts.sections, 0); assert.equal(r.sections.some((x) => x.first), false);
  assert.equal(r.counts.totalOffset, 4); assert.equal(r.pass, true, '4 px over three sections: each within 2 px, the sum within 8 px');
});

// ---- tokens, brief, view ----------------------------------------------------------------------------------------
await check('compareSpecs: a build header / footer the source spec has no section for is not an EXTRA to clear — left to chrome-parity, and said on the verdict line', () => {
  const live = liveSpec(); const b = clone(live);
  const i = Math.max(...b.sections.map((x) => x.i)) + 1; const last = b.sections[b.sections.length - 1];
  if (live.sections.some((x) => x.region === 'footer')) return; // the fixture has its own footer: nothing to show
  b.sections.push({ ...last, i, region: 'footer', y: last.y + last.h, h: 120, firstText: 'Footer' });
  b.nodes.push({ ...b.nodes[0], section: i, text: 'Footer link', y: last.y + last.h + 10 });
  const r = compareSpecs(live, b);
  assert.deepEqual([r.pass, r.extra.length, r.chromeSkipped], [true, 0, ['footer']]); assert.match(r.verdict, /build footer not compared: the source spec has none/);
});
await check('clusterStyles: distinct size / line-height / weight / family [transform] with counts, most used first, roles and a sample', () => {
  const s = liveSpec(); const c = clusterStyles(s.nodes);
  assert.deepEqual(c.map((x) => [x.key, x.n]), [['16/24 400 Arial', 6], ['32/35.2 400 Arial', 1]]);
  assert.deepEqual(c[0].roles, { p: 3, link: 1, h3: 1, h2: 1 }); assert.equal(c[0].sample, 'Hero paragraph of text');
  assert.equal(clusterStyles([T(0, 'A', 0, 0, 9, 9, { textTransform: 'uppercase' }), T(0, 'B', 0, 0, 9, 9)]).length, 2, 'a transform is its own style');
});
await check('containerOf / tokensOf: gutters from the main-region text, the commonest left edge, colours and font stacks counted', () => {
  const s = liveSpec();
  assert.deepEqual(containerOf(s.nodes, 360), { left: 16, right: 16, content: 328, leftCommon: { x: 16, n: 6 } });
  assert.deepEqual(containerOf([I(0, 'a.jpg', 0, 0, 360, 9)], 360), { left: null, right: null, content: null, leftCommon: null });
  const t = tokensOf(s.nodes, { viewport: 360, stacks: { 'Arial, sans-serif': 6, 'Georgia, serif': 1 }, loadedFaces: [] });
  assert.deepEqual(t.fonts, [{ stack: 'Arial, sans-serif', n: 6 }, { stack: 'Georgia, serif', n: 1 }]); assert.deepEqual(t.colours, [{ color: 'rgb(34, 34, 34)', n: 7 }]);
});
const stored = () => buildSpec({ ...liveSpec(), stacks: { 'Arial, sans-serif': 7 }, loadedFaces: [], truncated: { text: 0, image: 0 } }, { url: 'http://x/', width: 360, main: 'main' });
await check('formatBrief: one screen — page line, section table, text styles, fonts, colours, container; never the node list', () => {
  const text = formatBrief(stored(), { path: 'stardust/replica/spec/home-360.json' });
  assert.match(text, /^source-spec @360 {2}http:\/\/x\//); assert.match(text, /page {2}height 900 {2}viewport 360 {2}root main {2}7 text \+ 1 image nodes/);
  assert.match(text, / {2}1 main\s+400\s+300 {2}40\/40\s+none\s+"Card one title"/); assert.match(text, /text styles \(2\)/); assert.match(text, / {3}6 × 16\/24 400 Arial/);
  assert.match(text, /container {2}left 16 {2}right 16 {2}content 328/); assert.match(text, /view stardust\/replica\/spec\/home-360\.json --section <i>/);
  assert.equal(text.includes('Closing paragraph'), false); assert.ok(text.split('\n').length < 20);
  const t = stored(); t.truncated = { text: 12, image: 0 }; t.page.rootFallback = true; t.page.root = 'body';
  assert.match(formatBrief(t), /truncated: 12 text and 0 image node\(s\) over the cap/); assert.match(formatBrief(t), /--main matched nothing — measured body/);
});
await check('queryNodes / formatNodes: by section, kind and regex; the table is capped and says so; --tsv carries every field uncapped', () => {
  const s = stored();
  assert.deepEqual(queryNodes(s, { section: 1 }).map((n) => n.kind), ['image', 'text']); assert.equal(queryNodes(s, { kind: 'image' }).length, 1);
  assert.deepEqual(queryNodes(s, { grep: 'paragraph' }).map((n) => n.section), [0, 2, 2]); assert.deepEqual(queryNodes(s, { section: 2, grep: '^story' }).map((n) => n.text), ['Story heading']);
  const table = formatNodes(queryNodes(s, { section: 0 }));
  assert.match(table, / {2}0 text {4}h1\/h1\s+16\s+40\s+328\s+70 {2}32\/35\.2 400 Arial rgb\(34,34,34\) 2L\s+"Hero title"/); assert.match(table, /"Get started" {2}→ \/start/); assert.match(table, /3 node\(s\)$/);
  assert.match(formatNodes(s.nodes, { max: 2 }), /2 of 8 node\(s\) — narrow with/);
  const tsv = formatNodes(queryNodes(s, { kind: 'image' }), { tsv: true }).split('\n');
  assert.equal(tsv[0].split('\t')[0], 'section'); assert.equal(tsv[1].split('\t').length, tsv[0].split('\t').length); assert.ok(tsv[1].includes('400×240')); assert.ok(tsv[1].includes('one.jpg'));
});
await check('serialiseSpec: valid JSON, one node per line, round-trips', () => {
  const s = stored(); const text = serialiseSpec(s);
  assert.deepEqual(JSON.parse(text), s);
  assert.equal(text.split('\n').filter((l) => l.startsWith('  {"section"')).length, s.nodes.length);
});

// ---- end-to-end against the local fixtures (needs playwright) ---------------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end capture / compare / view (playwright not importable here; run this test from a project copy that has it)'); }
if (playwrightOk) {
  const { server, base } = await startFixtures();
  const out = mkdtempSync(join(tmpdir(), 'source-spec-e2e-'));
  const run = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: out }); let stdout = ''; let stderr = ''; // capture writes the gate's live cache under ./stardust — never in the caller's directory
    p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const show = (r) => `exit ${r.status}\n${r.stdout}\n${r.stderr}`;
  const specAt = (w) => join(out, `fixture-${w}.json`);
  try {
    await check('e2e capture: one brief per width, a spec file per width, responsive values differ between 1440 and 360', async () => {
      const r = await run(['capture', `${base}/live`, '--slug', 'fixture', '--widths', '1440,360', '--out', out]);
      assert.equal(r.status, 0, show(r)); console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      assert.ok(existsSync(specAt(1440)) && existsSync(specAt(360)));
      const d = JSON.parse(readFileSync(specAt(1440), 'utf8')); const m = JSON.parse(readFileSync(specAt(360), 'utf8'));
      assert.deepEqual(d.sections.map((s) => s.region), ['header', 'main', 'main', 'main', 'footer']); assert.deepEqual(d.sections.map((s) => s.firstText), ['Fixture Brand', 'Measure the source first', 'Three things to know', 'Why the order matters', 'Privacy']);
      assert.equal(d.sections[1].background, 'rgb(11, 37, 69)'); assert.equal(d.sections[1].paddingTop, 96); assert.equal(m.sections[1].paddingTop, 48);
      const h1 = (s) => s.nodes.find((n) => n.role === 'h1');
      assert.equal(h1(d).fontSize, 56); assert.equal(h1(m).fontSize, 32); assert.equal(h1(d).fontFamily, 'Georgia'); assert.equal(h1(d).x, 120); assert.equal(h1(m).x, 16);
      const btn = d.nodes.find((n) => n.text === 'Get started'); assert.equal(btn.kind, 'control'); assert.equal(btn.href, '/start'); assert.equal(btn.textTransform, 'uppercase');
      assert.equal(d.nodes.filter((n) => n.kind === 'image').length, 3); assert.deepEqual(d.nodes.find((n) => n.kind === 'image').natural, [400, 240]);
      assert.equal(d.nodes.some((n) => n.text === 'Products'), true); assert.equal(m.nodes.some((n) => n.text === 'Products'), false, 'the nav is display:none at 360');
      const cardY = (s) => s.nodes.filter((n) => n.role === 'h3').map((n) => n.y);
      assert.equal(new Set(cardY(d)).size, 1, 'cards sit in a row at 1440'); assert.equal(new Set(cardY(m)).size, 3, 'cards stack at 360');
      assert.deepEqual([d.tokens.container.left, d.tokens.container.right], [120, 120]); assert.equal(m.tokens.container.left, 16);
      assert.match(r.stdout, /source-spec @1440/); assert.match(r.stdout, /source-spec @360/); assert.equal(r.stdout.includes('Card title number 2'), false, 'the brief is not the node list');
    });
    await check('e2e (a) identical build: compare exits 0 at both widths', async () => {
      for (const w of [1440, 360]) {
        const r = await run(['compare', specAt(w), `${base}/build-a`]);
        assert.equal(r.status, 0, show(r)); assert.match(r.stdout, /source-spec: 0 section\(s\) with a height delta, total offset 0px, 0 node\(s\) off, 0 missing, 0 extra$/m);
        if (w === 360) console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      }
    });
    await check('e2e (b) heading 2 px smaller + a paragraph with an extra line at 360: exactly those nodes, the first cause, the chain below', async () => {
      const json = join(out, 'b-360.json');
      const r = await run(['compare', specAt(360), `${base}/build-b`, '--json', json]);
      assert.equal(r.status, 2, show(r)); console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      const res = JSON.parse(readFileSync(json, 'utf8'));
      assert.deepEqual(res.nodes.filter((d) => d.status === 'off').map((d) => d.live.text.slice(0, 24)), ['Measure the source first', 'Every measurement on thi']);
      const [h1, p] = res.nodes.filter((d) => d.status === 'off');
      assert.deepEqual(h1.font.size, [32, 30]); assert.ok(p.lines[1] > p.lines[0]); assert.equal(p.dh, 24 * (p.lines[1] - p.lines[0])); assert.deepEqual(p.font, {});
      assert.deepEqual(res.sections.map((s) => s.status), ['ok', 'cause', 'displaced', 'cause', 'displaced']); assert.equal(res.sections[1].first, true);
      assert.equal(res.sections[4].cum, res.sections[3].cum, 'the footer carries the offset of the last cause'); assert.equal(res.counts.missing, 0); assert.equal(res.counts.extra, 0);
      assert.match(r.stdout, /◄ FIRST CAUSE: own height/); assert.match(r.stdout, /lines \d→\d ◄ wrap/); assert.match(r.stdout, /size 32→30/);
      const d = await run(['compare', specAt(1440), `${base}/build-b`]);
      assert.equal(d.status, 2, show(d)); console.log(d.stdout.trimEnd().replace(/^/gm, '    '));
      assert.match(d.stdout, /size 56→54/); assert.match(d.stdout, /, 1 node\(s\) off, 0 missing, 0 extra$/m);
    });
    await check('e2e (c) a card missing + an extra link: reported as missing / extra, by section', async () => {
      const r = await run(['compare', specAt(1440), `${base}/build-c`]);
      assert.equal(r.status, 2, show(r)); console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      assert.match(r.stdout, /MISSING on the build — in the spec, by live section \(3\)/); assert.match(r.stdout, /section 2 main {3}h3 {5}"Card title number 3"/); assert.match(r.stdout, /\[img\] Card 3 picture/);
      assert.match(r.stdout, /EXTRA on the build — not in the spec, by build section \(1\)\n {2}section 3 main {3}link {3}"Read the whole story"/); assert.match(r.stdout, /3 missing, 1 extra$/m);
    });
    await check('e2e (d) the same boxes at rest, but a sticky heading authored static and another image radius: both are named, exit 2', async () => {
      const r = await run(['compare', specAt(1440), `${base}/build-d`]);
      assert.equal(r.status, 2, show(r)); console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      assert.match(r.stdout, /scroll sticky 20→static/); assert.match(r.stdout, /radius 24px→8px/);
      assert.match(r.stdout, /0 section\(s\) with a height delta, total offset 0px, 4 node\(s\) off, 0 missing, 0 extra/);
      const brief = await run(['view', specAt(1440)]);
      assert.match(brief.stdout, /^scroll {3}1 node\(s\) in the main region sit in a sticky \/ fixed box \(section \d+: sticky 20\)/m); assert.match(brief.stdout, /^shapes {3}3 image\(s\) are cut/m);
    });
    await check('e2e view: --section prints that section\'s nodes; --kind + --tsv feed a command; no flag is the brief', async () => {
      const r = await run(['view', specAt(360), '--section', '1']);
      assert.equal(r.status, 0, show(r)); console.log(r.stdout.trimEnd().replace(/^/gm, '    '));
      assert.match(r.stdout, /^section 1 main section\.hero {2}y 56 h \d+ {2}padding 48\/48 {2}bg rgb\(11, 37, 69\)/); assert.match(r.stdout, /3 node\(s\)$/m);
      const t = await run(['view', specAt(1440), '--kind', 'image', '--tsv']); assert.equal(t.stdout.trim().split('\n').length, 4);
      const b = await run(['view', specAt(1440)]); assert.match(b.stdout, /text styles \(/);
      const bad = await run(['view', specAt(1440), '--section', '9']); assert.equal(bad.status, 125);
    });
    await check('e2e: a build URL that answers 404 is an error (exit 1), not a comparison', async () => {
      const r = await run(['compare', specAt(360), `${base}/nope`]); assert.equal(r.status, 1, show(r));
    });
  } finally { server.close(); rmSync(out, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
