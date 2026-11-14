import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { fixture, html } from './helpers.mjs';
import { ASSETS_DIR, RUNTIME_DIR } from '../lib.mjs';

const {
  findBlocks, sections, openingTag, applyEdits, injectHead, decodeEntities, getAttr, textContent,
  findSections, parseAttrs, metadataValue, renderSectionMetadata,
} = html;

describe('findBlocks', () => {
  it('reads the rows of every block of a class', () => {
    const blocks = findBlocks(fixture('content/index.html'), 'section-metadata');
    assert.equal(blocks.length, 2);
    const [hero, welcome] = blocks;
    assert.deepEqual(hero.rows.map((row) => row.key), [
      'Personalization', 'Personalization Variants', 'Personalization Rule India', 'Personalization Rule NA Mobile',
    ]);
    assert.match(hero.rows[1].html, /home-hero\/na-mobile/);
    assert.equal(textContent(welcome.rows[0].html), 'welcome');
  });

  it('skips commented-out markup and keeps offsets', () => {
    const source = '<!-- <div class="section-metadata"><div><div>Style</div><div>old</div></div></div> -->\n'
      + '<div class="section-metadata other"><div><div>Style</div><div>live</div></div></div>';
    const blocks = findBlocks(source, 'section-metadata');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].rows[0].html, 'live');
    assert.ok(source.slice(blocks[0].start).startsWith('<div class="section-metadata other">'));
    assert.deepEqual(blocks[0].classes, ['section-metadata', 'other']);
  });

  it('ignores lookalike classes and unterminated blocks', () => {
    assert.equal(findBlocks('<div class="section-metadata-x"><div class="metadata"></div></div>', 'section-metadata').length, 0);
    assert.equal(findBlocks('<div class="section-metadata"><div>', 'section-metadata').length, 0);
  });
});

describe('sections', () => {
  it('returns top-level divs of main, or of the document', () => {
    assert.equal(sections(fixture('index.html')).length, 3);
    assert.equal(sections(fixture('content/index.html')).length, 3);
    assert.equal(sections('<!-- <div></div> --><div></div>').length, 1);
  });
});

describe('cells and attributes', () => {
  it('decodes entities and reads attributes', () => {
    assert.equal(decodeEntities('a &amp; b &#39;c&#x27; &nbsp;&unknown;'), "a & b 'c'  &unknown;");
    assert.equal(getAttr(' class="a b" data-x=\'y\' z=1', 'data-x'), 'y');
    assert.equal(getAttr(' z=1', 'z'), '1');
    assert.equal(getAttr(' class="x"', 'id'), undefined);
    assert.equal(textContent('<p>Hi\n <b>there</b></p>'), 'Hi there');
  });

  it('rewrites the opening tag, replacing earlier data-pzn attributes', () => {
    const section = { attrs: ' class="hero" data-personalization="x" data-pzn-source="x"' };
    assert.equal(
      openingTag(section, { source: 'edge', variant: 'a"b' }),
      '<div class="hero" data-personalization="x" data-pzn-source="edge" data-pzn-variant="a&quot;b">',
    );
  });

  it('applies edits and injects into head', () => {
    assert.equal(applyEdits('abcdef', [{ start: 0, end: 1, text: 'X' }, { start: 4, end: 6, text: 'YZ!' }]), 'XbcdYZ!');
    assert.equal(injectHead('<head><title></title></head>', '<meta>'), '<head><title></title><meta></head>');
    assert.equal(injectHead('<div></div>', '<meta>'), '<div></div>');
  });
});

describe('findSections and parseAttrs', () => {
  it('reads section attributes in order, quote-aware', () => {
    const page = '<html><body><main><div class="hero dark" data-note="a > b" data-personalization=\'x\' hidden data-z=3 data-note="dup">'
      + '<div class="inner"><p>One</p></div></div><div><p>Two</p></div></main></body></html>';
    const found = findSections(page);
    assert.equal(found.length, 2);
    assert.deepEqual(found[0].attributes, [
      ['class', 'hero dark'], ['data-note', 'a > b'], ['data-personalization', 'x'], ['hidden', ''], ['data-z', '3'],
    ]);
    assert.deepEqual(found[0].classes, ['hero', 'dark']);
    assert.equal(page.slice(found[0].openEnd, found[0].closeStart), '<div class="inner"><p>One</p></div>');
    assert.deepEqual(found[1].attributes, []);
    assert.deepEqual(parseAttrs(' DATA-X="&quot;q&quot;" y'), [['data-x', '"q"'], ['y', '']]);
    assert.equal(getAttr(' data-rule="geo: IN > x" class="c"', 'class'), 'c');
  });

  it('finds blocks inside sections whose attributes hold ">"', () => {
    const page = '<main><div data-personalization-rule-a="param: q=a>b"><div class="cards"><div><div>k</div><div>x</div></div></div></div></main>';
    assert.equal(findBlocks(page, 'cards')[0].rows[0].html, 'x');
    assert.equal(sections(page).length, 1);
  });
});

describe('Section Metadata rendering (pipeline emulation)', () => {
  it('extracts values like the pipeline: hrefs and srcs absolute, link text skipped, text split on commas', () => {
    assert.equal(metadataValue('<p>geo: US, CA &amp; device: mobile</p>'), 'geo: US,CA & device: mobile');
    assert.equal(metadataValue('<p><a href="/fragments/a">Fragment A</a></p><p><a href="https://x.aem.page/fragments/b">B</a></p>', 'https://site.aem.page/page'),
      'https://site.aem.page/fragments/a,https://x.aem.page/fragments/b');
    assert.equal(metadataValue('<p><img src="./media_1.png"></p>', 'https://site.aem.page/folder/page'), 'https://site.aem.page/folder/media_1.png');
    assert.equal(metadataValue('<p>40</p><p>30</p>'), '40,30', 'paragraphs are comma-joined');
  });

  it('turns rows into attributes in authoring order and removes the block', () => {
    const source = '<body><main><div><div class="section-metadata">'
      + '<div><div><p>Style</p></div><div><p>Dark Panel, wide</p></div></div>'
      + '<div><div><p>Personalization</p></div><div><p>hero</p></div></div>'
      + '<div><div><p>Personalization Rule India</p></div><div><p>geo: IN</p></div></div>'
      + '<div><div><p>Personalization Variants</p></div><div><p><a href="/fragments/hero/india">/fragments/hero/india</a></p></div></div>'
      + '<div><div><p>Personalization Rule India</p></div><div><p>param: x</p></div></div>'
      + '<div><div><p>Audience: Mobile</p></div><div><p>/m</p></div></div>'
      + '</div><h1>Hero</h1></div><div><p>Plain</p></div></main></body>';
    const { html: rendered, sections: found } = renderSectionMetadata(source, { base: 'https://main--s--o.aem.page/' });
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].attributes, [
      ['class', 'dark-panel wide'],
      ['data-personalization', 'hero'],
      ['data-personalization-rule-india', 'param: x'],
      ['data-personalization-variants', 'https://main--s--o.aem.page/fragments/hero/india'],
      ['data-audience:-mobile', '/m'],
    ]);
    assert.deepEqual(found[0].repeated, ['Personalization Rule India']);
    assert.equal(found[0].rows.length, 6);
    assert.doesNotMatch(rendered, /section-metadata/);
    const [first, second] = findSections(rendered);
    assert.deepEqual(first.attributes, found[0].attributes);
    assert.equal(rendered.slice(first.openEnd, first.closeStart), '<h1>Hero</h1>');
    assert.deepEqual(second.attributes, []);
  });

  it('keeps Hint and Description prose through the pipeline\'s comma split (OF1 worked example)', async () => {
    const { parseSection } = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'section-spec.js')).href);
    const row = (key, value) => `<div><div><p>${key}</p></div><div>${value}</div></div>`;
    const source = `<body><main><div><h1>Hero</h1><div class="section-metadata">${
      row('Personalization', '<p>home-hero</p>')
    }${row('Personalization Source', '<p>api</p>')
    }${row('Personalization Variants', '<p><a href="/fragments/home-hero/pro">pro</a></p><p><a href="/fragments/home-hero/deals">deals</a></p>')
    }${row('Personalization Hint', '<p>Show the hero for a buyer, a deal hunter, or 1,000 others.</p>')
    }${row('Personalization Description Pro', '<p>Dual boilers, PID control.</p>')
    }${row('Personalization Description Default', '<p>Our flagship range.</p>')
    }</div></div></main></body>`;
    const { sections: found } = renderSectionMetadata(source, { base: 'https://main--s--o.aem.page/' });
    assert.equal(getAttr(found[0].attributes.map(([n, v]) => ` ${n}="${v}"`).join(''), 'data-personalization-hint'),
      'Show the hero for a buyer,a deal hunter,or 1,000 others.', 'the pipeline drops the space after commas');
    const spec = parseSection(found[0].attributes);
    assert.deepEqual(spec.errors, []);
    assert.equal(spec.hint, 'Show the hero for a buyer, a deal hunter, or 1,000 others.');
    assert.deepEqual(spec.descriptions, { pro: 'Dual boilers, PID control.', default: 'Our flagship range.' });
    assert.deepEqual(spec.variants.map((variant) => [variant.name, variant.path]), [
      ['pro', '/fragments/home-hero/pro'], ['deals', '/fragments/home-hero/deals']]);
  });

  it('reads the section-metadata template as a valid section', async () => {
    const { parseSection } = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'section-spec.js')).href);
    const block = readFileSync(join(ASSETS_DIR, 'content', 'section-metadata.html'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replaceAll('{{ID}}', 'home-hero')
      .replaceAll('{{VARIANT}}', 'india')
      .replaceAll('{{CONDITION}}', 'geo: IN &amp; device: mobile');
    const { sections: found } = renderSectionMetadata(`<body><main><div><h1>Hero</h1>${block}</div></main></body>`);
    const spec = parseSection(found[0].attributes);
    assert.deepEqual(spec.errors, []);
    assert.deepEqual(spec.warnings, []);
    assert.deepEqual(spec.rules.map((rule) => [rule.variant, rule.condition]), [['india', 'geo: IN & device: mobile']]);
  });
});
