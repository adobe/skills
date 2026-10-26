#!/usr/bin/env node
// client-logic.mjs — pure helpers: prettify keeps literals intact, source-map decoding, number parsing for diff.
// Run: node plugins/stardust/skills/dynamics/scripts/test/client-logic.test.mjs
import assert from 'node:assert/strict';
import { prettify, decodeMappings, num } from '../client-logic.mjs';

let failures = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}

check('prettify: one statement per line, literals untouched, division vs regex', () => {
  const out = prettify('function f(a,b){if(a>1){return a/b*2}var r=/a\\/b[/]c/g.test(b);return`x${a+`y${b}`}`};var s="a;b{c}";x=a\n/2/1;');
  assert.match(out, /^\s+return a\/b\*2$/m);
  assert.ok(out.includes('/a\\/b[/]c/g.test(b);'));
  assert.ok(out.includes('return`x${a+`y${b}`}`'));
  assert.ok(out.includes('var s="a;b{c}";'));
  assert.ok(out.includes('x=a /2/1;'));
});

check('prettify: linear on a large bundle', () => {
  const big = 'function g(x){return x*2+Math.pow(x,3)/7;}'.repeat(60000);
  const t0 = Date.now(); prettify(big);
  assert.ok(Date.now() - t0 < 3000, 'took too long');
});

check('decodeMappings: VLQ segments', () => {
  // "AAAA;AACA" → line 0: [0,0,0,0]; line 1: [0,0,1,0]
  assert.deepEqual(decodeMappings('AAAA;AACA'), [[[0, 0, 0, 0]], [[0, 0, 1, 0]]]);
  // "AAAA,EAAE" → second segment genCol +2, srcCol +2
  assert.deepEqual(decodeMappings('AAAA,EAAE')[0][1], [2, 0, 0, 2]);
});

check('num: separators and locales', () => {
  const cases = [['The final balance is CHF3’192.91.', 3192.91], ['1 234 567 kr', 1234567], ['12,5 %', 12.5], ['−3', -3],
    ['1,234.56', 1234.56], ['1.234.567', 1234567], ['$1,000', 1000], ['0,125', 0.125], ['1.234,56', 1234.56], ['n/a', null]];
  for (const [t, v] of cases) assert.equal(num(t), v, t);
  assert.equal(num('1,234', { decimal: ',' }), 1.234);
});

if (failures) { console.error(`${failures} failing`); process.exit(1); }
console.log('client-logic: all checks passed');
