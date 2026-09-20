#!/usr/bin/env node
// lift.mjs contract test — pure halves always; browser cases when Playwright
// resolves (STARDUST_PW_ROOT=<dir with node_modules>, or the cwd).
//
// Pure: --help exits 0 and names --save-css / --refresh / --roots / exit 5; an
//   unknown flag exits 1; a trailing value flag is refused (exit 1, "needs a
//   value"); parseCssMeta reads @font-face descriptors (weight range kept) and
//   the exact @media conditions from CSS text, ignoring comments; reusable()
//   matches on url + width + roots only.
// Browser (fixtures/lift: nesting depth 22 with a 300-char teaser, a positioned
//   ancestor at x=100 with an absolute child left:40, an icon strip with
//   per-<img> inline sizes, body font-variation-settings, a linked sheet with
//   @font-face + @media (max-width: 768px), an inline <style> with @media
//   (min-width: 1200px), <sup> in a line-height:1.5 paragraph, a ::before,
//   a minmax(0,1fr) grid, h2/h3, a last child with margin-bottom):
//   1440 → exit 0; depth ≥ 20 and the full 300-char teaser (no truncation);
//   offset.left 40 vs rect.x ≥ 140 for the absolute child; inline sizes on
//   the three <img>; s.fontVariationSettings on body; fontFaces has the
//   fixture face; mediaQueries has both exact strings; lineHeightUnitless
//   "1.5" on the <sup>; ::before content on the badge; gridTemplateColumns on
//   the grid; headingLevel 2/3; isLastChild + marginBottom on the last card;
//   sections[] from main; stylesheets[] lists the linked + inline sheet;
//   flex-grow: 1 and z-index: 1 recorded (per-property defaults — a global
//   '1' dropped them), opacity 1 still dropped; the inline <svg> is an
//   element (rect, root), its <circle>/<path> are not.
//   360 → docHeight differs; a second 1440 run prints `reusing`, exit 0, no
//   navigation (the cache); --refresh re-probes; --save-css writes the sheets.
// Usage: node plugins/stardust/evals/lint/lift-smoke.mjs
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pwRoot, skipBrowser, stageProjectCopy, serveDir } from './lib/_browser.mjs';

const HERE = import.meta.dirname;
const SCRIPT = resolve(HERE, '..', '..', 'skills', 'replica', 'scripts', 'lift.mjs');
const FIXTURE = join(HERE, 'fixtures', 'lift');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const ENV = { ...process.env, STARDUST_CRAWL_LOG: '/nonexistent/_crawl-log.json' };
const run = (args, cwd) => { const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd, env: ENV }); return { status: r.status, out: `${r.stdout}\n${r.stderr}` }; };
const runAsync = (args, cwd) => new Promise((res) => { const ch = spawn(process.execPath, args, { cwd, env: ENV }); let out = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { out += d; }); ch.on('close', (status) => res({ status, out })); });

// ---- pure
const help = run([SCRIPT, '--help']);
check(help.status === 0 && /--save-css/.test(help.out) && /--refresh/.test(help.out) && /--roots/.test(help.out) && /5 invalid capture/.test(help.out), 'lift --help exits 0 and names --save-css, --refresh, --roots and exit 5');
check(run([SCRIPT, 'https://example.invalid/', '--bogus']).status === 1, 'an unknown flag exits 1');
const trailing = run([SCRIPT, 'https://example.invalid/', '--width']);
check(trailing.status === 1 && /needs a value/.test(trailing.out), 'a trailing value flag is refused with "needs a value"');
const { parseCssMeta, reusable, PROPS } = await import(SCRIPT);
{
  const m = parseCssMeta('/* @media (fake) { } */ @font-face { font-family: "Fixture Sans"; src: url(a.woff2) format("woff2"); font-weight: 100 900; font-display: swap; } body { line-height: 1.5 } @media (max-width: 768px) { .a { color: red } @media (hover: hover) { .b { c: d } } } @media screen and (min-width:1200px){.c{d:e}}');
  check(m.fontFaces.length === 1 && m.fontFaces[0].fontFamily === 'Fixture Sans' && m.fontFaces[0].fontWeight === '100 900' && m.fontFaces[0].fontDisplay === 'swap', `parseCssMeta reads @font-face descriptors (got ${JSON.stringify(m.fontFaces)})`);
  check(m.mediaQueries.includes('(max-width: 768px)') && m.mediaQueries.includes('(hover: hover)') && m.mediaQueries.includes('screen and (min-width:1200px)') && !m.mediaQueries.some((q) => /fake/.test(q)), `parseCssMeta lists exact @media conditions, comments ignored (got ${JSON.stringify(m.mediaQueries)})`);
  check(['fontVariationSettings', 'fontOpticalSizing', 'fontFeatureSettings', 'gridTemplateColumns', 'lineHeight', 'marginBottom'].every((p) => PROPS.includes(p)), 'PROPS carries the font-variation trio, grid template and margins');
  check(reusable('/nonexistent.json', 'u', { width: 1440, roots: ['main'] }) === false, 'reusable: a missing file is not reusable');
}
if (failures.length) { console.error(`lift-smoke: ${failures.length} pure failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('lift-smoke: pure cases passed');

// ---- browser
const root = pwRoot();
if (!root) skipBrowser('lift-smoke');
const staged = stageProjectCopy(root, ['lift.mjs', 'run-capped.mjs']);
const work = mkdtempSync(join(tmpdir(), 'lift-test-'));
const srv = await serveDir(FIXTURE);
try {
  const url = `${srv.url}/index.html`;
  const out1440 = join(work, 'fixture-1440.json'); const out360 = join(work, 'fixture-360.json');
  const r1 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '60', '--', process.execPath, staged.script('lift.mjs'), url, out1440, '--width', '1440', '--save-css'], staged.dir);
  check(r1.status === 0, `1440 lift exits 0 (got ${r1.status}): ${r1.out.slice(-600)}`);
  const j = existsSync(out1440) ? JSON.parse(readFileSync(out1440, 'utf8')) : null;
  check(j && j.schema === 1 && j.width === 1440 && j.dpr === 1 && Array.isArray(j.elements) && j.elements.length > 40, `record written with schema 1, width, dpr 1 and elements (got ${j && j.elements && j.elements.length})`);
  if (j) {
    const E = j.elements;
    const teaser = E.find((e) => e.cls === 'teaser');
    check(teaser && teaser.depth >= 20 && teaser.textLen === 300 && teaser.text.length === 300, `depth ≥ 20 and the 300-char teaser untruncated (got depth ${teaser && teaser.depth}, len ${teaser && teaser.textLen})`);
    const search = E.find((e) => e.cls === 'search');
    check(search && search.offset.left === 40 && search.rect.x >= 140 && typeof search.offset.offsetParent === 'number' && E[search.offset.offsetParent].cls === 'canvas', `absolute child: offset.left 40 vs rect.x ≥ 140, offsetParent = the canvas (got ${JSON.stringify(search && { off: search.offset, x: search.rect.x })})`);
    const imgs = E.filter((e) => e.tag === 'img' && e.inline);
    check(imgs.length === 3 && imgs.every((e) => /width:\s*\d+px;\s*height:\s*\d+px/.test(e.inline)) && new Set(imgs.map((e) => e.rect.h)).size === 3, `per-instance inline sizes on the icon strip (got ${JSON.stringify(imgs.map((e) => [e.inline, e.rect.h]))})`);
    const body = E.find((e) => e.tag === 'body') || E.find((e) => e.s && e.s.fontVariationSettings);
    check(E.some((e) => e.s && /opsz/.test(e.s.fontVariationSettings || '')), 'font-variation-settings recorded (inherited on descendants of body)');
    check(j.fontFaces.some((f) => f.fontFamily === 'Fixture Sans' && f.fontWeight === '100 900'), `@font-face from the linked sheet (got ${JSON.stringify(j.fontFaces)})`);
    check(j.mediaQueries.includes('(max-width: 768px)') && j.mediaQueries.includes('(min-width: 1200px)'), `exact @media conditions from the linked sheet AND the inline <style> (got ${JSON.stringify(j.mediaQueries)})`);
    const sup = E.find((e) => e.tag === 'sup');
    check(sup && sup.lineHeightUnitless === '1.5' && sup.s.lineHeight, `unitless line-height 1.5 traced to the <sup> from the matched rule (got ${JSON.stringify(sup && { u: sup.lineHeightUnitless, lh: sup.s.lineHeight })})`);
    const badge = E.find((e) => e.cls === 'badge');
    check(badge && badge.before && /★/.test(badge.before.content), `::before content recorded (got ${JSON.stringify(badge && badge.before)})`);
    const grid = E.find((e) => e.cls === 'grid');
    check(grid && grid.s.gridTemplateColumns && /px/.test(grid.s.gridTemplateColumns) && grid.s.display === 'grid', `gridTemplateColumns captured on the grid (got ${grid && grid.s.gridTemplateColumns})`);
    check(E.some((e) => e.headingLevel === 2) && E.filter((e) => e.headingLevel === 3).length === 3, 'heading levels recorded');
    const cards = E.filter((e) => e.cls === 'card');
    check(cards.length === 3 && cards[2].isLastChild === true && cards[2].s.marginBottom === '40px' && cards[0].isLastChild === false, `last-child margin on the block wrapper (got ${JSON.stringify(cards.map((c) => [c.isLastChild, c.s.marginBottom]))})`);
    check(j.sections.length === 5 && j.sections.every((s) => s.rect && typeof s.idx === 'number'), `sections[] from main (got ${j.sections.length})`);
    check(j.stylesheets.some((s) => !s.inline && /styles\.css/.test(s.url)) && j.stylesheets.some((s) => s.inline), 'stylesheets[] lists the linked sheet and the inline <style>');
    check(j.cssDir && existsSync(join(staged.dir, j.cssDir)) && readdirSync(join(staged.dir, j.cssDir)).length >= 2, `--save-css wrote the sheets under ${j.cssDir}`);
    check(j.rootsFound.every((r) => r.found) && E.some((e) => e.root === 'header') && E.some((e) => e.root === 'footer'), 'header, main and footer walked from one navigation');
    // D11 — per-property defaults: '1' is authored for flex-grow / z-index, default for opacity
    const nav = E.find((e) => e.tag === 'nav');
    check(nav && nav.s.flexGrow === '1', `flex-grow: 1 is recorded, not dropped as a default (got ${JSON.stringify(nav && nav.s.flexGrow)})`);
    check(search && search.s.zIndex === '1', `z-index: 1 is recorded (got ${JSON.stringify(search && search.s.zIndex)})`);
    check(!E.some((e) => e.s.opacity === '1' || e.s.flexShrink === '1'), 'opacity 1 / flex-shrink 1 stay dropped as defaults');
    // D12 — the <svg> element itself is lifted; its shapes are not
    const svg = E.find((e) => e.tag === 'svg');
    check(svg && svg.rect.w === 20 && svg.root === 'header', `the inline <svg> is recorded with its rect (got ${JSON.stringify(svg && svg.rect)})`);
    check(!E.some((e) => ['circle', 'path'].includes(e.tag)), 'svg children are not walked');
    check(j.consent && j.consent.mode === 'accept' && j.technique && j.capturedAt, 'provenance block (consent mode, technique, capturedAt)');
  }
  // cache: same url/width/roots → reusing, no navigation
  const r2 = await runAsync([staged.script('lift.mjs'), url, out1440, '--width', '1440'], staged.dir);
  check(r2.status === 0 && /reusing/.test(r2.out), `a second run reuses the record (got ${r2.status}: ${r2.out.slice(0, 160)})`);
  const before = j && j.capturedAt;
  const r3 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '60', '--', process.execPath, staged.script('lift.mjs'), url, out1440, '--width', '1440', '--refresh'], staged.dir);
  check(r3.status === 0 && JSON.parse(readFileSync(out1440, 'utf8')).capturedAt !== before, '--refresh re-probes and rewrites capturedAt');
  // 360: the media rule applied, docHeight differs
  const r4 = await runAsync([staged.script('run-capped.mjs'), '--timeout', '60', '--', process.execPath, staged.script('lift.mjs'), url, out360, '--width', '360'], staged.dir);
  const j360 = r4.status === 0 && existsSync(out360) ? JSON.parse(readFileSync(out360, 'utf8')) : null;
  check(j360 && j360.width === 360 && j360.docHeight !== (j && j.docHeight), `360 record differs in docHeight (got ${j360 && j360.docHeight} vs ${j && j.docHeight})`);
  const grid360 = j360 && j360.elements.find((e) => e.cls === 'grid');
  check(grid360 && grid360.s.gridTemplateColumns && grid360.s.gridTemplateColumns.split(' ').length === 1, `the 360 record shows the @media rule applied (one grid column; got ${grid360 && grid360.s.gridTemplateColumns})`);
} finally {
  await srv.close(); staged.cleanup(); rmSync(work, { recursive: true, force: true });
}
if (failures.length) { console.error(`lift-smoke: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('lift-smoke: browser cases passed');
