#!/usr/bin/env node
// skills/extract/scripts/test/extract-report.test.mjs — the extract-report.mjs contract: both page shapes
// (the crawler's record and the documented schema) summarised into outline, modules, brand tokens and slot
// candidates; the outline's levels, indentation, 80-char cut and 40-heading cap; the colour / font / other
// split; the h1 and body fallbacks of the slots; --pages by slug and by path; --json uncapped with texts
// whole; the aggregate line; no page → exit 2; a malformed page noted and skipped, _crawl-log.json never
// read as a page; --help and every run writing nothing. Fixtures are written by the test into a temp
// project. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyToken, formatPage, globToRegExp, isFontFamilyList, parseArgs, selectPages, summarizePage } from '../extract-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'extract-report.mjs');
const root = mkdtempSync(join(tmpdir(), 'extract-report-test-'));
let seq = 0;
const project = () => { seq += 1; const d = join(root, `p${seq}`); mkdirSync(d); return d; };
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const put = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`); };
const PAGES = join('stardust', 'current', 'pages');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// ---- fixtures -----------------------------------------------------------------------------------
const LONG = `A heading that runs well past the eighty character cut of the outline view ${'x'.repeat(60)}`;
const COLOURS = Array.from({ length: 13 }, (_, i) => [`--c-${String(i + 1).padStart(2, '0')}`, `#${String(i + 1).padStart(6, '0')}`]);
// The crawler's record (crawl.mjs): headings by tag, body strings, customProps map, media.imgs, no slug.
const CRAWLED = {
  url: 'https://example.com/',
  title: 'Example home',
  description: 'The example home page.',
  headings: [
    { tag: 'h1', text: 'Welcome to Example' },
    { tag: 'h2', text: 'What we do' },
    { tag: 'h3', text: LONG },
    { tag: 'h2', text: '' },
    ...Array.from({ length: 42 }, (_, i) => ({ tag: 'h4', text: `Item ${i + 1}` })),
  ],
  body: ['  The first   paragraph is the lede.  ', 'Second paragraph.'],
  ctas: [
    { label: 'Get started', href: '/start' },
    { label: 'Get started', href: '/start-again' },
    ...Array.from({ length: 9 }, (_, i) => ({ label: `Link ${i + 1}`, href: `/l${i + 1}` })),
  ],
  customProps: {
    ...Object.fromEntries(COLOURS),
    '--c-rgb': 'rgb(255, 255, 255)',
    '--c-hsl': ' hsl(210 40% 50%)',
    '--font-body': 'Inter, sans-serif',
    '--heading': '"Example Sans", Georgia, serif',
    '--font-size-lg': '1.25rem',
    '--radius': '8px',
    '--shadow': '0 1px 2px rgba(0, 0, 0, 0.1)',
    '--easing': 'ease-in-out',
  },
  media: { imgs: [{ src: 'https://example.com/a.jpg', alt: 'A' }, { src: 'https://example.com/b.jpg', alt: '' }, { src: 'https://example.com/c.jpg', alt: 'C' }], videos: [{ src: null }], iframes: [] },
  codeBlocks: ['npm i example'],
  dynamic: { forms: [{ action: null }, { action: null }] },
};
// The documented shape (current-state-schema.md): levels, hero fields, landmarks, components, cssCustomProperties.
const DOCUMENTED = {
  slug: 'about',
  url: 'https://example.com/about',
  title: 'About Example',
  metaDescription: 'Who we are.',
  heroHeadline: 'Designed for the way you work',
  heroLede: 'One platform for the whole team.',
  themeColor: { light: '#ffffff', dark: '#0a0a0a' },
  headings: [
    { level: 2, text: 'Our story', style: { fontFamily: 'Inter, system-ui' } },
    { level: 3, text: 'Since the start', style: { fontFamily: '"Example Serif", serif' } },
    { level: 2, text: 'Team', style: { fontFamily: 'Inter' } },
  ],
  landmarks: [
    { tag: 'header', children: [{ tag: 'div', purpose: 'footer-nav' }] },
    { tag: 'main', role: 'main', children: [
      { tag: 'section', id: 'hero', classes: ['hero', 'hero--dark'], purpose: 'hero', headlineRef: 0, body: ['p1', 'p2'], lists: [], qa: [], quotes: [] },
      { tag: 'section', id: null, classes: ['team'], purpose: 'feature-list', headlineRef: 2, body: [], lists: [{ items: ['a'] }], qa: [{ q: 'Q', a: 'A' }], quotes: [{ text: 'Q1' }, { text: 'Q2' }] },
      { tag: 'div', classes: [], purpose: 'cta-band', body: ['Ready?'], lists: [], qa: [], quotes: [] },
    ] },
  ],
  components: { cards: { count: 3 }, grids: { count: 0 }, tabs: { count: 1 }, other: [] },
  cssCustomProperties: [{ name: '--brand', value: 'oklch(0.6 0.2 250)' }, { name: '--font-display', value: 'Example Serif' }, { name: '--radius', value: '12px' }],
  perSectionStyle: [{ fontFamilies: ['Inter', 'Georgia'] }, { fontFamilies: ['"Example Serif"'] }],
  ctas: [{ label: 'Contact us', href: '/contact' }],
  media: { images: [{ src: 'https://example.com/team.jpg', alt: 'Team photo' }] },
};
const writeFixture = (dir) => {
  put(join(dir, PAGES, 'home.json'), CRAWLED);
  put(join(dir, PAGES, 'about.json'), DOCUMENTED);
  put(join(dir, PAGES, '_crawl-log.json'), { discovery: { count: 2 } });
  put(join(dir, PAGES, 'broken.json'), '{ "url": "https://example.com/broken", ');
};
const snapshot = (dir) => {
  const out = [];
  (function walk(d) { for (const e of readdirSync(d).sort()) { const p = join(d, e); const s = statSync(p); out.push(`${p.slice(dir.length)} ${s.size} ${s.mtimeMs}`); if (s.isDirectory()) walk(p); } })(dir);
  return out;
};

// ---- pure helpers -------------------------------------------------------------------------------
check('globToRegExp: * and ? never cross "/", {a,b} alternates, other characters are literal', () => {
  const m = (g, s) => globToRegExp(g).test(s);
  assert.ok(m('blog-*', 'blog-one')); assert.ok(m('blog-*', 'blog-'));
  assert.ok(!m('blog-*', 'blog/one')); assert.ok(!m('blog-*', 'xblog-one'));
  assert.ok(m('h?me', 'home')); assert.ok(!m('h?me', 'hme'));
  assert.ok(m('{home,about}', 'about')); assert.ok(m('{home,ab*}', 'abc')); assert.ok(!m('{home,about}', 'homeabout'));
  assert.ok(m('a.b', 'a.b')); assert.ok(!m('a.b', 'axb')); assert.ok(m('a+(b)', 'a+(b)'));
  assert.ok(m('stardust/current/pages/a*.json', 'stardust/current/pages/about.json'));
  assert.ok(!m('stardust/*/a*.json', 'stardust/current/pages/about.json'));
});
check('selectPages: *.json only, "_" names skipped, sorted by code point, --pages by slug or by path', () => {
  const names = ['b.json', 'a.json', '_crawl-log.json', 'notes.txt', 'ｚ.json', '\u{1F600}.json', 'B.json'];
  assert.deepEqual(selectPages(names).map((p) => p.slug), ['B', 'a', 'b', 'ｚ', '\u{1F600}']);
  assert.deepEqual(selectPages(['home.json'])[0], { file: 'home.json', slug: 'home', rel: 'stardust/current/pages/home.json' });
  assert.deepEqual(selectPages(names, 'a*').map((p) => p.slug), ['a']);
  assert.deepEqual(selectPages(names, '*.json'), [], 'a pattern without "/" is matched against the slug');
  assert.deepEqual(selectPages(names, 'stardust/current/pages/{a,b}.json').map((p) => p.slug), ['a', 'b']);
  assert.deepEqual(selectPages(names, './stardust/current/pages/B.json').map((p) => p.slug), ['B']);
});
check('parseArgs: --pages <glob>, --json; unknown flag, missing value, a flag as value, twice, a positional → exit 2', () => {
  assert.deepEqual(parseArgs([]), { pages: null, json: false });
  assert.deepEqual(parseArgs(['--pages', 'blog-*', '--json']), { pages: 'blog-*', json: true });
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad(['--frob'], /unknown option --frob/);
  bad(['--pages'], /--pages needs a value/);
  bad(['--pages', '--json'], /--pages needs a value/);
  bad(['--pages', ''], /--pages needs a value/);
  bad(['--pages', 'a', '--pages', 'b'], /given twice/);
  bad(['home'], /unexpected argument home/);
});
check('classifyToken / isFontFamilyList: a colour value, a font name or family list, the rest other', () => {
  for (const v of ['#fff', '#147aff', '#147aff80', 'rgb(1, 2, 3)', 'rgba(0,0,0,.5)', 'hsl(1 2% 3%)', 'hsla(1,2%,3%,.4)', 'oklch(0.6 0.2 250)', 'oklab(0.5 0.1 0.1)', 'color(display-p3 1 0 0)', ' #000 ']) {
    assert.equal(classifyToken('--x', v), 'color', v);
  }
  assert.equal(classifyToken('--font-color', '#333'), 'color', 'a colour value wins over a font name');
  assert.equal(classifyToken('--font-size-lg', '1.25rem'), 'font');
  assert.equal(classifyToken('--Heading-FONT', 'Inter'), 'font');
  assert.equal(classifyToken('--heading', '"Example Sans", Georgia, serif'), 'font');
  assert.equal(classifyToken('--mono', 'ui-monospace, Menlo, monospace'), 'font');
  for (const [n, v] of [['--shadow', '0 1px 2px rgba(0,0,0,.1)'], ['--radius', '8px'], ['--easing', 'ease-in-out'], ['--grad', 'linear-gradient(#fff, #000)'], ['--hex-ish', '#fffff'], ['--empty', '']]) {
    assert.equal(classifyToken(n, v), 'other', `${n}: ${v}`);
  }
  assert.ok(isFontFamilyList('Inter, sans-serif')); assert.ok(isFontFamilyList('"Helvetica Neue", Arial'));
  assert.ok(isFontFamilyList("'Source Sans 3', system-ui")); assert.ok(isFontFamilyList('serif'));
  assert.ok(!isFontFamilyList('Inter')); assert.ok(!isFontFamilyList('opacity, transform'));
  assert.ok(!isFontFamilyList('opacity .2s ease, transform .2s ease')); assert.ok(!isFontFamilyList(''));
});

const home = summarizePage(CRAWLED, 'home');
const about = summarizePage(DOCUMENTED, 'about-file');
check('summarizePage (crawler record): slug from the file name, outline from the tag digit, empty texts dropped', () => {
  assert.equal(home.slug, 'home'); assert.equal(home.url, 'https://example.com/');
  assert.equal(home.outline.length, 45);
  assert.deepEqual(home.outline.slice(0, 3), [{ level: 1, text: 'Welcome to Example' }, { level: 2, text: 'What we do' }, { level: 3, text: LONG }]);
  assert.deepEqual(home.outline[3], { level: 4, text: 'Item 1' });
});
check('summarizePage (crawler record): media, code blocks and forms counted as modules; no sections or components', () => {
  assert.deepEqual(home.modules, { media: { images: 3, videos: 1, iframes: 0, codeBlocks: 1, forms: 2 } });
});
check('summarizePage (crawler record): tokens split colour / font / other, sorted by name', () => {
  assert.equal(home.tokens.colors.length, 15);
  assert.deepEqual(home.tokens.colors.slice(0, 2), [{ name: '--c-01', value: '#000001' }, { name: '--c-02', value: '#000002' }]);
  assert.deepEqual(home.tokens.colors.slice(-2).map((c) => c.name), ['--c-hsl', '--c-rgb']);
  assert.equal(home.tokens.colors.at(-2).value, 'hsl(210 40% 50%)', 'values trimmed');
  assert.deepEqual(home.tokens.fonts, [
    { name: '--font-body', value: 'Inter, sans-serif' },
    { name: '--font-size-lg', value: '1.25rem' },
    { name: '--heading', value: '"Example Sans", Georgia, serif' },
  ]);
  assert.equal(home.tokens.other, 3);
  assert.equal(home.tokens.fontFamilies, undefined); assert.equal(home.tokens.themeColor, undefined);
});
check('summarizePage (crawler record): slots fall back to the first h1 and the first body paragraph; CTAs distinct by label; image alts', () => {
  assert.deepEqual(home.slots.headline, { text: 'Welcome to Example', from: 'h1' });
  assert.deepEqual(home.slots.lede, { text: 'The first paragraph is the lede.', from: 'body' });
  assert.equal(home.slots.title, 'Example home');
  assert.equal(home.slots.description, 'The example home page.');
  assert.equal(home.slots.ctas.length, 10);
  assert.deepEqual(home.slots.ctas[0], { label: 'Get started', href: '/start' });
  assert.deepEqual(home.slots.images, { count: 3, withAlt: 2, withoutAlt: 1 });
  assert.equal(home.slots.sections, undefined);
});
check('summarizePage (documented shape): the main landmark\'s sections, components with count > 0 in stored order', () => {
  assert.equal(about.slug, 'about', 'the record\'s slug wins over the file name');
  assert.deepEqual(about.outline, [{ level: 2, text: 'Our story' }, { level: 3, text: 'Since the start' }, { level: 2, text: 'Team' }]);
  assert.deepEqual(about.modules.sections, [
    { purpose: 'hero', id: 'hero', class: 'hero', headline: 'Our story' },
    { purpose: 'feature-list', class: 'team', headline: 'Team' },
    { purpose: 'cta-band' },
  ]);
  assert.deepEqual(about.modules.components, { cards: 3, tabs: 1 });
  assert.equal(about.modules.media, undefined, 'media counts only for a record without landmarks / components');
});
check('summarizePage (documented shape): tokens, heading / section font families, themeColor', () => {
  assert.deepEqual(about.tokens.colors, [{ name: '--brand', value: 'oklch(0.6 0.2 250)' }]);
  assert.deepEqual(about.tokens.fonts, [{ name: '--font-display', value: 'Example Serif' }]);
  assert.equal(about.tokens.other, 1);
  assert.deepEqual(about.tokens.fontFamilies, ['Inter', 'Example Serif', 'Georgia']);
  assert.deepEqual(about.tokens.themeColor, { light: '#ffffff', dark: '#0a0a0a' });
});
check('summarizePage (documented shape): hero fields, metaDescription, one slot line per main section', () => {
  assert.deepEqual(about.slots.headline, { text: 'Designed for the way you work', from: 'heroHeadline' });
  assert.deepEqual(about.slots.lede, { text: 'One platform for the whole team.', from: 'heroLede' });
  assert.equal(about.slots.description, 'Who we are.');
  assert.deepEqual(about.slots.images, { count: 1, withAlt: 1, withoutAlt: 0 });
  assert.deepEqual(about.slots.sections, [
    { purpose: 'hero', headline: 'Our story', paragraphs: 2, lists: 0, qa: 0, quotes: 0 },
    { purpose: 'feature-list', headline: 'Team', paragraphs: 0, lists: 1, qa: 1, quotes: 2 },
    { purpose: 'cta-band', paragraphs: 1, lists: 0, qa: 0, quotes: 0 },
  ]);
});
check('summarizePage: missing or odd fields are left out, never an error', () => {
  const s = summarizePage({}, 'bare');
  assert.deepEqual(s, { slug: 'bare', outline: [], modules: {}, tokens: {}, slots: {} });
  const odd = summarizePage({ headings: 'x', landmarks: [null, { tag: 'main', children: [null, 3] }], components: { cards: null, other: 'x' }, customProps: [], cssCustomProperties: [{ value: '#fff' }], media: null, ctas: [{}, null], body: [3] }, 'odd');
  assert.deepEqual(odd.outline, []);
  assert.deepEqual(odd.modules, { sections: [], components: {} });
  assert.deepEqual(odd.tokens, { colors: [], fonts: [], other: 0 });
  assert.deepEqual(odd.slots.ctas, []);
  const ref = summarizePage({ headings: [null, { level: 2, text: 'Kept' }], landmarks: [{ tag: 'main', children: [{ purpose: 'hero', headlineRef: 1 }] }] }, 'ref');
  assert.deepEqual(ref.modules.sections, [{ purpose: 'hero', headline: 'Kept' }], 'headlineRef indexes the record\'s headings[] as stored');
});
check('formatPage: the header, outline indented below the top level, cut at 80 with …, capped at 40 then "… <k> more"', () => {
  const lines = formatPage(home);
  assert.equal(lines[0], '== home  https://example.com/');
  assert.equal(lines[1], '  outline');
  assert.equal(lines[2], '    h1 Welcome to Example');
  assert.equal(lines[3], '      h2 What we do');
  assert.ok(lines[4].startsWith('        h3 A heading that runs'), lines[4]);
  const cutText = lines[4].slice('        h3 '.length);
  assert.ok(cutText.endsWith('…') && [...cutText].length <= 80, cutText);
  assert.equal(lines[5], '          h4 Item 1');
  assert.equal(lines.filter((l) => /^\s+h\d /.test(l)).length, 40);
  assert.ok(lines.includes('    … 5 more'));
  const aboutLines = formatPage(about);
  assert.equal(aboutLines[2], '    h2 Our story', 'the top level of a page without h1 is not indented');
  assert.equal(aboutLines[3], '      h3 Since the start');
});
check('formatPage: modules, tokens and slots blocks for both shapes', () => {
  const h = formatPage(home);
  assert.ok(h.includes('  modules'));
  assert.ok(h.includes('    media: images×3, videos×1, iframes×0, codeBlocks×1, forms×2'));
  assert.ok(h.includes('    custom properties: 21 — colours 15 · fonts 3 · other 3'));
  assert.equal(h.filter((l) => l.startsWith('    colour ')).length, 12);
  assert.ok(h.includes('    colour --c-01 #000001'));
  assert.ok(h.includes('    … 3 more colours'));
  assert.ok(h.includes('    font --heading "Example Sans", Georgia, serif'));
  assert.ok(h.includes('    headline (h1): Welcome to Example'));
  assert.ok(h.includes('    lede (body): The first paragraph is the lede.'));
  assert.ok(h.includes('    title: Example home'));
  assert.ok(h.includes('    cta: Get started → /start'));
  assert.equal(h.filter((l) => l.startsWith('    cta: ')).length, 8);
  assert.ok(h.includes('    … 2 more ctas'));
  assert.ok(h.includes('    images: 3 · alt 2 · no alt 1'));
  const a = formatPage(about);
  assert.ok(a.includes('    hero #hero "Our story"'));
  assert.ok(a.includes('    feature-list .team "Team"'));
  assert.ok(a.includes('    cta-band'));
  assert.ok(a.includes('    components: cards×3, tabs×1'));
  assert.ok(a.includes('    font families: Inter, Example Serif, Georgia'));
  assert.ok(a.includes('    themeColor: light #ffffff · dark #0a0a0a'));
  assert.ok(a.includes('    headline (heroHeadline): Designed for the way you work'));
  assert.ok(a.includes('    description: Who we are.'));
  assert.ok(a.includes('    section: hero · Our story · 2 paragraphs · 0 lists · 0 q&a · 0 quotes'));
  assert.ok(a.includes('    section: cta-band · 1 paragraphs · 0 lists · 0 q&a · 0 quotes'));
  const slot = formatPage(summarizePage({ heroHeadline: 'y'.repeat(150) }, 's')).find((l) => l.startsWith('    headline'));
  assert.equal([...slot.slice('    headline (heroHeadline): '.length)].length, 100);
  assert.deepEqual(formatPage(summarizePage({}, 'bare')), ['== bare', '  outline', '    (none)', '  modules', '    (none)', '  brand tokens', '    (none)', '  slot candidates', '    (none)']);
});

// ---- CLI ----------------------------------------------------------------------------------------
const P = project();
writeFixture(P);
const before = snapshot(P);
const text = run(P);
check('CLI text: both shapes reported in code-point order, _crawl-log.json not a page, the malformed page noted and skipped', () => {
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.err.trim().split('\n'), [text.err.trim().split('\n')[0]], `one stderr line: ${text.err}`);
  assert.match(text.err, /^extract-report: stardust\/current\/pages\/broken\.json skipped — not JSON/);
  const headers = text.out.split('\n').filter((l) => l.startsWith('== '));
  assert.deepEqual(headers, ['== about  https://example.com/about', '== home  https://example.com/']);
  assert.ok(!/crawl-log|discovery/.test(text.out));
});
check('CLI text: one aggregate line after the last page', () => {
  const lines = text.out.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'extract-report: 2 pages · sections by purpose: cta-band×1, feature-list×1, hero×1 · components: cards×3, tabs×1 · custom properties: 23');
  assert.equal(lines.filter((l) => l.startsWith('extract-report:')).length, 1);
});
check('CLI text: deterministic — a second run prints the same bytes', () => {
  const again = run(P);
  assert.equal(again.out, text.out);
});
check('CLI --pages: a slug glob, a path glob, {a,b}; nothing matched → exit 2 with one line', () => {
  const heads = (r) => r.out.split('\n').filter((l) => l.startsWith('== ')).map((l) => l.split(' ')[1]);
  const slug = run(P, '--pages', 'h?me');
  assert.equal(slug.code, 0, slug.err); assert.deepEqual(heads(slug), ['home']); assert.equal(slug.err, '');
  assert.match(slug.out.trimEnd().split('\n').at(-1), /^extract-report: 1 page · sections by purpose: none · components: none · custom properties: 21$/);
  const path = run(P, '--pages', 'stardust/current/pages/a*.json');
  assert.equal(path.code, 0, path.err); assert.deepEqual(heads(path), ['about']);
  const both = run(P, '--pages', '{home,about}');
  assert.deepEqual(heads(both), ['about', 'home']);
  const none = run(P, '--pages', '*.json');
  assert.equal(none.code, 2); assert.equal(none.out, '');
  assert.equal(none.err, 'extract-report: --pages *.json matched no page\n');
  const onlyBroken = run(P, '--pages', 'broken');
  assert.equal(onlyBroken.code, 2, 'no page reported → exit 2');
  assert.equal(onlyBroken.err.trim().split('\n').length, 2, onlyBroken.err);
  assert.equal(onlyBroken.out, '');
});
check('CLI --json: one object, uncapped, texts whole, the aggregate', () => {
  const r = run(P, '--json');
  assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(r.out);
  assert.deepEqual(Object.keys(doc), ['pages', 'aggregate']);
  assert.deepEqual(doc.pages.map((p) => p.slug), ['about', 'home']);
  const h = doc.pages[1];
  assert.deepEqual(Object.keys(h), ['slug', 'url', 'outline', 'modules', 'tokens', 'slots']);
  assert.equal(h.outline.length, 45);
  assert.equal(h.outline[2].text, LONG);
  assert.equal(h.tokens.colors.length, 15);
  assert.equal(h.slots.ctas.length, 10);
  assert.deepEqual(doc.pages[0], JSON.parse(JSON.stringify(about)));
  assert.deepEqual(doc.aggregate, { pages: 2, sectionsByPurpose: { 'cta-band': 1, 'feature-list': 1, hero: 1 }, components: { cards: 3, tabs: 1 }, customProperties: 23 });
});
check('CLI: no page JSON (no directory, or only "_" files) → exit 2, one stderr line', () => {
  const empty = project();
  const r = run(empty);
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.equal(r.err, 'extract-report: no page JSON under stardust/current/pages (run extract first)\n');
  const logOnly = project();
  put(join(logOnly, PAGES, '_crawl-log.json'), {});
  assert.equal(run(logOnly).err, r.err);
  assert.deepEqual(readdirSync(empty), []);
});
check('CLI: a page that is not an object is noted and skipped; none left → exit 2', () => {
  const d = project();
  put(join(d, PAGES, 'list.json'), [1, 2]);
  const r = run(d);
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.match(r.err, /^extract-report: stardust\/current\/pages\/list\.json skipped — not an object \(array\)\n/);
});
check('CLI: usage errors exit 2', () => {
  const r = run(P, '--frob');
  assert.equal(r.code, 2); assert.equal(r.err, 'extract-report: unknown option --frob\n');
  assert.equal(run(P, '--pages').code, 2);
});
check('CLI --help: exit 0, usage on stdout, nothing written in an empty cwd', () => {
  const d = project();
  const r = run(d, '--help');
  assert.equal(r.code, 0); assert.match(r.out, /Usage:\n {2}node stardust\/scripts\/extract\/extract-report\.mjs \[--pages <glob>\] \[--json\]/);
  assert.match(r.out, /Exit codes:/);
  assert.equal(run(d, '-h').code, 0);
  assert.deepEqual(readdirSync(d), []);
});
check('CLI: the runs above wrote nothing into the project', () => {
  assert.deepEqual(snapshot(P), before);
  assert.equal(readFileSync(join(P, PAGES, 'broken.json'), 'utf8'), '{ "url": "https://example.com/broken", ');
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nextract-report: all checks passed');
process.exit(failed ? 1 : 0);
