// Unit test for slot-map.mjs — the A′ fork's slot values located through the rollout block mapping: the selector
// grammar over migrate.mjs's element model, readMapping's reasons (absent, not hash-listed, stale), the archetype's
// anchors, the recipes of a fixture archetype (prototype + capture) and the values they read on sibling captures
// (one whose anchor matches twice). Static fixtures only: test/fixtures/slot-map/.
// Run: node skills/migrate/scripts/test/slot-map.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsFor, parseSelector, querySelectorAll, readMapping, slotRecipes, slotValues, UnsupportedSelector } from '../slot-map.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'slot-map');
const fx = (name) => readFileSync(join(FIX, name), 'utf8');
let failed = 0; let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`); }
}

// ---- selector grammar --------------------------------------------------------------------------
console.log('selector grammar');
const DOC = `<html><body><main id="m">
<ul class="list main-list" data-kind="cards grid">
  <li id="a:b" class="item first">One</li>
  <li class="item" data-href="/x/y.html?a=1&amp;b=2">Two <em>2</em></li>
  <p class="note">Aside</p>
  <li class="item last" lang="en-GB">Three</li>
</ul>
<div class="123 wrap"><span>Deep</span><p>Para</p><span>Other</span></div>
<script>document.write('<li class="item">fake</li>')</script>
</main></body></html>`;
const q = (sel) => querySelectorAll(DOC, sel).map((e) => DOC.slice(e.openEnd, e.closeStart).replace(/<[^>]*>/g, '').trim());
check('tag, *, #id, .class, descendant and > combinators, lists in document order (script text is never markup)', () => {
  assert.deepEqual(q('li'), ['One', 'Two 2', 'Three']);
  assert.deepEqual(q('ul > *'), ['One', 'Two 2', 'Aside', 'Three']);
  assert.deepEqual(q('#m > ul > li.first'), ['One']);
  assert.deepEqual(q('.item.last'), ['Three']);
  assert.deepEqual(q('main span'), ['Deep', 'Other']);
  assert.deepEqual(q('body > li'), []);
  assert.deepEqual(q('p.note, li.first'), ['One', 'Aside']);
});
check('attribute tests: [attr], =, ~=, ^=, $=, *= (values entity-decoded, quoted or identifiers)', () => {
  assert.deepEqual(q('[data-href]'), ['Two 2']);
  assert.deepEqual(q('[lang=en-GB]'), ['Three']);
  assert.deepEqual(q('[data-href="/x/y.html?a=1&b=2"]'), ['Two 2']);
  assert.deepEqual(q('ul[data-kind~=grid] > li:first-child'), ['One']);
  assert.deepEqual(q('ul[data-kind~="cards grid"] li'), []);
  assert.deepEqual(q('[data-href^="/x/"]'), ['Two 2']);
  assert.deepEqual(q("[data-href$='b=2']"), ['Two 2']);
  assert.deepEqual(q('[data-href*="y.html"]'), ['Two 2']);
});
check('structural pseudo-classes: :nth-of-type(n), :nth-child(n), :first-/:last-child, :first-/:last-of-type', () => {
  assert.deepEqual(q('li:nth-of-type(3)'), ['Three']);
  assert.deepEqual(q('li:nth-child(3)'), []);
  assert.deepEqual(q('ul > :nth-child(3)'), ['Aside']);
  assert.deepEqual(q('li:last-child'), ['Three']);
  assert.deepEqual(q('li:first-of-type'), ['One']);
  assert.deepEqual(q('div > span:last-of-type'), ['Other']);
  assert.deepEqual(q('div > :first-child'), ['Deep']);
});
check('backslash escapes in ids and classes (\\: and a hex escape)', () => {
  assert.deepEqual(q('#a\\:b'), ['One']);
  assert.deepEqual(q('.\\31 23 > p'), ['Para']);
});
check('parseSelector gives the compound list left to right with its combinators', () => {
  const none = { ids: [], classes: [], attrs: [], pseudos: [] };
  assert.deepEqual(parseSelector('main > ul li.item[data-x="1"]:nth-of-type(2), *#k'), [
    [{ combinator: null, tag: 'main', ...none }, { combinator: '>', tag: 'ul', ...none },
      { combinator: ' ', tag: 'li', ids: [], classes: ['item'], attrs: [{ name: 'data-x', op: '=', value: '1' }], pseudos: [{ name: 'nth-of-type', n: 2 }] }],
    [{ combinator: null, tag: null, ids: ['k'], classes: [], attrs: [], pseudos: [] }],
  ]);
});
check('anything outside the grammar throws UnsupportedSelector', () => {
  for (const sel of ['li + li', 'li ~ p', 'a:hover', 'p::before', 'li:nth-child(2n+1)', ':not(p)', '[lang|=en]', '[lang=en i]', 'svg|rect', '', 'li,', 'ul >', '[data-x', '"x"']) {
    assert.throws(() => parseSelector(sel), (e) => e instanceof UnsupportedSelector && e.name === 'UnsupportedSelector', sel);
    assert.throws(() => querySelectorAll(DOC, sel), UnsupportedSelector, sel);
  }
});

// ---- readMapping: read only a hash-listed, fresh mapping -----------------------------------------
console.log('readMapping');
check('a mapping listed by sha256 in the manifest outputs, generatedAt equal to pages.json → read', () => {
  const r = readMapping(join(FIX, 'rollout'));
  assert.equal(r.reason, null); assert.equal(r.generatedAt, '2026-10-01T08:00:00.000Z');
  assert.equal(r.mapping.templates.length, 2); assert.match(r.file, /rollout\/workspace\/mapping\.json$/);
});
check('absent → null with the reason', () => {
  const r = readMapping(join(FIX, 'no-such-rollout'));
  assert.equal(r.mapping, null); assert.match(r.reason, /no-such-rollout\/workspace\/mapping\.json is absent$/);
});
check('not hash-listed in the manifest outputs → null with the reason', () => {
  const r = readMapping(join(FIX, 'rollout-unlisted'));
  assert.equal(r.mapping, null); assert.match(r.reason, /rollout-unlisted\/workspace\/manifest\.json lists no workspace\/mapping\.json under outputs/);
});
check('stale (generatedAt differs from pages.json) → null with both stamps', () => {
  const r = readMapping(join(FIX, 'rollout-stale'));
  assert.equal(r.mapping, null);
  assert.match(r.reason, /rollout-stale\/workspace\/mapping\.json is stale: generatedAt 2026-10-01T08:00:00\.000Z, .*rollout-stale\/coverage\/pages\.json generatedAt 2026-10-02T09:30:00\.000Z/);
});

// ---- anchors, recipes, values -----------------------------------------------------------------
console.log('anchors, recipes and values');
const { mapping } = readMapping(join(FIX, 'rollout'));
const anchors = anchorsFor(mapping, null, 'trips');
check("anchorsFor: the archetype's verified, non-null block selectors, then the sections that resolved on it (each selector once)", () => {
  assert.deepEqual(anchors, [{ selector: 'div.hero-banner', kind: 'block', block: 'hero', pos: 0 }, { selector: 'div.article', kind: 'section', section: 's3' }]);
  assert.deepEqual(anchorsFor(mapping, 'other', 'trips'), [], 'a named template restricts the search');
  assert.deepEqual(anchorsFor(mapping, 'trip', 'trips').map((a) => a.selector), ['div.hero-banner', 'div.article']);
  assert.deepEqual(anchorsFor(mapping, null, 'nobody'), []); assert.deepEqual(anchorsFor(null, null, 'trips'), []);
});
const recipes = slotRecipes(fx('trips-proposed.html'), fx('trips.html'), anchors);
check("slotRecipes: each data-slot of the prototype's <main> → the innermost anchor holding its source and the child path to it", () => {
  assert.deepEqual(recipes, {
    hero: { anchor: 'div.hero-banner', path: [{ tag: 'div', n: 1 }, { tag: 'picture', n: 1 }, { tag: 'img', n: 1 }], kind: 'image' },
    headline: { anchor: 'div.hero-banner', path: [{ tag: 'div', n: 2 }, { tag: 'h1', n: 1 }], kind: 'text' },
    cta: { anchor: 'div.hero-banner', path: [{ tag: 'div', n: 2 }, { tag: 'a', n: 1 }], kind: 'link' },
    body: { anchor: 'div.article', path: [{ tag: 'div', n: 1 }], kind: 'html' },
  });
});
check('slotValues: a sibling capture gives its own text, image, link and HTML through the same anchors and paths', () => {
  assert.deepEqual(slotValues(recipes, fx('trip-one.html')), {
    slots: {
      hero: { src: '/content/media/north.jpg', alt: 'Aurora over the fjord', srcset: '/content/media/north.jpg 1x, /content/media/north-2x.jpg 2x' },
      headline: 'Northern lights',
      cta: { href: 'https://booking.example.org/north', text: 'Book the north' },
      body: { html: '<p>North body one.</p>\n      <p>North body <b>two</b>.</p>' },
    },
    unresolved: [],
  });
});
check('slotValues: entities decoded, a lazy image takes data-src, an extra element before the anchor and a missing one inside it do not matter', () => {
  assert.deepEqual(slotValues(recipes, fx('trip-two.html')), {
    slots: {
      hero: { src: '/content/media/coast.jpg', alt: 'Cliffs & sea' },
      headline: 'Coastal walks & cliffs',
      cta: { href: 'https://booking.example.org/coast?from=trips&lang=en', text: 'Book the coast' },
      body: { html: '<p>Coast body.</p>' },
    },
    unresolved: [],
  });
});
check('slotValues: an anchor matching twice on the sibling → null and listed for every slot under it', () => {
  const r = slotValues(recipes, fx('trip-twice.html'));
  assert.deepEqual(r.slots, { hero: null, headline: null, cta: null, body: { html: '<p>Lake body.</p>' } });
  assert.deepEqual(r.unresolved, ['hero', 'headline', 'cta'].map((slot) => ({ slot, reason: 'anchor "div.hero-banner" matches 2 elements' })));
});

// ---- slot kinds, nested and repeated slots, slots without a recipe -------------------------------
const PROTO = `<html><body><main>
<div class="card" data-slot="card"><h3>Card title</h3><p>Card text <span data-slot="card-note">note</span></p></div>
<figure data-slot="pic"><picture><source srcset="/m/pic.webp"><img src="assets/media/pic-0badf00d.png" alt=""></picture></figure>
<div data-slot="more"><a href="/more">Read more</a></div>
<p data-slot="deck">Deck <em>text</em></p>
<p data-slot="mixed">See <a href="/a">the guide</a> first</p>
<ul><li data-slot="tip">Tip one</li><li data-slot="tip">Tip two</li></ul>
<p data-slot="ghost">Not in the capture</p>
<p data-slot="empty"></p>
</main></body></html>`;
const CAPTURE = `<html><body><main><section class="s">
<div class="c"><h3>Card title</h3><p>Card text note</p></div>
<div class="f"><img src="/m/picture.png" alt="Not this one"><img data-src="https://cdn.example.test/m/pic.png?w=800" alt="A picture"></div>
<div class="m"><a href="/a">the guide</a><a href="/more">Read more</a></div>
<p>Deck <i>text</i></p>
<p>See <a href="/a">the guide</a> first</p>
<ul><li>Tip one</li><li>Tip two</li></ul>
</section></main></body></html>`;
const SIBLING = `<html><body><main><section class="s">
<div class="c"><h3>Sibling card</h3><p>Its text</p></div>
<div class="f"><img src="/m/x.png" alt=""><img data-src="https://cdn.example.test/m/sib.png?w=800" alt="Sibling picture"></div>
<div class="m"><a href="/b">other</a><a href="/sib-more">Read on</a></div>
<p></p>
<p>See <a href="/b">another guide</a> later</p>
<ul><li>Only tip</li></ul>
</section></main></body></html>`;
const kinds = slotRecipes(PROTO, CAPTURE, ['section.s', 'p:nth-of-type(9)', 'a:hover']);
check('kinds: block children → html (nested slots go with it), a lone image → image, a lone link → link, inline formatting → text, inline link → html', () => {
  assert.deepEqual(Object.keys(kinds), ['card', 'pic', 'more', 'deck', 'mixed', 'tip', 'ghost', 'empty'], 'card-note is inside replaced content');
  assert.deepEqual(kinds.card, { anchor: 'section.s', path: [{ tag: 'div', n: 1 }], kind: 'html' });
  assert.deepEqual(kinds.pic, { anchor: 'section.s', path: [{ tag: 'div', n: 2 }, { tag: 'img', n: 2 }], kind: 'image' }, 'the file name without the media-harvest hash; pic.png, not picture.png');
  assert.deepEqual(kinds.more, { anchor: 'section.s', path: [{ tag: 'div', n: 3 }, { tag: 'a', n: 2 }], kind: 'link' });
  assert.deepEqual(kinds.deck, { anchor: 'section.s', path: [{ tag: 'p', n: 1 }], kind: 'text' });
  assert.deepEqual(kinds.mixed, { anchor: 'section.s', path: [{ tag: 'p', n: 2 }], kind: 'html' });
});
check('a repeated slot → one recipe per element; a slot not found or without text → no anchor, with the reason', () => {
  assert.deepEqual(kinds.tip, [{ anchor: 'section.s', path: [{ tag: 'ul', n: 1 }, { tag: 'li', n: 1 }], kind: 'text' }, { anchor: 'section.s', path: [{ tag: 'ul', n: 1 }, { tag: 'li', n: 2 }], kind: 'text' }]);
  assert.deepEqual(kinds.ghost, { anchor: null, path: null, kind: 'text', reason: 'its text is inside no mapped element of the archetype capture' });
  assert.deepEqual(kinds.empty, { anchor: null, path: null, kind: 'text', reason: 'the archetype slot has no text to find it by' });
  const lost = slotRecipes(PROTO, CAPTURE, ['p:nth-of-type(9)', 'div']);
  assert.equal(lost.card.reason, 'no mapped selector matches exactly one element of the archetype capture', 'an anchor matching none or several elements is not used');
});
check('values: a repeated slot gives a list (a missing element → null and listed); an empty text → null, not listed; no recipe → absent', () => {
  const r = slotValues(kinds, SIBLING);
  assert.deepEqual(r.slots, {
    card: { html: '<h3>Sibling card</h3><p>Its text</p>' },
    pic: { src: 'https://cdn.example.test/m/sib.png?w=800', alt: 'Sibling picture' },
    more: { href: '/sib-more', text: 'Read on' },
    deck: null,
    mixed: { html: 'See <a href="/b">another guide</a> later' },
    tip: null,
  });
  assert.deepEqual(r.unresolved, [{ slot: 'tip', reason: 'path ul[1]/li[2] under "section.s" leads nowhere' }]);
  assert.deepEqual(slotValues({ tip: kinds.tip }, CAPTURE).slots, { tip: ['Tip one', 'Tip two'] });
});

console.log(failed ? `\n${failed} check(s) failed, ${passed} passed` : `\nall checks passed (${passed})`);
process.exitCode = failed ? 1 : 0;
