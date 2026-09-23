#!/usr/bin/env node
// skills/deploy/scripts/test/build-harness.test.mjs — the build-harness.mjs contract: the page
// metadata strip (balanced, no orphan </div>), the section-metadata fold mirrored from the
// delivery pipeline (style → normalised classes appended to the section, id → section id, other
// keys → data-*, the block removed, a rowless block left in place with a WARN), the media-ledger
// remap of content.da.live image URLs to captured files (explicit flag, auto-detect, unreadable →
// WARN, explicit-but-bad → exit 1), the /img/ rewrite, the document shell, the favicon rules,
// --help in an empty cwd, idempotence over its own output, and usage errors. No network.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'build-harness.mjs');
const BASE = mkdtempSync(join(tmpdir(), 'build-harness-test-'));
after(() => rmSync(BASE, { recursive: true, force: true }));

// One scratch project per check: <dir>/page.html in, <dir>/out/h.html out, --root <dir>.
const project = () => { const d = mkdtempSync(join(BASE, 'p-')); mkdirSync(join(d, 'out')); return d; };
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const build = (dir, page, args = []) => {
  writeFileSync(join(dir, 'page.html'), page);
  const r = run(['page.html', 'out/h.html', '--root', dir, ...args], dir);
  const outFile = join(dir, 'out', 'h.html');
  return { ...r, doc: existsSync(outFile) ? readFileSync(outFile, 'utf8') : null };
};
const mainOf = (doc) => doc.match(/<main[\s\S]*?<\/main>/i)[0];
const CDN = 'https://content.da.live/o/r/media/s';
// A media-ledger entry as da-media-upload.mjs writes it (keyed by media/<scope>/<file>).
const entry = (name, file, extra = {}) => ({
  status: 'uploaded', file, source: null, contentUrl: `${CDN}/${name}`, ts: '2026-01-01T00:00:00.000Z', ...extra,
});
const writeLedger = (dir, rel, entries) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), JSON.stringify(entries, null, 2));
};
const touch = (dir, rel) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), 'x'); };
// A content page wrapped the way DA-authored pages are: no <head>, <main> of section divs.
const page = (sections) => `<body>\n<header></header>\n<main>\n${sections}\n</main>\n<footer></footer>\n</body>\n`;
const META_SECTION = `  <div>
    <div class="metadata">
      <div>
        <div>title</div>
        <div>Test page</div>
      </div>
    </div>
  </div>`;
const STYLED_SECTION = `  <div>
    <h1>Hello</h1>
    <p><img src="https://example.test/x/img/a.jpg" alt="a"></p>
    <div class="section-metadata">
      <div>
        <div>Style</div>
        <div>Dark, Wide</div>
      </div>
      <div>
        <div>Background</div>
        <div>red</div>
      </div>
    </div>
  </div>`;
const plainSection = (src) => `  <div>
    <p>plain section</p>
    <p><img src="${src}" alt="b"></p>
  </div>`;
// The fixture: a styled section, a plain one carrying an editorial image, the page metadata last.
const PAGE = page([STYLED_SECTION, plainSection(`${CDN}/b.jpg`), META_SECTION].join('\n'));
const expectedMain = (bSrc) => `<main>
  <div class="dark wide" data-background="red">
    <h1>Hello</h1>
    <p><img src="/img/a.jpg" alt="a"></p>
  </div>
${plainSection(bSrc)}
</main>`;

test('folds section-metadata: style → normalised classes, other key → data-*, block removed, count printed', () => {
  const dir = project();
  writeLedger(dir, 'ledger.json', { 'media/s/b.jpg': entry('b.jpg', 'img/b.jpg') });
  touch(dir, 'img/b.jpg');
  const r = build(dir, PAGE, ['--media-ledger', 'ledger.json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.equal(mainOf(r.doc), expectedMain('/img/b.jpg'));
  assert.doesNotMatch(r.doc, /section-metadata/);
  assert.match(r.out, /^1 section-metadata block\(s\) folded$/m);
});

test('style normalisation mirrors the pipeline: option braces, punctuation, <p> boundaries, existing class kept', () => {
  const dir = project();
  const section = `  <div class="pre" id="keep">
    <p>x</p>
    <div class="section-metadata">
      <div><div>style</div><div><p>Hero (Full Width, centered)</p><p>Joe's Pizza!</p></div></div>
    </div>
  </div>`;
  const r = build(dir, page(section));
  assert.equal(r.code, 0, r.err);
  assert.match(mainOf(r.doc), /<div class="pre hero full-width centered joe-s-pizza" id="keep">/);
});

test('other pipeline keys: id → toSectionId, img/a values → URL only, comma tokens, later row overwrites, 1-cell row ignored', () => {
  const dir = project();
  const section = `  <div>
    <p>y</p>
    <div class="section-metadata">
      <div><div>Id</div><div>2 My Section!</div></div>
      <div><div>Background Image</div><div><p><img src="https://example.test/x/img/bg.jpg" alt=""></p></div></div>
      <div><div>link</div><div><a href="https://example.test/p?a=1&amp;b=2">Read more</a></div></div>
      <div><div>tags</div><div>a, b ,c</div></div>
      <div><div>tags</div><div>d</div></div>
      <div><div>lonely</div></div>
    </div>
  </div>
  <div>
    <p>z</p>
    <div class="section-metadata"><div><div>style</div><div>Tinted</div></div></div>
  </div>`;
  const r = build(dir, page(section));
  assert.equal(r.code, 0, r.err);
  const main = mainOf(r.doc);
  assert.match(main, /<div id="my-section" data-background-image="\/img\/bg\.jpg" data-link="https:\/\/example\.test\/p\?a=1&amp;b=2" data-tags="d">/);
  assert.match(main, /<div class="tinted">\n\s*<p>z<\/p>\n\s*<\/div>/);
  assert.doesNotMatch(main, /Read more|lonely|section-metadata/);
  assert.match(r.out, /^2 section-metadata block\(s\) folded$/m);
});

test('a section without section-metadata is byte-identical; page metadata removed; no WARN', () => {
  const dir = project();
  const r = build(dir, PAGE);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.ok(mainOf(r.doc).includes(plainSection(`${CDN}/b.jpg`)), mainOf(r.doc));
  assert.doesNotMatch(r.doc, /class="metadata"|Test page/);
  assert.equal(mainOf(r.doc), expectedMain(`${CDN}/b.jpg`));
});

test('/img/ rewrite: absolute origin and localhost:PORT image URLs become root-relative', () => {
  const dir = project();
  const r = build(dir, page('  <div>\n    <p><img src="https://example.test/x/img/a.jpg"> <img src="http://localhost:3000/img/c.png"></p>\n  </div>'));
  assert.equal(r.code, 0, r.err);
  assert.match(mainOf(r.doc), /<img src="\/img\/a\.jpg"> <img src="\/img\/c\.png">/);
  assert.doesNotMatch(mainOf(r.doc), /example\.test|localhost/);
});

test('--media-ledger: content URL → root-relative captured file (relative file field), count printed', () => {
  const dir = project();
  writeLedger(dir, 'stardust/deploy/ledger-elsewhere.json', { 'media/s/b.jpg': entry('b.jpg', './img/b.jpg') });
  touch(dir, 'img/b.jpg');
  const r = build(dir, PAGE, ['--media-ledger', 'stardust/deploy/ledger-elsewhere.json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  assert.match(mainOf(r.doc), /<img src="\/img\/b\.jpg" alt="b">/);
  assert.doesNotMatch(r.doc, /content\.da\.live/);
  assert.match(r.out, /^1 image URL\(s\) remapped to captured files$/m);
});

test('ledger: absolute file made root-relative, longer URL wins over its prefix, outside-root and missing files WARN', () => {
  const dir = project();
  touch(dir, 'img/c.png');
  writeLedger(dir, 'ledger.json', {
    'media/s/c.jpg': entry('c.jpg', join(dir, 'img', 'c.jpg')),
    'media/s/c.jpg.png': entry('c.jpg.png', 'img/c.png'),
    'media/s/out.jpg': entry('out.jpg', '/elsewhere/out.jpg', { status: 'failed', error: 'e' }),
    'media/s/unused.jpg': entry('unused.jpg', '/elsewhere/unused.jpg'),
    'media/s/no-url.jpg': { status: 'failed', file: 'img/n.jpg', error: 'missing-local' },
  });
  const body = `  <div>\n    <p><img src="${CDN}/c.jpg"> <img src="${CDN}/c.jpg.png"> <img src="${CDN}/c.jpg"> <img src="${CDN}/out.jpg"></p>\n  </div>`;
  const r = build(dir, page(body), ['--media-ledger', 'ledger.json']);
  assert.equal(r.code, 0, r.err);
  assert.match(mainOf(r.doc), /<img src="\/img\/c\.jpg"> <img src="\/img\/c\.png"> <img src="\/img\/c\.jpg"> <img src="https:\/\/content\.da\.live\/o\/r\/media\/s\/out\.jpg">/);
  assert.match(r.out, /^3 image URL\(s\) remapped to captured files$/m);
  assert.match(r.err, /^WARN: ledger file \/elsewhere\/out\.jpg is not under .* left as is\.$/m);
  assert.match(r.err, /^WARN: captured file \/img\/c\.jpg missing under .* remapped anyway\.$/m);
  assert.doesNotMatch(r.err, /unused|c\.png/);
});

test('ledger auto-detected at <root>/stardust/deploy/media-ledger.json without the flag', () => {
  const dir = project();
  writeLedger(dir, 'stardust/deploy/media-ledger.json', { 'media/s/b.jpg': entry('b.jpg', 'img/b.jpg') });
  touch(dir, 'img/b.jpg');
  const r = build(dir, PAGE);
  assert.equal(r.code, 0, r.err);
  assert.equal(mainOf(r.doc), expectedMain('/img/b.jpg'));
  assert.match(r.out, /^1 image URL\(s\) remapped to captured files$/m);
});

test('auto-detected ledger unreadable → WARN, harness still written; no ledger → 0 remapped note', () => {
  const dir = project();
  writeLedger(dir, 'stardust/deploy/media-ledger.json', null);
  writeFileSync(join(dir, 'stardust', 'deploy', 'media-ledger.json'), '{ not json');
  const r = build(dir, PAGE);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^WARN: media ledger .*media-ledger\.json unreadable \(.*\) — image URLs not remapped\.$/m);
  assert.match(r.out, /^0 image URL\(s\) remapped to captured files \(ledger unreadable\)$/m);
  assert.equal(mainOf(r.doc), expectedMain(`${CDN}/b.jpg`));
  const none = build(project(), PAGE);
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /^0 image URL\(s\) remapped to captured files \(no media ledger\)$/m);
});

test('explicit --media-ledger missing or invalid → exit 1, one stderr line, nothing written', () => {
  const dir = project();
  const missing = build(dir, PAGE, ['--media-ledger', 'nope.json']);
  assert.equal(missing.code, 1);
  assert.equal(missing.doc, null);
  assert.equal(missing.out, '');
  assert.match(missing.err.trim(), /^media ledger nope\.json: ENOENT[^\n]*$/);
  writeFileSync(join(dir, 'bad.json'), '[1, 2]');
  const list = build(dir, PAGE, ['--media-ledger', 'bad.json']);
  assert.equal(list.code, 1);
  assert.equal(list.doc, null);
  assert.match(list.err.trim(), /^media ledger bad\.json: not a JSON object$/);
  writeFileSync(join(dir, 'bad.json'), '{ nope');
  const unparsable = build(dir, PAGE, ['--media-ledger', 'bad.json']);
  assert.equal(unparsable.code, 1);
  assert.match(unparsable.err.trim(), /^media ledger bad\.json: [^\n]+$/);
});

test('a rowless section-metadata block, or one nested below a wrapper, is left in place with a WARN', () => {
  const dir = project();
  const body = [
    plainSection('/img/p.jpg'),
    '  <div>\n    <p>z</p>\n    <div class="section-metadata"><div><div>only one cell</div></div></div>\n  </div>',
    '  <div>\n    <div class="section-metadata-wrapper"><div class="section-metadata"><div><div>style</div><div>dark</div></div></div></div>\n  </div>',
  ].join('\n');
  const r = build(dir, page(body));
  assert.equal(r.code, 0);
  assert.match(r.err, /^WARN: section 2 of 3: section-metadata block has no key\/value rows — left in place\.$/m);
  assert.match(r.err, /^WARN: 1 section-metadata block\(s\) not a direct child of a top-level section — left in place\.$/m);
  const main = mainOf(r.doc);
  assert.match(main, /<div>\n\s*<p>z<\/p>\n\s*<div class="section-metadata"><div><div>only one cell<\/div><\/div><\/div>/);
  assert.match(main, /<div>\n\s*<div class="section-metadata-wrapper"><div class="section-metadata">/);
  assert.doesNotMatch(main, /class="dark/);
  assert.match(r.out, /^0 section-metadata block\(s\) folded$/m);
});

test('document shell: styles.css + scripts.js module, lang, viewport, empty header/footer, byte count printed', () => {
  const dir = project();
  const r = build(dir, PAGE);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.doc.startsWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>QA harness</title>\n'));
  assert.match(r.doc, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(r.doc, /<link rel="stylesheet" href="\/styles\/styles\.css">\n<script src="\/scripts\/scripts\.js" type="module"><\/script>/);
  assert.match(r.doc, /<body>\n<header><\/header>\n<main>[\s\S]*<\/main>\n<footer><\/footer>\n<\/body><\/html>$/);
  assert.match(r.out, new RegExp(`^harness written: out/h\\.html \\(${r.doc.length} bytes\\)$`, 'm'));
});

test('favicon: the icon href in <root>/head.html is mirrored even when favicon.ico also exists', () => {
  const dir = project();
  writeFileSync(join(dir, 'head.html'), '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
    + '<script src="/scripts/aem.js" type="module"></script>\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
    + '<link rel="stylesheet" href="/styles/styles.css"/>\n');
  touch(dir, 'favicon.ico');
  const r = build(dir, PAGE);
  assert.equal(r.code, 0, r.err);
  assert.equal((r.doc.match(/<link rel="icon"/g) || []).length, 1);
  assert.match(r.doc, /<link rel="icon" href="\/favicon\.svg"><\/head>/);
  assert.doesNotMatch(r.doc, /favicon\.ico/);
});

test('favicon: no head.html icon → existing favicon.{ico,svg,png} with ico first; none → data:, no-op', () => {
  const svgPng = project();
  touch(svgPng, 'favicon.svg'); touch(svgPng, 'favicon.png');
  assert.match(build(svgPng, PAGE).doc, /<link rel="icon" href="\/favicon\.svg">/);
  const ico = project();
  touch(ico, 'favicon.ico'); touch(ico, 'favicon.svg');
  writeFileSync(join(ico, 'head.html'), '<link rel="stylesheet" href="/styles/styles.css"/>\n');
  assert.match(build(ico, PAGE).doc, /<link rel="icon" href="\/favicon\.ico">/);
  const none = build(project(), PAGE);
  assert.match(none.doc, /<link rel="icon" href="data:,">/);
  assert.equal((none.doc.match(/<link rel="icon"/g) || []).length, 1);
});

test('orphan WARN: a stray </div> after the metadata section is reported; harness still written', () => {
  const dir = project();
  const body = '  <div><div class="metadata"><div><div>k</div><div>v</div></div></div></div>\n  </div>\n  <div><p>x</p></div>';
  const r = build(dir, page(body));
  assert.equal(r.code, 0);
  assert.match(r.err, /^WARN: harness <main> starts with an orphan <\/div> — metadata strip mis-balanced\.$/m);
  assert.match(mainOf(r.doc), /<div><p>x<\/p><\/div>/);
});

test('--help / -h: exit 0, prints the usage header (flags, folds, Writes:), writes nothing in an empty cwd', () => {
  const empty = mkdtempSync(join(BASE, 'empty-'));
  for (const flag of ['--help', '-h']) {
    const r = run([flag], empty);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^skills\/deploy\/scripts\/build-harness\.mjs — build a local QA harness/);
    assert.match(r.out, /Usage: node skills\/deploy\/scripts\/build-harness\.mjs <contentFile> <outHarness>/);
    assert.match(r.out, /--media-ledger <json>/);
    assert.match(r.out, /section-metadata fold/);
    assert.match(r.out, /Writes: <outHarness> only/);
    assert.equal(r.err, '');
  }
  assert.deepEqual(readdirSync(empty), []);
});

test('idempotent: rebuilding from its own output leaves the document unchanged (classes, data-*, images)', () => {
  const dir = project();
  writeLedger(dir, 'stardust/deploy/media-ledger.json', { 'media/s/b.jpg': entry('b.jpg', 'img/b.jpg') });
  touch(dir, 'img/b.jpg');
  const first = build(dir, PAGE);
  assert.equal(first.code, 0, first.err);
  const again = run(['out/h.html', 'out/h2.html', '--root', dir], dir);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.err, '');
  assert.match(again.out, /^0 section-metadata block\(s\) folded$/m);
  assert.match(again.out, /^0 image URL\(s\) remapped to captured files$/m);
  assert.equal(readFileSync(join(dir, 'out', 'h2.html'), 'utf8'), first.doc);
});

test('usage: missing positional or dangling flag → exit 1 with the usage line, nothing written', () => {
  const dir = project();
  const cases = [[], ['page.html'], ['page.html', 'out/h.html', '--root'], ['page.html', 'out/h.html', '--media-ledger']];
  for (const args of cases) {
    const r = run(args, dir);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /^usage: node skills\/deploy\/scripts\/build-harness\.mjs <contentFile> <outHarness> \[--root <dir>\] \[--media-ledger <json>\]$/m);
    assert.equal(r.out, '');
  }
  assert.equal(existsSync(join(dir, 'out', 'h.html')), false);
});
