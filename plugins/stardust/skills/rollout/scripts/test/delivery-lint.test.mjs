#!/usr/bin/env node
// skills/rollout/scripts/test/delivery-lint.test.mjs — internal link hygiene judged by the target: a trailing slash on a leaf is P1 (404), on a folder index it is right, a folder index without it is P1 (404), an unknown target is a P2 advisory, .html stays P1 — except the widget mount /widgets/<path>/<name>.html?<params>, which must exist under widgets/ (P1 unknown-widget) and carry a block-safe stem (P1 widget-name). Whitespace-only spacers are a P2 per tag kind. A page without an <h1> whose source capture has none is a note; otherwise the P0 stands.
// Run: node plugins/stardust/skills/rollout/scripts/test/delivery-lint.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLint } from '../../../replica/scripts/gate-evidence.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const root = mkdtempSync(join(tmpdir(), 'delivery-lint-'));
const content = join(root, 'content'); mkdirSync(join(content, 'en', 'news'), { recursive: true });
writeFileSync(join(content, 'en', 'news', 'index.html'), '<main></main>');
writeFileSync(join(content, 'en', 'news', 'story.html'), '<main></main>');
mkdirSync(join(root, 'widgets', 'search'), { recursive: true }); writeFileSync(join(root, 'widgets', 'search', 'site-search.html'), '<div></div>');
const links = ['/en/news/', '/en/news', '/en/news/story/', '/en/news/story', '/en/other/', '/en/news/story.html', '/widgets/search/site-search.html?q=docs', '/widgets/search/finder.html', '/widgets/search/widget.html', '/widgets/search/results-wrapper.html'];
const page = join(content, 'page.html');
writeFileSync(page, `<main><div><p>${links.map((h) => `<a href="${h}">x</a>`).join(' ')}</p></div><div class="metadata"></div></main>`);
const lint = (...extra) => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json', ...extra], { cwd: root, encoding: 'utf8' }); return JSON.parse(r.stdout).findings.filter((f) => /slash|html-extension|widget/.test(f.rule)); };
const by = (fs) => Object.fromEntries(fs.map((f) => [f.msg.match(/: (\/\S*)/)[1], `${f.sev} ${f.rule}`]));

check('with the content tree: each link judged by its target', () => {
  assert.deepEqual(by(lint()), {
    '/en/news': 'P1 folder-index-slash',
    '/en/news/story/': 'P1 trailing-slash',
    '/en/other/': 'P2 trailing-slash',
    '/en/news/story.html': 'P1 html-extension',
    '/widgets/search/finder.html': 'P1 unknown-widget',
    '/widgets/search/widget.html': 'P1 widget-name',
    '/widgets/search/results-wrapper.html': 'P1 widget-name',
  }, 'the one sanctioned .html link is the widget mount; it is judged by its code file and stem, never by html-extension');
});
check('without a content tree: a trailing slash is only an advisory (it may be a folder index)', () => {
  const fs = by(lint('--content', join(root, 'missing')));
  assert.equal(fs['/en/news/'], 'P2 trailing-slash'); assert.equal(fs['/en/news/story/'], 'P2 trailing-slash'); assert.equal(fs['/en/news'], undefined);
  assert.equal(fs['/widgets/search/finder.html'], 'P1 unknown-widget', 'the code tree is the content tree\'s parent, missing content dir or not'); assert.equal(fs['/widgets/search/widget.html'], 'P1 widget-name');
});
check('no widgets/ in the code tree: the existence check is skipped, the stem rule still applies', () => {
  const other = mkdtempSync(join(tmpdir(), 'delivery-lint-nocode-')); mkdirSync(join(other, 'content'));
  const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json', '--content', join(other, 'content')], { cwd: other, encoding: 'utf8' });
  const fs = by(JSON.parse(r.stdout).findings.filter((f) => /widget/.test(f.rule)));
  assert.deepEqual(fs, { '/widgets/search/widget.html': 'P1 widget-name', '/widgets/search/results-wrapper.html': 'P1 widget-name' });
  rmSync(other, { recursive: true });
});
check('--help prints usage before any I/O', () => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--help'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.match(r.stdout, /delivery-lint/); });

// --- spacer-whitespace (P2, #112): whitespace-only <p>/<h1>–<h6> and <br>-only <div>, one finding per tag kind ---
const doc = (main) => `<html><body><header></header><main>${main}<div class="metadata"></div></main><footer></footer></body></html>`;
const lintFile = (file, ...extra) => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', file, '--json', ...extra], { cwd: root, encoding: 'utf8' }); return { status: r.status, ...JSON.parse(r.stdout) }; };
const spacerPage = join(root, 'spacers.html');
writeFileSync(spacerPage, doc(['<h1>Title</h1>', '<p>&nbsp;</p>', '<h2>  </h2>', '<p><br></p>', '<p>&#160;<br/></p>', '<P>\u00a0</P>', '<div><br><br></div>',
  '<p>Line one<br></p>', '<p>Text&nbsp;<br></p>', '<h3>Heading <br></h3>', '<div><div></div></div>', '<div>Cell<br></div>'].join('')));
check('spacer-whitespace: one P2 per tag kind with its count; text with a trailing <br> and empty divs are not flagged; exit stays 0', () => {
  const r = lintFile(spacerPage);
  const spacers = r.findings.filter((f) => f.rule === 'spacer-whitespace');
  assert.deepEqual(spacers.map((f) => `${f.sev} ${f.msg.split(' — ')[0]}`), ['P2 4 whitespace-only <p>', 'P2 1 whitespace-only <h2>', 'P2 1 whitespace-only <div>']);
  assert.match(spacers[0].msg, /dropped by the content pipeline: model the height as spacing CSS \(deploy SKILL\.md § The ENCODE contract, #112\)$/);
  assert.equal(r.status, 0); assert.equal(r.gate, 'PASS');
});
check('spacer-whitespace: a long raw-NBSP run is linear — no backtracking blow-up — and keeps the same findings', () => {
  const run = '\u00a0'.repeat(5000);
  const page = join(root, 'nbsp-run.html');
  writeFileSync(page, doc([`<h1>T</h1><p>${run}x</p>`, `<div>${run}<p>x</p></div>`, `<p>${run}</p>`, `<div>${run}<br></div>`].join('')));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `took ${ms} ms`); // node startup included, on a busy machine
  const spacers = JSON.parse(r.stdout).findings.filter((f) => f.rule === 'spacer-whitespace');
  assert.deepEqual(spacers.map((f) => f.msg.split(' — ')[0]), ['1 whitespace-only <p>', '1 whitespace-only <div>']);
});
check('spacer-whitespace: a long run of unclosed `<br ` fragments is linear — a <br> never spans the next tag — and flags only the real spacer', () => {
  const page = join(root, 'br-run.html');
  writeFileSync(page, doc(['<h1>T</h1>', '<p><br '.repeat(30000), '<div><br '.repeat(30000), '<p><br></p>'].join('')));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `took ${ms} ms`); // node startup included, on a busy machine
  const spacers = JSON.parse(r.stdout).findings.filter((f) => f.rule === 'spacer-whitespace');
  assert.deepEqual(spacers.map((f) => f.msg.split(' — ')[0]), ['1 whitespace-only <p>']);
});

// --- h1 against the source capture: a source without an h1 makes 0 a note; never a failure, never a pass for >1 ---
mkdirSync(join(root, 'stardust', 'current', 'pages'), { recursive: true }); mkdirSync(join(root, 'stardust', 'rollout', 'coverage'), { recursive: true });
const capture = (dir, slug, tags) => writeFileSync(join(dir, 'pages', `${slug}.json`), JSON.stringify({ slug, headings: tags.map((tag) => ({ tag, text: 'x' })) }));
capture(join(root, 'stardust', 'current'), 'plain', ['h2', 'h3']);
capture(join(root, 'stardust', 'current'), 'titled', ['h1', 'h2']);
writeFileSync(join(root, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: [{ slug: 'plain', path: '/en/plain' }, { slug: 'titled', path: '/en/titled' }] }));
const noH1 = join(root, 'no-h1.html'); writeFileSync(noH1, doc('<h2>Intro</h2><p>Body</p>'));
const twoH1 = join(root, 'two-h1.html'); writeFileSync(twoH1, doc('<h1>A</h1><h1>B</h1>'));
const h1Of = (r) => r.findings.filter((f) => f.rule === 'h1').map((f) => `${f.sev} ${f.msg}`);
const NOTE = 'note source has no h1 (recorded source trait) — content is never edited to satisfy a verifier';
check('h1: --slug names a capture without an h1 → a note, exit 0, gate PASS', () => {
  const r = lintFile(noH1, '--slug', 'plain');
  assert.deepEqual(h1Of(r), [NOTE]); assert.equal(r.status, 0); assert.equal(r.gate, 'PASS');
});
check('h1: --path resolves the slug through the coverage row (pathKey match), --current and --coverage are honoured', () => {
  assert.deepEqual(h1Of(lintFile(noH1, '--path', '/en/plain')), [NOTE]);
  const cur = join(root, 'other-current'); mkdirSync(join(cur, 'pages'), { recursive: true }); capture(cur, 'elsewhere', ['h2']);
  const cov = join(root, 'other-pages.json'); writeFileSync(cov, JSON.stringify({ pages: [{ slug: 'elsewhere', path: '/en/elsewhere' }] }));
  assert.deepEqual(h1Of(lintFile(noH1, '--path', '/en/elsewhere/index', '--current', cur, '--coverage', cov)), [NOTE]);
});
check('h1: a capture with an h1 keeps the P0; no capture consulted → the P0 names --slug', () => {
  const titled = lintFile(noH1, '--slug', 'titled');
  assert.deepEqual(h1Of(titled), ['P0 expected exactly one <h1>, found 0']); assert.equal(titled.status, 1);
  const hint = ['P0 expected exactly one <h1>, found 0 (no source capture consulted: pass --slug)'];
  assert.deepEqual(h1Of(lintFile(noH1)), hint);
  assert.deepEqual(h1Of(lintFile(noH1, '--slug', 'missing')), hint);
  assert.deepEqual(h1Of(lintFile(noH1, '--path', '/en/unknown')), hint);
});
check('h1: more than one <h1> stays P1 even when the source has none', () => {
  assert.deepEqual(h1Of(lintFile(twoH1, '--slug', 'plain')), ['P1 expected exactly one <h1>, found 2']);
});
check('text output: the count line stays parseable by gate evidence; the notes follow on their own line', () => {
  const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', noH1, '--slug', 'plain'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(parseLint(r.stdout), { p0: 0, p1: 0, p2: 0, line: '0 P0 · 0 P1 · 0 P2' });
  assert.match(r.stdout, /^0 P0 · 0 P1 · 0 P2\n· 1 note\(s\)\n$/m);
});
rmSync(root, { recursive: true });
process.exit(failed ? 1 : 0);
