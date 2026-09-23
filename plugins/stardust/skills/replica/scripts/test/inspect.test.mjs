#!/usr/bin/env node
// skills/replica/scripts/test/inspect.test.mjs — the four inspection helpers' contracts:
// section.mjs (outline, one section, fences ignored, caps), css-rules.mjs (nested @media,
// raw at-rules, strings/comments/data URIs, filters, minified offsets), json-query.mjs (shape,
// table, --match/--fields/--keys/--path, caps, --tsv whole values, the truncation footer),
// html-slice.mjs (nesting, attribute stripping,
// svg/script removal, --text, --all, void tags). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, splitDeclarations } from '../css-rules.mjs';
import { outline, section } from '../section.mjs';
import { getPath, matches, parseMatch, shape, tsv } from '../json-query.mjs';
import { clean, findElements, parseSelector } from '../html-slice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = (name) => join(HERE, '..', name);
const dir = mkdtempSync(join(tmpdir(), 'inspect-test-'));
const run = (script, ...args) => { const r = spawnSync(process.execPath, [S(script), ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// ---- fixtures -----------------------------------------------------------------------------------
const MD = `# Title\n\nintro\n\n## Setup\n\nstep one\n\n\`\`\`bash\n# not a heading\necho hi\n\`\`\`\n\n### Sub of setup\n\nnested\n\n## Iteration discipline\n\n${Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')}\n\n## Residuals\n\nend\n`;
const md = join(dir, 'doc.md'); writeFileSync(md, MD);
const CSS = `@charset "UTF-8";\n@import url("x.css");\n/* comment { with brace } */\n.a, .b { color: red; content: "}"; background: url(data:image/svg+xml;base64,AAAA) no-repeat }\n@media (min-width: 1024px) {\n  .cmp-teaser__title { font-size: 32px; line-height: 40px }\n  @supports (display: grid) { .grid { display: grid } }\n}\n@font-face { font-family: X; src: url(x.woff2) }\n@keyframes spin { from { transform: none } to { transform: rotate(1turn) } }\n.cmp-teaser__title { font-size: 20px; margin: 0 }\n`;
const css = join(dir, 'site.css'); writeFileSync(css, CSS);
const cssMin = join(dir, 'site.min.css'); writeFileSync(cssMin, CSS.replace(/\n\s*/g, ''));
const JSON_DOC = { url: 'https://example.test/', width: 1440, docHeight: 3754, fontsFailed: [], elements: [
  { _rect: { x: 0, y: 0, w: 1440, h: 194 }, _tag: 'header', _class: 'experiencefragment header', _text: 'SIGN IN' },
  { _rect: { x: 0, y: 200, w: 1440, h: 600 }, _tag: 'div', _class: 'cmp-teaser', _text: 'Adventures', extra: true },
  { _rect: { x: 0, y: 800, w: 1440, h: 300 }, _tag: 'div', _class: 'cmp-teaser cmp-teaser--dark', _text: 'Surf' },
  { _rect: { x: 0, y: 1100, w: 1440, h: 80 }, _tag: 'footer', _class: 'footer', _text: 'Legal' },
], main: [{ type: 'carousel', slides: [{ label: 'Slide 1 of 3', indicator: 'A' }, { label: 'Slide 2 of 3', indicator: 'B' }] }] };
const json = join(dir, 'styles.json'); writeFileSync(json, JSON.stringify(JSON_DOC));
const LONG_URL = `https://example.test/${'segment/'.repeat(22)}index.html`; // 207 chars — longer than any table cell
const CRAWL = { pages: [{ slug: 'home', url: LONG_URL, title: 'Home\tsweet\nhome', depth: 0 }, { slug: 'about', url: 'https://example.test/about', title: 'About', depth: 1 }] };
const crawl = join(dir, 'crawl.json'); writeFileSync(crawl, JSON.stringify(CRAWL));
const HTML = `<!DOCTYPE html><html><head><title>t</title><style>.x{}</style></head><body class="page">\n<header class="site-header" data-cmp-is="header" id="top">\n<!-- nav -->\n<nav class="cmp-nav"><ul><li><a href="/a.html" data-track="1" class="lnk">A</a></li><li><a href="/b.html">B</a></li></ul></nav>\n<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>\n<div class="inner"><div class="deep">deep</div></div>\n<script>window.x = 1;</script>\n<img src="/logo.png" alt="Logo" width="10">\n</header>\n<main><div class="cmp-teaser">One</div><div class="cmp-teaser dark">Two</div></main>\n<footer><p>Legal &nbsp; text</p></footer></body></html>`;
const html = join(dir, 'page.html'); writeFileSync(html, HTML);

// ---- section ------------------------------------------------------------------------------------
check('section: outline skips headings inside fences and computes lengths', () => {
  const o = outline(MD);
  assert.deepEqual(o.map((h) => `${h.level}:${h.title}`), ['1:Title', '2:Setup', '3:Sub of setup', '2:Iteration discipline', '2:Residuals']);
  const setup = o.find((h) => h.title === 'Setup'); const sub = o.find((h) => h.title === 'Sub of setup');
  assert.ok(setup.end === sub.end, 'a ## section runs through its ### children'); assert.ok(setup.length > sub.length);
  const r = run('section.mjs', md, '--list'); assert.equal(r.code, 0); assert.match(r.out, /doc\.md: 5 headings/); assert.match(r.out, /^L\s+5\s+## Setup\s+\(13 lines\)/m); assert.match(r.out, /^L\s+14\s+### Sub of setup/m);
});
check('section: one heading by regex, case-insensitive, body to the next same-level heading', () => {
  const r = run('section.mjs', md, 'ITERATION');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^## Iteration discipline$/m); assert.match(r.out, /line 12/); assert.doesNotMatch(r.out, /## Residuals/); assert.doesNotMatch(r.out, /step one/);
});
check('section: --max-lines caps and names the remaining range; --level filters', () => {
  const r = run('section.mjs', md, 'iteration', '--max-lines', '4');
  assert.match(r.out, /line 2/); assert.doesNotMatch(r.out, /line 12/); assert.match(r.out, /… \d+ more lines \(L\d+–L\d+\)/);
  assert.equal(run('section.mjs', md, 'setup', '--level', '3').code, 0); // matches "Sub of setup"
  assert.equal(run('section.mjs', md, 'setup', '--level', '3').out.includes('### Sub of setup'), true);
});
check('section: no match exits 2 and prints the outline to stderr; usage exits 125', () => {
  const r = run('section.mjs', md, 'nope');
  assert.equal(r.code, 2); assert.match(r.err, /no heading matches/); assert.match(r.err, /## Residuals/);
  assert.equal(run('section.mjs', md).code, 125); assert.equal(run('section.mjs').code, 125);
  assert.equal(section(MD, /nope/), null);
});

// Multi-section cap (74-char lines): Alpha ≈ 14 KB, Beta ≈ 22 KB (alone above the cap), Gamma ≈ 0.8 KB.
const BIG = (tag, n) => Array.from({ length: n }, (_, i) => `${tag} line ${String(i + 1).padStart(3, '0')} ${'x'.repeat(60)}`).join('\n');
const MD2 = `# Big\n\n## Alpha\n\n${BIG('alpha', 190)}\n\n## Beta\n\n${BIG('beta', 300)}\n\n## Gamma\n\n${BIG('gamma', 10)}\n`;
const md2 = join(dir, 'big.md'); writeFileSync(md2, MD2);
check('section: --all over the 20 KB cap prints the sections that fit, then one final NOTE naming the omitted ones with sizes; exit 0', () => {
  const r = run('section.mjs', md2, '^(alpha|beta|gamma)$', '--all');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^## Alpha$/m); assert.match(r.out, /alpha line 190/, 'the first section prints whole');
  assert.doesNotMatch(r.out, /beta line 001/, 'Beta would push the total past 20 KB');
  assert.match(r.out, /^## Gamma$/m); assert.match(r.out, /gamma line 010/, 'a later section that still fits is printed');
  assert.ok(r.out.length <= 20 * 1024, `output stays within the cap (${r.out.length} chars)`);
  const last = r.out.trimEnd().split('\n').pop();
  assert.match(last, /^NOTE: 1 section\(s\) omitted \(Beta 22\.\d KB\) — request them one at a time$/, `last line: ${last}`);
  const first = run('section.mjs', md2, '^(beta|gamma)$', '--all'); // the first match alone exceeds the cap
  assert.equal(first.code, 0); assert.doesNotMatch(first.out, /beta line 001/); assert.match(first.out, /gamma line 010/);
  assert.match(first.out.trimEnd().split('\n').pop(), /^NOTE: 1 section\(s\) omitted \(Beta 22\.\d KB\)/);
});
check('section: a single section is never truncated by the cap; --all under the cap prints no NOTE', () => {
  const r = run('section.mjs', md2, 'beta'); assert.equal(r.code, 0, r.err); assert.match(r.out, /beta line 300/); assert.doesNotMatch(r.out, /NOTE:/);
  const two = run('section.mjs', md2, '^(alpha|gamma)$', '--all'); assert.equal(two.code, 0); assert.match(two.out, /alpha line 190/); assert.match(two.out, /gamma line 010/); assert.doesNotMatch(two.out, /NOTE:/);
});
// ---- css-rules ----------------------------------------------------------------------------------
check('css-rules: parser handles comments, strings, data URIs, nested conditionals and raw at-rules', () => {
  const rules = parseCss(CSS);
  const sel = rules.map((r) => r.selector);
  assert.ok(sel.includes('@charset "UTF-8"') && sel.includes('@import url("x.css")'), 'statement at-rules kept');
  const ab = rules.find((r) => r.selector === '.a, .b');
  assert.deepEqual(splitDeclarations(ab.body), ['color: red', 'content: "}"', 'background: url(data:image/svg+xml;base64,AAAA) no-repeat']);
  const title = rules.filter((r) => r.selector === '.cmp-teaser__title');
  assert.equal(title.length, 2); assert.deepEqual(title[0].media, ['@media (min-width: 1024px)']); assert.deepEqual(title[1].media, []);
  const grid = rules.find((r) => r.selector === '.grid'); assert.deepEqual(grid.media, ['@media (min-width: 1024px)', '@supports (display: grid)']);
  assert.ok(rules.find((r) => r.selector === '@font-face').body.includes('font-family: X'));
  assert.ok(rules.find((r) => r.selector === '@keyframes spin').body.includes('to { transform: rotate(1turn) }'));
  assert.ok(!sel.some((s) => s.includes('comment')), 'comments are not rules');
});
check('css-rules: selector regex, --media, --no-media, --decl, --count, line numbers', () => {
  const r = run('css-rules.mjs', css, 'cmp-teaser__title');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /2 of \d+ rules match/); assert.match(r.out, /^L6 \.cmp-teaser__title\s+@media \(min-width: 1024px\)\n\s+font-size: 32px; line-height: 40px;/m); assert.match(r.out, /^L11 \.cmp-teaser__title\n\s+font-size: 20px; margin: 0;/m);
  assert.match(run('css-rules.mjs', css, 'cmp-teaser__title', '--media', '1024').out, /1 of \d+ rules/);
  assert.match(run('css-rules.mjs', css, 'cmp-teaser__title', '--no-media').out, /L11/);
  const d = run('css-rules.mjs', css, 'cmp-teaser__title', '--decl', 'line-height'); assert.match(d.out, /1 of \d+/); assert.match(d.out, /line-height: 40px;\s+\(\+1 more\)/);
  assert.match(run('css-rules.mjs', css, '^\\.cmp', '--count').out, /^2 of \d+ rules match/);
  const none = run('css-rules.mjs', css, 'nothing-here'); assert.equal(none.code, 2); assert.match(none.err, /no rule of \d+ matches/);
  assert.match(run('css-rules.mjs', css, '.', '--max', '2').out, /… \d+ more — narrow/);
});
check('css-rules: a minified sheet reports byte offsets instead of lines', () => {
  const r = run('css-rules.mjs', cssMin, 'cmp-teaser__title'); assert.equal(r.code, 0); assert.match(r.out, /^@\d+ \.cmp-teaser__title/m);
});

// ---- json-query ---------------------------------------------------------------------------------
check('json-query: root shape, --path object/array/scalar, missing path exits 2 with the shape', () => {
  const r = run('json-query.mjs', json);
  assert.equal(r.code, 0); assert.match(r.out, /object\{6\}/); assert.match(r.out, /elements: array\[4\] of object/); assert.match(r.out, /url: string\(21\)/); assert.match(r.out, /fontsFailed: array\[0\] of empty/);
  assert.match(run('json-query.mjs', json, '--path', 'width').out, /number 1440/);
  assert.match(run('json-query.mjs', json, '--path', 'elements[1]._rect').out, /x: number 0/);
  const miss = run('json-query.mjs', json, '--path', 'nope.deeper'); assert.equal(miss.code, 2); assert.match(miss.err, /nothing at path/); assert.match(miss.err, /elements: array/);
  assert.equal(getPath(JSON_DOC, 'main[0].slides.1.label'), 'Slide 2 of 3');
});
check('json-query: table with default fields, --match (dotted, negated), --fields (dotted), --max footer', () => {
  const r = run('json-query.mjs', json, '--path', 'elements');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /showing 4 rows × 3 fields; other keys: _rect$/m); // from the first item; `--keys` is the union assert.match(r.out, /^#\s+_tag\s+_class\s+_text/m); assert.match(r.out, /^1\s+div\s+cmp-teaser\s+Adventures/m);
  const m = run('json-query.mjs', json, '--path', 'elements', '--match', '_class=(^| )cmp-teaser( |$)', '--fields', '_rect.y,_rect.h,_class');
  assert.match(m.out, /2 of 4 match/); assert.match(m.out, /^0\s+200\s+600\s+cmp-teaser$/m); assert.match(m.out, /^1\s+800\s+300\s+cmp-teaser cmp-teaser--dark/m);
  assert.match(run('json-query.mjs', json, '--path', 'elements', '--match', '_tag!=div', '--fields', '_tag').out, /2 of 4 match[\s\S]*header[\s\S]*footer/);
  const capped = run('json-query.mjs', json, '--path', 'elements', '--max', '2'); assert.match(capped.out, /… 2 more rows/);
  assert.match(run('json-query.mjs', json, '--path', 'elements', '--count', '--match', '_class=teaser').out, /2 of 4 items/);
  assert.equal(matches({ a: { b: 'Hello' } }, [parseMatch('a.b=^hel')]), true); assert.equal(matches({ a: 1 }, [parseMatch('a!=1')]), false);
});
check('json-query: --keys union with counts; nested path table; shape --depth', () => {
  const k = run('json-query.mjs', json, '--path', 'elements', '--keys'); assert.match(k.out, /_class: 4× string/); assert.match(k.out, /extra: 1× boolean/);
  const n = run('json-query.mjs', json, '--path', 'main[0].slides', '--fields', 'label'); assert.match(n.out, /^1\s+Slide 2 of 3/m);
  assert.ok(shape(JSON_DOC, { depth: 2 }).some((l) => /^\s+\[0\]\._tag: string/.test(l)), 'depth 2 describes the first array item');
  assert.equal(run('json-query.mjs', json, '--match', 'bad').code, 125);
});
check('json-query: --tsv prints whole values, escapes tab/newline, honours --fields order and --no-header', () => {
  const r = run('json-query.mjs', crawl, '--path', 'pages', '--fields', 'url,slug', '--tsv');
  assert.equal(r.code, 0, r.err); const lines = r.out.trimEnd().split('\n');
  assert.deepEqual(lines, ['url\tslug', `${LONG_URL}\thome`, 'https://example.test/about\tabout']);
  const t = run('json-query.mjs', crawl, '--path', 'pages', '--fields', 'slug,title', '--tsv', '--no-header');
  assert.deepEqual(t.out.trimEnd().split('\n'), ['home\tHome\\tsweet\\nhome', 'about\tAbout']);
  assert.equal(run('json-query.mjs', crawl, '--path', 'pages', '--tsv', '--no-header', '--match', 'slug=about').out.trimEnd(), 'about\thttps://example.test/about\tAbout\t1'); // default fields = all scalars
  assert.equal(run('json-query.mjs', crawl, '--path', 'pages', '--tsv', '--max', '1').out.trimEnd().split('\n').length, 3, '--max does not apply to --tsv');
  assert.deepEqual(tsv([{ a: 'x\ty', b: null, c: { d: 1 } }], ['a', 'b', 'c', 'missing'], { header: false }), ['x\\ty\tnull\t{"d":1}\t']);
});
check('json-query: the table marks a cut cell with … and one footer; --path to a long string prints it whole; --help exits 0', () => {
  const r = run('json-query.mjs', crawl, '--path', 'pages', '--fields', 'slug,url');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^0\s+home\s+https:\/\/example\.test\/segment\/\S*…$/m); assert.doesNotMatch(r.out, /index\.html/);
  assert.equal((r.out.match(/cell\(s\) truncated/g) || []).length, 1);
  assert.match(r.out, /\n1 cell\(s\) truncated at --width 48 — full values: --tsv, or --path pages\[<#>\]\.<field>\n$/, 'the footer is the last line');
  assert.doesNotMatch(run('json-query.mjs', crawl, '--path', 'pages', '--fields', 'slug,depth').out, /truncated/, 'no footer when nothing was cut');
  assert.match(run('json-query.mjs', crawl, '--path', 'pages', '--fields', 'slug,url', '--width', '300').out, /index\.html/);
  const p = run('json-query.mjs', crawl, '--path', 'pages[0].url'); assert.equal(p.code, 0, p.err); assert.match(p.out, /string\(207\)/); assert.ok(p.out.split('\n').includes(LONG_URL), 'the whole string on its own line');
  const h = run('json-query.mjs', '--help'); assert.equal(h.code, 0); assert.match(h.out, /Usage/); assert.match(h.out, /--tsv/);
});

// ---- html-slice ---------------------------------------------------------------------------------
check('html-slice: selector forms, depth-aware end tag, void elements', () => {
  assert.deepEqual(parseSelector('div.cmp-teaser'), { tag: 'div', cls: 'cmp-teaser', id: null }); assert.deepEqual(parseSelector('#top'), { tag: null, cls: null, id: 'top' });
  assert.throws(() => parseSelector('div > p'));
  const [h] = findElements(HTML, parseSelector('header')); assert.ok(h.html.startsWith('<header') && h.html.endsWith('</header>'));
  const [inner] = findElements(HTML, parseSelector('.inner')); assert.equal(inner.html, '<div class="inner"><div class="deep">deep</div></div>');
  const [img] = findElements(HTML, parseSelector('img')); assert.equal(img.html, '<img src="/logo.png" alt="Logo" width="10">');
  assert.equal(findElements(HTML, parseSelector('.cmp-teaser'), { all: true }).length, 2);
});
check('html-slice: cleaning keeps structural attributes only, drops script/comment, collapses svg', () => {
  const out = clean(findElements(HTML, parseSelector('header'))[0].html);
  assert.match(out, /<header class="site-header" id="top">/); assert.doesNotMatch(out, /data-cmp-is|data-track|width="10"/);
  assert.doesNotMatch(out, /window\.x|<!--/); assert.match(out, /<svg\/>/); assert.match(out, /<a class="lnk" href="\/a.html">A<\/a>/); // kept attributes come out in --keep-attrs order assert.match(out, /<img src="\/logo.png" alt="Logo">/);
  assert.ok(out.split('\n').length >= 4, 'block elements start new lines');
});
check('html-slice: CLI first match, --all, --text, --count, caps, no match exits 2', () => {
  const r = run('html-slice.mjs', html, 'header'); assert.equal(r.code, 0, r.err); assert.match(r.out, /<header> at \d+–\d+ \(\d+ chars raw, \d+ cleaned\)/); assert.match(r.out, /class="site-header"/);
  const all = run('html-slice.mjs', html, '.cmp-teaser', '--all'); assert.equal((all.out.match(/<div> at/g) || []).length, 2);
  const t = run('html-slice.mjs', html, 'footer', '--text'); assert.match(t.out, /^Legal text$/m); assert.doesNotMatch(t.out, /<p>/);
  assert.match(run('html-slice.mjs', html, '.cmp-teaser', '--count').out, /2 element\(s\) match/);
  const cap = run('html-slice.mjs', html, 'header', '--max-chars', '40'); assert.match(cap.out, /… truncated at 40 of \d+ chars/);
  const none = run('html-slice.mjs', html, '.nope'); assert.equal(none.code, 2); assert.match(none.err, /no element matches/);
  assert.equal(run('html-slice.mjs', html, 'a b').code, 125);
});

// ---- value-flag swallow rule (all four) ---------------------------------------------------------
// A value flag followed by nothing or by another --flag is a usage error (125) naming the flag —
// the next flag is never swallowed as the value.
check('section: --level / --max-lines without a value, or followed by another --flag, exit 125 naming the flag', () => {
  for (const args of [[md, 'setup', '--level'], [md, 'setup', '--max-lines'], [md, 'setup', '--level', '--all'], [md, '--max-lines', '--list']]) {
    const r = run('section.mjs', ...args); const flag = args.includes('--level') ? '--level' : '--max-lines';
    assert.equal(r.code, 125, args.join(' ')); assert.match(r.err, new RegExp(`^section: ${flag} needs a value`)); assert.equal(r.out, '');
  }
  assert.equal(run('section.mjs', md, 'setup', '--level', '3', '--all').code, 0, 'a real value still parses');
});
check('css-rules: --media / --decl / --max without a value, or followed by another --flag, exit 125 naming the flag', () => {
  for (const [flag, ...tail] of [['--media'], ['--decl'], ['--max'], ['--media', '--no-media'], ['--decl', '--count'], ['--max', '--media', '1024']]) {
    const r = run('css-rules.mjs', css, 'cmp-teaser__title', flag, ...tail);
    assert.equal(r.code, 125, `${flag} ${tail.join(' ')}`); assert.match(r.err, new RegExp(`^css-rules: ${flag} needs a value`)); assert.equal(r.out, '');
  }
  assert.equal(run('css-rules.mjs', css, 'cmp-teaser__title', '--media', '1024', '--count').code, 0, 'a real value still parses');
});
check('json-query: --path / --match / --fields / --max / --width / --depth without a value, or followed by another --flag, exit 125 naming the flag', () => {
  for (const [flag, ...tail] of [['--path'], ['--match'], ['--fields'], ['--max'], ['--width'], ['--depth'], ['--path', '--keys'], ['--fields', '--tsv'], ['--max', '--path', 'elements'], ['--depth', '--count']]) {
    const r = run('json-query.mjs', json, flag, ...tail);
    assert.equal(r.code, 125, `${flag} ${tail.join(' ')}`); assert.match(r.err, new RegExp(`^json-query: ${flag} needs a value`)); assert.equal(r.out, '');
  }
  assert.equal(run('json-query.mjs', json, '--path', 'elements', '--keys').code, 0, 'a real value still parses');
});
check('html-slice: --keep-attrs / --max-chars without a value, or followed by another --flag, exit 125 naming the flag', () => {
  for (const [flag, ...tail] of [['--keep-attrs'], ['--max-chars'], ['--keep-attrs', '--text'], ['--max-chars', '--all']]) {
    const r = run('html-slice.mjs', html, 'header', flag, ...tail);
    assert.equal(r.code, 125, `${flag} ${tail.join(' ')}`); assert.match(r.err, new RegExp(`^html-slice: ${flag} needs a value`)); assert.equal(r.out, '');
  }
  assert.equal(run('html-slice.mjs', html, 'header', '--keep-attrs', 'class', '--text').code, 0, 'a real value still parses');
});

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\ninspect helpers: all checks passed');
process.exit(failed ? 1 : 0);
