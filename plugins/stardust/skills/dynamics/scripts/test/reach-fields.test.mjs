#!/usr/bin/env node
/**
 * Fixture test for the sidecar-contract half of evals/lint/dynamics-recall.mjs (no browser, no network).
 * Run: node skills/dynamics/scripts/test/reach-fields.test.mjs
 *
 * The lint once regexed one source line of extract/scripts/crawl.mjs (`dynamicDom:\s*\{([^}]*)\}`):
 * a line break, a nested value or a comment inside the literal silently emptied the field list and
 * every "crawl.mjs dynamicDom writes <field>" check failed — or, worse, a reformat that moved the
 * keys onto a second line passed nothing and failed loudly on a contract that still held. Asserts:
 *   objectLiteralKeys() finds the keys of a `name: { … }` literal however it is formatted (one line,
 *   multi-line, nested objects / arrays / calls, trailing comma, comments and strings with braces,
 *   quoted keys, spreads skipped, template literals with `${}`), and null when the literal is absent;
 *   the old one-line regex misses the multi-line form (the fragility being fixed);
 *   REACH_SIDECAR_FIELDS ⊆ the keys of crawl.mjs's real `dynamicDom` literal (the contract itself);
 *   maskLiterals keeps code and blanks comments / strings / regex literals (length preserved).
 * Exit: 0 all assertions pass · 1 an assertion failed.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectLiteralKeys, maskLiterals, REACH_SIDECAR_FIELDS } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

const oneLine = 'return { dynamicDom: { a, b, c }, other: 1 };';
eq('one-line shorthand literal', objectLiteralKeys(oneLine, 'dynamicDom'), ['a', 'b', 'c']);

const multi = `
  // dynamicDom: { notThis } — a comment that names the key
  const s = "dynamicDom: { norThis }";
  return {
    dynamicDom: {
      a,
      b: { nested: [1, 2, { deep: '}' }] }, // a brace in a string and in a comment }
      'quoted-key': fn(x, { y: 1 }),
      c: \`tpl \${obj.k} { not a key }\`,
      ...spread,
      d /* trailing */,
    },
    other: 1,
  };`;
eq('multi-line literal with nesting, comments, strings, quoted key, spread, trailing comma', objectLiteralKeys(multi, 'dynamicDom'), ['a', 'b', 'quoted-key', 'c', 'd']);
eq('absent literal → null', objectLiteralKeys('const x = { a: 1 };', 'dynamicDom'), null);
eq('a mention inside a comment or string is not the literal', objectLiteralKeys('// dynamicDom: { a }\nconst t = "dynamicDom: { b }";', 'dynamicDom'), null);
eq('regex literal with braces and quotes does not derail the walk', objectLiteralKeys("const re = /[\"'{]/g; const o = { dynamicDom: { a, b } };", 'dynamicDom'), ['a', 'b']);

// the fragility being fixed: the old regex over one line
const oldRegex = (src) => ((src.match(/dynamicDom:\s*\{([^}]*)\}/) || [])[1] || '').split(',').map((s) => s.trim().split(':')[0]).filter(Boolean);
eq('old one-line regex still handles the one-line form', oldRegex(oneLine), ['a', 'b', 'c']);
eq('old one-line regex misses the multi-line / nested form (keys truncated at the first `}`)', oldRegex(multi).includes('d'), false);

// the contract itself, on the real crawl.mjs
const crawl = readFileSync(join(here, '..', '..', '..', 'extract', 'scripts', 'crawl.mjs'), 'utf8');
const keys = objectLiteralKeys(crawl, 'dynamicDom');
eq('crawl.mjs dynamicDom literal found', Array.isArray(keys) && keys.length >= REACH_SIDECAR_FIELDS.length, true);
eq('every reach sidecar field is written by crawl.mjs', REACH_SIDECAR_FIELDS.filter((f) => !keys.includes(f)), []);

// maskLiterals
const src = "a = 'x{'; // c }\nb = /[}]/; c = `t${d}`;";
const masked = maskLiterals(src);
eq('mask preserves length', masked.length, src.length);
eq('mask blanks string, comment and regex contents, keeps code', masked.replace(/ +/g, ' '), "a = ' '; \nb = / /; c = ` ${d}`;".replace(/ +/g, ' '));

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('reach-fields: all assertions pass');
