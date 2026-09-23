#!/usr/bin/env node
// skills/replica/scripts/test/measure.test.mjs — the measure.mjs contract: argument parsing and
// its usage errors, delta computation (exact px, prop diffs, a side with no match), table and
// delta formatting (a backgroundImage url() shortened to its file name), --help in an empty cwd;
// then end-to-end against two in-process fixture pages
// that differ in one element's padding + colour and one element's position (rects, props,
// --against deltas, the --all-matches cap, a selector missing on one side, --json / --out,
// a page that fails to load). The end-to-end part runs where playwright is importable and
// prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROPS, MATCH_CAP, UsageError, buildDeltas, computeDeltas, formatDelta, formatTable, isLiveHttpUrl, parseArgs, shortValue } from '../measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'measure.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

const match = (rect, props, extra = {}) => ({ index: 0, of: 1, rect, visible: true, text: 'Hello', props, ...extra });

// ---- pure: argument parsing ---------------------------------------------------------------------
await check('parseArgs: selectors split on commas, widths repeatable + comma-separated + deduped, defaults', () => {
  const o = parseArgs(['http://a/', '--selectors', ' .hero , .cta,, main > p ', '--width', '1440,360', '--width', '360']);
  assert.deepEqual(o.selectors, ['.hero', '.cta', 'main > p']);
  assert.deepEqual(o.widths, [1440, 360]);
  assert.deepEqual(o.props, DEFAULT_PROPS);
  assert.equal(DEFAULT_PROPS[DEFAULT_PROPS.indexOf('backgroundColor') + 1], 'backgroundImage', 'backgroundImage sits right after backgroundColor'); assert.equal(DEFAULT_PROPS.length, 23);
  assert.equal(o.against, null); assert.equal(o.allMatches, false); assert.equal(o.json, false); assert.equal(o.out, null);
  assert.equal(o.timeoutMs, 20000); assert.match(o.ua, /Chrome\//);
  assert.deepEqual(parseArgs(['http://a/', '--selectors', 'h1']).widths, [1440]);
});
await check('parseArgs: --props replaces the default list; --against, --all-matches, --json, --out, --timeout-ms, --ua', () => {
  const o = parseArgs(['http://a/', '--selectors', 'h1', '--props', 'padding, color', '--against', 'http://b/', '--all-matches', '--json', '--out', 'm.json', '--timeout-ms', '5000', '--ua', 'probe/1']);
  assert.deepEqual(o.props, ['padding', 'color']); assert.equal(o.props.includes('backgroundImage'), false, '--props replaces the default list, it does not extend it');
  assert.equal(o.against, 'http://b/'); assert.equal(o.allMatches, true); assert.equal(o.json, true);
  assert.equal(o.out, 'm.json'); assert.equal(o.timeoutMs, 5000); assert.equal(o.ua, 'probe/1');
});
await check('parseArgs: usage errors (code 2) — no url, no selectors, unknown flag, second positional, bad width, flag without value', () => {
  const usage = (argv, re) => { assert.throws(() => parseArgs(argv), (e) => e instanceof UsageError && e.code === 2 && re.test(e.message)); };
  usage(['--selectors', '.x'], /need <url>/);
  usage(['http://a/'], /need --selectors/);
  usage(['http://a/', '--selectors', '.x', '--bogus'], /unknown flag --bogus/);
  usage(['http://a/', 'http://b/', '--selectors', '.x'], /--against/);
  usage(['http://a/', '--selectors', '.x', '--width', '0'], /--width/);
  usage(['http://a/', '--selectors', '.x', '--width', 'wide'], /--width/);
  usage(['http://a/', '--selectors'], /--selectors needs a value/);
  usage(['http://a/', '--selectors', '.x', '--props', ','], /--props/);
});
await check('isLiveHttpUrl: live origins yes; localhost, loopback and file no', () => {
  assert.equal(isLiveHttpUrl('https://www.example.org/x'), true);
  assert.equal(isLiveHttpUrl('http://localhost:8791/a.html'), false);
  assert.equal(isLiveHttpUrl('http://127.0.0.1:8791/a.html'), false);
  assert.equal(isLiveHttpUrl('file:///tmp/a.html'), false);
  assert.equal(isLiveHttpUrl('not a url'), false);
});

// ---- pure: deltas ------------------------------------------------------------------------------
const A = [match({ x: 0, y: 120, w: 1440, h: 600 }, { padding: '64px 0px', color: 'rgb(0, 0, 0)' })];
const B = [match({ x: 12, y: 116, w: 1440, h: 612 }, { padding: '48px 0px', color: 'rgb(0, 0, 0)' })];
await check('computeDeltas: rect is B − A in px, only differing props listed as [a, b]', () => {
  const d = computeDeltas(A, B);
  assert.equal(d.status, 'ok'); assert.equal(d.countA, 1); assert.equal(d.countB, 1);
  assert.deepEqual(d.pairs[0].rect, { dx: 12, dy: -4, dw: 0, dh: 12 });
  assert.deepEqual(d.pairs[0].props, { padding: ['64px 0px', '48px 0px'] });
  assert.deepEqual(computeDeltas(A, A).pairs[0], { index: 0, rect: { dx: 0, dy: 0, dw: 0, dh: 0 }, props: {} });
});
await check('computeDeltas: a side with no match is a status (missing-a / missing-b / missing-both), never a skip', () => {
  assert.deepEqual(computeDeltas([], B), { status: 'missing-a', countA: 0, countB: 1, pairs: [] });
  assert.deepEqual(computeDeltas(A, []), { status: 'missing-b', countA: 1, countB: 0, pairs: [] });
  assert.deepEqual(computeDeltas(undefined, undefined), { status: 'missing-both', countA: 0, countB: 0, pairs: [] });
});
await check('computeDeltas: several matches pair by index up to the shorter side; a prop missing on one side reads as null', () => {
  const d = computeDeltas([...A, ...A, ...A], [...B, ...B]);
  assert.equal(d.countA, 3); assert.equal(d.countB, 2); assert.equal(d.pairs.length, 2); assert.equal(d.pairs[1].index, 1);
  const e = computeDeltas([match({ x: 0, y: 0, w: 1, h: 1 }, { gap: '8px' })], [match({ x: 0, y: 0, w: 1, h: 1 }, {})]);
  assert.deepEqual(e.pairs[0].props, { gap: ['8px', null] });
});
await check('buildDeltas: per width per selector; null when either page failed to load', () => {
  const result = { widths: [1440, 360], selectors: ['.hero', '.gone'], pages: { a: { 1440: { '.hero': A, '.gone': [] }, 360: { '.hero': A, '.gone': A } }, b: { 1440: { '.hero': B, '.gone': [] }, 360: { '.hero': B, '.gone': [] } } } };
  const d = buildDeltas(result, 'a', 'b');
  assert.deepEqual(Object.keys(d).sort(), ['1440', '360']);
  assert.equal(d[1440]['.gone'].status, 'missing-both'); assert.equal(d[360]['.gone'].status, 'missing-b');
  assert.equal(d[360]['.hero'].pairs[0].rect.dh, 12);
  assert.equal(buildDeltas({ ...result, pages: { a: result.pages.a } }, 'a', 'b'), null);
});

// ---- pure: formatting --------------------------------------------------------------------------
const prov = (urls, extra = {}) => ({ writtenBy: 'measure', writtenAt: 'now', urls, widths: [1440], selectors: [], props: ['padding', 'color'], allMatches: false, failed: [], warnings: [], ...extra });
await check('formatDelta: signed px deltas then differing props, or "props equal"', () => {
  assert.equal(formatDelta(computeDeltas(A, B).pairs[0]), 'Δx +12 Δy -4 Δw 0 Δh +12  padding: 64px 0px → 48px 0px');
  assert.equal(formatDelta(computeDeltas(A, A).pairs[0]), 'Δx 0 Δy 0 Δw 0 Δh 0  props equal');
});
await check('shortValue: a backgroundImage url() keeps its file name in the table and the Δ line; gradients, none and other props print raw; the JSON keeps the full value', () => {
  const long = 'url("https://cdn.example.test/assets/i18n/flags/v3/flag-de.svg")';
  assert.equal(shortValue('backgroundImage', long), 'url(…/flag-de.svg)');
  assert.equal(shortValue('backgroundImage', `${long}, url("https://cdn.example.test/x/y/flag-fr.svg?v=2#a")`), 'url(…/flag-de.svg), url(…/flag-fr.svg)', 'one per layer, query and fragment dropped');
  assert.equal(shortValue('backgroundImage', 'url("data:image/svg+xml;base64,PHN2Zy4uLg==")'), 'url(data:image/svg+xml…)');
  assert.equal(shortValue('backgroundImage', 'none'), 'none');
  assert.equal(shortValue('backgroundImage', 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))'), 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))');
  assert.equal(shortValue('backgroundImage', null), null); assert.equal(shortValue('color', long), long, 'only backgroundImage is shortened');
  const a = [match({ x: 0, y: 0, w: 24, h: 16 }, { backgroundImage: long, color: 'rgb(0, 0, 0)' })];
  const b = [match({ x: 0, y: 0, w: 24, h: 16 }, { backgroundImage: 'none', color: 'rgb(0, 0, 0)' })];
  assert.equal(formatDelta(computeDeltas(a, b).pairs[0]), 'Δx 0 Δy 0 Δw 0 Δh 0  backgroundImage: url(…/flag-de.svg) → none');
  assert.deepEqual(computeDeltas(a, b).pairs[0].props.backgroundImage, [long, 'none'], 'the delta structure (and so the JSON) keeps the full value');
  const t = formatTable({ _provenance: prov(['http://a/'], { props: ['backgroundImage', 'color'] }), widths: [1440], selectors: ['.flag'], pages: { 'http://a/': { 1440: { '.flag': a } } } });
  assert.match(t, /\n {6}backgroundImage: url\(…\/flag-de\.svg\); color: rgb\(0, 0, 0\)$/m); assert.doesNotMatch(t, /cdn\.example\.test/);
});
await check('formatTable: one page — one block per width, rect line + props line per match, "no match" named', () => {
  const t = formatTable({ _provenance: prov(['http://a/']), widths: [1440], selectors: ['.hero', '.gone'], pages: { 'http://a/': { 1440: { '.hero': A, '.gone': [] } } } });
  assert.match(t, /^measure {2}http:\/\/a\/\n/);
  assert.match(t, /\n@ 1440px\n {2}\.hero\n {7}x {5}0 {2}y {4}120 {2}w {2}1440 {2}h {3}600 {2}vis {2}"Hello"\n {6}padding: 64px 0px; color: rgb\(0, 0, 0\)\n/);
  assert.match(t, /\n {2}\.gone {3}no match/);
  assert.doesNotMatch(t, /Δ/);
});
await check('formatTable: --against — A/B rect lines, the Δ line, MISSING with the other side\'s count, a failed side named', () => {
  const pages = { 'http://a/': { 1440: { '.hero': A, '.only-a': A, '.n': [...A, ...A] } }, 'http://b/': { 1440: { '.hero': B, '.only-a': [], '.n': [...B, ...B, ...B] } } };
  const result = { _provenance: prov(['http://a/', 'http://b/']), widths: [1440], selectors: ['.hero', '.only-a', '.n'], pages };
  result.deltas = buildDeltas(result, 'http://a/', 'http://b/');
  const t = formatTable(result);
  assert.match(t, /^measure {2}A = http:\/\/a\/\n {9}B = http:\/\/b\/\n/);
  assert.match(t, /\n {2}\.hero\n {4}A {2}x {5}0 {2}y {4}120[^\n]*\n {4}B {2}x {4}12 {2}y {4}116[^\n]*\n {4}Δ {2}Δx \+12 Δy -4 Δw 0 Δh \+12 {2}padding: 64px 0px → 48px 0px\n/);
  assert.match(t, /\n {2}\.only-a {3}MISSING on B \(1 on A\)\n/);
  assert.match(t, /\n {2}\.n {3}matches 2 vs 3 — paired 2\n {4}\[1\]\n/);
  const half = { _provenance: prov(['http://a/', 'http://b/'], { failed: [{ url: 'http://b/', error: 'HTTP 404' }] }), widths: [1440], selectors: ['.hero'], pages: { 'http://a/': pages['http://a/'] }, deltas: null };
  const th = formatTable(half);
  assert.match(th, /\n {2}✗ http:\/\/b\/ failed to load — HTTP 404\n/);
  assert.match(th, /deltas not computed — a side failed to load$/);
});
await check('--help and -h: exit 0, the usage header on stdout, nothing written in an empty cwd', () => {
  for (const flag of ['--help', '-h']) {
    const cwd = mkdtempSync(join(tmpdir(), 'measure-help-'));
    const r = spawnSync(process.execPath, [SCRIPT, flag], { cwd, encoding: 'utf8' });
    const wrote = readdirSync(cwd); rmSync(cwd, { recursive: true, force: true });
    assert.equal(r.status, 0, `${flag} exit ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /--against <url2>/); assert.match(r.stdout, /Writes: nothing/);
    assert.deepEqual(wrote, []);
  }
});
await check('usage error on the CLI exits 2 with the reason on stderr', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'http://a/'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /measure: need --selectors/);
});

// ---- end-to-end against two fixture pages (needs playwright) -------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end measurement (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  // A and B share one layout; B differs in the hero's padding + background and the .shift box's position.
  const fixture = (hero, shift, extra) => `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0} .hero{height:300px;box-sizing:border-box;color:rgb(255, 255, 255);${hero}}
    .shift{position:absolute;width:100px;height:50px;background:rgb(0, 128, 0);${shift}} .item{height:20px} .hidden{display:none}
    </style></head><body><section class="hero"><h1>Welcome to the fixture page with a long heading that exceeds forty characters</h1></section>
    <div class="shift">S</div><ul>${Array.from({ length: 15 }, (_, i) => `<li class="item">item ${i + 1}</li>`).join('')}</ul>${extra}<p class="hidden">hidden</p></body></html>`;
  const pages = {
    '/a.html': fixture('padding:64px 0;background:rgb(10, 20, 30)', 'left:40px;top:200px', '<p class="only-a">Only on A</p>'),
    '/b.html': fixture('padding:48px 0;background:rgb(200, 20, 30)', 'left:52px;top:236px', ''),
  };
  const server = createServer((req, res) => {
    const body = pages[req.url];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urlA = `${base}/a.html`; const urlB = `${base}/b.html`;
  // Asynchronous spawn: the fixture origin lives in this process, so the event loop must keep running.
  const run = (args, cwd) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  const SELS = '.hero,.shift,.item,.only-a,.hidden,.nope';
  const work = mkdtempSync(join(tmpdir(), 'measure-e2e-'));

  await check('e2e: one page, two widths, --json + --out — rects, visibility, text cap, props, first-match count', async () => {
    const out = join(work, 'deep', 'a.json');
    const r = await run([urlA, '--selectors', SELS, '--width', '1440,360', '--json', '--out', out], work);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j._provenance.writtenBy, 'skills/replica/scripts/measure.mjs'); assert.deepEqual(j.widths, [1440, 360]); assert.deepEqual(j._provenance.failed, []);
    assert.equal(readFileSync(out, 'utf8'), r.stdout.trim());
    const hero = j.pages[urlA][1440]['.hero'][0];
    assert.deepEqual(hero.rect, { x: 0, y: 0, w: 1440, h: 300 }); assert.equal(hero.visible, true); assert.equal(hero.of, 1);
    assert.equal(hero.text.length, 40); assert.match(hero.text, /^Welcome to the fixture page with a long…$/);
    assert.equal(hero.props.padding, '64px 0px'); assert.equal(hero.props.backgroundColor, 'rgb(10, 20, 30)'); assert.equal(hero.props.display, 'block');
    assert.deepEqual(Object.keys(hero.props), DEFAULT_PROPS);
    assert.equal(j.pages[urlA][360]['.hero'][0].rect.w, 360);
    assert.deepEqual(j.pages[urlA][1440]['.shift'][0].rect, { x: 40, y: 200, w: 100, h: 50 });
    assert.equal(j.pages[urlA][1440]['.item'].length, 1); assert.equal(j.pages[urlA][1440]['.item'][0].of, 15);
    assert.equal(j.pages[urlA][1440]['.hidden'][0].visible, false);
    assert.deepEqual(j.pages[urlA][1440]['.nope'], []); assert.equal(j.deltas, undefined);
  });
  await check('e2e: --against — exact px deltas, the prop diff, a selector missing on one side, --all-matches cap, exit 0 despite deltas', async () => {
    const r = await run([urlA, '--against', urlB, '--selectors', SELS, '--all-matches', '--props', 'padding,backgroundColor,display', '--json'], work);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j._provenance.urls, [urlA, urlB]);
    const d = j.deltas[1440];
    assert.deepEqual(d['.hero'].pairs[0].rect, { dx: 0, dy: 0, dw: 0, dh: 0 });
    assert.deepEqual(d['.hero'].pairs[0].props, { padding: ['64px 0px', '48px 0px'], backgroundColor: ['rgb(10, 20, 30)', 'rgb(200, 20, 30)'] });
    assert.deepEqual(d['.shift'].pairs[0], { index: 0, rect: { dx: 12, dy: 36, dw: 0, dh: 0 }, props: {} });
    assert.deepEqual(d['.only-a'], { status: 'missing-b', countA: 1, countB: 0, pairs: [] });
    assert.equal(d['.nope'].status, 'missing-both');
    assert.equal(j.pages[urlA][1440]['.item'].length, MATCH_CAP); assert.equal(j.pages[urlA][1440]['.item'][11].of, 15); assert.equal(d['.item'].pairs.length, MATCH_CAP);
  });
  await check('e2e: --against table — the Δ line with exact px and the prop diff, MISSING named', async () => {
    const r = await run([urlA, '--against', urlB, '--selectors', '.hero,.shift,.only-a', '--props', 'padding,color'], work);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\n {4}Δ {2}Δx 0 Δy 0 Δw 0 Δh 0 {2}padding: 64px 0px → 48px 0px\n/);
    assert.match(r.stdout, /\n {4}Δ {2}Δx \+12 Δy \+36 Δw 0 Δh 0 {2}props equal\n/);
    assert.match(r.stdout, /\n {2}\.only-a {3}MISSING on B \(1 on A\)\n/);
  });
  await check('e2e: a side that fails to load — exit 1, named on stderr, the loaded side still printed, deltas null', async () => {
    const r = await run([urlA, '--against', `${base}/missing.html`, '--selectors', '.hero', '--props', 'padding'], work);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /measure: http:\/\/127\.0\.0\.1:\d+\/missing\.html failed to load — HTTP 404/);
    assert.match(r.stdout, /\n {2}✗ [^\n]*missing\.html failed to load — HTTP 404\n/);
    assert.match(r.stdout, /\n {4}A {2}x {5}0 {2}y {6}0 {2}w {2}1440 {2}h {3}300 {2}vis/);
    assert.match(r.stdout, /deltas not computed — a side failed to load/);
  });
  await check('e2e: an invalid selector is a warning, the rest is measured', async () => {
    const r = await run([urlA, '--selectors', '.hero,!bad', '--props', 'padding', '--json'], work);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j._provenance.warnings.length, 1, JSON.stringify(j._provenance.warnings)); assert.match(j._provenance.warnings[0], /selector "!bad"/);
    assert.match(r.stderr, /measure: [^\n]*selector "!bad"/);
    assert.deepEqual(j.pages[urlA][1440]['!bad'], []); assert.equal(j.pages[urlA][1440]['.hero'].length, 1);
  });
  server.close();
  assert.equal(existsSync(join(work, 'deep', 'a.json')), true);
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failing` : '\nmeasure: all checks passed');
process.exit(failed ? 1 : 0);
