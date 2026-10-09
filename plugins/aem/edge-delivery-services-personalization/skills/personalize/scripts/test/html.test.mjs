import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixture, html } from './helpers.mjs';

const {
  findBlocks, sections, readCell, openingTag, applyEdits, injectHead, decodeEntities, getAttr, textContent,
} = html;

describe('findBlocks', () => {
  it('reads every placeholder of a body-fragment page', () => {
    const blocks = findBlocks(fixture('content/index.html'));
    assert.equal(blocks.length, 2);
    const [hero, welcome] = blocks;
    assert.deepEqual(hero.rows.map((row) => row.key), ['id', 'geo: IN', 'geo: US, CA & device: mobile', 'default']);
    assert.equal(hero.rows[1].href, '/fragments/personalization/home-hero/india');
    assert.equal(welcome.rows[0].value, 'welcome');
    assert.equal(welcome.rows[3].value, 'none');
  });

  it('reads a full page the same way', () => {
    const plain = findBlocks(fixture('content/index.html')).map((block) => block.rows.map((row) => row.key));
    const page = findBlocks(fixture('index.html')).map((block) => block.rows.map((row) => row.key));
    assert.deepEqual(page, plain);
  });

  it('flags inline content cells', () => {
    const [offer] = findBlocks(fixture('content/offer.plain.html'));
    const defaultRow = offer.rows.find((row) => row.key === 'default');
    assert.equal(defaultRow.inline, true);
    assert.equal(defaultRow.value, 'Our standard offer. Terms apply.');
  });

  it('skips commented-out markup and keeps offsets', () => {
    const source = '<!-- <div class="personalization"><div><div>id</div><div>old</div></div></div> -->\n'
      + '<div class="personalization other"><div><div>id</div><div>live</div></div></div>';
    const blocks = findBlocks(source);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].rows[0].value, 'live');
    assert.ok(source.slice(blocks[0].start).startsWith('<div class="personalization other">'));
    assert.deepEqual(blocks[0].classes, ['personalization', 'other']);
  });

  it('ignores lookalike classes and unterminated blocks', () => {
    assert.equal(findBlocks('<div class="personalization-wrapper"><div class="personalizations"></div></div>').length, 0);
    assert.equal(findBlocks('<div class="personalization"><div>').length, 0);
  });
});

describe('sections', () => {
  it('returns top-level divs of main, or of the document', () => {
    const page = fixture('index.html');
    assert.equal(sections(page).length, 2);
    assert.equal(sections(fixture('content/index.html')).length, 2);
    assert.equal(sections('<!-- <div></div> --><div></div>').length, 1);
  });
});

describe('cells and attributes', () => {
  it('detects single links versus inline content', () => {
    assert.deepEqual(readCell('<a href="/fragments/a">/fragments/a</a>'), { value: '/fragments/a', href: '/fragments/a', inline: false });
    // A cell holding only a link is a reference whatever its text (same as the DOM runtime).
    assert.equal(readCell('<a href="/fragments/a">Click</a>').href, '/fragments/a');
    assert.equal(readCell('See <a href="/fragments/a">this</a>').href, undefined);
    assert.equal(readCell('<a href="/a">a</a><a href="/b">b</a>').href, undefined);
    assert.equal(readCell('<p>One</p>').inline, false);
    assert.equal(readCell('<p>One</p><p>Two</p>').inline, true);
    assert.equal(readCell('<picture><img src="x"></picture>').inline, true);
  });

  it('decodes entities and reads attributes', () => {
    assert.equal(decodeEntities('a &amp; b &#39;c&#x27; &nbsp;&unknown;'), "a & b 'c'  &unknown;");
    assert.equal(getAttr(' class="a b" data-x=\'y\' z=1', 'data-x'), 'y');
    assert.equal(getAttr(' z=1', 'z'), '1');
    assert.equal(getAttr(' class="x"', 'id'), undefined);
    assert.equal(textContent('<p>Hi\n <b>there</b></p>'), 'Hi there');
  });

  it('rewrites the opening tag, replacing earlier data-pzn attributes', () => {
    const block = { attrs: ' class="personalization" data-pzn-source="x"' };
    assert.equal(
      openingTag(block, { source: 'edge', variant: 'a"b' }),
      '<div class="personalization" data-pzn-source="edge" data-pzn-variant="a&quot;b">',
    );
  });

  it('applies edits and injects into head', () => {
    assert.equal(applyEdits('abcdef', [{ start: 0, end: 1, text: 'X' }, { start: 4, end: 6, text: 'YZ!' }]), 'XbcdYZ!');
    assert.equal(injectHead('<head><title></title></head>', '<meta>'), '<head><title></title><meta></head>');
    assert.equal(injectHead('<div></div>', '<meta>'), '<div></div>');
  });
});
