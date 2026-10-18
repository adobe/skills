#!/usr/bin/env node
// skills/diff/scripts/test/dom-probe.test.mjs — the dom-probe.mjs contract (the structural / geometry probe).
// Part (a), no browser: parseArgs (every flag, --json's optional .json value, the usage errors), toTarget (relative
// and absolute paths, file:// and http(s) URLs), the signature, the run collapse, the skeleton lines and their cut,
// the box / skeleton / outline formatting, the box deltas, the skeleton and outline comparisons, the in-page
// collector run in an isolated vm context (it must reference nothing outside itself), HELP = the header comment,
// and the CLI's --help / usage errors / missing files with any playwright import refused. Part (b), where playwright
// is importable: two fixture files with fixed CSS geometry (a 1000-px main, a 200-px header, three 300 × 200 cards
// in a flex row, a custom element with an open shadow root; B moves the cards 40 px down and renames one heading) —
// the boxes, the ×3 collapse, the #shadow line, the outline, the comparison (Δy +40, the renamed heading), --json,
// 0 matches, an invalid selector, the --max-nodes cut; and the same page over http from this process (the
// live-session path) plus an edge-signed 403 (exit 3). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import {
  HELP, UsageError, collapseRuns, collectInPage, compareBoxes, compareOutline, compareSkeleton, formatBox, formatDelta,
  formatOutline, formatOutlineDiff, formatSkeleton, formatSkeletonDiff, parseArgs, signature, skeletonLines, toTarget,
} from '../dom-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'dom-probe.mjs');
let failed = 0; let checks = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const usage = (args, re) => assert.throws(() => parseArgs(args, '/work'), (e) => e instanceof UsageError && re.test(e.message), `${args.join(' ')} → usage error ${re}`);
// Refuses any playwright import in the spawned CLI: --help and the usage errors must answer without it.
const NO_PLAYWRIGHT = `data:text/javascript,${encodeURIComponent("import * as m from 'node:module'; if (typeof m.registerHooks === 'function') m.registerHooks({ resolve(s, c, n) { if (/^playwright(\\/|$)/.test(s)) throw new Error('playwright imported'); return n(s, c); } });")}`;
const cli = (args) => spawnSync(process.execPath, ['--import', NO_PLAYWRIGHT, SCRIPT, ...args], { cwd: HERE, encoding: 'utf8' });
const runAsync = (args) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd: HERE }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });
// A collected tree node, as collectInPage returns it.
const nd = (tag, { id = '', cls = [], box = [0, 0, 0, 0], display = 'block', position = 'static', kids, shadow } = {}) => ({ tag, id, cls, x: box[0], y: box[1], w: box[2], h: box[3], display, position, ...(shadow ? { shadow: true } : {}), ...(kids ? { kids } : {}) });
// A skeleton line, as skeletonLines returns it.
const ln = (depth, sig, [x, y, w, h], extra = {}) => ({ depth, sig, n: 1, x, y, w, h, display: 'block', position: 'static', ...extra });
const hd = (level, text, y = 0) => ({ kind: `h${level}`, level, text, y, visible: true });

// ---- (a) pure -----------------------------------------------------------------------------------------

await check('parseArgs: defaults for a bare <url>', () => {
  assert.deepEqual(parseArgs(['https://www.example.com/']), {
    input: 'https://www.example.com/', target: { kind: 'http', url: 'https://www.example.com/' }, selectors: ['body'], width: 1440, depth: 4,
    maxNodes: 400, json: false, jsonFile: null, compare: null, compareTarget: null, locale: null, navTimeout: 60000, headed: false, help: false,
  });
});
await check('parseArgs: every flag; --selector repeats, is taken whole (a comma stays) and duplicates drop', () => {
  const o = parseArgs(['a.html', '--selector', 'main', '--selector', 'h1, h2', '--selector', 'main', '--width', '390', '--depth', '0', '--max-nodes', '50',
    '--json', 'out/probe.json', '--compare', 'https://www.example.com/x', '--locale', 'de-CH', '--nav-timeout', '90000', '--headed'], '/work');
  assert.deepEqual(o.target, { kind: 'file', url: 'file:///work/a.html', path: '/work/a.html' });
  assert.deepEqual(o.selectors, ['main', 'h1, h2']);
  assert.equal(o.width, 390); assert.equal(o.depth, 0); assert.equal(o.maxNodes, 50);
  assert.equal(o.json, true); assert.equal(o.jsonFile, 'out/probe.json');
  assert.equal(o.compare, 'https://www.example.com/x'); assert.deepEqual(o.compareTarget, { kind: 'http', url: 'https://www.example.com/x' });
  assert.equal(o.locale, 'de-CH'); assert.equal(o.navTimeout, 90000); assert.equal(o.headed, true); assert.equal(o.help, false);
});
await check('parseArgs: --json takes a following .json path only — otherwise it is bare (stdout) and the argument stays', () => {
  assert.deepEqual([parseArgs(['a.html', '--json'], '/w').json, parseArgs(['a.html', '--json'], '/w').jsonFile], [true, null]);
  const o = parseArgs(['--json', 'a.html'], '/w');
  assert.equal(o.input, 'a.html'); assert.equal(o.jsonFile, null);
  assert.equal(parseArgs(['a.html', '--json', '--depth', '2'], '/w').depth, 2);
  assert.equal(parseArgs(['--help']).help, true); assert.equal(parseArgs(['-h', '--depth']).help, true);
});
await check('parseArgs usage errors: no input, a value flag without its value or followed by a flag, bad numbers, two inputs, repeats, unknowns, other schemes', () => {
  usage([], /need <url\|file>/);
  usage(['--depth', '2'], /need <url\|file>/);
  usage(['a.html', '--selector'], /--selector needs a value$/);
  usage(['a.html', '--selector', '--depth', '2'], /--selector needs a value \(got --depth, which is a flag\)/);
  usage(['a.html', '--compare'], /--compare needs a value/);
  usage(['a.html', '--selector', '  '], /--selector needs a non-empty selector/);
  for (const w of ['abc', '0', '12.5', '20000']) usage(['a.html', '--width', w], /--width must be a whole number/);
  usage(['a.html', '--depth', '-1'], /--depth must be a whole number from 0 to 64/);
  usage(['a.html', '--max-nodes', '0'], /--max-nodes must be a whole number/);
  usage(['a.html', '--nav-timeout', 'soon'], /--nav-timeout must be a whole number/);
  usage(['a.html', 'b.html'], /unexpected argument "b\.html" — one <url\|file> per probe; compare two with --compare/);
  usage(['a.html', '--depth', '2', '--depth', '3'], /--depth given more than once/);
  usage(['a.html', '--wait'], /unknown option --wait/);
  usage(['javascript:alert(1)'], /an http\(s\) URL, a file path or a file:\/\/ URL/);
  usage(['a.html', '--compare', 'ftp://host/b.html'], /an http\(s\) URL, a file path or a file:\/\/ URL/);
});
await check('toTarget: a relative path (against the cwd), an absolute path, a file:// URL, an https URL', () => {
  assert.deepEqual(toTarget('fixtures/a.html', '/work'), { kind: 'file', url: 'file:///work/fixtures/a.html', path: '/work/fixtures/a.html' });
  assert.deepEqual(toTarget('/srv/pages/b.html', '/work'), { kind: 'file', url: 'file:///srv/pages/b.html', path: '/srv/pages/b.html' });
  assert.deepEqual(toTarget('file:///srv/pages/my%20page.html'), { kind: 'file', url: 'file:///srv/pages/my%20page.html', path: '/srv/pages/my page.html' });
  assert.deepEqual(toTarget('https://www.example.com/a?b=1'), { kind: 'http', url: 'https://www.example.com/a?b=1' });
  assert.deepEqual(toTarget('http://127.0.0.1:3000'), { kind: 'http', url: 'http://127.0.0.1:3000/' });
  assert.equal(toTarget('my page.html', '/work').url, 'file:///work/my%20page.html');
  assert.throws(() => toTarget('data:text/html,x'), UsageError);
});
await check('signature: tag#id.classes in document order, at most 3 classes then …', () => {
  assert.equal(signature(nd('div')), 'div');
  assert.equal(signature(nd('div', { id: 'hero', cls: ['b', 'a'] })), 'div#hero.b.a');
  assert.equal(signature(nd('li', { cls: ['one', 'two', 'three'] })), 'li.one.two.three');
  assert.equal(signature(nd('li', { cls: ['one', 'two', 'three', 'four'] })), 'li.one.two.three…');
});
await check('collapseRuns: 3 consecutive same-signature siblings → one ×3 item with the first one\'s box and subtree; 2 stay 2; a different sibling breaks a run', () => {
  const card = (x, kids) => nd('div', { cls: ['card'], box: [x, 200, 300, 200], kids });
  const out = collapseRuns([nd('h2'), card(220, [nd('h2', { box: [220, 200, 300, 28] })]), card(570), card(920), nd('p')]);
  assert.deepEqual(out.map((k) => [signature(k), k.n, k.x]), [['h2', 1, 0], ['div.card', 3, 220], ['p', 1, 0]]);
  assert.equal(out[1].kids.length, 1, 'the first one\'s subtree stands for the run');
  assert.deepEqual(collapseRuns([card(0), card(1)]).map((k) => k.n), [1, 1]);
  assert.deepEqual(collapseRuns([card(0), card(1), nd('hr'), card(2), card(3), card(4)]).map((k) => [signature(k), k.n]), [['div.card', 1], ['div.card', 1], ['hr', 1], ['div.card', 3]]);
});

const TREE = nd('main', { cls: ['layout'], box: [220, 0, 1000, 440], kids: [
  nd('header', { cls: ['top'], box: [220, 0, 1000, 200], kids: [nd('h1', { box: [220, 0, 1000, 40] })] }),
  nd('div', { cls: ['cards'], box: [220, 200, 1000, 200], display: 'flex', kids: [
    nd('div', { cls: ['card'], box: [220, 200, 300, 200], kids: [nd('h2', { box: [220, 200, 300, 28] })] }),
    nd('div', { cls: ['card'], box: [570, 200, 300, 200], kids: [nd('h2', { box: [570, 200, 300, 28] })] }),
    nd('div', { cls: ['card'], box: [920, 200, 300, 200], kids: [nd('h2', { box: [920, 200, 300, 28] })] }),
  ] }),
  nd('span', { box: [220, 400, 40, 20], display: 'inline', position: 'relative' }),
  nd('ul', { box: [220, 420, 1000, 20], kids: [nd('li', { box: [220, 420, 1000, 20], display: 'list-item' })] }),
  nd('div', { cls: ['overlay'], display: 'none', position: 'fixed' }),
  nd('x-note', { cls: ['note'], box: [220, 440, 1000, 40], kids: [nd('span', { cls: ['inner'], box: [220, 441, 34, 18], display: 'inline', shadow: true })] }),
] });

await check('skeletonLines + formatSkeleton: 2 spaces per level, ×N runs, display only when unusual, position only when absolute / fixed / sticky, #shadow', () => {
  assert.deepEqual(formatSkeleton(skeletonLines(TREE, 400)), [
    'main.layout 1000×440 @220,0',
    '  header.top 1000×200 @220,0',
    '    h1 1000×40 @220,0',
    '  div.cards 1000×200 @220,200 flex',
    '    ×3 div.card 300×200 @220,200',
    '      h2 300×28 @220,200',
    '  span 40×20 @220,400',
    '  ul 1000×20 @220,420',
    '    li 1000×20 @220,420',
    '  div.overlay 0×0 @0,0 none fixed',
    '  x-note.note 1000×40 @220,440 block',
    '    span.inner 34×18 @220,441 #shadow',
  ]);
});
await check('skeletonLines: the --max-nodes cut ends "… <k> more" (k = lines past the cap + elements past the walk cap); formatSkeleton takes an indent', () => {
  const sk = skeletonLines(TREE, 3);
  assert.equal(sk.lines.length, 3); assert.equal(sk.more, 9);
  assert.deepEqual(formatSkeleton(sk, '    '), ['    main.layout 1000×440 @220,0', '      header.top 1000×200 @220,0', '        h1 1000×40 @220,0', '    … 9 more']);
  assert.equal(skeletonLines(TREE, 400, 5).more, 5, 'elements the in-page walk cap left out');
  assert.equal(skeletonLines(nd('p'), 400).lines[0].n, 1);
});
await check('formatBox: x,y w×h · display · position · visible|hidden', () => {
  assert.equal(formatBox({ x: 220, y: 0, w: 1000, h: 440, display: 'block', position: 'static', visible: true }), '220,0 1000×440 · block · static · visible');
  assert.equal(formatBox({ x: 0, y: 0, w: 0, h: 0, display: 'none', position: 'fixed', visible: false }), '0,0 0×0 · none · fixed · hidden');
});
await check('formatOutline: headings, [landmarks], (hidden), the cut', () => {
  assert.deepEqual(formatOutline({ entries: [{ kind: 'main', text: 'Fixture main', y: 0, visible: true }, hd(1, 'Fixture page'),
    { kind: 'role=navigation', text: 'Say "hi"', y: 12, visible: false }], more: 2 }),
  ['[main] "Fixture main" y=0', 'h1 "Fixture page" y=0', '[role=navigation] "Say \\"hi\\"" y=12 (hidden)', '… 2 more']);
  assert.deepEqual(formatOutline({ entries: [], more: 0 }), []);
});
await check('compareBoxes / formatDelta: B minus A, signed; nonZero keeps only the components that moved', () => {
  const d = compareBoxes({ x: 220, y: 200, w: 300, h: 200 }, { x: 218, y: 240, w: 310, h: 200 });
  assert.deepEqual(d, { dx: -2, dy: 40, dw: 10, dh: 0 });
  assert.equal(formatDelta(d), 'Δx -2 Δy +40 Δw +10 Δh 0');
  assert.equal(formatDelta(d, true), 'Δx -2 Δy +40 Δw +10');
});
await check('compareSkeleton: keyed by signature path below the root — only A, only B, a move above 2 px; ≤ 2 px is the same', () => {
  const a = [ln(0, 'main.layout', [220, 0, 1000, 440]), ln(1, 'header.top', [220, 0, 1000, 200]), ln(1, 'div.cards', [220, 200, 1000, 200]),
    ln(2, 'div.card', [220, 200, 300, 200], { n: 3 }), ln(1, 'aside.promo', [220, 400, 1000, 40])];
  const b = [ln(0, 'main.layout', [220, 0, 1000, 480]), ln(1, 'header.top', [222, 0, 1000, 200]), ln(1, 'div.cards', [220, 240, 1000, 200]),
    ln(2, 'div.card', [220, 240, 300, 200], { n: 3 }), ln(1, 'footer.end', [220, 440, 1000, 40])];
  const c = compareSkeleton(a, b);
  assert.deepEqual([c.total, c.onlyA, c.onlyB, c.changed], [5, 1, 1, 3]);
  assert.deepEqual(c.diffs.map(formatSkeletonDiff), [
    'Δ (root): Δh +40',
    'Δ div.cards: Δy +40',
    'Δ div.cards > div.card: Δy +40',
    'only A: aside.promo 1000×40 @220,400',
    'only B: footer.end 1000×40 @220,440',
  ]);
  const cut = compareSkeleton(a, b, { limit: 2 });
  assert.equal(cut.total, 5); assert.equal(cut.diffs.length, 2);
});
await check('compareSkeleton: a run length, display, position or root signature change is a difference; a repeated path is numbered', () => {
  const root = (sig = 'main') => ln(0, sig, [0, 0, 100, 100]);
  assert.deepEqual(compareSkeleton([root(), ln(1, 'ul', [0, 0, 100, 50]), ln(2, 'li', [0, 0, 100, 10], { n: 3 })], [root(), ln(1, 'ul', [0, 0, 100, 50], { display: 'grid' }), ln(2, 'li', [0, 0, 100, 10], { n: 4 })]).diffs.map(formatSkeletonDiff),
    ['Δ ul: display block→grid', 'Δ ul > li: ×3→×4']);
  assert.deepEqual(compareSkeleton([root(), ln(1, 'nav', [0, 0, 10, 10])], [root('main.v2'), ln(1, 'nav', [0, 0, 10, 10], { position: 'sticky' })]).diffs.map(formatSkeletonDiff),
    ['Δ (root): main→main.v2', 'Δ nav: position static→sticky']);
  assert.deepEqual(compareSkeleton([root(), ln(1, 'p', [0, 0, 10, 10]), ln(1, 'p', [0, 10, 10, 10])], [root(), ln(1, 'p', [0, 0, 10, 10])]).diffs.map(formatSkeletonDiff),
    ['only A: p [2] 10×10 @0,10']);
});
await check('compareOutline: a renamed heading is one text change; level changes, added and removed headings; landmarks are not compared', () => {
  const land = { kind: 'main', text: 'Fixture main', y: 0, visible: true };
  assert.deepEqual(compareOutline([land, hd(1, 'Fixture page'), hd(2, 'Card one', 200), hd(2, 'Card two', 200), hd(2, 'Card three', 200)],
    [{ ...land, text: 'Other' }, hd(1, 'Fixture page'), hd(2, 'Card one', 240), hd(2, 'Card 2', 240), hd(2, 'Card three', 240)]).map(formatOutlineDiff),
  ['text h2 "Card two" → "Card 2"']);
  assert.deepEqual(compareOutline([hd(1, 'Title'), hd(2, 'Intro'), hd(2, 'Old')], [hd(1, 'Title'), hd(3, 'Intro'), hd(2, 'New'), hd(2, 'Extra', 90)]).map(formatOutlineDiff),
    ['level "Intro" h2 → h3', 'text h2 "Old" → "New"', 'added h2 "Extra" y=90']);
  assert.deepEqual(compareOutline([hd(1, 'A'), hd(2, 'B', 30)], [hd(1, 'A')]).map(formatOutlineDiff), ['removed h2 "B" y=30']);
  assert.deepEqual(compareOutline([hd(2, 'X')], [hd(3, 'Y')]).map(formatOutlineDiff), ['text h2→h3 "X" → "Y"']);
});
await check('collectInPage runs in an isolated context (nothing from outside itself): page-absolute boxes, the walk cap, 0 matches, an invalid selector', () => {
  const el = (localName, { cls = [], rect = [0, 0, 0, 0], kids = [], style = {} } = {}) => ({
    localName, id: '', classList: cls, children: kids, shadowRoot: null, innerText: '', textContent: '', getAttribute: () => null,
    getBoundingClientRect: () => ({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] }), matches: () => false, querySelectorAll: () => [],
    style: { display: 'block', position: 'static', visibility: 'visible', ...style },
  });
  const root = el('section', { cls: ['hero'], rect: [10, 20, 300, 200], kids: [el('p', { rect: [10, 20, 100, 30] }), el('script'), el('svg', { kids: [el('path')] })] });
  const sandbox = { window: { scrollX: 5, scrollY: 100 }, getComputedStyle: (e) => e.style, document: {
    getElementById: () => null,
    querySelectorAll: (sel) => { if (sel === '[[') throw new Error("'[[' is not a valid selector"); return sel === 'section' ? [root] : []; },
  } };
  const fn = vm.runInNewContext(`(${collectInPage.toString()})`, sandbox);
  const run = (walkCap) => JSON.parse(JSON.stringify(fn({ selectors: ['section', '.none', '[['], depth: 4, maxMatches: 20, walkCap, outlineCap: 200, textMax: 80 })));
  const [hit, none, bad] = run(20000);
  assert.deepEqual(hit.matches[0].box, { x: 15, y: 120, w: 300, h: 200, display: 'block', position: 'static', visible: true });
  assert.deepEqual(hit.matches[0].tree.kids.map((k) => [k.tag, k.x, k.y, k.kids]), [['p', 15, 120, []], ['svg', 5, 100, undefined]], 'script skipped, nothing inside an svg walked');
  assert.equal(hit.matches[0].omitted, 0);
  assert.deepEqual([none.count, none.matches], [0, []]);
  assert.match(bad.error, /not a valid selector/);
  const capped = run(1)[0].matches[0];
  assert.deepEqual([capped.tree.kids.length, capped.omitted], [1, 1]);
});
await check('HELP is the header comment; it names every flag, the output, the JSON shape, the exit codes and what to measure with', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf('/**');
  const block = src.slice(start, src.indexOf('*/', start));
  const header = block.split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n').trimEnd();
  assert.equal(header, HELP);
  for (const f of ['--selector', '--width', '--depth', '--max-nodes', '--json', '--compare', '--locale', '--nav-timeout', '--headed', '--help']) assert.ok(HELP.includes(f), f);
  for (const s of ['Usage: node dom-probe.mjs <url|file>', 'JSON', 'Exit codes', '0 matches', '3 bot challenge', 'a recorded hands-off run', 'never with a pixel library on a screenshot', 'replica/measure.mjs', 'never for gating']) assert.ok(HELP.includes(s), s);
});
await check('CLI: --help exits 0 with the usage and imports no playwright', () => {
  const r = cli(['--help']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^Usage: node dom-probe\.mjs <url\|file>/m);
  assert.equal(r.stdout.trim(), HELP); assert.equal(r.stderr, '');
});
await check('CLI: a usage error and a missing file exit 2 before any browser, nothing on stdout', () => {
  const u = cli(['fixtures/dom-probe/a.html', '--depth']);
  assert.equal(u.status, 2); assert.match(u.stderr, /dom-probe: --depth needs a value \(--help for usage\)/); assert.equal(u.stdout, '');
  const m = cli(['fixtures/dom-probe/missing.html']);
  assert.equal(m.status, 2); assert.match(m.stderr, /no such file: .*fixtures\/dom-probe\/missing\.html/); assert.equal(m.stdout, '');
  const c = cli(['fixtures/dom-probe/a.html', '--compare', 'fixtures/dom-probe/missing.html']);
  assert.equal(c.status, 2); assert.match(c.stderr, /no such file: .*missing\.html/);
  const h = cli(['www.example.com/page']);
  assert.equal(h.status, 2); assert.match(h.stderr, /no such file: .*www\.example\.com\/page \(an http\(s\) URL needs its scheme\)/);
});

// ---- (b) end to end -----------------------------------------------------------------------------------

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) { console.log('skip  end-to-end (playwright not importable here)'); }
else {
  const A = 'fixtures/dom-probe/a.html';
  const B = 'fixtures/dom-probe/b.html';
  const urlOf = (rel) => pathToFileURL(join(realpathSync(HERE), rel)).href;
  const SHADOW = /^ {8}span\.inner \d+×\d+ @220,4\d\d #shadow$/;
  const body = (shadowLine) => [
    'selector main: 1 match',
    '[1] main.layout box 220,0 1000×440 · block · static · visible',
    '  skeleton:',
    '    main.layout 1000×440 @220,0',
    '      header.top 1000×200 @220,0',
    '        h1 1000×40 @220,0',
    '      div.cards 1000×200 @220,200 flex',
    '        ×3 div.card 300×200 @220,200',
    '          h2 300×28 @220,200',
    '      x-note.note 1000×40 @220,400 block',
    shadowLine,
    '  outline:',
    '    [main] "Fixture main" y=0',
    '    [header] "Fixture page" y=0',
    '    h1 "Fixture page" y=0',
    '    h2 "Card one" y=200',
    '    h2 "Card two" y=200',
    '    h2 "Card three" y=200',
  ];
  const OUT = join(HERE, '.dom-probe-e2e-out');
  const PAGE = readFileSync(join(HERE, A), 'utf8');
  const server = createServer((req, res) => {
    if (req.url === '/blocked') { res.writeHead(403, { 'content-type': 'text/html', server: 'AkamaiGHost' }); res.end('<h1>Access Denied</h1>'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await check('e2e file: the root box, the skeleton (×3 collapse, flex, block custom element, #shadow) and the outline', async () => {
      const r = await runAsync([A, '--selector', 'main']);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trimEnd().split('\n');
      assert.equal(lines[0], `dom-probe ${urlOf(A)} @1440px · file`);
      assert.match(lines[11], SHADOW);
      assert.deepEqual(lines.slice(1), body(lines[11]));
    });
    await check('e2e --compare: Δh +40 on the root, Δy +40 on the moved cards, the renamed heading; exit 0', async () => {
      const r = await runAsync([A, '--selector', 'main', '--compare', B]);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.trimEnd().split('\n'), [
        'dom-probe compare @1440px · depth 4',
        `A = ${urlOf(A)} · file`,
        `B = ${urlOf(B)} · file`,
        'selector main: A 1 match · B 1 match',
        '[1] Δx 0 Δy 0 Δw 0 Δh +40 · A 220,0 1000×440 · B 220,0 1000×480',
        '  skeleton: 6 differences (only A 0 · only B 0 · changed 6)',
        '    Δ (root): Δh +40',
        '    Δ div.cards: Δy +40',
        '    Δ div.cards > div.card: Δy +40',
        '    Δ div.cards > div.card > h2: Δy +40',
        '    Δ x-note.note: Δy +40',
        '    Δ x-note.note > span.inner: Δy +40',
        '  outline: 1 difference',
        '    text h2 "Card two" → "Card 2"',
      ]);
    });
    await check('e2e --json (stdout) with --compare: both documents and the comparison', async () => {
      const r = await runAsync([A, '--selector', 'main', '--compare', B, '--json']);
      assert.equal(r.code, 0, r.err);
      const j = JSON.parse(r.out);
      assert.deepEqual([j.tool, j.width, j.depth, j.maxNodes, j.a.kind, j.a.url, j.b.url], ['dom-probe', 1440, 4, 400, 'file', urlOf(A), urlOf(B)]);
      const run = (doc) => doc.roots[0].matches[0].skeleton.lines.find((l) => l.n === 3);
      assert.deepEqual([run(j.a).sig, run(j.a).x, run(j.a).y, run(j.a).w, run(j.a).h, run(j.b).y], ['div.card', 220, 200, 300, 200, 240]);
      assert.deepEqual(j.a.roots[0].matches[0].box, { x: 220, y: 0, w: 1000, h: 440, display: 'block', position: 'static', visible: true });
      const pair = j.compare[0].pairs[0];
      assert.deepEqual([j.compare[0].countA, j.compare[0].countB, pair.delta], [1, 1, { dx: 0, dy: 0, dw: 0, dh: 40 }]);
      assert.deepEqual([pair.skeleton.total, pair.outline.total, pair.outline.diffs[0].type], [6, 1, 'text']);
    });
    await check('e2e --json <file>: the text still prints, the file holds the JSON, stdout names it', async () => {
      const file = join(OUT, 'probe.json');
      const r = await runAsync([A, '--selector', '.cards', '--depth', '1', '--json', file]);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trimEnd().split('\n');
      assert.equal(lines.at(-1), `json: ${file}`);
      assert.ok(lines.includes('      ×3 div.card 300×200 @220,200'), lines.join('\n'));
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).a.roots[0].selector, '.cards');
    });
    await check('e2e: a selector matching nothing prints 0 matches and exits 0; an invalid one prints its error and exits 1', async () => {
      const r = await runAsync([A, '--selector', '.nope']);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.trimEnd().split('\n'), [`dom-probe ${urlOf(A)} @1440px · file`, 'selector .nope: 0 matches']);
      const bad = await runAsync([A, '--selector', '[[[', '--selector', 'h1']);
      assert.equal(bad.code, 1);
      assert.match(bad.out, /^selector \[\[\[: error .+$/m); assert.match(bad.out, /^selector h1: 1 match$/m);
      assert.match(bad.err, /dom-probe error: invalid selector \[\[\[/);
    });
    await check('e2e: --depth 1 --max-nodes 2 cuts the skeleton with "… 2 more"; every h2 match is listed with its box', async () => {
      const r = await runAsync([A, '--selector', 'main', '--depth', '1', '--max-nodes', '2']);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(r.out.split('\n').slice(4, 7), ['    main.layout 1000×440 @220,0', '      header.top 1000×200 @220,0', '    … 2 more']);
      const h = await runAsync([A, '--selector', 'h2', '--depth', '0']);
      assert.match(h.out, /^selector h2: 3 matches$/m); assert.match(h.out, /^\[3\] h2 box 920,200 300×28 · block · static · visible$/m);
    });
    await check('e2e http: the same page through live-session (HTTP 200, consent none) measures the same', async () => {
      const r = await runAsync([`${base}/`, '--selector', 'main']);
      assert.equal(r.code, 0, r.err);
      const lines = r.out.trimEnd().split('\n');
      assert.equal(lines[0], `dom-probe ${base}/ @1440px · HTTP 200 · consent none`);
      assert.deepEqual(lines.slice(1), body(lines[11]));
      assert.match(lines[11], SHADOW);
    });
    await check('e2e http: an edge-signed 403 is a bot challenge — exit 3, nothing on stdout', async () => {
      const r = await runAsync([`${base}/blocked`]);
      assert.equal(r.code, 3, r.err); assert.match(r.err, /bot challenge/); assert.equal(r.out, '');
    });
  } finally {
    server.close();
    if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\ndom-probe: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
