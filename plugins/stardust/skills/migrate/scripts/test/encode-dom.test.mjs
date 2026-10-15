#!/usr/bin/env node
// Unit test: encode/dom.mjs — the encoder's mini DOM (parser + CSS-selector engine), pure, no browser, no network.
//
//   mini DOM sanity  implicit <li> close, textOf, combinators + [attr~=] + :last-child, selector lists,
//                    :not(:first-child), :has().
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

console.log('encode-dom: ok');
