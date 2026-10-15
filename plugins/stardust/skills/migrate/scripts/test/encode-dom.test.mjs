#!/usr/bin/env node
// Unit test: encode/dom.mjs — the encoder's mini DOM (parser + CSS-selector engine), pure, no browser, no network.
//
//   mini DOM sanity  implicit <li> close, textOf, combinators + [attr~=] + :last-child, selector lists,
//                    :not(:first-child), :has().
//   chained pseudo   :not(.a):not(.b) and friends — each argument ends at its own closing paren.
//   :has() relative  a leading > + ~ anchors at the element (default: descendant); plain :has(x) unchanged.
//
// The mini DOM sanity block is ported from the `stardust/next` branch:
// `skills/migrate/scripts/test/importer-skeleton.test.mjs` (commit 9aaeff4f).
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-dom.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { parseHTML, qsa, matches, textOf } from '../encode/dom.mjs';

// --- mini DOM sanity ---------------------------------------------------------------------------------------
{
  const d = parseHTML('<div id="a" class="x y"><p>one<b>two</b></p><ul><li>1<li>2</ul><img src=i.png><span data-k="v w">s</span></div>');
  assert.equal(qsa(d, 'li').length, 2, 'implicit li close');
  assert.equal(textOf(qsa(d, 'p')[0]), 'onetwo');
  assert.ok(matches(qsa(d, 'span')[0], 'div.x > span[data-k~="w"]:last-child'));
  assert.ok(matches(qsa(d, 'p')[0], '#a p:first-child, nothing'));
  assert.ok(!matches(qsa(d, 'p')[0], 'p:not(:first-child)'));
  assert.equal(qsa(d, 'div:has(img)').length, 1);
}

// --- chained functional pseudo-classes: each argument ends at ITS closing paren ----------------------------------
{
  const d = parseHTML('<main><div class="a">1</div><div class="b">2</div><div class="c" title="(x)">3<em>i</em></div><div>4</div></main>');
  const texts = (sel) => qsa(d, sel).map(textOf);
  assert.deepEqual(texts('div:not(.a):not(.b)'), ['3i', '4'], 'chained :not() excludes both');
  assert.deepEqual(texts('div:not(.a):not(.b):not(.c)'), ['4'], 'three chained :not()');
  assert.deepEqual(texts('div:is(.a, .c):not(.a)'), ['3i'], ':is() then :not()');
  assert.deepEqual(texts('div:not(:has(em)):not(.a)'), ['2', '4'], 'nested parens inside the first argument');
  assert.deepEqual(texts('div:not([title="(x)"]):not(.a)'), ['2', '4'], 'a paren inside a quoted value does not end the argument');
  assert.deepEqual(texts('div:not(.a).c'), ['3i'], 'a compound part after the argument still applies');
  assert.throws(() => qsa(d, 'div:not(.a'), /bad selector/, 'an unclosed argument fails loud');
}

// --- :has() takes relative selectors, anchored at the element ------------------------------------------------------
{
  const d = parseHTML('<main><div id="a"><div id="a1"><span class="x"></span></div></div><div id="b"><span class="x"></span></div>'
    + '<p id="p1"></p><i class="x"></i><p id="p2"><em>e</em></p><b></b><i class="x"></i><p id="p3"></p><i class="y"></i></main>');
  const ids = (sel) => qsa(d, sel).map((n) => n.attrs.id);
  assert.deepEqual(ids('div:has(.x)'), ['a', 'a1', 'b'], 'plain :has(x) unchanged: any descendant');
  assert.deepEqual(ids('div:has(> .x)'), ['a1', 'b'], ':has(> x): a child, not any descendant');
  assert.deepEqual(ids('p:has(+ .x)'), ['p1'], ':has(+ x): the next sibling');
  assert.deepEqual(ids('p:has(~ .x)'), ['p1', 'p2'], ':has(~ x): any following sibling');
  assert.deepEqual(ids('p:has(> em, + .y)'), ['p2', 'p3'], 'a list of relative selectors, each with its own combinator');
  assert.deepEqual(ids('div:has(main .x)'), [], 'the default descendant combinator is anchored too: main must be inside the div');
  assert.deepEqual(ids('div:has(:scope > .x)'), ['a1', 'b'], 'an explicitly :scope-anchored argument keeps working');
}

console.log('encode-dom: ok');
