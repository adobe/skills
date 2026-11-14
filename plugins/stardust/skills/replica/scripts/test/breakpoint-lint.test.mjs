#!/usr/bin/env node
// skills/replica/scripts/test/breakpoint-lint.test.mjs — the breakpoint-lint.mjs contract: every query form normalised to
// its switch point (min/max, range, reversed, em, 1px complementary pairs collapse, `max-width: 900px` ≠ 900), CSS read in
// @media preludes only (never declarations or comments), JS media strings and innerWidth comparisons read, interpolated
// features advisory, no target → skipped exit 0, off-target → exit 1 with file:line, DESIGN.json target read,
// --inventory distinct points, --help that reads nothing, usage errors on exit 2.
// Run: node plugins/stardust/skills/replica/scripts/test/breakpoint-lint.test.mjs   (well under 1 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTarget, switchPoints } from '../breakpoint-lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'breakpoint-lint.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'breakpoint-lint-test-')));

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const write = (base, rel, text) => { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), text); };
const px = (text, kind = 'css') => switchPoints(text, kind).map((h) => h.px);

check('min/max/range/reversed/em normalise to the switch point', () => {
  assert.deepEqual(px('@media (min-width: 900px) {}'), [900]);
  assert.deepEqual(px('@media (max-width: 899px) {}'), [900]);
  assert.deepEqual(px('@media (max-width: 900px) {}'), [901]);
  assert.deepEqual(px('@media (max-width: 899.98px) {}'), [900]);
  assert.deepEqual(px('@media (width >= 600px) {}'), [600]);
  assert.deepEqual(px('@media (width < 1200px) {}'), [1200]);
  assert.deepEqual(px('@media (width <= 767px) {}'), [768]);
  assert.deepEqual(px('@media (width > 1023px) {}'), [1024]);
  assert.deepEqual(px('@media (600px <= width < 900px) {}'), [600, 900]);
  assert.deepEqual(px('@media screen and (min-width: 56.25em) {}'), [900]);
  assert.deepEqual(px('@media (min-width: 0) {}'), []);
});

check('complementary 1px pair is one switch point', () => {
  assert.deepEqual(px('@media (max-width: 840px) { a{} } @media (min-width: 841px) { b{} }'), [841, 841]);
});

check('CSS: declarations and comments are not queries; line numbers kept', () => {
  const css = '.c { max-width: 1200px; min-width: 320px; }\n/* @media (min-width: 777px) */\n\n@media (min-width: 900px) {\n.c { max-width: 600px; } }\n';
  const hits = switchPoints(css, 'css');
  assert.deepEqual(hits.map((h) => [h.px, h.line, h.form]), [[900, 4, 'min']]);
});

check('JS: matchMedia strings, constants, innerWidth both ways; inline styles and element widths ignored', () => {
  const js = [
    "const isDesktop = window.matchMedia('(min-width: 1024px)');",
    "const MQ = '(width >= 768px)';",
    'if (window.innerWidth < 1024) {}',
    'if (900 <= innerWidth) {}',
    'if (document.documentElement.clientWidth > 599) {}',
    "el.style.cssText = 'max-width: 600px';",
    'if (card.clientWidth < 300) {}',
    "// matchMedia('(min-width: 777px)')",
  ].join('\n');
  assert.deepEqual(switchPoints(js, 'js').map((h) => [h.px, h.line]), [[1024, 1], [768, 2], [1024, 3], [900, 4], [600, 5]]);
});

check('JS: an interpolated feature is advisory (px null), never a number', () => {
  const hits = switchPoints('const q = matchMedia(`(min-width: ${BP}px)`);', 'js');
  assert.deepEqual(hits.map((h) => [h.px, h.form]), [[null, '?']]);
});

check('parseTarget: sorted unique positive integers, else null', () => {
  assert.deepEqual(parseTarget('1200, 600,900,600'), [600, 900, 1200]);
  assert.deepEqual(parseTarget([900, 600]), [600, 900]);
  assert.equal(parseTarget('600,abc'), null);
  assert.equal(parseTarget([]), null);
});

const proj = join(root, 'proj');
write(proj, 'styles/styles.css', '@media (width >= 900px) { :root { --nav-height: 64px; } }\n');
write(proj, 'blocks/header/header.js', "const isDesktop = window.matchMedia('(width >= 900px)');\n");
write(proj, 'blocks/cards/cards.css', '.cards { display: grid; }\n@media (max-width: 599px) { .cards { gap: 8px; } }\n');
write(proj, 'blocks/cards/vendor.min.js', "matchMedia('(min-width: 1234px)');\n");
write(proj, 'node_modules/x/x.css', '@media (min-width: 1234px) {}\n');

check('no target anywhere → skipped, exit 0', () => {
  const r = run(proj);
  assert.equal(r.code, 0); assert.match(r.out, /no target set — skipped/);
});

check('clean against --target (min.js and node_modules not walked)', () => {
  const r = run(proj, '--target', '600,900,1200');
  assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /clean — 3 switches in 3 files, all on 600,900,1200/);
});

check('off-target → exit 1, one file:line row each, summary', () => {
  write(proj, 'blocks/hero/hero.css', '\n@media (min-width: 1024px) { .hero { height: 60vh; } }\n');
  const r = run(proj, '--target', '600,900,1200');
  assert.equal(r.code, 1);
  assert.match(r.out, /blocks\/hero\/hero\.css:2 {2}min-width: 1024px {2}→ switches at 1024px/);
  assert.match(r.out, /breakpoint-lint: 1 off-target in 1 files \(target 600,900,1200\)/);
});

check('a prototype dir lints its inline <style> and <source media> (.html)', () => {
  const protos = join(root, 'protos');
  write(protos, 'home-proposed.html', '<style>\n@media (min-width: 768px) { .x { a: b } }\n</style>\n<source media="(min-width: 900px)">\n');
  const r = run(root, '--root', protos, '--dirs', '.', '--target', '600,900,1200');
  assert.equal(r.code, 1);
  assert.match(r.out, /home-proposed\.html:2 {2}min-width: 768px {2}→ switches at 768px/);
  assert.doesNotMatch(r.out, /900px  →/);
});

check('target read from DESIGN.json extensions.breakpoints.target; bad value → exit 2', () => {
  write(proj, 'DESIGN.json', JSON.stringify({ extensions: { breakpoints: { containerMaxWidth: 1200, target: [600, 900, 1024, 1200] } } }));
  assert.equal(run(proj).code, 0);
  write(proj, 'DESIGN.json', JSON.stringify({ extensions: { breakpoints: { target: ['wide'] } } }));
  const r = run(proj);
  assert.equal(r.code, 2); assert.match(r.err, /not a list of positive integers/);
});

check('--inventory lists distinct switch points with min/max split', () => {
  const live = join(root, 'live');
  write(live, 'site.css', '@media (max-width: 840px){} @media (min-width: 841px){} @media (min-width: 1024px){}');
  write(live, 'page.html', '<picture><source media="(min-width: 1024px)" srcset="a.jpg"></picture>');
  const r = run(root, '--inventory', live);
  assert.equal(r.code, 0);
  assert.match(r.out, / {2}841px {2}×2 {2}min 1 \/ max 1/);
  assert.match(r.out, / 1024px {2}×2 {2}min 2 \/ max 0/);
  assert.match(r.out, /2 distinct switch points/);
});

check('--help reads nothing; usage errors exit 2 with one stderr line', () => {
  const empty = mkdtempSync(join(tmpdir(), 'breakpoint-lint-help-'));
  const h = run(empty, '--help');
  assert.equal(h.code, 0); assert.match(h.out, /Usage:/); assert.deepEqual(readdirSync(empty), []);
  rmSync(empty, { recursive: true, force: true });
  for (const args of [['--bogus'], ['--target'], ['--target', '9x'], ['--inventory']]) {
    const r = run(proj, ...args);
    assert.equal(r.code, 2, args.join(' ')); assert.equal(r.err.trim().split('\n').length, 1);
  }
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${checks - failed}/${checks} passed`);
process.exit(failed ? 1 : 0);
