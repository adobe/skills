#!/usr/bin/env node
// skills/deploy/scripts/test/proto-to-doc.test.mjs — a gated prototype's <main> → the delivered document: two goldens
// (a landing with section/block markers, an article without either), --help before any I/O, the refusals (no <main>,
// an empty <main>) and usage errors write nothing, two runs are byte-identical and the second rewrites nothing, the
// --json shape, metadata from the page record vs the prototype's <head>, the media map + ledger rewrite, block rows of
// link / image members and of an <a> holding blocks, and section boundaries equal to section-schema's default
// reading. No browser.
// Run: node --test <this file>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'proto-to-doc.mjs');
const FX = join(HERE, 'fixtures', 'proto-to-doc');
const BASE = mkdtempSync(join(tmpdir(), 'proto-to-doc-'));
after(() => rmSync(BASE, { recursive: true, force: true }));

const LANDING = 'stardust/prototypes/landing-proposed.html';
const ARTICLE = 'stardust/prototypes/article.html';
// a project dir laid out as a run leaves it: stardust/prototypes/ and stardust/current/pages/
const project = () => {
  const dir = mkdtempSync(join(BASE, 'p-'));
  cpSync(join(FX, 'prototypes'), join(dir, 'stardust', 'prototypes'), { recursive: true });
  cpSync(join(FX, 'current'), join(dir, 'stardust', 'current'), { recursive: true });
  return dir;
};
const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
const read = (...p) => readFileSync(join(...p), 'utf8');
const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const proto = (main) => `<!doctype html><html><head><title>T</title></head><body>${main}</body></html>`;

test('--help prints the usage header with the exit codes, exit 0, in an empty dir that stays empty', () => {
  const dir = mkdtempSync(join(BASE, 'help-'));
  const r = run(dir, '--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /--path/);
  assert.match(r.stdout, /Exit codes: 0 ok · 1 usage · 2 refused/);
  assert.deepEqual(readdirSync(dir), []);
});

test('landing with markers → the golden document at content/<da-path>.html and the one-line summary', () => {
  const dir = project();
  const r = run(dir, LANDING, '--path', '/');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, 'content', 'index.html'), read(FX, 'landing.expected.html'));
  assert.equal(r.stdout, `proto-to-doc: ${LANDING} → content/index.html — 3 section(s), 3 block(s) (hero, tags, cards three-up), metadata: Title, Description; 4 image(s) unmapped\n`);
  assert.equal(r.stderr, '');
});

test('article without sections or markers → the golden document (one section, figcaption a paragraph)', () => {
  const dir = project();
  const r = run(dir, ARTICLE, '--path', '/journal/packing', '--out', 'out/article.html');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, 'out', 'article.html'), read(FX, 'article.expected.html'));
  assert.equal(r.stdout, `proto-to-doc: ${ARTICLE} → out/article.html — 1 section(s), 0 block(s), metadata: Title, Description; 1 image(s) unmapped\n`);
  assert.ok(!existsSync(join(dir, 'content')), 'only the --out file is written');
});

test('deterministic: two projects give byte-identical documents; a re-run leaves the identical file untouched', () => {
  const a = project(); const b = project();
  assert.equal(run(a, LANDING, '--path', '/trips/').status, 0);
  assert.equal(run(b, LANDING, '--path', '/trips/').status, 0);
  const file = join(a, 'content', 'trips', 'index.html');
  assert.equal(read(file), read(b, 'content', 'trips', 'index.html'), 'a trailing / maps to <path>/index');
  const old = new Date('2020-01-01T00:00:00Z');
  utimesSync(file, old, old);
  const r = run(a, LANDING, '--path', '/trips/');
  assert.equal(r.status, 0);
  assert.match(r.stdout, / \(unchanged\)\n$/);
  assert.equal(statSync(file).mtimeMs, old.getTime(), 'an identical document is not rewritten');
  assert.deepEqual(readdirSync(join(a, 'content', 'trips')), ['index.html'], 'no temp file left behind');
});

test('--json prints the record instead of the line', () => {
  const dir = project();
  const r = run(dir, LANDING, '--path', '/', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['prototype', 'path', 'out', 'written', 'sections', 'blocks', 'metadata', 'unmapped']);
  assert.equal(out.prototype, LANDING);
  assert.equal(out.path, '/index');
  assert.equal(out.out, 'content/index.html');
  assert.equal(out.written, true);
  assert.equal(out.sections, 3);
  assert.deepEqual(out.blocks, [{ name: 'hero', rows: 1, cells: 2 }, { name: 'tags', rows: 3, cells: 3 }, { name: 'cards three-up', rows: 3, cells: 6 }]);
  assert.deepEqual(out.metadata, { Title: 'Lakeside Trails', Description: 'Guided lake walks for every season &amp; every pace.' });
  assert.deepEqual(out.unmapped, ['forest-9c0d1e2f', 'lake-1a2b3c4d', 'ridge-3a4b5c6d', 'river-5e6f7a8b'].map((f) => `../current/assets/media/${f}.jpg`));
  assert.equal(JSON.parse(run(dir, LANDING, '--path', '/', '--json').stdout).written, false);
});

test('metadata: --page replaces the default page record, a row it leaves empty comes from the <head>; no record → the <head>', () => {
  const dir = project();
  write(join(dir, 'page.json'), JSON.stringify({ title: 'From --page', description: '' }));
  const r = run(dir, LANDING, '--path', '/', '--page', 'page.json', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).metadata, { Title: 'From --page', Description: 'Lake walks, as the head describes them.' });
  rmSync(join(dir, 'stardust', 'current', 'pages', 'landing.json'));
  const head = JSON.parse(run(dir, LANDING, '--path', '/', '--json').stdout).metadata;
  assert.deepEqual(head, { Title: 'Lakeside Trails (prototype)', Description: 'Lake walks, as the head describes them.' });
  write(join(dir, 'bare.html'), proto('<main><p>Hi</p></main>').replace('<title>T</title>', ''));
  const none = run(dir, 'bare.html', '--path', '/bare');
  assert.match(none.stdout, /, metadata: none\n$/);
  assert.match(read(dir, 'content', 'bare.html'), /^<body>\n<header><\/header>\n<main>\n<div>\n<div class="metadata">\n<\/div>\n<\/div>\n<div>\n<p>Hi<\/p>\n<\/div>\n/);
});

test('media: the media map names the source, the ledger its uploaded content URL; the rest stays and is listed', () => {
  const dir = project();
  const local = (f) => `stardust/current/assets/media/${f}.jpg`;
  const src = (n) => `https://www.example.com/media/${n}.jpg`;
  write(join(dir, 'stardust', 'current', 'assets', 'media-map.json'), JSON.stringify({
    [src('forest')]: { local: local('forest-9c0d1e2f'), status: 'ok' },
    [src('lake')]: { local: local('lake-1a2b3c4d'), status: 'ok' },
    [src('ridge')]: { local: null, status: 'http-404' },
    [src('river')]: { local: local('river-5e6f7a8b'), status: 'ok' },
  }));
  const cdn = (f) => `https://content.da.live/example-org/example-site/media/landing/${f}.jpg`;
  write(join(dir, 'stardust', 'deploy', 'media-ledger.json'), JSON.stringify({
    'media/landing/forest-9c0d1e2f.jpg': { status: 'failed', source: src('forest'), contentUrl: cdn('forest-9c0d1e2f') },
    'media/landing/lake-1a2b3c4d.jpg': { status: 'uploaded', source: null, sources: [src('lake')], contentUrl: cdn('lake-1a2b3c4d') },
  }));
  const r = run(dir, LANDING, '--path', '/', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).unmapped, ['../current/assets/media/ridge-3a4b5c6d.jpg', src('forest'), src('river')]);
  const doc = read(dir, 'content', 'index.html');
  assert.ok(doc.includes(`<img src="${cdn('lake-1a2b3c4d')}" alt="A calm lake at dawn">`), 'uploaded → its content URL');
  assert.ok(doc.includes(`<img src="${src('river')}" alt="River bend">`), 'mapped, not uploaded → the source URL');
  assert.ok(doc.includes(`<img src="${src('forest')}" alt="Pines in fog">`), 'a failed upload never resolves');
  assert.ok(doc.includes('<img src="../current/assets/media/ridge-3a4b5c6d.jpg" alt="">'), 'unmapped → as written');
  // an absolute src goes straight to the ledger; --media-ledger names another file
  write(join(dir, 'other-ledger.json'), JSON.stringify({ 'media/journal/pack.jpg': { status: 'uploaded', sources: [src('pack')], contentUrl: cdn('pack') } }));
  const a = run(dir, ARTICLE, '--path', '/journal/packing', '--media-ledger', 'other-ledger.json');
  assert.equal(a.status, 0, a.stderr);
  assert.doesNotMatch(a.stdout, /unmapped/);
  assert.ok(read(dir, 'content', 'journal', 'packing.html').includes(`<p><img src="${cdn('pack')}" alt="An open daypack"></p>`));
});

test('refused (exit 2, nothing written): no <main>, or a <main> without an element', () => {
  const dir = mkdtempSync(join(BASE, 'refuse-'));
  write(join(dir, 'none.html'), proto('<div><h1>No main here</h1></div>'));
  write(join(dir, 'empty.html'), proto('<main>  just text  </main>'));
  for (const f of ['none.html', 'empty.html']) {
    const r = run(dir, f, '--path', '/x');
    assert.equal(r.status, 2, `${f}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^proto-to-doc: refused — ${f} has no <main>.* — .+\\n$`));
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(readdirSync(dir).sort(), ['empty.html', 'none.html']);
});

test('usage errors (exit 1, nothing written): no prototype, no --path, a relative or .. path, an unknown flag', () => {
  const dir = project();
  for (const args of [['--path', '/x'], [LANDING], [LANDING, '--path', 'trips'], [LANDING, '--path', '/a/../b'], [LANDING, '--path', '/x', '--bogus']]) {
    const r = run(dir, ...args);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /usage: node .*proto-to-doc\.mjs <prototype\.html> --path/);
  }
  assert.ok(!existsSync(join(dir, 'content')));
});

test('block rows: link and image members are rows of one cell, <br>s form no group; an <a> holding blocks links its heading', () => {
  const dir = mkdtempSync(join(BASE, 'rows-'));
  write(join(dir, 'rows.html'), proto('<main>'
    + '<nav data-block="links"><a href="/a?x=1&amp;y=2">A</a><a href="/b">B</a></nav>'
    + '<div data-block="gallery"><img src="https://www.example.com/1.jpg" alt="1"><img src="https://www.example.com/2.jpg"></div>'
    + '<p data-block="address">Main Street 1<br>Lakeside<br>Open daily</p>'
    + '<div class="teaser"><a class="card" href="/trips/river-walk"><img src="https://www.example.com/r.jpg" alt="R"><h3>River Walk</h3><p>6 km</p></a></div>'
    + '</main>'));
  const r = run(dir, 'rows.html', '--path', '/rows');
  assert.equal(r.status, 0, r.stderr);
  const doc = read(dir, 'content', 'rows.html');
  assert.ok(doc.includes('<div class="links">\n<div><div><p><a href="/a?x=1&amp;y=2">A</a></p></div></div>\n<div><div><p><a href="/b">B</a></p></div></div>\n</div>'), doc);
  assert.ok(doc.includes('<div class="gallery">\n<div><div><img src="https://www.example.com/1.jpg" alt="1"></div></div>\n<div><div><img src="https://www.example.com/2.jpg" alt=""></div></div>\n</div>'), doc);
  assert.ok(doc.includes('<div class="address">\n<div><div><p>Main Street 1<br>Lakeside<br>Open daily</p></div></div>\n</div>'), doc);
  assert.ok(doc.includes('<div>\n<p><img src="https://www.example.com/r.jpg" alt="R"></p>\n<h3><a href="/trips/river-walk">River Walk</a></h3>\n<p>6 km</p>\n</div>'), doc);
});

test('sections follow section-schema: each outermost <section> is one, content around them is grouped by --split', () => {
  const dir = mkdtempSync(join(BASE, 'sections-'));
  // a lone unmarked <section> stays ONE section (groupSections alone would unwrap it into two)
  write(join(dir, 'lone.html'), proto('<main><section class="all"><h2>Head</h2><div data-block="cards"><div class="c"><p>A</p></div><div class="c"><p>B</p></div></div></section></main>'));
  let r = run(dir, 'lone.html', '--path', '/lone', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).sections, 1);
  assert.match(read(dir, 'content', 'lone.html'), /\n<div>\n<h2>Head<\/h2>\n<div class="cards">\n<div><div><p>A<\/p><\/div><\/div>\n<div><div><p>B<\/p><\/div><\/div>\n<\/div>\n<\/div>\n<\/main>/);
  // a wrapper holding sections is unwrapped; content outside every section is kept in a section of its own; a
  // section with nothing to deliver (an icon, a button) is left out
  write(join(dir, 'mixed.html'), proto('<main><h1>Title</h1><div class="wrap"><section><p>One</p></section><section class="deco"><svg></svg><button>Go</button></section><section data-section="two"><p>Two</p></section></div><p>After</p></main>'));
  r = run(dir, 'mixed.html', '--path', '/mixed');
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, 'content', 'mixed.html'), /<main>\n<div>\n<div class="metadata">\n<div><div>Title<\/div><div>T<\/div><\/div>\n<\/div>\n<\/div>\n<div>\n<h1>Title<\/h1>\n<\/div>\n<div>\n<p>One<\/p>\n<\/div>\n<div>\n<p>Two<\/p>\n<\/div>\n<div>\n<p>After<\/p>\n<\/div>\n<\/main>/);
});
