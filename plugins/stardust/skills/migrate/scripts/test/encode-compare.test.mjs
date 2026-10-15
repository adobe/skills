#!/usr/bin/env node
// Unit test: encode/compare.mjs — compareDocs levels core ⊂ text ⊂ strict (byte extends text), design § 2 with the D0
// tightening: ASCII whitespace runs collapse at `text` (none ≠ one), NBSP and every code point count, pre / code /
// textarea byte-exact, attribute values exact; block boundaries separate text; strict adds metadata rows and inline
// markup (tags, href, src, alt, title). Pure, no browser, no network.
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-compare.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { compareDocs, LEVELS } from '../encode/compare.mjs';

const META = '<div><div class="metadata"><div><div>Title</div><div>A page</div></div><div><div>nav</div><div>/en/nav</div></div></div></div>';
const BODY = [
  '<div><h1>Heading</h1><p>Some text with a <a href="/about" title="About us">link</a>.</p>',
  '<div class="cards three-up"><div><div><picture><img src="/media/a.jpg" alt="Card A"></picture></div><div><p>Card A body</p></div></div>',
  '<div><div><picture><img src="/media/b.jpg" alt="Card B"></picture></div><div><p>Card B body</p></div></div></div>',
  '<div class="section-metadata"><div><div>Style</div><div>dark</div></div></div></div>',
  '<div><ul><li>one</li><li>two</li></ul><pre>  keep  this  </pre><p>run <code>a  b</code> end</p></div>',
].join('');
const doc = (body = BODY, meta = META) => `<body><header></header><main>${meta}${body}</main><footer></footer></body>`;
const BASE = doc();
// one edit of the base body → the document
const edit = (from, to) => { assert.ok(BODY.includes(from), `fixture holds ${from}`); return doc(BODY.replace(from, to)); };
const levels = (got, expected = BASE) => compareDocs(expected, got).levels;

// --- the result shape; identical documents are equal at every level ---------------------------------------------
{
  assert.deepEqual(LEVELS, ['core', 'text', 'strict', 'byte']);
  const r = compareDocs(BASE, BASE, { level: 'strict' });
  assert.deepEqual(r, { equal: true, level: 'strict', levels: { core: true, text: true, strict: true, byte: true }, diffs: [] });
  assert.equal(compareDocs(BASE, BASE).level, 'text', 'text is the default level');
  assert.throws(() => compareDocs(BASE, BASE, { level: 'loose' }), /unknown level "loose"/);
}

// --- text: ASCII whitespace runs collapse, but none ≠ one ----------------------------------------------------------
{
  assert.deepEqual(levels(edit('Some text with', 'Some \n\t text   with')), { core: true, text: true, strict: true, byte: false }, 'a run of ASCII whitespace is one space');
  assert.deepEqual(levels(edit('<p>Some text', '<p>\n  Some text')), { core: true, text: true, strict: true, byte: false }, 'edge whitespace of a unit is not content');
  const none = compareDocs(BASE, edit('Some text with', 'Some textwith'));
  assert.equal(none.equal, false, 'a removed space is a difference');
  assert.deepEqual(none.diffs.map((d) => [d.where, d.kind, d.level]), [['s0.1 dc:p', 'text', 'core']]);
}

// --- text: NBSP and code points count (core ignores both) ----------------------------------------------------------
{
  const nbsp = compareDocs(BASE, edit('Some text with', 'Some&nbsp;text with'));
  assert.deepEqual(nbsp.levels, { core: true, text: false, strict: false, byte: false }, 'NBSP ≠ space at text; core ignores it');
  assert.deepEqual(nbsp.diffs, [{ where: 's0.1 dc:p', kind: 'text-exact', level: 'text', expected: 'Some text with a link.', got: 'Some\u00a0text with a link.' }]);
  assert.equal(compareDocs(BASE, edit('Some text with', 'Some&nbsp;text with'), { level: 'core' }).equal, true);
  assert.deepEqual(levels(edit('Card A body</p>', 'Card A body&nbsp;</p>')), { core: true, text: false, strict: false, byte: false }, 'an NBSP at a unit edge is kept');
  assert.deepEqual(levels(edit('Heading', 'He\u0301ading'), doc(BODY.replace('Heading', 'H\u00e9ading'))), { core: true, text: false, strict: false, byte: false }, 'NFC only at core');
}

// --- text: entities decode with sanitise's table (named, decimal, hex and the raw character are one code point) -----
{
  const named = doc(BODY.replace('Heading', 'Caf&eacute; &mdash; &copy;'));
  for (const v of ['Café — ©', 'Caf&#233; &#8212; &#xA9;']) assert.equal(compareDocs(named, doc(BODY.replace('Heading', v)), { level: 'byte' }).equal, true, v);
  assert.equal(compareDocs(named, doc(BODY.replace('Heading', 'Cafe — ©'))).equal, false, 'a different code point');
}

// --- text: pre / code / textarea are byte-exact ----------------------------------------------------------------------
{
  assert.deepEqual(levels(edit('<pre>  keep  this  </pre>', '<pre>  keep this  </pre>')), { core: true, text: false, strict: false, byte: false }, 'pre');
  assert.deepEqual(levels(edit('<pre>  keep  this  </pre>', '<pre>keep  this</pre>')), { core: true, text: false, strict: false, byte: false }, 'pre edges');
  assert.deepEqual(levels(edit('<code>a  b</code>', '<code>a b</code>')), { core: true, text: false, strict: false, byte: false }, 'code');
  assert.deepEqual(levels(edit('<code>a  b</code>', '<code>a  b</code>  '), BASE), { core: true, text: true, strict: true, byte: false }, 'whitespace after the code element collapses');
  const ta = (v) => doc(BODY.replace('</ul>', `</ul><p><textarea>${v}</textarea></p>`));
  assert.equal(compareDocs(ta('x\n\ny'), ta('x\ny')).equal, false, 'textarea');
}

// --- block boundaries separate text (`</li><li>` ≡ `</li>\n<li>`) ---------------------------------------------------
{
  assert.deepEqual(levels(edit('<ul><li>one</li><li>two</li></ul>', '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>')), { core: true, text: true, strict: true, byte: false });
  assert.deepEqual(levels(edit('<div><p>Card A body</p></div>', '<div>\n<p>Card A body</p>\n</div>')), { core: true, text: true, strict: true, byte: false }, 'inside a cell');
  assert.equal(levels(edit('<li>one</li><li>two</li>', '<li>onetwo</li>')).core, false, 'items never run together');
  assert.deepEqual(levels(edit('<li>one</li><li>two</li>', '<li>one<br>two</li>'), doc(BODY.replace('<li>one</li><li>two</li>', '<li>one<br>\ntwo</li>'))), { core: true, text: true, strict: true, byte: false }, 'whitespace after <br> is not content');
  assert.deepEqual(levels(edit('<li>one</li><li>two</li>', '<li>one<br>two</li>'), doc(BODY.replace('<li>one</li><li>two</li>', '<li>one two</li>'))), { core: true, text: true, strict: false, byte: false }, '<br> is markup');
}

// --- strict: inline markup and attribute values, exact -----------------------------------------------------------------
{
  const alt = compareDocs(BASE, edit('alt="Card A"', 'alt="Card X"'), { level: 'strict' });
  assert.deepEqual(alt.levels, { core: true, text: true, strict: false, byte: true }, 'an alt change: text and byte ignore it, strict catches it');
  assert.deepEqual(alt.diffs.map((d) => [d.where, d.kind, d.level]), [['s0.2 block:cards.three-up r0c0', 'markup', 'strict']]);
  assert.equal(alt.diffs[0].got, '<picture><img src="/media/a.jpg" alt="Card X"></picture>');
  assert.deepEqual(levels(edit('href="/about"', 'href="/about-us"')), { core: true, text: true, strict: false, byte: true }, 'href');
  assert.deepEqual(levels(edit('href="/about"', 'href="/About"')), { core: true, text: true, strict: false, byte: true }, 'an attribute differing only by case');
  assert.deepEqual(levels(edit('title="About us"', 'title="About  us"')), { core: true, text: true, strict: false, byte: true }, 'attribute whitespace is exact');
  assert.deepEqual(levels(edit('src="/media/b.jpg"', 'src="/media/b.png"')), { core: true, text: true, strict: false, byte: true }, 'src');
  assert.deepEqual(levels(edit('title="About us"', 'title="About &amp; us"'), doc(BODY.replace('title="About us"', 'title="About & us"'))), { core: true, text: true, strict: true, byte: true }, 'attributes compare entity-decoded');
  assert.deepEqual(levels(edit('with a <a', 'with <em>a</em> <a')), { core: true, text: true, strict: false, byte: true }, 'an added inline tag');
  assert.deepEqual(levels(edit('<a href="/about" title="About us">link</a>.', '<a href="/about" title="About us">link.</a>')), { core: true, text: true, strict: false, byte: true }, 'a tag boundary moved');
  assert.equal(compareDocs(BASE, edit('alt="Card A"', 'alt="Card X"'), { level: 'byte' }).equal, true, 'byte extends text, not strict');
  // attribute values decode exactly once: an escaped entity is text, a named or numeric reference is its character
  assert.deepEqual(levels(edit('href="/about"', 'href="/x?a=1&amp;amp;b=2"'), doc(BODY.replace('href="/about"', 'href="/x?a=1&amp;b=2"'))), { core: true, text: true, strict: false, byte: true }, '&amp;amp; is not &amp;');
  assert.deepEqual(levels(edit('title="About us"', 'title="&amp;eacute;"'), doc(BODY.replace('title="About us"', 'title="é"'))), { core: true, text: true, strict: false, byte: true }, '&amp;eacute; is not é');
  const cafe = doc(BODY.replace('alt="Card A"', 'alt="Caf&eacute; &frac14;"'));
  for (const v of ['Café ¼', 'Caf&#233; &#xBC;']) assert.equal(compareDocs(cafe, doc(BODY.replace('alt="Card A"', `alt="${v}"`)), { level: 'strict' }).equal, true, `sanitise's names in an attribute: ${v}`);
}

// --- strict: metadata and section-metadata rows ------------------------------------------------------------------------
{
  const m = compareDocs(BASE, doc(BODY, META.replace('A page', 'B page')), { level: 'strict' });
  assert.deepEqual(m.levels, { core: true, text: true, strict: false, byte: true });
  assert.deepEqual(m.diffs, [{ where: 'metadata:title', kind: 'metadata', level: 'strict', expected: 'A page', got: 'B page' }]);
  assert.deepEqual(compareDocs(BASE, doc(BODY, META.replace('<div><div>nav</div><div>/en/nav</div></div>', '')), { level: 'strict' }).diffs, [{ where: 'metadata:nav', kind: 'metadata', level: 'strict', expected: '/en/nav', got: null }], 'a missing row');
  assert.deepEqual(levels(edit('<div>dark</div>', '<div>Dark</div>')), { core: true, text: true, strict: false, byte: true }, 'a section style differing by case: same style, not the same row');
}

// --- core: structure — sections, section styles, item sequence, blocks by name + variants, rows × cells -----------------
{
  const style = compareDocs(BASE, edit('<div>dark</div>', '<div>light</div>'), { level: 'core' });
  assert.deepEqual(style.diffs, [{ where: 's0', kind: 'section-style', level: 'core', expected: 'dark', got: 'light' }]);
  const variant = compareDocs(BASE, edit('class="cards three-up"', 'class="cards"'));
  assert.equal(variant.levels.core, false, 'a variant class');
  assert.deepEqual(variant.diffs.filter((d) => d.kind.endsWith('-item')).map((d) => [d.kind, d.expected, d.got]), [['missing-item', 'block:cards.three-up', null], ['extra-item', null, 'block:cards']]);
  const cells = compareDocs(BASE, edit('<div><p>Card B body</p></div>', ''));
  assert.deepEqual(cells.diffs.map((d) => [d.where, d.kind]), [['s0.2 block:cards.three-up', 'rows-cells'], ['s0.2 block:cards.three-up r1c1', 'text-missing']]);
  const gone = compareDocs(BASE, edit('<h1>Heading</h1>', ''));
  assert.deepEqual(gone.diffs.map((d) => [d.kind, d.expected]), [['missing-item', 'dc:h1'], ['text-missing', 'Heading']]);
  assert.equal(compareDocs(BASE, edit('<div class="cards three-up">', '</div><div><div class="cards three-up">')).levels.core, false, 'a split section');
  assert.equal(compareDocs(BASE, edit('<h1>Heading</h1>', '<h2>Heading</h2>')).levels.core, false, 'default content by tag');
}

// --- text outside any element the model reads: directly in a section or <main>, or in a block outside its cells -------
{
  const probe = compareDocs('<main><div>Hello world<p>x</p></div></main>', '<main><div><p>x</p></div></main>', { level: 'strict' });
  assert.equal(probe.levels.core, false, 'text directly in a section is content');
  assert.deepEqual(probe.diffs.map((d) => [d.kind, d.expected]), [['missing-item', 'dc:#text'], ['text-missing', 'Hello world']]);
  const changed = compareDocs('<main><div>Hello world<p>x</p></div></main>', '<main><div>Hello there<p>x</p></div></main>');
  assert.deepEqual(changed.diffs.map((d) => [d.where, d.kind]), [['s0.0 dc:#text', 'text']], 'a section text run is a default-content unit');
  assert.equal(compareDocs('<main><div>Hello <!-- c -->world<p>x</p></div></main>', '<main><div>Hello world<p>x</p></div></main>', { level: 'strict' }).equal, true, 'one run, whatever splits its text nodes');
  assert.deepEqual(levels(edit('</h1><p>', '</h1>\n  <p>')), { core: true, text: true, strict: true, byte: true }, 'whitespace between items is not a unit');
  assert.equal(compareDocs(`<main>Intro${META}${BODY}</main>`, `<main>${META}${BODY}</main>`).levels.core, false, 'text directly in <main>');
  const row = compareDocs(BASE, edit('<div class="cards three-up"><div>', '<div class="cards three-up"><div>stray'));
  assert.deepEqual(row.diffs, [{ where: 's0.2 block:cards.three-up r0 stray0', kind: 'stray-text', level: 'core', expected: null, got: 'stray' }], 'text in a row outside its cells');
  const block = compareDocs(edit('<div class="cards three-up">', '<div class="cards three-up">loose'), BASE);
  assert.deepEqual(block.diffs, [{ where: 's0.2 block:cards.three-up stray0', kind: 'stray-text', level: 'core', expected: 'loose', got: null }], 'text in a block outside its rows');
  const both = edit('<div class="cards three-up"><div>', '<div class="cards three-up"><div>stray');
  assert.equal(compareDocs(both, both, { level: 'strict' }).equal, true, 'the same stray text on both sides');
  assert.equal(compareDocs(both, edit('<div class="cards three-up"><div>', '<div class="cards three-up"><div>Stray')).levels.core, false, 'stray text compares as a unit');
}

// --- an NBSP-only run is content at text and above (D0: only ASCII whitespace is blank); core folds it like a space -----
{
  const sec = compareDocs('<main><div>&nbsp;<p>x</p></div></main>', '<main><div><p>x</p></div></main>', { level: 'strict' });
  assert.deepEqual(sec.levels, { core: true, text: false, strict: false, byte: false }, 'directly in a section');
  assert.deepEqual(sec.diffs, [{ where: 's0.0 dc:#text', kind: 'text-exact', level: 'text', expected: '\u00a0', got: null }]);
  assert.equal(compareDocs('<main><div>&nbsp;<p>x</p></div></main>', '<main><div>&#160;<p>x</p></div></main>', { level: 'strict' }).equal, true, 'the same NBSP run on both sides');
  assert.deepEqual(compareDocs('<main><div>&nbsp;<p>x</p></div></main>', '<main><div><p>x</p>&nbsp;</div></main>').diffs.map((d) => d.where), ['s0.0 dc:#text', 's0.1 dc:#text'], 'placed before the item it precedes');
  assert.deepEqual(compareDocs('<main><div>&nbsp;<p>x</p><p>y</p>&nbsp;</div></main>', '<main><div><p>x</p><p>y</p>&nbsp;</div></main>').diffs.map((d) => d.where), ['s0.0 dc:#text'], 'each run keyed by its own place');
  assert.deepEqual(levels(`<body><main>&nbsp;${META}${BODY}</main></body>`), { core: true, text: false, strict: false, byte: false }, 'directly in <main>');
  const row = compareDocs(BASE, edit('<div class="cards three-up"><div>', '<div class="cards three-up"><div>&nbsp;'));
  assert.deepEqual(row.levels, { core: true, text: false, strict: false, byte: false }, 'stray in a row');
  assert.deepEqual(row.diffs, [{ where: 's0.2 block:cards.three-up r0 stray0', kind: 'stray-text', level: 'text', expected: null, got: '\u00a0' }]);
  assert.equal(compareDocs(BASE, edit('class="cards three-up"', 'class="cards\u00a0three-up"')).levels.core, false, 'class names split on ASCII whitespace only');
}

console.log('encode-compare: ok');
