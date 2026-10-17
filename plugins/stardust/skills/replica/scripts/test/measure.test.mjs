#!/usr/bin/env node
// skills/replica/scripts/test/measure.test.mjs — the measure.mjs contract: argument parsing and
// its usage errors, delta computation (exact px, prop diffs, a side with no match, an image pair's
// rendition), the root line (scrollWidth beside scrollHeight and the viewport, ◄◄ OVERFLOW when the
// document is wider) and its deltas, table and delta formatting (a backgroundImage url() shortened
// to its file name, an image match's rendition), --help in an empty cwd; then end-to-end against two
// in-process fixture pages that differ in one element's padding + colour, one element's position,
// the rendition an <img> selects at 360 and a 500 px box that overflows B at 360 (rects, props,
// --against deltas, the --all-matches cap, a selector missing on one side, --json / --out, root +
// rootDeltas, a page that fails to load). The end-to-end part runs where playwright is importable
// and prints a skip line otherwise. Also the per-width deadline: the width-read orchestration with
// fakes (a destroyed context re-read once on a fresh page, a deadline recorded at once, the next width
// on a fresh page, a bot challenge rethrown), the exit code and status line, a failed width in the
// deltas and the table; end-to-end a page that navigates once on resize, one that navigates on every
// scroll and one that hangs on resize. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_PROPS, DEFAULT_TIMEOUT_MS, MATCH_CAP, UsageError, buildDeltas, buildRootDeltas, computeDeltas, exitCodeFor, fileOf, formatDelta, formatRoot, formatTable, isLiveHttpUrl, parseArgs, readWidths, shortValue, statusLine } from '../measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'measure.mjs');
// The real deadline race and context classification (pure helpers) from live-session, in either layout.
const LIVE_SESSION = [join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs'), join(HERE, '..', '..', 'diff', 'live-session.mjs')].find((p) => existsSync(p));
const { withDeadline, isContextDestroyed } = await import(pathToFileURL(LIVE_SESSION).href);
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

const match = (rect, props, extra = {}) => ({ index: 0, of: 1, rect, visible: true, text: 'Hello', props, ...extra });

// ---- pure: argument parsing ---------------------------------------------------------------------
await check('parseArgs: selectors split on commas, widths repeatable + comma-separated + deduped, defaults', () => {
  const o = parseArgs(['http://a/', '--selectors', ' .hero , .cta,, main > p ', '--width', '1440,360', '--width', '360']);
  assert.deepEqual(o.selectors, ['.hero', '.cta', 'main > p']);
  assert.deepEqual(o.widths, [1440, 360]);
  assert.deepEqual(o.props, DEFAULT_PROPS);
  assert.equal(DEFAULT_PROPS[DEFAULT_PROPS.indexOf('backgroundColor') + 1], 'backgroundImage', 'backgroundImage sits right after backgroundColor');
  assert.equal(DEFAULT_PROPS[DEFAULT_PROPS.indexOf('position') + 1], 'boxSizing', 'boxSizing is a default prop — the box model is a lifted value the gate compares per box'); assert.equal(DEFAULT_PROPS.length, 24);
  assert.equal(o.against, null); assert.equal(o.allMatches, false); assert.equal(o.json, false); assert.equal(o.out, null);
  assert.equal(o.timeoutMs, null, 'no --timeout-ms: main resolves the shared navigation timeout'); assert.equal(DEFAULT_TIMEOUT_MS, 20000, 'the fallback stays the old default'); assert.match(o.ua, /Chrome\//);
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
  usage(['http://a/', '--selectors', '.x', '--timeout-ms', '0'], /--timeout-ms must be a positive number/);
  usage(['http://a/', '--selectors', '.x', '--timeout-ms', 'soon'], /--timeout-ms must be a positive number/);
});
await check('parseArgs: a value flag followed by nothing or by another --flag is a usage error naming the flag (never swallows the flag)', () => {
  for (const [flag, ...tail] of [['--width'], ['--against'], ['--out'], ['--timeout-ms'], ['--ua'], ['--consent'], ['--dismiss'], ['--locale'], ['--width', '--json'], ['--against', '--all-matches'], ['--dismiss', '--headed'], ['--locale', '--json']]) {
    assert.throws(() => parseArgs(['http://a/', '--selectors', '.x', flag, ...tail]), (e) => e instanceof UsageError && e.code === 2 && e.message.startsWith(`${flag} needs a value`), `${flag} ${tail.join(' ')}`);
  }
  // the CLI names the flag and exits 2
  const r = spawnSync(process.execPath, [SCRIPT, 'http://a/', '--selectors', '.x', '--width', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /measure: --width needs a value/);
});
await check('parseArgs: live-side flags — --consent, --dismiss (comma list, repeatable), --headed, --locale; live-session.mjs resolves from the plugin tree', () => {
  const o = parseArgs(['http://a/', '--selectors', 'h1', '--consent', '#ok', '--dismiss', '.close, .later', '--dismiss', '.x', '--headed', '--locale', 'en-GB']);
  assert.equal(o.consent, '#ok'); assert.deepEqual(o.dismiss, ['.close', '.later', '.x']); assert.equal(o.headed, true); assert.equal(o.locale, 'en-GB');
  const d = parseArgs(['http://a/', '--selectors', 'h1']); assert.equal(d.consent, null); assert.deepEqual(d.dismiss, []); assert.equal(d.headed, false); assert.equal(d.locale, null);
  assert.ok(existsSync(join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs')), 'the plugin-tree layout the script resolves first');
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
await check('fileOf: the file name without host, query or fragment; a data: URI keeps its MIME type; empty stays empty', () => {
  assert.equal(fileOf('https://cdn.example.test/media/hero-400.jpg?w=400&fmt=webp#x'), 'hero-400.jpg');
  assert.equal(fileOf('http://localhost:8791/assets/hero-1600.jpg'), 'hero-1600.jpg');
  assert.equal(fileOf('data:image/svg+xml;base64,PHN2Zy4uLg=='), 'data:image/svg+xml…');
  assert.equal(fileOf(''), ''); assert.equal(fileOf(undefined), '');
});
const IMG_A = [match({ x: 0, y: 900, w: 360, h: 240 }, { objectFit: 'cover' }, { img: { naturalWidth: 400, naturalHeight: 267, currentSrc: 'https://live.example.test/media/hero-400.jpg?fmt=webp' } })];
const IMG_B = [match({ x: 0, y: 900, w: 360, h: 240 }, { objectFit: 'cover' }, { img: { naturalWidth: 1600, naturalHeight: 1067, currentSrc: 'http://localhost:8791/assets/hero-1600.jpg' } })];
await check('computeDeltas: an image pair reports naturalWidth / naturalHeight / file only when the selected rendition differs; equal renditions and non-image pairs carry no img key', () => {
  const d = computeDeltas(IMG_A, IMG_B).pairs[0];
  assert.deepEqual(d.img, { naturalWidth: [400, 1600], naturalHeight: [267, 1067], file: ['hero-400.jpg', 'hero-1600.jpg'] });
  assert.deepEqual(d.props, {}); assert.deepEqual(d.rect, { dx: 0, dy: 0, dw: 0, dh: 0 });
  const same = computeDeltas(IMG_A, [match(IMG_A[0].rect, IMG_A[0].props, { img: { ...IMG_A[0].img, currentSrc: 'http://localhost:8791/x/hero-400.jpg' } })]).pairs[0];
  assert.equal('img' in same, false, 'same rendition on another host is not a delta — the host never counts');
  assert.equal('img' in computeDeltas(A, B).pairs[0], false);
  assert.deepEqual(computeDeltas(IMG_A, A).pairs[0].img, { naturalWidth: [400, null], naturalHeight: [267, null], file: ['hero-400.jpg', null] }, 'an image paired with a non-image reads null on that side');
});
const ROOT = (scrollWidth, scrollHeight, viewport = 360, clientWidth = viewport) => ({ viewport, clientWidth, scrollWidth, scrollHeight, overflowX: Math.max(0, scrollWidth - clientWidth) });
await check('buildRootDeltas: scrollWidth / scrollHeight as B − A per width; null for a width or a side without a root line', () => {
  const result = { widths: [1440, 360], root: { a: { 1440: ROOT(1440, 5402, 1440), 360: ROOT(360, 6100) }, b: { 1440: ROOT(1440, 5410, 1440), 360: ROOT(373, 6108) } } };
  assert.deepEqual(buildRootDeltas(result, 'a', 'b'), { 1440: { scrollWidth: 0, scrollHeight: 8 }, 360: { scrollWidth: 13, scrollHeight: 8 } });
  assert.equal(buildRootDeltas({ widths: [360], root: { a: { 360: ROOT(360, 1) } } }, 'a', 'b'), null);
  assert.deepEqual(buildRootDeltas({ widths: [360, 1440], root: { a: { 360: ROOT(360, 1) }, b: { 360: ROOT(360, 1) } } }, 'a', 'b'), { 360: { scrollWidth: 0, scrollHeight: 0 }, 1440: null });
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
  assert.doesNotMatch(t, /Δ/); assert.doesNotMatch(t, /root/, 'no root line when the result carries none (older JSON)');
});
await check('formatRoot + formatTable: the root line opens every width block — scrollWidth beside the viewport and scrollHeight, ◄◄ OVERFLOW +n px when the document is wider than its viewport; two sides print A / B / Δ', () => {
  assert.equal(formatRoot(ROOT(360, 6100)), 'scrollWidth   360  viewport 360  scrollHeight   6100');
  assert.equal(formatRoot(ROOT(373, 6108)), 'scrollWidth   373  viewport 360  scrollHeight   6108  ◄◄ OVERFLOW +13px');
  assert.equal(formatRoot(ROOT(345, 900, 360, 345)), 'scrollWidth   345  viewport 360 (client 345)  scrollHeight    900', 'a headed scrollbar gutter: client width shown, no overflow');
  const one = formatTable({ _provenance: prov(['http://a/']), widths: [360], selectors: ['.hero'], root: { 'http://a/': { 360: ROOT(400, 1200) } }, pages: { 'http://a/': { 360: { '.hero': A } } } });
  assert.match(one, /\n@ 360px\n {2}root {2}scrollWidth {3}400 {2}viewport 360 {2}scrollHeight {3}1200 {2}◄◄ OVERFLOW \+40px\n {2}\.hero\n/);
  const result = { _provenance: prov(['http://a/', 'http://b/']), widths: [360], selectors: ['.hero'], root: { 'http://a/': { 360: ROOT(360, 6100) }, 'http://b/': { 360: ROOT(373, 6108) } }, pages: { 'http://a/': { 360: { '.hero': A } }, 'http://b/': { 360: { '.hero': B } } } };
  result.deltas = buildDeltas(result, 'http://a/', 'http://b/'); result.rootDeltas = buildRootDeltas(result, 'http://a/', 'http://b/');
  const two = formatTable(result);
  assert.match(two, /\n@ 360px\n {2}root\n {4}A {2}scrollWidth {3}360 {2}viewport 360 {2}scrollHeight {3}6100\n {4}B {2}scrollWidth {3}373 {2}viewport 360 {2}scrollHeight {3}6108 {2}◄◄ OVERFLOW \+13px\n {4}Δ {2}scrollWidth \+13 {2}scrollHeight \+8\n {2}\.hero\n/);
  const half = formatTable({ ...result, root: { 'http://a/': result.root['http://a/'] }, pages: { 'http://a/': result.pages['http://a/'] }, deltas: null, rootDeltas: null });
  assert.match(half, /\n {2}root\n {4}A {2}scrollWidth {3}360[^\n]*\n {2}\.hero/, 'a side without a root line prints the other side alone, no Δ');
});
await check('formatDelta + the match line: an image match prints its rendition; a rendition delta prints img.naturalWidth / img.naturalHeight / img.file after the props', () => {
  assert.equal(formatDelta(computeDeltas(IMG_A, IMG_B).pairs[0]), 'Δx 0 Δy 0 Δw 0 Δh 0  img.naturalWidth: 400 → 1600; img.naturalHeight: 267 → 1067; img.file: hero-400.jpg → hero-1600.jpg');
  assert.equal(formatDelta(computeDeltas(IMG_A, [match(IMG_A[0].rect, { objectFit: 'contain' }, { img: IMG_A[0].img })]).pairs[0]), 'Δx 0 Δy 0 Δw 0 Δh 0  objectFit: cover → contain');
  const t = formatTable({ _provenance: prov(['http://a/'], { props: ['objectFit'] }), widths: [360], selectors: ['img'], pages: { 'http://a/': { 360: { img: IMG_A } } } });
  assert.match(t, /\n {7}x {5}0 {2}y {4}900 {2}w {3}360 {2}h {3}240 {2}vis {2}"Hello" {2}img 400×267 …\/hero-400\.jpg\n {6}objectFit: cover$/);
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
// ---- pure: per-width deadline — orchestration, exit code, status line, a failed width in deltas + table ----
const destroyed = (how = 'Execution context was destroyed, most likely because of a navigation') => new Error(`page.evaluate: ${how}\nCall log:\n  - waiting`);
// Fake pages: outcomes[width] lists what each successive read at that width does — an Error rejects, 'hang' never
// settles, anything else (or nothing listed) measures. Every read and reopen is logged in order.
const fakePages = (outcomes = {}, { reopen } = {}) => {
  const log = []; const n = {};
  return {
    log,
    deps: {
      read: (width) => {
        log.push(`read ${width}`);
        n[width] = (n[width] ?? -1) + 1;
        const out = (outcomes[width] || [])[n[width]];
        if (out === 'hang') return new Promise(() => {});
        if (out instanceof Error) return Promise.reject(out);
        return Promise.resolve({ width, attempt: n[width] });
      },
      reopen: async (width, bound) => { log.push(`reopen ${width}`); if (reopen) await reopen(width, bound); },
      deadlineMs: 40, withDeadline, isContextDestroyed, label: (width) => `u @${width}`,
    },
  };
};
await check('readWidths: a read the page navigated under is re-read once on a fresh page opened at that width — measured, listed as retried; the next width stays on that page', async () => {
  const f = fakePages({ 360: [destroyed()] });
  const r = await readWidths([1440, 360, 768], f.deps);
  assert.deepEqual(r.failed, []); assert.deepEqual(r.retried, [360]);
  assert.deepEqual(r.byWidth, { 1440: { width: 1440, attempt: 0 }, 360: { width: 360, attempt: 1 }, 768: { width: 768, attempt: 0 } });
  assert.deepEqual(f.log, ['read 1440', 'read 360', 'reopen 360', 'read 360', 'read 768']);
});
await check('readWidths: destroyed twice → recorded with the second error\'s first line, never measured; the next width starts on a fresh page', async () => {
  const f = fakePages({ 360: [destroyed(), destroyed('Frame was detached')] });
  const r = await readWidths([360, 1440], f.deps);
  assert.deepEqual(r.failed, [{ width: 360, error: 'page.evaluate: Frame was detached' }]); assert.deepEqual(r.retried, []);
  assert.deepEqual(Object.keys(r.byWidth), ['1440']);
  assert.deepEqual(f.log, ['read 360', 'reopen 360', 'read 360', 'reopen 1440', 'read 1440']);
});
await check('readWidths: a read past the deadline is recorded at once and never retried; any other error likewise; each next width gets a fresh page', async () => {
  const f = fakePages({ 360: ['hang'], 768: [new Error('page.setViewportSize: Target crashed\nstack')] });
  const t0 = Date.now();
  const r = await readWidths([1440, 360, 768, 1024], f.deps);
  assert.ok(Date.now() - t0 < 2000, 'the hung read cost its deadline, not more');
  assert.deepEqual(r.failed, [{ width: 360, error: 'u @360: deadline 40 ms exceeded' }, { width: 768, error: 'page.setViewportSize: Target crashed' }]);
  assert.deepEqual(r.retried, []); assert.deepEqual(Object.keys(r.byWidth), ['1024', '1440']);
  assert.deepEqual(f.log, ['read 1440', 'read 360', 'reopen 768', 'read 768', 'reopen 1024', 'read 1024']);
});
await check('readWidths: a fresh-page step that never settles is bounded by reopenDeadlineMs and recorded; a BotChallengeError from a fresh page is rethrown, never recorded', async () => {
  const hung = fakePages({ 360: [destroyed()] }, { reopen: (width, bound) => bound(new Promise(() => {})) });
  const r = await readWidths([360, 1440], { ...hung.deps, reopenDeadlineMs: 30 });
  assert.deepEqual(r.failed, [{ width: 360, error: 'u @360 fresh page: deadline 30 ms exceeded' }, { width: 1440, error: 'u @1440 fresh page: deadline 30 ms exceeded' }]);
  const challenge = Object.assign(new Error('bot challenge at u: edge interstitial'), { name: 'BotChallengeError' });
  const bot = fakePages({ 360: [destroyed()] }, { reopen: async () => { throw challenge; } });
  await assert.rejects(readWidths([1440, 360], bot.deps), (e) => e === challenge);
  const botAfterDeadline = fakePages({ 360: ['hang'] }, { reopen: async () => { throw challenge; } });
  await assert.rejects(readWidths([360, 1440], botAfterDeadline.deps), (e) => e === challenge, 'the next width\'s fresh page meets the challenge');
});
await check('readWidths: a fresh page\'s navigation is never raced — a slow one (a headed challenge-solve window) is measured, and a BotChallengeError it throws past every deadline still propagates, never recorded as a deadline', async () => {
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const challenge = Object.assign(new Error('bot challenge at u: edge interstitial'), { name: 'BotChallengeError' });
  // bound steps settle at once; the navigation between them takes 150 ms — past deadlineMs (40) and reopenDeadlineMs (30)
  const slow = (outcome) => async (width, bound) => { await bound(Promise.resolve()); await sleep(150); if (outcome) throw outcome; await bound(Promise.resolve()); };
  const solved = fakePages({ 360: [destroyed()] }, { reopen: slow() });
  const r = await readWidths([1440, 360], { ...solved.deps, reopenDeadlineMs: 30 });
  assert.deepEqual(r.failed, []); assert.deepEqual(r.retried, [360]); assert.deepEqual(r.byWidth[360], { width: 360, attempt: 1 });
  for (const outcomes of [{ 360: [destroyed()] }, { 360: ['hang'] }]) {
    const late = fakePages(outcomes, { reopen: slow(challenge) });
    await assert.rejects(readWidths([360, 1440], { ...late.deps, reopenDeadlineMs: 30 }), (e) => e === challenge, JSON.stringify(Object.keys(outcomes)));
  }
});
const done = (pages, failed = []) => ({ _provenance: { urls: Object.keys(pages), failed }, pages });
await check('exitCodeFor: 0 complete or partial, 124 every attempted width read failed, 1 a page failed to load (before 124)', () => {
  assert.equal(exitCodeFor(done({ a: { 1440: {}, 360: {} } })), 0);
  assert.equal(exitCodeFor(done({ a: { 1440: {} } }, [{ url: 'a', width: 360, error: 'x' }])), 0, 'partial is still 0 — a measurement, not a gate');
  assert.equal(exitCodeFor(done({ a: {} }, [{ url: 'a', width: 1440, error: 'x' }, { url: 'a', width: 360, error: 'y' }])), 124);
  assert.equal(exitCodeFor(done({ a: {}, b: {} }, [{ url: 'a', width: 360, error: 'x' }, { url: 'b', width: 360, error: 'y' }])), 124);
  assert.equal(exitCodeFor(done({ a: {} }, [{ url: 'b', error: 'HTTP 404' }, { url: 'a', width: 360, error: 'x' }])), 1);
  assert.equal(exitCodeFor(done({ a: { 360: {} } }, [{ url: 'b', error: 'HTTP 404' }])), 1);
});
await check('statusLine: null without a failed width; PARTIAL k of n; NO VERDICT (exit 124) when every width read failed', () => {
  assert.equal(statusLine(done({ a: { 1440: {}, 360: {} } })), null);
  assert.equal(statusLine(done({ a: { 360: {} } }, [{ url: 'b', error: 'HTTP 404' }])), null, 'a load failure alone keeps the output unchanged');
  assert.equal(statusLine(done({ a: { 1440: {} }, b: { 1440: {}, 360: {} } }, [{ url: 'a', width: 360, error: 'a @360: deadline 3000 ms exceeded' }])), 'measure: PARTIAL — 1 of 4 width read(s) failed: a @360 (a @360: deadline 3000 ms exceeded)');
  assert.equal(statusLine(done({ a: {} }, [{ url: 'a', width: 1440, error: 'e1' }, { url: 'a', width: 360, error: 'e2' }])), 'measure: NO VERDICT — every width read failed (exit 124): a @1440 (e1); a @360 (e2)');
});
const failedAt = (url, width) => ({ url, width, error: `${url} @${width}: deadline 3000 ms exceeded` });
await check('buildDeltas: a width either side has no read at is null — never a MISSING delta', () => {
  const result = { widths: [1440, 360], selectors: ['.hero'], pages: { a: { 1440: { '.hero': A }, 360: { '.hero': A } }, b: { 1440: { '.hero': B } } } };
  const d = buildDeltas(result, 'a', 'b');
  assert.equal(d[360], null); assert.equal(d[1440]['.hero'].status, 'ok');
  assert.deepEqual(buildDeltas({ ...result, pages: { a: {}, b: result.pages.b } }, 'a', 'b'), { 1440: null, 360: null });
});
await check('formatTable: a failed width — the status line first, ✗ <url> @<w> not measured in the header list and its width block; with --against that width prints each measured side under "Δ not computed"', () => {
  const one = formatTable({ _provenance: prov(['http://a/'], { failed: [failedAt('http://a/', 360)], partial: true }), widths: [1440, 360], selectors: ['.hero'], pages: { 'http://a/': { 1440: { '.hero': A } } } });
  const lines = one.split('\n');
  assert.equal(lines[0], 'measure: PARTIAL — 1 of 2 width read(s) failed: http://a/ @360 (http://a/ @360: deadline 3000 ms exceeded)');
  assert.equal(lines[1], 'measure  http://a/');
  assert.equal(lines.filter((l) => l === '  ✗ http://a/ @360 not measured — http://a/ @360: deadline 3000 ms exceeded').length, 2, one);
  assert.match(one, /\n@ 360px\n {2}✗ http:\/\/a\/ @360 not measured — [^\n]*$/);
  const result = { _provenance: prov(['http://a/', 'http://b/'], { failed: [failedAt('http://b/', 360)], partial: true }), widths: [1440, 360], selectors: ['.hero'], root: { 'http://a/': { 1440: ROOT(1440, 900, 1440), 360: ROOT(360, 1200) }, 'http://b/': { 1440: ROOT(1440, 900, 1440) } }, pages: { 'http://a/': { 1440: { '.hero': A }, 360: { '.hero': A } }, 'http://b/': { 1440: { '.hero': B } } } };
  result.deltas = buildDeltas(result, 'http://a/', 'http://b/');
  const two = formatTable(result);
  assert.match(two, /^measure: PARTIAL — 1 of 4 width read\(s\) failed: http:\/\/b\/ @360 /);
  assert.match(two, /\n@ 360px\n {2}✗ http:\/\/b\/ @360 not measured — [^\n]*\n {2}root\n {4}A {2}scrollWidth {3}360[^\n]*\n {2}Δ not computed at 360 — a side was not measured\n {2}\.hero\n {4}A {2}x {5}0 {2}y {4}120[^\n]*\n {6}padding: 64px 0px/);
  assert.match(two, /\n@ 1440px\n[\s\S]*\n {4}Δ {2}Δx \+12 Δy -4 Δw 0 Δh \+12/, 'the measured width keeps its Δ');
  assert.doesNotMatch(two, /MISSING|deltas not computed — a side failed to load/);
});
await check('--help and -h: exit 0, the usage header on stdout, nothing written in an empty cwd', () => {
  for (const flag of ['--help', '-h']) {
    const cwd = mkdtempSync(join(tmpdir(), 'measure-help-'));
    const r = spawnSync(process.execPath, [SCRIPT, flag], { cwd, encoding: 'utf8' });
    const wrote = readdirSync(cwd); rmSync(cwd, { recursive: true, force: true });
    assert.equal(r.status, 0, `${flag} exit ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /--against <url2>/); assert.match(r.stdout, /Writes: nothing/);
    assert.match(r.stdout, /root: \{ \[url\]: \{ \[width\]: \{ viewport, clientWidth, scrollWidth,/); assert.match(r.stdout, /◄◄ OVERFLOW \+<n>px/); assert.match(r.stdout, /img\?: \{ naturalWidth,/); assert.match(r.stdout, /boxSizing, width,/);
    assert.match(r.stdout, /--timeout-ms <ms> +per-page navigation timeout AND per-width deadline \(default:\s+STARDUST_NAV_TIMEOUT_MS/); assert.match(r.stdout, /124 every width\s+read failed/); assert.match(r.stdout, /failed: \[ \{ url, width\?, error \} \]/);
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
  // A and B share one layout; B differs in the hero's padding + background and the .shift box's position. A's
  // photo carries a srcset (400w / 1600w, sizes 100vw) so 360 selects the 400 rendition and 1440 the 1600 one; B
  // serves the 1600 rendition at every width — and carries a 500 px box that overflows the 360 viewport.
  const fixture = (hero, shift, extra, photo, tail = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0} .hero{height:300px;box-sizing:border-box;color:rgb(255, 255, 255);${hero}}
    .shift{position:absolute;width:100px;height:50px;background:rgb(0, 128, 0);${shift}} .item{height:20px} .hidden{display:none}
    .photo{display:block;width:200px;height:150px} .wide{width:500px;height:10px}
    </style></head><body><section class="hero"><h1>Welcome to the fixture page with a long heading that exceeds forty characters</h1></section>
    <div class="shift">S</div><ul>${Array.from({ length: 15 }, (_, i) => `<li class="item">item ${i + 1}</li>`).join('')}</ul>${extra}<p class="hidden">hidden</p>${photo}${tail}</body></html>`;
  const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`;
  const scripted = (script) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0} .hero{height:300px} .tall{height:2400px}</style></head><body><section class="hero"><h1>Scripted fixture</h1></section><div class="tall"></div><script>${script}</script></body></html>`;
  const pages = {
    '/a.html': fixture('padding:64px 0;background:rgb(10, 20, 30)', 'left:40px;top:200px', '<p class="only-a">Only on A</p>', '<img class="photo" src="/r-1600.svg" srcset="/r-400.svg 400w, /r-1600.svg 1600w" sizes="100vw" alt="">'),
    '/b.html': fixture('padding:48px 0;background:rgb(200, 20, 30)', 'left:52px;top:236px', '', '<img class="photo" src="/r-1600.svg?v=2" alt="">', '<div class="wide"></div>'),
    '/r-400.svg': svg(400, 300), '/r-1600.svg': svg(1600, 1200),
    // The per-width deadline fixtures: a page that navigates once on resize (a flag in localStorage — shared by a
    // fresh page in the same context), one that navigates on every scroll (the settle scrolls), one whose resize
    // handler busy-loops (the renderer never answers the read).
    '/nav-once.html': scripted("addEventListener('resize', () => { if (localStorage.getItem('navigated')) return; localStorage.setItem('navigated', '1'); setTimeout(() => location.reload(), 150); });"),
    '/nav-scroll.html': scripted("history.scrollRestoration = 'manual'; addEventListener('scroll', () => location.reload(), { once: true });"),
    '/hang.html': scripted("addEventListener('resize', () => { for (;;) { /* wedge the renderer */ } });"),
  };
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    const body = pages[path];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urlA = `${base}/a.html`; const urlB = `${base}/b.html`;
  // Asynchronous spawn: the fixture origin lives in this process, so the event loop must keep running. A run past
  // `killAfterMs` is killed (status null) so a hang fails its check instead of stalling the suite.
  const run = (args, cwd, env = process.env, killAfterMs = 0) => new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8' });
    const timer = killAfterMs ? setTimeout(() => child.kill('SIGKILL'), killAfterMs) : null;
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr, ms: Date.now() - t0 }); });
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
    assert.equal(hero.props.padding, '64px 0px'); assert.equal(hero.props.backgroundColor, 'rgb(10, 20, 30)'); assert.equal(hero.props.display, 'block'); assert.equal(hero.props.boxSizing, 'border-box');
    assert.deepEqual(Object.keys(hero.props), DEFAULT_PROPS);
    assert.equal(j.pages[urlA][360]['.hero'][0].rect.w, 360);
    assert.equal('img' in hero, false, 'a non-image match carries no img key');
    assert.deepEqual(j.root[urlA][1440], { viewport: 1440, clientWidth: 1440, scrollWidth: 1440, scrollHeight: j.root[urlA][1440].scrollHeight, overflowX: 0 });
    assert.ok(j.root[urlA][360].scrollHeight > j.root[urlA][1440].scrollHeight, 'the root line carries the document height per width'); assert.equal(j.root[urlA][360].overflowX, 0);
    assert.equal(j.rootDeltas, undefined);
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
  await check('e2e: the root line per side per width — B overflows the 360 viewport by 140 px (◄◄ OVERFLOW on the table, a stderr warning, root + rootDeltas in the JSON), no overflow at 1440', async () => {
    const r = await run([urlA, '--against', urlB, '--selectors', '.hero', '--width', '1440,360', '--props', 'display', '--json'], work);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.root[urlB][360], { viewport: 360, clientWidth: 360, scrollWidth: 500, scrollHeight: j.root[urlB][360].scrollHeight, overflowX: 140 });
    assert.equal(j.root[urlA][360].overflowX, 0); assert.equal(j.root[urlB][1440].overflowX, 0); assert.equal(j.root[urlB][1440].scrollWidth, 1440);
    assert.equal(j.rootDeltas[360].scrollWidth, 140); assert.equal(j.rootDeltas[1440].scrollWidth, 0); assert.equal(typeof j.rootDeltas[360].scrollHeight, 'number');
    assert.match(r.stderr, /measure: http:\/\/127\.0\.0\.1:\d+\/b\.html @360: horizontal overflow \+140px \(scrollWidth 500 > viewport 360\)/);
    assert.ok(j._provenance.warnings.some((w) => /b\.html @360: horizontal overflow \+140px/.test(w)), JSON.stringify(j._provenance.warnings));
    const t = await run([urlA, '--against', urlB, '--selectors', '.hero', '--width', '360', '--props', 'display'], work);
    assert.match(t.stdout, /\n@ 360px\n {2}root\n {4}A {2}scrollWidth {3}360 {2}viewport 360 {2}scrollHeight +\d+\n {4}B {2}scrollWidth {3}500 {2}viewport 360 {2}scrollHeight +\d+ {2}◄◄ OVERFLOW \+140px\n {4}Δ {2}scrollWidth \+140 {2}scrollHeight [+-]?\d+\n/, t.stdout);
  });
  await check('e2e: an <img> match reports the rendition the browser selected — A picks the 400 rendition at 360 and the 1600 one at 1440, B the 1600 one everywhere; the Δ names img.naturalWidth / img.file at 360 only', async () => {
    const r = await run([urlA, '--against', urlB, '--selectors', '.photo', '--width', '1440,360', '--props', 'display', '--json'], work);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    const a360 = j.pages[urlA][360]['.photo'][0].img; const b360 = j.pages[urlB][360]['.photo'][0].img;
    assert.equal(a360.naturalWidth, 400); assert.equal(a360.naturalHeight, 300); assert.match(a360.currentSrc, /\/r-400\.svg$/);
    assert.equal(b360.naturalWidth, 1600); assert.match(b360.currentSrc, /\/r-1600\.svg\?v=2$/);
    assert.equal(j.pages[urlA][1440]['.photo'][0].img.naturalWidth, 1600);
    assert.deepEqual(j.deltas[360]['.photo'].pairs[0].img, { naturalWidth: [400, 1600], naturalHeight: [300, 1200], file: ['r-400.svg', 'r-1600.svg'] });
    assert.equal('img' in j.deltas[1440]['.photo'].pairs[0], false, 'same rendition at 1440 (query string ignored) — no img delta');
    assert.deepEqual(j.deltas[360]['.photo'].pairs[0].rect, { dx: 0, dy: 0, dw: 0, dh: 0 }, 'equal boxes: a rendition-ratio symptom, not a layout bug');
    const t = await run([urlA, '--against', urlB, '--selectors', '.photo', '--width', '360', '--props', 'display'], work);
    assert.match(t.stdout, /\n {4}A {2}x[^\n]* {2}img 400×300 …\/r-400\.svg\n {4}B {2}x[^\n]* {2}img 1600×1200 …\/r-1600\.svg\n {4}Δ {2}Δx 0 Δy 0 Δw 0 Δh 0 {2}img\.naturalWidth: 400 → 1600; img\.naturalHeight: 300 → 1200; img\.file: r-400\.svg → r-1600\.svg\n/, t.stdout);
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
  await check('e2e: one navigation timeout — no flag: the crawl log\'s p95 × 2 (clamped), else the env; --timeout-ms wins over both; _provenance.navTimeout names the source', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'measure-nav-'));
    mkdirSync(join(proj, 'stardust', 'current'), { recursive: true });
    writeFileSync(join(proj, 'stardust', 'current', '_crawl-log.json'), JSON.stringify({ crawl: { navMs: { p95: 15000 } } }));
    const noEnv = { ...process.env }; delete noEnv.STARDUST_NAV_TIMEOUT_MS;
    try {
      const nav = async (args, env) => { const r = await run([urlA, '--selectors', '.hero', '--props', 'display', '--json', ...args], proj, env); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout)._provenance.navTimeout; };
      assert.deepEqual(await nav([], noEnv), { ms: 30000, source: 'crawl' });
      assert.deepEqual(await nav([], { ...noEnv, STARDUST_NAV_TIMEOUT_MS: '45000' }), { ms: 45000, source: 'env' });
      assert.deepEqual(await nav(['--timeout-ms', '7000'], { ...noEnv, STARDUST_NAV_TIMEOUT_MS: '45000' }), { ms: 7000, source: 'flag' });
    } finally { rmSync(proj, { recursive: true, force: true }); }
  });
  const navOnce = `${base}/nav-once.html`; const navScroll = `${base}/nav-scroll.html`; const hang = `${base}/hang.html`;
  await check('e2e: a page that navigates once on resize — the destroyed read is re-read on a fresh page: both widths measured, a re-read warning, not partial, exit 0', async () => {
    const r = await run([navOnce, '--selectors', '.hero', '--width', '1440,360', '--props', 'display', '--timeout-ms', '3000', '--json'], work, process.env, 60000);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j._provenance.partial, false); assert.deepEqual(j._provenance.failed, []);
    assert.deepEqual(j._provenance.warnings, [`${navOnce} @360: execution context destroyed (the page navigated) — re-read on a fresh page`]);
    assert.match(r.stderr, /measure: [^\n]*nav-once\.html @360: execution context destroyed \(the page navigated\) — re-read on a fresh page/);
    assert.equal(j.pages[navOnce][1440]['.hero'][0].rect.w, 1440); assert.equal(j.pages[navOnce][360]['.hero'][0].rect.w, 360);
    assert.equal(j.root[navOnce][360].viewport, 360);
    assert.doesNotMatch(r.stderr, /PARTIAL|NO VERDICT/);
  });
  await check('e2e: a page that navigates on every scroll — every width recorded as failed with its width, NO VERDICT first, exit 124', async () => {
    const out = join(work, 'nav-scroll.json');
    const r = await run([navScroll, '--selectors', '.hero', '--width', '1440,360', '--props', 'display', '--timeout-ms', '3000', '--out', out], work, process.env, 60000);
    assert.equal(r.status, 124, r.stderr);
    const first = r.stdout.split('\n')[0];
    assert.match(first, /^measure: NO VERDICT — every width read failed \(exit 124\): http:\/\/127\.0\.0\.1:\d+\/nav-scroll\.html @1440 \([^)]*Execution context was destroyed[^)]*\); [^\n]*nav-scroll\.html @360 \(/, first);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j._provenance.partial, true); assert.deepEqual(j.pages[navScroll], {});
    assert.deepEqual(j._provenance.failed.map((f) => [f.url, f.width]), [[navScroll, 1440], [navScroll, 360]]);
    for (const f of j._provenance.failed) assert.match(f.error, /Execution context was destroyed/);
    assert.match(r.stdout, /\n@ 360px\n {2}✗ [^\n]*nav-scroll\.html @360 not measured — /);
    assert.match(r.stderr, /measure: [^\n]*nav-scroll\.html @1440 not measured — /);
  });
  await check('e2e: a page that hangs on resize — 1440 measured, 360 recorded on its deadline, the other side measured, Δ not computed at 360, PARTIAL first, exit 0, bounded runtime', async () => {
    const out = join(work, 'hang.json');
    const r = await run([hang, '--against', urlA, '--selectors', '.hero', '--width', '1440,360', '--props', 'display', '--timeout-ms', '3000', '--out', out], work, process.env, 60000);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.ms < 30000, `took ${r.ms} ms — a hung width costs its deadline, not 900 s`);
    assert.equal(r.stdout.split('\n')[0], `measure: PARTIAL — 1 of 4 width read(s) failed: ${hang} @360 (${hang} @360: deadline 3000 ms exceeded)`);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j._provenance.partial, true);
    assert.deepEqual(j._provenance.failed, [{ url: hang, width: 360, error: `${hang} @360: deadline 3000 ms exceeded` }]);
    assert.deepEqual(Object.keys(j.pages[hang]), ['1440']); assert.equal(j.pages[hang][1440]['.hero'][0].rect.w, 1440);
    assert.deepEqual(Object.keys(j.pages[urlA]), ['360', '1440']);
    assert.equal(j.deltas[360], null); assert.equal(j.deltas[1440]['.hero'].status, 'ok'); assert.equal(j.rootDeltas[360], null);
    assert.match(r.stdout, /\n@ 360px\n {2}✗ [^\n]*hang\.html @360 not measured — [^\n]*\n {2}root\n {4}B {2}[^\n]*\n {2}Δ not computed at 360 — a side was not measured\n {2}\.hero\n {4}B {2}x/);
    assert.doesNotMatch(r.stdout, /MISSING/);
  });
  server.close();
  assert.equal(existsSync(join(work, 'deep', 'a.json')), true);
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failing` : '\nmeasure: all checks passed');
process.exit(failed ? 1 : 0);
