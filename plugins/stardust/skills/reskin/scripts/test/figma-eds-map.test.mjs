#!/usr/bin/env node
// skills/reskin/scripts/test/figma-eds-map.test.mjs — eds-map (pure): a Figma module name → the EDS block deploy
// Step 2 gives it. D1: buttons, links and body copy are default content (block null); D11: a boilerplate or
// Block Collection pattern takes that block's name, the Figma name kept as the variant where it tells variants
// apart; anything else keeps its Figma name, off the reserved EDS classes. Several modules on one EDS block
// become its variants. Deterministic. Run: node --test <this file>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { donorModulesEds, edsEquivalent, edsLabel, parseEdsLabel, resolveVariants, safeBlockName, slugOf } from '../figma/eds-map.mjs';

const map = (n, o) => { const e = edsEquivalent(n, o); return [e.block, e.variant]; };

// The One AZ kit's 32 modules, as the project decided them.
const ONE_AZ = {
  accordion: ['accordion', null], 'back-to-top': ['back-to-top', null], button: [null, null], breadcrumb: ['breadcrumbs', null],
  carousel: ['carousel', null], 'checkbox-radio': ['form', null], chips: ['chips', null], dropdown: ['form', null],
  input: ['form', null], links: [null, null], modal: ['modal', null], pagination: ['pagination', null], 'search-bar': ['search', null],
  slider: ['form', null], stepper: ['stepper', null], 'tab-nav': ['tabs', 'nav'], tabs: ['tabs', null], tables: ['table', null],
  toggle: ['form', null], tooltip: ['tooltip', null], account: ['account', null], 'block-content': [null, null],
  'cta-banner': ['cta-banner', null], calculator: ['calculator', null], email: [null, null], forms: ['form', null],
  footer: ['footer', null], header: ['header', null], 'home-hero-branded': ['hero', 'branded'], login: ['form', 'login'],
  teaser: ['cards', 'teaser'], quiz: ['quiz', null],
};

test('the One AZ kit maps as the project decided', () => {
  for (const [n, want] of Object.entries(ONE_AZ)) assert.deepEqual(map(n), want, n);
});

test('D11: Figma spellings of Block Collection patterns take the EDS name', () => {
  assert.deepEqual(map('❖ Q&A'), ['accordion', null]);
  assert.deepEqual(map('Q & A'), ['accordion', null]);
  assert.deepEqual(map('FAQ'), ['accordion', null]);
  assert.deepEqual(map('Expander'), ['accordion', null]);
  assert.deepEqual(map('Checkbox & Radio'), ['form', null]);
  assert.deepEqual(map('Text Field'), ['form', null]);
  assert.deepEqual(map('Sign In'), ['form', 'sign-in']);
  assert.deepEqual(map('Searchbar'), ['search', null]);
  assert.deepEqual(map('Data Table'), ['table', null]);
  assert.deepEqual(map('Tab Bar'), ['tabs', 'nav']);
  assert.deepEqual(map('Slideshow'), ['carousel', null]);
  assert.deepEqual(map('Dialog'), ['modal', null]);
  assert.deepEqual(map('Card'), ['cards', null]);
  assert.deepEqual(map('Product Card'), ['cards', 'product-card']);
  assert.deepEqual(map('Hero'), ['hero', null]);
  assert.deepEqual(map('▢ Home Hero – Branded'), ['hero', 'branded']);
  assert.match(edsEquivalent('Q&A').reason, /deploy Step 2 D11: "Q&A" matches the Block Collection accordion block/);
  assert.match(edsEquivalent('Teaser').reason, /boilerplate cards block \(variant teaser\)/);
});

test('D11: a pattern word anywhere in the name — table, accordion, image-top and stacked columns', () => {
  for (const n of ['Accordion Item', 'Accordion – Open', 'FAQ Section', 'FAQs List', 'Disclosure Panel', 'Q&A Section', 'Collapsible Group']) assert.deepEqual(map(n), ['accordion', null], n);
  for (const n of ['Table Row', 'Tables / Comparison', 'Comparison Table', 'Pricing Table v2', 'Data Table Header']) assert.deepEqual(map(n), ['table', null], n);
  assert.deepEqual(map('Table – Striped'), ['table', 'striped']);
  assert.deepEqual(map('Bordered Data Table'), ['table', 'bordered']);
  assert.deepEqual(map('Table (no header)'), ['table', 'no-header']);
  for (const n of ['Image Top Columns', 'Columns – Image Top', 'Image-on-top Column', '2-col image top', '3 Column / Top Image', 'Image Top']) assert.deepEqual(map(n), ['columns', 'image-top'], n);
  assert.deepEqual(map('Stacked Columns'), ['columns', 'stacked']);
  assert.deepEqual(map('3 Columns'), ['columns', null]);
  assert.deepEqual(map('Column Layout'), ['columns', null]);
  assert.deepEqual(map('Feature Columns'), ['columns', 'feature']);
  assert.match(edsEquivalent('Image Top Columns').reason, /matches the boilerplate columns block \(variant image-top\)/);
  assert.match(edsEquivalent('Accordion Item').reason, /matches the Block Collection accordion block$/);
  // Not patterns: a table of contents, a tablet frame; exact and last-token rules still win first.
  assert.deepEqual(map('Table of Contents'), ['table-of-contents', null]);
  assert.deepEqual(map('Tablet Hero'), ['hero', 'tablet']);
  assert.deepEqual(map('FAQ Card'), ['cards', 'faq-card']);
});

test('D1: buttons, links and body copy are default content unless they carry structure', () => {
  for (const n of ['Button', 'Btn', 'Links', 'Heading', 'Title Text', 'Rich Text', 'Block Content', 'Email']) assert.deepEqual(map(n), [null, null], n);
  assert.match(edsEquivalent('Button').reason, /D1: "Button" is default content/);
  assert.deepEqual(map('Links', { hasRepeatingUnits: true }), ['links', null]);
  assert.deepEqual(map('Promo Band', { hasRepeatingUnits: false, interactive: false }), [null, null]);
  assert.deepEqual(map('Promo Band', { hasRepeatingUnits: false, interactive: true }), ['promo-band', null]);
});

test('no EDS match: the Figma name, kebab-cased, never a reserved EDS class', () => {
  assert.deepEqual(map('❖ Chips'), ['chips', null]);
  assert.deepEqual(map('Section'), ['blk-section', null]);
  assert.deepEqual(map('Promo Wrapper'), ['promo-wrapper-block', null]);
  assert.deepEqual(map('Promo Container'), ['promo-container-block', null]);
  assert.match(edsEquivalent('Section').reason, /reserved EDS class, renamed blk-section/);
  assert.deepEqual(map(''), [null, null]);
  assert.equal(slugOf('Café & Co.'), 'cafe-and-co');
  assert.equal(safeBlockName('wrap'), 'blk-wrap');
});

test('edsLabel / resolveVariants: several modules on one block become its variants, never a suffixed block', () => {
  assert.equal(edsLabel(edsEquivalent('Teaser')), 'cards (teaser)');
  assert.equal(edsLabel(edsEquivalent('Button')), 'default content');
  const entries = ['Accordion', 'Q&A', 'FAQ', 'Teaser', 'Button', 'Links'].map((figma) => ({ key: slugOf(figma), figma, eds: edsEquivalent(figma) }));
  const out = resolveVariants(entries);
  assert.deepEqual(out.map((e) => [e.block, e.variant]), [['accordion', null], ['accordion', 'q-and-a'], ['accordion', 'faq'], ['cards', 'teaser'], [null, null], [null, null]]);
  assert.match(out[1].reason, /a variant of it/);
  assert.deepEqual(resolveVariants([{ key: 'a', figma: 'Teaser', eds: edsEquivalent('Teaser') }, { key: 'b', figma: 'Teaser', eds: edsEquivalent('Teaser') }]).map((e) => e.variant), ['teaser', 'teaser-2']);
});

test('parseEdsLabel inverts edsLabel; donorModulesEds reads the EDS block column, else Step 2 on the name', () => {
  for (const e of [{ block: 'accordion', variant: null }, { block: 'cards', variant: 'teaser' }, { block: null, variant: null }]) {
    assert.deepEqual(parseEdsLabel(edsLabel(e)), e);
  }
  assert.equal(parseEdsLabel('—'), null);
  const md = [
    '| # | Module | EDS block | Where seen | Description |', '|---|---|---|---|---|',
    '| M1 | Q&A | accordion | a | d |', '| M2 | Hero \\| dark | hero (dark) | a | d |', '| M3 | Button | default content | a | d |', '| — | Related | — | a | d |',
    '', '| # | Module | Where seen |', '|---|---|---|', '| M9 | FAQ | a |',
  ].join('\n');
  assert.deepEqual(Object.fromEntries(donorModulesEds(md)), {
    M1: { block: 'accordion', variant: null }, M2: { block: 'hero', variant: 'dark' }, M3: { block: null, variant: null }, M9: { block: 'accordion', variant: null },
  });
});

test('form fields are rows of the one Block Collection form, never variants', () => {
  for (const n of ['Input', 'Checkbox & Radio', 'Dropdown', 'Select', 'Slider', 'Range', 'Toggle', 'Switch', 'Textarea']) {
    const e = edsEquivalent(n);
    assert.deepEqual([e.block, e.variant, e.field], ['form', null, true], n);
    assert.match(e.reason, /field type rows of the Block Collection form, not a variant/, n);
  }
  assert.equal(edsEquivalent('Login').field, undefined);
  const out = resolveVariants(['Forms', 'Input', 'Dropdown', 'Toggle', 'Login', 'Sign In'].map((figma) => ({ key: slugOf(figma), figma, eds: edsEquivalent(figma) })));
  assert.deepEqual(out.map((e) => edsLabel(e)), ['form', 'form', 'form', 'form', 'form (login)', 'form (sign-in)']);
  assert.deepEqual(resolveVariants([{ key: 'a', eds: { block: 'form', variant: null } }, { key: 'b', eds: { block: 'form', variant: null } }]).map((e) => e.variant), [null, null]);
});
