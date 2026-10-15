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

console.log('encode-dom: ok');
